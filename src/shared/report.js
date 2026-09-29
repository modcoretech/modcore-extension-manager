// report.js – modcore Extension Manager (Universal & Optimized)

'use strict';

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.ModcoreReport = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  let _sidebar = null;
  let _prevFocus = null;
  let _isClosing = false;
  const _consoleLogs = [];
  let _consoleCaptureInstalled = false;
  let _stylesInstalled = false;

  const MAX_LOGS = 50;
  const MAX_LOG_ENTRY_LENGTH = 500;

  const REPO_OWNER = 'modcoretech';
  const REPO_NAME = 'modcore-extension-manager';
  const ISSUE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new`;
  const DISCUSS_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/discussions/new`;

  const CATEGORIES = {
    BUG: {
      name: 'Bug Report',
      prefix: '[BUG]',
      label: 'bug',
      instructions: 'Select optional attachments below to include context before creating your bug report on GitHub.'
    },
    FEATURE: {
      name: 'Feature Suggestion',
      prefix: '[FEATURE]',
      label: 'enhancement',
      instructions: 'Select optional attachments below to include context before suggesting your feature on GitHub.'
    },
    GENERAL: {
      name: 'General Feedback',
      prefix: '[FEEDBACK]',
      label: 'feedback',
      instructions: 'Select optional attachments below to include context before starting a discussion on GitHub.',
      discuss: true
    }
  };

  // --- Stringification & Console Capture ---

  function safeStringify(arg) {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'string') return arg.slice(0, MAX_LOG_ENTRY_LENGTH);
    if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') return String(arg);
    if (typeof arg === 'function') return '[Function]';
    if (arg instanceof Error) return (arg.stack || arg.message || String(arg)).slice(0, MAX_LOG_ENTRY_LENGTH);
    if (arg instanceof Date) return arg.toISOString();
    if (typeof arg === 'object') {
      try {
        const seen = new WeakSet();
        const str = JSON.stringify(arg, (k, v) => {
          if (typeof v === 'object' && v !== null) {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);
          }
          if (typeof v === 'string' && v.length > 150) return `${v.slice(0, 150)}...`;
          return v;
        });
        return str.slice(0, MAX_LOG_ENTRY_LENGTH);
      } catch {
        return '[Object]';
      }
    }
    return String(arg);
  }

  function captureEntry(type, args, meta = {}) {
    if (_consoleLogs.length >= MAX_LOGS) _consoleLogs.shift();
    
    // Fast shallow snapshot to avoid mutation issues before reporting
    const snapshots = Array.from(args).map(arg => {
      if (arg === null || arg === undefined || typeof arg !== 'object') return arg;
      if (arg instanceof Error) return { name: arg.name, message: arg.message, stack: arg.stack };
      try {
        return Array.isArray(arg) ? arg.slice(0, 10) : { ...arg };
      } catch {
        return String(arg);
      }
    });

    _consoleLogs.push({
      type,
      args: snapshots,
      ts: new Date().toISOString().slice(11, 23),
      ...meta
    });
  }

  function ensureConsoleCapture() {
    if (_consoleCaptureInstalled) return;
    _consoleCaptureInstalled = true;

    const methods = ['log', 'info', 'debug', 'warn', 'error', 'trace'];
    methods.forEach(method => {
      if (typeof console[method] !== 'function') return;
      const original = console[method].bind(console);
      console[method] = (...args) => {
        captureEntry(method, args);
        original(...args);
      };
    });

    window.addEventListener('error', e => {
      const msg = e.error instanceof Error ? (e.error.stack || e.error.message) : e.message;
      captureEntry('error', [msg], { source: e.filename, line: e.lineno, col: e.colno });
    });

    window.addEventListener('unhandledrejection', e => {
      const msg = e.reason instanceof Error ? (e.reason.stack || e.reason.message) : e.reason;
      captureEntry('unhandledrejection', [msg]);
    });
  }

  // --- DOM Helpers & Styles ---

  function el(tag, cls, attrs = {}) {
    const elem = document.createElement(tag);
    if (cls) elem.className = cls;
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null) elem.setAttribute(k, v);
    }
    return elem;
  }

  function escMD(str) {
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/[\n\r]+/g, ' ')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .trim();
  }

  function ensureStyles() {
    if (_stylesInstalled) return;
    _stylesInstalled = true;

    const style = el('style', 'mc-report-styles');
    style.textContent = `
      @media (prefers-reduced-motion: reduce) {
        .mc-sidebar-overlay, .mc-sidebar-overlay * {
          transition: none !important;
          animation: none !important;
        }
      }

      .mc-sidebar-overlay {
        position: fixed;
        inset: 0;
        background: var(--color-backdrop, rgba(0, 0, 0, 0.5));
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        display: flex;
        justify-content: flex-end;
        z-index: 2147483647;
        opacity: 0;
        transition: opacity var(--duration-fast, 150ms) var(--ease-standard, ease);
      }
      .mc-sidebar-overlay.open { opacity: 1; }

      .mc-sidebar-overlay * {
        box-sizing: border-box;
        font-family: var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
        line-height: var(--leading-normal, 1.5);
        -webkit-font-smoothing: antialiased;
      }

      .mc-sidebar {
        background: var(--color-bg, #1e1e2e);
        color: var(--color-text-primary, #cdd6f4);
        width: 400px;
        max-width: 90vw;
        height: 100%;
        display: flex;
        flex-direction: column;
        transform: translateX(100%);
        transition: transform var(--duration-normal, 250ms) var(--ease-standard, ease);
        border-left: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.25);
      }
      .mc-sidebar-overlay.open .mc-sidebar {
        transform: translateX(0);
      }

      .mc-sidebar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--space-4, 16px) var(--space-5, 20px);
        border-bottom: 2px solid var(--color-primary, #89b4fa);
        flex-shrink: 0;
      }
      .mc-sidebar-title {
        font-size: var(--text-headline-sm, 1.125rem);
        font-weight: var(--weight-bold, 700);
        color: var(--color-primary, #89b4fa);
        margin: 0;
      }
      .mc-sidebar-close {
        background: transparent;
        border: none;
        padding: var(--space-1, 4px);
        border-radius: var(--radius-md, 6px);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-icon, #a6adc8);
        transition: background var(--duration-fast, 150ms) var(--ease-standard, ease);
      }
      .mc-sidebar-close:hover {
        background: var(--color-surface-hover, rgba(255, 255, 255, 0.08));
      }

      .mc-sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-5, 20px);
        scrollbar-width: thin;
        scrollbar-color: var(--color-scrollbar-thumb, #45475a) transparent;
      }

      .mc-section {
        margin-bottom: var(--space-5, 20px);
        padding-bottom: var(--space-5, 20px);
        border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
      }
      .mc-section:last-child {
        margin-bottom: 0;
        padding-bottom: 0;
        border-bottom: none;
      }
      .mc-section-label {
        display: block;
        font-size: var(--text-body-md, 0.9375rem);
        font-weight: var(--weight-semibold, 600);
        color: var(--color-text-primary, #cdd6f4);
        margin-bottom: var(--space-3, 12px);
      }

      .mc-type-group {
        display: flex;
        flex-direction: column;
        gap: var(--space-2, 8px);
        border: none;
        padding: 0;
        margin: 0;
      }
      .mc-type-opt {
        display: flex;
        align-items: center;
        gap: var(--space-3, 12px);
        padding: var(--space-3, 12px) var(--space-4, 16px);
        border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
        border-radius: var(--radius-lg, 8px);
        cursor: pointer;
        transition: background var(--duration-fast, 150ms), border-color var(--duration-fast, 150ms);
        background: var(--color-surface, #2a2b3d);
        color: var(--color-text-primary, #cdd6f4);
      }
      .mc-type-opt:hover {
        background: var(--color-surface-hover, rgba(255, 255, 255, 0.08));
      }
      .mc-type-opt:has(input:checked) {
        border-color: var(--color-primary, #89b4fa);
        background: var(--color-primary-container, rgba(137, 180, 250, 0.15));
      }
      .mc-type-opt input[type="radio"] {
        width: 16px;
        height: 16px;
        margin: 0;
        accent-color: var(--color-primary, #89b4fa);
        cursor: pointer;
      }
      .mc-type-txt { 
        font-weight: var(--weight-medium, 500); 
        font-size: var(--text-body-md, 0.9375rem); 
      }

      .mc-note {
        background: var(--color-info-container, rgba(137, 180, 250, 0.1));
        color: var(--color-info, #89b4fa);
        padding: var(--space-2, 8px) var(--space-3, 12px);
        border-radius: var(--radius-md, 6px);
        font-size: var(--text-body-sm, 0.8125rem);
        margin-top: var(--space-3, 12px);
        border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
      }

      .mc-check-row {
        display: flex;
        flex-direction: column;
        gap: var(--space-1, 4px);
        padding: var(--space-3, 12px) var(--space-4, 16px);
        border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
        border-radius: var(--radius-lg, 8px);
        background: var(--color-surface, #2a2b3d);
        transition: background var(--duration-fast, 150ms), border-color var(--duration-fast, 150ms);
        cursor: pointer;
        margin-bottom: var(--space-2, 8px);
      }
      .mc-check-row:last-child { margin-bottom: 0; }
      .mc-check-row:hover { background: var(--color-surface-hover, rgba(255, 255, 255, 0.08)); }
      .mc-check-row:has(input:checked) {
        border-color: var(--color-primary, #89b4fa);
        background: var(--color-primary-container, rgba(137, 180, 250, 0.15));
      }
      .mc-check-hdr {
        display: flex;
        align-items: center;
        gap: var(--space-3, 12px);
      }
      .mc-check-hdr input[type="checkbox"] {
        width: 16px; 
        height: 16px;
        margin: 0;
        flex-shrink: 0;
        accent-color: var(--color-primary, #89b4fa);
        cursor: pointer;
      }
      .mc-check-hdr span {
        font-weight: var(--weight-semibold, 600);
        font-size: var(--text-body-md, 0.9375rem);
        flex: 1;
      }

      .mc-check-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: var(--text-label-sm, 0.75rem);
        font-weight: var(--weight-semibold, 600);
        line-height: 1;
        padding: 2px 6px;
        border-radius: var(--radius-full, 9999px);
        background: var(--color-primary-container, rgba(137, 180, 250, 0.15));
        color: var(--color-primary, #89b4fa);
        border: 1px solid var(--color-primary, #89b4fa);
        white-space: nowrap;
        height: fit-content;
      }

      .mc-check-desc {
        font-size: var(--text-body-sm, 0.8125rem);
        color: var(--color-text-muted, #a6adc8);
        padding-left: 28px;
        line-height: 1.35;
      }

      .mc-privacy {
        padding: var(--space-3, 12px) var(--space-4, 16px);
        font-size: var(--text-body-sm, 0.8125rem);
        background: var(--color-warning-container, rgba(249, 226, 175, 0.1));
        color: var(--color-text-primary, #cdd6f4);
        border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
        border-radius: var(--radius-lg, 8px);
        margin-top: var(--space-4, 16px);
      }

      .mc-error {
        background: var(--color-danger-container, rgba(243, 139, 168, 0.15));
        color: var(--color-danger, #f38ba8);
        padding: var(--space-2, 8px) var(--space-3, 12px);
        border-radius: var(--radius-md, 6px);
        font-size: var(--text-body-sm, 0.8125rem);
        border: 1px solid var(--color-danger, #f38ba8);
        margin-bottom: var(--space-4, 16px);
      }

      .mc-sidebar-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2, 8px);
        padding: var(--space-3, 12px) var(--space-5, 20px);
        border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
        flex-shrink: 0;
      }

      .mc-sidebar-footer button {
        padding: var(--space-2, 8px) var(--space-4, 16px);
        border: 1px solid transparent;
        border-radius: var(--radius-md, 6px);
        cursor: pointer;
        font-weight: var(--weight-semibold, 600);
        font-size: var(--text-body-md, 0.9375rem);
        transition: all var(--duration-fast, 150ms) var(--ease-standard, ease);
      }
      .mc-sidebar-footer button:active { transform: scale(0.98); }
      .mc-sidebar-footer button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .btn-sec {
        background: var(--color-surface, #2a2b3d);
        color: var(--color-text-primary, #cdd6f4);
        border-color: var(--color-border, rgba(255, 255, 255, 0.12));
      }
      .btn-sec:hover:not(:disabled) { background: var(--color-surface-hover, rgba(255, 255, 255, 0.08)); }

      .btn-ok {
        background: var(--color-primary, #89b4fa);
        color: var(--color-primary-on, #11111b);
      }
      .btn-ok:hover:not(:disabled) { opacity: 0.9; }
    `;
    document.head.appendChild(style);
  }

  // --- Data Gathering Helpers ---

  function getVersion() {
    try {
      return (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || 'N/A';
    } catch {
      return 'N/A';
    }
  }

  function getTechInfo() {
    const ua = navigator.userAgent;
    let browserName = 'Unknown', browserVer = 'N/A', engine = 'Unknown';
    let os = 'Unknown';

    const m = ua.match(/Edg\/([\d.]+)/) ||
              ua.match(/(?:Chrome|CriOS)\/([\d.]+)/) ||
              ua.match(/Firefox\/([\d.]+)/) ||
              ua.match(/Version\/([\d.]+).*Safari/);
    if (m) {
      if (ua.includes('Edg')) browserName = 'Edge';
      else if (ua.includes('Chrome') || ua.includes('CriOS')) browserName = 'Chrome';
      else if (ua.includes('Firefox')) browserName = 'Firefox';
      else if (ua.includes('Safari')) browserName = 'Safari';
      browserVer = m[1];
    }

    if (ua.includes('Firefox')) engine = 'Gecko';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) engine = 'WebKit';
    else if (ua.includes('Chrome') || ua.includes('CriOS') || ua.includes('Edg')) engine = 'Blink';

    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    return [
      '### Technical Environment',
      '| Detail | Value |',
      '| :--- | :--- |',
      `| **Extension Version** | \`${getVersion()}\` |`,
      `| **Browser** | \`${browserName} ${browserVer} (${engine})\` |`,
      `| **Operating System** | \`${os}\` |`,
      `| **Screen Resolution** | \`${screen.width}x${screen.height}\` |`
    ].join('\n');
  }

  async function getExtensions() {
    if (typeof chrome === 'undefined' || !chrome.management?.getAll) {
      return '_chrome.management API unavailable in current script context._';
    }
    try {
      const exts = await chrome.management.getAll();
      const selfId = chrome.runtime?.id;
      const list = exts.filter(e => e.id !== selfId).sort((a, b) => a.name.localeCompare(b.name));
      
      if (!list.length) return '_No other extensions installed._';

      const MAX = 30;
      const rows = list.slice(0, MAX).map(e => {
        const name = escMD(e.name.slice(0, 40));
        const ver = escMD((e.version ?? 'N/A').slice(0, 10));
        const state = e.enabled ? 'Enabled' : 'Disabled';
        const type = e.type ?? 'extension';
        return `| ${name} | ${ver} | ${state} | ${type} |`;
      });

      const note = list.length > MAX ? `\n_...and ${list.length - MAX} more (truncated)._` : '';
      return [
        `### Installed Extensions (${Math.min(list.length, MAX)} shown)`,
        '| Name | Version | State | Type |',
        '| :--- | :--- | :--- | :--- |',
        ...rows,
        note
      ].join('\n');
    } catch (err) {
      return `_Could not retrieve extensions list: ${String(err).slice(0, 100)}_`;
    }
  }

  function getConsoleLogs(max = MAX_LOGS) {
    if (!_consoleLogs.length) return '_No console activity captured._';
    const entries = _consoleLogs.slice(-max);
    const lines = entries.map(e => {
      const formattedMsg = e.args.map(safeStringify).join(' ');
      let line = `[${e.ts}] [${e.type.toUpperCase()}] ${formattedMsg}`;
      if (e.source) {
        line += ` (at ${e.source}:${e.line ?? '?'}:${e.col ?? '?'})`;
      }
      return line;
    });

    return [
      `### Console Logs (last ${entries.length} entries)`,
      '```',
      ...lines,
      '```'
    ].join('\n');
  }

  // --- UI Builder ---

  function buildSidebar() {
    ensureStyles();

    const overlay = el('div', 'mc-sidebar-overlay mc-dialog', {
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mc-sidebar-title'
    });

    const sidebar = el('div', 'mc-sidebar');

    // Header
    const header = el('div', 'mc-sidebar-header');
    const title = el('h2', 'mc-sidebar-title', { id: 'mc-sidebar-title' });
    title.textContent = 'Issue Reporter';
    const closeBtn = el('button', 'mc-sidebar-close', { type: 'button', 'aria-label': 'Close' });
    closeBtn.innerHTML = '&#215;'; // Clear fallback close cross symbol
    header.append(title, closeBtn);

    // Content
    const content = el('div', 'mc-sidebar-content');

    let selCategory = 'BUG';
    let instrNote, techCb, extCb, logCb, submitBtn, errorBox;

    function clearError() {
      if (errorBox) { 
        if (errorBox._tId) clearTimeout(errorBox._tId);
        errorBox.remove(); 
        errorBox = null; 
      }
    }

    function showError(msg) {
      clearError();
      errorBox = el('div', 'mc-error', { role: 'alert' });
      errorBox.textContent = msg;
      content.insertBefore(errorBox, content.firstChild);
      errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      errorBox._tId = setTimeout(clearError, 4500);
    }

    function updateForm(catKey) {
      const cat = CATEGORIES[catKey] || CATEGORIES.BUG;
      instrNote.textContent = cat.instructions;
    }

    // Category Section
    const categorySection = el('div', 'mc-section');
    const categoryLabel = el('legend', 'mc-section-label');
    categoryLabel.textContent = 'Report Category';
    
    const categoryGroup = el('fieldset', 'mc-type-group');
    categoryGroup.appendChild(categoryLabel);

    Object.keys(CATEGORIES).forEach(key => {
      const cat = CATEGORIES[key];
      const lbl = el('label', 'mc-type-opt', { for: `mc-type-${key}` });
      const radio = el('input', '', {
        type: 'radio', id: `mc-type-${key}`, name: 'issue-type', value: key
      });
      if (key === selCategory) radio.checked = true;

      const txt = el('span', 'mc-type-txt');
      txt.textContent = cat.name;

      lbl.append(radio, txt);

      radio.addEventListener('change', () => {
        if (radio.checked) {
          selCategory = key;
          updateForm(key);
        }
      });

      categoryGroup.appendChild(lbl);
    });

    instrNote = el('div', 'mc-note', { role: 'note' });
    categorySection.append(categoryGroup, instrNote);

    // Attachments Section
    const attachSection = el('div', 'mc-section');
    const attachLabel = el('div', 'mc-section-label');
    attachLabel.textContent = 'Attachments & Environment';

    function mkCheck({ id, label, desc, badge, checked = false }) {
      const row = el('label', 'mc-check-row', { for: id });
      const hdr = el('div', 'mc-check-hdr');
      const cb = el('input', '', { type: 'checkbox', id, name: id });
      if (checked) cb.checked = true;

      const span = el('span');
      span.textContent = label;

      hdr.append(cb, span);

      if (badge) {
        const b = el('span', 'mc-check-badge');
        b.textContent = badge;
        hdr.appendChild(b);
      }

      const d = el('div', 'mc-check-desc');
      d.textContent = desc;

      row.append(hdr, d);
      return { row, cb };
    }

    const logCount = _consoleLogs.length;
    const capBadge = logCount > 0 ? `${logCount} logged` : 'Optional';

    const techRow = mkCheck({
      id: 'mc-tech', label: 'Technical environment details',
      desc: 'Browser, OS, and screen resolution context.',
      badge: 'Recommended', checked: true
    });
    techCb = techRow.cb;

    const extRow = mkCheck({
      id: 'mc-ext', label: 'Installed extensions list',
      desc: 'Lists active browser extensions to debug conflicts.',
      badge: 'Optional', checked: false
    });
    extCb = extRow.cb;

    const logRow = mkCheck({
      id: 'mc-logs', label: 'Recent console logs & errors',
      desc: `Attaches up to ${MAX_LOGS} captured runtime logs.`,
      badge: capBadge, checked: false
    });
    logCb = logRow.cb;

    attachSection.append(attachLabel, techRow.row, extRow.row, logRow.row);

    const priv = el('div', 'mc-privacy', { role: 'note' });
    priv.textContent = 'Privacy: Continuing redirects you to GitHub. Your selected details will be pre-filled so you can comfortably review before submitting.';

    // Footer
    const footer = el('div', 'mc-sidebar-footer');
    const cancelBtn = el('button', 'btn-sec', { type: 'button' });
    cancelBtn.textContent = 'Cancel';
    submitBtn = el('button', 'btn-ok', { type: 'button' });
    submitBtn.textContent = 'Continue on GitHub';

    footer.append(cancelBtn, submitBtn);

    content.append(categorySection, attachSection, priv);
    sidebar.append(header, content, footer);
    overlay.append(sidebar);

    // Event Handlers
    overlay.addEventListener('click', e => { if (e.target === overlay) closeSidebar(); });
    closeBtn.addEventListener('click', closeSidebar);
    cancelBtn.addEventListener('click', closeSidebar);
    submitBtn.addEventListener('click', submit);

    updateForm(selCategory);

    async function submit() {
      clearError();

      submitBtn.disabled = true;
      submitBtn.textContent = 'Opening GitHub...';

      const cat = CATEGORIES[selCategory] || CATEGORIES.GENERAL;
      const isDiscuss = cat.discuss === true;
      const target = isDiscuss ? DISCUSS_URL : ISSUE_URL;

      const sections = [];
      if (techCb.checked) sections.push(getTechInfo());
      if (extCb.checked) sections.push(await getExtensions());
      if (logCb.checked) sections.push(getConsoleLogs());

      let body = '<!-- Please describe your issue or feedback above -->\n\n';
      if (sections.length > 0) {
        body += `\n<details><summary><strong>Attached Diagnostic Data</strong></summary>\n\n${sections.join('\n\n---\n\n')}\n\n*Technical details voluntarily attached by user.*</details>`;
      }

      const params = new URLSearchParams();
      params.append('title', `${cat.prefix} `);
      params.append('body', body);
      if (!isDiscuss && cat.label) params.append('labels', cat.label);
      if (isDiscuss) params.append('category', 'general');

      const url = `${target}?${params.toString()}`;

      try {
        // Safe check for background page tab API vs Content Script context
        if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
          await chrome.tabs.create({ url });
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      } catch {
        window.open(url, '_blank', 'noopener,noreferrer');
      }

      closeSidebar();
    }

    // Comprehensive Focus Trap
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeSidebar();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
      const focusable = Array.from(overlay.querySelectorAll(focusableSelector));
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
    });

    return overlay;
  }

  // --- Lifecycle Controls ---

  function openSidebar() {
    if (_sidebar || _isClosing || typeof document === 'undefined' || !document.body) return;
    ensureConsoleCapture();
    _prevFocus = document.activeElement;
    _sidebar = buildSidebar();
    document.body.appendChild(_sidebar);

    requestAnimationFrame(() => _sidebar?.classList.add('open'));
    _sidebar.querySelector('input[type="radio"]:checked')?.focus();
  }

  function closeSidebar() {
    if (!_sidebar || _isClosing) return;
    _isClosing = true;
    _sidebar.classList.remove('open');
    const dying = _sidebar;
    _sidebar = null;

    dying.querySelectorAll('.mc-error').forEach(e => {
      if (e._tId) clearTimeout(e._tId);
    });

    setTimeout(() => {
      dying.remove();
      _isClosing = false;
      _prevFocus?.focus();
      _prevFocus = null;
    }, 280);
  }

  // Keyboard shortcut: Alt + Shift + E (Option + Shift + E)
  function onKeydown(e) {
    if (e.defaultPrevented) return;
    const ae = document.activeElement;
    const typing = ae && (
      (ae.tagName === 'INPUT' && ae.type !== 'checkbox' && ae.type !== 'radio') ||
      ae.tagName === 'TEXTAREA' ||
      ae.isContentEditable ||
      ae.tagName === 'SELECT'
    );

    if (e.altKey && e.shiftKey && (e.key === 'e' || e.key === 'E') && !typing) {
      e.preventDefault();
      openSidebar();
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeydown);
  }

  return {
    open: openSidebar,
    close: closeSidebar,
    openSidebar,
    closeSidebar,
    ensureConsoleCapture
  };
});