// report.js

let reportDialogElement = null;
let previousActiveElement = null;

const _capturedConsoleLogs = [];
const MAX_CONSOLE_ENTRIES = 50;

// Capture console output early for debugging context.
(function installConsoleCapture() {
    const _origLog = console.log.bind(console);
    const _origError = console.error.bind(console);
    const _origWarn = console.warn.bind(console);

    function _capture(type, args) {
        if (_capturedConsoleLogs.length >= MAX_CONSOLE_ENTRIES) _capturedConsoleLogs.shift();
        try {
            const message = args
                .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
                .join(' ')
                .slice(0, 300);
            _capturedConsoleLogs.push({
                type,
                message,
                timestamp: new Date().toISOString().slice(11, 23)
            });
        } catch { /* swallow */ }
    }

    console.log = function (...args) { _capture('log', args); _origLog(...args); };
    console.error = function (...args) { _capture('error', args); _origError(...args); };
    console.warn = function (...args) { _capture('warn', args); _origWarn(...args); };
})();

const GITHUB_REPO_OWNER = 'modcoretech';
const GITHUB_REPO_NAME = 'modcore-extension-manager';
const GITHUB_BASE_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/new`;
const GITHUB_DISCUSSIONS_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/discussions/new`;
const TOTAL_STEPS = 3;
const MAX_BODY_CHARS = 6500;

const ISSUE_TEMPLATES = {
    BUG: {
        name: '🐛 Something is broken (Bug Report)',
        titlePrefix: '[BUG]',
        label: 'bug',
        summaryPlaceholder: 'e.g., The settings button disappears on page reload.',
        descriptionPlaceholder: '1. What are the clear, repeatable steps?\n2. Expected result?\n3. Actual result?',
        instructions: 'Provide clear steps to reproduce so we can fix it quickly.'
    },
    FEATURE: {
        name: '✨ I have an idea (Feature Suggestion)',
        titlePrefix: '[FEATURE]',
        label: 'enhancement',
        summaryPlaceholder: 'e.g., Add a dark mode toggle button.',
        descriptionPlaceholder: 'Describe the feature, why it is needed, and how it improves the extension.',
        instructions: 'Explain the value and intended usage of your suggestion.'
    },
    GENERAL: {
        name: '💬 General question or feedback',
        titlePrefix: '[FEEDBACK]',
        label: 'feedback',
        summaryPlaceholder: 'e.g., Question about installation process.',
        descriptionPlaceholder: 'Provide your detailed question or general feedback, including context.',
        instructions: 'Provide full context for your question or feedback.',
        useDiscussions: true
    }
};

function createElement(tag, className = '', attributes = {}) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    Object.entries(attributes).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

function getExtensionVersion() {
    try {
        return chrome.runtime.getManifest()?.version ?? 'N/A';
    } catch {
        return 'N/A';
    }
}

