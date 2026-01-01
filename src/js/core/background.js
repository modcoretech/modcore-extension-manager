/**
 * @file background.js
 * This service worker handles the core logic for the automation rules and
 * now includes cloud sync functionality v2.0. It also now includes extension
 * activity history tracking.
 */

// --- Constants for storage keys ---
const RULES_STORAGE_KEY = 'rules';
const GROUPS_STORAGE_KEY = 'extensionManagerGroups_v4';
const PROFILES_STORAGE_KEY = 'extensionManagerProfiles_v2';
const PREFS_STORAGE_KEY = 'extensionManagerPrefs';

// --- Cloud Sync v2.0 Constants ---
const SYNC_SETTINGS_KEY = 'cloudSyncSettings';
const SYNC_DATA_KEY = 'fullSyncData';
const SYNC_ALARM_NAME = 'cloudSyncAlarm_v2';
const MAX_VERSIONS = 10;

// --- Extension History Constants (NEW) ---
const EXTENSION_HISTORY_KEY = 'extensionActivityHistory';
const HISTORY_SETTINGS_KEY = 'extensionHistorySettings';

// Data categories that can be synced
const DATA_KEYS_TO_SYNC = {
    [RULES_STORAGE_KEY]: 'Automation Rules',
    [GROUPS_STORAGE_KEY]: 'Groups',
    [PROFILES_STORAGE_KEY]: 'Profiles',
    [PREFS_STORAGE_KEY]: 'Preferences'
};

// --- Rule Automation Cache ---
let urlRulesCache = [];

// =========================================================================
// EXTENSION HISTORY TRACKING LOGIC (NEW)
// =========================================================================

/**
 * Records an extension activity event.
 * @param {string} eventType - The type of event (e.g., 'installed', 'uninstalled', 'updated', 'permissions_updated').
 * @param {object} extensionInfo - Information about the extension.
 * @param {string} [details=''] - Optional details about the event.
 */
const recordExtensionActivity = async (eventType, extensionInfo, details = '') => {
    const { [HISTORY_SETTINGS_KEY]: historySettings } = await chrome.storage.local.get(HISTORY_SETTINGS_KEY);
    if (!historySettings?.trackingEnabled) {
        return; // Do not record if tracking is disabled
    }

    const { [EXTENSION_HISTORY_KEY]: history } = await chrome.storage.local.get(EXTENSION_HISTORY_KEY);
    const currentHistory = history || [];

    const newRecord = {
        timestamp: Date.now(),
        eventType: eventType,
        extensionId: extensionInfo.id,
        extensionName: extensionInfo.name,
        extensionVersion: extensionInfo.version,
        details: details
    };

    currentHistory.unshift(newRecord); // Add to the beginning
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: currentHistory });
    console.log(`Recorded extension activity: ${eventType} for ${extensionInfo.name}`);
};

/**
 * Clears all extension history records.
 */
const clearExtensionHistory = async () => {
    await chrome.storage.local.set({ [EXTENSION_HISTORY_KEY]: [] });
    console.log('Extension history cleared.');
};


// =========================================================================
// RULE AUTOMATION LOGIC
// =========================================================================

/**
 * Updates all Chrome alarms based on currently stored rules and refreshes the URL rules cache.
 */
const updateAlarmsAndCache = async () => {
    try {
        const { [RULES_STORAGE_KEY]: rules } = await chrome.storage.local.get(RULES_STORAGE_KEY);
        if (!rules) {
            urlRulesCache = [];
            return;
        }

        urlRulesCache = rules.filter(rule => rule.enabled && rule.trigger.type === 'url');
        console.log(`URL rules cache updated. ${urlRulesCache.length} rules active.`);

        // Clear only rule-based alarms
        const allAlarms = await chrome.alarms.getAll();
        allAlarms.forEach(alarm => {
            if (alarm.name.startsWith('rule_')) {
                chrome.alarms.clear(alarm.name);
            }
        });
        console.log("Rule alarms cleared. Re-scheduling...");

        const timeRules = rules.filter(rule => rule.enabled && rule.trigger.type === 'time');

        for (const rule of timeRules) {
            const [hour, minute] = rule.trigger.time.split(':').map(Number);
            const now = new Date();
            let nextTrigger = new Date();
            nextTrigger.setHours(hour, minute, 0, 0);

            if (nextTrigger < now) {
                nextTrigger.setDate(nextTrigger.getDate() + 1);
            }

            let foundNextDay = false;
            for(let i = 0; i < 7; i++) {
                if(rule.trigger.days.includes(nextTrigger.getDay())) {
                    foundNextDay = true;
                    break;
                }
                nextTrigger.setDate(nextTrigger.getDate() + 1);
            }

            if(foundNextDay) {
                chrome.alarms.create(`rule_${rule.id}`, {
                    when: nextTrigger.getTime(),
                    periodInMinutes: 7 * 24 * 60 // Repeat weekly
                });
            }
        }
    } catch (error) {
        console.error("Error updating alarms and cache:", error);
    }
};

