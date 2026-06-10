/**
 * popup.js – modcore Extension Manager
 */

'use strict';

// ─── Profile Module Imports ─────────────────────────────────────────────────
import {
    initProfiles,
    openProfilesModal,
    closeProfilesModal,
    applyProfile,
    populateBulkAssignMenu,
    registerKeyboardShortcuts,
    cleanupOrphanedProfileEntries,
    addExtensionToProfile,
    removeExtensionFromAllProfiles,
    refreshProfileViews,
    currentShortcuts,
    normalizeShortcut,
    switchToProfileListView,
    setupBulkAssignDropdown,
    loadProfileStore,
    getOrderedProfileIds
} from './profiles.js';

// ─── Constants ───────────────────────────────────────────────────────────────
export const PROFILES_STORAGE_KEY         = 'em_profiles';
export const SETTINGS_STORAGE_KEY         = 'em_settings';
export const DEFAULT_ICON_PLACEHOLDER     = '../../public/icons/svg/updatelogo.svg';
export const SHORTCUT_MODIFIER_KEYS       = ['Ctrl', 'Alt', 'Shift'];
export const VALID_SHORTCUT_KEYS          = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const DEFAULT_SETTINGS             = { compactMode: false, showExtensionIds: false, extensionOrder: [] };

export const ICON = {
    toggle:    '../../public/icons/svg/power.svg',
    details:   '../../public/icons/svg/info.svg',
    delete:    '../../public/icons/svg/trash.svg',
    add:       '../../public/icons/svg/plus.svg',
    profiles:  '../../public/icons/svg/profiles.svg',
    configure: '../../public/icons/svg/settings.svg',
    save:      '../../public/icons/svg/save.svg',
    duplicate: '../../public/icons/svg/copy.svg',
    current:   '../../public/icons/svg/current.svg',
    shortcut:  '../../public/icons/svg/keyboard.svg',
};

// ─── DOM cache ────────────────────────────────────────────────────────────────
export const el = {
    loadingIndicator:               document.getElementById('loading-indicator'),
    extensionList:                  document.getElementById('extension-list'),
    extensionListHeader:            document.getElementById('extension-list-header'),
    emptyState:                     document.getElementById('empty-state-message'),
    searchInput:                    document.getElementById('search-input'),
    typeFilter:                     document.getElementById('type-filter'),
    statusFilter:                   document.getElementById('status-filter'),
    filtersRow:                     document.getElementById('filters'),
    bulkActionsContainer:           document.getElementById('bulk-actions-container'),
    selectedCountSpan:              document.getElementById('selected-count'),
    bulkAssignActionButton:         document.getElementById('bulk-assign-action-btn'),
    bulkAssignDropdownMenu:         document.getElementById('bulk-assign-dropdown-menu'),
    bulkEnableButton:               document.getElementById('bulk-enable-button'),
    bulkDisableButton:              document.getElementById('bulk-disable-button'),
    selectAllCheckbox:              document.getElementById('select-all-checkbox'),
    profilesModal:                  document.getElementById('profiles-modal'),
    profilesModalTrigger:           document.getElementById('profiles-modal-trigger'),
    profilesModalCloseButton:       document.querySelector('#profiles-modal .modal-close-button'),
    modalNewProfileNameInput:       document.getElementById('modal-new-profile-name'),
    modalAddProfileButton:          document.getElementById('modal-add-profile-button'),
    createFromCurrentStateButton:   document.getElementById('create-from-current-state-button'),
    modalProfileListSection:        document.getElementById('modal-profile-list-section'),
    modalProfileList:               document.getElementById('modal-profile-management-list'),
    modalProfileCreationSection:    document.getElementById('modal-profile-creation'),
    profileConfigView:              document.getElementById('modal-profile-configuration-view'),
    profileConfigTitle:             document.getElementById('profile-config-title'),
    profileConfigNameInput:         document.getElementById('profile-config-name-input'),
    profileConfigShortcutInput:     document.getElementById('profile-config-shortcut-input'),
    profileConfigShortcutMessage:   document.getElementById('profile-config-shortcut-message'),
    profileConfigExtList:           document.getElementById('profile-config-extension-list'),
    saveProfileConfigBtn:           document.getElementById('save-profile-config-btn'),
    backToProfilesBtn:              document.getElementById('back-to-profiles-btn'),
    helpModal:                      document.getElementById('help-modal'),
    helpModalTrigger:               document.getElementById('help-modal-trigger'),
    helpModalCloseButton:           document.querySelector('#help-modal .modal-close-button'),
    settingsModal:                  document.getElementById('settings-modal'),
    settingsModalTrigger:           document.getElementById('settings-modal-trigger'),
    settingsModalCloseButton:       document.querySelector('#settings-modal .modal-close-button'),
    settingsCompactModeCheckbox:    document.getElementById('settings-compact-mode'),
    settingsShowIdsCheckbox:        document.getElementById('settings-show-ids'),
    settingsSaveButton:             document.getElementById('settings-save-btn'),
    settingsResetButton:            document.getElementById('settings-reset-btn'),
};

