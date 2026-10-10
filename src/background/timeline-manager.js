/**
 * @file timeline-manager.js
 * modcore Extension Manager - Timeline background logic.
 */

'use strict';

// ==========================================================================
// Constants
// ==========================================================================

const HISTORY_KEY  = 'timeline_activity';
const SETTINGS_KEY = 'timeline_settings';
const CACHE_KEY    = 'timeline_ext_state_cache';
const POLL_ALARM   = 'modcore_ext_poll';
const POLL_MINUTES = 5;
const MAX_DETAILS  = 500;
const DAY_MS       = 864e5;

const EVENT_TYPES = new Set([
    'installed', 'uninstalled', 'updated',
    'permissions_updated', 'enabled', 'disabled',
]);

/** Single source of truth for settings (the UI mirrors min/max in its HTML). */
const SETTINGS_SCHEMA = Object.freeze({
    trackingEnabled: { type: 'boolean', default: false },
    sortOrder:       { type: 'enum', default: 'desc', values: ['desc', 'asc', 'group', 'type'] },
    logsPerPage:     { type: 'int', default: 25,   min: 5,   max: 500 },
    pruneDays:       { type: 'int', default: 90,   min: 1,   max: 3650 },
    recordLimit:     { type: 'int', default: 1000, min: 100, max: 10000 },
});

const DEFAULT_SETTINGS = Object.freeze(
    Object.fromEntries(Object.entries(SETTINGS_SCHEMA).map(([k, s]) => [k, s.default]))
);

const store = chrome.storage.local;

// ==========================================================================
// Helpers
// ==========================================================================

/** Runs tasks one at a time, in order. A failed task never blocks the queue. */
let queue = Promise.resolve();
const serialize = (task) => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
};

const clampDetails = (d) => {
    if (typeof d !== 'string') return '';
    return d.length > MAX_DETAILS ? `${d.slice(0, MAX_DETAILS - 1)}…` : d;
};

const clampInt = (value, min, max, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Validates a settings payload; missing or invalid values fall back to defaults. */
function sanitizeSettings(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const out = {};
    for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
        let raw = src[key];
        if (key === 'sortOrder' && raw === 'name') raw = 'group'; // legacy value
        if (spec.type === 'boolean') {
            out[key] = typeof raw === 'boolean' ? raw : spec.default;
        } else if (spec.type === 'enum') {
            out[key] = spec.values.includes(raw) ? raw : spec.default;
        } else {
            out[key] = clampInt(raw, spec.min, spec.max, spec.default);
        }
    }
    return out;
}

// ==========================================================================
// Storage accessors
// ==========================================================================

async function getSettings() {
    const res = await store.get(SETTINGS_KEY);
    return sanitizeSettings(res[SETTINGS_KEY]);
}

async function readHistory() {
    const res = await store.get(HISTORY_KEY);
    return Array.isArray(res[HISTORY_KEY]) ? res[HISTORY_KEY] : [];
}

async function getCache() {
    const res = await store.get(CACHE_KEY);
    const c = res[CACHE_KEY];
    return c && typeof c === 'object' ? c : {};
}

const setCache = (cache) => store.set({ [CACHE_KEY]: cache });

// ==========================================================================
// Recording
// ==========================================================================

/**
 * Appends events (newest first) and enforces the record limit.
 * Must be called from inside `serialize()`.
 * @param {{eventType:string, info:{id:string,name?:string,version?:string}, details?:string}[]} events
 */
async function commit(events) {
    const valid = events.filter(e => EVENT_TYPES.has(e.eventType) && e.info?.id);
    if (!valid.length) return;

    const settings = await getSettings();
    if (!settings.trackingEnabled) return;

    const now = Date.now();
    const fresh = valid.map(({ eventType, info, details }) => ({
        id:               crypto.randomUUID(),
        timestamp:        now,
        eventType,
        extensionId:      info.id,
        extensionName:    info.name || 'Unknown',
        extensionVersion: info.version || 'Unknown',
        details:          clampDetails(details),
    }));

    const history = await readHistory();
    await store.set({ [HISTORY_KEY]: [...fresh, ...history].slice(0, settings.recordLimit) });
}

// ==========================================================================
// Change detection
// ==========================================================================