async function getAccurateTechnicalInfo() {
    let browserName = 'Unknown';
    let browserVersion = 'N/A';
    let browserEngine = 'Unknown';
    let os = 'Unknown';
    let osVersion = 'N/A';
    let architecture = 'N/A';
    const ua = navigator.userAgent;

    if (navigator.userAgentData) {
        try {
            const hints = await navigator.userAgentData.getHighEntropyValues([
                'platform', 'platformVersion', 'fullVersionList', 'architecture', 'bitness'
            ]);
            os = hints.platform || 'Unknown';
            osVersion = hints.platformVersion || 'N/A';
            architecture = hints.architecture
                ? `${hints.architecture}${hints.bitness ? `-${hints.bitness}bit` : ''}`
                : 'N/A';

            const primary = hints.fullVersionList?.find(
                b => b.brand && !b.brand.includes('Not') && b.brand !== 'Chromium'
            ) ?? hints.fullVersionList?.[0];
            if (primary) {
                browserName = primary.brand;
                browserVersion = primary.version;
            }
        } catch { /* fallback */ }
    }

    if (browserName === 'Unknown') {
        const edgeMatch = ua.match(/Edg\/([\d.]+)/);
        const chromeMatch = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/);
        const ffMatch = ua.match(/Firefox\/([\d.]+)/);
        const safariMatch = ua.match(/Version\/([\d.]+).*Safari/);

        if (edgeMatch) { browserName = 'Edge'; browserVersion = edgeMatch[1]; }
        else if (chromeMatch) { browserName = 'Chrome'; browserVersion = chromeMatch[1]; }
        else if (ffMatch) { browserName = 'Firefox'; browserVersion = ffMatch[1]; }
        else if (safariMatch) { browserName = 'Safari'; browserVersion = safariMatch[1]; }

        if (ua.includes('Windows')) os = 'Windows';
        else if (ua.includes('Mac')) os = 'macOS';
        else if (ua.includes('Linux')) os = 'Linux';
        else if (ua.includes('Android')) os = 'Android';
        else if (ua.includes('iOS')) os = 'iOS';
    }

    if (ua.includes('Firefox')) browserEngine = 'Gecko';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browserEngine = 'WebKit';
    else if (ua.includes('Chrome') || ua.includes('CriOS')) browserEngine = 'Blink';

    let pageLoadMs = 'N/A';
    try {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav) pageLoadMs = `${Math.round(nav.loadEventEnd - nav.startTime)} ms`;
    } catch { /* ignore */ }

    const memory = navigator.deviceMemory != null ? `${navigator.deviceMemory} GB` : 'N/A';
    const cpuCores = navigator.hardwareConcurrency ?? 'N/A';
    const screenRes = `${screen.width}×${screen.height} (${screen.colorDepth}-bit) @ ${window.devicePixelRatio}x DPR`;
    const viewport = `${window.innerWidth}×${window.innerHeight}`;
    const lang = navigator.language;
    const cookiesOn = navigator.cookieEnabled ? 'Yes' : 'No';
    const doNotTrack = navigator.doNotTrack === '1' ? 'Yes' : (navigator.doNotTrack === '0' ? 'No' : 'N/A');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'N/A';
    const currentURL = window.location.href.slice(0, 120);

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
| **Page Load Time** | \`${pageLoadMs}\` |
| **Timezone** | \`${timezone}\` |
| **Language** | \`${lang}\` |
| **Cookies Enabled** | \`${cookiesOn}\` |
| **Do Not Track** | \`${doNotTrack}\` |
| **Current URL** | \`${currentURL}\` |
`.trim();
}

