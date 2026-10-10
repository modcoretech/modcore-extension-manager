/**
 * timeline.js - modcore Timeline
 */
(() => {
    'use strict';

    /* ---------------------------------------------------------------------- */
    /*  Config                                                                */
    /* ---------------------------------------------------------------------- */
    const SEARCH_DEBOUNCE_MS  = 200;
    const SAVE_DEBOUNCE_MS    = 400;
    const REFRESH_DEBOUNCE_MS = 150;
    const DETAIL_RECENT_ROWS  = 6;
    const HISTORY_KEY         = 'timeline_activity'; // must match timeline-manager.js
    const DAY_MS              = 864e5;

    const TYPE_LABELS = {
        installed:           'Installed',
        uninstalled:         'Uninstalled',
        updated:             'Updated',
        permissions_updated: 'Permissions updated',
        enabled:             'Enabled',
        disabled:            'Disabled',
    };
    const EVENT_TYPES = Object.keys(TYPE_LABELS);

    /** Settings <-> DOM. Min/max for numbers come from the input's own attributes. */
    const SETTING_FIELDS = [
        { key: 'trackingEnabled', id: 'tracking-enabled-toggle', prop: 'checked' },
        { key: 'sortOrder',       id: 'sort-order-select',       prop: 'value' },
        { key: 'logsPerPage',     id: 'logs-per-page-input',     prop: 'value', int: true },
        { key: 'recordLimit',     id: 'record-limit-input',      prop: 'value', int: true },
        { key: 'pruneDays',       id: 'prune-days-input',        prop: 'value', int: true },
    ];

    const DEFAULT_SETTINGS = {
        trackingEnabled: false,
        sortOrder:       'desc',
        logsPerPage:     25,
        pruneDays:       90,
        recordLimit:     1000,
    };

    /* ---------------------------------------------------------------------- */
    /*  Helpers                                                               */
    /* ---------------------------------------------------------------------- */
    const $ = (id) => document.getElementById(id);

    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    };

    const debounce = (fn, wait) => {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    };

    const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
    const typeLabel = (t) => TYPE_LABELS[t] ?? t;

    const fmtTime = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
    const fmtFull = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'medium' });
    const fmtDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
    const fmtDay  = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

    const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

    const notify = (() => {
        const s = window.Status;
        const make = (level) => (msg, detail) => (s?.[level] ? s[level](msg, detail) : console[level === 'error' ? 'error' : 'log'](msg));
        return { info: make('info'), success: make('success'), error: make('error') };
    })();

    /** Sends a message to the background and throws if it reports an error. */
    const send = async (type, payload) => {
        const res = await chrome.runtime.sendMessage({ type, payload });
        if (res?.status === 'error') throw new Error(res.message);
        return res;
    };

    /** Appends `text` to `node`, wrapping case-insensitive matches of `term` in <mark>. */
    const appendHighlighted = (node, text, term) => {
        if (!term) { node.append(text); return; }
        const lower = text.toLowerCase();
        let i = 0, j;
        while ((j = lower.indexOf(term, i)) !== -1) {
            if (j > i) node.append(text.slice(i, j));
            node.append(el('mark', null, text.slice(j, j + term.length)));
            i = j + term.length;
        }
        if (i < text.length) node.append(text.slice(i));
    };

    /* ---------------------------------------------------------------------- */
    /*  State                                                                 */
    /* ---------------------------------------------------------------------- */
    let records   = [];
    let filtered  = [];
    let installed = new Map(); // extensionId -> { enabled, iconUrl }
    let settings  = { ...DEFAULT_SETTINGS };
    let loadFailed = false;

    const newFilters = () => ({ search: '', types: new Set(EVENT_TYPES), start: null, end: null });
    let filters = newFilters();

    let page = 1;
    let pages = 1;

    const byId = new Map();       // recordId -> record (for click delegation)
    const haystacks = new WeakMap(); // record -> lowercase search text
    let detailRecord = null;

    const dom = {
        navButtons:      document.querySelectorAll('.sidebar-button[data-panel-target]'),
        panels:          document.querySelectorAll('.content-panel'),
        search:          $('search-input'),
        filterCount:     $('filter-count'),
        typeFilters:     $('event-type-filters'),
        startDate:       $('start-date-input'),
        endDate:         $('end-date-input'),
        notice:          $('tracking-off-notice'),
        list:            $('history-list'),
        empty:           $('empty-state'),
        emptyTitle:      $('empty-title'),
        emptyHint:       $('empty-hint'),
        emptyClear:      $('empty-clear-btn'),
        pagination:      $('pagination-controls'),
        prev:            $('prev-page-btn'),
        next:            $('next-page-btn'),
        pageInfo:        $('page-info'),
        saved:           $('settings-saved-indicator'),
        pruneDays:       $('prune-days-input'),
        sidePanel:       $('side-panel'),
        sidePanelTitle:  $('side-panel-title'),
        filtersView:     $('filters-view'),
        detailsView:     $('details-view'),
        detailBody:      $('detail-content'),
    };
    const actionButtons = ['prune-now-btn', 'prune-inactive-btn', 'clear-all-btn', 'reset-defaults-btn'].map($);

    /* ---------------------------------------------------------------------- */
    /*  Data loading                                                          */
    /* ---------------------------------------------------------------------- */
    const pickIcon = (icons) => {
        if (!icons?.length) return null;
        const sorted = [...icons].sort((a, b) => a.size - b.size);
        return (sorted.find(i => i.size >= 48) ?? sorted.at(-1)).url;
    };

    const loadInstalled = async () => {
        try {
            const exts = await chrome.management.getAll();
            installed = new Map(exts.map(e => [e.id, { enabled: e.enabled, iconUrl: pickIcon(e.icons) }]));
        } catch (e) {
            console.warn('Failed to load installed extensions:', e);
        }
    };

    const cleanRecords = (list) => (Array.isArray(list) ? list : [])
        .filter(r => r && typeof r.timestamp === 'number'
            && typeof r.extensionId === 'string'
            && EVENT_TYPES.includes(r.eventType))
        .map(r => r.id ? r : { ...r, id: `${r.timestamp}-${r.extensionId}-${r.eventType}` });

    const loadSettings = async () => {
        try {
            const res = await send('GET_HISTORY_SETTINGS');
            settings = { ...DEFAULT_SETTINGS, ...res.settings };
        } catch (e) {
            console.error('Error loading settings:', e);
            notify.error('Failed to load settings.');
        }
        syncSettingsToUI();
    };

    const loadHistory = async () => {
        try {
            const res = await send('GET_EXTENSION_HISTORY');
            records = cleanRecords(res.history);
            loadFailed = false;
        } catch (e) {
            console.error('Error loading history:', e);
            notify.error('Failed to load history.');
            records = [];
            loadFailed = true;
        }
    };

    /* ---------------------------------------------------------------------- */
    /*  Filtering, sorting, pagination                                        */
    /* ---------------------------------------------------------------------- */
    const haystack = (r) => {
        let h = haystacks.get(r);
        if (h === undefined) {
            h = `${r.extensionName || ''}\n${r.extensionId}\n${r.details || ''}\n${typeLabel(r.eventType)}`.toLowerCase();
            haystacks.set(r, h);
        }
        return h;
    };

    const matches = (r) => {
        if (!filters.types.has(r.eventType)) return false;
        if (filters.start !== null && r.timestamp < filters.start) return false;
        if (filters.end   !== null && r.timestamp > filters.end)   return false;
        return !filters.search || haystack(r).includes(filters.search);
    };

    const nameOf = (r) => r.extensionName || 'Unknown';
    const COMPARATORS = {
        desc:  (a, b) => b.timestamp - a.timestamp,
        asc:   (a, b) => a.timestamp - b.timestamp,
        group: (a, b) => collator.compare(nameOf(a), nameOf(b))
                      || (a.extensionId < b.extensionId ? -1 : a.extensionId > b.extensionId ? 1 : 0)
                      || b.timestamp - a.timestamp,
        type:  (a, b) => EVENT_TYPES.indexOf(a.eventType) - EVENT_TYPES.indexOf(b.eventType)
                      || b.timestamp - a.timestamp,
    };

    const activeFilterCount = () =>
        (filters.types.size !== EVENT_TYPES.length ? 1 : 0) + (filters.start !== null || filters.end !== null ? 1 : 0);

    const applyFilters = (keepPage = false) => {
        filtered = records.filter(matches).sort(COMPARATORS[settings.sortOrder] ?? COMPARATORS.desc);
        pages = Math.max(1, Math.ceil(filtered.length / settings.logsPerPage));
        page = keepPage ? Math.min(page, pages) : 1;

        const n = activeFilterCount();
        dom.filterCount.hidden = n === 0;
        dom.filterCount.textContent = n;
        dom.filterCount.title = `${plural(n, 'filter')} active`;

        render();
    };

    const goToPage = (next) => {
        if (next < 1 || next > pages) return;
        page = next;
        render();
        window.scrollTo({ top: 0 });
    };

    /* ---------------------------------------------------------------------- */
    /*  List rendering                                                        */
    /* ---------------------------------------------------------------------- */
    /** Icon (or letter fallback). The box is separate from the badge so a late image error can't remove the badge. */
    const buildIcon = (record, wrapClass) => {
        const wrap = el('span', wrapClass);
        const box = el('span', 'icon-box');
        const fallback = () => {
            box.replaceChildren(el('span', 'icon-fallback', (record.extensionName || '?').charAt(0).toUpperCase()));
        };
        const url = installed.get(record.extensionId)?.iconUrl;
        if (url) {
            const img = el('img');
            img.alt = '';
            img.loading = 'lazy';
            img.src = url;
            img.addEventListener('error', fallback, { once: true });
            box.append(img);
        } else {
            fallback();
        }
        wrap.append(box);
        return wrap;
    };

    const buildItem = (r) => {
        const li = el('li');
        const btn = el('button', 'history-item');
        btn.type = 'button';
        btn.dataset.recordId = r.id;
        byId.set(r.id, r);

        const icon = buildIcon(r, 'item-icon');
        icon.append(el('span', `status-badge status-badge-${r.eventType}`));

        const title = el('span', 'history-item-title');
        appendHighlighted(title, nameOf(r), filters.search);
        title.append(el('span', 'history-item-version', `v${r.extensionVersion || 'N/A'}`));

        const details = el('span', 'history-item-details');
        appendHighlighted(details, typeLabel(r.eventType) + (r.details ? ` — ${r.details}` : ''), filters.search);

        const main = el('span', 'history-item-main');
        main.append(title, details);

        const time = el('time', 'history-item-time', fmtTime.format(r.timestamp));
        time.dateTime = new Date(r.timestamp).toISOString();
        time.title = fmtFull.format(r.timestamp);

        btn.append(icon, main, time);
        li.append(btn);
        return li;
    };

    const showEmptyState = () => {
        const filteredOut = records.length > 0;
        dom.empty.hidden = false;
        dom.emptyClear.hidden = !filteredOut;
        if (loadFailed) {
            dom.emptyTitle.textContent = 'Couldn\u2019t load history';
            dom.emptyHint.textContent = 'Reload this page to try again.';
        } else if (filteredOut) {
            dom.emptyTitle.textContent = 'No matching events';
            dom.emptyHint.textContent = 'Try different search terms or filters.';
        } else {
            dom.emptyTitle.textContent = 'No activity recorded yet';
            dom.emptyHint.textContent = settings.trackingEnabled
                ? 'Installs, updates, enables, disables, and permission changes will appear here.'
                : 'Timeline is turned off. Turn it on in Settings to start recording.';
        }
    };

    const render = () => {
        dom.list.replaceChildren();
        byId.clear();
        dom.notice.hidden = settings.trackingEnabled;

        if (filtered.length === 0) {
            showEmptyState();
            dom.pagination.hidden = true;
            return;
        }
        dom.empty.hidden = true;

        const mode = settings.sortOrder;
        const today = startOfDay(Date.now());
        const y = new Date(today); y.setDate(y.getDate() - 1);
        const yesterday = y.getTime();

        const keyOf = mode === 'group' ? (r) => r.extensionId
                    : mode === 'type'  ? (r) => r.eventType
                    : (r) => startOfDay(r.timestamp);
        const labelOf = mode === 'group' ? nameOf
                      : mode === 'type'  ? (r) => typeLabel(r.eventType)
                      : (r) => {
                            const s = startOfDay(r.timestamp);
                            return s === today ? 'Today' : s === yesterday ? 'Yesterday' : fmtDay.format(r.timestamp);
                        };

        const start = (page - 1) * settings.logsPerPage;
        const frag = document.createDocumentFragment();
        let lastKey, items;

        for (const r of filtered.slice(start, start + settings.logsPerPage)) {
            const key = keyOf(r);
            if (key !== lastKey) {
                const section = el('section', 'history-group');
                section.append(el('h3', 'history-group-title', labelOf(r)));
                items = el('ul', 'history-items');
                section.append(items);
                frag.append(section);
                lastKey = key;
            }
            items.append(buildItem(r));
        }
        dom.list.append(frag);

        dom.pagination.hidden = pages <= 1;
        dom.prev.disabled = page === 1;
        dom.next.disabled = page === pages;
        dom.pageInfo.textContent = `Page ${page} of ${pages}`;
    };

    /* ---------------------------------------------------------------------- */
    /*  Side panel (filters + event details)                                  */
    /* ---------------------------------------------------------------------- */
    const openSidePanel = (view) => {
        const showFilters = view === 'filters';
        dom.filtersView.hidden = !showFilters;
        dom.detailsView.hidden = showFilters;
        dom.sidePanelTitle.textContent = showFilters ? 'Filters' : 'Event details';
        if (!dom.sidePanel.open) dom.sidePanel.showModal();
    };

    const closeSidePanel = () => {
        if (dom.sidePanel.open) dom.sidePanel.close();
    };

    /* ---------------------------------------------------------------------- */
    /*  Detail view                                                           */
    /* ---------------------------------------------------------------------- */
    const detailRow = (label, value) => {
        const row = el('div', 'detail-row');
        row.append(el('span', 'detail-label', label));
        const val = el('span', 'detail-value');
        if (value instanceof Node) val.append(value);
        else val.textContent = value;
        row.append(val);
        return row;
    };

    /** Builds a titled group of label/value rows. Falsy entries are skipped. */
    const detailSection = (title, rows) => {
        const section = el('section', 'detail-section');
        section.append(el('h5', 'detail-section-title', title));
        const body = el('div', 'detail-rows');
        body.append(...rows.filter(Boolean));
        section.append(body);
        return section;
    };

    const openDetail = (r) => {
        detailRecord = r;
        const ext = installed.get(r.extensionId);

        const mine = records.filter(x => x.extensionId === r.extensionId);
        let first = Infinity, last = -Infinity;
        for (const x of mine) { first = Math.min(first, x.timestamp); last = Math.max(last, x.timestamp); }
        const recent = mine.slice().sort(COMPARATORS.desc).slice(0, DETAIL_RECENT_ROWS);

        const statusKind = ext ? (ext.enabled ? 'enabled' : 'disabled') : 'uninstalled';
        const statusText = ext ? (ext.enabled ? 'Enabled' : 'Disabled') : 'Uninstalled';

        const frag = document.createDocumentFragment();

        // Identity
        const header = el('div', 'detail-header');
        const identity = el('div', 'detail-identity');
        identity.append(
            el('h4', null, nameOf(r)),
            el('span', 'detail-version', `Version ${r.extensionVersion || 'N/A'}`),
            el('span', `detail-status detail-status-${statusKind}`, statusText),
        );
        header.append(buildIcon(r, 'item-icon'), identity);
        frag.append(header);

        // Event
        frag.append(detailSection('Event', [
            detailRow('Type', typeLabel(r.eventType)),
            detailRow('When', fmtFull.format(r.timestamp)),
            r.details ? detailRow('Details', el('p', 'detail-text', r.details)) : null,
        ]));

        // Extension
        frag.append(detailSection('Extension', [
            detailRow('ID', el('code', 'detail-code', r.extensionId)),
            detailRow('Total events', String(mine.length)),
            detailRow('First seen', fmtDate.format(first)),
            detailRow('Last seen', fmtDate.format(last)),
        ]));

        // Recent activity
        if (recent.length) {
            const section = el('section', 'detail-section');
            section.append(el('h5', 'detail-section-title', 'Recent activity'));
            const ul = el('ul', 'detail-recent-list');
            for (const x of recent) {
                const li = el('li');
                const left = el('div', 'detail-recent-event');
                left.append(el('strong', null, typeLabel(x.eventType)));
                if (x.details) left.append(el('span', 'detail-recent-details', x.details));

                const time = el('time', 'detail-recent-time', fmtFull.format(x.timestamp));
                time.dateTime = new Date(x.timestamp).toISOString();

                li.append(left, time);
                ul.append(li);
            }
            section.append(ul);
            frag.append(section);
        }

        dom.detailBody.replaceChildren(frag);
        openSidePanel('details');
    };

    const filterToDetailExtension = () => {
        if (!detailRecord) return;
        dom.search.value = detailRecord.extensionId;
        filters.search = detailRecord.extensionId.toLowerCase();
        closeSidePanel();
        applyFilters();
    };

    const copyDetailId = async () => {
        if (!detailRecord) return;
        try {
            await navigator.clipboard.writeText(detailRecord.extensionId);
            notify.success('Extension ID copied.');
        } catch {
            notify.error('Couldn\u2019t copy to the clipboard.');
        }
    };

    /* ---------------------------------------------------------------------- */
    /*  Filters                                                               */
    /* ---------------------------------------------------------------------- */
    const buildTypeFilters = () => {
        const frag = document.createDocumentFragment();
        for (const type of EVENT_TYPES) {
            const label = el('label', 'checkbox-row');
            const input = el('input');
            input.type = 'checkbox';
            input.value = type;
            input.checked = true;
            label.append(input, el('span', null, typeLabel(type)));
            frag.append(label);
        }
        dom.typeFilters.replaceChildren(frag);
    };

    const setTypeCheckboxes = (types) => {
        for (const input of dom.typeFilters.querySelectorAll('input')) input.checked = types.has(input.value);
    };

    const readTypeFilters = () => {
        filters.types = new Set([...dom.typeFilters.querySelectorAll('input:checked')].map(i => i.value));
        applyFilters();
    };

    const readDateFilters = () => {
        const s = dom.startDate.value, e = dom.endDate.value;
        // Parsed as local time so the range matches what the user sees in the list.
        filters.start = s ? new Date(`${s}T00:00:00`).getTime() : null;
        filters.end   = e ? new Date(`${e}T23:59:59.999`).getTime() : null;
        dom.endDate.min = s;   // native validation keeps the range valid
        dom.startDate.max = e;
        applyFilters();
    };

    const resetFilters = () => {
        filters = newFilters();
        dom.search.value = '';
        dom.startDate.value = dom.endDate.value = '';
        dom.startDate.max = dom.endDate.min = '';
        setTypeCheckboxes(filters.types);
        applyFilters();
    };

    /* ---------------------------------------------------------------------- */
    /*  Settings                                                              */
    /* ---------------------------------------------------------------------- */
    const syncSettingsToUI = () => {
        for (const f of SETTING_FIELDS) $(f.id)[f.prop] = settings[f.key];
    };

    const readSettingsFromUI = () => {
        for (const f of SETTING_FIELDS) {
            const input = $(f.id);
            let v = input[f.prop];
            if (f.int) {
                v = parseInt(v, 10);
                if (!Number.isFinite(v)) v = settings[f.key];
                v = Math.min(+input.max, Math.max(+input.min, v));
                input.value = v;
            }
            settings[f.key] = v;
        }
    };

    const flashSaved = () => {
        dom.saved.textContent = 'Saved';
        clearTimeout(flashSaved.t);
        flashSaved.t = setTimeout(() => { dom.saved.textContent = ''; }, 2000);
    };

    const saveSettings = async () => {
        try {
            await send('UPDATE_HISTORY_SETTINGS', settings);
            flashSaved();
            applyFilters();
        } catch (e) {
            console.error('Error saving settings:', e);
            notify.error('Failed to save settings.');
        }
    };

    const debouncedSave = debounce(saveSettings, SAVE_DEBOUNCE_MS);

    const onSettingChange = () => {
        readSettingsFromUI();
        dom.notice.hidden = settings.trackingEnabled;
        debouncedSave();
    };

    const resetDefaults = async () => {
        if (!confirm('Reset all Timeline settings to their defaults?')) return;
        settings = { ...DEFAULT_SETTINGS };
        syncSettingsToUI();
        await saveSettings();
    };

    /* ---------------------------------------------------------------------- */
    /*  Data actions                                                          */
    /* ---------------------------------------------------------------------- */
    /** Runs a destructive action with buttons disabled, then reloads the list. */
    const runAction = async (action, successMessage) => {
        actionButtons.forEach(b => { b.disabled = true; });
        try {
            const res = await action();
            await Promise.all([loadHistory(), loadInstalled()]);
            applyFilters(true);
            notify.success(successMessage(res));
        } catch (e) {
            console.error('Action failed:', e);
            notify.error(e.message || 'Something went wrong.');
        } finally {
            actionButtons.forEach(b => { b.disabled = false; });
        }
    };

    const removedMessage = (res) => `Removed ${plural(res.removed ?? 0, 'record')}.`;

    const pruneNow = () => {
        const input = dom.pruneDays;
        const days = parseInt(input.value, 10);
        if (!input.checkValidity() || !Number.isFinite(days)) { input.reportValidity(); return; }

        const cutoff = Date.now() - days * DAY_MS;
        const count = records.filter(r => r.timestamp < cutoff).length;
        if (!count) { notify.info(`No records older than ${plural(days, 'day')}.`); return; }
        if (!confirm(`Delete ${plural(count, 'record')} older than ${plural(days, 'day')}? This can\u2019t be undone.`)) return;

        runAction(() => send('PRUNE_HISTORY_BY_DAYS', { daysToKeep: days }), removedMessage);
    };

    const pruneInactive = () => {
        if (installed.size === 0) { notify.error('Couldn\u2019t read the installed extensions list.'); return; }
        const count = records.filter(r => !installed.has(r.extensionId)).length;
        if (!count) { notify.info('No history for uninstalled extensions.'); return; }
        if (!confirm(`Delete ${plural(count, 'record')} for extensions that are no longer installed? This can\u2019t be undone.`)) return;

        runAction(() => send('PRUNE_INACTIVE_EXTENSIONS'), removedMessage);
    };

    const clearAll = () => {
        if (!records.length) { notify.info('There\u2019s no history to clear.'); return; }
        if (!confirm(`Delete all ${plural(records.length, 'record')}? This can\u2019t be undone.`)) return;

        runAction(() => send('CLEAR_EXTENSION_HISTORY'), removedMessage);
    };

    /* ---------------------------------------------------------------------- */
    /*  Navigation & global handlers                                          */
    /* ---------------------------------------------------------------------- */
    const switchPanel = (targetId) => {
        dom.navButtons.forEach(btn => {
            const active = btn.dataset.panelTarget === targetId;
            btn.classList.toggle('active', active);
            if (active) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });
        dom.panels.forEach(panel => { panel.hidden = panel.id !== targetId; });
        closeSidePanel();
    };

    const onGlobalKeydown = (e) => {
        if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
        if (document.querySelector('dialog[open]')) return;
        if (document.getElementById('panel-history').hidden) return;
        e.preventDefault();
        dom.search.focus();
    };

    /** Keeps the list live while the page is open (events recorded in the background). */
    const refreshLive = debounce(async () => {
        await loadInstalled();
        applyFilters(true);
    }, REFRESH_DEBOUNCE_MS);

    const onStorageChanged = (changes, area) => {
        if (area !== 'local' || !changes[HISTORY_KEY]) return;
        records = cleanRecords(changes[HISTORY_KEY].newValue);
        loadFailed = false;
        refreshLive();
    };

    /* ---------------------------------------------------------------------- */
    /*  Wiring                                                                */
    /* ---------------------------------------------------------------------- */
    const setupEventListeners = () => {
        dom.navButtons.forEach(btn => btn.addEventListener('click', () => switchPanel(btn.dataset.panelTarget)));

        // Native type="search": its built-in clear button and Esc also fire `input`.
        dom.search.addEventListener('input', debounce(() => {
            filters.search = dom.search.value.trim().toLowerCase();
            applyFilters();
        }, SEARCH_DEBOUNCE_MS));

        $('filter-toggle-btn').addEventListener('click', () => openSidePanel('filters'));
        document.querySelectorAll('[data-close-panel]').forEach(btn => btn.addEventListener('click', closeSidePanel));

        dom.typeFilters.addEventListener('change', readTypeFilters);
        $('select-all-filters-btn').addEventListener('click', () => { setTypeCheckboxes(new Set(EVENT_TYPES)); readTypeFilters(); });
        $('select-none-filters-btn').addEventListener('click', () => { setTypeCheckboxes(new Set()); readTypeFilters(); });
        dom.startDate.addEventListener('change', readDateFilters);
        dom.endDate.addEventListener('change', readDateFilters);
        $('reset-filters-btn').addEventListener('click', resetFilters);
        dom.emptyClear.addEventListener('click', resetFilters);

        // One listener for the whole list.
        dom.list.addEventListener('click', (e) => {
            const item = e.target.closest('.history-item');
            const record = item && byId.get(item.dataset.recordId);
            if (record) openDetail(record);
        });

        dom.prev.addEventListener('click', () => goToPage(page - 1));
        dom.next.addEventListener('click', () => goToPage(page + 1));

        for (const f of SETTING_FIELDS) $(f.id).addEventListener('change', onSettingChange);
        $('enable-tracking-btn').addEventListener('click', () => {
            $('tracking-enabled-toggle').checked = true;
            onSettingChange();
        });

        $('prune-now-btn').addEventListener('click', pruneNow);
        $('prune-inactive-btn').addEventListener('click', pruneInactive);
        $('clear-all-btn').addEventListener('click', clearAll);
        $('reset-defaults-btn').addEventListener('click', resetDefaults);

        $('detail-filter-btn').addEventListener('click', filterToDetailExtension);
        $('copy-detail-id-btn').addEventListener('click', copyDetailId);

        document.addEventListener('keydown', onGlobalKeydown);
        chrome.storage.onChanged.addListener(onStorageChanged);
    };

    const init = async () => {
        buildTypeFilters();
        setupEventListeners();
        $('current-year').textContent = new Date().getFullYear();

        await Promise.all([loadSettings(), loadInstalled(), loadHistory()]);
        applyFilters();
    };

    init();
})();