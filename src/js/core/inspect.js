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
    
    // Header
    const headerMetaDiv = document.getElementById('header-meta');
    const refreshCacheButton = document.getElementById('refreshCacheButton');
    
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
    const clearDataButton = document.getElementById('clearDataButton');

    // Fix All Modal
    const fixAllModal = document.getElementById('fixAllModal');
    const fixAllTitle = document.getElementById('fixAllTitle');
    const fixAllMessage = document.getElementById('fixAllMessage');
    const fixAllSummary = document.getElementById('fixAllSummary');
    const confirmFixAllButton = document.getElementById('confirmFixAllButton');
    const cancelFixAllButton = document.getElementById('cancelFixAllButton');

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
        
        // Also save auto-scan to chrome storage for compatibility
        await chrome.storage.local.set({ [AUTO_SCAN_KEY]: currentSettings.autoScan });
    }

    function initSettingsUI() {
        autoScanSetting.checked = currentSettings.autoScan;
        showResolvedSetting.checked = currentSettings.showResolved;
        cacheDurationSetting.value = currentSettings.cacheDuration.toString();
    }

    // --- Enhanced Storage Management ---
    const StorageManager = {
        async getCacheTTL() {
            return (currentSettings.cacheDuration || DEFAULT_CACHE_TTL_HOURS) * 3600 * 1000;
        },

        async storeScanResults(results, hasIssues) {
            const timestamp = Date.now();
            const storageData = {
                [LAST_SCAN_KEY]: timestamp
            };

            if (!hasIssues) {
                // Store minimal data when no conflicts found
                storageData.lastScanResult = {
                    status: 'clean',
                    timestamp: timestamp,
                    conflictCount: 0,
                    deprecatedCount: 0
                };
            } else {
                // Store only problematic extension data
                const minimalConflicts = results.conflicts.map(c => ({
                    category_id: c.category_id,
                    name: c.name,
                    conflict_level: c.conflict_level,
                    extension_ids: c.extensions.map(e => e.id)
                }));
                
                const minimalDeprecated = results.deprecated.map(d => ({
                    id: d.extension.id,
                    name: d.extension.name,
                    security_risk_level: d.security_risk_level
                }));

                storageData.lastScanResult = {
                    status: 'issues_found',
                    timestamp: timestamp,
                    conflicts: minimalConflicts,
                    deprecated: minimalDeprecated,
                    conflictCount: results.conflicts.length,
                    deprecatedCount: results.deprecated.length
                };
            }

            await chrome.storage.local.set(storageData);
            await this.addToHistory(storageData.lastScanResult);
        },

        async addToHistory(scanResult) {
            const history = await this.getScanHistory();
            const entry = {
                timestamp: scanResult.timestamp,
                status: scanResult.status,
                conflictCount: scanResult.conflictCount || 0,
                deprecatedCount: scanResult.deprecatedCount || 0,
                id: Date.now().toString(36)
            };

            // Keep only last 5 scans
            const updatedHistory = [entry, ...history].slice(0, 5);
            await chrome.storage.local.set({ [SCAN_HISTORY_KEY]: updatedHistory });
        },

        async getScanHistory() {
            const data = await chrome.storage.local.get(SCAN_HISTORY_KEY);
            return data[SCAN_HISTORY_KEY] || [];
        },

        async clearAllData() {
            await chrome.storage.local.remove([
                'conflictConfig',
                'cache_timestamp',
                LAST_SCAN_KEY,
                SCAN_HISTORY_KEY,
                IGNORED_EXTENSIONS_KEY,
                'lastScanResult'
            ]);
            localStorage.removeItem(SETTINGS_KEY);
        },

        async getMinimalCache() {
            const data = await chrome.storage.local.get(['lastScanResult', 'cache_timestamp']);
            return {
                result: data.lastScanResult,
                timestamp: data.cache_timestamp
            };
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
        const buttons = document.querySelectorAll('button');
        buttons.forEach(btn => btn.disabled = disabled);
    };

    // --- Custom Confirmation Modal Logic ---
    const showConfirmationModal = (title, message) => {
        modalTitle.textContent = title;
        modalMessage.textContent = message;
        confirmationModal.classList.add('visible');
        confirmButton.focus();
        return new Promise((resolve) => {
            const handleConfirm = () => {
                confirmationModal.classList.remove('visible');
                resolve(true);
            };
            const handleCancel = () => {
                confirmationModal.classList.remove('visible');
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
            console.log('Using valid cached API data.');
            conflictConfig = cachedConfig;
            return conflictConfig;
        }

        try {
            console.log(forceRefresh ? 'Forcing refresh of API data.' : 'Cache expired or missing. Fetching new API data.');
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error(`API request failed with status: ${response.status}`);
            
            const config = await response.json();
            await chrome.storage.local.set({ conflictConfig: config, cache_timestamp: Date.now() });
            conflictConfig = config;
            return config;
        } catch (error) {
            console.error("Failed to fetch config:", error);
            if (cachedConfig) {
                console.warn("Using stale cached data as fallback.");
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

    const runScan = async (forceRefresh = false) => {
        showSpinner();
        setButtonsDisabled(true);
        initialScanScreen.style.display = 'none';
        
        // Clear previous results
        while (resultsDiv.firstChild) {
            if (resultsDiv.firstChild !== initialScanScreen && resultsDiv.firstChild !== loadingSpinner) {
                resultsDiv.removeChild(resultsDiv.firstChild);
            } else {
                break;
            }
        }

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

        } catch (error) {
            console.error("Error during scan:", error);
            let title = "An Error Occurred";
            let message = "Something went wrong. Please try again.";
            if (error.message.includes('API request failed')) {
                title = "Could Not Fetch Data";
                message = `The server returned an error (${error.message.split(': ')[1]}). You can try again or use the 'Refresh Data' button.`;
            } else if (error.message.includes('Failed to fetch')) {
                 title = "Network Error";
                 message = "Could not connect to the data server. Please check your internet connection.";
            } else if (!conflictConfig) {
                 title = "No Data Available";
                 message = "Could not fetch conflict data and no cached version is available. An internet connection is required for the first scan.";
            }
            renderErrorPlaceholder(title, message);
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

        // Build summary
        fixAllSummary.innerHTML = '';
        
        if (conflicts.length > 0) {
            const conflictItem = document.createElement('div');
            conflictItem.className = 'fix-all-summary-item';
            conflictItem.innerHTML = `
                <span class="icon icon-warning"></span>
                <span>Disable ${conflicts.length} conflicting extension group${conflicts.length > 1 ? 's' : ''} (keeping 1 per group)</span>
            `;
            fixAllSummary.appendChild(conflictItem);
        }
        
        if (deprecated.length > 0) {
            const deprecatedItem = document.createElement('div');
            deprecatedItem.className = 'fix-all-summary-item';
            deprecatedItem.innerHTML = `
                <span class="icon icon-error"></span>
                <span>Disable ${deprecated.length} deprecated extension${deprecated.length > 1 ? 's' : ''}</span>
            `;
            fixAllSummary.appendChild(deprecatedItem);
        }

        fixAllModal.classList.add('visible');
    };

    const executeFixAll = async () => {
        fixAllModal.classList.remove('visible');
        showSpinner();
        setButtonsDisabled(true);

        try {
            const { conflicts, deprecated } = currentScanResults;
            const promises = [];

            // For each conflict group, disable all but the first extension
            conflicts.forEach(conflict => {
                const extensionsToDisable = conflict.extensions.slice(1);
                extensionsToDisable.forEach(ext => {
                    promises.push(chrome.management.setEnabled(ext.id, false));
                });
            });

            // Disable all deprecated extensions
            deprecated.forEach(dep => {
                promises.push(chrome.management.setEnabled(dep.extension.id, false));
            });

            await Promise.all(promises);
            
            // Re-run scan to reflect changes
            await runScan(false);
            
        } catch (error) {
            console.error("Fix All failed:", error);
            renderErrorPlaceholder("Fix All Failed", "Some extensions could not be disabled. Please try again manually.");
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
        } else {
            renderScanHistory();
            scanHistoryPopover.classList.add('visible');
        }
    };

    const renderScanHistory = async () => {
        const history = await StorageManager.getScanHistory();
        scanHistoryList.innerHTML = '';

        if (history.length === 0) {
            scanHistoryList.innerHTML = '<div class="empty-state">No scan history available</div>';
            return;
        }

        history.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'scan-history-item';
            
            const hasIssues = entry.conflictCount > 0 || entry.deprecatedCount > 0;
            const iconClass = hasIssues ? 'warning' : 'success';
            const iconType = hasIssues ? 'icon-warning' : 'icon-check';
            
            let statusText = 'No issues found';
            if (entry.conflictCount > 0 && entry.deprecatedCount > 0) {
                statusText = `${entry.conflictCount} conflict${entry.conflictCount > 1 ? 's' : ''}, ${entry.deprecatedCount} deprecated`;
            } else if (entry.conflictCount > 0) {
                statusText = `${entry.conflictCount} conflict${entry.conflictCount > 1 ? 's' : ''}`;
            } else if (entry.deprecatedCount > 0) {
                statusText = `${entry.deprecatedCount} deprecated`;
            }

            item.innerHTML = `
                <div class="scan-history-icon ${iconClass}">
                    <span class="icon ${iconType}"></span>
                </div>
                <div class="scan-history-info">
                    <div class="scan-history-time">${new Date(entry.timestamp).toLocaleString()}</div>
                    <div class="scan-history-status">${statusText}</div>
                </div>
            `;
            
            scanHistoryList.appendChild(item);
        });
    };

    // --- Rendering Functions ---
    const renderResults = (conflicts, deprecated, allInstalled, ignoredSet) => {
        // Clear previous results (except initial screen and spinner)
        const children = Array.from(resultsDiv.children);
        children.forEach(child => {
            if (child !== initialScanScreen && child !== loadingSpinner) {
                resultsDiv.removeChild(child);
            }
        });

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

        // Add Fix All button if there are issues
        if (hasIssues) {
            const fixAllContainer = document.createElement('div');
            fixAllContainer.className = 'fix-all-container';
            fixAllContainer.innerHTML = `
                <button id="fixAllButton" class="btn fix-all-btn">
                    <span class="icon icon-check"></span>
                    Fix All Issues
                </button>
            `;
            wrapper.appendChild(fixAllContainer);
            
            // Add event listener after appending to DOM
            setTimeout(() => {
                const fixAllBtn = document.getElementById('fixAllButton');
                if (fixAllBtn) {
                    fixAllBtn.addEventListener('click', showFixAllModal);
                }
            }, 0);
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
            header.setAttribute('aria-expanded', header.classList.contains('active'));
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
            
            const links = dep.alternatives.map(alt => {
                const a = document.createElement('a');
                a.href = alt.url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = alt.name;
                return a;
            });
            
            links.forEach((link, index) => {
                alternativesDiv.appendChild(link);
                if (index < links.length - 1) {
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
        while (resultsDiv.firstChild) {
            if (resultsDiv.firstChild !== initialScanScreen && resultsDiv.firstChild !== loadingSpinner) {
                resultsDiv.removeChild(resultsDiv.firstChild);
            } else {
                break;
            }
        }
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
        const metaText = headerMetaDiv.querySelector('.meta-text') || headerMetaDiv;
        
        if (history.length > 0) {
            const lastScan = history[0];
            metaText.textContent = `Last scanned: ${new Date(lastScan.timestamp).toLocaleString()}`;
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
            const confirmed = await showConfirmationModal( "Ignore Extension?", `Are you sure you want to ignore "${name}"? It will no longer appear in scans.`);
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

    // --- Click Outside Handler for Popover ---
    document.addEventListener('click', (e) => {
        if (scanHistoryPopover.classList.contains('visible')) {
            if (!scanHistoryPopover.contains(e.target) && !headerMetaDiv.contains(e.target)) {
                scanHistoryPopover.classList.remove('visible');
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
        // Initialize settings
        initSettingsUI();
        
        // Settings button
        settingsButton.addEventListener('click', () => {
            settingsModal.classList.add('visible');
        });
        
        closeSettingsModal.addEventListener('click', () => {
            settingsModal.classList.remove('visible');
        });
        
        // Settings change handlers
        autoScanSetting.addEventListener('change', (e) => {
            saveSettings({ autoScan: e.target.checked });
        });
        
        showResolvedSetting.addEventListener('change', (e) => {
            saveSettings({ showResolved: e.target.checked });
        });
        
        cacheDurationSetting.addEventListener('change', (e) => {
            saveSettings({ cacheDuration: parseInt(e.target.value) });
        });
        
        clearDataButton.addEventListener('click', async () => {
            const confirmed = await showConfirmationModal(
                "Clear All Data?", 
                "This will remove all scan history, cached data, and settings. This action cannot be undone."
            );
            if (confirmed) {
                await StorageManager.clearAllData();
                location.reload();
            }
        });
        
        // Scan history popover
        headerMetaDiv.addEventListener('click', () => {
            if (headerMetaDiv.classList.contains('clickable')) {
                toggleHistoryPopover();
            }
        });
        
        closeHistoryPopover.addEventListener('click', () => {
            scanHistoryPopover.classList.remove('visible');
        });
        
        // Fix All modal
        confirmFixAllButton.addEventListener('click', executeFixAll);
        cancelFixAllButton.addEventListener('click', () => {
            fixAllModal.classList.remove('visible');
        });
        
        // Main buttons
        startScanButton.addEventListener('click', () => runScan(false));
        refreshCacheButton.addEventListener('click', () => runScan(true));
        resultsDiv.addEventListener('click', handleActionClick);
        
        // Check cache and auto-scan settings
        const cacheData = await chrome.storage.local.get(['cache_timestamp', 'conflictConfig']);
        const cacheTTL = await StorageManager.getCacheTTL();
        const isCacheValid = cacheData.cache_timestamp && (Date.now() - cacheData.cache_timestamp < cacheTTL) && cacheData.conflictConfig;

        if (isCacheValid) {
            console.log('Valid cache found. Loading results directly.');
            initialScanScreen.style.display = 'none';
            await loadResultsFromCache();
        } else {
            console.log('Cache is expired or missing.');
            if (currentSettings.autoScan) {
                console.log('Auto-scan is enabled. Running a new scan on load.');
                runScan(false);
            } else {
                console.log('Displaying initial scan screen.');
                initialScanScreen.style.display = 'flex';
                displayLastScanTime();
                if (cacheData.conflictConfig) displayDataVersionInfo(cacheData.conflictConfig);
            }
        }
    };

    initializePage();
});
