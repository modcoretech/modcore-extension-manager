// discovery.js
// Discovery Feature for modcore Extension Manager

'use strict';

// --- Storage Keys & Defaults ---
const DISCOVERY_STORAGE_KEY = 'modcore_discovery_v3';

const defaultDiscovery = {
    featureOrder: ['inspect', 'safety', 'snapshot', 'timeline', 'automations', 'cloud', 'notes'],
    quickActionsCollapsed: true
};

// --- Feature Definitions ---
const FEATURES = {
    inspect:     { id: 'inspect',     name: 'Inspect',     fullName: 'modcore Inspect',     url: 'src/html/inspect.html',       icon: '../../public/icons/svg/search.svg'  },
    safety:      { id: 'safety',      name: 'Safety',      fullName: 'Safety Center',       url: 'src/html/safety-center.html', icon: '../../public/icons/svg/shield.svg'  },
    snapshot:    { id: 'snapshot',    name: 'Snapshot',    fullName: 'modcore Snapshot',    url: 'src/html/snapshot.html',      icon: '../../public/icons/svg/host.svg'    },
    timeline:    { id: 'timeline',    name: 'Timeline',    fullName: 'modcore Timeline',    url: 'src/html/timeline.html',      icon: '../../public/icons/svg/clock.svg'   },
    automations: { id: 'automations', name: 'Automations', fullName: 'modcore Automations', url: 'src/html/automations.html',   icon: '../../public/icons/svg/rules.svg'   },
    cloud:       { id: 'cloud',       name: 'Cloud',       fullName: 'modcore Cloud',       url: 'src/html/cloud.html',         icon: '../../public/icons/svg/cloud.svg'   },
    notes:       { id: 'notes',       name: 'Notes',       fullName: 'Extension Notes',     url: 'src/html/notes.html',         icon: '../../public/icons/svg/edit.svg'    }
};

