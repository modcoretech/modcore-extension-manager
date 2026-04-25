document.addEventListener('DOMContentLoaded', () => {
    // --- Constants & State ---
    const API_URL = 'https://raw.githubusercontent.com/modcoretech/api/main/modcoreEM/extensions.json';
    const DEFAULT_CACHE_TTL_HOURS = 24;
    const IGNORED_EXTENSIONS_KEY = 'ignored_extensions';
    const AUTO_SCAN_KEY = 'auto_scan_enabled';
    const LAST_SCAN_KEY = 'last_scan_timestamp';
    const SCAN_HISTORY_KEY = 'scan_history';
    const SETTINGS_KEY = 'inspect_settings';
    const GENERIC_EXTENSION_ICON = '../../public/icons/svg/info.svg';
    
    let conflictConfig = null;
    let activeTooltip = null;
    let currentScanResults = null;
    let lastFocusedElement = null;
    let currentSettings = {
        autoScan: false,
        showResolved: false,
        cacheDuration: 24,
        ...loadSettings()
    };

    // --- DOM Elements ---
    const resultsDiv = document.getElementById('results');
    const loadingSpinner = document.getElementById('loading-spinner');
    const footer = document.getElementById('footer');
    const liveRegion = document.getElementById('liveRegion');
    const toastContainer = document.getElementById('toastContainer');
    
    // Header
    const headerMetaDiv = document.getElementById('header-meta');
    
    // Initial Screen
    const initialScanScreen = document.getElementById('initial-scan-screen');
    const startScanButton = document.getElementById('startScanButton');

    // Modals
    const confirmationModal = document.getElementById('confirmationModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');
    const confirmButton = document.getElementById('confirmButton');
    const cancelButton = document.getElementById('cancelButton');

    // Scan History Popover
    const scanHistoryPopover = document.getElementById('scanHistoryPopover');
    const scanHistoryList = document.getElementById('scanHistoryList');
    const closeHistoryPopover = document.getElementById('closeHistoryPopover');

    // Settings Modal
    const settingsModal = document.getElementById('settingsModal');
    const settingsButton = document.getElementById('settingsButton');
    const closeSettingsModal = document.getElementById('closeSettingsModal');
    const autoScanSetting = document.getElementById('autoScanSetting');
    const showResolvedSetting = document.getElementById('showResolvedSetting');
    const cacheDurationSetting = document.getElementById('cacheDurationSetting');
    const refreshCacheButton = document.getElementById('refreshCacheButton');

    // Fix All Modal
    const fixAllModal = document.getElementById('fixAllModal');
    const fixAllTitle = document.getElementById('fixAllTitle');
    const fixAllMessage = document.getElementById('fixAllMessage');
    const fixAllSummary = document.getElementById('fixAllSummary');
    const confirmFixAllButton = document.getElementById('confirmFixAllButton');
    const cancelFixAllButton = document.getElementById('cancelFixAllButton');

    // --- Helpers ---
    const formatRelativeTime = (timestamp) => {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 10) return 'Just now';
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}d ago`;
        return new Date(timestamp).toLocaleDateString();
    };

    const announce = (message, priority = 'polite') => {
        liveRegion.setAttribute('aria-live', priority);
        // Small delay to ensure screen readers pick up the change
        requestAnimationFrame(() => {
            liveRegion.textContent = message;
            setTimeout(() => { liveRegion.textContent = ''; }, 1000);
        });
    };

    const showToast = (message, type = 'info') => {
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    };

    const trapFocus = (element) => {
        const focusables = element.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
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
        // Store handler to remove later if needed; for now we rely on modal close
        element._focusTrapHandler = handler;
    };

    const openModal = (modal, returnFocus = true) => {
        if (returnFocus) lastFocusedElement = document.activeElement;
        modal.classList.add('visible');
        const focusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
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

    // --- Settings Management ---
    function loadSettings() {
        try {
            const stored = localStorage.getItem(SETTINGS_KEY);
            return stored ? JSON.parse(stored) : {};
        } catch {
            return {};
        }
    }

    async function saveSettings(settings) {
        currentSettings = { ...currentSettings, ...settings };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));
        await chrome.storage.local.set({ [AUTO_SCAN_KEY]: currentSettings.autoScan });
    }

    function initSettingsUI() {
        autoScanSetting.checked = currentSettings.autoScan;
        showResolvedSetting.checked = currentSettings.showResolved;
        cacheDurationSetting.value = String(currentSettings.cacheDuration);
    }

    // --- Enhanced Storage Management ---
    const StorageManager = {
        async getCacheTTL() {
            return (currentSettings.cacheDuration || DEFAULT_CACHE_TTL_HOURS) * 3600 * 1000;
        },

        async storeScanResults(results, hasIssues) {
            const timestamp = Date.now();
            await chrome.storage.local.set({ [LAST_SCAN_KEY]: timestamp });
            await this.addToHistory(results, timestamp, hasIssues);
            await this.cleanupHistory();
        },

        async addToHistory(results, timestamp, hasIssues) {
            const history = await this.getScanHistory();
            const entry = {
                timestamp,
                status: hasIssues ? 'issues_found' : 'clean',
                conflictCount: results.conflicts?.length || 0,
                deprecatedCount: results.deprecated?.length || 0,
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                summary: this.buildSummary(results)
            };

            const updatedHistory = [entry, ...history].slice(0, 10);
            await chrome.storage.local.set({ [SCAN_HISTORY_KEY]: updatedHistory });
        },

        buildSummary(results) {
            const names = [];
            results.conflicts?.forEach(c => names.push(c.name));
            results.deprecated?.forEach(d => names.push(d.extension.name));
            if (names.length === 0) return null;
            return names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2} more` : '');
        },

        async getScanHistory() {
            const data = await chrome.storage.local.get(SCAN_HISTORY_KEY);
            return data[SCAN_HISTORY_KEY] || [];
        },

        async cleanupHistory() {
            let history = await this.getScanHistory();
            const now = Date.now();
            const oneDay = 24 * 60 * 60 * 1000;
            
            let cleanScanKept = false;
            history = history.filter(entry => {
                const hasIssues = entry.conflictCount > 0 || entry.deprecatedCount > 0;
                if (hasIssues) return true;
                if (!cleanScanKept && (now - entry.timestamp) < oneDay) {
                    cleanScanKept = true;
                    return true;
                }
                return false;
            }).slice(0, 10);
            
            await chrome.storage.local.set({ [SCAN_HISTORY_KEY]: history });
        }
    };

    // --- UI Update Functions ---
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
        document.querySelectorAll('button, select, input').forEach(el => {
            if (!el.closest('.modal-overlay') && !el.closest('.popover')) {
                el.disabled = disabled;
            }
        });
    };

    // --- Custom Confirmation Modal Logic ---
    const showConfirmationModal = (title, message) => {
        modalTitle.textContent = title;
        modalMessage.textContent = message;
        openModal(confirmationModal);
        return new Promise((resolve) => {
            const handleConfirm = () => {
                closeModal(confirmationModal);
                resolve(true);
            };
            const handleCancel = () => {
                closeModal(confirmationModal);
                resolve(false);
            };
            confirmButton.addEventListener('click', handleConfirm, { once: true });
            cancelButton.addEventListener('click', handleCancel, { once: true });
        });
    };

    // --- Tooltip Positioning Logic ---
    const positionTooltip = (tooltipTrigger, tooltipContent) => {
        const triggerRect = tooltipTrigger.getBoundingClientRect();
        const contentRect = tooltipContent.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        
        let top = triggerRect.top - contentRect.height - 10;
        let left = triggerRect.left + (triggerRect.width / 2) - (contentRect.width / 2);

        if (left < 10) left = 10;
        if (left + contentRect.width > viewportWidth - 10) left = viewportWidth - contentRect.width - 10;
        if (top < 10) top = triggerRect.bottom + 10;

        tooltipContent.style.top = `${top}px`;
        tooltipContent.style.left = `${left}px`;
        tooltipContent.style.opacity = '1';
        tooltipContent.style.visibility = 'visible';
    };

    const hideTooltip = (tooltipContent) => {
        if (tooltipContent) {
            tooltipContent.style.opacity = '0';
            tooltipContent.style.visibility = 'hidden';
        }
    };

    // --- Data Fetching & Management ---
    const getConflictConfig = async (forceRefresh) => {
        const cachedData = await chrome.storage.local.get(['conflictConfig', 'cache_timestamp']);
        const cachedConfig = cachedData.conflictConfig;
        const cachedTime = cachedData.cache_timestamp;
        const cacheTTL = await StorageManager.getCacheTTL();

        if (!forceRefresh && cachedConfig && (Date.now() - cachedTime < cacheTTL)) {
            conflictConfig = cachedConfig;
            return conflictConfig;
        }

        try {
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error(`API request failed with status: ${response.status}`);
            
            const config = await response.json();
            await chrome.storage.local.set({ conflictConfig: config, cache_timestamp: Date.now() });
            conflictConfig = config;
            return config;
        } catch (error) {
            console.error("Failed to fetch config:", error);
            if (cachedConfig) {
                conflictConfig = cachedConfig;
                return cachedConfig;
            }
            throw error;
        }
    };
    
    const loadIgnoredExtensions = async () => new Set((await chrome.storage.local.get(IGNORED_EXTENSIONS_KEY))[IGNORED_EXTENSIONS_KEY] || []);
    
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

    // --- Core Logic ---
    const findConflicts = (installed, categories, ignored) => {
        return categories.map(cat => {
            const conflictingInstalled = installed.filter(ext => cat.extension_ids.includes(ext.id) && ext.enabled && !ignored.has(ext.id));
            return conflictingInstalled.length >= 2 ? { ...cat, extensions: conflictingInstalled } : null;
        }).filter(Boolean);
    };

    const findDeprecated = (installed, deprecatedList, ignored) => {
        const deprecatedMap = new Map(deprecatedList.map(dep => [dep.id, dep]));
        return installed.map(ext => {
            if (deprecatedMap.has(ext.id) && !ignored.has(ext.id)) {
                return { extension: ext, ...deprecatedMap.get(ext.id) };
            }
            return null;
        }).filter(Boolean);
    };

    const clearResults = () => {
        Array.from(resultsDiv.children).forEach(child => {
            if (child !== initialScanScreen && child !== loadingSpinner) {
                resultsDiv.removeChild(child);
            }
        });
    };

    const runScan = async (forceRefresh = false) => {
        showSpinner();
        setButtonsDisabled(true);
        initialScanScreen.style.display = 'none';
        clearResults();

        announce('Scanning extensions. Please wait.', 'polite');

        try {
            const [config, installedExtensions, ignoredExtensions] = await Promise.all([
                getConflictConfig(forceRefresh),
                chrome.management.getAll(),
                loadIgnoredExtensions()
            ]);

            const conflicts = findConflicts(installedExtensions, config.conflict_categories, ignoredExtensions);
            const deprecated = findDeprecated(installedExtensions, config.deprecated_extensions, ignoredExtensions);

            currentScanResults = { conflicts, deprecated, allInstalled: installedExtensions, ignored: ignoredExtensions };
            
            const hasIssues = conflicts.length > 0 || deprecated.length > 0;
            await StorageManager.storeScanResults(currentScanResults, hasIssues);

            renderResults(conflicts, deprecated, installedExtensions, ignoredExtensions);
            displayDataVersionInfo(config);
            displayLastScanTime();

            if (hasIssues) {
                announce(`Scan complete. ${conflicts.length} conflict groups and ${deprecated.length} deprecated extensions found.`, 'assertive');
                showToast(`Found ${conflicts.length + deprecated.length} issue${conflicts.length + deprecated.length > 1 ? 's' : ''}`, 'warning');
            } else {
                announce('Scan complete. No issues found.', 'polite');
                showToast('No issues found', 'success');
            }

        } catch (error) {
            console.error("Error during scan:", error);
            let title = "An Error Occurred";
            let message = "Something went wrong. Please try again.";
            if (error.message.includes('API request failed')) {
                title = "Could Not Fetch Data";
                message = `The server returned an error (${error.message.split(': ')[1]}). You can try again or use the Refresh Data option in Settings.`;
            } else if (error.message.includes('Failed to fetch')) {
                 title = "Network Error";
                 message = "Could not connect to the data server. Please check your internet connection.";
            } else if (!conflictConfig) {
                 title = "No Data Available";
                 message = "Could not fetch conflict data and no cached version is available. An internet connection is required for the first scan.";
            }
            renderErrorPlaceholder(title, message);
            announce(`Error: ${title}. ${message}`, 'assertive');
        } finally {
            hideSpinner();
            setButtonsDisabled(false);
        }
    };
    
    // --- Fix All Functionality ---
    const showFixAllModal = async () => {
        if (!currentScanResults) return;
        
        const { conflicts, deprecated } = currentScanResults;
        const totalIssues = conflicts.length + deprecated.length;
        if (totalIssues === 0) return;

        const hasCritical = conflicts.some(c => c.conflict_level === 'critical') || 
                            deprecated.some(d => d.security_risk_level === 'critical');

        fixAllTitle.textContent = hasCritical ? 'Fix Critical Issues?' : 'Fix All Issues?';
        fixAllMessage.textContent = hasCritical 
            ? 'Critical-risk extensions were detected. Review the actions below before confirming. Disabling them is strongly recommended.'
            : 'Review the actions below before confirming. This will disable conflicting extensions (keeping one per group) and disable all deprecated extensions.';

        // Clear previous content safely
        while (fixAllSummary.firstChild) {
            fixAllSummary.removeChild(fixAllSummary.firstChild);
        }

        if (conflicts.length > 0) {
            const conflictSection = document.createElement('div');
            conflictSection.className = 'fix-all-section';
            
            const conflictTitle = document.createElement('div');
            conflictTitle.className = 'fix-all-section-title';
            conflictTitle.textContent = `Conflicting Extensions (${conflicts.length} group${conflicts.length > 1 ? 's' : ''})`;
            conflictSection.appendChild(conflictTitle);
            
            conflicts.forEach(conflict => {
                const group = document.createElement('div');
                group.className = 'fix-all-group';
                
                const groupName = document.createElement('div');
                groupName.className = 'fix-all-group-name';
                groupName.textContent = conflict.name;
                group.appendChild(groupName);
                
                const extensionsToDisable = conflict.extensions.slice(1);
                if (extensionsToDisable.length > 0) {
                    extensionsToDisable.forEach(ext => {
                        const item = document.createElement('div');
                        item.className = 'fix-all-item';
                        
                        const icon = document.createElement('span');
                        icon.className = 'icon icon-warning';
                        icon.setAttribute('aria-hidden', 'true');
                        
                        const text = document.createElement('span');
                        text.textContent = `Disable ${ext.name}`;
                        
                        item.appendChild(icon);
                        item.appendChild(text);
                        group.appendChild(item);
                    });
                } else {
                    const item = document.createElement('div');
                    item.className = 'fix-all-item fix-all-item--info';
                    item.textContent = 'Only one extension active — nothing to disable';
                    group.appendChild(item);
                }
                
                conflictSection.appendChild(group);
            });
            
            fixAllSummary.appendChild(conflictSection);
        }

        if (deprecated.length > 0) {
            const deprecatedSection = document.createElement('div');
            deprecatedSection.className = 'fix-all-section';
            
            const deprecatedTitle = document.createElement('div');
            deprecatedTitle.className = 'fix-all-section-title';
            deprecatedTitle.textContent = `Deprecated Extensions (${deprecated.length})`;
            deprecatedSection.appendChild(deprecatedTitle);
            
            deprecated.forEach(dep => {
                const item = document.createElement('div');
                item.className = 'fix-all-item';
                
                const icon = document.createElement('span');
                icon.className = 'icon icon-error';
                icon.setAttribute('aria-hidden', 'true');
                
                const text = document.createElement('span');
                text.textContent = `Disable ${dep.extension.name}`;
                
                item.appendChild(icon);
                item.appendChild(text);
                deprecatedSection.appendChild(item);
            });
            
            fixAllSummary.appendChild(deprecatedSection);
        }

        openModal(fixAllModal);
    };

    const executeFixAll = async () => {
        closeModal(fixAllModal);
        showSpinner();
        setButtonsDisabled(true);
        announce('Fixing all issues. Disabling extensions.', 'polite');

        try {
            const { conflicts, deprecated } = currentScanResults;
            const promises = [];

            conflicts.forEach(conflict => {
                const extensionsToDisable = conflict.extensions.slice(1);
                extensionsToDisable.forEach(ext => {
                    promises.push(chrome.management.setEnabled(ext.id, false));
                });
            });

            deprecated.forEach(dep => {
                promises.push(chrome.management.setEnabled(dep.extension.id, false));
            });

            await Promise.all(promises);
            
            showToast('All issues fixed successfully', 'success');
            announce('All issues fixed. Re-scanning to reflect changes.', 'polite');
            
            await runScan(false);
            
        } catch (error) {
            console.error("Fix All failed:", error);
            renderErrorPlaceholder("Fix All Failed", "Some extensions could not be disabled. Please try again manually.");
            announce('Fix All failed. Some extensions could not be disabled.', 'assertive');
            showToast('Fix All failed', 'error');
        } finally {
            hideSpinner();
            setButtonsDisabled(false);
        }
    };

    // --- Scan History Popover ---
    const toggleHistoryPopover = () => {
        const isVisible = scanHistoryPopover.classList.contains('visible');
        if (isVisible) {
            scanHistoryPopover.classList.remove('visible');
            headerMetaDiv.setAttribute('aria-expanded', 'false');
        } else {
            renderScanHistory();
            scanHistoryPopover.classList.add('visible');
            headerMetaDiv.setAttribute('aria-expanded', 'true');
        }
    };

    const showHistoryDetail = (entry, itemElement) => {
        // Remove any existing detail views
        document.querySelectorAll('.scan-history-detail').forEach(el => el.remove());
        
        const detail = document.createElement('div');
        detail.className = 'scan-history-detail';
        
        const date = document.createElement('div');
        date.className = 'scan-history-detail-date';
        date.textContent = new Date(entry.timestamp).toLocaleString();
        detail.appendChild(date);
        
        if (entry.conflictCount > 0) {
            const conflicts = document.createElement('div');
            conflicts.className = 'scan-history-detail-row';
            const strong = document.createElement('strong');
            strong.textContent = 'Conflicts: ';
            conflicts.appendChild(strong);
            conflicts.appendChild(document.createTextNode(`${entry.conflictCount} group${entry.conflictCount > 1 ? 's' : ''} found`));
            detail.appendChild(conflicts);
        }
        
        if (entry.deprecatedCount > 0) {
            const deprecated = document.createElement('div');
            deprecated.className = 'scan-history-detail-row';
            const strong = document.createElement('strong');
            strong.textContent = 'Deprecated: ';
            deprecated.appendChild(strong);
            deprecated.appendChild(document.createTextNode(`${entry.deprecatedCount} extension${entry.deprecatedCount > 1 ? 's' : ''} found`));
            detail.appendChild(deprecated);
        }
        
        if (!entry.conflictCount && !entry.deprecatedCount) {
            const clean = document.createElement('div');
            clean.className = 'scan-history-detail-row';
            clean.textContent = 'No issues were found in this scan.';
            detail.appendChild(clean);
        }
        
        itemElement.insertAdjacentElement('afterend', detail);
    };

    const renderScanHistory = async () => {
        const history = await StorageManager.getScanHistory();
        
        while (scanHistoryList.firstChild) {
            scanHistoryList.removeChild(scanHistoryList.firstChild);
        }

        if (history.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'No scan history available';
            scanHistoryList.appendChild(emptyState);
            return;
        }

        history.forEach((entry) => {
            const item = document.createElement('div');
            item.className = 'scan-history-item';
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');
            item.setAttribute('aria-label', `Scan from ${formatRelativeTime(entry.timestamp)}. ${entry.summary || 'No issues found'}`);
            
            const hasIssues = entry.conflictCount > 0 || entry.deprecatedCount > 0;
            const iconWrapper = document.createElement('div');
            iconWrapper.className = `scan-history-icon ${hasIssues ? 'warning' : 'success'}`;
            
            const icon = document.createElement('span');
            icon.className = `icon ${hasIssues ? 'icon-warning' : 'icon-check'}`;
            icon.setAttribute('aria-hidden', 'true');
            iconWrapper.appendChild(icon);
            
            const info = document.createElement('div');
            info.className = 'scan-history-info';
            
            const time = document.createElement('div');
            time.className = 'scan-history-time';
            time.textContent = formatRelativeTime(entry.timestamp);
            time.setAttribute('title', new Date(entry.timestamp).toLocaleString());
            
            const status = document.createElement('div');
            status.className = 'scan-history-status';
            status.textContent = entry.summary || 'No issues found';
            
            info.appendChild(time);
            info.appendChild(status);
            
            const counts = document.createElement('div');
            counts.className = 'scan-history-counts';
            if (entry.conflictCount > 0) {
                const badge = document.createElement('span');
                badge.className = 'scan-history-badge scan-history-badge--conflict';
                badge.textContent = `${entry.conflictCount} conflict${entry.conflictCount > 1 ? 's' : ''}`;
                counts.appendChild(badge);
            }
            if (entry.deprecatedCount > 0) {
                const badge = document.createElement('span');
                badge.className = 'scan-history-badge scan-history-badge--deprecated';
                badge.textContent = `${entry.deprecatedCount} deprecated`;
                counts.appendChild(badge);
            }
            if (!hasIssues) {
                const badge = document.createElement('span');
                badge.className = 'scan-history-badge scan-history-badge--clean';
                badge.textContent = 'Clean';
                counts.appendChild(badge);
            }
            
            item.appendChild(iconWrapper);
            item.appendChild(info);
            item.appendChild(counts);
            
            let detailOpen = false;
            const toggleDetail = () => {
                detailOpen = !detailOpen;
                if (detailOpen) {
                    showHistoryDetail(entry, item);
                } else {
                    const existing = item.parentNode.querySelector('.scan-history-detail');
                    if (existing) existing.remove();
                }
            };
            
            item.addEventListener('click', toggleDetail);
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleDetail();
                }
            });
            
            scanHistoryList.appendChild(item);
        });
    };

    // --- Rendering Functions ---
    const renderResults = (conflicts, deprecated, allInstalled, ignoredSet) => {
        clearResults();

        const hasIssues = conflicts.length > 0 || deprecated.length > 0;
        const hasIgnored = ignoredSet.size > 0;

        if (!hasIssues && !hasIgnored) {
            resultsDiv.appendChild(createPlaceholder('icon-check', 'All Clear!', 'No conflicts or deprecated extensions were found.'));
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'results-wrapper';
        
        if (conflicts.length > 0) {
            wrapper.appendChild(createCollapsibleSection(
                "Conflicting Extensions", 
                conflicts.map(createConflictCard), 
                true, 
                "Groups of active extensions that can cause issues when used together."
            ));
        }
        
        if (deprecated.length > 0) {
            wrapper.appendChild(createCollapsibleSection(
                "Deprecated or Risky Extensions", 
                deprecated.map(createDeprecatedCard), 
                true, 
                "Extensions that are outdated, no longer maintained, or deemed unsafe, as well as those that have been removed from the web store."
            ));
        }
        
        if (hasIgnored) {
            const installedMap = new Map(allInstalled.map(ext => [ext.id, ext]));
            const ignoredItems = Array.from(ignoredSet).map(id => {
                const extInfo = installedMap.get(id) || { id, name: `Unknown Extension (${id})`, icons: [], version: 'N/A' };
                return createExtensionItem(extInfo, 'ignored');
            });
            wrapper.appendChild(createCollapsibleSection(
                "Ignored Extensions", 
                [createResultsGroup(ignoredItems)], 
                false, 
                "Extensions you have chosen to exclude from scanning. Ignored extensions will not be flagged as conflicts or deprecated, even if they meet the criteria."
            ));
        }

        if (hasIssues) {
            const fixAllContainer = document.createElement('div');
            fixAllContainer.className = 'fix-all-container';
            
            const fixAllBtn = document.createElement('button');
            fixAllBtn.id = 'fixAllButton';
            fixAllBtn.className = 'btn fix-all-btn';
            fixAllBtn.setAttribute('aria-label', `Fix all ${conflicts.length + deprecated.length} issues`);
            
            const icon = document.createElement('span');
            icon.className = 'icon icon-check';
            icon.setAttribute('aria-hidden', 'true');
            
            fixAllBtn.appendChild(icon);
            fixAllBtn.appendChild(document.createTextNode(' Fix All Issues'));
            fixAllBtn.addEventListener('click', showFixAllModal);
            
            fixAllContainer.appendChild(fixAllBtn);
            wrapper.appendChild(fixAllContainer);
        }

        resultsDiv.appendChild(wrapper);
    };

    const createCollapsibleSection = (title, contentElements, startOpen = true, tooltipText = '') => {
        const section = document.createElement('div');
        section.className = 'collapsible-section';

        const header = document.createElement('button');
        header.className = 'collapsible-header';
        header.setAttribute('aria-expanded', startOpen);
        if (startOpen) header.classList.add('active');

        const arrowSpan = document.createElement('span');
        arrowSpan.className = 'arrow icon icon-arrow-right';
        arrowSpan.setAttribute('aria-hidden', 'true');
        header.appendChild(arrowSpan);

        const headerTitleSpan = document.createElement('span');
        headerTitleSpan.className = 'header-title';
        headerTitleSpan.textContent = `${title} (${contentElements.length})`;
        header.appendChild(headerTitleSpan);

        if (tooltipText) {
            header.appendChild(createTooltip(tooltipText));
        }

        const content = document.createElement('div');
        content.className = 'collapsible-content';
        contentElements.forEach(el => content.appendChild(el));

        section.append(header, content);
        header.addEventListener('click', () => {
            header.classList.toggle('active');
            const isActive = header.classList.contains('active');
            header.setAttribute('aria-expanded', isActive);
        });
        return section;
    };
    
    const getRiskIconClass = (level) => {
        switch (level) {
            case 'critical': return 'icon-error';
            case 'high': return 'icon-warning';
            default: return 'icon-info';
        }
    };

    const createConflictCard = (conflict) => {
        const card = createResultsGroup();
        const header = document.createElement('div');
        const level = conflict.conflict_level || 'low';
        header.className = `issue-card-header ${level}`;
        
        const riskTooltipText = `Risk Level: ${level}. This indicates the potential severity of the conflict.`;

        const issueTitleDiv = document.createElement('div');
        issueTitleDiv.className = 'issue-title';
        const iconSpan = document.createElement('span');
        iconSpan.className = `icon ${getRiskIconClass(level)}`;
        iconSpan.setAttribute('aria-hidden', 'true');
        issueTitleDiv.appendChild(iconSpan);
        issueTitleDiv.appendChild(document.createTextNode(` ${conflict.name} `));
        const riskBadgeSpan = document.createElement('span');
        riskBadgeSpan.className = `risk-badge ${level}`;
        riskBadgeSpan.textContent = `${level} `;
        riskBadgeSpan.appendChild(createTooltip(riskTooltipText));
        issueTitleDiv.appendChild(riskBadgeSpan);
        header.appendChild(issueTitleDiv);

        const descriptionParagraph = document.createElement('p');
        descriptionParagraph.className = 'issue-description';
        descriptionParagraph.textContent = conflict.description;
        header.appendChild(descriptionParagraph);

        const recommendationDiv = document.createElement('div');
        recommendationDiv.className = 'recommended-action';
        const recommendationStrong = document.createElement('strong');
        recommendationStrong.textContent = 'Recommendation:';
        recommendationDiv.appendChild(recommendationStrong);
        recommendationDiv.appendChild(document.createTextNode(` ${conflict.recommended_action}`));
        header.appendChild(recommendationDiv);

        card.prepend(header);
        conflict.extensions.forEach(ext => card.appendChild(createExtensionItem(ext, 'conflict')));
        return card;
    };

    const createDeprecatedCard = (dep) => {
        const card = createResultsGroup();
        const header = document.createElement('div');
        const level = dep.security_risk_level || 'low';
        header.className = `issue-card-header ${level}`;
        
        const riskTooltipText = `Security Risk: ${level}. This indicates the potential security or privacy danger.`;

        const issueTitleDiv = document.createElement('div');
        issueTitleDiv.className = 'issue-title';
        const iconSpan = document.createElement('span');
        iconSpan.className = `icon ${getRiskIconClass(level)}`;
        iconSpan.setAttribute('aria-hidden', 'true');
        issueTitleDiv.appendChild(iconSpan);
        issueTitleDiv.appendChild(document.createTextNode(` Deprecated: ${dep.extension.name} `));
        const riskBadgeSpan = document.createElement('span');
        riskBadgeSpan.className = `risk-badge ${level}`;
        riskBadgeSpan.textContent = `${level} Risk `;
        riskBadgeSpan.appendChild(createTooltip(riskTooltipText));
        issueTitleDiv.appendChild(riskBadgeSpan);
        header.appendChild(issueTitleDiv);
        
        const reasonParagraph = document.createElement('p');
        reasonParagraph.className = 'issue-description';
        const reasonStrong = document.createElement('strong');
        reasonStrong.textContent = 'Reason:';
        reasonParagraph.appendChild(reasonStrong);
        reasonParagraph.appendChild(document.createTextNode(` ${dep.reason}`));
        header.appendChild(reasonParagraph);
        
        const recommendationDiv = document.createElement('div');
        recommendationDiv.className = 'recommended-action';
        const recommendationStrong = document.createElement('strong');
        recommendationStrong.textContent = 'Recommendation:';
        recommendationDiv.appendChild(recommendationStrong);
        recommendationDiv.appendChild(document.createTextNode(` ${dep.recommended_action}`));
        header.appendChild(recommendationDiv);
        
        if (dep.alternatives?.length > 0) {
            const alternativesDiv = document.createElement('div');
            alternativesDiv.className = 'alternatives-list';
            const alternativesStrong = document.createElement('strong');
            alternativesStrong.textContent = 'Suggested Alternatives:';
            alternativesDiv.appendChild(alternativesStrong);
            
            dep.alternatives.forEach((alt, index) => {
                const a = document.createElement('a');
                a.href = alt.url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = alt.name;
                alternativesDiv.appendChild(a);
                if (index < dep.alternatives.length - 1) {
                    alternativesDiv.appendChild(document.createTextNode(', '));
                }
            });
            header.appendChild(alternativesDiv);
        }

        card.append(header, createExtensionItem(dep.extension, 'deprecated'));
        return card;
    };

    const createResultsGroup = (items = []) => {
        const group = document.createElement('div');
        group.className = 'results-group';
        items.forEach(item => group.appendChild(item));
        return group;
    };

    const createExtensionItem = (ext, type) => {
        const item = document.createElement('div');
        item.className = 'extension-item';
        const iconUrl = ext.icons?.sort((a, b) => b.size - a.size)[0]?.url || GENERIC_EXTENSION_ICON;

        const img = document.createElement('img');
        img.src = iconUrl;
        img.alt = `Icon for ${ext.name}`;
        img.className = 'extension-icon';
        img.onerror = function() { this.onerror=null;this.src=GENERIC_EXTENSION_ICON; };
        item.appendChild(img);

        const infoDiv = document.createElement('div');
        infoDiv.className = 'extension-info';
        const nameDiv = document.createElement('div');
        nameDiv.className = 'extension-name';
        nameDiv.textContent = ext.name;
        const metaDiv = document.createElement('div');
        metaDiv.className = 'extension-meta';
        const versionSpan = document.createElement('span');
        versionSpan.className = 'version';
        versionSpan.setAttribute('aria-label', `Version ${ext.version}`);
        versionSpan.textContent = ext.version;
        const idSpan = document.createElement('span');
        idSpan.className = 'id';
        idSpan.setAttribute('aria-label', 'Extension ID');
        idSpan.textContent = ext.id;
        metaDiv.appendChild(versionSpan);
        metaDiv.appendChild(document.createTextNode(' • '));
        metaDiv.appendChild(idSpan);
        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(metaDiv);
        item.appendChild(infoDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'extension-actions';
        
        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'btn';
        detailsBtn.dataset.action = 'details';
        detailsBtn.dataset.id = ext.id;
        detailsBtn.setAttribute('aria-label', `View details for ${ext.name}`);
        detailsBtn.textContent = 'Details';
        actionsDiv.appendChild(detailsBtn);

        if (type === 'conflict' || type === 'deprecated') {
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'btn tertiary';
            toggleBtn.dataset.action = 'toggle';
            toggleBtn.dataset.id = ext.id;
            toggleBtn.dataset.enabled = ext.enabled;
            toggleBtn.setAttribute('aria-label', `${ext.enabled ? 'Disable' : 'Enable'} ${ext.name}`);
            toggleBtn.textContent = ext.enabled ? 'Disable' : 'Enable';
            actionsDiv.appendChild(toggleBtn);
            
            const ignoreBtn = document.createElement('button');
            ignoreBtn.className = 'btn tertiary';
            ignoreBtn.dataset.action = 'ignore';
            ignoreBtn.dataset.id = ext.id;
            ignoreBtn.dataset.name = ext.name;
            ignoreBtn.setAttribute('aria-label', `Ignore ${ext.name}`);
            ignoreBtn.textContent = 'Ignore';
            actionsDiv.appendChild(ignoreBtn);
        } else if (type === 'ignored') {
            const unignoreBtn = document.createElement('button');
            unignoreBtn.className = 'btn tertiary';
            unignoreBtn.dataset.action = 'unignore';
            unignoreBtn.dataset.id = ext.id;
            unignoreBtn.dataset.name = ext.name;
            unignoreBtn.setAttribute('aria-label', `Stop ignoring ${ext.name}`);
            unignoreBtn.textContent = 'Un-ignore';
            actionsDiv.appendChild(unignoreBtn);
        }
        item.appendChild(actionsDiv);
        return item;
    };

    const createPlaceholder = (iconClass, title, text) => {
        const el = document.createElement('div');
        el.className = 'placeholder';
        const iconSpan = document.createElement('span');
        iconSpan.className = `icon ${iconClass}`;
        iconSpan.setAttribute('aria-hidden', 'true');
        el.appendChild(iconSpan);
        const titleDiv = document.createElement('div');
        titleDiv.className = 'placeholder-title';
        titleDiv.textContent = title;
        el.appendChild(titleDiv);
        const textP = document.createElement('p');
        textP.className = 'placeholder-text';
        textP.textContent = text;
        el.appendChild(textP);
        return el;
    };

    const renderErrorPlaceholder = (title, text) => {
        clearResults();
        resultsDiv.appendChild(createPlaceholder('icon-error', title, text));
    };

    const createTooltip = (text, iconClass = 'icon-help') => {
        const tooltipId = `tooltip-${Math.random().toString(36).substring(2, 9)}`;
        
        const trigger = document.createElement('span');
        trigger.className = 'tooltip-trigger';
        trigger.setAttribute('role', 'tooltip');
        trigger.setAttribute('aria-describedby', tooltipId);

        const iconSpan = document.createElement('span');
        iconSpan.className = `icon ${iconClass}`;
        iconSpan.setAttribute('aria-hidden', 'true');
        trigger.appendChild(iconSpan);

        const content = document.createElement('span');
        content.id = tooltipId;
        content.className = 'tooltip-content';
        content.textContent = text;
        trigger.appendChild(content);

        return trigger;
    };
    
    const displayLastScanTime = async () => {
        const history = await StorageManager.getScanHistory();
        const metaText = headerMetaDiv.querySelector('.meta-text');
        
        if (history.length > 0) {
            const lastScan = history[0];
            metaText.textContent = `Last scanned: ${formatRelativeTime(lastScan.timestamp)}`;
            headerMetaDiv.classList.add('clickable');
            headerMetaDiv.title = "Click to view scan history";
        } else {
            metaText.textContent = 'No previous scans found';
            headerMetaDiv.classList.remove('clickable');
            headerMetaDiv.title = "";
        }
    };

    const displayDataVersionInfo = (config) => {
        if (!config) { 
            footer.classList.remove('visible'); 
            return; 
        }
        
        while (footer.firstChild) {
            footer.removeChild(footer.firstChild);
        }
        
        const parts = [];
        if (config.version) parts.push(`Data v${config.version}`);
        if (config.last_updated) parts.push(`Updated: ${new Date(config.last_updated).toLocaleDateString()}`);
        
        if (parts.length > 0) {
            footer.appendChild(document.createTextNode(parts.join(' | ')));
            footer.appendChild(document.createTextNode(' • '));
        }

        const reportLink = document.createElement('a');
        reportLink.href = 'https://github.com/modcoretech/api/issues';
        reportLink.target = '_blank';
        reportLink.rel = 'noopener noreferrer';
        reportLink.textContent = 'Report an Issue';
        footer.appendChild(reportLink);

        footer.classList.add('visible');
    };

    // --- Event Handling ---
    const handleActionClick = async (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button || button.disabled) return;

        const { action, id, name, enabled } = button.dataset;
        
        if (action === 'ignore') {
            const confirmed = await showConfirmationModal("Ignore Extension?", `Are you sure you want to ignore "${name}"? It will no longer appear in scans.`);
            if (!confirmed) return;
        }
        
        setButtonsDisabled(true);
        try {
            switch(action) {
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
        } catch (error) {
            console.error(`Failed to perform action '${action}':`, error);
            renderErrorPlaceholder("Action Failed", `Could not complete the action. Please try again or perform it manually from the extensions page.`);
            showToast('Action failed', 'error');
        } finally {
            if (action !== 'details') {
                 setButtonsDisabled(false);
            } else {
                setTimeout(() => setButtonsDisabled(false), 500);
            }
        }
    };
    
    // --- Tooltip Event Listeners ---
    document.addEventListener('mouseover', e => {
        const trigger = e.target.closest('.tooltip-trigger');
        if (trigger) {
            const tooltipContent = trigger.querySelector('.tooltip-content');
            if (tooltipContent && activeTooltip !== tooltipContent) {
                hideTooltip(activeTooltip);
                activeTooltip = tooltipContent;
                positionTooltip(trigger, tooltipContent);
            }
        }
    });
    document.addEventListener('mouseout', e => {
        if (e.target.closest('.tooltip-trigger') && activeTooltip) {
             hideTooltip(activeTooltip);
             activeTooltip = null;
        }
    });
    const onScrollOrResize = () => activeTooltip && hideTooltip(activeTooltip);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    // --- Global Keyboard & Click Handlers ---
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay.visible, .popover.visible').forEach(el => {
                el.classList.remove('visible');
                if (el._focusTrapHandler) {
                    el.removeEventListener('keydown', el._focusTrapHandler);
                    delete el._focusTrapHandler;
                }
            });
            if (lastFocusedElement && document.contains(lastFocusedElement)) {
                lastFocusedElement.focus();
            }
            headerMetaDiv.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('click', (e) => {
        if (scanHistoryPopover.classList.contains('visible')) {
            if (!scanHistoryPopover.contains(e.target) && !headerMetaDiv.contains(e.target)) {
                scanHistoryPopover.classList.remove('visible');
                headerMetaDiv.setAttribute('aria-expanded', 'false');
            }
        }
    });

    // --- Initialization ---
    const loadResultsFromCache = async () => {
        showSpinner();
        setButtonsDisabled(true);
        try {
            const [cachedData, installedExtensions, ignoredExtensions] = await Promise.all([
                chrome.storage.local.get('conflictConfig'),
                chrome.management.getAll(),
                loadIgnoredExtensions()
            ]);
            
            const config = cachedData.conflictConfig;
            if (!config) throw new Error("Cached config is missing.");
            
            conflictConfig = config;
            const conflicts = findConflicts(installedExtensions, config.conflict_categories, ignoredExtensions);
            const deprecated = findDeprecated(installedExtensions, config.deprecated_extensions, ignoredExtensions);

            currentScanResults = { conflicts, deprecated, allInstalled: installedExtensions, ignored: ignoredExtensions };
            
            renderResults(conflicts, deprecated, installedExtensions, ignoredExtensions);
            displayDataVersionInfo(config);
            displayLastScanTime();

        } catch (error) {
            console.error("Error loading from cache:", error);
            renderErrorPlaceholder("Cache Load Failed", "Could not load results from the cache. Please run a new scan.");
        } finally {
            hideSpinner();
            setButtonsDisabled(false);
        }
    };

    const initializePage = async () => {
        initSettingsUI();
        
        // Settings modal
        settingsButton.addEventListener('click', () => openModal(settingsModal));
        closeSettingsModal.addEventListener('click', () => closeModal(settingsModal));
        
        // Settings change handlers
        autoScanSetting.addEventListener('change', (e) => {
            saveSettings({ autoScan: e.target.checked });
            showToast(e.target.checked ? 'Auto-scan enabled' : 'Auto-scan disabled', 'info');
        });
        
        showResolvedSetting.addEventListener('change', (e) => {
            saveSettings({ showResolved: e.target.checked });
            showToast(e.target.checked ? 'Resolved issues will be shown' : 'Resolved issues hidden', 'info');
        });
        
        cacheDurationSetting.addEventListener('change', (e) => {
            saveSettings({ cacheDuration: parseInt(e.target.value) });
            showToast(`Cache duration set to ${e.target.value} hours`, 'info');
        });
        
        refreshCacheButton.addEventListener('click', () => {
            closeModal(settingsModal);
            runScan(true);
        });
        
        // Scan history popover
        headerMetaDiv.addEventListener('click', () => {
            if (headerMetaDiv.classList.contains('clickable')) {
                toggleHistoryPopover();
            }
        });
        headerMetaDiv.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && headerMetaDiv.classList.contains('clickable')) {
                e.preventDefault();
                toggleHistoryPopover();
            }
        });
        
        closeHistoryPopover.addEventListener('click', () => {
            scanHistoryPopover.classList.remove('visible');
            headerMetaDiv.setAttribute('aria-expanded', 'false');
        });
        
        // Fix All modal
        confirmFixAllButton.addEventListener('click', executeFixAll);
        cancelFixAllButton.addEventListener('click', () => closeModal(fixAllModal));
        
        // Main buttons
        startScanButton.addEventListener('click', () => runScan(false));
        resultsDiv.addEventListener('click', handleActionClick);
        
        // Check cache and auto-scan settings
        const cacheData = await chrome.storage.local.get(['cache_timestamp', 'conflictConfig']);
        const cacheTTL = await StorageManager.getCacheTTL();
        const isCacheValid = cacheData.cache_timestamp && (Date.now() - cacheData.cache_timestamp < cacheTTL) && cacheData.conflictConfig;

        if (isCacheValid) {
            initialScanScreen.style.display = 'none';
            await loadResultsFromCache();
        } else {
            if (currentSettings.autoScan) {
                runScan(false);
            } else {
                initialScanScreen.style.display = 'flex';
                displayLastScanTime();
                if (cacheData.conflictConfig) displayDataVersionInfo(cacheData.conflictConfig);
            }
        }
    };

    initializePage();
});
