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
    const STORAGE_KEY_SUPPORT_CACHE  = 'details_support';   // unified support cache key
    const STORAGE_KEY_SIDEBAR_STATE  = 'details_sidebar_closed';
    const SUPPORT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

    // == State Variables ==
    let extensionId = null;
    let extensionInfo = null;
    let supportInfo = null;
    let permissionsData = null;
    let isLoading = true;
    let currentPanel = 'panel-permissions';
    let currentPermissionsLayout = 'list';
    let searchDebounceTimeout = null;
    let uninstallConfirmResolver = null;
    let activePermissionPopup = null;
    let isPermissionsLoaded = false;
    let isSupportLoaded = false;
    let isRightSidebarClosed = false;

    // Filter state
    const filterState = {
        risk: new Set(['high', 'medium', 'low', 'varies']),
        type: new Set(['api', 'host']),
        searchTerm: ''
    };

    // == DOM Elements Cache ==
    const dom = {};

    // == Logging ==
    const log  = (...args) => { if (ENABLE_DEV_LOGGING) console.log('[EM Details]', ...args); };
    const warn = (...args) => { if (ENABLE_DEV_LOGGING) console.warn('[EM Details]', ...args); };
    const err  = (...args) => { console.error('[EM Details]', ...args); };

    // == DOM Helpers ==
    const getElem     = (id)               => document.getElementById(id);
    const getQuery    = (sel, p = document) => p.querySelector(sel);
    const getAllQuery  = (sel, p = document) => p.querySelectorAll(sel);

    const debounce = (func, delay) => {
        let id;
        return (...args) => {
            clearTimeout(id);
            id = setTimeout(() => func(...args), delay);
        };
    };

    // Safe DOM helpers: zero innerHTML usage
    const clearElement = (el) => {
        while (el.firstChild) el.removeChild(el.firstChild);
    };

    const setText = (el, text) => {
        if (el) el.textContent = text ?? '';
    };

    const createElement = (tag, options = {}) => {
        const el = document.createElement(tag);
        if (options.className)   el.className   = options.className;
        if (options.id)          el.id           = options.id;
        if (options.textContent) el.textContent  = options.textContent;
        if (options.attributes) {
            Object.entries(options.attributes).forEach(([k, v]) => el.setAttribute(k, v));
        }
        return el;
    };

    // == Support Cache (localStorage only, privacy-strict, no version in key) ==
    const SupportCache = {
        /**
         * Build cache key for a given extension.
         * Key format: details_support_{extensionId}
         * Stored under the unified STORAGE_KEY_SUPPORT_CACHE namespace.
         */
        buildKey(extId) {
            return `${STORAGE_KEY_SUPPORT_CACHE}_${extId || 'global'}`;
        },

        get(extId) {
            try {
                const raw = localStorage.getItem(this.buildKey(extId));
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                // Validate shape: must have timestamp and data
                if (typeof parsed.timestamp !== 'number' || parsed.data === undefined) {
                    this.remove(extId);
                    return null;
                }
                return parsed;
            } catch (e) {
                warn('Cache read error:', e);
                return null;
            }
        },

        set(extId, data) {
            try {
                const payload = JSON.stringify({ timestamp: Date.now(), data });
                localStorage.setItem(this.buildKey(extId), payload);
            } catch (e) {
                warn('Cache write error:', e);
            }
        },

        isValid(entry) {
            if (!entry) return false;
            return (Date.now() - entry.timestamp) < SUPPORT_CACHE_TTL_MS;
        },

        remove(extId) {
            localStorage.removeItem(this.buildKey(extId));
        }
    };

    // == Sidebar State ==
    async function loadSidebarState() {
        try {
            const result = await chrome.storage.local.get([STORAGE_KEY_SIDEBAR_STATE]);
            isRightSidebarClosed = result[STORAGE_KEY_SIDEBAR_STATE] === true;
            applySidebarState(false);
        } catch (e) {
            warn('Failed to load sidebar state:', e);
            isRightSidebarClosed = false;
            applySidebarState(false);
        }
    }

    async function saveSidebarState(closed) {
        try {
            await chrome.storage.local.set({ [STORAGE_KEY_SIDEBAR_STATE]: closed });
            isRightSidebarClosed = closed;
            applySidebarState(true);
        } catch (e) {
            warn('Failed to save sidebar state:', e);
        }
    }

    /**
     * Apply sidebar open/closed state to the DOM.
     * @param {boolean} animate - Whether to allow CSS transitions (true after user interaction,
     *                            false on initial load to avoid flash).
     */
    function applySidebarState(animate) {
        const sidebar  = dom.rightSidebar;
        const reopen   = dom.rightSidebarReopen;
        const content  = dom.contentArea;
        if (!sidebar || !reopen) return;

        if (!animate) {
            // Suppress transition on initial paint
            sidebar.style.transition = 'none';
            content && (content.style.transition = 'none');
            // Force reflow
            sidebar.getBoundingClientRect();
        }

        if (isRightSidebarClosed) {
            sidebar.classList.add('collapsed');
            sidebar.hidden = true;
            reopen.hidden = false;
            content && content.classList.add('right-sidebar-collapsed');
        } else {
            sidebar.classList.remove('collapsed');
            sidebar.hidden = false;
            reopen.hidden = true;
            content && content.classList.remove('right-sidebar-collapsed');
        }

        // Re-enable transition after next frame
        if (!animate) {
            requestAnimationFrame(() => {
                sidebar.style.transition = '';
                content && (content.style.transition = '');
            });
        }

        // Update ARIA
        if (dom.rightSidebarToggle) {
            dom.rightSidebarToggle.setAttribute('aria-label', isRightSidebarClosed ? 'Open sidebar' : 'Close sidebar');
            dom.rightSidebarToggle.title = isRightSidebarClosed ? 'Open sidebar' : 'Close sidebar';
        }
    }

    function toggleRightSidebar() {
        saveSidebarState(!isRightSidebarClosed);
    }

    // == Initialization ==
    async function initializeApp() {
        const t0 = performance.now();
        log('--- initializeApp Start ---');

        try {
            initDomElements();

            if (!validateEssentialElements()) {
                throw new Error('Essential page elements missing.');
            }

            setupModal();
            showLoadingOverlay(true);
            updateCurrentYear();

            extensionId = getExtensionIdFromUrl();
            if (!extensionId) {
                throw new Error("No Extension ID found in URL parameter 'id'.");
            }
            log('Target Extension ID:', extensionId);

            await loadSidebarState();
            await loadPermissionsData();

            const loaded = await loadExtensionData();
            if (loaded) {
                log('Extension data loaded.');
                updateSidebars();
                populateRightSidebar();
                setupAllListeners();
                setupSidebarNavigation();
                setupTooltipPositioning();

                requestAnimationFrame(() => switchPanel(currentPanel));
            } else {
                throw new Error('Could not load extension data.');
            }

        } catch (e) {
            err('CRITICAL error during initialization:', e);
            displayGlobalError(`Initialization Failed: ${e.message || 'Unknown error'}`);
            disableUIOnError();
        } finally {
            setTimeout(() => {
                showLoadingOverlay(false);
                setPageLoading(false);
            }, 300);
            log(`--- initializeApp End in ${Math.round(performance.now() - t0)}ms ---`);
        }
    }

    function validateEssentialElements() {
        return dom.initialLoadingOverlay && dom.contentArea && dom.errorContainer &&
               dom.customConfirmModal && dom.modalTitle && dom.modalMessage &&
               dom.modalCancelButton && dom.modalConfirmButton &&
               dom.leftSidebar && dom.rightSidebar;
    }

    function setPageLoading(loading) {
        isLoading = loading;
        document.body.setAttribute('aria-busy', loading ? 'true' : 'false');
    }

    function initDomElements() {
        // Left Sidebar
        dom.leftSidebar        = getElem('left-sidebar');
        dom.sidebarIcon        = getElem('sidebar-extension-icon');
        dom.sidebarTitle       = getElem('sidebar-extension-title');
        dom.currentYearSpan    = getElem('current-year');

        // Right Sidebar
        dom.rightSidebar       = getElem('right-sidebar');
        dom.rightSidebarToggle = getElem('right-sidebar-toggle');
        dom.rightSidebarReopen = getElem('right-sidebar-reopen');

        // Actions
        dom.actionEnableToggle = getElem('action-enable-toggle');
        dom.actionOptions      = getElem('action-options');
        dom.actionStore        = getElem('action-store');
        dom.actionUninstall    = getElem('action-uninstall');

        // Metadata
        dom.detailName                   = getElem('detail-name');
        dom.detailShortName              = getElem('detail-shortName-text');
        dom.copyShortNameButton          = getElem('copy-shortname-button');
        dom.detailVersion                = getElem('detail-version-text');
        dom.copyVersionButton            = getElem('copy-version-button');
        dom.detailId                     = getElem('detail-id');
        dom.copyIdButton                 = getElem('copy-id-button');
        dom.detailType                   = getElem('detail-type');
        dom.detailInstallType            = getElem('detail-install-type');
        dom.detailMayDisable             = getElem('detail-mayDisable');
        dom.detailDescription            = getElem('detail-description');
        dom.detailHomepageUrl            = getElem('detail-homepage-url');
        dom.copyHomepageButton           = getElem('copy-homepage-button');
        dom.detailOfflineEnabled         = getElem('detail-offline-enabled');
        dom.detailOfflineEnabledWrapper  = getElem('detail-offline-enabled-wrapper');
        dom.detailUpdateUrl              = getElem('detail-update-url');
        dom.detailUpdateUrlWrapper       = getElem('detail-update-url-wrapper');
        dom.copyUpdateUrlButton          = getElem('copy-update-url-button');
        dom.detailIconsContainer         = getElem('detail-icons-container');
        dom.detailIconsWrapper           = getElem('detail-icons-wrapper');

        // Content
        dom.contentArea              = getQuery('.content-area');
        dom.initialLoadingOverlay    = getElem('initial-loading-indicator');
        dom.errorContainer           = getElem('error-container');

        // Panels
        dom.permissionsPanel = getElem('panel-permissions');
        dom.supportPanel     = getElem('panel-support');

        // Permissions Panel
        dom.permissionsContentWrapper  = getElem('permissions-content-wrapper');
        dom.permissionSearchInput      = getElem('permission-search-input');
        dom.filterBtn                  = getElem('filter-btn');
        dom.filterDropdown             = getElem('filter-dropdown-panel');
        dom.layoutListButton           = getElem('layout-list-btn');
        dom.layoutGridButton           = getElem('layout-grid-btn');
        dom.apiPermCountSpan           = getElem('api-perm-count');
        dom.hostPermCountSpan          = getElem('host-perm-count');
        dom.apiPermissionsList         = getElem('api-permissions-list');
        dom.hostPermissionsList        = getElem('host-permissions-list');
        dom.permissionsListContainers  = getAllQuery('.permissions-list');

        // Support Panel
        dom.supportContentWrapper  = getElem('support-content-wrapper');
        dom.supportEmptyState      = getElem('support-empty-state');
        dom.supportDynamicContent  = getElem('support-dynamic-content');

        // Modal and Toast
        dom.toastContainer        = getElem('toast-container');
        dom.customConfirmModal    = getElem('custom-confirm-modal');
        dom.modalTitle            = getElem('modal-title');
        dom.modalMessage          = getElem('modal-message');
        dom.modalCancelButton     = getElem('modal-cancel-button');
        dom.modalConfirmButton    = getElem('modal-confirm-button');

        // Permission Popup
        dom.permissionPopup              = getElem('permission-popup');
        dom.permissionPopupOverlay       = getElem('permission-popup-overlay');
        dom.permissionPopupClose         = getElem('permission-popup-close');
        dom.permissionPopupTitle         = getElem('permission-popup-title');
        dom.permissionPopupRisk          = getElem('permission-popup-risk');
        dom.permissionPopupCategory      = getElem('permission-popup-category');
        dom.permissionPopupShortDesc     = getElem('permission-popup-short-desc');
        dom.permissionPopupDetailedDesc  = getElem('permission-popup-detailed-desc');
        dom.permissionPopupUseCases      = getElem('permission-popup-use-cases');
        dom.permissionPopupMitigation    = getElem('permission-popup-mitigation');
        dom.permissionPopupLink          = getElem('permission-popup-link');
    }

    function getExtensionIdFromUrl() {
        return new URLSearchParams(window.location.search).get('id');
    }

    function updateCurrentYear() {
        if (dom.currentYearSpan) {
            dom.currentYearSpan.textContent = new Date().getFullYear().toString();
        }
    }

    // == Data Loading ==
    async function loadPermissionsData() {
        try {
            const response = await fetch(PERMISSIONS_JSON_URL, { cache: 'no-cache' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            permissionsData = await response.json();
            log('Permissions data loaded.');
        } catch (e) {
            err('Failed to load permissions.json:', e);
            permissionsData = { permissions: {}, categories: {}, riskLevels: {} };
            showToast('Failed to load permission details', 'warning');
        }
    }

    async function loadExtensionData() {
        if (!extensionId) {
            displayGlobalError('Extension ID is missing from the URL.');
            return null;
        }
        try {
            if (typeof window.chrome?.management?.get !== 'function') {
                throw new Error('`chrome.management` API unavailable.');
            }
            const info = await chrome.management.get(extensionId);
            if (!info) throw new Error(`Extension ID "${extensionId}" not found.`);
            extensionInfo = info;
            return extensionInfo;
        } catch (e) {
            err('Error loading extension data:', e);
            extensionInfo = null;
            displayGlobalError(`Failed to load details for ID "${extensionId}": ${e.message}.`);
            return null;
        }
    }

    async function loadSupportData() {
        if (isSupportLoaded) return;

        const cached = SupportCache.get(extensionId);
        if (SupportCache.isValid(cached)) {
            log('Support data loaded from cache.');
            supportInfo = cached.data;
            populateSupportPanel();
            isSupportLoaded = true;
            return;
        }

        setBusyState(dom.supportContentWrapper, true);

        try {
            const response = await fetch(SUPPORT_DATA_URL, { cache: 'no-cache' });
            if (!response.ok) throw new Error(`Network response error: ${response.status}`);
            const data = await response.json();

            const extSupport = data.extensions?.find(ext => ext.id === extensionId);
            supportInfo = extSupport
                ? { extensions: [extSupport], meta: data.meta }
                : { extensions: [], meta: data.meta };

            SupportCache.set(extensionId, supportInfo);
            log('Support data fetched and cached.');

        } catch (e) {
            err('Error loading support data:', e);
            supportInfo = { error: e.message };
        } finally {
            populateSupportPanel();
            setBusyState(dom.supportContentWrapper, false);
            isSupportLoaded = true;
        }
    }

    // == UI Population ==
    function updateSidebars() {
        if (!extensionInfo) return;
        const bestIcon = findBestIconUrl(extensionInfo.icons);

        dom.sidebarIcon.src = bestIcon || '../../public/icons/svg/code.svg';
        dom.sidebarIcon.alt = `${extensionInfo.name || 'Extension'} icon`;
        dom.sidebarTitle.textContent = extensionInfo.name || 'Extension';

        document.title = `${extensionInfo.name || 'Extension'} Details | modcore EM`;
    }

    function populateRightSidebar() {
        if (!extensionInfo) return;
        setBusyState(dom.rightSidebar, true);

        requestAnimationFrame(() => {
            try {
                const isEnabled = extensionInfo.enabled;

                // Enable/Disable toggle button (now in Actions)
                const toggleIcon = dom.actionEnableToggle.querySelector('.icon');
                const toggleText = dom.actionEnableToggle.querySelector('span:not(.icon)');
                if (toggleIcon) {
                    toggleIcon.className = `icon ${isEnabled ? 'icon-toggle-on' : 'icon-toggle-off'}`;
                }
                if (toggleText) {
                    toggleText.textContent = isEnabled ? 'Disable' : 'Enable';
                }
                dom.actionEnableToggle.classList.toggle('enabled', isEnabled);
                dom.actionEnableToggle.setAttribute(
                    'aria-label',
                    isEnabled ? `Disable ${extensionInfo.name}` : `Enable ${extensionInfo.name}`
                );
                dom.actionEnableToggle.setAttribute(
                    'aria-pressed',
                    isEnabled ? 'true' : 'false'
                );

                // Actions
                dom.actionOptions.disabled = !extensionInfo.optionsUrl;

                const isWebStore = extensionInfo.id &&
                    /^[a-z]{32}$/.test(extensionInfo.id) &&
                    extensionInfo.installType === 'normal';
                dom.actionStore.disabled = !isWebStore;
                if (isWebStore) {
                    dom.actionStore.dataset.storeUrl =
                        `https://chrome.google.com/webstore/detail/${extensionInfo.id}`;
                }

                dom.actionUninstall.disabled = !extensionInfo.mayDisable;

                // Metadata
                setText(dom.detailName, extensionInfo.name);
                setText(dom.detailShortName, extensionInfo.shortName || 'N/A');
                setText(dom.detailVersion, extensionInfo.version);
                setText(dom.detailId, extensionInfo.id);
                setText(dom.detailType, formatExtensionType(extensionInfo.type));
                setText(dom.detailInstallType, getInstallTypeDescription(extensionInfo.installType));
                setText(dom.detailMayDisable, formatBoolean(extensionInfo.mayDisable));
                setText(dom.detailDescription, extensionInfo.description || 'No description provided.');

                updateLink(dom.detailHomepageUrl, extensionInfo.homepageUrl, extensionInfo.homepageUrl || 'N/A');
                dom.copyHomepageButton.disabled = !extensionInfo.homepageUrl;

                populateAdditionalMetadata();

            } catch (e) {
                err('Error populating right sidebar:', e);
            } finally {
                setBusyState(dom.rightSidebar, false);
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
                        alt: `${icon.size}x${icon.size} icon`,
                        title: `${icon.size}x${icon.size}`,
                        loading: 'lazy'
                    }
                });
                fragment.appendChild(img);
            });
            dom.detailIconsContainer.appendChild(fragment);
        } else {
            dom.detailIconsWrapper.hidden = true;
        }
    }

    function findBestIconUrl(icons, preferredSize = 128) {
        if (!icons || icons.length === 0) return null;
        const sorted = [...icons].sort((a, b) => b.size - a.size);
        const suitable = sorted.find(icon => icon.size >= preferredSize);
        return suitable ? suitable.url : sorted[0].url;
    }

    function getInstallTypeDescription(installType) {
        const map = {
            admin: 'Administrator Policy',
            development: 'Developer Mode',
            normal: 'Chrome Web Store',
            sideload: 'Sideloaded',
            other: 'Other'
        };
        return map[installType] || 'Unknown';
    }

    function formatExtensionType(type) {
        return type
            ? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ')
            : 'N/A';
    }

    function formatBoolean(value) {
        return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : 'N/A';
    }

    // == Permissions Panel ==
    function populatePermissionsPanel() {
        if (!dom.permissionsPanel || !extensionInfo) return;
        setBusyState(dom.permissionsContentWrapper, true);

        requestAnimationFrame(() => {
            try {
                const apiPerms  = extensionInfo.permissions || [];
                const hostPerms = extensionInfo.hostPermissions || [];
                setText(dom.apiPermCountSpan, apiPerms.length.toString());
                setText(dom.hostPermCountSpan, hostPerms.length.toString());
                renderPermissionsList(dom.apiPermissionsList, apiPerms, 'api');
                renderPermissionsList(dom.hostPermissionsList, hostPerms, 'host');
                applyFilters();
                applyPermissionsLayout(currentPermissionsLayout);
            } catch (e) {
                err('Error populating permissions panel', e);
            } finally {
                setBusyState(dom.permissionsContentWrapper, false);
            }
        });
    }

    function renderPermissionsList(container, permissions, type) {
        clearElement(container);

        if (!permissions || permissions.length === 0) {
            const text = type === 'api'
                ? 'No API permissions requested.'
                : 'No host permissions requested.';
            const placeholder = createPlaceholderElement(text, 'info');
            placeholder.dataset.listType = type;
            container.appendChild(placeholder);
            return;
        }

        const fragment = document.createDocumentFragment();
        permissions.forEach((perm, index) => {
            const def  = findPermissionDefinition(perm, type);
            const item = createPermissionElement(perm, type, def);
            item.style.animationDelay = `${index * 25}ms`;
            fragment.appendChild(item);
        });
        container.appendChild(fragment);
    }

    function findPermissionDefinition(permissionName, type) {
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

            if (permissionName === '<all_urls>') {
                riskLevel = 'high';
                description = 'Access data and modify behavior on ALL websites you visit.';
            } else if (permissionName.includes('*')) {
                riskLevel = 'medium';
                description = `Access websites matching pattern: "${permissionName}". Can read and change data on matching sites.`;
            } else {
                riskLevel = 'low';
                description = `Access specific site: "${permissionName}". Can read and change data on this site.`;
            }

            return { ...baseDef, name: permissionName, shortDescription: description, riskLevel, isHostPermission: true };
        }

        return permData[permissionName] || {
            name: permissionName,
            shortDescription: `Access to the '${permissionName}' browser feature.`,
            detailedDescription: `This permission grants access to the ${permissionName} API.`,
            category: ['functionality'],
            riskLevel: 'medium',
            requiresHostPermission: false,
            chromeLink: `https://developer.chrome.com/docs/extensions/reference/${permissionName}/`,
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
                'data-permission-risk': def.riskLevel.toLowerCase(),
                'role': 'listitem'
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
            const labelText = document.createTextNode('Host: ');
            nameSpan.appendChild(labelText);
            const code = createElement('code');
            code.textContent = name;
            nameSpan.appendChild(code);
        } else {
            nameSpan.textContent = name;
        }
        header.appendChild(nameSpan);

        const riskIndicator = createElement('span', {
            className: `risk-indicator ${def.riskLevel.toLowerCase()}`,
            textContent: `${def.riskLevel} Risk`,
            attributes: { 'aria-label': `Risk level: ${def.riskLevel}` }
        });
        header.appendChild(riskIndicator);

        item.appendChild(header);

        const descriptionDiv = createElement('div', {
            className: 'permission-item-description',
            textContent: def.shortDescription
        });

        const menuButton = createElement('button', {
            className: 'btn-icon permission-menu-btn',
            attributes: {
                'aria-label': `More details about ${name}`,
                'title': 'View detailed information',
                'type': 'button'
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

        closePermissionPopup();
        activePermissionPopup = { name, type, def };

        setText(dom.permissionPopupTitle, type === 'host' ? `Host: ${name}` : name);

        const riskConfig = permissionsData?.riskLevels?.[def.riskLevel.toLowerCase()];
        dom.permissionPopupRisk.className = `permission-popup-risk risk-${def.riskLevel.toLowerCase()}`;
        setText(dom.permissionPopupRisk, riskConfig?.name || `${def.riskLevel} Risk`);
        dom.permissionPopupRisk.style.backgroundColor = riskConfig?.containerColor || '';
        dom.permissionPopupRisk.style.color = riskConfig?.color || '';

        clearElement(dom.permissionPopupCategory);
        (def.category || []).forEach(cat => {
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

        setText(dom.permissionPopupShortDesc, def.shortDescription);
        setText(dom.permissionPopupDetailedDesc, def.detailedDescription || 'No detailed description available.');

        clearElement(dom.permissionPopupUseCases);
        const useCases = (def.commonUseCases && def.commonUseCases.length > 0)
            ? def.commonUseCases
            : ['General extension functionality'];
        useCases.forEach(uc => {
            const li = createElement('li', { textContent: uc });
            dom.permissionPopupUseCases.appendChild(li);
        });

        clearElement(dom.permissionPopupMitigation);
        const tips = (def.mitigationTips && def.mitigationTips.length > 0)
            ? def.mitigationTips
            : ['Review permission carefully before granting'];
        tips.forEach(tip => {
            const li = createElement('li', { textContent: tip });
            dom.permissionPopupMitigation.appendChild(li);
        });

        if (def.chromeLink) {
            dom.permissionPopupLink.href = def.chromeLink;
            dom.permissionPopupLink.hidden = false;
        } else {
            dom.permissionPopupLink.hidden = true;
        }

        dom.permissionPopupOverlay.classList.add('visible');
        dom.permissionPopupOverlay.setAttribute('aria-hidden', 'false');
        dom.permissionPopup.classList.add('visible');
        document.body.style.overflow = 'hidden';

        dom.permissionPopupClose.focus();
    }

    function closePermissionPopup() {
        if (!dom.permissionPopup) return;
        dom.permissionPopupOverlay.classList.remove('visible');
        dom.permissionPopupOverlay.setAttribute('aria-hidden', 'true');
        dom.permissionPopup.classList.remove('visible');
        document.body.style.overflow = '';
        activePermissionPopup = null;
    }

    // == Support Panel ==
    function populateSupportPanel() {
        if (!dom.supportPanel) return;

        const dynamicContent = dom.supportDynamicContent;
        const emptyState     = dom.supportEmptyState;
        clearElement(dynamicContent);

        if (supportInfo?.error) {
            emptyState.hidden = true;
            dynamicContent.hidden = false;

            const errorDiv = createElement('div', { className: 'support-message support-error' });

            const iconSpan = createElement('span', {
                className: 'icon icon-error',
                attributes: { 'aria-hidden': 'true' }
            });
            errorDiv.appendChild(iconSpan);

            const contentDiv = createElement('div');
            const errorTitle = createElement('h4', { textContent: 'Could Not Load Support Information' });
            const errorText  = createElement('p', { textContent: `Error: ${supportInfo.error}` });
            contentDiv.appendChild(errorTitle);
            contentDiv.appendChild(errorText);
            errorDiv.appendChild(contentDiv);

            dynamicContent.appendChild(errorDiv);
            return;
        }

        const extSupport = supportInfo?.extensions?.find(ext => ext.id === extensionId);

        if (!extSupport || !extSupport.support || Object.keys(extSupport.support).length === 0) {
            emptyState.hidden = false;
            dynamicContent.hidden = true;
            return;
        }

        emptyState.hidden = true;
        dynamicContent.hidden = false;

        const fragment    = document.createDocumentFragment();
        const supportCard = createElement('div', { className: 'support-card' });

        // Developer header
        const devHeader = createElement('div', { className: 'support-card-header' });
        const avatar    = createElement('div', { className: 'dev-avatar' });
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
                attributes: {
                    href: `mailto:${extSupport.supportEmail}`,
                    'aria-label': `Email developer: ${extSupport.supportEmail}`
                }
            });
            const emailIcon = createElement('span', {
                className: 'icon icon-info',
                attributes: { 'aria-hidden': 'true', style: 'width:14px;height:14px;' }
            });
            emailLink.appendChild(emailIcon);
            emailLink.appendChild(document.createTextNode(extSupport.supportEmail));
            devInfo.appendChild(emailLink);
        }

        devHeader.appendChild(devInfo);
        supportCard.appendChild(devHeader);

        // Description
        if (extSupport.description) {
            const descSection = createElement('div', { className: 'support-message-section' });
            const descTitle   = createElement('h4', { textContent: 'About' });
            const descText    = createElement('p', { textContent: extSupport.description });
            descSection.appendChild(descTitle);
            descSection.appendChild(descText);
            supportCard.appendChild(descSection);
        }

        // Stats
        if (extSupport.stats && Object.keys(extSupport.stats).length > 0) {
            const statsSection = createElement('div', { className: 'support-stats' });
            Object.entries(extSupport.stats).forEach(([key, value]) => {
                const statItem  = createElement('div', { className: 'stat-item' });
                const statValue = createElement('span', { className: 'stat-value', textContent: value });
                const statLabel = createElement('span', {
                    className: 'stat-label',
                    textContent: key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
                });
                statItem.appendChild(statValue);
                statItem.appendChild(statLabel);
                statsSection.appendChild(statItem);
            });
            supportCard.appendChild(statsSection);
        }

        // Support buttons
        const actionsDiv = createElement('div', { className: 'support-actions' });
        Object.entries(extSupport.support).forEach(([platform, url]) => {
            const button = createElement('a', {
                className: 'btn secondary support-button',
                attributes: {
                    href: url.trim(),
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    'data-platform': platform,
                    'aria-label': `Visit ${platform} (opens in new tab)`
                }
            });

            const icon = createElement('span', {
                className: 'icon icon-link',
                attributes: { 'aria-hidden': 'true' }
            });
            button.appendChild(icon);
            button.appendChild(document.createTextNode(platform));
            actionsDiv.appendChild(button);
        });

        supportCard.appendChild(actionsDiv);
        fragment.appendChild(supportCard);
        dynamicContent.appendChild(fragment);
    }

    // == Event Listeners ==
    function setupAllListeners() {
        setupActionListeners();
        setupPermissionControlsListeners();
        setupModalListeners();
        setupCopyButtonListeners();
        setupPermissionPopupListeners();
        setupPanelSwitchListeners();
        setupKeyboardNavigation();
        setupSidebarToggleListeners();
        setupGlobalClickListeners();
    }

    function setupSidebarToggleListeners() {
        dom.rightSidebarToggle?.addEventListener('click', toggleRightSidebar);
        dom.rightSidebarReopen?.addEventListener('click', toggleRightSidebar);
    }

    /**
     * Global click listener: closes filter dropdown when clicking outside it.
     * This is the fix for the "tapping outside doesn't close filter" bug.
     */
    function setupGlobalClickListeners() {
        document.addEventListener('click', (e) => {
            // Close filter dropdown if click is outside the wrapper
            if (dom.filterDropdown && dom.filterDropdown.classList.contains('open')) {
                const wrapper = dom.filterBtn?.closest('.filter-dropdown-wrapper');
                if (wrapper && !wrapper.contains(e.target)) {
                    closeAllDropdowns();
                }
            }
        }, true); // Use capture phase to catch all clicks

        // Also close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (dom.filterDropdown?.classList.contains('open')) {
                    closeAllDropdowns();
                    dom.filterBtn?.focus();
                }
            }
        });
    }

    function setupSidebarNavigation() {
        getAllQuery('.nav-item[data-panel-target]', dom.leftSidebar).forEach(item => {
            item.addEventListener('click', () => {
                const target = item.dataset.panelTarget;
                switchPanel(target);
                updateSidebarActiveState(target);
            });
        });
    }

    function updateSidebarActiveState(targetId) {
        getAllQuery('.nav-item[data-panel-target]', dom.leftSidebar).forEach(item => {
            const isActive = item.dataset.panelTarget === targetId;
            item.classList.toggle('active', isActive);
            item.setAttribute('aria-current', isActive ? 'true' : 'false');
        });
    }

    function setupKeyboardNavigation() {
        // Arrow key navigation in left sidebar
        dom.leftSidebar.addEventListener('keydown', (e) => {
            const items = Array.from(getAllQuery('.nav-item:not([disabled])', dom.leftSidebar));
            const idx = items.indexOf(document.activeElement);

            switch (e.key) {
                case 'ArrowDown': {
                    e.preventDefault();
                    items[(idx < items.length - 1 ? idx + 1 : 0)]?.focus();
                    break;
                }
                case 'ArrowUp': {
                    e.preventDefault();
                    items[(idx > 0 ? idx - 1 : items.length - 1)]?.focus();
                    break;
                }
                case 'Home': {
                    e.preventDefault();
                    items[0]?.focus();
                    break;
                }
                case 'End': {
                    e.preventDefault();
                    items[items.length - 1]?.focus();
                    break;
                }
            }
        });

        // Focus trap in modal
        dom.customConfirmModal.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const focusable = Array.from(dom.customConfirmModal.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            ));
            const first = focusable[0];
            const last  = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                last.focus(); e.preventDefault();
            } else if (!e.shiftKey && document.activeElement === last) {
                first.focus(); e.preventDefault();
            }
        });

        // Focus trap in permission popup
        dom.permissionPopup?.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab' || !activePermissionPopup) return;
            const focusable = Array.from(dom.permissionPopup.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            ));
            const first = focusable[0];
            const last  = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                last.focus(); e.preventDefault();
            } else if (!e.shiftKey && document.activeElement === last) {
                first.focus(); e.preventDefault();
            }
        });
    }

    function setupPanelSwitchListeners() {
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

        [dom.permissionsPanel, dom.supportPanel].forEach(panel => {
            if (panel) observer.observe(panel, { attributes: true });
        });
    }

    function setupPermissionPopupListeners() {
        dom.permissionPopupClose?.addEventListener('click', closePermissionPopup);
        dom.permissionPopupOverlay?.addEventListener('click', closePermissionPopup);
    }

    function setupActionListeners() {
        dom.actionEnableToggle.addEventListener('click', handleEnableToggleClick);
        dom.actionOptions.addEventListener('click', handleOptionsClick);
        dom.actionStore.addEventListener('click', handleStoreClick);
        dom.actionUninstall.addEventListener('click', handleUninstallClick);
    }

    function handleStoreClick() {
        if (dom.actionStore.dataset.storeUrl) {
            chrome.tabs.create({ url: dom.actionStore.dataset.storeUrl });
        }
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
                // Focus first interactive element in dropdown for accessibility
                requestAnimationFrame(() => {
                    const firstInput = dom.filterDropdown.querySelector('input');
                    firstInput?.focus();
                });
            }
        });

        getAllQuery('input[name="risk-filter"]', dom.filterDropdown).forEach(cb => {
            cb.addEventListener('change', () => {
                updateFilterState();
                applyFilters();
            });
        });

        getAllQuery('input[name="type-filter"]', dom.filterDropdown).forEach(cb => {
            cb.addEventListener('change', () => {
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
        getAllQuery('input[name="risk-filter"]:checked', dom.filterDropdown).forEach(cb => filterState.risk.add(cb.value));
        getAllQuery('input[name="type-filter"]:checked', dom.filterDropdown).forEach(cb => filterState.type.add(cb.value));
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
                    itemName.toLowerCase().includes(searchTerm) ||
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
        const existing = listContainer.querySelector('.placeholder');

        if (visibleCount === 0) {
            if (!existing) {
                const text = searchTerm
                    ? `No ${listType} permissions match your filters.`
                    : (listType === 'api' ? 'No API permissions requested.' : 'No host permissions requested.');
                const placeholder = createPlaceholderElement(text, 'info');
                listContainer.appendChild(placeholder);
            } else {
                const textSpan = existing.querySelector('.placeholder-text');
                if (textSpan && searchTerm) {
                    textSpan.textContent = `No ${listType} permissions match your filters.`;
                }
            }
        } else if (existing) {
            existing.remove();
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
        dom.layoutListButton.setAttribute('aria-pressed', layout === 'list' ? 'true' : 'false');
        dom.layoutGridButton.classList.toggle('active', layout === 'grid');
        dom.layoutGridButton.setAttribute('aria-pressed', layout === 'grid' ? 'true' : 'false');
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

        const target = getElem(targetId);
        if (target) {
            target.hidden = false;
            target.classList.add('active');
            target.focus({ preventScroll: true });
            currentPanel = targetId;
        }
    }

    function closeAllDropdowns() {
        if (dom.filterDropdown) {
            dom.filterDropdown.classList.remove('open');
            dom.filterBtn.setAttribute('aria-expanded', 'false');
        }
    }

    function setupTooltipPositioning() {
        const positionTooltip = (tooltip) => {
            const trigger = tooltip.parentElement;
            if (!trigger) return;

            tooltip.removeAttribute('data-position');
            tooltip.style.removeProperty('max-width');
            tooltip.style.visibility = 'hidden';
            tooltip.style.opacity = '0';

            const tr = trigger.getBoundingClientRect();
            const tp = tooltip.getBoundingClientRect();
            const vw = window.innerWidth;
            const margin = 10;

            const maxW = vw - margin * 2;
            if (tp.width > maxW) tooltip.style.maxWidth = `${maxW}px`;

            const centeredLeft  = tr.left + tr.width / 2 - tp.width / 2;
            const centeredRight = centeredLeft + tp.width;

            if (centeredLeft < margin) {
                tooltip.setAttribute('data-position', 'left');
            } else if (centeredRight > vw - margin) {
                tooltip.setAttribute('data-position', 'right');
            }

            const topEdge = tr.top - tp.height - 8;
            if (topEdge < margin) {
                tooltip.classList.add('tooltip-below');
            } else {
                tooltip.classList.remove('tooltip-below');
            }

            tooltip.style.removeProperty('visibility');
            tooltip.style.removeProperty('opacity');
        };

        getAllQuery('.tooltip-trigger').forEach(trigger => {
            trigger.addEventListener('mouseenter', () => {
                const tt = trigger.querySelector('.tooltip-content');
                if (tt) positionTooltip(tt);
            });
            trigger.addEventListener('focus', () => {
                const tt = trigger.querySelector('.tooltip-content');
                if (tt) positionTooltip(tt);
            });
        });
    }

    // == Modal ==
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
            uninstallConfirmResolver = null;
        }, 300);
    }

    function setupModalListeners() {
        dom.modalCancelButton.addEventListener('click', () => hideCustomConfirm(false));
        dom.modalConfirmButton.addEventListener('click', () => hideCustomConfirm(true));
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && dom.customConfirmModal.classList.contains('visible')) {
                hideCustomConfirm(false);
            }
            if (e.key === 'Escape' && activePermissionPopup) {
                closePermissionPopup();
            }
        });
        dom.customConfirmModal.addEventListener('click', (e) => {
            if (e.target === dom.customConfirmModal) hideCustomConfirm(false);
        });
    }

    // == Copy Buttons ==
    function setupCopyButtonListeners() {
        dom.copyIdButton.addEventListener('click',
            () => handleCopyClick(dom.detailId?.textContent, 'Extension ID', dom.copyIdButton));
        dom.copyShortNameButton.addEventListener('click',
            () => handleCopyClick(dom.detailShortName?.textContent, 'Short Name', dom.copyShortNameButton));
        dom.copyVersionButton.addEventListener('click',
            () => handleCopyClick(dom.detailVersion?.textContent, 'Version', dom.copyVersionButton));
        dom.copyHomepageButton.addEventListener('click',
            () => handleCopyClick(dom.detailHomepageUrl?.href, 'Homepage URL', dom.copyHomepageButton));
        dom.copyUpdateUrlButton.addEventListener('click',
            () => handleCopyClick(dom.detailUpdateUrl?.href, 'Update URL', dom.copyUpdateUrlButton));
    }

    // == Action Handlers ==
    async function handleEnableToggleClick() {
        if (!extensionInfo) return;
        const newState = !extensionInfo.enabled;

        try {
            await chrome.management.setEnabled(extensionId, newState);
            const refreshed = await loadExtensionData();
            if (refreshed) {
                populateRightSidebar();
                showToast(`Extension ${newState ? 'enabled' : 'disabled'}.`, 'success');
            }
        } catch (e) {
            err('Error toggling state:', e);
            showToast(`Failed to toggle state: ${e.message}`, 'error');
            loadExtensionData().then(() => populateRightSidebar());
        }
    }

    function handleOptionsClick() {
        if (extensionInfo?.optionsUrl) chrome.tabs.create({ url: extensionInfo.optionsUrl });
    }

    async function handleUninstallClick() {
        if (!extensionInfo) return;

        const confirmed = await showCustomConfirm(
            `Uninstall "${extensionInfo.name}"?`,
            'This action is permanent and will remove the extension and all of its associated data from your browser. Are you sure you want to continue?'
        );

        if (!confirmed) return;

        try {
            await chrome.management.uninstall(extensionId, { showConfirmDialog: false });
            SupportCache.remove(extensionId);
            showToast(`"${extensionInfo.name}" uninstalled.`, 'success');
            displayGlobalError(`"${extensionInfo.name}" has been uninstalled. You may close this page.`);
            disableUIOnError();
        } catch (e) {
            showToast(`Uninstall failed: ${e.message}`, 'error');
        }
    }

    async function handleCopyClick(text, label, btn) {
        if (!navigator.clipboard) {
            showToast('Clipboard API unavailable.', 'error');
            return;
        }
        const trimmed = text?.trim();
        if (!trimmed || trimmed === 'N/A' || trimmed === '#') {
            showToast(`Cannot copy ${label}: Not available.`, 'warning');
            return;
        }
        try {
            await navigator.clipboard.writeText(trimmed);
            showToast(`${label} copied!`, 'success');
            if (btn) {
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 1500);
            }
        } catch (e) {
            err(`Copy failed for "${label}":`, e);
            showToast(`Could not copy ${label}.`, 'error');
        }
    }

    // == UI State Helpers ==
    function showLoadingOverlay(show) {
        if (!dom.initialLoadingOverlay) return;
        if (show) {
            dom.initialLoadingOverlay.style.display = 'flex';
            dom.initialLoadingOverlay.classList.remove('hidden');
        } else {
            dom.initialLoadingOverlay.classList.add('hidden');
            setTimeout(() => {
                dom.initialLoadingOverlay.style.display = 'none';
            }, 400);
        }
    }

    function displayGlobalError(msg) {
        if (!dom.errorContainer) return;
        clearElement(dom.errorContainer);

        const iconSpan = createElement('span', {
            className: 'icon icon-error',
            attributes: { 'aria-hidden': 'true' }
        });
        dom.errorContainer.appendChild(iconSpan);

        const strong = createElement('strong', { textContent: 'Error: ' });
        dom.errorContainer.appendChild(strong);
        dom.errorContainer.appendChild(document.createTextNode(msg));

        dom.errorContainer.removeAttribute('hidden');
        dom.errorContainer.style.display = 'flex';
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
        if (!el) return;
        el.href = url || '#';
        setText(el, text);
        if (!url || url === '#') el.setAttribute('aria-disabled', 'true');
        else el.removeAttribute('aria-disabled');
    }

    function showToast(message, type = 'info', duration = TOAST_DEFAULT_DURATION) {
        const toast = createElement('div', { className: `toast ${type}` });

        const iconName = type === 'success' ? 'check'
            : type === 'error'   ? 'error'
            : type === 'warning' ? 'warning'
            : 'info';

        const icon = createElement('span', {
            className: `icon icon-${iconName}`,
            attributes: { 'aria-hidden': 'true' }
        });
        toast.appendChild(icon);
        toast.appendChild(document.createTextNode(message));

        dom.toastContainer.appendChild(toast);

        requestAnimationFrame(() => {
            // Force reflow for animation
            toast.getBoundingClientRect();
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 400);
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

    document.addEventListener('DOMContentLoaded', initializeApp);
})();