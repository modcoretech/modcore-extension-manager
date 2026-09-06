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

const DEFAULT_HISTORY_SETTINGS = {
    trackingEnabled:    true,
    sortOrder:          'desc',
    logsPerPage:        25,
    pruneDays:          90,
    recordLimit:        1000,
    relativeTimestamps: false,
};

function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

let actionCrxMenuVisible = false;

// ==========================================================================
// Extension state cache (for accurate update / permission-change detection)
// ==========================================================================

const EXT_STATE_CACHE_KEY = 'timeline_ext_state_cache';

// Guards against double-registering listeners
let managementListenersRegistered = false;

async function getExtStateCache() {
    try {
        const res = await chrome.storage.local.get(EXT_STATE_CACHE_KEY);
        return res[EXT_STATE_CACHE_KEY] && typeof res[EXT_STATE_CACHE_KEY] === 'object'
            ? res[EXT_STATE_CACHE_KEY]
            : {};
    } catch (err) {
        console.warn('getExtStateCache failed:', err);
        return {};
    }
}

async function setExtStateCache(cache) {
    try {
        await chrome.storage.local.set({ [EXT_STATE_CACHE_KEY]: cache });
    } catch (err) {
        console.warn('setExtStateCache failed:', err);
    }
}

/** Takes a stable snapshot of the fields we diff against later. */
function snapshotExtension(ext) {
    return {
        version:         ext.version || 'unknown',
        enabled:         !!ext.enabled,
        permissions:     [...(ext.permissions || [])].sort(),
        hostPermissions: [...(ext.hostPermissions || [])].sort(),
    };
}

function diffLists(prev = [], curr = []) {
    return {
        added:   curr.filter(p => !prev.includes(p)),
        removed: prev.filter(p => !curr.includes(p)),
    };
}

async function updateCacheEntry(ext) {
    const cache = await getExtStateCache();
    cache[ext.id] = snapshotExtension(ext);
    await setExtStateCache(cache);
}

/**
 * Populates the cache from currently installed extensions the first time
 * the extension runs (or after storage has been cleared), without emitting
 * any history events. Without this seed step, everything already installed
 * at first run would look like a "change" on the very first poll.
 */
async function seedExtStateCacheIfNeeded() {
    const cache = await getExtStateCache();
    if (Object.keys(cache).length > 0) return;
    try {
        const extensions = await chrome.management.getAll();
        const seeded = {};
        extensions.forEach(ext => { if (ext.id) seeded[ext.id] = snapshotExtension(ext); });
        await setExtStateCache(seeded);
    } catch (err) {
        console.warn('seedExtStateCacheIfNeeded failed:', err);
    }
}

// ==========================================================================
// Extension update / permission-change polling
// ==========================================================================

const POLL_ALARM_NAME = 'modcore_ext_poll';

/**
 * Polls all installed extensions and detects version changes (updates) and
 * permission/host-permission changes.
 */
async function pollExtensionChanges() {
    let extensions;
    try {
        extensions = await chrome.management.getAll();
    } catch (err) {
        console.warn('pollExtensionChanges: chrome.management.getAll failed:', err);
        return;
    }

    const cache = await getExtStateCache();
    const currentIds = new Set();

    for (const ext of extensions) {
        if (!ext.id) continue;
        currentIds.add(ext.id);

        const prev = cache[ext.id];
        const snap = snapshotExtension(ext);

        if (prev) {
            if (prev.version !== snap.version) {
                await recordExtensionActivity(
                    'updated', ext, `Updated from v${prev.version} to v${snap.version}.`
                );
            }

            const permDiff = diffLists(prev.permissions, snap.permissions);
            const hostDiff = diffLists(prev.hostPermissions, snap.hostPermissions);
            if (permDiff.added.length || permDiff.removed.length || hostDiff.added.length || hostDiff.removed.length) {
                const parts = [];
                if (permDiff.added.length)   parts.push(`Added permissions: ${permDiff.added.join(', ')}`);
                if (permDiff.removed.length) parts.push(`Removed permissions: ${permDiff.removed.join(', ')}`);
                if (hostDiff.added.length)   parts.push(`Added site access: ${hostDiff.added.join(', ')}`);
                if (hostDiff.removed.length) parts.push(`Removed site access: ${hostDiff.removed.join(', ')}`);
                await recordExtensionActivity('permissions_updated', ext, parts.join(' | '));
            }
        }

        cache[ext.id] = snap;
    }

    // Clean up cache entries for extensions that are no longer installed.
    for (const id of Object.keys(cache)) {
        if (!currentIds.has(id)) delete cache[id];
    }

    await setExtStateCache(cache);
}

