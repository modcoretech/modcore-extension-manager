document.addEventListener('DOMContentLoaded', initializeSyncPage);

// --- Constants & Global State ---
const SYNC_QUOTA_BYTES = 102400; // 100 KB
const SYNC_DATA_KEY = 'fullSyncData'; // A single key to hold versioned data
const SYNC_SETTINGS_KEY = 'cloudSyncSettings';
const MAX_LOG_ENTRIES = 100; // Default for log retention, but can be overridden by settings
const MAX_VERSIONS = 10; // Default for history retention, but can be overridden by settings

// Data categories that can be synced
const DATA_KEYS_TO_SYNC = {
    rules: 'Automation Rules',
    extensionManagerGroups_v4: 'Groups',
    extensionManagerProfiles_v2: 'Profiles',
    extensionManagerPrefs: 'Preferences'
};

let ui; // Object to hold all UI element references
let allLogEntries = []; // Store all log entries for filtering
let allHistoryEntries = []; // Store all history entries for filtering

let historySearchTimeout;
let logSearchTimeout;
const DEBOUNCE_DELAY = 300; // milliseconds

/**
 * Main initialization function.
 */
function initializeSyncPage() {
    console.log("Initializing Cloud Sync v2.0 Page");
    mapUI();
    bindEventListeners();
    loadAndApplySettings();
    updateSyncStatus();
    setupTooltips(); // Initialize tooltips
    applyRetentionPolicies(); // Apply on startup
}

/**
 * Maps all DOM elements to the `ui` object for easy access.
 */
function mapUI() {
    ui = {
        // Panels & Navigation
        sidebarButtons: document.querySelectorAll('.sidebar-button'),
        contentPanels: document.querySelectorAll('.content-panel'),
        
        // Status Panel
        chromeSyncStatus: document.getElementById('chromeSyncStatus'),
        extensionSyncStatus: document.getElementById('extensionSyncStatus'),
        lastSyncTimestamp: document.getElementById('lastSyncTimestamp'),
        syncProgressBarContainer: document.getElementById('syncProgressBarContainer'),
        syncProgress: document.getElementById('syncProgress'),
        syncProgressText: document.getElementById('syncProgressText'),
        totalBytesUsed: document.getElementById('totalBytesUsed'),
        statusMessage: document.getElementById('statusMessage'),
        quotaBreakdown: document.getElementById('quotaBreakdown'),

        // Options Panel
        selectiveSyncOptions: document.getElementById('selectiveSyncOptions'),
        enableAutoSync: document.getElementById('enableAutoSync'),
        syncOnStartup: document.getElementById('syncOnStartup'),
        syncInterval: document.getElementById('syncInterval'),
        historyRetentionPolicy: document.getElementById('historyRetentionPolicy'), // Moved to options
        logRetentionPolicy: document.getElementById('logRetentionPolicy'),     // Moved to options
        exportHistoryBtn: document.getElementById('exportHistoryBtn'),     // Moved to options
        exportLogBtn: document.getElementById('exportLogBtn'),         // Moved to options

        // Actions Panel
        syncNowBtn: document.getElementById('syncNowBtn'),
        restoreBtn: document.getElementById('restoreBtn'),
        clearSyncBtn: document.getElementById('clearSyncBtn'),

        // History Panel
        versionHistory: document.getElementById('versionHistory'),
        historySearchInput: document.getElementById('historySearchInput'),
        historyDateRange: document.getElementById('historyDateRange'),
        historyCustomDateRange: document.getElementById('historyCustomDateRange'),
        historyStartDate: document.getElementById('historyStartDate'),
        historyEndDate: document.getElementById('historyEndDate'),

        // Log Panel
        syncLog: document.getElementById('syncLog'),
        logSearchInput: document.getElementById('logSearchInput'),
        logDateRange: document.getElementById('logDateRange'),
        logCustomDateRange: document.getElementById('logCustomDateRange'),
        logStartDate: document.getElementById('logStartDate'),
        logEndDate: document.getElementById('logEndDate'),

        // Modals
        confirmDialog: {
            overlay: document.getElementById('confirmDialogOverlay'),
            title: document.getElementById('confirmDialogTitle'),
            message: document.getElementById('confirmDialogMessage'),
            okBtn: document.getElementById('confirmOkBtn'),
            cancelBtn: document.getElementById('confirmCancelBtn'),
        },
        conflictDialog: {
            overlay: document.getElementById('conflictDialogOverlay'),
            keepLocalBtn: document.getElementById('conflictKeepLocalBtn'),
            keepCloudBtn: document.getElementById('conflictKeepCloudBtn'),
        },
        
        // Toast
        toastContainer: document.getElementById('toast-container'),
        
        // Tooltips
        chromeSyncTooltip: document.getElementById('chromeSyncTooltip'),
        autoSyncTooltip: document.getElementById('autoSyncTooltip'),
    };
    populateSelectiveSyncOptions();
}

/**
 * Populates the selective sync checkbox area.
 */
function populateSelectiveSyncOptions() {
    while (ui.selectiveSyncOptions.firstChild) {
        ui.selectiveSyncOptions.removeChild(ui.selectiveSyncOptions.firstChild);
    }
    for (const key in DATA_KEYS_TO_SYNC) {
        const name = DATA_KEYS_TO_SYNC[key];
        const item = document.createElement('div');
        item.className = 'option-item';

        const label = document.createElement('label');
        label.setAttribute('for', `sync-${key}`);

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = `sync-${key}`;
        input.dataset.key = key;

        label.appendChild(input);
        label.appendChild(document.createTextNode(` ${name}`));

        item.appendChild(label);
        ui.selectiveSyncOptions.appendChild(item);
    }
}


