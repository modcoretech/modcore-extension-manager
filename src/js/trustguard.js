// trustguard.js - Enhanced Script for TrustGuard Analysis Page

(function() {
    // Cache DOM elements
    const extensionIcon = document.getElementById('extension-icon');
    const extensionName = document.getElementById('extension-name');
    const trustScoreValue = document.getElementById('trust-score-value');
    const trustScoreCategory = document.getElementById('trust-score-category');
    const trustScoreExplanation = document.getElementById('score-explanation');
    const allPermissionsList = document.getElementById('all-permissions-list');
    const toastContainer = document.getElementById('toast-container');
    const singleExtensionView = document.getElementById('single-extension-view');
    const allExtensionsView = document.getElementById('all-extensions-view');
    const allExtensionsList = document.getElementById('all-extensions-list');
    const permissionCountList = document.getElementById('permission-count-list');
    const riskRatingList = document.getElementById('risk-rating-list');
    const filteredExtensionsView = document.getElementById('filtered-extensions-view');
    const filteredExtensionsList = document.getElementById('filtered-extensions-list');
    const filteredViewHeader = document.getElementById('filtered-view-header');
    const permissionSearchInput = document.getElementById('permission-search-input');
    const permissionSynergyTable = document.getElementById('permission-synergy-table');
    const whatIfSandbox = document.getElementById('what-if-sandbox');
    const whatIfScoreValue = document.getElementById('what-if-score-value');
    const whatIfScoreCategory = document.getElementById('what-if-score-category');
    const privacyScoreGraph = document.getElementById('privacy-score-graph');
    const securityScoreGraph = document.getElementById('security-score-graph');
    const anomalyReport = document.getElementById('anomaly-report');
    const leastPrivilegeRecommendations = document.getElementById('least-privilege-recommendations');


    // Back button functionality
    document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
        window.location.href = 'trustguard.html';
    });
    document.getElementById('back-from-filtered-btn').addEventListener('click', () => {
        allExtensionsView.style.display = 'block';
        filteredExtensionsView.style.display = 'none';
    });

    // --- ENHANCED: Comprehensive Permission Definitions with assigned risk points and categories ---
    const PERMISSION_INFO = {
        // CRITICAL RISK (High score) - High potential for severe security or privacy breaches
        "<all_urls>": { level: "critical", base_risk_points: 90, type: "data_access", categories: ["Security", "Privacy"], description: "Allows the extension to read and change *all* your data on *every* website you visit. This is the highest potential for privacy invasion and malicious activity.", link: "https://developer.chrome.com/docs/extensions/reference/manifest/host_permissions" },
        "scripting": { level: "critical", base_risk_points: 85, type: "code_injection", categories: ["Security", "Privacy"], description: "Allows the extension to inject and run arbitrary JavaScript on web pages. This can be used to steal passwords, data, or hijack sessions.", link: "https://developer.chrome.com/docs/extensions/reference/scripting/" },
        "debugger": { level: "critical", base_risk_points: 95, type: "development_tools", categories: ["Security"], description: "Grants access to the browser's powerful debugger tools. If misused, it can inspect, manipulate, and intercept network traffic on a profound level, posing a critical security risk.", link: "https://developer.chrome.com/docs/extensions/reference/debugger/" },
        "nativeMessaging": { level: "critical", base_risk_points: 100, type: "system_interaction", categories: ["Security"], description: "Permits communication with native applications installed on your computer. This creates a bridge from the browser to your local system, which is a major security vulnerability.", link: "https://developer.chrome.com/docs/extensions/reference/nativeMessaging/" },
        "proxy": { level: "critical", base_risk_points: 95, type: "network_control", categories: ["Security", "Privacy"], description: "Allows the extension to control your browser's proxy settings. It can re-route all your internet traffic through a potentially malicious server, capturing all your data.", link: "https://developer.chrome.com/docs/extensions/reference/proxy/" },
        "webRequest": { level: "critical", base_risk_points: 80, type: "network_control", categories: ["Security", "Privacy"], description: "Enables the extension to observe and analyze network traffic. It can be used for tracking or surveillance, even if it doesn't modify the content.", link: "https://developer.chrome.com/docs/extensions/reference/webRequest/" },
        "webRequestBlocking": { level: "critical", base_risk_points: 85, type: "network_control", categories: ["Security", "Privacy"], description: "Allows the extension to block and modify network requests. While essential for ad blockers, it can also be used to censor content or redirect to malicious sites.", link: "https://developer.chrome.com/docs/extensions/reference/webRequest/#event-onBeforeRequest" },
        "identity": { level: "critical", base_risk_points: 75, type: "account_access", categories: ["Security", "Privacy"], description: "Get OAuth2 access tokens for user authorization. This could grant access to your Google account services.", link: "https://developer.chrome.com/docs/extensions/reference/identity/" },
        "identity.email": { level: "critical", base_risk_points: 70, type: "account_access", categories: ["Privacy"], description: "Get the user's email address. This is sensitive personal data.", link: "https://developer.chrome.com/docs/extensions/reference/identity/#get-email" },
        "input.ime": { level: "critical", base_risk_points: 85, type: "system_interaction", categories: ["Security"], description: "Implement a custom Input Method Editor (IME). Could be used to log keystrokes.", link: "https://developer.chrome.com/docs/extensions/reference/input_ime/" },
        "usb": { level: "critical", base_risk_points: 90, type: "system_interaction", categories: ["Security"], description: "Connect to USB devices. This creates a bridge from the browser to physical hardware.", link: "https://developer.chrome.com/docs/extensions/reference/usb/" },
        "usbDevices": { level: "critical", base_risk_points: 90, type: "system_interaction", categories: ["Security"], description: "Find and connect to specific USB devices.", link: "https://developer.chrome.com/docs/extensions/reference/usb/#method-getDevices" },
        "certificateProvider": { level: "critical", base_risk_points: 95, type: "system_interaction", categories: ["Security"], description: "Provide client TLS certificates to authenticate users via hardware-backed or software credentials.", link: "https://developer.chrome.com/docs/extensions/reference/certificateProvider/" },
        "networking.config": { level: "critical", base_risk_points: 95, type: "network_control", categories: ["Security"], description: "Configure network proxies. Similar to `proxy` permission.", link: "https://developer.chrome.com/docs/extensions/reference/networking_config/" },
        "accessibilityFeatures.modify": { level: "critical", base_risk_points: 80, type: "ui_interaction", categories: ["Security"], description: "Modify accessibility settings such as screen magnifier or high contrast mode. Can be used to interfere with user's browser experience.", link: "https://developer.chrome.com/docs/extensions/reference/accessibilityFeatures/" },
        "fileSystemProvider": { level: "critical", base_risk_points: 95, type: "system_interaction", categories: ["Security"], description: "Create virtual file systems for the ChromeOS file manager. Can be a major security risk.", link: "https://developer.chrome.com/docs/extensions/reference/fileSystemProvider/" },
        "vpnProvider": { level: "critical", base_risk_points: 95, type: "network_control", categories: ["Security", "Privacy"], description: "Implement a VPN client. Can reroute all network traffic and log sensitive data.", link: "https://developer.chrome.com/docs/extensions/reference/vpnProvider/" },
        "webAuthenticationProxy": { level: "critical", base_risk_points: 90, type: "security_feature", categories: ["Security"], description: "Proxy Web Authentication (WebAuthn) requests. This could be used to intercept or manipulate secure login requests.", link: "https://developer.chrome.com/docs/extensions/reference/webAuthenticationProxy/" },
        "searchProvider": { level: "critical", base_risk_points: 75, type: "browser_control", categories: ["Security", "Privacy"], description: "Replace or modify the default search engine. Can redirect searches to malicious or tracking-heavy sites.", link: "https://developer.chrome.com/docs/extensions/reference/search/" },
        "webRequestAuthProvider": { level: "critical", base_risk_points: 85, type: "network_control", categories: ["Security"], description: "Handle HTTP authentication challenges via extensions. This could expose credentials.", link: "https://developer.chrome.com/docs/extensions/reference/webRequestAuthProvider/" },
        "history": { level: "high", base_risk_points: 65, type: "data_access", categories: ["Privacy"], description: "Enables reading and modifying your browser's navigation history. This can reveal sensitive information about your Browse habits.", link: "https://developer.chrome.com/docs/extensions/reference/history/" },
        "cookies": { level: "high", base_risk_points: 60, type: "data_access", categories: ["Privacy"], description: "Grants access to your browser cookies. Cookies are used to store login sessions and track online activity, making this a significant privacy risk.", link: "https://developer.chrome.com/docs/extensions/reference/cookies/" },
        "clipboardRead": { level: "high", base_risk_points: 55, type: "system_interaction", categories: ["Privacy"], description: "Allows the extension to read data directly from your system clipboard. This could capture sensitive information like passwords or personal messages.", link: "https://developer.chrome.com/docs/extensions/reference/clipboard/#method-readText" },
        "geolocation": { level: "high", base_risk_points: 58, type: "privacy_sensitive", categories: ["Privacy"], description: "Allows access to your precise geographical location. This is highly sensitive personal data.", link: "https://developer.chrome.com/docs/extensions/reference/geolocation/" },
        "tabCapture": { level: "high", base_risk_points: 62, type: "data_access", categories: ["Privacy"], description: "Enables capturing the visible content (video and audio) of a browser tab. This is a significant privacy concern as it allows 'screen-scraping' of your activity.", link: "https://developer.chrome.com/docs/extensions/reference/tabCapture/" },
        "webNavigation": { level: "high", base_risk_points: 60, type: "browser_control", categories: ["Privacy"], description: "Allows the extension to receive detailed events about page navigation. This can be used to create a comprehensive map of your Browse behavior.", link: "https://developer.chrome.com/docs/extensions/reference/webNavigation/" },
        "management": { level: "high", base_risk_points: 65, type: "browser_control", categories: ["Security"], description: "Grants the ability to manage other installed extensions. This could be used maliciously to disable your security extensions. Required for this manager to function.", link: "https://developer.chrome.com/docs/extensions/reference/management/" },
        "BrowseData": { level: "high", base_risk_points: 70, type: "browser_control", categories: ["Privacy"], description: "Clear browse data (history, cache, cookies, etc.). Can be used maliciously to erase evidence of tracking or to cause data loss.", link: "https://developer.chrome.com/docs/extensions/reference/BrowseData/" },
        "declarativeNetRequestWithHostAccess": { level: "high", base_risk_points: 70, type: "network_control", categories: ["Security", "Privacy"], description: "Includes all `declarativeNetRequest` features plus the ability to redirect requests and modify headers. Powerful for content modification and tracking.", link: "https://developer.chrome.com/docs/extensions/reference/declarativeNetRequestWithHostAccess/" },
        "enterprise.platformKeys": { level: "high", base_risk_points: 75, type: "system_interaction", categories: ["Security"], description: "Access enterprise client certificates on managed devices. A critical security function for enterprise users.", link: "https://developer.chrome.com/docs/extensions/reference/enterprise_platformKeys/" },
        "platformKeys": { level: "high", base_risk_points: 75, type: "system_interaction", categories: ["Security"], description: "Access client certificates managed by the OS.", link: "https://developer.chrome.com/docs/extensions/reference/platformKeys/" },
        "sessions.restore": { level: "high", base_risk_points: 55, type: "data_access", categories: ["Privacy"], description: "Allows restoring closed tabs/windows using session ID. Can expose recent Browse activity.", link: "https://developer.chrome.com/docs/extensions/reference/sessions/" },
        "bookmarks": { level: "moderate", base_risk_points: 40, type: "data_access", categories: ["Privacy", "Functionality"], description: "Read, create, and modify your browser bookmarks. Misuse could lead to data loss or manipulation of your saved links.", link: "https://developer.chrome.com/docs/extensions/reference/bookmarks/" },
        "contentSettings": { level: "moderate", base_risk_points: 45, type: "browser_control", categories: ["Security", "Privacy"], description: "Control website features (cookies, JavaScript, plugins, etc.) for specific sites. Can be used to relax security settings.", link: "https://developer.chrome.com/docs/extensions/reference/contentSettings/" },
        "declarativeNetRequest": { level: "moderate", base_risk_points: 35, type: "network_control", categories: ["Security"], description: "Block or modify network requests using a static ruleset. Common for ad blockers, but still grants a level of network control.", link: "https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/" },
        "desktopCapture": { level: "moderate", base_risk_points: 50, type: "data_access", categories: ["Privacy"], description: "Capture screen, window, or tab content as a video stream. A direct privacy risk if used without consent.", link: "https://developer.chrome.com/docs/extensions/reference/desktopCapture/" },
        "documentScan": { level: "moderate", base_risk_points: 45, type: "system_interaction", categories: ["Security"], description: "Access document scanning devices. Potentially sensitive data access.", link: "https://developer.chrome.com/docs/extensions/reference/documentScan/" },
        "downloads": { level: "moderate", base_risk_points: 35, type: "browser_control", categories: ["Functionality"], description: "Manage downloads (start, monitor, cancel). It could potentially track or interfere with files you download.", link: "https://developer.chrome.com/docs/extensions/reference/downloads/" },
        "enterprise.deviceAttributes": { level: "moderate", base_risk_points: 40, type: "data_access", categories: ["Privacy"], description: "Read device attributes on managed ChromeOS devices. Can expose hardware information.", link: "https://developer.chrome.com/docs/extensions/reference/enterprise_deviceAttributes/" },
        "enterprise.networkingAttributes": { level: "moderate", base_risk_points: 45, type: "data_access", categories: ["Privacy"], description: "Read network details on managed devices.", link: "https://developer.chrome.com/docs/extensions/reference/enterprise_networkingAttributes/" },
        "fileBrowserHandler": { level: "moderate", base_risk_points: 40, type: "system_interaction", categories: ["Security"], description: "Extend the ChromeOS file browser. Grants a level of access to the file system.", link: "https://developer.chrome.com/docs/extensions/reference/fileBrowserHandler/" },
        "gcm": { level: "moderate", base_risk_points: 35, type: "data_transfer", categories: ["Privacy"], description: "Receive messages via Google Cloud Messaging. Can be used for tracking or data exfiltration.", link: "https://developer.chrome.com/docs/extensions/reference/gcm/" },
        "pageCapture": { level: "moderate", base_risk_points: 35, type: "data_access", categories: ["Privacy"], description: "Save a web page as MHTML format. Can capture all content on a page.", link: "https://developer.chrome.com/docs/extensions/reference/pageCapture/" },
        "printerProvider": { level: "moderate", base_risk_points: 40, type: "system_interaction", categories: ["Functionality"], description: "Implement a printer provider, exposing printers to the browser.", link: "https://developer.chrome.com/docs/extensions/reference/printerProvider/" },
        "printing": { level: "moderate", base_risk_points: 35, type: "system_interaction", categories: ["Functionality"], description: "Send print jobs to printers.", link: "https://developer.chrome.com/docs/extensions/reference/printing/" },
        "privacy": { level: "moderate", base_risk_points: 50, type: "browser_control", categories: ["Security", "Privacy"], description: "Control privacy-related browser features. Could be used to disable privacy protections.", link: "https://developer.chrome.com/docs/extensions/reference/privacy/" },
        "processes": { level: "moderate", base_risk_points: 45, type: "system_interaction", categories: ["Security"], description: "Access information about the browser's processes. Can be used for fingerprinting or monitoring.", link: "https://developer.chrome.com/docs/extensions/reference/processes/" },
        "readingList": { level: "moderate", base_risk_points: 35, type: "data_access", categories: ["Privacy"], description: "Read, add, and remove items from the Reading List.", link: "https://developer.chrome.com/docs/extensions/reference/readingList/" },
        "sessions": { level: "moderate", base_risk_points: 40, type: "data_access", categories: ["Privacy"], description: "Query and restore recently closed tabs or windows. Can expose recent Browse activity.", link: "https://developer.chrome.com/docs/extensions/reference/sessions/" },
        "system.network": { level: "moderate", base_risk_points: 35, type: "data_access", categories: ["Privacy"], description: "Access system-level network interface metadata (e.g., MAC, IP). Can be used for fingerprinting.", link: "https://developer.chrome.com/docs/extensions/reference/system_network/" },
        "userScripts": { level: "moderate", base_risk_points: 45, type: "code_injection", categories: ["Security"], description: "Register user scripts that run in isolated worlds and only on declared host permissions. Can modify page behavior.", link: "https://developer.chrome.com/docs/extensions/reference/userScripts/" },
        "downloads.open": { level: "moderate", base_risk_points: 35, type: "system_interaction", categories: ["Security"], description: "Programmatically open downloaded files. Can be used to launch malicious files.", link: "https://developer.chrome.com/docs/extensions/reference/downloads/" },
        "tabs": { level: "moderate", base_risk_points: 30, type: "browser_control", categories: ["Functionality", "Privacy"], description: "Enables access to the URLs and titles of your open tabs. While needed for tab management tools, it can be used to monitor your Browse activity.", link: "https://developer.chrome.com/docs/extensions/reference/tabs/" },
        "tabGroups": { level: "moderate", base_risk_points: 30, type: "browser_control", categories: ["Functionality"], description: "Organize tabs into groups.", link: "https://developer.chrome.com/docs/extensions/reference/tabGroups/" },
        "topSites": { level: "moderate", base_risk_points: 35, type: "data_access", categories: ["Privacy"], description: "Access the list of most visited sites. Can reveal Browse habits.", link: "https://developer.chrome.com/docs/extensions/reference/topSites/" },
        "windows": { level: "moderate", base_risk_points: 30, type: "browser_control", categories: ["Functionality"], description: "Interact with browser windows.", link: "https://developer.chrome.com/docs/extensions/reference/windows/" },
        "host": { level: "moderate", base_risk_points: 55, type: "data_access", categories: ["Security", "Privacy"], description: "Access specific websites or patterns (URLs). Grants ability to read and change data on matching sites.", custom_risk: true, link: "https://developer.chrome.com/docs/extensions/reference/manifest/host_permissions" },
        "alarms": { level: "low", base_risk_points: 5, type: "system_interaction", categories: ["Functionality"], description: "Schedule code to run periodically or at a specific time.", link: "https://developer.chrome.com/docs/extensions/reference/alarms/" },
        "contextMenus": { level: "low", base_risk_points: 5, type: "ui_interaction", categories: ["Functionality"], description: "Add items to the browser's right-click context menu.", link: "https://developer.chrome.com/docs/extensions/reference/contextMenus/" },
        "declarativeContent": { level: "low", base_risk_points: 5, type: "ui_interaction", categories: ["Functionality"], description: "Show or hide UI elements based on page content without needing host permissions.", link: "https://developer.chrome.com/docs/extensions/reference/declarativeContent/" },
        "declarativeNetRequestFeedback": { level: "low", base_risk_points: 5, type: "network_control", categories: ["Functionality"], description: "Observe actions taken by the `declarativeNetRequest` API (for debugging).", link: "https://developer.chrome.com/docs/extensions/reference/declarativeNetRequestFeedback/" },
        "dns": { level: "low", base_risk_points: 8, type: "network_control", categories: ["Functionality"], description: "Resolve domain names programmatically.", link: "https://developer.chrome.com/docs/extensions/reference/dns/" },
        "downloads.shelf": { level: "low", base_risk_points: 5, type: "ui_interaction", categories: ["Functionality"], description: "Control the download shelf UI.", link: "https://developer.chrome.com/docs/extensions/reference/downloads/#event-onDeterminingFilename" },
        "downloads.ui": { level: "low", base_risk_points: 5, type: "ui_interaction", categories: ["Functionality"], description: "Open the browser's download manager UI.", link: "https://developer.chrome.com/docs/extensions/reference/downloads/#method-show" },
        "enterprise.hardwarePlatform": { level: "low", base_risk_points: 5, type: "data_access", categories: ["Functionality"], description: "Read hardware platform information on managed devices.", link: "https://developer.chrome.com/docs/extensions/reference/enterprise_hardwarePlatform/" },
        "fontSettings": { level: "low", base_risk_points: 5, type: "browser_control", categories: ["Functionality"], description: "Manage browser font settings.", link: "https://developer.chrome.com/docs/extensions/reference/fontSettings/" },
        "idle": { level: "low", base_risk_points: 5, type: "system_interaction", categories: ["Functionality"], description: "Detect when the user's machine idle state changes.", link: "https://developer.chrome.com/docs/extensions/reference/idle/" },
        "loginState": { level: "low", base_risk_points: 5, type: "account_access", categories: ["Functionality"], description: "Read the user's login state (signed in or not).", link: "https://developer.chrome.com/docs/extensions/reference/loginState/" },
        "mdns": { level: "low", base_risk_points: 5, type: "network_control", categories: ["Functionality"], description: "Discover services over mDNS.", link: "https://developer.chrome.com/docs/extensions/reference/mdns/" },
        "notifications": { level: "low", base_risk_points: 5, type: "ui_interaction", categories: ["Functionality"], description: "Create and display rich desktop notifications.", link: "https://developer.chrome.com/docs/extensions/reference/notifications/" },
        "offscreen": { level: "low", base_risk_points: 5, type: "system_interaction", categories: ["Functionality"], description: "Create and manage offscreen documents for APIs not available in service workers.", link: "https://developer.chrome.com/docs/extensions/reference/offscreen/" },
        "power": { level: "low", base_risk_points: 5, type: "system_interaction", categories: ["Functionality"], description: "Override system power management.", link: "https://developer.chrome.com/docs/extensions/reference/power/" },
        "printingMetrics": { level: "low", base_risk_points: 5, type: "system_interaction", categories: ["Functionality"], description: "Query printer usage statistics.", link: "https://developer.chrome.com/docs/extensions/reference/printingMetrics/" },
        "runtime": { level: "low", base_risk_points: 5, type: "system_interaction", categories: ["Functionality"], description: "Basic runtime info, event listeners, and message passing.", link: "https://developer.chrome.com/docs/extensions/reference/runtime/" },
        "search": { level: "low", base_risk_points: 5, type: "ui_interaction", categories: ["Functionality"], description: "Use the default search provider.", link: "https://developer.chrome.com/docs/extensions/reference/search/" },
        "sidePanel": { level: "low", base_risk_points: 5, type: "ui_interaction", categories: ["Functionality"], description: "Control UI in the browser's side panel.", link: "https://developer.chrome.com/docs/extensions/reference/sidePanel/" },
        "storage": { level: "low", base_risk_points: 8, type: "data_access", categories: ["Functionality"], description: "Store and retrieve extension data.", link: "https://developer.chrome.com/docs/extensions/reference/storage/" },
        "system.cpu": { level: "low", base_risk_points: 5, type: "data_access", categories: ["Functionality"], description: "Read CPU metadata.", link: "https://developer.chrome.com/docs/extensions/reference/system_cpu/" },
        "system.display": { level: "low", base_risk_points: 5, type: "data_access", categories: ["Functionality"], description: "Query display metadata.", link: "https://developer.chrome.com/docs/extensions/reference/system_display/" },
        "system.memory": { level: "low", base_risk_points: 5, type: "data_access", categories: ["Functionality"], description: "Access physical memory metadata.", link: "https://developer.chrome.com/docs/extensions/reference/system_memory/" },
        "system.storage": { level: "low", base_risk_points: 5, type: "data_access", categories: ["Functionality"], description: "Access storage device metadata.", link: "https://developer.chrome.com/docs/extensions/reference/system_storage/" },
        "tts": { level: "low", base_risk_points: 5, type: "system_interaction", categories: ["Functionality"], description: "Use the browser's text-to-speech engine.", link: "https://developer.chrome.com/docs/extensions/reference/tts/" },
        "ttsEngine": { level: "low", base_risk_points: 5, type: "system_interaction", categories: ["Functionality"], description: "Implement a text-to-speech engine.", link: "https://developer.chrome.com/docs/extensions/reference/ttsEngine/" },
        "unlimitedStorage": { level: "low", base_risk_points: 5, type: "data_access", categories: ["Functionality"], description: "Remove the 5MB limit for `chrome.storage.local`.", link: "https://developer.chrome.com/docs/extensions/reference/storage/" },
        "wallpaper": { level: "low", base_risk_points: 5, type: "ui_interaction", categories: ["Functionality"], description: "Change the ChromeOS wallpaper.", link: "https://developer.chrome.com/docs/extensions/reference/wallpaper/" },
        "activeTab": { level: "low", base_risk_points: 5, type: "data_access", categories: ["Functionality"], description: "Grants temporary access to the active tab when the user invokes the extension. A safe alternative to `<all_urls>`.", link: "https://developer.chrome.com/docs/extensions/reference/activeTab/" },
        "background": { level: "low", base_risk_points: 5, type: "system_interaction", categories: ["Functionality"], description: "Allows the extension to run a service worker in the background.", link: "https://developer.chrome.com/docs/extensions/reference/manifest/background" },
        "clipboardWrite": { level: "low", base_risk_points: 5, type: "system_interaction", categories: ["Functionality"], description: "Write data to the system clipboard.", link: "https://developer.chrome.com/docs/extensions/reference/clipboard/" },
        "networkState": { level: "low", base_risk_points: 5, type: "data_access", categories: ["Functionality"], description: "Query the current network connectivity status.", link: "https://developer.chrome.com/docs/extensions/reference/networkState/" },
        "storageManaged": { level: "low", base_risk_points: 5, type: "data_access", categories: ["Functionality"], description: "Access read-only configuration set by enterprise admins.", link: "https://developer.chrome.com/docs/extensions/reference/storage/" },
        "notifications.buttons": { level: "low", base_risk_points: 5, type: "ui_interaction", categories: ["Functionality"], description: "Add action buttons to notifications for user interactions.", link: "https://developer.chrome.com/docs/extensions/reference/notifications/" },
        
        "unknown": { level: "moderate", base_risk_points: 40, type: "unknown", categories: ["Unclassified"], description: "This permission was not recognized. Its potential impact is unknown and it should be reviewed carefully." }
    };
    
    // Anomaly rules for name/permissions
    const ANOMALY_RULES = {
        'wallpaper': ['<all_urls>', 'webRequest', 'scripting'],
        'theme': ['<all_urls>', 'webRequest', 'scripting', 'history', 'downloads'],
        'dictionary': ['<all_urls>', 'webRequest', 'nativeMessaging'],
        'clock': ['<all_urls>', 'webRequest', 'scripting'],
    };

    const RISK_TYPE_WEIGHTS = {
        "data_access": 1.2,
        "code_injection": 1.5,
        "network_control": 1.3,
        "system_interaction": 1.6,
        "account_access": 1.4,
        "privacy_sensitive": 1.1,
        "browser_control": 1.0,
        "ui_interaction": 0.9,
        "data_transfer": 1.0,
        "development_tools": 1.5,
        "security_feature": 1.2,
        "unclassified": 1.1,
        "Functionality": 0.5,
        "unknown": 1.2
    };

    const SYNERGY_MULTIPLIERS = {
        "<all_urls>+scripting": 2.5,
        "<all_urls>+nativeMessaging": 3.0,
        "debugger+<all_urls>": 3.0,
        "history+cookies": 2.0,
        "management+proxy": 2.5,
        "fileSystemProvider+downloads.open": 2.2,
        "clipboardRead+<all_urls>": 2.8,
        "searchProvider+<all_urls>": 2.5
    };
    
    // --- Risk Levels and UI Labels ---
    const RISK_LEVELS = {
        "excellent": { scoreMin: 90, class: "risk-excellent", indicator: "✓", explanation: "Requests minimal to no permissions. Poses a negligible risk and demonstrates an exemplary approach to user privacy and security." },
        "low": { scoreMin: 70, class: "risk-low", indicator: "✓", explanation: "Requests common, low-impact permissions necessary for its features. Generally safe, but review to ensure the permissions align with the extension's purpose." },
        "moderate": { scoreMin: 50, class: "risk-moderate", indicator: "?", explanation: "Requests a notable set of permissions that could impact privacy or browser functionality if misused. Exercise caution and verify its necessity." },
        "high": { scoreMin: 20, class: "risk-high", indicator: "!", explanation: "Requests sensitive permissions that could compromise your privacy (e.g., access Browse history). This carries a high risk and requires careful consideration." },
        "critical": { scoreMin: 0, class: "risk-critical", indicator: "!", explanation: "Demands highly intrusive permissions (e.g., full web access, system interaction) that pose a critical threat. *Avoid* unless the source is absolutely trusted." },
        "unknown": { scoreMin: -1, class: "risk-unknown", indicator: "i", explanation: "The risk level could not be determined. Proceed with caution." }
    };
    
    /**
     * ENHANCED: Calculates a TrustGuard score with synergy penalties.
     * @param {string[]} permissions
     * @returns {{score: number, category: string, privacyScore: number, securityScore: number, synergyPenalties: Array<{pair: string, penalty: number}>}}
     */
    function calculateTrustGuardScore(permissions) {
        if (!permissions || permissions.length === 0) {
            return { score: 100, category: "excellent", privacyScore: 100, securityScore: 100, synergyPenalties: [] };
        }

        let totalRiskPoints = 0;
        let privacyRiskPoints = 0;
        let securityRiskPoints = 0;
        const permSet = new Set(permissions);
        const synergyPenalties = [];

        // 1. Sum base risk points with type weighting
        permissions.forEach(p => {
            const info = PERMISSION_INFO[p] || PERMISSION_INFO.unknown;
            const weightedRisk = info.base_risk_points * (RISK_TYPE_WEIGHTS[info.type] || 1.0);
            totalRiskPoints += weightedRisk;
            if (info.categories.includes("Privacy")) privacyRiskPoints += weightedRisk;
            if (info.categories.includes("Security")) securityRiskPoints += weightedRisk;
        });

        // 2. Add synergy risk points for dangerous combinations (now multiplicative)
        const allSynergyKeys = Object.keys(SYNERGY_MULTIPLIERS);
        for (const key of allSynergyKeys) {
            const [p1, p2] = key.split('+');
            if (permSet.has(p1) && permSet.has(p2)) {
                const penalty = (PERMISSION_INFO[p1].base_risk_points + PERMISSION_INFO[p2].base_risk_points) * (SYNERGY_MULTIPLIERS[key] - 1);
                totalRiskPoints += penalty;
                if ((PERMISSION_INFO[p1].categories.includes("Privacy") || PERMISSION_INFO[p2].categories.includes("Privacy"))) privacyRiskPoints += penalty * 0.5;
                if ((PERMISSION_INFO[p1].categories.includes("Security") || PERMISSION_INFO[p2].categories.includes("Security"))) securityRiskPoints += penalty * 0.5;
                synergyPenalties.push({ pair: `${p1} + ${p2}`, penalty: Math.round(penalty) });
            }
        }
        
        // 3. Add Permission Sparsity Penalty
        const permissionCount = permissions.length;
        const penaltyThreshold = 10;
        if (permissionCount > penaltyThreshold) {
            const sparsityPenalty = (permissionCount - penaltyThreshold) * 5; // 5 points for each permission over the threshold
            totalRiskPoints += sparsityPenalty;
        }

        // 4. Calculate scores
        const maxTheoreticalRiskPoints = 5000;
        const maxPrivacyRiskPoints = 2500;
        const maxSecurityRiskPoints = 3000;

        const cappedTotalRisk = Math.min(totalRiskPoints, maxTheoreticalRiskPoints);
        const cappedPrivacyRisk = Math.min(privacyRiskPoints, maxPrivacyRiskPoints);
        const cappedSecurityRisk = Math.min(securityRiskPoints, maxSecurityRiskPoints);

        const score = Math.max(0, Math.min(100, 100 - (cappedTotalRisk / maxTheoreticalRiskPoints) * 100));
        const privacyScore = Math.max(0, Math.min(100, 100 - (cappedPrivacyRisk / maxPrivacyRiskPoints) * 100));
        const securityScore = Math.max(0, Math.min(100, 100 - (cappedSecurityRisk / maxSecurityRiskPoints) * 100));

        // 5. Determine category
        let category = "unknown";
        const sortedLevels = Object.keys(RISK_LEVELS).sort((a, b) => RISK_LEVELS[b].scoreMin - RISK_LEVELS[a].scoreMin);
        for (const level of sortedLevels) {
            if (RISK_LEVELS[level].scoreMin !== -1 && score >= RISK_LEVELS[level].scoreMin) {
                category = level;
                break;
            }
        }
        return { score: Math.round(score), category: category, privacyScore: Math.round(privacyScore), securityScore: Math.round(securityScore), synergyPenalties: synergyPenalties };
    }

    /**
     * FIX: Corrected the function to accept privacyScore and securityScore as arguments.
     * Populates the TrustGuard score card for a single extension.
     * @param {number} score
     * @param {string} category
     * @param {number} privacyScore
     * @param {number} securityScore
     */
    function updateScoreCard(score, category, privacyScore, securityScore) {
        const levelInfo = RISK_LEVELS[category];
        trustScoreValue.textContent = score;
        trustScoreCategory.textContent = `${category} Risk`;
        trustScoreCategory.className = `score-category ${levelInfo.class}`;
        trustScoreExplanation.textContent = levelInfo.explanation;
        
        // Update security and privacy graphs
        document.getElementById('privacy-score-value').textContent = privacyScore;
        document.getElementById('security-score-value').textContent = securityScore;
        privacyScoreGraph.style.setProperty('--score-value', privacyScore);
        securityScoreGraph.style.setProperty('--score-value', securityScore);

        // Add emphasis to the key sentence in critical explanations
        if (category === 'critical') {
            const explanationText = levelInfo.explanation;
            const match = explanationText.match(/\*([^*]+)\*/);
            if (match) {
                const strongPart = match[1];
                const parts = explanationText.split(`*${strongPart}*`);
                trustScoreExplanation.textContent = ''; // Clear previous
                trustScoreExplanation.appendChild(document.createTextNode(parts[0]));
                const strongEl = document.createElement('strong');
                strongEl.textContent = strongPart;
                trustScoreExplanation.appendChild(strongEl);
                trustScoreExplanation.appendChild(document.createTextNode(parts[1]));
            }
        }
    }
    
    /**
     * Populates the What If Sandbox with permissions and adds event listeners.
     * @param {string[]} originalPermissions
     */
    function setupWhatIfSandbox(originalPermissions) {
        whatIfSandbox.textContent = ''; // Use textContent for safety
        const whatIfPermissionsList = document.createElement('ul');
        whatIfPermissionsList.className = 'what-if-permissions-list';

        originalPermissions.forEach(p => {
            const listItem = document.createElement('li');
            listItem.className = 'what-if-permission-item';

            const label = document.createElement('label');
            label.className = 'what-if-permission-label';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.dataset.permission = p;
            
            const permissionText = document.createElement('span');
            permissionText.className = 'what-if-permission-name';
            permissionText.textContent = p;

            label.appendChild(checkbox);
            label.appendChild(permissionText);
            listItem.appendChild(label);
            whatIfPermissionsList.appendChild(listItem);
        });

        whatIfSandbox.appendChild(whatIfPermissionsList);

        // Initial calculation
        updateWhatIfScore(originalPermissions);

        // Add event listener to recalculate score on every change
        whatIfSandbox.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') {
                const selectedPermissions = Array.from(whatIfSandbox.querySelectorAll('input[type="checkbox"]:checked'))
                    .map(cb => cb.dataset.permission);
                updateWhatIfScore(selectedPermissions);
            }
        });
    }

    /**
     * Updates the What If score display.
     * @param {string[]} permissions
     */
    function updateWhatIfScore(permissions) {
        const { score, category } = calculateTrustGuardScore(permissions);
        const levelInfo = RISK_LEVELS[category];
        whatIfScoreValue.textContent = score;
        whatIfScoreCategory.textContent = category;
        whatIfScoreCategory.className = `what-if-score-category ${levelInfo.class}`;
    }
    
    // NEW: Check for behavioral anomalies
    function checkAnomalies(name, permissions) {
        const anomalies = [];
        const lowerName = name.toLowerCase();
        
        // Simple heuristic based on name
        for (const keyword in ANOMALY_RULES) {
            if (lowerName.includes(keyword)) {
                for (const permission of ANOMALY_RULES[keyword]) {
                    if (permissions.includes(permission)) {
                        anomalies.push({
                            type: 'Behavioral Mismatch',
                            permission: permission,
                            reason: `The extension's name suggests it's a '${keyword}', yet it requests the high-risk '${permission}' permission. This could be a sign of a hidden function.`,
                        });
                    }
                }
            }
        }
        
        // Add other anomaly checks here if needed...
        
        return anomalies;
    }

    // NEW: Render anomaly reports
    function renderAnomalyReport(anomalies) {
        anomalyReport.textContent = '';
        if (anomalies.length === 0) {
            const messageItem = createSimpleMessageItem('No behavioral anomalies detected based on our current rules.');
            anomalyReport.appendChild(messageItem);
            return;
        }

        const anomalyList = document.createElement('ul');
        anomalyList.className = 'anomaly-list';
        anomalies.forEach(anomaly => {
            const item = document.createElement('li');
            item.className = 'anomaly-item';
            const type = document.createElement('h5');
            type.className = 'anomaly-type';
            type.textContent = anomaly.type;
            const description = document.createElement('p');
            description.className = 'anomaly-description';
            description.textContent = anomaly.reason;
            
            item.appendChild(type);
            item.appendChild(description);
            anomalyList.appendChild(item);
        });
        anomalyReport.appendChild(anomalyList);
    }
    
    // NEW: Render least privilege recommendations
    function renderLeastPrivilegeRecommendations(extensionName, permissions) {
        leastPrivilegeRecommendations.textContent = '';
        const recommendations = [];

        // Heuristic-based recommendations
        const lowRiskPerms = permissions.filter(p => PERMISSION_INFO[p]?.level === 'low');
        if (lowRiskPerms.length > 5) {
            recommendations.push({
                type: 'Excessive Low-Risk Permissions',
                description: `This extension requests ${lowRiskPerms.length} low-risk permissions. While individually harmless, a large number could indicate an extension is collecting more data than necessary.`,
            });
        }

        if (extensionName.toLowerCase().includes('adblock') && !permissions.includes('declarativeNetRequest')) {
            recommendations.push({
                type: 'Inefficient Ad-Blocking Method',
                description: `Ad-blocking extensions are encouraged to use the high-performance 'declarativeNetRequest' API. This extension does not, which may indicate a less efficient or older approach.`,
            });
        }
        
        if (recommendations.length === 0) {
            const messageItem = createSimpleMessageItem('No least privilege recommendations were generated for this extension.');
            leastPrivilegeRecommendations.appendChild(messageItem);
            return;
        }
        
        const recommendationList = document.createElement('ul');
        recommendationList.className = 'recommendation-list';
        recommendations.forEach(rec => {
            const item = document.createElement('li');
            item.className = 'recommendation-item';
            const type = document.createElement('h5');
            type.className = 'recommendation-type';
            type.textContent = rec.type;
            const description = document.createElement('p');
            description.className = 'recommendation-description';
            description.textContent = rec.description;
            item.appendChild(type);
            item.appendChild(description);
            recommendationList.appendChild(item);
        });
        leastPrivilegeRecommendations.appendChild(recommendationList);
    }


    /**
     * Creates a detailed permission list item.
     * @param {string} permission
     * @returns {HTMLLIElement}
     */
    function createPermissionListItem(permission) {
        const info = PERMISSION_INFO[permission] || PERMISSION_INFO.unknown;
        
        const item = document.createElement('li');
        item.className = `permission-item ${info.level}`;
        
        const icon = document.createElement('span');
        icon.className = `permission-icon ${RISK_LEVELS[info.level].class}`;
        icon.textContent = RISK_LEVELS[info.level].indicator;

        const content = document.createElement('div');
        content.className = 'permission-content';

        const title = document.createElement('h5');
        title.className = 'permission-title';

        const titleText = document.createTextNode(permission);
        if (info === PERMISSION_INFO.unknown && permission !== "unknown") {
            title.textContent = `Unknown: ${permission}`;
        } else {
            const link = document.createElement('a');
            link.href = info.link;
            link.target = '_blank';
            link.className = 'permission-link';
            link.textContent = '🔗';
            title.appendChild(titleText);
            title.appendChild(link);
        }

        const description = document.createElement('p');
        description.className = 'permission-description';
        description.textContent = info.description.replace(/\*([^*]+)\*/g, '$1');
        
        content.appendChild(title);
        content.appendChild(description);
        item.appendChild(icon);
        item.appendChild(content);

        return item;
    }

    /**
     * Populates the detailed permission reports with categorized lists.
     * @param {string[]} permissions
     */
    function updateDetailedReports(permissions) {
        allPermissionsList.textContent = ''; // Clear previous content safely

        if (!permissions || permissions.length === 0) {
            const messageItem = createSimpleMessageItem('This extension does not require any special permissions.');
            allPermissionsList.appendChild(messageItem);
            return;
        }

        const categorizedPermissions = {
            'critical': [],
            'high': [],
            'moderate': [],
            'low': [],
            'excellent': [],
            'unknown': []
        };
        
        // Group permissions by category
        permissions.forEach(p => {
            const info = PERMISSION_INFO[p] || PERMISSION_INFO.unknown;
            const level = info.level;
            if (categorizedPermissions[level]) {
                categorizedPermissions[level].push(p);
            } else {
                categorizedPermissions.unknown.push(p);
            }
        });

        // Create collapsible sections for each category
        const riskOrder = ["critical", "high", "moderate", "low", "excellent", "unknown"];
        riskOrder.forEach(riskLevel => {
            const perms = categorizedPermissions[riskLevel];
            if (perms.length > 0) {
                const details = document.createElement('details');
                details.className = `risk-category-details ${riskLevel}`;
                if (riskLevel === 'critical' || riskLevel === 'high') {
                    details.open = true; // Open high-risk categories by default
                }

                const summary = document.createElement('summary');
                summary.className = `risk-category-summary ${riskLevel}`;
                summary.textContent = `${riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)} Risk Permissions (${perms.length})`;

                const list = document.createElement('ul');
                list.className = 'detailed-report-list';
                perms.forEach(p => {
                    list.appendChild(createPermissionListItem(p));
                });

                details.appendChild(summary);
                details.appendChild(list);
                allPermissionsList.appendChild(details);
            }
        });
    }
    
    /**
     * Renders the permission synergy heatmap.
     * @param {Array<object>} penalties
     */
    function renderSynergyHeatmap(penalties) {
        permissionSynergyTable.textContent = ''; // Clear previous content safely
        if (penalties.length === 0) {
            const messageItem = createSimpleMessageItem('No significant synergy risks detected.');
            permissionSynergyTable.appendChild(messageItem);
            return;
        }
        
        const header = document.createElement('div');
        header.className = 'synergy-header';
        const headerSpan1 = document.createElement('span');
        headerSpan1.textContent = 'Permission Combination';
        const headerSpan2 = document.createElement('span');
        headerSpan2.textContent = 'Penalty Points';
        header.appendChild(headerSpan1);
        header.appendChild(headerSpan2);
        permissionSynergyTable.appendChild(header);

        penalties.sort((a, b) => b.penalty - a.penalty).forEach(p => {
            const item = document.createElement('div');
            item.className = 'synergy-item';
            
            const pairName = document.createElement('span');
            pairName.className = 'synergy-pair';
            pairName.textContent = p.pair;
            
            const penaltyValue = document.createElement('span');
            penaltyValue.className = 'synergy-penalty';
            penaltyValue.textContent = p.penalty;
            
            item.appendChild(pairName);
            item.appendChild(penaltyValue);
            permissionSynergyTable.appendChild(item);
        });
    }

    /**
     * Creates a simple list item for messages.
     * @param {string} message
     * @returns {HTMLLIElement}
     */
    function createSimpleMessageItem(message) {
        const item = document.createElement('li');
        item.className = 'permission-item-message';
        item.textContent = message;
        return item;
    }

    /**
     * Displays a toast notification.
     */
    function showToast(message, duration = 3000) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        toastContainer.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        }, duration);
    }

    /**
     * Renders a single extension's report.
     * @param {object} extensionInfo
     */
    function renderSingleExtensionReport(extensionInfo) {
        singleExtensionView.style.display = 'block';
        allExtensionsView.style.display = 'none';
        filteredExtensionsView.style.display = 'none';

        // Update header
        extensionIcon.src = extensionInfo.icons?.sort((a, b) => b.size - a.size)[0]?.url || '../../public/icons/svg/extension-placeholder.svg';
        extensionName.textContent = extensionInfo.name;

        const permissions = extensionInfo.permissions || [];
        
        // Calculate and display TrustGuard Score
        const { score, category, privacyScore, securityScore, synergyPenalties } = calculateTrustGuardScore(permissions);
        
        // FIX: Pass all required arguments to the function.
        updateScoreCard(score, category, privacyScore, securityScore);
        
        // Update Detailed Reports
        updateDetailedReports(permissions);
        renderSynergyHeatmap(synergyPenalties);
        setupWhatIfSandbox(permissions);
        
        // NEW: Anomaly detection and recommendations
        renderAnomalyReport(checkAnomalies(extensionInfo.name, permissions));
        renderLeastPrivilegeRecommendations(extensionInfo.name, permissions);
    }
    
    /**
     * Creates a list item for the all extensions view.
     * @param {object} extensionInfo
     * @returns {HTMLLIElement}
     */
    function createAllExtensionsListItem(extensionInfo) {
        const { id, name, permissions } = extensionInfo;
        const { score, category } = calculateTrustGuardScore(permissions);
        const levelInfo = RISK_LEVELS[category];

        const listItem = document.createElement('li');
        listItem.className = 'extension-summary-item';
        listItem.addEventListener('click', () => window.location.href = `trustguard.html?id=${id}`);

        const icon = document.createElement('img');
        icon.src = extensionInfo.icons?.sort((a, b) => b.size - a.size)[0]?.url || '../../public/icons/svg/extension-placeholder.svg';
        icon.className = 'extension-summary-icon';

        const content = document.createElement('div');
        content.className = 'extension-summary-content';

        const nameEl = document.createElement('h5');
        nameEl.className = 'extension-summary-name';
        nameEl.textContent = name;

        const scoreEl = document.createElement('div');
        scoreEl.className = `extension-summary-score-badge ${levelInfo.class}`;
        scoreEl.textContent = score;

        const permissionCount = document.createElement('p');
        permissionCount.className = 'extension-summary-permission-count';
        
        const unknownCount = (extensionInfo.permissions || []).filter(p => !PERMISSION_INFO[p]).length;
        const knownCount = (extensionInfo.permissions || []).filter(p => PERMISSION_INFO[p]).length;
        
        if (unknownCount > 0) {
            permissionCount.textContent = `${knownCount} known, ${unknownCount} unknown permissions`;
        } else {
            permissionCount.textContent = `${knownCount} permissions`;
        }

        content.appendChild(nameEl);
        content.appendChild(permissionCount);
        listItem.appendChild(icon);
        listItem.appendChild(content);
        listItem.appendChild(scoreEl);
        
        return listItem;
    }

    /**
     * Renders the overall dashboard view.
     * @param {Array<object>} extensions
     */
    function renderAllExtensionsDashboard(extensions) {
        singleExtensionView.style.display = 'none';
        filteredExtensionsView.style.display = 'none';
        allExtensionsView.style.display = 'block';

        allExtensionsList.textContent = ''; // Clear previous content safely
        extensions.forEach(ext => {
            if (ext.enabled) {
                const item = createAllExtensionsListItem(ext);
                // NEW: Add data attributes for better search
                const { score, category } = calculateTrustGuardScore(ext.permissions || []);
                item.dataset.permissions = (ext.permissions || []).join(',').toLowerCase();
                item.dataset.riskCategory = category;
                allExtensionsList.appendChild(item);
            }
        });
        
        updateOverviewStats(extensions);
    }
    
    /**
     * Populates the overview statistics section and makes items clickable.
     * @param {Array<object>} extensions
     */
    function updateOverviewStats(extensions) {
        const enabledExtensions = extensions.filter(ext => ext.enabled);
        const stats = {
            totalExtensions: extensions.length,
            enabledExtensions: enabledExtensions.length,
            riskCounts: { critical: 0, high: 0, moderate: 0, low: 0, excellent: 0, unknown: 0 },
            permissionCounts: {}
        };
        
        enabledExtensions.forEach(ext => {
            const { category } = calculateTrustGuardScore(ext.permissions || []);
            stats.riskCounts[category]++;
            (ext.permissions || []).forEach(p => {
                const permissionKey = PERMISSION_INFO[p] ? p : 'unknown';
                stats.permissionCounts[permissionKey] = (stats.permissionCounts[permissionKey] || 0) + 1;
            });
        });

        // Update dashboard values
        document.getElementById('total-extensions-count').textContent = stats.totalExtensions;
        document.getElementById('enabled-extensions-count').textContent = stats.enabledExtensions;
        document.getElementById('critical-risk-count').textContent = stats.riskCounts.critical;
        document.getElementById('high-risk-count').textContent = stats.riskCounts.high;
        document.getElementById('moderate-risk-count').textContent = stats.riskCounts.moderate;

        // Populate Extensions by Permission Count list
        permissionCountList.textContent = ''; // Clear previous content safely
        const sortedPermissions = Object.entries(stats.permissionCounts)
            .sort(([, countA], [, countB]) => countB - countA)
            .slice(0, 10);
        sortedPermissions.forEach(([permission, count]) => {
            const listItem = document.createElement('li');
            listItem.className = 'stat-list-item clickable';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'stat-name';
            nameSpan.textContent = permission;
            const valueSpan = document.createElement('span');
            valueSpan.className = 'stat-value';
            valueSpan.textContent = `${count} extensions`;
            listItem.appendChild(nameSpan);
            listItem.appendChild(valueSpan);
            listItem.addEventListener('click', () => filterAndDisplayExtensionsByPermission(extensions, permission));
            permissionCountList.appendChild(listItem);
        });

        // Populate Extensions by Risk Rating list
        riskRatingList.textContent = ''; // Clear previous content safely
        const riskOrder = ["critical", "high", "moderate", "low", "excellent", "unknown"];
        riskOrder.forEach(risk => {
            if (stats.riskCounts[risk] > 0) {
                const listItem = document.createElement('li');
                const levelInfo = RISK_LEVELS[risk];
                listItem.className = `stat-list-item clickable`;
                const nameSpan = document.createElement('span');
                nameSpan.className = `stat-name ${levelInfo.class}`;
                nameSpan.textContent = risk;
                const valueSpan = document.createElement('span');
                valueSpan.className = 'stat-value';
                valueSpan.textContent = `${stats.riskCounts[risk]} extensions`;
                listItem.appendChild(nameSpan);
                listItem.appendChild(valueSpan);
                listItem.addEventListener('click', () => filterAndDisplayExtensionsByRisk(extensions, risk));
                riskRatingList.appendChild(listItem);
            }
        });
    }
    
    // --- ENHANCED: Improved Search Functionality ---
    if (permissionSearchInput) {
        permissionSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const items = allExtensionsList.querySelectorAll('.extension-summary-item');
            items.forEach(item => {
                const name = item.querySelector('.extension-summary-name').textContent.toLowerCase();
                const permissions = item.dataset.permissions;
                const riskCategory = item.dataset.riskCategory;
                
                if (name.includes(query) || permissions.includes(query) || riskCategory.includes(query)) {
                    item.style.display = 'flex';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }

    /**
     * Filters extensions by a specific permission and displays them.
     * @param {Array<object>} extensions - All extensions.
     * @param {string} permission - The permission to filter by.
     */
    function filterAndDisplayExtensionsByPermission(extensions, permission) {
        let filteredExtensions;
        if (permission === 'unknown') {
            filteredExtensions = extensions.filter(ext => ext.enabled && ext.permissions && ext.permissions.some(p => !PERMISSION_INFO[p]));
        } else {
            filteredExtensions = extensions.filter(ext => ext.enabled && ext.permissions && ext.permissions.includes(permission));
        }
        
        filteredViewHeader.textContent = `Extensions with "${permission}"`;
        filteredExtensionsList.textContent = ''; // Clear previous content safely
        filteredExtensions.forEach(ext => {
            filteredExtensionsList.appendChild(createAllExtensionsListItem(ext));
        });
        
        allExtensionsView.style.display = 'none';
        filteredExtensionsView.style.display = 'block';
    }

    /**
     * Filters extensions by a specific risk rating and displays them.
     * @param {Array<object>} extensions - All extensions.
     * @param {string} riskCategory - The risk category to filter by.
     */
    function filterAndDisplayExtensionsByRisk(extensions, riskCategory) {
        const filteredExtensions = extensions.filter(ext => {
            if (!ext.enabled) return false;
            const { category } = calculateTrustGuardScore(ext.permissions || []);
            return category === riskCategory;
        });
        
        filteredViewHeader.textContent = `Extensions with ${riskCategory} Risk`;
        filteredExtensionsList.textContent = ''; // Clear previous content safely
        filteredExtensions.forEach(ext => {
            filteredExtensionsList.appendChild(createAllExtensionsListItem(ext));
        });
        
        allExtensionsView.style.display = 'none';
        filteredExtensionsView.style.display = 'block';
    }

    /**
     * Initializes the TrustGuard page.
     */
    async function initializeTrustGuardPage() {
        const urlParams = new URLSearchParams(window.location.search);
        const extensionId = urlParams.get('id');
        
        try {
            const allExtensions = await chrome.management.getAll();

            if (extensionId) {
                const extensionInfo = allExtensions.find(ext => ext.id === extensionId);
                if (!extensionInfo) {
                    updateForError("Extension not found or is inaccessible.");
                    return;
                }
                renderSingleExtensionReport(extensionInfo);
            } else {
                renderAllExtensionsDashboard(allExtensions);
            }

        } catch (error) {
            console.error("Error loading TrustGuard analysis:", error);
            updateForError(`Analysis failed: ${error.message}`);
        }
    }

    /**
     * Helper to display an error state across the UI.
     * @param {string} message - The error message to display.
     */
    function updateForError(message) {
        showToast(message);
        // Fallback to a generic error view
        singleExtensionView.style.display = 'block';
        allExtensionsView.style.display = 'none';
        filteredExtensionsView.style.display = 'none';

        extensionName.textContent = "Error";
        // FIX: Provide dummy values for the scores to avoid the ReferenceError
        updateScoreCard(0, "unknown", 0, 0);
        trustScoreValue.textContent = "!";
        trustScoreExplanation.textContent = message;
        allPermissionsList.textContent = '';
        allPermissionsList.appendChild(createSimpleMessageItem(message));
    }
    
    // Initialize when the DOM is fully loaded
    document.addEventListener('DOMContentLoaded', initializeTrustGuardPage);

})();
