// report.js

/**
 * Global variable for the main modal element.
 * @type {HTMLElement|null}
 */
let reportDialogElement = null;

/**
 * Captured console logs/errors, stored before the modal opens.
 * @type {Array<{type: string, message: string, timestamp: string}>}
 */
const _capturedConsoleLogs = [];
const MAX_CONSOLE_ENTRIES = 50;

/**
 * Intercept console.log and console.error as early as possible to capture
 * relevant messages before the user opens the report dialog.
 */
(function installConsoleCapture() {
    const _origLog = console.log.bind(console);
    const _origError = console.error.bind(console);
    const _origWarn = console.warn.bind(console);

    function _capture(type, args) {
        if (_capturedConsoleLogs.length >= MAX_CONSOLE_ENTRIES) {
            _capturedConsoleLogs.shift(); // Drop oldest to keep buffer bounded
        }
        try {
            const message = args
                .map(a => {
                    if (typeof a === 'string') return a;
                    try { return JSON.stringify(a, null, 0); } catch { return String(a); }
                })
                .join(' ')
                .slice(0, 300); // Cap per-message length to keep URL manageable
            _capturedConsoleLogs.push({
                type,
                message,
                timestamp: new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm
            });
        } catch { /* swallow capture errors */ }
    }

    console.log = function (...args) { _capture('log', args); _origLog(...args); };
    console.error = function (...args) { _capture('error', args); _origError(...args); };
    console.warn = function (...args) { _capture('warn', args); _origWarn(...args); };
})();

/**
 * Configuration for the GitHub repository.
 */
const GITHUB_REPO_OWNER = 'modcoretech';
const GITHUB_REPO_NAME = 'modcore-extension-manager';
const GITHUB_BASE_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/new`;
const TOTAL_STEPS = 3;

/**
 * Soft URL budget: GitHub URLs over ~8 000 chars are often truncated.
 * We leave headroom for the title, label param, and encoding overhead.
 */
const MAX_BODY_CHARS = 6500;

/**
 * Conversational Issue templates to guide the user and format the GitHub issue.
 */
const ISSUE_TEMPLATES = {
    BUG: {
        name: '🐛 Something is broken (Bug Report)',
        titlePrefix: '[BUG]',
        label: 'bug',
        summaryPlaceholder: 'e.g., The settings button disappears on page reload.',
        descriptionPlaceholder: '1. What are the clear, repeatable steps to see the issue?\n2. What should have happened (expected result)?\n3. What actually happened (incorrect result)?',
        instructions: 'Crucial: Provide clear steps to reproduce the bug so we can fix it quickly.',
    },
    FEATURE: {
        name: '✨ I have an idea (Feature Suggestion)',
        titlePrefix: '[FEATURE]',
        label: 'enhancement',
        summaryPlaceholder: 'e.g., Add a dark mode toggle button.',
        descriptionPlaceholder: 'Describe the feature in detail. Why is it needed, and how would it improve the extension?',
        instructions: 'Clearly explain the value and usage of your suggestion.',
    },
    GENERAL: {
        name: '💬 General question or feedback',
        titlePrefix: '[FEEDBACK]',
        label: 'feedback',
        summaryPlaceholder: 'e.g., Question about installation process.',
        descriptionPlaceholder: 'Please provide your detailed question or general feedback here, including context.',
        instructions: 'Provide full context for your question or feedback.',
    }
};

// ---------------------------------------------------------------------------
// DOM Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a DOM element with specified tag, classes, and attributes.
 * @param {string} tag
 * @param {string} [className='']
 * @param {Object} [attributes={}]
 * @returns {HTMLElement}
 */
function createElement(tag, className = '', attributes = {}) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    for (const key of Object.keys(attributes)) {
        el.setAttribute(key, attributes[key]);
    }
    return el;
}

// ---------------------------------------------------------------------------
// Data Collection
// ---------------------------------------------------------------------------

/**
 * Returns the extension version from the manifest, or 'N/A'.
 * @returns {string}
 */
function getExtensionVersion() {
    try {
        return chrome.runtime.getManifest()?.version ?? 'N/A';
    } catch {
        return 'N/A';
    }
}

/**
 * Gathers a rich set of technical environment details.
 * Uses User-Agent Client Hints where available and falls back gracefully.
 * @returns {Promise<string>} Markdown table string.
 */
async function getAccurateTechnicalInfo() {
    let browserName = 'Unknown';
    let browserVersion = 'N/A';
    let browserEngine = 'Unknown';
    let os = 'Unknown';
    let osVersion = 'N/A';
    let architecture = 'N/A';
    const ua = navigator.userAgent;

    // --- Browser / OS detection (Client Hints preferred) ---
    if (navigator.userAgentData) {
        try {
            const hints = await navigator.userAgentData.getHighEntropyValues([
                'platform', 'platformVersion', 'fullVersionList', 'architecture', 'model', 'bitness'
            ]);
            os = hints.platform || 'Unknown';
            osVersion = hints.platformVersion || 'N/A';
            architecture = hints.architecture
                ? `${hints.architecture}${hints.bitness ? `-${hints.bitness}bit` : ''}`
                : 'N/A';

            // Prefer the real browser brand over "Not A Brand" / "Chromium"
            const primary = hints.fullVersionList?.find(
                b => b.brand && !b.brand.includes('Not') && b.brand !== 'Chromium'
            ) ?? hints.fullVersionList?.[0];
            if (primary) {
                browserName = primary.brand;
                browserVersion = primary.version;
            }
        } catch { /* fall through to UA parsing */ }
    }

    if (browserName === 'Unknown') {
        // UA string fallback
        const chromeMatch = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/);
        const edgeMatch   = ua.match(/Edg\/([\d.]+)/);
        const ffMatch     = ua.match(/Firefox\/([\d.]+)/);
        const safariMatch = ua.match(/Version\/([\d.]+).*Safari/);

        if (edgeMatch)         { browserName = 'Edge';    browserVersion = edgeMatch[1]; }
        else if (chromeMatch)  { browserName = 'Chrome';  browserVersion = chromeMatch[1]; }
        else if (ffMatch)      { browserName = 'Firefox'; browserVersion = ffMatch[1]; }
        else if (safariMatch)  { browserName = 'Safari';  browserVersion = safariMatch[1]; }

        if (ua.includes('Windows'))     os = 'Windows';
        else if (ua.includes('Mac'))    os = 'macOS';
        else if (ua.includes('Linux'))  os = 'Linux';
        else if (ua.includes('Android'))os = 'Android';
        else if (ua.includes('iOS'))    os = 'iOS';
    }

    // Engine
    if (ua.includes('Firefox'))                               browserEngine = 'Gecko';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browserEngine = 'WebKit';
    else if (ua.includes('Chrome') || ua.includes('CriOS'))   browserEngine = 'Blink';

    // --- Connectivity ---
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const networkType   = connection?.effectiveType ?? 'N/A';
    const downlink      = connection?.downlink != null ? `${connection.downlink} Mbps` : 'N/A';
    const saveData      = connection?.saveData != null ? String(connection.saveData) : 'N/A';

    // --- Performance timing (page load) ---
    let pageLoadMs = 'N/A';
    try {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav) pageLoadMs = `${Math.round(nav.loadEventEnd - nav.startTime)} ms`;
    } catch { /* ignore */ }

    // --- Misc capabilities ---
    const memory        = navigator.deviceMemory != null ? `${navigator.deviceMemory} GB` : 'N/A';
    const cpuCores      = navigator.hardwareConcurrency ?? 'N/A';
    const screenRes     = `${screen.width}×${screen.height} (${screen.colorDepth}-bit) @ ${window.devicePixelRatio}x DPR`;
    const viewport      = `${window.innerWidth}×${window.innerHeight}`;
    const touchPoints   = navigator.maxTouchPoints ?? 0;
    const lang          = navigator.language;
    const cookiesOn     = navigator.cookieEnabled ? 'Yes' : 'No';
    const doNotTrack    = navigator.doNotTrack === '1' ? 'Yes' : (navigator.doNotTrack === '0' ? 'No' : 'N/A');
    const timezone      = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'N/A';
    const currentURL    = window.location.href.slice(0, 120); // cap length

    return `
