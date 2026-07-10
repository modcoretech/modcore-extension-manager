// report.js

'use strict';

/* --------------------------------------------------------------------------
   Module state
   -------------------------------------------------------------------------- */
let _dialog = null;
let _prevFocus = null;
let _consoleLogs = [];
let _consoleCaptureInstalled = false;
let _keyHandlerBound = null;
let _listeners = [];

const MAX_LOGS = 50;
const MAX_BODY = 6500;
const STEPS = 3;

const REPO_OWNER = 'modcoretech';
const REPO_NAME = 'modcore-extension-manager';
const ISSUE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new`;
const DISCUSS_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/discussions/new`;

const TEMPLATES = {
  BUG: {
    nameKey: 'report_type_bug_name',
    prefix: '[BUG]',
    label: 'bug',
    sumPhKey: 'report_bug_summary_placeholder',
    descPhKey: 'report_bug_description_placeholder',
    instrKey: 'report_bug_instructions'
  },
  FEATURE: {
    nameKey: 'report_type_feature_name',
    prefix: '[FEATURE]',
    label: 'enhancement',
    sumPhKey: 'report_feature_summary_placeholder',
    descPhKey: 'report_feature_description_placeholder',
    instrKey: 'report_feature_instructions'
  },
  GENERAL: {
    nameKey: 'report_type_general_name',
    prefix: '[FEEDBACK]',
    label: 'feedback',
    sumPhKey: 'report_general_summary_placeholder',
    descPhKey: 'report_general_description_placeholder',
    instrKey: 'report_general_instructions',
    discuss: true
  }
};

/* --------------------------------------------------------------------------
   i18n
   -------------------------------------------------------------------------- */
function t(key, subs) {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
      return chrome.i18n.getMessage(key, subs) || key;
    }
  } catch { /* noop */ }
  return key;
}

/* --------------------------------------------------------------------------
   Console capture (lazy)
   -------------------------------------------------------------------------- */
function ensureConsoleCapture() {
  if (_consoleCaptureInstalled) return;
  _consoleCaptureInstalled = true;

  const orig = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console)
  };

  function fmt(arg) {
    if (arg instanceof Error) return arg.stack || String(arg);
    if (arg && typeof arg === 'object') {
      try { return JSON.stringify(arg); } catch { return String(arg); }
    }
    return String(arg);
  }

  function capture(type, args) {
    if (_consoleLogs.length >= MAX_LOGS) _consoleLogs.shift();
    try {
      _consoleLogs.push({
        type,
        msg: Array.from(args).map(fmt).join(' '),
        ts: new Date().toISOString().slice(11, 23)
      });
    } catch { /* swallow */ }
  }

  console.log = (...a) => { capture('log', a); orig.log(...a); };
  console.error = (...a) => { capture('error', a); orig.error(...a); };
  console.warn = (...a) => { capture('warn', a); orig.warn(...a); };
}

/* --------------------------------------------------------------------------
   DOM helpers
   -------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
   Markdown escape
   -------------------------------------------------------------------------- */
function escMD(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\n\r]+/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim();
}

/* --------------------------------------------------------------------------
   Extension version
   -------------------------------------------------------------------------- */
function getVersion() {
  try {
    return chrome.runtime?.getManifest?.()?.version ?? 'N/A';
  } catch {
    return 'N/A';
  }
}

/* --------------------------------------------------------------------------
   Technical info
   -------------------------------------------------------------------------- */
