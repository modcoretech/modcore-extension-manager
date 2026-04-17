/**
 * @file cloud.js
 * modcore Cloud - UI logic for the cloud sync page.
 */

'use strict';

// ==========================================================================
// Constants
// ==========================================================================

const SYNC_QUOTA_BYTES = 102400; // 100 KB
const SYNC_DATA_KEY    = 'fullSyncData';
const SYNC_SETTINGS_KEY = 'cloudSyncSettings';

// Hard maximums - enforced regardless of user retention policy setting.
const HARD_MAX_VERSIONS   = 25;
const HARD_MAX_LOG_ENTRIES = 500;

// Default soft limits (overridden by user settings).
const DEFAULT_MAX_VERSIONS    = 10;
const DEFAULT_MAX_LOG_ENTRIES = 100;

const DEBOUNCE_DELAY = 320; // ms

const DATA_KEYS_TO_SYNC = {
    rules:                       'Automation Rules',
    extensionManagerProfiles_v2: 'Profiles',
    extensionManagerPrefs:       'Preferences',
};

// ==========================================================================
// Module-level state
// ==========================================================================

let ui = {};
let allLogEntries     = [];
let allHistoryEntries = [];
let activeRecordsTab  = 'history'; // 'history' | 'log'
let _searchDebounceTimer = null;

// ==========================================================================
// Initialization
// ==========================================================================

document.addEventListener('DOMContentLoaded', initializeSyncPage);

async function initializeSyncPage() {
    mapUI();
    bindEventListeners();
    await loadAndApplySettings();
    await updateSyncStatus();
}

// ==========================================================================
// UI Mapping
// ==========================================================================

function mapUI() {
    ui = {
        // Navigation
        sidebarButtons:  document.querySelectorAll('.sidebar-button'),
        contentPanels:   document.querySelectorAll('.content-panel'),

        // Status
        chromeSyncStatus:         document.getElementById('chromeSyncStatus'),
        extensionSyncStatus:      document.getElementById('extensionSyncStatus'),
        lastSyncTimestamp:        document.getElementById('lastSyncTimestamp'),
        syncProgressBar:          document.getElementById('syncProgressBar'),
        syncProgress:             document.getElementById('syncProgress'),
        syncProgressText:         document.getElementById('syncProgressText'),
        totalBytesUsed:           document.getElementById('totalBytesUsed'),
        statusMessage:            document.getElementById('statusMessage'),
        quotaBreakdown:           document.getElementById('quotaBreakdown'),

        // Options
        selectiveSyncOptions:     document.getElementById('selectiveSyncOptions'),
        enableAutoSync:           document.getElementById('enableAutoSync'),
        syncInterval:             document.getElementById('syncInterval'),
        historyRetentionPolicy:   document.getElementById('historyRetentionPolicy'),
        logRetentionPolicy:       document.getElementById('logRetentionPolicy'),
        exportHistoryBtn:         document.getElementById('exportHistoryBtn'),
        exportLogBtn:             document.getElementById('exportLogBtn'),

        // Actions
        syncNowBtn:    document.getElementById('syncNowBtn'),
        restoreBtn:    document.getElementById('restoreBtn'),
        clearSyncBtn:  document.getElementById('clearSyncBtn'),

        // Records panel (unified)
        recordsTabs:             document.querySelectorAll('.records-tab'),
        historyPane:             document.getElementById('records-history-pane'),
        logPane:                 document.getElementById('records-log-pane'),
        versionHistory:          document.getElementById('versionHistory'),
        syncLog:                 document.getElementById('syncLog'),

        // Shared filter controls
        recordsSearchInput:      document.getElementById('recordsSearchInput'),
        recordsDateRange:        document.getElementById('recordsDateRange'),
        recordsCustomDateRange:  document.getElementById('recordsCustomDateRange'),
        recordsStartDate:        document.getElementById('recordsStartDate'),
        recordsEndDate:          document.getElementById('recordsEndDate'),

        // Dialogs
        confirmDialog: {
            overlay:   document.getElementById('confirmDialogOverlay'),
            title:     document.getElementById('confirmDialogTitle'),
            message:   document.getElementById('confirmDialogMessage'),
            okBtn:     document.getElementById('confirmOkBtn'),
            cancelBtn: document.getElementById('confirmCancelBtn'),
        },
        conflictDialog: {
            overlay:       document.getElementById('conflictDialogOverlay'),
            keepLocalBtn:  document.getElementById('conflictKeepLocalBtn'),
            keepCloudBtn:  document.getElementById('conflictKeepCloudBtn'),
        },

        toastContainer: document.getElementById('toast-container'),
    };

    populateSelectiveSyncOptions();
}

