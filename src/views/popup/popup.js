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
export const DEFAULT_ICON_PLACEHOLDER = '../../../public/icons/svg/updatelogo.svg';

export const ICON = Object.freeze({
    delete:    '../../../public/icons/svg/trash.svg',
    add:       '../../../public/icons/svg/plus.svg',
    profiles:  '../../../public/icons/svg/profiles.svg',
    configure: '../../../public/icons/svg/settings.svg',
});

// Safe Status fallback so the popup never hard-crashes if the external status script fails
const Status = /*@__PURE__*/ (() => {
    if (typeof window !== 'undefined' && window.Status) return window.Status;
    const noop = () => {};
    return { success: noop, error: noop, info: noop, bar: noop };
})();

// ─── DOM cache ────────────────────────────────────────────────────────────────
export const el = {
    loadingIndicator:       document.getElementById('loading-indicator'),
    extensionList:          document.getElementById('extension-list'),
    extensionListHeader:    document.getElementById('extension-list-header'),
    emptyState:             document.getElementById('empty-state-message'),
    listStatus:             document.getElementById('list-status'),
    searchInput:            document.getElementById('search-input'),
    clearSearchButton:      document.getElementById('clear-search-btn'),
    statusFilter:           document.getElementById('status-filter'),
    bulkActionsContainer:   document.getElementById('bulk-actions-container'),
    selectedCountSpan:      document.getElementById('selected-count'),
    bulkAssignActionButton: document.getElementById('bulk-assign-action-btn'),
    bulkAssignDropdownMenu: document.getElementById('bulk-assign-dropdown-menu'),
    bulkEnableButton:       document.getElementById('bulk-enable-button'),
    bulkDisableButton:      document.getElementById('bulk-disable-button'),
    selectAllCheckbox:      document.getElementById('select-all-checkbox'),
    helpModal:              document.getElementById('help-modal'),
    helpModalTrigger:       document.getElementById('help-modal-trigger'),
    helpModalCloseButton:   document.querySelector('#help-modal .modal-close-button'),
    rowTemplate:            document.getElementById('extension-row-template'),
    contextMenu:            document.getElementById('extension-context-menu'),
};

// ─── Session state ────────────────────────────────────────────────────────────
let searchDebounceTimer        = null;
export let allFetchedExtensions = [];
export let extensionMap         = new Map();
export let selectedExtensionIds = new Set();
let fuse                       = null;
let contextMenuExtensionId     = null;

// ═════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

export function sanitizeText(str) {
    if (str === null || str === undefined) return '';
    return String(str);
}

export function makeImg(src, extraClass = '') {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    if (extraClass) img.className = extraClass;
    return img;
}

// ═════════════════════════════════════════════════════════════════════════════
// HELP DIALOG
// ═════════════════════════════════════════════════════════════════════════════

export function initDialogs() {
    el.helpModalTrigger?.addEventListener('click', () => el.helpModal?.showModal());
    el.helpModalCloseButton?.addEventListener('click', () => el.helpModal?.close());
}

export function openHelpModal() { el.helpModal?.showModal(); }

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
        keys: [
            { name: '_searchName', weight: 0.6 },
            { name: '_searchDesc', weight: 0.25 },
            { name: '_searchId',   weight: 0.15 }
        ],
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 1
    });
}

