/**
 * Details Page Script v3.1 (Cache, UI Fixes, Transparency)
 * Handles displaying extension details, permissions, status, and basic actions.
 */

(() => { // IIFE to encapsulate scope and prevent global variable pollution
    'use strict';

    // == Configuration ==
    const ENABLE_DEV_LOGGING = true; // Set to false for production
    const SEARCH_DEBOUNCE_MS = 150;
    const TOAST_DEFAULT_DURATION = 3500;
    const SUPPORT_DATA_URL = 'https://raw.githubusercontent.com/modcoretech/api/main/modcoreEM/support-data.json';
    const SUPPORT_DATA_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

    // ** Inline Permissions Data (Updated Links for MV3) **
    const ALL_PERMISSIONS_DATA = [
        // Core API Permissions - Links updated to new /api/ reference
        { name: "alarms", description: "Schedule code to run periodically or at a specific time.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/alarms/" },
        { name: "bookmarks", description: "Read, create, and modify your browser bookmarks.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/bookmarks/" },
        { name: "BrowseData", description: "Clear browse data (history, cache, cookies, etc.).", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/BrowseData/" },
        { name: "contentSettings", description: "Control website features (cookies, JavaScript, plugins, etc.) for specific sites.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/contentSettings/" },
        { name: "contextMenus", description: "Add items to the browser's right-click context menu.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/contextMenus/" },
        { name: "cookies", description: "Access, modify, and set browser cookies.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/cookies/" },
        { name: "declarativeContent", description: "Show or hide UI elements based on page content without needing host permissions.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/declarativeContent/" },
        { name: "declarativeNetRequest", description: "Block or modify network requests using a static ruleset.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest/" },
        { name: "declarativeNetRequestWithHostAccess", description: "Includes all `declarativeNetRequest` features plus the ability to redirect requests and modify headers.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequestWithHostAccess/" },
        { name: "declarativeNetRequestFeedback", description: "Observe actions taken by the `declarativeNetRequest` API (for debugging).", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequestFeedback/" },
        { name: "debugger", description: "Access the browser's debugger protocol. Very powerful.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/debugger/" },
        { name: "desktopCapture", description: "Capture screen, window, or tab content as a video stream.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/desktopCapture/" },
        { name: "dns", description: "Resolve domain names programmatically.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/dns/" },
        { name: "documentScan", description: "Access document scanning devices.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/documentScan/" },
        { name: "downloads", description: "Manage downloads (start, monitor, cancel).", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/downloads/" },
        { name: "downloads.shelf", description: "Control the download shelf UI.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/downloads/#method-setShelfEnabled" },
        { name: "downloads.ui", description: "Open the browser's download manager UI.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/downloads/#method-showDefaultFolder" },
        { name: "enterprise.deviceAttributes", description: "Read device attributes on managed ChromeOS devices.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/enterprise_deviceAttributes/" },
        { name: "enterprise.hardwarePlatform", description: "Read hardware platform information on managed devices.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/enterprise_hardwarePlatform/" },
        { name: "enterprise.networkingAttributes", description: "Read network details on managed devices.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/enterprise_networkingAttributes/" },
        { name: "enterprise.platformKeys", description: "Access enterprise client certificates on managed devices.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/enterprise_platformKeys/" },
        { name: "fileBrowserHandler", description: "Extend the ChromeOS file browser.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/fileBrowserHandler/" },
        { name: "fileSystemProvider", description: "Create virtual file systems for the ChromeOS file manager.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/fileSystemProvider/" },
        { name: "fontSettings", description: "Manage browser font settings.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/fontSettings/" },
        { name: "gcm", description: "Receive messages via Google Cloud Messaging.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/gcm/" },
        { name: "geolocation", description: "Allow the extension to get your current geographical location.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/develop/concepts/geolocation" },
        { name: "history", description: "Read and modify your browser history.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/history/" },
        { name: "hid", description: "Connect to Human Interface Devices (HID).", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/hid/" },
        { name: "identity", description: "Get OAuth2 access tokens for user authorization.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/identity/" },
        { name: "idle", description: "Detect when the user's machine idle state changes.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/idle/" },
        { name: "loginState", description: "Read the user's login state (signed in or not).", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/loginState/" },
        { name: "management", description: "Manage other installed apps/extensions. Required for this manager to function.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/management/" },
        { name: "mdns", description: "Discover services over mDNS.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/mdns/" },
        { name: "nativeMessaging", description: "Communicate with native applications on the user's computer.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/nativeMessaging/" },
        { name: "notifications", description: "Create and display rich desktop notifications.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/notifications/" },
        { name: "offscreen", description: "Create and manage offscreen documents for APIs not available in service workers.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/offscreen/" },
        { name: "pageCapture", description: "Save a web page as MHTML format.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/pageCapture/" },
        { name: "platformKeys", description: "Access client certificates managed by the OS.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/platformKeys/" },
        { name: "power", description: "Override system power management.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/power/" },
        { name: "printerProvider", description: "Implement a printer provider, exposing printers to the browser.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/printerProvider/" },
        { name: "printing", description: "Send print jobs to printers.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/printing/" },
        { name: "printingMetrics", description: "Query printer usage statistics.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/printingMetrics/" },
        { name: "privacy", description: "Control privacy-related browser features.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/privacy/" },
        { name: "processes", description: "Access information about the browser's processes.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/processes/" },
        { name: "proxy", description: "Manage browser proxy settings.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/proxy/" },
        { name: "readingList", description: "Read, add, and remove items from the Reading List.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/readingList/" },
        { name: "runtime", description: "Basic runtime info, event listeners, and message passing.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/runtime/" },
        { name: "scripting", description: "Inject scripts/CSS into web pages. Can read/modify page content.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/scripting/" },
        { name: "search", description: "Use the default search provider.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/search/" },
        { name: "sessions", description: "Query and restore recently closed tabs or windows.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/sessions/" },
        { name: "sidePanel", description: "Control UI in the browser's side panel.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/sidePanel/" },
        { name: "storage", description: "Store and retrieve extension data.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/storage/" },
        { name: "system.cpu", description: "Read CPU metadata.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/system_cpu/" },
        { name: "system.display", description: "Query display metadata.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/system_display/" },
        { name: "system.memory", description: "Access physical memory metadata.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/system_memory/" },
        { name: "system.storage", description: "Access storage device metadata.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/system_storage/" },
        { name: "tabCapture", description: "Capture visible tab content as a media stream.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/tabCapture/" },
        { name: "tabGroups", description: "Organize tabs into groups.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups/" },
        { name: "tabs", description: "Access and manipulate browser tabs. Does not grant content access without host permissions.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/tabs/" },
        { name: "topSites", description: "Access the list of most visited sites.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/topSites/" },
        { name: "tts", description: "Use the browser's text-to-speech engine.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/tts/" },
        { name: "ttsEngine", description: "Implement a text-to-speech engine.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/ttsEngine/" },
        { name: "unlimitedStorage", description: "Remove the 5MB limit for `chrome.storage.local`.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/storage/#unlimited-storage-and-service-workers" },
        { name: "vpnProvider", description: "Implement a VPN client.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/vpnProvider/" },
        { name: "wallpaper", description: "Change the ChromeOS wallpaper.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/wallpaper/" },
        { name: "webAuthenticationProxy", description: "Proxy Web Authentication (WebAuthn) requests.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/webAuthenticationProxy/" },
        { name: "webNavigation", description: "Receive notifications about navigation request status.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/webNavigation/" },
        { name: "webRequest", description: "Observe, analyze, and modify network requests.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/webRequest/" },
        { name: "webRequestBlocking", description: "Deprecated in MV3, allows synchronous blocking in webRequest.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/webRequest/#blocking-responses" },
        { name: "windows", description: "Interact with browser windows.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/windows/" },
        // Common non-API permissions
        { name: "activeTab", description: "Grants temporary access to the active tab when the user invokes the extension.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/develop/concepts/activeTab/" },
        { name: "background", description: "Allows the extension to run a service worker in the background.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/mv3/service_workers/" },
        { name: "clipboardRead", description: "Read data from the system clipboard.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/clipboard/" },
        { name: "clipboardWrite", description: "Write data to the system clipboard.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/clipboard/" },
        { name: "identity.email", description: "Get the user's email address.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/identity/#method-getProfileUserInfo" },
        { name: "input.ime", description: "Implement a custom Input Method Editor (IME).", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/input_ime/" },
        { name: "usb", description: "Connect to USB devices.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/usb/" },
        { name: "usbDevices", description: "Find and connect to specific USB devices.", risk: "High", link: "https://developer.chrome.com/docs/extensions/mv3/declare_permissions/#usb-devices" },
        { name: "certificateProvider", description: "Provide client certificates to the browser.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/certificateProvider/" },
        { name: "networking.config", description: "Configure network proxies.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/networking_config/" },
        { name: "accessibilityFeatures.read", description: "Read accessibility features settings (e.g. screen reader support).", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/accessibilityFeatures/#property-accessibilityFeatures.read" },
        { name: "accessibilityFeatures.modify", description: "Modify accessibility settings such as screen magnifier or high contrast mode.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/accessibilityFeatures/#property-accessibilityFeatures.modify" },
        { name: "certificateProvider", description: "Provide client TLS certificates to authenticate users via hardware-backed or software credentials.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/certificateProvider/" },
        { name: "sessions.restore", description: "Allows restoring closed tabs/windows using session ID.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/sessions/#method-restore" },
        { name: "networkState", description: "Query the current network connectivity status.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/networkingPrivate/#method-getState" },
        { name: "system.network", description: "Access system-level network interface metadata (e.g., MAC, IP).", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/system_network/" },
        { name: "storageManaged", description: "Access read-only configuration set by enterprise admins.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/storage/#property-managed" },
        { name: "searchProvider", description: "Replace or modify the default search engine.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/search/" },
        { name: "webRequestAuthProvider", description: "Handle HTTP authentication challenges via extensions.", risk: "High", link: "https://developer.chrome.com/docs/extensions/reference/api/webRequest/#authentication" },
        { name: "notifications.buttons", description: "Add action buttons to notifications for user interactions.", risk: "Low", link: "https://developer.chrome.com/docs/extensions/reference/api/notifications/#type-Button" },
        { name: "userScripts", description: "Register user scripts that run in isolated worlds and only on declared host permissions.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/userScripts/" },
        { name: "downloads.open", description: "Programmatically open downloaded files.", risk: "Medium", link: "https://developer.chrome.com/docs/extensions/reference/api/downloads/#method-open" },

        // Host permissions placeholder
        { name: "host", description: "Access specific websites or patterns (URLs). Grants ability to read and change data on matching sites.", risk: "Varies", link: "https://developer.chrome.com/docs/extensions/mv3/match_patterns/" }
    ];

    // == State Variables ==
    let extensionId = null;
    let extensionInfo = null;
    let supportInfo = null;
    let isLoading = true;
    let currentPanel = 'panel-details';
    let currentPermissionsLayout = 'list';
    let searchDebounceTimeout = null;
    let uninstallConfirmResolver = null;

    // == DOM Elements Cache ==
    const dom = {};

    // == Utility Functions ==
    const log = (...args) => { if (ENABLE_DEV_LOGGING) console.log('[EM Details]', ...args); };
    const warn = (...args) => { if (ENABLE_DEV_LOGGING) console.warn('[EM Details]', ...args); };
    const error = (...args) => { console.error('[EM Details]', ...args); };

    // Ensure all dynamic text content is set via textContent.

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

    // == Initialization ==
    async function initializeApp() {
        const startTime = performance.now();
        log("--- initializeApp Start ---");
        setPageLoading(true);

        try {
            initDomElements();
            log(`DOM elements cached in ${performance.now() - startTime}ms.`);

            if (!dom.initialLoadingOverlay || !dom.contentArea || !dom.errorContainer ||
                !dom.customConfirmModal || !dom.modalTitle || !dom.modalMessage ||
                !dom.modalCancelButton || !dom.modalConfirmButton) {
                 throw new Error("Essential page elements missing. Check HTML for required IDs.");
            }

            if (dom.customConfirmModal) {
                dom.customConfirmModal.style.display = 'none';
                dom.customConfirmModal.setAttribute('aria-hidden', 'true');
                dom.customConfirmModal.classList.remove('visible');
            }

            showLoadingOverlay(true);
            updateCurrentYear();

            extensionId = getExtensionIdFromUrl();
            if (!extensionId) {
                 throw new Error("No Extension ID found in URL parameter 'id'.");
            }
            log("Target Extension ID:", extensionId);

            const extensionDataLoaded = await loadExtensionData();
            loadSupportData(); // Runs in parallel

            if (extensionDataLoaded) {
                log("Extension data loaded successfully.");
                updateSidebarHeader();
                populateAllPanels();
                setupAllListeners();
                requestAnimationFrame(() => {
                     requestAnimationFrame(() => {
                         switchPanel(currentPanel);
                     });
                });
            } else {
                error("Initialization failed: Could not load extension data.");
                disableUIOnError();
            }

        } catch (err) {
            error("CRITICAL error during initialization:", err);
            displayGlobalError(`Initialization Failed: ${err.message || 'Unknown error'}`);
            disableUIOnError();
        } finally {
            showLoadingOverlay(false);
            setPageLoading(false);
            log(`--- initializeApp End in ${performance.now() - startTime}ms (isLoading: ${isLoading}) ---`);
        }
    }

    function setPageLoading(loading) {
        isLoading = loading;
        document.body.setAttribute('aria-busy', loading ? 'true' : 'false');
    }

    function initDomElements() {
        // Sidebar & Global Layout
        dom.sidebarIcon = getElem('sidebar-extension-icon');
        dom.sidebarTitle = getElem('sidebar-extension-title');
        dom.sidebarNav = getQuery('.sidebar-nav');
        dom.currentYearSpan = getElem('current-year');
        dom.contentArea = getQuery('.content-area');
        dom.initialLoadingOverlay = getElem('initial-loading-indicator');
        dom.errorContainer = getElem('error-container');

        // Panels
        dom.detailsPanel = getElem('panel-details');
        dom.permissionsPanel = getElem('panel-permissions');
        dom.supportPanel = getElem('panel-support');

        // Details Panel
        dom.detailsContentWrapper = getElem('details-content-wrapper');
        dom.detailsActualContent = getElem('details-actual-content');
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
        dom.detailsActionsContent = getElem('details-actions-content');
        dom.detailsActualActions = getElem('details-actual-actions');
        dom.enableToggleButton = getElem('enable-toggle-button');
        dom.optionsButton = getElem('options-button');
        dom.storeButton = getElem('store-button');
        dom.uninstallButton = getElem('uninstall-button');

        // Permissions Panel
        dom.permissionsContentWrapper = getElem('permissions-content-wrapper');
        dom.permissionsActualContent = getElem('permissions-actual-content');
        dom.permissionSearchInput = getElem('permission-search-input');
        dom.fiterButton = getElem('filter-btn');
        dom.layoutListButton = getElem('layout-list-btn');
        dom.layoutGridButton = getElem('layout-grid-btn');
        dom.apiPermCountSpan = getElem('api-perm-count');
        dom.hostPermCountSpan = getElem('host-perm-count');
        dom.apiPermissionsList = getElem('api-permissions-list');
        dom.hostPermissionsList = getElem('host-permissions-list');
        dom.permissionsListContainers = getAllQuery('.permissions-list');

        // Support Panel
        dom.supportContentWrapper = getElem('support-content-wrapper');
        dom.supportActualContent = getElem('support-actual-content');

        // Modal & Toast
        dom.toastContainer = getElem('toast-container');
        dom.customConfirmModal = getElem('custom-confirm-modal');
        dom.modalTitle = getElem('modal-title');
        dom.modalMessage = getElem('modal-message');
        dom.modalCancelButton = getElem('modal-cancel-button');
        dom.modalConfirmButton = getElem('modal-confirm-button');
    }

    function getExtensionIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('id');
    }

    function updateCurrentYear() {
        if (dom.currentYearSpan) dom.currentYearSpan.textContent = new Date().getFullYear();
    }

    // == Data Loading ==
    async function loadExtensionData() {
        if (!extensionId) {
             displayGlobalError("Extension ID is missing from the URL.");
             return null;
        }
        try {
            if (typeof window.chrome?.management?.get !== 'function') {
                 throw new Error("`chrome.management` API unavailable. Page must run in a privileged context.");
            }
            const info = await chrome.management.get(extensionId);
            if (!info) {
                 throw new Error(`Extension ID "${extensionId}" not found. It may have been uninstalled.`);
            }
            extensionInfo = info;
            return extensionInfo;
        } catch (err) {
             error("Error loading extension data:", err);
             extensionInfo = null;
             // Using textContent for error message to prevent XSS
             displayGlobalError(`Failed to load details for ID "${extensionId}": ${err.message}.`);
             return null;
        }
    }

    async function loadSupportData() {
        const startTime = performance.now();
        log("Attempting to load support data...");

        try {
            const cachedItem = localStorage.getItem('supportDataCache');
            if (cachedItem) {
                const { timestamp, data } = JSON.parse(cachedItem);
                if (Date.now() - timestamp < SUPPORT_DATA_TTL_MS) {
                    log(`Support data loaded from cache in ${performance.now() - startTime}ms.`);
                    supportInfo = data;
                    populateSupportPanel();
                    return;
                }
            }
        } catch (e) {
            warn("Could not read support data from localStorage.", e);
        }

        log("Fetching support data from:", SUPPORT_DATA_URL);
        try {
            const response = await fetch(SUPPORT_DATA_URL, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`Network response error: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            log(`Support data fetched successfully in ${performance.now() - startTime}ms.`);
            supportInfo = data;

            try {
                const cachePayload = JSON.stringify({ timestamp: Date.now(), data });
                localStorage.setItem('supportDataCache', cachePayload);
                log("Support data cached.");
            } catch (e) {
                warn("Could not write support data to localStorage.", e);
            }

        } catch (err) {
            error("Error loading support data:", err);
            supportInfo = { error: err.message };
        } finally {
            populateSupportPanel();
        }
    }

    // == UI Population & State ==
    function updateSidebarHeader() {
        if (!extensionInfo) return;
        const bestIcon = findBestIconUrl(extensionInfo.icons);
        dom.sidebarIcon.src = bestIcon || '../../public/icons/svg/terminal.svg';
        dom.sidebarIcon.alt = `${extensionInfo.name || 'Extension'} icon`;
        dom.sidebarTitle.textContent = extensionInfo.name || 'Details';
        document.title = `${extensionInfo.name || 'Extension'} Details | modcore EM`;
    }

    function findBestIconUrl(icons, preferredSize = 128) {
        if (!icons || icons.length === 0) return null;
        icons.sort((a, b) => b.size - a.size);
        const suitableIcon = icons.find(icon => icon.size >= preferredSize);
        return suitableIcon ? suitableIcon.url : icons[0].url;
    }

    function populateAllPanels() {
        if (!extensionInfo) return;
        populateDetailsPanel();
        populatePermissionsPanel();
    }
    
    // -- Tooltip Content Helpers --
    function getExtensionTypeTooltip(type) {
        switch (type) {
            case 'extension': return 'A standard browser extension that adds new features or functionality.';
            case 'theme': return 'A special extension that changes the look and feel of the browser.';
            case 'hosted_app': return 'A legacy packaged application that is hosted on the web.';
            case 'packaged_app': return 'A legacy Chrome App that runs in its own window.';
            default: return `The category of the installed item is '${type}'.`;
        }
    }

    function getInstallTypeTooltip(installType) {
        switch (installType) {
            case 'admin': return "Installed and managed by an organization's administrator via enterprise policy.";
            case 'development': return 'Loaded manually by a developer from a local folder for testing purposes.';
            case 'normal': return 'Installed from the official Chrome Web Store.';
            case 'sideload': return 'Installed from a .crx file outside of the Chrome Web Store.';
            case 'other': return 'Installed through another method not covered by other categories.';
            default: return 'Indicates how the extension was installed.';
        }
    }

    function populateDetailsPanel() {
        if (!dom.detailsPanel || !extensionInfo) return;
        setBusyState(dom.detailsContentWrapper, true);
        setBusyState(dom.detailsActionsContent, true);

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
                setText(getQuery('#detail-type-label .tooltip-content'), getExtensionTypeTooltip(extensionInfo.type));
                setText(getQuery('#detail-install-type-label .tooltip-content'), getInstallTypeTooltip(extensionInfo.installType));
                setText(getQuery('#detail-id-label .tooltip-content'), 'A unique 32-character identifier assigned to the extension. Useful for reporting issues or finding it in the web store.');
                setText(getQuery('#detail-mayDisable-label .tooltip-content'), extensionInfo.mayDisable ? 'You have permission to disable or uninstall this extension.' : 'This extension was installed by an administrator via policy and cannot be removed or disabled by you.');

                // Actions
                updateEnableToggleButton(extensionInfo.enabled);
                setElementVisibility(dom.optionsButton, !!extensionInfo.optionsUrl);
                setupStoreButton();
                dom.uninstallButton.disabled = !extensionInfo.mayDisable;
                dom.uninstallButton.title = extensionInfo.mayDisable ? "Uninstall Extension" : "Uninstall restricted by policy";
                dom.uninstallButton.setAttribute('aria-disabled', String(!extensionInfo.mayDisable));

            } catch(err) {
                error("Error populating details panel:", err);
            } finally {
                setBusyState(dom.detailsContentWrapper, false);
                setBusyState(dom.detailsActionsContent, false);
            }
        });
    }

    function getInstallTypeDescription(installType) {
        switch (installType) {
            case 'admin': return 'Administrator Policy';
            case 'development': return 'Developer Mode';
            case 'normal': return 'Chrome Web Store';
            case 'sideload': return 'Sideloaded';
            case 'other': return 'Other';
            default: return 'Unknown';
        }
    }

    function formatExtensionType(type) {
        return type ? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ') : 'N/A';
    }

    function formatBoolean(value) {
        return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : 'N/A';
    }

    function setupStoreButton() {
        if (!dom.storeButton || !extensionInfo) return;
        const isWebStore = extensionInfo.id && /^[a-z]{32}$/.test(extensionInfo.id) && extensionInfo.installType === 'normal';
        const storeUrl = isWebStore ? `https://chrome.google.com/webstore/detail/${extensionInfo.id}` : null;
        setElementVisibility(dom.storeButton, !!storeUrl);
        if (storeUrl) {
            dom.storeButton.href = storeUrl;
        }
    }

    function populatePermissionsPanel() {
        if (!dom.permissionsPanel || !extensionInfo) return;
        setBusyState(dom.permissionsContentWrapper, true);
        requestAnimationFrame(() => {
            try {
                const apiPerms = extensionInfo.permissions || [];
                const hostPerms = extensionInfo.hostPermissions || [];
                setText(dom.apiPermCountSpan, apiPerms.length);
                setText(dom.hostPermCountSpan, hostPerms.length);
                renderPermissionsList(dom.apiPermissionsList, apiPerms, 'api');
                renderPermissionsList(dom.hostPermissionsList, hostPerms, 'host');
                filterPermissions();
                applyPermissionsLayout(currentPermissionsLayout);
            } catch (err) {
                error("Error populating permissions panel", err);
            } finally {
                setBusyState(dom.permissionsContentWrapper, false);
            }
        });
    }
    

    function renderPermissionsList(container, permissions, type) {
        // Clear existing content using a safe method
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        if (!permissions || permissions.length === 0) {
            const text = type === 'api' ? 'No API permissions requested.' : 'No host permissions requested.';
            const placeholder = createPlaceholderElement(text, 'info');
            placeholder.dataset.initialText = text;
            placeholder.dataset.listType = type;
            container.appendChild(placeholder);
            return;
        }

        const fragment = document.createDocumentFragment();
        permissions.forEach(perm => {
            const def = findPermissionDefinition(perm, type);
            fragment.appendChild(createPermissionElement(perm, type, def));
        });
        container.appendChild(fragment);
    }

    const permissionsMap = new Map(ALL_PERMISSIONS_DATA.map(p => [p.name.toLowerCase(), p]));

    function findPermissionDefinition(permissionName, type) {
        if (type === 'host') {
            const baseDef = permissionsMap.get('host');
            let desc = baseDef.description;
            let risk = baseDef.risk;
            if (permissionName === "<all_urls>") {
                desc = "Access data/modify behavior on ALL websites you visit.";
                risk = "High";
            } else {
                // For host patterns, display the pattern literally.
                desc = `Access websites matching pattern: \`${permissionName}\`. Can read and change data on matching sites.`;
                risk = permissionName.includes('*') ? 'Medium' : 'Low';
            }
            return { ...baseDef, name: permissionName, description: desc, risk, link: "https://developer.chrome.com/docs/extensions/mv3/match_patterns/" };
        }
        return permissionsMap.get(permissionName.toLowerCase()) || {
            name: permissionName,
            description: `Access to the '${permissionName}' browser feature.`,
            risk: "Medium",
            link: "https://developer.chrome.com/docs/extensions/reference/permissions/"
        };
    }

    function createPermissionElement(name, type, def) {
        const item = document.createElement('div');
        item.className = 'permission-item';
        item.dataset.permissionName = name.toLowerCase();
        const riskLevel = def.risk.toLowerCase();
        item.classList.add(`risk-${riskLevel}`);

        const header = document.createElement('div');
        header.className = 'permission-item-header';

        const iconSpan = document.createElement('span');
        iconSpan.className = `icon ${type === 'host' ? 'icon-host' : 'icon-api'}`;
        iconSpan.setAttribute('aria-hidden', 'true');
        header.appendChild(iconSpan);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'perm-name';
        if (type === 'host') {
            const code = document.createElement('code');
            code.textContent = name;
            nameSpan.textContent = 'Host: ';
            nameSpan.appendChild(code);
        } else {
            nameSpan.textContent = name;
        }
        header.appendChild(nameSpan);

        const riskIndicator = document.createElement('span');
        riskIndicator.className = `risk-indicator ${riskLevel}`;
        riskIndicator.textContent = `${def.risk} Risk`;
        header.appendChild(riskIndicator);

        item.appendChild(header);

        const descriptionDiv = document.createElement('div');
        descriptionDiv.className = 'permission-item-description';
        descriptionDiv.textContent = def.description;

        if (def.link) {
            const link = document.createElement('a');
            link.href = def.link;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'permission-link';
            link.title = 'View documentation';

            const linkIcon = document.createElement('span');
            linkIcon.className = 'icon icon-link';
            linkIcon.setAttribute('aria-hidden', 'true');
            link.appendChild(linkIcon);
            descriptionDiv.appendChild(link); // Append link to description
        }
        item.appendChild(descriptionDiv);
        return item;
    }

    function createPlaceholderElement(text, type = 'info') {
        const p = document.createElement('div');
        p.className = `placeholder info-message type-${type}`;

        const iconSpan = document.createElement('span');
        iconSpan.className = `icon icon-${type}`;
        iconSpan.setAttribute('aria-hidden', 'true');
        p.appendChild(iconSpan);

        const textSpan = document.createElement('span');
        textSpan.className = 'placeholder-text';
        textSpan.textContent = text;
        p.appendChild(textSpan);

        return p;
    }

    function populateSupportPanel() {
        if (!dom.supportPanel) return;
        setBusyState(dom.supportContentWrapper, true);
        
        requestAnimationFrame(() => {
            // Clear existing content
            dom.supportActualContent.textContent = ''; 
            const fragment = document.createDocumentFragment();

            if (supportInfo && supportInfo.error) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'support-message support-error';
                errorDiv.textContent = '...'; // Initial placeholder
                const h4 = document.createElement('h4');
                h4.textContent = 'Could Not Load Support Information';
                const p = document.createElement('p');
                p.textContent = `Error: ${supportInfo.error}`;
                errorDiv.appendChild(h4);
                errorDiv.appendChild(p);
                fragment.appendChild(errorDiv);
            } else if (supportInfo && extensionId) {
                const extSupport = supportInfo.extensions?.find(ext => ext.id === extensionId);
                if (extSupport?.support) {
                    const supportAvailableDiv = document.createElement('div');
                    supportAvailableDiv.className = 'support-available';

                    const h4 = document.createElement('h4');
                    h4.textContent = 'Show Your Appreciation';
                    supportAvailableDiv.appendChild(h4);

                    const p = document.createElement('p');
                    p.textContent = `If you find ${extensionInfo?.name || 'this extension'} valuable, consider supporting its creator. Your contribution helps fuel future updates.`;
                    supportAvailableDiv.appendChild(p);

                    const supportActionsDiv = document.createElement('div');
                    supportActionsDiv.className = 'support-actions';

                    Object.entries(extSupport.support).forEach(([platform, url]) => {
                        const buttonLink = document.createElement('a');
                        buttonLink.href = url;
                        buttonLink.target = '_blank';
                        buttonLink.rel = 'noopener noreferrer';
                        buttonLink.className = 'btn secondary support-button';
                        buttonLink.textContent = `Support via ${platform}`;
                        supportActionsDiv.appendChild(buttonLink);
                    });
                    supportAvailableDiv.appendChild(supportActionsDiv);
                    fragment.appendChild(supportAvailableDiv);
                } else {
                    const notListedDiv = document.createElement('div');
                    notListedDiv.className = 'support-message support-not-listed';
                    notListedDiv.textContent = ''; // Initial placeholder
                    const h4 = document.createElement('h4');
                    h4.textContent = 'No Support Listing';
                    const p = document.createElement('p');
                    p.textContent = 'This extension hasn’t joined our "Support the Developer" program yet. Developers can apply to receive direct support from users like you. ';

                    const learnMoreLink = document.createElement('a');
                    learnMoreLink.href = 'https://sites.google.com/view/modcore-em-help/manage-extensions/details-page-features#h.sds0564ux3v8';
                    learnMoreLink.target = '_blank';
                    learnMoreLink.rel = 'noopener noreferrer';
                    learnMoreLink.textContent = 'Learn more';
                    learnMoreLink.className = 'learn-more-link';

                    p.appendChild(learnMoreLink);
                    notListedDiv.appendChild(h4);
                    notListedDiv.appendChild(p);
                    fragment.appendChild(notListedDiv);
                }
            }
            
            const disclaimerDiv = document.createElement('div');
            disclaimerDiv.className = 'support-message support-disclaimer';

            const infoIcon = document.createElement('span');
            infoIcon.className = 'icon icon-info';
            infoIcon.setAttribute('aria-hidden', 'true');
            disclaimerDiv.appendChild(infoIcon);

            const textContainer = document.createElement('div');
            const h4Disclaimer = document.createElement('h4');
            h4Disclaimer.textContent = 'Please Note';
            textContainer.appendChild(h4Disclaimer);

            const disclaimerList = document.createElement('ul');
            disclaimerList.className = 'disclaimer-list';

            const disclaimers = [
                'This is a community-driven feature: Links are provided by developers and listed for your convenience.',
                'We do not process payments: All transactions happen on third-party platforms. We do not handle any funds.',
                'We cannot provide refunds or support: We cannot assist with payment disputes, refunds, or other issues.',
                'Verification: We cannot fully verify every link. Please be diligent when providing support.',
                'Internet Connectivity: An active internet connection is required to access payment platforms.'
            ];

            disclaimers.forEach(text => {
                const li = document.createElement('li');
                li.textContent = text;
                disclaimerList.appendChild(li);
            });
            textContainer.appendChild(disclaimerList);
            disclaimerDiv.appendChild(textContainer);
            fragment.appendChild(disclaimerDiv);

            dom.supportActualContent.appendChild(fragment);
            setBusyState(dom.supportContentWrapper, false);
        });
    }

    // == Event Listeners & Handlers ==
    function setupAllListeners() {
        setupSidebarNavigation();
        setupActionListeners();
        setupPermissionControlsListeners();
        setupModalListeners();
        setupCopyButtonListeners();
    }

    function addSafeListener(el, evt, handler) { if (el) el.addEventListener(evt, handler); }

    function setupSidebarNavigation() {
        getAllQuery('.sidebar-button').forEach(btn => addSafeListener(btn, 'click', (e) => switchPanel(e.currentTarget.dataset.panelTarget)));
    }

    function setupActionListeners() {
        addSafeListener(dom.enableToggleButton, 'click', handleEnableToggleClick);
        addSafeListener(dom.optionsButton, 'click', handleOptionsClick);
        addSafeListener(dom.uninstallButton, 'click', handleUninstallClick);
    }

    function setupPermissionControlsListeners() {
        const debouncedSearch = debounce(filterPermissions, SEARCH_DEBOUNCE_MS);
        addSafeListener(dom.permissionSearchInput, 'input', () => debouncedSearch(dom.permissionSearchInput.value));
        addSafeListener(dom.fiterButton, 'click', handlePermissionFilterClick);
        addSafeListener(dom.layoutListButton, 'click', handleLayoutToggle);
        addSafeListener(dom.layoutGridButton, 'click', handleLayoutToggle);
    }

    function setupModalListeners() {
        addSafeListener(dom.modalCancelButton, 'click', () => hideCustomConfirm(false));
        addSafeListener(dom.modalConfirmButton, 'click', () => hideCustomConfirm(true));
        addSafeListener(document, 'keydown', (e) => { if (e.key === 'Escape' && dom.customConfirmModal.classList.contains('visible')) hideCustomConfirm(false); });
        addSafeListener(dom.customConfirmModal, 'click', (e) => { if (e.target === dom.customConfirmModal) hideCustomConfirm(false); });
    }

    function setupCopyButtonListeners() {
        addSafeListener(dom.copyIdButton, 'click', (e) => handleCopyClick(dom.detailId?.textContent, 'Extension ID', e.currentTarget));
        addSafeListener(dom.copyShortNameButton, 'click', (e) => handleCopyClick(dom.detailShortName?.textContent, 'Short Name', e.currentTarget));
        addSafeListener(dom.copyVersionButton, 'click', (e) => handleCopyClick(dom.detailVersion?.textContent, 'Version', e.currentTarget));
        addSafeListener(dom.copyHomepageButton, 'click', (e) => handleCopyClick(dom.detailHomepageUrl?.href, 'Homepage URL', e.currentTarget));
    }

    async function handleEnableToggleClick() {
        if (!extensionInfo || dom.enableToggleButton.disabled) return;
        const newState = !extensionInfo.enabled;
        dom.enableToggleButton.disabled = true;
        try {
            await chrome.management.setEnabled(extensionId, newState);
            const refreshed = await loadExtensionData();
            if (refreshed) {
                populateAllPanels();
                updateSidebarHeader();
                showToast(`Extension ${newState ? 'enabled' : 'disabled'}.`, 'success');
            }
        } catch (err) {
            error("Error toggling state:", err);
            showToast(`Failed to toggle state: ${err.message}`, 'error');
            loadExtensionData().then(populateAllPanels);
        }
    }

    function handleOptionsClick() {
        if (extensionInfo?.optionsUrl) chrome.tabs.create({ url: extensionInfo.optionsUrl });
    }

    async function handleUninstallClick() {
        if (!extensionInfo || dom.uninstallButton.disabled) return;
        // Using textContent for messages
        const confirmed = await showCustomConfirm(
            `Uninstall "${extensionInfo.name}"?`,
            "This action is permanent and will remove the extension and all of its associated data from your browser. Are you sure you want to continue?"
        );
        if (!confirmed) return;
        dom.uninstallButton.disabled = true;
        chrome.management.uninstall(extensionId, { showConfirmDialog: false })
            .then(() => {
                showToast(`"${extensionInfo.name}" uninstalled.`, 'success');
                displayGlobalError(`"${extensionInfo.name}" has been uninstalled. You may close this page.`);
                disableUIOnError();
            })
            .catch(err => {
                showToast(`Uninstall failed: ${err.message}`, 'error');
                dom.uninstallButton.disabled = !extensionInfo.mayDisable;
            });
    }

    async function handleCopyClick(text, label, btn) {
        if (!navigator.clipboard) {
            showToast('Clipboard API unavailable. This may be due to browser settings or an insecure connection.', 'error');
            return;
        }
        if (!text || text.trim() === 'N/A') {
            showToast(`Cannot copy ${label}: Not available.`, 'warning');
            return;
        }
        try {
            await navigator.clipboard.writeText(text.trim());
            showToast(`${label} copied!`, 'success');
        } catch (err) {
            error(`Copy failed for "${label}":`, err);
            showToast(`Could not copy ${label}.`, 'error');
        }
    }

    function updatePlaceholderVisibility(listContainer, visibleCount, searchTerm) {
        const existingPlaceholder = listContainer.querySelector('.placeholder');
        if (visibleCount === 0) {
            if (!existingPlaceholder) {
                const type = listContainer.id === 'api-permissions-list' ? 'api' : 'host';
                const text = searchTerm
                    ? `No ${type.toUpperCase()} permissions match your search.`
                    : (type === 'api' ? 'No API permissions requested.' : 'No host permissions requested.');
                const placeholder = createPlaceholderElement(text, 'info');
                placeholder.dataset.initialText = text;
                placeholder.dataset.listType = type;
                listContainer.appendChild(placeholder);
            } else {
                // Update text if needed
                const type = listContainer.id === 'api-permissions-list' ? 'api' : 'host';
                existingPlaceholder.querySelector('.placeholder-text').textContent = searchTerm
                    ? `No ${type.toUpperCase()} permissions match your search.`
                    : existingPlaceholder.dataset.initialText || (type === 'api' ? 'No API permissions requested.' : 'No host permissions requested.');
            }
        } else if (existingPlaceholder) {
            existingPlaceholder.remove();
        }
    }

    function filterPermissions(term = '') {
        term = term.trim().toLowerCase();
        ['api', 'host'].forEach(type => {
            const list = dom[`${type}PermissionsList`];
            const items = list?.querySelectorAll('.permission-item');
            let visibleCount = 0;
            items?.forEach(item => {
                // Ensure we check textContent of the item, not just dataset.permissionName
                const itemText = item.textContent.toLowerCase();
                const show = !term || item.dataset.permissionName.includes(term) || itemText.includes(term);
                setElementVisibility(item, show);
                if (show) visibleCount++;
            });
            updatePlaceholderVisibility(list, visibleCount, term);
        });
    }

    function handlePermissionFilterClick() {
        if (!dom.fiterButton) return;

        // Persistent filter state
        if (!window.__permissionFilters) {
            window.__permissionFilters = { risk: 'all', scope: 'all' }; // scope = api|host|all
        }
        const permissionFilters = window.__permissionFilters;

        // Create dropdown once
        if (!dom._filterDropdown) {
            const wrapper = document.createElement('div');
            wrapper.className = 'filter-dropdown-wrapper';
            // Insert after filter button
            dom.fiterButton.parentNode.insertBefore(wrapper, dom.fiterButton.nextSibling);

            // Dropdown panel
            const panel = document.createElement('div');
            panel.className = 'filter-dropdown';
            panel.setAttribute('role', 'menu');

            // Risk group
            const riskGroup = document.createElement('div');
            riskGroup.className = 'group';
            const riskTitle = document.createElement('h4');
            riskTitle.textContent = 'Filter by risk';
            riskGroup.appendChild(riskTitle);

            const riskOptions = [
                { id: 'risk-all', label: 'Show all', value: 'all' },
                { id: 'risk-high', label: 'High risk', value: 'high' },
                { id: 'risk-medium', label: 'Medium risk', value: 'medium' },
                { id: 'risk-low', label: 'Low risk', value: 'low' },
            ];
            riskOptions.forEach(opt => {
                const row = document.createElement('div');
                row.className = 'option';
                row.dataset.role = 'risk-option';
                row.dataset.value = opt.value;
                if (opt.value !== 'all') row.dataset.risk = opt.value;
                const dot = document.createElement('span');
                dot.className = 'dot';
                row.appendChild(dot);
                const txt = document.createElement('span');
                txt.textContent = opt.label;
                row.appendChild(txt);
                if (opt.value === permissionFilters.risk) row.classList.add('active');
                row.addEventListener('click', (e) => {
                    permissionFilters.risk = opt.value;
                    // toggle active
                    panel.querySelectorAll('[data-role="risk-option"]').forEach(r => r.classList.remove('active'));
                    row.classList.add('active');
                    // immediately filter
                    filterPermissions(dom.permissionSearchInput?.value || '');
                });
                riskGroup.appendChild(row);
            });
            panel.appendChild(riskGroup);

            // Scope group (api/host/all)
            const scopeGroup = document.createElement('div');
            scopeGroup.className = 'group';
            const scopeTitle = document.createElement('h4');
            scopeTitle.textContent = 'Show';
            scopeGroup.appendChild(scopeTitle);

            const scopeOptions = [
                { id: 'scope-all', label: 'All permissions', value: 'all' },
                { id: 'scope-api', label: 'Only API permissions', value: 'api' },
                { id: 'scope-host', label: 'Only host permissions', value: 'host' },
            ];
            scopeOptions.forEach(opt => {
                const row = document.createElement('div');
                row.className = 'option';
                row.dataset.role = 'scope-option';
                row.dataset.value = opt.value;
                const txt = document.createElement('span');
                txt.textContent = opt.label;
                row.appendChild(txt);
                if (opt.value === permissionFilters.scope) row.classList.add('active');
                row.addEventListener('click', () => {
                    permissionFilters.scope = opt.value;
                    panel.querySelectorAll('[data-role="scope-option"]').forEach(r => r.classList.remove('active'));
                    row.classList.add('active');
                    filterPermissions(dom.permissionSearchInput?.value || '');
                });
                scopeGroup.appendChild(row);
            });
            panel.appendChild(scopeGroup);

            // Footer (clear)
            const footer = document.createElement('div');
            footer.className = 'footer';
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'clear-btn';
            clearBtn.textContent = 'Reset filters';
            clearBtn.addEventListener('click', () => {
                permissionFilters.risk = 'all';
                permissionFilters.scope = 'all';
                panel.querySelectorAll('.option').forEach(o => o.classList.remove('active'));
                // set defaults visually
                panel.querySelector('[data-value="all"]').classList.add('active');
                filterPermissions(dom.permissionSearchInput?.value || '');
            });
            footer.appendChild(clearBtn);
            panel.appendChild(footer);

            wrapper.appendChild(panel);
            dom._filterDropdown = panel;

            // Close dropdown on outside click
            document.addEventListener('click', (ev) => {
                if (!dom._filterDropdown) return;
                if (!wrapper.contains(ev.target) && ev.target !== dom.fiterButton) {
                    dom._filterDropdown.classList.remove('open');
                }
            }, { capture: true });
        }

        // Toggle dropdown visibility
        dom._filterDropdown.classList.toggle('open');

        function filterPermissions(term = '') {
            term = (term || dom.permissionSearchInput?.value || '').trim().toLowerCase();
            const { risk, scope } = permissionFilters;

            ['api', 'host'].forEach(listType => {
                const list = dom[`${listType}PermissionsList`];
                if (!list) return;
                const items = list.querySelectorAll('.permission-item');
                let visibleCount = 0;
                items.forEach(item => {
                    const itemText = item.textContent.toLowerCase();
                    const name = (item.dataset.permissionName || '').toLowerCase();
                    const matchesSearch = !term || name.includes(term) || itemText.includes(term);

                    // Determine item's risk by class
                    const isHigh = item.classList.contains('risk-high');
                    const isMedium = item.classList.contains('risk-medium');
                    const isLow = item.classList.contains('risk-low');

                    let matchesRisk = true;
                    if (risk === 'high') matchesRisk = isHigh;
                    else if (risk === 'medium') matchesRisk = isMedium;
                    else if (risk === 'low') matchesRisk = isLow;

                    // Determine scope match
                    let matchesScope = true;
                    if (scope === 'api' && listType !== 'api') matchesScope = false;
                    if (scope === 'host' && listType !== 'host') matchesScope = false;

                    const show = matchesSearch && matchesRisk && matchesScope;
                    setElementVisibility(item, show);
                    if (show) visibleCount++;
                });
                updatePlaceholderVisibility(list, visibleCount, term);
            });
        }

        // Immediately apply filters once the UI is shown or toggled
        filterPermissions(dom.permissionSearchInput?.value || '');
        
    }

    // Layout toggle handler

    function handleLayoutToggle(event) {
        const layout = event.currentTarget.dataset.layout;
        if (layout && layout !== currentPermissionsLayout) applyPermissionsLayout(layout);
    }

    function applyPermissionsLayout(layout) {
        currentPermissionsLayout = layout;
        dom.layoutListButton.classList.toggle('active', layout === 'list');
        dom.layoutGridButton.classList.toggle('active', layout === 'grid');
        dom.permissionsListContainers.forEach(c => c.className = `permissions-list ${layout}-view`);
    }

    function switchPanel(targetId) {
        if (!targetId) return;
        getAllQuery('.content-panel.active').forEach(p => { p.hidden = true; p.classList.remove('active'); });
        getAllQuery('.sidebar-button.active').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
        const targetPanel = getElem(targetId);
        if (targetPanel) {
            targetPanel.hidden = false;
            targetPanel.classList.add('active');
            targetPanel.focus({ preventScroll: true });
            currentPanel = targetId;
        }
        const activeButton = getQuery(`.sidebar-button[data-panel-target="${targetId}"]`);
        if (activeButton) {
            activeButton.classList.add('active');
            activeButton.setAttribute('aria-current', 'page');
        }
    }

    // == UI State Helpers ==
    function showLoadingOverlay(show) { if (dom.initialLoadingOverlay) dom.initialLoadingOverlay.style.display = show ? 'flex' : 'none'; }
    
    function displayGlobalError(msg) { 
        if (dom.errorContainer) { 
            // Clear existing content
            dom.errorContainer.textContent = ''; 
            
            const iconSpan = document.createElement('span');
            iconSpan.className = 'icon icon-error';
            dom.errorContainer.appendChild(iconSpan);

            const strongText = document.createElement('strong');
            strongText.textContent = 'Error: ';
            dom.errorContainer.appendChild(strongText);

            const textNode = document.createTextNode(msg);
            dom.errorContainer.appendChild(textNode);
            
            setElementVisibility(dom.errorContainer, true); 
        } 
    }

    function disableUIOnError() { getAllQuery('button, a, input').forEach(el => el.disabled = true); }
    function setBusyState(container, isBusy) { if (container) container.setAttribute('aria-busy', String(isBusy)); }
    function setElementVisibility(el, visible) { if (el) { el.hidden = !visible; el.style.display = visible ? '' : 'none'; } }
    function setText(el, text) { if (el) el.textContent = text ?? ''; }
    
    function updateLink(el, url, text) { 
        if (el) { 
            el.href = url || '#'; 
            el.textContent = text; 
            if (!url) el.setAttribute('aria-disabled', 'true'); 
            else el.removeAttribute('aria-disabled'); 
        } 
    }

    function updateEnableToggleButton(isEnabled) {
        if (!dom.enableToggleButton || !extensionInfo) return;
        dom.enableToggleButton.disabled = false;
        setText(dom.enableToggleButton.querySelector('span:not(.icon)'), isEnabled ? 'Enabled' : 'Disabled');
        dom.enableToggleButton.querySelector('.icon').className = `icon ${isEnabled ? 'icon-toggle-on' : 'icon-toggle-off'}`;
        dom.enableToggleButton.classList.toggle('enabled', isEnabled);
    }
    
    function showToast(message, type = 'info', duration = TOAST_DEFAULT_DURATION) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message; // Use textContent for the message
        dom.toastContainer.appendChild(toast);
        requestAnimationFrame(() => {
            toast.classList.add('show');
            setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 500); }, duration);
        });
    }

    // Custom Modal
    function showCustomConfirm(title, message) {
        setText(dom.modalTitle, title);
        dom.modalMessage.textContent = message; // Use textContent for the message
        dom.customConfirmModal.style.display = 'flex';
        dom.customConfirmModal.classList.add('visible');
        dom.modalConfirmButton.focus();
        return new Promise(resolve => { uninstallConfirmResolver = resolve; });
    }

    function hideCustomConfirm(confirmed) {
        dom.customConfirmModal.classList.remove('visible');
        setTimeout(() => {
            dom.customConfirmModal.style.display = 'none';
            if (uninstallConfirmResolver) uninstallConfirmResolver(confirmed);
        }, 300);
    }

    document.addEventListener('DOMContentLoaded', initializeApp);

})(); // End IIFE