### Technical Environment
| Detail | Value |
| :--- | :--- |
| **Extension Version** | \`${getExtensionVersion()}\` |
| **Browser** | \`${browserName} ${browserVersion} (${browserEngine})\` |
| **Operating System** | \`${os} ${osVersion}\` |
| **Architecture** | \`${architecture}\` |
| **Device Memory** | \`${memory}\` |
| **CPU Cores (logical)** | \`${cpuCores}\` |
| **Screen Resolution** | \`${screenRes}\` |
| **Viewport** | \`${viewport}\` |
| **Touch Points** | \`${touchPoints}\` |
| **Network Type** | \`${networkType}\` |
| **Downlink Speed** | \`${downlink}\` |
| **Data Saver** | \`${saveData}\` |
| **Page Load Time** | \`${pageLoadMs}\` |
| **Timezone** | \`${timezone}\` |
| **Language** | \`${lang}\` |
| **Cookies Enabled** | \`${cookiesOn}\` |
| **Do Not Track** | \`${doNotTrack}\` |
| **Current URL** | \`${currentURL}\` |
`.trim();
}

/**
 * Queries the list of installed extensions via chrome.management API.
 * Returns a compact Markdown table capped to keep the URL length reasonable.
 * @returns {Promise<string>}
 */
async function getInstalledExtensionsInfo() {
    try {
        if (!chrome?.management?.getAll) return '_chrome.management API not available._';

        const extensions = await new Promise((resolve, reject) => {
            chrome.management.getAll(result => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve(result);
            });
        });

        // Exclude the reporter itself; sort by name
        const selfId = chrome.runtime.id;
        const list = extensions
            .filter(e => e.id !== selfId)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (!list.length) return '_No other extensions installed._';

        // Build compact table - cap at 30 entries to protect URL budget
        const MAX_EXT = 30;
        const rows = list.slice(0, MAX_EXT).map(e => {
            const name    = e.name.slice(0, 40).replace(/\|/g, '\\|');
            const version = (e.version ?? 'N/A').slice(0, 10);
            const state   = e.enabled ? '✅ Enabled' : '⛔ Disabled';
            const type    = e.type ?? 'extension';
            return `| ${name} | ${version} | ${state} | ${type} |`;
        });

        const truncNote = list.length > MAX_EXT
            ? `\n_…and ${list.length - MAX_EXT} more (truncated for URL length)._`
            : '';

        return `
### Installed Extensions (${Math.min(list.length, MAX_EXT)} shown)
| Name | Version | State | Type |
| :--- | :--- | :--- | :--- |
${rows.join('\n')}${truncNote}
`.trim();
    } catch (err) {
        return `_Could not retrieve extensions list: ${String(err).slice(0, 100)}_`;
    }
}

