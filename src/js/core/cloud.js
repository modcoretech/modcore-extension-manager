/**
 * @file cloud.js
 * modcore Cloud — UI logic for the cloud sync page.
 */

'use strict';

// ==========================================================================
// Constants
// ==========================================================================

const SYNC_QUOTA_BYTES  = 102400; // 100 KB
const SYNC_DATA_KEY     = 'fullSyncData';
const SYNC_SETTINGS_KEY = 'cloudSyncSettings';

// Hard maximums — enforced regardless of user settings. Strict limits for efficiency.
const HARD_MAX_VERSIONS    = 5;
const HARD_MAX_LOG_ENTRIES = 100;

// Default soft limits (overridden by user settings).
const DEFAULT_MAX_VERSIONS    = 5;
const DEFAULT_MAX_LOG_ENTRIES = 50;

// Rate-limiting for manual actions (ms)
const ACTION_COOLDOWN_MS = 30_000;  // 30 s between sync/restore
const CLEAR_COOLDOWN_MS  = 60_000;  // 60 s between clear operations

const DEBOUNCE_DELAY = 300; // ms

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

// Rate-limit timestamps
let lastSyncAt    = 0;
let lastRestoreAt = 0;
let lastClearAt   = 0;

// Version action-menu state
let activeVersionMenuBtn     = null;
let activeVersionMenuVersion = null;
let lastVersionMenuTrigger   = null;

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
    await updateActionStates();
}

// ==========================================================================
// UI Mapping
// ==========================================================================

