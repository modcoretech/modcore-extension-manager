/**
 * @file service-worker.js
 * modcore Extension Manager - background service worker.
 */

'use strict';

import { triggerCRXDownload, registerCrxListeners } from '../features/crx-downloader.js';
import {
    EXTENSION_HISTORY_KEY,
    HISTORY_SETTINGS_KEY,
    recordExtensionActivity,
    clearExtensionHistory,
    handlePruneByDays,
    handlePruneInactive,
    handlePruneByTypes,
    handlePruneToLimit,
    handleRestoreHistory,
} from '../features/timeline-manager.js';
import {
    RULES_STORAGE_KEY,
    PROFILES_STORAGE_KEY,
    getUrlRulesCache,
    updateAlarmsAndCache,
    executeRuleAction,
    handleRuleAlarm,
} from '../features/automations-manager.js';

// ==========================================================================
// Context Menu Constants
// ==========================================================================

const WEBSTORE_PATTERNS = [
    'https://chrome.google.com/webstore/detail/*',
    'https://chromewebstore.google.com/detail/*',
];

const MENU_CRX_FEATURES = 'crxFeatures';
const MENU_CRX_DOWNLOAD = 'crxDownload';
const MENU_ZIP_DOWNLOAD = 'zipDownload';
const MENU_DONATE       = 'donate';

const ACTION_MENU_CRX_FEATURES = 'crxFeatures_action';
const ACTION_MENU_CRX_DOWNLOAD = 'crxDownload_action';
const ACTION_MENU_ZIP_DOWNLOAD = 'zipDownload_action';

let actionCrxMenuVisible = false;

// ==========================================================================
// Permissions cache (for accurate permission-change detection)
// ==========================================================================

let permissionsCache = new Map();

// ==========================================================================
// Permissions cache init
// ==========================================================================

async function initializePermissionsCache() {
    try {
        const extensions = await chrome.management.getAll();
        permissionsCache.clear();
        extensions.forEach(ext => {
            if (ext.id) permissionsCache.set(ext.id, [...(ext.permissions || [])]);
        });
    } catch (err) {
        console.warn('initializePermissionsCache failed:', err);
    }
}

// ==========================================================================
// chrome.management Listeners
// ==========================================================================

function registerManagementListeners() {
    try {
        chrome.management.onInstalled.addListener(info => {
            recordExtensionActivity('installed', info);
            permissionsCache.set(info.id, [...(info.permissions || [])]);
        });

        chrome.management.onUninstalled.addListener(id => {
            recordExtensionActivity('uninstalled', { id, name: 'Unknown', version: 'Unknown' });
            permissionsCache.delete(id);
        });

        chrome.management.onEnabled.addListener(info => {
            recordExtensionActivity('enabled', info);
            permissionsCache.set(info.id, [...(info.permissions || [])]);
        });

        chrome.management.onDisabled.addListener(info => {
            recordExtensionActivity('disabled', info);
            permissionsCache.set(info.id, [...(info.permissions || [])]);
        });

        chrome.management.onUpdated.addListener(info => {
            const previousPerms = permissionsCache.get(info.id);
            const currentPerms  = info.permissions || [];
            let added = [], removed = [];

            if (previousPerms !== undefined) {
                added   = currentPerms.filter(p => !previousPerms.includes(p));
                removed = previousPerms.filter(p => !currentPerms.includes(p));
            }

            let details = `Updated to v${info.version}.`;
            if (added.length)   details += ` Added permissions: ${added.join(', ')}.`;
            if (removed.length) details += ` Removed permissions: ${removed.join(', ')}.`;

            const evType = (previousPerms !== undefined && (added.length || removed.length))
                ? 'permissions_updated'
                : 'updated';

            recordExtensionActivity(evType, info, details);
            permissionsCache.set(info.id, [...currentPerms]);
        });

        console.log('chrome.management listeners registered.');
    } catch (err) {
        console.warn('registerManagementListeners failed:', err);
    }
}

// ==========================================================================
// Context Menu Management
// ==========================================================================