/**
 * Binds all event listeners for the page.
 */
function bindEventListeners() {
    // Panel Navigation
    ui.sidebarButtons.forEach(button => {
        button.addEventListener('click', () => {
            switchPanel(button.dataset.panel);
            // Load content automatically when panel is switched
            if (button.dataset.panel === 'history-panel') {
                displayVersionHistory(true);
            } else if (button.dataset.panel === 'log-panel') {
                updateSyncLog(true);
            }
        });
    });

    // Options
    ui.enableAutoSync.addEventListener('change', saveSyncSettings);
    ui.syncOnStartup.addEventListener('change', saveSyncSettings);
    ui.syncInterval.addEventListener('change', saveSyncSettings);
    ui.selectiveSyncOptions.addEventListener('change', saveSyncSettings);
    ui.historyRetentionPolicy.addEventListener('change', saveSyncSettings);
    ui.logRetentionPolicy.addEventListener('change', saveSyncSettings);
    ui.exportHistoryBtn.addEventListener('click', () => exportDataToCSV(allHistoryEntries, 'sync_history'));
    ui.exportLogBtn.addEventListener('click', () => exportDataToCSV(allLogEntries, 'sync_log'));


    // Actions
    ui.syncNowBtn.addEventListener('click', () => syncToCloud(false));
    ui.restoreBtn.addEventListener('click', () => restoreFromCloud(null)); // null means latest
    ui.clearSyncBtn.addEventListener('click', confirmClearCloudData);
    
    // History Filters (automatic on change with debounce)
    ui.historySearchInput.addEventListener('input', debounce(() => displayVersionHistory(true), DEBOUNCE_DELAY));
    ui.historyDateRange.addEventListener('change', () => {
        ui.historyCustomDateRange.style.display = ui.historyDateRange.value === 'custom' ? 'flex' : 'none';
        displayVersionHistory(true);
    });
    ui.historyStartDate.addEventListener('change', debounce(() => displayVersionHistory(true), DEBOUNCE_DELAY));
    ui.historyEndDate.addEventListener('change', debounce(() => displayVersionHistory(true), DEBOUNCE_DELAY));


    // Log Filters (automatic on change with debounce)
    ui.logSearchInput.addEventListener('input', debounce(() => updateSyncLog(true), DEBOUNCE_DELAY));
    ui.logDateRange.addEventListener('change', () => {
        ui.logCustomDateRange.style.display = ui.logDateRange.value === 'custom' ? 'flex' : 'none';
        updateSyncLog(true);
    });
    ui.logStartDate.addEventListener('change', debounce(() => updateSyncLog(true), DEBOUNCE_DELAY));
    ui.logEndDate.addEventListener('change', debounce(() => updateSyncLog(true), DEBOUNCE_DELAY));


    // Storage Changes
    chrome.storage.onChanged.addListener(handleStorageChange);
}

/**
 * Switches the visible content panel.
 * @param {string} panelId The ID of the panel to show.
 */
function switchPanel(panelId) {
    ui.sidebarButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.panel === panelId));
    ui.contentPanels.forEach(panel => panel.classList.toggle('active', panel.id === panelId));
}

/**
 * Loads settings from storage and updates the UI accordingly.
 */
async function loadAndApplySettings() {
    try {
        const { [SYNC_SETTINGS_KEY]: settings } = await chrome.storage.local.get(SYNC_SETTINGS_KEY);
        const defaults = {
            autoSyncEnabled: false,
            syncOnStartup: false,
            syncInterval: 60,
            selectiveSync: Object.keys(DATA_KEYS_TO_SYNC).reduce((acc, key) => ({ ...acc, [key]: true }), {}),
            lastSyncTimestamp: null,
            logRetentionPolicy: '100', // Default: keep last 100 entries
            historyRetentionPolicy: '10' // Default: keep last 10 versions
        };
        const currentSettings = { ...defaults, ...settings };

        ui.enableAutoSync.checked = currentSettings.autoSyncEnabled;
        ui.syncOnStartup.checked = currentSettings.syncOnStartup;
        ui.syncInterval.value = currentSettings.syncInterval;
        ui.lastSyncTimestamp.textContent = currentSettings.lastSyncTimestamp ? new Date(currentSettings.lastSyncTimestamp).toLocaleString() : 'Never';
        ui.extensionSyncStatus.textContent = currentSettings.autoSyncEnabled ? 'Enabled' : 'Disabled';
        ui.extensionSyncStatus.className = `detail-value status-indicator ${currentSettings.autoSyncEnabled ? 'success' : 'error'}`;
        ui.logRetentionPolicy.value = currentSettings.logRetentionPolicy;
        ui.historyRetentionPolicy.value = currentSettings.historyRetentionPolicy;


        for (const key in currentSettings.selectiveSync) {
            const checkbox = document.getElementById(`sync-${key}`);
            if (checkbox) {
                checkbox.checked = currentSettings.selectiveSync[key];
            }
        }
    } catch (error) {
        console.error("Error loading settings:", error);
        showToast("Could not load sync settings.", "error");
    }
}

/**
 * Saves all current sync settings to local storage.
 */