const snapshot = (ext) => ({
    name:            ext.name || 'Unknown',
    version:         ext.version || 'unknown',
    enabled:         !!ext.enabled,
    permissions:     [...(ext.permissions || [])].sort(),
    hostPermissions: [...(ext.hostPermissions || [])].sort(),
});

function diffLists(prev = [], curr = []) {
    const p = new Set(prev), c = new Set(curr);
    return {
        added:   curr.filter(x => !p.has(x)),
        removed: prev.filter(x => !c.has(x)),
    };
}

function describePermissionChange(perm, host) {
    const parts = [];
    if (perm.added.length)   parts.push(`Added permissions: ${perm.added.join(', ')}`);
    if (perm.removed.length) parts.push(`Removed permissions: ${perm.removed.join(', ')}`);
    if (host.added.length)   parts.push(`Added site access: ${host.added.join(', ')}`);
    if (host.removed.length) parts.push(`Removed site access: ${host.removed.join(', ')}`);
    return parts.join(' | ');
}

/** Compares the cached snapshot with the live extension and returns events. */
function detectChanges(prev, info, { reinstall = false } = {}) {
    if (!prev) return [{ eventType: 'installed', info }];

    const next = snapshot(info);
    const events = [];

    if (prev.version !== next.version) {
        events.push({
            eventType: 'updated', info,
            details: `Updated from v${prev.version} to v${next.version}.`,
        });
    }

    const perm = diffLists(prev.permissions, next.permissions);
    const host = diffLists(prev.hostPermissions, next.hostPermissions);
    if (perm.added.length || perm.removed.length || host.added.length || host.removed.length) {
        events.push({
            eventType: 'permissions_updated', info,
            details: describePermissionChange(perm, host),
        });
    }

    if (typeof prev.enabled === 'boolean' && prev.enabled !== next.enabled) {
        events.push({ eventType: next.enabled ? 'enabled' : 'disabled', info });
    }

    if (reinstall && !events.length) {
        events.push({ eventType: 'installed', info, details: 'Reinstalled.' });
    }
    return events;
}

// ==========================================================================
// Sync operations (each one is serialized)
// ==========================================================================

/** Records whatever changed for one extension, then updates its snapshot. */
const syncExtension = (info, opts) => serialize(async () => {
    const cache = await getCache();
    await commit(detectChanges(cache[info.id], info, opts));
    cache[info.id] = snapshot(info);
    await setCache(cache);
});

const removeExtension = (id) => serialize(async () => {
    const cache = await getCache();
    const prev = cache[id];
    await commit([{
        eventType: 'uninstalled',
        info: { id, name: prev?.name, version: prev?.version },
    }]);
    delete cache[id];
    await setCache(cache);
});

/** Seeds the snapshot cache on first run so existing extensions aren't logged as new. */
async function seedIfEmpty(skipId) {
    const cache = await getCache();
    if (Object.keys(cache).length) return false;
    const seeded = {};
    for (const ext of await chrome.management.getAll()) {
        if (ext.id && ext.id !== skipId) seeded[ext.id] = snapshot(ext);
    }
    await setCache(seeded);
    return true;
}

/** Safety net: catches anything that happened while the worker was asleep or the browser closed. */
async function pollLocked() {
    if (await seedIfEmpty()) return;

    const [extensions, cache] = await Promise.all([chrome.management.getAll(), getCache()]);
    const next = {};
    const events = [];

    for (const ext of extensions) {
        if (!ext.id) continue;
        events.push(...detectChanges(cache[ext.id], ext));
        next[ext.id] = snapshot(ext);
    }
    for (const [id, prev] of Object.entries(cache)) {
        if (!next[id]) {
            events.push({ eventType: 'uninstalled', info: { id, name: prev.name, version: prev.version } });
        }
    }

    await commit(events);
    await setCache(next);
}

const runPoll = () => serialize(pollLocked).catch(err => console.warn('Timeline poll failed:', err));

async function ensurePollAlarm() {
    const existing = await chrome.alarms.get(POLL_ALARM);
    if (!existing || existing.periodInMinutes !== POLL_MINUTES) {
        chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES });
    }
}

// ==========================================================================
// Message handlers (UI -> background)
// ==========================================================================