/**
 * Executes the action for a given rule.
 * @param {object} rule The rule object to execute.
 */
const executeRuleAction = async (rule) => {
    console.log(`Executing rule: "${rule.name}"`);
    try {
        if (rule.targetType === 'extension') {
            const shouldEnable = rule.action === 'enable';
            for (const extId of rule.targetIds) {
                try {
                    await chrome.management.setEnabled(extId, shouldEnable);
                } catch (e) { console.warn(`Error toggling extension ${extId}: ${e.message}`); }
            }
        } else if (rule.targetType === 'profile') {
            const profileId = rule.targetIds[0];
            const profilesData = await chrome.storage.local.get(PROFILES_STORAGE_KEY);
            const targetProfile = profilesData[PROFILES_STORAGE_KEY]?.[profileId];

            if (targetProfile?.extensionStates) {
                for (const extId in targetProfile.extensionStates) {
                    try {
                        await chrome.management.setEnabled(extId, targetProfile.extensionStates[extId]);
                    } catch (e) { console.warn(`Error applying profile to ext ${extId}: ${e.message}`); }
                }
            }
        } else if (rule.targetType === 'group') {
            const groupsData = await chrome.storage.local.get(GROUPS_STORAGE_KEY);
            for (const groupName of rule.targetIds) {
                const targetGroup = groupsData[GROUPS_STORAGE_KEY]?.[groupName];
                if (targetGroup?.members) {
                    for (const extId of targetGroup.members) {
                        try {
                            let shouldEnable;
                            if (rule.action !== 'toggle') {
                                shouldEnable = rule.action === 'enable';
                            } else {
                                const extInfo = await chrome.management.get(extId);
                                shouldEnable = !extInfo.enabled;
                            }
                            await chrome.management.setEnabled(extId, shouldEnable);
                        } catch (e) { console.warn(`Error processing group member ${extId}: ${e.message}`); }
                    }
                }
            }
        }
    } catch (error) {
        console.error(`Error executing rule "${rule.name}":`, error);
    }
};

// =========================================================================
// CLOUD SYNC V2.0 LOGIC
// =========================================================================

/**
 * Gathers selected local data, versions it, and saves to chrome.storage.sync.
 * @param {boolean} isAutomatic - Flag to indicate if sync was triggered by an alarm.
 */
const syncLocalDataToCloud = async (isAutomatic = true) => {
    const { [SYNC_SETTINGS_KEY]: settings } = await chrome.storage.local.get(SYNC_SETTINGS_KEY);

    if (isAutomatic && !settings?.autoSyncEnabled) {
        console.log('Automatic cloud sync is disabled. Skipping sync.');
        return;
    }

    console.log('Background sync to cloud started.');
    try {
        const keysToSync = Object.keys(settings.selectiveSync).filter(key => settings.selectiveSync[key]);
        if (keysToSync.length === 0) return;

        const localData = await chrome.storage.local.get(keysToSync);
        const newVersion = {
            timestamp: Date.now(),
            data: localData,
            source: isAutomatic ? 'Automatic Background Sync' : 'Manual Sync'
        };

        const syncStorage = await chrome.storage.sync.get(SYNC_DATA_KEY);
        const syncData = syncStorage[SYNC_DATA_KEY] || { versions: [] };

        syncData.versions.unshift(newVersion);
        syncData.versions.length = Math.min(syncData.versions.length, MAX_VERSIONS);

        await chrome.storage.sync.set({ [SYNC_DATA_KEY]: syncData });
        await chrome.storage.local.set({ [SYNC_SETTINGS_KEY]: { ...settings, lastSyncTimestamp: Date.now() } });
        console.log('Background sync successful.');

    } catch (error) {
        console.error('Error during background sync:', error);
        if (error.message.includes('QUOTA')) {
             chrome.notifications.create({
                type: 'basic',
                iconUrl: '../images/icon128.png',
                title: 'Cloud Sync Failed',
                message: 'Your data could not be synced due to exceeding the storage quota.',
                priority: 2
            });
        }
    }
};

/**
 * Updates or clears the sync alarm based on user settings.
 */
