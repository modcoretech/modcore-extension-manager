// report.js

'use strict';

let _sidebar = null;
let _prevFocus = null;
let _consoleLogs = [];
let _consoleCaptureInstalled = false;
let _keyHandlerBound = false;
let _listeners = [];

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

function safeStringify(arg) {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'string') return arg.slice(0, MAX_LOG_ENTRY_LENGTH);
  if (['number', 'boolean', 'bigint', 'symbol'].includes(typeof arg)) return String(arg);
  if (typeof arg === 'function') return '[Function]';
  if (arg instanceof Error) return (arg.stack || arg.message || String(arg)).slice(0, MAX_LOG_ENTRY_LENGTH);
  if (arg instanceof Date) return arg.toISOString();
  if (arg instanceof RegExp) return arg.toString();
  if (typeof arg === 'object') {
    try {
      const seen = new WeakSet();
      const str = JSON.stringify(arg, (k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        if (typeof v === 'string' && v.length > 200) return `${v.slice(0, 200)}...`;
        return v;
      });
      return str.slice(0, MAX_LOG_ENTRY_LENGTH);
    } catch {
      return '[Object]';
    }
  }
  return String(arg);
}

let _capturing = false;
function captureEntry(type, args, meta = {}) {
  if (_capturing) return;
  _capturing = true;
  try {
    if (_consoleLogs.length >= MAX_LOGS) _consoleLogs.shift();
    const msg = Array.from(args).map(safeStringify).join(' ');
    _consoleLogs.push({
      type,
      msg: msg.slice(0, MAX_LOG_ENTRY_LENGTH),
      ts: new Date().toISOString().slice(11, 23),
      ...meta
    });
  } catch {
  } finally {
    _capturing = false;
  }
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
    const msg = e.reason instanceof Error ? (e.reason.stack || e.reason.message) : safeStringify(e.reason);
    captureEntry('unhandledrejection', [msg]);
  });
}

function el(tag, cls, attrs = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) e.setAttribute(k, v);
  }
  return e;
}

function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  _listeners.push({ target, type, handler, opts });
}

function offAll() {
  for (const { target, type, handler, opts } of _listeners) {
    target.removeEventListener(type, handler, opts);
  }
  _listeners.length = 0;
}

function escMD(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\n\r]+/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim();
}