async function saveSyncSettings() {
    try {
        const selectiveSync = {};
        document.querySelectorAll('#selectiveSyncOptions input[type="checkbox"]').forEach(cb => {
            selectiveSync[cb.dataset.key] = cb.checked;
        });

        const settings = {
            autoSyncEnabled: ui.enableAutoSync.checked,
            syncOnStartup: ui.syncOnStartup.checked,
            syncInterval: parseInt(ui.syncInterval.value, 10),
            selectiveSync: selectiveSync,
            logRetentionPolicy: ui.logRetentionPolicy.value,
            historyRetentionPolicy: ui.historyRetentionPolicy.value
        };
        
        await chrome.storage.local.set({ [SYNC_SETTINGS_KEY]: settings });
        
        // Update background script with new alarm schedule
        chrome.runtime.sendMessage({ type: 'UPDATE_SYNC_ALARM' });
        
        showToast("Settings saved.", "success");
        loadAndApplySettings(); // Refresh UI state
        applyRetentionPolicies(); // Apply immediately after saving
    } catch (error) {
        console.error("Error saving settings:", error);
        showToast("Failed to save settings.", "error");
    }
}

// --- Core Sync & Status Functions ---

/**
 * Checks Chrome sync status and updates the UI and progress bar.
 */
async function updateSyncStatus() {
    setUIState(true, "Checking sync status..."); // Set loading state for status
    try {
        // Check if sync is enabled in Chrome itself (heuristic)
        const syncData = await chrome.storage.sync.get(SYNC_DATA_KEY);
        const hasData = syncData && syncData[SYNC_DATA_KEY] && syncData[SYNC_DATA_KEY].versions && syncData[SYNC_DATA_KEY].versions.length > 0;
        
        // For Chrome Sync Status, check chrome.identity or chrome.storage.sync.QUOTA_BYTES_PER_ITEM for a more accurate status
        // A direct API for "is Chrome Sync enabled for extension data" isn't readily available, so we infer.
        // If getBytesInUse returns data, it implies sync is active.
        let chromeSyncActive = false;
        try {
             const testData = { 'testSync': 'test' };
             await chrome.storage.sync.set(testData); // Attempt a small write to check if sync is active
             await chrome.storage.sync.remove('testSync');
             chromeSyncActive = true;
        } catch (e) {
            console.warn("Chrome Sync might be inactive or restricted:", e);
            chromeSyncActive = false;
        }

        ui.chromeSyncStatus.textContent = chromeSyncActive ? 'Active' : 'Inactive';
        ui.chromeSyncStatus.className = `detail-value status-indicator ${chromeSyncActive ? 'success' : 'warning'}`;


        // Update progress bar using getBytesInUse for accuracy
        const bytesInUse = await chrome.storage.sync.getBytesInUse(null);
        const percentage = (bytesInUse / SYNC_QUOTA_BYTES) * 100;

        ui.syncProgress.style.width = `${Math.min(percentage, 100)}%`;
        ui.syncProgressText.textContent = `${(bytesInUse / 1024).toFixed(2)} KB / 100 KB`;
        ui.totalBytesUsed.textContent = bytesInUse.toLocaleString();

        ui.syncProgress.classList.remove('warning', 'error');
        if (percentage > 90) {
            ui.syncProgress.classList.add('error');
            updateStatusMessage('Error: Sync quota critically high! Clear data or disable sync.', 'error');
        } else if (percentage > 75) {
            ui.syncProgress.classList.add('warning');
            updateStatusMessage('Warning: You are approaching the sync quota limit.', 'warning');
        } else {
            updateStatusMessage('Sync usage is healthy.', 'success');
        }
        
        // Update quota breakdown
        // Use the actual data from syncStorage if available, otherwise assume latest is version 0
        updateQuotaBreakdown(syncData[SYNC_DATA_KEY]?.versions[0]?.data);

    } catch (error) {
        console.error("Error getting sync status:", error);
        updateStatusMessage(`Error: Could not retrieve sync status. ${error.message}`, 'error');
    } finally {
        setUIState(false); // Remove loading state for status
    }
}

/**
 * Updates the detailed quota breakdown display.
 * @param {object} latestData The latest synced data object.
 */
function updateQuotaBreakdown(latestData) {
    while (ui.quotaBreakdown.firstChild) {
        ui.quotaBreakdown.removeChild(ui.quotaBreakdown.firstChild);
    }
    if (!latestData) {
        const placeholder = document.createElement('p');
        placeholder.className = 'placeholder-text';
        placeholder.textContent = 'No data synced yet.';
        ui.quotaBreakdown.appendChild(placeholder);
        return;
    }

    const breakdown = [];
    for (const key in latestData) {
        // Ensure data exists for the key before trying to stringify
        if (latestData[key] !== undefined) {
            const size = new TextEncoder().encode(JSON.stringify(latestData[key])).length;
            breakdown.push({ name: DATA_KEYS_TO_SYNC[key] || key, size });
        }
    }

    if (breakdown.length === 0) {
        const placeholder = document.createElement('p');
        placeholder.className = 'placeholder-text';
        placeholder.textContent = 'No data selected for syncing.';
        ui.quotaBreakdown.appendChild(placeholder);
        return;
    }

    breakdown.sort((a, b) => b.size - a.size).forEach(item => {
        const div = document.createElement('div');
        div.className = 'quota-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'quota-item-name';
        nameSpan.textContent = item.name;
        
        const sizeSpan = document.createElement('span');
        sizeSpan.className = 'quota-item-size';
        sizeSpan.textContent = `${(item.size / 1024).toFixed(2)} KB`;

        div.appendChild(nameSpan);
        div.appendChild(sizeSpan);

        ui.quotaBreakdown.appendChild(div);
    });
}

