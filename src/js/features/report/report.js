// report.js

'use strict';

let _sidebar = null;
let _prevFocus = null;
let _consoleLogs = [];
let _consoleCaptureInstalled = false;
let _keyHandlerBound = null;
let _listeners = [];

const MAX_LOGS = 50;
const MAX_LOG_ENTRY_LENGTH = 500;
const MAX_BODY = 6500;

const REPO_OWNER = 'modcoretech';
const REPO_NAME = 'modcore-extension-manager';
const ISSUE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new`;
const DISCUSS_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/discussions/new`;

const TEMPLATES = {
  BUG: {
    name: 'Bug Report',
    prefix: '[BUG]',
    label: 'bug',
    sumPlaceholder: 'e.g., The settings button disappears on page reload.',
    descPlaceholder: '1. Clear, repeatable steps?\n2. Expected result?\n3. Actual result?',
    instructions: 'Provide clear steps to reproduce so we can fix it quickly.'
  },
  FEATURE: {
    name: 'Feature Suggestion',
    prefix: '[FEATURE]',
    label: 'enhancement',
    sumPlaceholder: 'e.g., Add a dark mode toggle button.',
    descPlaceholder: 'Describe the feature, why it is needed, and how it improves the extension.',
    instructions: 'Explain the value and intended usage of your suggestion.'
  },
  GENERAL: {
    name: 'General Feedback',
    prefix: '[FEEDBACK]',
    label: 'feedback',
    sumPlaceholder: 'e.g., Question about installation process.',
    descPlaceholder: 'Provide your detailed question or general feedback, including context.',
    instructions: 'Provide full context for your question or feedback.',
    discuss: true
  }
};

function safeStringify(arg) {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'string') return arg.slice(0, MAX_LOG_ENTRY_LENGTH);
  if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint' || typeof arg === 'symbol') return String(arg);
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
        if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '...';
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
    const msg = Array.from(args).map(a => safeStringify(a)).join(' ');
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
  const originals = {};

  methods.forEach(method => {
    if (typeof console[method] !== 'function') return;
    originals[method] = console[method].bind(console);
    console[method] = (...args) => {
      captureEntry(method, args);
      originals[method](...args);
    };
  });

  window.addEventListener('error', e => {
    let msg = e.message;
    if (e.error instanceof Error) {
      msg = e.error.stack || e.error.message || e.message;
    }
    captureEntry('error', [msg], { source: e.filename, line: e.lineno, col: e.colno });
  });

  window.addEventListener('unhandledrejection', e => {
    let msg;
    if (e.reason instanceof Error) {
      msg = e.reason.stack || e.reason.message;
    } else {
      msg = safeStringify(e.reason);
    }
    captureEntry('unhandledrejection', [msg]);
  });
}

