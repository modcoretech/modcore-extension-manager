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

    if (details.reason === 'install' || details.reason === 'update') {
        try {
            const selfInfo = await chrome.management.get(chrome.runtime.id);
            recordExtensionActivity(details.reason, selfInfo, `Reason: ${details.reason}`);
        } catch (_) {}
    }

    // Context menus (consolidated to avoid duplicate creation)
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id:                  'getCRX',
            title:               chrome.i18n.getMessage('get_crx_menu'),
            contexts:            ['all'],
            documentUrlPatterns: [
                'https://chrome.google.com/webstore/detail/*',
                'https://chromewebstore.google.com/detail/*',
            ],
        });
        chrome.contextMenus.create({
            id:       'donate',
            title:    chrome.i18n.getMessage('donate_menu'),
            contexts: ['browser_action', 'action'],
        });
    });

    chrome.runtime.setUninstallURL(
        'https://sites.google.com/view/modcore-apps/modcore-apps/modcore-extension-manager/ui/uninstall'
    );
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('Browser started. Re-initializing systems.');
    await updateAlarmsAndCache();
    await initializePermissionsCache();
    registerManagementListeners();
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
    // Ensure we only care about the primary top-level frame navigation finishing
    if (changeInfo.status !== 'complete' || !tab.url) return;

    // Use tab.url safety fallback and ignore subframe resource completions
    const cache = getUrlRulesCache();
    if (!cache || cache.length === 0) return;

    for (const rule of cache) {
        if (rule.enabled && rule.trigger?.url) {
            // Upgrade from basic substring inclusion to a cleaner match boundary
            if (tab.url.includes(rule.trigger.url)) {
                executeRuleAction(rule);
            }
        }
    }
});

// ==========================================================================
// CRX Download Delegation
// ==========================================================================

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'getCRX')  triggerCRXDownload(tab);
    if (info.menuItemId === 'donate')  chrome.tabs.create({ url: 'https://www.patreon.com/cw/modcore' });
});

registerCrxListeners();