// ─── Session state ────────────────────────────────────────────────────────────
export let searchDebounceTimer       = null;
export let allFetchedExtensions      = [];
export let selectedExtensionIds      = new Set();
export let appSettings               = { ...DEFAULT_SETTINGS };
export let contextMenuEl             = null;
export let activeContextExtId        = null;
export let dialogResolve             = null;
export let dialogType                = null;
export let fuse                      = null;
export let clusterize                = null;
export let extensionSortable         = null;
export let clearFiltersFn            = null;

// ═════════════════════════════════════════════════════════════════════════════
// UTILITIES  (exported for profiles.js)
// ═════════════════════════════════════════════════════════════════════════════

export function sanitizeText(str) {
    if (str === null || str === undefined) return '';
    return String(str);
}

export function makeImg(src, alt = '', extraClass = '') {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.setAttribute('aria-hidden', 'true');
    if (extraClass) img.className = extraClass;
    return img;
}

export function makeButton({ className = '', title = '', icon = null, text = null, ariaLabel = null } = {}) {
    const btn = document.createElement('button');
    btn.className = className;
    if (title)     btn.title = title;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    if (icon)      btn.appendChild(makeImg(icon));
    if (text)      btn.appendChild(document.createTextNode(` ${text}`));
    return btn;
}

// ═════════════════════════════════════════════════════════════════════════════
// CUSTOM DIALOGS
// ═════════════════════════════════════════════════════════════════════════════

export function initCustomDialogs() {
    document.getElementById('custom-confirm-yes')?.addEventListener('click', () => closeCustomDialog(true));
    document.getElementById('custom-confirm-no')?.addEventListener('click', () => closeCustomDialog(false));
    document.getElementById('custom-confirm-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('custom-confirm-modal')) closeCustomDialog(false);
    });

    document.getElementById('custom-prompt-ok')?.addEventListener('click', () => {
        const input = document.getElementById('custom-prompt-input');
        closeCustomDialog(input?.value ?? '');
    });
    document.getElementById('custom-prompt-cancel')?.addEventListener('click', () => closeCustomDialog(null));
    document.getElementById('custom-prompt-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('custom-prompt-modal')) closeCustomDialog(null);
    });
    document.getElementById('custom-prompt-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); closeCustomDialog(e.target.value); }
        if (e.key === 'Escape') { e.preventDefault(); closeCustomDialog(null); }
    });
}

export function openCustomDialog(type, message, title, defaultValue = '') {
    dialogType = type;
    const modal = document.getElementById(type === 'confirm' ? 'custom-confirm-modal' : 'custom-prompt-modal');
    const msgEl = document.getElementById(type === 'confirm' ? 'custom-confirm-message' : 'custom-prompt-message');
    const titleEl = document.getElementById(type === 'confirm' ? 'custom-confirm-title' : 'custom-prompt-title');

    if (titleEl) titleEl.textContent = sanitizeText(title);
    if (msgEl) msgEl.textContent = sanitizeText(message);

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

export function closeCustomDialog(value) {
    const modal = document.getElementById(dialogType === 'confirm' ? 'custom-confirm-modal' : 'custom-prompt-modal');
    if (modal) {
        modal.classList.remove('visible');
        modal.setAttribute('aria-hidden', 'true');
        setTimeout(() => {
            if (!modal.classList.contains('visible')) modal.style.display = 'none';
        }, 200);
    }
    if (dialogResolve) {
        dialogResolve(value);
        dialogResolve = null;
    }
    dialogType = null;
}

export function showCustomConfirm(message, title = 'Confirm') {
    return openCustomDialog('confirm', message, title);
}

export function showCustomPrompt(message, defaultValue = '', title = 'Input Required') {
    return openCustomDialog('prompt', message, title, defaultValue);
}

// ═════════════════════════════════════════════════════════════════════════════
// LOADING
// ═════════════════════════════════════════════════════════════════════════════

export function showLoading() {
    if (el.loadingIndicator) {
        el.loadingIndicator.style.display = 'flex';
        el.loadingIndicator.setAttribute('aria-hidden', 'false');
    }
}
export function hideLoading() {
    if (el.loadingIndicator) {
        el.loadingIndicator.style.display = 'none';
        el.loadingIndicator.setAttribute('aria-hidden', 'true');
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═════════════════════════════════════════════════════════════════════════════

export async function loadSettings() {
    try {
        const data = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
        const raw = data[SETTINGS_STORAGE_KEY];
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            appSettings = { ...DEFAULT_SETTINGS, ...raw };
        } else {
            appSettings = { ...DEFAULT_SETTINGS };
        }
    } catch (e) {
        appSettings = { ...DEFAULT_SETTINGS };
    }
    applySettingsToUI();
}

export async function saveSettingsToStore(newSettings) {
    try {
        await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: newSettings });
        appSettings = { ...newSettings };
        applySettingsToUI();
        return true;
    } catch (e) {
        Status.error('Could not save settings.');
        return false;
    }
}

export function applySettingsToUI() {
    document.body.classList.toggle('compact-mode', !!appSettings.compactMode);
}