function populateSelectiveSyncOptions() {
    const container = ui.selectiveSyncOptions;
    clearChildren(container);

    for (const [key, name] of Object.entries(DATA_KEYS_TO_SYNC)) {
        const item  = document.createElement('div');
        item.className = 'option-item';

        const label = document.createElement('label');
        label.setAttribute('for', `sync-${key}`);

        const input = document.createElement('input');
        input.type         = 'checkbox';
        input.id           = `sync-${key}`;
        input.dataset.key  = key;
        input.checked      = true; // default; overridden by loadAndApplySettings

        label.appendChild(input);
        label.appendChild(document.createTextNode(` ${name}`));
        item.appendChild(label);
        container.appendChild(item);
    }
}

// ==========================================================================
// Event Binding
// ==========================================================================

function bindEventListeners() {
    // Sidebar navigation
    ui.sidebarButtons.forEach(button => {
        button.addEventListener('click', () => {
            const panelId = button.dataset.panel;
            switchPanel(panelId);
            if (panelId === 'records-panel') {
                refreshActiveRecordsTab(true);
            }
        });
    });

    // Options
    ui.enableAutoSync.addEventListener('change', saveSyncSettings);
    ui.syncInterval.addEventListener('change', saveSyncSettings);
    ui.historyRetentionPolicy.addEventListener('change', saveSyncSettings);
    ui.logRetentionPolicy.addEventListener('change', saveSyncSettings);
    ui.selectiveSyncOptions.addEventListener('change', saveSyncSettings);

    ui.exportHistoryBtn.addEventListener('click', () => exportDataAsJSON(allHistoryEntries, 'sync_history'));
    ui.exportLogBtn.addEventListener('click',     () => exportDataAsJSON(allLogEntries,     'sync_log'));

    // Actions
    ui.syncNowBtn.addEventListener('click',   () => syncToCloud(false));
    ui.restoreBtn.addEventListener('click',   () => restoreFromCloud(null));
    ui.clearSyncBtn.addEventListener('click', confirmClearCloudData);

    // Records tab switching
    ui.recordsTabs.forEach(tab => {
        tab.addEventListener('click', () => switchRecordsTab(tab.dataset.tab));
        tab.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                switchRecordsTab(tab.dataset.tab);
            }
        });
    });

    // Shared filter controls - debounced search, immediate date
    ui.recordsSearchInput.addEventListener('input', () => {
        clearTimeout(_searchDebounceTimer);
        _searchDebounceTimer = setTimeout(() => refreshActiveRecordsTab(false), DEBOUNCE_DELAY);
    });

    ui.recordsDateRange.addEventListener('change', () => {
        const isCustom = ui.recordsDateRange.value === 'custom';
        ui.recordsCustomDateRange.hidden = !isCustom;
        refreshActiveRecordsTab(false);
    });

    ui.recordsStartDate.addEventListener('change', () => refreshActiveRecordsTab(false));
    ui.recordsEndDate.addEventListener('change',   () => refreshActiveRecordsTab(false));

    // React to storage changes from other contexts
    chrome.storage.onChanged.addListener(handleStorageChange);
}

// ==========================================================================
// Panel & Tab Navigation
// ==========================================================================

