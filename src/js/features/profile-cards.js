// discovery.js
// Discovery Feature for modcore Extension Manager


'use strict';

// ─── Storage Keys & Defaults ────────────────────────────────────────────────
const DISCOVERY_STORAGE_KEY = 'modcore_discovery_v3';

const defaultDiscovery = {
    featureOrder: ['inspect', 'safety', 'snapshot', 'timeline', 'automations', 'cloud', 'notes'],
    quickActionsCollapsed: true
};

// ─── Feature Definitions ─────────────────────────────────────────────────────
const FEATURES = {
    inspect:     { id: 'inspect',     name: 'Inspect',     fullName: 'modcore Inspect',       description: 'Identify extension conflicts and security issues', url: 'src/html/inspect.html',       icon: '../../public/icons/svg/search.svg',   shortcut: '1' },
    safety:      { id: 'safety',      name: 'Safety',      fullName: 'Safety Center',         description: 'Security dashboard for installed extensions',      url: 'src/html/safety-center.html', icon: '../../public/icons/svg/shield.svg',   shortcut: '2' },
    snapshot:    { id: 'snapshot',    name: 'Snapshot',    fullName: 'modcore Snapshot',      description: 'Save, manage, and restore extension data',         url: 'src/html/snapshot.html',      icon: '../../public/icons/svg/host.svg',     shortcut: '3' },
    timeline:    { id: 'timeline',    name: 'Timeline',    fullName: 'modcore Timeline',      description: 'Track extension activity and changes over time',   url: 'src/html/timeline.html',      icon: '../../public/icons/svg/clock.svg',    shortcut: '4' },
    automations: { id: 'automations', name: 'Automations', fullName: 'modcore Automations',   description: 'Create rules to automate extension management',    url: 'src/html/automations.html',   icon: '../../public/icons/svg/rules.svg',    shortcut: '5' },
    cloud:       { id: 'cloud',       name: 'Cloud',       fullName: 'modcore Cloud',         description: 'Sync and backup your data securely',               url: 'src/html/cloud.html',         icon: '../../public/icons/svg/cloud.svg',    shortcut: '6' },
    notes:       { id: 'notes',       name: 'Notes',       fullName: 'Extension Notes',       description: 'Keep notes and organize your extensions',          url: 'src/html/notes.html',         icon: '../../public/icons/svg/edit.svg',     shortcut: '7' }
};

// ─── Keyboard Shortcut Map ────────────────────────────────────────────────────
// Alt+D = toggle Discovery | Escape = close | 1-7 = open feature | R = reorder | Q = quick actions | ? = help
const KB = {
    TOGGLE:  { key: 'd',   alt: true,  label: 'Alt+D' },
    ESCAPE:  { key: 'Escape' },
    REORDER: { key: 'r',   label: 'R' },
    HELP:    { key: '?',   label: '?' },
    QUICK:   { key: 'q',   label: 'Q' }
};

