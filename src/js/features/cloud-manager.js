/**
 * @file cloud-manager.js
 * modcore Extension Manager - Cloud sync background logic.
 */

'use strict';

export const SYNC_SETTINGS_KEY = 'cloud_settings';
export const SYNC_DATA_KEY     = 'fullSyncData';
export const SYNC_ALARM_NAME   = 'cloud_syncalarm';

// Hard limits - must match cloud.js constants!!
const HARD_MAX_VERSIONS    = 5;
const HARD_MAX_LOG_ENTRIES = 100;

/**
 * Syncs local data to chrome.storage.sync.
 * @param {boolean} [isAutomatic=true]
 */
export async function syncLocalDataToCloud(isAutomatic = true) {
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

/**
 * Applies retention policy to version history.
 * @param {Array} versions
 * @param {string|number} policy
 * @returns {Array}
 */
export function applyHistoryRetentionSW(versions, policy) {
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

/**
 * Adds a log entry to the local sync log.
 * @param {string} message
 * @param {string} [type='info']
 * @param {Object|null} [settings=null]
 */
export async function addLogEntrySW(message, type = 'info', settings = null) {
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

/**
 * Creates or clears the periodic sync alarm based on settings.
 */
export async function updateSyncAlarm() {
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

/**
 * Handles the cloud sync alarm firing.
 */
export function handleSyncAlarm() {
    console.log('Sync alarm fired.');
    syncLocalDataToCloud(true);
}