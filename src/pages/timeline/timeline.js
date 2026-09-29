/**
 * timeline.js - modcore Timeline
 *
 * UI controller. Responsibilities:
 *  - fetch history + settings, keep in-memory state
 *  - filter / sort / paginate
 *  - render list, detail dialog, filter popover
 *  - delegate user input events
 */
(() => {
    'use strict';

    /* ---------------------------------------------------------------------- */
    /*  Config                                                                */
    /* ---------------------------------------------------------------------- */
    const SEARCH_DEBOUNCE_MS        = 200;
    const SETTINGS_SAVE_DEBOUNCE_MS = 400;
    const MAX_DETAIL_HISTORY_ROWS   = 6;

    const EVENT_TYPES = [
        'installed', 'uninstalled', 'updated',
        'permissions_updated', 'enabled', 'disabled',
    ];

    /**
     * Schema-driven settings bindings. Each entry maps a settings key to the
     * DOM element, the property to read/write, and how to coerce the value.
     * Adding a setting means adding a single line here.
     */
    const SETTINGS_BINDINGS = [
        { key: 'trackingEnabled', domKey: 'trackingEnabledToggle', prop: 'checked', kind: 'bool' },
        { key: 'sortOrder',       domKey: 'sortOrderSelect',       prop: 'value',  kind: 'string' },
        { key: 'logsPerPage',     domKey: 'logsPerPageInput',      prop: 'value',  kind: 'int', min: 5,   max: 500 },
        { key: 'pruneDays',       domKey: 'pruneDaysInput',        prop: 'value',  kind: 'int', min: 1,   max: 3650 },
        { key: 'recordLimit',     domKey: 'recordLimitInput',      prop: 'value',  kind: 'int', min: 100, max: 10000 },
    ];

    const DEFAULT_SETTINGS = {
        trackingEnabled: true,
        sortOrder:       'desc',
        logsPerPage:     25,
        pruneDays:       90,
        recordLimit:     1000,
    };

    /* ---------------------------------------------------------------------- */
    /*  State                                                                 */
    /* ---------------------------------------------------------------------- */
    let allHistoryRecords = [];
    let filteredRecords   = [];
    let installedExtensions = new Map();
    let settings = { ...DEFAULT_SETTINGS };

    let currentFilters = {
        searchTerm: '',
        eventTypes: new Set(EVENT_TYPES),
        startDate:  null,
        endDate:    null,
    };

    let currentPage = 1;
    let totalPages  = 1;

    /** Map of recordId -> record, for event delegation on the list. */
    const renderedRecords = new Map();

    const dom = {};

    /* ---------------------------------------------------------------------- */
    /*  Utilities                                                             */
    /* ---------------------------------------------------------------------- */
    const debounce = (fn, wait) => {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
    };

    const escapeHtml = (str) => {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[m]));
    };

    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const highlightMatch = (text, term) => {
        if (!term || !text) return escapeHtml(text);
        const re = new RegExp(`(${escapeRegex(term)})`, 'gi');
        return String(text).split(re)
            .map(part => part.toLowerCase() === term.toLowerCase()
                ? `<mark>${escapeHtml(part)}</mark>`
                : escapeHtml(part))
            .join('');
    };

    const status = (typeof window !== 'undefined' && window.Status) ? window.Status : null;
    const notify = {
        info:    (m, d) => status ? status.info(m, d)    : console.log('[info]', m),
        success: (m, d) => status ? status.success(m, d) : console.log('[success]', m),
        warning: (m, d) => status ? status.warning(m, d) : console.warn('[warning]', m),
        error:   (m, d) => status ? status.error(m, d)   : console.error('[error]', m),
    };

    const formatEventType = (t) => t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    const formatFullDate = (ts) => new Date(ts).toLocaleString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const formatShortDate = (ts) => new Date(ts).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
    });

    const recordKey = (r) =>
        r.id || `${r.timestamp}-${r.extensionId}-${r.eventType}`;

    /* ---------------------------------------------------------------------- */
    /*  DOM cache                                                             */
    /* ---------------------------------------------------------------------- */
    const cacheDomElements = () => {
        const get = (id) => document.getElementById(id);

        dom.contentArea      = document.querySelector('.content-area');
        dom.initialLoading   = get('initial-loading-indicator');
        dom.currentYear      = get('current-year');
        dom.panels           = document.querySelectorAll('.content-panel');
        dom.sidebarButtons   = document.querySelectorAll('.sidebar-button[data-panel-target]');
        dom.panelLinkButtons = document.querySelectorAll('[data-panel-target]');

        /* History */
        dom.historyList        = get('history-list');
        dom.noHistoryMessage   = get('no-history-message');
        dom.searchInput        = get('search-input');
        dom.clearSearchBtn     = get('clear-search-btn');
        dom.filterToggleButton = get('filter-toggle-btn');
        dom.filterPanel        = get('filter-panel');
        dom.eventTypeFilters   = get('event-type-filters');
        dom.startDateInput     = get('start-date-input');
        dom.endDateInput       = get('end-date-input');
        dom.clearAllButton     = get('clear-all-btn');
        dom.resetFiltersBtn    = get('reset-filters-btn');
        dom.selectAllFiltersBtn  = get('select-all-filters-btn');
        dom.selectNoneFiltersBtn = get('select-none-filters-btn');

        /* Pagination */
        dom.paginationControls = get('pagination-controls');
        dom.prevPageBtn        = get('prev-page-btn');
        dom.nextPageBtn        = get('next-page-btn');
        dom.currentPageDisplay = get('current-page-display');
        dom.totalPagesDisplay  = get('total-pages-display');

        /* Settings */
        dom.trackingEnabledToggle  = get('tracking-enabled-toggle');
        dom.pruneDaysInput         = get('prune-days-input');
        dom.pruneNowButton         = get('prune-now-btn');
        dom.sortOrderSelect        = get('sort-order-select');
        dom.logsPerPageInput       = get('logs-per-page-input');
        dom.recordLimitInput       = get('record-limit-input');
        dom.resetDefaultsBtn       = get('reset-defaults-btn');
        dom.settingsSavedIndicator = get('settings-saved-indicator');
        dom.pruneInactiveBtn       = get('prune-inactive-btn');
        dom.pruneByTypeBtn         = get('prune-by-type-btn');

        /* Dialogs */
        dom.pruneByTypeModal    = get('prune-by-type-modal');
        dom.pruneTypeOptions    = get('prune-type-options');
        dom.pruneTypeCancelBtn  = get('prune-type-cancel-btn');
        dom.pruneTypeConfirmBtn = get('prune-type-confirm-btn');

        dom.detailModal     = get('detail-modal');
        dom.detailContent   = get('detail-content');
        dom.closeDetailBtn  = get('close-detail-btn');
        dom.copyDetailIdBtn = get('copy-detail-id-btn');

        dom.checkboxTemplate = get('checkbox-template');
    };

    /* ---------------------------------------------------------------------- */
    /*  Dialog helpers                                                        */
    /* ---------------------------------------------------------------------- */
    const showDialog = (dialog) => {
        if (!dialog) return;
        if (typeof dialog.showModal === 'function') {
            if (!dialog.open) dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
    };

    const closeDialog = (dialog) => {
        if (!dialog) return;
        if (typeof dialog.close === 'function') {
            if (dialog.open) dialog.close();
        } else {
            dialog.removeAttribute('open');
        }
    };

    /* ---------------------------------------------------------------------- */
    /*  Shared UI builders                                                    */
    /* ---------------------------------------------------------------------- */
    const buildCheckbox = (type, checked) => {
        const node = dom.checkboxTemplate.content.firstElementChild.cloneNode(true);
        const input = node.querySelector('input');
        input.value = type;
        input.checked = checked;
        node.querySelector('.checkbox-label').textContent = formatEventType(type);
        return node;
    };

    const buildEmptyState = () => {
        const wrap = document.createElement('div');
        wrap.className = 'empty-state';
        const icon = document.createElement('span');
        icon.className = 'icon icon-search-off';
        icon.style.cssText = 'width:48px;height:48px;margin-bottom:var(--space-3);opacity:.5';
        icon.setAttribute('aria-hidden', 'true');
        const msg = document.createElement('p');
        msg.textContent = 'No events found.';
        const hint = document.createElement('p');
        hint.className = 'text-secondary';
        hint.textContent = 'Try adjusting your filters or search terms.';
        wrap.append(icon, msg, hint);
        return wrap;
    };

    /* ---------------------------------------------------------------------- */
    /*  Loading                                                               */
    /* ---------------------------------------------------------------------- */
    const setBusyState = (busy) => {
        if (!dom.initialLoading || !dom.contentArea) return;
        dom.initialLoading.style.display = busy ? 'flex' : 'none';
        dom.contentArea.style.opacity = busy ? '0.5' : '1';
        dom.contentArea.style.pointerEvents = busy ? 'none' : 'auto';
        dom.sidebarButtons.forEach(b => b.disabled = busy);
    };

    const setActionLoading = (busy) => {
        [dom.clearAllButton, dom.pruneNowButton, dom.pruneInactiveBtn,
         dom.pruneByTypeBtn, dom.resetDefaultsBtn]
            .forEach(b => { if (b) b.disabled = busy; });
    };

    /* ---------------------------------------------------------------------- */
    /*  Data loading                                                          */
    /* ---------------------------------------------------------------------- */
    const loadInstalledExtensions = async () => {
        try {
            const exts = await chrome.management.getAll();
            installedExtensions = new Map(exts.map(e => [e.id, {
                name:    e.name,
                enabled: e.enabled,
                iconUrl: e.icons?.[e.icons.length - 1]?.url || e.icons?.[0]?.url || null,
            }]));
        } catch (e) {
            console.warn('Failed to load installed extensions:', e);
        }
    };

    const loadSettings = async () => {
        try {
            const res = await chrome.runtime.sendMessage({ type: 'GET_HISTORY_SETTINGS' });
            if (res?.settings) settings = { ...DEFAULT_SETTINGS, ...res.settings };
            syncSettingsToUI();
        } catch (e) {
            console.error('Error loading settings:', e);
            notify.error('Failed to load settings.');
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
            notify.error('Failed to load history data.');
            if (dom.noHistoryMessage) {
                dom.noHistoryMessage.replaceChildren(buildEmptyState());
                dom.noHistoryMessage.hidden = false;
            }
        } finally {
            if (showLoading) setBusyState(false);
        }
    };

    /* ---------------------------------------------------------------------- */
    /*  Filtering / sorting / pagination                                      */
    /* ---------------------------------------------------------------------- */
    const applyFiltersAndSort = () => {
        const term = currentFilters.searchTerm;
        const types = currentFilters.eventTypes;
        const s = currentFilters.startDate;
        const e = currentFilters.endDate;

        filteredRecords = allHistoryRecords.filter(r => {
            if (!types.has(r.eventType)) return false;
            if (s && r.timestamp < s) return false;
            if (e && r.timestamp > e) return false;
            if (!term) return true;
            return (r.extensionName || '').toLowerCase().includes(term)
                || (r.extensionId   || '').toLowerCase().includes(term)
                || (r.details       || '').toLowerCase().includes(term);
        });

        const so = settings.sortOrder;
        if (so === 'desc' || so === 'asc') {
            const dir = so === 'desc' ? -1 : 1;
            filteredRecords.sort((a, b) => dir * (a.timestamp - b.timestamp));
        } else if (so === 'name' || so === 'group') {
            filteredRecords.sort((a, b) =>
                (a.extensionName || '').localeCompare(b.extensionName || '')
                || (b.timestamp - a.timestamp));
        } else if (so === 'type') {
            filteredRecords.sort((a, b) =>
                a.eventType.localeCompare(b.eventType)
                || (b.timestamp - a.timestamp));
        }

        currentPage = 1;
        totalPages  = Math.max(1, Math.ceil(filteredRecords.length / settings.logsPerPage));
        renderHistory();
    };

    const handlePageChange = (dir) => {
        const np = currentPage + dir;
        if (np > 0 && np <= totalPages) {
            currentPage = np;
            renderHistory();
        }
    };

    /* ---------------------------------------------------------------------- */
    /*  History list rendering                                                */
    /* ---------------------------------------------------------------------- */
    const getDayKey = (ts) => {
        const fmt = (d) => d.toLocaleDateString(undefined,
            { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const todayStr     = fmt(new Date());
        const yesterdayStr = fmt(new Date(Date.now() - 864e5));
        const key = fmt(new Date(ts));
        if (key === todayStr) return 'Today';
        if (key === yesterdayStr) return 'Yesterday';
        return key;
    };

    const buildHistoryItem = (record) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const key = recordKey(record);
        item.dataset.recordId = key;
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'listitem');
        item.setAttribute('aria-label',
            `${record.extensionName || 'Unknown'}, ${formatEventType(record.eventType)}`);
        renderedRecords.set(key, record);

        /* Icon + badge */
        const iconWrap = document.createElement('div');
        iconWrap.className = 'item-icon';
        const ext = installedExtensions.get(record.extensionId);
        const iconImg = document.createElement('img');
        iconImg.className = 'extension-icon-img';
        iconImg.alt = '';
        iconImg.loading = 'lazy';
        iconImg.src = ext?.iconUrl || `chrome://extension-icon/${record.extensionId}/32/0`;
        iconWrap.appendChild(iconImg);

        const badge = document.createElement('span');
        badge.className = `status-badge status-badge-${record.eventType}`;
        iconWrap.appendChild(badge);

        /* Content */
        const content = document.createElement('div');
        content.className = 'history-item-content';

        const header = document.createElement('div');
        header.className = 'history-item-header';
        header.innerHTML = highlightMatch(
            `${record.extensionName || 'Unknown'} (v${record.extensionVersion || 'N/A'})`,
            currentFilters.searchTerm
        );

        const metaRow = document.createElement('div');
        metaRow.className = 'history-item-meta-row';
        const details = document.createElement('span');
        details.className = 'history-item-details';
        const detailText = formatEventType(record.eventType)
            + (record.details ? ` — ${record.details}` : '');
        details.innerHTML = highlightMatch(detailText, currentFilters.searchTerm);
        metaRow.appendChild(details);

        content.append(header, metaRow);
        item.append(iconWrap, content);

        const time = document.createElement('div');
        time.className = 'history-item-meta';
        time.textContent = new Date(record.timestamp).toLocaleTimeString();
        item.appendChild(time);

        return item;
    };

    const renderHistory = () => {
        if (!dom.historyList) return;
        dom.historyList.replaceChildren();
        renderedRecords.clear();

        const page = filteredRecords.slice(
            (currentPage - 1) * settings.logsPerPage,
            currentPage * settings.logsPerPage
        );

        if (filteredRecords.length === 0) {
            dom.noHistoryMessage.replaceChildren(buildEmptyState());
            dom.noHistoryMessage.hidden = false;
            dom.paginationControls.hidden = true;
            return;
        }

        dom.noHistoryMessage.hidden = true;
        dom.paginationControls.hidden = false;

        const frag = document.createDocumentFragment();
        const isGroup = settings.sortOrder === 'group';
        let lastGroupKey = null;

        for (const r of page) {
            const groupKey = isGroup ? (r.extensionName || 'Unknown Extension')
                                     : getDayKey(r.timestamp);
            if (groupKey !== lastGroupKey) {
                const h = document.createElement('h3');
                h.className = isGroup ? 'history-group-header' : 'history-day-header';
                h.textContent = groupKey;
                frag.appendChild(h);
                lastGroupKey = groupKey;
            }
            frag.appendChild(buildHistoryItem(r));
        }

        dom.historyList.appendChild(frag);
        renderPagination();
    };

    const renderPagination = () => {
        if (!dom.paginationControls) return;
        dom.paginationControls.hidden = totalPages <= 1;
        dom.prevPageBtn.disabled = currentPage === 1;
        dom.nextPageBtn.disabled = currentPage === totalPages;
        dom.currentPageDisplay.textContent = currentPage;
        dom.totalPagesDisplay.textContent = totalPages;
    };

    /* ---------------------------------------------------------------------- */
    /*  Detail dialog                                                         */
    /* ---------------------------------------------------------------------- */
    const openDetailModal = (record) => {
        if (!dom.detailContent) return;

        const ext = installedExtensions.get(record.extensionId);
        const iconUrl = ext?.iconUrl || `chrome://extension-icon/${record.extensionId}/32/0`;

        const extHistory = allHistoryRecords.filter(r => r.extensionId === record.extensionId);
        const totalEvents = extHistory.length;
        const firstSeen = totalEvents ? Math.min(...extHistory.map(r => r.timestamp)) : record.timestamp;
        const lastSeen  = totalEvents ? Math.max(...extHistory.map(r => r.timestamp)) : record.timestamp;
        const recent = extHistory
            .slice()
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, MAX_DETAIL_HISTORY_ROWS);

        const frag = document.createDocumentFragment();

        /* Header */
        const header = document.createElement('div');
        header.className = 'detail-header';
        const icon = document.createElement('img');
        icon.className = 'detail-icon';
        icon.alt = '';
        icon.src = iconUrl;
        icon.addEventListener('error', () => { icon.style.display = 'none'; }, { once: true });
        const headerInfo = document.createElement('div');
        headerInfo.className = 'detail-header-info';
        const h4 = document.createElement('h4');
        h4.textContent = record.extensionName || 'Unknown Extension';
        const versionSpan = document.createElement('span');
        versionSpan.className = 'detail-version';
        versionSpan.textContent = `Version ${record.extensionVersion || 'N/A'}`;
        headerInfo.append(h4, versionSpan);
        header.append(icon, headerInfo);
        frag.appendChild(header);

        /* Event + When */
        frag.append(
            makeDetailRow('Event', formatEventType(record.eventType)),
            makeDetailRow('When',  formatFullDate(record.timestamp)),
        );

        /* Extension ID */
        const idRow = document.createElement('div');
        idRow.className = 'detail-row';
        const idLabel = document.createElement('strong');
        idLabel.textContent = 'Extension ID';
        const idCode = document.createElement('code');
        idCode.className = 'detail-code';
        idCode.id = 'detail-extension-id';
        idCode.textContent = record.extensionId;
        idRow.append(idLabel, idCode);
        frag.appendChild(idRow);

        /* Optional details */
        if (record.details) {
            const detailsRow = document.createElement('div');
            detailsRow.className = 'detail-row detail-details';
            const detailsLabel = document.createElement('strong');
            detailsLabel.textContent = 'Event Details';
            const detailsPara = document.createElement('p');
            detailsPara.textContent = record.details;
            detailsRow.append(detailsLabel, detailsPara);
            frag.appendChild(detailsRow);
        }

        /* Insights */
        const insightsTitle = document.createElement('h5');
        insightsTitle.className = 'detail-section-title';
        insightsTitle.textContent = 'Insights';
        frag.appendChild(insightsTitle);

        const statsGrid = document.createElement('div');
        statsGrid.className = 'detail-stats-grid';
        statsGrid.append(
            makeStatCell('Total Events', String(totalEvents)),
            makeStatCell('Current Status',
                ext ? (ext.enabled ? 'Enabled' : 'Disabled') : 'Uninstalled'),
            makeStatCell('First Seen', formatShortDate(firstSeen)),
            makeStatCell('Last Seen',  formatShortDate(lastSeen)),
        );
        frag.appendChild(statsGrid);

        /* Recent activity */
        if (recent.length > 0) {
            const recentTitle = document.createElement('h5');
            recentTitle.className = 'detail-section-title';
            recentTitle.textContent = 'Recent Activity';
            frag.appendChild(recentTitle);

            const list = document.createElement('ul');
            list.className = 'detail-recent-list';
            for (const r of recent) {
                const li = document.createElement('li');
                const left = document.createElement('div');
                left.className = 'detail-recent-event';
                const typeSpan = document.createElement('strong');
                typeSpan.textContent = formatEventType(r.eventType);
                left.appendChild(typeSpan);
                if (r.details) {
                    const detailsSpan = document.createElement('span');
                    detailsSpan.className = 'detail-recent-details';
                    detailsSpan.textContent = r.details;
                    left.appendChild(detailsSpan);
                }
                const timeSpan = document.createElement('span');
                timeSpan.className = 'detail-recent-time';
                timeSpan.textContent = formatFullDate(r.timestamp);
                li.append(left, timeSpan);
                list.appendChild(li);
            }
            frag.appendChild(list);
        }

        dom.detailContent.replaceChildren(frag);
        if (dom.copyDetailIdBtn) dom.copyDetailIdBtn.disabled = false;
        showDialog(dom.detailModal);
    };

    const makeDetailRow = (label, value) => {
        const div = document.createElement('div');
        div.className = 'detail-row';
        const strong = document.createElement('strong');
        strong.textContent = label;
        const span = document.createElement('span');
        span.textContent = value;
        div.append(strong, span);
        return div;
    };

    const makeStatCell = (label, value) => {
        const div = document.createElement('div');
        div.className = 'detail-cell';
        const strong = document.createElement('strong');
        strong.textContent = label;
        const span = document.createElement('span');
        span.textContent = value;
        div.append(strong, span);
        return div;
    };

    const handleCopyDetailId = async () => {
        const idEl = document.getElementById('detail-extension-id');
        if (!idEl) return;
        try {
            await navigator.clipboard.writeText(idEl.textContent);
            notify.success('Extension ID copied to clipboard.');
        } catch {
            notify.error('Failed to copy.');
        }
    };

    /* ---------------------------------------------------------------------- */
    /*  Settings                                                              */
    /* ---------------------------------------------------------------------- */
    const syncSettingsToUI = () => {
        for (const b of SETTINGS_BINDINGS) {
            const el = dom[b.domKey];
            if (el) el[b.prop] = settings[b.key];
        }
        updateSettingsControlsState();
    };

    const readSettingsFromUI = () => {
        for (const b of SETTINGS_BINDINGS) {
            const el = dom[b.domKey];
            if (!el) continue;
            let v = el[b.prop];
            if (b.kind === 'bool') {
                v = !!v;
            } else if (b.kind === 'int') {
                v = parseInt(v, 10);
                if (!Number.isFinite(v)) v = settings[b.key];
                if (b.min != null) v = Math.max(b.min, v);
                if (b.max != null) v = Math.min(b.max, v);
            }
            settings[b.key] = v;
        }
    };

    const updateSettingsControlsState = () => {
        const on = dom.trackingEnabledToggle.checked;
        [dom.pruneNowButton, dom.pruneDaysInput, dom.recordLimitInput,
         dom.pruneInactiveBtn, dom.pruneByTypeBtn]
            .forEach(el => { if (el) el.disabled = !on; });
    };

    const showSaveIndicator = () => {
        if (!dom.settingsSavedIndicator) return;
        dom.settingsSavedIndicator.hidden = false;
        dom.settingsSavedIndicator.classList.add('visible');
        clearTimeout(dom.settingsSavedIndicator._t);
        dom.settingsSavedIndicator._t = setTimeout(
            () => dom.settingsSavedIndicator.classList.remove('visible'), 2000);
    };

    const saveSettings = async (showFeedback = true) => {
        readSettingsFromUI();
        try {
            await chrome.runtime.sendMessage({
                type: 'UPDATE_HISTORY_SETTINGS',
                payload: settings,
            });
            if (showFeedback) notify.success('Settings saved.');
            else showSaveIndicator();
            applyFiltersAndSort();
            checkHistoryLimit();
        } catch (e) {
            console.error('Error saving settings:', e);
            notify.error('Failed to save settings.');
        }
    };

    const debouncedAutoSave = debounce(() => saveSettings(false), SETTINGS_SAVE_DEBOUNCE_MS);

    const checkHistoryLimit = () => {
        if (!settings.trackingEnabled) return;
        if (allHistoryRecords.length <= settings.recordLimit) return;
        handleAutoPrune();
    };

    const handleAutoPrune = async () => {
        try {
            await chrome.runtime.sendMessage({
                type: 'PRUNE_HISTORY_TO_LIMIT',
                payload: { limit: settings.recordLimit },
            });
            await loadInitialData(false);
            notify.success(`History pruned to ${settings.recordLimit} records.`);
        } catch (e) {
            console.error('Auto-prune failed:', e);
        }
    };

    const handleResetDefaults = async () => {
        if (!confirm('Reset all settings to defaults?')) return;
        settings = { ...DEFAULT_SETTINGS };
        syncSettingsToUI();
        await saveSettings();
        notify.success('Settings reset to defaults.');
    };

    /* ---------------------------------------------------------------------- */
    /*  Filter checkboxes                                                     */
    /* ---------------------------------------------------------------------- */
    const buildFilterCheckboxes = () => {
        const frag = document.createDocumentFragment();
        for (const type of EVENT_TYPES) {
            frag.appendChild(buildCheckbox(type, currentFilters.eventTypes.has(type)));
        }
        dom.eventTypeFilters.replaceChildren(frag);
    };

    /* ---------------------------------------------------------------------- */
    /*  Handlers                                                              */
    /* ---------------------------------------------------------------------- */
    const switchPanel = (targetId) => {
        const target = document.getElementById(targetId);
        if (!target) return;

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

        // Close the filter popover when leaving the history panel.
        if (dom.filterPanel?.matches(':popover-open')) {
            dom.filterPanel.hidePopover();
        }
    };

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
            notify.error('Start date cannot be after end date.');
            dom.endDateInput.value = '';
            return;
        }
        currentFilters.startDate = s ? new Date(s).getTime() : null;
        currentFilters.endDate   = e ? new Date(e).setHours(23, 59, 59, 999) : null;
        applyFiltersAndSort();
    };

    const handleResetFilters = () => {
        currentFilters = {
            searchTerm: '',
            eventTypes: new Set(EVENT_TYPES),
            startDate: null,
            endDate: null,
        };
        dom.searchInput.value = '';
        dom.clearSearchBtn.hidden = true;
        dom.startDateInput.value = '';
        dom.endDateInput.value = '';
        buildFilterCheckboxes();
        applyFiltersAndSort();
        notify.info('Filters reset.');
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

    const handleClearAllHistory = async () => {
        if (!allHistoryRecords.length) {
            notify.info('No history to clear.');
            return;
        }
        if (!confirm('Delete ALL history records? This cannot be undone.')) return;
        try {
            await chrome.runtime.sendMessage({ type: 'CLEAR_EXTENSION_HISTORY' });
            allHistoryRecords = [];
            applyFiltersAndSort();
            notify.success('All history cleared.');
        } catch (e) {
            console.error('Error clearing history:', e);
            notify.error('Failed to clear history.');
        }
    };

    const handlePruneNow = async () => {
        const days = parseInt(dom.pruneDaysInput.value, 10);
        if (!Number.isFinite(days) || days < 1) {
            notify.error('Enter a valid number of days (1+).');
            return;
        }
        if (!confirm(`Prune all records older than ${days} days?`)) return;
        setActionLoading(true);
        try {
            await chrome.runtime.sendMessage({
                type: 'PRUNE_HISTORY_BY_DAYS',
                payload: { daysToKeep: days },
            });
            await loadInitialData();
            notify.success(`Records older than ${days} days pruned.`);
        } catch (e) {
            console.error('Prune failed:', e);
            notify.error('Failed to prune history.');
        } finally {
            setActionLoading(false);
        }
    };

    const handlePruneInactive = async () => {
        if (!confirm('Prune all records for extensions that are currently uninstalled?')) return;
        setActionLoading(true);
        try {
            await chrome.runtime.sendMessage({ type: 'PRUNE_INACTIVE_EXTENSIONS' });
            await loadInitialData();
            notify.success('Inactive extension history pruned.');
        } catch (e) {
            console.error('Prune inactive failed:', e);
            notify.error('Failed to prune inactive history.');
        } finally {
            setActionLoading(false);
        }
    };

    const openPruneByTypeModal = () => {
        const frag = document.createDocumentFragment();
        for (const type of EVENT_TYPES) {
            frag.appendChild(buildCheckbox(type, false));
        }
        dom.pruneTypeOptions.replaceChildren(frag);
        dom.pruneTypeConfirmBtn.disabled = true;
        showDialog(dom.pruneByTypeModal);
    };

    const handlePruneByTypeConfirm = async () => {
        const types = Array.from(
            dom.pruneTypeOptions.querySelectorAll('input:checked')
        ).map(i => i.value);
        if (!types.length) return;
        setActionLoading(true);
        try {
            await chrome.runtime.sendMessage({
                type: 'PRUNE_HISTORY_BY_TYPES',
                payload: types,
            });
            await loadInitialData();
            notify.success('Selected event types pruned.');
            closeDialog(dom.pruneByTypeModal);
        } catch (e) {
            console.error('Prune by type failed:', e);
            notify.error('Failed to prune by type.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleGlobalKeydown = (e) => {
        if (e.key === 'Escape' && document.activeElement === dom.searchInput && dom.searchInput.value) {
            handleClearSearch();
            return;
        }
        if (e.key === '/' &&
            !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
            e.preventDefault();
            dom.searchInput.focus();
        }
    };

    /* ---------------------------------------------------------------------- */
    /*  Event wiring                                                          */
    /* ---------------------------------------------------------------------- */
    const setupEventListeners = () => {
        /* Navigation */
        dom.panelLinkButtons.forEach(btn => {
            btn.addEventListener('click', () => switchPanel(btn.dataset.panelTarget));
        });

        /* Search */
        dom.searchInput.addEventListener('input', debounce(handleSearchInput, SEARCH_DEBOUNCE_MS));
        dom.clearSearchBtn.addEventListener('click', handleClearSearch);

        /* Filter panel — native popover handles toggle/light-dismiss/Escape.
           We only sync aria-expanded and initial checkbox building. */
        dom.filterPanel.addEventListener('toggle', (e) => {
            dom.filterToggleButton.setAttribute(
                'aria-expanded',
                e.newState === 'open' ? 'true' : 'false'
            );
        });
        dom.resetFiltersBtn.addEventListener('click', handleResetFilters);
        dom.selectAllFiltersBtn.addEventListener('click', handleSelectAllFilters);
        dom.selectNoneFiltersBtn.addEventListener('click', handleSelectNoneFilters);
        dom.eventTypeFilters.addEventListener('change', handleFilterChange);
        dom.startDateInput.addEventListener('change', handleDateFilterChange);
        dom.endDateInput.addEventListener('change', handleDateFilterChange);

        /* History list — event delegation (no per-item listeners) */
        dom.historyList.addEventListener('click', (e) => {
            const item = e.target.closest('.history-item');
            if (!item) return;
            const record = renderedRecords.get(item.dataset.recordId);
            if (record) openDetailModal(record);
        });
        dom.historyList.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const item = e.target.closest('.history-item');
            if (!item) return;
            e.preventDefault();
            const record = renderedRecords.get(item.dataset.recordId);
            if (record) openDetailModal(record);
        });
        /* Icon load failures bubble via capture phase (error doesn't bubble) */
        dom.historyList.addEventListener('error', (e) => {
            const img = e.target;
            if (!(img instanceof HTMLImageElement)) return;
            if (!img.classList.contains('extension-icon-img')) return;
            img.style.display = 'none';
            const wrap = img.parentElement;
            if (!wrap || wrap.querySelector('.extension-icon-fallback')) return;
            const fallback = document.createElement('div');
            fallback.className = 'extension-icon-fallback';
            const record = renderedRecords.get(wrap.parentElement?.dataset?.recordId);
            fallback.textContent = (record?.extensionName || '?').charAt(0).toUpperCase();
            wrap.appendChild(fallback);
        }, true);

        /* Pagination */
        dom.prevPageBtn.addEventListener('click', () => handlePageChange(-1));
        dom.nextPageBtn.addEventListener('click', () => handlePageChange(1));

        /* Settings — bind change events via schema */
        for (const b of SETTINGS_BINDINGS) {
            const el = dom[b.domKey];
            if (!el) continue;
            el.addEventListener('change', () => {
                if (b.kind === 'int') {
                    let v = parseInt(el.value, 10);
                    if (!Number.isFinite(v)) v = b.min ?? 0;
                    if (b.min != null) v = Math.max(b.min, v);
                    if (b.max != null) v = Math.min(b.max, v);
                    el.value = v;
                }
                debouncedAutoSave();
            });
        }
        dom.trackingEnabledToggle.addEventListener('change', updateSettingsControlsState);

        /* Data management */
        dom.pruneNowButton.addEventListener('click', handlePruneNow);
        dom.pruneInactiveBtn.addEventListener('click', handlePruneInactive);
        dom.pruneByTypeBtn.addEventListener('click', openPruneByTypeModal);
        dom.clearAllButton.addEventListener('click', handleClearAllHistory);
        dom.resetDefaultsBtn.addEventListener('click', handleResetDefaults);

        /* Prune dialog */
        dom.pruneTypeCancelBtn.addEventListener('click', () => closeDialog(dom.pruneByTypeModal));
        dom.pruneTypeConfirmBtn.addEventListener('click', handlePruneByTypeConfirm);
        dom.pruneTypeOptions.addEventListener('change', () => {
            dom.pruneTypeConfirmBtn.disabled =
                dom.pruneTypeOptions.querySelectorAll('input:checked').length === 0;
        });

        /* Detail dialog */
        dom.closeDetailBtn?.addEventListener('click', () => closeDialog(dom.detailModal));
        dom.copyDetailIdBtn?.addEventListener('click', handleCopyDetailId);

        /* Click outside dialog = close (native dialog doesn't do this by default) */
        [dom.pruneByTypeModal, dom.detailModal].forEach(dlg => {
            dlg?.addEventListener('click', (e) => {
                if (e.target === dlg) dlg.close();
            });
        });

        document.addEventListener('keydown', handleGlobalKeydown);
    };

    /* ---------------------------------------------------------------------- */
    /*  Entry point                                                           */
    /* ---------------------------------------------------------------------- */
    const initializeApp = async () => {
        cacheDomElements();
        setupEventListeners();
        setBusyState(true);

        await Promise.all([
            loadSettings(),
            loadInstalledExtensions(),
            loadInitialData(false),
        ]);

        buildFilterCheckboxes();
        if (dom.currentYear) dom.currentYear.textContent = new Date().getFullYear();
        checkHistoryLimit();
        setBusyState(false);
    };

    document.addEventListener('DOMContentLoaded', initializeApp);
})();