/**
 * Gathers selected local data, versions it, and saves to chrome.storage.sync.
 * @param {boolean} isAutomatic - Flag to indicate if sync was triggered by user or alarm.
 */
async function syncToCloud(isAutomatic = false) {
    setUIState(true, "Syncing data to cloud...");
    try {
        const { [SYNC_SETTINGS_KEY]: settings } = await chrome.storage.local.get(SYNC_SETTINGS_KEY);
        const keysToSync = Object.keys(settings.selectiveSync).filter(key => settings.selectiveSync[key]);

        if (keysToSync.length === 0) {
            throw new Error("No data categories selected for syncing.");
        }

        const localData = await chrome.storage.local.get(keysToSync);
        const newVersion = {
            timestamp: Date.now(),
            data: localData,
            source: isAutomatic ? 'Automatic' : 'Manual'
        };

        const syncStorage = await chrome.storage.sync.get(SYNC_DATA_KEY);
        const syncData = syncStorage[SYNC_DATA_KEY] || { versions: [] };
        
        syncData.versions.unshift(newVersion); // Add new version to the front
        
        // Apply history retention immediately after adding a new version
        const historyRetention = settings.historyRetentionPolicy || MAX_VERSIONS.toString(); // Use setting or default
        if (historyRetention.endsWith('d')) {
            const days = parseInt(historyRetention.replace('d', ''), 10);
            const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
            syncData.versions = syncData.versions.filter(v => v.timestamp >= cutoff);
        } else {
            // Numeric (e.g., '10') means keep last N entries
            const numEntries = parseInt(historyRetention, 10);
            if (!isNaN(numEntries) && syncData.versions.length > numEntries) {
                syncData.versions.length = numEntries; // Trim old versions
            }
        }


        await chrome.storage.sync.set({ [SYNC_DATA_KEY]: syncData });
        await chrome.storage.local.set({ [SYNC_SETTINGS_KEY]: { ...settings, lastSyncTimestamp: Date.now() } });

        await addLogEntry('Sync to cloud successful.', 'success');
        showToast('Sync Complete!', 'success');
        
    } catch (error) {
        console.error('Sync to cloud failed:', error);
        await addLogEntry(`Sync failed: ${error.message}`, 'error');
        showToast(`Sync Error: ${error.message}`, 'error');
    } finally {
        setUIState(false);
        await updateSyncStatus(); // Always update status after sync attempt
        await loadAndApplySettings(); // Refresh timestamp
        await displayVersionHistory(true); // Refresh history
    }
}

/**
 * Restores data from the cloud to local storage.
 * @param {number|null} versionTimestamp - The timestamp of the version to restore. Null for latest.
 */
async function restoreFromCloud(versionTimestamp) {
    const performRestore = async () => {
        setUIState(true, "Restoring data from cloud...");
        try {
            const { [SYNC_DATA_KEY]: syncData } = await chrome.storage.sync.get(SYNC_DATA_KEY);
            if (!syncData || syncData.versions.length === 0) {
                throw new Error("No data found in the cloud to restore.");
            }
            
            let versionToRestore;
            if (versionTimestamp) {
                versionToRestore = syncData.versions.find(v => v.timestamp === versionTimestamp);
            } else {
                versionToRestore = syncData.versions[0]; // Latest
            }

            if (!versionToRestore) {
                throw new Error("Specified version not found.");
            }
            
            // Conflict Resolution Check for latest version restore
            if (!versionTimestamp) {
                const { [SYNC_SETTINGS_KEY]: settings } = await chrome.storage.local.get(SYNC_SETTINGS_KEY);
                if (settings.lastSyncTimestamp && versionToRestore.timestamp < settings.lastSyncTimestamp) {
                    const userChoice = await showConflictDialog();
                    if (userChoice === 'local') {
                        showToast("Restore cancelled. Local data kept.", "info");
                        setUIState(false);
                        return;
                    }
                }
            }

            await chrome.storage.local.set(versionToRestore.data);
            
            // Also update local settings with the restored data's selective sync config if it exists
            const restoredSettings = versionToRestore.data[SYNC_SETTINGS_KEY];
            if (restoredSettings) {
                 await chrome.storage.local.set({ [SYNC_SETTINGS_KEY]: restoredSettings });
            }

            await addLogEntry(`Restored from version: ${new Date(versionToRestore.timestamp).toLocaleString()}`, 'success');
            showToast('Restore Complete!', 'success');
            
            // Reload settings to reflect restored state
            await loadAndApplySettings();

        } catch (error) {
            console.error('Restore from cloud failed:', error);
            await addLogEntry(`Restore failed: ${error.message}`, 'error');
            showToast(`Restore Error: ${error.message}`, 'error');
        } finally {
            setUIState(false);
            await updateSyncStatus(); // Always update status after restore attempt
        }
    };
    
    // Show confirmation dialog before restoring
    const confirmed = await showConfirmDialog(
        'Restore Data?',
        `This will overwrite your local data with the selected cloud version. This action cannot be undone.`
    );
    if (confirmed) {
        performRestore();
    }
}


