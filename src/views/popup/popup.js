/**
 * popup.js – modcore Extension Manager (Popup)
 */

'use strict';

import {
    applyProfile,
    registerKeyboardShortcuts,
    cleanupOrphanedProfileEntries,
    removeExtensionsFromAllProfiles,
    assignExtensionsToProfile,
    currentShortcuts,
    normalizeShortcut,
    loadProfileStore,
    getOrderedProfileIds
} from '../../shared/js/profiles.js';

// ─── Constants ───────────────────────────────────────────────────────────────
export const DEFAULT_ICON_PLACEHOLDER     = '../../../public/icons/svg/updatelogo.svg';

export const ICON = Object.freeze({
    toggle:    '../../../public/icons/svg/power.svg',
    details:   '../../../public/icons/svg/info.svg',
    delete:    '../../../public/icons/svg/trash.svg',
    add:       '../../../public/icons/svg/plus.svg',
    profiles:  '../../../public/icons/svg/profiles.svg',
    configure: '../../../public/icons/svg/settings.svg',
    save:      '../../../public/icons/svg/save.svg',
    duplicate: '../../../public/icons/svg/copy.svg',
    current:   '../../../public/icons/svg/current.svg',
    shortcut:  '../../../public/icons/svg/keyboard.svg',
});


// Safe Status fallback so the popup never hard-crashes if the external status script fails
const Status = /*@__PURE__*/ (() => {
    if (typeof window !== 'undefined' && window.Status) return window.Status;
    const noop = () => {};
    return { success: noop, error: noop, info: noop, bar: noop };
})();

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
    helpModal:                      document.getElementById('help-modal'),
    helpModalTrigger:               document.getElementById('help-modal-trigger'),
    helpModalCloseButton:           document.querySelector('#help-modal .modal-close-button'),
};

// ─── Session state ────────────────────────────────────────────────────────────
let searchDebounceTimer       = null;
export let allFetchedExtensions      = [];
export let extensionMap              = new Map();
export let selectedExtensionIds      = new Set();
let dialogResolve             = null;
let dialogType                = null;
let fuse                      = null;
let clearFiltersFn            = null;
let bulkAssignFuse            = null;

// ═════════════════════════════════════════════════════════════════════════════
// UTILITIES
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
    document.getElementById('custom-confirm-modal')?.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); closeCustomDialog(false); }
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

    filtered.sort((a, b) => a._searchName.localeCompare(b._searchName, undefined, { sensitivity: 'base' }));

    return filtered;
}

// ═════════════════════════════════════════════════════════════════════════════
// EXTENSION LIST RENDERING
// ═════════════════════════════════════════════════════════════════════════════

function buildExtensionRow(ext) {
    const item = document.createElement('div');
    item.className = 'extension-item';
    if (selectedExtensionIds.has(ext.id)) item.classList.add('selected');
    item.dataset.extensionId = ext.id;
    item.setAttribute('role', 'listitem');
    item.setAttribute('aria-selected', String(selectedExtensionIds.has(ext.id)));

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'extension-select-checkbox';
    cb.dataset.extensionId = ext.id;
    cb.checked = selectedExtensionIds.has(ext.id);
    cb.setAttribute('aria-label', `Select ${sanitizeText(ext.name)}`);

    const bestIcon = ext.icons ? [...ext.icons].sort((a, b) => b.size - a.size)[0] : null;
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

    item.appendChild(cb);
    item.appendChild(iconImg);
    item.appendChild(details);
    item.appendChild(actions);

    return item;
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
                el.emptyState.replaceChildren();
                const p1 = document.createElement('p');
                p1.textContent = 'No extensions match your criteria.';
                el.emptyState.appendChild(p1);
                if (el.searchInput?.value.trim() || el.typeFilter?.value !== 'all' || el.statusFilter?.value !== 'all') {
                    const p2 = document.createElement('p');
                    p2.textContent = 'Try clearing your search or adjusting filters.';
                    el.emptyState.appendChild(p2);
                }
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

        const frag = document.createDocumentFragment();
        for (const ext of filteredExtensions) {
            frag.appendChild(buildExtensionRow(ext));
        }
        el.extensionList.replaceChildren(frag);

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
        extensionMap.clear();
        for (const ext of allFetchedExtensions) {
            ext._searchName = (ext.name ?? '').toLowerCase();
            ext._searchDesc = (ext.description ?? '').toLowerCase();
            ext._searchId = (ext.id ?? '').toLowerCase();
            extensionMap.set(ext.id, ext);
        }
        rebuildFuse(allFetchedExtensions);
        await cleanupOrphanedProfileEntries(new Set(allFetchedExtensions.map(e => e.id)));
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
    const target = event.target;

    if (target.classList.contains('extension-select-checkbox')) {
        const id = target.dataset.extensionId;
        const item = target.closest('.extension-item');
        if (target.checked) { selectedExtensionIds.add(id); item?.classList.add('selected'); }
        else { selectedExtensionIds.delete(id); item?.classList.remove('selected'); }
        updateBulkActionsUI();
        updateSelectAllCheckboxState();

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
        try {
            hideLoading();
            if (chrome.runtime.lastError) {
                Status.error(`Error: ${chrome.runtime.lastError.message}`);
                return;
            }
            Status.success(`Extension ${enable ? 'enabled' : 'disabled'}.`, 2000);

            const ext = extensionMap.get(extensionId);
            if (ext) ext.enabled = enable;

            const statusFilter = el.statusFilter?.value ?? 'all';
            if (statusFilter !== 'all') {
                await refreshExtensionDataAndRender();
            } else {
                const item = el.extensionList?.querySelector(`.extension-item[data-extension-id="${extensionId}"]`);
                const btn = buttonElement || item?.querySelector('.toggle-button');
                if (item && btn && ext) {
                    btn.dataset.currentState = enable ? 'enabled' : 'disabled';
                    btn.replaceChildren(makeImg(ICON.toggle), document.createTextNode(` ${enable ? 'Disable' : 'Enable'}`));
                    btn.title = `${enable ? 'Disable' : 'Enable'} ${sanitizeText(ext.name)}`;
                    btn.setAttribute('aria-pressed', String(enable));
                    btn.className = `toggle-button button-small ${enable ? 'button-danger' : 'button-success'}`;
                } else {
                    await renderExtensionList();
                }
            }
        } catch (e) {
            hideLoading();
            console.error('toggleExtension error:', e);
            Status.error('Unexpected error toggling extension.');
        }
    });
}