function mapUI() {
    ui = {
        // Navigation
        sidebarButtons:  document.querySelectorAll('.sidebar-button'),
        contentPanels:   document.querySelectorAll('.content-panel'),

        // Overview
        chromeSyncStatus:    document.getElementById('chromeSyncStatus'),
        extensionSyncStatus: document.getElementById('extensionSyncStatus'),
        lastSyncTimestamp:   document.getElementById('lastSyncTimestamp'),
        syncProgressBar:     document.getElementById('syncProgressBar'),
        syncProgress:        document.getElementById('syncProgress'),
        syncProgressText:    document.getElementById('syncProgressText'),
        totalBytesUsed:      document.getElementById('totalBytesUsed'),
        statusMessage:       document.getElementById('statusMessage'),
        quotaBreakdown:      document.getElementById('quotaBreakdown'),

        // Options
        selectiveSyncOptions:   document.getElementById('selectiveSyncOptions'),
        enableAutoSync:         document.getElementById('enableAutoSync'),
        syncInterval:           document.getElementById('syncInterval'),
        historyRetentionPolicy: document.getElementById('historyRetentionPolicy'),
        logRetentionPolicy:     document.getElementById('logRetentionPolicy'),

        // Actions
        syncNowBtn:   document.getElementById('syncNowBtn'),
        restoreBtn:   document.getElementById('restoreBtn'),
        clearSyncBtn: document.getElementById('clearSyncBtn'),

        // Records panel
        recordsTabs:      document.querySelectorAll('.records-tab'),
        historyPane:      document.getElementById('records-history-pane'),
        logPane:          document.getElementById('records-log-pane'),
        versionHistory:   document.getElementById('versionHistory'),
        syncLog:          document.getElementById('syncLog'),

        // Filter panel
        filterToggleBtn:      document.getElementById('recordsFilterToggle'),
        filterPanel:          document.getElementById('recordsFilterPanel'),
        recordsSearchInput:   document.getElementById('recordsSearchInput'),
        recordsDateRange:     document.getElementById('recordsDateRange'),
        recordsCustomRange:   document.getElementById('recordsCustomDateRange'),
        recordsStartDate:     document.getElementById('recordsStartDate'),
        recordsEndDate:       document.getElementById('recordsEndDate'),
        clearFiltersBtn:      document.getElementById('recordsClearFilters'),

        // Version action menu
        versionActionMenu:   document.getElementById('versionActionMenu'),
        versionMenuViewData: document.getElementById('versionMenuViewData'),
        versionMenuRestore:  document.getElementById('versionMenuRestore'),
        versionMenuDelete:   document.getElementById('versionMenuDelete'),

        // Version data modal
        versionDataOverlay: document.getElementById('versionDataDialogOverlay'),
        versionDataContent: document.getElementById('versionDataContent'),
        versionDataClose:   document.getElementById('versionDataCloseBtn'),

        // Dialogs
        confirmDialog: {
            overlay:   document.getElementById('confirmDialogOverlay'),
            title:     document.getElementById('confirmDialogTitle'),
            message:   document.getElementById('confirmDialogMessage'),
            okBtn:     document.getElementById('confirmOkBtn'),
            cancelBtn: document.getElementById('confirmCancelBtn'),
        },
        conflictDialog: {
            overlay:      document.getElementById('conflictDialogOverlay'),
            keepLocalBtn: document.getElementById('conflictKeepLocalBtn'),
            keepCloudBtn: document.getElementById('conflictKeepCloudBtn'),
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
        input.type        = 'checkbox';
        input.id          = `sync-${key}`;
        input.dataset.key = key;
        input.checked     = true;

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
    ui.sidebarButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const panelId = btn.dataset.panel;
            switchPanel(panelId);
            if (panelId === 'records-panel') refreshActiveRecordsTab(true);
        });
    });

    // Options
    ui.enableAutoSync.addEventListener('change', saveSyncSettings);
    ui.syncInterval.addEventListener('change', saveSyncSettings);
    ui.historyRetentionPolicy.addEventListener('change', saveSyncSettings);
    ui.logRetentionPolicy.addEventListener('change', saveSyncSettings);
    ui.selectiveSyncOptions.addEventListener('change', saveSyncSettings);

    // Actions (with rate-limit guards)
    ui.syncNowBtn.addEventListener('click',   () => guardedSyncToCloud());
    ui.restoreBtn.addEventListener('click',   () => guardedRestoreFromCloud(null));
    ui.clearSyncBtn.addEventListener('click', () => guardedClearCloudData());

    // Records tab switching with keyboard navigation
    ui.recordsTabs.forEach((tab, index, tabs) => {
        tab.addEventListener('click', () => switchRecordsTab(tab.dataset.tab));
        tab.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                switchRecordsTab(tab.dataset.tab);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                const next = tabs[(index + 1) % tabs.length];
                next.focus();
                next.tabIndex = 0;
                tab.tabIndex = -1;
                switchRecordsTab(next.dataset.tab);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const prev = tabs[(index - 1 + tabs.length) % tabs.length];
                prev.focus();
                prev.tabIndex = 0;
                tab.tabIndex = -1;
                switchRecordsTab(prev.dataset.tab);
            }
        });
    });

    // Filter toggle
    ui.filterToggleBtn.addEventListener('click', toggleFilterPanel);

    // Filter controls
    ui.recordsSearchInput.addEventListener('input', () => {
        clearTimeout(_searchDebounceTimer);
        _searchDebounceTimer = setTimeout(() => refreshActiveRecordsTab(false), DEBOUNCE_DELAY);
    });
    ui.recordsDateRange.addEventListener('change', () => {
        ui.recordsCustomRange.hidden = ui.recordsDateRange.value !== 'custom';
        refreshActiveRecordsTab(false);
    });
    ui.recordsStartDate.addEventListener('change', () => refreshActiveRecordsTab(false));
    ui.recordsEndDate.addEventListener('change',   () => refreshActiveRecordsTab(false));
    ui.clearFiltersBtn.addEventListener('click', () => {
        clearFilters();
        ui.recordsSearchInput.focus();
    });

    // Version action menu
    ui.versionMenuViewData.addEventListener('click', () => {
        const version = activeVersionMenuVersion;
        closeVersionMenu();
        if (version) showVersionData(version);
    });
    ui.versionMenuRestore.addEventListener('click', () => {
        const ts = activeVersionMenuVersion?.timestamp ?? null;
        closeVersionMenu();
        if (ts != null) guardedRestoreFromCloud(ts);
    });
    ui.versionMenuDelete.addEventListener('click', () => {
        const ts = activeVersionMenuVersion?.timestamp ?? null;
        closeVersionMenu();
        if (ts != null) deleteVersion(ts);
    });

    // Version data modal close
    ui.versionDataClose.addEventListener('click', () => closeVersionDataModal());
    ui.versionDataOverlay.addEventListener('click', e => {
        if (e.target === ui.versionDataOverlay) closeVersionDataModal();
    });

    // Close menu when clicking outside
    document.addEventListener('click', e => {
        if (!ui.versionActionMenu.hidden && !ui.versionActionMenu.contains(e.target) && e.target !== activeVersionMenuBtn) {
            closeVersionMenu();
        }
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (!ui.versionActionMenu.hidden) closeVersionMenu();
            if (ui.versionDataOverlay.classList.contains('active')) closeVersionDataModal();
        }
    });

    // Chrome storage listener
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
        const isActive = panel.id === panelId;
        panel.classList.toggle('active', isActive);
    });
}

function switchRecordsTab(tabName) {
    if (activeRecordsTab === tabName) return;
    activeRecordsTab = tabName;

    ui.recordsTabs.forEach(tab => {
        const isActive = tab.dataset.tab === tabName;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
    });

    ui.historyPane.hidden = tabName !== 'history';
    ui.logPane.hidden     = tabName !== 'log';

    refreshActiveRecordsTab(true);
}