async function getTechInfo() {
  let browserName = 'Unknown', browserVer = 'N/A', engine = 'Unknown';
  let os = 'Unknown', osVer = 'N/A', arch = 'N/A';
  const ua = navigator.userAgent;

  // Try Client Hints API first
  if (navigator.userAgentData) {
    try {
      const h = await navigator.userAgentData.getHighEntropyValues([
        'platform', 'platformVersion', 'fullVersionList', 'architecture', 'bitness'
      ]);
      os = h.platform || 'Unknown';
      osVer = h.platformVersion || 'N/A';
      arch = h.architecture
        ? `${h.architecture}${h.bitness ? `-${h.bitness}bit` : ''}`
        : 'N/A';
      const primary = h.fullVersionList?.find(
        b => b.brand && !b.brand.includes('Not') && b.brand !== 'Chromium'
      ) ?? h.fullVersionList?.[0];
      if (primary) { browserName = primary.brand; browserVer = primary.version; }
    } catch { /* fallback */ }
  }

  // Fallback UA parsing
  if (browserName === 'Unknown') {
    const m =
      ua.match(/Edg\/([\d.]+)/) ||
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
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  }

  if (ua.includes('Firefox')) engine = 'Gecko';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) engine = 'WebKit';
  else if (ua.includes('Chrome') || ua.includes('CriOS')) engine = 'Blink';

  let pageLoad = 'N/A';
  try {
    const nav = performance?.getEntriesByType?.('navigation')?.[0];
    if (nav) pageLoad = `${Math.round(nav.loadEventEnd - nav.startTime)} ms`;
  } catch { /* ignore */ }

  const mem = navigator.deviceMemory != null ? `${navigator.deviceMemory} GB` : 'N/A';
  const cores = navigator.hardwareConcurrency ?? 'N/A';
  const dpr = window.devicePixelRatio ?? 1;
  const screenRes = `${screen.width}×${screen.height} (${screen.colorDepth}-bit) @ ${dpr}x DPR`;
  const vp = `${window.innerWidth}×${window.innerHeight}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'N/A';
  const url = window.location.href.slice(0, 120);

  return [
    '### Technical Environment',
    '| Detail | Value |',
    '| :--- | :--- |',
    `| **Extension Version** | \`${getVersion()}\` |`,
    `| **Browser** | \`${browserName} ${browserVer} (${engine})\` |`,
    `| **Operating System** | \`${os} ${osVer}\` |`,
    `| **Architecture** | \`${arch}\` |`,
    `| **Device Memory** | \`${mem}\` |`,
    `| **CPU Cores** | \`${cores}\` |`,
    `| **Screen Resolution** | \`${screenRes}\` |`,
    `| **Viewport** | \`${vp}\` |`,
    `| **Page Load Time** | \`${pageLoad}\` |`,
    `| **Timezone** | \`${tz}\` |`,
    `| **Language** | \`${navigator.language}\` |`,
    `| **Cookies Enabled** | \`${navigator.cookieEnabled ? 'Yes' : 'No'}\` |`,
    `| **Do Not Track** | \`${navigator.doNotTrack === '1' ? 'Yes' : (navigator.doNotTrack === '0' ? 'No' : 'N/A')}\` |`,
    `| **Current URL** | \`${url}\` |`
  ].join('\n');
}

/* --------------------------------------------------------------------------
   Installed extensions
   -------------------------------------------------------------------------- */
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
      const state = e.enabled ? '✅ Enabled' : '⛔ Disabled';
      const type = e.type ?? 'extension';
      return `| ${name} | ${ver} | ${state} | ${type} |`;
    });

    const note = list.length > MAX ? `\n_…and ${list.length - MAX} more (truncated)._` : '';
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

/* --------------------------------------------------------------------------
   Console logs
   -------------------------------------------------------------------------- */
function getConsoleLogs(max = MAX_LOGS) {
  if (!_consoleLogs.length) return '_No console activity captured._';
  const entries = _consoleLogs.slice(-max);
  const lines = entries.map(e => `[${e.ts}] [${e.type.toUpperCase()}] ${e.msg}`);
  return [
    `### Console Logs (last ${entries.length} entries)`,
    '```',
    ...lines,
    '```'
  ].join('\n');
}

/* --------------------------------------------------------------------------
   Dialog builder
   -------------------------------------------------------------------------- */