/**
 * Confirms and then clears all extension data from sync storage.
 */
async function confirmClearCloudData() {
    const confirmed = await showConfirmDialog(
        '⚠️ Clear All Cloud Data?',
        'This will permanently delete ALL synced extension data from your Google account. This cannot be undone.',
        'Clear Data'
    );
    if (confirmed) {
        setUIState(true, "Clearing all cloud data...");
        try {
            await chrome.storage.sync.remove(SYNC_DATA_KEY);
            await addLogEntry('All cloud data was permanently cleared.', 'success');
            showToast('Cloud data cleared.', 'success');
        } catch (error) {
            console.error('Clear cloud data failed:', error);
            await addLogEntry(`Clearing failed: ${error.message}`, 'error');
            showToast(`Clear Error: ${error.message}`, 'error');
        } finally {
            setUIState(false);
            await updateSyncStatus(); // Always update status after clear attempt
            await displayVersionHistory(true); // Refresh history view
        }
    }
}

// --- Version History ---

async function displayVersionHistory(applyFilters = false) {
    // Only show loading if actively filtering/loading
    if (applyFilters) {
        setUIState(true, 'Loading version history...');
    }
    const loadingPlaceholder = document.createElement('p');
    loadingPlaceholder.className = 'placeholder-text';
    loadingPlaceholder.textContent = 'Loading history...';
    while (ui.versionHistory.firstChild) {
        ui.versionHistory.removeChild(ui.versionHistory.firstChild);
    }
    ui.versionHistory.appendChild(loadingPlaceholder);

    try {
        const { [SYNC_DATA_KEY]: syncData } = await chrome.storage.sync.get(SYNC_DATA_KEY);
        allHistoryEntries = syncData && syncData.versions ? syncData.versions : [];

        if (allHistoryEntries.length === 0) {
            const noHistoryPlaceholder = document.createElement('p');
            noHistoryPlaceholder.className = 'placeholder-text';
            noHistoryPlaceholder.textContent = 'No version history found in the cloud.';
            while (ui.versionHistory.firstChild) {
                ui.versionHistory.removeChild(ui.versionHistory.firstChild);
            }
            ui.versionHistory.appendChild(noHistoryPlaceholder);
            return;
        }

        let filteredEntries = [...allHistoryEntries];

        const searchTerm = ui.historySearchInput.value.toLowerCase();
        const dateRange = ui.historyDateRange.value;
        let startDate = null;
        let endDate = null;

        if (dateRange === 'custom') {
            startDate = ui.historyStartDate.value ? new Date(ui.historyStartDate.value).getTime() : null;
            endDate = ui.historyEndDate.value ? new Date(ui.historyEndDate.value).setHours(23, 59, 59, 999) : null; // End of day
        } else if (dateRange !== 'all') {
            const now = Date.now();
            if (dateRange === '24h') startDate = now - (24 * 60 * 60 * 1000);
            if (dateRange === '7d') startDate = now - (7 * 24 * 60 * 60 * 1000);
            if (dateRange === '30d') startDate = now - (30 * 24 * 60 * 60 * 1000);
        }

        filteredEntries = filteredEntries.filter(version => {
            const messageContent = JSON.stringify(version.data).toLowerCase() + version.source.toLowerCase();
            const matchesSearch = searchTerm ? messageContent.includes(searchTerm) : true;

            const entryTimestamp = version.timestamp;
            const matchesDate = (startDate ? entryTimestamp >= startDate : true) &&
                                (endDate ? entryTimestamp <= endDate : true);

            return matchesSearch && matchesDate;
        });

        if (filteredEntries.length === 0) {
            const noMatchPlaceholder = document.createElement('p');
            noMatchPlaceholder.className = 'placeholder-text';
            noMatchPlaceholder.textContent = 'No matching history entries found.';
            while (ui.versionHistory.firstChild) {
                ui.versionHistory.removeChild(ui.versionHistory.firstChild);
            }
            ui.versionHistory.appendChild(noMatchPlaceholder);
            return;
        }

        while (ui.versionHistory.firstChild) {
            ui.versionHistory.removeChild(ui.versionHistory.firstChild);
        }
        filteredEntries.forEach(version => {
            const item = document.createElement('div');
            item.className = 'history-item';
            const dataSummary = Object.keys(version.data)
                .map(key => DATA_KEYS_TO_SYNC[key] || key)
                .join(', ');

            const headerDiv = document.createElement('div');
            headerDiv.className = 'history-item-header';

            const timestampSpan = document.createElement('span');
            timestampSpan.className = 'history-timestamp';
            timestampSpan.textContent = new Date(version.timestamp).toLocaleString();

            const restoreBtn = document.createElement('button');
            restoreBtn.className = 'btn secondary restore-version-btn';
            restoreBtn.dataset.timestamp = version.timestamp;
            restoreBtn.textContent = 'Restore';

            headerDiv.appendChild(timestampSpan);
            headerDiv.appendChild(restoreBtn);

            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'history-item-body';

            const sourceStrong = document.createElement('strong');
            sourceStrong.textContent = 'Source:';
            bodyDiv.appendChild(sourceStrong);
            bodyDiv.appendChild(document.createTextNode(` ${version.source} `));
            
            const br = document.createElement('br');
            bodyDiv.appendChild(br);

            const containsStrong = document.createElement('strong');
            containsStrong.textContent = 'Contains:';
            bodyDiv.appendChild(containsStrong);
            bodyDiv.appendChild(document.createTextNode(` ${dataSummary || 'No data'}`));


            item.appendChild(headerDiv);
            item.appendChild(bodyDiv);
            ui.versionHistory.appendChild(item);
        });
        
        document.querySelectorAll('.restore-version-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const timestamp = parseInt(e.target.dataset.timestamp, 10);
                restoreFromCloud(timestamp);
            });
        });

    } catch (error) {
        console.error('Failed to display version history:', error);
        const errorPlaceholder = document.createElement('p');
        errorPlaceholder.className = 'placeholder-text error';
        errorPlaceholder.textContent = 'Could not load version history.';
        while (ui.versionHistory.firstChild) {
            ui.versionHistory.removeChild(ui.versionHistory.firstChild);
        }
        ui.versionHistory.appendChild(errorPlaceholder);
        showToast('Failed to load history.', 'error');
    } finally {
        if (applyFilters) {
            setUIState(false);
        }
    }
}