// --- CSS ---
const DISCOVERY_CSS = `
    .modcore-discovery-ui,
    .modcore-discovery-ui *,
    .modcore-discovery-ui button,
    .modcore-discovery-ui input {
        font-family: var(--font-sans);
        box-sizing: border-box;
    }

    /* Trigger Button */
    .mc-trigger {
        position: fixed;
        top: 14px;
        right: 14px;
        z-index: 10000;
        width: 34px;
        height: 34px;
        border-radius: var(--radius-sm);
        background: var(--color-surface);
        border: var(--border-width) solid var(--color-border);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-sm);
        transition:
            background var(--transition-fast),
            box-shadow var(--transition-fast),
            transform var(--duration-fast) var(--ease-bounce);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        outline: none;
    }
    .mc-trigger:hover {
        background: var(--color-surface-hover);
        box-shadow: 0 4px 14px rgba(0,0,0,0.10);
        transform: translateY(-1px) scale(1.04);
    }
    .mc-trigger:active { transform: scale(0.93); }
    .mc-trigger:focus-visible {
        box-shadow: 0 0 0 3px var(--color-focus-ring);
    }
    .mc-trigger img {
        width: 18px;
        height: 18px;
        opacity: 0.6;
        filter: var(--filter-icon);
        transition: opacity var(--transition-fast), transform var(--duration-normal) var(--ease-bounce);
        pointer-events: none;
    }
    .mc-trigger:hover img { opacity: 0.9; }
    .mc-trigger.active img {
        opacity: 1;
        transform: scale(1.1);
    }
    .mc-trigger.pulse {
        animation: mc-trigger-pulse var(--duration-slow) var(--ease-standard);
    }
    @keyframes mc-trigger-pulse {
        0%   { box-shadow: 0 0 0 0 var(--color-focus-ring); }
        70%  { box-shadow: 0 0 0 8px transparent; }
        100% { box-shadow: 0 0 0 0 transparent; }
    }

    /* Overlay */
    .mc-overlay {
        position: fixed;
        inset: 0;
        background: var(--color-backdrop);
        backdrop-filter: blur(0px);
        -webkit-backdrop-filter: blur(0px);
        z-index: 9999;
        opacity: 0;
        pointer-events: none;
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        padding: 56px 14px 20px 20px;
        will-change: opacity, backdrop-filter;
        transition:
            backdrop-filter var(--transition-normal),
            opacity var(--transition-normal);
    }
    .mc-overlay.open {
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        opacity: 1;
        pointer-events: auto;
    }

    /* Panel */
    .mc-panel {
        background: var(--color-surface);
        border-radius: var(--radius-2xl);
        border: var(--border-width) solid var(--color-border);
        box-shadow: 0 24px 64px rgba(0,0,0,0.18), 0 6px 20px rgba(0,0,0,0.08);
        width: 344px;
        overflow: hidden;
        transform: translateY(-14px) scale(0.96);
        opacity: 0;
        will-change: transform, opacity;
        transition:
            transform var(--duration-slow) var(--ease-standard),
            opacity var(--duration-normal) var(--ease-standard);
        outline: none;
        contain: layout style paint;
    }
    .mc-overlay.open .mc-panel {
        transform: translateY(0) scale(1);
        opacity: 1;
    }

    /* Header */
    .mc-header {
        padding: var(--space-4) 14px var(--space-3);
        border-bottom: var(--border-width) solid var(--color-border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--color-surface);
        z-index: 10;
        gap: var(--space-2);
    }
    .mc-header h3 {
        margin: 0;
        font-size: var(--text-headline-sm);
        font-weight: var(--weight-semibold);
        color: var(--color-text-primary);
        letter-spacing: -0.3px;
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .mc-header-actions {
        display: flex;
        gap: var(--space-1);
        flex-shrink: 0;
    }
    .mc-icon-btn {
        width: 30px;
        height: 30px;
        border-radius: var(--radius-sm);
        border: none;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition:
            background var(--transition-fast),
            transform var(--duration-fast) var(--ease-standard);
        position: relative;
        outline: none;
        flex-shrink: 0;
    }
    .mc-icon-btn:hover { background: var(--color-surface-high); }
    .mc-icon-btn:active { transform: scale(0.88); }
    .mc-icon-btn:focus-visible { box-shadow: 0 0 0 2px var(--color-focus-ring); }
    .mc-icon-btn img {
        width: 16px;
        height: 16px;
        opacity: 0.5;
        filter: var(--filter-icon);
        transition: opacity var(--transition-fast), transform var(--duration-normal) var(--ease-standard);
        pointer-events: none;
    }
    .mc-icon-btn:hover img { opacity: 0.85; }
    .mc-icon-btn.reorder-active {
        background: var(--color-primary-container);
    }
    .mc-icon-btn.reorder-active img {
        opacity: 1;
        filter: invert(29%) sepia(98%) saturate(1500%) hue-rotate(198deg) brightness(95%);
    }

    /* Reorder Mode Bar */
    .mc-reorder-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        padding: 0 var(--space-4);
        background: var(--color-primary);
        color: var(--color-primary-on);
        font-size: var(--text-body-sm);
        font-weight: var(--weight-medium);
        overflow: hidden;
        max-height: 0;
        opacity: 0;
        transition:
            max-height var(--duration-normal) var(--ease-standard),
            opacity var(--duration-fast) var(--ease-standard),
            padding var(--duration-normal) var(--ease-standard);
    }
    .mc-reorder-bar.visible {
        max-height: 38px;
        opacity: 1;
        padding: 9px var(--space-4);
    }
    .mc-reorder-bar-hint { opacity: 0.9; }
    .mc-reorder-done-btn {
        background: rgba(255,255,255,0.22);
        border: none;
        color: var(--color-primary-on);
        padding: 3px var(--space-3);
        border-radius: var(--radius-sm);
        font-size: var(--text-body-sm);
        font-weight: var(--weight-semibold);
        cursor: pointer;
        transition: background var(--transition-fast);
        white-space: nowrap;
        outline: none;
        flex-shrink: 0;
    }
    .mc-reorder-done-btn:hover { background: rgba(255,255,255,0.35); }
    .mc-reorder-done-btn:focus-visible { box-shadow: 0 0 0 2px rgba(255,255,255,0.6); }

    /* Feature Grid */
    .mc-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--space-1);
        padding: 14px 12px 12px;
    }

    /* Feature Item */
    .mc-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        padding: 10px 4px 8px;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition:
            background var(--duration-fast) var(--ease-standard),
            transform var(--duration-normal) var(--ease-bounce),
            box-shadow var(--duration-fast) var(--ease-standard);
        text-decoration: none;
        border: 2px solid transparent;
        background: transparent;
        position: relative;
        user-select: none;
        -webkit-user-select: none;
        outline: none;
        -webkit-tap-highlight-color: transparent;
        animation: mc-item-in var(--duration-normal) var(--ease-standard) both;
    }
    .mc-item,
    .mc-item:hover,
    .mc-item:visited,
    .mc-item:focus,
    .mc-item:active {
        text-decoration: none;
    }
    @keyframes mc-item-in {
        from { opacity: 0; transform: scale(0.82) translateY(6px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    .mc-item:hover {
        background: var(--color-surface-mid);
        transform: translateY(-3px) scale(1.03);
    }
    .mc-item:active { transform: scale(0.94); transition-duration: var(--duration-fast); }
    .mc-item:focus-visible {
        box-shadow: 0 0 0 2px var(--color-focus-ring);
        outline: none;
    }

    /* Reorder states */
    .mc-item.reordering {
        cursor: grab;
        animation: none;
    }
    .mc-item.reordering:hover { transform: translateY(-2px); }
    .mc-item.reordering::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: var(--radius-md);
        border: 1.5px dashed rgba(var(--color-primary-rgb), 0.25);
        pointer-events: none;
        animation: mc-reorder-border 1.8s var(--ease-standard) infinite;
    }
    @keyframes mc-reorder-border {
        0%,100% { border-color: rgba(var(--color-primary-rgb), 0.18); }
        50%      { border-color: rgba(var(--color-primary-rgb), 0.5); }
    }
    .mc-item.dragging {
        opacity: 0.3;
        transform: scale(0.94);
        cursor: grabbing;
    }
    .mc-item.drag-over {
        border-color: var(--color-primary);
        background: var(--color-primary-container);
        transform: scale(1.06);
        box-shadow: 0 4px 16px rgba(var(--color-primary-rgb), 0.18);
    }
    .mc-item.swap-selected {
        border-color: var(--color-warning);
        background: var(--color-warning-container);
        animation: mc-swap-pulse 0.9s var(--ease-standard) infinite;
    }
    @keyframes mc-swap-pulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(var(--color-warning-rgb), 0.3); }
        50%      { box-shadow: 0 0 0 5px transparent; }
    }

    /* Feature Icon */
    .mc-icon {
        width: 46px;
        height: 46px;
        border-radius: var(--radius-md);
        background: var(--color-surface-high);
        display: flex;
        align-items: center;
        justify-content: center;
        transition:
            transform var(--duration-normal) var(--ease-bounce),
            box-shadow var(--duration-fast) var(--ease-standard),
            background var(--duration-fast) var(--ease-standard);
        position: relative;
        flex-shrink: 0;
    }
    .mc-item:hover .mc-icon {
        transform: scale(1.1) rotate(3deg);
        box-shadow: 0 5px 14px rgba(0,0,0,0.09);
        background: var(--color-surface-highest);
    }
    .mc-item.reordering .mc-icon { transform: none; box-shadow: none; }
    .mc-icon img {
        width: 21px;
        height: 21px;
        filter: var(--filter-icon);
        transition: transform var(--duration-fast) var(--ease-standard);
        pointer-events: none;
    }

    /* Keyboard shortcut badge */
    .mc-kbd-badge {
        position: absolute;
        top: 3px;
        right: 3px;
        background: rgba(0,0,0,0.5);
        color: #fff;
        font-size: 8.5px;
        font-weight: var(--weight-bold);
        border-radius: 4px;
        padding: 1px 4px;
        line-height: 1.4;
        opacity: 0;
        transform: scale(0.75);
        transition:
            opacity var(--transition-fast),
            transform var(--duration-fast) var(--ease-bounce);
        pointer-events: none;
        letter-spacing: 0.3px;
    }
    .mc-shortcuts-visible .mc-kbd-badge {
        opacity: 1;
        transform: scale(1);
    }

    /* Feature Label */
    .mc-label {
        font-size: var(--text-label-lg);
        font-weight: var(--weight-medium);
        color: var(--color-text-secondary);
        text-align: center;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        transition: color var(--transition-fast);
        pointer-events: none;
        text-decoration: none;
    }
    .mc-item:hover .mc-label { color: var(--color-text-primary); }

    /* Quick Actions */
    .mc-quick-section {
        border-top: var(--border-width) solid var(--color-border);
        overflow: hidden;
    }
    .mc-quick-toggle {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 9px var(--space-4);
        background: transparent;
        border: none;
        cursor: pointer;
        text-align: left;
        transition: background var(--transition-fast);
        outline: none;
    }
    .mc-quick-toggle:hover { background: var(--color-surface-mid); }
    .mc-quick-toggle:focus-visible { box-shadow: inset 0 0 0 2px var(--color-focus-ring); }
    .mc-quick-toggle-label {
        font-size: var(--text-label-lg);
        color: var(--color-text-muted);
        font-weight: var(--weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.55px;
        flex: 1;
    }
    .mc-quick-toggle-arrow {
        width: 14px;
        height: 14px;
        filter: var(--filter-icon);
        opacity: 0.4;
        transition:
            transform var(--duration-normal) var(--ease-standard),
            opacity var(--transition-fast);
        pointer-events: none;
        flex-shrink: 0;
    }
    .mc-quick-toggle:hover .mc-quick-toggle-arrow { opacity: 0.65; }
    .mc-quick-toggle.expanded .mc-quick-toggle-arrow {
        transform: rotate(180deg);
    }
    .mc-kbd-hint {
        font-size: var(--text-label-sm);
        color: var(--color-text-disabled);
        background: var(--color-surface-high);
        border-radius: var(--radius-sm);
        padding: 1px 5px;
        letter-spacing: 0.2px;
        flex-shrink: 0;
    }
    .mc-quick-body {
        max-height: 0;
        overflow: hidden;
        transition:
            max-height var(--duration-normal) var(--ease-standard),
            padding var(--duration-normal) var(--ease-standard);
        padding: 0 12px;
    }
    .mc-quick-body.expanded {
        max-height: 160px;
        padding: 0 12px 12px;
    }
    .mc-quick-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 7px;
    }
    .mc-quick-btn {
        padding: 10px var(--space-1);
        border-radius: var(--radius-sm);
        border: var(--border-width) solid var(--color-border);
        background: var(--color-surface-mid);
        cursor: pointer;
        font-size: var(--text-body-sm);
        font-weight: var(--weight-medium);
        color: var(--color-text-secondary);
        transition:
            background var(--transition-fast),
            border-color var(--transition-fast),
            color var(--transition-fast),
            transform var(--duration-fast) var(--ease-bounce),
            box-shadow var(--transition-fast);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        outline: none;
    }
    .mc-quick-btn:hover {
        background: var(--color-primary-container);
        border-color: rgba(var(--color-primary-rgb), 0.35);
        color: var(--color-primary);
        transform: translateY(-2px);
        box-shadow: 0 3px 10px rgba(var(--color-primary-rgb), 0.1);
    }
    .mc-quick-btn:active { transform: scale(0.94); }
    .mc-quick-btn:focus-visible { box-shadow: 0 0 0 2px var(--color-focus-ring); }
    .mc-quick-btn img {
        width: 15px;
        height: 15px;
        opacity: 0.55;
        filter: var(--filter-icon);
        transition: opacity var(--transition-fast);
        pointer-events: none;
    }
    .mc-quick-btn:hover img { opacity: 0.9; }

    /* Toast */
    .mc-toast {
        position: fixed;
        bottom: 22px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: var(--color-inverse-surface);
        color: var(--color-inverse-on-surface);
        padding: 10px 18px;
        border-radius: var(--radius-md);
        font-size: var(--text-body-md);
        font-weight: var(--weight-medium);
        z-index: 10005;
        opacity: 0;
        visibility: hidden;
        transition: all var(--duration-normal) var(--ease-standard);
        white-space: nowrap;
        pointer-events: none;
        max-width: calc(100vw - 40px);
    }
    .mc-toast.show {
        opacity: 1;
        visibility: visible;
        transform: translateX(-50%) translateY(0);
    }

    /* Help / Shortcut Sheet */
    .mc-help-sheet {
        position: absolute;
        inset: 0;
        background: var(--color-modal-bg);
        border-radius: var(--radius-2xl);
        z-index: 20;
        display: flex;
        flex-direction: column;
        padding: var(--space-5);
        gap: var(--space-3);
        opacity: 0;
        pointer-events: none;
        transform: scale(0.96) translateY(6px);
        transition:
            opacity var(--duration-normal) var(--ease-standard),
            transform var(--duration-normal) var(--ease-standard);
        overflow-y: auto;
    }
    .mc-help-sheet.visible {
        opacity: 1;
        pointer-events: auto;
        transform: scale(1) translateY(0);
    }
    .mc-help-sheet-title {
        font-size: var(--text-title-lg);
        font-weight: var(--weight-semibold);
        color: var(--color-text-primary);
        margin: 0 0 4px;
        letter-spacing: -0.2px;
    }
    .mc-shortcut-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        padding: 5px 0;
        border-bottom: var(--border-width) solid var(--color-border);
    }
    .mc-shortcut-row:last-of-type { border-bottom: none; }
    .mc-shortcut-desc {
        font-size: var(--text-body-md);
        color: var(--color-text-secondary);
    }
    .mc-shortcut-keys {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }
    .mc-kbd {
        background: var(--color-surface-high);
        border: var(--border-width) solid var(--color-border-strong);
        border-bottom-width: 2px;
        border-radius: var(--radius-sm);
        padding: 2px 7px;
        font-size: var(--text-body-sm);
        font-weight: var(--weight-semibold);
        color: var(--color-text-primary);
        line-height: 1.5;
        font-family: inherit;
        white-space: nowrap;
    }
    .mc-kbd-plus {
        color: var(--color-text-muted);
        font-size: var(--text-label-md);
        align-self: center;
    }
    .mc-help-doc-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        border-radius: var(--radius-sm);
        background: var(--color-primary-container);
        color: var(--color-primary);
        font-size: var(--text-body-sm);
        font-weight: var(--weight-semibold);
        text-decoration: none;
        margin: 4px 0;
        transition: background var(--transition-fast), transform var(--duration-fast) var(--ease-standard);
        outline: none;
    }
    .mc-help-doc-link:hover {
        background: rgba(var(--color-primary-rgb), 0.18);
        transform: translateY(-1px);
    }
    .mc-help-doc-link:focus-visible {
        box-shadow: 0 0 0 2px var(--color-focus-ring);
    }
    .mc-help-close {
        margin-top: auto;
        width: 100%;
        padding: 9px;
        border: none;
        border-radius: var(--radius-sm);
        background: var(--color-surface-high);
        cursor: pointer;
        font-size: var(--text-body-md);
        font-weight: var(--weight-semibold);
        color: var(--color-text-secondary);
        transition: background var(--transition-fast);
        outline: none;
    }
    .mc-help-close:hover { background: var(--color-surface-highest); }
    .mc-help-close:focus-visible { box-shadow: 0 0 0 2px var(--color-focus-ring); }

    /* Reduced motion */
    @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
        }
        .mc-panel,
        .mc-overlay,
        .mc-item,
        .mc-toast,
        .mc-help-sheet {
            transition: none !important;
            animation: none !important;
        }
    }
`;

