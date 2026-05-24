/**
 * @file actions-menu.js
 * modcore Extension Manager - Action menu logic for toolbar context menu.
 */

'use strict';

export const MENU_ACTIONS     = 'modcoreActions';
export const MENU_ENABLE_ALL  = 'modcoreActions_enableAll';
export const MENU_DISABLE_ALL = 'modcoreActions_disableAll';
export const MENU_EXPORT_LIST = 'modcoreActions_exportList';

const PREVIOUS_STATE_KEY = 'actions_previous_state';

/**
 * Registers the static Actions submenu in the action (toolbar) context.
 */
export function registerActionMenus() {
    chrome.contextMenus.create({
        id:       MENU_ACTIONS,
        title:    chrome.i18n.getMessage('action_menu'),
        contexts: ['action'],
    });
    chrome.contextMenus.create({
        id:        MENU_ENABLE_ALL,
        parentId:  MENU_ACTIONS,
        title:     chrome.i18n.getMessage('action_enable_all'),
        contexts:  ['action'],
    });
    chrome.contextMenus.create({
        id:        MENU_DISABLE_ALL,
        parentId:  MENU_ACTIONS,
        title:     chrome.i18n.getMessage('action_disable_all'),
        contexts:  ['action'],
    });
    chrome.contextMenus.create({
        id:        MENU_EXPORT_LIST,
        parentId:  MENU_ACTIONS,
        title:     chrome.i18n.getMessage('action_export_list'),
        contexts:  ['action'],
    });
}

/**
 * Checks whether a clicked menu item belongs to the Actions menu.
 * @param {string} menuItemId
 * @returns {boolean}
 */
export function isActionMenuItem(menuItemId) {
    return menuItemId === MENU_ENABLE_ALL ||
           menuItemId === MENU_DISABLE_ALL ||
           menuItemId === MENU_EXPORT_LIST;
}

/**
 * Routes an Actions menu click to the correct handler.
 * @param {string} menuItemId
 */
export async function handleActionMenuClick(menuItemId) {
    switch (menuItemId) {
        case MENU_ENABLE_ALL:
            await enableAllExtensions();
            break;
        case MENU_DISABLE_ALL:
            await disableAllExtensions();
            break;
        case MENU_EXPORT_LIST:
            await exportExtensionList();
            break;
    }
}

// -------------------------------------------------------------------------
// Internal handlers
// -------------------------------------------------------------------------

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

async function exportExtensionList() {
    try {
        const all = await chrome.management.getAll();
        const payload = all
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(ext => ({
                id:              ext.id,
                name:            ext.name,
                version:         ext.version,
                enabled:         ext.enabled,
                type:            ext.type,
                installType:     ext.installType,
                mayDisable:      ext.mayDisable,
                permissions:     ext.permissions     || [],
                hostPermissions: ext.hostPermissions || [],
                description:     ext.description,
                homepageUrl:     ext.homepageUrl,
                updateUrl:       ext.updateUrl,
            }));

        const jsonStr = JSON.stringify(payload, null, 2);
        const dataUrl = `data:application/json;base64,${stringToBase64(jsonStr)}`;

        const now = new Date();
        const ts  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

        await chrome.downloads.download({
            url:      dataUrl,
            filename: `modcore-extensions-${ts}.json`,
            saveAs:   true,
        });
    } catch (err) {
        console.error('Actions: export list failed:', err);
    }
}

/**
 * UTF-8 safe base64 encoder (service-worker compatible).
 * @param {string} str
 * @returns {string}
 */
function stringToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const chunkSize = 0x2000; // 8 KB
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
    }
    return btoa(binary);
}