/**
 * @file timeline-manager.js
 * modcore Extension Manager - Timeline background logic.
 *
 * Self-contained subsystem:
 *   • owns the activity log (chrome.storage.local)
 *   • tracks extension state to detect updates / permission changes
 *   • registers chrome.management listeners
 *   • registers its own poll alarm
 *   • registers its own chrome.runtime.onMessage handler
 *   • registers its own chrome.alarms.onAlarm handler
 *
 * The service worker just calls `initTimelineManager()` — no timeline
 * plumbing leaks into service-worker.js.
 */

'use strict';

// ==========================================================================
// Storage keys & constants
// ==========================================================================

const EXTENSION_HISTORY_KEY = 'timeline_activity';
const HISTORY_SETTINGS_KEY  = 'timeline_settings';
const EXT_STATE_CACHE_KEY   = 'timeline_ext_state_cache';
const POLL_ALARM_NAME       = 'modcore_ext_poll';

/** Recognized event types. Anything else is rejected as invalid input. */
const KNOWN_EVENT_TYPES = new Set([
    'installed',
    'uninstalled',
    'updated',
    'permissions_updated',
    'enabled',
    'disabled',
]);

/** Hard ceiling on stored records (defense-in-depth against misconfig). */
const HARD_RECORD_CAP = 5000;

/** Longest allowed length for the free-text "details" field. */
const MAX_DETAILS_LENGTH = 500;

/** Deduplication window — also absorbs onInstalled/poll races. */
const DEDUPE_WINDOW_MS = 8000;

/** Single source of truth for user-configurable settings. */
const SETTINGS_SCHEMA = Object.freeze({
    trackingEnabled: { type: 'boolean', default: true },
    sortOrder:       { type: 'enum',    default: 'desc',
                       values: ['desc', 'asc', 'name', 'type', 'group'] },
    logsPerPage:     { type: 'int',     default: 25,   min: 5,   max: 500 },
    pruneDays:       { type: 'int',     default: 90,   min: 1,   max: 3650 },
    recordLimit:     { type: 'int',     default: 1000, min: 100, max: 10000 },
});

const DEFAULT_HISTORY_SETTINGS = Object.freeze(
    Object.fromEntries(
        Object.entries(SETTINGS_SCHEMA).map(([k, spec]) => [k, spec.default])
    )
);

// ==========================================================================
// Small helpers
// ==========================================================================

const newRecordId = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

const clampDetails = (d) =>
    typeof d === 'string' ? d.slice(0, MAX_DETAILS_LENGTH) : '';

function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/** Validates + normalizes a settings payload against SETTINGS_SCHEMA. */
function sanitizeSettings(payload = {}) {
    const out = {};
    for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
        const raw = payload[key];
        switch (spec.type) {
            case 'boolean':
                out[key] = !!raw;
                break;
            case 'enum':
                out[key] = spec.values.includes(raw) ? raw : spec.default;
                break;
            case 'int':
                out[key] = clampInt(raw, spec.min, spec.max, spec.default);
                break;
        }
    }
    return out;
}

// ==========================================================================
// Storage accessors
// ==========================================================================

async function readHistory() {
    const stored = await chrome.storage.local.get(EXTENSION_HISTORY_KEY);
    return Array.isArray(stored[EXTENSION_HISTORY_KEY])
        ? stored[EXTENSION_HISTORY_KEY]
        : [];
}

const writeHistory = (history) =>
    chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: history });

async function getExtStateCache() {
    try {
        const res = await chrome.storage.local.get(EXT_STATE_CACHE_KEY);
        return (res[EXT_STATE_CACHE_KEY] && typeof res[EXT_STATE_CACHE_KEY] === 'object')
            ? res[EXT_STATE_CACHE_KEY]
            : {};
    } catch {
        return {};
    }
}

const setExtStateCache = (cache) =>
    chrome.storage.local.set({ [EXT_STATE_CACHE_KEY]: cache });

// ==========================================================================
// Deduplication
// ==========================================================================

const recentEvents = new Map();

function isDuplicate(extensionId, eventType) {
    const key = `${extensionId}|${eventType}`;
    const now = Date.now();
    const last = recentEvents.get(key);
    if (last && (now - last) < DEDUPE_WINDOW_MS) return true;
    recentEvents.set(key, now);
    return false;
}

// ==========================================================================
// Activity recording
// ==========================================================================