// --- Style Injection ---
function injectStyles() {
    if (document.getElementById('modcore-discovery-styles')) return;
    const style = document.createElement('style');
    style.id = 'modcore-discovery-styles';
    style.textContent = DISCOVERY_CSS;
    document.head.appendChild(style);
}

// --- Storage ---
function getDiscoveryData() {
    return new Promise(resolve => {
        try {
            chrome.storage.local.get([DISCOVERY_STORAGE_KEY], result => {
                const stored = result?.[DISCOVERY_STORAGE_KEY] ?? {};
                const knownIds = new Set(Object.keys(FEATURES));
                let featureOrder = Array.isArray(stored.featureOrder) ? stored.featureOrder : [];
                featureOrder = featureOrder.filter(id => knownIds.has(id));
                Object.keys(FEATURES).forEach(id => {
                    if (!featureOrder.includes(id)) featureOrder.push(id);
                });
                resolve({
                    featureOrder,
                    quickActionsCollapsed: stored.quickActionsCollapsed ?? defaultDiscovery.quickActionsCollapsed
                });
            });
        } catch {
            resolve({ ...defaultDiscovery, featureOrder: [...defaultDiscovery.featureOrder] });
        }
    });
}

function saveDiscoveryData(data) {
    return new Promise(resolve => {
        try {
            chrome.storage.local.set({ [DISCOVERY_STORAGE_KEY]: data }, resolve);
        } catch { resolve(); }
    });
}