const updateSyncAlarm = async () => {
    const { [SYNC_SETTINGS_KEY]: settings } = await chrome.storage.local.get(SYNC_SETTINGS_KEY);

    await chrome.alarms.clear(SYNC_ALARM_NAME);

    if (settings?.autoSyncEnabled) {
        const periodInMinutes = parseInt(settings.syncInterval, 10) || 60;
        chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes });
        console.log(`Cloud sync alarm updated. Will run every ${periodInMinutes} minutes.`);
    } else {
        console.log('Cloud sync is disabled. Sync alarm removed.');
    }
};

// =========================================================================
// REGISTERING CHROME MANAGEMENT LISTENERS (MOVED)
// =========================================================================

const registerManagementListeners = () => {
    try {
        chrome.management.onInstalled.addListener((extensionInfo) => {
            recordExtensionActivity('installed', extensionInfo);
        });

        chrome.management.onUninstalled.addListener((extensionId) => {
            recordExtensionActivity('uninstalled', { id: extensionId, name: 'Unknown', version: 'Unknown' });
        });

        chrome.management.onEnabled.addListener((extensionInfo) => {
            recordExtensionActivity('enabled', extensionInfo);
        });

        chrome.management.onDisabled.addListener((extensionInfo) => {
            recordExtensionActivity('disabled', extensionInfo);
        });

        chrome.management.onUpdated.addListener(async (extensionInfo) => {
            const { permissions: oldPermissions = [] } = extensionInfo.oldPermissions || {};
            const { permissions: newPermissions = [] } = extensionInfo.permissions || {};

            const addedPermissions = newPermissions.filter(p => !oldPermissions.includes(p));
            const removedPermissions = oldPermissions.filter(p => !newPermissions.includes(p));

            let details = `Version updated to ${extensionInfo.version}.`;

            if (addedPermissions.length > 0) {
                details += ` Added permissions: ${addedPermissions.join(', ')}.`;
            }
            if (removedPermissions.length > 0) {
                details += ` Removed permissions: ${removedPermissions.join(', ')}.`;
            }

            if (addedPermissions.length > 0 || removedPermissions.length > 0) {
                 recordExtensionActivity('permissions_updated', extensionInfo, details);
            } else {
                 recordExtensionActivity('updated', extensionInfo, details);
            }
        });
        console.log("chrome.management listeners successfully registered.");
    } catch (error) {
        console.warn("Failed to set up chrome.management listeners. This is likely due to the 'management' permission not being granted in manifest.json or an initialization timing issue.", error);
    }
};


// =========================================================================
// CHROME API EVENT LISTENERS
// =========================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('Extension installed/updated. Initializing systems.');
    if (details.reason === 'install') {
        await chrome.storage.local.set({
            [RULES_STORAGE_KEY]: [],
            [SYNC_SETTINGS_KEY]: {
                autoSyncEnabled: true,
                syncOnStartup: true,
                syncInterval: 60,
                selectiveSync: Object.keys(DATA_KEYS_TO_SYNC).reduce((acc, key) => ({ ...acc, [key]: true }), {}),
                lastSyncTimestamp: null
            },
            syncLog: [],
            // NEW: Initialize history settings
            [EXTENSION_HISTORY_KEY]: [],
            [HISTORY_SETTINGS_KEY]: {
                trackingEnabled: true
            }
        });
        console.log('Initialized default settings for rules, sync, and history.');
    }
    // Always update both systems on install/update
    updateAlarmsAndCache();
    updateSyncAlarm();
    // CALL THE NEW FUNCTION HERE to register the listeners
    registerManagementListeners();


    // NEW: Record the installation/update of this extension itself
    if (details.reason === 'install' || details.reason === 'update') {
        const selfExtensionInfo = await chrome.management.get(chrome.runtime.id);
        recordExtensionActivity(details.reason, selfExtensionInfo, `Reason: ${details.reason}`);
    }
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('Browser started. Initializing systems.');
    updateAlarmsAndCache();
    updateSyncAlarm();
    // Also call the new function here for good measure
    registerManagementListeners();

    const { [SYNC_SETTINGS_KEY]: settings } = await chrome.storage.local.get(SYNC_SETTINGS_KEY);
    if (settings?.syncOnStartup) {
        console.log('Sync on startup is enabled. Triggering sync...');
        syncLocalDataToCloud(true);
    }
});


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SAVE_RULES') {
        chrome.storage.local.set({ [RULES_STORAGE_KEY]: request.payload }, () => {
            updateAlarmsAndCache();
            sendResponse({ status: 'success' });
        });
        return true; // Indicates async response
    }
    if (request.type === 'UPDATE_SYNC_ALARM') {
        updateSyncAlarm();
        sendResponse({status: "success"});
        return true; // Indicates async response
    }
    // NEW: Message handlers for history feature
    if (request.type === 'GET_EXTENSION_HISTORY') {
        chrome.storage.local.get(EXTENSION_HISTORY_KEY, (result) => {
            sendResponse({ history: result[EXTENSION_HISTORY_KEY] || [] });
        });
        return true;
    }
    if (request.type === 'GET_HISTORY_SETTINGS') {
        chrome.storage.local.get(HISTORY_SETTINGS_KEY, (result) => {
            sendResponse({ settings: result[HISTORY_SETTINGS_KEY] || { trackingEnabled: true } });
        });
        return true;
    }
    if (request.type === 'UPDATE_HISTORY_SETTINGS') {
        chrome.storage.local.set({ [HISTORY_SETTINGS_KEY]: request.payload }, () => {
            sendResponse({ status: 'success' });
        });
        return true;
    }
    if (request.type === 'CLEAR_EXTENSION_HISTORY') {
        clearExtensionHistory();
        sendResponse({ status: 'success' });
        return true;
    }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith('rule_')) {
        const { [RULES_STORAGE_KEY]: rules } = await chrome.storage.local.get(RULES_STORAGE_KEY);
        const ruleToExecute = rules?.find(r => `rule_${r.id}` === alarm.name);
        if (ruleToExecute?.enabled) {
            executeRuleAction(ruleToExecute);
        }
    } else if (alarm.name === SYNC_ALARM_NAME) {
        console.log('Periodic sync alarm fired. Starting sync...');
        syncLocalDataToCloud(true);
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url || urlRulesCache.length === 0) {
        return;
    }
    for (const rule of urlRulesCache) {
        if (rule.enabled && rule.trigger.type === 'url' && tab.url.includes(rule.trigger.url)) {
            executeRuleAction(rule);
        }
    }
});


