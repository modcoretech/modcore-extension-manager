/**
 * timeline.js - modcore Timeline
 * Refactored for extension icons, side-sheet filters, cleaner settings,
 * useful detail view, export/import, and search highlighting.
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
    const EVENT_ICON_MAP          = {
        installed: 'icon-install',
        uninstalled: 'icon-trash',
        updated: 'icon-update',
        permissions_updated: 'icon-shield',
        enabled: 'icon-check',
        disabled: 'icon-error'
    };

    /* ---------------------------------------------------------------------- */
    /*  State                                                                 */
    /* ---------------------------------------------------------------------- */
    let allHistoryRecords = [];
    let filteredRecords   = [];
    let installedExtensions = new Map();
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
        displayTimestamps:    true,
        relativeTimestamps:   false,
        liveRefreshSeconds:   0,
        showExtensionIcons:   true,
    };
    let currentPage  = 1;
    let totalPages   = 1;
    let liveRefreshInterval = null;

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

    const escapeHtml = (str) => {
        if (!str) return '';
        return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    };

    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const highlightMatch = (text, term) => {
        if (!term || !text) return escapeHtml(text);
        const parts = text.split(new RegExp(`(${escapeRegex(term)})`, 'gi'));
        return parts.map(part => 
            part.toLowerCase() === term.toLowerCase() ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)
        ).join('');
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
        if (!dom.initialLoading || !dom.contentArea) return;
        dom.initialLoading.style.display = busy ? 'flex' : 'none';
        dom.contentArea.style.opacity    = busy ? '0.5' : '1';
        dom.contentArea.style.pointerEvents = busy ? 'none' : 'auto';
        dom.sidebarButtons.forEach(b => b.disabled = busy);
    };

    const setActionLoading = (busy) => {
        [dom.clearAllButton, dom.pruneNowButton, dom.pruneInactiveBtn, dom.pruneByTypeBtn,
         dom.resetDefaultsBtn, dom.exportHistoryBtn, dom.importHistoryBtn].forEach(b => { if (b) b.disabled = busy; });
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
        const week = Math.floor(day / 7);
        const month= Math.floor(day / 30);
        if (sec < 10)  return 'Just now';
        if (sec < 60)  return `${sec}s ago`;
        if (min < 60)  return `${min}m ago`;
        if (hr < 24)   return `${hr}h ago`;
        if (day < 7)   return `${day}d ago`;
        if (week < 4)  return `${week}w ago`;
        if (month < 12)return `${month}mo ago`;
        return new Date(ts).toLocaleDateString();
    };

    const formatFullDate = (ts) => {
        const d = new Date(ts);
        return d.toLocaleString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
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
        await Promise.all([loadInstalledExtensions(), loadInitialData(false)]);
        buildFilterCheckboxes();
        if (dom.currentYear) dom.currentYear.textContent = new Date().getFullYear();
        checkHistoryLimit();
        startLiveRefresh();
        setBusyState(false);
    };

    const cacheDomElements = () => {
        dom.sidebar           = document.querySelector('.sidebar');
        dom.contentArea       = document.querySelector('.content-area');
        dom.toastContainer    = document.getElementById('toast-container');
        dom.initialLoading    = document.getElementById('initial-loading-indicator');
        dom.currentYear       = document.getElementById('current-year');
        dom.panels            = document.querySelectorAll('.content-panel');
        dom.sidebarButtons    = document.querySelectorAll('.sidebar-button[data-panel-target]');

        /* History */
        dom.historyContentWrapper = document.getElementById('history-content-wrapper');
        dom.historyList           = document.getElementById('history-list');
        dom.noHistoryMessage      = document.getElementById('no-history-message');
        dom.searchInput           = document.getElementById('search-input');
        dom.clearSearchBtn        = document.getElementById('clear-search-btn');
        dom.filterToggleButton    = document.getElementById('filter-toggle-btn');
        dom.filterPanel           = document.getElementById('filter-panel');
        dom.filterBackdrop        = document.getElementById('filter-backdrop');
        dom.closeFilterSheet      = document.getElementById('close-filter-sheet');
        dom.eventTypeFilters      = document.getElementById('event-type-filters');
        dom.startDateInput        = document.getElementById('start-date-input');
        dom.endDateInput          = document.getElementById('end-date-input');
        dom.clearAllButton        = document.getElementById('clear-all-btn');
        dom.resetFiltersBtn       = document.getElementById('reset-filters-btn');
        dom.selectAllFiltersBtn   = document.getElementById('select-all-filters-btn');
        dom.selectNoneFiltersBtn  = document.getElementById('select-none-filters-btn');
        dom.recordCountDisplay    = document.getElementById('record-count-display');

        /* Toolbar */
        dom.exportHistoryBtn      = document.getElementById('export-history-btn');
        dom.importHistoryBtn      = document.getElementById('import-history-btn');
        dom.importFileInput       = document.getElementById('import-file-input');

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
        dom.sortOrderSelect            = document.getElementById('sort-order-select');
        dom.logsPerPageInput           = document.getElementById('logs-per-page-input');
        dom.recordLimitInput           = document.getElementById('record-limit-input');
        dom.displayTimestampsToggle    = document.getElementById('display-timestamps-toggle');
        dom.relativeTimestampsToggle   = document.getElementById('relative-timestamps-toggle');
        dom.liveRefreshInput           = document.getElementById('live-refresh-input');
        dom.showExtensionIconsToggle   = document.getElementById('show-extension-icons-toggle');
        dom.resetDefaultsBtn           = document.getElementById('reset-defaults-btn');
        dom.settingsSavedIndicator     = document.getElementById('settings-saved-indicator');
        dom.pruneInactiveBtn           = document.getElementById('prune-inactive-btn');
        dom.pruneByTypeBtn             = document.getElementById('prune-by-type-btn');

        /* Modals */
        dom.pruneByTypeModal   = document.getElementById('prune-by-type-modal');
        dom.modalBackdrop      = document.getElementById('modal-backdrop');
        dom.pruneTypeOptions   = document.getElementById('prune-type-options');
        dom.pruneTypeCancelBtn = document.getElementById('prune-type-cancel-btn');
        dom.pruneTypeConfirmBtn= document.getElementById('prune-type-confirm-btn');

        /* Detail Modal */
        dom.detailModal        = document.getElementById('detail-modal');
        dom.detailContent      = document.getElementById('detail-content');
        dom.closeDetailBtn     = document.getElementById('close-detail-btn');
        dom.copyDetailIdBtn    = document.getElementById('copy-detail-id-btn');
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
        dom.closeFilterSheet?.addEventListener('click', toggleFilterPanel);
        dom.filterBackdrop?.addEventListener('click', toggleFilterPanel);
        dom.resetFiltersBtn.addEventListener('click', handleResetFilters);
        dom.selectAllFiltersBtn.addEventListener('click', handleSelectAllFilters);
        dom.selectNoneFiltersBtn.addEventListener('click', handleSelectNoneFilters);
        dom.clearAllButton.addEventListener('click', handleClearAllHistory);
        dom.eventTypeFilters.addEventListener('change', handleFilterChange);
        dom.startDateInput.addEventListener('change', handleDateFilterChange);
        dom.endDateInput.addEventListener('change', handleDateFilterChange);

        /* Toolbar */
        dom.exportHistoryBtn?.addEventListener('click', handleExportHistory);
        dom.importHistoryBtn?.addEventListener('click', () => dom.importFileInput?.click());
        dom.importFileInput?.addEventListener('change', handleImportFileSelect);

        /* Pagination */
        dom.prevPageBtn.addEventListener('click', () => handlePageChange(-1));
        dom.nextPageBtn.addEventListener('click', () => handlePageChange(1));

        /* Settings - auto-save wiring */
        const autoSaveToggles = [
            dom.trackingEnabledToggle, dom.displayTimestampsToggle,
            dom.relativeTimestampsToggle, dom.showExtensionIconsToggle, dom.sortOrderSelect
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
        dom.pruneTypeCancelBtn.addEventListener('click', () => hideModal('pruneByTypeModal'));
        dom.pruneTypeConfirmBtn.addEventListener('click', handlePruneByTypeConfirm);

        /* Detail Modal */
        if (dom.closeDetailBtn) dom.closeDetailBtn.addEventListener('click', () => hideModal('detailModal'));
        if (dom.copyDetailIdBtn) dom.copyDetailIdBtn.addEventListener('click', handleCopyDetailId);

        /* Keyboard shortcuts */
        document.addEventListener('keydown', handleGlobalKeydown);

        /* Modal backdrop click */
        dom.modalBackdrop.addEventListener('click', () => {
            hideModal('pruneByTypeModal');
            hideModal('detailModal');
        });
    };

    const handleGlobalKeydown = (e) => {
        if (e.key === 'Escape') {
            if (!dom.detailModal.hidden) { hideModal('detailModal'); return; }
            if (!dom.pruneByTypeModal.hidden) { hideModal('pruneByTypeModal'); return; }
            if (dom.filterPanel.classList.contains('is-visible')) {
                toggleFilterPanel();
                return;
            }
            if (document.activeElement === dom.searchInput) {
                handleClearSearch();
                return;
            }
        }
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'SELECT') {
            e.preventDefault();
            dom.searchInput.focus();
        }
    };

    /* ---------------------------------------------------------------------- */
    /*  Data & State                                                          */
    /* ---------------------------------------------------------------------- */
    const loadInstalledExtensions = async () => {
        try {
            const exts = await chrome.management.getAll();
            installedExtensions = new Map(exts.map(e => [e.id, { 
                name: e.name, 
                enabled: e.enabled,
                iconUrl: e.icons?.[e.icons.length - 1]?.url || e.icons?.[0]?.url || null
            }]));
        } catch (e) {
            console.warn('Failed to load installed extensions:', e);
        }
    };

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
            allHistoryRecords = (res?.history || []).filter(r =>
                r && typeof r === 'object' &&
                typeof r.timestamp === 'number' &&
                typeof r.extensionId === 'string' &&
                typeof r.eventType === 'string' &&
                EVENT_TYPES.includes(r.eventType)
            );
            applyFiltersAndSort();
            checkHistoryLimit();
        } catch (e) {
            console.error('Error loading history:', e);
            showToast('Failed to load history data.', 'error');
            if (dom.noHistoryMessage) {
                dom.noHistoryMessage.innerHTML = '<div class="empty-state"><p>Could not load history.</p></div>';
                dom.noHistoryMessage.hidden = false;
            }
        } finally {
            if (showLoading) setBusyState(false);
        }
    };

    const applyFiltersAndSort = () => {
        const term = currentFilters.searchTerm;
        filteredRecords = allHistoryRecords.filter(r => {
            const searchMatch = !term ||
                (r.extensionName || '').toLowerCase().includes(term) ||
                (r.extensionId || '').toLowerCase().includes(term) ||
                (r.details || '').toLowerCase().includes(term);
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
            filteredRecords.sort((a, b) => (a.extensionName || '').localeCompare(b.extensionName || '') || b.timestamp - a.timestamp);
        } else if (so === 'type') {
            filteredRecords.sort((a, b) => a.eventType.localeCompare(b.eventType) || b.timestamp - a.timestamp);
        } else if (so === 'group') {
            filteredRecords.sort((a, b) => (a.extensionName || '').localeCompare(b.extensionName || '') || b.timestamp - a.timestamp);
        }

        currentPage = 1;
        totalPages  = Math.max(1, Math.ceil(filteredRecords.length / settings.logsPerPage));
        renderHistory();
        updateRecordCount();
    };

    const updateSettingsControlsState = () => {
        const on = dom.trackingEnabledToggle.checked;
        [dom.pruneNowButton, dom.pruneDaysInput, dom.recordLimitInput,
         dom.pruneInactiveBtn, dom.pruneByTypeBtn].forEach(el => { if (el) el.disabled = !on; });
    };

    const checkHistoryLimit = () => {
        if (!settings.trackingEnabled || allHistoryRecords.length <= settings.recordLimit) return;
        handleAutoPrune();
    };

    const handleAutoPrune = async () => {
        try {
            await chrome.runtime.sendMessage({ type: 'PRUNE_HISTORY_TO_LIMIT', payload: { limit: settings.recordLimit } });
            await loadInitialData(false);
            showToast(`History pruned to ${settings.recordLimit} records.`, 'success');
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
        const targetPanel = document.getElementById(targetId);
        if (!targetPanel) return;
        dom.sidebarButtons.forEach(btn => {
            const active = btn.dataset.panelTarget === targetId;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-current', active ? 'page' : 'false');
        });
        dom.panels.forEach(panel => {
            const isTarget = panel.id === targetId;
            panel.hidden = !isTarget;
            panel.classList.toggle('active', isTarget);
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
        if (!dom.historyList) return;
        while (dom.historyList.firstChild) dom.historyList.removeChild(dom.historyList.firstChild);
        const start = (currentPage - 1) * settings.logsPerPage;
        const page  = filteredRecords.slice(start, start + settings.logsPerPage);

        if (filteredRecords.length === 0) {
            dom.noHistoryMessage.hidden = false;
            dom.noHistoryMessage.innerHTML = `
                <div class="empty-state">
                    <span class="icon icon-search-off" style="width: 48px; height: 48px; margin-bottom: var(--space-3); opacity: 0.5;"></span>
                    <p>No events found.</p>
                    <p class="text-secondary">Try adjusting your filters or search terms.</p>
                </div>
            `;
            dom.paginationControls.hidden = true;
            return;
        }

        dom.noHistoryMessage.hidden = true;
        dom.paginationControls.hidden = false;

        const frag = document.createDocumentFragment();
        const isGroup = settings.sortOrder === 'group';

        if (isGroup) {
            let lastGroup = null;
            page.forEach(r => {
                const groupName = r.extensionName || 'Unknown Extension';
                if (groupName !== lastGroup) {
                    const h = document.createElement('h3');
                    h.className = 'history-group-header';
                    h.textContent = groupName;
                    frag.appendChild(h);
                    lastGroup = groupName;
                }
                frag.appendChild(createHistoryItemElement(r));
            });
        } else {
            let lastDay = null;
            page.forEach(r => {
                const dayKey = getDayKey(r.timestamp);
                if (dayKey !== lastDay) {
                    const h = document.createElement('h3');
                    h.className = 'history-day-header';
                    h.textContent = dayKey;
                    frag.appendChild(h);
                    lastDay = dayKey;
                }
                frag.appendChild(createHistoryItemElement(r));
            });
        }

        dom.historyList.appendChild(frag);
        renderPagination();
    };

    const getDayKey = (ts) => {
        const today = new Date().toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
        const yesterday = new Date(Date.now()-864e5).toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
        let key = new Date(ts).toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
        if (key === today) key = 'Today';
        else if (key === yesterday) key = 'Yesterday';
        return key;
    };

    const createHistoryItemElement = (record) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.recordId = record.id || `${record.timestamp}-${record.extensionId}-${record.eventType}`;
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'listitem');
        item.setAttribute('aria-label', `${record.extensionName || 'Unknown'}, ${formatEventType(record.eventType)}`);

        const iconWrap = document.createElement('div');
        iconWrap.className = 'item-icon';

        const ext = installedExtensions.get(record.extensionId);
        
        if (settings.showExtensionIcons) {
            const iconImg = document.createElement('img');
            iconImg.className = 'extension-icon-img';
            iconImg.alt = '';
            iconImg.loading = 'lazy';
            iconImg.src = ext?.iconUrl || `chrome://extension-icon/${record.extensionId}/32/0`;
            iconImg.onerror = function() {
                this.style.display = 'none';
                const fallback = document.createElement('div');
                fallback.className = 'extension-icon-fallback';
                fallback.textContent = (record.extensionName || '?').charAt(0).toUpperCase();
                iconWrap.appendChild(fallback);
            };
            iconWrap.appendChild(iconImg);
        } else {
            const icon = document.createElement('span');
            icon.className = `icon ${EVENT_ICON_MAP[record.eventType] || 'icon-info-status'}`;
            iconWrap.appendChild(icon);
        }

        const badge = document.createElement('span');
        badge.className = `status-badge status-badge-${record.eventType}`;
        iconWrap.appendChild(badge);

        const content = document.createElement('div');
        content.className = 'history-item-content';
        const header = document.createElement('div');
        header.className = 'history-item-header';
        header.innerHTML = highlightMatch(`${record.extensionName || 'Unknown'} (v${record.extensionVersion || 'N/A'})`, currentFilters.searchTerm);

        const metaRow = document.createElement('div');
        metaRow.className = 'history-item-meta-row';

        const details = document.createElement('span');
        details.className = 'history-item-details';
        const detailText = formatEventType(record.eventType) + (record.details ? ` — ${record.details}` : '');
        details.innerHTML = highlightMatch(detailText, currentFilters.searchTerm);

        metaRow.appendChild(details);
        content.append(header, metaRow);

        item.append(iconWrap, content);

        if (settings.displayTimestamps) {
            const time = document.createElement('div');
            time.className = 'history-item-meta';
            time.textContent = settings.relativeTimestamps
                ? formatRelativeTime(record.timestamp)
                : new Date(record.timestamp).toLocaleTimeString();
            item.appendChild(time);
        }

        item.addEventListener('click', () => openDetailModal(record));
        item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetailModal(record); } });
        return item;
    };

    const openDetailModal = (record) => {
        if (!dom.detailContent) return;
        const ext = installedExtensions.get(record.extensionId);
        const isInstalled = !!ext;
        const iconUrl = ext?.iconUrl || `chrome://extension-icon/${record.extensionId}/32/0`;
        
        const extHistory = allHistoryRecords
            .filter(r => r.extensionId === record.extensionId)
            .slice(0, 5);

        dom.detailContent.innerHTML = `
            <div class="detail-header">
                <img src="${escapeHtml(iconUrl)}" alt="" class="detail-icon" onerror="this.style.display='none'">
                <div class="detail-header-info">
                    <h4>${escapeHtml(record.extensionName || 'Unknown Extension')}</h4>
                    <span class="detail-version">Version ${escapeHtml(record.extensionVersion || 'N/A')}</span>
                </div>
            </div>
            
            <div class="detail-grid">
                <div class="detail-cell">
                    <strong>Event</strong>
                    <span class="detail-event detail-event-${record.eventType}">${formatEventType(record.eventType)}</span>
                </div>
                <div class="detail-cell">
                    <strong>Current Status</strong>
                    <span class="extension-status ${isInstalled ? (ext.enabled ? 'status-enabled' : 'status-disabled') : 'status-uninstalled'}">
                        ${isInstalled ? (ext.enabled ? 'Enabled' : 'Disabled') : 'Uninstalled'}
                    </span>
                </div>
                <div class="detail-cell">
                    <strong>Date</strong>
                    <span>${formatFullDate(record.timestamp)}</span>
                </div>
                <div class="detail-cell">
                    <strong>Relative Time</strong>
                    <span>${formatRelativeTime(record.timestamp)}</span>
                </div>
            </div>

            <div class="detail-row">
                <strong>Extension ID</strong>
                <code class="detail-code" id="detail-extension-id">${escapeHtml(record.extensionId)}</code>
            </div>

            ${record.details ? `
            <div class="detail-row detail-details">
                <strong>Event Details</strong>
                <p>${escapeHtml(record.details)}</p>
            </div>` : ''}

            ${extHistory.length > 1 ? `
            <div class="detail-recent">
                <strong>Recent Activity for This Extension</strong>
                <ul class="detail-recent-list">
                    ${extHistory.map(r => `
                        <li>
                            <span class="detail-recent-event detail-event-${r.eventType}">${formatEventType(r.eventType)}</span>
                            <span class="detail-recent-time">${settings.relativeTimestamps ? formatRelativeTime(r.timestamp) : new Date(r.timestamp).toLocaleTimeString()}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>` : ''}
        `;
        
        if (dom.copyDetailIdBtn) dom.copyDetailIdBtn.disabled = false;
        showModal('detailModal');
    };

    const handleCopyDetailId = async () => {
        const idEl = document.getElementById('detail-extension-id');
        if (!idEl) return;
        try {
            await navigator.clipboard.writeText(idEl.textContent);
            showToast('Extension ID copied to clipboard.', 'success');
        } catch (err) {
            showToast('Failed to copy.', 'error');
        }
    };

    const toggleFilterPanel = () => {
        const visible = !dom.filterPanel.classList.contains('is-visible');
        if (visible) {
            dom.filterPanel.hidden = false;
            dom.filterBackdrop.hidden = false;
            requestAnimationFrame(() => {
                dom.filterPanel.classList.add('is-visible');
                dom.filterBackdrop.classList.add('is-visible');
            });
            dom.filterToggleButton.setAttribute('aria-expanded', 'true');
        } else {
            dom.filterPanel.classList.remove('is-visible');
            dom.filterBackdrop.classList.remove('is-visible');
            dom.filterPanel.addEventListener('transitionend', () => {
                dom.filterPanel.hidden = true;
                dom.filterBackdrop.hidden = true;
            }, { once: true });
            dom.filterToggleButton.setAttribute('aria-expanded', 'false');
        }
    };

    const renderPagination = () => {
        if (!dom.paginationControls) return;
        dom.paginationControls.hidden = totalPages <= 1;
        dom.prevPageBtn.disabled = currentPage === 1;
        dom.nextPageBtn.disabled = currentPage === totalPages;
        dom.currentPageDisplay.textContent = currentPage;
        dom.totalPagesDisplay.textContent = totalPages;
    };

    const updateRecordCount = () => {
        if (!dom.recordCountDisplay) return;
        const start = Math.min((currentPage - 1) * settings.logsPerPage + 1, filteredRecords.length);
        const end   = Math.min(currentPage * settings.logsPerPage, filteredRecords.length);
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
        dom.sortOrderSelect.value            = settings.sortOrder;
        dom.logsPerPageInput.value           = settings.logsPerPage;
        dom.recordLimitInput.value           = settings.recordLimit;
        dom.displayTimestampsToggle.checked  = settings.displayTimestamps;
        dom.relativeTimestampsToggle.checked = settings.relativeTimestamps;
        dom.liveRefreshInput.value           = settings.liveRefreshSeconds;
        dom.showExtensionIconsToggle.checked = settings.showExtensionIcons;
        updateSettingsControlsState();
    };

    const readSettingsFromUI = () => {
        settings.trackingEnabled      = dom.trackingEnabledToggle.checked;
        settings.pruneDays            = Math.max(1, Math.min(3650, parseInt(dom.pruneDaysInput.value,10)||90));
        settings.sortOrder            = dom.sortOrderSelect.value;
        settings.logsPerPage          = Math.max(5, Math.min(500, parseInt(dom.logsPerPageInput.value,10)||25));
        settings.recordLimit          = Math.max(100, Math.min(10000, parseInt(dom.recordLimitInput.value,10)||1000));
        settings.displayTimestamps    = dom.displayTimestampsToggle.checked;
        settings.relativeTimestamps   = dom.relativeTimestampsToggle.checked;
        settings.liveRefreshSeconds   = Math.max(0, Math.min(300, parseInt(dom.liveRefreshInput.value,10)||0));
        settings.showExtensionIcons   = dom.showExtensionIconsToggle.checked;
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
            recordLimit: 1000, displayTimestamps: true,
            relativeTimestamps: false, liveRefreshSeconds: 0,
            showExtensionIcons: true,
        };
        syncSettingsToUI();
        await saveSettings();
        showToast('Settings reset to defaults.', 'success');
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
        if (s && e) {
            const startDate = new Date(s);
            const endDate = new Date(e);
            if (startDate > endDate) {
                showToast('Start date cannot be after end date.', 'error');
                dom.endDateInput.value = '';
                return;
            }
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
        if (!allHistoryRecords.length) {
            showToast('No history to clear.', 'info');
            return;
        }
        const previous = [...allHistoryRecords];
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

    const handleExportHistory = async () => {
        try {
            const res = await chrome.runtime.sendMessage({ type: 'GET_EXTENSION_HISTORY' });
            const history = res?.history || [];
            const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `modcore-timeline-${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('History exported.', 'success');
        } catch (e) {
            console.error('Export failed:', e);
            showToast('Failed to export history.', 'error');
        }
    };

    const handleImportFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const imported = JSON.parse(text);
            if (!Array.isArray(imported)) throw new Error('Invalid file format.');
            const valid = imported.filter(r =>
                r && typeof r === 'object' &&
                typeof r.timestamp === 'number' &&
                typeof r.extensionId === 'string' &&
                typeof r.eventType === 'string'
            );
            if (valid.length === 0) throw new Error('No valid records found.');

            const res = await chrome.runtime.sendMessage({ type: 'GET_EXTENSION_HISTORY' });
            const current = res?.history || [];
            const merged = [...valid, ...current];
            merged.sort((a, b) => b.timestamp - a.timestamp);
            const seen = new Set();
            const deduped = merged.filter(r => {
                const key = r.id || `${r.timestamp}-${r.extensionId}-${r.eventType}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            await chrome.runtime.sendMessage({ type: 'RESTORE_HISTORY', payload: deduped });
            await loadInitialData();
            showToast(`Imported ${valid.length} records.`, 'success');
        } catch (err) {
            showToast(`Import failed: ${err.message}`, 'error');
        } finally {
            e.target.value = '';
        }
    };

    /* ---------------------------------------------------------------------- */
    /*  Entry Point                                                           */
    /* ---------------------------------------------------------------------- */
    document.addEventListener('DOMContentLoaded', initializeApp);
})();