export function openDetailsPage(extensionId) {
    try {
        const url = new URL('../safety-center/safety-center.html', window.location.href);
        url.searchParams.set('id', extensionId);
        chrome.tabs.create({ url: url.href });
    } catch (e) {
        console.error('openDetailsPage error:', e);
        Status.error('Failed to open details page.');
    }
}

export async function confirmAndDeleteExtension(extensionId, extensionName) {
    const confirmed = await showCustomConfirm(
        `Uninstall "${extensionName}"?\n\nThis cannot be undone.`,
        'Uninstall Extension'
    );
    if (confirmed) {
        uninstallExtension(extensionId, sanitizeText(extensionName));
    }
}

export function uninstallExtension(extensionId, safeName) {
    showLoading();
    chrome.management.uninstall(extensionId, { showConfirmDialog: false }, async () => {
        try {
            hideLoading();
            if (chrome.runtime.lastError) {
                Status.error(`Error uninstalling "${safeName}": ${chrome.runtime.lastError.message}`);
            } else {
                Status.success(`"${safeName}" uninstalled.`);
                selectedExtensionIds.delete(extensionId);
                await refreshExtensionDataAndRender();
                await registerKeyboardShortcuts();
            }
        } catch (e) {
            hideLoading();
            console.error('uninstallExtension error:', e);
            Status.error('Unexpected error during uninstall.');
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
    const cbs = el.extensionList?.querySelectorAll('.extension-select-checkbox');
    const total = cbs?.length ?? 0;
    if (!total) {
        el.selectAllCheckbox.checked = false;
        el.selectAllCheckbox.indeterminate = false;
        el.selectAllCheckbox.disabled = true;
        return;
    }
    el.selectAllCheckbox.disabled = false;
    let checkedCount = 0;
    for (let i = 0; i < total; i++) {
        if (cbs[i].checked) checkedCount++;
    }
    el.selectAllCheckbox.checked = checkedCount === total;
    el.selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < total;
}

export function handleSelectAllChange(event) {
    const checked = event.target.checked;
    const items = el.extensionList?.querySelectorAll('.extension-item');
    if (!items?.length) return;

    items.forEach(item => {
        const id = item.dataset.extensionId;
        const cb = item.querySelector('.extension-select-checkbox');
        if (checked) { selectedExtensionIds.add(id); }
        else { selectedExtensionIds.delete(id); }
        item.classList.toggle('selected', checked);
        item.setAttribute('aria-selected', String(checked));
        if (cb) cb.checked = checked;
    });

    updateBulkActionsUI();
    updateSelectAllCheckboxState();
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
    // Note: caller is responsible for re-rendering if data changed
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
            const ext = extensionMap.get(r);
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
// BULK ASSIGN DROPDOWN
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
        createBtn.addEventListener('click', () => { toggleBulkAssignMenu(false); window.open('../profiles-page/profiles-page.html', '_blank'); });
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
        clearFiltersBtn.textContent = 'Clear';
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
    el.helpModalTrigger?.addEventListener('click', openHelpModal);
    el.helpModalCloseButton?.addEventListener('click', closeHelpModal);
    el.helpModal?.addEventListener('click', e => { if (e.target === el.helpModal) closeHelpModal(); });
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
    const helpOpen = el.helpModal?.classList.contains('visible');
    const anyModalOpen = helpOpen;

    if (event.key === 'Escape') {
        if (helpOpen) { closeHelpModal(); return; }
        const confirmOpen = document.getElementById('custom-confirm-modal')?.classList.contains('visible');
        const promptOpen = document.getElementById('custom-prompt-modal')?.classList.contains('visible');
        if (confirmOpen) { closeCustomDialog(false); return; }
        if (promptOpen) { closeCustomDialog(null); return; }
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
            applyProfile(currentShortcuts.get(normalized), extensionMap).then(() => window.close());
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
            case 'P': event.preventDefault(); window.open('../profiles-page/profiles-page.html', '_blank'); break;
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
        initCustomDialogs();
        await setupFiltersAndSearch();
        setupModalListeners();
        setupBulkActionListeners();
        setupBulkAssignDropdown();

        el.extensionList?.addEventListener('click', handleExtensionListClick);

        document.addEventListener('keydown', handleGlobalKeydown);

        await refreshExtensionDataAndRender();
        el.searchInput?.focus({ preventScroll: true });

        registerKeyboardShortcuts().catch(console.error);

        const footerEl = document.getElementById('footer-info');
        if (footerEl) {
            try {
                const manifest = chrome.runtime.getManifest();
                const year = new Date().getFullYear();
                footerEl.textContent = `Version ${manifest?.version ?? '?'} | © ${year} modcore.`;
            } catch (e) {
                footerEl.textContent = `© ${new Date().getFullYear()} modcore.`;
            }
        }

        await populateBulkAssignMenu();
    } catch (e) {
        console.error('Initialization error:', e);
        Status.error('Failed to initialize popup. Please reload.', 10000);
        hideLoading();
    }
}

document.addEventListener('DOMContentLoaded', initializePopup);