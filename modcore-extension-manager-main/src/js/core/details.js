/**
 * Details Page Script
 * for modcore Extension Manager
 */

(() => {
    'use strict';

    // == Configuration ==
    const ENABLE_DEV_LOGGING = true;
    const SEARCH_DEBOUNCE_MS = 150;
    const TOAST_DEFAULT_DURATION = 3500;
    const SUPPORT_DATA_URL = 'https://raw.githubusercontent.com/modcoretech/api/main/modcoreEM/support-data.json';
    const PERMISSIONS_JSON_URL = '../js/features/permissions.json';
    const CACHE_VERSION = 'v2';
    const CACHE_KEY_PREFIX = `modcore_em_${CACHE_VERSION}_`;
    const SUPPORT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

    // == State Variables ==
    let extensionId = null;
    let extensionInfo = null;
    let supportInfo = null;
    let permissionsData = null;
    let isLoading = true;
    let currentPanel = 'panel-details';
    let currentPermissionsLayout = 'list';
    let searchDebounceTimeout = null;
    let uninstallConfirmResolver = null;
    let activePermissionPopup = null;
    let isPermissionsLoaded = false;
    let isSupportLoaded = false;
    
    // Filter state
    const filterState = {
        risk: new Set(['high', 'medium', 'low', 'varies']),
        type: new Set(['api', 'host']),
        searchTerm: ''
    };

    // == DOM Elements Cache ==
    const dom = {};

    // == Utility Functions ==
    const log = (...args) => { if (ENABLE_DEV_LOGGING) console.log('[EM Details]', ...args); };
    const warn = (...args) => { if (ENABLE_DEV_LOGGING) console.warn('[EM Details]', ...args); };
    const error = (...args) => { console.error('[EM Details]', ...args); };

    const getElem = (id) => document.getElementById(id);
    const getQuery = (selector, parent = document) => parent.querySelector(selector);
    const getAllQuery = (selector, parent = document) => parent.querySelectorAll(selector);

    const debounce = (func, delay) => {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    };

    // Safe DOM manipulation
    const clearElement = (el) => {
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
    };

    const setText = (el, text) => {
        if (el) el.textContent = text ?? '';
    };

    const createElement = (tag, options = {}) => {
        const el = document.createElement(tag);
        if (options.className) el.className = options.className;
        if (options.id) el.id = options.id;
        if (options.textContent) el.textContent = options.textContent;
        if (options.attributes) {
            Object.entries(options.attributes).forEach(([key, value]) => {
                el.setAttribute(key, value);
            });
        }
        return el;
    };

    // == Smart Caching System (Support Data Only) ==
    const CacheManager = {
        getKey(extensionId, type) {
            return `${CACHE_KEY_PREFIX}${type}_${extensionId || 'global'}`;
        },

        get(key) {
            try {
                const item = localStorage.getItem(key);
                if (!item) return null;
                const { timestamp, data, version } = JSON.parse(item);
                if (version !== CACHE_VERSION) {
                    localStorage.removeItem(key);
                    return null;
                }
                return { timestamp, data };
            } catch (e) {
                warn('Cache read error:', e);
                return null;
            }
        },

        set(key, data) {
            try {
                const payload = JSON.stringify({
                    version: CACHE_VERSION,
                    timestamp: Date.now(),
                    data
                });
                localStorage.setItem(key, payload);
            } catch (e) {
                warn('Cache write error:', e);
            }
        },

        isValid(cacheEntry, ttl) {
            if (!cacheEntry) return false;
            return (Date.now() - cacheEntry.timestamp) < ttl;
        },

        clearExtensionCache(extId) {
            localStorage.removeItem(this.getKey(extId, 'support'));
        }
    };

    // == Initialization ==
    async function initializeApp() {
        const startTime = performance.now();
        log("--- initializeApp Start ---");

        try {
            initDomElements();
            
            if (!validateEssentialElements()) {
                throw new Error("Essential page elements missing.");
            }

            setupModal();
            showLoadingOverlay(true);
            updateCurrentYear();

            extensionId = getExtensionIdFromUrl();
            if (!extensionId) {
                throw new Error("No Extension ID found in URL parameter 'id'.");
            }
            log("Target Extension ID:", extensionId);

            // Load permissions data first (no caching)
            await loadPermissionsData();

            // Load extension data
            const extensionDataLoaded = await loadExtensionData();
            
            if (extensionDataLoaded) {
                log("Extension data loaded successfully.");
                updateHeader();
                populateDetailsPanel();
                setupAllListeners();
                setupDropdowns();
                setupTooltipPositioning();
                setupDisclaimerToggle();
                
                // Defer support data loading until panel is viewed
                requestAnimationFrame(() => {
                    switchPanel(currentPanel);
                });
            } else {
                throw new Error("Could not load extension data.");
            }

        } catch (err) {
            error("CRITICAL error during initialization:", err);
            displayGlobalError(`Initialization Failed: ${err.message || 'Unknown error'}`);
            disableUIOnError();
        } finally {
            setTimeout(() => {
                showLoadingOverlay(false);
                setPageLoading(false);
            }, 300);
            log(`--- initializeApp End in ${performance.now() - startTime}ms ---`);
        }
    }

    function validateEssentialElements() {
        return dom.initialLoadingOverlay && dom.contentArea && dom.errorContainer &&
               dom.customConfirmModal && dom.modalTitle && dom.modalMessage &&
               dom.modalCancelButton && dom.modalConfirmButton;
    }

    function setPageLoading(loading) {
        isLoading = loading;
        document.body.setAttribute('aria-busy', loading ? 'true' : 'false');
    }

    function initDomElements() {
        // Header
        dom.headerIcon = getElem('header-extension-icon');
        dom.headerTitle = getElem('header-extension-title');
        dom.currentYearSpan = getElem('current-year');
        
        // Dropdowns
        dom.sectionDropdownBtn = getElem('section-dropdown-btn');
        dom.sectionDropdownMenu = getElem('section-dropdown-menu');
        dom.currentSectionLabel = getElem('current-section-label');
        dom.actionsDropdownBtn = getElem('actions-dropdown-btn');
        dom.actionsDropdownMenu = getElem('actions-dropdown-menu');
        dom.dropdownEnableToggle = getElem('dropdown-enable-toggle');
        dom.dropdownOptions = getElem('dropdown-options');
        dom.dropdownStore = getElem('dropdown-store');
        dom.dropdownRefresh = getElem('dropdown-refresh');
        dom.dropdownUninstall = getElem('dropdown-uninstall');

        // Content
        dom.contentArea = getQuery('.content-area');
        dom.initialLoadingOverlay = getElem('initial-loading-indicator');
        dom.errorContainer = getElem('error-container');

        // Panels
        dom.detailsPanel = getElem('panel-details');
        dom.permissionsPanel = getElem('panel-permissions');
        dom.supportPanel = getElem('panel-support');

        // Details Panel
        dom.detailsContentWrapper = getElem('details-content-wrapper');
        dom.detailName = getElem('detail-name');
        dom.detailShortName = getElem('detail-shortName-text');
        dom.copyShortNameButton = getElem('copy-shortname-button');
        dom.detailVersion = getElem('detail-version-text');
        dom.copyVersionButton = getElem('copy-version-button');
        dom.detailId = getElem('detail-id');
        dom.copyIdButton = getElem('copy-id-button');
        dom.detailType = getElem('detail-type');
        dom.detailStatus = getElem('detail-status');
        dom.detailInstallType = getElem('detail-install-type');
        dom.detailMayDisable = getElem('detail-mayDisable');
        dom.detailDescription = getElem('detail-description');
        dom.detailHomepageUrl = getElem('detail-homepage-url');
        dom.copyHomepageButton = getElem('copy-homepage-button');
        
        // Additional metadata elements
        dom.detailOfflineEnabled = getElem('detail-offline-enabled');
        dom.detailOfflineEnabledWrapper = getElem('detail-offline-enabled-wrapper');
        dom.detailUpdateUrl = getElem('detail-update-url');
        dom.detailUpdateUrlWrapper = getElem('detail-update-url-wrapper');
        dom.copyUpdateUrlButton = getElem('copy-update-url-button');
        dom.detailIconsContainer = getElem('detail-icons-container');
        dom.detailIconsWrapper = getElem('detail-icons-wrapper');

        // Permissions Panel
        dom.permissionsContentWrapper = getElem('permissions-content-wrapper');
        dom.permissionSearchInput = getElem('permission-search-input');
        dom.filterBtn = getElem('filter-btn');
        dom.filterDropdown = getElem('filter-dropdown-panel');
        dom.layoutListButton = getElem('layout-list-btn');
        dom.layoutGridButton = getElem('layout-grid-btn');
        dom.apiPermCountSpan = getElem('api-perm-count');
        dom.hostPermCountSpan = getElem('host-perm-count');
        dom.apiPermissionsList = getElem('api-permissions-list');
        dom.hostPermissionsList = getElem('host-permissions-list');
        dom.permissionsListContainers = getAllQuery('.permissions-list');

        // Support Panel
        dom.supportContentWrapper = getElem('support-content-wrapper');
        dom.supportEmptyState = getElem('support-empty-state');
        dom.supportDynamicContent = getElem('support-dynamic-content');
        dom.disclaimerToggle = getElem('disclaimer-toggle');
        dom.disclaimerContent = getElem('disclaimer-content');

        // Modal & Toast
        dom.toastContainer = getElem('toast-container');
        dom.customConfirmModal = getElem('custom-confirm-modal');
        dom.modalTitle = getElem('modal-title');
        dom.modalMessage = getElem('modal-message');
        dom.modalCancelButton = getElem('modal-cancel-button');
        dom.modalConfirmButton = getElem('modal-confirm-button');
        
        // Permission Popup
        dom.permissionPopup = getElem('permission-popup');
        dom.permissionPopupOverlay = getElem('permission-popup-overlay');
        dom.permissionPopupClose = getElem('permission-popup-close');
        dom.permissionPopupTitle = getElem('permission-popup-title');
        dom.permissionPopupRisk = getElem('permission-popup-risk');
        dom.permissionPopupCategory = getElem('permission-popup-category');
        dom.permissionPopupShortDesc = getElem('permission-popup-short-desc');
        dom.permissionPopupDetailedDesc = getElem('permission-popup-detailed-desc');
        dom.permissionPopupUseCases = getElem('permission-popup-use-cases');
        dom.permissionPopupMitigation = getElem('permission-popup-mitigation');
        dom.permissionPopupLink = getElem('permission-popup-link');
    }

    function getExtensionIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('id');
    }

    function updateCurrentYear() {
        if (dom.currentYearSpan) dom.currentYearSpan.textContent = new Date().getFullYear().toString();
    }

    // == Data Loading ==
    async function loadPermissionsData() {
        // No caching - fetch fresh every time to avoid storage bloat
        try {
            const response = await fetch(PERMISSIONS_JSON_URL, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            permissionsData = await response.json();
            log('Permissions loaded from JSON (not cached)');
        } catch (err) {
            error('Failed to load permissions.json:', err);
            permissionsData = { permissions: {}, categories: {}, riskLevels: {} };
            showToast('Failed to load permission details', 'warning');
        }
    }

    async function loadExtensionData() {
        if (!extensionId) {
            displayGlobalError("Extension ID is missing from the URL.");
            return null;
        }
        try {
            if (typeof window.chrome?.management?.get !== 'function') {
                throw new Error("`chrome.management` API unavailable.");
            }
            const info = await chrome.management.get(extensionId);
            if (!info) {
                throw new Error(`Extension ID "${extensionId}" not found.`);
            }
            extensionInfo = info;
            return extensionInfo;
        } catch (err) {
            error("Error loading extension data:", err);
            extensionInfo = null;
            displayGlobalError(`Failed to load details for ID "${extensionId}": ${err.message}.`);
            return null;
        }
    }

    async function loadSupportData() {
        if (isSupportLoaded) return;
        
        const cacheKey = CacheManager.getKey(extensionId, 'support');
        const cached = CacheManager.get(cacheKey);

        // Check if we have cached support data for this specific extension
        if (cached && CacheManager.isValid(cached, SUPPORT_CACHE_TTL_MS)) {
            log('Support data loaded from cache for extension:', extensionId);
            supportInfo = cached.data;
            populateSupportPanel();
            isSupportLoaded = true;
            return;
        }

        setBusyState(dom.supportContentWrapper, true);
        
        try {
            const response = await fetch(SUPPORT_DATA_URL, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`Network response error: ${response.status}`);
            }
            const data = await response.json();
            
            // Only cache data relevant to this extension
            const extSupport = data.extensions?.find(ext => ext.id === extensionId);
            supportInfo = extSupport ? { extensions: [extSupport], meta: data.meta } : { extensions: [], meta: data.meta };
            
            CacheManager.set(cacheKey, supportInfo);
            log('Support data fetched and cached for extension:', extensionId);
            
        } catch (err) {
            error("Error loading support data:", err);
            supportInfo = { error: err.message };
        } finally {
            populateSupportPanel();
            setBusyState(dom.supportContentWrapper, false);
            isSupportLoaded = true;
        }
    }

    // == UI Population & State ==
    function updateHeader() {
        if (!extensionInfo) return;
        const bestIcon = findBestIconUrl(extensionInfo.icons);
        dom.headerIcon.src = bestIcon || '../../public/icons/svg/code.svg';
        dom.headerIcon.alt = `${extensionInfo.name || 'Extension'} icon`;
        dom.headerTitle.textContent = extensionInfo.name || 'Extension Details';
        document.title = `${extensionInfo.name || 'Extension'} Details | modcore EM`;
        
        updateActionDropdownItems();
    }

    function updateActionDropdownItems() {
        if (!extensionInfo) return;
        
        const isEnabled = extensionInfo.enabled;
        setText(dom.dropdownEnableToggle.querySelector('span:not(.icon)'), isEnabled ? 'Disable Extension' : 'Enable Extension');
        const toggleIcon = dom.dropdownEnableToggle.querySelector('.icon');
        toggleIcon.className = `icon ${isEnabled ? 'icon-toggle-on' : 'icon-toggle-off'}`;
        dom.dropdownEnableToggle.classList.toggle('enabled', isEnabled);
        
        dom.dropdownOptions.disabled = !extensionInfo.optionsUrl;
        
        const isWebStore = extensionInfo.id && /^[a-z]{32}$/.test(extensionInfo.id) && extensionInfo.installType === 'normal';
        dom.dropdownStore.disabled = !isWebStore;
        if (isWebStore) {
            dom.dropdownStore.dataset.storeUrl = `https://chrome.google.com/webstore/detail/${extensionInfo.id}`;
        }
        
        dom.dropdownUninstall.disabled = !extensionInfo.mayDisable;
    }

    function findBestIconUrl(icons, preferredSize = 128) {
        if (!icons || icons.length === 0) return null;
        icons.sort((a, b) => b.size - a.size);
        const suitableIcon = icons.find(icon => icon.size >= preferredSize);
        return suitableIcon ? suitableIcon.url : icons[0].url;
    }

    function populateDetailsPanel() {
        if (!dom.detailsPanel || !extensionInfo) return;
        setBusyState(dom.detailsContentWrapper, true);

        requestAnimationFrame(() => {
            try {
                setText(dom.detailName, extensionInfo.name);
                setText(dom.detailShortName, extensionInfo.shortName || 'N/A');
                setText(dom.detailVersion, extensionInfo.version);
                setText(dom.detailId, extensionInfo.id);
                setText(dom.detailType, formatExtensionType(extensionInfo.type));
                setText(dom.detailStatus, extensionInfo.enabled ? 'Enabled' : 'Disabled');
                dom.detailStatus.classList.toggle('status-enabled', extensionInfo.enabled);
                dom.detailStatus.classList.toggle('status-disabled', !extensionInfo.enabled);
                setText(dom.detailInstallType, getInstallTypeDescription(extensionInfo.installType));
                setText(dom.detailMayDisable, formatBoolean(extensionInfo.mayDisable));
                setText(dom.detailDescription, extensionInfo.description || 'No description provided.');
                
                updateLink(dom.detailHomepageUrl, extensionInfo.homepageUrl, extensionInfo.homepageUrl || 'N/A');
                dom.copyHomepageButton.disabled = !extensionInfo.homepageUrl;

                // Update tooltips
                const typeTooltip = getQuery('#tooltip-type');
                if (typeTooltip) setText(typeTooltip, getExtensionTypeTooltip(extensionInfo.type));
                
                const installTooltip = getQuery('#tooltip-install');
                if (installTooltip) setText(installTooltip, getInstallTypeTooltip(extensionInfo.installType));

                populateAdditionalMetadata();

            } catch(err) {
                error("Error populating details panel:", err);
            } finally {
                setBusyState(dom.detailsContentWrapper, false);
            }
        });
    }

    function populateAdditionalMetadata() {
        if (!extensionInfo) return;

        if (extensionInfo.offlineEnabled !== undefined) {
            dom.detailOfflineEnabledWrapper.hidden = false;
            setText(dom.detailOfflineEnabled, extensionInfo.offlineEnabled ? 'Yes' : 'No');
        } else {
            dom.detailOfflineEnabledWrapper.hidden = true;
        }

        if (extensionInfo.updateUrl) {
            dom.detailUpdateUrlWrapper.hidden = false;
            updateLink(dom.detailUpdateUrl, extensionInfo.updateUrl, extensionInfo.updateUrl);
            dom.copyUpdateUrlButton.disabled = false;
        } else {
            dom.detailUpdateUrlWrapper.hidden = true;
            dom.copyUpdateUrlButton.disabled = true;
        }

        if (extensionInfo.icons && extensionInfo.icons.length > 0) {
            dom.detailIconsWrapper.hidden = false;
            clearElement(dom.detailIconsContainer);
            const fragment = document.createDocumentFragment();
            extensionInfo.icons.forEach(icon => {
                const img = createElement('img', {
                    className: 'detail-icon-item',
                    attributes: {
                        src: icon.url,
                        alt: `Icon ${icon.size}x${icon.size}`,
                        title: `${icon.size}x${icon.size}`
                    }
                });
                fragment.appendChild(img);
            });
            dom.detailIconsContainer.appendChild(fragment);
        } else {
            dom.detailIconsWrapper.hidden = true;
        }
    }

    function formatLaunchType(type) {
        return type ? type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'N/A';
    }

    function getInstallTypeDescription(installType) {
        const descriptions = {
            admin: 'Administrator Policy',
            development: 'Developer Mode',
            normal: 'Chrome Web Store',
            sideload: 'Sideloaded',
            other: 'Other'
        };
        return descriptions[installType] || 'Unknown';
    }

    function formatExtensionType(type) {
        return type ? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ') : 'N/A';
    }

    function formatBoolean(value) {
        return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : 'N/A';
    }

    function getExtensionTypeTooltip(type) {
        const tooltips = {
            extension: 'A standard browser extension that adds new features or functionality.',
            theme: 'A special extension that changes the look and feel of the browser.',
            hosted_app: 'A legacy packaged application that is hosted on the web.',
            packaged_app: 'A legacy Chrome App that runs in its own window.'
        };
        return tooltips[type] || `The category of the installed item is '${type}'.`;
    }

    function getInstallTypeTooltip(installType) {
        const tooltips = {
            admin: "Installed and managed by an organization's administrator via enterprise policy.",
            development: 'Loaded manually by a developer from a local folder for testing purposes.',
            normal: 'Installed from the official Chrome Web Store.',
            sideload: 'Installed from a .crx file outside of the Chrome Web Store.',
            other: 'Installed through another method not covered by other categories.'
        };
        return tooltips[installType] || 'Indicates how the extension was installed.';
    }

    // == Permissions Panel ==
    function populatePermissionsPanel() {
        if (!dom.permissionsPanel || !extensionInfo) return;
        setBusyState(dom.permissionsContentWrapper, true);
        
        requestAnimationFrame(() => {
            try {
                const apiPerms = extensionInfo.permissions || [];
                const hostPerms = extensionInfo.hostPermissions || [];
                setText(dom.apiPermCountSpan, apiPerms.length.toString());
                setText(dom.hostPermCountSpan, hostPerms.length.toString());
                renderPermissionsList(dom.apiPermissionsList, apiPerms, 'api');
                renderPermissionsList(dom.hostPermissionsList, hostPerms, 'host');
                applyFilters();
                applyPermissionsLayout(currentPermissionsLayout);
            } catch (err) {
                error("Error populating permissions panel", err);
            } finally {
                setBusyState(dom.permissionsContentWrapper, false);
            }
        });
    }

    function renderPermissionsList(container, permissions, type) {
        clearElement(container);

        if (!permissions || permissions.length === 0) {
            const text = type === 'api' ? 'No API permissions requested.' : 'No host permissions requested.';
            const placeholder = createPlaceholderElement(text, 'info');
            placeholder.dataset.listType = type;
            container.appendChild(placeholder);
            return;
        }

        const fragment = document.createDocumentFragment();
        permissions.forEach((perm, index) => {
            const def = findPermissionDefinition(perm, type);
            const item = createPermissionElement(perm, type, def);
            item.style.animationDelay = `${index * 30}ms`;
            fragment.appendChild(item);
        });
        container.appendChild(fragment);
    }

    function findPermissionDefinition(permissionName, type) {
        const permKey = permissionName;
        const permData = permissionsData?.permissions || {};
        
        if (type === 'host') {
            const baseDef = permData['host'] || {
                name: 'host',
                shortDescription: 'Access specific websites or patterns.',
                detailedDescription: 'Host permissions allow extensions to interact with specific websites.',
                category: ['functionality'],
                riskLevel: 'varies',
                requiresHostPermission: true,
                chromeLink: 'https://developer.chrome.com/docs/extensions/mv3/match_patterns/',
                mv3Compatible: true,
                commonUseCases: ['Site-specific enhancements', 'Content modification'],
                mitigationTips: ['Use specific patterns', 'Avoid broad wildcards']
            };
            
            let riskLevel = 'varies';
            let description = baseDef.shortDescription;
            
            if (permissionName === "<all_urls>") {
                riskLevel = 'high';
                description = "Access data/modify behavior on ALL websites you visit.";
            } else if (permissionName.includes('*')) {
                riskLevel = 'medium';
                description = `Access websites matching pattern: "${permissionName}". Can read and change data on matching sites.`;
            } else {
                riskLevel = 'low';
                description = `Access specific site: "${permissionName}". Can read and change data on this site.`;
            }
            
            return {
                ...baseDef,
                name: permissionName,
                shortDescription: description,
                riskLevel,
                isHostPermission: true
            };
        }
        
        return permData[permKey] || {
            name: permissionName,
            shortDescription: `Access to the '${permissionName}' browser feature.`,
            detailedDescription: `This permission grants access to the ${permissionName} API.`,
            category: ['functionality'],
            riskLevel: 'medium',
            requiresHostPermission: false,
            chromeLink: `https://developer.chrome.com/docs/extensions/reference/${permKey}/`,
            mv3Compatible: true,
            commonUseCases: ['Extension functionality'],
            mitigationTips: ['Review documentation for best practices']
        };
    }

    function createPermissionElement(name, type, def) {
        const item = createElement('div', {
            className: `permission-item risk-${def.riskLevel.toLowerCase()}`,
            attributes: {
                'data-permission-name': name,
                'data-permission-type': type,
                'data-permission-risk': def.riskLevel.toLowerCase()
            }
        });

        const header = createElement('div', { className: 'permission-item-header' });

        const iconSpan = createElement('span', {
            className: `icon ${type === 'host' ? 'icon-host' : 'icon-api'}`,
            attributes: { 'aria-hidden': 'true' }
        });
        header.appendChild(iconSpan);

        const nameSpan = createElement('span', { className: 'perm-name' });
        if (type === 'host') {
            nameSpan.textContent = 'Host: ';
            const code = createElement('code');
            code.textContent = name;
            nameSpan.appendChild(code);
        } else {
            nameSpan.textContent = name;
        }
        header.appendChild(nameSpan);

        const riskIndicator = createElement('span', {
            className: `risk-indicator ${def.riskLevel.toLowerCase()}`,
            textContent: `${def.riskLevel} Risk`
        });
        header.appendChild(riskIndicator);

        item.appendChild(header);

        const descriptionDiv = createElement('div', {
            className: 'permission-item-description',
            textContent: def.shortDescription
        });

        // Three-dot menu button for extended view
        const menuButton = createElement('button', {
            className: 'btn-icon permission-menu-btn',
            attributes: {
                'aria-label': `More details about ${name}`,
                'title': 'View detailed information'
            }
        });
        
        const menuIcon = createElement('span', {
            className: 'icon icon-more',
            attributes: { 'aria-hidden': 'true' }
        });
        menuButton.appendChild(menuIcon);
        
        menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            showPermissionPopup(name, type, def);
        });
        
        descriptionDiv.appendChild(menuButton);
        item.appendChild(descriptionDiv);

        return item;
    }

    // == Permission Popup ==
    function showPermissionPopup(name, type, def) {
        if (!dom.permissionPopup) return;
        
        // Close existing popup
        closePermissionPopup();
        
        activePermissionPopup = { name, type, def };
        
        // Populate popup content
        setText(dom.permissionPopupTitle, type === 'host' ? `Host: ${name}` : name);
        
        // Risk badge
        const riskConfig = permissionsData?.riskLevels?.[def.riskLevel.toLowerCase()];
        dom.permissionPopupRisk.className = `permission-popup-risk risk-${def.riskLevel.toLowerCase()}`;
        setText(dom.permissionPopupRisk, riskConfig?.name || `${def.riskLevel} Risk`);
        dom.permissionPopupRisk.style.backgroundColor = riskConfig?.containerColor || '';
        dom.permissionPopupRisk.style.color = riskConfig?.color || '';
        
        // Categories
        clearElement(dom.permissionPopupCategory);
        if (def.category && def.category.length > 0) {
            def.category.forEach(cat => {
                const catConfig = permissionsData?.categories?.[cat];
                const badge = createElement('span', {
                    className: 'category-badge',
                    textContent: catConfig?.name || cat
                });
                if (catConfig?.color) {
                    badge.style.backgroundColor = catConfig.color + '20';
                    badge.style.color = catConfig.color;
                    badge.style.borderColor = catConfig.color + '40';
                }
                dom.permissionPopupCategory.appendChild(badge);
            });
        }
        
        // Descriptions
        setText(dom.permissionPopupShortDesc, def.shortDescription);
        setText(dom.permissionPopupDetailedDesc, def.detailedDescription || 'No detailed description available.');
        
        // Use cases
        clearElement(dom.permissionPopupUseCases);
        if (def.commonUseCases && def.commonUseCases.length > 0) {
            def.commonUseCases.forEach(useCase => {
                const li = createElement('li', { textContent: useCase });
                dom.permissionPopupUseCases.appendChild(li);
            });
        } else {
            const li = createElement('li', { textContent: 'General extension functionality' });
            dom.permissionPopupUseCases.appendChild(li);
        }
        
        // Mitigation tips
        clearElement(dom.permissionPopupMitigation);
        if (def.mitigationTips && def.mitigationTips.length > 0) {
            def.mitigationTips.forEach(tip => {
                const li = createElement('li', { textContent: tip });
                dom.permissionPopupMitigation.appendChild(li);
            });
        } else {
            const li = createElement('li', { textContent: 'Review permission carefully before granting' });
            dom.permissionPopupMitigation.appendChild(li);
        }
        
        // Documentation link
        if (def.chromeLink) {
            dom.permissionPopupLink.href = def.chromeLink;
            dom.permissionPopupLink.hidden = false;
        } else {
            dom.permissionPopupLink.hidden = true;
        }
        
        // Show popup
        dom.permissionPopupOverlay.classList.add('visible');
        dom.permissionPopup.classList.add('visible');
        document.body.style.overflow = 'hidden';
        
        // Focus trap
        dom.permissionPopupClose.focus();
    }

    function closePermissionPopup() {
        if (!dom.permissionPopup) return;
        dom.permissionPopupOverlay.classList.remove('visible');
        dom.permissionPopup.classList.remove('visible');
        document.body.style.overflow = '';
        activePermissionPopup = null;
    }

    // == Support Panel ==
    function populateSupportPanel() {
        if (!dom.supportPanel) return;
        
        const dynamicContent = dom.supportDynamicContent;
        const emptyState = dom.supportEmptyState;
        clearElement(dynamicContent);
        
        // Handle error state
        if (supportInfo?.error) {
            emptyState.hidden = false;
            dynamicContent.hidden = true;
            const errorDiv = createElement('div', { className: 'support-message support-error' });
            errorDiv.innerHTML = `
                <span class="icon icon-error" aria-hidden="true"></span>
                <div>
                    <h4>Could Not Load Support Information</h4>
                    <p>Error: ${supportInfo.error}</p>
                </div>
            `;
            // Show error inside empty state area
            emptyState.after(errorDiv);
            return;
        }
        
        const extSupport = supportInfo?.extensions?.find(ext => ext.id === extensionId);
        
        // Not in program: show empty state, hide dynamic content
        if (!extSupport || !extSupport.support || Object.keys(extSupport.support).length === 0) {
            emptyState.hidden = false;
            dynamicContent.hidden = true;
            return;
        }
        
        // In program: hide empty state, show dynamic content
        emptyState.hidden = true;
        dynamicContent.hidden = false;
        
        const fragment = document.createDocumentFragment();
        
        // Main support card
        const supportCard = createElement('div', { className: 'support-card' });
        
        // Developer Header with Name & Email
        const devHeader = createElement('div', { className: 'support-card-header' });
        const avatar = createElement('div', { className: 'dev-avatar' });
        const avatarIcon = createElement('span', { 
            className: 'icon icon-developer',
            attributes: { 'aria-hidden': 'true' }
        });
        avatar.appendChild(avatarIcon);
        devHeader.appendChild(avatar);
        
        const devInfo = createElement('div', { className: 'dev-info' });
        const devName = createElement('h3', { 
            textContent: extSupport.developerName || extSupport.name || 'Developer'
        });
        devInfo.appendChild(devName);
        
        if (extSupport.supportEmail) {
            const emailLink = createElement('a', {
                className: 'support-dev-email',
                href: `mailto:${extSupport.supportEmail}`,
                textContent: extSupport.supportEmail,
                attributes: {
                    'aria-label': `Email developer: ${extSupport.supportEmail}`
                }
            });
            const emailIcon = createElement('span', {
                className: 'icon icon-info',
                attributes: { 'aria-hidden': 'true', 'style': 'width: 16px; height: 16px;' }
            });
            emailLink.insertBefore(emailIcon, emailLink.firstChild);
            devInfo.appendChild(emailLink);
        }
        
        devHeader.appendChild(devInfo);
        supportCard.appendChild(devHeader);
        
        // Description
        if (extSupport.description) {
            const descSection = createElement('div', { className: 'support-message-section' });
            const descTitle = createElement('h4', { textContent: 'About' });
            const descText = createElement('p', { textContent: extSupport.description });
            descSection.appendChild(descTitle);
            descSection.appendChild(descText);
            supportCard.appendChild(descSection);
        }
        
        // Dynamic Stats from API
        if (extSupport.stats && Object.keys(extSupport.stats).length > 0) {
            const statsSection = createElement('div', { className: 'support-stats' });
            
            Object.entries(extSupport.stats).forEach(([key, value]) => {
                const statItem = createElement('div', { className: 'stat-item' });
                const statValue = createElement('span', {
                    className: 'stat-value',
                    textContent: value
                });
                const statLabel = createElement('span', {
                    className: 'stat-label',
                    textContent: key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
                });
                statItem.appendChild(statValue);
                statItem.appendChild(statLabel);
                statsSection.appendChild(statItem);
            });
            
            supportCard.appendChild(statsSection);
        }
        
        // Support Buttons - Use API keys directly as button text
        const actionsDiv = createElement('div', { className: 'support-actions' });
        
        Object.entries(extSupport.support).forEach(([platform, url]) => {
            const button = createElement('a', {
                className: `btn support-button`,
                attributes: {
                    'href': url,
                    'target': '_blank',
                    'rel': 'noopener noreferrer',
                    'data-platform': platform,
                    'aria-label': `Visit ${platform} (opens in new tab)`
                }
            });
            button.textContent = platform;
            
            // Add appropriate icon based on platform name
            const icon = createElement('span', {
                className: 'icon',
                attributes: { 'aria-hidden': 'true' }
            });
            
            const platformLower = platform.toLowerCase();
            if (platformLower.includes('github')) {
                icon.classList.add('icon-code');
            } else if (platformLower.includes('mail') || platformLower.includes('contact')) {
                icon.classList.add('icon-info');
            } else if (platformLower.includes('doc')) {
                icon.classList.add('icon-link');
            } else if (platformLower.includes('patreon') || platformLower.includes('kofi') || platformLower.includes('ko-fi') || platformLower.includes('paypal') || platformLower.includes('coffee')) {
                icon.classList.add('icon-support');
            } else {
                icon.classList.add('icon-link');
            }
            
            button.insertBefore(icon, button.firstChild);
            actionsDiv.appendChild(button);
        });
        
        supportCard.appendChild(actionsDiv);
        fragment.appendChild(supportCard);
        dynamicContent.appendChild(fragment);
    }

    function setupDisclaimerToggle() {
        if (!dom.disclaimerToggle || !dom.disclaimerContent) return;
        
        dom.disclaimerToggle.addEventListener('click', () => {
            const isExpanded = dom.disclaimerToggle.getAttribute('aria-expanded') === 'true';
            dom.disclaimerToggle.setAttribute('aria-expanded', String(!isExpanded));
            dom.disclaimerContent.hidden = isExpanded;
        });
        
        // Keyboard accessibility
        dom.disclaimerToggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                dom.disclaimerToggle.click();
            }
        });
    }

    // == Event Listeners & Handlers ==
    function setupAllListeners() {
        setupDropdownListeners();
        setupActionListeners();
        setupPermissionControlsListeners();
        setupModalListeners();
        setupCopyButtonListeners();
        setupPermissionPopupListeners();
        setupPanelSwitchListeners();
        setupKeyboardNavigation();
    }

    function setupKeyboardNavigation() {
        // Enhanced keyboard navigation for dropdowns
        [dom.sectionDropdownMenu, dom.actionsDropdownMenu].forEach(menu => {
            if (!menu) return;
            
            menu.addEventListener('keydown', (e) => {
                const items = Array.from(menu.querySelectorAll('.dropdown-item:not([disabled])'));
                const currentIndex = items.indexOf(document.activeElement);
                
                switch(e.key) {
                    case 'ArrowDown':
                        e.preventDefault();
                        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                        items[nextIndex]?.focus();
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                        items[prevIndex]?.focus();
                        break;
                    case 'Home':
                        e.preventDefault();
                        items[0]?.focus();
                        break;
                    case 'End':
                        e.preventDefault();
                        items[items.length - 1]?.focus();
                        break;
                    case 'Escape':
                        e.preventDefault();
                        closeAllDropdowns();
                        // Return focus to dropdown button
                        if (menu === dom.sectionDropdownMenu) {
                            dom.sectionDropdownBtn?.focus();
                        } else if (menu === dom.actionsDropdownMenu) {
                            dom.actionsDropdownBtn?.focus();
                        }
                        break;
                }
            });
        });

        // Trap focus in modal
        dom.customConfirmModal.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            
            const focusableElements = dom.customConfirmModal.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            const firstFocusable = focusableElements[0];
            const lastFocusable = focusableElements[focusableElements.length - 1];
            
            if (e.shiftKey) {
                if (document.activeElement === firstFocusable) {
                    lastFocusable.focus();
                    e.preventDefault();
                }
            } else {
                if (document.activeElement === lastFocusable) {
                    firstFocusable.focus();
                    e.preventDefault();
                }
            }
        });
    }

    function setupPanelSwitchListeners() {
        // Listen for panel switches to lazy-load data
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    if (target.classList.contains('active')) {
                        const panelId = target.id;
                        if (panelId === 'panel-permissions' && !isPermissionsLoaded) {
                            populatePermissionsPanel();
                            isPermissionsLoaded = true;
                        } else if (panelId === 'panel-support' && !isSupportLoaded) {
                            loadSupportData();
                        }
                    }
                }
            });
        });

        [dom.detailsPanel, dom.permissionsPanel, dom.supportPanel].forEach(panel => {
            if (panel) {
                observer.observe(panel, { attributes: true });
            }
        });
    }

    function setupPermissionPopupListeners() {
        if (dom.permissionPopupClose) {
            dom.permissionPopupClose.addEventListener('click', closePermissionPopup);
        }
        if (dom.permissionPopupOverlay) {
            dom.permissionPopupOverlay.addEventListener('click', closePermissionPopup);
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && activePermissionPopup) {
                closePermissionPopup();
            }
        });
    }

    function setupDropdowns() {
        getAllQuery('.dropdown-item[data-panel-target]', dom.sectionDropdownMenu).forEach(item => {
            item.addEventListener('click', () => {
                const target = item.dataset.panelTarget;
                switchPanel(target);
                updateSectionDropdownLabel(target);
                closeAllDropdowns();
            });
        });

        dom.dropdownEnableToggle.addEventListener('click', () => {
            handleEnableToggleClick();
            closeAllDropdowns();
        });
        
        dom.dropdownOptions.addEventListener('click', () => {
            handleOptionsClick();
            closeAllDropdowns();
        });
        
        dom.dropdownStore.addEventListener('click', () => {
            if (dom.dropdownStore.dataset.storeUrl) {
                chrome.tabs.create({ url: dom.dropdownStore.dataset.storeUrl });
            }
            closeAllDropdowns();
        });
        
        dom.dropdownRefresh.addEventListener('click', () => {
            handleRefreshClick();
            closeAllDropdowns();
        });
        
        dom.dropdownUninstall.addEventListener('click', () => {
            handleUninstallClick();
            closeAllDropdowns();
        });
    }

    function setupDropdownListeners() {
        dom.sectionDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dom.sectionDropdownMenu.classList.contains('open');
            closeAllDropdowns();
            if (!isOpen) {
                dom.sectionDropdownMenu.classList.add('open');
                dom.sectionDropdownBtn.setAttribute('aria-expanded', 'true');
                // Focus first item
                const firstItem = dom.sectionDropdownMenu.querySelector('.dropdown-item:not([disabled])');
                firstItem?.focus();
            }
        });

        dom.actionsDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dom.actionsDropdownMenu.classList.contains('open');
            closeAllDropdowns();
            if (!isOpen) {
                dom.actionsDropdownMenu.classList.add('open');
                dom.actionsDropdownBtn.setAttribute('aria-expanded', 'true');
                // Focus first item
                const firstItem = dom.actionsDropdownMenu.querySelector('.dropdown-item:not([disabled])');
                firstItem?.focus();
            }
        });

        document.addEventListener('click', closeAllDropdowns);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeAllDropdowns();
        });
    }

    function closeAllDropdowns() {
        dom.sectionDropdownMenu.classList.remove('open');
        dom.sectionDropdownBtn.setAttribute('aria-expanded', 'false');
        dom.actionsDropdownMenu.classList.remove('open');
        dom.actionsDropdownBtn.setAttribute('aria-expanded', 'false');
        if (dom.filterDropdown) {
            dom.filterDropdown.classList.remove('open');
            dom.filterBtn.setAttribute('aria-expanded', 'false');
        }
    }

    function updateSectionDropdownLabel(targetId) {
        const labels = {
            'panel-details': 'Overview',
            'panel-permissions': 'Permissions',
            'panel-support': 'Support Developer'
        };
        setText(dom.currentSectionLabel, labels[targetId] || 'Overview');
        
        getAllQuery('.dropdown-item', dom.sectionDropdownMenu).forEach(item => {
            item.classList.toggle('active', item.dataset.panelTarget === targetId);
            item.setAttribute('aria-current', item.dataset.panelTarget === targetId ? 'true' : 'false');
        });
    }

    function setupActionListeners() {
        // Actions handled in dropdown setup
    }

    function setupPermissionControlsListeners() {
        const debouncedSearch = debounce((value) => {
            filterState.searchTerm = value.trim().toLowerCase();
            applyFilters();
        }, SEARCH_DEBOUNCE_MS);
        
        dom.permissionSearchInput.addEventListener('input', (e) => {
            debouncedSearch(e.target.value);
        });

        dom.filterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dom.filterDropdown.classList.contains('open');
            closeAllDropdowns();
            if (!isOpen) {
                dom.filterDropdown.classList.add('open');
                dom.filterBtn.setAttribute('aria-expanded', 'true');
            }
        });

        getAllQuery('input[name="risk-filter"]', dom.filterDropdown).forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                updateFilterState();
                applyFilters();
            });
        });

        getAllQuery('input[name="type-filter"]', dom.filterDropdown).forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                updateFilterState();
                applyFilters();
            });
        });

        dom.layoutListButton.addEventListener('click', handleLayoutToggle);
        dom.layoutGridButton.addEventListener('click', handleLayoutToggle);
    }

    function updateFilterState() {
        filterState.risk.clear();
        filterState.type.clear();
        
        getAllQuery('input[name="risk-filter"]:checked', dom.filterDropdown).forEach(cb => {
            filterState.risk.add(cb.value);
        });
        
        getAllQuery('input[name="type-filter"]:checked', dom.filterDropdown).forEach(cb => {
            filterState.type.add(cb.value);
        });
    }

    function applyFilters() {
        const { searchTerm, risk, type } = filterState;
        
        ['api', 'host'].forEach(listType => {
            const list = dom[`${listType}PermissionsList`];
            if (!list) return;
            
            const items = list.querySelectorAll('.permission-item');
            let visibleCount = 0;
            
            items.forEach(item => {
                const itemRisk = item.dataset.permissionRisk;
                const itemType = item.dataset.permissionType;
                const itemName = item.dataset.permissionName;
                const itemText = item.textContent.toLowerCase();
                
                const matchesSearch = !searchTerm || 
                    itemName.includes(searchTerm) || 
                    itemText.includes(searchTerm);
                
                const matchesRisk = risk.has(itemRisk);
                const matchesType = type.has(itemType);
                
                const show = matchesSearch && matchesRisk && matchesType;
                item.hidden = !show;
                if (show) visibleCount++;
            });
            
            updatePlaceholderVisibility(list, visibleCount, searchTerm, listType);
        });
    }

    function updatePlaceholderVisibility(listContainer, visibleCount, searchTerm, listType) {
        const existingPlaceholder = listContainer.querySelector('.placeholder');
        
        if (visibleCount === 0) {
            if (!existingPlaceholder) {
                const text = searchTerm
                    ? `No ${listType} permissions match your filters.`
                    : (listType === 'api' ? 'No API permissions requested.' : 'No host permissions requested.');
                const placeholder = createPlaceholderElement(text, 'info');
                listContainer.appendChild(placeholder);
            } else {
                const textSpan = existingPlaceholder.querySelector('.placeholder-text');
                if (textSpan && searchTerm) {
                    textSpan.textContent = `No ${listType} permissions match your filters.`;
                }
            }
        } else if (existingPlaceholder) {
            existingPlaceholder.remove();
        }
    }

    function setupModalListeners() {
        dom.modalCancelButton.addEventListener('click', () => hideCustomConfirm(false));
        dom.modalConfirmButton.addEventListener('click', () => hideCustomConfirm(true));
        document.addEventListener('keydown', (e) => { 
            if (e.key === 'Escape' && dom.customConfirmModal.classList.contains('visible')) {
                hideCustomConfirm(false);
            }
        });
        dom.customConfirmModal.addEventListener('click', (e) => { 
            if (e.target === dom.customConfirmModal) hideCustomConfirm(false); 
        });
    }

    function setupCopyButtonListeners() {
        dom.copyIdButton.addEventListener('click', () => handleCopyClick(dom.detailId?.textContent, 'Extension ID', dom.copyIdButton));
        dom.copyShortNameButton.addEventListener('click', () => handleCopyClick(dom.detailShortName?.textContent, 'Short Name', dom.copyShortNameButton));
        dom.copyVersionButton.addEventListener('click', () => handleCopyClick(dom.detailVersion?.textContent, 'Version', dom.copyVersionButton));
        dom.copyHomepageButton.addEventListener('click', () => handleCopyClick(dom.detailHomepageUrl?.href, 'Homepage URL', dom.copyHomepageButton));
        dom.copyUpdateUrlButton.addEventListener('click', () => handleCopyClick(dom.detailUpdateUrl?.href, 'Update URL', dom.copyUpdateUrlButton));
    }

    async function handleEnableToggleClick() {
        if (!extensionInfo) return;
        const newState = !extensionInfo.enabled;
        
        try {
            await chrome.management.setEnabled(extensionId, newState);
            const refreshed = await loadExtensionData();
            if (refreshed) {
                populateDetailsPanel();
                updateHeader();
                showToast(`Extension ${newState ? 'enabled' : 'disabled'}.`, 'success');
            }
        } catch (err) {
            error("Error toggling state:", err);
            showToast(`Failed to toggle state: ${err.message}`, 'error');
            loadExtensionData().then(() => {
                populateDetailsPanel();
                updateHeader();
            });
        }
    }

    function handleOptionsClick() {
        if (extensionInfo?.optionsUrl) chrome.tabs.create({ url: extensionInfo.optionsUrl });
    }

    async function handleRefreshClick() {
        const refreshIcon = dom.dropdownRefresh.querySelector('.icon');
        refreshIcon.classList.add('loading');
        
        showToast('Refreshing...', 'info', 1500);
        
        // Clear support cache so it's fresh on reload
        CacheManager.clearExtensionCache(extensionId);
        
        // Brief delay so toast is visible, then reload the page
        setTimeout(() => {
            window.location.reload();
        }, 600);
    }

    async function handleUninstallClick() {
        if (!extensionInfo) return;
        
        const confirmed = await showCustomConfirm(
            `Uninstall "${extensionInfo.name}"?`,
            "This action is permanent and will remove the extension and all of its associated data from your browser. Are you sure you want to continue?"
        );
        
        if (!confirmed) return;
        
        try {
            await chrome.management.uninstall(extensionId, { showConfirmDialog: false });
            
            // Clear cache for this extension
            CacheManager.clearExtensionCache(extensionId);
            
            showToast(`"${extensionInfo.name}" uninstalled.`, 'success');
            displayGlobalError(`"${extensionInfo.name}" has been uninstalled. You may close this page.`);
            disableUIOnError();
        } catch (err) {
            showToast(`Uninstall failed: ${err.message}`, 'error');
        }
    }

    async function handleCopyClick(text, label, btn) {
        if (!navigator.clipboard) {
            showToast('Clipboard API unavailable.', 'error');
            return;
        }
        if (!text || text.trim() === 'N/A' || !text.trim()) {
            showToast(`Cannot copy ${label}: Not available.`, 'warning');
            return;
        }
        try {
            await navigator.clipboard.writeText(text.trim());
            showToast(`${label} copied!`, 'success');
            
            if (btn) {
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 1500);
            }
        } catch (err) {
            error(`Copy failed for "${label}":`, err);
            showToast(`Could not copy ${label}.`, 'error');
        }
    }

    function handleLayoutToggle(event) {
        const layout = event.currentTarget.dataset.layout;
        if (layout && layout !== currentPermissionsLayout) {
            applyPermissionsLayout(layout);
        }
    }

    function applyPermissionsLayout(layout) {
        currentPermissionsLayout = layout;
        dom.layoutListButton.classList.toggle('active', layout === 'list');
        dom.layoutListButton.setAttribute('aria-pressed', layout === 'list');
        dom.layoutGridButton.classList.toggle('active', layout === 'grid');
        dom.layoutGridButton.setAttribute('aria-pressed', layout === 'grid');
        dom.permissionsListContainers.forEach(c => {
            c.className = `permissions-list ${layout}-view`;
        });
    }

    function switchPanel(targetId) {
        if (!targetId) return;
        
        getAllQuery('.content-panel.active').forEach(p => { 
            p.hidden = true; 
            p.classList.remove('active'); 
        });
        
        const targetPanel = getElem(targetId);
        if (targetPanel) {
            targetPanel.hidden = false;
            targetPanel.classList.add('active');
            targetPanel.focus({ preventScroll: true });
            currentPanel = targetId;
        }
    }

    function setupTooltipPositioning() {
        const positionTooltip = (tooltip) => {
            const trigger = tooltip.parentElement;
            if (!trigger) return;
            
            // Reset to defaults so we can measure natural position
            tooltip.removeAttribute('data-position');
            tooltip.style.removeProperty('max-width');
            
            // Force a reflow so getBoundingClientRect is accurate
            tooltip.style.visibility = 'hidden';
            tooltip.style.opacity = '0';
            
            const triggerRect = trigger.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const margin = 10;
            
            // Clamp max-width to available horizontal space
            const maxAllowedWidth = vw - margin * 2;
            if (tooltipRect.width > maxAllowedWidth) {
                tooltip.style.maxWidth = `${maxAllowedWidth}px`;
            }
            
            // Horizontal: check centering overflow
            const centeredLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
            const centeredRight = centeredLeft + tooltipRect.width;
            
            if (centeredLeft < margin) {
                tooltip.setAttribute('data-position', 'left');
            } else if (centeredRight > vw - margin) {
                tooltip.setAttribute('data-position', 'right');
            }
            
            // Vertical: if tooltip goes above viewport, show below instead
            const topEdge = triggerRect.top - tooltipRect.height - 8; // 8px gap
            if (topEdge < margin) {
                tooltip.setAttribute('data-position', (tooltip.getAttribute('data-position') || '') + ' below');
                tooltip.classList.add('tooltip-below');
            } else {
                tooltip.classList.remove('tooltip-below');
            }
            
            tooltip.style.removeProperty('visibility');
            tooltip.style.removeProperty('opacity');
        };

        getAllQuery('.tooltip-trigger').forEach(trigger => {
            trigger.addEventListener('mouseenter', () => {
                const tooltip = trigger.querySelector('.tooltip-content');
                if (tooltip) positionTooltip(tooltip);
            });
            trigger.addEventListener('focus', () => {
                const tooltip = trigger.querySelector('.tooltip-content');
                if (tooltip) positionTooltip(tooltip);
            });
        });
    }

    // == UI State Helpers ==
    function showLoadingOverlay(show) {
        if (dom.initialLoadingOverlay) {
            if (show) {
                dom.initialLoadingOverlay.style.display = 'flex';
                dom.initialLoadingOverlay.classList.remove('hidden');
            } else {
                dom.initialLoadingOverlay.classList.add('hidden');
                setTimeout(() => {
                    dom.initialLoadingOverlay.style.display = 'none';
                }, 300);
            }
        }
    }

    function displayGlobalError(msg) {
        if (dom.errorContainer) {
            clearElement(dom.errorContainer);
            
            const iconSpan = createElement('span', {
                className: 'icon icon-error',
                attributes: { 'aria-hidden': 'true' }
            });
            dom.errorContainer.appendChild(iconSpan);

            const strongText = createElement('strong', { textContent: 'Error: ' });
            dom.errorContainer.appendChild(strongText);

            const textNode = document.createTextNode(msg);
            dom.errorContainer.appendChild(textNode);
            
            dom.errorContainer.style.display = 'flex';
        }
    }

    function disableUIOnError() {
        getAllQuery('button, a, input').forEach(el => {
            el.disabled = true;
            if (el.tagName === 'A') el.setAttribute('aria-disabled', 'true');
        });
    }

    function setBusyState(container, isBusy) {
        if (container) container.setAttribute('aria-busy', String(isBusy));
    }

    function updateLink(el, url, text) {
        if (el) {
            el.href = url || '#';
            setText(el, text);
            if (!url) el.setAttribute('aria-disabled', 'true');
            else el.removeAttribute('aria-disabled');
        }
    }

    function showToast(message, type = 'info', duration = TOAST_DEFAULT_DURATION) {
        const toast = createElement('div', {
            className: `toast ${type}`,
            textContent: message
        });
        
        const icon = createElement('span', {
            className: `icon icon-${type === 'success' ? 'check' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info'}`,
            attributes: { 'aria-hidden': 'true' }
        });
        toast.insertBefore(icon, toast.firstChild);
        
        dom.toastContainer.appendChild(toast);
        
        requestAnimationFrame(() => {
            toast.classList.add('show');
            setTimeout(() => { 
                toast.classList.remove('show'); 
                setTimeout(() => toast.remove(), 500); 
            }, duration);
        });
    }

    function createPlaceholderElement(text, type = 'info') {
        const p = createElement('div', {
            className: `placeholder info-message type-${type}`
        });

        const iconSpan = createElement('span', {
            className: `icon icon-${type}`,
            attributes: { 'aria-hidden': 'true' }
        });
        p.appendChild(iconSpan);

        const textSpan = createElement('span', {
            className: 'placeholder-text',
            textContent: text
        });
        p.appendChild(textSpan);

        return p;
    }

    function setupModal() {
        dom.customConfirmModal.style.display = 'none';
        dom.customConfirmModal.setAttribute('aria-hidden', 'true');
        dom.customConfirmModal.classList.remove('visible');
    }

    function showCustomConfirm(title, message) {
        setText(dom.modalTitle, title);
        setText(dom.modalMessage, message);
        dom.customConfirmModal.style.display = 'flex';
        dom.customConfirmModal.classList.add('visible');
        dom.customConfirmModal.setAttribute('aria-hidden', 'false');
        dom.modalConfirmButton.focus();
        return new Promise(resolve => { uninstallConfirmResolver = resolve; });
    }

    function hideCustomConfirm(confirmed) {
        dom.customConfirmModal.classList.remove('visible');
        dom.customConfirmModal.setAttribute('aria-hidden', 'true');
        setTimeout(() => {
            dom.customConfirmModal.style.display = 'none';
            if (uninstallConfirmResolver) uninstallConfirmResolver(confirmed);
        }, 300);
    }

    document.addEventListener('DOMContentLoaded', initializeApp);
})();