// =========================================================================
// CONTEXT MENU FOR GETTING CRX FILES (FIXED & IMPROVED)
// =========================================================================

let ExtName;
let ExtID;

// ---------- SAFE CONTEXT MENU CREATION ----------

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "getCRX",
            title: chrome.i18n.getMessage("get_crx_menu"),
            contexts: ["all"],
            documentUrlPatterns: [
                "https://chrome.google.com/webstore/detail/*",
                "https://chromewebstore.google.com/detail/*"
            ]
        });
    });
});

// ---------- HELPERS ----------

function extractExtensionId(url) {
    // Works for both old and new Chrome Web Store
    const match = url.match(/\/detail\/[^/]+\/([a-p]{32})/i);
    return match ? match[1] : null;
}

function sanitize(text) {
    return text.replace(/[&\/\\:"*<>|?]/g, "").trim();
}

function getChromeVersion() {
    const match = navigator.userAgent.match(/Chrome\/([\d.]+)/);
    return match ? match[1] : "0.0.0.0";
}

function buildCRXUrl(arch, id, version) {
    return `https://clients2.google.com/service/update2/crx?response=redirect&nacl_arch=${arch}&prodversion=${version}&acceptformat=crx2,crx3&x=id%3D${id}%26installsource%3Dondemand%26uc`;
}

// ---------- MAIN FUNCTION ----------

function getCRX(info, tab) {

    if (!tab?.url) return;

    if (
        !tab.url.includes("chrome.google.com/webstore/detail") &&
        !tab.url.includes("chromewebstore.google.com/detail")
    ) {
        console.warn("Not a Chrome Web Store extension page");
        return;
    }

    ExtID = extractExtensionId(tab.url);

    if (!ExtID) {
        console.warn("Could not extract extension ID.");
        return;
    }

    ExtName = sanitize(
        tab.title.replace(" - Chrome Web Store", "")
    );

    const chromeVersion = getChromeVersion();

    chrome.runtime.getPlatformInfo((platform) => {

        const arch = platform.nacl_arch || "x86-64";
        const crxUrl = buildCRXUrl(arch, ExtID, chromeVersion);

        chrome.downloads.download({
            url: crxUrl,
            saveAs: true
        });

    });
}

// ---------- CONTEXT MENU LISTENER ----------

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "getCRX") {
        getCRX(info, tab);
    }
});

// ---------- IMPROVED FILENAME HANDLING ----------

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {

    if (!item.url.startsWith("https://clients2.google.com/service/update2/crx")) return;

    if (!ExtName || !ExtID) return;

    let version = "latest";

    const versionMatch = item.filename.match(/_(\d+[_\d]*)/);
    if (versionMatch) {
        version = versionMatch[1].replace(/_/g, ".");
    }

    const finalName =
        sanitize(ExtName) +
        " [" + ExtID.substring(0, 8) + "]" +
        ".v" + version +
        ".crx";

    suggest({ filename: finalName });

    ExtName = undefined;
    ExtID = undefined;
});