// --- Toast ---
let _toastTimer = null;
let _toastPersistent = false;

function showToast(message, { persistent = false } = {}) {
    let toast = document.querySelector('.mc-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'mc-toast modcore-discovery-ui';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.setAttribute('aria-atomic', 'true');
        document.body.appendChild(toast);
    }
    clearTimeout(_toastTimer);
    _toastPersistent = persistent;
    toast.textContent = message;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    if (!persistent) {
        _toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
    }
}

function clearToast() {
    const toast = document.querySelector('.mc-toast');
    if (toast) toast.classList.remove('show');
    clearTimeout(_toastTimer);
    _toastPersistent = false;
}

// --- Safe DOM Helpers ---
function el(tag, opts = {}) {
    const node = document.createElement(tag);
    if (opts.className)   node.className = opts.className;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.attrs)       Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (opts.on)          Object.entries(opts.on).forEach(([k, v]) => node.addEventListener(k, v));
    if (opts.children)    opts.children.forEach(c => c && node.appendChild(c));
    return node;
}

function makeImg(src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.setAttribute('loading', 'eager');
    return img;
}

function makeKbd(key) {
    return el('kbd', { className: 'mc-kbd', text: key });
}

// --- Trigger Button ---
function createTrigger() {
    return el('button', {
        className: 'mc-trigger modcore-discovery-ui',
        attrs: {
            'aria-label': 'Open Discovery (Alt+D)',
            'aria-haspopup': 'dialog',
            'aria-expanded': 'false',
            'aria-controls': 'modcore-discovery-overlay',
            'title': 'Discovery (Alt+D)',
            'id': 'modcore-discovery-trigger'
        },
        children: [makeImg('../../public/icons/svg/grid.svg')]
    });
}