function switchPanel(panelId) {
    ui.sidebarButtons.forEach(btn => {
        const isActive = btn.dataset.panel === panelId;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
    ui.contentPanels.forEach(panel => {
        panel.classList.toggle('active', panel.id === panelId);
    });
}

function switchRecordsTab(tabName) {
    activeRecordsTab = tabName;

    ui.recordsTabs.forEach(tab => {
        const isActive = tab.dataset.tab === tabName;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
    });

    const showHistory = tabName === 'history';
    ui.historyPane.hidden = !showHistory;
    ui.logPane.hidden     = showHistory;

    refreshActiveRecordsTab(true);
}

function refreshActiveRecordsTab(fetchFresh) {
    if (activeRecordsTab === 'history') {
        displayVersionHistory(fetchFresh);
    } else {
        displaySyncLog(fetchFresh);
    }
}

// ==========================================================================
// Settings
// ==========================================================================

async function loadAndApplySettings() {
    try {
        const stored = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
        const settings = stored[SYNC_SETTINGS_KEY] || {};

        const defaults = {
            autoSyncEnabled:        false,
            syncInterval:           60,
            selectiveSync:          Object.keys(DATA_KEYS_TO_SYNC).reduce((acc, k) => ({ ...acc, [k]: true }), {}),
            lastSyncTimestamp:      null,
            logRetentionPolicy:     String(DEFAULT_MAX_LOG_ENTRIES),
            historyRetentionPolicy: String(DEFAULT_MAX_VERSIONS),
        };

        const s = { ...defaults, ...settings };

        ui.enableAutoSync.checked = s.autoSyncEnabled;
        ui.syncInterval.value     = String(s.syncInterval);

        ui.lastSyncTimestamp.textContent = s.lastSyncTimestamp
            ? new Date(s.lastSyncTimestamp).toLocaleString()
            : 'Never';

        ui.extensionSyncStatus.textContent = s.autoSyncEnabled ? 'Enabled' : 'Disabled';
        ui.extensionSyncStatus.className   = `detail-value status-indicator ${s.autoSyncEnabled ? 'success' : 'error'}`;

        setSelectValue(ui.logRetentionPolicy,     s.logRetentionPolicy);
        setSelectValue(ui.historyRetentionPolicy, s.historyRetentionPolicy);

        for (const [key, enabled] of Object.entries(s.selectiveSync)) {
            const cb = document.getElementById(`sync-${key}`);
            if (cb) cb.checked = enabled;
        }
    } catch (err) {
        console.error('loadAndApplySettings:', err);
        showToast('Could not load sync settings.', 'error');
    }
}

async function saveSyncSettings() {
    try {
        const selectiveSync = {};
        document.querySelectorAll('#selectiveSyncOptions input[type="checkbox"]').forEach(cb => {
            selectiveSync[cb.dataset.key] = cb.checked;
        });

        const settings = {
            autoSyncEnabled:        ui.enableAutoSync.checked,
            syncInterval:           parseInt(ui.syncInterval.value, 10) || 60,
            selectiveSync,
            logRetentionPolicy:     ui.logRetentionPolicy.value,
            historyRetentionPolicy: ui.historyRetentionPolicy.value,
        };

        // Preserve lastSyncTimestamp
        const stored = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
        const existing = stored[SYNC_SETTINGS_KEY] || {};
        settings.lastSyncTimestamp = existing.lastSyncTimestamp || null;

        await chromeStorageSet('local', { [SYNC_SETTINGS_KEY]: settings });

        // Notify service worker to reschedule alarm
        try {
            chrome.runtime.sendMessage({ type: 'UPDATE_SYNC_ALARM' });
        } catch (_) { /* non-critical */ }

        showToast('Settings saved.', 'success');
        await loadAndApplySettings();
        await applyRetentionPolicies();
    } catch (err) {
        console.error('saveSyncSettings:', err);
        showToast('Failed to save settings.', 'error');
    }
}

// ==========================================================================
// Sync Status
// ==========================================================================

async function updateSyncStatus() {
    setStatusLoading(true, 'Checking sync status…');
    try {
        // Heuristic: try a small test write to detect if Chrome Sync is active
        let chromeSyncActive = false;
        try {
            await chrome.storage.sync.set({ _mcTest: 1 });
            await chrome.storage.sync.remove('_mcTest');
            chromeSyncActive = true;
        } catch (_) {
            chromeSyncActive = false;
        }

        ui.chromeSyncStatus.textContent = chromeSyncActive ? 'Active' : 'Inactive';
        ui.chromeSyncStatus.className   = `detail-value status-indicator ${chromeSyncActive ? 'success' : 'warning'}`;

        const bytesInUse = await chrome.storage.sync.getBytesInUse(null);
        const percentage = Math.min((bytesInUse / SYNC_QUOTA_BYTES) * 100, 100);

        ui.syncProgress.style.width = `${percentage}%`;
        ui.syncProgressText.textContent = `${(bytesInUse / 1024).toFixed(1)} KB / 100 KB`;
        ui.totalBytesUsed.textContent = bytesInUse.toLocaleString();
        ui.syncProgressBar.setAttribute('aria-valuenow', bytesInUse);

        ui.syncProgress.classList.remove('warning', 'error');
        if (percentage > 90) {
            ui.syncProgress.classList.add('error');
            setStatusMessage('Sync quota critically high. Clear data or reduce synced items.', 'error');
        } else if (percentage > 75) {
            ui.syncProgress.classList.add('warning');
            setStatusMessage('Approaching sync quota limit.', 'warning');
        } else {
            setStatusMessage('Sync storage usage is healthy.', 'success');
        }

        const syncRaw = await chromeStorageGet('sync', SYNC_DATA_KEY);
        const latestData = syncRaw[SYNC_DATA_KEY]?.versions?.[0]?.data ?? null;
        renderQuotaBreakdown(latestData);

    } catch (err) {
        console.error('updateSyncStatus:', err);
        setStatusMessage(`Could not retrieve sync status: ${err.message}`, 'error');
    } finally {
        setStatusLoading(false);
    }
}

function renderQuotaBreakdown(latestData) {
    clearChildren(ui.quotaBreakdown);

    if (!latestData) {
        ui.quotaBreakdown.appendChild(makePlaceholder('No data synced yet.'));
        return;
    }

    const items = Object.entries(latestData)
        .filter(([, v]) => v !== undefined)
        .map(([key, value]) => ({
            name: DATA_KEYS_TO_SYNC[key] || key,
            size: new TextEncoder().encode(JSON.stringify(value)).length,
        }))
        .sort((a, b) => b.size - a.size);

    if (items.length === 0) {
        ui.quotaBreakdown.appendChild(makePlaceholder('No data selected for syncing.'));
        return;
    }

    items.forEach(({ name, size }) => {
        const row = document.createElement('div');
        row.className = 'quota-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'quota-item-name';
        nameSpan.textContent = name;

        const sizeSpan = document.createElement('span');
        sizeSpan.className = 'quota-item-size';
        sizeSpan.textContent = `${(size / 1024).toFixed(2)} KB`;

        row.appendChild(nameSpan);
        row.appendChild(sizeSpan);
        ui.quotaBreakdown.appendChild(row);
    });
}

// ==========================================================================
// Sync to Cloud
// ==========================================================================

async function syncToCloud(isAutomatic = false) {
    setActionLoading(true, 'Syncing data to cloud…');
    try {
        const settingsRaw = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
        const settings = settingsRaw[SYNC_SETTINGS_KEY];

        if (!settings?.selectiveSync) {
            throw new Error('Sync settings not configured. Please check Options.');
        }

        const keysToSync = Object.keys(settings.selectiveSync).filter(k => settings.selectiveSync[k]);
        if (keysToSync.length === 0) {
            throw new Error('No data categories selected for syncing.');
        }

        const localData = await chromeStorageGet('local', ...keysToSync);
        const newVersion = {
            timestamp: Date.now(),
            data:      localData,
            source:    isAutomatic ? 'Automatic' : 'Manual',
        };

        const syncRaw  = await chromeStorageGet('sync', SYNC_DATA_KEY);
        const syncData = syncRaw[SYNC_DATA_KEY] || { versions: [] };

        syncData.versions.unshift(newVersion);
        syncData.versions = applyHistoryRetention(syncData.versions, settings.historyRetentionPolicy);

        // Estimate size before writing to guard against quota
        const estimatedSize = new TextEncoder().encode(JSON.stringify({ [SYNC_DATA_KEY]: syncData })).length;
        if (estimatedSize > SYNC_QUOTA_BYTES) {
            // Auto-trim more aggressively
            while (syncData.versions.length > 1) {
                syncData.versions.pop();
                const sz = new TextEncoder().encode(JSON.stringify({ [SYNC_DATA_KEY]: syncData })).length;
                if (sz <= SYNC_QUOTA_BYTES * 0.95) break;
            }
            showToast('History was trimmed to fit quota.', 'warning');
        }

        await chrome.storage.sync.set({ [SYNC_DATA_KEY]: syncData });
        await chromeStorageSet('local', {
            [SYNC_SETTINGS_KEY]: { ...settings, lastSyncTimestamp: Date.now() },
        });

        await addLogEntry('Sync to cloud successful.', 'success');
        showToast('Sync complete!', 'success');

    } catch (err) {
        console.error('syncToCloud:', err);
        const msg = friendlyStorageError(err);
        await addLogEntry(`Sync failed: ${msg}`, 'error');
        showToast(`Sync failed: ${msg}`, 'error');
    } finally {
        setActionLoading(false);
        await updateSyncStatus();
        await loadAndApplySettings();
        if (activeRecordsTab === 'history') displayVersionHistory(true);
    }
}

// ==========================================================================
// Restore from Cloud
// ==========================================================================

async function restoreFromCloud(versionTimestamp) {
    const confirmed = await showConfirmDialog(
        'Restore from Cloud?',
        'This will overwrite your current local data with the selected cloud version. This action cannot be undone.'
    );
    if (!confirmed) return;

    setActionLoading(true, 'Restoring from cloud…');
    try {
        const syncRaw = await chromeStorageGet('sync', SYNC_DATA_KEY);
        const syncData = syncRaw[SYNC_DATA_KEY];

        if (!syncData?.versions?.length) {
            throw new Error('No data found in the cloud to restore.');
        }

        let versionToRestore;
        if (versionTimestamp != null) {
            versionToRestore = syncData.versions.find(v => v.timestamp === versionTimestamp);
        } else {
            versionToRestore = syncData.versions[0];
        }

        if (!versionToRestore) {
            throw new Error('Specified version not found.');
        }

        // Conflict check: if we're restoring the latest and local has been updated since
        if (versionTimestamp == null) {
            const settingsRaw = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
            const settings    = settingsRaw[SYNC_SETTINGS_KEY];
            if (settings?.lastSyncTimestamp && versionToRestore.timestamp < settings.lastSyncTimestamp) {
                const choice = await showConflictDialog();
                if (choice === 'local') {
                    showToast('Restore cancelled. Local data kept.', 'info');
                    return;
                }
            }
        }

        await chromeStorageSet('local', versionToRestore.data);
        await addLogEntry(`Restored from version: ${new Date(versionToRestore.timestamp).toLocaleString()}`, 'success');
        showToast('Restore complete!', 'success');
        await loadAndApplySettings();

    } catch (err) {
        console.error('restoreFromCloud:', err);
        await addLogEntry(`Restore failed: ${err.message}`, 'error');
        showToast(`Restore failed: ${err.message}`, 'error');
    } finally {
        setActionLoading(false);
        await updateSyncStatus();
    }
}

// ==========================================================================
// Clear Cloud Data
// ==========================================================================

async function confirmClearCloudData() {
    const confirmed = await showConfirmDialog(
        '⚠️ Clear All Cloud Data?',
        'This will permanently delete ALL synced extension data from your Google account. This cannot be undone.',
        'Clear Data'
    );
    if (!confirmed) return;

    setActionLoading(true, 'Clearing cloud data…');
    try {
        await chrome.storage.sync.remove(SYNC_DATA_KEY);
        await addLogEntry('All cloud data permanently cleared.', 'success');
        showToast('Cloud data cleared.', 'success');
    } catch (err) {
        console.error('confirmClearCloudData:', err);
        await addLogEntry(`Clear failed: ${err.message}`, 'error');
        showToast(`Clear failed: ${err.message}`, 'error');
    } finally {
        setActionLoading(false);
        await updateSyncStatus();
        displayVersionHistory(true);
    }
}

// ==========================================================================
// Version History
// ==========================================================================

async function displayVersionHistory(fetchFresh) {
    setPlaceholder(ui.versionHistory, 'Loading history…');

    try {
        if (fetchFresh) {
            const raw = await chromeStorageGet('sync', SYNC_DATA_KEY);
            allHistoryEntries = raw[SYNC_DATA_KEY]?.versions ?? [];
        }

        const filtered = applyFilters(allHistoryEntries, (entry) => {
            return JSON.stringify(entry.data).toLowerCase() + ' ' + (entry.source || '').toLowerCase();
        });

        if (filtered === null) return; // waiting for custom date inputs

        clearChildren(ui.versionHistory);

        if (allHistoryEntries.length === 0) {
            ui.versionHistory.appendChild(makePlaceholder('No version history found in the cloud.'));
            return;
        }

        if (filtered.length === 0) {
            ui.versionHistory.appendChild(makePlaceholder('No matching history entries.'));
            return;
        }

        const fragment = document.createDocumentFragment();
        filtered.forEach(version => {
            fragment.appendChild(buildHistoryItem(version));
        });
        ui.versionHistory.appendChild(fragment);

    } catch (err) {
        console.error('displayVersionHistory:', err);
        clearChildren(ui.versionHistory);
        const p = makePlaceholder('Could not load version history.');
        p.classList.add('error-text');
        ui.versionHistory.appendChild(p);
        showToast('Failed to load history.', 'error');
    }
}

function buildHistoryItem(version) {
    const dataSummary = Object.keys(version.data || {})
        .map(k => DATA_KEYS_TO_SYNC[k] || k)
        .join(', ') || 'No data';

    const item = document.createElement('div');
    item.className = 'history-item';

    // Header row
    const header = document.createElement('div');
    header.className = 'history-item-header';

    const ts = document.createElement('span');
    ts.className = 'history-timestamp';
    ts.textContent = new Date(version.timestamp).toLocaleString();
    header.appendChild(ts);

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn secondary';
    restoreBtn.style.padding = '6px 12px';
    restoreBtn.style.fontSize = 'var(--body-small)';
    restoreBtn.textContent = 'Restore this version';
    restoreBtn.addEventListener('click', () => restoreFromCloud(version.timestamp));
    header.appendChild(restoreBtn);

    item.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'history-item-body';

    const sourceLine = document.createElement('span');
    sourceLine.appendChild(makeStrong('Source: '));
    sourceLine.appendChild(document.createTextNode(version.source || 'Unknown'));

    const containsLine = document.createElement('span');
    containsLine.appendChild(makeStrong('  ·  Contains: '));
    containsLine.appendChild(document.createTextNode(dataSummary));

    body.appendChild(sourceLine);
    body.appendChild(containsLine);
    item.appendChild(body);

    return item;
}

// ==========================================================================
// Sync Log
// ==========================================================================

async function displaySyncLog(fetchFresh) {
    setPlaceholder(ui.syncLog, 'Loading log…');

    try {
        if (fetchFresh) {
            const raw = await chromeStorageGet('local', 'syncLog');
            allLogEntries = raw.syncLog ?? [];
        }

        const filtered = applyFilters(allLogEntries, (entry) => {
            return (entry.message || '').toLowerCase() + ' ' + (entry.type || '').toLowerCase();
        });

        if (filtered === null) return;

        clearChildren(ui.syncLog);

        if (allLogEntries.length === 0) {
            ui.syncLog.appendChild(makePlaceholder('No sync events recorded yet.'));
            return;
        }

        if (filtered.length === 0) {
            ui.syncLog.appendChild(makePlaceholder('No matching log entries.'));
            return;
        }

        const fragment = document.createDocumentFragment();
        filtered.forEach(entry => {
            fragment.appendChild(buildLogEntry(entry));
        });
        ui.syncLog.appendChild(fragment);

    } catch (err) {
        console.error('displaySyncLog:', err);
        clearChildren(ui.syncLog);
        const p = makePlaceholder('Could not load sync log.');
        p.classList.add('error-text');
        ui.syncLog.appendChild(p);
    }
}

function buildLogEntry(entry) {
    const div = document.createElement('div');
    div.className = 'log-entry';

    const header = document.createElement('div');
    header.className = 'log-header';

    const ts = document.createElement('span');
    ts.className = 'log-timestamp';
    ts.textContent = new Date(entry.timestamp).toLocaleString();
    header.appendChild(ts);

    const badge = document.createElement('span');
    badge.className = `status-indicator ${entry.type || 'info'}`;
    badge.textContent = entry.type || 'info';
    header.appendChild(badge);

    div.appendChild(header);

    const msg = document.createElement('p');
    msg.className = `log-message ${entry.type || ''}`;
    msg.textContent = entry.message || '';
    div.appendChild(msg);

    if (entry.details) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'toggle-details-btn';
        toggleBtn.textContent = 'Show details';
        toggleBtn.setAttribute('aria-expanded', 'false');
        div.appendChild(toggleBtn);

        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'log-message-details';
        detailsDiv.textContent = entry.details;
        detailsDiv.id = `log-detail-${entry.timestamp}`;
        div.appendChild(detailsDiv);

        toggleBtn.setAttribute('aria-controls', detailsDiv.id);
        toggleBtn.addEventListener('click', () => {
            const expanded = div.classList.toggle('expanded');
            toggleBtn.textContent = expanded ? 'Hide details' : 'Show details';
            toggleBtn.setAttribute('aria-expanded', String(expanded));
        });
    }

    return div;
}

// ==========================================================================
// Add Log Entry
// ==========================================================================

async function addLogEntry(message, type = 'info', details = '') {
    try {
        const raw = await chromeStorageGet('local', 'syncLog');
        const currentLog = raw.syncLog ?? [];

        const newEntry = { timestamp: Date.now(), message, type, ...(details ? { details } : {}) };
        let newLog = [newEntry, ...currentLog];

        const settingsRaw = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
        const retention   = settingsRaw[SYNC_SETTINGS_KEY]?.logRetentionPolicy ?? String(DEFAULT_MAX_LOG_ENTRIES);
        newLog = applyLogRetention(newLog, retention);

        await chromeStorageSet('local', { syncLog: newLog });
        allLogEntries = newLog;

        if (activeRecordsTab === 'log') {
            displaySyncLog(false);
        }
    } catch (err) {
        console.error('addLogEntry:', err);
    }
}

// ==========================================================================
// Retention Helpers
// ==========================================================================

function applyHistoryRetention(versions, policy) {
    let result = [...versions];
    policy = policy || String(DEFAULT_MAX_VERSIONS);

    if (policy.endsWith('d')) {
        const days   = parseInt(policy, 10);
        const cutoff = Date.now() - days * 864e5;
        result = result.filter(v => v.timestamp >= cutoff);
    } else {
        const n = parseInt(policy, 10) || DEFAULT_MAX_VERSIONS;
        result = result.slice(0, n);
    }

    // Enforce hard max regardless of policy
    return result.slice(0, HARD_MAX_VERSIONS);
}

function applyLogRetention(entries, policy) {
    let result = [...entries];
    policy = policy || String(DEFAULT_MAX_LOG_ENTRIES);

    if (policy.endsWith('d')) {
        const days   = parseInt(policy, 10);
        const cutoff = Date.now() - days * 864e5;
        result = result.filter(e => e.timestamp >= cutoff);
    } else {
        const n = parseInt(policy, 10) || DEFAULT_MAX_LOG_ENTRIES;
        result = result.slice(0, n);
    }

    return result.slice(0, HARD_MAX_LOG_ENTRIES);
}

async function applyRetentionPolicies() {
    try {
        const settingsRaw = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
        const settings    = settingsRaw[SYNC_SETTINGS_KEY] || {};
        const logPolicy   = settings.logRetentionPolicy     || String(DEFAULT_MAX_LOG_ENTRIES);
        const histPolicy  = settings.historyRetentionPolicy || String(DEFAULT_MAX_VERSIONS);

        // Log
        const logRaw = await chromeStorageGet('local', 'syncLog');
        const currentLog = logRaw.syncLog ?? [];
        const trimmedLog = applyLogRetention(currentLog, logPolicy);
        if (trimmedLog.length !== currentLog.length) {
            await chromeStorageSet('local', { syncLog: trimmedLog });
            allLogEntries = trimmedLog;
        }

        // History
        const syncRaw = await chromeStorageGet('sync', SYNC_DATA_KEY);
        const syncData = syncRaw[SYNC_DATA_KEY];
        if (syncData?.versions) {
            const trimmedVersions = applyHistoryRetention(syncData.versions, histPolicy);
            if (trimmedVersions.length !== syncData.versions.length) {
                await chrome.storage.sync.set({ [SYNC_DATA_KEY]: { ...syncData, versions: trimmedVersions } });
                allHistoryEntries = trimmedVersions;
            }
        }
    } catch (err) {
        console.error('applyRetentionPolicies:', err);
    }
}

// ==========================================================================
// Shared Filtering
// ==========================================================================

/**
 * Filters an array of entries using the shared search/date controls.
 * Returns `null` if we're in custom date mode but dates aren't filled.
 * @param {Array} entries
 * @param {(entry: any) => string} textFn - Returns searchable text for entry.
 * @returns {Array|null}
 */
function applyFilters(entries, textFn) {
    const search    = ui.recordsSearchInput.value.trim().toLowerCase();
    const dateRange = ui.recordsDateRange.value;

    let startTs = null;
    let endTs   = null;

    if (dateRange === 'custom') {
        if (ui.recordsStartDate.value) startTs = new Date(ui.recordsStartDate.value).getTime();
        if (ui.recordsEndDate.value)   endTs   = new Date(ui.recordsEndDate.value).setHours(23, 59, 59, 999);
    } else if (dateRange !== 'all') {
        const now = Date.now();
        const map = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };
        startTs = now - (map[dateRange] || 0);
    }

    return entries.filter(entry => {
        const text       = textFn(entry);
        const matchText  = !search || text.includes(search);
        const ts         = entry.timestamp;
        const matchStart = startTs == null || ts >= startTs;
        const matchEnd   = endTs   == null || ts <= endTs;
        return matchText && matchStart && matchEnd;
    });
}

