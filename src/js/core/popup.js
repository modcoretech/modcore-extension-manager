/**
 * popup.js – modcore Extension Manager
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────
const EXTENSIONS_PER_PAGE          = 12;
const PROFILES_STORAGE_KEY         = 'em_profiles';        // { profiles:{}, order:[] }
const DEFAULT_ICON_PLACEHOLDER     = '../../public/icons/svg/updatelogo.svg';
const ITEM_FEEDBACK_HIGHLIGHT_MS   = 800;
const SHORTCUT_MODIFIER_KEYS       = ['Ctrl', 'Alt', 'Shift'];
const VALID_SHORTCUT_KEYS          = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const ICON = {
    toggle:     '../../public/icons/svg/power.svg',
    details:    '../../public/icons/svg/info.svg',
    delete:     '../../public/icons/svg/trash.svg',
    add:        '../../public/icons/svg/plus.svg',
    profiles:   '../../public/icons/svg/profiles.svg',
    configure:  '../../public/icons/svg/settings.svg',
    save:       '../../public/icons/svg/save.svg',
    back:       '../../public/icons/svg/arrow-left.svg',
    arrowRight: '../../public/icons/svg/arrow-right.svg',
    duplicate:  '../../public/icons/svg/copy.svg',
    current:    '../../public/icons/svg/current.svg',
    shortcut:   '../../public/icons/svg/keyboard.svg',
};

// ─── DOM cache ────────────────────────────────────────────────────────────────
const el = {
    loadingIndicator:               document.getElementById('loading-indicator'),
    extensionList:                  document.getElementById('extension-list'),
    extensionListHeader:            document.getElementById('extension-list-header'),
    emptyState:                     document.getElementById('empty-state-message'),
    searchInput:                    document.getElementById('search-input'),
    typeFilter:                     document.getElementById('type-filter'),
    statusFilter:                   document.getElementById('status-filter'),
    filtersRow:                     document.getElementById('filters'),
    currentPageSpan:                document.getElementById('current-page'),
    totalPagesSpan:                 document.getElementById('total-pages'),
    prevPageButton:                 document.getElementById('prev-page'),
    nextPageButton:                 document.getElementById('next-page'),
    paginationContainer:            document.getElementById('pagination-container'),
    // Bulk actions
    bulkActionsContainer:           document.getElementById('bulk-actions-container'),
    selectedCountSpan:              document.getElementById('selected-count'),
    bulkAssignActionButton:         document.getElementById('bulk-assign-action-btn'),
    bulkAssignDropdownMenu:         document.getElementById('bulk-assign-dropdown-menu'),
    bulkEnableButton:               document.getElementById('bulk-enable-button'),
    bulkDisableButton:              document.getElementById('bulk-disable-button'),
    selectAllCheckbox:              document.getElementById('select-all-checkbox'),
    // Profiles modal
    profilesModal:                  document.getElementById('profiles-modal'),
    profilesModalTrigger:           document.getElementById('profiles-modal-trigger'),
    profilesModalCloseButton:       document.querySelector('#profiles-modal .modal-close-button'),
    modalNewProfileNameInput:       document.getElementById('modal-new-profile-name'),
    modalAddProfileButton:          document.getElementById('modal-add-profile-button'),
    createFromCurrentStateButton:   document.getElementById('create-from-current-state-button'),
    modalProfileListSection:        document.getElementById('modal-profile-list-section'),
    modalProfileList:               document.getElementById('modal-profile-management-list'),
    modalProfileCreationSection:    document.getElementById('modal-profile-creation'),
    // Profile config view
    profileConfigView:              document.getElementById('modal-profile-configuration-view'),
    profileConfigTitle:             document.getElementById('profile-config-title'),
    profileConfigNameInput:         document.getElementById('profile-config-name-input'),
    profileConfigShortcutInput:     document.getElementById('profile-config-shortcut-input'),
    profileConfigShortcutMessage:   document.getElementById('profile-config-shortcut-message'),
    profileConfigExtList:           document.getElementById('profile-config-extension-list'),
    saveProfileConfigBtn:           document.getElementById('save-profile-config-btn'),
    backToProfilesBtn:              document.getElementById('back-to-profiles-btn'),
    // Help modal
    helpModal:                      document.getElementById('help-modal'),
    helpModalTrigger:               document.getElementById('help-modal-trigger'),
    helpModalCloseButton:           document.querySelector('#help-modal .modal-close-button'),
};

// ─── Session state ────────────────────────────────────────────────────────────
let searchDebounceTimer       = null;
let allFetchedExtensions      = [];
let currentFilteredExtensions = [];
let selectedExtensionIds      = new Set();
let selectedProfileIds        = new Set();
let currentConfiguringId      = null;   // profile id being configured, or null
let contextMenuEl             = null;
let activeContextExtId        = null;
const activeShortcutHandlers  = new Map();

// ═════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

/** Safely coerce any value to a plain text string. */
function sanitizeText(str) {
    if (str === null || str === undefined) return '';
    return String(str);
}

/**
 * Build a DocumentFragment with search terms highlighted.
 * Every string used here is set via textContent
 */
function highlightSearchTerms(text, searchTerms) {
    const safe = sanitizeText(text);
    if (!searchTerms?.length || !safe) return document.createTextNode(safe);

    const escaped = searchTerms
        .map(t => t.trim())
        .filter(Boolean)
        .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    if (!escaped.length) return document.createTextNode(safe);

    try {
        const regex  = new RegExp(`(${escaped.join('|')})`, 'gi');
        const parts  = safe.split(regex);
        const frag   = document.createDocumentFragment();
        parts.forEach(part => {
            if (regex.test(part) && escaped.some(t => part.toLowerCase() === t.toLowerCase())) {
                const span = document.createElement('span');
                span.className = 'search-highlight';
                span.textContent = part;
                frag.appendChild(span);
            } else if (part) {
                frag.appendChild(document.createTextNode(part));
            }
        });
        return frag;
    } catch {
        return document.createTextNode(safe);
    }
}

/** Create an <img> element */
function makeImg(src, alt = '', extraClass = '') {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.setAttribute('aria-hidden', 'true');
    if (extraClass) img.className = extraClass;
    return img;
}

/** Create a <button> with optional icon and text. */
function makeButton({ className = '', title = '', icon = null, text = null, ariaLabel = null } = {}) {
    const btn = document.createElement('button');
    btn.className = className;
    if (title)     btn.title = title;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    if (icon)      btn.appendChild(makeImg(icon));
    if (text)      btn.appendChild(document.createTextNode(` ${text}`));
    return btn;
}

// ═════════════════════════════════════════════════════════════════════════════
// TOAST / FEEDBACK
// ═════════════════════════════════════════════════════════════════════════════

let toastContainer = null;

function getToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.setAttribute('aria-live', 'polite');
        toastContainer.setAttribute('aria-atomic', 'false');
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} [duration] ms before auto-dismiss
 */
function showToast(message, type = 'info', duration = 3000) {
    const container = getToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.textContent = sanitizeText(message);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => dismissToast(toast));
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    const timer = setTimeout(() => dismissToast(toast), duration);
    toast._dismissTimer = timer;
}