function refreshActiveRecordsTab(fetchFresh) {
    if (activeRecordsTab === 'history') displayVersionHistory(fetchFresh);
    else                                displaySyncLog(fetchFresh);
}

// ==========================================================================
// Filter Panel
// ==========================================================================

function toggleFilterPanel() {
    const isOpen = !ui.filterPanel.hidden;
    ui.filterPanel.hidden = isOpen;
    ui.filterToggleBtn.setAttribute('aria-expanded', String(!isOpen));
    ui.filterToggleBtn.classList.toggle('active', !isOpen);
    if (!isOpen) ui.recordsSearchInput.focus();
}

function clearFilters() {
    ui.recordsSearchInput.value = '';
    ui.recordsDateRange.value   = 'all';
    ui.recordsCustomRange.hidden = true;
    ui.recordsStartDate.value   = '';
    ui.recordsEndDate.value     = '';
    refreshActiveRecordsTab(false);
}

// ==========================================================================
// Settings
// ==========================================================================

async function loadAndApplySettings() {
    try {
        const stored   = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
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
        setSelectValue(ui.syncInterval, String(s.syncInterval));

        ui.lastSyncTimestamp.textContent = s.lastSyncTimestamp
            ? formatRelativeTime(s.lastSyncTimestamp)
            : 'Never';

        ui.extensionSyncStatus.textContent = s.autoSyncEnabled ? 'Enabled' : 'Disabled';
        ui.extensionSyncStatus.className   = `detail-value status-indicator ${s.autoSyncEnabled ? 'success' : 'error'}`;

        setSelectValue(ui.logRetentionPolicy,     s.logRetentionPolicy);
        setSelectValue(ui.historyRetentionPolicy, s.historyRetentionPolicy);

        for (const [key, enabled] of Object.entries(s.selectiveSync)) {
            const cb = document.getElementById(`sync-${key}`);
            if (cb) cb.checked = Boolean(enabled);
        }
    } catch (err) {
        console.error('loadAndApplySettings:', err);
        showToast('Failed to load sync configuration.', 'error');
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

        const stored   = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
        const existing = stored[SYNC_SETTINGS_KEY] || {};
        settings.lastSyncTimestamp = existing.lastSyncTimestamp || null;

        await chromeStorageSet('local', { [SYNC_SETTINGS_KEY]: settings });

        try { chrome.runtime.sendMessage({ type: 'UPDATE_SYNC_ALARM' }); } catch (_) { /* non-critical */ }

        showToast('Configuration saved.', 'success');
        await loadAndApplySettings();
        await applyRetentionPolicies();
        await updateActionStates();
    } catch (err) {
        console.error('saveSyncSettings:', err);
        showToast('Failed to persist configuration.', 'error');
    }
}

// ==========================================================================
// Action Button States
// ==========================================================================

async function updateActionStates() {
    try {
        const stored = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
        const settings = stored[SYNC_SETTINGS_KEY];
        const hasSelection = settings?.selectiveSync && Object.values(settings.selectiveSync).some(Boolean);
        ui.syncNowBtn.disabled = !hasSelection;
        ui.syncNowBtn.title = hasSelection ? '' : 'Select at least one data category in Options';
    } catch (_) {}
}

// ==========================================================================
// Sync Status (Overview)
// ==========================================================================

async function updateSyncStatus() {
    setStatusLoading(true, 'Evaluating sync status…');
    try {
        let chromeSyncActive = false;
        try {
            await chrome.storage.sync.set({ _mcTest: 1 });
            await chrome.storage.sync.remove('_mcTest');
            chromeSyncActive = true;
        } catch (_) { /* noop */ }

        ui.chromeSyncStatus.textContent = chromeSyncActive ? 'Active' : 'Inactive';
        ui.chromeSyncStatus.className   = `detail-value status-indicator ${chromeSyncActive ? 'success' : 'warning'}`;

        const bytesInUse = await chrome.storage.sync.getBytesInUse(null);
        const percentage = Math.min((bytesInUse / SYNC_QUOTA_BYTES) * 100, 100);

        ui.syncProgress.style.width     = `${percentage}%`;
        ui.syncProgressText.textContent = `${(bytesInUse / 1024).toFixed(1)} KB / 100 KB`;
        ui.totalBytesUsed.textContent   = bytesInUse.toLocaleString();
        ui.syncProgressBar.setAttribute('aria-valuenow', String(bytesInUse));

        ui.syncProgress.classList.remove('warning', 'error');
        if (percentage > 90) {
            ui.syncProgress.classList.add('error');
            setStatusMessage('Storage critical. Reduce sync scope or prune history.', 'error');
        } else if (percentage > 75) {
            ui.syncProgress.classList.add('warning');
            setStatusMessage('Storage approaching quota limit.', 'warning');
        } else {
            setStatusMessage('Storage utilization nominal.', 'success');
        }

        const syncRaw    = await chromeStorageGet('sync', SYNC_DATA_KEY);
        const latestData = syncRaw[SYNC_DATA_KEY]?.versions?.[0]?.data ?? null;
        renderQuotaBreakdown(latestData);

    } catch (err) {
        console.error('updateSyncStatus:', err);
        setStatusMessage(`Status check failed: ${err.message}`, 'error');
    } finally {
        setStatusLoading(false);
    }
}