function buildDialog() {
  // ---- Styles ----
  const style = el('style');
  style.textContent = `
    @import url('${chrome.runtime?.getURL?.('../../src/shared/styles/main.css') ?? ''}');

    @media (prefers-reduced-motion: reduce) {
      .mc-dialog-overlay, .mc-dialog-overlay * {
        transition: none !important;
        animation: none !important;
      }
    }

    .mc-dialog-overlay {
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
    .mc-dialog-overlay.open { opacity: 1; }

    .mc-dialog-overlay * {
      box-sizing: border-box;
      font-family: var(--font-sans);
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .mc-dialog {
      background: var(--color-bg);
      color: var(--color-text-primary);
      padding: 22px;
      border-radius: var(--radius-2xl);
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
    .mc-dialog-overlay.open .mc-dialog {
      transform: scale(1) translateY(0);
      opacity: 1;
    }
    .mc-dialog::-webkit-scrollbar { width: 5px; }
    .mc-dialog::-webkit-scrollbar-thumb {
      background: var(--color-border);
      border-radius: var(--radius-full);
    }

    .mc-header {
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
    .mc-step-badge {
      font-size: var(--text-label-lg);
      font-weight: var(--weight-medium);
      color: var(--color-text-muted);
      background: var(--color-surface-mid);
      padding: 3px 10px;
      border-radius: var(--radius-full);
    }

    .mc-progress-track {
      height: 3px;
      background: var(--color-border);
      border-radius: var(--radius-full);
      margin-bottom: 18px;
      overflow: hidden;
    }
    .mc-progress-fill {
      height: 100%;
      background: var(--color-primary);
      border-radius: var(--radius-full);
      transition: width 0.4s var(--ease-standard);
      width: 33.33%;
    }

    .mc-dialog label:not(.mc-type-opt) {
      display: block;
      margin-bottom: 4px;
      font-size: var(--text-body-md);
      font-weight: var(--weight-semibold);
      color: var(--color-text-primary);
    }
    .mc-dialog input:not([type="checkbox"]):not(.mc-type-radio),
    .mc-dialog textarea,
    .mc-dialog select {
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
    .mc-dialog input:focus,
    .mc-dialog textarea:focus,
    .mc-dialog select:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3.5px var(--color-focus-ring);
      transform: translateY(-1px);
    }
    .mc-dialog textarea { min-height: 90px; resize: vertical; }
    .mc-dialog input[aria-invalid="true"],
    .mc-dialog textarea[aria-invalid="true"] {
      border-color: var(--color-danger) !important;
      background: var(--color-danger-container);
    }

    .mc-note {
      background: var(--color-info-container);
      color: var(--color-info);
      padding: 10px 14px;
      border-radius: var(--radius-2xl);
      font-size: var(--text-body-sm);
      margin-top: 4px;
      border: 1px solid rgba(var(--color-info-rgb), 0.15);
    }

    .mc-privacy {
      margin-top: 14px;
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
      margin-bottom: 10px;
    }
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(6px); }
      60% { transform: translateX(-4px); }
      80% { transform: translateX(4px); }
    }

    .mc-step {
      display: none;
      flex-direction: column;
      gap: 10px;
    }
    .mc-step.current {
      display: flex;
      animation: stepIn 0.3s var(--ease-standard) forwards;
    }
    .mc-step.out {
      animation: stepOut 0.2s ease forwards;
    }
    .mc-step.back {
      animation: stepBack 0.3s var(--ease-standard) forwards;
    }
    @keyframes stepIn {
      from { opacity: 0; transform: translateX(20px) scale(0.98); }
      to   { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes stepOut {
      from { opacity: 1; transform: translateX(0) scale(1); }
      to   { opacity: 0; transform: translateX(-16px) scale(0.98); }
    }
    @keyframes stepBack {
      from { opacity: 0; transform: translateX(-20px) scale(0.98); }
      to   { opacity: 1; transform: translateX(0) scale(1); }
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
      transform: translateY(-2px);
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
    }
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
      margin-bottom: 0;
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

    .mc-actions {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1.5px solid var(--color-border);
    }
    .mc-actions .mc-right { display: flex; gap: 8px; }

    .mc-dialog button {
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
    .mc-dialog button::after {
      content: "";
      position: absolute;
      inset: 0;
      background: rgba(255,255,255,0.15);
      opacity: 0;
      border-radius: inherit;
      transition: opacity 0.25s;
    }
    .mc-dialog button:hover::after { opacity: 1; }
    .mc-dialog button:active { transform: scale(0.96); }
    .mc-dialog button:disabled {
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

    .btn-pri {
      background: var(--color-primary);
      color: var(--color-primary-on);
    }
    .btn-pri:hover:not(:disabled) { background: var(--color-primary-hover); }

    .btn-ok {
      background: var(--color-success);
      color: var(--color-primary-on);
    }
    .btn-ok:hover:not(:disabled) { background: var(--color-success-hover); }

    .btn-loading { pointer-events: none; }
  `;

  // ---- Overlay ----
  const overlay = el('div', 'mc-dialog-overlay', {
    role: 'dialog', 'aria-modal': 'true',
    'aria-labelledby': 'mc-dlg-title',
    'aria-describedby': 'mc-step-badge'
  });

  const content = el('div', 'mc-dialog', { 'aria-live': 'polite' });

  // Header
  const header = el('div', 'mc-header', { id: 'mc-dlg-title' });
  header.textContent = t('report_dialog_title');
  const stepBadge = el('span', 'mc-step-badge', { id: 'mc-step-badge', 'aria-live': 'polite' });
  stepBadge.textContent = t('report_step_status', ['1', String(STEPS)]);
  header.appendChild(stepBadge);

  // Progress
  const pTrack = el('div', 'mc-progress-track', {
    role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(STEPS),
    'aria-valuenow': '1', 'aria-label': 'Form progress'
  });
  const pFill = el('div', 'mc-progress-fill');
  pTrack.appendChild(pFill);

  // Form
  const form = el('form');
  form.setAttribute('novalidate', 'true');

  // Step refs
  let step1, step2, step3;
  let summaryInp, descInp, instrNote;
  let techCb, extCb, logCb;
  let backBtn, nextBtn;
  let errorBox = null;

  function mkStep(id) {
    return el('div', 'mc-step', { id, role: 'group', 'aria-labelledby': 'mc-dlg-title' });
  }

  // ---- Step 1: Type ----
  step1 = mkStep('mc-step1');
  const typeLbl = el('label');
  typeLbl.setAttribute('id', 'mc-type-lbl');
  typeLbl.textContent = t('report_type_label');

  const typeGroup = el('div', 'mc-type-group', {
    role: 'radiogroup', 'aria-labelledby': 'mc-type-lbl'
  });

  const typeKeys = Object.keys(TEMPLATES);
  let selType = typeKeys[0];

  typeKeys.forEach(key => {
    const tpl = TEMPLATES[key];
    const lbl = el('label', 'mc-type-opt', { for: `mc-type-${key}`, tabindex: '0' });
    const radio = el('input', 'mc-type-radio', {
      type: 'radio', id: `mc-type-${key}`, name: 'issue-type', value: key
    });
    const txt = el('span', 'mc-type-txt');
    txt.textContent = t(tpl.nameKey);

    lbl.appendChild(radio);
    lbl.appendChild(txt);

    const activate = () => {
      typeGroup.querySelectorAll('.mc-type-opt').forEach(o => o.classList.remove('sel'));
      lbl.classList.add('sel');
      radio.checked = true;
      selType = key;
      updateStep2(key);
    };

    on(lbl, 'click', activate);
    on(lbl, 'keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });

    typeGroup.appendChild(lbl);
  });

  // Select first
  const firstOpt = typeGroup.querySelector('.mc-type-opt');
  if (firstOpt) { firstOpt.classList.add('sel'); firstOpt.querySelector('input').checked = true; }

  step1.appendChild(typeLbl);
  step1.appendChild(typeGroup);

  // ---- Step 2: Details ----
  step2 = mkStep('mc-step2');

  const sumLbl = el('label', '', { for: 'mc-summary' });
  sumLbl.textContent = t('report_summary_label');
  summaryInp = el('input', '', {
    type: 'text', id: 'mc-summary', name: 'issue-summary',
    required: 'true', 'aria-required': 'true',
    'aria-label': t('report_summary_label'), maxlength: '120', autocomplete: 'off'
  });

  const descLbl = el('label', '', { for: 'mc-desc' });
  descLbl.textContent = t('report_description_label');
  descInp = el('textarea', '', {
    id: 'mc-desc', name: 'issue-description',
    required: 'true', 'aria-required': 'true',
    'aria-label': t('report_description_label'), maxlength: '2000'
  });

  instrNote = el('div', 'mc-note', { role: 'note' });

  step2.appendChild(sumLbl);
  step2.appendChild(summaryInp);
  step2.appendChild(descLbl);
  step2.appendChild(descInp);
  step2.appendChild(instrNote);

  // ---- Step 3: Options ----
  step3 = mkStep('mc-step3');

  function mkCheck({ id, lblKey, descKey, descSub, badge, checked = false }) {
    const row = el('label', 'mc-check-row');
    row.setAttribute('for', id);

    const hdr = el('div', 'mc-check-hdr');
    const cb = el('input', '', { type: 'checkbox', id, name: id });
    if (checked) { cb.checked = true; }

    const span = el('span');
    span.textContent = t(lblKey);

    hdr.appendChild(cb);
    hdr.appendChild(span);

    if (badge) {
      const b = el('span', 'mc-check-badge');
      b.textContent = badge;
      hdr.appendChild(b);
    }

    const d = el('div', 'mc-check-desc');
    d.textContent = t(descKey, descSub || []);

    row.appendChild(hdr);
    row.appendChild(d);
    return { row, cb };
  }

  const logCount = _consoleLogs.length;
  const capBadge = logCount > 0 ? t('report_badge_captured_count', [String(logCount)]) : t('report_badge_optional');

  const techRow = mkCheck({
    id: 'mc-tech', lblKey: 'report_include_tech_info_label',
    descKey: 'report_include_tech_info_desc',
    badge: t('report_badge_recommended'), checked: true
  });
  techCb = techRow.cb;
  techCb.checked = true;

  const extRow = mkCheck({
    id: 'mc-ext', lblKey: 'report_include_ext_list_label',
    descKey: 'report_include_ext_list_desc',
    badge: t('report_badge_optional'), checked: false
  });
  extCb = extRow.cb;

  const logRow = mkCheck({
    id: 'mc-logs', lblKey: 'report_include_console_logs_label',
    descKey: 'report_include_console_logs_desc',
    descSub: [String(MAX_LOGS), String(logCount)],
    badge: capBadge, checked: false
  });
  logCb = logRow.cb;

  const priv = el('div', 'mc-privacy', { role: 'note' });
  priv.textContent = t('report_privacy', [REPO_NAME]);

  step3.appendChild(techRow.row);
  step3.appendChild(extRow.row);
  step3.appendChild(logRow.row);
  step3.appendChild(priv);

  // ---- Actions ----
  const actions = el('div', 'mc-actions');
  const right = el('div', 'mc-right');

  const cancelBtn = el('button', 'btn-sec', { type: 'button', 'aria-label': t('report_cancel') });
  cancelBtn.textContent = t('report_cancel');

  backBtn = el('button', 'btn-sec', {
    type: 'button', id: 'mc-back', disabled: 'true',
    'aria-label': t('report_back')
  });
  backBtn.textContent = t('report_back');
  backBtn.style.visibility = 'hidden';

  nextBtn = el('button', 'btn-pri', {
    type: 'button', id: 'mc-next', 'aria-label': t('report_next')
  });
  nextBtn.textContent = t('report_next');

  right.appendChild(backBtn);
  right.appendChild(nextBtn);
  actions.appendChild(cancelBtn);
  actions.appendChild(right);

  // Assemble
  form.appendChild(step1);
  form.appendChild(step2);
  form.appendChild(step3);
  form.appendChild(actions);

  content.appendChild(header);
  content.appendChild(pTrack);
  content.appendChild(form);

  overlay.appendChild(style);
  overlay.appendChild(content);

  // ---- Event wiring ----
  on(overlay, 'click', e => { if (e.target === overlay) closeDialog(); });
  on(cancelBtn, 'click', closeDialog);
  on(backBtn, 'click', () => nav(-1));
  on(nextBtn, 'click', () => nav(1));

  function clearError() {
    if (errorBox) { errorBox.remove(); errorBox = null; }
  }

  function showError(msg) {
    clearError();
    errorBox = el('div', 'mc-error', { role: 'alert' });
    errorBox.textContent = msg;
    form.insertBefore(errorBox, actions);
    // Auto-remove after 4.5s
    const tId = setTimeout(() => { clearError(); }, 4500);
    // Store timeout ref on element for cleanup
    errorBox._tId = tId;
  }

  on(summaryInp, 'input', () => {
    summaryInp.setAttribute('aria-invalid', 'false');
    clearError();
  });
  on(descInp, 'input', () => {
    descInp.setAttribute('aria-invalid', 'false');
    clearError();
  });

  // ---- Navigation ----
  const steps = [step1, step2, step3];
  let cur = 0;

  function updateStep2(type) {
    const tpl = TEMPLATES[type] || TEMPLATES.BUG;
    summaryInp.placeholder = t(tpl.sumPhKey);
    descInp.placeholder = t(tpl.descPhKey);
    instrNote.textContent = t(tpl.instrKey);
  }
  updateStep2(selType);
  step1.classList.add('current');

  function setProgress(idx) {
    const pct = ((idx + 1) / STEPS) * 100;
    pFill.style.width = `${pct}%`;
    pTrack.setAttribute('aria-valuenow', String(idx + 1));
  }

  function nav(dir) {
    const newIdx = cur + dir;

    if (dir > 0 && cur === 1) {
      const emptySum = !summaryInp.value.trim();
      const emptyDesc = !descInp.value.trim();
      summaryInp.setAttribute('aria-invalid', String(emptySum));
      descInp.setAttribute('aria-invalid', String(emptyDesc));

      if (emptySum || emptyDesc) {
        showError(t('report_validation_fill_all'));
        (emptySum ? summaryInp : descInp).focus();
        return;
      }
      clearError();
    }

    if (newIdx >= 0 && newIdx < steps.length) {
      steps[cur].classList.add('out');
      const old = cur;
      cur = newIdx;

      // Use single rAF for transition
      requestAnimationFrame(() => {
        steps[old].classList.remove('current', 'out');
        steps[cur].classList.add('current');
        if (dir < 0) steps[cur].classList.add('back');

        backBtn.style.visibility = cur > 0 ? 'visible' : 'hidden';
        backBtn.disabled = cur === 0;

        const last = cur === steps.length - 1;
        nextBtn.textContent = last ? t('report_submit') : t('report_next');
        nextBtn.className = last ? 'btn-ok' : 'btn-pri';
        nextBtn.setAttribute('aria-label', last ? t('report_submit') : t('report_next'));

        stepBadge.textContent = t('report_step_status', [String(cur + 1), String(STEPS)]);
        setProgress(cur);

        const focusable = steps[cur].querySelector(
          'input:not([type="hidden"]), select, textarea, button:not(#mc-back), .mc-type-opt'
        );
        focusable?.focus();
      });
    } else if (newIdx === steps.length) {
      submit();
    }
  }

  async function submit() {
    nextBtn.disabled = true;
    nextBtn.classList.add('btn-loading');
    nextBtn.textContent = t('report_opening_github') + ' ⏳';

    const tpl = TEMPLATES[selType] || TEMPLATES.GENERAL;
    const title = `${tpl.prefix} ${summaryInp.value.trim()}`;
    const desc = descInp.value.trim();
    const isDiscuss = tpl.discuss === true;
    const target = isDiscuss ? DISCUSS_URL : ISSUE_URL;

    const parts = [`## Detailed Report\n\n${desc}`];
    if (techCb.checked) parts.push(`\n---\n${await getTechInfo()}`);
    if (extCb.checked) parts.push(`\n---\n${await getExtensions()}`);
    if (logCb.checked) parts.push(`\n---\n${getConsoleLogs()}`);
    parts.push(`\n---\n*Technical details included voluntarily by the user to aid debugging.*`);

    let body = parts.join('\n');
    if (body.length > MAX_BODY) {
      body = body.slice(0, MAX_BODY) + '\n\n_…(report truncated to stay within URL limits)_';
    }

    const params = new URLSearchParams();
    params.append('title', title);
    params.append('body', body);
    if (!isDiscuss && tpl.label) params.append('labels', tpl.label);
    if (isDiscuss) params.append('category', 'general');

    window.open(`${target}?${params.toString()}`, '_blank', 'noopener,noreferrer');
    closeDialog();
  }

  // ---- Focus trap ----
  on(overlay, 'keydown', e => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(
      overlay.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => !el.closest('.mc-step:not(.current)'));

    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });

  return overlay;
}