async function recordExtensionActivity(eventType, extensionInfo, details = '') {
    if (!KNOWN_EVENT_TYPES.has(eventType)) return;
    if (!extensionInfo || typeof extensionInfo !== 'object') return;

    try {
        const settings = await chrome.storage.local.get(HISTORY_SETTINGS_KEY);
        if (!settings[HISTORY_SETTINGS_KEY]?.trackingEnabled) return;

        const extensionId = extensionInfo.id ?? 'unknown';
        if (isDuplicate(extensionId, eventType)) return;

        const history = await readHistory();
        history.unshift({
            id:               newRecordId(),
            timestamp:        Date.now(),
            eventType,
            extensionId,
            extensionName:    extensionInfo.name    || 'Unknown',
            extensionVersion: extensionInfo.version || 'Unknown',
            enabled:          typeof extensionInfo.enabled === 'boolean' ? extensionInfo.enabled : null,
            details:          clampDetails(details),
        });

        if (history.length > HARD_RECORD_CAP) history.length = HARD_RECORD_CAP;
        await writeHistory(history);
    } catch (err) {
        console.warn('recordExtensionActivity failed:', err);
    }
}

// ==========================================================================
// Extension state cache — snapshot / diff helpers
// ==========================================================================

const snapshotExtension = (ext) => ({
    version:         ext.version || 'unknown',
    enabled:         !!ext.enabled,
    permissions:     [...(ext.permissions || [])].sort(),
    hostPermissions: [...(ext.hostPermissions || [])].sort(),
});

const diffLists = (prev = [], curr = []) => ({
    added:   curr.filter(p => !prev.includes(p)),
    removed: prev.filter(p => !curr.includes(p)),
});

const hasPermissionChange = (permDiff, hostDiff) =>
    permDiff.added.length || permDiff.removed.length ||
    hostDiff.added.length || hostDiff.removed.length;

function formatPermissionDiff(permDiff, hostDiff) {
    const parts = [];
    if (permDiff.added.length)   parts.push(`Added permissions: ${permDiff.added.join(', ')}`);
    if (permDiff.removed.length) parts.push(`Removed permissions: ${permDiff.removed.join(', ')}`);
    if (hostDiff.added.length)   parts.push(`Added site access: ${hostDiff.added.join(', ')}`);
    if (hostDiff.removed.length) parts.push(`Removed site access: ${hostDiff.removed.join(', ')}`);
    return parts.join(' | ');
}

/**
 * Compares an extension's current snapshot to the cached one, emits
 * `updated` / `permissions_updated` (and optionally `installed` for a
 * reinstall) events, then persists the new snapshot.
 */
async function diffAndRecordExtension(info, { wasReinstalled = false } = {}) {
    const cache = await getExtStateCache();
    const prev = cache[info.id];
    const snap = snapshotExtension(info);

    if (prev) {
        if (prev.version !== snap.version) {
            await recordExtensionActivity(
                'updated', info, `Updated from v${prev.version} to v${snap.version}.`
            );
        }

        const permDiff = diffLists(prev.permissions, snap.permissions);
        const hostDiff = diffLists(prev.hostPermissions, snap.hostPermissions);
        if (hasPermissionChange(permDiff, hostDiff)) {
            await recordExtensionActivity(
                'permissions_updated', info, formatPermissionDiff(permDiff, hostDiff)
            );
        }

        if (wasReinstalled &&
            prev.version === snap.version &&
            !hasPermissionChange(permDiff, hostDiff)) {
            await recordExtensionActivity('installed', info, 'Reinstalled.');
        }
    } else {
        await recordExtensionActivity('installed', info);
    }

    cache[info.id] = snap;
    await setExtStateCache(cache);
}

async function updateCacheEntry(ext) {
    const cache = await getExtStateCache();
    cache[ext.id] = snapshotExtension(ext);
    await setExtStateCache(cache);
}

async function seedExtStateCacheIfNeeded() {
    const cache = await getExtStateCache();
    if (Object.keys(cache).length > 0) return;
    try {
        const extensions = await chrome.management.getAll();
        const seeded = {};
        for (const ext of extensions) {
            if (ext.id) seeded[ext.id] = snapshotExtension(ext);
        }
        await setExtStateCache(seeded);
    } catch (err) {
        console.warn('seedExtStateCacheIfNeeded failed:', err);
    }
}

