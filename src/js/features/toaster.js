/**
 * toaster.js — Universal Toast Notification System
 *
 * Usage:
 *   Toaster.show('Hello world', 'success');
 *   Toaster.error('Something went wrong', 5000);
 *   Toaster.dismissAll();
 */
(function(global) {
    'use strict';

    const Toaster = {
        version: '1.0.0',

        defaults: {
            duration: 3000,
            position: 'bottom-center',
            maxVisible: 5,
            pauseOnHover: true,
            dismissible: true,
            showProgress: false,
            animation: 'slide',      // 'slide' | 'fade' | 'scale'
            ariaLive: 'polite',
            zIndex: 9999,
            offsetX: '1rem',
            offsetY: '1rem',
            gap: '0.5rem',
            onShow: null,
            onDismiss: null
        },

        types: {
            info:    { className: 'toaster-type-info',    role: 'status', duration: 3000 },
            success: { className: 'toaster-type-success', role: 'status', duration: 3000 },
            error:   { className: 'toaster-type-error',   role: 'alert',  duration: 5000 },
            warning: { className: 'toaster-type-warning', role: 'alert',  duration: 4000 }
        },

        _containers: new Map(),
        _toasts: new Map(),
        _idCounter: 0,
        _stylesInjected: false,
        _initCalled: false,

        init(options) {
            if (this._initCalled) return this;
            this._injectStyles();
            this._initCalled = true;
            if (options && typeof options === 'object') {
                Object.assign(this.defaults, options);
            }
            return this;
        },

        configure(options) {
            Object.assign(this.defaults, options);
            return this;
        },

        setDefault(key, value) {
            this.defaults[key] = value;
            return this;
        },

        getDefault(key) {
            return this.defaults[key];
        },

        show(message, type = 'info', duration, options = {}) {
            this.init();

            const typeConf = this.types[type] || this.types.info;
            const opts = { ...this.defaults, ...typeConf, ...options };
            if (duration != null) opts.duration = duration;

            const id = ++this._idCounter;
            const toast = this._buildToast(id, message, type, opts);

            this._toasts.set(id, toast);

            // Enforce maxVisible per position
            const position = opts.position;
            const visibleHere = Array.from(this._toasts.values())
                .filter(t => t.visible && t.options.position === position);
            if (visibleHere.length > opts.maxVisible) {
                const oldest = visibleHere[0];
                if (oldest) this._remove(oldest.id, false);
            }

            this._mount(toast);

            if (typeof opts.onShow === 'function') {
                try { opts.onShow(toast.element, id); } catch (e) { console.error(e); }
            }

            if (opts.duration > 0) {
                toast.timer = setTimeout(() => this._remove(id, true), opts.duration);
            }

            return id;
        },

        info(message, duration, options) {
            return this.show(message, 'info', duration, options);
        },

        success(message, duration, options) {
            return this.show(message, 'success', duration, options);
        },

        error(message, duration, options) {
            return this.show(message, 'error', duration, options);
        },

        warning(message, duration, options) {
            return this.show(message, 'warning', duration, options);
        },

        persist(message, type = 'info', options = {}) {
            return this.show(message, type, 0, { ...options, dismissible: true });
        },

        dismiss(id) {
            return this._remove(id, true);
        },

        dismissAll() {
            const ids = Array.from(this._toasts.keys());
            ids.forEach(id => this._remove(id, false));
            return this;
        },

        clear() {
            return this.dismissAll();
        },

        update(id, message, options = {}) {
            const toast = this._toasts.get(id);
            if (!toast) return false;

            if (message != null) {
                toast.message = message;
                if (toast.messageEl) toast.messageEl.textContent = String(message);
            }

            if (options.type && this.types[options.type]) {
                const oldCls = this.types[toast.type]?.className;
                const newCls = this.types[options.type].className;
                if (oldCls) toast.element.classList.remove(oldCls);
                if (newCls) toast.element.classList.add(newCls);
                toast.type = options.type;

                const role = this.types[options.type].role || 'status';
                toast.element.setAttribute('role', role);
            }

            if (options.duration != null) {
                if (toast.timer) clearTimeout(toast.timer);
                toast.options.duration = options.duration;
                if (options.duration > 0) {
                    toast.timer = setTimeout(() => this._remove(id, true), options.duration);
                    if (toast.progressInner) {
                        toast.progressInner.style.animationDuration = `${options.duration}ms`;
                        toast.progressInner.style.animation = 'none';
                        void toast.progressInner.offsetWidth;
                        toast.progressInner.style.animation = '';
                    }
                }
            }

            return true;
        },

        exists(id) {
            return this._toasts.has(id);
        },

        getElement(id) {
            return this._toasts.get(id)?.element || null;
        },

        count() {
            return this._toasts.size;
        },

        _buildToast(id, message, type, opts) {
            const el = document.createElement('div');
            el.className = `toaster-notification ${opts.animation} ${opts.className || ''}`.trim();
            el.setAttribute('role', opts.role || 'status');
            el.setAttribute('aria-live', opts.ariaLive);
            el.setAttribute('aria-atomic', 'true');
            el.setAttribute('data-toaster-id', String(id));
            el.style.zIndex = String(opts.zIndex + id);

            // Message
            const msgEl = document.createElement('span');
            msgEl.className = 'toaster-message';
            msgEl.textContent = String(message);
            el.appendChild(msgEl);

            // Progress bar
            let progressEl = null;
            let progressInner = null;
            if (opts.showProgress && opts.duration > 0) {
                progressEl = document.createElement('div');
                progressEl.className = 'toaster-progress';
                progressInner = document.createElement('div');
                progressInner.className = 'toaster-progress-bar';
                progressInner.style.animationDuration = `${opts.duration}ms`;
                progressEl.appendChild(progressInner);
                el.appendChild(progressEl);
            }

            // Close button
            if (opts.dismissible) {
                const closeBtn = document.createElement('button');
                closeBtn.className = 'toaster-close';
                closeBtn.setAttribute('aria-label', 'Dismiss notification');
                closeBtn.setAttribute('type', 'button');
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._remove(id, true);
                });

                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '14');
                svg.setAttribute('height', '14');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'currentColor');
                svg.setAttribute('stroke-width', '2');
                svg.setAttribute('stroke-linecap', 'round');
                svg.setAttribute('stroke-linejoin', 'round');
                svg.setAttribute('aria-hidden', 'true');

                const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line1.setAttribute('x1', '18');
                line1.setAttribute('y1', '6');
                line1.setAttribute('x2', '6');
                line1.setAttribute('y2', '18');

                const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line2.setAttribute('x1', '6');
                line2.setAttribute('y1', '6');
                line2.setAttribute('x2', '18');
                line2.setAttribute('y2', '18');

                svg.appendChild(line1);
                svg.appendChild(line2);
                closeBtn.appendChild(svg);
                el.appendChild(closeBtn);
            }

            // Pause on hover
            if (opts.pauseOnHover && opts.duration > 0) {
                let remaining = opts.duration;
                let startTime = Date.now();

                el.addEventListener('mouseenter', () => {
                    if (toast.timer) {
                        clearTimeout(toast.timer);
                        toast.timer = null;
                        remaining -= (Date.now() - startTime);
                        if (progressInner) progressInner.style.animationPlayState = 'paused';
                    }
                });

                el.addEventListener('mouseleave', () => {
                    if (!toast.timer && remaining > 0) {
                        startTime = Date.now();
                        toast.timer = setTimeout(() => this._remove(id, true), remaining);
                        if (progressInner) progressInner.style.animationPlayState = 'running';
                    }
                });
            }

            const toast = {
                id,
                element: el,
                messageEl: msgEl,
                progressInner,
                message: String(message),
                type,
                options: opts,
                visible: false,
                timer: null
            };

            return toast;
        },

        _mount(toast) {
            const container = this._getContainer(toast.options.position);
            container.appendChild(toast.element);

            // Force reflow for transition
            void toast.element.offsetWidth;

            requestAnimationFrame(() => {
                toast.element.classList.add('toaster-visible');
                toast.visible = true;
            });
        },

        _remove(id, animate = true) {
            const toast = this._toasts.get(id);
            if (!toast) return false;

            if (toast.timer) {
                clearTimeout(toast.timer);
                toast.timer = null;
            }

            if (!toast.visible) {
                this._toasts.delete(id);
                return true;
            }

            toast.visible = false;
            const el = toast.element;

            if (!animate) {
                this._purge(toast);
                return true;
            }

            el.classList.remove('toaster-visible');
            el.classList.add('toaster-exit');

            const done = (e) => {
                if (e && e.target !== el) return;
                el.removeEventListener('animationend', done);
                el.removeEventListener('transitionend', done);
                this._purge(toast);
            };

            el.addEventListener('animationend', done, { once: true });
            el.addEventListener('transitionend', done, { once: true });

            // Fallback cleanup if transition/animation fails
            setTimeout(() => {
                if (this._toasts.has(id) && !this._toasts.get(id).visible) {
                    this._purge(toast);
                }
            }, 500);

            return true;
        },

        _purge(toast) {
            if (toast.element.parentNode) {
                toast.element.parentNode.removeChild(toast.element);
            }
            this._toasts.delete(toast.id);
            this._cleanupContainer(toast.options.position);

            if (typeof toast.options.onDismiss === 'function') {
                try { toast.options.onDismiss(toast.element, toast.id); } catch (e) { console.error(e); }
            }
        },

        _getContainer(position) {
            if (this._containers.has(position)) {
                return this._containers.get(position);
            }

            const container = document.createElement('div');
            container.className = `toaster-container toaster-position-${position.replace(/[^a-z-]/g, '')}`;
            container.setAttribute('aria-live', 'polite');
            container.setAttribute('aria-atomic', 'false');

            const styles = this._positionStyles(position);
            Object.assign(container.style, styles);

            document.body.appendChild(container);
            this._containers.set(position, container);
            return container;
        },

        _cleanupContainer(position) {
            const container = this._containers.get(position);
            if (container && !container.hasChildNodes()) {
                if (container.parentNode) container.parentNode.removeChild(container);
                this._containers.delete(position);
            }
        },

        _positionStyles(position) {
            const s = {
                position: 'fixed',
                display: 'flex',
                gap: this.defaults.gap,
                zIndex: String(this.defaults.zIndex),
                pointerEvents: 'none',
                maxWidth: 'calc(100vw - 2rem)',
                margin: '0',
                padding: '0',
                border: 'none',
                background: 'transparent',
                boxSizing: 'border-box'
            };

            switch (position) {
                case 'top-left':
                    s.top = this.defaults.offsetY;
                    s.left = this.defaults.offsetX;
                    s.flexDirection = 'column';
                    s.alignItems = 'flex-start';
                    break;
                case 'top-center':
                    s.top = this.defaults.offsetY;
                    s.left = '50%';
                    s.transform = 'translateX(-50%)';
                    s.flexDirection = 'column';
                    s.alignItems = 'center';
                    break;
                case 'top-right':
                    s.top = this.defaults.offsetY;
                    s.right = this.defaults.offsetX;
                    s.flexDirection = 'column';
                    s.alignItems = 'flex-end';
                    break;
                case 'bottom-left':
                    s.bottom = this.defaults.offsetY;
                    s.left = this.defaults.offsetX;
                    s.flexDirection = 'column-reverse';
                    s.alignItems = 'flex-start';
                    break;
                case 'bottom-right':
                    s.bottom = this.defaults.offsetY;
                    s.right = this.defaults.offsetX;
                    s.flexDirection = 'column-reverse';
                    s.alignItems = 'flex-end';
                    break;
                case 'bottom-center':
                default:
                    s.bottom = this.defaults.offsetY;
                    s.left = '50%';
                    s.transform = 'translateX(-50%)';
                    s.flexDirection = 'column-reverse';
                    s.alignItems = 'center';
            }

            return s;
        },

        _injectStyles() {
            if (this._stylesInjected) return;
            if (typeof document === 'undefined') return;

            const id = 'toaster-styles';
            if (document.getElementById(id)) {
                this._stylesInjected = true;
                return;
            }

            const css = `
                .toaster-container { pointer-events: none !important; }
                .toaster-container > * { pointer-events: auto; }

                .toaster-notification {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0.625rem 1rem;
                    border-radius: 9999px;
                    font-size: 0.875rem;
                    font-weight: 600;
                    line-height: 1.4;
                    border: 1px solid rgba(0,0,0,0.1);
                    box-shadow: 0 4px 16px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(255,255,255,0.2);
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                    min-width: 200px;
                    max-width: 380px;
                    width: max-content;
                    text-align: center;
                    justify-content: center;
                    position: relative;
                    overflow: hidden;
                    opacity: 0;
                    transform: translateY(10px) scale(0.97);
                    transition: opacity 160ms cubic-bezier(0.2,0.8,0.2,1),
                                transform 160ms cubic-bezier(0.2,0.8,0.2,1);
                    font-family: var(--font-family); -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                                 Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                    word-break: break-word;
                }

                .toaster-notification.toaster-visible {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }

                .toaster-notification.toaster-exit {
                    opacity: 0;
                    transform: translateY(8px) scale(0.96);
                    transition: opacity 160ms cubic-bezier(0.2,0.8,0.2,1),
                                transform 160ms cubic-bezier(0.2,0.8,0.2,1);
                }

                .toaster-notification.fade {
                    transform: scale(0.97);
                }
                .toaster-notification.fade.toaster-visible {
                    transform: scale(1);
                }
                .toaster-notification.fade.toaster-exit {
                    transform: scale(0.96);
                }

                .toaster-notification.scale {
                    transform: scale(0.9);
                }
                .toaster-notification.scale.toaster-visible {
                    transform: scale(1);
                }
                .toaster-notification.scale.toaster-exit {
                    transform: scale(0.9);
                }

                .toaster-type-success {
                    background-color: rgba(52,199,89,0.25);
                    color: #1a5a2a;
                    border-color: rgba(52,199,89,0.5);
                }
                .toaster-type-error {
                    background-color: rgba(255,59,48,0.25);
                    color: #8b1a0f;
                    border-color: rgba(255,59,48,0.5);
                }
                .toaster-type-info {
                    background-color: rgba(0,122,255,0.22);
                    color: #003d99;
                    border-color: rgba(0,122,255,0.5);
                }
                .toaster-type-warning {
                    background-color: rgba(255,204,0,0.25);
                    color: #664400;
                    border-color: rgba(255,204,0,0.5);
                }

                @media (prefers-color-scheme: dark) {
                    .toaster-type-success {
                        background-color: rgba(48,209,88,0.25);
                        color: #b3f0c9;
                        border-color: rgba(48,209,88,0.5);
                    }
                    .toaster-type-error {
                        background-color: rgba(255,69,58,0.25);
                        color: #ffb3ad;
                        border-color: rgba(255,69,58,0.5);
                    }
                    .toaster-type-info {
                        background-color: rgba(10,132,255,0.22);
                        color: #80b8ff;
                        border-color: rgba(10,132,255,0.5);
                    }
                    .toaster-type-warning {
                        background-color: rgba(255,214,10,0.25);
                        color: #ffe680;
                        border-color: rgba(255,214,10,0.5);
                    }
                }

                .toaster-close {
                    background: none;
                    border: none;
                    cursor: pointer;
                    color: inherit;
                    opacity: 0.6;
                    line-height: 1;
                    padding: 0 0 0 0.25rem;
                    flex-shrink: 0;
                    transition: opacity 160ms;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    outline: none;
                    border-radius: 4px;
                    margin: -2px -4px -2px 0;
                }
                .toaster-close:hover { opacity: 1; }
                .toaster-close:focus-visible {
                    box-shadow: 0 0 0 2px currentColor;
                    opacity: 1;
                }
                .toaster-close svg {
                    width: 12px;
                    height: 12px;
                    display: block;
                }

                .toaster-message {
                    flex: 1 1 auto;
                    overflow-wrap: anywhere;
                }

                .toaster-progress {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    height: 3px;
                    background: rgba(0,0,0,0.08);
                    border-radius: 0 0 9999px 9999px;
                    overflow: hidden;
                }
                .toaster-progress-bar {
                    height: 100%;
                    background: currentColor;
                    opacity: 0.35;
                    width: 100%;
                    transform-origin: left;
                    animation: toaster-progress linear forwards;
                }
                @keyframes toaster-progress {
                    from { transform: scaleX(1); }
                    to   { transform: scaleX(0); }
                }

                @media (prefers-reduced-motion: reduce) {
                    .toaster-notification,
                    .toaster-notification.toaster-visible,
                    .toaster-notification.toaster-exit {
                        transition: none !important;
                        animation: none !important;
                        transform: none !important;
                        opacity: 1 !important;
                    }
                    .toaster-progress-bar {
                        animation: none !important;
                        display: none;
                    }
                }
            `;

            const style = document.createElement('style');
            style.id = id;
            style.textContent = css;
            document.head.appendChild(style);
            this._stylesInjected = true;
        }
    };

    // Auto-init when DOM is ready
    if (typeof document !== 'undefined') {
        const ready = () => Toaster.init();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', ready, { once: true });
        } else {
            ready();
        }
    }

    global.Toaster = Toaster;

})(typeof window !== 'undefined' ? window : this);