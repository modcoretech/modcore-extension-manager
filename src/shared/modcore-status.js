/**
 * modcore-status.js
 *
 * Two modes:
 *   1. Toasts: transient bottom-center notifications (max 3, auto-dismiss)
 *   2. Status Bar: persistent top banner for errors (manual dismiss only)
 *
 * Usage:
 *   Status.toast('Saved', 'success');
 *   Status.error('Failed to save');           // toast
 *   Status.bar('Critical: connection lost');  // persistent status bar
 *   Status.dismissBar();                       // hide status bar
 *   Status.clearToasts();                     // dismiss all toasts
 *   Status.clearAll();                        // toasts + status bar
 */
(function (global) {
    'use strict';

    // ─── Asset path helper ───────────────────────────────────────────────
    const ICON_PATH = 'src/shared/assets/icons/svg/close.svg';

    function _resolveIcon(path) {
        if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
            return chrome.runtime.getURL(path);
        }
        return path;
    }

    // ─── Constants ───────────────────────────────────────────────────────
    const STYLE_ID          = '_modcore-status-styles';
    const TOAST_CONTAINER_ID= '_modcore-toasts';
    const STATUS_BAR_ID     = '_modcore-status-bar';
    const MAX_TOASTS        = 3;

    const TYPE_META = {
        info:    { role: 'status', cls: '_mc-info' },
        success: { role: 'status', cls: '_mc-success' },
        warning: { role: 'alert',  cls: '_mc-warning' },
        error:   { role: 'alert',  cls: '_mc-error' },
    };

    // ─── State ───────────────────────────────────────────────────────────
    let _stylesInjected = false;
    let _toastContainer = null;
    let _statusBar      = null;
    let _toastId        = 0;
    const _toasts = new Map(); // id → { id, el, timer, startedAt, remaining, dedupKey }
    const _dedup  = new Map(); // "type::message" → id

    // ─── CSS ─────────────────────────────────────────────────────────────
    // __ICON__ is replaced with the resolved close-icon URL at injection time.
    const CSS_TEMPLATE = `
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
            padding: 8px 12px;
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
        ._mc-toast._mc-visible { opacity: 1; transform: translateY(0); }
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

        /* ── Shared close button (toast + bar) ── */
        ._mc-toast-close,
        ._mc-bar-close {
            all: unset;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            border-radius: var(--radius-sm, 4px);
            opacity: 0.6;
            transition: opacity 100ms ease;
        }
        ._mc-toast-close { width: 18px; height: 18px; }
        ._mc-bar-close   { width: 22px; height: 22px; opacity: 0.75; }
        ._mc-toast-close:hover,
        ._mc-bar-close:hover { opacity: 1; }
        ._mc-toast-close:focus-visible,
        ._mc-bar-close:focus-visible {
            opacity: 1;
            outline: 2px solid currentColor;
            outline-offset: 1px;
        }
        ._mc-toast-close-icon,
        ._mc-bar-close-icon {
            display: block;
            background-color: currentColor;
            -webkit-mask-image: url("__ICON__");
                    mask-image: url("__ICON__");
            -webkit-mask-size: contain;
                    mask-size: contain;
            -webkit-mask-repeat: no-repeat;
                    mask-repeat: no-repeat;
            -webkit-mask-position: center;
                    mask-position: center;
        }
        ._mc-toast-close-icon { width: 12px; height: 12px; }
        ._mc-bar-close-icon   { width: 14px; height: 14px; }

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
        #_modcore-status-bar._mc-bar-visible { display: flex; }
        #_modcore-status-bar ._mc-bar-live   { flex: 1 1 auto; }

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

    // ─── Style injection ─────────────────────────────────────────────────
    function _injectStyles() {
        if (_stylesInjected) return;
        if (typeof document === 'undefined') return;
        if (document.getElementById(STYLE_ID)) { _stylesInjected = true; return; }
        const s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = CSS_TEMPLATE.replace(/__ICON__/g, _resolveIcon(ICON_PATH));
        document.head.appendChild(s);
        _stylesInjected = true;
    }

    // ─── DOM getters ─────────────────────────────────────────────────────
    function _getToastContainer() {
        if (_toastContainer) return _toastContainer;
        _toastContainer = document.getElementById(TOAST_CONTAINER_ID);
        if (!_toastContainer) {
            _toastContainer = document.createElement('div');
            _toastContainer.id = TOAST_CONTAINER_ID;
            document.body.appendChild(_toastContainer);

            // One click listener handles every toast's close button.
            _toastContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('._mc-toast-close');
                if (!btn) return;
                const el = btn.closest('._mc-toast');
                if (!el) return;
                _removeToast(Number(el.getAttribute('data-tid')), true);
            });
        }
        return _toastContainer;
    }

    function _getStatusBar() {
        if (_statusBar) return _statusBar;
        _statusBar = document.getElementById(STATUS_BAR_ID);
        if (!_statusBar) {
            _statusBar = document.createElement('div');
            _statusBar.id = STATUS_BAR_ID;
            _statusBar.setAttribute('aria-live', 'assertive');
            _statusBar.setAttribute('aria-atomic', 'true');
            document.body.appendChild(_statusBar);

            // Escape dismisses the bar.
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                if (!_statusBar.classList.contains('_mc-bar-visible')) return;
                _hideBar();
            });
        }
        return _statusBar;
    }

    // ─── Icon builder ────────────────────────────────────────────────────
    function _makeCloseIcon(className) {
        const span = document.createElement('span');
        span.className = className;
        span.setAttribute('aria-hidden', 'true');
        return span;
    }

    // ─── Toast element builder ───────────────────────────────────────────
    function _buildToast(id, message, type) {
        const meta = TYPE_META[type] || TYPE_META.info;

        const el = document.createElement('div');
        el.className = `_mc-toast ${meta.cls}`;
        el.setAttribute('role', meta.role);
        el.setAttribute('data-tid', String(id));

        const msg = document.createElement('span');
        msg.className = '_mc-toast-msg';
        msg.textContent = String(message);
        el.appendChild(msg);

        const btn = document.createElement('button');
        btn.className = '_mc-toast-close';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Dismiss notification');
        btn.appendChild(_makeCloseIcon('_mc-toast-close-icon'));
        el.appendChild(btn);

        return el;
    }

    // ─── Pause / resume auto-dismiss ─────────────────────────────────────
    function _pause(rec) {
        if (!rec || !rec.timer) return;
        clearTimeout(rec.timer);
        rec.timer = null;
        rec.remaining -= (Date.now() - rec.startedAt);
        if (rec.remaining < 0) rec.remaining = 0;
    }

    function _resume(rec) {
        if (!rec || rec.timer || rec.remaining <= 0) return;
        if (!_toasts.has(rec.id)) return;
        rec.startedAt = Date.now();
        rec.timer = setTimeout(() => _removeToast(rec.id, true), rec.remaining);
    }

    // ─── Status Bar show / hide ──────────────────────────────────────────
    function _hideBar() {
        if (!_statusBar) return;
        _statusBar.classList.remove('_mc-bar-visible');
        _statusBar.setAttribute('aria-hidden', 'true');
    }

    function _showStatusBar(message) {
        const bar = _getStatusBar();

        // Clear, re-announce, then repopulate so screen readers pick it up
        // even when the same message is repeated.
        bar.replaceChildren();
        bar.classList.remove('_mc-bar-visible');
        bar.setAttribute('aria-hidden', 'true');

        requestAnimationFrame(() => {
            const live = document.createElement('span');
            live.className = '_mc-bar-live';
            live.textContent = String(message);
            bar.appendChild(live);

            const btn = document.createElement('button');
            btn.className = '_mc-bar-close';
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Dismiss error');
            btn.appendChild(_makeCloseIcon('_mc-bar-close-icon'));
            btn.addEventListener('click', _hideBar);
            bar.appendChild(btn);

            bar.classList.add('_mc-bar-visible');
            bar.removeAttribute('aria-hidden');

            // Move focus to the live region so keyboard users land on it.
            live.setAttribute('tabindex', '-1');
            live.focus({ preventScroll: true });
        });
    }

    // ─── Toast lifecycle ─────────────────────────────────────────────────
    function _showToast(message, type, duration) {
        _injectStyles();

        const dedupKey = `${type}::${message}`;
        const existing = _dedup.get(dedupKey);

        // Merge identical toasts: reset the existing one's timer.
        if (existing !== undefined && _toasts.has(existing)) {
            const rec = _toasts.get(existing);
            if (rec.timer) clearTimeout(rec.timer);
            rec.timer = null;
            if (duration > 0) {
                rec.remaining = duration;
                rec.startedAt = Date.now();
                rec.timer = setTimeout(() => _removeToast(rec.id, true), duration);
            }
            return existing;
        }

        // Evict oldest if at cap.
        if (_toasts.size >= MAX_TOASTS) {
            const oldest = _toasts.keys().next().value;
            _removeToast(oldest, false);
        }

        const id = ++_toastId;
        const el = _buildToast(id, message, type);
        const container = _getToastContainer();
        container.appendChild(el);

        // Force reflow, then animate in.
        void el.offsetWidth;
        requestAnimationFrame(() => el.classList.add('_mc-visible'));

        const rec = {
            id, el, timer: null,
            startedAt: 0, remaining: 0,
            dedupKey,
        };
        _toasts.set(id, rec);
        _dedup.set(dedupKey, id);

        // Pause auto-dismiss while the user hovers or focuses the toast.
        el.addEventListener('mouseenter', () => _pause(rec));
        el.addEventListener('mouseleave', () => _resume(rec));
        el.addEventListener('focusin',    () => _pause(rec));
        el.addEventListener('focusout',   (e) => {
            if (!el.contains(e.relatedTarget)) _resume(rec);
        });

        if (duration > 0) {
            rec.remaining = duration;
            rec.startedAt = Date.now();
            rec.timer = setTimeout(() => _removeToast(id, true), duration);
        }

        return id;
    }

    function _removeToast(id, animate) {
        const rec = _toasts.get(id);
        if (!rec) return false;

        if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
        _toasts.delete(id);
        if (rec.dedupKey) _dedup.delete(rec.dedupKey);

        if (!animate) {
            rec.el.remove();
            return true;
        }

        rec.el.classList.remove('_mc-visible');
        rec.el.classList.add('_mc-exit');

        const drop = () => { if (rec.el.parentNode) rec.el.remove(); };
        rec.el.addEventListener('transitionend', drop, { once: true });
        setTimeout(drop, 300); // safety net

        return true;
    }

    // ─── Public API ──────────────────────────────────────────────────────
    const Status = {
        /**
         * Show a toast notification.
         * @param {string} message
         * @param {'info'|'success'|'warning'|'error'} [type='info']
         * @param {number} [duration=3000] ms; 0 = persistent
         * @returns {number} toast id
         */
        toast(message, type = 'info', duration = 3000) {
            const validType = TYPE_META[type] ? type : 'info';
            const dur = (typeof duration === 'number' && duration >= 0) ? duration : 3000;
            return _showToast(message, validType, dur);
        },

        info(message, duration) {
            return this.toast(message, 'info', duration ?? 3000);
        },
        success(message, duration) {
            return this.toast(message, 'success', duration ?? 3000);
        },
        warning(message, duration) {
            return this.toast(message, 'warning', duration ?? 4000);
        },
        error(message, duration) {
            return this.toast(message, 'error', duration ?? 5000);
        },

        /**
         * Show a persistent status bar for critical errors.
         * Does NOT auto-dismiss. Escape or the close button hides it.
         * @param {string} message
         */
        bar(message) {
            _injectStyles();
            _showStatusBar(message);
        },

        /** Hide the status bar. */
        dismissBar() {
            _hideBar();
        },

        /** Dismiss all toasts immediately (no animation). */
        clearToasts() {
            for (const id of [..._toasts.keys()]) _removeToast(id, false);
            _dedup.clear();
        },

        /** Dismiss everything: toasts + status bar. */
        clearAll() {
            this.clearToasts();
            this.dismissBar();
        },
    };

    global.Status = Status;

})(typeof window !== 'undefined' ? window : this);