// ==========================================================================
// Poll for updates / permission changes
// ==========================================================================

async function pollExtensionChanges() {
    let extensions;
    try {
        extensions = await chrome.management.getAll();
    } catch {
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
            if (hasPermissionChange(permDiff, hostDiff)) {
                await recordExtensionActivity(
                    'permissions_updated', ext, formatPermissionDiff(permDiff, hostDiff)
                );
            }
        }
        cache[ext.id] = snap;
    }

    for (const id of Object.keys(cache)) {
        if (!currentIds.has(id)) delete cache[id];
    }
    await setExtStateCache(cache);
}

async function ensurePollAlarm() {
    const existing = await chrome.alarms.get(POLL_ALARM_NAME);
    if (!existing) {
        chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: 1 });
    }
}

// ==========================================================================
// Pruning / restore operations
// ==========================================================================

async function clearExtensionHistory() {
    await writeHistory([]);
}

async function handlePruneByDays({ daysToKeep } = {}) {
    const days = Number(daysToKeep);
    if (!Number.isFinite(days) || days < 1) throw new Error('Invalid number of days.');
    const cutoff = Date.now() - days * 864e5;
    const history = await readHistory();
    await writeHistory(history.filter(r => r.timestamp >= cutoff));
}

async function handlePruneInactive() {
    let installedIds;
    try {
        const extensions = await chrome.management.getAll();
        installedIds = new Set(extensions.map(e => e.id));
    } catch {
        throw new Error('Unable to fetch installed extensions.');
    }
    const history = await readHistory();
    await writeHistory(history.filter(r => installedIds.has(r.extensionId)));
}

async function handlePruneByTypes(typesToPrune) {
    if (!Array.isArray(typesToPrune)) throw new Error('Invalid types payload.');
    const valid = typesToPrune.filter(t => KNOWN_EVENT_TYPES.has(t));
    if (!valid.length) throw new Error('No valid event types provided.');
    const validSet = new Set(valid);
    const history = await readHistory();
    await writeHistory(history.filter(r => !validSet.has(r.eventType)));
}

async function handlePruneToLimit({ limit } = {}) {
    const n = Number(limit);
    if (!Number.isFinite(n) || n < 1) throw new Error('Invalid limit.');
    const history = await readHistory();
    if (history.length <= n) return;
    await writeHistory(history.slice(0, n));
}

async function handleRestoreHistory(records) {
    if (!Array.isArray(records)) throw new Error('Invalid history data.');

    const sanitized = [];
    for (const r of records) {
        if (
            r && typeof r === 'object' &&
            typeof r.timestamp === 'number' && Number.isFinite(r.timestamp) &&
            typeof r.extensionId === 'string' && r.extensionId.length > 0 &&
            KNOWN_EVENT_TYPES.has(r.eventType)
        ) {
            sanitized.push({
                id:               typeof r.id === 'string' && r.id ? r.id : newRecordId(),
                timestamp:        r.timestamp,
                eventType:        r.eventType,
                extensionId:      r.extensionId,
                extensionName:    typeof r.extensionName === 'string' ? r.extensionName : 'Unknown',
                extensionVersion: typeof r.extensionVersion === 'string' ? r.extensionVersion : 'Unknown',
                enabled:          typeof r.enabled === 'boolean' ? r.enabled : null,
                details:          clampDetails(r.details),
            });
            if (sanitized.length >= HARD_RECORD_CAP) break;
        }
    }

    await writeHistory(sanitized);
}

// ==========================================================================
// Message handling
// ==========================================================================

const MESSAGE_HANDLERS = {
    GET_EXTENSION_HISTORY:   async () => ({ history: await readHistory() }),

    GET_HISTORY_SETTINGS:    async () => {
        const res = await chrome.storage.local.get(HISTORY_SETTINGS_KEY);
        return { settings: res[HISTORY_SETTINGS_KEY] ?? DEFAULT_HISTORY_SETTINGS };
    },

    UPDATE_HISTORY_SETTINGS: async (payload) => {
        if (!payload || typeof payload !== 'object') {
            return { status: 'error', message: 'Invalid settings payload.' };
        }
        await chrome.storage.local.set({
            [HISTORY_SETTINGS_KEY]: sanitizeSettings(payload),
        });
        return { status: 'success' };
    },

    CLEAR_EXTENSION_HISTORY: async () => {
        await clearExtensionHistory();
        return { status: 'success' };
    },

    PRUNE_HISTORY_BY_DAYS:   async (p) => { await handlePruneByDays(p);  return { status: 'success' }; },
    PRUNE_INACTIVE_EXTENSIONS: async () => { await handlePruneInactive(); return { status: 'success' }; },
    PRUNE_HISTORY_BY_TYPES:  async (p) => { await handlePruneByTypes(p); return { status: 'success' }; },
    PRUNE_HISTORY_TO_LIMIT:  async (p) => { await handlePruneToLimit(p); return { status: 'success' }; },
    RESTORE_HISTORY:         async (p) => { await handleRestoreHistory(p); return { status: 'success' }; },
};

