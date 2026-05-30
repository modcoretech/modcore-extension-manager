document.addEventListener('DOMContentLoaded', () => {

    // =========================================================================
    // CONSTANTS & STATE
    // =========================================================================
    const API_URL = 'https://raw.githubusercontent.com/modcoretech/api/main/modcoreEM/extensions.json';
    const DEFAULT_CACHE_TTL_HOURS = 24;
    const MAX_HISTORY_ENTRIES = 4;

    // Storage keys — never modified
    const IGNORED_EXTENSIONS_KEY = 'inspect_ignored_extensions';
    const AUTO_SCAN_KEY           = 'inspect_auto_scan_enabled';
    const LAST_SCAN_KEY           = 'inspect_last_scan_timestamp';
    const SCAN_HISTORY_KEY        = 'inspect_scan_history';
    const SETTINGS_KEY            = 'inspect_settings';

    const GENERIC_EXTENSION_ICON = '../../public/icons/svg/info.svg';

    let conflictConfig     = null;
    let activeTooltip      = null;
    let currentScanResults = null;
    let lastFocusedElement = null;
    let currentSettings    = { autoScan: false, cacheDuration: DEFAULT_CACHE_TTL_HOURS };


    // =========================================================================
    // DOM REFERENCES
    // =========================================================================
    const resultsDiv          = document.getElementById('results');
    const loadingSpinner      = document.getElementById('loading-spinner');
    const footer              = document.getElementById('footer');
    const liveRegion          = document.getElementById('liveRegion');
    const toastContainer      = document.getElementById('toastContainer');
    const headerMetaDiv       = document.getElementById('header-meta');
    const initialScanScreen   = document.getElementById('initial-scan-screen');
    const startScanButton     = document.getElementById('startScanButton');

    // Confirmation modal
    const confirmationModal   = document.getElementById('confirmationModal');
    const modalTitle          = document.getElementById('modalTitle');
    const modalMessage        = document.getElementById('modalMessage');
    const confirmButton       = document.getElementById('confirmButton');
    const cancelButton        = document.getElementById('cancelButton');

    // Scan history popover
    const scanHistoryPopover  = document.getElementById('scanHistoryPopover');
    const scanHistoryList     = document.getElementById('scanHistoryList');
    const closeHistoryPopover = document.getElementById('closeHistoryPopover');

    // Settings modal
    const settingsModal       = document.getElementById('settingsModal');
    const settingsButton      = document.getElementById('settingsButton');
    const closeSettingsModal  = document.getElementById('closeSettingsModal');
    const autoScanSetting     = document.getElementById('autoScanSetting');
    const cacheDurationSetting= document.getElementById('cacheDurationSetting');
    const refreshCacheButton  = document.getElementById('refreshCacheButton');

    // Fix All modal
    const fixAllModal         = document.getElementById('fixAllModal');
    const fixAllTitle         = document.getElementById('fixAllTitle');
    const fixAllMessage       = document.getElementById('fixAllMessage');
    const fixAllSummary       = document.getElementById('fixAllSummary');
    const confirmFixAllButton = document.getElementById('confirmFixAllButton');
    const cancelFixAllButton  = document.getElementById('cancelFixAllButton');


    // =========================================================================
    // SETTINGS
    // =========================================================================
    const loadSettings = () => {
        try {
            const stored = localStorage.getItem(SETTINGS_KEY);
            return stored ? JSON.parse(stored) : {};
        } catch {
            return {};
        }
    };

    const saveSettings = async (patch) => {
        currentSettings = { ...currentSettings, ...patch };
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));
        } catch {
            // localStorage unavailable — silently continue, chrome.storage below is canonical
        }
        await chrome.storage.local.set({ [AUTO_SCAN_KEY]: currentSettings.autoScan });
    };

    const initSettingsUI = () => {
        autoScanSetting.checked      = currentSettings.autoScan;
        cacheDurationSetting.value   = String(currentSettings.cacheDuration);
    };


    // =========================================================================
    // STORAGE MANAGER
    // Storage is kept lean to stay well within chrome.storage.local's 10 MB limit.
    // conflictConfig (the API payload) is the largest item (~20–40 KB).
    // History entries store only primitive counts + a short summary string.
    // =========================================================================
    const StorageManager = {
        cacheTTL() {
            return (currentSettings.cacheDuration || DEFAULT_CACHE_TTL_HOURS) * 3_600_000;
        },

        async storeScanResults(results, hasIssues) {
            const timestamp = Date.now();
            await chrome.storage.local.set({ [LAST_SCAN_KEY]: timestamp });
            await this._addToHistory(results, timestamp, hasIssues);
        },

        async _addToHistory(results, timestamp, hasIssues) {
            const history = await this.getScanHistory();

            // Build a compact summary string (≤ ~60 chars)
            const names = [];
            (results.conflicts  || []).forEach(c => names.push(c.name));
            (results.deprecated || []).forEach(d => names.push(d.extension.name));
            const summary = names.length === 0
                ? null
                : names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2} more` : '');

            const entry = {
                timestamp,
                id: timestamp.toString(36),
                status:          hasIssues ? 'issues_found' : 'clean',
                conflictCount:   results.conflicts?.length  || 0,
                deprecatedCount: results.deprecated?.length || 0,
                summary,
            };

            // Keep most-recent MAX_HISTORY_ENTRIES only
            const updated = [entry, ...history].slice(0, MAX_HISTORY_ENTRIES);
            await chrome.storage.local.set({ [SCAN_HISTORY_KEY]: updated });
        },

        async getScanHistory() {
            const data = await chrome.storage.local.get(SCAN_HISTORY_KEY);
            return data[SCAN_HISTORY_KEY] || [];
        },
    };


    // =========================================================================
    // HELPERS
    // =========================================================================
    const formatRelativeTime = (ts) => {
        const s = Math.floor((Date.now() - ts) / 1000);
        if (s < 10)  return 'Just now';
        if (s < 60)  return `${s}s ago`;
        const m = Math.floor(s / 60);
        if (m < 60)  return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24)  return `${h}h ago`;
        const d = Math.floor(h / 24);
        if (d < 7)   return `${d}d ago`;
        return new Date(ts).toLocaleDateString();
    };

    const announce = (message, priority = 'polite') => {
        liveRegion.setAttribute('aria-live', priority);
        requestAnimationFrame(() => {
            liveRegion.textContent = message;
            setTimeout(() => { liveRegion.textContent = ''; }, 1500);
        });
    };

    const showToast = (message, type = 'info') => {
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.setAttribute('role', 'status');
        toast.textContent = message;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(6px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    };


    // =========================================================================
    // MODAL / FOCUS MANAGEMENT
    // =========================================================================
    const trapFocus = (element) => {
        const focusables = element.querySelectorAll(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last  = focusables[focusables.length - 1];

        const handler = (e) => {
            if (e.key !== 'Tab') return;
            if (e.shiftKey) {
                if (document.activeElement === first) { last.focus(); e.preventDefault(); }
            } else {
                if (document.activeElement === last) { first.focus(); e.preventDefault(); }
            }
        };
        element.addEventListener('keydown', handler);
        element._focusTrapHandler = handler;
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
        if (modal._focusTrapHandler) {
            modal.removeEventListener('keydown', modal._focusTrapHandler);
            delete modal._focusTrapHandler;
        }
        if (lastFocusedElement && document.contains(lastFocusedElement)) {
            lastFocusedElement.focus();
        }
    };

    const showConfirmationModal = (title, message) => {
        modalTitle.textContent   = title;
        modalMessage.textContent = message;
        openModal(confirmationModal);
        return new Promise((resolve) => {
            const yes = () => { closeModal(confirmationModal); resolve(true); };
            const no  = () => { closeModal(confirmationModal); resolve(false); };
            confirmButton.addEventListener('click', yes, { once: true });
            cancelButton.addEventListener('click',  no,  { once: true });
        });
    };


    // =========================================================================
    // TOOLTIP POSITIONING
    // =========================================================================
    const positionTooltip = (trigger, content) => {
        const tr = trigger.getBoundingClientRect();
        const ct = content.getBoundingClientRect();
        const vw = window.innerWidth;
        let top  = tr.top - ct.height - 10;
        let left = tr.left + tr.width / 2 - ct.width / 2;
        if (left < 8) left = 8;
        if (left + ct.width > vw - 8) left = vw - ct.width - 8;
        if (top < 8) top = tr.bottom + 10;
        content.style.top        = `${top}px`;
        content.style.left       = `${left}px`;
        content.style.opacity    = '1';
        content.style.visibility = 'visible';
    };

    const hideTooltip = (content) => {
        if (!content) return;
        content.style.opacity    = '0';
        content.style.visibility = 'hidden';
    };


    // =========================================================================
    // DATA FETCHING
    // =========================================================================
    const getConflictConfig = async (forceRefresh) => {
        const cached    = await chrome.storage.local.get(['conflictConfig', 'cache_timestamp']);
        const config    = cached.conflictConfig;
        const cachedAt  = cached.cache_timestamp;
        const ttl       = StorageManager.cacheTTL();
        const cacheHit  = !forceRefresh && config && cachedAt && (Date.now() - cachedAt < ttl);

        if (cacheHit) {
            conflictConfig = config;
            return config;
        }

        let fetched;
        try {
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            fetched = await response.json();
        } catch (err) {
            if (config) {
                // Stale cache is better than nothing
                conflictConfig = config;
                showToast('Using cached data — network unavailable', 'warning');
                return config;
            }
            throw err;
        }

        // Only write what we actually need; strip security_threats_metadata to save space
        const slim = {
            version:               fetched.version,
            last_updated:          fetched.last_updated,
            conflict_categories:   fetched.conflict_categories,
            deprecated_extensions: fetched.deprecated_extensions,
        };

        await chrome.storage.local.set({ conflictConfig: slim, cache_timestamp: Date.now() });
        conflictConfig = slim;
        return slim;
    };

    const loadIgnoredExtensions = async () => {
        const data = await chrome.storage.local.get(IGNORED_EXTENSIONS_KEY);
        return new Set(data[IGNORED_EXTENSIONS_KEY] || []);
    };

    const saveIgnoredExtension = async (id) => {
        const ignored = await loadIgnoredExtensions();
        ignored.add(id);
        await chrome.storage.local.set({ [IGNORED_EXTENSIONS_KEY]: Array.from(ignored) });
    };

    const removeIgnoredExtension = async (id) => {
        const ignored = await loadIgnoredExtensions();
        ignored.delete(id);
        await chrome.storage.local.set({ [IGNORED_EXTENSIONS_KEY]: Array.from(ignored) });
    };


    // =========================================================================
    // CORE SCAN LOGIC
    // =========================================================================
    const findConflicts = (installed, categories, ignored) =>
        categories.map(cat => {
            const active = installed.filter(
                ext => cat.extension_ids.includes(ext.id) && ext.enabled && !ignored.has(ext.id)
            );
            return active.length >= 2 ? { ...cat, extensions: active } : null;
        }).filter(Boolean);

    const findDeprecated = (installed, deprecatedList, ignored) => {
        const map = new Map(deprecatedList.map(d => [d.id, d]));
        return installed.flatMap(ext => {
            if (map.has(ext.id) && !ignored.has(ext.id)) {
                return [{ extension: ext, ...map.get(ext.id) }];
            }
            return [];
        });
    };

    const clearResults = () => {
        let child = resultsDiv.lastChild;
        while (child) {
            const prev = child.previousSibling;
            if (child !== initialScanScreen && child !== loadingSpinner) {
                resultsDiv.removeChild(child);
            }
            child = prev;
        }
    };

    const showSpinner = () => {
        loadingSpinner.style.display = 'block';
        resultsDiv.classList.add('dimmed');
        resultsDiv.setAttribute('aria-busy', 'true');
    };

    const hideSpinner = () => {
        loadingSpinner.style.display = 'none';
        resultsDiv.classList.remove('dimmed');
        resultsDiv.setAttribute('aria-busy', 'false');
    };

    const setButtonsDisabled = (disabled) => {
        resultsDiv.querySelectorAll('button, select, input').forEach(el => {
            el.disabled = disabled;
        });
        startScanButton.disabled = disabled;
    };

    const runScan = async (forceRefresh = false) => {
        showSpinner();
        setButtonsDisabled(true);
        initialScanScreen.style.display = 'none';
        clearResults();
        announce('Scanning extensions. Please wait.');

        try {
            const [config, installed, ignored] = await Promise.all([
                getConflictConfig(forceRefresh),
                chrome.management.getAll(),
                loadIgnoredExtensions(),
            ]);

            const conflicts   = findConflicts(installed,  config.conflict_categories,   ignored);
            const deprecated  = findDeprecated(installed, config.deprecated_extensions, ignored);
            const hasIssues   = conflicts.length > 0 || deprecated.length > 0;

            currentScanResults = { conflicts, deprecated, allInstalled: installed, ignored };

            await StorageManager.storeScanResults(currentScanResults, hasIssues);

            renderResults(conflicts, deprecated, installed, ignored);
            displayDataVersionInfo(config);
            displayLastScanTime();

            if (hasIssues) {
                const total = conflicts.length + deprecated.length;
                announce(`Scan complete. ${total} issue${total > 1 ? 's' : ''} found.`, 'assertive');
                showToast(`Found ${total} issue${total > 1 ? 's' : ''}`, 'warning');
            } else {
                announce('Scan complete. No issues found.');
                showToast('No issues found', 'success');
            }

        } catch (err) {
            console.error('Scan error:', err);
            let title   = 'Scan Failed';
            let message = 'Something went wrong. Please try again.';
            if (err.message?.includes('HTTP')) {
                title   = 'Could Not Fetch Data';
                message = `The server returned an error (${err.message}). Try again or use Refresh in Settings.`;
            } else if (err.message?.includes('fetch')) {
                title   = 'No Internet Connection';
                message = 'Could not reach the data server. Check your connection and try again.';
            } else if (!conflictConfig) {
                title   = 'No Data Available';
                message = 'No cached data and no network access. An internet connection is required for the first scan.';
            }
            renderErrorPlaceholder(title, message);
            announce(`${title}. ${message}`, 'assertive');
        } finally {
            hideSpinner();
            setButtonsDisabled(false);
        }
    };

    const loadResultsFromCache = async () => {
        showSpinner();
        setButtonsDisabled(true);
        try {
            const [cachedData, installed, ignored] = await Promise.all([
                chrome.storage.local.get('conflictConfig'),
                chrome.management.getAll(),
                loadIgnoredExtensions(),
            ]);

            const config = cachedData.conflictConfig;
            if (!config) throw new Error('Cached config missing');

            conflictConfig = config;
            const conflicts  = findConflicts(installed,  config.conflict_categories,   ignored);
            const deprecated = findDeprecated(installed, config.deprecated_extensions, ignored);

            currentScanResults = { conflicts, deprecated, allInstalled: installed, ignored };
            renderResults(conflicts, deprecated, installed, ignored);
            displayDataVersionInfo(config);
            displayLastScanTime();

        } catch (err) {
            console.error('Cache load error:', err);
            renderErrorPlaceholder('Cache Load Failed', 'Could not load results from cache. Please run a new scan.');
        } finally {
            hideSpinner();
            setButtonsDisabled(false);
        }
    };


    // =========================================================================
    // FIX ALL
    // =========================================================================
    const showFixAllModal = () => {
        if (!currentScanResults) return;
        const { conflicts, deprecated } = currentScanResults;
        if (conflicts.length === 0 && deprecated.length === 0) return;

        const hasCritical = conflicts.some(c => c.conflict_level === 'critical')
                         || deprecated.some(d => d.security_risk_level === 'critical');

        fixAllTitle.textContent   = hasCritical ? 'Fix Critical Issues?' : 'Fix All Issues?';
        fixAllMessage.textContent = hasCritical
            ? 'Critical-risk extensions were detected. Disabling them is strongly recommended. Review the actions below before confirming.'
            : 'Review the actions below before confirming. This will disable conflicting extensions (keeping one per group) and all deprecated extensions.';

        // Clear previous content
        while (fixAllSummary.firstChild) fixAllSummary.removeChild(fixAllSummary.firstChild);

        if (conflicts.length > 0) {
            const section = document.createElement('div');
            section.className = 'fix-all-section';

            const title = document.createElement('div');
            title.className = 'fix-all-section-title';
            title.textContent = `Conflicting Extensions (${conflicts.length} group${conflicts.length > 1 ? 's' : ''})`;
            section.appendChild(title);

            conflicts.forEach(conflict => {
                const group = document.createElement('div');
                group.className = 'fix-all-group';
                group.setAttribute('role', 'listitem');

                const groupName = document.createElement('div');
                groupName.className = 'fix-all-group-name';
                groupName.textContent = conflict.name;
                group.appendChild(groupName);

                const toDisable = conflict.extensions.slice(1);
                if (toDisable.length > 0) {
                    toDisable.forEach(ext => {
                        const item = createFixAllItem(ext.name, 'conflict');
                        group.appendChild(item);
                    });
                } else {
                    const note = document.createElement('div');
                    note.className = 'fix-all-item fix-all-item--info';
                    note.textContent = 'Only one extension active — nothing to disable';
                    group.appendChild(note);
                }
                section.appendChild(group);
            });

            fixAllSummary.appendChild(section);
        }

        if (deprecated.length > 0) {
            const section = document.createElement('div');
            section.className = 'fix-all-section';

            const title = document.createElement('div');
            title.className = 'fix-all-section-title';
            title.textContent = `Deprecated Extensions (${deprecated.length})`;
            section.appendChild(title);

            deprecated.forEach(dep => {
                section.appendChild(createFixAllItem(dep.extension.name, 'deprecated'));
            });

            fixAllSummary.appendChild(section);
        }

        openModal(fixAllModal);
    };

    const createFixAllItem = (name, kind) => {
        const item = document.createElement('div');
        item.className = `fix-all-item fix-all-item--${kind}`;
        item.setAttribute('role', 'listitem');

        const icon = document.createElement('span');
        icon.className = `icon ${kind === 'deprecated' ? 'icon-error' : 'icon-warning'}`;
        icon.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.textContent = `Disable ${name}`;

        item.appendChild(icon);
        item.appendChild(text);
        return item;
    };

    const executeFixAll = async () => {
        closeModal(fixAllModal);
        showSpinner();
        setButtonsDisabled(true);
        announce('Fixing all issues. Disabling extensions.');

        try {
            const { conflicts, deprecated } = currentScanResults;
            const promises = [];

            conflicts.forEach(c  => c.extensions.slice(1).forEach(ext => promises.push(chrome.management.setEnabled(ext.id, false))));
            deprecated.forEach(d => promises.push(chrome.management.setEnabled(d.extension.id, false)));

            await Promise.all(promises);
            showToast('All issues fixed', 'success');
            announce('All issues fixed. Re-scanning.');
            await runScan(false);

        } catch (err) {
            console.error('Fix All failed:', err);
            renderErrorPlaceholder('Fix All Failed', 'Some extensions could not be disabled. Please try again manually.');
            announce('Fix All failed. Some extensions could not be disabled.', 'assertive');
            showToast('Fix All failed', 'error');
        } finally {
            hideSpinner();
            setButtonsDisabled(false);
        }
    };


    // =========================================================================
    // SCAN HISTORY POPOVER
    // =========================================================================
    const toggleHistoryPopover = () => {
        const isOpen = scanHistoryPopover.classList.contains('visible');
        if (isOpen) {
            closeScanHistoryPopover();
        } else {
            renderScanHistory();
            scanHistoryPopover.classList.add('visible');
            headerMetaDiv.setAttribute('aria-expanded', 'true');
            closeHistoryPopover.focus();
        }
    };

    const closeScanHistoryPopover = () => {
        scanHistoryPopover.classList.remove('visible');
        headerMetaDiv.setAttribute('aria-expanded', 'false');
    };

    const renderScanHistory = async () => {
        while (scanHistoryList.firstChild) scanHistoryList.removeChild(scanHistoryList.firstChild);

        const history = await StorageManager.getScanHistory();

        if (history.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No scan history yet';
            scanHistoryList.appendChild(empty);
            return;
        }

        history.forEach(entry => {
            const hasIssues = entry.conflictCount > 0 || entry.deprecatedCount > 0;

            const item = document.createElement('div');
            item.className = 'scan-history-item';
            item.setAttribute('role', 'listitem');
            item.setAttribute('tabindex', '0');
            item.setAttribute('aria-label',
                `Scan from ${formatRelativeTime(entry.timestamp)}. ${
                    hasIssues
                        ? `${entry.conflictCount} conflict group${entry.conflictCount !== 1 ? 's' : ''}, ${entry.deprecatedCount} deprecated`
                        : 'No issues found'
                }`
            );

            const iconWrap = document.createElement('div');
            iconWrap.className = `scan-history-icon ${hasIssues ? 'warning' : 'success'}`;
            iconWrap.setAttribute('aria-hidden', 'true');
            const iconEl = document.createElement('span');
            iconEl.className = `icon ${hasIssues ? 'icon-warning' : 'icon-check'}`;
            iconWrap.appendChild(iconEl);

            const info = document.createElement('div');
            info.className = 'scan-history-info';

            const time = document.createElement('div');
            time.className = 'scan-history-time';
            time.textContent = formatRelativeTime(entry.timestamp);
            time.title = new Date(entry.timestamp).toLocaleString();

            const counts = document.createElement('div');
            counts.className = 'scan-history-counts';

            if (entry.conflictCount > 0) {
                const b = document.createElement('span');
                b.className = 'scan-history-badge scan-history-badge--conflict';
                b.textContent = `${entry.conflictCount} conflict${entry.conflictCount > 1 ? 's' : ''}`;
                counts.appendChild(b);
            }
            if (entry.deprecatedCount > 0) {
                const b = document.createElement('span');
                b.className = 'scan-history-badge scan-history-badge--deprecated';
                b.textContent = `${entry.deprecatedCount} deprecated`;
                counts.appendChild(b);
            }
            if (!hasIssues) {
                const b = document.createElement('span');
                b.className = 'scan-history-badge scan-history-badge--clean';
                b.textContent = 'Clean';
                counts.appendChild(b);
            }

            info.appendChild(time);
            info.appendChild(counts);

            item.appendChild(iconWrap);
            item.appendChild(info);

            // Expandable detail on click/Enter
            let detailOpen = false;
            const toggleDetail = () => {
                detailOpen = !detailOpen;
                const existing = item.nextElementSibling;
                if (detailOpen) {
                    const detail = buildHistoryDetail(entry);
                    item.insertAdjacentElement('afterend', detail);
                } else if (existing?.classList.contains('scan-history-detail')) {
                    existing.remove();
                }
            };

            item.addEventListener('click', toggleDetail);
            item.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDetail(); }
            });

            scanHistoryList.appendChild(item);
        });
    };

    const buildHistoryDetail = (entry) => {
        const detail = document.createElement('div');
        detail.className = 'scan-history-detail';

        const dateEl = document.createElement('div');
        dateEl.className = 'scan-history-detail-date';
        dateEl.textContent = new Date(entry.timestamp).toLocaleString();
        detail.appendChild(dateEl);

        const addRow = (label, value) => {
            const row = document.createElement('div');
            row.className = 'scan-history-detail-row';
            const strong = document.createElement('strong');
            strong.textContent = `${label}: `;
            row.appendChild(strong);
            row.appendChild(document.createTextNode(value));
            detail.appendChild(row);
        };

        if (entry.conflictCount > 0)  addRow('Conflicts',  `${entry.conflictCount} group${entry.conflictCount  > 1 ? 's' : ''}`);
        if (entry.deprecatedCount > 0) addRow('Deprecated', `${entry.deprecatedCount} extension${entry.deprecatedCount > 1 ? 's' : ''}`);
        if (!entry.conflictCount && !entry.deprecatedCount) {
            const row = document.createElement('div');
            row.className = 'scan-history-detail-row';
            row.textContent = 'No issues found in this scan.';
            detail.appendChild(row);
        }

        return detail;
    };


    // =========================================================================
    // RENDERING
    // =========================================================================
    const renderResults = (conflicts, deprecated, allInstalled, ignoredSet) => {
        clearResults();

        const hasIssues  = conflicts.length > 0 || deprecated.length > 0;
        const hasIgnored = ignoredSet.size > 0;

        if (!hasIssues && !hasIgnored) {
            resultsDiv.appendChild(
                createPlaceholder('icon-check', 'All Clear', 'No conflicts or deprecated extensions were found.')
            );
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'results-wrapper';

        if (conflicts.length > 0) {
            wrapper.appendChild(createCollapsibleSection(
                'Conflicting Extensions',
                conflicts.map(createConflictCard),
                true,
                'These groups of active extensions can interfere with each other, causing slowdowns, broken sites, or unexpected behaviour. Keep only one per category.'
            ));
        }

        if (deprecated.length > 0) {
            wrapper.appendChild(createCollapsibleSection(
                'Deprecated or Risky Extensions',
                deprecated.map(createDeprecatedCard),
                true,
                'Extensions that are outdated, no longer maintained, removed from the Web Store, or flagged for security concerns.'
            ));
        }

        if (hasIgnored) {
            const installedMap = new Map(allInstalled.map(ext => [ext.id, ext]));
            const ignoredItems = Array.from(ignoredSet).map(id => {
                const ext = installedMap.get(id) || { id, name: `Unknown Extension (${id})`, icons: [], version: 'N/A', enabled: false };
                return createExtensionItem(ext, 'ignored');
            });
            wrapper.appendChild(createCollapsibleSection(
                'Ignored Extensions',
                [createResultsGroup(ignoredItems)],
                false,
                'Extensions you have chosen to exclude from scans. They will not appear as conflicts or deprecated, even if they match criteria.'
            ));
        }

        if (hasIssues) {
            const container = document.createElement('div');
            container.className = 'fix-all-container';

            const btn = document.createElement('button');
            btn.id          = 'fixAllButton';
            btn.className   = 'btn fix-all-btn';
            btn.setAttribute('aria-label', `Fix all ${conflicts.length + deprecated.length} issues at once`);

            const icon = document.createElement('span');
            icon.className = 'icon icon-check';
            icon.setAttribute('aria-hidden', 'true');

            btn.appendChild(icon);
            btn.appendChild(document.createTextNode(' Fix All Issues'));
            btn.addEventListener('click', showFixAllModal);

            container.appendChild(btn);
            wrapper.appendChild(container);
        }

        resultsDiv.appendChild(wrapper);
    };

    const createCollapsibleSection = (title, contentElements, startOpen, tooltipText) => {
        const section = document.createElement('section');
        section.className = 'collapsible-section';

        const header = document.createElement('button');
        header.className = `collapsible-header${startOpen ? ' active' : ''}`;
        header.setAttribute('aria-expanded', String(startOpen));
        header.setAttribute('aria-controls', `section-content-${Math.random().toString(36).slice(2, 7)}`);

        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.setAttribute('aria-hidden', 'true');
        header.appendChild(arrow);

        const titleSpan = document.createElement('span');
        titleSpan.className = 'header-title';
        titleSpan.textContent = `${title} (${contentElements.length})`;
        header.appendChild(titleSpan);

        if (tooltipText) header.appendChild(createTooltip(tooltipText));

        const content = document.createElement('div');
        content.className = 'collapsible-content';
        content.id = header.getAttribute('aria-controls');
        contentElements.forEach(el => content.appendChild(el));

        section.appendChild(header);
        section.appendChild(content);

        header.addEventListener('click', () => {
            header.classList.toggle('active');
            header.setAttribute('aria-expanded', String(header.classList.contains('active')));
        });

        return section;
    };

    const getRiskIconClass = (level) => {
        if (level === 'critical') return 'icon-error';
        if (level === 'high')     return 'icon-warning';
        return 'icon-info';
    };

    const createConflictCard = (conflict) => {
        const card  = createResultsGroup();
        const level = conflict.conflict_level || 'low';

        const header = document.createElement('div');
        header.className = `issue-card-header ${level}`;

        const titleDiv = document.createElement('div');
        titleDiv.className = 'issue-title';

        const icon = document.createElement('span');
        icon.className = `icon ${getRiskIconClass(level)}`;
        icon.setAttribute('aria-hidden', 'true');
        titleDiv.appendChild(icon);
        titleDiv.appendChild(document.createTextNode(` ${conflict.name} `));

        const badge = document.createElement('span');
        badge.className = `risk-badge ${level}`;
        badge.textContent = level;
        badge.appendChild(createTooltip(`Conflict severity: ${level}. This indicates the potential impact if both extensions remain active.`));
        titleDiv.appendChild(badge);
        header.appendChild(titleDiv);

        const desc = document.createElement('p');
        desc.className = 'issue-description';
        desc.textContent = conflict.description;
        header.appendChild(desc);

        const rec = document.createElement('div');
        rec.className = 'recommended-action';
        const recStrong = document.createElement('strong');
        recStrong.textContent = 'What to do: ';
        rec.appendChild(recStrong);
        rec.appendChild(document.createTextNode(conflict.recommended_action));
        header.appendChild(rec);

        if (conflict.source_url) {
            header.appendChild(buildSourceLink(conflict.source_url));
        }

        card.appendChild(header);
        conflict.extensions.forEach(ext => card.appendChild(createExtensionItem(ext, 'conflict')));
        return card;
    };

    const createDeprecatedCard = (dep) => {
        const card  = createResultsGroup();
        const level = dep.security_risk_level || 'low';

        const header = document.createElement('div');
        header.className = `issue-card-header ${level}`;

        const titleDiv = document.createElement('div');
        titleDiv.className = 'issue-title';

        const icon = document.createElement('span');
        icon.className = `icon ${getRiskIconClass(level)}`;
        icon.setAttribute('aria-hidden', 'true');
        titleDiv.appendChild(icon);
        titleDiv.appendChild(document.createTextNode(` ${dep.extension.name} `));

        const badge = document.createElement('span');
        badge.className = `risk-badge ${level}`;
        badge.textContent = `${level} risk`;
        badge.appendChild(createTooltip(`Security risk level: ${level}. This indicates the potential security or privacy danger posed by this extension.`));
        titleDiv.appendChild(badge);
        header.appendChild(titleDiv);

        const reason = document.createElement('p');
        reason.className = 'issue-description';
        const reasonLabel = document.createElement('strong');
        reasonLabel.textContent = 'Why it\'s flagged: ';
        reason.appendChild(reasonLabel);
        reason.appendChild(document.createTextNode(dep.reason));
        header.appendChild(reason);

        const rec = document.createElement('div');
        rec.className = 'recommended-action';
        const recStrong = document.createElement('strong');
        recStrong.textContent = 'What to do: ';
        rec.appendChild(recStrong);
        rec.appendChild(document.createTextNode(dep.recommended_action));
        header.appendChild(rec);

        if (dep.alternatives?.length > 0) {
            const altDiv = document.createElement('div');
            altDiv.className = 'alternatives-list';
            const altLabel = document.createElement('strong');
            altLabel.textContent = 'Suggested alternatives: ';
            altDiv.appendChild(altLabel);

            dep.alternatives.forEach((alt, i) => {
                const a = document.createElement('a');
                a.href   = alt.url;
                a.target = '_blank';
                a.rel    = 'noopener noreferrer';
                a.textContent = alt.name;
                altDiv.appendChild(a);
                if (i < dep.alternatives.length - 1) altDiv.appendChild(document.createTextNode(', '));
            });

            header.appendChild(altDiv);
        }

        if (dep.source_url) {
            header.appendChild(buildSourceLink(dep.source_url));
        }

        card.appendChild(header);
        card.appendChild(createExtensionItem(dep.extension, 'deprecated'));
        return card;
    };

    const buildSourceLink = (url) => {
        const wrap = document.createElement('div');
        wrap.style.marginTop = '10px';
        const a = document.createElement('a');
        a.href   = url;
        a.target = '_blank';
        a.rel    = 'noopener noreferrer';
        a.className = 'source-link';
        a.setAttribute('aria-label', 'Learn more about this issue (opens in new tab)');

        const icon = document.createElement('span');
        icon.className = 'icon icon-info';
        icon.setAttribute('aria-hidden', 'true');
        a.appendChild(icon);
        a.appendChild(document.createTextNode(' Learn more'));
        wrap.appendChild(a);
        return wrap;
    };

    const createResultsGroup = (items = []) => {
        const group = document.createElement('div');
        group.className = 'results-group';
        items.forEach(item => group.appendChild(item));
        return group;
    };

    const createExtensionItem = (ext, type) => {
        const item    = document.createElement('div');
        item.className = 'extension-item';

        const iconUrl = ext.icons?.sort((a, b) => b.size - a.size)[0]?.url || GENERIC_EXTENSION_ICON;

        const img = document.createElement('img');
        img.src    = iconUrl;
        img.alt    = '';
        img.className = 'extension-icon';
        img.setAttribute('aria-hidden', 'true');
        img.onerror = function () { this.onerror = null; this.src = GENERIC_EXTENSION_ICON; };
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
        dot.className = `extension-status-dot ${ext.enabled ? 'enabled' : 'disabled'}`;
        dot.setAttribute('aria-hidden', 'true');
        status.appendChild(dot);
        status.appendChild(document.createTextNode(ext.enabled ? 'Enabled' : 'Disabled'));
        info.appendChild(status);

        const meta = document.createElement('div');
        meta.className = 'extension-meta';

        const version = document.createElement('span');
        version.className = 'version';
        version.setAttribute('aria-label', `Version ${ext.version}`);
        version.textContent = ext.version;
        meta.appendChild(version);

        const sep = document.createTextNode(' · ');
        meta.appendChild(sep);

        const idSpan = document.createElement('span');
        idSpan.className = 'id';
        idSpan.setAttribute('aria-label', `Extension ID: ${ext.id}`);
        idSpan.title = ext.id;
        // Show truncated ID for readability
        idSpan.textContent = ext.id.length > 16 ? `${ext.id.slice(0, 8)}…` : ext.id;
        meta.appendChild(idSpan);

        info.appendChild(meta);
        item.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'extension-actions';

        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'btn';
        detailsBtn.dataset.action  = 'details';
        detailsBtn.dataset.id      = ext.id;
        detailsBtn.setAttribute('aria-label', `Open ${ext.name} in Chrome Extensions`);
        detailsBtn.textContent = 'Details';
        actions.appendChild(detailsBtn);

        if (type === 'conflict' || type === 'deprecated') {
            const toggleBtn = document.createElement('button');
            toggleBtn.className  = 'btn tertiary';
            toggleBtn.dataset.action  = 'toggle';
            toggleBtn.dataset.id      = ext.id;
            toggleBtn.dataset.enabled = String(ext.enabled);
            toggleBtn.setAttribute('aria-label', `${ext.enabled ? 'Disable' : 'Enable'} ${ext.name}`);
            toggleBtn.setAttribute('aria-pressed', String(ext.enabled));
            toggleBtn.textContent = ext.enabled ? 'Disable' : 'Enable';
            actions.appendChild(toggleBtn);

            const ignoreBtn = document.createElement('button');
            ignoreBtn.className  = 'btn tertiary';
            ignoreBtn.dataset.action  = 'ignore';
            ignoreBtn.dataset.id      = ext.id;
            ignoreBtn.dataset.name    = ext.name;
            ignoreBtn.setAttribute('aria-label', `Ignore ${ext.name} in future scans`);
            ignoreBtn.textContent = 'Ignore';
            actions.appendChild(ignoreBtn);

        } else if (type === 'ignored') {
            const unignoreBtn = document.createElement('button');
            unignoreBtn.className  = 'btn tertiary';
            unignoreBtn.dataset.action  = 'unignore';
            unignoreBtn.dataset.id      = ext.id;
            unignoreBtn.dataset.name    = ext.name;
            unignoreBtn.setAttribute('aria-label', `Stop ignoring ${ext.name}`);
            unignoreBtn.textContent = 'Un-ignore';
            actions.appendChild(unignoreBtn);
        }

        item.appendChild(actions);
        return item;
    };

    const createPlaceholder = (iconClass, title, text) => {
        const el = document.createElement('div');
        el.className = 'placeholder';

        const icon = document.createElement('span');
        icon.className = `icon ${iconClass}`;
        icon.setAttribute('aria-hidden', 'true');
        el.appendChild(icon);

        const h = document.createElement('div');
        h.className   = 'placeholder-title';
        h.textContent = title;
        el.appendChild(h);

        const p = document.createElement('p');
        p.className   = 'placeholder-text';
        p.textContent = text;
        el.appendChild(p);

        return el;
    };

    const renderErrorPlaceholder = (title, text) => {
        clearResults();
        resultsDiv.appendChild(createPlaceholder('icon-error', title, text));
    };

    const createTooltip = (text) => {
        const id = `tt-${Math.random().toString(36).slice(2, 9)}`;

        const trigger = document.createElement('span');
        trigger.className = 'tooltip-trigger';
        trigger.setAttribute('role', 'button');
        trigger.setAttribute('tabindex', '0');
        trigger.setAttribute('aria-describedby', id);
        trigger.setAttribute('aria-label', 'More information');

        const icon = document.createElement('span');
        icon.className = 'icon icon-help';
        icon.setAttribute('aria-hidden', 'true');
        trigger.appendChild(icon);

        const content = document.createElement('span');
        content.id        = id;
        content.className = 'tooltip-content';
        content.setAttribute('role', 'tooltip');
        content.textContent = text;
        trigger.appendChild(content);

        return trigger;
    };


    // =========================================================================
    // FOOTER: VERSION INFO & LAST SCAN TIME
    // =========================================================================
    const displayLastScanTime = async () => {
        const history  = await StorageManager.getScanHistory();
        const metaText = headerMetaDiv.querySelector('.meta-text');

        if (history.length > 0) {
            const last = history[0];
            metaText.textContent = `Last scanned ${formatRelativeTime(last.timestamp)}`;
            headerMetaDiv.classList.add('clickable');
            headerMetaDiv.setAttribute('tabindex', '0');
            headerMetaDiv.title = 'View scan history';
            headerMetaDiv.setAttribute('aria-label', `Last scanned ${formatRelativeTime(last.timestamp)}. Click to view history.`);
        } else {
            metaText.textContent = 'No previous scans found';
            headerMetaDiv.classList.remove('clickable');
            headerMetaDiv.setAttribute('tabindex', '-1');
            headerMetaDiv.title = '';
            headerMetaDiv.setAttribute('aria-label', 'No previous scans');
        }
    };

    const displayDataVersionInfo = (config) => {
        if (!config) { footer.classList.remove('visible'); return; }

        while (footer.firstChild) footer.removeChild(footer.firstChild);

        if (config.version) {
            footer.appendChild(document.createTextNode(`Data v${config.version}`));
        }
        if (config.last_updated) {
            footer.appendChild(document.createTextNode(` · Updated ${new Date(config.last_updated).toLocaleDateString()}`));
        }

        footer.appendChild(document.createTextNode(' · '));

        const link = document.createElement('a');
        link.href   = 'https://github.com/modcoretech/api/issues';
        link.target = '_blank';
        link.rel    = 'noopener noreferrer';
        link.textContent = 'Report an Issue';
        footer.appendChild(link);

        footer.classList.add('visible');
    };


    // =========================================================================
    // EVENT: EXTENSION ACTION CLICKS (delegated)
    // =========================================================================
    const handleActionClick = async (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button || button.disabled) return;

        const { action, id, name, enabled } = button.dataset;

        if (action === 'ignore') {
            const ok = await showConfirmationModal(
                'Ignore Extension?',
                `"${name}" will no longer appear in scans, even if it conflicts or is deprecated.`
            );
            if (!ok) return;
        }

        setButtonsDisabled(true);
        try {
            switch (action) {
                case 'toggle':
                    await chrome.management.setEnabled(id, enabled !== 'true');
                    await runScan();
                    break;
                case 'ignore':
                    await saveIgnoredExtension(id);
                    await runScan();
                    break;
                case 'unignore':
                    await removeIgnoredExtension(id);
                    await runScan();
                    break;
                case 'details':
                    chrome.tabs.create({ url: `chrome://extensions/?id=${id}` });
                    break;
            }
        } catch (err) {
            console.error(`Action '${action}' failed:`, err);
            renderErrorPlaceholder('Action Failed', 'Could not complete the action. Please try again or manage the extension manually.');
            showToast('Action failed', 'error');
        } finally {
            if (action !== 'details') {
                setButtonsDisabled(false);
            } else {
                setTimeout(() => setButtonsDisabled(false), 500);
            }
        }
    };


    // =========================================================================
    // TOOLTIP EVENTS (delegated)
    // =========================================================================
    document.addEventListener('mouseover', e => {
        const trigger = e.target.closest('.tooltip-trigger');
        if (!trigger) return;
        const content = trigger.querySelector('.tooltip-content');
        if (content && activeTooltip !== content) {
            hideTooltip(activeTooltip);
            activeTooltip = content;
            positionTooltip(trigger, content);
        }
    });

    document.addEventListener('mouseout', e => {
        if (e.target.closest('.tooltip-trigger') && activeTooltip) {
            hideTooltip(activeTooltip);
            activeTooltip = null;
        }
    });

    const hideActiveTooltip = () => { if (activeTooltip) { hideTooltip(activeTooltip); activeTooltip = null; } };
    window.addEventListener('scroll', hideActiveTooltip, true);
    window.addEventListener('resize', hideActiveTooltip);


    // =========================================================================
    // GLOBAL KEYBOARD & CLICK
    // =========================================================================
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('.modal-overlay.visible').forEach(m => closeModal(m));
        if (scanHistoryPopover.classList.contains('visible')) closeScanHistoryPopover();
    });

    document.addEventListener('click', e => {
        if (!scanHistoryPopover.classList.contains('visible')) return;
        if (!scanHistoryPopover.contains(e.target) && !headerMetaDiv.contains(e.target)) {
            closeScanHistoryPopover();
        }
    });


    // =========================================================================
    // INITIALISATION
    // =========================================================================
    const initializePage = async () => {
        // Load settings
        const stored = loadSettings();
        currentSettings = { ...currentSettings, ...stored };
        initSettingsUI();

        // Settings modal
        settingsButton.addEventListener('click', () => openModal(settingsModal));
        closeSettingsModal.addEventListener('click', () => closeModal(settingsModal));

        autoScanSetting.addEventListener('change', e => {
            saveSettings({ autoScan: e.target.checked });
            showToast(e.target.checked ? 'Auto-scan enabled' : 'Auto-scan disabled');
        });

        cacheDurationSetting.addEventListener('change', e => {
            saveSettings({ cacheDuration: parseInt(e.target.value, 10) });
            showToast(`Cache duration set to ${e.target.value} hours`);
        });

        refreshCacheButton.addEventListener('click', () => {
            closeModal(settingsModal);
            runScan(true);
        });

        // Scan history popover
        headerMetaDiv.addEventListener('click', () => {
            if (headerMetaDiv.classList.contains('clickable')) toggleHistoryPopover();
        });
        headerMetaDiv.addEventListener('keydown', e => {
            if ((e.key === 'Enter' || e.key === ' ') && headerMetaDiv.classList.contains('clickable')) {
                e.preventDefault();
                toggleHistoryPopover();
            }
        });
        closeHistoryPopover.addEventListener('click', closeScanHistoryPopover);

        // Fix All modal
        confirmFixAllButton.addEventListener('click', executeFixAll);
        cancelFixAllButton.addEventListener('click', () => closeModal(fixAllModal));

        // Main scan
        startScanButton.addEventListener('click', () => runScan(false));
        resultsDiv.addEventListener('click', handleActionClick);

        // Decide startup state
        const cacheData = await chrome.storage.local.get(['cache_timestamp', 'conflictConfig']);
        const ttl       = StorageManager.cacheTTL();
        const cacheValid = cacheData.cache_timestamp
                        && (Date.now() - cacheData.cache_timestamp < ttl)
                        && cacheData.conflictConfig;

        if (cacheValid) {
            initialScanScreen.style.display = 'none';
            await loadResultsFromCache();
        } else if (currentSettings.autoScan) {
            await runScan(false);
        } else {
            initialScanScreen.style.display = 'flex';
            await displayLastScanTime();
            if (cacheData.conflictConfig) displayDataVersionInfo(cacheData.conflictConfig);
        }
    };

    initializePage();
});