function el(tag, cls, attrs) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null) e.setAttribute(k, v);
    }
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
    const exts = await new Promise((resolve, reject) => {
      chrome.management.getAll(result => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(result);
      });
    });

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

    .mc-dialog input:not([type="checkbox"]):not(.mc-type-radio),
    .mc-dialog textarea {
      width: 100%;
      padding: 10px 14px;
      border-radius: var(--radius-2xl);
      margin-top: 2px;
      margin-bottom: 4px;
      font-size: var(--text-body-md);
      border: 1.5px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text-primary);
      transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
    }
    .mc-dialog input:focus,
    .mc-dialog textarea:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3.5px var(--color-focus-ring);
      transform: translateY(-1px);
    }
    .mc-dialog textarea { min-height: 100px; resize: vertical; }
    .mc-dialog input[aria-invalid="true"],
    .mc-dialog textarea[aria-invalid="true"] {
      border-color: var(--color-danger) !important;
      background: var(--color-danger-container);
    }

    .mc-counter {
      text-align: right;
      font-size: var(--text-label-sm);
      color: var(--color-text-muted);
      margin-bottom: 12px;
    }

    .mc-note {
      background: var(--color-info-container);
      color: var(--color-info);
      padding: 10px 14px;
      border-radius: var(--radius-2xl);
      font-size: var(--text-body-sm);
      margin-top: 8px;
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
  header.appendChild(title);
  header.appendChild(closeBtn);

  const content = el('div', 'mc-sidebar-content');

  let selType = 'BUG';
  let summaryInp, descInp, instrNote, sumCounter, descCounter;
  let techCb, extCb, logCb;
  let submitBtn, errorBox;

  function clearError() {
    if (errorBox) { errorBox.remove(); errorBox = null; }
  }

  function showError(msg) {
    clearError();
    errorBox = el('div', 'mc-error', { role: 'alert' });
    errorBox.textContent = msg;
    content.insertBefore(errorBox, content.firstChild);
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const tId = setTimeout(() => clearError(), 4500);
    errorBox._tId = tId;
  }

  function updateForm(type) {
    const tpl = TEMPLATES[type] || TEMPLATES.BUG;
    summaryInp.placeholder = tpl.sumPlaceholder;
    descInp.placeholder = tpl.descPlaceholder;
    instrNote.textContent = tpl.instructions;
  }

  const typeSection = el('div', 'mc-section');
  const typeLabel = el('label', 'mc-section-label');
  typeLabel.textContent = 'Report Type';
  typeLabel.id = 'mc-type-lbl';
  const typeGroup = el('div', 'mc-type-group', { role: 'radiogroup', 'aria-labelledby': 'mc-type-lbl' });

  Object.keys(TEMPLATES).forEach(key => {
    const tpl = TEMPLATES[key];
    const lbl = el('label', 'mc-type-opt', { for: `mc-type-${key}`, tabindex: '0' });
    const radio = el('input', 'mc-type-radio', {
      type: 'radio', id: `mc-type-${key}`, name: 'issue-type', value: key
    });
    const txt = el('span', 'mc-type-txt');
    txt.textContent = tpl.name;

    lbl.appendChild(radio);
    lbl.appendChild(txt);

    const activate = () => {
      typeGroup.querySelectorAll('.mc-type-opt').forEach(o => o.classList.remove('sel'));
      lbl.classList.add('sel');
      radio.checked = true;
      selType = key;
      updateForm(key);
    };

    on(lbl, 'click', activate);
    on(lbl, 'keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });

    typeGroup.appendChild(lbl);
  });

  const firstOpt = typeGroup.querySelector('.mc-type-opt');
  if (firstOpt) { firstOpt.classList.add('sel'); firstOpt.querySelector('input').checked = true; }

  typeSection.appendChild(typeLabel);
  typeSection.appendChild(typeGroup);

  const detailsSection = el('div', 'mc-section');

  const sumLbl = el('label', 'mc-section-label', { for: 'mc-summary' });
  sumLbl.textContent = 'Summary';
  summaryInp = el('input', '', {
    type: 'text', id: 'mc-summary', name: 'issue-summary',
    required: 'true', 'aria-required': 'true',
    'aria-label': 'Summary', maxlength: '120', autocomplete: 'off'
  });
  sumCounter = el('div', 'mc-counter');
  sumCounter.textContent = '0 / 120';

  const descLbl = el('label', 'mc-section-label', { for: 'mc-desc' });
  descLbl.textContent = 'Description';
  descInp = el('textarea', '', {
    id: 'mc-desc', name: 'issue-description',
    required: 'true', 'aria-required': 'true',
    'aria-label': 'Description', maxlength: '2000'
  });
  descCounter = el('div', 'mc-counter');
  descCounter.textContent = '0 / 2000';

  instrNote = el('div', 'mc-note', { role: 'note' });

  on(summaryInp, 'input', () => {
    summaryInp.setAttribute('aria-invalid', 'false');
    sumCounter.textContent = `${summaryInp.value.length} / 120`;
    clearError();
  });
  on(descInp, 'input', () => {
    descInp.setAttribute('aria-invalid', 'false');
    descCounter.textContent = `${descInp.value.length} / 2000`;
    clearError();
  });

  detailsSection.appendChild(sumLbl);
  detailsSection.appendChild(summaryInp);
  detailsSection.appendChild(sumCounter);
  detailsSection.appendChild(descLbl);
  detailsSection.appendChild(descInp);
  detailsSection.appendChild(descCounter);
  detailsSection.appendChild(instrNote);

  const attachSection = el('div', 'mc-section');

  const attachLabel = el('label', 'mc-section-label');
  attachLabel.textContent = 'Attachments';

  function mkCheck({ id, label, desc, badge, checked = false }) {
    const row = el('label', 'mc-check-row');
    row.setAttribute('for', id);

    const hdr = el('div', 'mc-check-hdr');
    const cb = el('input', '', { type: 'checkbox', id, name: id });
    if (checked) cb.checked = true;

    const span = el('span');
    span.textContent = label;

    hdr.appendChild(cb);
    hdr.appendChild(span);

    if (badge) {
      const b = el('span', 'mc-check-badge');
      b.textContent = badge;
      hdr.appendChild(b);
    }

    const d = el('div', 'mc-check-desc');
    d.textContent = desc;

    row.appendChild(hdr);
    row.appendChild(d);
    return { row, cb };
  }

  const logCount = _consoleLogs.length;
  const capBadge = logCount > 0 ? `${logCount} captured` : 'Optional';

  const techRow = mkCheck({
    id: 'mc-tech', label: 'Include technical environment details',
    desc: 'Browser, OS, and screen resolution. Recommended for bug reports.',
    badge: 'Recommended', checked: true
  });
  techCb = techRow.cb;

  const extRow = mkCheck({
    id: 'mc-ext', label: 'Include installed extensions list',
    desc: 'Lists your other installed extensions. Useful for compatibility issues.',
    badge: 'Optional', checked: false
  });
  extCb = extRow.cb;

  const logRow = mkCheck({
    id: 'mc-logs', label: 'Include recent console logs and errors',
    desc: `Attaches up to ${MAX_LOGS} captured console messages. ${logCount} entries captured so far.`,
    badge: capBadge, checked: false
  });
  logCb = logRow.cb;

  attachSection.appendChild(attachLabel);
  attachSection.appendChild(techRow.row);
  attachSection.appendChild(extRow.row);
  attachSection.appendChild(logRow.row);

  const priv = el('div', 'mc-privacy', { role: 'note' });
  priv.textContent = `Privacy: Your report will open on the ${REPO_NAME} public GitHub page. Ensure your summary and description contain no personal or sensitive information.`;

  const footer = el('div', 'mc-sidebar-footer');
  const cancelBtn = el('button', 'btn-sec', { type: 'button' });
  cancelBtn.textContent = 'Cancel';
  submitBtn = el('button', 'btn-ok', { type: 'button' });
  submitBtn.textContent = 'Send to GitHub';

  footer.appendChild(cancelBtn);
  footer.appendChild(submitBtn);

  content.appendChild(typeSection);
  content.appendChild(detailsSection);
  content.appendChild(attachSection);
  content.appendChild(priv);

  sidebar.appendChild(header);
  sidebar.appendChild(content);
  sidebar.appendChild(footer);

  overlay.appendChild(style);
  overlay.appendChild(sidebar);

  on(overlay, 'click', e => { if (e.target === overlay) closeSidebar(); });
  on(closeBtn, 'click', closeSidebar);
  on(cancelBtn, 'click', closeSidebar);
  on(submitBtn, 'click', submit);

  updateForm(selType);

  async function submit() {
    const emptySum = !summaryInp.value.trim();
    const emptyDesc = !descInp.value.trim();
    summaryInp.setAttribute('aria-invalid', String(emptySum));
    descInp.setAttribute('aria-invalid', String(emptyDesc));

    if (emptySum || emptyDesc) {
      showError('Please fill in all required fields before continuing.');
      (emptySum ? summaryInp : descInp).focus();
      return;
    }
    clearError();

    submitBtn.disabled = true;
    submitBtn.classList.add('btn-loading');
    submitBtn.textContent = 'Opening GitHub...';

    const tpl = TEMPLATES[selType] || TEMPLATES.GENERAL;
    const title = `${tpl.prefix} ${summaryInp.value.trim()}`;
    const desc = descInp.value.trim();
    const isDiscuss = tpl.discuss === true;
    const target = isDiscuss ? DISCUSS_URL : ISSUE_URL;

    const parts = [`## Detailed Report\n\n${desc}`];
    if (techCb.checked) parts.push(`\n---\n${getTechInfo()}`);
    if (extCb.checked) parts.push(`\n---\n${await getExtensions()}`);
    if (logCb.checked) parts.push(`\n---\n${getConsoleLogs()}`);
    parts.push(`\n---\n*Technical details included voluntarily by the user to aid debugging.*`);

    let body = parts.join('\n');
    if (body.length > MAX_BODY) {
      body = body.slice(0, MAX_BODY) + '\n\n_(report truncated to stay within URL limits)_';
    }

    const params = new URLSearchParams();
    params.append('title', title);
    params.append('body', body);
    if (!isDiscuss && tpl.label) params.append('labels', tpl.label);
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
      submitBtn.textContent = 'Send to GitHub';
      return;
    }

    closeSidebar();
  }

  on(overlay, 'keydown', e => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(
      overlay.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  requestAnimationFrame(() => _sidebar.classList.add('open'));
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