function registerContextMenus() {
    chrome.contextMenus.removeAll(() => {
        if (chrome.runtime.lastError) {
            console.warn('removeAll menus:', chrome.runtime.lastError.message);
        }

        // Page context menus — only visible on Web Store extension pages
        chrome.contextMenus.create({
            id: MENU_CRX_FEATURES,
            title: chrome.i18n.getMessage('crx_features_menu'),
            contexts: ['all'],
            documentUrlPatterns: WEBSTORE_PATTERNS,
        });
        chrome.contextMenus.create({
            id: MENU_CRX_DOWNLOAD,
            parentId: MENU_CRX_FEATURES,
            title: chrome.i18n.getMessage('crx_download_menu'),
            contexts: ['all'],
            documentUrlPatterns: WEBSTORE_PATTERNS,
        });
        chrome.contextMenus.create({
            id: MENU_ZIP_DOWNLOAD,
            parentId: MENU_CRX_FEATURES,
            title: chrome.i18n.getMessage('zip_download_menu'),
            contexts: ['all'],
            documentUrlPatterns: WEBSTORE_PATTERNS,
        });

        // Action context menu — always visible
        chrome.contextMenus.create({
            id: MENU_DONATE,
            title: chrome.i18n.getMessage('donate_menu'),
            contexts: ['action'],
        });

        // Reset dynamic state and evaluate current active tab
        actionCrxMenuVisible = false;
        updateActionCrxMenu();
    });
}

async function updateActionCrxMenu() {
    let url = '';
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        url = tabs[0]?.url || '';
    } catch (e) {
        console.warn('updateActionCrxMenu: failed to query tabs', e);
        return;
    }

    const shouldShow = url && (
        url.includes('chrome.google.com/webstore/detail') ||
        url.includes('chromewebstore.google.com/detail')
    );

    if (shouldShow && !actionCrxMenuVisible) {
        try {
            chrome.contextMenus.create({
                id: ACTION_MENU_CRX_FEATURES,
                title: chrome.i18n.getMessage('crx_features_menu'),
                contexts: ['action'],
            });
            chrome.contextMenus.create({
                id: ACTION_MENU_CRX_DOWNLOAD,
                parentId: ACTION_MENU_CRX_FEATURES,
                title: chrome.i18n.getMessage('crx_download_menu'),
                contexts: ['action'],
            });
            chrome.contextMenus.create({
                id: ACTION_MENU_ZIP_DOWNLOAD,
                parentId: ACTION_MENU_CRX_FEATURES,
                title: chrome.i18n.getMessage('zip_download_menu'),
                contexts: ['action'],
            });
            actionCrxMenuVisible = true;
        } catch (err) {
            console.warn('Failed to create action CRX menu:', err);
        }
    } else if (!shouldShow && actionCrxMenuVisible) {
        try {
            chrome.contextMenus.remove(ACTION_MENU_ZIP_DOWNLOAD);
            chrome.contextMenus.remove(ACTION_MENU_CRX_DOWNLOAD);
            chrome.contextMenus.remove(ACTION_MENU_CRX_FEATURES);
            actionCrxMenuVisible = false;
        } catch (err) {
            console.warn('Failed to remove action CRX menu:', err);
        }
    }
}

// Update action menu when the active tab changes or navigates
chrome.tabs.onActivated.addListener(() => updateActionCrxMenu());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, _tab) => {
    if (changeInfo.url) updateActionCrxMenu();
});

// ==========================================================================
// Lifecycle Events
// ==========================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`Extension ${details.reason}. Initializing systems.`);

    if (details.reason === 'install') {
        await chrome.storage.local.set({
            [RULES_STORAGE_KEY]:    [],
            [EXTENSION_HISTORY_KEY]:    [],
            [HISTORY_SETTINGS_KEY]:     { trackingEnabled: true },
        });
        console.log('Default settings initialized.');
    }

    await updateAlarmsAndCache();
    await initializePermissionsCache();
    registerManagementListeners();
    registerContextMenus();

    if (details.reason === 'install' || details.reason === 'update') {
        try {
            const selfInfo = await chrome.management.get(chrome.runtime.id);
            recordExtensionActivity(details.reason, selfInfo, `Reason: ${details.reason}`);
        } catch (_) {}
    }

    chrome.runtime.setUninstallURL(
        'https://sites.google.com/view/modcore-apps/modcore-apps/modcore-extension-manager/ui/uninstall'
    );
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('Browser started. Re-initializing systems.');
    await updateAlarmsAndCache();
    await initializePermissionsCache();
    registerManagementListeners();
    updateActionCrxMenu();
});