export function openSettingsModal() {
    if (!el.settingsModal) return;
    closeHelpModal();
    el.settingsModal.style.display = 'flex';
    el.settingsModal.setAttribute('aria-hidden', 'false');
    populateSettingsForm();
    requestAnimationFrame(() => {
        el.settingsModal.classList.add('visible');
        el.settingsModalCloseButton?.focus();
    });
}

export function closeSettingsModal() {
    if (!el.settingsModal) return;
    el.settingsModal.classList.remove('visible');
    el.settingsModal.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
        if (!el.settingsModal.classList.contains('visible')) el.settingsModal.style.display = 'none';
        el.settingsModalTrigger?.focus();
    }, 350);
}

export function populateSettingsForm() {
    if (el.settingsCompactModeCheckbox) el.settingsCompactModeCheckbox.checked = !!appSettings.compactMode;
    if (el.settingsShowIdsCheckbox) el.settingsShowIdsCheckbox.checked = !!appSettings.showExtensionIds;
}

export async function handleSettingsSave() {
    const newSettings = {
        compactMode: !!el.settingsCompactModeCheckbox?.checked,
        showExtensionIds: !!el.settingsShowIdsCheckbox?.checked,
        extensionOrder: appSettings.extensionOrder || [],
    };
    const saved = await saveSettingsToStore(newSettings);
    if (!saved) return;
    Status.success('Settings saved.');
    await refreshExtensionDataAndRender();
    closeSettingsModal();
}

export function handleSettingsReset() {
    populateSettingsForm();
    Status.info('Form reset to saved values.');
}

// ═════════════════════════════════════════════════════════════════════════════
// EXTENSION DATA
// ═════════════════════════════════════════════════════════════════════════════