// ==========================================================================
// Storage Change Handler
// ==========================================================================

function handleStorageChange(changes, areaName) {
    if (areaName === 'sync' && changes[SYNC_DATA_KEY]) {
        showToast('Sync data updated externally.', 'info');
        updateSyncStatus();
        if (activeRecordsTab === 'history' && isRecordsPanelActive()) {
            displayVersionHistory(true);
        }
    }
    if (areaName === 'local') {
        if (changes.syncLog && activeRecordsTab === 'log' && isRecordsPanelActive()) {
            const newLog = changes.syncLog.newValue ?? [];
            allLogEntries = newLog;
            displaySyncLog(false);
        }
        if (changes[SYNC_SETTINGS_KEY]) {
            loadAndApplySettings();
        }
    }
}

function isRecordsPanelActive() {
    return document.getElementById('records-panel')?.classList.contains('active');
}

// ==========================================================================
// Export (JSON)
// ==========================================================================

function exportDataAsJSON(data, filename) {
    if (!data || data.length === 0) {
        showToast('No data to export.', 'info');
        return;
    }

    const json  = JSON.stringify(data, null, 2);
    const blob  = new Blob([json], { type: 'application/json' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    const date  = new Date().toISOString().slice(0, 10);

    a.href     = url;
    a.download = `${filename}_${date}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Exported ${data.length} entries to ${filename}.json`, 'success');
}

// ==========================================================================
// UI State Helpers
// ==========================================================================

function setStatusLoading(isLoading, msg) {
    if (isLoading && msg) setStatusMessage(msg, 'info');
}

function setActionLoading(isLoading, msg) {
    const buttons = [ui.syncNowBtn, ui.restoreBtn, ui.clearSyncBtn, ui.exportHistoryBtn, ui.exportLogBtn];
    buttons.forEach(btn => { btn.disabled = isLoading; });

    if (isLoading) {
        [ui.syncNowBtn, ui.restoreBtn, ui.clearSyncBtn].forEach(btn => {
            if (!btn) return;
            btn.dataset.originalText = btn.textContent.trim();
            clearChildren(btn);
            const spin = document.createElement('span');
            spin.className = 'icon loading';
            spin.setAttribute('aria-hidden', 'true');
            btn.appendChild(spin);
            btn.appendChild(document.createTextNode(' ' + (btn.dataset.originalText || '…')));
        });
        if (msg) setStatusMessage(msg, 'info');
    } else {
        [ui.syncNowBtn, ui.restoreBtn, ui.clearSyncBtn].forEach(btn => {
            if (!btn || !btn.dataset.originalText) return;
            btn.textContent = btn.dataset.originalText;
            delete btn.dataset.originalText;
        });
    }
}

function setStatusMessage(message, type) {
    ui.statusMessage.textContent = message;
    ui.statusMessage.className   = `status-message ${type}`;
}

function setPlaceholder(container, text) {
    clearChildren(container);
    container.appendChild(makePlaceholder(text));
}

// ==========================================================================
// Modals
// ==========================================================================

function showConfirmDialog(title, message, okText = 'Confirm') {
    return new Promise(resolve => {
        const d = ui.confirmDialog;
        d.title.textContent  = title;
        d.message.textContent = message;
        d.okBtn.textContent  = okText;
        d.okBtn.className    = okText === 'Clear Data' ? 'btn danger' : 'btn primary';

        d.overlay.classList.add('active');
        d.overlay.setAttribute('aria-hidden', 'false');
        d.okBtn.focus();

        const close = (value) => {
            d.overlay.classList.remove('active');
            d.overlay.setAttribute('aria-hidden', 'true');
            d.okBtn.onclick     = null;
            d.cancelBtn.onclick = null;
            resolve(value);
        };

        d.okBtn.onclick     = () => close(true);
        d.cancelBtn.onclick = () => close(false);
    });
}

function showConflictDialog() {
    return new Promise(resolve => {
        const d = ui.conflictDialog;
        d.overlay.classList.add('active');
        d.overlay.setAttribute('aria-hidden', 'false');
        d.keepCloudBtn.focus();

        const close = (value) => {
            d.overlay.classList.remove('active');
            d.overlay.setAttribute('aria-hidden', 'true');
            d.keepLocalBtn.onclick = null;
            d.keepCloudBtn.onclick = null;
            resolve(value);
        };

        d.keepLocalBtn.onclick = () => close('local');
        d.keepCloudBtn.onclick = () => close('cloud');
    });
}

// ==========================================================================
// Toast Notifications
// ==========================================================================

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'alert');

    const iconMap = { success: 'check', error: 'error', warning: 'error', info: 'info-badge' };
    const icon = document.createElement('span');
    icon.className = `icon icon-${iconMap[type] || 'info-badge'}`;
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createTextNode(message);

    toast.appendChild(icon);
    toast.appendChild(text);
    ui.toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('show'));
    });

    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 4000);
}