function getVersion() {
  try {
    return chrome.runtime?.getManifest?.()?.version ?? 'N/A';
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

  const screenRes = `${screen.width}x${screen.height}`;

  return [
    '### Technical Environment',
    '| Detail | Value |',
    '| :--- | :--- |',
    `| **Extension Version** | \`${getVersion()}\` |`,
    `| **Browser** | \`${browserName} ${browserVer} (${engine})\` |`,
    `| **Operating System** | \`${os}\` |`,
    `| **Screen Resolution** | \`${screenRes}\` |`
  ].join('\n');
}

async function getExtensions() {
  if (!chrome?.management?.getAll) {
    return '_chrome.management API not available._';
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
    let line = `[${e.ts}] [${e.type.toUpperCase()}] ${e.msg}`;
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

function buildSidebar() {
  const style = el('style');
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
      background: var(--color-backdrop);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex;
      justify-content: flex-end;
      z-index: 2147483647;
      opacity: 0;
      transition: opacity 0.25s var(--ease-standard);
    }
    .mc-sidebar-overlay.open { opacity: 1; }

    .mc-sidebar-overlay * {
      box-sizing: border-box;
      font-family: var(--font-sans);
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .mc-sidebar {
      background: var(--color-bg);
      color: var(--color-text-primary);
      width: 400px;
      max-width: 90vw;
      height: 100%;
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.35s var(--ease-standard);
      border-left: 1.5px solid var(--color-border);
    }
    .mc-sidebar-overlay.open .mc-sidebar {
      transform: translateX(0);
    }

    .mc-sidebar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 22px;
      border-bottom: 2px solid var(--color-primary);
      flex-shrink: 0;
    }
    .mc-sidebar-title {
      font-size: var(--text-headline-sm);
      font-weight: var(--weight-bold);
      color: var(--color-primary);
      margin: 0;
    }
    .mc-sidebar-close {
      background: transparent;
      border: none;
      padding: 6px;
      border-radius: var(--radius-md);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-muted);
    }
    .mc-sidebar-close:hover {
      background: var(--color-surface-hover);
    }

    .mc-sidebar-content {
      flex: 1;
      overflow-y: auto;
      padding: 20px 22px;
      scrollbar-width: thin;
      scrollbar-color: var(--color-border) transparent;
    }
    .mc-sidebar-content::-webkit-scrollbar { width: 5px; }
    .mc-sidebar-content::-webkit-scrollbar-thumb {
      background: var(--color-border);
      border-radius: var(--radius-full);
    }

    .mc-section {
      margin-bottom: 20px;
      padding-bottom: 20px;
      border-bottom: 1.5px solid var(--color-border);
    }
    .mc-section:last-child {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }
    .mc-section-label {
      display: block;
      font-size: var(--text-body-md);
      font-weight: var(--weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: 12px;
    }

    .mc-type-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .mc-type-opt {
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
    .mc-type-opt:hover {
      background: var(--color-surface-hover);
      transform: translateY(-1px);
    }
    .mc-type-opt:active { transform: translateY(0); }
    .mc-type-opt.sel {
      border-color: var(--color-primary);
      background: var(--color-primary-container);
    }
    .mc-type-radio {
      position: absolute;
      left: 16px; top: 50%;
      transform: translateY(-50%);
      margin: 0;
      width: 16px; height: 16px;
      opacity: 0;
    }
    .mc-type-opt::before {
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
    .mc-type-opt.sel::before {
      background: var(--color-primary);
      border-color: var(--color-primary);
    }
    .mc-type-opt.sel::after {
      content: "";
      position: absolute;
      left: 21px; top: 50%;
      transform: translateY(-50%) rotate(45deg);
      width: 4px; height: 7px;
      border-right: 2px solid var(--color-primary-on);
      border-bottom: 2px solid var(--color-primary-on);
      margin-top: -1px;
    }
    .mc-type-txt { font-weight: var(--weight-medium); font-size: var(--text-body-md); }

    .mc-note {
      background: var(--color-info-container);
      color: var(--color-info);
      padding: 10px 14px;
      border-radius: var(--radius-2xl);
      font-size: var(--text-body-sm);
      margin-top: 12px;
      border: 1px solid rgba(var(--color-info-rgb), 0.15);
    }

    .mc-check-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px 14px;
      border: 1.5px solid var(--color-border);
      border-radius: var(--radius-2xl);
      background: var(--color-surface);
      transition: all 0.15s;
      cursor: pointer;
      margin-bottom: 8px;
    }
    .mc-check-row:last-child { margin-bottom: 0; }
    .mc-check-row:hover { background: var(--color-surface-hover); }
    .mc-check-row:has(input:checked) {
      border-color: var(--color-primary);
      background: var(--color-primary-container);
    }
    .mc-check-hdr {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .mc-check-hdr input[type="checkbox"] {
      width: 17px; height: 17px;
      flex-shrink: 0;
      accent-color: var(--color-primary);
      cursor: pointer;
    }
    .mc-check-hdr span {
      font-weight: var(--weight-semibold);
      font-size: var(--text-body-md);
      cursor: pointer;
      flex: 1;
    }
    .mc-check-badge {
      font-size: var(--text-label-sm);
      font-weight: var(--weight-semibold);
      padding: 2px 8px;
      border-radius: var(--radius-full);
      background: var(--color-primary-container);
      color: var(--color-primary);
    }
    .mc-check-desc {
      font-size: var(--text-label-lg);
      color: var(--color-text-muted);
      padding-left: 27px;
      line-height: 1.4;
    }

    .mc-privacy {
      padding: 10px 14px;
      font-size: var(--text-label-lg);
      background: var(--color-warning-container);
      color: var(--color-text-primary);
      border: 1px solid rgba(var(--color-warning-rgb), 0.25);
      border-radius: var(--radius-2xl);
      margin-top: 16px;
    }

    .mc-error {
      background: var(--color-danger-container);
      color: var(--color-danger);
      padding: 10px 14px;
      border-radius: var(--radius-2xl);
      font-size: var(--text-body-sm);
      border: 1.5px solid rgba(var(--color-danger-rgb), 0.35);
      animation: shake 0.4s var(--ease-standard);
      margin-bottom: 16px;
    }
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(6px); }
      60% { transform: translateX(-4px); }
      80% { transform: translateX(4px); }
    }

    .mc-sidebar-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 22px;
      border-top: 1.5px solid var(--color-border);
      flex-shrink: 0;
    }

    .mc-sidebar-footer button {
      padding: 9px 16px;
      border: none;
      border-radius: var(--radius-2xl);
      cursor: pointer;
      font-weight: var(--weight-semibold);
      font-size: var(--text-body-md);
      transition: all 0.18s var(--ease-standard);
      position: relative;
      overflow: hidden;
    }
    .mc-sidebar-footer button::after {
      content: "";
      position: absolute;
      inset: 0;
      background: rgba(255,255,255,0.15);
      opacity: 0;
      border-radius: inherit;
      transition: opacity 0.25s;
    }
    .mc-sidebar-footer button:hover::after { opacity: 1; }
    .mc-sidebar-footer button:active { transform: scale(0.96); }
    .mc-sidebar-footer button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      transform: none;
    }

    .btn-sec {
      background: var(--color-surface);
      color: var(--color-info);
      border: 1.5px solid var(--color-border);
    }
    .btn-sec:hover:not(:disabled) { background: var(--color-surface-hover); }

    .btn-ok {
      background: var(--color-success);
      color: var(--color-primary-on);
    }
    .btn-ok:hover:not(:disabled) { background: var(--color-success-hover); }

    .btn-loading { pointer-events: none; }
  `;

  const overlay = el('div', 'mc-sidebar-overlay mc-dialog', {
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mc-sidebar-title'
  });

  const sidebar = el('div', 'mc-sidebar');

  const header = el('div', 'mc-sidebar-header');
  const title = el('h2', 'mc-sidebar-title', { id: 'mc-sidebar-title' });
  title.textContent = 'Issue Reporter';
  const closeBtn = el('button', 'mc-sidebar-close', { type: 'button', 'aria-label': 'Close' });
  const closeIcon = el('span', 'icon icon-close icon-20');
  closeBtn.appendChild(closeIcon);
  header.append(title, closeBtn);

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

  const categorySection = el('div', 'mc-section');
  const categoryLabel = el('label', 'mc-section-label', { id: 'mc-type-lbl' });
  categoryLabel.textContent = 'Report Category';
  
  const categoryGroup = el('div', 'mc-type-group', { role: 'radiogroup', 'aria-labelledby': 'mc-type-lbl' });

  Object.keys(CATEGORIES).forEach(key => {
    const cat = CATEGORIES[key];
    const lbl = el('label', 'mc-type-opt', { for: `mc-type-${key}`, tabindex: '0' });
    const radio = el('input', 'mc-type-radio', {
      type: 'radio', id: `mc-type-${key}`, name: 'issue-type', value: key
    });
    const txt = el('span', 'mc-type-txt');
    txt.textContent = cat.name;

    lbl.append(radio, txt);

    const activate = () => {
      categoryGroup.querySelectorAll('.mc-type-opt').forEach(o => o.classList.remove('sel'));
      lbl.classList.add('sel');
      radio.checked = true;
      selCategory = key;
      updateForm(key);
    };

    on(lbl, 'click', activate);
    on(lbl, 'keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });

    categoryGroup.appendChild(lbl);
  });

  const firstOpt = categoryGroup.querySelector('.mc-type-opt');
  if (firstOpt) { 
    firstOpt.classList.add('sel'); 
    firstOpt.querySelector('input').checked = true; 
  }

  instrNote = el('div', 'mc-note', { role: 'note' });
  categorySection.append(categoryLabel, categoryGroup, instrNote);

  const attachSection = el('div', 'mc-section');
  const attachLabel = el('label', 'mc-section-label');
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
  const capBadge = logCount > 0 ? `${logCount} captured` : 'Optional';

  const techRow = mkCheck({
    id: 'mc-tech', label: 'Include technical environment details',
    desc: 'Browser, OS, and screen resolution context.',
    badge: 'Recommended', checked: true
  });
  techCb = techRow.cb;

  const extRow = mkCheck({
    id: 'mc-ext', label: 'Include installed extensions list',
    desc: 'Lists active browser extensions to debug issues.',
    badge: 'Optional', checked: false
  });
  extCb = extRow.cb;

  const logRow = mkCheck({
    id: 'mc-logs', label: 'Include recent console logs and errors',
    desc: `Attaches up to ${MAX_LOGS} captured runtime logs (${logCount} captured).`,
    badge: capBadge, checked: false
  });
  logCb = logRow.cb;

  attachSection.append(attachLabel, techRow.row, extRow.row, logRow.row);

  const priv = el('div', 'mc-privacy', { role: 'note' });
  priv.textContent = `Privacy: Continuing will redirect you to GitHub. Your selected details will be pre-filled so you can comfortably write your issue.`;

  const footer = el('div', 'mc-sidebar-footer');
  const cancelBtn = el('button', 'btn-sec', { type: 'button' });
  cancelBtn.textContent = 'Cancel';
  submitBtn = el('button', 'btn-ok', { type: 'button' });
  submitBtn.textContent = 'Continue on GitHub';

  footer.append(cancelBtn, submitBtn);

  content.append(categorySection, attachSection, priv);
  sidebar.append(header, content, footer);
  overlay.append(style, sidebar);

  on(overlay, 'click', e => { if (e.target === overlay) closeSidebar(); });
  on(closeBtn, 'click', closeSidebar);
  on(cancelBtn, 'click', closeSidebar);
  on(submitBtn, 'click', submit);

  updateForm(selCategory);

  async function submit() {
    clearError();

    submitBtn.disabled = true;
    submitBtn.classList.add('btn-loading');
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
      body += `\n<details><summary><strong>Attached Diagnostic Data</strong></summary>\n\n${sections.join('\n\n---\n\n')}\n\n*Technical details voluntarily attached by the user.*</details>`;
    }

    const params = new URLSearchParams();
    params.append('title', `${cat.prefix} `);
    params.append('body', body);
    if (!isDiscuss && cat.label) params.append('labels', cat.label);
    if (isDiscuss) params.append('category', 'general');

    const url = `${target}?${params.toString()}`;

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        await chrome.tabs.create({ url });
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      showError('Failed to open GitHub. Please try again.');
      submitBtn.disabled = false;
      submitBtn.classList.remove('btn-loading');
      submitBtn.textContent = 'Continue on GitHub';
      return;
    }

    closeSidebar();
  }

  on(overlay, 'keydown', e => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(
      overlay.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
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

function openSidebar() {
  if (_sidebar || !document.body) return;
  ensureConsoleCapture();
  _prevFocus = document.activeElement;
  _sidebar = buildSidebar();
  document.body.appendChild(_sidebar);

  requestAnimationFrame(() => _sidebar?.classList.add('open'));
  _sidebar.querySelector('.mc-type-opt')?.focus();
}

function closeSidebar() {
  if (!_sidebar) return;
  _sidebar.classList.remove('open');
  const dying = _sidebar;
  _sidebar = null;

  dying.querySelectorAll('.mc-error').forEach(e => {
    if (e._tId) clearTimeout(e._tId);
  });

  offAll();

  setTimeout(() => {
    dying.remove();
    _prevFocus?.focus();
    _prevFocus = null;
  }, 300);
}

function onKeydown(e) {
  const mod = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
  const ae = document.activeElement;
  const typing = ae && (
    (ae.tagName === 'INPUT' && ae.type !== 'checkbox' && ae.type !== 'radio') ||
    ae.tagName === 'TEXTAREA' ||
    ae.isContentEditable ||
    ae.tagName === 'SELECT'
  );

  if (e.key === 'e' && !mod && !typing) {
    e.preventDefault();
    e.stopPropagation();
    openSidebar();
    return;
  }

  if (e.key === 'Escape' && _sidebar) {
    e.preventDefault();
    e.stopPropagation();
    closeSidebar();
  }
}

if (!_keyHandlerBound) {
  document.addEventListener('keydown', onKeydown);
  _keyHandlerBound = true;
}