/**
 * profiles.js – modcore Profile Data Layer (Shared)
 */

'use strict';

const PROFILES_STORAGE_KEY = 'em_profiles';

export const currentShortcuts = new Map();

export async function loadProfileStore() {
    try {
        const data = await chrome.storage.local.get(PROFILES_STORAGE_KEY);
        const raw = data[PROFILES_STORAGE_KEY];

        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return { profiles: {}, order: [] };
        }

        const profiles = raw.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles)
            ? raw.profiles : {};
        const order = Array.isArray(raw.order) ? raw.order.filter(id => typeof id === 'string') : [];

        for (const [id, p] of Object.entries(profiles)) {
            if (!p || typeof p !== 'object') { delete profiles[id]; continue; }
            p.id = String(id);
            p.name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Unnamed';
            const states = p.extensionStates;
            p.extensionStates = (states && typeof states === 'object' && !Array.isArray(states))
                ? states : {};
            p.shortcut = typeof p.shortcut === 'string' && p.shortcut.trim() ? p.shortcut.trim() : null;
        }

        const validOrder = [...new Set(order)].filter(id => profiles[id]);
        return { profiles, order: validOrder };
    } catch (e) {
        console.error('loadProfileStore error:', e);
        return { profiles: {}, order: [] };
    }
}

export async function saveProfileStore(store) {
    try {
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            throw new Error('Invalid store object');
        }
        const payload = {
            profiles: store.profiles || {},
            order: Array.isArray(store.order) ? store.order : []
        };
        await chrome.storage.local.set({ [PROFILES_STORAGE_KEY]: payload });
    } catch (e) {
        console.error('saveProfileStore error:', e);
        Status.error('Could not save profiles.');
        throw e;
    }
}

export async function getOrderedProfileIds() {
    const { profiles, order } = await loadProfileStore();
    const inOrder = [...new Set(order)].filter(id => profiles[id]);
    const notInOrder = Object.keys(profiles)
        .filter(id => !inOrder.includes(id))
        .sort((a, b) => (profiles[a].name || '').localeCompare(profiles[b].name || '', undefined, { sensitivity: 'base' }));
    return [...inOrder, ...notInOrder];
}

export function generateProfileId() {
    return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function getProfileById(profileId) {
    const { profiles } = await loadProfileStore();
    return profiles[profileId] || null;
}

export async function cleanupOrphanedProfileEntries(validExtensionIds) {
    if (!validExtensionIds?.size) return;
    const store = await loadProfileStore();
    let changed = false;
    for (const profile of Object.values(store.profiles)) {
        if (!profile?.extensionStates) continue;
        for (const extId of Object.keys(profile.extensionStates)) {
            if (!validExtensionIds.has(extId)) {
                delete profile.extensionStates[extId];
                changed = true;
            }
        }
    }
    if (changed) await saveProfileStore(store);
}

export async function applyProfile(profileId, extensionMap) {
    try {
        if (!extensionMap || typeof extensionMap.get !== 'function') {
            throw new Error('Invalid extensionMap');
        }
        const { profiles } = await loadProfileStore();
        const profile = profiles[profileId];

        if (!profile?.extensionStates || typeof profile.extensionStates !== 'object') {
            Status.error('Profile not found or is empty.');
            return { ok: false };
        }

        const entries = Object.entries(profile.extensionStates);
        if (entries.length === 0) {
            Status.info(`Profile "${profile.name}" has no extensions configured.`);
            return { ok: true, changed: 0, errors: 0, noChange: 0, skipped: 0 };
        }

        let success = 0, errors = 0, noChange = 0, skipped = 0;

        const ops = entries.map(([extId, shouldEnable]) => new Promise(resolve => {
            const cur = extensionMap.get(extId);
            if (!cur || !cur.mayDisable) return resolve({ status: 'skipped', id: extId });
            if (cur.enabled === shouldEnable) return resolve({ status: 'nochange', id: extId });
            chrome.management.setEnabled(extId, shouldEnable, () => {
                if (chrome.runtime.lastError) resolve({ status: 'error', id: extId, error: chrome.runtime.lastError.message, shouldEnable });
                else resolve({ status: 'success', id: extId, shouldEnable });
            });
        }));

        const results = await Promise.all(ops);
        results.forEach(r => {
            if (r.status === 'success') {
                success++;
                const ext = extensionMap.get(r.id);
                if (ext) ext.enabled = r.shouldEnable;
            } else if (r.status === 'nochange') {
                noChange++;
            } else if (r.status === 'skipped') {
                skipped++;
            } else if (r.status === 'error') {
                errors++;
                console.error('Apply profile error:', r.id, r.error);
            }
        });

        if (errors > 0) {
            Status.error(`"${profile.name}" applied with ${errors} error(s).${skipped > 0 ? ` ${skipped} skipped.` : ''}`, 5000);
        } else if (success > 0) {
            Status.success(`"${profile.name}" applied – ${success} changed, ${noChange} unchanged${skipped > 0 ? `, ${skipped} skipped` : ''}.`);
        } else if (skipped > 0) {
            Status.info(`"${profile.name}" had no changes needed. ${skipped} non-manageable extension(s) skipped.`);
        } else {
            Status.info(`All extensions in "${profile.name}" were already in the desired state.`);
        }

        return { ok: true, changed: success, errors, noChange, skipped };
    } catch (e) {
        console.error('applyProfile error:', e);
        Status.error('Failed to apply profile.');
        return { ok: false };
    }
}

export function normalizeShortcut(shortcut) {
    if (!shortcut) return null;
    const parts = shortcut.toLowerCase().split('+').map(p => p.trim());
    const modifiers = [];
    let key = '';
    const lowerModifiers = ['ctrl', 'alt', 'shift'];

    parts.forEach(part => {
        if (lowerModifiers.includes(part)) {
            modifiers.push(part.charAt(0).toUpperCase() + part.slice(1));
        } else if ('abcdefghijklmnopqrstuvwxyz0123456789'.includes(part)) {
            key = part.toUpperCase();
        }
    });

    if (!key || modifiers.length > 2 || (!modifiers.includes('Ctrl') && !modifiers.includes('Alt'))) return null;

    modifiers.sort((a, b) => {
        if (a === 'Ctrl') return -1; if (b === 'Ctrl') return 1;
        if (a === 'Alt') return -1; if (b === 'Alt') return 1;
        return 0;
    });

    return [...modifiers, key].join('+');
}

export async function getExistingShortcuts(excludeProfileId = null) {
    const { profiles } = await loadProfileStore();
    const existing = new Map();
    Object.entries(profiles).forEach(([id, data]) => {
        if (id !== excludeProfileId && data.shortcut) {
            const normalized = normalizeShortcut(data.shortcut);
            if (normalized) existing.set(normalized, `Profile: "${data.name}"`);
        }
    });
    return existing;
}

export function validateShortcut(shortcut, existingShortcuts) {
    const normalized = normalizeShortcut(shortcut);
    if (!normalized) return { isValid: false, message: 'Invalid format. Use Ctrl+Shift+<Key> or Alt+Shift+<Key>.', normalizedShortcut: null };

    const parts = normalized.split('+');
    const key = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);

    if (!modifiers.some(m => ['Ctrl', 'Alt'].includes(m)))
        return { isValid: false, message: "Must include 'Ctrl' or 'Alt' modifier.", normalizedShortcut: null };
    if (!modifiers.includes('Shift'))
        return { isValid: false, message: "Must include 'Shift' modifier.", normalizedShortcut: null };
    if (existingShortcuts.has(normalized))
        return { isValid: false, message: `Shortcut already used by ${existingShortcuts.get(normalized)}.`, normalizedShortcut: null };

    return { isValid: true, message: 'Shortcut is valid.', normalizedShortcut: normalized };
}

