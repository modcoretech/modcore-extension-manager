/**
 * profiles-page.js – modcore Profile Management Page
 */

'use strict';

import {
    loadProfileStore, saveProfileStore, getOrderedProfileIds, generateProfileId,
    applyProfile, normalizeShortcut, getExistingShortcuts, validateShortcut,
    registerKeyboardShortcuts, cleanupOrphanedProfileEntries
} from '../../shared/js/profiles.js';

// ─── Constants ───────────────────────────────────────────────────────────────
const DEFAULT_ICON_PLACEHOLDER = '../../../public/icons/svg/updatelogo.svg';

const ICON = {
    configure: '../../../public/icons/svg/settings.svg',
    duplicate: '../../../public/icons/svg/copy.svg',
    delete:    '../../../public/icons/svg/trash.svg',
    shortcut:  '../../../public/icons/svg/keyboard.svg',
};

const SELF_EXT_ID = chrome.runtime.id;

// ─── DOM References ─────────────────────────────────────────────────────────
let el = {};

// ─── Session State ───────────────────────────────────────────────────────────
let selectedProfileIds   = new Set();
let currentConfiguringId = null;
let allFetchedExtensions = [];
let extensionMap         = new Map();
let profileConfigAllExts = [];
let profileConfigState   = new Map();
let dialogResolve        = null;
let dialogType           = null;
let isRecordingShortcut  = false;
let lastFocusedElement   = null;
let isConfigDirty        = false;
let currentProfileFilter = '';
let focusedProfileIndex  = -1;
let profileFuse          = null;
let profileFuseDirty     = true;
let extensionFuse        = null;

// ═════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

function sanitizeText(str) {
    return str == null ? '' : String(str);
}

function makeImg(src, alt = '') {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.setAttribute('aria-hidden', 'true');
    return img;
}

function announceToScreenReader(message) {
    const region = el.ariaLiveRegion;
    if (!region) return;
    region.textContent = '';
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            region.textContent = message;
        });
    });
}

function saveFocus() {
    lastFocusedElement = document.activeElement;
}

function restoreFocus() {
    if (lastFocusedElement && lastFocusedElement.isConnected) {
        lastFocusedElement.focus({ preventScroll: true });
    }
}

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(null, args), ms);
    };
}

function invalidateProfileFuse() {
    profileFuseDirty = true;
}

// ═════════════════════════════════════════════════════════════════════════════
// DIALOGS
// ═════════════════════════════════════════════════════════════════════════════

function trapFocus(modal, event) {
    if (event.key !== 'Tab') return;
    const focusables = modal.querySelectorAll(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function initDialogs() {
    const confirmModal = document.getElementById('custom-confirm-modal');
    const promptModal  = document.getElementById('custom-prompt-modal');

    document.getElementById('custom-confirm-yes')?.addEventListener('click', () => closeDialog(true));
    document.getElementById('custom-confirm-no')?.addEventListener('click', () => closeDialog(false));
    confirmModal?.addEventListener('click', e => { if (e.target === confirmModal) closeDialog(false); });
    confirmModal?.addEventListener('keydown', e => trapFocus(confirmModal, e));

    document.getElementById('custom-prompt-ok')?.addEventListener('click', () => {
        closeDialog(document.getElementById('custom-prompt-input')?.value ?? '');
    });
    document.getElementById('custom-prompt-cancel')?.addEventListener('click', () => closeDialog(null));
    promptModal?.addEventListener('click', e => { if (e.target === promptModal) closeDialog(null); });
    promptModal?.addEventListener('keydown', e => trapFocus(promptModal, e));
    document.getElementById('custom-prompt-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); closeDialog(e.target.value); }
        if (e.key === 'Escape') { e.preventDefault(); closeDialog(null); }
    });
}

function openDialog(type, message, title, defaultValue = '') {
    dialogType = type;
    saveFocus();
    const modal = document.getElementById(type === 'confirm' ? 'custom-confirm-modal' : 'custom-prompt-modal');
    const msgEl = document.getElementById(type === 'confirm' ? 'custom-confirm-message' : 'custom-prompt-message');
    const titleEl = document.getElementById(type === 'confirm' ? 'custom-confirm-title' : 'custom-prompt-title');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (type === 'prompt') {
        const input = document.getElementById('custom-prompt-input');
        if (input) input.value = defaultValue;
    }

    if (modal) {
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => {
            modal.classList.add('visible');
            if (type === 'confirm') document.getElementById('custom-confirm-no')?.focus();
            else document.getElementById('custom-prompt-input')?.focus();
        });
    }
    return new Promise(resolve => { dialogResolve = resolve; });
}

function closeDialog(value) {
    const modal = document.getElementById(dialogType === 'confirm' ? 'custom-confirm-modal' : 'custom-prompt-modal');
    if (modal) {
        modal.classList.remove('visible');
        modal.setAttribute('aria-hidden', 'true');
        setTimeout(() => { if (!modal.classList.contains('visible')) modal.style.display = 'none'; }, 200);
    }
    if (dialogResolve) { dialogResolve(value); dialogResolve = null; }
    dialogType = null;
    restoreFocus();
}

function showCustomConfirm(message, title = 'Confirm') {
    return openDialog('confirm', message, title);
}