/**
 * Formats captured console logs/errors into a Markdown code block.
 * @param {number} [maxEntries=MAX_CONSOLE_ENTRIES]
 * @returns {string}
 */
function getConsoleLogs(maxEntries = MAX_CONSOLE_ENTRIES) {
    if (!_capturedConsoleLogs.length) return '_No console activity captured._';

    const entries = _capturedConsoleLogs.slice(-maxEntries);
    const lines = entries.map(e => `[${e.timestamp}] [${e.type.toUpperCase()}] ${e.message}`);

    return `
### Console Logs (last ${entries.length} entries)
\`\`\`
${lines.join('\n')}
\`\`\`
`.trim();
}

// ---------------------------------------------------------------------------
// Modal Construction
// ---------------------------------------------------------------------------

function createReportDialog() {

    // ---- Styles ----
    const style = createElement('style');
    style.textContent = `
        /* ===========================
           modcore Issue Reporter CSS
           =========================== */

        /* Theme tokens */
        .modcore-dialog-overlay {
            --mc-bg: #ffffff;
            --mc-text: #1a1a1a;
            --mc-text-muted: #6b6b6b;
            --mc-accent: #007bff;
            --mc-accent-hover: #0062cc;
            --mc-surface: #f4f6f9;
            --mc-surface-hover: #edf0f5;
            --mc-border: #dde1e9;
            --mc-border-focus: #007bff;
            --mc-note-bg: #eef4ff;
            --mc-note-text: #374a6e;
            --mc-privacy-bg: #fffbeb;
            --mc-privacy-text: #7a5c0d;
            --mc-privacy-border: #f0d080;
            --mc-btn-secondary-bg: #f0f2f5;
            --mc-btn-secondary-text: #444;
            --mc-btn-primary: #007bff;
            --mc-btn-primary-hover: #0062cc;
            --mc-btn-success: #1a8a3e;
            --mc-btn-success-hover: #156d30;
            --mc-error-bg: rgba(220,38,38,0.07);
            --mc-error-border: rgba(220,38,38,0.4);
            --mc-error-text: #c0392b;
            --mc-shadow: 0 12px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08);
            --mc-checkbox-size: 17px;
            --mc-radius: 14px;
            --mc-radius-sm: 10px;
        }

        /* Dark mode overrides */
        @media (prefers-color-scheme: dark) {
            .modcore-dialog-overlay {
                --mc-bg: #18181c;
                --mc-text: #f0f0f0;
                --mc-text-muted: #8a8a9a;
                --mc-accent: #3b9eff;
                --mc-accent-hover: #60b0ff;
                --mc-surface: #25252b;
                --mc-surface-hover: #2e2e36;
                --mc-border: #35353f;
                --mc-border-focus: #3b9eff;
                --mc-note-bg: #1e2a40;
                --mc-note-text: #9ab4dc;
                --mc-privacy-bg: #2a240f;
                --mc-privacy-text: #e8c96a;
                --mc-privacy-border: #5a4a14;
                --mc-btn-secondary-bg: #2c2c34;
                --mc-btn-secondary-text: #c0c0cc;
                --mc-btn-primary: #2273d4;
                --mc-btn-primary-hover: #1a5fad;
                --mc-btn-success: #166e32;
                --mc-btn-success-hover: #105226;
                --mc-error-bg: rgba(220,38,38,0.12);
                --mc-error-border: rgba(220,38,38,0.5);
                --mc-error-text: #f07070;
                --mc-shadow: 0 16px 50px rgba(0,0,0,0.55), 0 2px 10px rgba(0,0,0,0.3);
            }
        }

        /* Reduced motion */
        @media (prefers-reduced-motion: reduce) {
            .modcore-dialog-overlay,
            .modcore-dialog-content,
            .modcore-form-step,
            .modcore-dialog-overlay *  {
                transition: none !important;
                animation: none !important;
                transform: none !important;
                opacity: 1 !important;
            }
        }

        /* Reset */
        .modcore-dialog-overlay * {
            box-sizing: border-box;
            font-family: modcore-inter-font-custom, -apple-system, BlinkMacSystemFont,
                "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans",
                "Droid Sans", "Helvetica Neue", sans-serif;
            line-height: 1.45;
        }

        /* ---- Overlay ---- */
        .modcore-dialog-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.65);
            backdrop-filter: blur(3px);
            -webkit-backdrop-filter: blur(3px);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 2147483647;
            opacity: 0;
            transition: opacity 0.22s ease;
        }
        .modcore-dialog-overlay.is-open { opacity: 1; }

        /* ---- Dialog box ---- */
        .modcore-dialog-content {
            background: var(--mc-bg);
            color: var(--mc-text);
            padding: 22px 22px 18px;
            border-radius: var(--mc-radius);
            box-shadow: var(--mc-shadow);
            width: 92%;
            max-width: 460px;
            max-height: 92vh;
            overflow-y: auto;
            overflow-x: hidden;
            transform: scale(0.94) translateY(10px);
            transition: transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.2),
                        opacity  0.25s ease;
            opacity: 0;
            scrollbar-width: thin;
            scrollbar-color: var(--mc-border) transparent;
        }
        .modcore-dialog-overlay.is-open .modcore-dialog-content {
            transform: scale(1) translateY(0);
            opacity: 1;
        }
        /* Scrollbar (webkit) */
        .modcore-dialog-content::-webkit-scrollbar { width: 5px; }
        .modcore-dialog-content::-webkit-scrollbar-thumb {
            background: var(--mc-border);
            border-radius: 4px;
        }

        /* ---- Header ---- */
        .modcore-form-header {
            font-size: 1.12em;
            font-weight: 700;
            margin-bottom: 16px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--mc-accent);
            color: var(--mc-accent);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .modcore-form-step-status {
            font-size: 0.75em;
            font-weight: 500;
            color: var(--mc-text-muted);
            background: var(--mc-surface);
            padding: 3px 8px;
            border-radius: 20px;
        }

        /* ---- Progress bar ---- */
        .modcore-progress-bar-track {
            height: 3px;
            background: var(--mc-border);
            border-radius: 3px;
            margin-bottom: 18px;
            overflow: hidden;
        }
        .modcore-progress-bar-fill {
            height: 100%;
            background: var(--mc-accent);
            border-radius: 3px;
            transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
            width: 33.33%;
        }

        /* ---- Labels & Inputs ---- */
        .modcore-dialog-content label {
            display: block;
            margin-bottom: 4px;
            font-size: 0.87em;
            font-weight: 600;
            color: var(--mc-text);
        }
        .modcore-dialog-content input:not([type="checkbox"]):not(.modcore-type-radio),
        .modcore-dialog-content textarea,
        .modcore-dialog-content select {
            width: 100%;
            padding: 9px 12px;
            border-radius: var(--mc-radius-sm);
            margin-top: 2px;
            margin-bottom: 12px;
            font-size: 0.88em;
            border: 1.5px solid var(--mc-border);
            background: var(--mc-surface);
            color: var(--mc-text);
            transition: border-color 0.15s, box-shadow 0.15s;
        }
        .modcore-dialog-content input:not([type="checkbox"]):focus,
        .modcore-dialog-content textarea:focus,
        .modcore-dialog-content select:focus {
            outline: none;
            border-color: var(--mc-border-focus);
            box-shadow: 0 0 0 3.5px rgba(0,123,255,0.12);
        }
        .modcore-dialog-content textarea { min-height: 88px; resize: vertical; }

        /* aria-invalid styling */
        .modcore-dialog-content input[aria-invalid="true"],
        .modcore-dialog-content textarea[aria-invalid="true"] {
            border-color: var(--mc-error-text) !important;
            background: var(--mc-error-bg);
        }

        /* ---- Notes / Callouts ---- */
        .modcore-modal-note {
            background: var(--mc-note-bg);
            color: var(--mc-note-text);
            padding: 9px 12px;
            border-radius: var(--mc-radius-sm);
            font-size: 0.8em;
            margin-top: 4px;
            border: 1px solid rgba(0,123,255,0.12);
            animation: noteSlideIn 0.22s ease forwards;
        }
        @keyframes noteSlideIn {
            from { opacity: 0; transform: translateY(-4px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        .modcore-privacy-note {
            margin-top: 14px;
            padding: 9px 12px;
            font-size: 0.75em;
            background: var(--mc-privacy-bg);
            color: var(--mc-privacy-text);
            border: 1px solid var(--mc-privacy-border);
            border-radius: var(--mc-radius-sm);
        }
        .modcore-error-note {
            background: var(--mc-error-bg);
            color: var(--mc-error-text);
            padding: 9px 12px;
            border-radius: var(--mc-radius-sm);
            font-size: 0.82em;
            border: 1.5px solid var(--mc-error-border);
            animation: shakeError 0.35s ease;
        }
        @keyframes shakeError {
            0%,100% { transform: translateX(0); }
            20%      { transform: translateX(-5px); }
            40%      { transform: translateX(5px); }
            60%      { transform: translateX(-3px); }
            80%      { transform: translateX(3px); }
        }

        /* ---- Step transitions ---- */
        .modcore-form-step {
            display: none;
            flex-direction: column;
            gap: 10px;
        }
        .modcore-form-step.current {
            display: flex;
            animation: stepIn 0.25s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .modcore-form-step.step-out {
            animation: stepOut 0.18s ease forwards;
        }
        @keyframes stepIn {
            from { opacity: 0; transform: translateX(18px); }
            to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes stepOut {
            from { opacity: 1; transform: translateX(0); }
            to   { opacity: 0; transform: translateX(-14px); }
        }
        .modcore-form-step.step-back-in {
            animation: stepBackIn 0.25s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        @keyframes stepBackIn {
            from { opacity: 0; transform: translateX(-18px); }
            to   { opacity: 1; transform: translateX(0); }
        }

        /* ---- Type selection cards ---- */
        .modcore-type-options-group {
            display: flex;
            flex-direction: column;
            gap: 7px;
        }
        .modcore-type-option {
            position: relative;
            display: flex;
            align-items: center;
            padding: 10px 12px 10px 44px;
            border: 1.5px solid var(--mc-border);
            border-radius: var(--mc-radius-sm);
            cursor: pointer;
            transition: background 0.15s, border-color 0.15s, box-shadow 0.15s,
                        transform 0.12s;
            background: var(--mc-surface);
            color: var(--mc-text);
        }
        .modcore-type-option:hover {
            background: var(--mc-surface-hover);
            transform: translateY(-1px);
        }
        .modcore-type-option:active { transform: translateY(0); }
        .modcore-type-option.is-selected {
            border-color: var(--mc-accent);
            background: rgba(0,123,255,0.06);
            box-shadow: 0 0 0 3px rgba(0,123,255,0.1);
        }
        .modcore-type-radio {
            position: absolute;
            left: 14px; top: 50%;
            transform: translateY(-50%);
            margin: 0;
            width: 16px; height: 16px;
            opacity: 0;
        }
        .modcore-type-option::before {
            content: "";
            position: absolute;
            left: 14px; top: 50%;
            transform: translateY(-50%);
            width: 14px; height: 14px;
            border-radius: 50%;
            background: transparent;
            border: 2px solid var(--mc-border);
            transition: background 0.15s, border-color 0.15s;
        }
        .modcore-type-option.is-selected::before {
            background: var(--mc-accent);
            border-color: var(--mc-accent);
            box-shadow: 0 0 0 3px rgba(0,123,255,0.2);
        }
        /* checkmark inside the dot */
        .modcore-type-option.is-selected::after {
            content: "";
            position: absolute;
            left: 19px; top: 50%;
            transform: translateY(-50%) rotate(45deg);
            width: 4px; height: 7px;
            border-right: 2px solid #fff;
            border-bottom: 2px solid #fff;
            margin-top: -1px;
        }
        .modcore-type-option-text { font-weight: 500; font-size: 0.9em; }

        /* ---- Checkbox row (enhanced) ---- */
        .mc-checkbox-row {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 11px 13px;
            border: 1.5px solid var(--mc-border);
            border-radius: var(--mc-radius-sm);
            background: var(--mc-surface);
            transition: border-color 0.15s, background 0.15s;
            cursor: pointer;
        }
        .mc-checkbox-row:has(input:checked) {
            border-color: var(--mc-accent);
            background: rgba(0,123,255,0.04);
        }
        .mc-checkbox-row:hover { background: var(--mc-surface-hover); }
        .mc-checkbox-header {
            display: flex;
            align-items: center;
            gap: 9px;
        }
        .mc-checkbox-header input[type="checkbox"] {
            width: var(--mc-checkbox-size);
            height: var(--mc-checkbox-size);
            flex-shrink: 0;
            accent-color: var(--mc-accent);
            cursor: pointer;
        }
        .mc-checkbox-header label {
            font-weight: 600;
            font-size: 0.88em;
            margin-bottom: 0;
            cursor: pointer;
            flex: 1;
        }
        .mc-checkbox-badge {
            font-size: 0.7em;
            font-weight: 600;
            padding: 2px 7px;
            border-radius: 20px;
            background: rgba(0,123,255,0.12);
            color: var(--mc-accent);
        }
        .mc-checkbox-desc {
            font-size: 0.77em;
            color: var(--mc-text-muted);
            padding-left: calc(var(--mc-checkbox-size) + 9px);
            line-height: 1.4;
        }

        /* ---- Buttons ---- */
        .modcore-form-actions {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1.5px solid var(--mc-border);
        }
        .modcore-form-actions .mc-right-actions {
            display: flex;
            gap: 8px;
        }
        .modcore-dialog-content button {
            padding: 8px 15px;
            border: none;
            border-radius: var(--mc-radius-sm);
            cursor: pointer;
            font-weight: 600;
            font-size: 0.86em;
            transition: background 0.18s, box-shadow 0.18s, transform 0.1s, opacity 0.18s;
            color: #fff;
            position: relative;
            overflow: hidden;
        }
        /* Ripple */
        .modcore-dialog-content button::after {
            content: "";
            position: absolute;
            inset: 0;
            background: rgba(255,255,255,0.18);
            opacity: 0;
            border-radius: inherit;
            transition: opacity 0.25s;
        }
        .modcore-dialog-content button:hover::after { opacity: 1; }
        .modcore-dialog-content button:active { transform: scale(0.97); }
        .modcore-dialog-content button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        .btn-secondary {
            background: var(--mc-btn-secondary-bg);
            color: var(--mc-btn-secondary-text);
        }
        .btn-secondary:hover:not(:disabled) { background: var(--mc-surface-hover); }
        .btn-primary { background: var(--mc-btn-primary); }
        .btn-primary:hover:not(:disabled) { background: var(--mc-btn-primary-hover); }
        .btn-success { background: var(--mc-btn-success); }
        .btn-success:hover:not(:disabled) { background: var(--mc-btn-success-hover); }

        /* Loading spinner on submit */
        .btn-loading {
            pointer-events: none;
        }
        .btn-loading-text::after {
            content: " ⏳";
        }

        /* Smooth font rendering */
        .modcore-dialog-content, .modcore-dialog-content * {
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
    `;

    // ---- Overlay / wrapper ----
    const overlay = createElement('div', 'modcore-dialog-overlay', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'modcore-dialog-title',
        'aria-describedby': 'step-status'
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) removeModal(); });

    // Trap focus inside the modal
    overlay.addEventListener('keydown', trapFocus);

    const content = createElement('div', 'modcore-dialog-content', { 'aria-live': 'polite' });

    // ---- Header ----
    const header = createElement('div', 'modcore-form-header', { id: 'modcore-dialog-title' });
    header.textContent = 'modcore Issue Reporter';
    const stepStatus = createElement('span', 'modcore-form-step-status', { id: 'step-status', 'aria-live': 'polite' });
    stepStatus.textContent = `Step 1 of ${TOTAL_STEPS}`;
    header.appendChild(stepStatus);

    // ---- Progress bar ----
    const progressTrack = createElement('div', 'modcore-progress-bar-track', { role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(TOTAL_STEPS), 'aria-valuenow': '1', 'aria-label': 'Form progress' });
    const progressFill  = createElement('div', 'modcore-progress-bar-fill');
    progressTrack.appendChild(progressFill);

    const form = createElement('form');

    // =========================================================
    // Step 1 - Issue Type Selection
    // =========================================================
    const step1 = createStepElement('step-1');

    const typeHeading = createElement('label');
    typeHeading.setAttribute('id', 'type-heading');
    typeHeading.textContent = '1. What kind of report are you submitting?';

    const typeOptionsGroup = createElement('div', 'modcore-type-options-group', {
        role: 'radiogroup',
        'aria-labelledby': 'type-heading'
    });

    Object.keys(ISSUE_TEMPLATES).forEach((key, idx) => {
        const template = ISSUE_TEMPLATES[key];
        const optionLabel = createElement('label', 'modcore-type-option', {
            for: `issue-type-${key}`,
            tabindex: '0'
        });
        const radio = createElement('input', 'modcore-type-radio', {
            type: 'radio',
            id: `issue-type-${key}`,
            name: 'issue-type',
            value: key,
            'aria-required': 'true'
        });
        const optionText = createElement('span', 'modcore-type-option-text');
        optionText.textContent = template.name;

        optionLabel.appendChild(radio);
        optionLabel.appendChild(optionText);

        optionLabel.addEventListener('click', () => {
            document.querySelectorAll('.modcore-type-option').forEach(el => el.classList.remove('is-selected'));
            optionLabel.classList.add('is-selected');
            radio.checked = true;
            updateStep2Template(key);
        });

        // Keyboard activation on label
        optionLabel.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                optionLabel.click();
            }
        });

        typeOptionsGroup.appendChild(optionLabel);
    });

    // Default selection
    const initialType = Object.keys(ISSUE_TEMPLATES)[0];
    const initialRadio = typeOptionsGroup.querySelector(`input[value="${initialType}"]`);
    if (initialRadio) {
        initialRadio.checked = true;
        initialRadio.parentElement.classList.add('is-selected');
    }

    step1.appendChild(typeHeading);
    step1.appendChild(typeOptionsGroup);

    // =========================================================
    // Step 2 - Details
    // =========================================================
    const step2 = createStepElement('step-2');

    const summaryLabel = createElement('label', '', { for: 'issue-summary' });
    summaryLabel.textContent = '2. Short Summary / Title';
    const summaryInput = createElement('input', '', {
        type: 'text',
        id: 'issue-summary',
        name: 'issue-summary',
        required: 'true',
        'aria-required': 'true',
        'aria-label': 'Short summary or title for the issue',
        maxlength: '120',
        autocomplete: 'off'
    });

    const descriptionLabel = createElement('label', '', { for: 'issue-description' });
    descriptionLabel.textContent = '3. Detailed Description';
    const descriptionTextarea = createElement('textarea', '', {
        id: 'issue-description',
        name: 'issue-description',
        required: 'true',
        'aria-required': 'true',
        'aria-label': 'Detailed description of the issue',
        maxlength: '2000'
    });

    const instructionsNote = createElement('div', 'modcore-modal-note', {
        id: 'instructions-note',
        role: 'note'
    });

    step2.appendChild(summaryLabel);
    step2.appendChild(summaryInput);
    step2.appendChild(descriptionLabel);
    step2.appendChild(descriptionTextarea);
    step2.appendChild(instructionsNote);

    // =========================================================
    // Step 3 - Optional Attachments & Submit
    // =========================================================
    const step3 = createStepElement('step-3');

    // -- Checkbox helper --
    function makeCheckboxRow({ id, label, description, badge, defaultChecked = false }) {
        const row = createElement('div', 'mc-checkbox-row');
        row.setAttribute('role', 'group');

        const headerDiv = createElement('div', 'mc-checkbox-header');
        const checkbox = createElement('input', '', {
            type: 'checkbox',
            id,
            name: id,
            'aria-describedby': `${id}-desc`
        });
        if (defaultChecked) checkbox.setAttribute('checked', 'true');

        const lbl = createElement('label', '', { for: id });
        lbl.textContent = label;

        headerDiv.appendChild(checkbox);
        headerDiv.appendChild(lbl);

        if (badge) {
            const badgeEl = createElement('span', 'mc-checkbox-badge');
            badgeEl.textContent = badge;
            headerDiv.appendChild(badgeEl);
        }

        const desc = createElement('div', 'mc-checkbox-desc', { id: `${id}-desc` });
        desc.textContent = description;

        row.appendChild(headerDiv);
        row.appendChild(desc);

        // Clicking the row also toggles the checkbox
        row.addEventListener('click', e => {
            if (e.target !== checkbox && e.target !== lbl) checkbox.checked = !checkbox.checked;
        });

        return { row, checkbox };
    }

    // 1 - Technical environment
    const { row: techRow, checkbox: techInfoCheckbox } = makeCheckboxRow({
        id: 'include-tech-info',
        label: 'Include technical environment details',
        description: 'Browser, OS, architecture, screen, network, performance timing, and more. Highly recommended for bug reports.',
        badge: 'Recommended',
        defaultChecked: true
    });
    techInfoCheckbox.setAttribute('checked', 'true');
    techInfoCheckbox.checked = true;

    // 2 - Installed extensions list
    const { row: extRow, checkbox: extListCheckbox } = makeCheckboxRow({
        id: 'include-ext-list',
        label: 'Include installed extensions list',
        description: `Lists your other installed extensions (name, version, enabled/disabled). Useful for compatibility issues. Requires the management permission.`,
        badge: 'Optional',
        defaultChecked: false
    });

    // 3 - Console logs
    const logCount = _capturedConsoleLogs.length;
    const { row: consoleRow, checkbox: consoleLogsCheckbox } = makeCheckboxRow({
        id: 'include-console-logs',
        label: `Include recent console logs & errors`,
        description: `Attaches up to ${MAX_CONSOLE_ENTRIES} captured console messages (log/warn/error) to help pinpoint runtime issues. ${logCount} entr${logCount === 1 ? 'y' : 'ies'} captured so far.`,
        badge: logCount > 0 ? `${logCount} captured` : 'Optional',
        defaultChecked: false
    });

    // Privacy note
    const privacyNote = createElement('div', 'modcore-privacy-note', { role: 'note' });
    privacyNote.innerHTML = `<strong>⚠ Privacy:</strong> Your report will open on the <em>public</em> ${GITHUB_REPO_NAME} GitHub page. Ensure your summary and description contain no personal or sensitive information.`;

    step3.appendChild(techRow);
    step3.appendChild(extRow);
    step3.appendChild(consoleRow);
    step3.appendChild(privacyNote);

    // =========================================================
    // Action Buttons
    // =========================================================
    const actionsDiv = createElement('div', 'modcore-form-actions');
    const rightActions = createElement('div', 'mc-right-actions');

    const cancelButton = createElement('button', 'btn-secondary', { type: 'button', 'aria-label': 'Cancel and close' });
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', removeModal);

    const backButton = createElement('button', 'btn-secondary', {
        type: 'button',
        id: 'back-button',
        disabled: 'true',
        'aria-label': 'Go to previous step'
    });
    backButton.textContent = '← Back';
    backButton.style.visibility = 'hidden';
    backButton.addEventListener('click', () => navigateStep(-1));

    const nextButton = createElement('button', 'btn-primary', {
        type: 'button',
        id: 'next-button',
        'aria-label': 'Go to next step'
    });
    nextButton.textContent = 'Next →';
    nextButton.addEventListener('click', () => navigateStep(1));

    rightActions.appendChild(backButton);
    rightActions.appendChild(nextButton);
    actionsDiv.appendChild(cancelButton);
    actionsDiv.appendChild(rightActions);

    // ---- Assemble form ----
    form.appendChild(step1);
    form.appendChild(step2);
    form.appendChild(step3);
    form.appendChild(actionsDiv);

    content.appendChild(header);
    content.appendChild(progressTrack);
    content.appendChild(form);

    overlay.appendChild(style);
    overlay.appendChild(content);

    // ---- Initial state ----
    updateStep2Template(initialType);
    step1.classList.add('current');

    return overlay;

    // =========================================================
    // Inner Helpers
    // =========================================================

    function createStepElement(id) {
        return createElement('div', 'modcore-form-step', {
            id,
            role: 'group',
            'aria-labelledby': 'modcore-dialog-title'
        });
    }

    function updateStep2Template(type) {
        const template = ISSUE_TEMPLATES[type] || ISSUE_TEMPLATES.BUG;
        summaryInput.placeholder = template.summaryPlaceholder;
        descriptionTextarea.placeholder = template.descriptionPlaceholder;
        instructionsNote.textContent = template.instructions;
    }

    function updateProgress(stepIndex) {
        const pct = ((stepIndex + 1) / TOTAL_STEPS) * 100;
        progressFill.style.width = `${pct}%`;
        progressTrack.setAttribute('aria-valuenow', String(stepIndex + 1));
    }

    function navigateStep(direction) {
        const steps = [step1, step2, step3];
        const currentStepIndex = steps.findIndex(s => s.classList.contains('current'));
        const newStepIndex = currentStepIndex + direction;

        // Validation on Step 2 → 3 transition
        if (direction > 0 && currentStepIndex === 1) {
            const isSummaryEmpty     = !summaryInput.value.trim();
            const isDescriptionEmpty = !descriptionTextarea.value.trim();

            summaryInput.setAttribute('aria-invalid',     String(isSummaryEmpty));
            descriptionTextarea.setAttribute('aria-invalid', String(isDescriptionEmpty));

            if (isSummaryEmpty || isDescriptionEmpty) {
                let errorDiv = form.querySelector('.modcore-error-note');
                if (!errorDiv) {
                    errorDiv = createElement('div', 'modcore-error-note', {
                        id: 'validation-error',
                        role: 'alert'
                    });
                    form.insertBefore(errorDiv, actionsDiv);
                }
                errorDiv.textContent = 'Please fill in all required fields before continuing.';
                setTimeout(() => errorDiv?.remove(), 4500);
                (isSummaryEmpty ? summaryInput : descriptionTextarea).focus();
                return;
            }

            summaryInput.setAttribute('aria-invalid', 'false');
            descriptionTextarea.setAttribute('aria-invalid', 'false');
            form.querySelector('.modcore-error-note')?.remove();
        }

        if (newStepIndex >= 0 && newStepIndex < steps.length) {
            // Animate out
            steps[currentStepIndex].classList.add(direction > 0 ? 'step-out' : 'step-out');
            setTimeout(() => {
                steps[currentStepIndex].classList.remove('current', 'step-out');

                steps[newStepIndex].classList.add('current');
                steps[newStepIndex].classList.add(direction > 0 ? '' : 'step-back-in');

                // Button state
                backButton.style.visibility = newStepIndex > 0 ? 'visible' : 'hidden';
                backButton.disabled = newStepIndex === 0;
                const isLast = newStepIndex === steps.length - 1;
                nextButton.textContent = isLast ? '🚀 Send to GitHub' : 'Next →';
                nextButton.className   = isLast ? 'btn-success' : 'btn-primary';
                nextButton.setAttribute('aria-label', isLast ? 'Submit report to GitHub' : 'Go to next step');

                stepStatus.textContent = `Step ${newStepIndex + 1} of ${TOTAL_STEPS}`;
                updateProgress(newStepIndex);

                // Focus first interactive element
                const firstFocusable = steps[newStepIndex].querySelector(
                    'input:not([type="hidden"]), select, textarea, button:not(#back-button), .modcore-type-option'
                );
                firstFocusable?.focus();
            }, 160);

        } else if (newStepIndex === steps.length) {
            nextButton.disabled = true;
            nextButton.classList.add('btn-loading');
            nextButton.innerHTML = '<span class="btn-loading-text">Opening GitHub</span>';
            handleFormSubmission(form);
        }
    }

    /** Trap keyboard focus within the overlay for accessibility. */
    function trapFocus(e) {
        if (e.key !== 'Tab') return;
        const focusable = Array.from(
            overlay.querySelectorAll(
                'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
        ).filter(el => !el.closest('.modcore-form-step:not(.current)'));

        if (!focusable.length) return;
        const first = focusable[0];
        const last  = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
}

// ---------------------------------------------------------------------------
// Modal lifecycle
// ---------------------------------------------------------------------------

function displayModal() {
    if (reportDialogElement) return;
    reportDialogElement = createReportDialog();
    document.body.appendChild(reportDialogElement);

    // Stagger: allow paint before adding open class
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            reportDialogElement?.classList.add('is-open');
        });
    });

    const firstFocusable = reportDialogElement.querySelector('.modcore-type-option');
    firstFocusable?.focus();
}