export async function registerKeyboardShortcuts() {
    const { profiles } = await loadProfileStore();
    currentShortcuts.clear();
    Object.entries(profiles).forEach(([id, p]) => {
        if (p?.shortcut) {
            const normalized = normalizeShortcut(p.shortcut);
            if (normalized) currentShortcuts.set(normalized, id);
        }
    });
}

export async function assignExtensionsToProfile(extensionIds, profileId, enabled = true) {
    if (!extensionIds?.size || !profileId) return;
    const store = await loadProfileStore();
    const profile = store.profiles[profileId];
    if (!profile) { Status.error('Profile not found.'); return; }

    let changed = false;
    extensionIds.forEach(extId => {
        if (profile.extensionStates[extId] !== enabled) { profile.extensionStates[extId] = enabled; changed = true; }
    });

    if (changed) {
        await saveProfileStore(store);
        Status.success(`${extensionIds.size} extension(s) ${enabled ? 'added to' : 'updated in'} "${profile.name}".`);
    } else {
        Status.info(`All selected extensions were already in "${profile.name}".`);
    }
}

export async function removeExtensionsFromAllProfiles(extensionIds) {
    if (!extensionIds?.size) return;
    const store = await loadProfileStore();
    let changed = false;
    Object.values(store.profiles).forEach(profile => {
        extensionIds.forEach(extId => {
            if (Object.prototype.hasOwnProperty.call(profile.extensionStates, extId)) {
                delete profile.extensionStates[extId];
                changed = true;
            }
        });
    });
    if (changed) {
        await saveProfileStore(store);
        Status.success(`${extensionIds.size} extension(s) removed from all profiles.`);
    } else {
        Status.info('Selected extensions were not in any profiles.');
    }
}

export async function addExtensionToProfile(extensionId, profileId, isEnabled) {
    const store = await loadProfileStore();
    const profile = store.profiles[profileId];
    if (!profile) return;
    profile.extensionStates[extensionId] = isEnabled;
    await saveProfileStore(store);
    Status.success(`Added to "${profile.name}".`, 2000);
}

export async function removeExtensionFromAllProfiles(extensionId) {
    const store = await loadProfileStore();
    let changed = false;
    Object.values(store.profiles).forEach(profile => {
        if (Object.prototype.hasOwnProperty.call(profile.extensionStates, extensionId)) {
            delete profile.extensionStates[extensionId];
            changed = true;
        }
    });
    if (changed) { await saveProfileStore(store); Status.success('Removed from all profiles.', 2000); }
}