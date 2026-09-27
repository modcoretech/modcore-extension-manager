/**
 * @file actions-menu.js
 * modcore Extension Manager - Action menus + CRX downloader.
 */

'use strict';

// ==========================================================================
// Action menu IDs
// ==========================================================================

export const MENU_ACTIONS     = 'modcoreActions';
export const MENU_ENABLE_ALL  = 'modcoreActions_enableAll';
export const MENU_DISABLE_ALL = 'modcoreActions_disableAll';

// Action-context CRX submenu (dynamically toggled per active tab URL)
export const ACTION_MENU_CRX_FEATURES = 'crxFeatures_action';
export const ACTION_MENU_CRX_DOWNLOAD = 'crxDownload_action';
export const ACTION_MENU_CRX_DOCS     = 'crxDocs_action';

export const CRX_DOCS_URL =
    'https://sites.google.com/view/modcore-em-help/manage-extensions/trustguard/extension-source-viewer';

const PREVIOUS_STATE_KEY = 'actions_previous_state';

// ==========================================================================
// CRX / Web Store constants
// ==========================================================================

const CRX_UPDATE_BASE = 'https://clients2.google.com/service/update2/crx';

const WEBSTORE_MARKERS = [
    'chrome.google.com/webstore/detail',
    'chromewebstore.google.com/detail',
];

const CRX_QUEUE_TTL_MS = 30_000;

// ==========================================================================
// Action menu registration
// ==========================================================================

export function registerActionMenus() {
    chrome.contextMenus.create({
        id:       MENU_ACTIONS,
        title:    'Actions',
        contexts: ['action'],
    });
    chrome.contextMenus.create({
        id:       MENU_ENABLE_ALL,
        parentId: MENU_ACTIONS,
        title:    'Enable All Extensions',
        contexts: ['action'],
    });
    chrome.contextMenus.create({
        id:       MENU_DISABLE_ALL,
        parentId: MENU_ACTIONS,
        title:    'Disable All Extensions',
        contexts: ['action'],
    });
}

export function isActionMenuItem(menuItemId) {
    return menuItemId === MENU_ENABLE_ALL ||
           menuItemId === MENU_DISABLE_ALL;
}

export async function handleActionMenuClick(menuItemId) {
    switch (menuItemId) {
        case MENU_ENABLE_ALL:  await enableAllExtensions();  break;
        case MENU_DISABLE_ALL: await disableAllExtensions(); break;
    }
}

// ==========================================================================
// Dynamic action-context CRX submenu
// ==========================================================================

let actionCrxMenuVisible     = false;
let actionCrxMenuInitialized = false;
let actionCrxMenuChain       = Promise.resolve();

function removeMenuSafe(id) {
    return new Promise(resolve => {
        try {
            chrome.contextMenus.remove(id, () => {
                // Swallow "not found" — this is intentional cleanup.
                void chrome.runtime.lastError;
                resolve();
            });
        } catch (_) {
            resolve();
        }
    });
}

async function removeActionCrxMenus() {
    // Remove children before parent.
    await removeMenuSafe(ACTION_MENU_CRX_DOCS);
    await removeMenuSafe(ACTION_MENU_CRX_DOWNLOAD);
    await removeMenuSafe(ACTION_MENU_CRX_FEATURES);
}

function createActionCrxMenus() {
    chrome.contextMenus.create({
        id:       ACTION_MENU_CRX_FEATURES,
        title:    'CRX Features',
        contexts: ['action'],
    });
    chrome.contextMenus.create({
        id:       ACTION_MENU_CRX_DOWNLOAD,
        parentId: ACTION_MENU_CRX_FEATURES,
        title:    'Get CRX File',
        contexts: ['action'],
    });
    chrome.contextMenus.create({
        id:       ACTION_MENU_CRX_DOCS,
        parentId: ACTION_MENU_CRX_FEATURES,
        title:    'modcore Source',
        contexts: ['action'],
    });
}

async function _syncActionCrxMenu() {
    let url = '';
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        url = tabs[0]?.url || '';
    } catch (err) {
        console.warn('updateActionCrxMenu: failed to query tabs:', err);
        return;
    }

    const shouldShow = isWebStoreUrl(url);

    // Fast path only if we've synced at least once and state is unchanged.
    if (actionCrxMenuInitialized && shouldShow === actionCrxMenuVisible) return;

    // Always clear first — this is what makes the function idempotent
    // across service-worker restarts.
    await removeActionCrxMenus();
    if (shouldShow) createActionCrxMenus();

    actionCrxMenuVisible     = shouldShow;
    actionCrxMenuInitialized = true;
}

export function updateActionCrxMenu() {
    actionCrxMenuChain = actionCrxMenuChain
        .then(() => _syncActionCrxMenu())
        .catch(err => console.warn('updateActionCrxMenu failed:', err));
    return actionCrxMenuChain;
}

// ==========================================================================
// Action handler implementations
// ==========================================================================