// ─── CSS ──────────────────────────────────────────────────────────────────────
const DISCOVERY_CSS = `
    .modcore-discovery-ui,
    .modcore-discovery-ui *,
    .modcore-discovery-ui button,
    .modcore-discovery-ui input {
        font-family: 'modcore-inter-font-custom', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        box-sizing: border-box;
    }

    /* ── Trigger Button ── */
    .mc-trigger {
        position: fixed;
        top: 14px;
        right: 14px;
        z-index: 10000;
        width: 34px;
        height: 34px;
        border-radius: 10px;
        background: rgba(255,255,255,0.92);
        border: 1px solid rgba(0,0,0,0.08);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 4px rgba(0,0,0,0.07), 0 0 0 0 rgba(0,123,255,0);
        transition: background 0.2s ease, box-shadow 0.25s ease, transform 0.18s cubic-bezier(0.34,1.56,0.64,1);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        outline: none;
    }
    .mc-trigger:hover {
        background: #fff;
        box-shadow: 0 4px 14px rgba(0,0,0,0.12);
        transform: translateY(-1px);
    }
    .mc-trigger:active  { transform: scale(0.93); }
    .mc-trigger:focus-visible {
        box-shadow: 0 0 0 3px rgba(0,123,255,0.35);
    }
    .mc-trigger img {
        width: 18px;
        height: 18px;
        opacity: 0.6;
        transition: opacity 0.2s ease, transform 0.35s cubic-bezier(0.34,1.56,0.64,1);
        pointer-events: none;
    }
    .mc-trigger:hover img { opacity: 0.9; }
    .mc-trigger.active img {
        opacity: 1;
        transform: rotate(45deg) scale(1.1);
    }
    .mc-trigger.pulse {
        animation: mc-trigger-pulse 0.45s ease;
    }
    @keyframes mc-trigger-pulse {
        0%   { box-shadow: 0 0 0 0 rgba(0,123,255,0.4); }
        70%  { box-shadow: 0 0 0 8px rgba(0,123,255,0); }
        100% { box-shadow: 0 0 0 0 rgba(0,123,255,0); }
    }

    /* ── Overlay ── */
    .mc-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0);
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
        transition: background 0.28s ease, backdrop-filter 0.28s ease, opacity 0.28s ease;
    }
    .mc-overlay.open {
        background: rgba(0,0,0,0.3);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        opacity: 1;
        pointer-events: auto;
    }

    /* ── Panel ── */
    .mc-panel {
        background: #fff;
        border-radius: 18px;
        box-shadow: 0 24px 64px rgba(0,0,0,0.22), 0 6px 20px rgba(0,0,0,0.12);
        width: 344px;
        max-height: calc(100vh - 80px);
        overflow-y: auto;
        overflow-x: hidden;
        transform: translateY(-12px) scale(0.97);
        opacity: 0;
        will-change: transform, opacity;
        transition: transform 0.38s cubic-bezier(0.16,1,0.3,1), opacity 0.28s ease;
        scrollbar-width: thin;
        scrollbar-color: rgba(0,0,0,0.18) transparent;
        outline: none;
        contain: layout style;
    }
    .mc-panel::-webkit-scrollbar       { width: 5px; }
    .mc-panel::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.13); border-radius: 3px; }
    .mc-overlay.open .mc-panel {
        transform: translateY(0) scale(1);
        opacity: 1;
    }

    /* ── Header ── */
    .mc-header {
        padding: 16px 14px 12px;
        border-bottom: 1px solid #f0f0f0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: sticky;
        top: 0;
        background: rgba(255,255,255,0.96);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 10;
        gap: 8px;
    }
    .mc-header h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 650;
        color: #111;
        letter-spacing: -0.3px;
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .mc-header-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
    }
    .mc-icon-btn {
        width: 30px;
        height: 30px;
        border-radius: 8px;
        border: none;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s ease, transform 0.15s ease;
        position: relative;
        outline: none;
        flex-shrink: 0;
    }
    .mc-icon-btn:hover { background: #f3f4f6; }
    .mc-icon-btn:active { transform: scale(0.9); }
    .mc-icon-btn:focus-visible { box-shadow: 0 0 0 2px rgba(0,123,255,0.4); border-radius: 8px; }
    .mc-icon-btn img {
        width: 16px;
        height: 16px;
        opacity: 0.5;
        transition: opacity 0.15s ease, transform 0.2s ease;
        pointer-events: none;
    }
    .mc-icon-btn:hover img { opacity: 0.85; }
    .mc-icon-btn.reorder-active {
        background: rgba(0,123,255,0.1);
    }
    .mc-icon-btn.reorder-active img {
        opacity: 1;
        filter: invert(29%) sepia(98%) saturate(1500%) hue-rotate(198deg) brightness(95%);
    }

    /* ── Reorder Mode Bar ── */
    .mc-reorder-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 0 16px;
        background: linear-gradient(90deg, #0066ff, #0047b3);
        color: #fff;
        font-size: 11.5px;
        font-weight: 500;
        overflow: hidden;
        max-height: 0;
        opacity: 0;
        transition: max-height 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease, padding 0.3s ease;
    }
    .mc-reorder-bar.visible {
        max-height: 38px;
        opacity: 1;
        padding: 9px 16px;
    }
    .mc-reorder-bar-hint { opacity: 0.9; }
    .mc-reorder-done-btn {
        background: rgba(255,255,255,0.22);
        border: none;
        color: #fff;
        padding: 3px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
        white-space: nowrap;
        outline: none;
        flex-shrink: 0;
    }
    .mc-reorder-done-btn:hover { background: rgba(255,255,255,0.35); }
    .mc-reorder-done-btn:focus-visible { box-shadow: 0 0 0 2px rgba(255,255,255,0.6); }

    /* ── Feature Grid ── */
    .mc-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        padding: 14px 12px 12px;
    }

    /* ── Feature Item ── */
    .mc-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        padding: 10px 4px 8px;
        border-radius: 13px;
        cursor: pointer;
        transition: background 0.18s ease, transform 0.22s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease;
        text-decoration: none;
        border: 2px solid transparent;
        background: transparent;
        position: relative;
        user-select: none;
        -webkit-user-select: none;
        outline: none;
        animation: mc-item-in 0.3s cubic-bezier(0.16,1,0.3,1) both;
    }
    @keyframes mc-item-in {
        from { opacity: 0; transform: scale(0.85) translateY(4px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    .mc-item:hover {
        background: #f4f5f7;
        transform: translateY(-3px) scale(1.02);
    }
    .mc-item:active { transform: scale(0.94); }
    .mc-item:focus-visible {
        box-shadow: 0 0 0 2px rgba(0,123,255,0.5);
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
        border-radius: 11px;
        border: 1.5px dashed rgba(0,102,255,0.25);
        pointer-events: none;
        animation: mc-reorder-border 1.8s ease infinite;
    }
    @keyframes mc-reorder-border {
        0%,100% { border-color: rgba(0,102,255,0.18); }
        50%      { border-color: rgba(0,102,255,0.45); }
    }
    .mc-item.dragging {
        opacity: 0.35;
        transform: scale(0.95);
        cursor: grabbing;
    }
    .mc-item.drag-over {
        border-color: #0066ff;
        background: rgba(0,102,255,0.07);
        transform: scale(1.05);
        box-shadow: 0 4px 16px rgba(0,102,255,0.15);
    }
    /* Click-to-swap: first selected */
    .mc-item.swap-selected {
        border-color: #f59e0b;
        background: rgba(245,158,11,0.08);
        animation: mc-swap-pulse 0.9s ease infinite;
    }
    @keyframes mc-swap-pulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.3); }
        50%      { box-shadow: 0 0 0 5px rgba(245,158,11,0); }
    }

    /* ── Feature Icon ── */
    .mc-icon {
        width: 46px;
        height: 46px;
        border-radius: 13px;
        background: linear-gradient(145deg, #f5f6f8 0%, #eaecef 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.22s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease;
        position: relative;
        overflow: hidden;
        flex-shrink: 0;
    }
    .mc-icon::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(145deg, rgba(255,255,255,0.55) 0%, transparent 60%);
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
    }
    .mc-item:hover .mc-icon {
        transform: scale(1.1) rotate(3deg);
        box-shadow: 0 5px 14px rgba(0,0,0,0.1);
    }
    .mc-item:hover .mc-icon::after { opacity: 1; }
    .mc-item.reordering .mc-icon { transform: none; box-shadow: none; }
    .mc-icon img {
        width: 21px;
        height: 21px;
        transition: transform 0.2s ease;
        pointer-events: none;
    }

    /* Keyboard shortcut badge */
    .mc-kbd-badge {
        position: absolute;
        top: 3px;
        right: 3px;
        background: rgba(0,0,0,0.55);
        color: #fff;
        font-size: 8.5px;
        font-weight: 700;
        border-radius: 4px;
        padding: 1px 4px;
        line-height: 1.4;
        opacity: 0;
        transform: scale(0.8);
        transition: opacity 0.15s ease, transform 0.15s ease;
        pointer-events: none;
        letter-spacing: 0.3px;
    }
    .mc-shortcuts-visible .mc-kbd-badge {
        opacity: 1;
        transform: scale(1);
    }

    /* ── Feature Label ── */
    .mc-label {
        font-size: 10.5px;
        font-weight: 510;
        color: #555;
        text-align: center;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        transition: color 0.15s ease;
        pointer-events: none;
    }
    .mc-item:hover .mc-label { color: #111; }

    /* ── Quick Actions (collapsible, secondary) ── */
    .mc-quick-section {
        border-top: 1px solid #f0f0f0;
        overflow: hidden;
    }
    .mc-quick-toggle {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 9px 16px;
        background: transparent;
        border: none;
        cursor: pointer;
        text-align: left;
        transition: background 0.15s ease;
        outline: none;
    }
    .mc-quick-toggle:hover { background: #fafafa; }
    .mc-quick-toggle:focus-visible { box-shadow: inset 0 0 0 2px rgba(0,123,255,0.3); }
    .mc-quick-toggle-label {
        font-size: 10.5px;
        color: #999;
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0.55px;
        flex: 1;
    }
    .mc-quick-toggle-arrow {
        width: 14px;
        height: 14px;
        opacity: 0.35;
        transition: transform 0.25s cubic-bezier(0.4,0,0.2,1), opacity 0.15s ease;
        pointer-events: none;
    }
    .mc-quick-toggle:hover .mc-quick-toggle-arrow { opacity: 0.6; }
    .mc-quick-toggle.expanded .mc-quick-toggle-arrow {
        transform: rotate(180deg);
    }
    .mc-kbd-hint {
        font-size: 9.5px;
        color: #bbb;
        background: #f0f0f0;
        border-radius: 4px;
        padding: 1px 5px;
        letter-spacing: 0.2px;
    }
    .mc-quick-body {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.3s cubic-bezier(0.4,0,0.2,1), padding 0.3s ease;
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
        padding: 10px 6px;
        border-radius: 10px;
        border: 1px solid #e8e9eb;
        background: #fafafa;
        cursor: pointer;
        font-size: 11px;
        font-weight: 500;
        color: #555;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.18s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.15s ease;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        outline: none;
    }
    .mc-quick-btn:hover {
        background: #f0f4ff;
        border-color: rgba(0,102,255,0.35);
        color: #0055cc;
        transform: translateY(-2px);
        box-shadow: 0 3px 10px rgba(0,102,255,0.1);
    }
    .mc-quick-btn:active { transform: scale(0.94); }
    .mc-quick-btn:focus-visible { box-shadow: 0 0 0 2px rgba(0,123,255,0.4); }
    .mc-quick-btn img {
        width: 15px;
        height: 15px;
        opacity: 0.55;
        transition: opacity 0.15s ease;
        pointer-events: none;
    }
    .mc-quick-btn:hover img { opacity: 0.9; }

    /* ── Toast ── */
    .mc-toast {
        position: fixed;
        bottom: 22px;
        left: 50%;
        transform: translateX(-50%) translateY(16px);
        background: #1a1a1e;
        color: #f5f5f5;
        padding: 10px 18px;
        border-radius: 12px;
        font-size: 12.5px;
        font-weight: 500;
        z-index: 10005;
        opacity: 0;
        visibility: hidden;
        transition: all 0.32s cubic-bezier(0.16,1,0.3,1);
        box-shadow: 0 5px 22px rgba(0,0,0,0.22);
        white-space: nowrap;
        pointer-events: none;
        max-width: calc(100vw - 40px);
    }
    .mc-toast.show {
        opacity: 1;
        visibility: visible;
        transform: translateX(-50%) translateY(0);
    }

    /* ── Shortcut Help Sheet ── */
    .mc-help-sheet {
        position: absolute;
        inset: 0;
        background: rgba(255,255,255,0.98);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        border-radius: 18px;
        z-index: 20;
        display: flex;
        flex-direction: column;
        padding: 20px;
        gap: 10px;
        opacity: 0;
        pointer-events: none;
        transform: scale(0.97);
        transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.16,1,0.3,1);
    }
    .mc-help-sheet.visible {
        opacity: 1;
        pointer-events: auto;
        transform: scale(1);
    }
    .mc-help-sheet-title {
        font-size: 14px;
        font-weight: 650;
        color: #111;
        margin: 0 0 4px;
        letter-spacing: -0.2px;
    }
    .mc-shortcut-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 5px 0;
        border-bottom: 1px solid #f2f2f2;
    }
    .mc-shortcut-row:last-child { border-bottom: none; }
    .mc-shortcut-desc {
        font-size: 12px;
        color: #444;
    }
    .mc-shortcut-keys {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
    }
    .mc-kbd {
        background: #f0f1f3;
        border: 1px solid #d0d2d6;
        border-bottom-width: 2px;
        border-radius: 5px;
        padding: 2px 7px;
        font-size: 11px;
        font-weight: 600;
        color: #333;
        line-height: 1.5;
        font-family: inherit;
        white-space: nowrap;
    }
    .mc-help-close {
        margin-top: auto;
        width: 100%;
        padding: 9px;
        border: none;
        border-radius: 10px;
        background: #f0f1f3;
        cursor: pointer;
        font-size: 12.5px;
        font-weight: 600;
        color: #444;
        transition: background 0.15s ease;
        outline: none;
    }
    .mc-help-close:hover { background: #e5e6e8; }

    /* ── Dark Mode ── */
    @media (prefers-color-scheme: dark) {
        .mc-trigger {
            background: rgba(36,36,42,0.92);
            border-color: rgba(255,255,255,0.09);
        }
        .mc-trigger:hover {
            background: rgba(46,46,54,0.96);
        }
        .mc-trigger img { filter: invert(1); opacity: 0.65; }
        .mc-trigger.active img { opacity: 1; }

        .mc-panel {
            background: #111115;
            box-shadow: 0 24px 64px rgba(0,0,0,0.55), 0 6px 20px rgba(0,0,0,0.3);
        }
        .mc-header {
            background: rgba(17,17,21,0.96);
            border-bottom-color: #222228;
        }
        .mc-header h3 { color: #efefef; }
        .mc-icon-btn:hover { background: #222228; }
        .mc-icon-btn img { filter: invert(1); opacity: 0.45; }
        .mc-icon-btn:hover img { opacity: 0.85; }
        .mc-icon-btn.reorder-active { background: rgba(0,100,255,0.18); }
        .mc-icon-btn.reorder-active img {
            filter: invert(47%) sepia(89%) saturate(1100%) hue-rotate(197deg) brightness(110%);
            opacity: 1;
        }

        .mc-item:hover { background: #1c1c24; }
        .mc-item.drag-over { background: rgba(0,102,255,0.12); }
        .mc-label { color: #999; }
        .mc-item:hover .mc-label { color: #eee; }
        .mc-icon { background: linear-gradient(145deg, #1e1e28 0%, #282834 100%); }
        .mc-icon img { filter: invert(1); opacity: 0.85; }
        .mc-kbd-badge { background: rgba(255,255,255,0.18); }

        .mc-quick-section { border-top-color: #222228; }
        .mc-quick-toggle:hover { background: #17171d; }
        .mc-quick-toggle-label { color: #555; }
        .mc-kbd-hint { background: #222228; color: #666; }
        .mc-quick-btn { background: #17171d; border-color: #252530; color: #aaa; }
        .mc-quick-btn:hover { background: #1e2040; border-color: rgba(0,102,255,0.4); color: #6699ff; }
        .mc-quick-btn img { filter: invert(1); opacity: 0.55; }
        .mc-quick-btn:hover img { opacity: 0.9; }

        .mc-toast { background: #28282f; color: #eee; }

        .mc-help-sheet { background: rgba(17,17,21,0.98); }
        .mc-help-sheet-title { color: #eee; }
        .mc-shortcut-desc { color: #aaa; }
        .mc-shortcut-row { border-bottom-color: #222228; }
        .mc-kbd { background: #222228; border-color: #333; border-bottom-color: #444; color: #ccc; }
        .mc-help-close { background: #222228; color: #aaa; }
        .mc-help-close:hover { background: #2c2c34; }
    }
`;

