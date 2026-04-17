/**
 * @file service-worker.js
 * modcore Extension Manager - background service worker.
 */

'use strict';

// ==========================================================================
// Storage Keys
// ==========================================================================

const RULES_STORAGE_KEY    = 'rules';
const PROFILES_STORAGE_KEY = 'extensionManagerProfiles_v2';
const PREFS_STORAGE_KEY    = 'extensionManagerPrefs';

const SYNC_SETTINGS_KEY    = 'cloudSyncSettings';
const SYNC_DATA_KEY        = 'fullSyncData';
const SYNC_ALARM_NAME      = 'cloudSyncAlarm_v2';

const EXTENSION_HISTORY_KEY = 'extensionActivityHistory';
const HISTORY_SETTINGS_KEY  = 'extensionHistorySettings';

// Hard limits - must match cloud.js constants!!
const HARD_MAX_VERSIONS    = 25;
const HARD_MAX_LOG_ENTRIES = 500;

const DATA_KEYS_TO_SYNC = {
    [RULES_STORAGE_KEY]:    'Automation Rules',
    [PROFILES_STORAGE_KEY]: 'Profiles',
    [PREFS_STORAGE_KEY]:    'Preferences',
};

// ==========================================================================
// URL-rule cache (populated at startup and on rule changes)
// ==========================================================================

let urlRulesCache = [];

// ==========================================================================
// Extension History Tracking
// ==========================================================================

async function recordExtensionActivity(eventType, extensionInfo, details = '') {
    try {
        const result = await chrome.storage.local.get(HISTORY_SETTINGS_KEY);
        if (!result[HISTORY_SETTINGS_KEY]?.trackingEnabled) return;

        const stored  = await chrome.storage.local.get(EXTENSION_HISTORY_KEY);
        const history = stored[EXTENSION_HISTORY_KEY] ?? [];

        history.unshift({
            timestamp:        Date.now(),
            eventType,
            extensionId:      extensionInfo.id      ?? 'unknown',
            extensionName:    extensionInfo.name    ?? 'Unknown',
            extensionVersion: extensionInfo.version ?? 'Unknown',
            details,
        });

        // Trim to a reasonable limit
        const trimmed = history.slice(0, 500);
        await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: trimmed });
    } catch (err) {
        console.warn('recordExtensionActivity failed:', err);
    }
}

async function clearExtensionHistory() {
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: [] });
}

// ==========================================================================
// Rule Automation
// ==========================================================================

async function updateAlarmsAndCache() {
    try {
        const stored = await chrome.storage.local.get(RULES_STORAGE_KEY);
        const rules  = stored[RULES_STORAGE_KEY] ?? [];

        urlRulesCache = rules.filter(r => r.enabled && r.trigger?.type === 'url');

        // Clear only rule-prefixed alarms
        const allAlarms = await chrome.alarms.getAll();
        await Promise.all(
            allAlarms
                .filter(a => a.name.startsWith('rule_'))
                .map(a => chrome.alarms.clear(a.name))
        );

        const timeRules = rules.filter(r => r.enabled && r.trigger?.type === 'time');

        for (const rule of timeRules) {
            const [hour, minute] = (rule.trigger.time || '00:00').split(':').map(Number);
            const now = new Date();
            let next  = new Date(now);
            next.setHours(hour, minute, 0, 0);
            if (next <= now) next.setDate(next.getDate() + 1);

            // Advance to the nearest matching day-of-week
            let found = false;
            for (let i = 0; i < 7; i++) {
                if ((rule.trigger.days ?? []).includes(next.getDay())) { found = true; break; }
                next.setDate(next.getDate() + 1);
            }

            if (found) {
                chrome.alarms.create(`rule_${rule.id}`, {
                    when:            next.getTime(),
                    periodInMinutes: 7 * 24 * 60,
                });
            }
        }

        console.log(`Alarms updated. ${urlRulesCache.length} URL rule(s) cached.`);
    } catch (err) {
        console.error('updateAlarmsAndCache:', err);
    }
}

async function executeRuleAction(rule) {
    console.log(`Executing rule: "${rule.name}"`);
    try {
        if (rule.targetType === 'extension') {
            const enable = rule.action === 'enable';
            await Promise.allSettled(rule.targetIds.map(id => chrome.management.setEnabled(id, enable)));

        } else if (rule.targetType === 'profile') {
            const profileId = rule.targetIds[0];
            const stored    = await chrome.storage.local.get(PROFILES_STORAGE_KEY);
            const profile   = stored[PROFILES_STORAGE_KEY]?.[profileId];
            if (profile?.extensionStates) {
                await Promise.allSettled(
                    Object.entries(profile.extensionStates)
                        .map(([id, state]) => chrome.management.setEnabled(id, state))
                );
            }

        }
    }
    
    catch (err) {
        console.error(`executeRuleAction "${rule.name}":`, err);
    }
}

// ==========================================================================
// Cloud Sync
// ==========================================================================