/** Rewrites history keeping only records for which `keep` is true. */
async function rewriteHistory(keep) {
    const history = await readHistory();
    const next = history.filter(keep);
    if (next.length !== history.length) await store.set({ [HISTORY_KEY]: next });
    return { status: 'success', removed: history.length - next.length };
}

const HANDLERS = {
    GET_EXTENSION_HISTORY: async () => ({ history: await readHistory() }),

    GET_HISTORY_SETTINGS: async () => ({ settings: await getSettings() }),

    UPDATE_HISTORY_SETTINGS: async (payload) => {
        if (!payload || typeof payload !== 'object') {
            return { status: 'error', message: 'Invalid settings payload.' };
        }
        const settings = sanitizeSettings(payload);
        await store.set({ [SETTINGS_KEY]: settings });

        const history = await readHistory();
        if (history.length > settings.recordLimit) {
            await store.set({ [HISTORY_KEY]: history.slice(0, settings.recordLimit) });
        }
        return { status: 'success', settings };
    },

    CLEAR_EXTENSION_HISTORY: async () => {
        const { length } = await readHistory();
        await store.set({ [HISTORY_KEY]: [] });
        return { status: 'success', removed: length };
    },

    PRUNE_HISTORY_BY_DAYS: async ({ daysToKeep } = {}) => {
        const days = Number(daysToKeep);
        if (!Number.isFinite(days) || days < 1) throw new Error('Invalid number of days.');
        const cutoff = Date.now() - days * DAY_MS;
        return rewriteHistory(r => r.timestamp >= cutoff);
    },

    PRUNE_INACTIVE_EXTENSIONS: async () => {
        const ids = new Set((await chrome.management.getAll()).map(e => e.id));
        return rewriteHistory(r => ids.has(r.extensionId));
    },
};

function handleMessage(request, sender, sendResponse) {
    const type = request?.type;
    if (sender.id !== chrome.runtime.id || !Object.hasOwn(HANDLERS, type)) return false;

    serialize(() => HANDLERS[type](request.payload)).then(
        sendResponse,
        (err) => sendResponse({ status: 'error', message: err?.message || String(err) })
    );
    return true; // async response
}

// ==========================================================================
// Public API
// ==========================================================================

let initialized = false;

/** Registers all listeners. Call synchronously at service-worker top level. Idempotent. */
function initTimelineManager() {
    if (initialized) return;
    initialized = true;

    const warn = (label) => (err) => console.warn(`Timeline ${label} failed:`, err);
    const mgmt = chrome.management;

    mgmt.onInstalled.addListener(info => syncExtension(info, { reinstall: true }).catch(warn('onInstalled')));
    mgmt.onUninstalled.addListener(id => removeExtension(id).catch(warn('onUninstalled')));
    mgmt.onEnabled.addListener(info => syncExtension(info).catch(warn('onEnabled')));
    mgmt.onDisabled.addListener(info => syncExtension(info).catch(warn('onDisabled')));

    chrome.runtime.onMessage.addListener(handleMessage);
    chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === POLL_ALARM) runPoll(); });

    serialize(() => seedIfEmpty()).catch(warn('seed'));
    ensurePollAlarm().catch(warn('alarm'));
}

/** Call from the service worker's runtime.onInstalled. */
async function onTimelineInstalled({ reason }) {
    try {
        await serialize(async () => {
            if (reason === 'install') {
                await store.set({ [HISTORY_KEY]: [], [SETTINGS_KEY]: DEFAULT_SETTINGS });
            } else {
                // Normalizes settings written by older versions (e.g. sortOrder "name").
                await store.set({ [SETTINGS_KEY]: await getSettings() });
            }

            const self = await chrome.management.get(chrome.runtime.id);
            // On a fresh install, seed everything except ourselves so our own
            // "installed" event is recorded below.
            await seedIfEmpty(reason === 'install' ? self.id : undefined);

            const cache = await getCache();
            const events = detectChanges(cache[self.id], self);
            if (reason === 'install' && events.length) {
                events[0].details = 'modcore EM was installed.';
            }
            await commit(events);
            cache[self.id] = snapshot(self);
            await setCache(cache);
        });
    } catch (err) {
        console.warn('Timeline install handling failed:', err);
    }
}

/** Call from the service worker's runtime.onStartup. */
const onTimelineStartup = () => runPoll();

export { initTimelineManager, onTimelineInstalled, onTimelineStartup };