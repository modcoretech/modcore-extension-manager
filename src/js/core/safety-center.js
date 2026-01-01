// safety-center.js - Enhanced modcore Safety Center

(function() {
    // Cache DOM elements
    const extensionIcon = document.getElementById('extension-icon');
    const extensionName = document.getElementById('extension-name');
    const overallScoreValue = document.getElementById('overall-score-value');
    const overallScoreCategory = document.getElementById('overall-score-category');
    const overallScoreExplanation = document.getElementById('score-explanation');
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
    const privacyScoreGraph = document.getElementById('privacy-score-graph');
    const securityScoreGraph = document.getElementById('security-score-graph');
    const privacyScoreValue = document.getElementById('privacy-score-value');
    const securityScoreValue = document.getElementById('security-score-value');

    // Back button functionality
    document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
        window.location.href = 'safety-center.html';
    });
    document.getElementById('back-from-filtered-btn').addEventListener('click', () => {
        allExtensionsView.style.display = 'block';
        filteredExtensionsView.style.display = 'none';
    });

    // Enhanced Permission Definitions with comprehensive risk assessment
    const PERMISSION_INFO = {
        // CRITICAL RISK - Extremely high potential for severe security or privacy breaches
        "<all_urls>": { 
            level: "critical", 
            security_impact: 95, 
            privacy_impact: 95, 
            type: "data_access", 
            categories: ["Security", "Privacy"], 
            description: "Grants access to read and modify all data on every website you visit. This permission provides complete visibility into your browsing activity and can intercept sensitive information including passwords, financial data, and personal communications.",
            link: "https://developer.chrome.com/docs/extensions/reference/manifest/host_permissions" 
        },
        "scripting": { 
            level: "critical", 
            security_impact: 90, 
            privacy_impact: 85, 
            type: "code_injection", 
            categories: ["Security", "Privacy"], 
            description: "Enables injection and execution of arbitrary JavaScript code on web pages. This capability can be exploited to steal credentials, manipulate page content, or establish persistent monitoring of user activity.",
            link: "https://developer.chrome.com/docs/extensions/reference/scripting/" 
        },
        "debugger": { 
            level: "critical", 
            security_impact: 100, 
            privacy_impact: 90, 
            type: "development_tools", 
            categories: ["Security", "Privacy"], 
            description: "Provides access to Chrome's debugging protocol, allowing deep inspection and manipulation of browser behavior. Can intercept network traffic, modify runtime execution, and access protected browser internals.",
            link: "https://developer.chrome.com/docs/extensions/reference/debugger/" 
        },
        "nativeMessaging": { 
            level: "critical", 
            security_impact: 100, 
            privacy_impact: 85, 
            type: "system_interaction", 
            categories: ["Security"], 
            description: "Establishes communication channels with native applications on your computer. This creates a bridge between your browser and local system, potentially exposing your device to malicious software.",
            link: "https://developer.chrome.com/docs/extensions/reference/nativeMessaging/" 
        },
        "proxy": { 
            level: "critical", 
            security_impact: 95, 
            privacy_impact: 100, 
            type: "network_control", 
            categories: ["Security", "Privacy"], 
            description: "Controls browser proxy configuration, enabling redirection of all network traffic through arbitrary servers. Can be used to intercept, monitor, or manipulate all internet communications.",
            link: "https://developer.chrome.com/docs/extensions/reference/proxy/" 
        },
        "webRequest": { 
            level: "critical", 
            security_impact: 80, 
            privacy_impact: 90, 
            type: "network_control", 
            categories: ["Security", "Privacy"], 
            description: "Monitors and analyzes all network requests. Provides visibility into every website visit, API call, and resource loaded, enabling comprehensive tracking of online activity.",
            link: "https://developer.chrome.com/docs/extensions/reference/webRequest/" 
        },
        "webRequestBlocking": { 
            level: "critical", 
            security_impact: 85, 
            privacy_impact: 85, 
            type: "network_control", 
            categories: ["Security", "Privacy"], 
            description: "Intercepts and modifies network requests in real-time. While necessary for content filtering, it can redirect traffic to malicious sites or censor legitimate content.",
            link: "https://developer.chrome.com/docs/extensions/reference/webRequest/#event-onBeforeRequest" 
        },
        "identity": { 
            level: "critical", 
            security_impact: 85, 
            privacy_impact: 80, 
            type: "account_access", 
            categories: ["Security", "Privacy"], 
            description: "Requests OAuth2 access tokens for user authorization. Potentially grants access to Google account services and associated user data.",
            link: "https://developer.chrome.com/docs/extensions/reference/identity/" 
        },
        "identity.email": { 
            level: "critical", 
            security_impact: 70, 
            privacy_impact: 85, 
            type: "account_access", 
            categories: ["Privacy"], 
            description: "Accesses your email address. This personally identifiable information can be used for tracking, profiling, or account correlation.",
            link: "https://developer.chrome.com/docs/extensions/reference/identity/#get-email" 
        },
        "input.ime": { 
            level: "critical", 
            security_impact: 95, 
            privacy_impact: 90, 
            type: "system_interaction", 
            categories: ["Security", "Privacy"], 
            description: "Implements custom input methods, potentially capturing all keyboard input including passwords, messages, and sensitive data.",
            link: "https://developer.chrome.com/docs/extensions/reference/input_ime/" 
        },
        "usb": { 
            level: "critical", 
            security_impact: 90, 
            privacy_impact: 70, 
            type: "system_interaction", 
            categories: ["Security"], 
            description: "Connects to USB devices, creating a bridge between browser and physical hardware that could be exploited for unauthorized device access.",
            link: "https://developer.chrome.com/docs/extensions/reference/usb/" 
        },
        "usbDevices": { 
            level: "critical", 
            security_impact: 90, 
            privacy_impact: 70, 
            type: "system_interaction", 
            categories: ["Security"], 
            description: "Identifies and connects to specific USB devices attached to your system.",
            link: "https://developer.chrome.com/docs/extensions/reference/usb/#method-getDevices" 
        },
        "certificateProvider": { 
            level: "critical", 
            security_impact: 95, 
            privacy_impact: 75, 
            type: "system_interaction", 
            categories: ["Security"], 
            description: "Provides client TLS certificates for authentication. Misuse could compromise secure communications or impersonate users.",
            link: "https://developer.chrome.com/docs/extensions/reference/certificateProvider/" 
        },
        "networking.config": { 
            level: "critical", 
            security_impact: 95, 
            privacy_impact: 90, 
            type: "network_control", 
            categories: ["Security", "Privacy"], 
            description: "Configures network settings including proxy configuration, potentially redirecting all traffic.",
            link: "https://developer.chrome.com/docs/extensions/reference/networking_config/" 
        },
        "accessibilityFeatures.modify": { 
            level: "critical", 
            security_impact: 75, 
            privacy_impact: 60, 
            type: "ui_interaction", 
            categories: ["Security"], 
            description: "Modifies accessibility settings such as screen magnification or contrast modes, potentially interfering with user experience.",
            link: "https://developer.chrome.com/docs/extensions/reference/accessibilityFeatures/" 
        },
        "fileSystemProvider": { 
            level: "critical", 
            security_impact: 95, 
            privacy_impact: 80, 
            type: "system_interaction", 
            categories: ["Security", "Privacy"], 
            description: "Creates virtual file systems, providing extensive control over file operations and potential access to sensitive data.",
            link: "https://developer.chrome.com/docs/extensions/reference/fileSystemProvider/" 
        },
        "vpnProvider": { 
            level: "critical", 
            security_impact: 95, 
            privacy_impact: 100, 
            type: "network_control", 
            categories: ["Security", "Privacy"], 
            description: "Implements VPN functionality, routing all network traffic through controlled channels where it can be monitored or manipulated.",
            link: "https://developer.chrome.com/docs/extensions/reference/vpnProvider/" 
        },
        "webAuthenticationProxy": { 
            level: "critical", 
            security_impact: 95, 
            privacy_impact: 80, 
            type: "security_feature", 
            categories: ["Security"], 
            description: "Intercepts Web Authentication requests, potentially compromising secure authentication flows.",
            link: "https://developer.chrome.com/docs/extensions/reference/webAuthenticationProxy/" 
        },
        "webRequestAuthProvider": {
            level: "critical",
            security_impact: 90,
            privacy_impact: 85,
            type: "auth_integration",
            categories: ["Security", "Privacy"],
            description: "Integrates custom authentication handling into web request flows. Can intercept or alter authentication challenges and responses, risking credential exposure or session manipulation.",
            link: "https://developer.chrome.com/docs/extensions/reference/webRequest/" 
        },

        // HIGH RISK - Significant security or privacy concerns
        "history": { 
            level: "high", 
            security_impact: 40, 
            privacy_impact: 85, 
            type: "data_access", 
            categories: ["Privacy"], 
            description: "Accesses complete browsing history, revealing detailed patterns of online behavior, interests, and frequently visited sites.",
            link: "https://developer.chrome.com/docs/extensions/reference/history/" 
        },
        "cookies": { 
            level: "high", 
            security_impact: 60, 
            privacy_impact: 80, 
            type: "data_access", 
            categories: ["Security", "Privacy"], 
            description: "Reads and modifies browser cookies, potentially accessing session tokens and authentication credentials.",
            link: "https://developer.chrome.com/docs/extensions/reference/cookies/" 
        },
        "clipboardRead": { 
            level: "high", 
            security_impact: 70, 
            privacy_impact: 75, 
            type: "system_interaction", 
            categories: ["Privacy", "Security"], 
            description: "Reads clipboard contents, potentially capturing passwords, sensitive messages, or confidential information.",
            link: "https://developer.chrome.com/docs/extensions/reference/clipboard/#method-readText" 
        },
        "geolocation": { 
            level: "high", 
            security_impact: 50, 
            privacy_impact: 85, 
            type: "privacy_sensitive", 
            categories: ["Privacy"], 
            description: "Accesses precise geographical location data, enabling tracking of physical movements and location history.",
            link: "https://developer.chrome.com/docs/extensions/reference/geolocation/" 
        },
        "tabCapture": { 
            level: "high", 
            security_impact: 65, 
            privacy_impact: 90, 
            type: "data_access", 
            categories: ["Privacy", "Security"], 
            description: "Captures tab audio and video content, enabling recording of all activities within browser tabs.",
            link: "https://developer.chrome.com/docs/extensions/reference/tabCapture/" 
        },
        "webNavigation": { 
            level: "high", 
            security_impact: 50, 
            privacy_impact: 75, 
            type: "browser_control", 
            categories: ["Privacy"], 
            description: "Monitors detailed navigation events, creating comprehensive records of browsing patterns and site interactions.",
            link: "https://developer.chrome.com/docs/extensions/reference/webNavigation/" 
        },
        "management": { 
            level: "high", 
            security_impact: 80, 
            privacy_impact: 40, 
            type: "browser_control", 
            categories: ["Security"], 
            description: "Manages other browser extensions, potentially disabling security tools or installing additional extensions.",
            link: "https://developer.chrome.com/docs/extensions/reference/management/" 
        },
        "browsingData": { 
            level: "high", 
            security_impact: 70, 
            privacy_impact: 65, 
            type: "browser_control", 
            categories: ["Security", "Privacy"], 
            description: "Removes browsing data including history, cache, and cookies. Can erase evidence of activity or cause data loss.",
            link: "https://developer.chrome.com/docs/extensions/reference/browsingData/" 
        },
        "declarativeNetRequestWithHostAccess": { 
            level: "high", 
            security_impact: 75, 
            privacy_impact: 70, 
            type: "network_control", 
            categories: ["Security", "Privacy"], 
            description: "Modifies network requests with host permissions, enabling content alteration and header manipulation.",
            link: "https://developer.chrome.com/docs/extensions/reference/declarativeNetRequestWithHostAccess/" 
        },
        "enterprise.platformKeys": { 
            level: "high", 
            security_impact: 85, 
            privacy_impact: 60, 
            type: "system_interaction", 
            categories: ["Security"], 
            description: "Accesses enterprise certificates on managed devices for authentication purposes.",
            link: "https://developer.chrome.com/docs/extensions/reference/enterprise_platformKeys/" 
        },
        "platformKeys": { 
            level: "high", 
            security_impact: 85, 
            privacy_impact: 60, 
            type: "system_interaction", 
            categories: ["Security"], 
            description: "Accesses platform-managed client certificates for secure authentication.",
            link: "https://developer.chrome.com/docs/extensions/reference/platformKeys/" 
        },
        "background": {
            level: "high",
            security_impact: 70,
            privacy_impact: 60,
            type: "lifecycle_control",
            categories: ["Security", "Functionality"],
            description: "Allows an extension to run background pages or service workers persistently. Enables continuous execution and the ability to perform background network activity or monitoring, increasing potential for abuse.",
            link: "https://developer.chrome.com/docs/extensions/reference/manifest/background/" 
        },

        // MODERATE RISK - Notable permissions requiring consideration
        "bookmarks": { 
            level: "moderate", 
            security_impact: 25, 
            privacy_impact: 55, 
            type: "data_access", 
            categories: ["Privacy"], 
            description: "Manages browser bookmarks. While generally safe, can reveal interests and frequently accessed resources.",
            link: "https://developer.chrome.com/docs/extensions/reference/bookmarks/" 
        },
        "contentSettings": { 
            level: "moderate", 
            security_impact: 60, 
            privacy_impact: 45, 
            type: "browser_control", 
            categories: ["Security"], 
            description: "Controls site-specific settings for cookies, JavaScript, and plugins. Incorrect configuration may weaken security.",
            link: "https://developer.chrome.com/docs/extensions/reference/contentSettings/" 
        },
        "declarativeNetRequest": { 
            level: "moderate", 
            security_impact: 40, 
            privacy_impact: 35, 
            type: "network_control", 
            categories: ["Security"], 
            description: "Blocks or modifies network requests using declarative rules. Standard for content blockers with limited scope.",
            link: "https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/" 
        },
        "desktopCapture": { 
            level: "moderate", 
            security_impact: 55, 
            privacy_impact: 75, 
            type: "data_access", 
            categories: ["Privacy"], 
            description: "Captures screen or window content. Privacy-sensitive but typically requires user interaction.",
            link: "https://developer.chrome.com/docs/extensions/reference/desktopCapture/" 
        },
        "downloads": { 
            level: "moderate", 
            security_impact: 45, 
            privacy_impact: 50, 
            type: "browser_control", 
            categories: ["Privacy"], 
            description: "Manages download operations. Can track downloaded files and modify download behavior.",
            link: "https://developer.chrome.com/docs/extensions/reference/downloads/" 
        },
        "downloads.open": { 
            level: "moderate", 
            security_impact: 55, 
            privacy_impact: 30, 
            type: "system_interaction", 
            categories: ["Security"], 
            description: "Opens downloaded files programmatically, potentially executing malicious content.",
            link: "https://developer.chrome.com/docs/extensions/reference/downloads/" 
        },
        "tabs": { 
            level: "moderate", 
            security_impact: 30, 
            privacy_impact: 55, 
            type: "browser_control", 
            categories: ["Privacy"], 
            description: "Accesses tab information including URLs and titles. Enables monitoring of browsing activity.",
            link: "https://developer.chrome.com/docs/extensions/reference/tabs/" 
        },
        "tabGroups": { 
            level: "moderate", 
            security_impact: 20, 
            privacy_impact: 40, 
            type: "browser_control", 
            categories: ["Privacy"], 
            description: "Manages tab groups and organization. Limited privacy implications.",
            link: "https://developer.chrome.com/docs/extensions/reference/tabGroups/" 
        },
        "topSites": { 
            level: "moderate", 
            security_impact: 25, 
            privacy_impact: 60, 
            type: "data_access", 
            categories: ["Privacy"], 
            description: "Accesses list of most frequently visited websites, revealing browsing preferences.",
            link: "https://developer.chrome.com/docs/extensions/reference/topSites/" 
        },
        "privacy": { 
            level: "moderate", 
            security_impact: 65, 
            privacy_impact: 50, 
            type: "browser_control", 
            categories: ["Security", "Privacy"], 
            description: "Modifies privacy-related browser settings. Could disable privacy protections if misused.",
            link: "https://developer.chrome.com/docs/extensions/reference/privacy/" 
        },
        "sessions": { 
            level: "moderate", 
            security_impact: 35, 
            privacy_impact: 55, 
            type: "data_access", 
            categories: ["Privacy"], 
            description: "Accesses and restores recently closed tabs and windows, revealing recent browsing activity.",
            link: "https://developer.chrome.com/docs/extensions/reference/sessions/" 
        },
        "host": { 
            level: "moderate", 
            security_impact: 70, 
            privacy_impact: 65, 
            type: "data_access", 
            categories: ["Security", "Privacy"], 
            description: "Accesses specific websites matching defined patterns. Impact depends on scope of host permissions.",
            link: "https://developer.chrome.com/docs/extensions/reference/manifest/host_permissions" 
        },

        // LOW RISK - Standard functionality with minimal security concerns
        "activeTab": { 
            level: "low", 
            security_impact: 15, 
            privacy_impact: 20, 
            type: "data_access", 
            categories: ["Functionality"], 
            description: "Grants temporary access to the active tab only when user invokes the extension. Minimal risk approach.",
            link: "https://developer.chrome.com/docs/extensions/reference/activeTab/" 
        },
        "alarms": { 
            level: "low", 
            security_impact: 5, 
            privacy_impact: 5, 
            type: "system_interaction", 
            categories: ["Functionality"], 
            description: "Schedules code execution at specified intervals. Standard functionality with negligible risk.",
            link: "https://developer.chrome.com/docs/extensions/reference/alarms/" 
        },
        "contextMenus": { 
            level: "low", 
            security_impact: 5, 
            privacy_impact: 5, 
            type: "ui_interaction", 
            categories: ["Functionality"], 
            description: "Adds context menu items. Purely functional with no data access.",
            link: "https://developer.chrome.com/docs/extensions/reference/contextMenus/" 
        },
        "notifications": { 
            level: "low", 
            security_impact: 5, 
            privacy_impact: 10, 
            type: "ui_interaction", 
            categories: ["Functionality"], 
            description: "Displays system notifications. Minimal risk, primarily cosmetic functionality.",
            link: "https://developer.chrome.com/docs/extensions/reference/notifications/" 
        },
        "storage": { 
            level: "low", 
            security_impact: 20, 
            privacy_impact: 25, 
            type: "data_access", 
            categories: ["Functionality"], 
            description: "Stores extension data. Isolated storage with limited cross-extension access.",
            link: "https://developer.chrome.com/docs/extensions/reference/storage/" 
        },
        "unlimitedStorage": { 
            level: "low", 
            security_impact: 15, 
            privacy_impact: 20, 
            type: "data_access", 
            categories: ["Functionality"], 
            description: "Removes storage quota limits. Allows larger data storage but remains isolated.",
            link: "https://developer.chrome.com/docs/extensions/reference/storage/" 
        },
        "windows": { 
            level: "low", 
            security_impact: 10, 
            privacy_impact: 15, 
            type: "browser_control", 
            categories: ["Functionality"], 
            description: "Manages browser windows. Limited functional permission with minimal risk.",
            link: "https://developer.chrome.com/docs/extensions/reference/windows/" 
        },
        "clipboardWrite": { 
            level: "low", 
            security_impact: 10, 
            privacy_impact: 15, 
            type: "system_interaction", 
            categories: ["Functionality"], 
            description: "Writes data to clipboard. Standard functionality without reading capability.",
            link: "https://developer.chrome.com/docs/extensions/reference/clipboard/" 
        },
        "offscreen": {
            level: "moderate",
            security_impact: 40,
            privacy_impact: 30,
            type: "rendering",
            categories: ["Functionality", "Privacy"],
            description: "Allows creation of offscreen documents to render content outside visible tabs. Can be used to load and process remote content in the background, which may increase attack surface if misused.",
            link: "https://developer.chrome.com/docs/extensions/mv3/offscreen/" 
        },

        "sidePanel": {
            level: "low",
            security_impact: 10,
            privacy_impact: 10,
            type: "ui_interaction",
            categories: ["Functionality"],
            description: "Enables the extension to create a side panel in the browser UI. Primarily for enhanced user interaction with minimal security implications.",
            link: "https://developer.chrome.com/docs/extensions/reference/api/sidePanel"
        },

        "devtools": {
            level: "moderate",
            security_impact: 50,
            privacy_impact: 40,
            type: "development_tools",
            categories: ["Functionality", "Security"],
            description: "Integrates with DevTools, allowing inspection and modification of web pages. While useful for development, it can expose sensitive data if misused.",
            link: "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/devtools"
        },

        "unknown": { 
            level: "moderate", 
            security_impact: 50, 
            privacy_impact: 50, 
            type: "unknown", 
            categories: ["Unclassified"], 
            description: "Unrecognized permission. Exercise caution as impact cannot be determined without additional analysis." 
        }
    };

    // Risk level definitions
    const RISK_LEVELS = {
        "excellent": { 
            scoreMin: 85, 
            class: "risk-excellent", 
            label: "Excellent", 
            description: "This extension requests minimal permissions and demonstrates exceptional respect for your security and privacy. Safe for use." 
        },
        "good": { 
            scoreMin: 70, 
            class: "risk-good", 
            label: "Good", 
            description: "Requests standard permissions appropriate for its functionality. Generally safe with acceptable privacy practices." 
        },
        "moderate": { 
            scoreMin: 50, 
            class: "risk-moderate", 
            label: "Moderate", 
            description: "Requests permissions that warrant review. Verify the extension's purpose aligns with requested capabilities." 
        },
        "concerning": { 
            scoreMin: 30, 
            class: "risk-concerning", 
            label: "Concerning", 
            description: "Requests sensitive permissions that could impact privacy or security. Carefully evaluate necessity before use." 
        },
        "high-risk": { 
            scoreMin: 0, 
            class: "risk-high-risk", 
            label: "High Risk", 
            description: "Requests extensive permissions with significant security and privacy implications. Only install from trusted sources." 
        }
    };

    /**
     * Calculate comprehensive security assessment scores
     */
    function calculateSecurityScores(permissions) {
        if (!permissions || permissions.length === 0) {
            return { 
                overallScore: 100, 
                securityScore: 100, 
                privacyScore: 100, 
                category: "excellent",
                permissionCount: 0 
            };
        }

        let totalSecurityImpact = 0;
        let totalPrivacyImpact = 0;
        let permissionCount = 0;

        // Calculate cumulative impact with diminishing returns for multiple permissions
        permissions.forEach(permission => {
            const info = PERMISSION_INFO[permission] || PERMISSION_INFO.unknown;
            
            // Apply exponential scaling for critical permissions
            const securityMultiplier = info.level === "critical" ? 1.5 : 1.0;
            const privacyMultiplier = info.level === "critical" ? 1.5 : 1.0;
            
            totalSecurityImpact += info.security_impact * securityMultiplier;
            totalPrivacyImpact += info.privacy_impact * privacyMultiplier;
            permissionCount++;
        });

        // Apply permission sprawl penalty (more permissions = additional risk)
        const sprawlPenalty = Math.min(permissionCount * 2, 30);
        totalSecurityImpact += sprawlPenalty;
        totalPrivacyImpact += sprawlPenalty;

        // Normalize scores with stricter thresholds
        const maxSecurityImpact = 800;
        const maxPrivacyImpact = 800;

        const securityScore = Math.max(0, Math.min(100, 
            100 - (totalSecurityImpact / maxSecurityImpact) * 100
        ));
        
        const privacyScore = Math.max(0, Math.min(100, 
            100 - (totalPrivacyImpact / maxPrivacyImpact) * 100
        ));

        // Overall score weighted toward the lower of the two
        const overallScore = Math.round(Math.min(securityScore, privacyScore) * 0.7 + 
                                        Math.max(securityScore, privacyScore) * 0.3);

        // Determine category
        let category = "high-risk";
        for (const [level, info] of Object.entries(RISK_LEVELS)) {
            if (overallScore >= info.scoreMin) {
                category = level;
                break;
            }
        }

        return {
            overallScore: Math.round(overallScore),
            securityScore: Math.round(securityScore),
            privacyScore: Math.round(privacyScore),
            category,
            permissionCount
        };
    }

    /**
     * Update score displays with calculated values
     */
    function updateScoreDisplays(scores) {
        const levelInfo = RISK_LEVELS[scores.category];
        
        // Update overall score
        overallScoreValue.textContent = scores.overallScore;
        overallScoreCategory.textContent = levelInfo.label;
        overallScoreCategory.className = `score-category ${levelInfo.class}`;
        overallScoreExplanation.textContent = levelInfo.description;
        
        // Update security score
        securityScoreValue.textContent = scores.securityScore;
        securityScoreGraph.style.setProperty('--score-value', scores.securityScore);
        
        // Update privacy score
        privacyScoreValue.textContent = scores.privacyScore;
        privacyScoreGraph.style.setProperty('--score-value', scores.privacyScore);
    }

    /**
     * Create permission list item with proper DOM manipulation
     */
    function createPermissionListItem(permission) {
        const info = PERMISSION_INFO[permission] || PERMISSION_INFO.unknown;
        
        const item = document.createElement('li');
        item.className = `permission-item permission-${info.level}`;
        
        const iconContainer = document.createElement('div');
        iconContainer.className = `permission-icon ${RISK_LEVELS[info.level]?.class || 'risk-moderate'}`;
        
        const iconText = document.createElement('span');
        iconText.textContent = info.level === 'critical' ? '!' : 
                               info.level === 'high' ? '!' :
                               info.level === 'moderate' ? '?' : 
                               '✓';
        iconContainer.appendChild(iconText);
        
        const content = document.createElement('div');
        content.className = 'permission-content';
        
        const header = document.createElement('div');
        header.className = 'permission-header';
        
        const title = document.createElement('h5');
        title.className = 'permission-title';
        
        const titleText = document.createElement('span');
        titleText.textContent = permission;
        title.appendChild(titleText);
        
        if (info.link && info !== PERMISSION_INFO.unknown) {
            const link = document.createElement('a');
            link.href = info.link;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'permission-link';
            link.textContent = '📖';
            link.setAttribute('aria-label', 'View documentation');
            title.appendChild(link);
        }
        
        header.appendChild(title);
        
        const badges = document.createElement('div');
        badges.className = 'permission-badges';
        
        info.categories.forEach(category => {
            const badge = document.createElement('span');
            badge.className = 'permission-badge';
            badge.textContent = category;
            badges.appendChild(badge);
        });
        
        header.appendChild(badges);
        content.appendChild(header);
        
        const description = document.createElement('p');
        description.className = 'permission-description';
        description.textContent = info.description;
        content.appendChild(description);
        
        item.appendChild(iconContainer);
        item.appendChild(content);
        
        return item;
    }

    /**
     * Render categorized permission list
     */
    function renderPermissionsList(permissions) {
        while (allPermissionsList.firstChild) {
            allPermissionsList.removeChild(allPermissionsList.firstChild);
        }

        if (!permissions || permissions.length === 0) {
            const message = document.createElement('p');
            message.className = 'no-permissions-message';
            message.textContent = 'This extension does not request any special permissions.';
            allPermissionsList.appendChild(message);
            return;
        }

        // Group by risk level
        const grouped = {
            critical: [],
            high: [],
            moderate: [],
            low: []
        };

        permissions.forEach(permission => {
            const info = PERMISSION_INFO[permission] || PERMISSION_INFO.unknown;
            const level = info.level === 'excellent' ? 'low' : info.level;
            if (grouped[level]) {
                grouped[level].push(permission);
            } else {
                grouped.moderate.push(permission);
            }
        });

        // Render each category
        const categoryOrder = ['critical', 'high', 'moderate', 'low'];
        const categoryLabels = {
            critical: 'Critical Risk Permissions',
            high: 'High Risk Permissions',
            moderate: 'Moderate Risk Permissions',
            low: 'Standard Permissions'
        };

        categoryOrder.forEach(level => {
            if (grouped[level].length > 0) {
                const section = document.createElement('details');
                section.className = `permission-category permission-category-${level}`;
                
                // Auto-open critical and high risk
                if (level === 'critical' || level === 'high') {
                    section.open = true;
                }

                const summary = document.createElement('summary');
                summary.className = 'permission-category-summary';
                
                const summaryText = document.createElement('span');
                summaryText.textContent = `${categoryLabels[level]} (${grouped[level].length})`;
                summary.appendChild(summaryText);
                
                section.appendChild(summary);

                const list = document.createElement('ul');
                list.className = 'permission-list';
                
                grouped[level].forEach(permission => {
                    list.appendChild(createPermissionListItem(permission));
                });
                
                section.appendChild(list);
                allPermissionsList.appendChild(section);
            }
        });
    }

    /**
     * Create extension summary card
     */
    function createExtensionCard(extension) {
        const card = document.createElement('li');
        card.className = 'extension-card';
        card.addEventListener('click', () => {
            window.location.href = `safety-center.html?id=${extension.id}`;
        });

        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'extension-card-icon-wrapper';
        
        const icon = document.createElement('img');
        icon.className = 'extension-card-icon';
        icon.src = extension.icons?.[0]?.url || '../../public/icons/svg/terminal.svg';
        icon.alt = `${extension.name} icon`;
        iconWrapper.appendChild(icon);

        const content = document.createElement('div');
        content.className = 'extension-card-content';

        const name = document.createElement('h3');
        name.className = 'extension-card-name';
        name.textContent = extension.name;

        const meta = document.createElement('div');
        meta.className = 'extension-card-meta';

        const permCount = document.createElement('span');
        permCount.className = 'extension-card-permissions';
        const count = extension.permissions?.length || 0;
        permCount.textContent = `${count} permission${count !== 1 ? 's' : ''}`;

        meta.appendChild(permCount);
        content.appendChild(name);
        content.appendChild(meta);

        const scores = calculateSecurityScores(extension.permissions || []);
        const scoreDisplay = document.createElement('div');
        scoreDisplay.className = 'extension-card-score';

        const scoreValue = document.createElement('div');
        scoreValue.className = `extension-card-score-value ${RISK_LEVELS[scores.category].class}`;
        scoreValue.textContent = scores.overallScore;

        const scoreLabel = document.createElement('div');
        scoreLabel.className = 'extension-card-score-label';
        scoreLabel.textContent = RISK_LEVELS[scores.category].label;

        scoreDisplay.appendChild(scoreValue);
        scoreDisplay.appendChild(scoreLabel);

        card.appendChild(iconWrapper);
        card.appendChild(content);
        card.appendChild(scoreDisplay);

        // Add data attributes for filtering
        card.dataset.name = extension.name.toLowerCase();
        card.dataset.category = scores.category;
        card.dataset.permissions = (extension.permissions || []).join(',').toLowerCase();

        return card;
    }

    /**
     * Render single extension view
     */
    function renderExtensionDetails(extension) {
        singleExtensionView.style.display = 'block';
        allExtensionsView.style.display = 'none';
        filteredExtensionsView.style.display = 'none';

        // Update header
        extensionIcon.src = extension.icons?.[0]?.url || '../../public/icons/svg/terminal.svg';
        extensionIcon.alt = `${extension.name} icon`;
        extensionName.textContent = extension.name;

        // Calculate and display scores
        const scores = calculateSecurityScores(extension.permissions || []);
        updateScoreDisplays(scores);

        // Render permissions
        renderPermissionsList(extension.permissions || []);
    }

    /**
     * Render dashboard view
     */
    function renderDashboard(extensions) {
        singleExtensionView.style.display = 'none';
        filteredExtensionsView.style.display = 'none';
        allExtensionsView.style.display = 'block';

        // Clear extension list
        while (allExtensionsList.firstChild) {
            allExtensionsList.removeChild(allExtensionsList.firstChild);
        }

        // Calculate statistics
        const enabled = extensions.filter(ext => ext.enabled);
        const stats = {
            total: extensions.length,
            enabled: enabled.length,
            categories: { excellent: 0, good: 0, moderate: 0, concerning: 0, 'high-risk': 0 },
            permissions: {}
        };

        enabled.forEach(ext => {
            const scores = calculateSecurityScores(ext.permissions || []);
            stats.categories[scores.category]++;

            (ext.permissions || []).forEach(perm => {
                stats.permissions[perm] = (stats.permissions[perm] || 0) + 1;
            });

            allExtensionsList.appendChild(createExtensionCard(ext));
        });

        // Update overview stats
        document.getElementById('total-extensions-count').textContent = stats.total;
        document.getElementById('enabled-extensions-count').textContent = stats.enabled;
        document.getElementById('high-risk-count').textContent = stats.categories['high-risk'];
        document.getElementById('concerning-count').textContent = stats.categories.concerning;
        document.getElementById('moderate-risk-count').textContent = stats.categories.moderate;

        // Render permission counts
        renderPermissionCounts(stats.permissions, extensions);
        
        // Render risk distribution
        renderRiskDistribution(stats.categories, extensions);
    }

    /**
     * Render permission frequency list
     */
    function renderPermissionCounts(permissions, extensions) {
        while (permissionCountList.firstChild) {
            permissionCountList.removeChild(permissionCountList.firstChild);
        }

        const sorted = Object.entries(permissions)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10);

        sorted.forEach(([permission, count]) => {
            const item = document.createElement('li');
            item.className = 'stat-item stat-item-clickable';
            item.addEventListener('click', () => {
                filterExtensionsByPermission(extensions, permission);
            });

            const info = PERMISSION_INFO[permission] || PERMISSION_INFO.unknown;
            
            const nameWrapper = document.createElement('div');
            nameWrapper.className = 'stat-item-name-wrapper';
            
            const name = document.createElement('span');
            name.className = 'stat-item-name';
            name.textContent = permission;
            
            const badge = document.createElement('span');
            badge.className = `stat-item-badge ${RISK_LEVELS[info.level === 'excellent' ? 'good' : info.level]?.class || 'risk-moderate'}`;
            badge.textContent = info.level;
            
            nameWrapper.appendChild(name);
            nameWrapper.appendChild(badge);

            const value = document.createElement('span');
            value.className = 'stat-item-value';
            value.textContent = `${count} extension${count !== 1 ? 's' : ''}`;

            item.appendChild(nameWrapper);
            item.appendChild(value);
            permissionCountList.appendChild(item);
        });
    }

    /**
     * Render risk category distribution
     */
    function renderRiskDistribution(categories, extensions) {
        while (riskRatingList.firstChild) {
            riskRatingList.removeChild(riskRatingList.firstChild);
        }

        const order = ['high-risk', 'concerning', 'moderate', 'good', 'excellent'];
        
        order.forEach(category => {
            const count = categories[category];
            if (count > 0) {
                const item = document.createElement('li');
                item.className = 'stat-item stat-item-clickable';
                item.addEventListener('click', () => {
                    filterExtensionsByCategory(extensions, category);
                });

                const nameWrapper = document.createElement('div');
                nameWrapper.className = 'stat-item-name-wrapper';
                
                const name = document.createElement('span');
                name.className = `stat-item-name ${RISK_LEVELS[category].class}`;
                name.textContent = RISK_LEVELS[category].label;

                nameWrapper.appendChild(name);

                const value = document.createElement('span');
                value.className = 'stat-item-value';
                value.textContent = `${count} extension${count !== 1 ? 's' : ''}`;

                item.appendChild(nameWrapper);
                item.appendChild(value);
                riskRatingList.appendChild(item);
            }
        });
    }

    /**
     * Filter extensions by permission
     */
    function filterExtensionsByPermission(extensions, permission) {
        const filtered = extensions.filter(ext => 
            ext.enabled && (ext.permissions || []).includes(permission)
        );

        renderFilteredView(
            filtered,
            `Extensions Using "${permission}"`,
            `${filtered.length} extension${filtered.length !== 1 ? 's' : ''} use this permission`
        );
    }

    /**
     * Filter extensions by risk category
     */
    function filterExtensionsByCategory(extensions, category) {
        const filtered = extensions.filter(ext => {
            if (!ext.enabled) return false;
            const scores = calculateSecurityScores(ext.permissions || []);
            return scores.category === category;
        });

        renderFilteredView(
            filtered,
            `${RISK_LEVELS[category].label} Extensions`,
            `${filtered.length} extension${filtered.length !== 1 ? 's' : ''} in this category`
        );
    }

    /**
     * Render filtered extension view
     */
    function renderFilteredView(extensions, title, subtitle) {
        allExtensionsView.style.display = 'none';
        singleExtensionView.style.display = 'none';
        filteredExtensionsView.style.display = 'block';

        filteredViewHeader.textContent = title;
        
        const subtitleElement = document.getElementById('filtered-view-subtitle');
        if (subtitleElement) {
            subtitleElement.textContent = subtitle;
        }

        while (filteredExtensionsList.firstChild) {
            filteredExtensionsList.removeChild(filteredExtensionsList.firstChild);
        }

        extensions.forEach(ext => {
            filteredExtensionsList.appendChild(createExtensionCard(ext));
        });
    }

    /**
     * Search functionality
     */
    if (permissionSearchInput) {
        permissionSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const cards = allExtensionsList.querySelectorAll('.extension-card');

            cards.forEach(card => {
                const name = card.dataset.name || '';
                const permissions = card.dataset.permissions || '';
                const category = card.dataset.category || '';

                const matches = !query || 
                    name.includes(query) || 
                    permissions.includes(query) || 
                    category.includes(query);

                card.style.display = matches ? 'flex' : 'none';
            });
        });
    }

    /**
     * Display toast notification
     */
    function showToast(message, duration = 3000) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        
        toastContainer.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('toast-show');
        });

        setTimeout(() => {
            toast.classList.remove('toast-show');
            setTimeout(() => {
                if (toast.parentNode) {
                    toastContainer.removeChild(toast);
                }
            }, 300);
        }, duration);
    }

    /**
     * Initialize Safety Center
     */
    async function initialize() {
        try {
            const params = new URLSearchParams(window.location.search);
            const extensionId = params.get('id');

            const extensions = await chrome.management.getAll();

            if (extensionId) {
                const extension = extensions.find(ext => ext.id === extensionId);
                if (extension) {
                    renderExtensionDetails(extension);
                } else {
                    showToast('Extension not found');
                    renderDashboard(extensions);
                }
            } else {
                renderDashboard(extensions);
            }
        } catch (error) {
            console.error('Safety Center initialization error:', error);
            showToast('Failed to load extension data');
        }
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