function renderQuotaBreakdown(latestData) {
    clearChildren(ui.quotaBreakdown);

    if (!latestData) {
        ui.quotaBreakdown.appendChild(makePlaceholder('Push data to generate a storage breakdown.'));
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
        ui.quotaBreakdown.appendChild(makePlaceholder('No data categories selected for syncing.'));
        return;
    }

    const frag = document.createDocumentFragment();
    for (const { name, size } of items) {
        const row      = document.createElement('div');
        row.className  = 'quota-item';

        const nameSpan = document.createElement('span');
        nameSpan.className   = 'quota-item-name';
        nameSpan.textContent = name;

        const sizeSpan = document.createElement('span');
        sizeSpan.className   = 'quota-item-size';
        sizeSpan.textContent = `${(size / 1024).toFixed(2)} KB`;

        row.appendChild(nameSpan);
        row.appendChild(sizeSpan);
        frag.appendChild(row);
    }
    ui.quotaBreakdown.appendChild(frag);
}

// ==========================================================================
// Rate-Limited Action Guards
// ==========================================================================

async function guardedSyncToCloud() {
    const settingsRaw = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
    const settings = settingsRaw[SYNC_SETTINGS_KEY];
    const hasSelection = settings?.selectiveSync && Object.values(settings.selectiveSync).some(Boolean);
    if (!hasSelection) {
        showToast('No sync categories selected. Check Options.', 'warning');
        return;
    }

    const now     = Date.now();
    const elapsed = now - lastSyncAt;
    if (elapsed < ACTION_COOLDOWN_MS) {
        const wait = Math.ceil((ACTION_COOLDOWN_MS - elapsed) / 1000);
        showToast(`Rate limit active. Retry in ${wait}s.`, 'warning');
        return;
    }
    lastSyncAt = now;
    syncToCloud(false);
}

function guardedRestoreFromCloud(versionTimestamp) {
    const now     = Date.now();
    const elapsed = now - lastRestoreAt;
    if (elapsed < ACTION_COOLDOWN_MS) {
        const wait = Math.ceil((ACTION_COOLDOWN_MS - elapsed) / 1000);
        showToast(`Rate limit active. Retry in ${wait}s.`, 'warning');
        return;
    }
    lastRestoreAt = now;
    restoreFromCloud(versionTimestamp);
}

function guardedClearCloudData() {
    const now     = Date.now();
    const elapsed = now - lastClearAt;
    if (elapsed < CLEAR_COOLDOWN_MS) {
        const wait = Math.ceil((CLEAR_COOLDOWN_MS - elapsed) / 1000);
        showToast(`Rate limit active. Retry in ${wait}s.`, 'warning');
        return;
    }
    lastClearAt = now;
    confirmClearCloudData();
}

// ==========================================================================
// Sync to Cloud
// ==========================================================================