// ─── Style Injection ──────────────────────────────────────────────────────────
function injectStyles() {
    if (document.getElementById('modcore-discovery-styles')) return;
    const style = document.createElement('style');
    style.id = 'modcore-discovery-styles';
    style.textContent = DISCOVERY_CSS;
    document.head.appendChild(style);
}

// ─── Storage ──────────────────────────────────────────────────────────────────
function getDiscoveryData() {
    return new Promise(resolve => {
        try {
            chrome.storage.local.get([DISCOVERY_STORAGE_KEY], result => {
                const stored = result[DISCOVERY_STORAGE_KEY] || {};
                resolve({
                    featureOrder: stored.featureOrder || [...defaultDiscovery.featureOrder],
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

// ─── Toast ────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(message) {
    let toast = document.querySelector('.mc-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'mc-toast modcore-discovery-ui';
        document.body.appendChild(toast);
    }
    clearTimeout(_toastTimer);
    toast.textContent = message;
    toast.classList.remove('show');
    // Force reflow for re-animation
    void toast.offsetWidth;
    toast.classList.add('show');
    _toastTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

// ─── Safe DOM Helpers ─────────────────────────────────────────────────────────
function el(tag, opts = {}) {
    const node = document.createElement(tag);
    if (opts.className)   node.className = opts.className;
    if (opts.text)        node.textContent = opts.text;
    if (opts.attrs)       Object.entries(opts.attrs).forEach(([k,v]) => node.setAttribute(k, v));
    if (opts.on)          Object.entries(opts.on).forEach(([k,v]) => node.addEventListener(k, v));
    if (opts.children)    opts.children.forEach(c => c && node.appendChild(c));
    return node;
}

function makeImg(src, alt = '') {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    return img;
}

function makeKbd(key) {
    return el('kbd', { className: 'mc-kbd', text: key });
}

// ─── Trigger Button ───────────────────────────────────────────────────────────
function createTrigger() {
    const btn = el('button', {
        className: 'mc-trigger modcore-discovery-ui',
        attrs: {
            'aria-label': 'Open Discovery (Alt+D)',
            'aria-haspopup': 'true',
            'aria-expanded': 'false',
            'title': 'Discovery  Alt+D'
        },
        children: [makeImg('../../public/icons/svg/grid.svg')]
    });
    return btn;
}

// ─── Feature Item ─────────────────────────────────────────────────────────────
function createFeatureItem(featureId, { isReordering = false, showShortcuts = false, animIndex = 0 } = {}) {
    const feature = FEATURES[featureId];
    if (!feature) return null;

    const iconWrapper = el('div', { className: 'mc-icon', children: [makeImg(feature.icon)] });

    const badge = el('div', { className: 'mc-kbd-badge', text: feature.shortcut });
    iconWrapper.appendChild(badge);

    const label = el('span', { className: 'mc-label', text: feature.name });

    const item = el('a', {
        className: 'mc-item modcore-discovery-ui' + (isReordering ? ' reordering' : ''),
        attrs: {
            'data-feature-id': featureId,
            'title': `${feature.fullName}: ${feature.description}`,
            'aria-label': `${feature.fullName}: ${feature.description}`,
            'href': isReordering ? '#' : feature.url,
            'draggable': isReordering ? 'true' : 'false',
            'style': `animation-delay: ${animIndex * 35}ms`
        },
        children: [iconWrapper, label]
    });

    if (showShortcuts) item.classList.add('mc-shortcuts-visible'); // hint applied to parent via class

    return item;
}

// ─── Discovery Panel ──────────────────────────────────────────────────────────
function createDiscoveryPanel(data) {
    let isReordering = false;
    let draggedItem = null;
    let swapCandidate = null;
    let showShortcuts = false;

    // ── Overlay
    const overlay = el('div', {
        className: 'mc-overlay modcore-discovery-ui',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Discovery' }
    });

    // ── Panel
    const panel = el('div', {
        className: 'mc-panel',
        attrs: { tabindex: '-1' }
    });

    // ── Header
    const title = el('h3', { text: 'Discovery' });

    const reorderBtn = el('button', {
        className: 'mc-icon-btn',
        attrs: {
            'aria-label': 'Reorder features (R)',
            'title': 'Reorder  R',
            'aria-pressed': 'false'
        },
        children: [makeImg('../../public/icons/svg/move.svg')]
    });

    const helpBtn = el('button', {
        className: 'mc-icon-btn',
        attrs: { 'aria-label': 'Keyboard shortcuts (?)', 'title': 'Shortcuts  ?' }
    });
    helpBtn.appendChild(makeImg('../../public/icons/svg/help.svg'));

    const closeBtn = el('button', {
        className: 'mc-icon-btn',
        attrs: { 'aria-label': 'Close Discovery (Esc)', 'title': 'Close  Esc' }
    });
    closeBtn.appendChild(makeImg('../../public/icons/svg/close.svg'));

    const headerActions = el('div', {
        className: 'mc-header-actions',
        children: [reorderBtn, helpBtn, closeBtn]
    });

    const header = el('div', {
        className: 'mc-header',
        children: [title, headerActions]
    });
    panel.appendChild(header);

    // ── Reorder Bar
    const reorderHint = el('span', { className: 'mc-reorder-bar-hint', text: 'Drag to reorder · click two to swap' });
    const reorderDoneBtn = el('button', { className: 'mc-reorder-done-btn', text: 'Done ✓' });
    const reorderBar = el('div', {
        className: 'mc-reorder-bar',
        children: [reorderHint, reorderDoneBtn]
    });
    panel.appendChild(reorderBar);

    // ── Feature Grid
    const grid = el('div', { className: 'mc-grid', attrs: { id: 'mc-feature-grid' } });
    panel.appendChild(grid);

    function renderFeatures() {
        grid.textContent = '';
        if (showShortcuts) grid.classList.add('mc-shortcuts-visible');
        else grid.classList.remove('mc-shortcuts-visible');

        data.featureOrder.forEach((featureId, idx) => {
            const item = createFeatureItem(featureId, { isReordering, showShortcuts, animIndex: idx });
            if (!item) return;

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
                    grid.querySelectorAll('.mc-item').forEach(el => el.classList.remove('drag-over'));
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
                        showToast('Order saved');
                    }
                });

                // Touch support
                let touchStartY = 0, touchStartX = 0;
                item.addEventListener('touchstart', (e) => {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                    item.classList.add('swap-selected-touch');
                }, { passive: true });
                item.addEventListener('touchend', (e) => {
                    item.classList.remove('swap-selected-touch');
                    const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
                    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
                    if (dx < 10 && dy < 10) handleSwapClick(item, featureId);
                }, { passive: true });

            } else {
                // Normal mode: open feature
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    try { chrome.tabs.create({ url: item.getAttribute('href') }); } catch { window.open(item.getAttribute('href'), '_blank'); }
                    closeDiscovery(overlay);
                });
                item.setAttribute('tabindex', '0');
                item.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        item.click();
                    }
                });
            }

            item.setAttribute('data-index', idx);
            grid.appendChild(item);
        });
    }

    function handleSwapClick(item, featureId) {
        if (!swapCandidate) {
            swapCandidate = { el: item, id: featureId };
            item.classList.add('swap-selected');
            showToast('Now click another to swap');
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
                showToast('Swapped!');
            }
        }
    }

    renderFeatures();

    // ── Quick Actions (collapsible)
    const quickToggleArrow = makeImg('../../public/icons/svg/arrow-down.svg');
    quickToggleArrow.className = 'mc-quick-toggle-arrow';

    const kbdHint = el('span', { className: 'mc-kbd-hint', text: 'Q' });

    const quickToggleLabel = el('span', { className: 'mc-quick-toggle-label', text: 'Quick Actions' });

    const quickToggle = el('button', {
        className: 'mc-quick-toggle' + (data.quickActionsCollapsed ? '' : ' expanded'),
        attrs: {
            'aria-expanded': data.quickActionsCollapsed ? 'false' : 'true',
            'aria-label': 'Toggle Quick Actions (Q)',
            'title': 'Quick Actions  Q'
        },
        children: [quickToggleLabel, kbdHint, quickToggleArrow]
    });

    const quickBody = el('div', {
        className: 'mc-quick-body' + (data.quickActionsCollapsed ? '' : ' expanded'),
    });

    function toggleQuickActions() {
        const expanded = quickToggle.classList.toggle('expanded');
        quickBody.classList.toggle('expanded', expanded);
        quickToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        data.quickActionsCollapsed = !expanded;
        saveDiscoveryData(data);
    }
    quickToggle.addEventListener('click', toggleQuickActions);

    const quickGrid = el('div', { className: 'mc-quick-grid' });

    const quickActions = [
        { text: 'Manage',      icon: '../../public/icons/svg/grid.svg',  title: 'Open Chrome Extensions page',           action: () => { try { chrome.tabs.create({ url: 'chrome://extensions' }); } catch {} } },
        { text: 'Enable All',  icon: '../../public/icons/svg/check.svg', title: 'Enable all extensions except modcore',   action: () => toggleAllExtensions(true) },
        { text: 'Disable All', icon: '../../public/icons/svg/close.svg', title: 'Disable all extensions except modcore',  action: () => toggleAllExtensions(false) }
    ];

    quickActions.forEach(({ text, icon, title, action }) => {
        const btn = el('button', {
            className: 'mc-quick-btn modcore-discovery-ui',
            attrs: { 'title': title, 'aria-label': title },
            children: [makeImg(icon), el('span', { text })]
        });
        btn.addEventListener('click', () => { action(); });
        quickGrid.appendChild(btn);
    });

    quickBody.appendChild(quickGrid);

    const quickSection = el('div', {
        className: 'mc-quick-section',
        children: [quickToggle, quickBody]
    });
    panel.appendChild(quickSection);

    // ── Help / Shortcut sheet (layered over panel content)
    const helpSheet = createHelpSheet();
    panel.appendChild(helpSheet);

    // ── Reorder toggle logic
    function setReordering(val) {
        isReordering = val;
        swapCandidate = null;
        reorderBtn.classList.toggle('reorder-active', isReordering);
        reorderBtn.setAttribute('aria-pressed', isReordering ? 'true' : 'false');
        reorderBar.classList.toggle('visible', isReordering);
        reorderBtn.setAttribute('title', isReordering ? 'Done reordering  R' : 'Reorder features  R');
        reorderBtn.setAttribute('aria-label', isReordering ? 'Done reordering (R)' : 'Reorder features (R)');
        if (isReordering) showToast('Drag to reorder, or tap two items to swap');
        renderFeatures();
    }

    reorderBtn.addEventListener('click', () => setReordering(!isReordering));
    reorderDoneBtn.addEventListener('click', () => setReordering(false));

    // ── Help sheet logic
    helpBtn.addEventListener('click', () => {
        helpSheet.classList.toggle('visible');
    });

    // ── Close
    closeBtn.addEventListener('click', () => closeDiscovery(overlay));

    // ── Keyboard nav within panel
    panel.addEventListener('keydown', (e) => {
        if (helpSheet.classList.contains('visible')) {
            if (e.key === 'Escape' || e.key === '?') {
                e.stopPropagation();
                helpSheet.classList.remove('visible');
            }
            return;
        }

        // Feature shortcuts 1-7
        if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-7]$/.test(e.key)) {
            const featureId = Object.values(FEATURES).find(f => f.shortcut === e.key)?.id;
            if (featureId) {
                const feat = FEATURES[featureId];
                try { chrome.tabs.create({ url: feat.url }); } catch { window.open(feat.url, '_blank'); }
                closeDiscovery(overlay);
            }
        }
        if (e.key === 'r' || e.key === 'R') setReordering(!isReordering);
        if (e.key === '?') helpSheet.classList.toggle('visible');
        if (e.key === 'q' || e.key === 'Q') toggleQuickActions();
        if (e.key === 'Tab') {
            // Allow natural tab flow; no custom override needed
        }
    });

    overlay.appendChild(panel);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDiscovery(overlay);
    });

    // Expose setReordering for external use (keyboard shortcut from initDiscovery)
    overlay._setReordering = setReordering;
    overlay._toggleQuickActions = toggleQuickActions;

    return overlay;
}