async function syncLocalDataToCloud(isAutomatic = true) {
    try {
        const stored   = await chrome.storage.local.get(SYNC_SETTINGS_KEY);
        const settings = stored[SYNC_SETTINGS_KEY];

        if (!settings) {
            console.log('Cloud sync: no settings found, skipping.');
            return;
        }
        if (isAutomatic && !settings.autoSyncEnabled) {
            console.log('Cloud sync: auto-sync disabled, skipping.');
            return;
        }

        const keysToSync = Object.keys(settings.selectiveSync ?? {})
            .filter(k => settings.selectiveSync[k]);
        if (keysToSync.length === 0) {
            console.log('Cloud sync: no categories selected, skipping.');
            return;
        }

        const localData = await chrome.storage.local.get(keysToSync);
        const newVersion = {
            timestamp: Date.now(),
            data:      localData,
            source:    isAutomatic ? 'Automatic Background Sync' : 'Manual Sync',
        };

        const syncRaw  = await chrome.storage.sync.get(SYNC_DATA_KEY);
        const syncData = syncRaw[SYNC_DATA_KEY] ?? { versions: [] };

        syncData.versions.unshift(newVersion);

        // Apply retention
        const histPolicy = settings.historyRetentionPolicy ?? String(10);
        syncData.versions = applyHistoryRetentionSW(syncData.versions, histPolicy);

        // Guard against quota - aggressively trim if needed
        let payload = JSON.stringify({ [SYNC_DATA_KEY]: syncData });
        while (syncData.versions.length > 1 && new TextEncoder().encode(payload).length > 102400 * 0.95) {
            syncData.versions.pop();
            payload = JSON.stringify({ [SYNC_DATA_KEY]: syncData });
        }

        await chrome.storage.sync.set({ [SYNC_DATA_KEY]: syncData });
        await chrome.storage.local.set({
            [SYNC_SETTINGS_KEY]: { ...settings, lastSyncTimestamp: Date.now() },
        });

        await addLogEntrySW('Background sync successful.', 'success', settings);
        console.log('Cloud sync: completed successfully.');

    } catch (err) {
        console.error('Cloud sync failed:', err);
        await addLogEntrySW(`Sync failed: ${err.message}`, 'error');

        if (err.message?.includes('QUOTA')) {
            chrome.notifications.create({
                type:     'basic',
                iconUrl:  '../icons/modcore-em.png',
                title:    'modcore Cloud Sync Failed',
                message:  'Sync failed due to storage quota. Open Cloud settings to manage data.',
                priority: 2,
            }).catch(() => {});
        }
    }
}

function applyHistoryRetentionSW(versions, policy) {
    let result = [...versions];
    if (typeof policy === 'string' && policy.endsWith('d')) {
        const days   = parseInt(policy, 10);
        const cutoff = Date.now() - days * 864e5;
        result = result.filter(v => v.timestamp >= cutoff);
    } else {
        const n = parseInt(policy, 10) || 10;
        result = result.slice(0, n);
    }
    return result.slice(0, HARD_MAX_VERSIONS);
}

async function addLogEntrySW(message, type = 'info', settings = null) {
    try {
        const stored   = await chrome.storage.local.get('syncLog');
        const current  = stored.syncLog ?? [];

        let newLog = [{ timestamp: Date.now(), message, type }, ...current];

        if (!settings) {
            const s = await chrome.storage.local.get(SYNC_SETTINGS_KEY);
            settings = s[SYNC_SETTINGS_KEY];
        }
        const policy = settings?.logRetentionPolicy ?? '100';

        if (policy.endsWith('d')) {
            const days   = parseInt(policy, 10);
            const cutoff = Date.now() - days * 864e5;
            newLog = newLog.filter(e => e.timestamp >= cutoff);
        } else {
            const n = parseInt(policy, 10) || 100;
            newLog = newLog.slice(0, n);
        }

        newLog = newLog.slice(0, HARD_MAX_LOG_ENTRIES);
        await chrome.storage.local.set({ syncLog: newLog });
    } catch (err) {
        console.warn('addLogEntrySW:', err);
    }
}

async function updateSyncAlarm() {
    try {
        const stored   = await chrome.storage.local.get(SYNC_SETTINGS_KEY);
        const settings = stored[SYNC_SETTINGS_KEY];

        await chrome.alarms.clear(SYNC_ALARM_NAME);

        if (settings?.autoSyncEnabled) {
            const periodInMinutes = parseInt(settings.syncInterval, 10) || 60;
            chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes });
            console.log(`Cloud sync alarm set: every ${periodInMinutes} min.`);
        } else {
            console.log('Cloud sync alarm cleared (auto-sync disabled).');
        }
    } catch (err) {
        console.error('updateSyncAlarm:', err);
    }
}

// ==========================================================================
// chrome.management Listeners
// ==========================================================================