/**
 * Applies retention policies for both log and history.
 */
async function applyRetentionPolicies() {
    // FIX: Added a robust settings check to prevent TypeError
    const defaults = {
        logRetentionPolicy: MAX_LOG_ENTRIES.toString(),
        historyRetentionPolicy: MAX_VERSIONS.toString()
    };
    const { [SYNC_SETTINGS_KEY]: settings } = await chrome.storage.local.get(SYNC_SETTINGS_KEY);
    const currentSettings = { ...defaults, ...settings };

    const logRetention = currentSettings.logRetentionPolicy;
    const historyRetention = currentSettings.historyRetentionPolicy;

    // Apply log retention
    const { syncLog: currentLog = [] } = await chrome.storage.local.get('syncLog');
    let newLog = [...currentLog];
    if (logRetention === 'never') {
        // Do nothing, keep all
    } else if (logRetention.endsWith('d')) {
        const days = parseInt(logRetention.replace('d', ''), 10);
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        newLog = newLog.filter(entry => entry.timestamp >= cutoff);
    } else { // Numeric, keep last N entries
        const numEntries = parseInt(logRetention, 10);
        if (!isNaN(numEntries) && newLog.length > numEntries) {
            newLog = newLog.slice(0, numEntries);
        }
    }
    if (JSON.stringify(newLog) !== JSON.stringify(currentLog)) { // Only save if changed
        await chrome.storage.local.set({ syncLog: newLog });
        await updateSyncLog(); // Refresh UI
    }

    // Apply history retention (already applied in syncToCloud, but good to have a general cleanup)
    const { [SYNC_DATA_KEY]: syncData } = await chrome.storage.sync.get(SYNC_DATA_KEY);
    if (syncData && syncData.versions) {
        let newVersions = [...syncData.versions];
        if (historyRetention === 'never') {
            // Do nothing, keep all
        } else if (historyRetention.endsWith('d')) {
            const days = parseInt(historyRetention.replace('d', ''), 10);
            const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
            newVersions = newVersions.filter(v => v.timestamp >= cutoff);
        } else { // Numeric, keep last N entries
            const numEntries = parseInt(historyRetention, 10);
            if (!isNaN(numEntries) && newVersions.length > numEntries) {
                newVersions = newVersions.slice(0, numEntries);
            }
        }
        if (JSON.stringify(newVersions) !== JSON.stringify(syncData.versions)) {
            await chrome.storage.sync.set({ [SYNC_DATA_KEY]: { ...syncData, versions: newVersions } });
            await displayVersionHistory(); // Refresh UI
        }
    }
}


// --- Logging ---

