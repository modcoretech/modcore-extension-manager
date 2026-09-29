/**
 * @file service-worker.js
 * modcore Extension Manager - background service worker.
 * 
 **/

'use strict';

import {
    registerActionMenus,
    isActionMenuItem,
    handleActionMenuClick,
    updateActionCrxMenu,
    triggerCRXDownload,
    registerCrxListeners,
    ACTION_MENU_CRX_DOWNLOAD,
    ACTION_MENU_CRX_DOCS,
    CRX_DOCS_URL,
} from './actions-menu.js';
import {
    RULES_STORAGE_KEY,
    getUrlRulesCache,
    updateAlarmsAndCache,
    executeRuleAction,
    handleRuleAlarm,
} from './automations-manager.js';
import {
    initTimelineManager,
    onTimelineInstalled,
    onTimelineStartup,
    recordExtensionActivity,
    updateCacheEntry,
} from './timeline-manager.js';

// ==========================================================================
// Context Menu Constants
// ==========================================================================

const WEBSTORE_PATTERNS = [
    'https://chrome.google.com/webstore/detail/*',
    'https://chromewebstore.google.com/detail/*',
];

const STATIC_CRX_CONTEXTS = ['page', 'frame', 'link', 'selection'];

const MENU_CRX_FEATURES = 'crxFeatures';
const MENU_CRX_DOWNLOAD = 'crxDownload';
const MENU_CRX_DOCS     = 'crxDocs';
const MENU_DONATE       = 'donate';

// ==========================================================================
// Initialize timeline subsystem (registers its own listeners)
// ==========================================================================

initTimelineManager();

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
            title: 'CRX Features',
            contexts: STATIC_CRX_CONTEXTS,
            documentUrlPatterns: WEBSTORE_PATTERNS,
        });
        chrome.contextMenus.create({
            id: MENU_CRX_DOWNLOAD,
            parentId: MENU_CRX_FEATURES,
            title: 'Get CRX File',
            contexts: STATIC_CRX_CONTEXTS,
            documentUrlPatterns: WEBSTORE_PATTERNS,
        });
        chrome.contextMenus.create({
            id: MENU_CRX_DOCS,
            parentId: MENU_CRX_FEATURES,
            title: 'modcore Source',
            contexts: STATIC_CRX_CONTEXTS,
            documentUrlPatterns: WEBSTORE_PATTERNS,
        });

        registerActionMenus();

        chrome.contextMenus.create({
            id: MENU_DONATE,
            title: 'Support modcore on Patreon',
            contexts: ['action'],
        });

        updateActionCrxMenu();
    });
}

chrome.tabs.onActivated.addListener(updateActionCrxMenu);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url) updateActionCrxMenu();
});

// ==========================================================================
// Lifecycle Events
// ==========================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`Extension ${details.reason}. Initializing systems.`);

    if (details.reason === 'install') {
        await chrome.storage.local.set({ [RULES_STORAGE_KEY]: [] });
    }

    await updateAlarmsAndCache();
    await onTimelineInstalled(details);
    registerContextMenus();

    if (details.reason === 'install' || details.reason === 'update') {
        const eventType = details.reason === 'install' ? 'installed' : 'updated';
        try {
            const selfInfo = await chrome.management.get(chrome.runtime.id);
            await recordExtensionActivity(
                eventType, selfInfo,
                `modcore EM was ${eventType} (reason: ${details.reason}).`
            );
            await updateCacheEntry(selfInfo);
        } catch (_) { /* ignore */ }
    }

    chrome.runtime.setUninstallURL(
        'https://sites.google.com/view/modcore-apps/modcore-apps/modcore-extension-manager/ui/uninstall'
    );
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('Browser started. Re-initializing systems.');
    await updateAlarmsAndCache();
    await onTimelineStartup();
    updateActionCrxMenu();
});

// ==========================================================================
// Message Handling (non-timeline)
// ==========================================================================

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.type === 'SAVE_RULES') {
        chrome.storage.local.set({ [RULES_STORAGE_KEY]: request.payload }, () => {
            updateAlarmsAndCache();
            sendResponse({ status: 'success' });
        });
        return true;
    }
    return false;
});

// ==========================================================================
// Alarm Handling (non-timeline — timeline handles its own)
// ==========================================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith('rule_')) {
        await handleRuleAlarm(alarm.name);
    }
});

// ==========================================================================
// Tab URL-Rule Watcher
// ==========================================================================

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    const rules = getUrlRulesCache();
    if (!rules || rules.length === 0) return;

    for (const rule of rules) {
        if (rule.enabled && rule.trigger?.url && tab.url.includes(rule.trigger.url)) {
            executeRuleAction(rule);
        }
    }
});

// ==========================================================================
// Context menu click delegation
// ==========================================================================

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_CRX_DOWNLOAD || info.menuItemId === ACTION_MENU_CRX_DOWNLOAD) {
        triggerCRXDownload(tab);
    } else if (info.menuItemId === MENU_CRX_DOCS || info.menuItemId === ACTION_MENU_CRX_DOCS) {
        chrome.tabs.create({ url: CRX_DOCS_URL });
    } else if (isActionMenuItem(info.menuItemId)) {
        handleActionMenuClick(info.menuItemId);
    } else if (info.menuItemId === MENU_DONATE) {
        chrome.tabs.create({ url: 'https://www.patreon.com/cw/modcore' });
    }
});

registerCrxListeners();