/**
 * @file service-worker.js
 * modcore Extension Manager - background service worker.
 */

'use strict';

import { triggerCRXDownload, registerCrxListeners } from '../features/crx-downloader/crx-downloader.js';
import {
    registerActionMenus,
    isActionMenuItem,
    handleActionMenuClick,
} from '../features/actions-menu/actions-menu.js';
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
} from '../features/timeline/timeline-manager.js';
import {
    RULES_STORAGE_KEY,
    PROFILES_STORAGE_KEY,
    getUrlRulesCache,
    updateAlarmsAndCache,
    executeRuleAction,
    handleRuleAlarm,
} from '../features/automations/automations-manager.js';

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

// Guards against double-registering listeners
let managementListenersRegistered = false;

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
// Extension update / permission-change polling
// ==========================================================================

const POLL_ALARM_NAME = 'modcore_ext_poll';

/**
 * Polls all installed extensions and detects updates & permission changes.
 * chrome.management has NO onUpdated event, so we must poll.
 */
async function pollExtensionChanges() {
    try {
        const extensions = await chrome.management.getAll();
        const currentIds = new Set();

        for (const ext of extensions) {
            if (!ext.id) continue;
            currentIds.add(ext.id);

            const previousPerms = permissionsCache.get(ext.id);
            const currentPerms  = ext.permissions || [];

            // If we've seen this extension before and permissions changed
            if (previousPerms !== undefined) {
                const added   = currentPerms.filter(p => !previousPerms.includes(p));
                const removed = previousPerms.filter(p => !currentPerms.includes(p));

                if (added.length || removed.length) {
                    let details = `Updated to v${ext.version}.`;
                    if (added.length)   details += ` Added permissions: ${added.join(', ')}.`;
                    if (removed.length) details += ` Removed permissions: ${removed.join(', ')}.`;

                    recordExtensionActivity('permissions_updated', ext, details);
                } else if (ext.version) {
                    // Version changed but permissions didn't? We can't know for sure
                    // without caching version too, but let's record a generic update
                    // if we want to be thorough. For now, we only record if permissions
                    // actually changed, which is the important part.
                }
            }

            // Always refresh cache
            permissionsCache.set(ext.id, [...currentPerms]);
        }

        // Clean up cache for uninstalled extensions
        for (const [id] of permissionsCache) {
            if (!currentIds.has(id)) {
                permissionsCache.delete(id);
            }
        }
    } catch (err) {
        console.warn('pollExtensionChanges failed:', err);
    }
}

async function registerPollAlarm() {
    // Poll every 30 seconds while the service worker is alive.
    // The alarm itself will wake the worker, but the polling only runs
    // when the alarm fires. This is lightweight enough.
    const existing = await chrome.alarms.get(POLL_ALARM_NAME);
    if (!existing) {
        chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: 0.5 });
    }
}

// ==========================================================================
// chrome.management Listeners
// ==========================================================================

function safeAddListener(event, handler, label) {
    if (!event || typeof event.addListener !== 'function') {
        console.warn(`chrome.management.${label} is unavailable in this context; skipping.`);
        return;
    }
    try {
        event.addListener(handler);
    } catch (err) {
        console.warn(`Failed to register chrome.management.${label} listener:`, err);
    }
}

function registerManagementListeners() {
    if (managementListenersRegistered) return;
    managementListenersRegistered = true;

    const management = chrome.management;

    safeAddListener(management?.onInstalled, info => {
        recordExtensionActivity('installed', info);
        permissionsCache.set(info.id, [...(info.permissions || [])]);
    }, 'onInstalled');

    safeAddListener(management?.onUninstalled, id => {
        recordExtensionActivity('uninstalled', { id, name: 'Unknown', version: 'Unknown' });
        permissionsCache.delete(id);
    }, 'onUninstalled');

    safeAddListener(management?.onEnabled, info => {
        recordExtensionActivity('enabled', info);
        permissionsCache.set(info.id, [...(info.permissions || [])]);
    }, 'onEnabled');

    safeAddListener(management?.onDisabled, info => {
        recordExtensionActivity('disabled', info);
        permissionsCache.set(info.id, [...(info.permissions || [])]);
    }, 'onDisabled');

    // NOTE: chrome.management.onUpdated does NOT exist in Chrome.
    // We use pollExtensionChanges() via alarms instead.

    console.log('chrome.management listeners registered.');
}

// Top-level MV3 registration
registerManagementListeners();
initializePermissionsCache();
registerPollAlarm();

// ==========================================================================
// Context Menu Management
// ==========================================================================

function registerContextMenus() {
    chrome.contextMenus.removeAll(() => {
        if (chrome.runtime.lastError) {
            console.warn('removeAll menus:', chrome.runtime.lastError.message);
        }

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

        registerActionMenus();

        chrome.contextMenus.create({
            id: MENU_DONATE,
            title: chrome.i18n.getMessage('donate_menu'),
            contexts: ['action'],
        });

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
    if (alarm.name === POLL_ALARM_NAME) {
        await pollExtensionChanges();
        return;
    }
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
// CRX / ZIP / Actions / Donate Delegation
// ==========================================================================

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_CRX_DOWNLOAD || info.menuItemId === ACTION_MENU_CRX_DOWNLOAD) {
        triggerCRXDownload(tab, 'crx');
    } else if (info.menuItemId === MENU_ZIP_DOWNLOAD || info.menuItemId === ACTION_MENU_ZIP_DOWNLOAD) {
        triggerCRXDownload(tab, 'zip');
    } else if (isActionMenuItem(info.menuItemId)) {
        handleActionMenuClick(info.menuItemId);
    } else if (info.menuItemId === MENU_DONATE) {
        chrome.tabs.create({ url: 'https://www.patreon.com/cw/modcore' });
    }
});

registerCrxListeners();