// --- Feature Item ---
function createFeatureItem(featureId, position, { isReordering = false } = {}) {
    const feature = FEATURES[featureId];
    if (!feature) return null;

    const shortcutKey = position <= 9 ? String(position) : null;

    const iconWrapper = el('div', { className: 'mc-icon', children: [makeImg(feature.icon)] });

    if (shortcutKey) {
        const badge = el('div', { className: 'mc-kbd-badge', text: shortcutKey });
        badge.setAttribute('aria-hidden', 'true');
        iconWrapper.appendChild(badge);
    }

    const label = el('span', { className: 'mc-label', text: feature.name });

    const item = el('a', {
        className: 'mc-item modcore-discovery-ui' + (isReordering ? ' reordering' : ''),
        attrs: {
            'data-feature-id': featureId,
            'aria-label': feature.fullName,
            'href': isReordering ? '#' : feature.url,
            'draggable': isReordering ? 'true' : 'false',
            'tabindex': '0',
            'style': `animation-delay: ${(position - 1) * 35}ms`
        },
        children: [iconWrapper, label]
    });

    return item;
}

// --- Discovery Panel ---
function createDiscoveryPanel(data) {
    let isReordering = false;
    let draggedItem = null;
    let swapCandidate = null;

    const overlay = el('div', {
        className: 'mc-overlay modcore-discovery-ui',
        attrs: {
            id: 'modcore-discovery-overlay',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Discovery',
            'aria-labelledby': 'modcore-discovery-title'
        }
    });

    const panel = el('div', {
        className: 'mc-panel',
        attrs: { tabindex: '-1' }
    });

    const title = el('h3', { text: 'Discovery', attrs: { id: 'modcore-discovery-title' } });

    const reorderBtn = el('button', {
        className: 'mc-icon-btn',
        attrs: {
            'aria-label': 'Reorder features (R)',
            'title': 'Reorder (R)',
            'aria-pressed': 'false'
        },
        children: [makeImg('../../public/icons/svg/move.svg')]
    });

    const helpBtn = el('button', {
        className: 'mc-icon-btn',
        attrs: {
            'aria-label': 'Keyboard shortcuts (?)',
            'title': 'Shortcuts (?)',
            'aria-expanded': 'false',
            'aria-controls': 'modcore-help-sheet'
        },
        children: [makeImg('../../public/icons/svg/help.svg')]
    });

    const closeBtn = el('button', {
        className: 'mc-icon-btn',
        attrs: { 'aria-label': 'Close Discovery (Esc)', 'title': 'Close (Esc)' },
        children: [makeImg('../../public/icons/svg/close.svg')]
    });

    const header = el('div', {
        className: 'mc-header',
        children: [
            title,
            el('div', { className: 'mc-header-actions', children: [reorderBtn, helpBtn, closeBtn] })
        ]
    });
    panel.appendChild(header);

    const reorderBar = el('div', {
        className: 'mc-reorder-bar',
        attrs: { 'aria-live': 'polite' },
        children: [
            el('span', { className: 'mc-reorder-bar-hint', text: 'Drag to reorder or tap two items to swap' }),
            el('button', { className: 'mc-reorder-done-btn', text: 'Done' })
        ]
    });
    const reorderDoneBtn = reorderBar.querySelector('.mc-reorder-done-btn');
    panel.appendChild(reorderBar);

    const grid = el('div', {
        className: 'mc-grid',
        attrs: { 'aria-label': 'Features' }
    });
    panel.appendChild(grid);

    function renderFeatures() {
        while (grid.firstChild) grid.removeChild(grid.firstChild);

        data.featureOrder.forEach((featureId, idx) => {
            const position = idx + 1;
            const item = createFeatureItem(featureId, position, { isReordering });
            if (!item) return;

            const feat = FEATURES[featureId];

            if (isReordering) {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    handleSwapClick(item, featureId);
                });

                item.addEventListener('dragstart', (e) => {
                    draggedItem = item;
                    item.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', featureId);
                });
                item.addEventListener('dragend', () => {
                    item.classList.remove('dragging');
                    draggedItem = null;
                    grid.querySelectorAll('.mc-item').forEach(i => i.classList.remove('drag-over'));
                });
                item.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (draggedItem && draggedItem !== item) item.classList.add('drag-over');
                });
                item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
                item.addEventListener('drop', (e) => {
                    e.preventDefault();
                    item.classList.remove('drag-over');
                    if (!draggedItem || draggedItem === item) return;
                    const fromId = draggedItem.getAttribute('data-feature-id');
                    const toId   = featureId;
                    const fi = data.featureOrder.indexOf(fromId);
                    const ti = data.featureOrder.indexOf(toId);
                    if (fi > -1 && ti > -1) {
                        data.featureOrder.splice(fi, 1);
                        data.featureOrder.splice(ti, 0, fromId);
                        saveDiscoveryData(data);
                        renderFeatures();
                        showToast('Order saved', { persistent: true });
                    }
                });

                let touchStartX = 0, touchStartY = 0;
                item.addEventListener('touchstart', (e) => {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                }, { passive: true });
                item.addEventListener('touchend', (e) => {
                    const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
                    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
                    if (dx < 10 && dy < 10) handleSwapClick(item, featureId);
                }, { passive: true });

            } else {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    openFeature(feat.url);
                });
                item.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openFeature(item.getAttribute('href'));
                    }
                });
            }

            grid.appendChild(item);
        });

        panel._shortcutMap = {};
        data.featureOrder.forEach((featureId, idx) => {
            const key = String(idx + 1);
            if (idx < 9) panel._shortcutMap[key] = featureId;
        });
    }

    function openFeature(url) {
        try { chrome.tabs.create({ url }); } catch { window.open(url, '_blank'); }
        closeDiscovery(overlay);
    }

    function handleSwapClick(item, featureId) {
        if (!swapCandidate) {
            swapCandidate = { el: item, id: featureId };
            item.classList.add('swap-selected');
            showToast('Select another feature to swap', { persistent: true });
        } else if (swapCandidate.el === item) {
            item.classList.remove('swap-selected');
            swapCandidate = null;
        } else {
            const fi = data.featureOrder.indexOf(swapCandidate.id);
            const ti = data.featureOrder.indexOf(featureId);
            if (fi > -1 && ti > -1) {
                [data.featureOrder[fi], data.featureOrder[ti]] = [data.featureOrder[ti], data.featureOrder[fi]];
                saveDiscoveryData(data);
                swapCandidate = null;
                renderFeatures();
                showToast('Swapped', { persistent: true });
            }
        }
    }

    renderFeatures();

    const quickToggleArrow = makeImg('../../public/icons/svg/arrow-down.svg');
    quickToggleArrow.className = 'mc-quick-toggle-arrow';

    const quickToggle = el('button', {
        className: 'mc-quick-toggle' + (data.quickActionsCollapsed ? '' : ' expanded'),
        attrs: {
            'aria-expanded': data.quickActionsCollapsed ? 'false' : 'true',
            'aria-controls': 'mc-quick-body',
            'aria-label': 'Toggle Quick Actions (Q)'
        },
        children: [
            el('span', { className: 'mc-quick-toggle-label', text: 'Quick Actions' }),
            el('span', { className: 'mc-kbd-hint', text: 'Q', attrs: { 'aria-hidden': 'true' } }),
            quickToggleArrow
        ]
    });

    const quickBody = el('div', {
        className: 'mc-quick-body' + (data.quickActionsCollapsed ? '' : ' expanded'),
        attrs: { id: 'mc-quick-body', 'aria-hidden': data.quickActionsCollapsed ? 'true' : 'false' }
    });

    function toggleQuickActions() {
        const expanded = quickToggle.classList.toggle('expanded');
        quickBody.classList.toggle('expanded', expanded);
        quickToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        quickBody.setAttribute('aria-hidden', expanded ? 'false' : 'true');
        data.quickActionsCollapsed = !expanded;
        saveDiscoveryData(data);
    }
    quickToggle.addEventListener('click', toggleQuickActions);

    const quickGrid = el('div', { className: 'mc-quick-grid' });

    const quickActions = [
        { text: 'Manage',      icon: '../../public/icons/svg/grid.svg',  label: 'Open Chrome Extensions page',           action: () => { try { chrome.tabs.create({ url: 'chrome://extensions' }); } catch {} } },
        { text: 'Enable All',  icon: '../../public/icons/svg/check.svg', label: 'Enable all extensions except modcore',  action: () => toggleAllExtensions(true) },
        { text: 'Disable All', icon: '../../public/icons/svg/close.svg', label: 'Disable all extensions except modcore', action: () => toggleAllExtensions(false) }
    ];

    quickActions.forEach(({ text, icon, label, action }) => {
        const btn = el('button', {
            className: 'mc-quick-btn modcore-discovery-ui',
            attrs: { 'aria-label': label },
            children: [makeImg(icon), el('span', { text })]
        });
        btn.addEventListener('click', action);
        quickGrid.appendChild(btn);
    });

    quickBody.appendChild(quickGrid);

    panel.appendChild(el('div', {
        className: 'mc-quick-section',
        children: [quickToggle, quickBody]
    }));

    const helpSheet = createHelpSheet();
    panel.appendChild(helpSheet);

    function setReordering(val) {
        isReordering = val;
        swapCandidate = null;
        reorderBtn.classList.toggle('reorder-active', isReordering);
        reorderBtn.setAttribute('aria-pressed', isReordering ? 'true' : 'false');
        reorderBar.classList.toggle('visible', isReordering);
        reorderBtn.setAttribute('title', isReordering ? 'Done reordering (R)' : 'Reorder features (R)');
        reorderBtn.setAttribute('aria-label', isReordering ? 'Done reordering (R)' : 'Reorder features (R)');
        if (isReordering) {
            showToast('Drag to reorder, or tap two items to swap', { persistent: true });
        } else {
            clearToast();
        }
        renderFeatures();
    }

    reorderBtn.addEventListener('click', () => setReordering(!isReordering));
    reorderDoneBtn.addEventListener('click', () => setReordering(false));

    helpBtn.addEventListener('click', () => {
        const nowVisible = helpSheet.classList.toggle('visible');
        helpBtn.setAttribute('aria-expanded', nowVisible ? 'true' : 'false');
        helpSheet.setAttribute('aria-hidden', nowVisible ? 'false' : 'true');
        if (nowVisible) helpSheet.querySelector('.mc-help-close')?.focus();
    });

    closeBtn.addEventListener('click', () => closeDiscovery(overlay));

    panel.addEventListener('keydown', (e) => {
        if (helpSheet.classList.contains('visible')) {
            if (e.key === 'Escape' || e.key === '?') {
                e.stopPropagation();
                helpSheet.classList.remove('visible');
                helpSheet.setAttribute('aria-hidden', 'true');
                helpBtn.setAttribute('aria-expanded', 'false');
                helpBtn.focus();
            }
            return;
        }

        if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key)) {
            const featureId = panel._shortcutMap?.[e.key];
            if (featureId) {
                const feat = FEATURES[featureId];
                if (feat) {
                    try { chrome.tabs.create({ url: feat.url }); } catch { window.open(feat.url, '_blank'); }
                    closeDiscovery(overlay);
                }
            }
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (isReordering) {
                setReordering(false);
            } else {
                closeDiscovery(overlay);
            }
            return;
        }

        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setReordering(!isReordering); }
        if (e.key === '?') { e.preventDefault(); helpBtn.click(); }
        if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); toggleQuickActions(); }
    });

    overlay.appendChild(panel);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            if (isReordering) {
                setReordering(false);
            } else {
                closeDiscovery(overlay);
            }
        }
    });

    overlay._setReordering = setReordering;
    overlay._toggleQuickActions = toggleQuickActions;

    return overlay;
}

