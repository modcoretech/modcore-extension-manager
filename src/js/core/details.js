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
    const PERMISSIONS_JSON_URL = '../js/data/permissions.json';
    const STORAGE_KEY_SUPPORT_CACHE  = 'details_support';
    const SUPPORT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

    // == State Variables ==
    let extensionId = null;
    let extensionInfo = null;
    let supportInfo = null;
    let permissionsData = null;
    let isLoading = true;
    let currentPanel = 'panel-overview';
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

    // == Support Cache (localStorage only, privacy-strict) ==
    const SupportCache = {
        buildKey(extId) {
            return `${STORAGE_KEY_SUPPORT_CACHE}_${extId || 'global'}`;
        },

        get(extId) {
            try {
                const raw = localStorage.getItem(this.buildKey(extId));
                if (!raw) return null;
                const parsed = JSON.parse(raw);
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

            // Non-critical: permissions data can fail without blocking the UI
            try {
                await loadPermissionsData();
            } catch (e) {
                warn('Permissions data load failed, continuing:', e);
            }

            const loaded = await loadExtensionData();
            if (!loaded) {
                throw new Error('Could not load extension data.');
            }

            log('Extension data loaded.');

            // Update UI components individually so one failure doesn't break the rest
            try { updateSidebars(); } catch (e) { err('Sidebar update failed:', e); }
            try { populateOverviewPanel(); } catch (e) { err('Overview panel failed:', e); }
            try { populateActionsPanel(); } catch (e) { err('Actions panel failed:', e); }

            // Listeners - wrap individually so one bad listener doesn't kill the others
            try { setupAllListeners(); } catch (e) { err('Listener setup failed:', e); }
            try { setupSidebarNavigation(); } catch (e) { err('Sidebar navigation failed:', e); }
            try { setupTooltipPositioning(); } catch (e) { err('Tooltip setup failed:', e); }

            requestAnimationFrame(() => switchPanel(currentPanel));

        } catch (e) {
            err('CRITICAL error during initialization:', e);
            displayGlobalError(`Initialization Failed: ${e.message || 'Unknown error'}`);
            // Intentionally NOT disabling the entire UI
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
               dom.leftSidebar && dom.overviewPanel;
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

        // Overview Panel
        dom.overviewPanel            = getElem('panel-overview');
        dom.overviewIcon             = getElem('overview-icon');
        dom.overviewName             = getElem('overview-name');
        dom.overviewStatusBadge      = getElem('overview-status-badge');
        dom.overviewVersion          = getElem('overview-version');
        dom.overviewType             = getElem('overview-type');
        dom.overviewInstallType      = getElem('overview-install-type');
        dom.overviewShortName        = getElem('overview-shortName');
        dom.copyShortNameButton      = getElem('copy-shortname-button');
        dom.overviewId               = getElem('overview-id');
        dom.copyIdButton             = getElem('copy-id-button');
        dom.overviewTypeDetail       = getElem('overview-type-detail');
        dom.overviewEnabled          = getElem('overview-enabled');
        dom.overviewMayDisable       = getElem('overview-mayDisable');
        dom.overviewOfflineEnabled     = getElem('overview-offline-enabled');
        dom.overviewOfflineEnabledWrapper = getElem('overview-offline-enabled-wrapper');
        dom.overviewHomepageUrl      = getElem('overview-homepage-url');
        dom.copyHomepageButton       = getElem('copy-homepage-button');
        dom.overviewUpdateUrl        = getElem('overview-update-url');
        dom.overviewUpdateUrlWrapper = getElem('overview-update-url-wrapper');
        dom.copyUpdateUrlButton      = getElem('copy-update-url-button');
        dom.overviewStoreWrapper     = getElem('overview-store-wrapper');
        dom.overviewStoreUrl         = getElem('overview-store-url');
        dom.overviewOptionsWrapper   = getElem('overview-options-wrapper');
        dom.overviewOptionsUrl       = getElem('overview-options-url');
        dom.overviewDescription      = getElem('overview-description');
        dom.overviewIconsContainer   = getElem('overview-icons-container');
        dom.overviewIconsWrapper     = getElem('overview-icons-wrapper');

        // Actions (now in Overview panel)
        dom.actionEnable    = getElem('action-enable');
        dom.actionOptions   = getElem('action-options');
        dom.actionStore     = getElem('action-store');
        dom.actionUninstall = getElem('action-uninstall');

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
        dom.apiPermCountSpan           = getElem('api-perm-count');
        dom.hostPermCountSpan          = getElem('host-perm-count');
        dom.apiPermissionsList         = getElem('api-permissions-list');
        dom.hostPermissionsList        = getElem('host-permissions-list');

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

    function populateOverviewPanel() {
        if (!extensionInfo) return;
        setBusyState(dom.overviewPanel, true);

        requestAnimationFrame(() => {
            try {
                const isEnabled = extensionInfo.enabled;

                // Hero
                const bestIcon = findBestIconUrl(extensionInfo.icons);
                dom.overviewIcon.src = bestIcon || '../../public/icons/svg/code.svg';
                dom.overviewIcon.alt = `${extensionInfo.name || 'Extension'} icon`;
                setText(dom.overviewName, extensionInfo.name);
                setText(dom.overviewVersion, `v${extensionInfo.version}`);
                setText(dom.overviewType, formatExtensionType(extensionInfo.type));
                setText(dom.overviewInstallType, getInstallTypeDescription(extensionInfo.installType));

                // Status badge
                dom.overviewStatusBadge.textContent = isEnabled ? 'Enabled' : 'Disabled';
                dom.overviewStatusBadge.className = `status-badge ${isEnabled ? 'enabled' : 'disabled'}`;

                // Identity
                setText(dom.overviewShortName, extensionInfo.shortName || 'N/A');
                setText(dom.overviewId, extensionInfo.id);
                setText(dom.overviewTypeDetail, formatExtensionType(extensionInfo.type));

                // Status
                setText(dom.overviewEnabled, isEnabled ? 'Enabled' : 'Disabled');
                setText(dom.overviewMayDisable, formatBoolean(extensionInfo.mayDisable));

                if (extensionInfo.offlineEnabled !== undefined) {
                    dom.overviewOfflineEnabledWrapper.hidden = false;
                    setText(dom.overviewOfflineEnabled, extensionInfo.offlineEnabled ? 'Yes' : 'No');
                } else {
                    dom.overviewOfflineEnabledWrapper.hidden = true;
                }

                // Links
                updateLink(dom.overviewHomepageUrl, extensionInfo.homepageUrl, extensionInfo.homepageUrl || 'N/A');
                dom.copyHomepageButton.disabled = !extensionInfo.homepageUrl;

                if (extensionInfo.updateUrl) {
                    dom.overviewUpdateUrlWrapper.hidden = false;
                    updateLink(dom.overviewUpdateUrl, extensionInfo.updateUrl, extensionInfo.updateUrl);
                    dom.copyUpdateUrlButton.disabled = false;
                } else {
                    dom.overviewUpdateUrlWrapper.hidden = true;
                    dom.copyUpdateUrlButton.disabled = true;
                }

                const isWebStore = extensionInfo.id &&
                    /^[a-z]{32}$/.test(extensionInfo.id) &&
                    extensionInfo.installType === 'normal';
                if (isWebStore) {
                    dom.overviewStoreWrapper.hidden = false;
                    dom.overviewStoreUrl.href = `https://chrome.google.com/webstore/detail/${extensionInfo.id}`;
                    dom.overviewStoreUrl.textContent = 'View in Chrome Web Store';
                } else {
                    dom.overviewStoreWrapper.hidden = true;
                }

                if (extensionInfo.optionsUrl) {
                    dom.overviewOptionsWrapper.hidden = false;
                    dom.overviewOptionsUrl.href = extensionInfo.optionsUrl;
                    dom.overviewOptionsUrl.textContent = 'Open options page';
                } else {
                    dom.overviewOptionsWrapper.hidden = true;
                }

                // About
                setText(dom.overviewDescription, extensionInfo.description || 'No description provided.');

                // Icons
                if (extensionInfo.icons && extensionInfo.icons.length > 0) {
                    dom.overviewIconsWrapper.hidden = false;
                    clearElement(dom.overviewIconsContainer);
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
                    dom.overviewIconsContainer.appendChild(fragment);
                } else {
                    dom.overviewIconsWrapper.hidden = true;
                }

            } catch (e) {
                err('Error populating overview panel:', e);
            } finally {
                setBusyState(dom.overviewPanel, false);
            }
        });
    }

    function populateActionsPanel() {
        if (!extensionInfo) return;
        const isEnabled = extensionInfo.enabled;

        if (dom.actionEnable) {
            const toggleIcon = dom.actionEnable.querySelector('.icon');
            const toggleText = dom.actionEnable.querySelector('#action-enable-text');
            if (toggleIcon) toggleIcon.className = `icon ${isEnabled ? 'icon-toggle-on' : 'icon-toggle-off'}`;
            if (toggleText) toggleText.textContent = isEnabled ? 'Disable' : 'Enable';
            dom.actionEnable.classList.toggle('enabled', isEnabled);
            dom.actionEnable.setAttribute(
                'aria-label',
                isEnabled ? `Disable ${extensionInfo.name}` : `Enable ${extensionInfo.name}`
            );
        }

        if (dom.actionOptions) {
            dom.actionOptions.disabled = !extensionInfo.optionsUrl;
        }

        if (dom.actionStore) {
            const isWebStore = extensionInfo.id &&
                /^[a-z]{32}$/.test(extensionInfo.id) &&
                extensionInfo.installType === 'normal';
            dom.actionStore.disabled = !isWebStore;
            dom.actionStore.hidden = !isWebStore;
            if (isWebStore) {
                dom.actionStore.dataset.storeUrl = `https://chrome.google.com/webstore/detail/${extensionInfo.id}`;
            }
        }

        if (dom.actionUninstall) {
            dom.actionUninstall.disabled = !extensionInfo.mayDisable;
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
            className: `perm-row risk-${def.riskLevel.toLowerCase()}`,
            attributes: {
                'data-permission-name': name,
                'data-permission-type': type,
                'data-permission-risk': def.riskLevel.toLowerCase(),
                'role': 'listitem'
            }
        });

        // Name cell
        const nameCell = createElement('div', {
            className: 'perm-cell perm-name-cell',
            attributes: { 'data-label': 'Permission' }
        });
        const iconSpan = createElement('span', {
            className: `icon ${type === 'host' ? 'icon-host' : 'icon-api'}`,
            attributes: { 'aria-hidden': 'true' }
        });
        nameCell.appendChild(iconSpan);
        const nameText = createElement(type === 'host' ? 'code' : 'span');
        nameText.textContent = name;
        nameCell.appendChild(nameText);
        item.appendChild(nameCell);

        // Type cell
        const typeCell = createElement('div', {
            className: 'perm-cell perm-type-cell',
            attributes: { 'data-label': 'Type' }
        });
        const typeBadge = createElement('span', {
            className: 'type-badge',
            textContent: type === 'host' ? 'Host' : 'API'
        });
        typeCell.appendChild(typeBadge);
        item.appendChild(typeCell);

        // Risk cell
        const riskCell = createElement('div', {
            className: 'perm-cell perm-risk-cell',
            attributes: { 'data-label': 'Risk' }
        });
        const riskBadge = createElement('span', {
            className: `risk-badge ${def.riskLevel.toLowerCase()}`,
            textContent: def.riskLevel
        });
        riskCell.appendChild(riskBadge);
        item.appendChild(riskCell);

        // Description cell
        const descCell = createElement('div', {
            className: 'perm-cell perm-desc-cell',
            attributes: { 'data-label': 'Description' }
        });
        const descText = createElement('p', {
            className: 'perm-desc-text',
            textContent: def.shortDescription
        });
        descCell.appendChild(descText);
        item.appendChild(descCell);

        // Actions cell
        const actionsCell = createElement('div', {
            className: 'perm-cell perm-actions-cell',
            attributes: { 'data-label': 'Actions' }
        });
        const infoButton = createElement('button', {
            className: 'btn secondary btn-sm',
            attributes: {
                'aria-label': `More details about ${name}`,
                'type': 'button'
            }
        });
        infoButton.textContent = 'More info';
        infoButton.addEventListener('click', (e) => {
            e.stopPropagation();
            showPermissionPopup(name, type, def);
        });
        actionsCell.appendChild(infoButton);
        item.appendChild(actionsCell);

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
        try { setupActionListeners(); } catch (e) { err('Action listeners failed:', e); }
        try { setupPermissionControlsListeners(); } catch (e) { err('Permission controls failed:', e); }
        try { setupModalListeners(); } catch (e) { err('Modal listeners failed:', e); }
        try { setupCopyButtonListeners(); } catch (e) { err('Copy buttons failed:', e); }
        try { setupPermissionPopupListeners(); } catch (e) { err('Permission popup listeners failed:', e); }
        try { setupPanelSwitchListeners(); } catch (e) { err('Panel switch listeners failed:', e); }
        try { setupKeyboardNavigation(); } catch (e) { err('Keyboard navigation failed:', e); }
        try { setupGlobalClickListeners(); } catch (e) { err('Global click listeners failed:', e); }
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
        dom.actionEnable?.addEventListener('click', handleEnableToggleClick);
        dom.actionOptions?.addEventListener('click', handleOptionsClick);
        dom.actionStore?.addEventListener('click', handleStoreClick);
        dom.actionUninstall?.addEventListener('click', handleUninstallClick);
    }

    function handleStoreClick() {
        const url = dom.actionStore?.dataset?.storeUrl;
        if (!url) return;
        try {
            if (typeof chrome?.tabs?.create === 'function') {
                chrome.tabs.create({ url }, () => {
                    if (chrome.runtime?.lastError) {
                        window.open(url, '_blank', 'noopener,noreferrer');
                    }
                });
            } else {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
        } catch (e) {
            warn('Error opening store:', e);
            window.open(url, '_blank', 'noopener,noreferrer');
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

            const items = list.querySelectorAll('.perm-row');
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

    function switchPanel(targetId) {
        if (!targetId) return;

        getAllQuery('.content-panel.active').forEach(p => {
            p.classList.remove('active');
        });

        const target = getElem(targetId);
        if (target) {
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
        dom.copyIdButton?.addEventListener('click', () => handleCopyClick(dom.overviewId?.textContent, 'Extension ID', dom.copyIdButton));
        dom.copyShortNameButton?.addEventListener('click', () => handleCopyClick(dom.overviewShortName?.textContent, 'Short Name', dom.copyShortNameButton));
        dom.copyHomepageButton?.addEventListener('click', () => handleCopyClick(dom.overviewHomepageUrl?.href, 'Homepage URL', dom.copyHomepageButton));
        dom.copyUpdateUrlButton?.addEventListener('click', () => handleCopyClick(dom.overviewUpdateUrl?.href, 'Update URL', dom.copyUpdateUrlButton));
    }

    // == Action Handlers ==
    async function handleEnableToggleClick() {
        if (!extensionInfo) return;
        const newState = !extensionInfo.enabled;

        try {
            await chrome.management.setEnabled(extensionId, newState);
            const refreshed = await loadExtensionData();
            if (refreshed) {
                populateOverviewPanel();
                populateActionsPanel();
                showToast(`Extension ${newState ? 'enabled' : 'disabled'}.`, 'success');
            }
        } catch (e) {
            err('Error toggling state:', e);
            showToast(`Failed to toggle state: ${e.message}`, 'error');
            loadExtensionData().then(() => {
                populateOverviewPanel();
                populateActionsPanel();
            });
        }
    }

    function handleOptionsClick() {
        if (!extensionInfo?.optionsUrl) return;
        try {
            if (typeof chrome?.tabs?.create === 'function') {
                chrome.tabs.create({ url: extensionInfo.optionsUrl }, () => {
                    if (chrome.runtime?.lastError) {
                        window.open(extensionInfo.optionsUrl, '_blank', 'noopener,noreferrer');
                    }
                });
            } else {
                window.open(extensionInfo.optionsUrl, '_blank', 'noopener,noreferrer');
            }
        } catch (e) {
            warn('Error opening options page:', e);
            window.open(extensionInfo.optionsUrl, '_blank', 'noopener,noreferrer');
        }
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
            // Intentionally not disabling the entire UI
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

    /**
     * Global click listener: closes filter dropdown when clicking outside.
     */
    function setupGlobalClickListeners() {
        document.addEventListener('click', (e) => {
            if (dom.filterDropdown && dom.filterDropdown.classList.contains('open')) {
                const wrapper = dom.filterBtn?.closest('.filter-dropdown-wrapper');
                if (wrapper && !wrapper.contains(e.target)) {
                    closeAllDropdowns();
                }
            }
        }, true);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (dom.filterDropdown?.classList.contains('open')) {
                    closeAllDropdowns();
                    dom.filterBtn?.focus();
                }
            }
        });
    }

    document.addEventListener('DOMContentLoaded', initializeApp);
})();