async function syncToCloud(isAutomatic = false) {
    setActionLoading(true, 'Pushing to cloud…');
    try {
        const settingsRaw = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
        const settings    = settingsRaw[SYNC_SETTINGS_KEY];

        if (!settings?.selectiveSync) throw new Error('Sync scope undefined. Configure in Options.');

        const keysToSync = Object.keys(settings.selectiveSync).filter(k => settings.selectiveSync[k]);
        if (keysToSync.length === 0) throw new Error('No sync categories selected.');

        const localData  = await chromeStorageGet('local', ...keysToSync);
        const newVersion = {
            timestamp: Date.now(),
            data:      localData,
            source:    isAutomatic ? 'Automatic' : 'Manual',
        };

        const syncRaw  = await chromeStorageGet('sync', SYNC_DATA_KEY);
        const syncData = syncRaw[SYNC_DATA_KEY] || { versions: [] };

        // Deduplicate: skip if identical to latest version
        const latest = syncData.versions[0];
        if (latest && JSON.stringify(latest.data) === JSON.stringify(localData)) {
            showToast('Local state matches cloud. No changes detected.', 'info');
            return;
        }

        syncData.versions.unshift(newVersion);
        syncData.versions = applyHistoryRetention(syncData.versions, settings.historyRetentionPolicy);

        // Guard against quota — trim if needed
        let estimatedSize = new TextEncoder().encode(JSON.stringify({ [SYNC_DATA_KEY]: syncData })).length;
        if (estimatedSize > SYNC_QUOTA_BYTES) {
            while (syncData.versions.length > 1) {
                syncData.versions.pop();
                estimatedSize = new TextEncoder().encode(JSON.stringify({ [SYNC_DATA_KEY]: syncData })).length;
                if (estimatedSize <= SYNC_QUOTA_BYTES * 0.95) break;
            }
            showToast('Storage quota exceeded. Pruned oldest versions.', 'warning');
        }

        await chrome.storage.sync.set({ [SYNC_DATA_KEY]: syncData });
        await chromeStorageSet('local', {
            [SYNC_SETTINGS_KEY]: { ...settings, lastSyncTimestamp: Date.now() },
        });

        await addLogEntry('Push completed successfully.', 'success');
        showToast('Push completed.', 'success');

    } catch (err) {
        console.error('syncToCloud:', err);
        const msg = friendlyStorageError(err);
        await addLogEntry(`Push failed: ${msg}`, 'error');
        showToast(`Push failed: ${msg}`, 'error');
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
        'This will overwrite your current local data with the selected cloud snapshot. This operation cannot be undone.'
    );
    if (!confirmed) return;

    setActionLoading(true, 'Restoring local state…');
    try {
        const syncRaw  = await chromeStorageGet('sync', SYNC_DATA_KEY);
        const syncData = syncRaw[SYNC_DATA_KEY];

        if (!syncData?.versions?.length) throw new Error('No cloud snapshot available.');

        const versionToRestore = versionTimestamp != null
            ? syncData.versions.find(v => v.timestamp === versionTimestamp)
            : syncData.versions[0];

        if (!versionToRestore) throw new Error('Version not found. It may have been pruned.');

        // Conflict check for latest restore
        if (versionTimestamp == null) {
            const settingsRaw = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
            const settings    = settingsRaw[SYNC_SETTINGS_KEY];
            if (settings?.lastSyncTimestamp && versionToRestore.timestamp < settings.lastSyncTimestamp) {
                const choice = await showConflictDialog();
                if (choice === 'local') {
                    showToast('Restore aborted. Local state preserved.', 'info');
                    return;
                }
            }
        }

        await chromeStorageSet('local', versionToRestore.data);
        await addLogEntry(`Restored from version ${new Date(versionToRestore.timestamp).toLocaleString()}.`, 'success');
        showToast('Restore completed.', 'success');
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
// Delete a Single Version
// ==========================================================================

async function deleteVersion(timestamp) {
    const confirmed = await showConfirmDialog(
        'Delete Version?',
        'This operation permanently removes the selected version from Chrome Sync.',
        'Delete'
    );
    if (!confirmed) return;

    try {
        const syncRaw  = await chromeStorageGet('sync', SYNC_DATA_KEY);
        const syncData = syncRaw[SYNC_DATA_KEY];
        if (!syncData?.versions) throw new Error('No versions available.');

        const updated = syncData.versions.filter(v => v.timestamp !== timestamp);
        if (updated.length === syncData.versions.length) throw new Error('Version not found.');

        await chrome.storage.sync.set({ [SYNC_DATA_KEY]: { ...syncData, versions: updated } });
        allHistoryEntries = updated;
        await addLogEntry(`Deleted version from ${new Date(timestamp).toLocaleString()}.`, 'info');
        showToast('Version deleted.', 'success');
        displayVersionHistory(false);
        await updateSyncStatus();
    } catch (err) {
        console.error('deleteVersion:', err);
        showToast(`Deletion failed: ${err.message}`, 'error');
    }
}

// ==========================================================================
// Clear All Cloud Data
// ==========================================================================

async function confirmClearCloudData() {
    const confirmed = await showConfirmDialog(
        'Purge Cloud Data?',
        'This operation irreversibly purges all modcore Cloud data from your Google account.',
        'Purge'
    );
    if (!confirmed) return;

    setActionLoading(true, 'Purging cloud data…');
    try {
        await chrome.storage.sync.remove(SYNC_DATA_KEY);
        allHistoryEntries = [];
        await addLogEntry('Cloud data purged.', 'success');
        showToast('Purge completed.', 'success');
    } catch (err) {
        console.error('confirmClearCloudData:', err);
        await addLogEntry(`Purge failed: ${err.message}`, 'error');
        showToast(`Purge failed: ${err.message}`, 'error');
    } finally {
        setActionLoading(false);
        await updateSyncStatus();
        displayVersionHistory(false);
    }
}

// ==========================================================================
// Version History
// ==========================================================================

async function displayVersionHistory(fetchFresh) {
    setPlaceholder(ui.versionHistory, 'Loading versions…');

    try {
        if (fetchFresh) {
            const raw         = await chromeStorageGet('sync', SYNC_DATA_KEY);
            allHistoryEntries = raw[SYNC_DATA_KEY]?.versions ?? [];
        }

        const filtered = applyFilters(allHistoryEntries, entry =>
            JSON.stringify(entry.data).toLowerCase() + ' ' + (entry.source || '').toLowerCase()
        );

        if (filtered === null) return;

        clearChildren(ui.versionHistory);

        if (allHistoryEntries.length === 0) {
            ui.versionHistory.appendChild(makePlaceholder('No versions available. Push data to create a snapshot.'));
            return;
        }

        if (filtered.length === 0) {
            ui.versionHistory.appendChild(makePlaceholder('No versions match the current filter criteria.'));
            return;
        }

        const frag = document.createDocumentFragment();
        filtered.forEach((version, idx) => frag.appendChild(buildHistoryItem(version, idx === 0)));
        ui.versionHistory.appendChild(frag);

    } catch (err) {
        console.error('displayVersionHistory:', err);
        clearChildren(ui.versionHistory);
        const p = makePlaceholder('Failed to load version history.');
        p.classList.add('error-text');
        ui.versionHistory.appendChild(p);
        showToast('Failed to load version history.', 'error');
    }
}

function buildHistoryItem(version, isLatest) {
    const dataSummary = Object.keys(version.data || {})
        .map(k => DATA_KEYS_TO_SYNC[k] || k)
        .join(', ') || 'No data';

    const item = document.createElement('div');
    item.className = 'history-item';

    // Header row
    const header = document.createElement('div');
    header.className = 'history-item-header';

    const leftCol = document.createElement('div');
    leftCol.className = 'history-item-left';

    const ts = document.createElement('span');
    ts.className   = 'history-timestamp';
    ts.textContent = new Date(version.timestamp).toLocaleString();

    if (isLatest) {
        const badge = document.createElement('span');
        badge.className   = 'history-badge-latest';
        badge.textContent = 'Latest';
        leftCol.appendChild(ts);
        leftCol.appendChild(badge);
    } else {
        leftCol.appendChild(ts);
    }

    // ⋯ action button
    const menuBtn = document.createElement('button');
    menuBtn.className = 'btn-version-menu';
    menuBtn.setAttribute('aria-label', 'Version actions');
    menuBtn.setAttribute('aria-haspopup', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    const menuIcon = document.createElement('span');
    menuIcon.className = 'icon icon-dots-menu';
    menuIcon.setAttribute('aria-hidden', 'true');
    menuBtn.appendChild(menuIcon);
    menuBtn.addEventListener('click', e => {
        e.stopPropagation();
        openVersionMenu(menuBtn, version);
    });

    header.appendChild(leftCol);
    header.appendChild(menuBtn);
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
// Version Action Menu (Popover)
// ==========================================================================

function openVersionMenu(triggerBtn, version) {
    if (activeVersionMenuBtn === triggerBtn && !ui.versionActionMenu.hidden) {
        closeVersionMenu();
        return;
    }
    closeVersionMenu();

    activeVersionMenuBtn     = triggerBtn;
    activeVersionMenuVersion = version;
    lastVersionMenuTrigger   = triggerBtn;
    triggerBtn.setAttribute('aria-expanded', 'true');

    const rect = triggerBtn.getBoundingClientRect();
    const menu = ui.versionActionMenu;
    menu.hidden = false;
    menu.style.top  = '0';
    menu.style.left = '0';

    const menuRect = menu.getBoundingClientRect();
    let top  = rect.bottom + 4;
    let left = rect.right - menuRect.width;

    // Viewport boundary checks
    if (left < 8) left = 8;
    if (left + menuRect.width > window.innerWidth - 8) {
        left = window.innerWidth - menuRect.width - 8;
    }
    if (top + menuRect.height > window.innerHeight - 8) {
        top = rect.top - menuRect.height - 4;
    }
    if (top < 8) top = 8;

    menu.style.top  = `${top}px`;
    menu.style.left = `${left}px`;

    const items = [...menu.querySelectorAll('.version-action-item')];
    items[0]?.focus();

    // Keyboard navigation
    menu.onkeydown = (e) => {
        const idx = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            items[(idx + 1) % items.length]?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            items[(idx - 1 + items.length) % items.length]?.focus();
        } else if (e.key === 'Home') {
            e.preventDefault();
            items[0]?.focus();
        } else if (e.key === 'End') {
            e.preventDefault();
            items[items.length - 1]?.focus();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeVersionMenu();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            closeVersionMenu();
        }
    };

    // Close on resize or scroll
    const closeHandler = () => closeVersionMenu();
    window.addEventListener('resize', closeHandler, { once: true });
    window.addEventListener('scroll', closeHandler, { once: true });
}

function closeVersionMenu() {
    const trigger = activeVersionMenuBtn;
    ui.versionActionMenu.hidden = true;
    ui.versionActionMenu.onkeydown = null;
    activeVersionMenuBtn        = null;
    activeVersionMenuVersion    = null;
    if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
    }
}

// ==========================================================================
// Version Data Modal
// ==========================================================================

function showVersionData(version) {
    const formatted = JSON.stringify(version.data, null, 2);
    ui.versionDataContent.textContent = formatted;
    ui.versionDataOverlay.classList.add('active');
    ui.versionDataOverlay.setAttribute('aria-hidden', 'false');
    ui.versionDataClose.focus();
}

function closeVersionDataModal() {
    ui.versionDataOverlay.classList.remove('active');
    ui.versionDataOverlay.setAttribute('aria-hidden', 'true');
    ui.versionDataContent.textContent = '';
    if (lastVersionMenuTrigger) {
        lastVersionMenuTrigger.focus();
        lastVersionMenuTrigger = null;
    }
}

// ==========================================================================
// Sync Log
// ==========================================================================

async function displaySyncLog(fetchFresh) {
    setPlaceholder(ui.syncLog, 'Loading audit log…');

    try {
        if (fetchFresh) {
            const raw     = await chromeStorageGet('local', 'syncLog');
            allLogEntries = raw.syncLog ?? [];
        }

        const filtered = applyFilters(allLogEntries, entry =>
            (entry.message || '').toLowerCase() + ' ' + (entry.type || '').toLowerCase()
        );

        if (filtered === null) return;

        clearChildren(ui.syncLog);

        if (allLogEntries.length === 0) {
            ui.syncLog.appendChild(makePlaceholder('No sync events recorded.'));
            return;
        }

        if (filtered.length === 0) {
            ui.syncLog.appendChild(makePlaceholder('No log entries match the current filter criteria.'));
            return;
        }

        const frag = document.createDocumentFragment();
        filtered.forEach(entry => frag.appendChild(buildLogEntry(entry)));
        ui.syncLog.appendChild(frag);

    } catch (err) {
        console.error('displaySyncLog:', err);
        clearChildren(ui.syncLog);
        const p = makePlaceholder('Failed to load audit log.');
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
    ts.className   = 'log-timestamp';
    ts.textContent = new Date(entry.timestamp).toLocaleString();
    header.appendChild(ts);

    const badge = document.createElement('span');
    badge.className   = `status-indicator ${entry.type || 'info'}`;
    badge.textContent = entry.type || 'info';
    header.appendChild(badge);

    div.appendChild(header);

    const msg = document.createElement('p');
    msg.className   = `log-message ${entry.type || ''}`;
    msg.textContent = entry.message || '';
    div.appendChild(msg);

    if (entry.details) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'toggle-details-btn';
        toggleBtn.textContent = 'Show details';
        toggleBtn.setAttribute('aria-expanded', 'false');

        const detailsDiv = document.createElement('div');
        detailsDiv.className   = 'log-message-details';
        detailsDiv.textContent = entry.details;
        detailsDiv.id          = `log-detail-${entry.timestamp}`;

        toggleBtn.setAttribute('aria-controls', detailsDiv.id);
        toggleBtn.addEventListener('click', () => {
            const expanded = div.classList.toggle('expanded');
            toggleBtn.textContent = expanded ? 'Hide details' : 'Show details';
            toggleBtn.setAttribute('aria-expanded', String(expanded));
        });

        div.appendChild(toggleBtn);
        div.appendChild(detailsDiv);
    }

    return div;
}

// ==========================================================================
// Add Log Entry
// ==========================================================================

async function addLogEntry(message, type = 'info', details = '') {
    try {
        const raw        = await chromeStorageGet('local', 'syncLog');
        const currentLog = raw.syncLog ?? [];

        const newEntry = {
            timestamp: Date.now(),
            message,
            type,
            ...(details ? { details } : {}),
        };
        let newLog = [newEntry, ...currentLog];

        const settingsRaw = await chromeStorageGet('local', SYNC_SETTINGS_KEY);
        const retention   = settingsRaw[SYNC_SETTINGS_KEY]?.logRetentionPolicy ?? String(DEFAULT_MAX_LOG_ENTRIES);
        newLog = applyLogRetention(newLog, retention);

        await chromeStorageSet('local', { syncLog: newLog });
        allLogEntries = newLog;

        if (activeRecordsTab === 'log') displaySyncLog(false);
    } catch (err) {
        console.error('addLogEntry:', err);
    }
}

// ==========================================================================
// Retention
// ==========================================================================

function applyHistoryRetention(versions, policy) {
    let result = [...versions];
    policy = policy || String(DEFAULT_MAX_VERSIONS);

    // Remove duplicates (same data payload, keep newest)
    const seen = new Set();
    result = result.filter(v => {
        const key = JSON.stringify(v.data);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    if (policy.endsWith('d')) {
        const days   = parseInt(policy, 10);
        const cutoff = Date.now() - days * 864e5;
        result = result.filter(v => v.timestamp >= cutoff);
    } else {
        const n = Math.min(parseInt(policy, 10) || DEFAULT_MAX_VERSIONS, HARD_MAX_VERSIONS);
        result  = result.slice(0, n);
    }

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
        const n = Math.min(parseInt(policy, 10) || DEFAULT_MAX_LOG_ENTRIES, HARD_MAX_LOG_ENTRIES);
        result  = result.slice(0, n);
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
        const logRaw     = await chromeStorageGet('local', 'syncLog');
        const currentLog = logRaw.syncLog ?? [];
        const trimmedLog = applyLogRetention(currentLog, logPolicy);
        if (trimmedLog.length !== currentLog.length) {
            await chromeStorageSet('local', { syncLog: trimmedLog });
            allLogEntries = trimmedLog;
        }

        // History
        const syncRaw  = await chromeStorageGet('sync', SYNC_DATA_KEY);
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

function applyFilters(entries, textFn) {
    const search    = ui.recordsSearchInput.value.trim().toLowerCase();
    const dateRange = ui.recordsDateRange.value;

    let startTs = null;
    let endTs   = null;

    if (dateRange === 'custom') {
        if (ui.recordsStartDate.value) startTs = new Date(ui.recordsStartDate.value).getTime();
        if (ui.recordsEndDate.value)   endTs   = new Date(ui.recordsEndDate.value).setHours(23, 59, 59, 999);
    } else if (dateRange !== 'all') {
        const map = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };
        startTs   = Date.now() - (map[dateRange] || 0);
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
        showToast('Sync data updated from another device.', 'info');
        updateSyncStatus();
        if (activeRecordsTab === 'history' && isRecordsPanelActive()) displayVersionHistory(true);
    }
    if (areaName === 'local') {
        if (changes.syncLog && activeRecordsTab === 'log' && isRecordsPanelActive()) {
            allLogEntries = changes.syncLog.newValue ?? [];
            displaySyncLog(false);
        }
        if (changes[SYNC_SETTINGS_KEY]) {
            loadAndApplySettings();
            updateActionStates();
        }
    }
}

function isRecordsPanelActive() {
    return document.getElementById('records-panel')?.classList.contains('active');
}

// ==========================================================================
// UI State Helpers
// ==========================================================================

function setStatusLoading(isLoading, msg) {
    if (isLoading && msg) setStatusMessage(msg, 'info');
}

function setActionLoading(isLoading, msg) {
    const buttons = [ui.syncNowBtn, ui.restoreBtn, ui.clearSyncBtn];
    buttons.forEach(btn => { if (btn) btn.disabled = isLoading; });

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
        d.title.textContent   = title;
        d.message.textContent = message;
        d.okBtn.textContent   = okText;
        d.okBtn.className     = (okText === 'Purge' || okText === 'Delete') ? 'btn danger' : 'btn primary';

        d.overlay.classList.add('active');
        d.overlay.setAttribute('aria-hidden', 'false');
        d.okBtn.focus();

        const close = value => {
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

        const close = value => {
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
    const icon    = document.createElement('span');
    icon.className = `icon icon-${iconMap[type] || 'info-badge'}`;
    icon.setAttribute('aria-hidden', 'true');

    toast.appendChild(icon);
    toast.appendChild(document.createTextNode(message));
    ui.toastContainer.appendChild(toast);

    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));

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
    const p     = document.createElement('p');
    p.className   = 'placeholder-text';
    p.textContent = text;
    return p;
}

function makeStrong(text) {
    const s     = document.createElement('strong');
    s.textContent = text;
    return s;
}

function setSelectValue(selectEl, value) {
    const exists  = [...selectEl.options].some(o => o.value === String(value));
    selectEl.value = exists ? String(value) : (selectEl.options[0]?.value ?? '');
}

/**
 * Returns a human-friendly relative time string.
 * @param {number} timestamp
 */
function formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1)  return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleString();
}

// ==========================================================================
// Storage Wrappers
// ==========================================================================

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

function friendlyStorageError(err) {
    const msg = err?.message || String(err);
    if (msg.includes('QUOTA_BYTES_PER_ITEM') || msg.includes('quota')) {
        return 'Storage quota exceeded. Clear cloud data or reduce sync scope.';
    }
    return msg;
}