// --- Help / Shortcut Sheet ---
function createHelpSheet() {
    const sheet = el('div', {
        className: 'mc-help-sheet',
        attrs: {
            id: 'modcore-help-sheet',
            role: 'region',
            'aria-label': 'Keyboard shortcuts',
            'aria-labelledby': 'modcore-help-title',
            'aria-hidden': 'true'
        }
    });

    sheet.appendChild(el('h4', { className: 'mc-help-sheet-title', text: 'Keyboard Shortcuts', attrs: { id: 'modcore-help-title' } }));

    const shortcuts = [
        { desc: 'Open or close Discovery', keys: ['Alt', 'D'] },
        { desc: 'Close panel',              keys: ['Esc'] },
        { desc: 'Open feature 1-9',         keys: ['1-9'] },
        { desc: 'Toggle reorder mode',      keys: ['R'] },
        { desc: 'Toggle quick actions',     keys: ['Q'] },
        { desc: 'Show this help',           keys: ['?'] },
    ];

    shortcuts.forEach(({ desc, keys }) => {
        const keysEl = el('div', { className: 'mc-shortcut-keys' });
        keys.forEach((k, i) => {
            keysEl.appendChild(makeKbd(k));
            if (i < keys.length - 1) keysEl.appendChild(el('span', { className: 'mc-kbd-plus', text: '+' }));
        });
        sheet.appendChild(el('div', {
            className: 'mc-shortcut-row',
            children: [
                el('span', { className: 'mc-shortcut-desc', text: desc }),
                keysEl
            ]
        }));
    });

    const docLink = el('a', {
        className: 'mc-help-doc-link',
        text: 'Full Documentation',
        attrs: {
            href: 'https://example.com',
            target: '_blank',
            rel: 'noopener noreferrer',
            'aria-label': 'Open full documentation in new tab'
        },
        children: [
            makeImg('../../public/icons/svg/external-link.svg'),
            el('span', { text: 'Full Documentation' })
        ]
    });
    // Remove the text from the anchor itself since children handle it
    docLink.textContent = '';
    docLink.appendChild(makeImg('../../public/icons/svg/external-link.svg'));
    docLink.appendChild(el('span', { text: 'Full Documentation' }));
    sheet.appendChild(docLink);

    const closeBtn = el('button', { className: 'mc-help-close', text: 'Close' });
    closeBtn.addEventListener('click', () => {
        sheet.classList.remove('visible');
        sheet.setAttribute('aria-hidden', 'true');
        const helpBtn = document.querySelector('.mc-icon-btn[aria-controls="modcore-help-sheet"]');
        if (helpBtn) {
            helpBtn.setAttribute('aria-expanded', 'false');
            helpBtn.focus();
        }
    });
    sheet.appendChild(closeBtn);

    return sheet;
}

