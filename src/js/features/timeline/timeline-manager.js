/**
 * @file timeline-manager.js
 * modcore Extension Manager - Timeline background logic.
 *
 * Owns the persisted activity log (chrome.storage.local) and the pruning /
 * restore operations exposed to the UI via the service worker's message
 * handler. All writes here are defensively validated since the payloads
 * ultimately originate from the timeline UI page.
 */

'use strict';

const EXTENSION_HISTORY_KEY = 'timeline_activity';
const HISTORY_SETTINGS_KEY  = 'timeline_settings';

/** Recognized event types. Anything else is rejected as invalid input. */
const KNOWN_EVENT_TYPES = new Set([
    'installed',
    'uninstalled',
    'updated',
    'permissions_updated',
    'enabled',
    'disabled',
]);

/** Hard ceiling on stored records, independent of the user's configured
 *  record limit, so a misconfigured (or missing) limit can never grow
 *  storage without bound. */
const HARD_RECORD_CAP = 5000;

/** Longest allowed length for the free-text "details" field. */
const MAX_DETAILS_LENGTH = 500;

// Simple in-memory deduplication cache: "extId|eventType" -> timestamp
const recentEvents = new Map();
const DEDUPE_WINDOW_MS = 5000;

const newRecordId = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

const clampDetails = (details) =>
    typeof details === 'string' ? details.slice(0, MAX_DETAILS_LENGTH) : '';

/**
 * Records a new extension activity event if tracking is enabled.
 * Skips duplicate events for the same extension within the deduplication window.
 * @param {string} eventType
 * @param {chrome.management.ExtensionInfo|{id:string,name?:string,version?:string}} extensionInfo
 * @param {string} [details='']
 */
async function recordExtensionActivity(eventType, extensionInfo, details = '') {
    if (!KNOWN_EVENT_TYPES.has(eventType)) {
        console.warn(`recordExtensionActivity: ignoring unknown eventType "${eventType}"`);
        return;
    }
    if (!extensionInfo || typeof extensionInfo !== 'object') {
        console.warn('recordExtensionActivity: missing extensionInfo, skipping.');
        return;
    }

    try {
        const settingsResult = await chrome.storage.local.get(HISTORY_SETTINGS_KEY);
        if (!settingsResult[HISTORY_SETTINGS_KEY]?.trackingEnabled) return;

        const extensionId = extensionInfo.id ?? 'unknown';
        const dedupeKey = `${extensionId}|${eventType}`;
        const lastTime = recentEvents.get(dedupeKey);
        const now = Date.now();
        if (lastTime && (now - lastTime) < DEDUPE_WINDOW_MS) {
            return; // Skip rapid duplicate
        }
        recentEvents.set(dedupeKey, now);

        const stored  = await chrome.storage.local.get(EXTENSION_HISTORY_KEY);
        const history = Array.isArray(stored[EXTENSION_HISTORY_KEY]) ? stored[EXTENSION_HISTORY_KEY] : [];

        history.unshift({
            id:               newRecordId(),
            timestamp:        now,
            eventType,
            extensionId,
            extensionName:    extensionInfo.name    || 'Unknown',
            extensionVersion: extensionInfo.version || 'Unknown',
            enabled:          typeof extensionInfo.enabled === 'boolean' ? extensionInfo.enabled : null,
            details:          clampDetails(details),
        });

        // Defense in depth: never let the log grow past the hard cap, even
        // if the user's configured limit is large or the auto-prune step
        // in the UI hasn't run yet.
        if (history.length > HARD_RECORD_CAP) history.length = HARD_RECORD_CAP;

        await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: history });
    } catch (err) {
        console.warn('recordExtensionActivity failed:', err);
    }
}

async function clearExtensionHistory() {
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: [] });
}

async function handlePruneByDays({ daysToKeep } = {}) {
    const days = Number(daysToKeep);
    if (!Number.isFinite(days) || days < 1) {
        throw new Error('Invalid number of days.');
    }
    const cutoff = Date.now() - days * 864e5;
    const stored = await chrome.storage.local.get(EXTENSION_HISTORY_KEY);
    const history = Array.isArray(stored[EXTENSION_HISTORY_KEY]) ? stored[EXTENSION_HISTORY_KEY] : [];
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
    const history = Array.isArray(stored[EXTENSION_HISTORY_KEY]) ? stored[EXTENSION_HISTORY_KEY] : [];
    const pruned = history.filter(r => installedIds.has(r.extensionId));
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: pruned });
}

async function handlePruneByTypes(typesToPrune) {
    if (!Array.isArray(typesToPrune)) throw new Error('Invalid types payload.');
    const validTypes = typesToPrune.filter(t => KNOWN_EVENT_TYPES.has(t));
    if (!validTypes.length) throw new Error('No valid event types provided.');
    const stored = await chrome.storage.local.get(EXTENSION_HISTORY_KEY);
    const history = Array.isArray(stored[EXTENSION_HISTORY_KEY]) ? stored[EXTENSION_HISTORY_KEY] : [];
    const pruned = history.filter(r => !validTypes.includes(r.eventType));
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: pruned });
}

async function handlePruneToLimit({ limit } = {}) {
    const n = Number(limit);
    if (!Number.isFinite(n) || n < 1) throw new Error('Invalid limit.');
    const stored = await chrome.storage.local.get(EXTENSION_HISTORY_KEY);
    const history = Array.isArray(stored[EXTENSION_HISTORY_KEY]) ? stored[EXTENSION_HISTORY_KEY] : [];
    if (history.length <= n) return;
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: history.slice(0, n) });
}

/**
 * Restores (or imports) a history array, sanitizing every record so that
 * only known, well-typed fields ever reach storage. Unknown extra keys on
 * incoming objects are dropped rather than persisted verbatim.
 */
async function handleRestoreHistory(records) {
    if (!Array.isArray(records)) throw new Error('Invalid history data.');

    const sanitized = records.reduce((acc, r) => {
        if (
            r && typeof r === 'object' &&
            typeof r.timestamp === 'number' && Number.isFinite(r.timestamp) &&
            typeof r.extensionId === 'string' && r.extensionId.length > 0 &&
            KNOWN_EVENT_TYPES.has(r.eventType)
        ) {
            acc.push({
                id:               typeof r.id === 'string' && r.id ? r.id : newRecordId(),
                timestamp:        r.timestamp,
                eventType:        r.eventType,
                extensionId:      r.extensionId,
                extensionName:    typeof r.extensionName === 'string' ? r.extensionName : 'Unknown',
                extensionVersion: typeof r.extensionVersion === 'string' ? r.extensionVersion : 'Unknown',
                enabled:          typeof r.enabled === 'boolean' ? r.enabled : null,
                details:          clampDetails(r.details),
            });
        }
        return acc;
    }, []).slice(0, HARD_RECORD_CAP);

    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: sanitized });
}

export {
    EXTENSION_HISTORY_KEY,
    HISTORY_SETTINGS_KEY,
    KNOWN_EVENT_TYPES,
    recordExtensionActivity,
    clearExtensionHistory,
    handlePruneByDays,
    handlePruneInactive,
    handlePruneByTypes,
    handlePruneToLimit,
    handleRestoreHistory,
};