function registerManagementListeners() {
    try {
        chrome.management.onInstalled.addListener(info => {
            recordExtensionActivity('installed', info);
        });

        chrome.management.onUninstalled.addListener(id => {
            recordExtensionActivity('uninstalled', { id, name: 'Unknown', version: 'Unknown' });
        });

        chrome.management.onEnabled.addListener(info => {
            recordExtensionActivity('enabled', info);
        });

        chrome.management.onDisabled.addListener(info => {
            recordExtensionActivity('disabled', info);
        });

        chrome.management.onUpdated.addListener(info => {
            const added   = (info.permissions   ?? []).filter(p => !(info.oldPermissions ?? []).includes(p));
            const removed = (info.oldPermissions ?? []).filter(p => !(info.permissions   ?? []).includes(p));

            let details = `Updated to v${info.version}.`;
            if (added.length)   details += ` Added permissions: ${added.join(', ')}.`;
            if (removed.length) details += ` Removed permissions: ${removed.join(', ')}.`;

            const evType = (added.length || removed.length) ? 'permissions_updated' : 'updated';
            recordExtensionActivity(evType, info, details);
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
            [SYNC_SETTINGS_KEY]: {
                autoSyncEnabled:        false,
                syncInterval:           60,
                selectiveSync:          Object.keys(DATA_KEYS_TO_SYNC).reduce((a, k) => ({ ...a, [k]: true }), {}),
                lastSyncTimestamp:      null,
                logRetentionPolicy:     '100',
                historyRetentionPolicy: '10',
            },
            syncLog:                    [],
            [EXTENSION_HISTORY_KEY]:    [],
            [HISTORY_SETTINGS_KEY]:     { trackingEnabled: true },
        });
        console.log('Default settings initialized.');
    }

    await updateAlarmsAndCache();
    await updateSyncAlarm();
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
    await updateSyncAlarm();
    registerManagementListeners();
    // Note: "sync on startup" removed - use the auto-sync alarm interval instead.
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

        case 'UPDATE_SYNC_ALARM':
            updateSyncAlarm().then(() => sendResponse({ status: 'success' }));
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
    }
});

// ==========================================================================
// Alarm Handler
// ==========================================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith('rule_')) {
        const stored = await chrome.storage.local.get(RULES_STORAGE_KEY);
        const rule   = (stored[RULES_STORAGE_KEY] ?? []).find(r => `rule_${r.id}` === alarm.name);
        if (rule?.enabled) {
            executeRuleAction(rule);
        }
        return;
    }

    if (alarm.name === SYNC_ALARM_NAME) {
        console.log('Sync alarm fired.');
        syncLocalDataToCloud(true);
    }
});

// ==========================================================================
// Tab URL-Rule Watcher
// ==========================================================================

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url || urlRulesCache.length === 0) return;
    for (const rule of urlRulesCache) {
        if (rule.enabled && tab.url.includes(rule.trigger.url)) {
            executeRuleAction(rule);
        }
    }
});

// ==========================================================================
// CRX Download Helper
// ==========================================================================

let _pendingCrxName;
let _pendingCrxId;

function extractExtensionId(url) {
    const m = url.match(/\/detail\/[^/]+\/([a-p]{32})/i);
    return m ? m[1] : null;
}

function sanitizeFilename(text) {
    return text.replace(/[&/\\:"*<>|?]/g, '').trim();
}

function getChromeVersion() {
    const m = navigator.userAgent.match(/Chrome\/([\d.]+)/);
    return m ? m[1] : '0.0.0.0';
}

function buildCRXUrl(arch, id, version) {
    return `https://clients2.google.com/service/update2/crx?response=redirect&nacl_arch=${encodeURIComponent(arch)}&prodversion=${version}&acceptformat=crx2,crx3&x=id%3D${id}%26installsource%3Dondemand%26uc`;
}

function triggerCRXDownload(tab) {
    if (!tab?.url) return;
    if (!tab.url.includes('chrome.google.com/webstore/detail') &&
        !tab.url.includes('chromewebstore.google.com/detail')) {
        console.warn('CRX: not a Web Store extension page.');
        return;
    }

    _pendingCrxId = extractExtensionId(tab.url);
    if (!_pendingCrxId) { console.warn('CRX: could not extract extension ID.'); return; }

    _pendingCrxName = sanitizeFilename(tab.title.replace(' - Chrome Web Store', ''));
    const version   = getChromeVersion();

    chrome.runtime.getPlatformInfo(platform => {
        const arch = platform.nacl_arch || 'x86-64';
        chrome.downloads.download({ url: buildCRXUrl(arch, _pendingCrxId, version), saveAs: true });
    });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'getCRX')  triggerCRXDownload(tab);
    if (info.menuItemId === 'donate')  chrome.tabs.create({ url: 'https://www.patreon.com/cw/modcore' });
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    if (!item.url.startsWith('https://clients2.google.com/service/update2/crx')) return;
    if (!_pendingCrxName || !_pendingCrxId) return;

    const vMatch  = item.filename.match(/_(\d+[_\d]*)/);
    const version = vMatch ? vMatch[1].replace(/_/g, '.') : 'latest';

    suggest({
        filename: `${sanitizeFilename(_pendingCrxName)} [${_pendingCrxId.substring(0, 8)}].v${version}.crx`,
    });

    _pendingCrxName = undefined;
    _pendingCrxId   = undefined;
});

chrome.commands.onCommand.addListener(command => {
    if (command === 'download-crx') {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]) triggerCRXDownload(tabs[0]);
        });
    }
});