// ==========================================================================
// Message Handling
// ==========================================================================

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    switch (request.type) {

        case 'SAVE_RULES':
            chrome.storage.local.set({ [RULES_STORAGE_KEY]: request.payload }, () => {
                updateAlarmsAndCache();
                sendResponse({ status: 'success' });
            });
            return true;

        case 'GET_EXTENSION_HISTORY':
            chrome.storage.local.get(EXTENSION_HISTORY_KEY, result => {
                sendResponse({ history: result[EXTENSION_HISTORY_KEY] ?? [] });
            });
            return true;

        case 'GET_HISTORY_SETTINGS':
            chrome.storage.local.get(HISTORY_SETTINGS_KEY, result => {
                sendResponse({ settings: result[HISTORY_SETTINGS_KEY] ?? { trackingEnabled: true } });
            });
            return true;

        case 'UPDATE_HISTORY_SETTINGS':
            chrome.storage.local.set({ [HISTORY_SETTINGS_KEY]: request.payload }, () => {
                sendResponse({ status: 'success' });
            });
            return true;

        case 'CLEAR_EXTENSION_HISTORY':
            clearExtensionHistory().then(() => sendResponse({ status: 'success' }));
            return true;

        case 'PRUNE_HISTORY_BY_DAYS':
            handlePruneByDays(request.payload)
                .then(() => sendResponse({ status: 'success' }))
                .catch(err => sendResponse({ status: 'error', message: err.message }));
            return true;

        case 'PRUNE_INACTIVE_EXTENSIONS':
            handlePruneInactive()
                .then(() => sendResponse({ status: 'success' }))
                .catch(err => sendResponse({ status: 'error', message: err.message }));
            return true;

        case 'PRUNE_HISTORY_BY_TYPES':
            handlePruneByTypes(request.payload)
                .then(() => sendResponse({ status: 'success' }))
                .catch(err => sendResponse({ status: 'error', message: err.message }));
            return true;

        case 'PRUNE_HISTORY_TO_LIMIT':
            handlePruneToLimit(request.payload)
                .then(() => sendResponse({ status: 'success' }))
                .catch(err => sendResponse({ status: 'error', message: err.message }));
            return true;

        case 'RESTORE_HISTORY':
            handleRestoreHistory(request.payload)
                .then(() => sendResponse({ status: 'success' }))
                .catch(err => sendResponse({ status: 'error', message: err.message }));
            return true;
    }
});

// ==========================================================================
// Alarm Handler
// ==========================================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith('rule_')) {
        await handleRuleAlarm(alarm.name);
        return;
    }
});

// ==========================================================================
// Tab URL-Rule Watcher
// ==========================================================================

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    const cache = getUrlRulesCache();
    if (!cache || cache.length === 0) return;

    for (const rule of cache) {
        if (rule.enabled && rule.trigger?.url) {
            if (tab.url.includes(rule.trigger.url)) {
                executeRuleAction(rule);
            }
        }
    }
});

// ==========================================================================
// CRX / ZIP Download Delegation
// ==========================================================================

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_CRX_DOWNLOAD || info.menuItemId === ACTION_MENU_CRX_DOWNLOAD) {
        triggerCRXDownload(tab, 'crx');
    } else if (info.menuItemId === MENU_ZIP_DOWNLOAD || info.menuItemId === ACTION_MENU_ZIP_DOWNLOAD) {
        triggerCRXDownload(tab, 'zip');
    } else if (info.menuItemId === MENU_DONATE) {
        chrome.tabs.create({ url: 'https://www.patreon.com/cw/modcore' });
    }
});

registerCrxListeners();