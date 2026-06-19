/**
 * Extension Conflicts — modcore EM
 * Scans installed extensions against remote conflict category definitions.
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // ========================================================================
    // CONFIGURATION
    // ========================================================================
    const MANIFEST_URL = 'https://raw.githubusercontent.com/modcoretech/api/main/modcoreEM/manifest.json';
    const DEFAULT_CACHE_HOURS = 24;

    const STORAGE_KEYS = {
        SETTINGS: 'conflicts_settings',
        CACHE: 'conflicts_cache',
    };

    const GENERIC_ICON = '../../public/icons/svg/info.svg';

    // ========================================================================
    // STATE
    // ========================================================================
    let currentSettings = { autoScan: false, cacheDuration: DEFAULT_CACHE_HOURS, ignored: [] };
    let lastFocusedElement = null;

    // ========================================================================
    // DOM REFERENCES
    // ========================================================================
    const resultsDiv = document.getElementById('results');
    const loadingOverlay = document.getElementById('loading');
    const summaryBar = document.getElementById('summaryBar');
    const footer = document.getElementById('footer');
    const liveRegion = document.getElementById('liveRegion');
    const initialScreen = document.getElementById('initial-screen');
    const startScanButton = document.getElementById('startScanButton');

    // Settings modal
    const settingsModal = document.getElementById('settingsModal');
    const settingsButton = document.getElementById('settingsButton');
    const closeSettingsModal = document.getElementById('closeSettingsModal');
    const autoScanSetting = document.getElementById('autoScanSetting');
    const cacheDurationSetting = document.getElementById('cacheDurationSetting');
    const refreshCacheButton = document.getElementById('refreshCacheButton');
    const ignoredListContainer = document.getElementById('ignoredListContainer');

    // Confirmation modal
    const confirmModal = document.getElementById('confirmModal');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmAction = document.getElementById('confirmAction');
    const confirmCancel = document.getElementById('confirmCancel');

    // ========================================================================
    // SETTINGS & CACHE
    // ========================================================================
    const Settings = {
        async load() {
            const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
            const defaults = { autoScan: false, cacheDuration: DEFAULT_CACHE_HOURS, ignored: [] };
            const stored = data[STORAGE_KEYS.SETTINGS] || {};
            return { ...defaults, ...stored };
        },

        async save(patch) {
            currentSettings = { ...currentSettings, ...patch };
            await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: currentSettings });
        }
    };

    const Cache = {
        ttl() {
            return (currentSettings.cacheDuration || DEFAULT_CACHE_HOURS) * 3_600_000;
        },

        async get() {
            const data = await chrome.storage.local.get(STORAGE_KEYS.CACHE);
            return data[STORAGE_KEYS.CACHE] || null;
        },

        async update(patch) {
            const existing = await this.get() || {};
            await chrome.storage.local.set({ [STORAGE_KEYS.CACHE]: { ...existing, ...patch } });
        },

        async clear() {
            await chrome.storage.local.remove(STORAGE_KEYS.CACHE);
        },

        isValid(cached) {
            return !!(cached && cached.cachedAt && (Date.now() - cached.cachedAt < this.ttl()));
        }
    };

    // ========================================================================
    // HELPERS
    // ========================================================================
    const announce = (message, priority = 'polite') => {
        liveRegion.setAttribute('aria-live', priority);
        requestAnimationFrame(() => {
            liveRegion.textContent = message;
            setTimeout(() => { liveRegion.textContent = ''; }, 1500);
        });
    };

    const setUIEnabled = (enabled) => {
        const buttons = document.querySelectorAll('button, select, input');
        buttons.forEach(el => {
            if (!el.closest('.modal-overlay')) el.disabled = !enabled;
        });
    };

    const showLoading = () => {
        loadingOverlay.classList.add('visible');
        resultsDiv.classList.add('dimmed');
        resultsDiv.setAttribute('aria-busy', 'true');
        setUIEnabled(false);
    };

    const hideLoading = () => {
        loadingOverlay.classList.remove('visible');
        resultsDiv.classList.remove('dimmed');
        resultsDiv.setAttribute('aria-busy', 'false');
        setUIEnabled(true);
    };

    const clearResults = () => {
        while (resultsDiv.lastChild) {
            const child = resultsDiv.lastChild;
            if (child === initialScreen) break;
            resultsDiv.removeChild(child);
        }
    };

    // ========================================================================
    // MODAL / FOCUS MANAGEMENT
    // ========================================================================
    const trapFocus = (element) => {
        const focusables = element.querySelectorAll(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        const handler = (e) => {
            if (e.key !== 'Tab') return;
            if (e.shiftKey) {
                if (document.activeElement === first) {
                    last.focus();
                    e.preventDefault();
                }
            } else {
                if (document.activeElement === last) {
                    first.focus();
                    e.preventDefault();
                }
            }
        };
        element.addEventListener('keydown', handler);
        element._focusTrap = handler;
    };

    const openModal = (modal) => {
        lastFocusedElement = document.activeElement;
        modal.classList.add('visible');
        const focusable = modal.querySelector(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable) setTimeout(() => focusable.focus(), 50);
        trapFocus(modal);
    };

    const closeModal = (modal) => {
        modal.classList.remove('visible');
        if (modal._focusTrap) {
            modal.removeEventListener('keydown', modal._focusTrap);
            delete modal._focusTrap;
        }
        if (lastFocusedElement && document.contains(lastFocusedElement)) {
            lastFocusedElement.focus();
        }
    };

    const showConfirm = (title, message) => {
        confirmTitle.textContent = title;
        confirmMessage.textContent = message;
        openModal(confirmModal);
        return new Promise((resolve) => {
            const yes = () => { closeModal(confirmModal); resolve(true); };
            const no = () => { closeModal(confirmModal); resolve(false); };
            confirmAction.addEventListener('click', yes, { once: true });
            confirmCancel.addEventListener('click', no, { once: true });
        });
    };

    // ========================================================================
    // SETTINGS UI
    // ========================================================================
    const initSettingsUI = () => {
        autoScanSetting.checked = currentSettings.autoScan;
        cacheDurationSetting.value = String(currentSettings.cacheDuration);
    };

    const initSettingsTabs = () => {
        const tabs = settingsModal.querySelectorAll('.settings-tab');
        const panels = settingsModal.querySelectorAll('.settings-panel');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetId = tab.getAttribute('aria-controls');

                tabs.forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                panels.forEach(p => {
                    p.classList.remove('active');
                });

                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');
                const panel = document.getElementById(targetId);
                if (panel) panel.classList.add('active');
            });
        });
    };

    const renderIgnoredList = async () => {
        if (!ignoredListContainer) return;

        while (ignoredListContainer.lastChild) {
            ignoredListContainer.removeChild(ignoredListContainer.lastChild);
        }

        if (currentSettings.ignored.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'setting-hint empty-ignored';
            empty.textContent = 'No extensions are currently ignored.';
            ignoredListContainer.appendChild(empty);
            return;
        }

        const installed = await chrome.management.getAll();
        const installedMap = new Map(installed.map(e => [e.id, e]));

        const list = document.createElement('div');
        list.className = 'ignored-list';

        currentSettings.ignored.forEach(id => {
            const ext = installedMap.get(id);
            const item = document.createElement('div');
            item.className = 'ignored-item';

            const info = document.createElement('div');
            info.className = 'ignored-info';

            const name = document.createElement('span');
            name.className = 'ignored-name';
            name.textContent = ext ? ext.name : `Unknown (${id.slice(0, 8)}…)`;
            info.appendChild(name);

            const idSpan = document.createElement('span');
            idSpan.className = 'ignored-id';
            idSpan.textContent = id.length > 24 ? `${id.slice(0, 12)}…` : id;
            info.appendChild(idSpan);

            item.appendChild(info);

            const btn = document.createElement('button');
            btn.className = 'btn';
            btn.textContent = 'Un-ignore';
            btn.setAttribute('aria-label', `Stop ignoring ${ext ? ext.name : id}`);
            btn.addEventListener('click', async () => {
                currentSettings.ignored = currentSettings.ignored.filter(x => x !== id);
                await Settings.save(currentSettings);
                renderIgnoredList();
                Status.success('Extension removed from ignore list');
                if (initialScreen.style.display === 'none') {
                    await runScan(false);
                }
            });
            item.appendChild(btn);

            list.appendChild(item);
        });

        ignoredListContainer.appendChild(list);
    };

    // ========================================================================
    // DATA FETCHING
    // ========================================================================
    const fetchManifest = async () => {
        const response = await fetch(MANIFEST_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    };

    const fetchCategory = async (endpoint) => {
        const fullUrl = `https://raw.githubusercontent.com/modcoretech/api/main/modcoreEM/${endpoint}`;
        const response = await fetch(fullUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    };

    const getManifest = async (forceRefresh) => {
        const cached = await Cache.get();
        if (!forceRefresh && cached?.manifest && Cache.isValid(cached)) {
            return cached.manifest;
        }
        const manifest = await fetchManifest();
        await Cache.update({ manifest, cachedAt: Date.now() });
        return manifest;
    };

    const getCategories = async (manifest, forceRefresh) => {
        const cached = await Cache.get();
        const entries = Object.entries(manifest.endpoints.conflicts.categories);

        if (!forceRefresh && cached?.categories && Cache.isValid(cached)) {
            const allPresent = entries.every(([id]) => cached.categories[id]);
            if (allPresent) return Object.values(cached.categories);
        }

        const categories = {};
        const errors = [];

        await Promise.allSettled(
            entries.map(async ([id, endpoint]) => {
                try {
                    categories[id] = await fetchCategory(endpoint);
                } catch (err) {
                    if (cached?.categories?.[id]) {
                        categories[id] = cached.categories[id];
                        Status.warning(`Using cached data for ${id}`);
                    } else {
                        errors.push(`${id}: ${err.message}`);
                    }
                }
            })
        );

        const categoryList = Object.values(categories);

        if (categoryList.length === 0 && errors.length > 0) {
            throw new Error(`Failed to load all categories. ${errors[0]}`);
        }

        if (errors.length > 0) {
            Status.warning(`${errors.length} category file(s) could not be refreshed`);
        }

        await Cache.update({ categories, cachedAt: Date.now() });
        return categoryList;
    };

    // ========================================================================
    // CORE SCAN LOGIC
    // ========================================================================
    const findConflicts = (installed, categories) => {
        const installedMap = new Map(installed.map(ext => [ext.id, ext]));
        const ignoredSet = new Set(currentSettings.ignored);

        return categories.map(cat => {
            const active = cat.extension_ids
                .map(id => installedMap.get(id))
                .filter(ext => ext && ext.enabled && !ignoredSet.has(ext.id));
            return active.length >= 2 ? { ...cat, extensions: active } : null;
        }).filter(Boolean);
    };

    const runScan = async (forceRefresh = false) => {
        showLoading();
        initialScreen.style.display = 'none';
        clearResults();
        announce('Scanning for extension conflicts. Please wait.');

        try {
            const manifest = await getManifest(forceRefresh);
            const categories = await getCategories(manifest, forceRefresh);
            const installed = await chrome.management.getAll();

            const conflicts = findConflicts(installed, categories);

            renderResults(conflicts);
            displayFooter(manifest);

            if (conflicts.length > 0) {
                announce(`Scan complete. Found ${conflicts.length} conflict group${conflicts.length > 1 ? 's' : ''}.`, 'assertive');
                Status.warning(`Found ${conflicts.length} conflict group${conflicts.length > 1 ? 's' : ''}`);
            } else {
                announce('Scan complete. No conflicts found.');
                Status.success('No conflicts found');
            }
        } catch (err) {
            console.error('Scan error:', err);
            let title = 'Scan Failed';
            let message = 'Something went wrong. Please try again.';

            if (err.message?.includes('HTTP')) {
                title = 'Could Not Fetch Data';
                message = `Server error (${err.message}). Check your connection or try Refresh in Settings.`;
            } else if (err.message?.includes('fetch') || err.message?.includes('network')) {
                title = 'No Internet Connection';
                message = 'Could not reach the data server. Check your connection and try again.';
            }

            renderError(title, message);
            announce(`${title}. ${message}`, 'assertive');
            Status.error(`${title}: ${message}`);
        } finally {
            hideLoading();
        }
    };

    // ========================================================================
    // RENDERING
    // ========================================================================
    const updateSummaryBar = (conflicts) => {
        if (!summaryBar) return;

        while (summaryBar.lastChild) {
            summaryBar.removeChild(summaryBar.lastChild);
        }

        if (!conflicts) {
            summaryBar.className = 'summary-bar';
            return;
        }

        if (conflicts.length === 0) {
            summaryBar.className = 'summary-bar clean';
            const icon = document.createElement('span');
            icon.className = 'icon icon-check';
            icon.setAttribute('aria-hidden', 'true');
            summaryBar.appendChild(icon);

            const text = document.createElement('span');
            text.className = 'summary-text';
            text.textContent = 'No conflicts';
            summaryBar.appendChild(text);
            return;
        }

        const total = conflicts.reduce((sum, c) => sum + c.extensions.length, 0);
        summaryBar.className = 'summary-bar warning';

        const icon = document.createElement('span');
        icon.className = 'icon icon-warning';
        icon.setAttribute('aria-hidden', 'true');
        summaryBar.appendChild(icon);

        const text = document.createElement('span');
        text.className = 'summary-text';
        text.textContent = `${conflicts.length} groups · ${total} extensions`;
        summaryBar.appendChild(text);
    };

    const renderResults = (conflicts) => {
        clearResults();
        updateSummaryBar(conflicts);

        if (conflicts.length === 0) {
            renderEmptyState();
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'results-wrapper';

        conflicts.forEach(conflict => {
            wrapper.appendChild(buildConflictCard(conflict));
        });

        resultsDiv.appendChild(wrapper);
    };

    const buildConflictCard = (conflict) => {
        const card = document.createElement('div');
        card.className = 'conflict-card';

        const header = document.createElement('div');
        header.className = 'conflict-header';

        const title = document.createElement('h3');
        title.className = 'conflict-title';
        title.textContent = conflict.name;
        header.appendChild(title);

        const desc = document.createElement('p');
        desc.className = 'conflict-desc';
        desc.textContent = conflict.description;
        header.appendChild(desc);

        card.appendChild(header);

        const list = document.createElement('div');
        list.className = 'extension-list';
        conflict.extensions.forEach(ext => {
            list.appendChild(buildExtensionItem(ext));
        });
        card.appendChild(list);

        return card;
    };

    const buildExtensionItem = (ext) => {
        const item = document.createElement('div');
        item.className = 'extension-item';

        const iconUrl = ext.icons?.sort((a, b) => b.size - a.size)[0]?.url || GENERIC_ICON;
        const img = document.createElement('img');
        img.src = iconUrl;
        img.alt = '';
        img.className = 'extension-icon';
        img.setAttribute('aria-hidden', 'true');
        img.onerror = () => { img.src = GENERIC_ICON; };
        item.appendChild(img);

        const info = document.createElement('div');
        info.className = 'extension-info';

        const name = document.createElement('div');
        name.className = 'extension-name';
        name.textContent = ext.name;
        info.appendChild(name);

        const status = document.createElement('div');
        status.className = 'extension-status';
        const dot = document.createElement('span');
        dot.className = `status-dot ${ext.enabled ? 'enabled' : 'disabled'}`;
        dot.setAttribute('aria-hidden', 'true');
        status.appendChild(dot);
        status.appendChild(document.createTextNode(ext.enabled ? 'Enabled' : 'Disabled'));
        info.appendChild(status);

        const meta = document.createElement('div');
        meta.className = 'extension-meta';

        const version = document.createElement('span');
        version.className = 'version';
        version.textContent = ext.version;
        meta.appendChild(version);

        meta.appendChild(document.createTextNode(' · '));

        const idSpan = document.createElement('span');
        idSpan.className = 'id';
        idSpan.title = ext.id;
        idSpan.textContent = ext.id.length > 16 ? `${ext.id.slice(0, 8)}…` : ext.id;
        meta.appendChild(idSpan);

        info.appendChild(meta);
        item.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'extension-actions';

        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'btn';
        detailsBtn.dataset.action = 'details';
        detailsBtn.dataset.id = ext.id;
        detailsBtn.setAttribute('aria-label', `Open ${ext.name} details`);
        detailsBtn.textContent = 'Details';
        actions.appendChild(detailsBtn);

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn';
        toggleBtn.dataset.action = 'toggle';
        toggleBtn.dataset.id = ext.id;
        toggleBtn.dataset.enabled = String(ext.enabled);
        toggleBtn.setAttribute('aria-label', `${ext.enabled ? 'Disable' : 'Enable'} ${ext.name}`);
        toggleBtn.setAttribute('aria-pressed', String(ext.enabled));
        toggleBtn.textContent = ext.enabled ? 'Disable' : 'Enable';
        actions.appendChild(toggleBtn);

        const ignoreBtn = document.createElement('button');
        ignoreBtn.className = 'btn';
        ignoreBtn.dataset.action = 'ignore';
        ignoreBtn.dataset.id = ext.id;
        ignoreBtn.dataset.name = ext.name;
        ignoreBtn.setAttribute('aria-label', `Ignore ${ext.name}`);
        ignoreBtn.textContent = 'Ignore';
        actions.appendChild(ignoreBtn);

        item.appendChild(actions);
        return item;
    };

    const renderEmptyState = () => {
        const el = document.createElement('div');
        el.className = 'empty-state';

        const icon = document.createElement('span');
        icon.className = 'icon icon-check';
        icon.setAttribute('aria-hidden', 'true');
        el.appendChild(icon);

        const title = document.createElement('div');
        title.className = 'empty-state-title';
        title.textContent = 'All Clear';
        el.appendChild(title);

        const text = document.createElement('p');
        text.className = 'empty-state-text';
        text.textContent = 'No conflicting extension groups were found. Your extensions are playing nicely together.';
        el.appendChild(text);

        resultsDiv.appendChild(el);
    };

    const renderError = (title, message) => {
        clearResults();
        updateSummaryBar(null);

        const el = document.createElement('div');
        el.className = 'empty-state';

        const icon = document.createElement('span');
        icon.className = 'icon icon-error';
        icon.setAttribute('aria-hidden', 'true');
        el.appendChild(icon);

        const titleEl = document.createElement('div');
        titleEl.className = 'empty-state-title';
        titleEl.textContent = title;
        el.appendChild(titleEl);

        const text = document.createElement('p');
        text.className = 'empty-state-text';
        text.textContent = message;
        el.appendChild(text);

        resultsDiv.appendChild(el);
    };

    const displayFooter = (manifest) => {
        if (!manifest) {
            footer.classList.remove('visible');
            return;
        }

        while (footer.lastChild) {
            footer.removeChild(footer.lastChild);
        }

        if (manifest.version) {
            footer.appendChild(document.createTextNode(`Data v${manifest.version}`));
        }
        if (manifest.last_updated) {
            footer.appendChild(document.createTextNode(` · Updated ${new Date(manifest.last_updated).toLocaleDateString()}`));
        }

        footer.appendChild(document.createTextNode(' · '));

        const link = document.createElement('a');
        link.href = 'https://github.com/modcoretech/api/issues';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Report an Issue';
        footer.appendChild(link);

        footer.classList.add('visible');
    };

    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================
    const handleActionClick = async (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button || button.disabled) return;

        const { action, id, name, enabled } = button.dataset;

        if (action === 'ignore') {
            const ok = await showConfirm(
                'Ignore Extension?',
                `"${name}" will no longer appear in conflict scans. You can un-ignore it in Settings.`
            );
            if (!ok) return;
        }

        setUIEnabled(false);
        try {
            switch (action) {
                case 'toggle':
                    await chrome.management.setEnabled(id, enabled !== 'true');
                    await runScan();
                    break;
                case 'ignore':
                    if (!currentSettings.ignored.includes(id)) {
                        currentSettings.ignored.push(id);
                        await Settings.save(currentSettings);
                    }
                    await runScan();
                    break;
                case 'details':
                    chrome.tabs.create({ url: `chrome://extensions/?id=${id}` });
                    setTimeout(() => setUIEnabled(true), 500);
                    return;
            }
        } catch (err) {
            console.error(`Action '${action}' failed:`, err);
            renderError('Action Failed', 'Could not complete the action. Please try again or manage the extension manually.');
            Status.error('Action failed');
            setUIEnabled(true);
        }
    };

    // ========================================================================
    // GLOBAL EVENTS
    // ========================================================================
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('.modal-overlay.visible').forEach(m => closeModal(m));
    });

    document.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal && e.target === modal) {
            closeModal(modal);
        }
    });

    // ========================================================================
    // INITIALISATION
    // ========================================================================
    const init = async () => {
        currentSettings = await Settings.load();
        initSettingsUI();
        initSettingsTabs();

        settingsButton.addEventListener('click', () => {
            renderIgnoredList();
            openModal(settingsModal);
        });
        closeSettingsModal.addEventListener('click', () => closeModal(settingsModal));

        autoScanSetting.addEventListener('change', (e) => {
            Settings.save({ autoScan: e.target.checked });
            Status.toast(e.target.checked ? 'Auto-scan enabled' : 'Auto-scan disabled', 'info');
        });

        cacheDurationSetting.addEventListener('change', (e) => {
            const hours = parseInt(e.target.value, 10);
            Settings.save({ cacheDuration: hours });
            Status.toast(`Cache duration set to ${hours} hours`, 'info');
        });

        refreshCacheButton.addEventListener('click', () => {
            closeModal(settingsModal);
            Cache.clear().then(() => {
                Status.info('Cache cleared. Fetching fresh data…');
                runScan(true);
            });
        });

        startScanButton.addEventListener('click', () => runScan(false));
        resultsDiv.addEventListener('click', handleActionClick);

        const cached = await Cache.get();
        if (cached && cached.manifest && cached.categories && Cache.isValid(cached)) {
            initialScreen.style.display = 'none';
            await runScan(false);
        } else if (currentSettings.autoScan) {
            await runScan(false);
        } else {
            initialScreen.style.display = 'flex';
        }
    };

    init();
});