function dismissToast(toast) {
    clearTimeout(toast._dismissTimer);
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

// ═════════════════════════════════════════════════════════════════════════════
// LOADING
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

// ═════════════════════════════════════════════════════════════════════════════
// PROFILE STORAGE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Returns { profiles: { [id]: ProfileObject }, order: string[] }
 * Normalises any bad values so callers always get a clean shape.
 */
async function loadProfileStore() {
    try {
        const data  = await chrome.storage.local.get(PROFILES_STORAGE_KEY);
        const raw   = data[PROFILES_STORAGE_KEY];

        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return { profiles: {}, order: [] };
        }

        const profiles = raw.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles)
            ? raw.profiles : {};

        const order = Array.isArray(raw.order) ? raw.order.filter(id => typeof id === 'string') : [];

        // Normalise each profile
        for (const [id, p] of Object.entries(profiles)) {
            if (!p || typeof p !== 'object') { delete profiles[id]; continue; }
            p.id              = id;
            p.name            = typeof p.name === 'string' ? p.name : 'Unnamed';
            p.extensionStates = (p.extensionStates && typeof p.extensionStates === 'object') ? p.extensionStates : {};
            p.shortcut        = typeof p.shortcut === 'string' ? p.shortcut : null;
        }

        // Remove orphan ids from order
        const validOrder = order.filter(id => profiles[id]);

        return { profiles, order: validOrder };
    } catch (e) {
        console.error('loadProfileStore error:', e);
        return { profiles: {}, order: [] };
    }
}

async function saveProfileStore(store) {
    try {
        await chrome.storage.local.set({ [PROFILES_STORAGE_KEY]: store });
    } catch (e) {
        console.error('saveProfileStore error:', e);
        showToast('Could not save profiles.', 'error');
    }
}

/** Convenience: return the profiles map only. */
async function getProfiles() {
    return (await loadProfileStore()).profiles;
}