// ==========================================================================
// DOM Utilities
// ==========================================================================

function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function makePlaceholder(text) {
    const p = document.createElement('p');
    p.className   = 'placeholder-text';
    p.textContent = text;
    return p;
}

function makeStrong(text) {
    const s = document.createElement('strong');
    s.textContent = text;
    return s;
}

function setSelectValue(selectEl, value) {
    // Only set if the option exists; fallback to first option otherwise
    const exists = [...selectEl.options].some(o => o.value === String(value));
    selectEl.value = exists ? String(value) : selectEl.options[0]?.value ?? '';
}

// ==========================================================================
// Storage Wrappers
// ==========================================================================

/**
 * Wraps chrome.storage.local.get or chrome.storage.sync.get in a Promise.
 * @param {'local'|'sync'} area
 * @param {...string} keys
 */
function chromeStorageGet(area, ...keys) {
    return new Promise((resolve, reject) => {
        const k = keys.length === 1 ? keys[0] : keys;
        chrome.storage[area].get(k, result => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(result);
        });
    });
}

function chromeStorageSet(area, data) {
    return new Promise((resolve, reject) => {
        chrome.storage[area].set(data, () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve();
        });
    });
}

/**
 * Returns a message for storage errors.
 */
function friendlyStorageError(err) {
    const msg = err?.message || String(err);
    if (msg.includes('QUOTA_BYTES_PER_ITEM') || msg.includes('quota')) {
        return 'Storage quota exceeded. Try clearing cloud data or reducing synced items.';
    }
    return msg;
}