async function getInstalledExtensionsInfo() {
    try {
        if (!chrome?.management?.getAll) return '_chrome.management API not available._';

        const extensions = await new Promise((resolve, reject) => {
            chrome.management.getAll(result => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve(result);
            });
        });

        const selfId = chrome.runtime.id;
        const list = extensions
            .filter(e => e.id !== selfId)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (!list.length) return '_No other extensions installed._';

        const MAX_EXT = 30;
        const rows = list.slice(0, MAX_EXT).map(e => {
            const name = e.name.slice(0, 40).replace(/\|/g, '\\|');
            const version = (e.version ?? 'N/A').slice(0, 10);
            const state = e.enabled ? '✅ Enabled' : '⛔ Disabled';
            const type = e.type ?? 'extension';
            return `| ${name} | ${version} | ${state} | ${type} |`;
        });

        const truncNote = list.length > MAX_EXT
            ? `\n_…and ${list.length - MAX_EXT} more (truncated)._`
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

function createReportDialog() {
    const style = createElement('style');
    style.textContent = `
        @import url('${chrome.runtime.getURL('../../src/css/variables.css')}');

        @media (prefers-reduced-motion: reduce) {
            .modcore-dialog-overlay, .modcore-dialog-overlay * {
                transition: none !important;
                animation: none !important;
            }
        }

        .modcore-dialog-overlay * {
            box-sizing: border-box;
            font-family: var(--font-sans);
            line-height: 1.45;
        }

        .modcore-dialog-overlay {
            position: fixed;
            inset: 0;
            background: var(--color-backdrop);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 2147483647;
            opacity: 0;
            transition: opacity 0.25s var(--ease-standard);
        }
        .modcore-dialog-overlay.is-open { opacity: 1; }

        .modcore-dialog-content {
            background: var(--color-modal-bg);
            color: var(--color-text-primary);
            padding: 22px;
            border-radius: var(--radius-2xl);
            box-shadow: var(--shadow-lg);
            width: 92%;
            max-width: 460px;
            max-height: 92vh;
            overflow-y: auto;
            overflow-x: hidden;
            transform: scale(0.92) translateY(16px);
            transition: transform 0.35s var(--ease-bounce), opacity 0.3s var(--ease-standard);
            opacity: 0;
            scrollbar-width: thin;
            scrollbar-color: var(--color-border) transparent;
        }
        .modcore-dialog-overlay.is-open .modcore-dialog-content {
            transform: scale(1) translateY(0);
            opacity: 1;
        }
        .modcore-dialog-content::-webkit-scrollbar { width: 5px; }
        .modcore-dialog-content::-webkit-scrollbar-thumb {
            background: var(--color-border);
            border-radius: var(--radius-full);
        }

        .modcore-form-header {
            font-size: var(--text-headline-sm);
            font-weight: var(--weight-bold);
            margin-bottom: 16px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--color-primary);
            color: var(--color-primary);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .modcore-form-step-status {
            font-size: var(--text-label-lg);
            font-weight: var(--weight-medium);
            color: var(--color-text-muted);
            background: var(--color-surface-mid);
            padding: 3px 10px;
            border-radius: var(--radius-full);
        }

        .modcore-progress-bar-track {
            height: 3px;
            background: var(--color-border);
            border-radius: var(--radius-full);
            margin-bottom: 18px;
            overflow: hidden;
        }
        .modcore-progress-bar-fill {
            height: 100%;
            background: var(--color-primary);
            border-radius: var(--radius-full);
            transition: width 0.4s var(--ease-standard);
            width: 33.33%;
            box-shadow: 0 0 10px rgba(var(--color-primary-rgb), 0.35);
        }

        .modcore-dialog-content label {
            display: block;
            margin-bottom: 4px;
            font-size: var(--text-body-md);
            font-weight: var(--weight-semibold);
            color: var(--color-text-primary);
        }
        .modcore-dialog-content input:not([type="checkbox"]):not(.modcore-type-radio),
        .modcore-dialog-content textarea,
        .modcore-dialog-content select {
            width: 100%;
            padding: 10px 14px;
            border-radius: var(--radius-2xl);
            margin-top: 2px;
            margin-bottom: 12px;
            font-size: var(--text-body-md);
            border: 1.5px solid var(--color-border);
            background: var(--color-surface);
            color: var(--color-text-primary);
            transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
        }
        .modcore-dialog-content input:focus,
        .modcore-dialog-content textarea:focus,
        .modcore-dialog-content select:focus {
            outline: none;
            border-color: var(--color-primary);
            box-shadow: 0 0 0 3.5px var(--color-focus-ring);
            transform: translateY(-1px);
        }
        .modcore-dialog-content textarea { min-height: 90px; resize: vertical; }

        .modcore-dialog-content input[aria-invalid="true"],
        .modcore-dialog-content textarea[aria-invalid="true"] {
            border-color: var(--color-danger) !important;
            background: var(--color-danger-container);
        }

        .modcore-modal-note {
            background: var(--color-info-container);
            color: var(--color-info);
            padding: 10px 14px;
            border-radius: var(--radius-2xl);
            font-size: var(--text-body-sm);
            margin-top: 4px;
            border: 1px solid rgba(var(--color-info-rgb), 0.15);
            animation: noteSlideIn 0.25s var(--ease-standard) forwards;
        }
        @keyframes noteSlideIn {
            from { opacity: 0; transform: translateY(-6px); }
            to   { opacity: 1; transform: translateY(0); }
        }

        .modcore-privacy-note {
            margin-top: 14px;
            padding: 10px 14px;
            font-size: var(--text-label-lg);
            background: var(--color-warning-container);
            color: var(--color-text-primary);
            border: 1px solid rgba(var(--color-warning-rgb), 0.25);
            border-radius: var(--radius-2xl);
        }

        .modcore-error-note {
            background: var(--color-danger-container);
            color: var(--color-danger);
            padding: 10px 14px;
            border-radius: var(--radius-2xl);
            font-size: var(--text-body-sm);
            border: 1.5px solid rgba(var(--color-danger-rgb), 0.35);
            animation: shakeError 0.4s var(--ease-standard);
            margin-bottom: 10px;
        }
        @keyframes shakeError {
            0%, 100% { transform: translateX(0); }
            20% { transform: translateX(-6px); }
            40% { transform: translateX(6px); }
            60% { transform: translateX(-4px); }
            80% { transform: translateX(4px); }
        }

        .modcore-form-step {
            display: none;
            flex-direction: column;
            gap: 10px;
        }
        .modcore-form-step.current {
            display: flex;
            animation: stepIn 0.3s var(--ease-standard) forwards;
        }
        .modcore-form-step.step-out {
            animation: stepOut 0.2s ease forwards;
        }
        @keyframes stepIn {
            from { opacity: 0; transform: translateX(20px) scale(0.98); }
            to   { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes stepOut {
            from { opacity: 1; transform: translateX(0) scale(1); }
            to   { opacity: 0; transform: translateX(-16px) scale(0.98); }
        }
        .modcore-form-step.step-back-in {
            animation: stepBackIn 0.3s var(--ease-standard) forwards;
        }
        @keyframes stepBackIn {
            from { opacity: 0; transform: translateX(-20px) scale(0.98); }
            to   { opacity: 1; transform: translateX(0) scale(1); }
        }

        .modcore-type-options-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .modcore-type-option {
            position: relative;
            display: flex;
            align-items: center;
            padding: 12px 14px 12px 46px;
            border: 1.5px solid var(--color-border);
            border-radius: var(--radius-2xl);
            cursor: pointer;
            transition: all 0.2s var(--ease-standard);
            background: var(--color-surface);
            color: var(--color-text-primary);
        }
        .modcore-type-option:hover {
            background: var(--color-surface-hover);
            transform: translateY(-2px);
            box-shadow: var(--shadow-sm);
        }
        .modcore-type-option:active { transform: translateY(0); }
        .modcore-type-option.is-selected {
            border-color: var(--color-primary);
            background: var(--color-primary-container);
            box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb), 0.12);
        }
        .modcore-type-radio {
            position: absolute;
            left: 16px; top: 50%;
            transform: translateY(-50%);
            margin: 0;
            width: 16px; height: 16px;
            opacity: 0;
        }
        .modcore-type-option::before {
            content: "";
            position: absolute;
            left: 16px; top: 50%;
            transform: translateY(-50%);
            width: 14px; height: 14px;
            border-radius: 50%;
            background: transparent;
            border: 2px solid var(--color-border);
            transition: all 0.15s;
        }
        .modcore-type-option.is-selected::before {
            background: var(--color-primary);
            border-color: var(--color-primary);
            box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb), 0.2);
        }
        .modcore-type-option.is-selected::after {
            content: "";
            position: absolute;
            left: 21px; top: 50%;
            transform: translateY(-50%) rotate(45deg);
            width: 4px; height: 7px;
            border-right: 2px solid var(--color-primary-on);
            border-bottom: 2px solid var(--color-primary-on);
            margin-top: -1px;
        }
        .modcore-type-option-text { font-weight: var(--weight-medium); font-size: var(--text-body-md); }

        .mc-checkbox-row {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 12px 14px;
            border: 1.5px solid var(--color-border);
            border-radius: var(--radius-2xl);
            background: var(--color-surface);
            transition: all 0.15s;
            cursor: pointer;
        }
        .mc-checkbox-row:has(input:checked) {
            border-color: var(--color-primary);
            background: var(--color-primary-container);
        }
        .mc-checkbox-row:hover { background: var(--color-surface-hover); }
        .mc-checkbox-header {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .mc-checkbox-header input[type="checkbox"] {
            width: 17px;
            height: 17px;
            flex-shrink: 0;
            accent-color: var(--color-primary);
            cursor: pointer;
        }
        .mc-checkbox-header label {
            font-weight: var(--weight-semibold);
            font-size: var(--text-body-md);
            margin-bottom: 0;
            cursor: pointer;
            flex: 1;
        }
        .mc-checkbox-badge {
            font-size: var(--text-label-sm);
            font-weight: var(--weight-semibold);
            padding: 2px 8px;
            border-radius: var(--radius-full);
            background: var(--color-primary-container);
            color: var(--color-primary);
        }
        .mc-checkbox-desc {
            font-size: var(--text-label-lg);
            color: var(--color-text-muted);
            padding-left: 27px;
            line-height: 1.4;
        }

        .modcore-form-actions {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1.5px solid var(--color-border);
        }
        .modcore-form-actions .mc-right-actions {
            display: flex;
            gap: 8px;
        }
        .modcore-dialog-content button {
            padding: 9px 16px;
            border: none;
            border-radius: var(--radius-2xl);
            cursor: pointer;
            font-weight: var(--weight-semibold);
            font-size: var(--text-body-md);
            transition: all 0.18s var(--ease-standard);
            color: var(--color-primary-on);
            position: relative;
            overflow: hidden;
        }
        .modcore-dialog-content button::after {
            content: "";
            position: absolute;
            inset: 0;
            background: rgba(255,255,255,0.15);
            opacity: 0;
            border-radius: inherit;
            transition: opacity 0.25s;
        }
        .modcore-dialog-content button:hover::after { opacity: 1; }
        .modcore-dialog-content button:active { transform: scale(0.96); }
        .modcore-dialog-content button:disabled {
            opacity: 0.45;
            cursor: not-allowed;
            transform: none;
        }
        .btn-secondary {
            background: var(--color-surface-high);
            color: var(--color-text-secondary);
        }
        .btn-secondary:hover:not(:disabled) { background: var(--color-surface-hover); }
        .btn-primary { background: var(--color-primary); }
        .btn-primary:hover:not(:disabled) { background: var(--color-primary-hover); }
        .btn-success { background: var(--color-success); }
        .btn-success:hover:not(:disabled) { background: var(--color-success-hover); }

        .btn-loading { pointer-events: none; }
        .btn-loading-text::after { content: " ⏳"; }

        .modcore-dialog-content, .modcore-dialog-content * {
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
    `;

    const overlay = createElement('div', 'modcore-dialog-overlay', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'modcore-dialog-title',
        'aria-describedby': 'step-status'
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) removeModal(); });

    const content = createElement('div', 'modcore-dialog-content', { 'aria-live': 'polite' });

    const header = createElement('div', 'modcore-form-header', { id: 'modcore-dialog-title' });
    header.textContent = 'modcore Issue Reporter';
    const stepStatus = createElement('span', 'modcore-form-step-status', { id: 'step-status', 'aria-live': 'polite' });
    stepStatus.textContent = `Step 1 of ${TOTAL_STEPS}`;
    header.appendChild(stepStatus);

    const progressTrack = createElement('div', 'modcore-progress-bar-track', {
        role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(TOTAL_STEPS),
        'aria-valuenow': '1', 'aria-label': 'Form progress'
    });
    const progressFill = createElement('div', 'modcore-progress-bar-fill');
    progressTrack.appendChild(progressFill);

    const form = createElement('form');
    form.setAttribute('novalidate', 'true');

    // Step 1
    const step1 = createStepElement('step-1');
    const typeHeading = createElement('label');
    typeHeading.setAttribute('id', 'type-heading');
    typeHeading.textContent = '1. What kind of report are you submitting?';

    const typeOptionsGroup = createElement('div', 'modcore-type-options-group', {
        role: 'radiogroup', 'aria-labelledby': 'type-heading'
    });

    Object.keys(ISSUE_TEMPLATES).forEach(key => {
        const template = ISSUE_TEMPLATES[key];
        const optionLabel = createElement('label', 'modcore-type-option', {
            for: `issue-type-${key}`, tabindex: '0'
        });
        const radio = createElement('input', 'modcore-type-radio', {
            type: 'radio', id: `issue-type-${key}`, name: 'issue-type', value: key, 'aria-required': 'true'
        });
        const optionText = createElement('span', 'modcore-type-option-text');
        optionText.textContent = template.name;

        optionLabel.appendChild(radio);
        optionLabel.appendChild(optionText);

        optionLabel.addEventListener('click', () => {
            typeOptionsGroup.querySelectorAll('.modcore-type-option').forEach(el => el.classList.remove('is-selected'));
            optionLabel.classList.add('is-selected');
            radio.checked = true;
            updateStep2Template(key);
        });

        optionLabel.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                optionLabel.click();
            }
        });

        typeOptionsGroup.appendChild(optionLabel);
    });

    const initialType = Object.keys(ISSUE_TEMPLATES)[0];
    const initialRadio = typeOptionsGroup.querySelector(`input[value="${initialType}"]`);
    if (initialRadio) {
        initialRadio.checked = true;
        initialRadio.parentElement.classList.add('is-selected');
    }

    step1.appendChild(typeHeading);
    step1.appendChild(typeOptionsGroup);

    // Step 2
    const step2 = createStepElement('step-2');
    const summaryLabel = createElement('label', '', { for: 'issue-summary' });
    summaryLabel.textContent = '2. Short Summary / Title';
    const summaryInput = createElement('input', '', {
        type: 'text', id: 'issue-summary', name: 'issue-summary', required: 'true',
        'aria-required': 'true', 'aria-label': 'Short summary or title', maxlength: '120', autocomplete: 'off'
    });

    const descriptionLabel = createElement('label', '', { for: 'issue-description' });
    descriptionLabel.textContent = '3. Detailed Description';
    const descriptionTextarea = createElement('textarea', '', {
        id: 'issue-description', name: 'issue-description', required: 'true',
        'aria-required': 'true', 'aria-label': 'Detailed description', maxlength: '2000'
    });

    const instructionsNote = createElement('div', 'modcore-modal-note', { id: 'instructions-note', role: 'note' });

    step2.appendChild(summaryLabel);
    step2.appendChild(summaryInput);
    step2.appendChild(descriptionLabel);
    step2.appendChild(descriptionTextarea);
    step2.appendChild(instructionsNote);

    // Step 3
    const step3 = createStepElement('step-3');

    function makeCheckboxRow({ id, label, description, badge, defaultChecked = false }) {
        const row = createElement('div', 'mc-checkbox-row');
        row.setAttribute('role', 'group');

        const headerDiv = createElement('div', 'mc-checkbox-header');
        const checkbox = createElement('input', '', {
            type: 'checkbox', id, name: id, 'aria-describedby': `${id}-desc`
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

        row.addEventListener('click', e => {
            if (e.target !== checkbox && e.target !== lbl) checkbox.checked = !checkbox.checked;
        });

        return { row, checkbox };
    }

    const { row: techRow, checkbox: techInfoCheckbox } = makeCheckboxRow({
        id: 'include-tech-info', label: 'Include technical environment details',
        description: 'Browser, OS, architecture, screen, performance timing, and more. Highly recommended for bug reports.',
        badge: 'Recommended', defaultChecked: true
    });
    techInfoCheckbox.checked = true;

    const { row: extRow, checkbox: extListCheckbox } = makeCheckboxRow({
        id: 'include-ext-list', label: 'Include installed extensions list',
        description: 'Lists your other installed extensions. Useful for compatibility issues.',
        badge: 'Optional', defaultChecked: false
    });

    const logCount = _capturedConsoleLogs.length;
    const { row: consoleRow, checkbox: consoleLogsCheckbox } = makeCheckboxRow({
        id: 'include-console-logs', label: 'Include recent console logs & errors',
        description: `Attaches up to ${MAX_CONSOLE_ENTRIES} captured console messages. ${logCount} entr${logCount === 1 ? 'y' : 'ies'} captured so far.`,
        badge: logCount > 0 ? `${logCount} captured` : 'Optional', defaultChecked: false
    });

    const privacyNote = createElement('div', 'modcore-privacy-note', { role: 'note' });
    const privacyStrong = createElement('strong');
    privacyStrong.textContent = '⚠ Privacy: ';
    privacyNote.appendChild(privacyStrong);
    privacyNote.appendChild(document.createTextNode('Your report will open on the '));
    const privacyEm = createElement('em');
    privacyEm.textContent = 'public';
    privacyNote.appendChild(privacyEm);
    privacyNote.appendChild(document.createTextNode(` ${GITHUB_REPO_NAME} GitHub page. Ensure your summary and description contain no personal or sensitive information.`));

    step3.appendChild(techRow);
    step3.appendChild(extRow);
    step3.appendChild(consoleRow);
    step3.appendChild(privacyNote);

    // Actions
    const actionsDiv = createElement('div', 'modcore-form-actions');
    const rightActions = createElement('div', 'mc-right-actions');

    const cancelButton = createElement('button', 'btn-secondary', { type: 'button', 'aria-label': 'Cancel and close' });
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', removeModal);

    const backButton = createElement('button', 'btn-secondary', {
        type: 'button', id: 'back-button', disabled: 'true', 'aria-label': 'Go to previous step'
    });
    backButton.textContent = '← Back';
    backButton.style.visibility = 'hidden';
    backButton.addEventListener('click', () => navigateStep(-1));

    const nextButton = createElement('button', 'btn-primary', {
        type: 'button', id: 'next-button', 'aria-label': 'Go to next step'
    });
    nextButton.textContent = 'Next →';
    nextButton.addEventListener('click', () => navigateStep(1));

    rightActions.appendChild(backButton);
    rightActions.appendChild(nextButton);
    actionsDiv.appendChild(cancelButton);
    actionsDiv.appendChild(rightActions);

    // Assemble
    form.appendChild(step1);
    form.appendChild(step2);
    form.appendChild(step3);
    form.appendChild(actionsDiv);

    content.appendChild(header);
    content.appendChild(progressTrack);
    content.appendChild(form);

    overlay.appendChild(style);
    overlay.appendChild(content);

    // Live validation cleanup
    summaryInput.addEventListener('input', () => {
        summaryInput.setAttribute('aria-invalid', 'false');
        form.querySelector('.modcore-error-note')?.remove();
    });
    descriptionTextarea.addEventListener('input', () => {
        descriptionTextarea.setAttribute('aria-invalid', 'false');
        form.querySelector('.modcore-error-note')?.remove();
    });

    updateStep2Template(initialType);
    step1.classList.add('current');

    overlay.addEventListener('keydown', trapFocus);

    return overlay;

    // ---- Inner helpers ----

    function createStepElement(id) {
        return createElement('div', 'modcore-form-step', {
            id, role: 'group', 'aria-labelledby': 'modcore-dialog-title'
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

        if (direction > 0 && currentStepIndex === 1) {
            const isSummaryEmpty = !summaryInput.value.trim();
            const isDescriptionEmpty = !descriptionTextarea.value.trim();

            summaryInput.setAttribute('aria-invalid', String(isSummaryEmpty));
            descriptionTextarea.setAttribute('aria-invalid', String(isDescriptionEmpty));

            if (isSummaryEmpty || isDescriptionEmpty) {
                let errorDiv = form.querySelector('.modcore-error-note');
                if (!errorDiv) {
                    errorDiv = createElement('div', 'modcore-error-note', { id: 'validation-error', role: 'alert' });
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
            steps[currentStepIndex].classList.add('step-out');
            setTimeout(() => {
                steps[currentStepIndex].classList.remove('current', 'step-out');

                steps[newStepIndex].classList.add('current');
                if (direction < 0) steps[newStepIndex].classList.add('step-back-in');

                backButton.style.visibility = newStepIndex > 0 ? 'visible' : 'hidden';
                backButton.disabled = newStepIndex === 0;

                const isLast = newStepIndex === steps.length - 1;
                nextButton.textContent = isLast ? '🚀 Send to GitHub' : 'Next →';
                nextButton.className = isLast ? 'btn-success' : 'btn-primary';
                nextButton.setAttribute('aria-label', isLast ? 'Submit report to GitHub' : 'Go to next step');

                stepStatus.textContent = `Step ${newStepIndex + 1} of ${TOTAL_STEPS}`;
                updateProgress(newStepIndex);

                const firstFocusable = steps[newStepIndex].querySelector(
                    'input:not([type="hidden"]), select, textarea, button:not(#back-button), .modcore-type-option'
                );
                firstFocusable?.focus();
            }, 160);

        } else if (newStepIndex === steps.length) {
            nextButton.disabled = true;
            nextButton.classList.add('btn-loading');
            nextButton.textContent = '';
            const loadingSpan = createElement('span', 'btn-loading-text');
            loadingSpan.textContent = 'Opening GitHub';
            nextButton.appendChild(loadingSpan);
            handleFormSubmission(form);
        }
    }

    function trapFocus(e) {
        if (e.key !== 'Tab') return;
        const focusable = Array.from(
            overlay.querySelectorAll(
                'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
        ).filter(el => !el.closest('.modcore-form-step:not(.current)'));

        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
}

function displayModal() {
    if (reportDialogElement || !document.body) return;
    previousActiveElement = document.activeElement;
    reportDialogElement = createReportDialog();
    document.body.appendChild(reportDialogElement);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => reportDialogElement?.classList.add('is-open'));
    });

    reportDialogElement.querySelector('.modcore-type-option')?.focus();
}

function removeModal() {
    if (!reportDialogElement) return;
    reportDialogElement.classList.remove('is-open');
    const dying = reportDialogElement;
    reportDialogElement = null;
    setTimeout(() => {
        dying.remove();
        previousActiveElement?.focus();
        previousActiveElement = null;
    }, 320);
}

async function handleFormSubmission(form) {
    const typeKey = form.elements['issue-type'].value;
    const summary = form.elements['issue-summary'].value.trim();
    const description = form.elements['issue-description'].value.trim();
    const includeTech = form.elements['include-tech-info'].checked;
    const includeExtList = form.elements['include-ext-list'].checked;
    const includeConsole = form.elements['include-console-logs'].checked;

    const template = ISSUE_TEMPLATES[typeKey] || ISSUE_TEMPLATES.GENERAL;
    const issueTitle = `${template.titlePrefix} ${summary}`;
    const isDiscussion = template.useDiscussions === true;
    const targetUrl = isDiscussion ? GITHUB_DISCUSSIONS_URL : GITHUB_BASE_URL;

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

    let issueBody = bodyParts.join('\n');
    if (issueBody.length > MAX_BODY_CHARS) {
        issueBody = issueBody.slice(0, MAX_BODY_CHARS) + '\n\n_…(report truncated to stay within URL limits)_';
    }

    const params = new URLSearchParams();
    params.append('title', issueTitle);
    params.append('body', issueBody);

    if (!isDiscussion && template.label) {
        params.append('labels', template.label);
    }
    if (isDiscussion) {
        params.append('category', 'general');
    }

    window.open(`${targetUrl}?${params.toString()}`, '_blank');
    removeModal();
}

function handleKeydown(event) {
    const hasModifier = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
    const activeElement = document.activeElement;
    const isTyping = activeElement && (
        (activeElement.tagName === 'INPUT' &&
            activeElement.type !== 'checkbox' &&
            activeElement.type !== 'radio') ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable ||
        activeElement.tagName === 'SELECT'
    );

    if (event.key === 'e' && !hasModifier && !isTyping) {
        event.preventDefault();
        event.stopPropagation();
        displayModal();
        return;
    }

    if (event.key === 'Escape' && reportDialogElement) {
        event.preventDefault();
        event.stopPropagation();
        removeModal();
    }
}

document.addEventListener('keydown', handleKeydown);