async function updateSyncLog(applyFilters = false) {
    // Only show loading if actively filtering/loading
    if (applyFilters) {
        setUIState(true, 'Loading sync log...');
    }

    const loadingPlaceholder = document.createElement('p');
    loadingPlaceholder.className = 'placeholder-text';
    loadingPlaceholder.textContent = 'Loading log...';
    while (ui.syncLog.firstChild) {
        ui.syncLog.removeChild(ui.syncLog.firstChild);
    }
    ui.syncLog.appendChild(loadingPlaceholder);

    try {
        const { syncLog } = await chrome.storage.local.get('syncLog');
        allLogEntries = syncLog || [];

        if (!allLogEntries || allLogEntries.length === 0) {
            const noLogsPlaceholder = document.createElement('p');
            noLogsPlaceholder.className = 'placeholder-text';
            noLogsPlaceholder.textContent = 'No sync events recorded yet.';
            while (ui.syncLog.firstChild) {
                ui.syncLog.removeChild(ui.syncLog.firstChild);
            }
            ui.syncLog.appendChild(noLogsPlaceholder);
            return;
        }

        let filteredLogs = [...allLogEntries];

        const searchTerm = ui.logSearchInput.value.toLowerCase();
        const dateRange = ui.logDateRange.value;
        let startDate = null;
        let endDate = null;

        if (dateRange === 'custom') {
            startDate = ui.logStartDate.value ? new Date(ui.logStartDate.value).getTime() : null;
            endDate = ui.logEndDate.value ? new Date(ui.logEndDate.value).setHours(23, 59, 59, 999) : null; // End of day
        } else if (dateRange !== 'all') {
            const now = Date.now();
            if (dateRange === '24h') startDate = now - (24 * 60 * 60 * 1000);
            if (dateRange === '7d') startDate = now - (7 * 24 * 60 * 60 * 1000);
            if (dateRange === '30d') startDate = now - (30 * 24 * 60 * 60 * 1000);
        }

        filteredLogs = filteredLogs.filter(entry => {
            const messageContent = entry.message.toLowerCase() + entry.type.toLowerCase();
            const matchesSearch = searchTerm ? messageContent.includes(searchTerm) : true;

            const entryTimestamp = entry.timestamp;
            const matchesDate = (startDate ? entryTimestamp >= startDate : true) &&
                                (endDate ? entryTimestamp <= endDate : true);

            return matchesSearch && matchesDate;
        });
        
        if (filteredLogs.length === 0) {
            const noMatchPlaceholder = document.createElement('p');
            noMatchPlaceholder.className = 'placeholder-text';
            noMatchPlaceholder.textContent = 'No matching log entries found.';
            while (ui.syncLog.firstChild) {
                ui.syncLog.removeChild(ui.syncLog.firstChild);
            }
            ui.syncLog.appendChild(noMatchPlaceholder);
            return;
        }
        
        while (ui.syncLog.firstChild) {
            ui.syncLog.removeChild(ui.syncLog.firstChild);
        }
        filteredLogs.forEach(entry => {
            const logDiv = document.createElement('div');
            logDiv.className = 'log-entry';

            const headerDiv = document.createElement('div');
            headerDiv.className = 'log-header';

            const timestampSpan = document.createElement('span');
            timestampSpan.className = 'log-timestamp';
            timestampSpan.textContent = new Date(entry.timestamp).toLocaleString();

            const statusIndicatorSpan = document.createElement('span');
            statusIndicatorSpan.className = `status-indicator ${entry.type}`;
            statusIndicatorSpan.textContent = entry.type;

            headerDiv.appendChild(timestampSpan);
            headerDiv.appendChild(statusIndicatorSpan);
            logDiv.appendChild(headerDiv);

            const messageParagraph = document.createElement('p');
            messageParagraph.className = `log-message ${entry.type}`;
            messageParagraph.textContent = entry.message;
            logDiv.appendChild(messageParagraph);

            if (entry.details) {
                logDiv.classList.add('has-details');
                const toggleButton = document.createElement('button');
                toggleButton.className = 'toggle-details-btn';
                toggleButton.textContent = 'Show Details';
                logDiv.appendChild(toggleButton);

                const detailsDiv = document.createElement('div');
                detailsDiv.className = 'log-message-details';
                detailsDiv.textContent = entry.details;
                logDiv.appendChild(detailsDiv);

                toggleButton.addEventListener('click', function() {
                    logDiv.classList.toggle('expanded');
                    this.textContent = logDiv.classList.contains('expanded') ? 'Hide Details' : 'Show Details';
                });
            }
            ui.syncLog.prepend(logDiv);
        });
    } catch (error) {
        console.error("Could not update sync log:", error);
    } finally {
        if (applyFilters) {
            setUIState(false);
        }
    }
}

async function addLogEntry(message, type = 'info', details = '') {
    try {
        const { syncLog: currentLog = [] } = await chrome.storage.local.get('syncLog');
        const newEntry = { timestamp: Date.now(), message, type, details };
        let newLog = [newEntry, ...currentLog];

        // Apply log retention after adding new entry
        const { [SYNC_SETTINGS_KEY]: settings } = await chrome.storage.local.get(SYNC_SETTINGS_KEY);
        const logRetention = settings?.logRetentionPolicy || MAX_LOG_ENTRIES.toString(); // Use optional chaining for safety

        if (logRetention === 'never') {
            // Do nothing, keep all
        } else if (logRetention.endsWith('d')) {
            const days = parseInt(logRetention.replace('d', ''), 10);
            const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
            newLog = newLog.filter(entry => entry.timestamp >= cutoff);
        } else { // Numeric (e.g., '100') means keep last N entries
            const numEntries = parseInt(logRetention, 10);
            if (!isNaN(numEntries) && newLog.length > numEntries) {
                newLog = newLog.slice(0, numEntries);
            }
        }

        await chrome.storage.local.set({ syncLog: newLog });
        await updateSyncLog(true); // Always refresh log UI after adding/cleaning
    } catch (error) {
        console.error('Failed to add log entry:', error);
    }
}


// --- UI Helpers (Modals, Toasts, State, Tooltips, Debounce) ---

/**
 * Debounce function to limit how often a function is called.
 * @param {Function} func The function to debounce.
 * @param {number} delay The delay in milliseconds.
 * @returns {Function} A new function that will be debounced.
 */
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