/** Ordered array of profile ids respecting the saved order. */
async function getOrderedProfileIds() {
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
// PROFILES MODAL – open / close
// ═════════════════════════════════════════════════════════════════════════════

async function openProfilesModal() {
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

function closeProfilesModal() {
    if (!el.profilesModal) return;
    currentConfiguringId = null;
    el.profilesModal.classList.remove('visible');
    el.profilesModal.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
        if (!el.profilesModal.classList.contains('visible')) {
            el.profilesModal.style.display = 'none';
        }
        el.profilesModalTrigger?.focus();
    }, 350);
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILES MODAL – list view
// ═════════════════════════════════════════════════════════════════════════════

async function switchToProfileListView() {
    currentConfiguringId = null;
    el.profileConfigView.style.display = 'none';
    el.modalProfileCreationSection.style.display = 'block';
    el.modalProfileListSection.style.display = 'block';
    await renderProfileList();
    el.modalNewProfileNameInput?.focus();
}

async function renderProfileList() {
    const listEl = el.modalProfileList;
    if (!listEl) return;

    listEl.replaceChildren();

    // Remove old header if any
    const oldHeader = el.modalProfileListSection?.querySelector('.modal-list-header');
    if (oldHeader) oldHeader.remove();

    const { profiles } = await loadProfileStore();
    const orderedIds   = await getOrderedProfileIds();

    if (orderedIds.length === 0) {
        const li = document.createElement('li');
        li.className = 'no-profiles-message';
        li.setAttribute('role', 'status');
        li.textContent = 'No profiles yet. Use the input above to create one.';
        listEl.appendChild(li);
        updateProfileBulkUI();
        return;
    }

    // Header row (select-all + bulk delete)
    const header  = document.createElement('div');
    header.className = 'modal-list-header';

    const selAll  = document.createElement('input');
    selAll.type   = 'checkbox';
    selAll.id     = 'select-all-profiles-checkbox';
    selAll.title  = 'Select / deselect all profiles';

    const selLabel = document.createElement('label');
    selLabel.htmlFor   = selAll.id;
    selLabel.textContent = 'Select All';

    const bulkDelBtn = document.createElement('button');
    bulkDelBtn.id        = 'modal-bulk-delete-profiles-btn';
    bulkDelBtn.className = 'button-small button-danger';
    bulkDelBtn.style.display = 'none';
    bulkDelBtn.textContent = 'Delete Selected';

    header.appendChild(selAll);
    header.appendChild(selLabel);
    header.appendChild(bulkDelBtn);
    listEl.before(header);

    selAll.addEventListener('change', handleSelectAllProfiles);
    bulkDelBtn.addEventListener('click', () => deleteProfiles(selectedProfileIds));

    // Profile items
    const frag = document.createDocumentFragment();
    orderedIds.forEach(profileId => {
        const profile = profiles[profileId];
        if (!profile) return;

        const li = document.createElement('li');
        li.dataset.profileid = profileId;
        li.setAttribute('role', 'listitem');
        if (selectedProfileIds.has(profileId)) li.classList.add('selected');

        // Checkbox
        const cb = document.createElement('input');
        cb.type  = 'checkbox';
        cb.className = 'profile-select-checkbox';
        cb.dataset.profileid = profileId;
        cb.checked = selectedProfileIds.has(profileId);
        cb.setAttribute('aria-label', `Select profile ${sanitizeText(profile.name)}`);

        // Details
        const details = document.createElement('div');
        details.className = 'profile-item-details';
        details.title     = sanitizeText(profile.name);

        const nameSpan = document.createElement('span');
        nameSpan.className   = 'profile-item-name';
        nameSpan.textContent = sanitizeText(profile.name);
        details.appendChild(nameSpan);

        if (profile.shortcut) {
            const scSpan = document.createElement('span');
            scSpan.className = 'profile-item-shortcut';
            scSpan.appendChild(makeImg(ICON.shortcut, 'Shortcut'));
            scSpan.appendChild(document.createTextNode(` ${sanitizeText(profile.shortcut)}`));
            details.appendChild(scSpan);
        }

        // Action buttons
        const actions = document.createElement('div');
        actions.className = 'profile-item-actions';

        const mkBtn = (cls, title, text, icon) => {
            const btn = makeButton({ className: `button-small ${cls}`, title, text, icon });
            btn.dataset.profileid = profileId;
            return btn;
        };

        actions.appendChild(mkBtn('button-success apply-profile-btn',   'Apply Profile',       'Apply',     null));
        actions.appendChild(mkBtn('configure-profile-btn',               'Configure Profile',    null,        ICON.configure));
        actions.appendChild(mkBtn('icon-only duplicate-profile-btn',     'Duplicate Profile',   null,        ICON.duplicate));
        actions.appendChild(mkBtn('button-danger icon-only delete-profile-btn', 'Delete Profile', null,     ICON.delete));

        li.appendChild(cb);
        li.appendChild(details);
        li.appendChild(actions);
        frag.appendChild(li);
    });

    listEl.appendChild(frag);
    updateProfileBulkUI();
}

function updateProfileBulkUI() {
    const bulkBtn  = document.getElementById('modal-bulk-delete-profiles-btn');
    const selAll   = document.getElementById('select-all-profiles-checkbox');
    if (!bulkBtn || !selAll) return;

    const count = selectedProfileIds.size;
    bulkBtn.style.display = count > 0 ? 'inline-flex' : 'none';
    if (count > 0) bulkBtn.textContent = `Delete Selected (${count})`;

    const total = el.modalProfileList?.querySelectorAll('.profile-select-checkbox').length ?? 0;
    selAll.checked       = total > 0 && count === total;
    selAll.indeterminate = count > 0 && count < total;
}

function handleSelectAllProfiles(event) {
    const checked = event.target.checked;
    el.modalProfileList?.querySelectorAll('.profile-select-checkbox').forEach(cb => {
        const id   = cb.dataset.profileid;
        cb.checked = checked;
        const li   = cb.closest('li');
        if (checked) { selectedProfileIds.add(id);    li?.classList.add('selected'); }
        else         { selectedProfileIds.delete(id); li?.classList.remove('selected'); }
    });
    updateProfileBulkUI();
}

async function handleProfileListClick(event) {
    // Checkbox toggle
    if (event.target.matches('.profile-select-checkbox')) {
        const id  = event.target.dataset.profileid;
        const li  = event.target.closest('li');
        if (event.target.checked) { selectedProfileIds.add(id);    li?.classList.add('selected'); }
        else                      { selectedProfileIds.delete(id); li?.classList.remove('selected'); }
        updateProfileBulkUI();
        return;
    }

    // Button actions
    const btn = event.target.closest('button[data-profileid]');
    if (!btn) return;
    const id = btn.dataset.profileid;
    if (!id) return;

    if      (btn.classList.contains('delete-profile-btn'))    await deleteProfiles(new Set([id]));
    else if (btn.classList.contains('apply-profile-btn'))     await applyProfile(id);
    else if (btn.classList.contains('configure-profile-btn')) await switchToProfileConfigView(id);
    else if (btn.classList.contains('duplicate-profile-btn')) await duplicateProfile(id);
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILES – CRUD
// ═════════════════════════════════════════════════════════════════════════════

async function addProfile(profileName) {
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

async function deleteProfiles(idsSet) {
    if (idsSet.size === 0) return false;

    const store        = await loadProfileStore();
    const profileNames = Array.from(idsSet)
        .map(id => `"${sanitizeText(store.profiles[id]?.name)}"`)
        .join(', ');

    if (!confirm(`Delete ${idsSet.size} profile(s)?\n\n${profileNames}\n\nThis cannot be undone.`)) {
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

async function duplicateProfile(sourceId) {
    const store  = await loadProfileStore();
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
        name:             newName,
        extensionStates:  structuredClone(source.extensionStates ?? {}),
        shortcut:         null,
    };
    store.order.push(id);
    await saveProfileStore(store);

    await renderProfileList();
    showToast(`Profile duplicated as "${sanitizeText(newName)}".`, 'success');
    await registerKeyboardShortcuts();
    return true;
}

async function createProfileFromCurrentState() {
    showLoading();
    const profileName = prompt('Enter a name for the new profile:', 'Current State Profile');
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

async function applyProfile(profileId) {
    showLoading();
    const { profiles } = await loadProfileStore();
    const profile       = profiles[profileId];

    if (!profile?.extensionStates) {
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
        if (!cur || !cur.mayDisable)       return resolve({ status: 'skipped' });
        if (cur.enabled === shouldEnable)  return resolve({ status: 'nochange' });
        chrome.management.setEnabled(extId, shouldEnable, () => {
            if (chrome.runtime.lastError) resolve({ status: 'error',   id: extId, error: chrome.runtime.lastError.message });
            else                          resolve({ status: 'success',  id: extId });
        });
    }));

    const results = await Promise.all(ops);
    results.forEach(r => {
        if      (r.status === 'success') { success++;  const ext = extMap.get(r.id); if (ext) ext.enabled = !ext.enabled; }
        else if (r.status === 'nochange') noChange++;
        else if (r.status === 'error')   { errors++;  console.error('Apply profile error:', r.id, r.error); }
    });

    hideLoading();

    if (errors > 0)      showToast(`"${sanitizeText(profile.name)}" applied with ${errors} error(s).`, 'error', 5000);
    else if (success > 0) showToast(`"${sanitizeText(profile.name)}" applied – ${success} changed, ${noChange} unchanged.`, 'success');
    else                  showToast(`All extensions in "${sanitizeText(profile.name)}" were already in the desired state.`, 'info');

    await refreshExtensionDataAndRender(getCurrentPage());
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILE CONFIGURATION VIEW
// ═════════════════════════════════════════════════════════════════════════════

async function switchToProfileConfigView(profileId) {
    currentConfiguringId = profileId;
    const { profiles } = await loadProfileStore();
    const profile       = profiles[profileId];
    if (!profile) { await switchToProfileListView(); return; }

    el.modalProfileCreationSection.style.display = 'none';
    el.modalProfileListSection.style.display     = 'none';
    el.profileConfigView.style.display           = 'block';

    if (el.profileConfigTitle)        el.profileConfigTitle.textContent = `Configure: ${sanitizeText(profile.name)}`;
    if (el.profileConfigNameInput)    el.profileConfigNameInput.value   = profile.name;
    if (el.profileConfigShortcutInput) {
        el.profileConfigShortcutInput.disabled    = false;
        el.profileConfigShortcutInput.value       = profile.shortcut ? (normalizeShortcut(profile.shortcut) ?? '') : '';
        el.profileConfigShortcutInput.placeholder = 'e.g., Ctrl+Shift+P';
    }
    // Hide inline shortcut message
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
    const states       = profiles[profileId]?.extensionStates ?? {};
    const frag         = document.createDocumentFragment();

    controllable.forEach(ext => {
        const checked   = states[ext.id] ?? ext.enabled;
        const cbId      = `profile-cfg-ext-${ext.id}`;

        const item = document.createElement('div');
        item.className = 'profile-config-extension-item';

        const cb = document.createElement('input');
        cb.type              = 'checkbox';
        cb.id                = cbId;
        cb.className         = 'profile-config-ext-checkbox';
        cb.dataset.extensionId = ext.id;
        cb.checked           = checked;

        const icon = makeImg(
            ext.icons?.find(i => i.size >= 16)?.url || DEFAULT_ICON_PLACEHOLDER,
            '',
            'extension-icon-small'
        );
        icon.loading = 'lazy';

        const label = document.createElement('label');
        label.htmlFor    = cbId;
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

    const store   = await loadProfileStore();
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
        const result   = validateShortcut(rawShortcut, existing);
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

    profile.name             = newName;
    profile.extensionStates  = newStates;
    profile.shortcut         = validatedShortcut;

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
    const result   = validateShortcut(val, existing);
    showShortcutMessage(result.message, result.isValid ? 'success' : 'error');
}

// ═════════════════════════════════════════════════════════════════════════════
// EXTENSION DATA
// ═════════════════════════════════════════════════════════════════════════════

function fetchAllExtensions() {
    return new Promise((resolve, reject) => {
        chrome.management.getAll(exts => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(exts || []);
        });
    });
}

async function filterAndSortExtensions(extensions) {
    const search      = (el.searchInput?.value ?? '').toLowerCase().trim();
    const terms       = search.split(/\s+/).filter(Boolean);
    const typeVal     = el.typeFilter?.value   ?? 'all';
    const statusVal   = el.statusFilter?.value ?? 'all';

    const filtered = extensions.filter(ext => {
        if (typeVal !== 'all') {
            const extType = ext.isApp ? 'app' : (ext.type || 'extension');
            if (typeVal === 'extension' && !['extension', 'packaged_app'].includes(extType)) return false;
            if (typeVal === 'theme'     && extType !== 'theme')                               return false;
        }
        if (statusVal === 'enabled'  && !ext.enabled)  return false;
        if (statusVal === 'disabled' &&  ext.enabled)  return false;
        if (terms.length > 0) {
            const name = (ext.name        ?? '').toLowerCase();
            const desc = (ext.description ?? '').toLowerCase();
            const id   = (ext.id          ?? '').toLowerCase();
            return terms.every(t => name.includes(t) || desc.includes(t) || id.includes(t));
        }
        return true;
    });

    filtered.sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
    );

    return filtered;
}

// ═════════════════════════════════════════════════════════════════════════════
// EXTENSION LIST RENDERING
// ═════════════════════════════════════════════════════════════════════════════

async function renderExtensionList(page = 1) {
    if (!el.extensionList) { hideLoading(); return; }

    el.extensionList.replaceChildren();
    el.emptyState.style.display = 'none';
    el.emptyState.replaceChildren();

    currentFilteredExtensions = await filterAndSortExtensions(allFetchedExtensions);
    const total      = currentFilteredExtensions.length;
    const totalPages = Math.ceil(total / EXTENSIONS_PER_PAGE) || 1;
    const curPage    = Math.min(Math.max(page, 1), totalPages);
    const start      = (curPage - 1) * EXTENSIONS_PER_PAGE;
    const pageItems  = currentFilteredExtensions.slice(start, start + EXTENSIONS_PER_PAGE);

    if (el.currentPageSpan)  el.currentPageSpan.textContent  = String(curPage);
    if (el.totalPagesSpan)   el.totalPagesSpan.textContent   = String(totalPages);
    if (el.prevPageButton)   el.prevPageButton.disabled       = curPage === 1;
    if (el.nextPageButton)   el.nextPageButton.disabled       = curPage === totalPages;

    const searchTerms = (el.searchInput?.value ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    const frag        = document.createDocumentFragment();

    if (pageItems.length > 0) {
        if (el.extensionListHeader) el.extensionListHeader.style.display = 'flex';

        for (const ext of pageItems) {
            const item = document.createElement('div');
            item.className = 'extension-item';
            item.dataset.extensionId = ext.id;
            item.setAttribute('role', 'listitem');

            const isSelected = selectedExtensionIds.has(ext.id);
            item.classList.toggle('selected', isSelected);
            item.setAttribute('aria-selected', String(isSelected));

            // Checkbox
            const cb = document.createElement('input');
            cb.type                = 'checkbox';
            cb.className           = 'extension-select-checkbox';
            cb.dataset.extensionId = ext.id;
            cb.checked             = isSelected;
            cb.setAttribute('aria-label', `Select ${sanitizeText(ext.name)}`);

            // Icon
            const bestIcon  = ext.icons?.sort((a, b) => b.size - a.size)[0];
            const iconImg   = makeImg(bestIcon?.url ?? DEFAULT_ICON_PLACEHOLDER, '', 'extension-icon');
            iconImg.loading = 'lazy';
            iconImg.onerror = () => { if (iconImg.src !== DEFAULT_ICON_PLACEHOLDER) iconImg.src = DEFAULT_ICON_PLACEHOLDER; iconImg.onerror = null; };

            // Details
            const details  = document.createElement('div');
            details.className = 'extension-details';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'extension-name';
            nameSpan.title     = sanitizeText(ext.name);
            nameSpan.appendChild(highlightSearchTerms(ext.name, searchTerms));
            details.appendChild(nameSpan);

            // Actions
            const actions = document.createElement('div');
            actions.className = 'extension-actions';

            const toggleBtn = makeButton({
                className: `toggle-button button-small ${ext.enabled ? 'button-danger' : 'button-success'}`,
                title:     `${ext.enabled ? 'Disable' : 'Enable'} ${sanitizeText(ext.name)}`,
                icon:      ICON.toggle,
                text:      ext.enabled ? 'Disable' : 'Enable',
            });
            toggleBtn.dataset.action       = 'toggle';
            toggleBtn.dataset.extensionId  = ext.id;
            toggleBtn.dataset.currentState = ext.enabled ? 'enabled' : 'disabled';
            toggleBtn.setAttribute('aria-pressed', String(ext.enabled));

            const detailsBtn = makeButton({
                className: 'details-button button-small icon-only',
                title:     `View details for ${sanitizeText(ext.name)}`,
                icon:      ICON.details,
            });
            detailsBtn.dataset.action      = 'details';
            detailsBtn.dataset.extensionId = ext.id;

            const deleteBtn = makeButton({
                className: 'delete-button button-small button-danger icon-only',
                title:     `Uninstall ${sanitizeText(ext.name)}`,
                icon:      ICON.delete,
            });
            deleteBtn.dataset.action       = 'delete';
            deleteBtn.dataset.extensionId  = ext.id;
            deleteBtn.dataset.extensionName = sanitizeText(ext.name);

            actions.appendChild(toggleBtn);
            actions.appendChild(detailsBtn);
            actions.appendChild(deleteBtn);

            item.appendChild(cb);
            item.appendChild(iconImg);
            item.appendChild(details);
            item.appendChild(actions);
            frag.appendChild(item);
        }
    } else {
        if (el.extensionListHeader) el.extensionListHeader.style.display = 'none';
        if (el.emptyState) {
            el.emptyState.style.display = 'block';
            const p1 = document.createElement('p');
            p1.textContent = 'No extensions match your criteria.';
            el.emptyState.appendChild(p1);
            if (el.searchInput?.value.trim() || el.typeFilter?.value !== 'all' || el.statusFilter?.value !== 'all') {
                const p2 = document.createElement('p');
                p2.textContent = 'Try clearing your search or adjusting filters.';
                el.emptyState.appendChild(p2);
            }
        }
    }

    el.extensionList.appendChild(frag);
    hideLoading();
    updateSelectAllCheckboxState();
    updateBulkActionsUI();
}

async function refreshExtensionDataAndRender(page = 1) {
    showLoading();
    try {
        allFetchedExtensions = await fetchAllExtensions();
        await renderExtensionList(page);
    } catch (e) {
        hideLoading();
        showToast(`Error fetching extensions: ${e.message ?? 'Unknown error'}`, 'error');
        console.error('Extension fetch/render error:', e);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// EXTENSION ACTION DELEGATION
// ═════════════════════════════════════════════════════════════════════════════

function handleExtensionListClick(event) {
    if (event.button === 2) return;
    const target = event.target;

    if (target.classList.contains('extension-select-checkbox')) {
        const id   = target.dataset.extensionId;
        const item = target.closest('.extension-item');
        if (target.checked) { selectedExtensionIds.add(id);    item?.classList.add('selected'); }
        else                { selectedExtensionIds.delete(id); item?.classList.remove('selected'); }
        updateBulkActionsUI();
        updateSelectAllCheckboxState();
        return;
    }

    const btn = target.closest('button[data-action]');
    if (!btn) return;
    const { action, extensionId, currentState, extensionName } = btn.dataset;
    if (!extensionId) return;

    switch (action) {
        case 'toggle':  toggleExtension(extensionId, currentState === 'disabled', btn); break;
        case 'details': openDetailsPage(extensionId); break;
        case 'delete':  confirmAndDeleteExtension(extensionId, extensionName || 'this extension'); break;
    }
}

// ─── Single extension actions ─────────────────────────────────────────────────

function toggleExtension(extensionId, enable, buttonElement) {
    showLoading();
    chrome.management.setEnabled(extensionId, enable, async () => {
        hideLoading();
        if (chrome.runtime.lastError) {
            showToast(`Error: ${chrome.runtime.lastError.message}`, 'error');
            return;
        }
        showToast(`Extension ${enable ? 'enabled' : 'disabled'}.`, 'success', 2000);

        const cached = allFetchedExtensions.find(e => e.id === extensionId);
        if (cached) cached.enabled = enable;

        // Optimistic UI update
        const item = el.extensionList?.querySelector(`.extension-item[data-extension-id="${extensionId}"]`);
        const btn  = buttonElement || item?.querySelector('.toggle-button');

        if (item && btn && cached) {
            btn.dataset.currentState = enable ? 'enabled' : 'disabled';
            btn.replaceChildren(makeImg(ICON.toggle), document.createTextNode(` ${enable ? 'Disable' : 'Enable'}`));
            btn.title = `${enable ? 'Disable' : 'Enable'} ${sanitizeText(cached.name)}`;
            btn.setAttribute('aria-pressed', String(enable));
            btn.classList.toggle('button-danger',  enable);
            btn.classList.toggle('button-success', !enable);

            item.classList.add('item-feedback-highlight', enable ? 'success' : 'info');
            setTimeout(() => item.classList.remove('item-feedback-highlight', 'success', 'info'), ITEM_FEEDBACK_HIGHLIGHT_MS);

            if (el.statusFilter?.value !== 'all') {
                setTimeout(async () => await refreshExtensionDataAndRender(getCurrentPage()), ITEM_FEEDBACK_HIGHLIGHT_MS + 50);
            }
        } else {
            await refreshExtensionDataAndRender(getCurrentPage());
        }
    });
}

function openDetailsPage(extensionId) {
    chrome.tabs.create({ url: `src/html/details.html?id=${extensionId}` });
}

function confirmAndDeleteExtension(extensionId, extensionName) {
    if (confirm(`Uninstall "${sanitizeText(extensionName)}"?\n\nThis cannot be undone.`)) {
        uninstallExtension(extensionId, sanitizeText(extensionName));
    }
}

function uninstallExtension(extensionId, safeName) {
    showLoading();
    chrome.management.uninstall(extensionId, { showConfirmDialog: false }, async () => {
        hideLoading();
        if (chrome.runtime.lastError) {
            showToast(`Error uninstalling "${safeName}": ${chrome.runtime.lastError.message}`, 'error');
        } else {
            showToast(`"${safeName}" uninstalled.`, 'success');
            selectedExtensionIds.delete(extensionId);
            await refreshExtensionDataAndRender(getCurrentPage());
            if (el.profilesModal?.style.display === 'flex') {
                await renderProfileList();
                if (currentConfiguringId) await renderProfileConfigExtensions(currentConfiguringId);
            }
            await registerKeyboardShortcuts();
        }
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// BULK ACTIONS
// ═════════════════════════════════════════════════════════════════════════════

function updateBulkActionsUI() {
    const count = selectedExtensionIds.size;
    if (!el.bulkActionsContainer) return;
    if (count > 0) {
        if (el.selectedCountSpan) el.selectedCountSpan.textContent = `${count} selected`;
        el.bulkActionsContainer.style.display = 'flex';
        [el.bulkEnableButton, el.bulkDisableButton, el.bulkAssignActionButton].forEach(b => b && (b.disabled = false));
    } else {
        el.bulkActionsContainer.style.display = 'none';
        toggleBulkAssignMenu(false);
    }
}

function updateSelectAllCheckboxState() {
    if (!el.selectAllCheckbox) return;
    const cbs = [...(el.extensionList?.querySelectorAll('.extension-select-checkbox') ?? [])];
    if (!cbs.length) {
        el.selectAllCheckbox.checked       = false;
        el.selectAllCheckbox.indeterminate = false;
        el.selectAllCheckbox.disabled      = true;
        return;
    }
    el.selectAllCheckbox.disabled = false;
    const allSel  = cbs.every(cb => cb.checked);
    const someSel = cbs.some(cb => cb.checked);
    el.selectAllCheckbox.checked       = allSel;
    el.selectAllCheckbox.indeterminate = !allSel && someSel;
}

function handleSelectAllChange(event) {
    const checked = event.target.checked;
    el.extensionList?.querySelectorAll('.extension-select-checkbox').forEach(cb => {
        cb.checked = checked;
        const id   = cb.dataset.extensionId;
        const item = cb.closest('.extension-item');
        if (checked) { selectedExtensionIds.add(id);    item?.classList.add('selected'); }
        else         { selectedExtensionIds.delete(id); item?.classList.remove('selected'); }
    });
    updateBulkActionsUI();
}

function clearSelection() {
    selectedExtensionIds.clear();
    el.extensionList?.querySelectorAll('.extension-item.selected').forEach(item => {
        item.classList.remove('selected');
        const cb = item.querySelector('.extension-select-checkbox');
        if (cb) cb.checked = false;
    });
    updateBulkActionsUI();
    updateSelectAllCheckboxState();
    toggleBulkAssignMenu(false);
}

async function performBulkAction(action) {
    const ids = new Set(selectedExtensionIds);
    if (ids.size === 0) return;

    const enable = action === 'enable';
    if (action !== 'enable' && action !== 'disable') return;

    showLoading();
    const ops = Array.from(ids).map(id =>
        new Promise((res, rej) =>
            chrome.management.setEnabled(id, enable, () =>
                chrome.runtime.lastError ? rej({ error: chrome.runtime.lastError, id }) : res(id)
            )
        ).catch(e => e)
    );

    const results = await Promise.all(ops);
    let success = 0, errors = 0;

    results.forEach(r => {
        if (typeof r === 'string') {
            success++;
            const ext = allFetchedExtensions.find(e => e.id === r);
            if (ext) ext.enabled = enable;
        } else {
            errors++;
            console.error('Bulk action error:', r?.id, r?.error?.message);
        }
    });

    hideLoading();
    if (errors)         showToast(`Done with errors. ${success} ${action}d, ${errors} failed.`, 'error');
    else if (success)   showToast(`${success} extension(s) ${action}d.`, 'success');

    clearSelection();
    await refreshExtensionDataAndRender(getCurrentPage());
}

// ─── Bulk assign dropdown ─────────────────────────────────────────────────────

function toggleBulkAssignMenu(show) {
    const menu = el.bulkAssignDropdownMenu;
    const btn  = el.bulkAssignActionButton;
    if (!menu || !btn) return;
    if (show) {
        menu.classList.add('visible');
        btn.setAttribute('aria-expanded', 'true');
    } else {
        menu.classList.remove('visible');
        btn.setAttribute('aria-expanded', 'false');
    }
}

/**
 * Build the Assign-To dropdown.
 */
async function populateBulkAssignMenu() {
    const menu = el.bulkAssignDropdownMenu;
    if (!menu) return;
    menu.replaceChildren();

    const { profiles } = await loadProfileStore();
    const orderedIds   = await getOrderedProfileIds();

    // Header row (title + optional search)
    const header = document.createElement('div');
    header.className = 'submenu-header';

    const titleSpan = document.createElement('span');
    titleSpan.className   = 'submenu-title';
    titleSpan.textContent = 'Profiles';
    header.appendChild(titleSpan);

    const tools = document.createElement('div');
    tools.className = 'submenu-tools';
    header.appendChild(tools);
    menu.appendChild(header);

    // Scrollable list
    const list = document.createElement('div');
    list.className = 'submenu';
    menu.appendChild(list);

    if (orderedIds.length > 0) {
        // Search input
        const searchInput = document.createElement('input');
        searchInput.type        = 'search';
        searchInput.className   = 'submenu-search';
        searchInput.placeholder = 'Search profiles…';
        searchInput.setAttribute('aria-label', 'Search profiles');
        tools.appendChild(searchInput);

        const noResults = document.createElement('div');
        noResults.className = 'context-menu-placeholder';
        noResults.setAttribute('role', 'status');
        noResults.textContent = 'No profiles match your search.';
        noResults.style.display = 'none';

        orderedIds.forEach(profileId => {
            const profile = profiles[profileId];
            if (!profile) return;
            const displayName = sanitizeText(profile.name);

            const btn = document.createElement('button');
            btn.className     = 'menu-item';
            btn.dataset.action = 'assign-profile';
            btn.dataset.value  = profileId;
            btn.dataset.name   = displayName.toLowerCase();
            btn.setAttribute('role', 'menuitem');
            btn.appendChild(makeImg(ICON.profiles, ''));
            const span = document.createElement('span');
            span.textContent = displayName;
            btn.appendChild(span);
            list.appendChild(btn);
        });

        // Remove from all profiles
        const removeBtn = document.createElement('button');
        removeBtn.className     = 'menu-item danger';
        removeBtn.dataset.action = 'remove-profile';
        removeBtn.setAttribute('role', 'menuitem');
        removeBtn.appendChild(makeImg(ICON.delete, ''));
        const removeSpan = document.createElement('span');
        removeSpan.textContent = 'Remove from all Profiles';
        removeBtn.appendChild(removeSpan);
        list.appendChild(removeBtn);
        list.appendChild(noResults);

        // Live filtering
        searchInput.addEventListener('input', () => {
            const q    = searchInput.value.trim().toLowerCase();
            let anyVis = false;
            list.querySelectorAll('.menu-item[data-name]').forEach(item => {
                const visible = !q || item.dataset.name.includes(q);
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

// ═════════════════════════════════════════════════════════════════════════════
// ASSIGN / REMOVE EXTENSIONS FROM PROFILES
// ═════════════════════════════════════════════════════════════════════════════

async function assignExtensionsToProfile(extensionIds, profileId) {
    if (!extensionIds?.size || !profileId) return;
    const store   = await loadProfileStore();
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

async function removeExtensionsFromAllProfiles(extensionIds) {
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

async function addExtensionToProfile(extensionId, profileId) {
    const store   = await loadProfileStore();
    const profile = store.profiles[profileId];
    if (!profile) return;
    const ext = allFetchedExtensions.find(e => e.id === extensionId);
    if (!ext) return;
    profile.extensionStates[extensionId] = ext.enabled;
    await saveProfileStore(store);
    showToast(`Added to "${sanitizeText(profile.name)}".`, 'success', 2000);
}

async function removeExtensionFromAllProfiles(extensionId) {
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
// CONTEXT MENU
// ═════════════════════════════════════════════════════════════════════════════

function createContextMenu() {
    if (document.getElementById('custom-context-menu')) {
        contextMenuEl = document.getElementById('custom-context-menu');
        return;
    }
    contextMenuEl = document.createElement('div');
    contextMenuEl.id        = 'custom-context-menu';
    contextMenuEl.className = 'custom-context-menu';
    document.body.appendChild(contextMenuEl);
}

function hideContextMenu() {
    contextMenuEl?.classList.remove('visible');
    contextMenuEl?.removeEventListener('keydown', handleContextMenuKeyDown);
    activeContextExtId = null;
}

function handleContextMenuKeyDown(event) {
    const items = [...contextMenuEl.querySelectorAll('.context-menu-item:not([style*="display: none"]):not(.context-menu-separator)')];
    if (!items.length) return;
    const focused = document.activeElement;
    const inside  = contextMenuEl.contains(focused);
    let newIdx    = -1;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        newIdx = !inside ? 0 : (items.indexOf(focused) + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        newIdx = !inside ? items.length - 1 : (items.indexOf(focused) - 1 + items.length) % items.length;
    } else if (event.key === 'Enter' && inside && focused?.classList.contains('context-menu-item')) {
        event.preventDefault();
        focused.click();
    } else if (event.key === 'Escape') {
        event.preventDefault();
        hideContextMenu();
        (document.querySelector(`.extension-item[data-extension-id="${activeContextExtId}"]`) ?? el.searchInput)?.focus();
    }
    if (newIdx !== -1) items[newIdx].focus();
}

async function showContextMenu(extensionId, event) {
    event.preventDefault();
    event.stopPropagation();
    activeContextExtId = extensionId;

    const extension = allFetchedExtensions.find(e => e.id === extensionId);
    if (!extension) return;

    contextMenuEl.replaceChildren();
    const frag = document.createDocumentFragment();

    // Helper to make a context menu item button
    const makeItem = (text, icon, action, danger = false) => {
        const item = document.createElement('button');
        item.className = `context-menu-item${danger ? ' danger' : ''}`;
        item.appendChild(makeImg(icon, ''));
        const span = document.createElement('span');
        span.textContent = text;
        item.appendChild(span);
        item.addEventListener('click', () => { action(); hideContextMenu(); });
        return item;
    };

    // Info section
    const info = document.createElement('div');
    info.className = 'context-menu-info';
    const strong = document.createElement('strong');
    strong.textContent = sanitizeText(extension.name);
    const verSpan = document.createElement('span');
    verSpan.textContent = `Version: ${sanitizeText(extension.version)}`;
    const idSpan = document.createElement('span');
    idSpan.textContent = `ID: ${sanitizeText(extension.id)}`;
    idSpan.title = sanitizeText(extension.id);
    info.appendChild(strong);
    info.appendChild(verSpan);
    info.appendChild(idSpan);
    frag.appendChild(info);
    frag.appendChild(Object.assign(document.createElement('hr'), { className: 'context-menu-separator' }));

    // Profile membership
    const { profiles } = await loadProfileStore();
    const memberProfiles = Object.values(profiles).filter(p =>
        Object.prototype.hasOwnProperty.call(p.extensionStates, extensionId)
    );
    if (memberProfiles.length > 0) {
        const mem = document.createElement('div');
        mem.className = 'context-menu-membership';
        const mStrong = document.createElement('strong');
        mStrong.textContent = 'In Profiles:';
        mem.appendChild(mStrong);
        const ul = document.createElement('ul');
        memberProfiles.forEach(p => {
            const li = document.createElement('li');
            li.textContent = sanitizeText(p.name);
            li.title       = sanitizeText(p.name);
            li.className   = 'context-menu-item-name';
            ul.appendChild(li);
        });
        mem.appendChild(ul);
        frag.appendChild(mem);
        frag.appendChild(Object.assign(document.createElement('hr'), { className: 'context-menu-separator' }));
    }

    // Core actions
    frag.appendChild(makeItem('View Details', ICON.details, () => openDetailsPage(extensionId)));

    // Assign to Profile submenu
    const profileMenuItem = document.createElement('button');
    profileMenuItem.className = 'context-menu-item';
    profileMenuItem.appendChild(makeImg(ICON.profiles, ''));
    const pSpan = document.createElement('span');
    pSpan.textContent = 'Assign to Profile';
    profileMenuItem.appendChild(pSpan);
    profileMenuItem.appendChild(document.createTextNode(' ▶'));

    const submenu = document.createElement('div');
    submenu.className = 'context-menu-submenu';
    const orderedIds = await getOrderedProfileIds();
    if (orderedIds.length > 0) {
        orderedIds.forEach(pid => {
            submenu.appendChild(makeItem(sanitizeText(profiles[pid].name), ICON.add, () => addExtensionToProfile(extensionId, pid)));
        });
        submenu.appendChild(Object.assign(document.createElement('hr'), { className: 'context-menu-separator' }));
        submenu.appendChild(makeItem('Remove from all Profiles', ICON.delete, () => removeExtensionFromAllProfiles(extensionId), true));
    } else {
        const ph = document.createElement('div');
        ph.className   = 'context-menu-placeholder';
        ph.textContent = 'No profiles created yet.';
        ph.setAttribute('role', 'status');
        submenu.appendChild(ph);
        submenu.appendChild(makeItem('Create Profile…', ICON.add, () => openProfilesModal()));
    }
    profileMenuItem.appendChild(submenu);
    frag.appendChild(profileMenuItem);

    frag.appendChild(Object.assign(document.createElement('hr'), { className: 'context-menu-separator' }));

    frag.appendChild(makeItem('Options', ICON.configure, () => {
        chrome.management.get(extensionId, ext => {
            if (chrome.runtime.lastError) { showToast(chrome.runtime.lastError.message, 'error'); return; }
            chrome.tabs.create({ url: ext?.optionsUrl || `chrome://extensions/?id=${extensionId}` });
            if (!ext?.optionsUrl) showToast('No dedicated Options page; opened extension details.', 'info');
        });
    }));
    frag.appendChild(makeItem('Uninstall', ICON.delete, () => confirmAndDeleteExtension(extensionId, extension.name), true));

    contextMenuEl.appendChild(frag);

    // Position
    const { clientX: mx, clientY: my } = event;
    contextMenuEl.style.top  = `${Math.min(my, window.innerHeight - contextMenuEl.offsetHeight - 5)}px`;
    contextMenuEl.style.left = `${Math.min(mx, window.innerWidth  - contextMenuEl.offsetWidth  - 5)}px`;
    contextMenuEl.classList.add('visible');
    contextMenuEl.addEventListener('keydown', handleContextMenuKeyDown);
    contextMenuEl.querySelector('.context-menu-item')?.focus();
}

// ═════════════════════════════════════════════════════════════════════════════
// FILTERS & SEARCH
// ═════════════════════════════════════════════════════════════════════════════

async function setupFiltersAndSearch() {
    let clearFiltersBtn = null;

    async function handleFilterChange() {
        clearSelection();
        await renderExtensionList(1);
        updateClearFiltersVisibility();
    }

    function createClearFiltersButton() {
        if (document.getElementById('clear-filters-btn')) {
            clearFiltersBtn = document.getElementById('clear-filters-btn');
            return;
        }
        clearFiltersBtn             = document.createElement('button');
        clearFiltersBtn.id          = 'clear-filters-btn';
        clearFiltersBtn.className   = 'button-small';
        clearFiltersBtn.textContent = 'Clear Filters';
        clearFiltersBtn.title       = 'Reset all search and filter options (Ctrl+Shift+F)';
        clearFiltersBtn.style.display = 'none';
        el.filtersRow?.appendChild(clearFiltersBtn);
        clearFiltersBtn.addEventListener('click', clearAllFilters);
    }

    function updateClearFiltersVisibility() {
        if (!clearFiltersBtn) return;
        const active = el.searchInput?.value.trim() || el.typeFilter?.value !== 'all' || el.statusFilter?.value !== 'all';
        clearFiltersBtn.style.display = active ? 'inline-flex' : 'none';
    }

    async function clearAllFilters() {
        if (el.searchInput)  el.searchInput.value  = '';
        if (el.typeFilter)   el.typeFilter.value   = 'all';
        if (el.statusFilter) el.statusFilter.value = 'all';
        await handleFilterChange();
    }

    createClearFiltersButton();
    updateClearFiltersVisibility();

    el.typeFilter?.addEventListener('change', handleFilterChange);
    el.statusFilter?.addEventListener('change', handleFilterChange);
    el.searchInput?.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(handleFilterChange, 300);
    });

    await populateBulkAssignMenu();

    return { clearAllFilters };
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGINATION
// ═════════════════════════════════════════════════════════════════════════════

function getCurrentPage() {
    return parseInt(el.currentPageSpan?.textContent || '1', 10);
}

function setupPagination() {
    el.prevPageButton?.addEventListener('click', async () => {
        if (!el.prevPageButton.disabled) await renderExtensionList(getCurrentPage() - 1);
    });
    el.nextPageButton?.addEventListener('click', async () => {
        if (!el.nextPageButton.disabled) await renderExtensionList(getCurrentPage() + 1);
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// HELP MODAL
// ═════════════════════════════════════════════════════════════════════════════

function openHelpModal() {
    if (!el.helpModal) return;
    el.helpModal.style.display = 'flex';
    el.helpModal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
        el.helpModal.classList.add('visible');
        el.helpModal.querySelector('.modal-close-button')?.focus();
    });
}

function closeHelpModal() {
    if (!el.helpModal) return;
    el.helpModal.classList.remove('visible');
    el.helpModal.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
        if (!el.helpModal.classList.contains('visible')) el.helpModal.style.display = 'none';
        el.helpModalTrigger?.focus();
    }, 350);
}

// ═════════════════════════════════════════════════════════════════════════════
// EVENT LISTENER WIRING
// ═════════════════════════════════════════════════════════════════════════════

function setupModalListeners() {
    // Profiles modal
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

    // Profile config
    el.saveProfileConfigBtn?.addEventListener('click', saveProfileConfig);
    el.backToProfilesBtn?.addEventListener('click', switchToProfileListView);
    el.profileConfigShortcutInput?.addEventListener('input', handleShortcutInputChange);

    // Help modal
    el.helpModalTrigger?.addEventListener('click', openHelpModal);
    el.helpModalCloseButton?.addEventListener('click', closeHelpModal);
    el.helpModal?.addEventListener('click', e => { if (e.target === el.helpModal) closeHelpModal(); });
}

function setupBulkActionListeners() {
    el.selectAllCheckbox?.addEventListener('change', handleSelectAllChange);
    el.bulkEnableButton?.addEventListener('click', () => performBulkAction('enable'));
    el.bulkDisableButton?.addEventListener('click', () => performBulkAction('disable'));

    const menu = el.bulkAssignDropdownMenu;
    const btn  = el.bulkAssignActionButton;

    // Toggle menu on click; jump straight to profiles submenu (no intermediate screen)
    btn?.addEventListener('click', event => {
        event.stopPropagation();
        if (menu.classList.contains('visible')) {
            toggleBulkAssignMenu(false);
        } else {
            // Position above or below
            const btnRect  = btn.getBoundingClientRect();
            const bodyRect = document.body.getBoundingClientRect();
            const spaceAbove = btnRect.top;
            const spaceBelow = bodyRect.height - btnRect.bottom;
            menu.classList.toggle('position-below', spaceAbove < 220 && spaceBelow > spaceAbove);
            toggleBulkAssignMenu(true);
            // Focus the search input if present
            menu.querySelector('.submenu-search')?.focus();
        }
    });

    // Handle actions inside menu
    menu?.addEventListener('click', async event => {
        const target = event.target.closest('button[data-action]');
        if (!target) return;
        const { action, value } = target.dataset;
        const ids = selectedExtensionIds;

        switch (action) {
            case 'assign-profile': if (ids.size > 0) await assignExtensionsToProfile(ids, value); toggleBulkAssignMenu(false); break;
            case 'remove-profile': if (ids.size > 0) await removeExtensionsFromAllProfiles(ids);  toggleBulkAssignMenu(false); break;
        }
    });

    // Close on outside click
    document.addEventListener('click', event => {
        if (!menu?.contains(event.target) && !btn?.contains(event.target)) {
            if (menu?.classList.contains('visible')) toggleBulkAssignMenu(false);
        }
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS (global profile shortcuts + popup hotkeys)
// ═════════════════════════════════════════════════════════════════════════════

function normalizeShortcut(shortcut) {
    if (!shortcut) return null;
    const parts     = shortcut.toLowerCase().split('+').map(p => p.trim());
    const modifiers = [];
    let key         = '';

    parts.forEach(part => {
        if (SHORTCUT_MODIFIER_KEYS.map(m => m.toLowerCase()).includes(part)) {
            modifiers.push(part.charAt(0).toUpperCase() + part.slice(1));
        } else if (VALID_SHORTCUT_KEYS.toLowerCase().includes(part)) {
            key = part.toUpperCase();
        }
    });

    if (!key || modifiers.length > 2 || (!modifiers.includes('Ctrl') && !modifiers.includes('Alt'))) return null;

    modifiers.sort((a, b) => {
        if (a === 'Ctrl') return -1; if (b === 'Ctrl') return 1;
        if (a === 'Alt')  return -1; if (b === 'Alt')  return 1;
        return 0;
    });

    return [...modifiers, key].join('+');
}

async function getExistingShortcuts(excludeProfileId = null) {
    const { profiles } = await loadProfileStore();
    const existing     = new Map();
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

    const parts     = normalized.split('+');
    const key       = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);

    if (key.length !== 1 || !VALID_SHORTCUT_KEYS.includes(key))
        return { isValid: false, message: `Invalid key "${key}". Must be a letter or number.`, normalizedShortcut: null };
    if (!modifiers.some(m => ['Ctrl', 'Alt'].includes(m)))
        return { isValid: false, message: "Must include 'Ctrl' or 'Alt' modifier.", normalizedShortcut: null };
    if (existingShortcuts.has(normalized))
        return { isValid: false, message: `Shortcut already used by ${existingShortcuts.get(normalized)}.`, normalizedShortcut: null };

    return { isValid: true, message: 'Shortcut is valid.', normalizedShortcut: normalized };
}

async function registerKeyboardShortcuts() {
    activeShortcutHandlers.forEach(handler => document.removeEventListener('keydown', handler));
    activeShortcutHandlers.clear();

    const { profiles } = await loadProfileStore();
    Object.entries(profiles).forEach(([profileId, profile]) => {
        if (!profile.shortcut) return;
        const normalized = normalizeShortcut(profile.shortcut);
        if (!normalized || activeShortcutHandlers.has(normalized)) return;

        const handler = event => {
            const pressed = [];
            if (event.ctrlKey)  pressed.push('Ctrl');
            if (event.altKey)   pressed.push('Alt');
            if (event.shiftKey) pressed.push('Shift');
            pressed.push(event.key.toUpperCase());
            if (normalizeShortcut(pressed.join('+')) === normalized) {
                event.preventDefault();
                applyProfile(profileId).then(() => window.close());
            }
        };
        document.addEventListener('keydown', handler);
        activeShortcutHandlers.set(normalized, handler);
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═════════════════════════════════════════════════════════════════════════════

async function initializePopup() {
    console.log('modcore EM Popup Initializing…');

    createContextMenu();
    setupPagination();
    const { clearAllFilters } = await setupFiltersAndSearch();
    setupModalListeners();
    setupBulkActionListeners();

    el.extensionList?.addEventListener('click', handleExtensionListClick);
    el.extensionList?.addEventListener('contextmenu', event => {
        const item = event.target.closest('.extension-item');
        if (item?.dataset.extensionId) showContextMenu(item.dataset.extensionId, event);
    });

    document.addEventListener('click', event => {
        if (!contextMenuEl?.contains(event.target)) hideContextMenu();
    });

    document.addEventListener('keydown', event => {
        const active      = document.activeElement;
        const isInput     = active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);
        const profilesOpen = el.profilesModal?.classList.contains('visible');
        const helpOpen     = el.helpModal?.classList.contains('visible');

        if (event.key === 'Escape') {
            if (profilesOpen) { currentConfiguringId ? switchToProfileListView() : closeProfilesModal(); }
            else if (helpOpen) closeHelpModal();
        }

        if (isInput && event.key !== 'Escape') return;

        if (event.key === '/') {
            event.preventDefault();
            el.searchInput?.focus();
            el.searchInput?.select();
        }

        if (event.ctrlKey && event.shiftKey) {
            switch (event.key.toUpperCase()) {
                case 'P': event.preventDefault(); openProfilesModal(); break;
                case 'A': event.preventDefault(); if (el.selectAllCheckbox && !el.selectAllCheckbox.disabled) el.selectAllCheckbox.click(); break;
                case 'F': event.preventDefault(); clearAllFilters(); el.searchInput?.focus(); break;
                case 'H': event.preventDefault(); openHelpModal(); break;
                case 'R': event.preventDefault(); refreshExtensionDataAndRender(getCurrentPage()); break;
            }
        }

        if (event.altKey) {
            if (event.key === 'ArrowRight' && !el.nextPageButton?.disabled) { event.preventDefault(); el.nextPageButton.click(); }
            if (event.key === 'ArrowLeft'  && !el.prevPageButton?.disabled) { event.preventDefault(); el.prevPageButton.click(); }
        }
    });

    await refreshExtensionDataAndRender(1);
    el.searchInput?.focus({ preventScroll: true });
    await registerKeyboardShortcuts();

    // Footer version
    const footerEl = document.getElementById('footer-info');
    if (footerEl) {
        const manifest = chrome.runtime.getManifest();
        footerEl.textContent = `Version ${manifest.version} | © ${new Date().getFullYear()} modcore. Made in Germany.`;
    }

    console.log('modcore EM Popup Initialized.');
}

document.addEventListener('DOMContentLoaded', initializePopup);