function removeModal() {
    if (!reportDialogElement) return;
    reportDialogElement.classList.remove('is-open');
    const dying = reportDialogElement;
    reportDialogElement = null;
    setTimeout(() => dying.remove(), 320);
}

// ---------------------------------------------------------------------------
// Form submission
// ---------------------------------------------------------------------------

/**
 * Assembles the GitHub issue URL and opens it, respecting the URL budget.
 * @param {HTMLFormElement} form
 */
async function handleFormSubmission(form) {
    const typeKey   = form.elements['issue-type'].value;
    const summary   = form.elements['issue-summary'].value.trim();
    const description = form.elements['issue-description'].value.trim();
    const includeTech    = form.elements['include-tech-info'].checked;
    const includeExtList = form.elements['include-ext-list'].checked;
    const includeConsole = form.elements['include-console-logs'].checked;

    const template   = ISSUE_TEMPLATES[typeKey] || ISSUE_TEMPLATES.GENERAL;
    const issueTitle = `${template.titlePrefix} ${summary}`;

    // Build body sections, then trim if necessary to respect URL budget
    let bodyParts = [`## Detailed Report\n\n${description}`];

    if (includeTech) {
        const techInfo = await getAccurateTechnicalInfo();
        bodyParts.push(`\n---\n${techInfo}`);
    }

    if (includeExtList) {
        const extInfo = await getInstalledExtensionsInfo();
        bodyParts.push(`\n---\n${extInfo}`);
    }

    if (includeConsole) {
        const consoleLogs = getConsoleLogs();
        bodyParts.push(`\n---\n${consoleLogs}`);
    }

    bodyParts.push(`\n---\n*Technical details included voluntarily by the user to aid debugging.*`);

    // Join and enforce budget
    let issueBody = bodyParts.join('\n');
    if (issueBody.length > MAX_BODY_CHARS) {
        issueBody = issueBody.slice(0, MAX_BODY_CHARS) +
            '\n\n_…(report truncated to stay within URL limits)_';
    }

    const params = new URLSearchParams();
    params.append('title',  issueTitle);
    params.append('body',   issueBody);
    params.append('labels', template.label);

    window.open(`${GITHUB_BASE_URL}?${params.toString()}`, '_blank');
    removeModal();
}

// ---------------------------------------------------------------------------
// Global keyboard listener
// ---------------------------------------------------------------------------

function handleKeydown(event) {
    const hasModifier   = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
    const activeElement = document.activeElement;
    const isTyping      = activeElement && (
        (activeElement.tagName === 'INPUT' &&
            activeElement.type !== 'checkbox' &&
            activeElement.type !== 'radio' &&
            activeElement.type !== 'submit') ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable ||
        activeElement.tagName === 'SELECT'
    );

    if (event.key === 'e' && !hasModifier && !isTyping) {
        event.preventDefault();
        displayModal();
        return;
    }

    if (event.key === 'Escape' && reportDialogElement) {
        event.preventDefault();
        removeModal();
    }
}

document.addEventListener('keydown', handleKeydown);