export function fetchAllExtensions() {
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

function rebuildFuse(extensions) {
    fuse = new Fuse(extensions, {
        keys: ['_searchName', '_searchDesc', '_searchId'],
        threshold: 0.3,
        includeScore: false
    });
}

export async function filterAndSortExtensions(extensions) {
    const search = (el.searchInput?.value ?? '').toLowerCase().trim();
    const typeVal = el.typeFilter?.value ?? 'all';
    const statusVal = el.statusFilter?.value ?? 'all';

    let filtered = [];
    for (const ext of extensions) {
        if (typeVal !== 'all') {
            const extType = ext.isApp ? 'app' : (ext.type || 'extension');
            if (typeVal === 'extension' && !['extension', 'packaged_app'].includes(extType)) continue;
            if (typeVal === 'theme' && extType !== 'theme') continue;
        }
        if (statusVal === 'enabled' && !ext.enabled) continue;
        if (statusVal === 'disabled' && ext.enabled) continue;
        filtered.push(ext);
    }

    if (search.length > 0 && fuse) {
        const results = fuse.search(search);
        filtered = results.map(r => r.item);
    }

    const orderMap = new Map((appSettings.extensionOrder || []).map((id, idx) => [id, idx]));
    filtered.sort((a, b) => {
        const oa = orderMap.get(a.id);
        const ob = orderMap.get(b.id);
        if (oa !== undefined && ob !== undefined) return oa - ob;
        if (oa !== undefined) return -1;
        if (ob !== undefined) return 1;
        return a._searchName.localeCompare(b._searchName, undefined, { sensitivity: 'base' });
    });

    return filtered;
}

// ═════════════════════════════════════════════════════════════════════════════
// EXTENSION LIST RENDERING  (Clusterize + real-DOM bulk mode)
// ═════════════════════════════════════════════════════════════════════════════

function getExtensionRowHTML(ext) {
    const isSelected = selectedExtensionIds.has(ext.id);
    const bestIcon = ext.icons?.sort((a, b) => b.size - a.size)[0];
    const iconUrl = bestIcon?.url ?? DEFAULT_ICON_PLACEHOLDER;
    const dragDisplay = selectedExtensionIds.size > 0 ? 'inline-flex' : 'none';
    const idHtml = (appSettings.showExtensionIds && ext.id) ? `<span class="extension-id-display">${ext.id}</span>` : '';

    return `
    <div class="extension-item ${isSelected ? 'selected' : ''}" data-extension-id="${ext.id}" role="listitem" aria-selected="${isSelected}">
        <button class="drag-handle" data-extension-id="${ext.id}" title="Drag to reorder" aria-label="Drag to reorder" style="display:${dragDisplay}">⋮⋮</button>
        <input type="checkbox" class="extension-select-checkbox" data-extension-id="${ext.id}" ${isSelected ? 'checked' : ''} aria-label="Select ${sanitizeText(ext.name)}">
        <img src="${iconUrl}" alt="" class="extension-icon" loading="lazy" onerror="if(this.src!=='${DEFAULT_ICON_PLACEHOLDER}'){this.src='${DEFAULT_ICON_PLACEHOLDER}';this.onerror=null;}">
        <div class="extension-details">
            <span class="extension-name" title="${sanitizeText(ext.name)}">${sanitizeText(ext.name)}</span>
            ${idHtml}
        </div>
        <div class="extension-actions">
            <button class="toggle-button button-small ${ext.enabled ? 'button-danger' : 'button-success'}" data-action="toggle" data-extension-id="${ext.id}" data-current-state="${ext.enabled ? 'enabled' : 'disabled'}" aria-pressed="${ext.enabled}" title="${ext.enabled ? 'Disable' : 'Enable'} ${sanitizeText(ext.name)}">
                <img src="${ICON.toggle}" alt="" aria-hidden="true"> ${ext.enabled ? 'Disable' : 'Enable'}
            </button>
            <button class="details-button button-small icon-only" data-action="details" data-extension-id="${ext.id}" title="View details for ${sanitizeText(ext.name)}">
                <img src="${ICON.details}" alt="" aria-hidden="true">
            </button>
            <button class="delete-button button-small button-danger icon-only" data-action="delete" data-extension-id="${ext.id}" data-extension-name="${sanitizeText(ext.name)}" title="Uninstall ${sanitizeText(ext.name)}">
                <img src="${ICON.delete}" alt="" aria-hidden="true">
            </button>
        </div>
    </div>`;
}

function buildExtensionRow(ext) {
    const item = document.createElement('div');
    item.className = 'extension-item';
    if (selectedExtensionIds.has(ext.id)) item.classList.add('selected');
    item.dataset.extensionId = ext.id;
    item.setAttribute('role', 'listitem');
    item.setAttribute('aria-selected', String(selectedExtensionIds.has(ext.id)));

    const dragHandle = document.createElement('button');
    dragHandle.className = 'drag-handle';
    dragHandle.dataset.extensionId = ext.id;
    dragHandle.title = 'Drag to reorder';
    dragHandle.setAttribute('aria-label', 'Drag to reorder');
    dragHandle.textContent = '⋮⋮';
    dragHandle.style.display = selectedExtensionIds.size > 0 ? 'inline-flex' : 'none';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'extension-select-checkbox';
    cb.dataset.extensionId = ext.id;
    cb.checked = selectedExtensionIds.has(ext.id);
    cb.setAttribute('aria-label', `Select ${sanitizeText(ext.name)}`);

    const bestIcon = ext.icons?.sort((a, b) => b.size - a.size)[0];
    const iconImg = makeImg(bestIcon?.url ?? DEFAULT_ICON_PLACEHOLDER, '', 'extension-icon');
    iconImg.loading = 'lazy';
    iconImg.onerror = () => { if (iconImg.src !== DEFAULT_ICON_PLACEHOLDER) iconImg.src = DEFAULT_ICON_PLACEHOLDER; iconImg.onerror = null; };

    const details = document.createElement('div');
    details.className = 'extension-details';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'extension-name';
    nameSpan.title = sanitizeText(ext.name);
    nameSpan.textContent = sanitizeText(ext.name);
    details.appendChild(nameSpan);

    if (appSettings.showExtensionIds && ext.id) {
        const idSpan = document.createElement('span');
        idSpan.className = 'extension-id-display';
        idSpan.textContent = ext.id;
        details.appendChild(idSpan);
    }

    const actions = document.createElement('div');
    actions.className = 'extension-actions';

    const toggleBtn = makeButton({
        className: `toggle-button button-small ${ext.enabled ? 'button-danger' : 'button-success'}`,
        title: `${ext.enabled ? 'Disable' : 'Enable'} ${sanitizeText(ext.name)}`,
        icon: ICON.toggle,
        text: ext.enabled ? 'Disable' : 'Enable',
    });
    toggleBtn.dataset.action = 'toggle';
    toggleBtn.dataset.extensionId = ext.id;
    toggleBtn.dataset.currentState = ext.enabled ? 'enabled' : 'disabled';
    toggleBtn.setAttribute('aria-pressed', String(ext.enabled));

    const detailsBtn = makeButton({
        className: 'details-button button-small icon-only',
        title: `View details for ${sanitizeText(ext.name)}`,
        icon: ICON.details,
    });
    detailsBtn.dataset.action = 'details';
    detailsBtn.dataset.extensionId = ext.id;

    const deleteBtn = makeButton({
        className: 'delete-button button-small button-danger icon-only',
        title: `Uninstall ${sanitizeText(ext.name)}`,
        icon: ICON.delete,
    });
    deleteBtn.dataset.action = 'delete';
    deleteBtn.dataset.extensionId = ext.id;
    deleteBtn.dataset.extensionName = sanitizeText(ext.name);

    actions.appendChild(toggleBtn);
    actions.appendChild(detailsBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(dragHandle);
    item.appendChild(cb);
    item.appendChild(iconImg);
    item.appendChild(details);
    item.appendChild(actions);

    return item;
}

function initExtensionSortable() {
    if (extensionSortable) {
        extensionSortable.destroy();
        extensionSortable = null;
    }
    if (selectedExtensionIds.size === 0) return;

    extensionSortable = new Sortable(el.extensionList, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        forceFallback: true,
        onEnd: async (evt) => {
            const items = el.extensionList.querySelectorAll('.extension-item');
            const visibleOrder = Array.from(items).map(item => item.dataset.extensionId);

            const fullOrder = appSettings.extensionOrder || [];
            const visibleSet = new Set(visibleOrder);
            const remaining = fullOrder.filter(id => !visibleSet.has(id));

            const knownSet = new Set([...fullOrder, ...visibleOrder]);
            const extra = allFetchedExtensions.map(e => e.id).filter(id => !knownSet.has(id));

            const newOrder = [...visibleOrder, ...remaining, ...extra];
            appSettings.extensionOrder = newOrder;
            await saveSettingsToStore(appSettings);
            Status.success('Extension order saved.');

            const orderMap = new Map(newOrder.map((id, idx) => [id, idx]));
            allFetchedExtensions.sort((a, b) => {
                const oa = orderMap.get(a.id);
                const ob = orderMap.get(b.id);
                if (oa !== undefined && ob !== undefined) return oa - ob;
                if (oa !== undefined) return -1;
                if (ob !== undefined) return 1;
                return 0;
            });
        }
    });
}

export async function renderExtensionList() {
    try {
        if (!el.extensionList) { hideLoading(); return; }

        const filteredExtensions = await filterAndSortExtensions(allFetchedExtensions);
        const total = filteredExtensions.length;
        const bulkMode = selectedExtensionIds.size > 0;

        if (total === 0) {
            if (el.extensionListHeader) el.extensionListHeader.style.display = 'none';
            if (el.emptyState) {
                el.emptyState.style.display = 'block';
                const p1 = document.createElement('p');
                p1.textContent = 'No extensions match your criteria.';
                el.emptyState.replaceChildren(p1);
                if (el.searchInput?.value.trim() || el.typeFilter?.value !== 'all' || el.statusFilter?.value !== 'all') {
                    const p2 = document.createElement('p');
                    p2.textContent = 'Try clearing your search or adjusting filters.';
                    el.emptyState.appendChild(p2);
                }
            }
            if (clusterize) {
                clusterize.destroy();
                clusterize = null;
            }
            el.extensionList.replaceChildren();
            el.extensionList.style.display = 'none';
            hideLoading();
            updateSelectAllCheckboxState();
            updateBulkActionsUI();
            return;
        }

        if (el.extensionListHeader) el.extensionListHeader.style.display = 'flex';
        el.emptyState.style.display = 'none';
        el.extensionList.style.display = '';

        if (bulkMode) {
            if (clusterize) {
                clusterize.destroy();
                clusterize = null;
            }
            if (extensionSortable) {
                extensionSortable.destroy();
                extensionSortable = null;
            }
            const frag = document.createDocumentFragment();
            for (const ext of filteredExtensions) {
                frag.appendChild(buildExtensionRow(ext));
            }
            el.extensionList.replaceChildren(frag);
            initExtensionSortable();
        } else {
            if (extensionSortable) {
                extensionSortable.destroy();
                extensionSortable = null;
            }
            const rows = filteredExtensions.map(ext => getExtensionRowHTML(ext));
            if (!clusterize) {
                clusterize = new Clusterize({
                    rows,
                    scrollElem: document.querySelector('.popup-container'),
                    contentElem: el.extensionList,
                    rows_in_block: 16,
                    blocks_in_cluster: 4,
                    show_no_data_row: false
                });
            } else {
                clusterize.update(rows);
            }
        }

        hideLoading();
        updateSelectAllCheckboxState();
        updateBulkActionsUI();
    } catch (e) {
        hideLoading();
        console.error('renderExtensionList error:', e);
        Status.error('Error rendering extension list.');
    }
}

export async function refreshExtensionDataAndRender() {
    showLoading();
    try {
        allFetchedExtensions = await fetchAllExtensions();
        for (const ext of allFetchedExtensions) {
            ext._searchName = (ext.name ?? '').toLowerCase();
            ext._searchDesc = (ext.description ?? '').toLowerCase();
            ext._searchId = (ext.id ?? '').toLowerCase();
        }
        rebuildFuse(allFetchedExtensions);
        await cleanupOrphanedProfileEntries();
        await renderExtensionList();
    } catch (e) {
        hideLoading();
        Status.bar(`Error fetching extensions: ${e?.message ?? 'Unknown error'}`);
        console.error('Extension fetch/render error:', e);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// EXTENSION ACTION DELEGATION
// ═════════════════════════════════════════════════════════════════════════════

export function handleExtensionListClick(event) {
    if (event.button === 2) return;
    const target = event.target;

    if (target.classList.contains('extension-select-checkbox')) {
        const id = target.dataset.extensionId;
        const item = target.closest('.extension-item');
        if (target.checked) { selectedExtensionIds.add(id); item?.classList.add('selected'); }
        else { selectedExtensionIds.delete(id); item?.classList.remove('selected'); }
        updateBulkActionsUI();
        updateSelectAllCheckboxState();
        renderExtensionList();
        return;
    }

    const btn = target.closest('button[data-action]');
    if (!btn) return;
    const { action, extensionId, currentState, extensionName } = btn.dataset;
    if (!extensionId) return;

    switch (action) {
        case 'toggle': toggleExtension(extensionId, currentState === 'disabled', btn); break;
        case 'details': openDetailsPage(extensionId); break;
        case 'delete': confirmAndDeleteExtension(extensionId, extensionName || 'this extension'); break;
    }
}

export function toggleExtension(extensionId, enable, buttonElement) {
    showLoading();
    chrome.management.setEnabled(extensionId, enable, async () => {
        hideLoading();
        if (chrome.runtime.lastError) {
            Status.error(`Error: ${chrome.runtime.lastError.message}`);
            return;
        }
        Status.success(`Extension ${enable ? 'enabled' : 'disabled'}.`, 2000);

        const cached = allFetchedExtensions.find(e => e.id === extensionId);
        if (cached) cached.enabled = enable;

        if (el.statusFilter?.value !== 'all') {
            await refreshExtensionDataAndRender();
        } else {
            const item = el.extensionList?.querySelector(`.extension-item[data-extension-id="${extensionId}"]`);
            const btn = buttonElement || item?.querySelector('.toggle-button');
            if (item && btn && cached) {
                btn.dataset.currentState = enable ? 'enabled' : 'disabled';
                btn.replaceChildren(makeImg(ICON.toggle), document.createTextNode(` ${enable ? 'Disable' : 'Enable'}`));
                btn.title = `${enable ? 'Disable' : 'Enable'} ${sanitizeText(cached.name)}`;
                btn.setAttribute('aria-pressed', String(enable));
                btn.classList.toggle('button-danger', enable);
                btn.classList.toggle('button-success', !enable);
            } else {
                await renderExtensionList();
            }
        }
    });
}

export function openDetailsPage(extensionId) {
    chrome.tabs.create({ url: `src/html/details.html?id=${extensionId}` });
}

export async function confirmAndDeleteExtension(extensionId, extensionName) {
    const confirmed = await showCustomConfirm(
        `Uninstall "${sanitizeText(extensionName)}"?\n\nThis cannot be undone.`,
        'Uninstall Extension'
    );
    if (confirmed) {
        uninstallExtension(extensionId, sanitizeText(extensionName));
    }
}

export function uninstallExtension(extensionId, safeName) {
    showLoading();
    chrome.management.uninstall(extensionId, { showConfirmDialog: false }, async () => {
        hideLoading();
        if (chrome.runtime.lastError) {
            Status.error(`Error uninstalling "${safeName}": ${chrome.runtime.lastError.message}`);
        } else {
            Status.success(`"${safeName}" uninstalled.`);
            selectedExtensionIds.delete(extensionId);
            await refreshExtensionDataAndRender();
            await refreshProfileViews();
            await registerKeyboardShortcuts();
        }
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// BULK ACTIONS
// ═════════════════════════════════════════════════════════════════════════════

export function updateBulkActionsUI() {
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

export function updateSelectAllCheckboxState() {
    if (!el.selectAllCheckbox) return;
    const cbs = [...(el.extensionList?.querySelectorAll('.extension-select-checkbox') ?? [])];
    if (!cbs.length) {
        el.selectAllCheckbox.checked = false;
        el.selectAllCheckbox.indeterminate = false;
        el.selectAllCheckbox.disabled = true;
        return;
    }
    el.selectAllCheckbox.disabled = false;
    const allSel = cbs.every(cb => cb.checked);
    const someSel = cbs.some(cb => cb.checked);
    el.selectAllCheckbox.checked = allSel;
    el.selectAllCheckbox.indeterminate = !allSel && someSel;
}

export function handleSelectAllChange(event) {
    const checked = event.target.checked;
    el.extensionList?.querySelectorAll('.extension-select-checkbox').forEach(cb => {
        cb.checked = checked;
        const id = cb.dataset.extensionId;
        const item = cb.closest('.extension-item');
        if (checked) { selectedExtensionIds.add(id); item?.classList.add('selected'); }
        else { selectedExtensionIds.delete(id); item?.classList.remove('selected'); }
    });
    updateBulkActionsUI();
    updateSelectAllCheckboxState();
    renderExtensionList();
}

export function clearSelection() {
    selectedExtensionIds.clear();
    el.extensionList?.querySelectorAll('.extension-item.selected').forEach(item => {
        item.classList.remove('selected');
        const cb = item.querySelector('.extension-select-checkbox');
        if (cb) cb.checked = false;
    });
    updateBulkActionsUI();
    updateSelectAllCheckboxState();
    toggleBulkAssignMenu(false);
    renderExtensionList();
}

export async function performBulkAction(action) {
    const ids = new Set(selectedExtensionIds);
    if (ids.size === 0) return;

    const enable = action === 'enable';

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
    if (errors) Status.error(`Done with errors. ${success} ${action}d, ${errors} failed.`);
    else if (success) Status.success(`${success} extension(s) ${action}d.`);

    clearSelection();
    await refreshExtensionDataAndRender();
}

// ─── Bulk assign dropdown toggle ─────────────────────────────────────────────

export function toggleBulkAssignMenu(show) {
    const menu = el.bulkAssignDropdownMenu;
    const btn = el.bulkAssignActionButton;
    if (!menu || !btn) return;
    if (show) {
        menu.classList.add('visible');
        btn.setAttribute('aria-expanded', 'true');
    } else {
        menu.classList.remove('visible');
        btn.setAttribute('aria-expanded', 'false');
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// CONTEXT MENU
// ═════════════════════════════════════════════════════════════════════════════

export function createContextMenu() {
    if (document.getElementById('custom-context-menu')) {
        contextMenuEl = document.getElementById('custom-context-menu');
        return;
    }
    contextMenuEl = document.createElement('div');
    contextMenuEl.id = 'custom-context-menu';
    contextMenuEl.className = 'custom-context-menu';
    document.body.appendChild(contextMenuEl);
}

export function hideContextMenu() {
    contextMenuEl?.classList.remove('visible');
    contextMenuEl?.removeEventListener('keydown', handleContextMenuKeyDown);
    activeContextExtId = null;
}

export function handleContextMenuKeyDown(event) {
    const items = [...contextMenuEl.querySelectorAll('.context-menu-item:not([style*="display: none"]):not(.context-menu-separator)')];
    if (!items.length) return;
    const focused = document.activeElement;
    const inside = contextMenuEl.contains(focused);
    let newIdx = -1;

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

export async function showContextMenu(extensionId, event) {
    event.preventDefault();
    event.stopPropagation();
    activeContextExtId = extensionId;

    const extension = allFetchedExtensions.find(e => e.id === extensionId);
    if (!extension) return;

    contextMenuEl.replaceChildren();
    const frag = document.createDocumentFragment();

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

    const info = document.createElement('div');
    info.className = 'context-menu-info';
    const strong = document.createElement('strong');
    strong.textContent = sanitizeText(extension.name);
    const verSpan = document.createElement('span');
    verSpan.textContent = `Version: ${sanitizeText(extension.version)}`;
    info.appendChild(strong);
    info.appendChild(verSpan);
    frag.appendChild(info);
    frag.appendChild(Object.assign(document.createElement('hr'), { className: 'context-menu-separator' }));

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
            li.title = sanitizeText(p.name);
            li.className = 'context-menu-item-name';
            ul.appendChild(li);
        });
        mem.appendChild(ul);
        frag.appendChild(mem);
        frag.appendChild(Object.assign(document.createElement('hr'), { className: 'context-menu-separator' }));
    }

    frag.appendChild(makeItem('View Details', ICON.details, () => openDetailsPage(extensionId)));

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
        ph.className = 'context-menu-placeholder';
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
            if (chrome.runtime.lastError) { Status.error(chrome.runtime.lastError.message); return; }
            chrome.tabs.create({ url: ext?.optionsUrl || `chrome://extensions/?id=${extensionId}` });
            if (!ext?.optionsUrl) Status.info('No dedicated Options page; opened extension details.');
        });
    }));
    frag.appendChild(makeItem('Uninstall', ICON.delete, () => confirmAndDeleteExtension(extensionId, extension.name), true));

    contextMenuEl.appendChild(frag);

    const { clientX: mx, clientY: my } = event;
    contextMenuEl.style.top = `${Math.min(my, window.innerHeight - contextMenuEl.offsetHeight - 5)}px`;
    contextMenuEl.style.left = `${Math.min(mx, window.innerWidth - contextMenuEl.offsetWidth - 5)}px`;
    contextMenuEl.classList.add('visible');
    contextMenuEl.addEventListener('keydown', handleContextMenuKeyDown);
    contextMenuEl.querySelector('.context-menu-item')?.focus();
}

// ═════════════════════════════════════════════════════════════════════════════
// FILTERS & SEARCH
// ═════════════════════════════════════════════════════════════════════════════

export async function setupFiltersAndSearch() {
    async function handleFilterChange() {
        clearSelection();
        await renderExtensionList();
        updateClearFiltersVisibility();
    }

    function createClearFiltersButton() {
        if (document.getElementById('clear-filters-btn')) return;
        const clearFiltersBtn = document.createElement('button');
        clearFiltersBtn.id = 'clear-filters-btn';
        clearFiltersBtn.className = 'button-small';
        clearFiltersBtn.textContent = 'Clear Filters';
        clearFiltersBtn.title = 'Reset all search and filter options (Ctrl+Shift+F)';
        clearFiltersBtn.style.display = 'none';
        el.filtersRow?.appendChild(clearFiltersBtn);
        clearFiltersBtn.addEventListener('click', clearAllFiltersLocal);
    }

    function updateClearFiltersVisibility() {
        const btn = document.getElementById('clear-filters-btn');
        if (!btn) return;
        const active = el.searchInput?.value.trim() || el.typeFilter?.value !== 'all' || el.statusFilter?.value !== 'all';
        btn.style.display = active ? 'inline-flex' : 'none';
    }

    async function clearAllFiltersLocal() {
        if (el.searchInput) el.searchInput.value = '';
        if (el.typeFilter) el.typeFilter.value = 'all';
        if (el.statusFilter) el.statusFilter.value = 'all';
        await handleFilterChange();
    }

    createClearFiltersButton();
    updateClearFiltersVisibility();
    clearFiltersFn = clearAllFiltersLocal;

    el.typeFilter?.addEventListener('change', handleFilterChange);
    el.statusFilter?.addEventListener('change', handleFilterChange);
    el.searchInput?.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(handleFilterChange, 150);
    });

    return { clearAllFilters: clearAllFiltersLocal };
}