async function registerPollAlarm() {
    const existing = await chrome.alarms.get(POLL_ALARM_NAME);
    if (!existing) {
        chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: 1 });
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

    safeAddListener(management?.onInstalled, async (info) => {
        try {
            const cache = await getExtStateCache();
            const prev = cache[info.id];
            const snap = snapshotExtension(info);

            if (prev) {
                if (prev.version !== snap.version) {
                    await recordExtensionActivity(
                        'updated', info, `Updated from v${prev.version} to v${snap.version}.`
                    );
                } else {
                    await recordExtensionActivity('installed', info, 'Reinstalled.');
                }
            } else {
                await recordExtensionActivity('installed', info);
            }

            cache[info.id] = snap;
            await setExtStateCache(cache);
        } catch (err) {
            console.warn('onInstalled handling failed:', err);
        }
    }, 'onInstalled');

    safeAddListener(management?.onUninstalled, async (id) => {
        await recordExtensionActivity('uninstalled', { id, name: 'Unknown', version: 'Unknown' });
        try {
            const cache = await getExtStateCache();
            delete cache[id];
            await setExtStateCache(cache);
        } catch (err) {
            console.warn('onUninstalled cache cleanup failed:', err);
        }
    }, 'onUninstalled');

    safeAddListener(management?.onEnabled, async (info) => {
        await recordExtensionActivity('enabled', info);
        await updateCacheEntry(info);
    }, 'onEnabled');

    safeAddListener(management?.onDisabled, async (info) => {
        await recordExtensionActivity('disabled', info);
        await updateCacheEntry(info);
    }, 'onDisabled');

    // Updates that don't fire onInstalled, and all permission/host-permission
    // changes, are caught by the periodic poll (see pollExtensionChanges).

    console.log('chrome.management listeners registered.');
}

// Top-level MV3 registration
registerManagementListeners();
seedExtStateCacheIfNeeded();
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
            [RULES_STORAGE_KEY]:     [],
            [EXTENSION_HISTORY_KEY]: [],
            [HISTORY_SETTINGS_KEY]:  DEFAULT_HISTORY_SETTINGS,
        });
        console.log('Default settings initialized.');
    }

    await updateAlarmsAndCache();
    await seedExtStateCacheIfNeeded();
    registerContextMenus();

    if (details.reason === 'install' || details.reason === 'update') {
        const eventType = details.reason === 'install' ? 'installed' : 'updated';
        try {
            const selfInfo = await chrome.management.get(chrome.runtime.id);
            await recordExtensionActivity(eventType, selfInfo, `modcore EM was ${eventType} (reason: ${details.reason}).`);
            await updateCacheEntry(selfInfo);
        } catch (_) {}
    }

    chrome.runtime.setUninstallURL(
        'https://sites.google.com/view/modcore-apps/modcore-apps/modcore-extension-manager/ui/uninstall'
    );
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('Browser started. Re-initializing systems.');
    await updateAlarmsAndCache();
    await seedExtStateCacheIfNeeded();
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
                sendResponse({ settings: result[HISTORY_SETTINGS_KEY] ?? DEFAULT_HISTORY_SETTINGS });
            });
            return true;

        case 'UPDATE_HISTORY_SETTINGS': {
            const payload = request.payload;
            if (!payload || typeof payload !== 'object') {
                sendResponse({ status: 'error', message: 'Invalid settings payload.' });
                return true;
            }
            // Persist only known, well-typed fields so a malformed payload
            // can't pollute settings storage with arbitrary keys.
            const sanitized = {
                trackingEnabled:    !!payload.trackingEnabled,
                sortOrder:          ['desc', 'asc', 'name', 'type', 'group'].includes(payload.sortOrder) ? payload.sortOrder : 'desc',
                logsPerPage:        clampInt(payload.logsPerPage, 5, 500, 25),
                pruneDays:          clampInt(payload.pruneDays, 1, 3650, 90),
                recordLimit:        clampInt(payload.recordLimit, 100, 10000, 1000),
                relativeTimestamps: !!payload.relativeTimestamps,
            };
            chrome.storage.local.set({ [HISTORY_SETTINGS_KEY]: sanitized }, () => {
                sendResponse({ status: 'success' });
            });
            return true;
        }

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