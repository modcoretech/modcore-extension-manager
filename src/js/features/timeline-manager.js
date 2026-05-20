/**
 * @file timeline-manager.js
 * modcore Extension Manager - Timeline background logic.
 */

'use strict';

const EXTENSION_HISTORY_KEY = 'timeline_activity';
const HISTORY_SETTINGS_KEY  = 'timeline_settings';

/**
 * Records a new extension activity event if tracking is enabled.
 * @param {string} eventType
 * @param {chrome.management.ExtensionInfo} extensionInfo
 * @param {string} [details='']
 */
async function recordExtensionActivity(eventType, extensionInfo, details = '') {
    try {
        const result = await chrome.storage.local.get(HISTORY_SETTINGS_KEY);
        if (!result[HISTORY_SETTINGS_KEY]?.trackingEnabled) return;

        const stored  = await chrome.storage.local.get(EXTENSION_HISTORY_KEY);
        const history = stored[EXTENSION_HISTORY_KEY] ?? [];

        history.unshift({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            timestamp:        Date.now(),
            eventType,
            extensionId:      extensionInfo.id      ?? 'unknown',
            extensionName:    extensionInfo.name    ?? 'Unknown',
            extensionVersion: extensionInfo.version ?? 'Unknown',
            details,
        });

        await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: history });
    } catch (err) {
        console.warn('recordExtensionActivity failed:', err);
    }
}

async function clearExtensionHistory() {
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: [] });
}

async function handlePruneByDays({ daysToKeep }) {
    const cutoff = Date.now() - daysToKeep * 864e5;
    const stored = await chrome.storage.local.get(EXTENSION_HISTORY_KEY);
    const history = stored[EXTENSION_HISTORY_KEY] ?? [];
    const pruned = history.filter(r => r.timestamp >= cutoff);
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: pruned });
}

async function handlePruneInactive() {
    let installedIds;
    try {
        const extensions = await chrome.management.getAll();
        installedIds = new Set(extensions.map(e => e.id));
    } catch (e) {
        throw new Error('Unable to fetch installed extensions.');
    }
    const stored = await chrome.storage.local.get(EXTENSION_HISTORY_KEY);
    const history = stored[EXTENSION_HISTORY_KEY] ?? [];
    const pruned = history.filter(r => installedIds.has(r.extensionId));
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: pruned });
}

async function handlePruneByTypes(typesToPrune) {
    if (!Array.isArray(typesToPrune)) throw new Error('Invalid types payload.');
    const stored = await chrome.storage.local.get(EXTENSION_HISTORY_KEY);
    const history = stored[EXTENSION_HISTORY_KEY] ?? [];
    const pruned = history.filter(r => !typesToPrune.includes(r.eventType));
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: pruned });
}

async function handlePruneToLimit({ limit }) {
    const n = parseInt(limit, 10);
    if (isNaN(n) || n < 1) throw new Error('Invalid limit.');
    const stored = await chrome.storage.local.get(EXTENSION_HISTORY_KEY);
    const history = stored[EXTENSION_HISTORY_KEY] ?? [];
    if (history.length <= n) return;
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: history.slice(0, n) });
}

async function handleRestoreHistory(records) {
    if (!Array.isArray(records)) throw new Error('Invalid history data.');
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: records });
}

export {
    EXTENSION_HISTORY_KEY,
    HISTORY_SETTINGS_KEY,
    recordExtensionActivity,
    clearExtensionHistory,
    handlePruneByDays,
    handlePruneInactive,
    handlePruneByTypes,
    handlePruneToLimit,
    handleRestoreHistory,
};