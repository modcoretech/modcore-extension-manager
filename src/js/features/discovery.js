// discovery.js
// Discovery Feature for modcore Extension Manager

'use strict';

// --- Constants ---
const DISCOVERY_STORAGE_KEY = 'discovery_data';
const GITHUB_REPO           = 'modcoretech/modcore-extension-manager';
const GITHUB_API_URL        = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const VERSION_CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24 hours

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

// --- Install Source Detection ---
function isSideloaded() {
    try {
        const info = chrome.runtime.getManifest();
        // update_url is injected by Chrome Web Store; its absence means sideloaded / unpacked
        return !info.update_url;
    } catch {
        return false;
    }
}

// --- CSS ---
const DISCOVERY_CSS = `
    .modcore-discovery-ui,
    .modcore-discovery-ui *,
    .modcore-discovery-ui button,
    .modcore-discovery-ui input {
        font-family: var(--font-sans);
        box-sizing: border-box;
    }

    /* ── Trigger Button ──────────────────────────────────────────── */
    .modcore-discovery-ui.mc-trigger {
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
    .modcore-discovery-ui.mc-trigger:hover {
        background: var(--color-surface-hover);
        box-shadow: 0 4px 14px rgba(0,0,0,0.10);
        transform: translateY(-1px) scale(1.04);
    }
    .modcore-discovery-ui.mc-trigger:active { transform: scale(0.93); }
    .modcore-discovery-ui.mc-trigger:focus-visible {
        box-shadow: 0 0 0 3px var(--color-focus-ring);
    }
    .modcore-discovery-ui.mc-trigger img {
        width: 18px;
        height: 18px;
        opacity: 0.6;
        filter: var(--filter-icon);
        transition: opacity var(--transition-fast), transform var(--duration-normal) var(--ease-bounce);
        pointer-events: none;
    }
    .modcore-discovery-ui.mc-trigger:hover img { opacity: 0.9; }
    .modcore-discovery-ui.mc-trigger.active img {
        opacity: 1;
        transform: scale(1.1);
    }
    .modcore-discovery-ui.mc-trigger.pulse {
        animation: mc-trigger-pulse var(--duration-slow) var(--ease-standard);
    }
    @keyframes mc-trigger-pulse {
        0%   { box-shadow: 0 0 0 0 var(--color-focus-ring); }
        70%  { box-shadow: 0 0 0 8px transparent; }
        100% { box-shadow: 0 0 0 0 transparent; }
    }

    /* ── Overlay ─────────────────────────────────────────────────── */
    .modcore-discovery-ui.mc-overlay {
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
    .modcore-discovery-ui.mc-overlay.open {
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        opacity: 1;
        pointer-events: auto;
    }

    /* ── Panel ───────────────────────────────────────────────────── */
    .modcore-discovery-ui .mc-panel {
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
    .modcore-discovery-ui.mc-overlay.open .mc-panel {
        transform: translateY(0) scale(1);
        opacity: 1;
    }

    /* ── Header ──────────────────────────────────────────────────── */
    .modcore-discovery-ui .mc-header {
        padding: var(--space-4) 14px var(--space-3);
        border-bottom: var(--border-width) solid var(--color-border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--color-surface);
        z-index: 10;
        gap: var(--space-2);
    }
    .modcore-discovery-ui .mc-header h3 {
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
    .modcore-discovery-ui .mc-header-actions {
        display: flex;
        gap: var(--space-1);
        flex-shrink: 0;
        align-items: center;
    }
    .modcore-discovery-ui .mc-icon-btn {
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
    .modcore-discovery-ui .mc-icon-btn:hover { background: var(--color-surface-high); }
    .modcore-discovery-ui .mc-icon-btn:active { transform: scale(0.88); }
    .modcore-discovery-ui .mc-icon-btn:focus-visible { box-shadow: 0 0 0 2px var(--color-focus-ring); }
    .modcore-discovery-ui .mc-icon-btn img {
        width: 16px;
        height: 16px;
        opacity: 0.5;
        filter: var(--filter-icon);
        transition: opacity var(--transition-fast), transform var(--duration-normal) var(--ease-standard);
        pointer-events: none;
    }
    .modcore-discovery-ui .mc-icon-btn:hover img { opacity: 0.85; }
    .modcore-discovery-ui .mc-icon-btn.reorder-active {
        background: var(--color-primary-container);
    }
    .modcore-discovery-ui .mc-icon-btn.reorder-active img {
        opacity: 1;
        filter: invert(29%) sepia(98%) saturate(1500%) hue-rotate(198deg) brightness(95%);
    }

    /* ── Update / Refresh button states ─────────────────────────── */
    .modcore-discovery-ui .mc-icon-btn.mc-update-btn img {
        transition: opacity var(--transition-fast), transform var(--duration-normal) var(--ease-standard);
    }
    .modcore-discovery-ui .mc-icon-btn.mc-update-btn.checking img {
        animation: mc-spin 1s linear infinite;
    }
    .modcore-discovery-ui .mc-icon-btn.mc-update-btn.outdated {
        background: var(--color-danger-container);
    }
    .modcore-discovery-ui .mc-icon-btn.mc-update-btn.outdated img {
        opacity: 1;
        filter: invert(28%) sepia(84%) saturate(2000%) hue-rotate(338deg) brightness(96%);
    }
    .modcore-discovery-ui .mc-icon-btn.mc-update-btn.up-to-date {
        background: var(--color-success-container);
    }
    .modcore-discovery-ui .mc-icon-btn.mc-update-btn.up-to-date img {
        opacity: 1;
        filter: invert(55%) sepia(71%) saturate(500%) hue-rotate(95deg) brightness(96%);
    }
    @keyframes mc-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
    }

    /* ── Reorder Mode Bar ────────────────────────────────────────── */
    .modcore-discovery-ui .mc-reorder-bar {
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
    .modcore-discovery-ui .mc-reorder-bar.visible {
        max-height: 38px;
        opacity: 1;
        padding: 9px var(--space-4);
    }
    .modcore-discovery-ui .mc-reorder-bar-hint { opacity: 0.9; }
    .modcore-discovery-ui .mc-reorder-done-btn {
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
    .modcore-discovery-ui .mc-reorder-done-btn:hover { background: rgba(255,255,255,0.35); }
    .modcore-discovery-ui .mc-reorder-done-btn:focus-visible { box-shadow: 0 0 0 2px rgba(255,255,255,0.6); }

    /* ── Status Banner (replaces toaster for update/reorder msgs) ── */
    .modcore-discovery-ui .mc-status-banner {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 0 var(--space-4);
        font-size: var(--text-body-sm);
        font-weight: var(--weight-medium);
        overflow: hidden;
        max-height: 0;
        opacity: 0;
        transition:
            max-height var(--duration-normal) var(--ease-standard),
            opacity var(--duration-fast) var(--ease-standard),
            padding var(--duration-normal) var(--ease-standard);
        border-bottom: var(--border-width) solid transparent;
    }
    .modcore-discovery-ui .mc-status-banner.visible {
        max-height: 42px;
        opacity: 1;
        padding: 10px var(--space-4);
    }
    .modcore-discovery-ui .mc-status-banner.info {
        background: var(--color-feedback-bg);
        border-color: var(--color-feedback-border);
        color: var(--color-feedback-text);
    }
    .modcore-discovery-ui .mc-status-banner.success {
        background: var(--color-success-container);
        border-color: rgba(var(--color-success-rgb), 0.25);
        color: var(--color-success);
    }
    .modcore-discovery-ui .mc-status-banner.danger {
        background: var(--color-danger-container);
        border-color: rgba(var(--color-danger-rgb), 0.25);
        color: var(--color-danger);
    }
    .modcore-discovery-ui .mc-status-banner-text {
        flex: 1;
        font-size: var(--text-body-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .modcore-discovery-ui .mc-status-banner-close {
        flex-shrink: 0;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        opacity: 0.55;
        line-height: 1;
        color: inherit;
        font-size: 14px;
        transition: opacity var(--transition-fast);
        outline: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: var(--radius-sm);
    }
    .modcore-discovery-ui .mc-status-banner-close:hover { opacity: 1; }
    .modcore-discovery-ui .mc-status-banner-close:focus-visible { box-shadow: 0 0 0 2px var(--color-focus-ring); }
    .modcore-discovery-ui .mc-status-banner img {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        pointer-events: none;
    }

    /* ── Confirm Dialog ──────────────────────────────────────────── */
    .modcore-discovery-ui .mc-confirm-dialog {
        position: absolute;
        inset: 0;
        background: var(--color-modal-bg);
        border-radius: var(--radius-2xl);
        z-index: 25;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--space-6);
        gap: var(--space-4);
        opacity: 0;
        pointer-events: none;
        transform: scale(0.96) translateY(6px);
        transition:
            opacity var(--duration-normal) var(--ease-standard),
            transform var(--duration-normal) var(--ease-standard);
        text-align: center;
    }
    .modcore-discovery-ui .mc-confirm-dialog.visible {
        opacity: 1;
        pointer-events: auto;
        transform: scale(1) translateY(0);
    }
    .modcore-discovery-ui .mc-confirm-icon {
        width: 44px;
        height: 44px;
        border-radius: var(--radius-xl);
        background: var(--color-info-container);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }
    .modcore-discovery-ui .mc-confirm-icon img {
        width: 22px;
        height: 22px;
        filter: invert(29%) sepia(98%) saturate(1500%) hue-rotate(198deg) brightness(95%);
        pointer-events: none;
    }
    .modcore-discovery-ui .mc-confirm-title {
        font-size: var(--text-title-lg);
        font-weight: var(--weight-semibold);
        color: var(--color-text-primary);
        margin: 0;
        letter-spacing: -0.2px;
    }
    .modcore-discovery-ui .mc-confirm-body {
        font-size: var(--text-body-md);
        color: var(--color-text-secondary);
        margin: 0;
        line-height: var(--leading-normal);
        max-width: 260px;
    }
    .modcore-discovery-ui .mc-confirm-actions {
        display: flex;
        gap: var(--space-2);
        width: 100%;
        margin-top: var(--space-1);
    }
    .modcore-discovery-ui .mc-confirm-btn {
        flex: 1;
        padding: 10px var(--space-3);
        border-radius: var(--radius-sm);
        font-size: var(--text-body-md);
        font-weight: var(--weight-semibold);
        cursor: pointer;
        transition:
            background var(--transition-fast),
            transform var(--duration-fast) var(--ease-standard);
        outline: none;
        border: var(--border-width) solid transparent;
    }
    .modcore-discovery-ui .mc-confirm-btn:active { transform: scale(0.96); }
    .modcore-discovery-ui .mc-confirm-btn:focus-visible { box-shadow: 0 0 0 2px var(--color-focus-ring); }
    .modcore-discovery-ui .mc-confirm-btn.cancel {
        background: var(--color-surface-high);
        border-color: var(--color-border);
        color: var(--color-text-secondary);
    }
    .modcore-discovery-ui .mc-confirm-btn.cancel:hover { background: var(--color-surface-highest); }
    .modcore-discovery-ui .mc-confirm-btn.confirm {
        background: var(--color-primary);
        color: var(--color-primary-on);
    }
    .modcore-discovery-ui .mc-confirm-btn.confirm:hover { background: var(--color-primary-hover); }

    /* ── Feature Grid ────────────────────────────────────────────── */
    .modcore-discovery-ui .mc-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--space-1);
        padding: 14px 12px 12px;
    }

    /* ── Feature Item ────────────────────────────────────────────── */
    .modcore-discovery-ui .mc-item {
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
    .modcore-discovery-ui .mc-item,
    .modcore-discovery-ui .mc-item:hover,
    .modcore-discovery-ui .mc-item:visited,
    .modcore-discovery-ui .mc-item:focus,
    .modcore-discovery-ui .mc-item:active {
        text-decoration: none;
    }
    @keyframes mc-item-in {
        from { opacity: 0; transform: scale(0.82) translateY(6px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    .modcore-discovery-ui .mc-item:hover {
        background: var(--color-surface-mid);
        transform: translateY(-3px) scale(1.03);
    }
    .modcore-discovery-ui .mc-item:active { transform: scale(0.94); transition-duration: var(--duration-fast); }
    .modcore-discovery-ui .mc-item:focus-visible {
        box-shadow: 0 0 0 2px var(--color-focus-ring);
        outline: none;
    }
    .modcore-discovery-ui .mc-item.reordering {
        cursor: grab;
        animation: none;
    }
    .modcore-discovery-ui .mc-item.reordering:hover { transform: translateY(-2px); }
    .modcore-discovery-ui .mc-item.reordering::after {
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
    .modcore-discovery-ui .mc-item.dragging {
        opacity: 0.3;
        transform: scale(0.94);
        cursor: grabbing;
    }
    .modcore-discovery-ui .mc-item.drag-over {
        border-color: var(--color-primary);
        background: var(--color-primary-container);
        transform: scale(1.06);
        box-shadow: 0 4px 16px rgba(var(--color-primary-rgb), 0.18);
    }
    .modcore-discovery-ui .mc-item.swap-selected {
        border-color: var(--color-warning);
        background: var(--color-warning-container);
        animation: mc-swap-pulse 0.9s var(--ease-standard) infinite;
    }
    @keyframes mc-swap-pulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(var(--color-warning-rgb), 0.3); }
        50%      { box-shadow: 0 0 0 5px transparent; }
    }

    /* ── Feature Icon ────────────────────────────────────────────── */
    .modcore-discovery-ui .mc-icon {
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
    .modcore-discovery-ui .mc-item:hover .mc-icon {
        transform: scale(1.1) rotate(3deg);
        box-shadow: 0 5px 14px rgba(0,0,0,0.09);
        background: var(--color-surface-highest);
    }
    .modcore-discovery-ui .mc-item.reordering .mc-icon { transform: none; box-shadow: none; }
    .modcore-discovery-ui .mc-icon img {
        width: 21px;
        height: 21px;
        filter: var(--filter-icon);
        transition: transform var(--duration-fast) var(--ease-standard);
        pointer-events: none;
    }

    /* ── Keyboard shortcut badge ─────────────────────────────────── */
    .modcore-discovery-ui .mc-kbd-badge {
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
    .modcore-discovery-ui .mc-shortcuts-visible .mc-kbd-badge {
        opacity: 1;
        transform: scale(1);
    }

    /* ── Feature Label ───────────────────────────────────────────── */
    .modcore-discovery-ui .mc-label {
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
    .modcore-discovery-ui .mc-item:hover .mc-label { color: var(--color-text-primary); }

    /* ── Quick Actions ───────────────────────────────────────────── */
    .modcore-discovery-ui .mc-quick-section {
        border-top: var(--border-width) solid var(--color-border);
        overflow: hidden;
    }
    .modcore-discovery-ui .mc-quick-toggle {
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
    .modcore-discovery-ui .mc-quick-toggle:hover { background: var(--color-surface-mid); }
    .modcore-discovery-ui .mc-quick-toggle:focus-visible { box-shadow: inset 0 0 0 2px var(--color-focus-ring); }
    .modcore-discovery-ui .mc-quick-toggle-label {
        font-size: var(--text-label-lg);
        color: var(--color-text-muted);
        font-weight: var(--weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.55px;
        flex: 1;
    }
    .modcore-discovery-ui .mc-quick-toggle-arrow {
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
    .modcore-discovery-ui .mc-quick-toggle:hover .mc-quick-toggle-arrow { opacity: 0.65; }
    .modcore-discovery-ui .mc-quick-toggle.expanded .mc-quick-toggle-arrow {
        transform: rotate(180deg);
    }
    .modcore-discovery-ui .mc-kbd-hint {
        font-size: var(--text-label-sm);
        color: var(--color-text-disabled);
        background: var(--color-surface-high);
        border-radius: var(--radius-sm);
        padding: 1px 5px;
        letter-spacing: 0.2px;
        flex-shrink: 0;
    }
    .modcore-discovery-ui .mc-quick-body {
        max-height: 0;
        overflow: hidden;
        transition:
            max-height var(--duration-normal) var(--ease-standard),
            padding var(--duration-normal) var(--ease-standard);
        padding: 0 12px;
    }
    .modcore-discovery-ui .mc-quick-body.expanded {
        max-height: 160px;
        padding: 0 12px 12px;
    }
    .modcore-discovery-ui .mc-quick-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 7px;
    }
    .modcore-discovery-ui .mc-quick-btn {
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
    .modcore-discovery-ui .mc-quick-btn:hover {
        background: var(--color-primary-container);
        border-color: rgba(var(--color-primary-rgb), 0.35);
        color: var(--color-primary);
        transform: translateY(-2px);
        box-shadow: 0 3px 10px rgba(var(--color-primary-rgb), 0.1);
    }
    .modcore-discovery-ui .mc-quick-btn:active { transform: scale(0.94); }
    .modcore-discovery-ui .mc-quick-btn:focus-visible { box-shadow: 0 0 0 2px var(--color-focus-ring); }
    .modcore-discovery-ui .mc-quick-btn img {
        width: 15px;
        height: 15px;
        opacity: 0.55;
        filter: var(--filter-icon);
        transition: opacity var(--transition-fast);
        pointer-events: none;
    }
    .modcore-discovery-ui .mc-quick-btn:hover img { opacity: 0.9; }

    /* ── Help / Shortcut Sheet ───────────────────────────────────── */
    .modcore-discovery-ui .mc-help-sheet {
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
    .modcore-discovery-ui .mc-help-sheet.visible {
        opacity: 1;
        pointer-events: auto;
        transform: scale(1) translateY(0);
    }
    .modcore-discovery-ui .mc-help-sheet-title {
        font-size: var(--text-title-lg);
        font-weight: var(--weight-semibold);
        color: var(--color-text-primary);
        margin: 0 0 4px;
        letter-spacing: -0.2px;
    }
    .modcore-discovery-ui .mc-shortcut-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        padding: 5px 0;
        border-bottom: var(--border-width) solid var(--color-border);
    }
    .modcore-discovery-ui .mc-shortcut-row:last-of-type { border-bottom: none; }
    .modcore-discovery-ui .mc-shortcut-desc {
        font-size: var(--text-body-md);
        color: var(--color-text-secondary);
    }
    .modcore-discovery-ui .mc-shortcut-keys {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }
    .modcore-discovery-ui .mc-kbd {
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
    .modcore-discovery-ui .mc-kbd-plus {
        color: var(--color-text-muted);
        font-size: var(--text-label-md);
        align-self: center;
    }
    .modcore-discovery-ui .mc-help-doc-link {
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
    .modcore-discovery-ui .mc-help-doc-link:hover {
        background: rgba(var(--color-primary-rgb), 0.18);
        transform: translateY(-1px);
    }
    .modcore-discovery-ui .mc-help-doc-link:focus-visible {
        box-shadow: 0 0 0 2px var(--color-focus-ring);
    }
    .modcore-discovery-ui .mc-help-close {
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
    .modcore-discovery-ui .mc-help-close:hover { background: var(--color-surface-highest); }
    .modcore-discovery-ui .mc-help-close:focus-visible { box-shadow: 0 0 0 2px var(--color-focus-ring); }

    /* ── Reduced motion ──────────────────────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
        .modcore-discovery-ui,
        .modcore-discovery-ui *,
        .modcore-discovery-ui *::before,
        .modcore-discovery-ui *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
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
                    quickActionsCollapsed: stored.quickActionsCollapsed ?? defaultDiscovery.quickActionsCollapsed,
                    // version check cache
                    versionCache: (stored.versionCache && typeof stored.versionCache === 'object') ? stored.versionCache : null
                });
            });
        } catch {
            resolve({ ...defaultDiscovery, featureOrder: [...defaultDiscovery.featureOrder], versionCache: null });
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

// --- Safe DOM Helpers ---
function el(tag, opts = {}) {
    const node = document.createElement(tag);
    if (opts.className)    node.className = opts.className;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.attrs)        Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (opts.on)           Object.entries(opts.on).forEach(([k, v]) => node.addEventListener(k, v));
    if (opts.children)     opts.children.forEach(c => c && node.appendChild(c));
    return node;
}

function makeImg(src, { cls = '', altText = '' } = {}) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = altText;
    img.setAttribute('aria-hidden', altText ? 'false' : 'true');
    img.setAttribute('loading', 'eager');
    if (cls) img.className = cls;
    return img;
}

function makeKbd(key) {
    return el('kbd', { className: 'mc-kbd', text: key });
}

// --- Version Comparison ---
// Parses "v2.4.31" or "2.4.31" → [2, 4, 31]
function parseVersion(tag) {
    const clean = String(tag).replace(/^v/, '').trim();
    const parts = clean.split('.').map(p => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
    });
    // Normalise to 3 segments
    while (parts.length < 3) parts.push(0);
    return parts;
}

// Returns -1 (a < b), 0 (equal), 1 (a > b)
function compareVersions(a, b) {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] ?? 0;
        const nb = pb[i] ?? 0;
        if (na < nb) return -1;
        if (na > nb) return  1;
    }
    return 0;
}

// --- GitHub Version Check ---
async function fetchLatestVersion() {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 8000);
    try {
        const resp = await fetch(GITHUB_API_URL, {
            method: 'GET',
            headers: { 'Accept': 'application/vnd.github+json' },
            signal: controller.signal
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        // Only trust the tag_name field; no innerHTML anywhere
        const tag = typeof json.tag_name === 'string' ? json.tag_name : null;
        if (!tag) throw new Error('No tag_name in response');
        return { tag, url: typeof json.html_url === 'string' ? json.html_url : null };
    } finally {
        clearTimeout(timeoutId);
    }
}

// Checks cache; fetches if stale. Returns { status, latestTag, url, fromCache }
// status: 'up-to-date' | 'outdated' | 'error'
async function checkVersion(data) {
    const manifest = chrome.runtime.getManifest();
    const currentVersion = manifest.version ?? '0.0.0';

    // Cache hit?
    const cache = data.versionCache;
    if (
        cache &&
        typeof cache.tag        === 'string' &&
        typeof cache.fetchedAt  === 'number' &&
        (Date.now() - cache.fetchedAt) < VERSION_CACHE_TTL_MS
    ) {
        const cmp = compareVersions(currentVersion, cache.tag);
        return {
            status: cmp >= 0 ? 'up-to-date' : 'outdated',
            latestTag: cache.tag,
            currentVersion,
            url: cache.url ?? null,
            fromCache: true
        };
    }

    // Live fetch
    try {
        const { tag, url } = await fetchLatestVersion();
        // Persist cache
        data.versionCache = { tag, url, fetchedAt: Date.now() };
        await saveDiscoveryData(data);
        const cmp = compareVersions(currentVersion, tag);
        return {
            status: cmp >= 0 ? 'up-to-date' : 'outdated',
            latestTag: tag,
            currentVersion,
            url,
            fromCache: false
        };
    } catch (err) {
        return { status: 'error', error: String(err), currentVersion, fromCache: false };
    }
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

// --- Status Banner (replaces toast notifications) ---
function createStatusBanner() {
    const iconEl   = makeImg('');
    const textEl   = el('span', { className: 'mc-status-banner-text' });
    const closeEl  = el('button', {
        className: 'mc-status-banner-close',
        attrs: { 'aria-label': 'Dismiss', type: 'button' }
    });
    // Use textContent for the × character - safe, no innerHTML
    closeEl.textContent = '×';

    const banner = el('div', {
        className: 'mc-status-banner',
        attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
        children: [iconEl, textEl, closeEl]
    });

    let hideTimer = null;

    function show({ message, variant = 'info', autoDismiss = 0, iconSrc = '' }) {
        clearTimeout(hideTimer);
        banner.className = `mc-status-banner ${variant}`;
        textEl.textContent = message;
        if (iconSrc) {
            iconEl.src = iconSrc;
            iconEl.style.display = '';
        } else {
            iconEl.style.display = 'none';
        }
        // Force reflow for transition
        void banner.offsetWidth;
        banner.classList.add('visible');
        if (autoDismiss > 0) {
            hideTimer = setTimeout(hide, autoDismiss);
        }
    }

    function hide() {
        clearTimeout(hideTimer);
        banner.classList.remove('visible');
    }

    closeEl.addEventListener('click', hide);

    return { banner, show, hide };
}

// --- Confirm Dialog ---
function createConfirmDialog({ title, body, confirmLabel = 'Continue', cancelLabel = 'Cancel', iconSrc = '', onConfirm, onCancel }) {
    const iconWrapper = el('div', { className: 'mc-confirm-icon' });
    if (iconSrc) iconWrapper.appendChild(makeImg(iconSrc));

    const titleEl   = el('p', { className: 'mc-confirm-title', text: title });
    const bodyEl    = el('p', { className: 'mc-confirm-body',  text: body  });

    const cancelBtn  = el('button', { className: 'mc-confirm-btn cancel',  text: cancelLabel,  attrs: { type: 'button' } });
    const confirmBtn = el('button', { className: 'mc-confirm-btn confirm', text: confirmLabel, attrs: { type: 'button' } });

    const dialog = el('div', {
        className: 'mc-confirm-dialog',
        attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'mc-confirm-title' },
        children: [
            iconWrapper,
            titleEl,
            bodyEl,
            el('div', { className: 'mc-confirm-actions', children: [cancelBtn, confirmBtn] })
        ]
    });

    titleEl.id = 'mc-confirm-title';

    function show() {
        dialog.classList.add('visible');
        confirmBtn.focus();
    }
    function hide() {
        dialog.classList.remove('visible');
    }

    cancelBtn.addEventListener('click',  () => { hide(); onCancel?.(); });
    confirmBtn.addEventListener('click', () => { hide(); onConfirm?.(); });

    dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); hide(); onCancel?.(); }
    });

    return { dialog, show, hide };
}

// --- Discovery Panel ---
function createDiscoveryPanel(data, { sideloaded } = {}) {
    let isReordering  = false;
    let draggedItem   = null;
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

    // ── Refresh / Update button (sideloaded only) ──────────────────
    let updateBtn = null;
    if (sideloaded) {
        updateBtn = el('button', {
            className: 'mc-icon-btn mc-update-btn',
            attrs: {
                'aria-label': 'Check for updates',
                'title': 'Check for updates',
                type: 'button'
            },
            children: [makeImg('../../public/icons/svg/refresh.svg')]
        });
    }

    // ── Reorder button ─────────────────────────────────────────────
    const reorderBtn = el('button', {
        className: 'mc-icon-btn',
        attrs: {
            'aria-label': 'Reorder features (R)',
            'title': 'Reorder (R)',
            'aria-pressed': 'false',
            type: 'button'
        },
        children: [makeImg('../../public/icons/svg/move.svg')]
    });

    // ── Help button ────────────────────────────────────────────────
    const helpBtn = el('button', {
        className: 'mc-icon-btn',
        attrs: {
            'aria-label': 'Keyboard shortcuts (?)',
            'title': 'Shortcuts (?)',
            'aria-expanded': 'false',
            'aria-controls': 'modcore-help-sheet',
            type: 'button'
        },
        children: [makeImg('../../public/icons/svg/help.svg')]
    });

    // ── Header actions: [update?] [reorder] [help]  (no close btn) ─
    const headerActionChildren = [];
    if (updateBtn) headerActionChildren.push(updateBtn);
    headerActionChildren.push(reorderBtn, helpBtn);

    const header = el('div', {
        className: 'mc-header',
        children: [
            title,
            el('div', { className: 'mc-header-actions', children: headerActionChildren })
        ]
    });
    panel.appendChild(header);

    // ── Status Banner ──────────────────────────────────────────────
    const { banner: statusBanner, show: showBanner, hide: hideBanner } = createStatusBanner();
    panel.appendChild(statusBanner);

    // ── Reorder Mode Bar ───────────────────────────────────────────
    const reorderBar = el('div', {
        className: 'mc-reorder-bar',
        attrs: { 'aria-live': 'polite' },
        children: [
            el('span', { className: 'mc-reorder-bar-hint', text: 'Drag to reorder or tap two items to swap' }),
            el('button', { className: 'mc-reorder-done-btn', text: 'Done', attrs: { type: 'button' } })
        ]
    });
    const reorderDoneBtn = reorderBar.querySelector('.mc-reorder-done-btn');
    panel.appendChild(reorderBar);

    // ── Feature Grid ───────────────────────────────────────────────
    const grid = el('div', { className: 'mc-grid', attrs: { 'aria-label': 'Features' } });
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
                    // Use a neutral token - avoids leaking feature ids via dataTransfer in untrusted contexts
                    e.dataTransfer.setData('text/plain', 'mc-drag');
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
                    // Read feature id from DOM attribute, not from dataTransfer
                    const fromId = draggedItem.getAttribute('data-feature-id');
                    const toId   = featureId;
                    const fi = data.featureOrder.indexOf(fromId);
                    const ti = data.featureOrder.indexOf(toId);
                    if (fi > -1 && ti > -1) {
                        data.featureOrder.splice(fi, 1);
                        data.featureOrder.splice(ti, 0, fromId);
                        saveDiscoveryData(data);
                        renderFeatures();
                        showBanner({ message: 'Order saved', variant: 'success', autoDismiss: 2500 });
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
                        openFeature(feat.url);
                    }
                });
            }

            grid.appendChild(item);
        });

        panel._shortcutMap = {};
        data.featureOrder.forEach((featureId, idx) => {
            if (idx < 9) panel._shortcutMap[String(idx + 1)] = featureId;
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
            showBanner({ message: 'Select another feature to swap', variant: 'info' });
        } else if (swapCandidate.el === item) {
            item.classList.remove('swap-selected');
            swapCandidate = null;
            hideBanner();
        } else {
            const fi = data.featureOrder.indexOf(swapCandidate.id);
            const ti = data.featureOrder.indexOf(featureId);
            if (fi > -1 && ti > -1) {
                [data.featureOrder[fi], data.featureOrder[ti]] = [data.featureOrder[ti], data.featureOrder[fi]];
                saveDiscoveryData(data);
                swapCandidate = null;
                renderFeatures();
                showBanner({ message: 'Order saved', variant: 'success', autoDismiss: 2500 });
            }
        }
    }

    renderFeatures();

    // ── Quick Actions ──────────────────────────────────────────────
    const quickToggleArrow = makeImg('../../public/icons/svg/arrow-down.svg');
    quickToggleArrow.className = 'mc-quick-toggle-arrow';

    const quickToggle = el('button', {
        className: 'mc-quick-toggle' + (data.quickActionsCollapsed ? '' : ' expanded'),
        attrs: {
            'aria-expanded': data.quickActionsCollapsed ? 'false' : 'true',
            'aria-controls': 'mc-quick-body',
            'aria-label': 'Toggle Quick Actions (Q)',
            type: 'button'
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
        { text: 'Enable All',  icon: '../../public/icons/svg/check.svg', label: 'Enable all extensions except modcore',  action: () => toggleAllExtensions(true,  showBanner) },
        { text: 'Disable All', icon: '../../public/icons/svg/close.svg', label: 'Disable all extensions except modcore', action: () => toggleAllExtensions(false, showBanner) }
    ];

    quickActions.forEach(({ text, icon, label, action }) => {
        const btn = el('button', {
            className: 'mc-quick-btn modcore-discovery-ui',
            attrs: { 'aria-label': label, type: 'button' },
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

    // ── Help Sheet ─────────────────────────────────────────────────
    const helpSheet = createHelpSheet();
    panel.appendChild(helpSheet);

    // ── Confirm Dialog for update check ───────────────────────────
    let confirmDialogInstance = null;
    if (updateBtn) {
        confirmDialogInstance = createConfirmDialog({
            title: 'Internet Connection Required',
            body: 'Checking for updates requires a connection to the GitHub API. Continue?',
            confirmLabel: 'Check now',
            cancelLabel: 'Cancel',
            iconSrc: '../../public/icons/svg/refresh.svg',
            onConfirm: () => runVersionCheck(),
            onCancel: () => {}
        });
        panel.appendChild(confirmDialogInstance.dialog);

        updateBtn.addEventListener('click', () => {
            // If already showing result, re-trigger
            confirmDialogInstance.show();
        });
    }

    // ── Version check logic ────────────────────────────────────────
    async function runVersionCheck() {
        if (!updateBtn) return;

        updateBtn.disabled = true;
        updateBtn.classList.remove('outdated', 'up-to-date');
        updateBtn.classList.add('checking');
        updateBtn.setAttribute('aria-label', 'Checking for updates…');
        updateBtn.setAttribute('title',      'Checking for updates…');

        showBanner({ message: 'Checking for updates…', variant: 'info' });

        const result = await checkVersion(data);

        updateBtn.classList.remove('checking');
        updateBtn.disabled = false;

        if (result.status === 'up-to-date') {
            updateBtn.classList.add('up-to-date');
            updateBtn.setAttribute('aria-label', `Up to date (${result.currentVersion})`);
            updateBtn.setAttribute('title',      `Up to date - v${result.currentVersion}`);
            showBanner({
                message: `Up to date - v${result.currentVersion}`,
                variant: 'success',
                autoDismiss: 4000
            });
        } else if (result.status === 'outdated') {
            updateBtn.classList.add('outdated');
            updateBtn.setAttribute('aria-label', `Update available: ${result.latestTag}`);
            updateBtn.setAttribute('title',      `Update available - ${result.latestTag}`);
            showBanner({
                message: `Update available: ${result.latestTag} (installed: v${result.currentVersion})`,
                variant: 'danger'
                // no autoDismiss - keep visible until user dismisses
            });
        } else {
            updateBtn.setAttribute('aria-label', 'Check for updates (last check failed)');
            updateBtn.setAttribute('title',      'Check failed - click to retry');
            showBanner({
                message: 'Could not reach GitHub. Check your connection and try again.',
                variant: 'info',
                autoDismiss: 5000
            });
        }
    }

    // ── Reorder logic ──────────────────────────────────────────────
    function setReordering(val) {
        isReordering  = val;
        swapCandidate = null;
        reorderBtn.classList.toggle('reorder-active', isReordering);
        reorderBtn.setAttribute('aria-pressed', isReordering ? 'true' : 'false');
        reorderBar.classList.toggle('visible', isReordering);
        reorderBtn.setAttribute('title',      isReordering ? 'Done reordering (R)' : 'Reorder features (R)');
        reorderBtn.setAttribute('aria-label', isReordering ? 'Done reordering (R)' : 'Reorder features (R)');
        if (isReordering) {
            showBanner({ message: 'Drag to reorder, or tap two items to swap', variant: 'info' });
        } else {
            hideBanner();
        }
        renderFeatures();
    }

    reorderBtn.addEventListener('click',  () => setReordering(!isReordering));
    reorderDoneBtn.addEventListener('click', () => setReordering(false));

    helpBtn.addEventListener('click', () => {
        const nowVisible = helpSheet.classList.toggle('visible');
        helpBtn.setAttribute('aria-expanded', nowVisible ? 'true' : 'false');
        helpSheet.setAttribute('aria-hidden', nowVisible ? 'false' : 'true');
        if (nowVisible) helpSheet.querySelector('.mc-help-close')?.focus();
    });

    // ── Keyboard handling ──────────────────────────────────────────
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

    overlay._setReordering    = setReordering;
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

    sheet.appendChild(el('h4', {
        className: 'mc-help-sheet-title',
        text: 'Keyboard Shortcuts',
        attrs: { id: 'modcore-help-title' }
    }));

    const shortcuts = [
        { desc: 'Open or close Discovery', keys: ['Alt', 'D'] },
        { desc: 'Close panel',             keys: ['Esc'] },
        { desc: 'Open feature 1-9',        keys: ['1-9'] },
        { desc: 'Toggle reorder mode',     keys: ['R'] },
        { desc: 'Toggle quick actions',    keys: ['Q'] },
        { desc: 'Show this help',          keys: ['?'] },
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
        attrs: {
            href: 'https://sites.google.com/view/modcore-em-help/general-information/additional-features/discovery',
            target: '_blank',
            rel: 'noopener noreferrer',
            'aria-label': 'Open full documentation in new tab'
        },
        children: [el('span', { text: 'Full Documentation' })]
    });
    sheet.appendChild(docLink);

    const closeBtn = el('button', {
        className: 'mc-help-close',
        text: 'Close',
        attrs: { type: 'button' }
    });
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
async function toggleAllExtensions(enable, showBanner) {
    try {
        const extensions = await new Promise(resolve => chrome.management.getAll(resolve));
        const myId   = chrome.runtime.id;
        const targets = extensions.filter(e => e.id !== myId && !e.isApp && e.enabled !== enable);
        let changed = 0;
        for (const ext of targets) {
            try {
                await new Promise(resolve => chrome.management.setEnabled(ext.id, enable, resolve));
                changed++;
            } catch { /* skip individual failures */ }
        }
        const label = enable ? 'enabled' : 'disabled';
        const msg   = changed > 0
            ? `${changed} extension${changed !== 1 ? 's' : ''} ${label}`
            : 'Nothing to change';
        showBanner({ message: msg, variant: changed > 0 ? 'success' : 'info', autoDismiss: 3000 });
    } catch {
        showBanner({ message: 'Action failed. Check permissions.', variant: 'danger', autoDismiss: 4000 });
    }
}

// --- Main Init ---
async function initDiscovery() {
    if (document.querySelector('.mc-trigger')) return;

    injectStyles();

    const sideloaded  = isSideloaded();
    const dataPromise = getDiscoveryData();

    const trigger = createTrigger();
    document.body.appendChild(trigger);

    let overlay = null;
    let isOpen  = false;

    async function openDiscovery() {
        if (isOpen) return;
        isOpen = true;
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');

        trigger.classList.add('pulse');
        setTimeout(() => trigger.classList.remove('pulse'), 500);

        const data = await dataPromise;
        overlay = createDiscoveryPanel(data, { sideloaded });
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