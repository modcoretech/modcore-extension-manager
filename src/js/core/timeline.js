/**
 * timeline.js — modcore Timeline
 * Refactored for auto-save, compact-by-default, safer DOM, and robust controls.
 */
(() => {
    'use strict';

    /* ---------------------------------------------------------------------- */
    /*  Config                                                                */
    /* ---------------------------------------------------------------------- */
    const SEARCH_DEBOUNCE_MS      = 200;
    const SETTINGS_SAVE_DEBOUNCE_MS = 400;
    const TOAST_DURATION_MS       = 3000;
    const UNDO_DURATION_MS        = 8000;
    const EVENT_TYPES             = ['installed', 'uninstalled', 'updated', 'permissions_updated', 'enabled', 'disabled'];
    const FILTER_STATE_KEY        = 'timelineFilterState_v2';

    /* ---------------------------------------------------------------------- */
    /*  State                                                                 */
    /* ---------------------------------------------------------------------- */
    let allHistoryRecords = [];
    let filteredRecords   = [];
    let currentFilters    = {
        searchTerm: '',
        eventTypes: new Set(EVENT_TYPES),
        startDate:  null,
        endDate:    null
    };
    let settings = {
        trackingEnabled:      true,
        sortOrder:            'desc',
        logsPerPage:          25,
        pruneDays:            90,
        recordLimit:          1000,
        pruneOnLimit:         true,
        displayTimestamps:    true,
        autoPruneOnStartup:   false,
        relativeTimestamps:   false,
        liveRefreshSeconds:   0,
        keyboardShortcuts:    true,
        persistFilters:       false,
        showRecordCount:      true,
    };
    let currentPage  = 1;
    let totalPages   = 1;
    let liveRefreshInterval = null;
    let settingsSaveTimer   = null;

    /* ---------------------------------------------------------------------- */
    /*  DOM Cache                                                             */
    /* ---------------------------------------------------------------------- */
    const dom = {};

    /* ---------------------------------------------------------------------- */
    /*  Utilities                                                             */
    /* ---------------------------------------------------------------------- */
    const debounce = (fn, wait) => {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
    };

    const showToast = (message, type = 'info', duration = TOAST_DURATION_MS, action = null) => {
        if (!dom.toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        if (action) {
            toast.classList.add('undo');
            const p = document.createElement('p');
            p.textContent = message;
            const btn = document.createElement('button');
            btn.className = 'btn secondary';
            btn.textContent = 'Undo';
            btn.addEventListener('click', action.handler, { once: true });
            toast.append(p, btn);
        } else {
            toast.textContent = message;
        }
        dom.toastContainer.appendChild(toast);
        requestAnimationFrame(() => {
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
                toast.addEventListener('transitionend', () => toast.remove(), { once: true });
            }, duration);
        });
    };

    const setBusyState = (busy) => {
        dom.initialLoading.style.display = busy ? 'flex' : 'none';
        dom.contentArea.style.opacity    = busy ? '0.5' : '1';
        dom.contentArea.style.pointerEvents = busy ? 'none' : 'auto';
        dom.sidebarButtons.forEach(b => b.disabled = busy);
    };

    const setActionLoading = (busy) => {
        [dom.clearAllButton, dom.pruneNowButton, dom.pruneInactiveBtn, dom.pruneByTypeBtn,
         dom.resetDefaultsBtn].forEach(b => { if (b) b.disabled = busy; });
    };

    const showModal = (id) => {
        const m = dom[id];
        if (!m) return;
        dom.modalBackdrop.hidden = false;
        m.hidden = false;
        m.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => m.classList.add('is-visible'));
    };

    const hideModal = (id) => {
        const m = dom[id];
        if (!m) return;
        m.classList.remove('is-visible');
        m.addEventListener('transitionend', () => {
            dom.modalBackdrop.hidden = true;
            m.hidden = true;
            m.setAttribute('aria-hidden', 'true');
        }, { once: true });
    };

    const formatEventType = (t) => t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    const formatRelativeTime = (ts) => {
        const diff = Date.now() - ts;
        const sec  = Math.floor(diff / 1000);
        const min  = Math.floor(sec / 60);
        const hr   = Math.floor(min / 60);
        const day  = Math.floor(hr / 24);
        if (sec < 10)  return 'Just now';
        if (sec < 60)  return `${sec}s ago`;
        if (min < 60)  return `${min}m ago`;
        if (hr < 24)   return `${hr}h ago`;
        if (day < 7)   return `${day}d ago`;
        return new Date(ts).toLocaleDateString();
    };

    const showSaveIndicator = () => {
        if (!dom.settingsSavedIndicator) return;
        dom.settingsSavedIndicator.hidden = false;
        dom.settingsSavedIndicator.classList.add('visible');
        clearTimeout(dom.settingsSavedIndicator._t);
        dom.settingsSavedIndicator._t = setTimeout(() => dom.settingsSavedIndicator.classList.remove('visible'), 2000);
    };

    /* ---------------------------------------------------------------------- */
    /*  Init                                                                  */
    /* ---------------------------------------------------------------------- */
    const initializeApp = async () => {
        cacheDomElements();
        setupEventListeners();
        await loadSettings();
        setBusyState(true);
        await loadInitialData();
        buildFilterCheckboxes();
        if (settings.persistFilters) await restoreFilters();
        if (dom.currentYear) dom.currentYear.textContent = new Date().getFullYear();
        await maybeAutoPrune();
        startLiveRefresh();
    };

    const cacheDomElements = () => {
        dom.sidebar           = document.querySelector('.sidebar');
        dom.contentArea       = document.querySelector('.content-area');
        dom.toastContainer    = document.getElementById('toast-container');
        dom.initialLoading    = document.getElementById('initial-loading-indicator');
        dom.currentYear       = document.getElementById('current-year');
        dom.panels            = document.querySelectorAll('.content-panel');
        dom.sidebarButtons    = document.querySelectorAll('.sidebar-button');
        dom.body              = document.body;

        /* History */
        dom.historyContentWrapper = document.getElementById('history-content-wrapper');
        dom.historyList           = document.getElementById('history-list');
        dom.noHistoryMessage      = document.getElementById('no-history-message');
        dom.searchInput           = document.getElementById('search-input');
        dom.clearSearchBtn        = document.getElementById('clear-search-btn');
        dom.filterToggleButton    = document.getElementById('filter-toggle-btn');
        dom.filterPanel           = document.getElementById('filter-panel');
        dom.eventTypeFilters      = document.getElementById('event-type-filters');
        dom.startDateInput        = document.getElementById('start-date-input');
        dom.endDateInput          = document.getElementById('end-date-input');
        dom.clearAllButton        = document.getElementById('clear-all-btn');
        dom.resetFiltersBtn       = document.getElementById('reset-filters-btn');
        dom.selectAllFiltersBtn   = document.getElementById('select-all-filters-btn');
        dom.selectNoneFiltersBtn  = document.getElementById('select-none-filters-btn');
        dom.recordCountDisplay    = document.getElementById('record-count-display');

        /* Pagination */
        dom.paginationControls   = document.getElementById('pagination-controls');
        dom.prevPageBtn          = document.getElementById('prev-page-btn');
        dom.nextPageBtn          = document.getElementById('next-page-btn');
        dom.currentPageDisplay   = document.getElementById('current-page-display');
        dom.totalPagesDisplay    = document.getElementById('total-pages-display');

        /* Settings */
        dom.trackingEnabledToggle      = document.getElementById('tracking-enabled-toggle');
        dom.pruneDaysInput             = document.getElementById('prune-days-input');
        dom.pruneNowButton             = document.getElementById('prune-now-btn');
        dom.pruneOnLimitToggle         = document.getElementById('prune-on-limit-toggle');
        dom.sortOrderSelect            = document.getElementById('sort-order-select');
        dom.logsPerPageInput           = document.getElementById('logs-per-page-input');
        dom.recordLimitInput           = document.getElementById('record-limit-input');
        dom.displayTimestampsToggle    = document.getElementById('display-timestamps-toggle');
        dom.autoPruneOnStartupToggle   = document.getElementById('auto-prune-startup-toggle');
        dom.relativeTimestampsToggle   = document.getElementById('relative-timestamps-toggle');
        dom.liveRefreshInput           = document.getElementById('live-refresh-input');
        dom.keyboardShortcutsToggle    = document.getElementById('keyboard-shortcuts-toggle');
        dom.persistFiltersToggle       = document.getElementById('persist-filters-toggle');
        dom.showRecordCountToggle      = document.getElementById('show-record-count-toggle');
        dom.resetDefaultsBtn           = document.getElementById('reset-defaults-btn');
        dom.settingsSavedIndicator     = document.getElementById('settings-saved-indicator');
        dom.pruneInactiveBtn           = document.getElementById('prune-inactive-btn');
        dom.pruneByTypeBtn             = document.getElementById('prune-by-type-btn');

        /* Modals */
        dom.limitModal         = document.getElementById('limit-modal');
        dom.pruneByTypeModal   = document.getElementById('prune-by-type-modal');
        dom.modalBackdrop      = document.getElementById('modal-backdrop');
        dom.modalPruneBtn      = document.getElementById('modal-prune-btn');
        dom.modalDisableBtn    = document.getElementById('modal-disable-btn');
        dom.modalLimitValue    = document.getElementById('modal-limit-value');
        dom.pruneTypeOptions   = document.getElementById('prune-type-options');
        dom.pruneTypeCancelBtn = document.getElementById('prune-type-cancel-btn');
        dom.pruneTypeConfirmBtn= document.getElementById('prune-type-confirm-btn');
    };

    const setupEventListeners = () => {
        /* Navigation */
        dom.sidebarButtons.forEach(btn => {
            btn.addEventListener('click', () => switchPanel(btn.dataset.panelTarget));
        });

        /* History */
        dom.searchInput.addEventListener('input', debounce(handleSearchInput, SEARCH_DEBOUNCE_MS));
        dom.clearSearchBtn.addEventListener('click', handleClearSearch);
        dom.filterToggleButton.addEventListener('click', toggleFilterPanel);
        dom.resetFiltersBtn.addEventListener('click', handleResetFilters);
        dom.selectAllFiltersBtn.addEventListener('click', handleSelectAllFilters);
        dom.selectNoneFiltersBtn.addEventListener('click', handleSelectNoneFilters);
        dom.clearAllButton.addEventListener('click', handleClearAllHistory);
        dom.eventTypeFilters.addEventListener('change', handleFilterChange);
        dom.startDateInput.addEventListener('change', handleDateFilterChange);
        dom.endDateInput.addEventListener('change', handleDateFilterChange);

        /* Pagination */
        dom.prevPageBtn.addEventListener('click', () => handlePageChange(-1));
        dom.nextPageBtn.addEventListener('click', () => handlePageChange(1));

        /* Settings — auto-save wiring */
        const autoSaveToggles = [
            dom.trackingEnabledToggle, dom.pruneOnLimitToggle, dom.displayTimestampsToggle,
            dom.autoPruneOnStartupToggle, dom.relativeTimestampsToggle,
            dom.keyboardShortcutsToggle, dom.persistFiltersToggle, dom.showRecordCountToggle,
            dom.sortOrderSelect
        ];
        autoSaveToggles.forEach(el => el && el.addEventListener('change', () => debouncedAutoSave()));

        const numericAutoSave = [
            { el: dom.pruneDaysInput,   min: 1,    max: 3650 },
            { el: dom.logsPerPageInput, min: 5,    max: 500 },
            { el: dom.recordLimitInput, min: 100,  max: 10000 },
            { el: dom.liveRefreshInput, min: 0,    max: 300 },
        ];
        numericAutoSave.forEach(({ el, min, max }) => {
            if (!el) return;
            el.addEventListener('change', () => {
                let v = parseInt(el.value, 10);
                if (isNaN(v) || v < min) v = min;
                if (v > max) v = max;
                el.value = v;
                debouncedAutoSave();
            });
        });

        dom.pruneNowButton.addEventListener('click', handlePruneNow);
        dom.pruneInactiveBtn.addEventListener('click', handlePruneInactive);
        dom.pruneByTypeBtn.addEventListener('click', handlePruneByTypeModalOpen);
        dom.resetDefaultsBtn.addEventListener('click', handleResetDefaults);

        /* Modals */
        dom.modalPruneBtn.addEventListener('click', () => handleModalPrune(true));
        dom.modalDisableBtn.addEventListener('click', handleModalDisable);
        dom.pruneTypeCancelBtn.addEventListener('click', () => hideModal('pruneByTypeModal'));
        dom.pruneTypeConfirmBtn.addEventListener('click', handlePruneByTypeConfirm);
    };

    /* ---------------------------------------------------------------------- */
    /*  Data & State                                                          */
    /* ---------------------------------------------------------------------- */
    const loadSettings = async () => {
        try {
            const res = await chrome.runtime.sendMessage({ type: 'GET_HISTORY_SETTINGS' });
            if (res?.settings) settings = { ...settings, ...res.settings };
            syncSettingsToUI();
        } catch (e) {
            console.error('Error loading settings:', e);
            showToast('Failed to load settings.', 'error');
        }
    };

    const loadInitialData = async (showLoading = true) => {
        try {
            if (showLoading) setBusyState(true);
            const res = await chrome.runtime.sendMessage({ type: 'GET_EXTENSION_HISTORY' });
            allHistoryRecords = (res.history || []).filter(r =>
                r && typeof r === 'object' &&
                typeof r.timestamp === 'number' &&
                typeof r.extensionId === 'string' &&
                typeof r.eventType === 'string'
            );
            applyFiltersAndSort();
            checkHistoryLimit();
        } catch (e) {
            console.error('Error loading history:', e);
            showToast('Failed to load history data.', 'error');
            dom.noHistoryMessage.textContent = 'Could not load history.';
            dom.noHistoryMessage.hidden = false;
        } finally {
            if (showLoading) setBusyState(false);
        }
    };

    const applyFiltersAndSort = () => {
        filteredRecords = allHistoryRecords.filter(r => {
            const searchMatch = !currentFilters.searchTerm ||
                (r.extensionName || '').toLowerCase().includes(currentFilters.searchTerm) ||
                (r.details || '').toLowerCase().includes(currentFilters.searchTerm);
            const typeMatch = currentFilters.eventTypes.has(r.eventType);
            const s = currentFilters.startDate;
            const e = currentFilters.endDate;
            const dateMatch = (!s || r.timestamp >= s) && (!e || r.timestamp <= e);
            return searchMatch && typeMatch && dateMatch;
        });

        const so = settings.sortOrder;
        if (so === 'desc' || so === 'asc') {
            filteredRecords.sort((a, b) => so === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);
        } else if (so === 'name') {
            filteredRecords.sort((a, b) => (a.extensionName || '').localeCompare(b.extensionName || ''));
        } else if (so === 'type') {
            filteredRecords.sort((a, b) => a.eventType.localeCompare(b.eventType) || b.timestamp - a.timestamp);
        }

        currentPage = 1;
        totalPages  = Math.max(1, Math.ceil(filteredRecords.length / settings.logsPerPage));
        renderHistory();
        updateRecordCount();
        if (settings.persistFilters) persistCurrentFilters();
    };

    const updateSettingsControlsState = () => {
        const on = dom.trackingEnabledToggle.checked;
        [dom.pruneNowButton, dom.pruneDaysInput, dom.pruneOnLimitToggle,
         dom.recordLimitInput, dom.pruneInactiveBtn, dom.pruneByTypeBtn,
         dom.autoPruneOnStartupToggle].forEach(el => { if (el) el.disabled = !on; });
    };

    const checkHistoryLimit = () => {
        if (!settings.trackingEnabled || allHistoryRecords.length <= settings.recordLimit) return;
        if (settings.pruneOnLimit) {
            handleModalPrune(false);
        } else {
            if (dom.modalLimitValue) dom.modalLimitValue.textContent = settings.recordLimit;
            showModal('limitModal');
        }
    };

    const maybeAutoPrune = async () => {
        if (!settings.autoPruneOnStartup || !settings.trackingEnabled) return;
        const days = settings.pruneDays;
        if (!days || days < 1) return;
        try {
            await chrome.runtime.sendMessage({ type: 'PRUNE_HISTORY_BY_DAYS', payload: { daysToKeep: days } });
            await loadInitialData(false);
            showToast(`Auto-pruned records older than ${days} days.`, 'success');
        } catch (e) {
            console.error('Auto-prune failed:', e);
        }
    };

    const startLiveRefresh = () => {
        stopLiveRefresh();
        const sec = parseInt(settings.liveRefreshSeconds, 10) || 0;
        if (sec < 5) return;
        liveRefreshInterval = setInterval(() => loadInitialData(false), sec * 1000);
    };

    const stopLiveRefresh = () => {
        if (liveRefreshInterval) { clearInterval(liveRefreshInterval); liveRefreshInterval = null; }
    };

    /* ---------------------------------------------------------------------- */
    /*  UI Rendering                                                          */
    /* ---------------------------------------------------------------------- */
    const switchPanel = (targetId) => {
        dom.sidebarButtons.forEach(btn => {
            const active = btn.dataset.panelTarget === targetId;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-current', active ? 'page' : 'false');
        });
        dom.panels.forEach(panel => {
            panel.hidden = panel.id !== targetId;
            panel.classList.toggle('active', panel.id === targetId);
        });
    };

    const buildFilterCheckboxes = () => {
        while (dom.eventTypeFilters.firstChild) dom.eventTypeFilters.removeChild(dom.eventTypeFilters.firstChild);
        const frag = document.createDocumentFragment();
        EVENT_TYPES.forEach(type => {
            const label = document.createElement('label');
            label.className = 'checkbox-container';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = type;
            input.checked = currentFilters.eventTypes.has(type);
            input.addEventListener('change', handleFilterChange);
            const checkmark = document.createElement('span');
            checkmark.className = 'checkmark';
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
            svg.appendChild(path);
            checkmark.appendChild(svg);
            const text = document.createTextNode(formatEventType(type));
            label.append(input, checkmark, text);
            frag.appendChild(label);
        });
        dom.eventTypeFilters.appendChild(frag);
    };

    const renderHistory = () => {
        while (dom.historyList.firstChild) dom.historyList.removeChild(dom.historyList.firstChild);
        const start = (currentPage - 1) * settings.logsPerPage;
        const page  = filteredRecords.slice(start, start + settings.logsPerPage);

        dom.noHistoryMessage.hidden = filteredRecords.length > 0;
        dom.paginationControls.hidden = filteredRecords.length === 0;

        if (filteredRecords.length === 0) return;

        const frag = document.createDocumentFragment();

        if (settings.sortOrder === 'group') {
            const groups = groupRecordsByExtension(page);
            for (const name in groups) {
                const h = document.createElement('h3');
                h.className = 'history-group-header';
                h.textContent = name;
                frag.appendChild(h);
                groups[name].forEach(r => frag.appendChild(createHistoryItemElement(r)));
            }
        } else {
            const days = groupRecordsByDate(page);
            for (const dk in days) {
                const h = document.createElement('h3');
                h.className = 'history-day-header';
                h.textContent = dk;
                frag.appendChild(h);
                days[dk].forEach(r => frag.appendChild(createHistoryItemElement(r)));
            }
        }

        dom.historyList.appendChild(frag);
        renderPagination();
    };

    const createHistoryItemElement = (record) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.recordId = record.id || `${record.timestamp}-${record.extensionId}-${record.eventType}`;
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'listitem');

        const iconWrap = document.createElement('div');
        iconWrap.className = 'item-icon';
        const icon = document.createElement('span');
        icon.className = `icon icon-${record.eventType}`;
        icon.setAttribute('aria-label', formatEventType(record.eventType));
        const badge = document.createElement('span');
        badge.className = 'status-badge';
        icon.appendChild(badge);
        iconWrap.appendChild(icon);

        const content = document.createElement('div');
        content.className = 'history-item-content';
        const header = document.createElement('div');
        header.className = 'history-item-header';
        header.textContent = `${record.extensionName || 'Unknown'} (v${record.extensionVersion || 'N/A'})`;
        const details = document.createElement('div');
        details.className = 'history-item-details';
        details.textContent = `${formatEventType(record.eventType)}${record.details ? ` — ${record.details}` : ''}`;
        content.append(header, details);

        item.append(iconWrap, content);

        if (settings.displayTimestamps) {
            const meta = document.createElement('div');
            meta.className = 'history-item-meta';
            meta.textContent = settings.relativeTimestamps
                ? formatRelativeTime(record.timestamp)
                : new Date(record.timestamp).toLocaleTimeString();
            item.appendChild(meta);
        }
        return item;
    };

    const groupRecordsByDate = (records) => {
        const today = new Date().toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
        const yesterday = new Date(Date.now()-864e5).toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
        return records.reduce((acc, r) => {
            let key = new Date(r.timestamp).toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
            if (key === today) key = 'Today';
            else if (key === yesterday) key = 'Yesterday';
            if (!acc[key]) acc[key] = [];
            acc[key].push(r);
            return acc;
        }, {});
    };

    const groupRecordsByExtension = (records) => {
        const g = records.reduce((acc, r) => {
            const n = r.extensionName || 'Unknown Extension';
            if (!acc[n]) acc[n] = [];
            acc[n].push(r);
            return acc;
        }, {});
        for (const k in g) g[k].sort((a, b) => b.timestamp - a.timestamp);
        return g;
    };

    const toggleFilterPanel = () => {
        const visible = dom.filterPanel.classList.toggle('is-visible');
        dom.filterToggleButton.setAttribute('aria-expanded', visible);
    };

    const renderPagination = () => {
        dom.paginationControls.hidden = totalPages <= 1;
        dom.prevPageBtn.disabled = currentPage === 1;
        dom.nextPageBtn.disabled = currentPage === totalPages;
        dom.currentPageDisplay.textContent = currentPage;
        dom.totalPagesDisplay.textContent = totalPages;
    };

    const updateRecordCount = () => {
        if (!dom.recordCountDisplay) return;
        if (!settings.showRecordCount) { dom.recordCountDisplay.textContent = ''; return; }
        const start = Math.min((currentPage-1)*settings.logsPerPage+1, filteredRecords.length);
        const end   = Math.min(currentPage*settings.logsPerPage, filteredRecords.length);
        dom.recordCountDisplay.textContent = filteredRecords.length
            ? `${start}-${end} of ${filteredRecords.length} records`
            : '0 records';
    };

    /* ---------------------------------------------------------------------- */
    /*  Settings helpers                                                      */
    /* ---------------------------------------------------------------------- */
    const syncSettingsToUI = () => {
        dom.trackingEnabledToggle.checked    = settings.trackingEnabled;
        dom.pruneDaysInput.value             = settings.pruneDays;
        dom.pruneOnLimitToggle.checked       = settings.pruneOnLimit;
        dom.sortOrderSelect.value            = settings.sortOrder;
        dom.logsPerPageInput.value           = settings.logsPerPage;
        dom.recordLimitInput.value           = settings.recordLimit;
        dom.displayTimestampsToggle.checked  = settings.displayTimestamps;
        dom.autoPruneOnStartupToggle.checked = settings.autoPruneOnStartup;
        dom.relativeTimestampsToggle.checked = settings.relativeTimestamps;
        dom.liveRefreshInput.value           = settings.liveRefreshSeconds;
        dom.keyboardShortcutsToggle.checked  = settings.keyboardShortcuts;
        dom.persistFiltersToggle.checked     = settings.persistFilters;
        dom.showRecordCountToggle.checked    = settings.showRecordCount;
        updateSettingsControlsState();
    };

    const readSettingsFromUI = () => {
        settings.trackingEnabled      = dom.trackingEnabledToggle.checked;
        settings.pruneDays            = Math.max(1, Math.min(3650, parseInt(dom.pruneDaysInput.value,10)||90));
        settings.pruneOnLimit         = dom.pruneOnLimitToggle.checked;
        settings.sortOrder            = dom.sortOrderSelect.value;
        settings.logsPerPage          = Math.max(5, Math.min(500, parseInt(dom.logsPerPageInput.value,10)||25));
        settings.recordLimit          = Math.max(100, Math.min(10000, parseInt(dom.recordLimitInput.value,10)||1000));
        settings.displayTimestamps    = dom.displayTimestampsToggle.checked;
        settings.autoPruneOnStartup   = dom.autoPruneOnStartupToggle.checked;
        settings.relativeTimestamps   = dom.relativeTimestampsToggle.checked;
        settings.liveRefreshSeconds   = Math.max(0, Math.min(300, parseInt(dom.liveRefreshInput.value,10)||0));
        settings.keyboardShortcuts    = dom.keyboardShortcutsToggle.checked;
        settings.persistFilters       = dom.persistFiltersToggle.checked;
        settings.showRecordCount      = dom.showRecordCountToggle.checked;
    };

    const saveSettings = async (showFeedback = true) => {
        readSettingsFromUI();
        try {
            await chrome.runtime.sendMessage({ type: 'UPDATE_HISTORY_SETTINGS', payload: settings });
            if (showFeedback) showToast('Settings saved.', 'success');
            else showSaveIndicator();
            applyFiltersAndSort();
            checkHistoryLimit();
            startLiveRefresh();
        } catch (e) {
            console.error('Error saving settings:', e);
            showToast('Failed to save settings.', 'error');
        }
    };

    const debouncedAutoSave = debounce(() => saveSettings(false), SETTINGS_SAVE_DEBOUNCE_MS);

    const handleResetDefaults = async () => {
        if (!confirm('Reset all settings to defaults?')) return;
        settings = {
            trackingEnabled: true, sortOrder: 'desc', logsPerPage: 25, pruneDays: 90,
            recordLimit: 1000, pruneOnLimit: true, displayTimestamps: true,
            autoPruneOnStartup: false, relativeTimestamps: false, liveRefreshSeconds: 0,
            keyboardShortcuts: true, persistFilters: false, showRecordCount: true,
        };
        syncSettingsToUI();
        await saveSettings();
        showToast('Settings reset to defaults.', 'success');
    };

    /* ---------------------------------------------------------------------- */
    /*  Filter persistence                                                    */
    /* ---------------------------------------------------------------------- */
    const persistCurrentFilters = async () => {
        try {
            await chrome.storage.local.set({
                [FILTER_STATE_KEY]: {
                    searchTerm: currentFilters.searchTerm,
                    eventTypes: Array.from(currentFilters.eventTypes),
                    startDate:  currentFilters.startDate,
                    endDate:    currentFilters.endDate,
                }
            });
        } catch (e) { console.error('Failed to persist filters:', e); }
    };

    const restoreFilters = async () => {
        try {
            const res = await chrome.storage.local.get(FILTER_STATE_KEY);
            const s = res[FILTER_STATE_KEY];
            if (!s) return;
            currentFilters.searchTerm = s.searchTerm || '';
            currentFilters.eventTypes = new Set(s.eventTypes || EVENT_TYPES);
            currentFilters.startDate  = s.startDate || null;
            currentFilters.endDate    = s.endDate || null;

            dom.searchInput.value = currentFilters.searchTerm;
            dom.startDateInput.value = currentFilters.startDate ? new Date(currentFilters.startDate).toISOString().split('T')[0] : '';
            dom.endDateInput.value   = currentFilters.endDate   ? new Date(currentFilters.endDate).toISOString().split('T')[0] : '';
        } catch (e) { console.error('Failed to restore filters:', e); }
    };

    /* ---------------------------------------------------------------------- */
    /*  Event Handlers                                                        */
    /* ---------------------------------------------------------------------- */
    const handleSearchInput = (e) => {
        currentFilters.searchTerm = e.target.value.trim().toLowerCase();
        dom.clearSearchBtn.hidden = !currentFilters.searchTerm;
        applyFiltersAndSort();
    };

    const handleClearSearch = () => {
        dom.searchInput.value = '';
        currentFilters.searchTerm = '';
        dom.clearSearchBtn.hidden = true;
        applyFiltersAndSort();
    };

    const handleFilterChange = (e) => {
        const cb = e.target;
        if (cb.checked) currentFilters.eventTypes.add(cb.value);
        else currentFilters.eventTypes.delete(cb.value);
        applyFiltersAndSort();
    };

    const handleDateFilterChange = () => {
        const s = dom.startDateInput.value;
        const e = dom.endDateInput.value;
        if (s && e && new Date(s) > new Date(e)) {
            showToast('Start date cannot be after end date.', 'error');
            dom.endDateInput.value = '';
            return;
        }
        currentFilters.startDate = s ? new Date(s).getTime() : null;
        currentFilters.endDate   = e ? new Date(e).setHours(23,59,59,999) : null;
        applyFiltersAndSort();
    };

    const handleResetFilters = () => {
        currentFilters = { searchTerm:'', eventTypes:new Set(EVENT_TYPES), startDate:null, endDate:null };
        dom.searchInput.value = '';
        dom.clearSearchBtn.hidden = true;
        dom.startDateInput.value = '';
        dom.endDateInput.value = '';
        buildFilterCheckboxes();
        applyFiltersAndSort();
        showToast('Filters reset.', 'info');
    };

    const handleSelectAllFilters = () => {
        currentFilters.eventTypes = new Set(EVENT_TYPES);
        buildFilterCheckboxes();
        applyFiltersAndSort();
    };

    const handleSelectNoneFilters = () => {
        currentFilters.eventTypes.clear();
        buildFilterCheckboxes();
        applyFiltersAndSort();
    };

    const handlePageChange = (dir) => {
        const np = currentPage + dir;
        if (np > 0 && np <= totalPages) { currentPage = np; renderHistory(); updateRecordCount(); }
    };

    const handleClearAllHistory = async () => {
        const previous = allHistoryRecords;
        const undo = async () => {
            try {
                await chrome.runtime.sendMessage({ type: 'RESTORE_HISTORY', payload: previous });
                await loadInitialData();
                showToast('History restored.', 'success');
            } catch (e) {
                showToast('Failed to restore history.', 'error');
                console.error(e);
            }
        };
        if (!confirm('Delete ALL history records? You can undo this for a few seconds.')) return;
        try {
            await chrome.runtime.sendMessage({ type: 'CLEAR_EXTENSION_HISTORY' });
            allHistoryRecords = [];
            applyFiltersAndSort();
            showToast('All history cleared.', 'success', UNDO_DURATION_MS, { handler: undo });
        } catch (e) {
            console.error('Error clearing history:', e);
            showToast('Failed to clear history.', 'error');
        }
    };

    const handlePruneNow = async () => {
        const days = parseInt(dom.pruneDaysInput.value, 10);
        if (isNaN(days) || days < 1) { showToast('Enter a valid number of days (1+).', 'error'); return; }
        if (!confirm(`Prune all records older than ${days} days?`)) return;
        setActionLoading(true);
        try {
            await chrome.runtime.sendMessage({ type: 'PRUNE_HISTORY_BY_DAYS', payload: { daysToKeep: days } });
            await loadInitialData();
            showToast(`Records older than ${days} days pruned.`, 'success');
        } catch (e) {
            console.error('Prune failed:', e);
            showToast('Failed to prune history.', 'error');
        } finally { setActionLoading(false); }
    };

    const handlePruneInactive = async () => {
        if (!confirm('Prune all records for extensions that are currently uninstalled?')) return;
        setActionLoading(true);
        try {
            await chrome.runtime.sendMessage({ type: 'PRUNE_INACTIVE_EXTENSIONS' });
            await loadInitialData();
            showToast('Inactive extension history pruned.', 'success');
        } catch (e) {
            console.error('Prune inactive failed:', e);
            showToast('Failed to prune inactive history.', 'error');
        } finally { setActionLoading(false); }
    };

    const handlePruneByTypeModalOpen = () => {
        while (dom.pruneTypeOptions.firstChild) dom.pruneTypeOptions.removeChild(dom.pruneTypeOptions.firstChild);
        const frag = document.createDocumentFragment();
        EVENT_TYPES.forEach(type => {
            const label = document.createElement('label');
            label.className = 'checkbox-container';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = type;
            input.addEventListener('change', () => {
                dom.pruneTypeConfirmBtn.disabled = dom.pruneTypeOptions.querySelectorAll('input:checked').length === 0;
            });
            const checkmark = document.createElement('span');
            checkmark.className = 'checkmark';
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
            svg.appendChild(path);
            checkmark.appendChild(svg);
            const text = document.createTextNode(formatEventType(type));
            label.append(input, checkmark, text);
            frag.appendChild(label);
        });
        dom.pruneTypeOptions.appendChild(frag);
        dom.pruneTypeConfirmBtn.disabled = true;
        showModal('pruneByTypeModal');
    };

    const handlePruneByTypeConfirm = async () => {
        const types = Array.from(dom.pruneTypeOptions.querySelectorAll('input:checked')).map(i => i.value);
        if (!types.length) return;
        if (!confirm(`Delete all history records for the selected event types?`)) return;
        setActionLoading(true);
        try {
            await chrome.runtime.sendMessage({ type: 'PRUNE_HISTORY_BY_TYPES', payload: types });
            await loadInitialData();
            showToast('Selected event types pruned.', 'success');
            hideModal('pruneByTypeModal');
        } catch (e) {
            console.error('Prune by type failed:', e);
            showToast('Failed to prune by type.', 'error');
        } finally { setActionLoading(false); }
    };

    const handleModalPrune = async (showToastMsg = true) => {
        try {
            await chrome.runtime.sendMessage({ type: 'PRUNE_HISTORY_TO_LIMIT', payload: { limit: settings.recordLimit } });
            await loadInitialData();
            hideModal('limitModal');
            if (showToastMsg) showToast(`History pruned to ${settings.recordLimit} records.`, 'success');
        } catch (e) {
            console.error('Prune to limit failed:', e);
            if (showToastMsg) showToast('Failed to prune to limit.', 'error');
        }
    };

    const handleModalDisable = async () => {
        try {
            dom.trackingEnabledToggle.checked = false;
            await saveSettings();
            hideModal('limitModal');
            showToast('History tracking disabled.', 'info');
        } catch (e) {
            console.error('Disable failed:', e);
            showToast('Failed to disable tracking.', 'error');
        }
    };

    /* ---------------------------------------------------------------------- */
    /*  Keyboard Shortcuts                                                    */
    /* ---------------------------------------------------------------------- */
    const handleKeyboardShortcuts = (e) => {
        if (!settings.keyboardShortcuts || e.ctrlKey || e.metaKey) return;
        if (!e.altKey) return;
        const k = e.key.toLowerCase();
        const map = {
            f: () => dom.searchInput.focus(),
            g: () => toggleFilterPanel(),
            r: () => handleResetFilters(),
            c: () => handleClearAllHistory(),
            s: () => switchPanel('panel-settings'),
            h: () => switchPanel('panel-help'),
            ',': () => dom.prevPageBtn.click(),
            '<': () => dom.prevPageBtn.click(),
            '.': () => dom.nextPageBtn.click(),
            '>': () => dom.nextPageBtn.click(),
        };
        if (map[k]) { e.preventDefault(); map[k](); }
    };

    /* ---------------------------------------------------------------------- */
    /*  Entry Point                                                           */
    /* ---------------------------------------------------------------------- */
    document.addEventListener('DOMContentLoaded', initializeApp);
    document.addEventListener('keydown', handleKeyboardShortcuts);
})();