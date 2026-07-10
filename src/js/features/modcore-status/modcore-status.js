/**
 * modcore-status.js
 *
 * Two modes:
 *   1. Toasts: transient bottom-center notifications (max 3, auto-dismiss)
 *   2. Status Bar: persistent top banner for errors (manual dismiss only)
 *
 * Usage:
 *   Status.toast('Saved', 'success');
 *   Status.error('Failed to save');           // toast + optional bar
 *   Status.bar('Critical: connection lost');  // persistent status bar
 *   Status.dismissBar();                       // hide status bar
 *   Status.clearToasts();                     // dismiss all toasts
 */
(function (global) {
    'use strict';

    // ─── Asset path helper ───────────────────────────────────────────────────
    function _icon(path) {
        if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
            return chrome.runtime.getURL(path);
        }
        return path;
    }

    // ─── Constants ───────────────────────────────────────────────────────────
    const STYLE_ID = '_modcore-status-styles';
    const TOAST_CONTAINER_ID = '_modcore-toasts';
    const STATUS_BAR_ID = '_modcore-status-bar';
    const MAX_TOASTS = 3;

    const TYPE_META = {
        info:    { role: 'status',  live: 'polite',    cls: '_mc-info' },
        success: { role: 'status',  live: 'polite',    cls: '_mc-success' },
        warning: { role: 'alert',   live: 'assertive', cls: '_mc-warning' },
        error:   { role: 'alert',   live: 'assertive', cls: '_mc-error' },
    };

    // ─── State ───────────────────────────────────────────────────────────────
    let _stylesInjected = false;
    let _toastContainer = null;
    let _statusBar = null;
    let _toastId = 0;
    const _toasts = new Map(); // id → { el, timer }

    // ─── CSS ─────────────────────────────────────────────────────────────────
    // Single background surface, colored borders + text. No blur, no glass.
    const CSS = `
        /* ── Toast Container ── */
        #_modcore-toasts {
            position: fixed;
            bottom: var(--space-4, 16px);
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: var(--space-2, 8px);
            align-items: center;
            pointer-events: none;
            max-width: calc(100vw - var(--space-8, 32px));
        }
        #_modcore-toasts > * { pointer-events: auto; }

        /* ── Toast ── */
        ._mc-toast {
            display: flex;
            align-items: center;
            gap: var(--space-2, 8px);
            padding: 8px 14px;
            border-radius: var(--radius-md, 8px);
            border: 1.5px solid;
            background: var(--color-surface, #fff);
            color: var(--color-text-primary, #111);
            font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            font-size: var(--text-body-sm, 13px);
            font-weight: var(--weight-medium, 500);
            line-height: 1.4;
            min-width: 180px;
            max-width: 320px;
            width: max-content;
            box-shadow: var(--shadow-md, 0 2px 8px rgba(0,0,0,0.08));
            word-break: break-word;

            opacity: 0;
            transform: translateY(8px);
            transition: opacity 120ms ease-out, transform 120ms ease-out;
        }
        ._mc-toast._mc-visible {
            opacity: 1;
            transform: translateY(0);
        }
        ._mc-toast._mc-exit {
            opacity: 0;
            transform: translateY(4px);
            transition-duration: 100ms;
        }

        /* Type variants: border + text color only, no background tinting */
        ._mc-toast._mc-info    { border-color: var(--color-info, #0b57d0);    color: var(--color-info, #0b57d0); }
        ._mc-toast._mc-success { border-color: var(--color-success, #1e8e3e); color: var(--color-success, #1e8e3e); }
        ._mc-toast._mc-warning { border-color: var(--color-warning, #b06000); color: var(--color-warning, #b06000); }
        ._mc-toast._mc-error   { border-color: var(--color-danger, #c5221f);  color: var(--color-danger, #c5221f); }

        ._mc-toast-msg { flex: 1 1 auto; }

        ._mc-toast-close {
            all: unset;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            width: 18px;
            height: 18px;
            border-radius: var(--radius-sm, 4px);
            opacity: 0.55;
            transition: opacity 100ms ease;
        }
        ._mc-toast-close:hover { opacity: 1; }
        ._mc-toast-close:focus-visible {
            opacity: 1;
            outline: 2px solid currentColor;
            outline-offset: 1px;
        }
        ._mc-toast-close img {
            width: 12px;
            height: 12px;
            display: block;
            filter: var(--filter-icon, none);
        }

        /* ── Status Bar ── */
        #_modcore-status-bar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 10000;
            display: none;
            align-items: center;
            gap: var(--space-3, 12px);
            padding: 10px var(--space-4, 16px);
            background: var(--color-surface, #fff);
            border-bottom: 2px solid var(--color-danger, #c5221f);
            color: var(--color-danger, #c5221f);
            font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            font-size: var(--text-body-sm, 13px);
            font-weight: var(--weight-medium, 500);
            line-height: 1.4;
            box-shadow: var(--shadow-sm, 0 1px 4px rgba(0,0,0,0.06));
            word-break: break-word;
        }
        #_modcore-status-bar._mc-bar-visible {
            display: flex;
        }
        /* Live region on inner message, not the container (allows interactive children) */
        #_modcore-status-bar ._mc-bar-live {
            flex: 1 1 auto;
        }
        ._mc-bar-close {
            all: unset;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            width: 22px;
            height: 22px;
            border-radius: var(--radius-sm, 4px);
            opacity: 0.7;
            transition: opacity 100ms ease;
            color: inherit;
        }
        ._mc-bar-close:hover { opacity: 1; }
        ._mc-bar-close:focus-visible {
            opacity: 1;
            outline: 2px solid currentColor;
            outline-offset: 2px;
        }
        ._mc-bar-close img {
            width: 14px;
            height: 14px;
            display: block;
            filter: var(--filter-icon, none);
        }

        /* Reduced motion */
        @media (prefers-reduced-motion: reduce) {
            ._mc-toast,
            ._mc-toast._mc-exit {
                transition: none !important;
                transform: none !important;
                opacity: 1 !important;
            }
        }
    `;

    // ─── Style injection ─────────────────────────────────────────────────────
    function _injectStyles() {
        if (_stylesInjected) return;
        if (typeof document === 'undefined') return;
        if (document.getElementById(STYLE_ID)) { _stylesInjected = true; return; }
        const s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = CSS;
        document.head.appendChild(s);
        _stylesInjected = true;
    }

    // ─── Toast Container ────────────────────────────────────────────────────
    function _getToastContainer() {
        if (_toastContainer) return _toastContainer;
        _toastContainer = document.getElementById(TOAST_CONTAINER_ID);
        if (!_toastContainer) {
            _toastContainer = document.createElement('div');
            _toastContainer.id = TOAST_CONTAINER_ID;
            document.body.appendChild(_toastContainer);
        }
        return _toastContainer;
    }

    // ─── Status Bar ──────────────────────────────────────────────────────────
    function _getStatusBar() {
        if (_statusBar) return _statusBar;
        _statusBar = document.getElementById(STATUS_BAR_ID);
        if (!_statusBar) {
            _statusBar = document.createElement('div');
            _statusBar.id = STATUS_BAR_ID;
            // Use aria-live on container (not role=alert) so interactive children are allowed
            _statusBar.setAttribute('aria-live', 'assertive');
            _statusBar.setAttribute('aria-atomic', 'true');
            document.body.appendChild(_statusBar);
        }
        return _statusBar;
    }

    // ─── Build toast element  ──────────────────────────────
    function _buildToast(id, message, type) {
        const meta = TYPE_META[type] || TYPE_META.info;
        const el = document.createElement('div');
        el.className = `_mc-toast ${meta.cls}`;
        el.setAttribute('role', meta.role);
        el.setAttribute('aria-live', meta.live);
        el.setAttribute('aria-atomic', 'true');
        el.setAttribute('data-tid', String(id));

        const msg = document.createElement('span');
        msg.className = '_mc-toast-msg';
        msg.textContent = String(message);
        el.appendChild(msg);

        const btn = document.createElement('button');
        btn.className = '_mc-toast-close';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Dismiss notification');
        const img = document.createElement('img');
        img.src = _icon('../../public/icons/svg/close.svg');
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        img.width = 12;
        img.height = 12;
        btn.appendChild(img);
        el.appendChild(btn);

        btn.addEventListener('click', () => _removeToast(id));

        return el;
    }

    // ─── Build / update status bar ───────────────────────────────────────────
    function _showStatusBar(message) {
        const bar = _getStatusBar();

        // Clear then repopulate to force re-announcement even for same message
        bar.replaceChildren();
        bar.classList.remove('_mc-bar-visible');
        bar.setAttribute('aria-hidden', 'true');

        // Small delay to ensure screen readers detect the content change
        requestAnimationFrame(() => {
            const live = document.createElement('span');
            live.className = '_mc-bar-live';
            live.textContent = String(message);
            bar.appendChild(live);

            const btn = document.createElement('button');
            btn.className = '_mc-bar-close';
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Dismiss error');
            const img = document.createElement('img');
            img.src = _icon('../../public/icons/svg/close.svg');
            img.alt = '';
            img.setAttribute('aria-hidden', 'true');
            img.width = 14;
            img.height = 14;
            btn.appendChild(img);
            bar.appendChild(btn);

            btn.addEventListener('click', () => {
                bar.classList.remove('_mc-bar-visible');
                bar.setAttribute('aria-hidden', 'true');
            });

            bar.classList.add('_mc-bar-visible');
            bar.removeAttribute('aria-hidden');

            // Move focus to the live region for keyboard users
            live.setAttribute('tabindex', '-1');
            live.focus({ preventScroll: true });
        });
    }

    // ─── Toast lifecycle ─────────────────────────────────────────────────────
    function _showToast(message, type, duration) {
        _injectStyles();

        // Hard cap at 3: evict oldest
        if (_toasts.size >= MAX_TOASTS) {
            const oldest = _toasts.keys().next().value;
            _removeToast(oldest, false);
        }

        const id = ++_toastId;
        const el = _buildToast(id, message, type);
        const container = _getToastContainer();
        container.appendChild(el);

        // Force reflow then animate in
        void el.offsetWidth;
        requestAnimationFrame(() => el.classList.add('_mc-visible'));

        const record = { el, timer: null };
        _toasts.set(id, record);

        if (duration > 0) {
            record.timer = setTimeout(() => _removeToast(id, true), duration);
        }

        return id;
    }

    function _removeToast(id, animate) {
        const rec = _toasts.get(id);
        if (!rec) return false;

        if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
        _toasts.delete(id);

        if (!animate) {
            rec.el.remove();
            return true;
        }

        rec.el.classList.remove('_mc-visible');
        rec.el.classList.add('_mc-exit');

        const onEnd = (e) => {
            if (e.target === rec.el) {
                rec.el.removeEventListener('transitionend', onEnd);
                rec.el.remove();
            }
        };
        rec.el.addEventListener('transitionend', onEnd);

        // Safety fallback if transitionend never fires
        setTimeout(() => {
            if (rec.el.parentNode) {
                rec.el.removeEventListener('transitionend', onEnd);
                rec.el.remove();
            }
        }, 300);

        return true;
    }

    // ─── Public API ──────────────────────────────────────────────────────────
    const Status = {
        /**
         * Show a toast notification.
         * @param {string} message
         * @param {'info'|'success'|'warning'|'error'} [type='info']
         * @param {number} [duration=3000] ms; 0 = persistent
         */
        toast(message, type = 'info', duration = 3000) {
            const validType = TYPE_META[type] ? type : 'info';
            const dur = (typeof duration === 'number' && duration >= 0) ? duration : 3000;
            return _showToast(message, validType, dur);
        },

        /** Shorthand: info toast */
        info(message, duration) {
            return this.toast(message, 'info', duration ?? 3000);
        },

        /** Shorthand: success toast */
        success(message, duration) {
            return this.toast(message, 'success', duration ?? 3000);
        },

        /** Shorthand: warning toast */
        warning(message, duration) {
            return this.toast(message, 'warning', duration ?? 4000);
        },

        /** Shorthand: error toast */
        error(message, duration) {
            return this.toast(message, 'error', duration ?? 5000);
        },

        /**
         * Show a persistent status bar for critical errors.
         * Does NOT auto-dismiss. Must be dismissed manually.
         * Accessible: uses aria-live (not role=alert) to allow interactive children.
         * @param {string} message
         */
        bar(message) {
            _injectStyles();
            _showStatusBar(message);
        },

        /** Hide the status bar */
        dismissBar() {
            if (_statusBar) {
                _statusBar.classList.remove('_mc-bar-visible');
                _statusBar.setAttribute('aria-hidden', 'true');
            }
        },

        /** Dismiss all toasts immediately (no animation) */
        clearToasts() {
            for (const id of [..._toasts.keys()]) {
                _removeToast(id, false);
            }
        },

        /** Dismiss everything: toasts + status bar */
        clearAll() {
            this.clearToasts();
            this.dismissBar();
        }
    };

    global.Status = Status;

})(typeof window !== 'undefined' ? window : this);