export function clearAllFilters() {
    if (clearFiltersFn) clearFiltersFn();
}

// ═════════════════════════════════════════════════════════════════════════════
// HELP MODAL
// ═════════════════════════════════════════════════════════════════════════════

export function openHelpModal() {
    if (!el.helpModal) return;
    el.helpModal.style.display = 'flex';
    el.helpModal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
        el.helpModal.classList.add('visible');
        el.helpModalCloseButton?.focus();
    });
}

export function closeHelpModal() {
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

export function setupModalListeners() {
    el.profilesModalTrigger?.addEventListener('click', openProfilesModal);

    el.helpModalTrigger?.addEventListener('click', openHelpModal);
    el.helpModalCloseButton?.addEventListener('click', closeHelpModal);
    el.helpModal?.addEventListener('click', e => { if (e.target === el.helpModal) closeHelpModal(); });

    el.settingsModalTrigger?.addEventListener('click', openSettingsModal);
    el.settingsModalCloseButton?.addEventListener('click', closeSettingsModal);
    el.settingsModal?.addEventListener('click', e => { if (e.target === el.settingsModal) closeSettingsModal(); });
    el.settingsSaveButton?.addEventListener('click', handleSettingsSave);
    el.settingsResetButton?.addEventListener('click', handleSettingsReset);
}

export function setupBulkActionListeners() {
    el.selectAllCheckbox?.addEventListener('change', handleSelectAllChange);
    el.bulkEnableButton?.addEventListener('click', () => performBulkAction('enable'));
    el.bulkDisableButton?.addEventListener('click', () => performBulkAction('disable'));

    document.addEventListener('click', event => {
        const menu = el.bulkAssignDropdownMenu;
        const btn = el.bulkAssignActionButton;
        if (!menu?.contains(event.target) && !btn?.contains(event.target)) {
            if (menu?.classList.contains('visible')) toggleBulkAssignMenu(false);
        }
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═════════════════════════════════════════════════════════════════════════════

export function handleGlobalKeydown(event) {
    const active = document.activeElement;
    const isInput = active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);
    const profilesOpen = el.profilesModal?.classList.contains('visible');
    const helpOpen = el.helpModal?.classList.contains('visible');
    const settingsOpen = el.settingsModal?.classList.contains('visible');
    const anyModalOpen = profilesOpen || helpOpen || settingsOpen;

    if (event.key === 'Escape') {
        if (settingsOpen) { closeSettingsModal(); return; }
        if (profilesOpen) { currentConfiguringId ? switchToProfileListView() : closeProfilesModal(); return; }
        if (helpOpen) { closeHelpModal(); return; }
        if (contextMenuEl?.classList.contains('visible')) { hideContextMenu(); return; }
        if (isInput && !anyModalOpen) { active.blur(); return; }
    }

    if (!isInput) {
        const pressed = [];
        if (event.ctrlKey) pressed.push('Ctrl');
        if (event.altKey) pressed.push('Alt');
        if (event.shiftKey) pressed.push('Shift');
        pressed.push(event.key.toUpperCase());
        const normalized = normalizeShortcut(pressed.join('+'));
        if (normalized && currentShortcuts.has(normalized)) {
            event.preventDefault();
            applyProfile(currentShortcuts.get(normalized)).then(() => window.close());
            return;
        }
    }

    if (isInput) return;

    if (event.key === '/') {
        event.preventDefault();
        el.searchInput?.focus();
        el.searchInput?.select();
        return;
    }

    if (event.ctrlKey && event.shiftKey) {
        switch (event.key.toUpperCase()) {
            case 'P': event.preventDefault(); openProfilesModal(); break;
            case 'A': event.preventDefault(); if (el.selectAllCheckbox && !el.selectAllCheckbox.disabled) el.selectAllCheckbox.click(); break;
            case 'F': event.preventDefault(); clearAllFilters(); el.searchInput?.focus(); break;
            case 'H': event.preventDefault(); openHelpModal(); break;
            case 'R': event.preventDefault(); refreshExtensionDataAndRender(); break;
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═════════════════════════════════════════════════════════════════════════════

export async function initializePopup() {
    try {
        createContextMenu();
        initCustomDialogs();
        await loadSettings();
        await setupFiltersAndSearch();
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

        document.addEventListener('keydown', handleGlobalKeydown);

        await refreshExtensionDataAndRender();
        el.searchInput?.focus({ preventScroll: true });

        setTimeout(() => registerKeyboardShortcuts().catch(console.error), 0);

        const footerEl = document.getElementById('footer-info');
        if (footerEl) {
            try {
                const manifest = chrome.runtime.getManifest();
                footerEl.textContent = `Version ${manifest?.version ?? '?'} | © ${new Date().getFullYear()} modcore. Made in Germany.`;
            } catch (e) {
                footerEl.textContent = `© ${new Date().getFullYear()} modcore. Made in Germany.`;
            }
        }

        await initProfiles();
        await populateBulkAssignMenu();
    } catch (e) {
        console.error('Initialization error:', e);
        Status.error('Failed to initialize popup. Please reload.', 10000);
        hideLoading();
    }
}

document.addEventListener('DOMContentLoaded', initializePopup);