/* --------------------------------------------------------------------------
   Dialog lifecycle
   -------------------------------------------------------------------------- */
function openDialog() {
  if (_dialog || !document.body) return;
  ensureConsoleCapture();
  _prevFocus = document.activeElement;
  _dialog = buildDialog();
  document.body.appendChild(_dialog);

  requestAnimationFrame(() => _dialog.classList.add('open'));
  _dialog.querySelector('.mc-type-opt')?.focus();
}

function closeDialog() {
  if (!_dialog) return;
  _dialog.classList.remove('open');
  const dying = _dialog;
  _dialog = null;

  // Clear any pending error timeouts
  dying.querySelectorAll('.mc-error').forEach(e => {
    if (e._tId) clearTimeout(e._tId);
  });

  // Clean up all listeners
  offAll();

  requestAnimationFrame(() => {
    dying.remove();
    _prevFocus?.focus();
    _prevFocus = null;
  });
}

/* --------------------------------------------------------------------------
   Global keyboard shortcut
   -------------------------------------------------------------------------- */
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
    openDialog();
    return;
  }

  if (e.key === 'Escape' && _dialog) {
    e.preventDefault();
    e.stopPropagation();
    closeDialog();
  }
}

/* --------------------------------------------------------------------------
   Init
   -------------------------------------------------------------------------- */
if (!_keyHandlerBound) {
  document.addEventListener('keydown', onKeydown);
  _keyHandlerBound = true;
}