export async function filterAndSortExtensions(extensions) {
    const search    = (el.searchInput?.value ?? '').trim();
    const statusVal = el.statusFilter?.value ?? 'all';

    let filtered = extensions;
    if (statusVal === 'enabled')  filtered = filtered.filter(ext => ext.enabled);
    if (statusVal === 'disabled') filtered = filtered.filter(ext => !ext.enabled);

    if (search.length > 0 && fuse) {
        const matchedIds = new Set(fuse.search(search).map(r => r.item.id));
        filtered = filtered.filter(ext => matchedIds.has(ext.id));
    }

    return filtered.sort((a, b) =>
        a._searchName.localeCompare(b._searchName, undefined, { sensitivity: 'base' })
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// EXTENSION LIST RENDERING
// ═════════════════════════════════════════════════════════════════════════════

function buildExtensionRow(ext) {
    const template = el.rowTemplate;
    if (!template) return null;

    const node = template.content.firstElementChild.cloneNode(true);
    const isSelected  = selectedExtensionIds.has(ext.id);
    const safeName    = sanitizeText(ext.name);
    const userManaged = ext.mayDisable !== false;

    node.dataset.extensionId = ext.id;
    node.classList.toggle('selected', isSelected);

    // Checkbox
    const cb = node.querySelector('.extension-select-checkbox');
    cb.dataset.extensionId = ext.id;
    cb.checked = isSelected;
    cb.setAttribute('aria-label', `Select ${safeName}`);

    // Icon
    const iconImg = node.querySelector('.extension-icon');
    const bestIcon = ext.icons?.length
        ? ext.icons.reduce((a, b) => (b.size > a.size ? b : a))
        : null;
    iconImg.src = bestIcon?.url ?? DEFAULT_ICON_PLACEHOLDER;
    iconImg.onerror = () => {
        iconImg.onerror = null;
        iconImg.src = DEFAULT_ICON_PLACEHOLDER;
    };

    // Name
    const nameEl = node.querySelector('.extension-name');
    nameEl.title = safeName;
    nameEl.textContent = safeName;

    // Toggle button
    const toggleBtn = node.querySelector('.toggle-button');
    const toggleLabelSpan = toggleBtn.querySelector('.toggle-button-label');
    const actionWord = ext.enabled ? 'Disable' : 'Enable';
    toggleLabelSpan.textContent = actionWord;
    const toggleLabel = `${actionWord} ${safeName}`;
    toggleBtn.classList.add(ext.enabled ? 'button-danger' : 'button-success');
    toggleBtn.title = toggleLabel;
    toggleBtn.setAttribute('aria-label', toggleLabel);
    toggleBtn.setAttribute('aria-pressed', String(ext.enabled));
    toggleBtn.dataset.extensionId = ext.id;
    toggleBtn.dataset.currentState = ext.enabled ? 'enabled' : 'disabled';
    if (!userManaged) {
        toggleBtn.disabled = true;
        const msg = `${safeName} is managed by your browser and cannot be toggled.`;
        toggleBtn.title = msg;
        toggleBtn.setAttribute('aria-label', msg);
    }

    // Details button
    const detailsBtn = node.querySelector('.details-button');
    detailsBtn.title = `View details for ${safeName}`;
    detailsBtn.setAttribute('aria-label', `View details for ${safeName}`);
    detailsBtn.dataset.extensionId = ext.id;

    // "More" overflow button
    const moreBtn = node.querySelector('.more-button');
    const hasOptions   = Boolean(ext.optionsUrl);
    const canUninstall = userManaged;
    if (!hasOptions && !canUninstall) {
        moreBtn.disabled = true;
        const msg = `${safeName} has no available actions.`;
        moreBtn.title = msg;
        moreBtn.setAttribute('aria-label', msg);
    } else {
        moreBtn.title = `More actions for ${safeName}`;
        moreBtn.setAttribute('aria-label', `More actions for ${safeName}`);
    }
    moreBtn.dataset.extensionId = ext.id;

    return node;
}

function updateListStatus(count) {
    if (!el.listStatus) return;
    el.listStatus.textContent = count === 0
        ? 'No extensions to display.'
        : `${count} extension${count === 1 ? '' : 's'} displayed.`;
}

export async function renderExtensionList() {
    try {
        if (!el.extensionList) { hideLoading(); return; }

        const filteredExtensions = await filterAndSortExtensions(allFetchedExtensions);
        const total = filteredExtensions.length;

        if (total === 0) {
            if (el.extensionListHeader) el.extensionListHeader.style.display = 'none';
            if (el.emptyState) {
                el.emptyState.style.display = 'block';
                el.emptyState.replaceChildren();

                const hasActiveFilters =
                    Boolean(el.searchInput?.value.trim()) ||
                    (el.statusFilter?.value ?? 'all') !== 'all';

                const p1 = document.createElement('p');
                p1.textContent = hasActiveFilters
                    ? 'No extensions match your criteria.'
                    : 'No extensions found.';
                el.emptyState.appendChild(p1);

                if (hasActiveFilters) {
                    const p2 = document.createElement('p');
                    p2.textContent = 'Try clearing your search or adjusting filters.';
                    el.emptyState.appendChild(p2);

                    const clearBtn = document.createElement('button');
                    clearBtn.className = 'button-small button-primary';
                    clearBtn.type = 'button';
                    clearBtn.textContent = 'Clear Filters';
                    clearBtn.addEventListener('click', clearAllFilters);
                    el.emptyState.appendChild(clearBtn);
                }
            }
            el.extensionList.replaceChildren();
            el.extensionList.style.display = 'none';
            hideLoading();
            updateSelectAllCheckboxState();
            updateBulkActionsUI();
            updateListStatus(0);
            return;
        }

        if (el.extensionListHeader) el.extensionListHeader.style.display = 'flex';
        if (el.emptyState) el.emptyState.style.display = 'none';
        el.extensionList.style.display = '';

        const frag = document.createDocumentFragment();
        for (const ext of filteredExtensions) {
            const row = buildExtensionRow(ext);
            if (row) frag.appendChild(row);
        }
        el.extensionList.replaceChildren(frag);

        hideLoading();
        updateSelectAllCheckboxState();
        updateBulkActionsUI();
        updateListStatus(total);
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
            ext._searchId   = (ext.id ?? '').toLowerCase();
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
    if (!btn || btn.disabled) return;
    const { action, extensionId, currentState } = btn.dataset;
    if (!extensionId) return;

    switch (action) {
        case 'toggle':  toggleExtension(extensionId, currentState === 'disabled', btn); break;
        case 'details': openDetailsPage(extensionId); break;
        case 'more':    toggleExtensionContextMenu(btn, extensionId); break;
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

            if ((el.statusFilter?.value ?? 'all') !== 'all') {
                await refreshExtensionDataAndRender();
                return;
            }

            const item = el.extensionList?.querySelector(`.extension-item[data-extension-id="${extensionId}"]`);
            const btn  = buttonElement || item?.querySelector('.toggle-button');
            if (item && btn && ext) {
                const actionWord = enable ? 'Disable' : 'Enable';
                const label = `${actionWord} ${sanitizeText(ext.name)}`;
                btn.dataset.currentState = enable ? 'enabled' : 'disabled';
                btn.title = label;
                btn.setAttribute('aria-label', label);
                btn.setAttribute('aria-pressed', String(enable));
                btn.classList.toggle('button-danger', enable);
                btn.classList.toggle('button-success', !enable);
                const labelSpan = btn.querySelector('.toggle-button-label');
                if (labelSpan) labelSpan.textContent = actionWord;
            } else {
                await renderExtensionList();
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

export function openOptionsPage(extensionId) {
    const ext = extensionMap.get(extensionId);
    if (!ext?.optionsUrl) {
        Status.error('This extension has no options page.');
        return;
    }
    try {
        chrome.tabs.create({ url: ext.optionsUrl });
    } catch (e) {
        console.error('openOptionsPage error:', e);
        Status.error('Failed to open options page.');
    }
}

export function uninstallExtension(extensionId) {
    const ext = extensionMap.get(extensionId);
    const safeName = sanitizeText(ext?.name ?? 'this extension');

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
// EXTENSION "MORE" CONTEXT MENU
//
// Uses a native <dialog> with showModal() so it renders in the top layer.
// This is required for Chrome extension popups: absolutely/fixed-positioned
// siblings of the popup container get clipped by the popup's own rendering.
// ═════════════════════════════════════════════════════════════════════════════

function buildExtensionContextMenu(ext) {
    const menu = el.contextMenu;
    if (!menu) return;
    menu.replaceChildren();

    if (ext.optionsUrl) {
        const optBtn = document.createElement('button');
        optBtn.className = 'menu-item';
        optBtn.type = 'button';
        optBtn.dataset.action = 'options';
        optBtn.dataset.extensionId = ext.id;
        optBtn.setAttribute('role', 'menuitem');
        optBtn.appendChild(makeImg(ICON.configure));
        const sp = document.createElement('span');
        sp.textContent = 'Options';
        optBtn.appendChild(sp);
        menu.appendChild(optBtn);
    }

    if (ext.mayDisable !== false) {
        const delBtn = document.createElement('button');
        delBtn.className = 'menu-item danger';
        delBtn.type = 'button';
        delBtn.dataset.action = 'delete';
        delBtn.dataset.extensionId = ext.id;
        delBtn.setAttribute('role', 'menuitem');
        delBtn.appendChild(makeImg(ICON.delete));
        const sp = document.createElement('span');
        sp.textContent = 'Uninstall';
        delBtn.appendChild(sp);
        menu.appendChild(delBtn);
    }
}

/**
 * Position the dialog near the anchor button.
 * Dialogs with showModal() are positioned via top/left (we've disabled the
 * UA's default margin:auto centering in CSS).
 */
function positionContextMenu(anchorBtn) {
    const menu = el.contextMenu;
    if (!menu) return;

    const menuRect   = menu.getBoundingClientRect();
    const anchorRect = anchorBtn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    let left = anchorRect.right - menuRect.width;
    let top  = anchorRect.bottom + 4;

    if (left < 4) left = 4;
    if (left + menuRect.width > vw - 4) left = Math.max(4, vw - menuRect.width - 4);
    if (top + menuRect.height > vh - 4) top = anchorRect.top - menuRect.height - 4;
    if (top < 4) top = 4;

    menu.style.left = `${left}px`;
    menu.style.top  = `${top}px`;
}

export function toggleExtensionContextMenu(anchorBtn, extensionId) {
    const menu = el.contextMenu;
    if (!menu) return;

    // Same anchor & menu open → close (toggle).
    if (menu.open && contextMenuExtensionId === extensionId) {
        closeExtensionContextMenu();
        return;
    }

    // Different anchor while another menu is open → swap.
    if (menu.open) menu.close();

    const ext = extensionMap.get(extensionId);
    if (!ext) return;

    // Reset aria on the previous anchor if we're switching rows.
    if (contextMenuExtensionId && contextMenuExtensionId !== extensionId) {
        el.extensionList
            ?.querySelector(`.more-button[data-extension-id="${contextMenuExtensionId}"]`)
            ?.setAttribute('aria-expanded', 'false');
    }

    buildExtensionContextMenu(ext);
    if (menu.children.length === 0) return;

    contextMenuExtensionId = extensionId;
    anchorBtn.setAttribute('aria-expanded', 'true');

    menu.showModal();
    positionContextMenu(anchorBtn);

    // Give keyboard users a focus target inside the menu.
    menu.querySelector('.menu-item')?.focus({ preventScroll: true });
}

export function closeExtensionContextMenu() {
    const menu = el.contextMenu;
    if (!menu || !menu.open) return;
    menu.close(); // triggers 'close' event → resets state
}

function setupExtensionContextMenu() {
    const menu = el.contextMenu;
    if (!menu) return;

    // Menu item clicks + backdrop click (closes when clicking outside the dialog).
    menu.addEventListener('click', event => {
        // Clicked the backdrop (dialog itself) → close.
        if (event.target === menu) {
            closeExtensionContextMenu();
            return;
        }
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;
        const { action, extensionId } = btn.dataset;
        closeExtensionContextMenu();
        if (action === 'options') openOptionsPage(extensionId);
        else if (action === 'delete') uninstallExtension(extensionId);
    });

    // Reset state whenever the dialog closes (Escape, close(), backdrop).
    menu.addEventListener('close', () => {
        menu.replaceChildren();
        menu.style.left = '';
        menu.style.top  = '';

        if (contextMenuExtensionId) {
            el.extensionList
                ?.querySelector(`.more-button[data-extension-id="${contextMenuExtensionId}"]`)
                ?.setAttribute('aria-expanded', 'false');
        }
        contextMenuExtensionId = null;
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
        [el.bulkEnableButton, el.bulkDisableButton, el.bulkAssignActionButton]
            .forEach(b => b && (b.disabled = false));
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
    for (const cb of cbs) if (cb.checked) checkedCount++;
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
        if (checked) selectedExtensionIds.add(id);
        else selectedExtensionIds.delete(id);
        item.classList.toggle('selected', checked);
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

    for (const r of results) {
        if (typeof r === 'string') {
            success++;
            const ext = extensionMap.get(r);
            if (ext) ext.enabled = enable;
        } else {
            errors++;
            console.error('Bulk action error:', r?.id, r?.error?.message);
        }
    }

    hideLoading();
    if (errors) Status.error(`Done with errors. ${success} ${action}d, ${errors} failed.`);
    else if (success) Status.success(`${success} extension(s) ${action}d.`);

    clearSelection();
    await refreshExtensionDataAndRender();
}

export function toggleBulkAssignMenu(show) {
    const menu = el.bulkAssignDropdownMenu;
    const btn  = el.bulkAssignActionButton;
    if (!menu || !btn) return;
    menu.classList.toggle('visible', show);
    btn.setAttribute('aria-expanded', String(show));
}

// ═════════════════════════════════════════════════════════════════════════════
// BULK ASSIGN DROPDOWN (profile list only — no search, no meta)
// ═════════════════════════════════════════════════════════════════════════════

export async function populateBulkAssignMenu() {
    const menu = el.bulkAssignDropdownMenu;
    if (!menu) return;
    menu.replaceChildren();

    const { profiles } = await loadProfileStore();
    const orderedIds = await getOrderedProfileIds();

    const list = document.createElement('div');
    list.className = 'submenu';
    menu.appendChild(list);

    // No profiles → placeholder + create button
    if (orderedIds.length === 0) {
        const placeholder = document.createElement('div');
        placeholder.className = 'context-menu-placeholder';
        placeholder.setAttribute('role', 'status');
        placeholder.textContent = 'No profiles created yet.';
        list.appendChild(placeholder);

        const createBtn = document.createElement('button');
        createBtn.className = 'menu-item';
        createBtn.type = 'button';
        createBtn.appendChild(makeImg(ICON.add));
        const sp = document.createElement('span');
        sp.textContent = 'Create Profile…';
        createBtn.appendChild(sp);
        createBtn.addEventListener('click', () => {
            toggleBulkAssignMenu(false);
            window.open('../profiles-page/profiles-page.html', '_blank');
        });
        list.appendChild(createBtn);
        return;
    }

    // Profile list
    for (const profileId of orderedIds) {
        const profile = profiles[profileId];
        if (!profile) continue;

        const displayName = sanitizeText(profile.name);

        const btn = document.createElement('button');
        btn.className = 'menu-item';
        btn.type = 'button';
        btn.dataset.action = 'assign-profile';
        btn.dataset.value = profileId;
        btn.setAttribute('role', 'menuitem');
        btn.appendChild(makeImg(ICON.profiles));
        const sp = document.createElement('span');
        sp.textContent = displayName;
        btn.appendChild(sp);
        list.appendChild(btn);
    }

    // "Remove from all Profiles"
    const removeBtn = document.createElement('button');
    removeBtn.className = 'menu-item danger';
    removeBtn.type = 'button';
    removeBtn.dataset.action = 'remove-profile';
    removeBtn.setAttribute('role', 'menuitem');
    removeBtn.appendChild(makeImg(ICON.delete));
    const removeSpan = document.createElement('span');
    removeSpan.textContent = 'Remove from all Profiles';
    removeBtn.appendChild(removeSpan);
    list.appendChild(removeBtn);

    // Simple arrow-key navigation between menu items.
    list.addEventListener('keydown', e => {
        if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
        const items = [...list.querySelectorAll('.menu-item')];
        const idx = items.indexOf(document.activeElement);
        if (idx < 0) return;
        e.preventDefault();
        if (e.key === 'ArrowDown') items[Math.min(idx + 1, items.length - 1)]?.focus();
        else                       items[Math.max(idx - 1, 0)]?.focus();
    });
}

export async function handleBulkAssignMenuClick(event) {
    const target = event.target.closest('button[data-action]');
    if (!target) return;
    const { action, value } = target.dataset;
    const ids = selectedExtensionIds;

    switch (action) {
        case 'assign-profile':
            if (ids.size > 0) await assignExtensionsToProfile(ids, value);
            toggleBulkAssignMenu(false);
            break;
        case 'remove-profile':
            if (ids.size > 0) await removeExtensionsFromAllProfiles(ids);
            toggleBulkAssignMenu(false);
            break;
    }
}

export function setupBulkAssignDropdown() {
    const menu = el.bulkAssignDropdownMenu;
    const btn  = el.bulkAssignActionButton;
    if (!menu || !btn) return;

    btn.addEventListener('click', event => {
        event.stopPropagation();
        if (menu.classList.contains('visible')) {
            toggleBulkAssignMenu(false);
            return;
        }
        const btnRect  = btn.getBoundingClientRect();
        const bodyRect = document.body.getBoundingClientRect();
        const spaceAbove = btnRect.top;
        const spaceBelow = bodyRect.height - btnRect.bottom;
        menu.classList.toggle('position-below', spaceAbove < 220 && spaceBelow > spaceAbove);
        toggleBulkAssignMenu(true);
        menu.querySelector('.menu-item')?.focus({ preventScroll: true });
    });

    menu.addEventListener('click', handleBulkAssignMenuClick);

    document.addEventListener('click', event => {
        if (!menu.classList.contains('visible')) return;
        if (menu.contains(event.target) || btn.contains(event.target)) return;
        toggleBulkAssignMenu(false);
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// FILTERS & SEARCH
// ═════════════════════════════════════════════════════════════════════════════

function updateClearSearchVisibility() {
    if (!el.clearSearchButton) return;
    el.clearSearchButton.classList.toggle('visible', Boolean(el.searchInput?.value.trim()));
}

export async function clearAllFilters() {
    if (el.searchInput)  el.searchInput.value = '';
    if (el.statusFilter) el.statusFilter.value = 'all';
    clearTimeout(searchDebounceTimer);
    updateClearSearchVisibility();
    clearSelection();
    await renderExtensionList();
}

export function setupFiltersAndSearch() {
    const handleFilterChange = async () => {
        clearSelection();
        await renderExtensionList();
    };

    el.statusFilter?.addEventListener('change', handleFilterChange);

    el.searchInput?.addEventListener('input', () => {
        updateClearSearchVisibility();
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(handleFilterChange, 150);
    });

    el.clearSearchButton?.addEventListener('click', () => {
        if (!el.searchInput) return;
        el.searchInput.value = '';
        updateClearSearchVisibility();
        el.searchInput.focus();
        clearTimeout(searchDebounceTimer);
        handleFilterChange();
    });

    updateClearSearchVisibility();
}

// ═════════════════════════════════════════════════════════════════════════════
// EVENT LISTENER WIRING
// ═════════════════════════════════════════════════════════════════════════════

export function setupBulkActionListeners() {
    el.selectAllCheckbox?.addEventListener('change', handleSelectAllChange);
    el.bulkEnableButton?.addEventListener('click', () => performBulkAction('enable'));
    el.bulkDisableButton?.addEventListener('click', () => performBulkAction('disable'));
}

// ═════════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═════════════════════════════════════════════════════════════════════════════

export function handleGlobalKeydown(event) {
    // Native <dialog> handles its own Escape / focus trap.
    if (document.querySelector('dialog[open]')) return;

    const active = document.activeElement;
    const isInput = active && (
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName) ||
        active.isContentEditable
    );

    if (event.key === 'Escape' && isInput) {
        if (active === el.searchInput && active.value) {
            active.value = '';
            updateClearSearchVisibility();
            clearTimeout(searchDebounceTimer);
            renderExtensionList();
        } else {
            active.blur();
        }
        return;
    }

    if (!isInput) {
        const pressed = [];
        if (event.ctrlKey)  pressed.push('Ctrl');
        if (event.altKey)   pressed.push('Alt');
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
            case 'F': event.preventDefault(); clearAllFilters().then(() => el.searchInput?.focus()); break;
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
        initDialogs();
        setupFiltersAndSearch();
        setupBulkActionListeners();
        setupBulkAssignDropdown();
        setupExtensionContextMenu();

        el.extensionList?.addEventListener('click', handleExtensionListClick);
        document.addEventListener('keydown', handleGlobalKeydown);

        // Populate the (hidden) assign menu lazily on first open of the dropdown.
        let bulkMenuPopulated = false;
        el.bulkAssignActionButton?.addEventListener('click', async () => {
            if (bulkMenuPopulated) return;
            bulkMenuPopulated = true;
            await populateBulkAssignMenu();
        });

        await refreshExtensionDataAndRender();
        el.searchInput?.focus({ preventScroll: true });

        registerKeyboardShortcuts().catch(console.error);

        const footerEl = document.getElementById('footer-info');
        if (footerEl) {
            try {
                const manifest = chrome.runtime.getManifest();
                const year = new Date().getFullYear();
                footerEl.textContent = `Version ${manifest?.version ?? '?'} | © ${year} modcore.`;
            } catch {
                footerEl.textContent = `© ${new Date().getFullYear()} modcore.`;
            }
        }
    } catch (e) {
        console.error('Initialization error:', e);
        Status.error('Failed to initialize popup. Please reload.', 10000);
        hideLoading();
    }
}

document.addEventListener('DOMContentLoaded', initializePopup);