// --- Close Discovery ---
function closeDiscovery(overlay) {
    const trigger = document.querySelector('.mc-trigger');
    overlay.classList.remove('open');

    const fallbackTimer = setTimeout(() => {
        if (overlay.parentNode) {
            overlay.remove();
            if (trigger) {
                trigger.classList.remove('active');
                trigger.setAttribute('aria-expanded', 'false');
                trigger.focus();
            }
        }
    }, 380);

    const onEnd = () => {
        clearTimeout(fallbackTimer);
        overlay.removeEventListener('transitionend', onEnd);
        if (overlay.parentNode) overlay.remove();
        if (trigger) {
            trigger.classList.remove('active');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.focus();
        }
    };
    overlay.addEventListener('transitionend', onEnd);
}

// --- Toggle All Extensions ---
async function toggleAllExtensions(enable) {
    try {
        const extensions = await new Promise(resolve => chrome.management.getAll(resolve));
        const myId = chrome.runtime.id;
        const targets = extensions.filter(e => e.id !== myId && !e.isApp && e.enabled !== enable);
        let changed = 0;
        for (const ext of targets) {
            try {
                await new Promise(resolve => chrome.management.setEnabled(ext.id, enable, resolve));
                changed++;
            } catch { /* skip individual failures */ }
        }
        const label = enable ? 'enabled' : 'disabled';
        showToast(changed > 0 ? `${changed} extension${changed !== 1 ? 's' : ''} ${label}` : 'Nothing to change');
    } catch {
        showToast('Action failed. Check permissions.');
    }
}