function handleTimelineMessage(request, _sender, sendResponse) {
    const handler = MESSAGE_HANDLERS[request?.type];
    if (!handler) return false;

    (async () => {
        try {
            sendResponse(await handler(request.payload));
        } catch (err) {
            sendResponse({ status: 'error', message: err?.message || String(err) });
        }
    })();
    return true;
}

// ==========================================================================
// chrome.management listeners
// ==========================================================================

function safeAddListener(event, handler, label) {
    if (!event || typeof event.addListener !== 'function') {
        console.warn(`chrome.management.${label} unavailable; skipping.`);
        return;
    }
    try { event.addListener(handler); }
    catch (err) { console.warn(`Failed to register chrome.management.${label}:`, err); }
}

function registerManagementListeners() {
    const mgmt = chrome.management;

    safeAddListener(mgmt?.onInstalled, async (info) => {
        try { await diffAndRecordExtension(info, { wasReinstalled: true }); }
        catch (err) { console.warn('onInstalled handling failed:', err); }
    }, 'onInstalled');

    safeAddListener(mgmt?.onUninstalled, async (id) => {
        await recordExtensionActivity('uninstalled', { id, name: 'Unknown', version: 'Unknown' });
        try {
            const cache = await getExtStateCache();
            delete cache[id];
            await setExtStateCache(cache);
        } catch (err) {
            console.warn('onUninstalled cache cleanup failed:', err);
        }
    }, 'onUninstalled');

    // Guarded against spurious startup re-affirmations.
    safeAddListener(mgmt?.onEnabled, async (info) => {
        try {
            const cache = await getExtStateCache();
            if (cache[info.id]?.enabled === true) return;
            await recordExtensionActivity('enabled', info);
            await updateCacheEntry(info);
        } catch (err) { console.warn('onEnabled handling failed:', err); }
    }, 'onEnabled');

    safeAddListener(mgmt?.onDisabled, async (info) => {
        try {
            const cache = await getExtStateCache();
            if (cache[info.id]?.enabled === false) return;
            await recordExtensionActivity('disabled', info);
            await updateCacheEntry(info);
        } catch (err) { console.warn('onDisabled handling failed:', err); }
    }, 'onDisabled');
}

// ==========================================================================
// Public init
// ==========================================================================

let initialized = false;

/**
 * Boots the timeline subsystem. Idempotent.
 * Registers: management listeners, message handler, alarm handler.
 * Seeds the extension state cache and ensures the poll alarm exists.
 */
function initTimelineManager() {
    if (initialized) return;
    initialized = true;

    registerManagementListeners();
    seedExtStateCacheIfNeeded();
    ensurePollAlarm();

    chrome.runtime.onMessage.addListener(handleTimelineMessage);

    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === POLL_ALARM_NAME) {
            pollExtensionChanges().catch(err =>
                console.warn('pollExtensionChanges failed:', err));
        }
    });
}

/** Lifecycle hook — call from service worker's onInstalled. */
async function onTimelineInstalled(details) {
    if (details.reason === 'install') {
        await chrome.storage.local.set({
            [EXTENSION_HISTORY_KEY]: [],
            [HISTORY_SETTINGS_KEY]:  DEFAULT_HISTORY_SETTINGS,
        });
    }
    await seedExtStateCacheIfNeeded();
}

/** Lifecycle hook — call from service worker's onStartup. */
async function onTimelineStartup() {
    await seedExtStateCacheIfNeeded();
}

export {
    // Public lifecycle
    initTimelineManager,
    onTimelineInstalled,
    onTimelineStartup,

    // Used by service worker for self-recording
    recordExtensionActivity,
    updateCacheEntry,
};