// ─── Help / Shortcut Sheet ────────────────────────────────────────────────────
function createHelpSheet() {
    const sheet = el('div', { className: 'mc-help-sheet', attrs: { role: 'region', 'aria-label': 'Keyboard shortcuts' } });

    const titleEl = el('h4', { className: 'mc-help-sheet-title', text: 'Keyboard Shortcuts' });
    sheet.appendChild(titleEl);

    const shortcuts = [
        { desc: 'Open / close Discovery',   keys: ['Alt', 'D'] },
        { desc: 'Close panel',               keys: ['Esc'] },
        { desc: 'Open feature 1-7',          keys: ['1–7'] },
        { desc: 'Toggle reorder mode',       keys: ['R'] },
        { desc: 'Toggle quick actions',      keys: ['Q'] },
        { desc: 'Show this help',            keys: ['?'] },
    ];

    shortcuts.forEach(({ desc, keys }) => {
        const row = el('div', { className: 'mc-shortcut-row' });
        row.appendChild(el('span', { className: 'mc-shortcut-desc', text: desc }));
        const keysEl = el('div', { className: 'mc-shortcut-keys' });
        keys.forEach((k, i) => {
            keysEl.appendChild(makeKbd(k));
            if (i < keys.length - 1) keysEl.appendChild(el('span', { text: '+', attrs: { style: 'color:#aaa;font-size:11px;align-self:center;' } }));
        });
        row.appendChild(keysEl);
        sheet.appendChild(row);
    });

    const closeBtn = el('button', { className: 'mc-help-close', text: 'Close' });
    closeBtn.addEventListener('click', () => sheet.classList.remove('visible'));
    sheet.appendChild(closeBtn);

    return sheet;
}