// --- Main Init ---
async function initDiscovery() {
    if (document.querySelector('.mc-trigger')) return;

    injectStyles();

    const dataPromise = getDiscoveryData();

    const trigger = createTrigger();
    document.body.appendChild(trigger);

    let overlay = null;
    let isOpen = false;

    async function openDiscovery() {
        if (isOpen) return;
        isOpen = true;
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');

        trigger.classList.add('pulse');
        setTimeout(() => trigger.classList.remove('pulse'), 500);

        const data = await dataPromise;
        overlay = createDiscoveryPanel(data);
        document.body.appendChild(overlay);

        requestAnimationFrame(() => requestAnimationFrame(() => {
            overlay.classList.add('open');
            const panel = overlay.querySelector('.mc-panel');
            if (panel) panel.focus();
        }));
    }

    function doClose() {
        if (!isOpen) return;
        isOpen = false;
        if (overlay) {
            closeDiscovery(overlay);
            overlay = null;
        }
    }

    trigger.addEventListener('click', () => {
        if (isOpen) doClose();
        else openDiscovery();
    });

    document.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (isOpen) doClose(); else openDiscovery();
            return;
        }
        if (!isOpen) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            doClose();
        }
    });
}

// --- Bootstrap ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDiscovery, { once: true });
} else {
    initDiscovery();
}