function setUIState(isLoading, message = '') {
    const buttons = [ui.syncNowBtn, ui.restoreBtn, ui.clearSyncBtn, ui.exportHistoryBtn, ui.exportLogBtn]; // Updated buttons
    buttons.forEach(btn => btn.disabled = isLoading);
    
    // Disable/enable filter inputs
    const filterInputs = [
        ui.historySearchInput, ui.historyDateRange, ui.historyStartDate, ui.historyEndDate,
        ui.logSearchInput, ui.logDateRange, ui.logStartDate, ui.logEndDate,
        ui.logRetentionPolicy, ui.historyRetentionPolicy, // Also disable retention policy selectors during loading
        ui.enableAutoSync, ui.syncOnStartup, ui.syncInterval, // Options panel inputs
        ...document.querySelectorAll('#selectiveSyncOptions input[type="checkbox"]') // Selective sync checkboxes
    ];
    filterInputs.forEach(input => input.disabled = isLoading);


    if (isLoading) {
        const actionableButtons = [ui.syncNowBtn, ui.restoreBtn, ui.clearSyncBtn];
        actionableButtons.forEach(activeBtn => {
             if(activeBtn) {
                activeBtn.dataset.originalText = activeBtn.textContent;
                const loadingIcon = document.createElement('span');
                loadingIcon.className = 'icon loading';
                activeBtn.textContent = ''; // Clear text
                activeBtn.appendChild(loadingIcon);
                activeBtn.appendChild(document.createTextNode(activeBtn.dataset.originalText));
            }
        });

        if (message) updateStatusMessage(message, 'info');
    } else {
        const actionableButtons = [ui.syncNowBtn, ui.restoreBtn, ui.clearSyncBtn];
        actionableButtons.forEach(btn => {
            if (btn.dataset.originalText) {
                while (btn.firstChild) {
                    btn.removeChild(btn.firstChild);
                }
                btn.textContent = btn.dataset.originalText;
                delete btn.dataset.originalText;
            }
        });
    }
}

function updateStatusMessage(message, type) {
    ui.statusMessage.textContent = message;
    ui.statusMessage.className = `status-message ${type}`;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const iconSpan = document.createElement('span');
    iconSpan.className = `icon icon-${type === 'error' ? 'error' : type === 'success' ? 'check' : 'info'}`;
    const messageText = document.createTextNode(` ${message}`);
    toast.appendChild(iconSpan);
    toast.appendChild(messageText);
    ui.toastContainer.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 4000);
}

function showConfirmDialog(title, message, okText = 'OK') {
    return new Promise(resolve => {
        const dialog = ui.confirmDialog;
        dialog.title.textContent = title;
        dialog.message.textContent = message;
        dialog.okBtn.textContent = okText;
        dialog.okBtn.className = okText === 'Clear Data' ? 'btn danger' : 'btn primary';

        dialog.overlay.classList.add('active');

        const close = (value) => {
            dialog.overlay.classList.remove('active');
            dialog.okBtn.onclick = null;
            dialog.cancelBtn.onclick = null;
            resolve(value);
        };

        dialog.okBtn.onclick = () => close(true);
        dialog.cancelBtn.onclick = () => close(false);
    });
}

function showConflictDialog() {
    return new Promise(resolve => {
        const dialog = ui.conflictDialog;
        dialog.overlay.classList.add('active');
        
        const close = (value) => {
            dialog.overlay.classList.remove('active');
            dialog.keepLocalBtn.onclick = null;
            dialog.keepCloudBtn.onclick = null;
            resolve(value);
        };

        dialog.keepLocalBtn.onclick = () => close('local');
        dialog.keepCloudBtn.onclick = () => close('cloud');
    });
}

function handleStorageChange(changes, areaName) {
    if (areaName === 'sync' && changes[SYNC_DATA_KEY]) {
        console.log("Sync data changed in another context. Updating status.");
        showToast("Sync data was updated in the background.", "info");
        updateSyncStatus();
        // If the active panel is history, refresh it
        if (document.getElementById('history-panel').classList.contains('active')) {
            displayVersionHistory(true);
        }
    }
    if (areaName === 'local' && (changes.syncLog || changes[SYNC_SETTINGS_KEY])) {
        console.log("Local log or settings changed. Updating UI.");
        if (changes.syncLog) {
            // If the active panel is log, refresh it
            if (document.getElementById('log-panel').classList.contains('active')) {
                updateSyncLog(true);
            }
        }
        if (changes[SYNC_SETTINGS_KEY]) {
            loadAndApplySettings();
            applyRetentionPolicies(); // Re-apply retention if settings change
        }
    }
}

/**
 * Sets up dynamic tooltips for elements with `data-tooltip-id`.
 */
function setupTooltips() {
    const tooltipElements = document.querySelectorAll('[data-tooltip-id]');
    tooltipElements.forEach(element => {
        const tooltipId = element.dataset.tooltipId;
        const tooltip = document.getElementById(tooltipId);
        if (tooltip) {
            // Position the tooltip relative to the detail-item parent
            const parentDetailItem = element.closest('.detail-item');
            if (parentDetailItem) {
                parentDetailItem.style.position = 'relative'; // Ensure parent is positioned
                parentDetailItem.appendChild(tooltip); // Move tooltip inside parent for positioning context
            }
        }
    });
}


/**
 * Exports data to a CSV file.
 * @param {Array<Object>} data - The array of objects to export.
 * @param {string} filename - The desired filename (without extension).
 */
function exportDataToCSV(data, filename) {
    if (data.length === 0) {
        showToast("No data to export.", "info");
        return;
    }

    // Prepare CSV header
    const headers = Object.keys(data[0]);
    const csvRows = [];
    csvRows.push(headers.map(header => `"${header}"`).join(','));

    // Prepare CSV rows
    for (const row of data) {
        const values = headers.map(header => {
            const value = row[header];
            // Handle objects/arrays by stringifying them
            if (typeof value === 'object' && value !== null) {
                return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
            }
            return `"${String(value).replace(/"/g, '""')}"`; // Escape double quotes
        });
        csvRows.push(values.join(','));
    }

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${data.length} entries to ${filename}.csv`, "success");
}