async function enableAllExtensions() {
    try {
        const all    = await chrome.management.getAll();
        const selfId = chrome.runtime.id;
        let count = 0;

        for (const ext of all) {
            if (ext.id === selfId) continue;
            if (!ext.enabled) {
                await chrome.management.setEnabled(ext.id, true);
                count++;
            }
        }
        console.log(`Actions: enabled ${count} extension(s).`);
    } catch (err) {
        console.error('Actions: enable all failed:', err);
    }
}

async function disableAllExtensions() {
    try {
        const all    = await chrome.management.getAll();
        const selfId = chrome.runtime.id;
        const previouslyEnabled = [];
        let count = 0;

        for (const ext of all) {
            if (ext.id === selfId) continue;
            if (ext.enabled && ext.mayDisable !== false) {
                previouslyEnabled.push(ext.id);
                await chrome.management.setEnabled(ext.id, false);
                count++;
            }
        }

        await chrome.storage.local.set({ [PREVIOUS_STATE_KEY]: previouslyEnabled });
        console.log(`Actions: disabled ${count} extension(s).`);
    } catch (err) {
        console.error('Actions: disable all failed:', err);
    }
}

// ==========================================================================
// CRX / Web Store URL utilities
// ==========================================================================

function extractExtensionId(url) {
    const m = url.match(/\/detail\/[^/]+\/([a-p]{32})/i);
    return m ? m[1] : null;
}

function isWebStoreUrl(url) {
    if (typeof url !== 'string') return false;
    return WEBSTORE_MARKERS.some(marker => url.includes(marker));
}

function sanitizeFilename(text) {
    if (!text || typeof text !== 'string') return 'unknown';
    let clean = text.replace(/[\x00-\x1f\x7f&/\\:"*<>|?]/g, '').trim();
    clean = clean.replace(/[.\s]+$/, '');
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(clean)) {
        clean = '_' + clean;
    }
    if (clean.length > 200) clean = clean.slice(0, 200);
    return clean || 'unknown';
}

function getChromeVersion() {
    const m = navigator.userAgent.match(/Chrome\/([\d.]+)/);
    return m ? m[1] : '0.0.0.0';
}

function buildCRXUrl(arch, id, version) {
    return CRX_UPDATE_BASE
        + '?response=redirect'
        + '&nacl_arch='   + encodeURIComponent(arch)
        + '&prodversion=' + encodeURIComponent(version)
        + '&acceptformat=crx2,crx3'
        + '&x=id%3D'      + encodeURIComponent(id)
        + '%26installsource%3Dondemand%26uc';
}

// ==========================================================================
// CRX download orchestration
// ==========================================================================

/**
 * Pending CRX downloads handled by chrome.downloads. Entries are consumed
 * by onDeterminingFilename so we can rename the downloaded file.
 * @type {Array<{url: string, name: string, id: string, timestamp: number}>}
 */
const _crxQueue = [];

function pruneCrxQueue() {
    const cutoff = Date.now() - CRX_QUEUE_TTL_MS;
    while (_crxQueue.length > 0 && _crxQueue[0].timestamp < cutoff) {
        _crxQueue.shift();
    }
}

export function triggerCRXDownload(tab) {
    if (!tab?.url) {
        console.warn('CRX: no tab URL provided.');
        return;
    }
    if (!isWebStoreUrl(tab.url)) {
        console.warn('CRX: not a Web Store extension page.', tab.url);
        return;
    }

    const extId = extractExtensionId(tab.url);
    if (!extId) {
        console.warn('CRX: could not extract extension ID from URL.', tab.url);
        return;
    }

    const extName       = sanitizeFilename(tab.title?.replace(/ - Chrome Web Store$/i, ''));
    const chromeVersion = getChromeVersion();

    downloadAsCrx(extId, extName, chromeVersion)
        .catch(err => console.error('CRX download failed:', err));
}

async function downloadAsCrx(extId, extName, chromeVersion) {
    const platform = await chrome.runtime.getPlatformInfo();
    const arch     = platform.nacl_arch || 'x86-64';
    const url      = buildCRXUrl(arch, extId, chromeVersion);

    _crxQueue.push({ url, name: extName, id: extId, timestamp: Date.now() });
    pruneCrxQueue();

    try {
        await chrome.downloads.download({ url, saveAs: true });
    } catch (err) {
        const idx = _crxQueue.findIndex(q => q.url === url);
        if (idx !== -1) _crxQueue.splice(idx, 1);
        throw err;
    }
}

// ==========================================================================
// CRX download event listeners
// ==========================================================================

export function registerCrxListeners() {
    chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
        if (!item.url.startsWith(CRX_UPDATE_BASE)) return;

        const idx = _crxQueue.findIndex(q => q.url === item.url);
        if (idx === -1) return;

        const { name, id } = _crxQueue[idx];
        _crxQueue.splice(idx, 1);

        const vMatch  = item.filename.match(/_(\d+(?:_\d+)*)\.crx$/i);
        const version = vMatch ? vMatch[1].replace(/_/g, '.') : 'latest';

        suggest({
            filename: `${sanitizeFilename(name)} [${id.substring(0, 8)}].v${version}.crx`,
        });
    });
}