// ─── Close Discovery ──────────────────────────────────────────────────────────
function closeDiscovery(overlay) {
    const trigger = document.querySelector('.mc-trigger');
    if (trigger) {
        trigger.classList.remove('active');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
    }
    overlay.classList.remove('open');
    // Remove after animation
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 320);
}

// ─── Toggle All Extensions ────────────────────────────────────────────────────
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
            } catch { /* skip */ }
        }
        showToast(changed > 0 ? `${changed} extension${changed !== 1 ? 's' : ''} ${enable ? 'enabled' : 'disabled'}` : 'Nothing to change');
    } catch {
        showToast('Action failed');
    }
}

// ─── Main Init ────────────────────────────────────────────────────────────────
async function initDiscovery() {
    // Prevent double-init
    if (document.querySelector('.mc-trigger')) return;

    injectStyles();

    // Load data eagerly - don't block UI
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

        // Pulse animation on trigger
        trigger.classList.add('pulse');
        setTimeout(() => trigger.classList.remove('pulse'), 500);

        const data = await dataPromise;
        overlay = createDiscoveryPanel(data);
        document.body.appendChild(overlay);

        // Double-rAF for reliable animation start
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

    // ── Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Alt+D - toggle Discovery
        if (e.altKey && (e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (isOpen) doClose(); else openDiscovery();
            return;
        }
        if (!isOpen) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            doClose();
            return;
        }
    });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDiscovery, { once: true });
} else {
    // Already interactive/complete - run immediately
    initDiscovery();
}
