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
    // DOM BUILDER UTILITIES
    // ========================================================================
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

    const create = (tag, opts = {}) => {
        const el = document.createElement(tag);
        if (opts.id) el.id = opts.id;
        if (opts.className) el.className = opts.className;
        if (opts.text) el.textContent = opts.text;
        if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => el.setAttribute(k, v));
        if (opts.props) Object.entries(opts.props).forEach(([k, v]) => el[k] = v);
        if (opts.on) Object.entries(opts.on).forEach(([k, v]) => el.addEventListener(k, v));
        if (opts.children) opts.children.forEach(c => el.appendChild(c));
        return el;
    };

    // ========================================================================
    // STATE
    // ========================================================================
    let currentSettings = { autoScan: false, cacheDuration: DEFAULT_CACHE_HOURS, ignored: [] };
    let lastFocusedElement = null;
    let _pendingConfirm = null;

    // ========================================================================
    // DOM REFERENCES
    // ========================================================================
    const resultsDiv = $('#results');
    const loadingOverlay = $('#loading');
    const summaryBar = $('#summaryBar');
    const footer = $('#footer');
    const liveRegion = $('#liveRegion');
    const initialScreen = $('#initial-screen');
    const startScanButton = $('#startScanButton');

    // Settings modal
    const settingsModal = $('#settingsModal');
    const settingsButton = $('#settingsButton');
    const closeSettingsBtn = $('#closeSettingsModal');
    const autoScanSetting = $('#autoScanSetting');
    const cacheDurationSetting = $('#cacheDurationSetting');
    const refreshCacheButton = $('#refreshCacheButton');
    const ignoredListContainer = $('#ignoredListContainer');

    // Confirmation modal
    const confirmModal = $('#confirmModal');
    const confirmTitle = $('#confirmTitle');
    const confirmMessage = $('#confirmMessage');
    const confirmAction = $('#confirmAction');
    const confirmCancel = $('#confirmCancel');

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
        liveRegion.textContent = '';
        requestAnimationFrame(() => {
            liveRegion.textContent = message;
            setTimeout(() => { liveRegion.textContent = ''; }, 5000);
        });
    };

    const setUIEnabled = (enabled) => {
        $$('button, select, input, textarea').forEach(el => {
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
        resultsDiv.replaceChildren(initialScreen);
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

        // Remove any existing trap on this element to avoid duplicates
        if (element._focusTrap) {
            element.removeEventListener('keydown', element._focusTrap);
        }
        element.addEventListener('keydown', handler);
        element._focusTrap = handler;
    };

    const openModal = (modal) => {
        // Pause focus traps on other visible modals (nested modal support)
        $$('.modal-overlay.visible').forEach(m => {
            if (m._focusTrap) {
                m.removeEventListener('keydown', m._focusTrap);
            }
        });

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

        // Re-activate focus trap on the next visible modal down
        const visibleModals = $$('.modal-overlay.visible');
        if (visibleModals.length > 0) {
            trapFocus(visibleModals[visibleModals.length - 1]);
        }

        if (lastFocusedElement && document.contains(lastFocusedElement)) {
            lastFocusedElement.focus();
        }
    };

    const resolveConfirm = (value) => {
        if (_pendingConfirm && !_pendingConfirm.handled) {
            _pendingConfirm.handled = true;
            _pendingConfirm.resolve(value);
            _pendingConfirm = null;
        }
    };

    const showConfirm = (title, message) => {
        confirmTitle.textContent = title;
        confirmMessage.textContent = message;

        return new Promise((resolve) => {
            _pendingConfirm = { resolve, handled: false };
            openModal(confirmModal);
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
        const tabs = $$('.settings-nav-item[role="tab"]');
        const panels = $$('.settings-panel');

        const switchTab = (targetTab) => {
            tabs.forEach(t => {
                const isActive = t === targetTab;
                t.classList.toggle('active', isActive);
                t.setAttribute('aria-selected', String(isActive));
                t.setAttribute('tabindex', isActive ? '0' : '-1');
            });
            panels.forEach(p => {
                p.classList.toggle('active', p.id === targetTab.getAttribute('aria-controls'));
            });
        };

        tabs.forEach((tab, index) => {
            tab.setAttribute('tabindex', tab.classList.contains('active') ? '0' : '-1');

            tab.addEventListener('click', () => switchTab(tab));

            tab.addEventListener('keydown', (e) => {
                let nextIndex = index;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    nextIndex = (index + 1) % tabs.length;
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    nextIndex = (index - 1 + tabs.length) % tabs.length;
                } else if (e.key === 'Home') {
                    nextIndex = 0;
                } else if (e.key === 'End') {
                    nextIndex = tabs.length - 1;
                } else {
                    return;
                }
                e.preventDefault();
                tabs[nextIndex].focus();
                switchTab(tabs[nextIndex]);
            });
        });
    };

    const renderIgnoredList = async () => {
        if (!ignoredListContainer) return;
        ignoredListContainer.replaceChildren();

        if (currentSettings.ignored.length === 0) {
            const empty = create('div', { className: 'empty-ignored' });
            empty.appendChild(create('span', { className: 'icon icon-info', attrs: { 'aria-hidden': 'true' } }));
            empty.appendChild(create('p', { text: 'No extensions are currently ignored.' }));
            empty.appendChild(create('p', {
                className: 'setting-hint',
                text: 'Ignored extensions are excluded from conflict detection.'
            }));
            ignoredListContainer.appendChild(empty);
            return;
        }

        const installed = await chrome.management.getAll();
        const installedMap = new Map(installed.map(e => [e.id, e]));

        const list = create('div', { className: 'ignored-list' });

        currentSettings.ignored.forEach(id => {
            const ext = installedMap.get(id);
            const item = create('div', { className: 'ignored-item' });

            const info = create('div', { className: 'ignored-info' });

            if (ext?.icons?.length) {
                const iconUrl = ext.icons.sort((a, b) => b.size - a.size)[0].url;
                const img = create('img', {
                    className: 'ignored-icon',
                    attrs: { src: iconUrl, alt: '', 'aria-hidden': 'true' }
                });
                img.onerror = () => img.remove();
                info.appendChild(img);
            }

            const textWrap = create('div', { className: 'ignored-text' });
            textWrap.appendChild(create('span', {
                className: 'ignored-name',
                text: ext ? ext.name : 'Unknown extension'
            }));
            textWrap.appendChild(create('span', {
                className: 'ignored-id',
                text: id.length > 24 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id
            }));
            info.appendChild(textWrap);
            item.appendChild(info);

            const btn = create('button', {
                className: 'btn',
                attrs: { 'aria-label': `Stop ignoring ${ext ? ext.name : id}` },
                text: 'Un-ignore'
            });
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
        if (!manifest?.endpoints?.conflicts?.categories) {
            throw new Error('Invalid manifest: missing conflict categories');
        }

        const entries = Object.entries(manifest.endpoints.conflicts.categories);
        const cached = await Cache.get();

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

        return categories
            .filter(cat => Array.isArray(cat?.extension_ids))
            .map(cat => {
                const active = cat.extension_ids
                    .map(id => installedMap.get(id))
                    .filter(ext => ext && ext.enabled && !ignoredSet.has(ext.id));
                return active.length >= 2 ? { ...cat, extensions: active } : null;
            })
            .filter(Boolean);
    };

    const runScan = async (forceRefresh = false) => {
        showLoading();
        initialScreen.style.display = 'none';
        clearResults();

        try {
            const manifest = await getManifest(forceRefresh);
            const categories = await getCategories(manifest, forceRefresh);
            const installed = await chrome.management.getAll();

            const conflicts = findConflicts(installed, categories);

            renderResults(conflicts);
            displayFooter(manifest);

            if (conflicts.length > 0) {
                const groupWord = conflicts.length > 1 ? 'groups' : 'group';
                announce(`Scan complete. Found ${conflicts.length} conflict ${groupWord}.`, 'assertive');
                Status.warning(`Found ${conflicts.length} conflict ${groupWord}`);
            } else {
                announce('Scan complete. No conflicts found.');
                Status.success('No conflicts found');
            }
        } catch (err) {
            console.error('Scan error:', err);

            const isNetwork = err.name === 'TypeError' || /fetch|network/i.test(err.message);
            const isHttp = /HTTP/i.test(err.message);

            let title = 'Scan Failed';
            let message = 'Something went wrong while checking for conflicts.';

            if (isHttp) {
                title = 'Server Error';
                message = `Could not fetch compatibility data (${err.message}). The server may be temporarily unavailable.`;
            } else if (isNetwork) {
                title = 'Connection Error';
                message = 'Please check your internet connection and try again.';
            }

            renderError(title, message, true);
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
        summaryBar.replaceChildren();

        if (!conflicts) {
            summaryBar.className = 'summary-bar';
            return;
        }

        if (conflicts.length === 0) {
            summaryBar.className = 'summary-bar clean';
            summaryBar.appendChild(create('span', { className: 'icon icon-check', attrs: { 'aria-hidden': 'true' } }));
            summaryBar.appendChild(create('span', { className: 'summary-text', text: 'No conflicts' }));
            return;
        }

        const total = conflicts.reduce((sum, c) => sum + c.extensions.length, 0);
        summaryBar.className = 'summary-bar warning';
        summaryBar.appendChild(create('span', { className: 'icon icon-warning', attrs: { 'aria-hidden': 'true' } }));
        summaryBar.appendChild(create('span', { className: 'summary-text', text: `${conflicts.length} groups · ${total} extensions` }));
    };

    const renderResults = (conflicts) => {
        clearResults();
        updateSummaryBar(conflicts);

        if (conflicts.length === 0) {
            renderEmptyState();
            return;
        }

        const wrapper = create('div', { className: 'results-wrapper' });
        conflicts.forEach(conflict => wrapper.appendChild(buildConflictCard(conflict)));

        const actions = create('div', { className: 'results-actions' });
        const scanAgainBtn = create('button', { className: 'btn primary', text: 'Scan Again' });
        scanAgainBtn.addEventListener('click', () => runScan(false));
        actions.appendChild(scanAgainBtn);
        wrapper.appendChild(actions);

        resultsDiv.appendChild(wrapper);
    };

    const buildConflictCard = (conflict) => {
        const card = create('div', { className: 'conflict-card' });

        const header = create('div', { className: 'conflict-header' });
        header.appendChild(create('h3', { className: 'conflict-title', text: conflict.name }));
        header.appendChild(create('p', { className: 'conflict-desc', text: conflict.description }));
        card.appendChild(header);

        const list = create('div', { className: 'extension-list' });
        conflict.extensions.forEach(ext => list.appendChild(buildExtensionItem(ext)));
        card.appendChild(list);

        return card;
    };

    const buildExtensionItem = (ext) => {
        const iconUrl = ext.icons?.sort((a, b) => b.size - a.size)[0]?.url || GENERIC_ICON;

        const item = create('div', { className: 'extension-item' });

        const img = create('img', {
            className: 'extension-icon',
            attrs: { src: iconUrl, alt: '', 'aria-hidden': 'true' }
        });
        img.onerror = () => { img.src = GENERIC_ICON; };
        item.appendChild(img);

        const info = create('div', { className: 'extension-info' });
        info.appendChild(create('div', { className: 'extension-name', text: ext.name }));
        item.appendChild(info);

        const actions = create('div', { className: 'extension-actions' });

        const toggleBtn = create('button', {
            className: 'btn',
            attrs: {
                'data-action': 'toggle',
                'data-id': ext.id,
                'data-enabled': String(ext.enabled),
                'aria-label': `Disable ${ext.name}`,
                'aria-pressed': 'true'
            },
            text: 'Disable'
        });
        actions.appendChild(toggleBtn);

        const ignoreBtn = create('button', {
            className: 'btn',
            attrs: {
                'data-action': 'ignore',
                'data-id': ext.id,
                'data-name': ext.name,
                'aria-label': `Ignore ${ext.name}`
            },
            text: 'Ignore'
        });
        actions.appendChild(ignoreBtn);

        item.appendChild(actions);
        return item;
    };

    const renderEmptyState = () => {
        const el = create('div', { className: 'empty-state' });
        el.appendChild(create('span', { className: 'icon icon-check', attrs: { 'aria-hidden': 'true' } }));
        el.appendChild(create('div', { className: 'empty-state-title', text: 'All Clear' }));
        el.appendChild(create('p', {
            className: 'empty-state-text',
            text: 'No conflicting extension groups were found. Your extensions are playing nicely together.'
        }));

        const scanAgainBtn = create('button', {
            className: 'btn primary scan-btn',
            text: 'Scan Again'
        });
        scanAgainBtn.addEventListener('click', () => runScan(false));
        el.appendChild(scanAgainBtn);

        resultsDiv.appendChild(el);
    };

    const renderError = (title, message, retryable = false) => {
        clearResults();
        updateSummaryBar(null);

        const el = create('div', { className: 'empty-state' });
        el.appendChild(create('span', { className: 'icon icon-error', attrs: { 'aria-hidden': 'true' } }));
        el.appendChild(create('div', { className: 'empty-state-title', text: title }));
        el.appendChild(create('p', { className: 'empty-state-text', text: message }));

        if (retryable) {
            const retryBtn = create('button', {
                className: 'btn primary scan-btn',
                attrs: { 'aria-label': 'Retry scan' },
                text: 'Try Again'
            });
            retryBtn.addEventListener('click', () => runScan(false));
            el.appendChild(retryBtn);
        }

        resultsDiv.appendChild(el);
    };

    const displayFooter = (manifest) => {
        if (!manifest) {
            footer.classList.remove('visible');
            return;
        }

        footer.replaceChildren();

        if (manifest.version) {
            footer.appendChild(document.createTextNode(`Data v${manifest.version}`));
        }
        if (manifest.last_updated) {
            footer.appendChild(document.createTextNode(` · Updated ${new Date(manifest.last_updated).toLocaleDateString()}`));
        }

        footer.appendChild(document.createTextNode(' · '));

        const link = create('a', {
            attrs: {
                href: 'https://github.com/modcoretech/api/issues',
                target: '_blank',
                rel: 'noopener noreferrer'
            },
            text: 'Report an Issue'
        });
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
                `"${name}" will be excluded from future conflict scans. You can un-ignore it in Settings.`
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
                    setUIEnabled(true);
                    return;
            }
        } catch (err) {
            console.error(`Action '${action}' failed:`, err);
            renderError('Action Failed', 'Could not complete the action. Please try again or manage the extension manually.', false);
            announce('Action failed. Please try again.', 'assertive');
            Status.error('Action failed');
            setUIEnabled(true);
        }
    };

    // ========================================================================
    // GLOBAL EVENTS
    // ========================================================================
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const visibleModals = $$('.modal-overlay.visible');
        visibleModals.forEach(m => {
            if (m === confirmModal) {
                resolveConfirm(false);
            }
            closeModal(m);
        });
    });

    document.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal && e.target === modal) {
            if (modal === confirmModal) {
                resolveConfirm(false);
            }
            closeModal(modal);
        }
    });

    confirmAction.addEventListener('click', () => {
        resolveConfirm(true);
        closeModal(confirmModal);
    });

    confirmCancel.addEventListener('click', () => {
        resolveConfirm(false);
        closeModal(confirmModal);
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

        closeSettingsBtn.addEventListener('click', () => closeModal(settingsModal));

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