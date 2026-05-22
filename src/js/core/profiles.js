/**
 * profiles.js – modcore Extension Manager (Profile Module)
 */

'use strict';

import {
    el, allFetchedExtensions, selectedExtensionIds, appSettings,
    showToast, showLoading, hideLoading, sanitizeText, makeImg, makeButton,
    showCustomConfirm, showCustomPrompt, saveSettingsToStore,
    SETTINGS_STORAGE_KEY,
    ICON, DEFAULT_ICON_PLACEHOLDER, SHORTCUT_MODIFIER_KEYS, VALID_SHORTCUT_KEYS,
    refreshExtensionDataAndRender, toggleBulkAssignMenu, clearSelection,
    updateBulkActionsUI, openDetailsPage, confirmAndDeleteExtension,
    uninstallExtension
} from './popup.js';

// ─── Constants ───────────────────────────────────────────────────────────────
const PROFILES_STORAGE_KEY = 'em_profiles';

// ─── Session state ───────────────────────────────────────────────────────────
let selectedProfileIds   = new Set();
let currentConfiguringId = null;
export const currentShortcuts = new Map();
let profileListSortable = null;
let bulkAssignFuse      = null;

// ═════════════════════════════════════════════════════════════════════════════
// PROFILE STORAGE
// ═════════════════════════════════════════════════════════════════════════════

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

        const validOrder = order.filter(id => profiles[id]);
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
        store.profiles = store.profiles || {};
        store.order = Array.isArray(store.order) ? store.order : [];
        await chrome.storage.local.set({ [PROFILES_STORAGE_KEY]: store });
    } catch (e) {
        console.error('saveProfileStore error:', e);
        showToast('Could not save profiles.', 'error');
    }
}

export async function getOrderedProfileIds() {
    const { profiles, order } = await loadProfileStore();
    const inOrder = order.filter(id => profiles[id]);
    const notInOrder = Object.keys(profiles)
        .filter(id => !inOrder.includes(id))
        .sort((a, b) => (profiles[a].name || '').localeCompare(profiles[b].name || '', undefined, { sensitivity: 'base' }));
    return [...inOrder, ...notInOrder];
}