function showCustomPrompt(message, defaultValue = '', title = 'Input Required') {
    return openDialog('prompt', message, title, defaultValue);
}

// ═════════════════════════════════════════════════════════════════════════════
// LOADING / BUSY
// ═════════════════════════════════════════════════════════════════════════════

function showLoading() {
    if (el.loadingIndicator) {
        el.loadingIndicator.style.display = 'flex';
        el.loadingIndicator.setAttribute('aria-hidden', 'false');
    }
}
function hideLoading() {
    if (el.loadingIndicator) {
        el.loadingIndicator.style.display = 'none';
        el.loadingIndicator.setAttribute('aria-hidden', 'true');
    }
}

function setListBusy(busy) {
    if (el.profileList) el.profileList.setAttribute('aria-busy', busy ? 'true' : 'false');
}

// ═════════════════════════════════════════════════════════════════════════════
// EXTENSION DATA
// ═════════════════════════════════════════════════════════════════════════════

function fetchAllExtensions() {
    return new Promise((resolve, reject) => {
        if (!chrome?.management?.getAll) {
            reject(new Error('Extension management API unavailable'));
            return;
        }
        chrome.management.getAll(exts => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(exts || []);
        });
    });
}

async function refreshExtensionData() {
    const all = await fetchAllExtensions();

    // Never expose the current extension for management — modcore must not disable itself.
    allFetchedExtensions = all.filter(ext => ext.id !== SELF_EXT_ID);

    extensionMap.clear();
    for (const ext of allFetchedExtensions) {
        ext._searchName = (ext.name ?? '').toLowerCase();
        ext._searchDesc = (ext.description ?? '').toLowerCase();
        ext._searchId = (ext.id ?? '').toLowerCase();
        extensionMap.set(ext.id, ext);
    }

    await cleanupOrphanedProfileEntries(new Set(allFetchedExtensions.map(e => e.id)));
    invalidateProfileFuse();

    const fuseableExts = allFetchedExtensions.filter(ext => ext.mayDisable);
    extensionFuse = new Fuse(fuseableExts, {
        keys: ['name', 'description', 'id'],
        threshold: 0.3,
        ignoreLocation: true,
        includeMatches: true,
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILE LIST VIEW
// ═════════════════════════════════════════════════════════════════════════════

async function switchToProfileListView() {
    if (isConfigDirty) {
        const confirmed = await showCustomConfirm(
            'You have unsaved changes. Discard them and go back?',
            'Unsaved Changes'
        );
        if (!confirmed) return;
    }

    currentConfiguringId = null;
    isConfigDirty = false;
    updateConfigDirtyState();
    el.profileConfigSection.style.display = 'none';
    if (el.mainView) el.mainView.style.display = '';
    stopRecordingShortcut();

    await renderProfileList();
    updateProfileStats();
    el.newProfileNameInput?.focus();
}

function getFilteredProfiles(profiles, orderedIds) {
    if (!currentProfileFilter) return orderedIds;
    const filter = currentProfileFilter.toLowerCase().trim();
    if (!filter) return orderedIds;

    if (profileFuse) {
        const results = profileFuse.search(filter, { limit: 100 });
        const resultIds = new Set(results.map(r => r.item.id));
        return orderedIds.filter(id => resultIds.has(id));
    }

    return orderedIds.filter(id => {
        const p = profiles[id];
        return p && p.name.toLowerCase().includes(filter);
    });
}

function updateProfileStats() {
    const totalEl = document.getElementById('stat-total');
    const shortcutEl = document.getElementById('stat-with-shortcut');
    if (!totalEl && !shortcutEl) return;

    loadProfileStore().then(({ profiles }) => {
        const ids = Object.keys(profiles);
        const withShortcut = ids.filter(id => profiles[id]?.shortcut).length;
        if (totalEl) totalEl.textContent = ids.length;
        if (shortcutEl) shortcutEl.textContent = withShortcut;
    });
}

async function renderProfileList() {
    const listEl = el.profileList;
    if (!listEl) return;

    listEl.replaceChildren();

    const { profiles } = await loadProfileStore();
    let orderedIds = await getOrderedProfileIds();
    const allOrderedIds = orderedIds;

    if (profileFuseDirty) {
        const profileArray = orderedIds.map(id => ({ id, ...profiles[id] })).filter(p => p.name);
        profileFuse = new Fuse(profileArray, {
            keys: ['name'],
            threshold: 0.3,
            ignoreLocation: true,
        });
        profileFuseDirty = false;
    }

    orderedIds = getFilteredProfiles(profiles, orderedIds);

    const totalProfiles = Object.keys(profiles).length;
    const hasProfiles = totalProfiles > 0;

    if (el.profileListToolbar) {
        el.profileListToolbar.style.display = hasProfiles ? 'flex' : 'none';
    }

    if (totalProfiles === 0) {
        el.noProfilesMsg.style.display = 'flex';
        el.noSearchResultsMsg.style.display = 'none';
        listEl.style.display = 'none';
        selectedProfileIds.clear();
        updateProfileBulkUI();
        return;
    }

    el.noProfilesMsg.style.display = 'none';

    if (orderedIds.length === 0) {
        listEl.style.display = 'none';
        el.noSearchResultsMsg.style.display = 'flex';
        selectedProfileIds.clear();
        updateProfileBulkUI();
        announceToScreenReader('No profiles match your search.');
        return;
    }

    el.noSearchResultsMsg.style.display = 'none';
    listEl.style.display = 'block';

    if (currentProfileFilter && orderedIds.length !== allOrderedIds.length) {
        announceToScreenReader(`${orderedIds.length} of ${allOrderedIds.length} profiles match your search.`);
    }

    const validExtIds = new Set(allFetchedExtensions.map(e => e.id));
    const frag = document.createDocumentFragment();

    orderedIds.forEach((profileId, index) => {
        const profile = profiles[profileId];
        if (!profile) return;

        const li = document.createElement('li');
        li.className = 'profile-list-item';
        li.dataset.profileid = profileId;
        li.dataset.index = index;
        li.setAttribute('role', 'listitem');
        li.setAttribute('tabindex', '-1');
        if (selectedProfileIds.has(profileId)) li.classList.add('selected');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'profile-select-checkbox';
        cb.dataset.profileid = profileId;
        cb.checked = selectedProfileIds.has(profileId);
        cb.setAttribute('aria-label', `Select profile ${sanitizeText(profile.name)}`);
        cb.setAttribute('tabindex', '0');

        const details = document.createElement('div');
        details.className = 'profile-item-details';
        details.title = sanitizeText(profile.name);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'profile-item-name';
        nameSpan.textContent = sanitizeText(profile.name);
        details.appendChild(nameSpan);

        const meta = document.createElement('div');
        meta.className = 'profile-item-meta';

        const managedExtIds = Object.keys(profile.extensionStates || {}).filter(id => validExtIds.has(id));
        const extCount = managedExtIds.length;

        if (extCount === 0) {
            const emptyWarning = document.createElement('span');
            emptyWarning.className = 'profile-empty-warning';
            emptyWarning.textContent = 'Empty';
            emptyWarning.setAttribute('aria-label', 'This profile has no extensions configured');
            emptyWarning.title = 'No extensions in this profile';
            meta.appendChild(emptyWarning);
        }

        if (profile.shortcut) {
            const scSpan = document.createElement('span');
            scSpan.className = 'profile-item-shortcut';
            scSpan.appendChild(makeImg(ICON.shortcut, 'Shortcut'));
            scSpan.appendChild(document.createTextNode(` ${sanitizeText(profile.shortcut)}`));
            scSpan.setAttribute('aria-label', `Shortcut: ${sanitizeText(profile.shortcut)}`);
            meta.appendChild(scSpan);
        }

        details.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'profile-item-actions';

        const mkBtn = ({ cls, title, text, icon, ariaLabel }) => {
            const btn = document.createElement('button');
            btn.className = `button-small ${cls}`;
            btn.title = title;
            if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
            if (icon) btn.appendChild(makeImg(icon));
            if (text) btn.appendChild(document.createTextNode(text));
            btn.dataset.profileid = profileId;
            return btn;
        };

        actions.appendChild(mkBtn({
            cls: 'button-success apply-profile-btn',
            title: `Apply profile "${sanitizeText(profile.name)}"`,
            text: 'Apply',
            ariaLabel: `Apply profile ${sanitizeText(profile.name)}`
        }));
        actions.appendChild(mkBtn({
            cls: 'configure-profile-btn icon-only',
            title: `Configure "${sanitizeText(profile.name)}"`,
            icon: ICON.configure,
            ariaLabel: `Configure profile ${sanitizeText(profile.name)}`
        }));
        actions.appendChild(mkBtn({
            cls: 'duplicate-profile-btn icon-only',
            title: `Duplicate "${sanitizeText(profile.name)}"`,
            icon: ICON.duplicate,
            ariaLabel: `Duplicate profile ${sanitizeText(profile.name)}`
        }));
        actions.appendChild(mkBtn({
            cls: 'button-danger delete-profile-btn icon-only',
            title: `Delete "${sanitizeText(profile.name)}"`,
            icon: ICON.delete,
            ariaLabel: `Delete profile ${sanitizeText(profile.name)}`
        }));

        li.appendChild(cb);
        li.appendChild(details);
        li.appendChild(actions);
        frag.appendChild(li);
    });

    listEl.appendChild(frag);
    updateProfileBulkUI();
    focusedProfileIndex = -1;
}

function updateProfileBulkUI() {
    const bulkDelete = el.bulkDeleteBtn;
    const selAll = el.selectAllCheckbox;
    if (!bulkDelete || !selAll) return;

    const count = selectedProfileIds.size;

    bulkDelete.classList.toggle('visible', count > 0);
    bulkDelete.disabled = count === 0;
    bulkDelete.replaceChildren();
    bulkDelete.appendChild(makeImg(ICON.delete, ''));
    if (count > 0) {
        bulkDelete.appendChild(document.createTextNode(` Delete (${count})`));
        bulkDelete.setAttribute('aria-label', `Delete ${count} selected profiles`);
    } else {
        bulkDelete.appendChild(document.createTextNode(' Delete Selected'));
        bulkDelete.setAttribute('aria-label', 'Delete selected profiles');
    }

    const total = el.profileList?.querySelectorAll('.profile-select-checkbox').length ?? 0;
    selAll.checked = total > 0 && count === total;
    selAll.indeterminate = count > 0 && count < total;
    selAll.disabled = total === 0;
}

function handleSelectAllProfiles(event) {
    const checked = event.target.checked;
    el.profileList?.querySelectorAll('.profile-select-checkbox').forEach(cb => {
        cb.checked = checked;
        const id = cb.dataset.profileid;
        const li = cb.closest('li');
        if (checked) { selectedProfileIds.add(id); li?.classList.add('selected'); }
        else { selectedProfileIds.delete(id); li?.classList.remove('selected'); }
    });
    updateProfileBulkUI();
    announceToScreenReader(checked ? 'All profiles selected' : 'All profiles deselected');
}

async function handleProfileListClick(event) {
    const li = event.target.closest('li[data-profileid]');
    if (li) {
        const items = Array.from(el.profileList?.querySelectorAll('li[data-profileid]') || []);
        focusedProfileIndex = items.indexOf(li);
    }

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
    else if (btn.classList.contains('apply-profile-btn')) await applyProfileAndRefresh(id);
    else if (btn.classList.contains('configure-profile-btn')) await switchToProfileConfigView(id);
    else if (btn.classList.contains('duplicate-profile-btn')) await duplicateProfile(id);
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILE CRUD
// ═════════════════════════════════════════════════════════════════════════════

async function addProfile(profileName) {
    const name = profileName.trim();
    if (!name) { Status.error('Profile name cannot be empty.'); return false; }
    if (name.length > 50) { Status.error('Profile name must be 50 characters or fewer.'); return false; }

    const store = await loadProfileStore();
    if (Object.values(store.profiles).some(p => p.name.toLowerCase() === name.toLowerCase())) {
        Status.error(`Profile "${sanitizeText(name)}" already exists.`);
        return false;
    }

    const id = generateProfileId();
    store.profiles[id] = { id, name, extensionStates: {}, shortcut: null };
    store.order.push(id);
    await saveProfileStore(store);

    currentProfileFilter = '';
    if (el.profileSearchInput) el.profileSearchInput.value = '';

    invalidateProfileFuse();
    await renderProfileList();
    updateProfileStats();
    Status.success(`Profile "${sanitizeText(name)}" added.`);
    announceToScreenReader(`Profile ${name} created.`);
    await registerKeyboardShortcuts();

    const newItem = el.profileList?.querySelector(`li[data-profileid="${id}"] .profile-select-checkbox`);
    newItem?.focus();
    return true;
}

async function deleteProfiles(idsSet) {
    if (idsSet.size === 0) return false;

    const store = await loadProfileStore();
    const profileNames = Array.from(idsSet)
        .map(id => `"${sanitizeText(store.profiles[id]?.name)}"`)
        .filter(Boolean)
        .join(', ');

    const confirmed = await showCustomConfirm(
        `Delete ${idsSet.size} profile(s)?\n\n${profileNames}\n\nThis cannot be undone.`,
        'Delete Profiles'
    );
    if (!confirmed) {
        Status.info('Deletion cancelled.');
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
        invalidateProfileFuse();
        await renderProfileList();
        updateProfileStats();
        Status.success(`${deleted} profile(s) deleted.`);
        announceToScreenReader(`${deleted} profile${deleted === 1 ? '' : 's'} deleted.`);
        await registerKeyboardShortcuts();

        const nextFocus = el.profileList?.querySelector('li[data-profileid] .profile-select-checkbox');
        if (nextFocus) nextFocus.focus();
        else el.newProfileNameInput?.focus();
    }
    return true;
}

async function duplicateProfile(sourceId) {
    const store = await loadProfileStore();
    const source = store.profiles[sourceId];
    if (!source) { Status.error('Source profile not found.'); return false; }

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

    invalidateProfileFuse();
    await renderProfileList();
    updateProfileStats();
    Status.success(`Profile duplicated as "${sanitizeText(newName)}".`);
    announceToScreenReader(`Profile duplicated as ${newName}.`);
    await registerKeyboardShortcuts();

    const newItem = el.profileList?.querySelector(`li[data-profileid="${id}"] .profile-select-checkbox`);
    newItem?.focus();
    return true;
}

async function createProfileFromCurrentState() {
    const profileName = await showCustomPrompt(
        'Enter a name for the new profile:',
        'Current State Profile',
        'Create Profile from Current State'
    );
    if (profileName === null) return;

    const name = profileName.trim();
    if (!name) { Status.error('Profile name cannot be empty.'); return; }
    if (name.length > 50) { Status.error('Profile name must be 50 characters or fewer.'); return; }

    const store = await loadProfileStore();
    if (Object.values(store.profiles).some(p => p.name.toLowerCase() === name.toLowerCase())) {
        Status.error(`Profile "${sanitizeText(name)}" already exists.`);
        return;
    }

    const extensionStates = {};
    allFetchedExtensions.forEach(ext => { if (ext.mayDisable) extensionStates[ext.id] = ext.enabled; });

    const id = generateProfileId();
    store.profiles[id] = { id, name, extensionStates, shortcut: null };
    store.order.push(id);
    await saveProfileStore(store);

    invalidateProfileFuse();
    await renderProfileList();
    updateProfileStats();
    Status.success(`Profile "${sanitizeText(name)}" created from current state.`);
    announceToScreenReader(`Profile ${name} created from current state.`);
    await registerKeyboardShortcuts();

    const newItem = el.profileList?.querySelector(`li[data-profileid="${id}"] .profile-select-checkbox`);
    newItem?.focus();
}

async function applyProfileAndRefresh(profileId) {
    showLoading();
    setListBusy(true);
    try {
        await applyProfile(profileId, extensionMap);
        await refreshExtensionData();
        await renderProfileList();
        updateProfileStats();
    } finally {
        hideLoading();
        setListBusy(false);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILE CONFIGURATION VIEW
// ═════════════════════════════════════════════════════════════════════════════

async function switchToProfileConfigView(profileId) {
    currentConfiguringId = profileId;
    isConfigDirty = false;
    updateConfigDirtyState();

    const { profiles } = await loadProfileStore();
    const profile = profiles[profileId];
    if (!profile) { await switchToProfileListView(); return; }

    if (el.mainView) el.mainView.style.display = 'none';
    el.profileConfigSection.style.display = 'block';

    if (el.profileConfigTitle) el.profileConfigTitle.textContent = `Configure: ${sanitizeText(profile.name)}`;
    if (el.profileConfigNameInput) {
        el.profileConfigNameInput.value = profile.name;
        el.profileConfigNameInput.dataset.originalValue = profile.name;
    }
    if (el.profileConfigShortcutInput) {
        const normalized = profile.shortcut ? (normalizeShortcut(profile.shortcut) ?? '') : '';
        el.profileConfigShortcutInput.value = normalized;
        el.profileConfigShortcutInput.dataset.originalValue = normalized;
        el.profileConfigShortcutInput.placeholder = 'Click Record to capture';
    }
    hideShortcutMessage();

    profileConfigAllExts = allFetchedExtensions
        .filter(ext => ext.mayDisable)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    profileConfigState.clear();
    if (el.profileConfigSearch) {
        el.profileConfigSearch.value = '';
        el.profileConfigSearch.dataset.originalValue = '';
    }

    await renderProfileConfigList();
    updateConfigSummary(profile);
    el.profileConfigNameInput?.focus();
}

function updateConfigSummary(profile) {
    if (!el.configSummaryContent) return;
    const states = profile?.extensionStates || {};
    const validExtIds = new Set(allFetchedExtensions.map(e => e.id));
    const managedIds = Object.keys(states).filter(id => validExtIds.has(id));
    const enabledCount = managedIds.filter(id => states[id]).length;
    const totalCount = managedIds.length;

    el.configSummaryContent.replaceChildren();
    const createStat = (number, label) => {
        const div = document.createElement('div');
        div.className = 'summary-stat';
        const numSpan = document.createElement('span');
        numSpan.className = 'summary-number';
        numSpan.textContent = String(number);
        const labelSpan = document.createElement('span');
        labelSpan.className = 'summary-label';
        labelSpan.textContent = label;
        div.append(numSpan, labelSpan);
        return div;
    };
    el.configSummaryContent.append(
        createStat(enabledCount, 'Enabled'),
        createStat(totalCount - enabledCount, 'Disabled'),
        createStat(totalCount, 'Total')
    );

    const emptyWarning = document.getElementById('config-empty-warning');
    if (emptyWarning) {
        emptyWarning.style.display = totalCount === 0 ? 'flex' : 'none';
    }
}

function updateConfigDirtyState() {
    if (el.configDirtyIndicator) {
        el.configDirtyIndicator.style.display = isConfigDirty ? 'flex' : 'none';
    }
    if (el.saveProfileConfigBtn) {
        el.saveProfileConfigBtn.classList.toggle('button-primary-dirty', isConfigDirty);
    }
}

function markConfigDirty() {
    if (!isConfigDirty) {
        isConfigDirty = true;
        updateConfigDirtyState();
    }
}

function createProfileConfigRow(ext, checked, searchTerm) {
    const item = document.createElement('div');
    item.className = 'profile-config-extension-item';
    item.dataset.extensionId = ext.id;
    item.setAttribute('role', 'listitem');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `profile-cfg-ext-${ext.id}`;
    cb.className = 'profile-config-ext-checkbox';
    cb.dataset.extensionId = ext.id;
    cb.checked = checked;

    const icon = document.createElement('img');
    icon.src = ext.icons?.find(i => i.size >= 16)?.url || DEFAULT_ICON_PLACEHOLDER;
    icon.alt = '';
    icon.className = 'extension-icon-small';
    icon.loading = 'lazy';
    icon.onerror = function() {
        if (this.src !== DEFAULT_ICON_PLACEHOLDER) {
            this.src = DEFAULT_ICON_PLACEHOLDER;
            this.onerror = null;
        }
    };

    const label = document.createElement('label');
    label.htmlFor = cb.id;
    label.title = ext.name || '';

    if (searchTerm) {
        const lowerName = (ext.name || '').toLowerCase();
        const idx = lowerName.indexOf(searchTerm);
        if (idx >= 0) {
            label.append(
                document.createTextNode(ext.name.slice(0, idx)),
                Object.assign(document.createElement('mark'), { textContent: ext.name.slice(idx, idx + searchTerm.length) }),
                document.createTextNode(ext.name.slice(idx + searchTerm.length))
            );
        } else {
            label.textContent = ext.name || '';
        }
    } else {
        label.textContent = ext.name || '';
    }

    item.append(cb, icon, label);
    return item;
}

async function renderProfileConfigList() {
    const search = (el.profileConfigSearch?.value ?? '').toLowerCase().trim();
    let exts = profileConfigAllExts;

    if (search && extensionFuse) {
        const results = extensionFuse.search(search, { limit: 200 });
        exts = results.map(r => r.item);
    } else if (search) {
        exts = profileConfigAllExts.filter(ext =>
            ext._searchName.includes(search) ||
            ext._searchDesc.includes(search) ||
            ext._searchId.includes(search)
        );
    }

    const { profiles } = await loadProfileStore();
    const states = profiles[currentConfiguringId]?.extensionStates ?? {};

    const frag = document.createDocumentFragment();
    for (const ext of exts) {
        const checked = profileConfigState.has(ext.id)
            ? profileConfigState.get(ext.id)
            : (states[ext.id] ?? ext.enabled);
        frag.appendChild(createProfileConfigRow(ext, checked, search));
    }

    el.profileConfigExtList.replaceChildren(frag);

    const noResults = el.profileConfigSection?.querySelector('.config-no-results');
    if (noResults) {
        noResults.style.display = exts.length === 0 ? 'block' : 'none';
    }
}

async function saveProfileConfig() {
    if (!currentConfiguringId) return;

    const store = await loadProfileStore();
    const profile = store.profiles[currentConfiguringId];
    if (!profile) return;

    const newName = el.profileConfigNameInput?.value.trim() ?? '';
    if (!newName) { Status.error('Profile name cannot be empty.'); return; }
    if (newName.length > 50) { Status.error('Profile name must be 50 characters or fewer.'); return; }

    const nameTaken = Object.values(store.profiles).some(
        p => p.name.toLowerCase() === newName.toLowerCase() && p.id !== currentConfiguringId
    );
    if (nameTaken) { Status.error(`Name "${sanitizeText(newName)}" already in use.`); return; }

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
    profileConfigAllExts.forEach(ext => {
        newStates[ext.id] = profileConfigState.has(ext.id)
            ? profileConfigState.get(ext.id)
            : (profile.extensionStates[ext.id] ?? ext.enabled);
    });

    profile.name = newName;
    profile.extensionStates = newStates;
    profile.shortcut = validatedShortcut;

    await saveProfileStore(store);

    if (el.profileConfigNameInput) el.profileConfigNameInput.dataset.originalValue = newName;
    if (el.profileConfigShortcutInput) el.profileConfigShortcutInput.dataset.originalValue = validatedShortcut || '';
    isConfigDirty = false;
    updateConfigDirtyState();
    updateConfigSummary(profile);

    invalidateProfileFuse();
    Status.success(`Saved "${sanitizeText(profile.name)}".`);
    announceToScreenReader(`Profile ${profile.name} saved.`);
    await registerKeyboardShortcuts();
}

function showShortcutMessage(msg, type) {
    const m = el.profileConfigShortcutMessage;
    if (!m) return;
    m.className = `feedback-message ${type === 'success' ? 'success-message' : type === 'error' ? 'error-message' : 'info-message'}`;
    m.textContent = sanitizeText(msg);
    m.style.display = 'flex';
}

function hideShortcutMessage() {
    const m = el.profileConfigShortcutMessage;
    if (!m) return;
    m.textContent = '';
    m.style.display = 'none';
}

// ═════════════════════════════════════════════════════════════════════════════
// SHORTCUT RECORDING
// ═════════════════════════════════════════════════════════════════════════════

function startRecordingShortcut() {
    isRecordingShortcut = true;
    const input = el.profileConfigShortcutInput;
    const btn = el.shortcutRecordBtn;
    if (input) {
        input.value = '';
        input.placeholder = 'Press keys…';
        input.classList.add('recording');
        input.focus();
    }
    if (btn) {
        btn.classList.add('recording');
        btn.replaceChildren();
        btn.appendChild(makeImg(ICON.shortcut, ''));
        btn.appendChild(document.createTextNode(' Stop'));
        btn.setAttribute('aria-pressed', 'true');
    }
    showShortcutMessage('Press a combination like Ctrl+Shift+P. Press Esc to cancel.', 'info');
}

function stopRecordingShortcut() {
    isRecordingShortcut = false;
    const input = el.profileConfigShortcutInput;
    const btn = el.shortcutRecordBtn;
    if (input) {
        input.classList.remove('recording');
        input.placeholder = 'Click Record to capture';
    }
    if (btn) {
        btn.classList.remove('recording');
        btn.replaceChildren();
        btn.appendChild(makeImg(ICON.shortcut, ''));
        btn.appendChild(document.createTextNode(' Record'));
        btn.setAttribute('aria-pressed', 'false');
    }
}

function handleShortcutRecordKeydown(event) {
    if (!isRecordingShortcut) return;
    event.preventDefault();

    if (event.key === 'Escape') {
        stopRecordingShortcut();
        hideShortcutMessage();
        return;
    }

    if (['Control', 'Alt', 'Shift', 'Meta', 'Tab', 'CapsLock', 'OS'].includes(event.key)) {
        return;
    }

    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');

    if (!event.ctrlKey && !event.altKey) {
        showShortcutMessage('Shortcut must include Ctrl or Alt.', 'error');
        return;
    }
    if (!event.shiftKey) {
        showShortcutMessage('Shortcut must include Shift.', 'error');
        return;
    }

    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (!/^[A-Z0-9]$/.test(key)) {
        showShortcutMessage('Only single letters and numbers are allowed.', 'error');
        return;
    }

    parts.push(key);
    const combo = parts.join('+');

    if (el.profileConfigShortcutInput) {
        el.profileConfigShortcutInput.value = combo;
    }

    (async () => {
        const existing = await getExistingShortcuts(currentConfiguringId);
        const result = validateShortcut(combo, existing);
        showShortcutMessage(result.message, result.isValid ? 'success' : 'error');
        if (result.isValid) markConfigDirty();
    })();

    stopRecordingShortcut();
}

// ═════════════════════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═════════════════════════════════════════════════════════════════════════════

function setupListeners() {
    el.addProfileButton?.addEventListener('click', async () => {
        const input = el.newProfileNameInput;
        if (input?.value.trim()) {
            if (await addProfile(input.value.trim())) input.value = '';
            input.focus();
        }
    });
    el.newProfileNameInput?.addEventListener('keypress', e => { if (e.key === 'Enter') el.addProfileButton?.click(); });

    el.profileList?.addEventListener('click', handleProfileListClick);
    el.createFromStateButton?.addEventListener('click', createProfileFromCurrentState);
    el.selectAllCheckbox?.addEventListener('change', handleSelectAllProfiles);
    el.bulkDeleteBtn?.addEventListener('click', () => deleteProfiles(new Set(selectedProfileIds)));

    el.saveProfileConfigBtn?.addEventListener('click', saveProfileConfig);
    el.backToProfilesBtn?.addEventListener('click', switchToProfileListView);

    el.profileConfigSearch?.addEventListener('input', debounce(() => {
        markConfigDirty();
        renderProfileConfigList();
    }, 150));

    el.profileConfigExtList?.addEventListener('change', event => {
        if (event.target.classList.contains('profile-config-ext-checkbox')) {
            profileConfigState.set(event.target.dataset.extensionId, event.target.checked);
            markConfigDirty();
        }
    });

    el.profileSearchInput?.addEventListener('input', debounce((e) => {
        currentProfileFilter = e.target.value.trim();
        renderProfileList();
    }, 150));

    const clearSearch = () => {
        currentProfileFilter = '';
        if (el.profileSearchInput) el.profileSearchInput.value = '';
        renderProfileList();
        el.profileSearchInput?.focus();
    };
    el.clearSearchBtn?.addEventListener('click', clearSearch);
    el.clearSearchBtnAlt?.addEventListener('click', clearSearch);

    el.shortcutRecordBtn?.addEventListener('click', () => {
        if (isRecordingShortcut) stopRecordingShortcut();
        else startRecordingShortcut();
    });
    el.shortcutClearBtn?.addEventListener('click', () => {
        if (el.profileConfigShortcutInput) el.profileConfigShortcutInput.value = '';
        hideShortcutMessage();
        markConfigDirty();
    });
    el.profileConfigShortcutInput?.addEventListener('keydown', handleShortcutRecordKeydown);
    el.profileConfigShortcutInput?.addEventListener('blur', () => {
        if (isRecordingShortcut) stopRecordingShortcut();
    });

    el.profileConfigNameInput?.addEventListener('input', markConfigDirty);

    el.configSelectAllBtn?.addEventListener('click', () => {
        profileConfigAllExts.forEach(ext => profileConfigState.set(ext.id, true));
        renderProfileConfigList();
        markConfigDirty();
    });
    el.configSelectNoneBtn?.addEventListener('click', () => {
        profileConfigAllExts.forEach(ext => profileConfigState.set(ext.id, false));
        renderProfileConfigList();
        markConfigDirty();
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// KEYBOARD NAVIGATION
// ═════════════════════════════════════════════════════════════════════════════

function handleListKeydown(event) {
    const listEl = el.profileList;
    if (!listEl) return;
    const items = Array.from(listEl.querySelectorAll('li[data-profileid]'));
    if (items.length === 0) return;

    const active = document.activeElement;
    const inList = !!active?.closest('#profile-management-list');
    const inSearchOrSelectAll = !!active?.matches('#profile-search-input, #select-all-profiles-checkbox');

    if (!inList && !inSearchOrSelectAll) return;

    const focusItemAt = (idx) => {
        focusedProfileIndex = Math.max(0, Math.min(idx, items.length - 1));
        const target = items[focusedProfileIndex]?.querySelector('.profile-select-checkbox') || items[focusedProfileIndex];
        target?.focus();
    };

    // Down-arrow from outside the list jumps into it
    if (inSearchOrSelectAll && event.key === 'ArrowDown') {
        event.preventDefault();
        focusItemAt(0);
        return;
    }
    if (!inList) return;

    const currentIdx = items.findIndex(item => item.contains(active));
    if (currentIdx >= 0) focusedProfileIndex = currentIdx;

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            focusItemAt(focusedProfileIndex + 1);
            break;
        case 'ArrowUp':
            event.preventDefault();
            focusItemAt(focusedProfileIndex - 1);
            break;
        case 'Home':
            event.preventDefault();
            focusItemAt(0);
            break;
        case 'End':
            event.preventDefault();
            focusItemAt(items.length - 1);
            break;
        case 'Enter': {
            if (active?.classList.contains('profile-select-checkbox')) return;
            event.preventDefault();
            const id = active?.closest('li')?.dataset.profileid;
            if (id) switchToProfileConfigView(id);
            break;
        }
        case 'Delete': {
            if (active?.classList.contains('profile-select-checkbox')) {
                const id = active.dataset.profileid;
                if (id && selectedProfileIds.has(id)) {
                    event.preventDefault();
                    deleteProfiles(new Set([id]));
                }
            }
            break;
        }
    }
}

function handleGlobalKeydown(event) {
    const active = document.activeElement;
    const isInput = active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);
    const configOpen = el.profileConfigSection?.style.display !== 'none';

    if (event.key === 'Escape' && configOpen && !isInput) {
        event.preventDefault();
        switchToProfileListView();
        return;
    }

    if (!isInput && !configOpen && event.ctrlKey && event.shiftKey) {
        switch (event.key.toUpperCase()) {
            case 'N':
                event.preventDefault();
                el.newProfileNameInput?.focus();
                el.newProfileNameInput?.select();
                break;
            case 'A':
                event.preventDefault();
                if (el.selectAllCheckbox) {
                    el.selectAllCheckbox.checked = !el.selectAllCheckbox.checked;
                    el.selectAllCheckbox.dispatchEvent(new Event('change'));
                }
                break;
        }
    }

    if (configOpen && !isInput) {
        if (event.key === '/' || (event.ctrlKey && event.key.toUpperCase() === 'F')) {
            event.preventDefault();
            el.profileConfigSearch?.focus();
            el.profileConfigSearch?.select();
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// BEFOREUNLOAD HANDLER
// ═════════════════════════════════════════════════════════════════════════════

function handleBeforeUnload(event) {
    if (isConfigDirty) {
        event.preventDefault();
        event.returnValue = '';
        return '';
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═════════════════════════════════════════════════════════════════════════════

function cacheElements() {
    el = {
        loadingIndicator:           document.getElementById('loading-indicator'),
        newProfileNameInput:        document.getElementById('new-profile-name'),
        addProfileButton:           document.getElementById('add-profile-btn'),
        createFromStateButton:      document.getElementById('create-from-state-btn'),
        profileListToolbar:         document.getElementById('profile-list-toolbar'),
        profileList:                document.getElementById('profile-management-list'),
        noProfilesMsg:              document.getElementById('no-profiles-msg'),
        noSearchResultsMsg:         document.getElementById('no-search-results-msg'),
        clearSearchBtn:             document.getElementById('clear-search-btn'),
        clearSearchBtnAlt:          document.getElementById('clear-search-btn-alt'),
        profileConfigSection:       document.getElementById('profile-config-section'),
        profileConfigTitle:         document.getElementById('profile-config-title'),
        profileConfigNameInput:     document.getElementById('profile-config-name-input'),
        profileConfigShortcutInput: document.getElementById('profile-config-shortcut-input'),
        profileConfigShortcutMessage: document.getElementById('profile-config-shortcut-message'),
        profileConfigSearch:        document.getElementById('profile-config-search'),
        profileConfigExtList:       document.getElementById('profile-config-extension-list'),
        saveProfileConfigBtn:       document.getElementById('save-profile-config-btn'),
        backToProfilesBtn:          document.getElementById('back-to-profiles-btn'),
        selectAllCheckbox:          document.getElementById('select-all-profiles-checkbox'),
        bulkDeleteBtn:              document.getElementById('modal-bulk-delete-profiles-btn'),
        shortcutRecordBtn:          document.getElementById('shortcut-record-btn'),
        shortcutClearBtn:           document.getElementById('shortcut-clear-btn'),
        mainView:                   document.getElementById('main-view'),
        profileSearchInput:         document.getElementById('profile-search-input'),
        configDirtyIndicator:       document.getElementById('config-dirty-indicator'),
        configSummaryContent:       document.getElementById('config-summary-content'),
        configSelectAllBtn:         document.getElementById('config-select-all-btn'),
        configSelectNoneBtn:        document.getElementById('config-select-none-btn'),
        ariaLiveRegion:             document.getElementById('aria-live-region'),
    };
}

async function init() {
    cacheElements();
    initDialogs();
    setupListeners();
    document.addEventListener('keydown', handleGlobalKeydown);
    document.addEventListener('keydown', handleListKeydown);
    window.addEventListener('beforeunload', handleBeforeUnload);

    try {
        await refreshExtensionData();
    } catch (e) {
        console.error('Failed to load extensions:', e);
        Status.error('Extension management API unavailable. Some features may not work.');
    }

    await renderProfileList();
    updateProfileStats();
    await registerKeyboardShortcuts();

    el.newProfileNameInput?.focus();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}