function generateProfileId() {
    return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILE CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

export async function cleanupOrphanedProfileEntries() {
    if (!allFetchedExtensions?.length) return;
    const validIds = new Set(allFetchedExtensions.map(e => e.id));
    const store = await loadProfileStore();
    let changed = false;

    for (const profile of Object.values(store.profiles)) {
        if (!profile?.extensionStates) continue;
        for (const extId of Object.keys(profile.extensionStates)) {
            if (!validIds.has(extId)) {
                delete profile.extensionStates[extId];
                changed = true;
            }
        }
    }

    if (changed) await saveProfileStore(store);
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILES MODAL – open / close
// ═════════════════════════════════════════════════════════════════════════════

export async function openProfilesModal() {
    if (!el.profilesModal) return;
    selectedProfileIds.clear();
    currentConfiguringId = null;
    el.profilesModal.style.display = 'flex';
    el.profileConfigView.style.display = 'none';
    el.profilesModal.setAttribute('aria-hidden', 'false');
    await switchToProfileListView();
    requestAnimationFrame(() => {
        el.profilesModal.classList.add('visible');
        el.modalNewProfileNameInput?.focus();
    });
}

export function closeProfilesModal() {
    if (!el.profilesModal) return;
    currentConfiguringId = null;
    el.profilesModal.classList.remove('visible');
    el.profilesModal.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
        if (!el.profilesModal.classList.contains('visible')) el.profilesModal.style.display = 'none';
        el.profilesModalTrigger?.focus();
    }, 350);
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILES MODAL – list view  (with SortableJS)
// ═════════════════════════════════════════════════════════════════════════════

export async function switchToProfileListView() {
    currentConfiguringId = null;
    el.profileConfigView.style.display = 'none';
    el.modalProfileCreationSection.style.display = 'block';
    el.modalProfileListSection.style.display = 'block';
    await renderProfileList();
    el.modalNewProfileNameInput?.focus();
}

function initProfileSortable() {
    if (profileListSortable) profileListSortable.destroy();
    const listEl = el.modalProfileList;
    if (!listEl) return;
    profileListSortable = new Sortable(listEl, {
        handle: '.drag-handle-profile',
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: async (evt) => {
            const store = await loadProfileStore();
            const items = listEl.querySelectorAll('li[data-profileid]');
            const newOrder = Array.from(items).map(li => li.dataset.profileid).filter(Boolean);
            store.order = newOrder;
            await saveProfileStore(store);
            showToast('Profile order saved.', 'success');
        }
    });
}

export async function renderProfileList() {
    const listEl = el.modalProfileList;
    if (!listEl) return;

    const oldHeader = el.modalProfileListSection?.querySelector('.modal-list-header');
    if (oldHeader) oldHeader.remove();

    listEl.replaceChildren();

    const { profiles } = await loadProfileStore();
    const orderedIds = await getOrderedProfileIds();

    if (orderedIds.length === 0) {
        const li = document.createElement('li');
        li.className = 'no-profiles-message';
        li.setAttribute('role', 'status');
        li.textContent = 'No profiles yet. Use the input above to create one.';
        listEl.appendChild(li);
        updateProfileBulkUI();
        return;
    }

    const header = document.createElement('div');
    header.className = 'modal-list-header';

    const selAll = document.createElement('input');
    selAll.type = 'checkbox';
    selAll.id = 'select-all-profiles-checkbox';
    selAll.title = 'Select / deselect all profiles';

    const selLabel = document.createElement('label');
    selLabel.htmlFor = selAll.id;
    selLabel.textContent = 'Select All';

    const bulkDelBtn = document.createElement('button');
    bulkDelBtn.id = 'modal-bulk-delete-profiles-btn';
    bulkDelBtn.className = 'button-small button-danger';
    bulkDelBtn.style.display = 'none';
    bulkDelBtn.textContent = 'Delete Selected';

    header.appendChild(selAll);
    header.appendChild(selLabel);
    header.appendChild(bulkDelBtn);
    listEl.before(header);

    selAll.addEventListener('change', handleSelectAllProfiles);
    bulkDelBtn.addEventListener('click', () => deleteProfiles(selectedProfileIds));

    const frag = document.createDocumentFragment();
    orderedIds.forEach(profileId => {
        const profile = profiles[profileId];
        if (!profile) return;

        const li = document.createElement('li');
        li.dataset.profileid = profileId;
        li.setAttribute('role', 'listitem');
        if (selectedProfileIds.has(profileId)) li.classList.add('selected');

        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle-profile';
        dragHandle.textContent = '⋮⋮';
        dragHandle.title = 'Drag to reorder';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'profile-select-checkbox';
        cb.dataset.profileid = profileId;
        cb.checked = selectedProfileIds.has(profileId);
        cb.setAttribute('aria-label', `Select profile ${sanitizeText(profile.name)}`);

        const details = document.createElement('div');
        details.className = 'profile-item-details';
        details.title = sanitizeText(profile.name);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'profile-item-name';
        nameSpan.textContent = sanitizeText(profile.name);
        details.appendChild(nameSpan);

        if (profile.shortcut) {
            const scSpan = document.createElement('span');
            scSpan.className = 'profile-item-shortcut';
            scSpan.appendChild(makeImg(ICON.shortcut, 'Shortcut'));
            scSpan.appendChild(document.createTextNode(` ${sanitizeText(profile.shortcut)}`));
            details.appendChild(scSpan);
        }

        const actions = document.createElement('div');
        actions.className = 'profile-item-actions';

        const mkBtn = (cls, title, text, icon) => {
            const btn = makeButton({ className: `button-small ${cls}`, title, text, icon });
            btn.dataset.profileid = profileId;
            return btn;
        };

        actions.appendChild(mkBtn('button-success apply-profile-btn', 'Apply Profile', 'Apply', null));
        actions.appendChild(mkBtn('configure-profile-btn', 'Configure Profile', null, ICON.configure));
        actions.appendChild(mkBtn('icon-only duplicate-profile-btn', 'Duplicate Profile', null, ICON.duplicate));
        actions.appendChild(mkBtn('button-danger icon-only delete-profile-btn', 'Delete Profile', null, ICON.delete));

        li.appendChild(dragHandle);
        li.appendChild(cb);
        li.appendChild(details);
        li.appendChild(actions);
        frag.appendChild(li);
    });

    listEl.appendChild(frag);
    initProfileSortable();
    updateProfileBulkUI();
}

function updateProfileBulkUI() {
    const bulkBtn = document.getElementById('modal-bulk-delete-profiles-btn');
    const selAll = document.getElementById('select-all-profiles-checkbox');
    if (!bulkBtn || !selAll) return;

    const count = selectedProfileIds.size;
    bulkBtn.style.display = count > 0 ? 'inline-flex' : 'none';
    if (count > 0) bulkBtn.textContent = `Delete Selected (${count})`;

    const total = el.modalProfileList?.querySelectorAll('.profile-select-checkbox').length ?? 0;
    selAll.checked = total > 0 && count === total;
    selAll.indeterminate = count > 0 && count < total;
}

function handleSelectAllProfiles(event) {
    const checked = event.target.checked;
    el.modalProfileList?.querySelectorAll('.profile-select-checkbox').forEach(cb => {
        const id = cb.dataset.profileid;
        cb.checked = checked;
        const li = cb.closest('li');
        if (checked) { selectedProfileIds.add(id); li?.classList.add('selected'); }
        else { selectedProfileIds.delete(id); li?.classList.remove('selected'); }
    });
    updateProfileBulkUI();
}

export async function handleProfileListClick(event) {
    if (event.target.matches('.profile-select-checkbox')) {
        const id = event.target.dataset.profileid;
        const li = event.target.closest('li');
        if (event.target.checked) { selectedProfileIds.add(id); li?.classList.add('selected'); }
        else { selectedProfileIds.delete(id); li?.classList.remove('selected'); }
        updateProfileBulkUI();
        return;
    }

    const btn = event.target.closest('button[data-profileid]');
    if (!btn) return;
    const id = btn.dataset.profileid;
    if (!id) return;

    if (btn.classList.contains('delete-profile-btn')) await deleteProfiles(new Set([id]));
    else if (btn.classList.contains('apply-profile-btn')) await applyProfile(id);
    else if (btn.classList.contains('configure-profile-btn')) await switchToProfileConfigView(id);
    else if (btn.classList.contains('duplicate-profile-btn')) await duplicateProfile(id);
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILES – CRUD
// ═════════════════════════════════════════════════════════════════════════════

export async function addProfile(profileName) {
    const name = profileName.trim();
    if (!name) { showToast('Profile name cannot be empty.', 'error'); return false; }

    const store = await loadProfileStore();
    if (Object.values(store.profiles).some(p => p.name.toLowerCase() === name.toLowerCase())) {
        showToast(`Profile "${sanitizeText(name)}" already exists.`, 'error');
        return false;
    }

    const id = generateProfileId();
    store.profiles[id] = { id, name, extensionStates: {}, shortcut: null };
    store.order.push(id);
    await saveProfileStore(store);

    await renderProfileList();
    await populateBulkAssignMenu();
    showToast(`Profile "${sanitizeText(name)}" added.`, 'success');
    await registerKeyboardShortcuts();
    return true;
}

export async function deleteProfiles(idsSet) {
    if (idsSet.size === 0) return false;

    const store = await loadProfileStore();
    const profileNames = Array.from(idsSet)
        .map(id => `"${sanitizeText(store.profiles[id]?.name)}"`)
        .join(', ');

    const confirmed = await showCustomConfirm(
        `Delete ${idsSet.size} profile(s)?\n\n${profileNames}\n\nThis cannot be undone.`,
        'Delete Profiles'
    );
    if (!confirmed) {
        showToast('Deletion cancelled.', 'info');
        return false;
    }

    let deleted = 0;
    idsSet.forEach(id => {
        if (store.profiles[id]) { delete store.profiles[id]; deleted++; }
    });
    store.order = store.order.filter(id => !idsSet.has(id));

    if (deleted > 0) {
        await saveProfileStore(store);
        selectedProfileIds.clear();
        await renderProfileList();
        await populateBulkAssignMenu();
        showToast(`${deleted} profile(s) deleted.`, 'success');
        await registerKeyboardShortcuts();
    }
    return true;
}

export async function duplicateProfile(sourceId) {
    const store = await loadProfileStore();
    const source = store.profiles[sourceId];
    if (!source) { showToast('Source profile not found.', 'error'); return false; }

    let newName = `${source.name} (Copy)`;
    let counter = 1;
    while (Object.values(store.profiles).some(p => p.name.toLowerCase() === newName.toLowerCase())) {
        counter++;
        newName = `${source.name} (Copy ${counter})`;
    }

    const id = generateProfileId();
    store.profiles[id] = {
        id,
        name: newName,
        extensionStates: structuredClone(source.extensionStates ?? {}),
        shortcut: null,
    };
    store.order.push(id);
    await saveProfileStore(store);

    await renderProfileList();
    showToast(`Profile duplicated as "${sanitizeText(newName)}".`, 'success');
    await registerKeyboardShortcuts();
    return true;
}

export async function createProfileFromCurrentState() {
    showLoading();
    const profileName = await showCustomPrompt(
        'Enter a name for the new profile:',
        'Current State Profile',
        'Create Profile from Current State'
    );
    if (profileName === null) { hideLoading(); return; }

    const name = profileName.trim();
    if (!name) { hideLoading(); showToast('Profile name cannot be empty.', 'error'); return; }

    const store = await loadProfileStore();
    if (Object.values(store.profiles).some(p => p.name.toLowerCase() === name.toLowerCase())) {
        hideLoading();
        showToast(`Profile "${sanitizeText(name)}" already exists.`, 'error');
        return;
    }

    const extensionStates = {};
    allFetchedExtensions.forEach(ext => { if (ext.mayDisable) extensionStates[ext.id] = ext.enabled; });

    const id = generateProfileId();
    store.profiles[id] = { id, name, extensionStates, shortcut: null };
    store.order.push(id);
    await saveProfileStore(store);

    hideLoading();
    await renderProfileList();
    await populateBulkAssignMenu();
    showToast(`Profile "${sanitizeText(name)}" created from current state.`, 'success');
    await registerKeyboardShortcuts();
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILES – APPLY
// ═════════════════════════════════════════════════════════════════════════════

export async function applyProfile(profileId) {
    showLoading();
    try {
        const { profiles } = await loadProfileStore();
        const profile = profiles[profileId];

        if (!profile?.extensionStates || typeof profile.extensionStates !== 'object') {
            hideLoading();
            showToast('Profile not found or is empty.', 'error');
            return;
        }

        const entries = Object.entries(profile.extensionStates);
        if (entries.length === 0) {
            hideLoading();
            showToast(`Profile "${sanitizeText(profile.name)}" has no extensions configured.`, 'info');
            return;
        }

        const extMap = new Map(allFetchedExtensions.map(e => [e.id, e]));
        let success = 0, errors = 0, noChange = 0;

        const ops = entries.map(([extId, shouldEnable]) => new Promise(resolve => {
            const cur = extMap.get(extId);
            if (!cur || !cur.mayDisable) return resolve({ status: 'skipped' });
            if (cur.enabled === shouldEnable) return resolve({ status: 'nochange' });
            chrome.management.setEnabled(extId, shouldEnable, () => {
                if (chrome.runtime.lastError) resolve({ status: 'error', id: extId, error: chrome.runtime.lastError.message });
                else resolve({ status: 'success', id: extId });
            });
        }));

        const results = await Promise.all(ops);
        results.forEach(r => {
            if (r.status === 'success') { success++; const ext = extMap.get(r.id); if (ext) ext.enabled = !ext.enabled; }
            else if (r.status === 'nochange') noChange++;
            else if (r.status === 'error') { errors++; console.error('Apply profile error:', r.id, r.error); }
        });

        hideLoading();

        if (errors > 0) showToast(`"${sanitizeText(profile.name)}" applied with ${errors} error(s).`, 'error', 5000);
        else if (success > 0) showToast(`"${sanitizeText(profile.name)}" applied – ${success} changed, ${noChange} unchanged.`, 'success');
        else showToast(`All extensions in "${sanitizeText(profile.name)}" were already in the desired state.`, 'info');

        await refreshExtensionDataAndRender();
    } catch (e) {
        hideLoading();
        console.error('applyProfile error:', e);
        showToast('Failed to apply profile.', 'error');
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILE CONFIGURATION VIEW
// ═════════════════════════════════════════════════════════════════════════════

export async function switchToProfileConfigView(profileId) {
    currentConfiguringId = profileId;
    const { profiles } = await loadProfileStore();
    const profile = profiles[profileId];
    if (!profile) { await switchToProfileListView(); return; }

    el.modalProfileCreationSection.style.display = 'none';
    el.modalProfileListSection.style.display = 'none';
    el.profileConfigView.style.display = 'block';

    if (el.profileConfigTitle) el.profileConfigTitle.textContent = `Configure: ${sanitizeText(profile.name)}`;
    if (el.profileConfigNameInput) el.profileConfigNameInput.value = profile.name;
    if (el.profileConfigShortcutInput) {
        el.profileConfigShortcutInput.disabled = false;
        el.profileConfigShortcutInput.value = profile.shortcut ? (normalizeShortcut(profile.shortcut) ?? '') : '';
        el.profileConfigShortcutInput.placeholder = 'e.g., Ctrl+Shift+P';
    }
    hideShortcutMessage();

    await renderProfileConfigExtensions(profileId);
    el.saveProfileConfigBtn?.focus();
}

function hideShortcutMessage() {
    const m = el.profileConfigShortcutMessage;
    if (!m) return;
    m.textContent = '';
    m.style.display = 'none';
}

async function renderProfileConfigExtensions(profileId) {
    const listEl = el.profileConfigExtList;
    if (!listEl) return;
    listEl.replaceChildren();

    const controllable = allFetchedExtensions
        .filter(ext => ext.mayDisable)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (controllable.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'No user-controllable extensions available.';
        listEl.appendChild(p);
        return;
    }

    const { profiles } = await loadProfileStore();
    const states = profiles[profileId]?.extensionStates ?? {};
    const frag = document.createDocumentFragment();

    controllable.forEach(ext => {
        const checked = states[ext.id] ?? ext.enabled;
        const cbId = `profile-cfg-ext-${ext.id}`;

        const item = document.createElement('div');
        item.className = 'profile-config-extension-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = cbId;
        cb.className = 'profile-config-ext-checkbox';
        cb.dataset.extensionId = ext.id;
        cb.checked = checked;

        const icon = makeImg(
            ext.icons?.find(i => i.size >= 16)?.url || DEFAULT_ICON_PLACEHOLDER,
            '',
            'extension-icon-small'
        );
        icon.loading = 'lazy';

        const label = document.createElement('label');
        label.htmlFor = cbId;
        label.textContent = sanitizeText(ext.name);

        item.appendChild(cb);
        item.appendChild(icon);
        item.appendChild(label);
        frag.appendChild(item);
    });

    listEl.appendChild(frag);
}

async function saveProfileConfig() {
    if (!currentConfiguringId) return;

    const store = await loadProfileStore();
    const profile = store.profiles[currentConfiguringId];
    if (!profile) return;

    const newName = el.profileConfigNameInput?.value.trim() ?? '';
    if (!newName) { showToast('Profile name cannot be empty.', 'error'); return; }

    const nameTaken = Object.values(store.profiles).some(
        p => p.name.toLowerCase() === newName.toLowerCase() && p.id !== currentConfiguringId
    );
    if (nameTaken) { showToast(`Name "${sanitizeText(newName)}" already in use.`, 'error'); return; }

    const rawShortcut = el.profileConfigShortcutInput?.value.trim() || null;
    let validatedShortcut = null;
    if (rawShortcut) {
        const existing = await getExistingShortcuts(currentConfiguringId);
        const result = validateShortcut(rawShortcut, existing);
        if (!result.isValid) {
            showShortcutMessage(result.message, 'error');
            return;
        }
        validatedShortcut = result.normalizedShortcut;
    }

    const newStates = {};
    el.profileConfigExtList?.querySelectorAll('.profile-config-ext-checkbox').forEach(cb => {
        newStates[cb.dataset.extensionId] = cb.checked;
    });

    profile.name = newName;
    profile.extensionStates = newStates;
    profile.shortcut = validatedShortcut;

    await saveProfileStore(store);
    showToast(`Saved "${sanitizeText(profile.name)}".`, 'success');
    await registerKeyboardShortcuts();
}

function showShortcutMessage(msg, type) {
    const m = el.profileConfigShortcutMessage;
    if (!m) return;
    m.className = `feedback-message modal-feedback ${type === 'success' ? 'success-message' : type === 'error' ? 'error-message' : 'info-message'}`;
    m.textContent = sanitizeText(msg);
    m.style.display = 'block';
}

async function handleShortcutInputChange(event) {
    const val = event.target.value.trim();
    if (!val) { hideShortcutMessage(); return; }
    const existing = await getExistingShortcuts(currentConfiguringId);
    const result = validateShortcut(val, existing);
    showShortcutMessage(result.message, result.isValid ? 'success' : 'error');
}

// ═════════════════════════════════════════════════════════════════════════════
// SHORTCUT UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

export function normalizeShortcut(shortcut) {
    if (!shortcut) return null;
    const parts = shortcut.toLowerCase().split('+').map(p => p.trim());
    const modifiers = [];
    let key = '';
    const lowerModifiers = SHORTCUT_MODIFIER_KEYS.map(m => m.toLowerCase());

    parts.forEach(part => {
        if (lowerModifiers.includes(part)) {
            modifiers.push(part.charAt(0).toUpperCase() + part.slice(1));
        } else if (VALID_SHORTCUT_KEYS.toLowerCase().includes(part)) {
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

async function getExistingShortcuts(excludeProfileId = null) {
    const { profiles } = await loadProfileStore();
    const existing = new Map();
    Object.entries(profiles).forEach(([id, data]) => {
        if (id !== excludeProfileId && data.shortcut) {
            existing.set(normalizeShortcut(data.shortcut), `Profile: "${data.name}"`);
        }
    });
    return existing;
}

function validateShortcut(shortcut, existingShortcuts) {
    const normalized = normalizeShortcut(shortcut);
    if (!normalized) return { isValid: false, message: 'Invalid format. Use Ctrl+Shift+<Key> or Alt+Shift+<Key>.', normalizedShortcut: null };

    const parts = normalized.split('+');
    const key = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);

    if (!modifiers.some(m => ['Ctrl', 'Alt'].includes(m)))
        return { isValid: false, message: "Must include 'Ctrl' or 'Alt' modifier.", normalizedShortcut: null };
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

// ═════════════════════════════════════════════════════════════════════════════
// BULK ASSIGN DROPDOWN  (with Fuse.js)
// ═════════════════════════════════════════════════════════════════════════════

export async function populateBulkAssignMenu() {
    const menu = el.bulkAssignDropdownMenu;
    if (!menu) return;
    menu.replaceChildren();

    const { profiles } = await loadProfileStore();
    const orderedIds = await getOrderedProfileIds();

    const header = document.createElement('div');
    header.className = 'submenu-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'submenu-title';
    titleSpan.textContent = 'Profiles';
    header.appendChild(titleSpan);

    const tools = document.createElement('div');
    tools.className = 'submenu-tools';
    header.appendChild(tools);
    menu.appendChild(header);

    const list = document.createElement('div');
    list.className = 'submenu';
    menu.appendChild(list);

    if (orderedIds.length > 0) {
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'submenu-search';
        searchInput.placeholder = 'Search profiles…';
        searchInput.setAttribute('aria-label', 'Search profiles');
        tools.appendChild(searchInput);

        const noResults = document.createElement('div');
        noResults.className = 'context-menu-placeholder';
        noResults.setAttribute('role', 'status');
        noResults.textContent = 'No profiles match your search.';
        noResults.style.display = 'none';

        const profileData = [];

        orderedIds.forEach(profileId => {
            const profile = profiles[profileId];
            if (!profile) return;
            const displayName = sanitizeText(profile.name);

            const btn = document.createElement('button');
            btn.className = 'menu-item';
            btn.dataset.action = 'assign-profile';
            btn.dataset.value = profileId;
            btn.dataset.name = displayName.toLowerCase();
            btn.setAttribute('role', 'menuitem');
            btn.appendChild(makeImg(ICON.profiles, ''));
            const span = document.createElement('span');
            span.textContent = displayName;
            btn.appendChild(span);
            list.appendChild(btn);

            profileData.push({ id: profileId, name: displayName.toLowerCase() });
        });

        bulkAssignFuse = new Fuse(profileData, {
            keys: ['name'],
            threshold: 0.3
        });

        const removeBtn = document.createElement('button');
        removeBtn.className = 'menu-item danger';
        removeBtn.dataset.action = 'remove-profile';
        removeBtn.setAttribute('role', 'menuitem');
        removeBtn.appendChild(makeImg(ICON.delete, ''));
        const removeSpan = document.createElement('span');
        removeSpan.textContent = 'Remove from all Profiles';
        removeBtn.appendChild(removeSpan);
        list.appendChild(removeBtn);
        list.appendChild(noResults);

        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            if (!q) {
                list.querySelectorAll('.menu-item[data-name]').forEach(item => item.style.display = '');
                noResults.style.display = 'none';
                return;
            }
            const results = bulkAssignFuse.search(q);
            const matchedIds = new Set(results.map(r => r.item.id));
            let anyVis = false;
            list.querySelectorAll('.menu-item[data-name]').forEach(item => {
                const visible = matchedIds.has(item.dataset.value);
                item.style.display = visible ? '' : 'none';
                if (visible) anyVis = true;
            });
            noResults.style.display = anyVis ? 'none' : 'block';
        });
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'context-menu-placeholder';
        placeholder.setAttribute('role', 'status');
        placeholder.textContent = 'No profiles created yet.';
        list.appendChild(placeholder);

        const createBtn = document.createElement('button');
        createBtn.className = 'menu-item create-from-submenu';
        createBtn.appendChild(makeImg(ICON.add, ''));
        const sp = document.createElement('span');
        sp.textContent = 'Create Profile…';
        createBtn.appendChild(sp);
        createBtn.addEventListener('click', () => { toggleBulkAssignMenu(false); openProfilesModal(); });
        list.appendChild(createBtn);
    }
}

export async function handleBulkAssignMenuClick(event) {
    const target = event.target.closest('button[data-action]');
    if (!target) return;
    const { action, value } = target.dataset;
    const ids = selectedExtensionIds;

    switch (action) {
        case 'assign-profile': if (ids.size > 0) await assignExtensionsToProfile(ids, value); toggleBulkAssignMenu(false); break;
        case 'remove-profile': if (ids.size > 0) await removeExtensionsFromAllProfiles(ids); toggleBulkAssignMenu(false); break;
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// ASSIGN / REMOVE EXTENSIONS FROM PROFILES
// ═════════════════════════════════════════════════════════════════════════════

export async function assignExtensionsToProfile(extensionIds, profileId) {
    if (!extensionIds?.size || !profileId) return;
    const store = await loadProfileStore();
    const profile = store.profiles[profileId];
    if (!profile) { showToast('Profile not found.', 'error'); return; }

    let changed = false;
    extensionIds.forEach(extId => {
        if (profile.extensionStates[extId] !== true) { profile.extensionStates[extId] = true; changed = true; }
    });

    if (changed) {
        await saveProfileStore(store);
        showToast(`${extensionIds.size} extension(s) added to "${sanitizeText(profile.name)}".`, 'success');
    } else {
        showToast(`All selected extensions were already in "${sanitizeText(profile.name)}".`, 'info');
    }
    clearSelection();
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
        showToast(`${extensionIds.size} extension(s) removed from all profiles.`, 'success');
    } else {
        showToast('Selected extensions were not in any profiles.', 'info');
    }
    clearSelection();
}

export async function addExtensionToProfile(extensionId, profileId) {
    const store = await loadProfileStore();
    const profile = store.profiles[profileId];
    if (!profile) return;
    const ext = allFetchedExtensions.find(e => e.id === extensionId);
    if (!ext) return;
    profile.extensionStates[extensionId] = ext.enabled;
    await saveProfileStore(store);
    showToast(`Added to "${sanitizeText(profile.name)}".`, 'success', 2000);
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
    if (changed) { await saveProfileStore(store); showToast('Removed from all profiles.', 'success', 2000); }
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILE VIEWS REFRESH  (called from popup.js after uninstall)
// ═════════════════════════════════════════════════════════════════════════════

export async function refreshProfileViews() {
    if (el.profilesModal?.style.display !== 'flex') return;
    await renderProfileList();
    if (currentConfiguringId) await renderProfileConfigExtensions(currentConfiguringId);
}

// ═════════════════════════════════════════════════════════════════════════════
// EVENT LISTENER WIRING
// ═════════════════════════════════════════════════════════════════════════════

export function setupProfileModalListeners() {
    el.profilesModalTrigger?.addEventListener('click', openProfilesModal);
    el.profilesModalCloseButton?.addEventListener('click', closeProfilesModal);
    el.profilesModal?.addEventListener('click', e => { if (e.target === el.profilesModal) closeProfilesModal(); });

    el.modalAddProfileButton?.addEventListener('click', async () => {
        const input = el.modalNewProfileNameInput;
        if (input?.value.trim()) {
            if (await addProfile(input.value.trim())) input.value = '';
            input.focus();
        }
    });
    el.modalNewProfileNameInput?.addEventListener('keypress', e => { if (e.key === 'Enter') el.modalAddProfileButton?.click(); });
    el.modalProfileList?.addEventListener('click', handleProfileListClick);
    el.createFromCurrentStateButton?.addEventListener('click', createProfileFromCurrentState);

    el.saveProfileConfigBtn?.addEventListener('click', saveProfileConfig);
    el.backToProfilesBtn?.addEventListener('click', switchToProfileListView);
    el.profileConfigShortcutInput?.addEventListener('input', handleShortcutInputChange);
}

export function setupBulkAssignDropdown() {
    const menu = el.bulkAssignDropdownMenu;
    const btn = el.bulkAssignActionButton;

    btn?.addEventListener('click', event => {
        event.stopPropagation();
        if (menu.classList.contains('visible')) {
            toggleBulkAssignMenu(false);
        } else {
            const btnRect = btn.getBoundingClientRect();
            const bodyRect = document.body.getBoundingClientRect();
            const spaceAbove = btnRect.top;
            const spaceBelow = bodyRect.height - btnRect.bottom;
            menu.classList.toggle('position-below', spaceAbove < 220 && spaceBelow > spaceAbove);
            toggleBulkAssignMenu(true);
            menu.querySelector('.submenu-search')?.focus();
        }
    });

    menu?.addEventListener('click', handleBulkAssignMenuClick);
}

// ═════════════════════════════════════════════════════════════════════════════
// INITIALIZATION (profiles module)
// ═════════════════════════════════════════════════════════════════════════════

export async function initProfiles() {
    setupProfileModalListeners();
    setupBulkAssignDropdown();
}