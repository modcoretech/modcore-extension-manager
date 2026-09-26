/**
 * sc-core.js | modcore Safety Center Core
 * Shared utilities, constants, permission database, scoring engine, popup.
 */
(function (global) {
    'use strict';

    /* Constants */
    const PERMISSIONS_JSON_URL = '../../shared/permissions.json';

    const RISK_LEVELS = Object.freeze({
        excellent: {
            scoreMin: 85,
            class: 'risk-excellent',
            label: 'Excellent',
            description: 'Minimal permissions and exceptional respect for your security and privacy. Safe for use.'
        },
        good: {
            scoreMin: 70,
            class: 'risk-good',
            label: 'Good',
            description: 'Standard permissions appropriate for its functionality. Generally safe with acceptable practices.'
        },
        moderate: {
            scoreMin: 50,
            class: 'risk-moderate',
            label: 'Moderate',
            description: 'Permissions that warrant review. Verify the extension purpose aligns with requested capabilities.'
        },
        concerning: {
            scoreMin: 30,
            class: 'risk-concerning',
            label: 'Concerning',
            description: 'Sensitive permissions that could impact privacy or security. Evaluate necessity carefully.'
        },
        'high-risk': {
            scoreMin: 0,
            class: 'risk-high-risk',
            label: 'High Risk',
            description: 'Extensive permissions with significant security and privacy implications. Only install from trusted sources.'
        }
    });

    const LEVEL_PILL_MAP = Object.freeze({
        high:     'risk-high-risk',
        moderate: 'risk-moderate',
        low:      'risk-good'
    });

    const JSON_TO_INTERNAL = Object.freeze({
        low:    'low',
        medium: 'moderate',
        high:   'high',
        varies: 'moderate'
    });

    const LEVEL_BASE_IMPACT = Object.freeze({
        high:     { security: 65, privacy: 70 },
        moderate: { security: 35, privacy: 38 },
        low:      { security:  8, privacy:  8 }
    });

    const CATEGORY_ORDER = Object.freeze(['high-risk', 'concerning', 'moderate', 'good', 'excellent']);

    const RISK_ICON_LETTER = Object.freeze({ high: '!', moderate: '~', low: '✓' });

    /* State */
    let permDB = {};
    let permCats = {};
    let permRiskMeta = {};

    /* DOM utilities */
    const $ = id => document.getElementById(id);

    function clearEl(el) {
        if (!el) return;
        while (el.firstChild) el.removeChild(el.firstChild);
    }

    function createEl(tag, opts = {}) {
        const el = document.createElement(tag);
        if (opts.className) el.className = opts.className;
        if (opts.id) el.id = opts.id;
        if (opts.text != null) el.textContent = String(opts.text);
        if (opts.attrs) {
            Object.entries(opts.attrs).forEach(([k, v]) => {
                if (v != null) el.setAttribute(k, v);
            });
        }
        if (opts.events) {
            Object.entries(opts.events).forEach(([evt, handler]) => el.addEventListener(evt, handler));
        }
        if (opts.children) {
            opts.children.forEach(child => { if (child) el.appendChild(child); });
        }
        return el;
    }

    function setText(el, text) {
        if (el) el.textContent = text ?? '';
    }

    function debounce(fn, ms) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), ms);
        };
    }

    /* Data loading */
    async function loadPermissionsDB() {
        try {
            const r = await fetch(PERMISSIONS_JSON_URL);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const d = await r.json();
            permDB = d.permissions || {};
            permCats = d.categories || {};
            permRiskMeta = d.riskLevels || {};
        } catch (err) {
            console.warn('[SafetyCenter] permissions.json not loaded:', err.message);
        }
    }

    /* Permission resolver */
    function getPermInfo(permission, isHost = false) {
        if (isHost) return resolveHostPermission(permission);

        let entry = permDB[permission];
        if (!entry && (/^https?:\/\/\*/.test(permission) || permission === '<all_urls>')) {
            entry = permDB['<<all_urls>'] || permDB['host_permissions'];
        }
        if (!entry) return fallbackPerm(permission);

        const jsonLevel = entry.riskLevel || 'low';
        const internalLvl = JSON_TO_INTERNAL[jsonLevel] || 'low';
        const cats = Array.isArray(entry.category) ? entry.category : [entry.category || 'functionality'];

        let secImpact = LEVEL_BASE_IMPACT[internalLvl].security;
        let privImpact = LEVEL_BASE_IMPACT[internalLvl].privacy;
        if (cats.includes('privacy') || cats.includes('data')) privImpact = Math.min(100, privImpact * 1.25);
        if (cats.includes('security')) secImpact = Math.min(100, secImpact * 1.25);

        return {
            level: internalLvl,
            rawLevel: jsonLevel,
            security_impact: secImpact,
            privacy_impact: privImpact,
            type: 'api',
            categories: cats.map(c => permCats[c]?.name || titleCase(c)),
            description: entry.detailedDescription || entry.shortDescription || 'No description available.',
            shortDescription: entry.shortDescription || '',
            detailedDescription: entry.detailedDescription || '',
            link: entry.chromeLink || null,
            requiresHost: entry.requiresHostPermission || false,
            mv3Compatible: entry.mv3Compatible !== false,
            commonUseCases: entry.commonUseCases || [],
            mitigationTips: entry.mitigationTips || [],
            displayName: entry.name || permission
        };
    }

    function resolveHostPermission(permission) {
        const base = permDB['<<all_urls>'] || permDB['host_permissions'] || {};
        let rawLevel = 'varies';
        let description = 'Access specific websites or patterns.';

        if (permission === '<all_urls>') {
            rawLevel = 'high';
            description = 'Access data and modify behavior on ALL websites you visit.';
        } else if (permission.includes('*')) {
            rawLevel = 'medium';
            description = `Access websites matching pattern: "${permission}". Can read and change data on matching sites.`;
        } else {
            rawLevel = 'low';
            description = `Access specific site: "${permission}". Can read and change data on this site.`;
        }

        const secMap  = { high: 80, medium: 50, low: 15 };
        const privMap = { high: 75, medium: 45, low: 12 };

        return {
            level: JSON_TO_INTERNAL[rawLevel] || 'moderate',
            rawLevel,
            security_impact: secMap[rawLevel] || 50,
            privacy_impact: privMap[rawLevel] || 45,
            type: 'host',
            categories: (base.category || ['functionality']).map(c => permCats[c]?.name || titleCase(c)),
            description,
            shortDescription: base.shortDescription || description,
            detailedDescription: base.detailedDescription || 'Host permissions allow extensions to interact with specific websites.',
            link: base.chromeLink || 'https://developer.chrome.com/docs/extensions/mv3/match_patterns/',
            requiresHost: true,
            mv3Compatible: base.mv3Compatible !== false,
            commonUseCases: base.commonUseCases || ['Site-specific enhancements', 'Content modification'],
            mitigationTips: base.mitigationTips || ['Use specific patterns', 'Avoid broad wildcards'],
            displayName: permission
        };
    }

    function fallbackPerm(permission) {
        return {
            level: 'moderate',
            rawLevel: 'medium',
            security_impact: 45,
            privacy_impact: 45,
            type: 'api',
            categories: ['Unclassified'],
            description: 'Unrecognised permission. Exercise caution as impact cannot be determined without additional analysis.',
            shortDescription: 'Unknown permission',
            detailedDescription: 'This permission is not present in the modcore knowledge base.',
            link: null,
            requiresHost: false,
            mv3Compatible: true,
            commonUseCases: [],
            mitigationTips: [],
            displayName: permission
        };
    }

    function titleCase(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /* Scoring */
    function calculateScores(apiPerms, hostPerms) {
        const all = [
            ...(apiPerms || []).map(p => ({ name: p, isHost: false })),
            ...(hostPerms || []).map(p => ({ name: p, isHost: true }))
        ];

        if (all.length === 0) {
            return {
                overallScore: 100,
                securityScore: 100,
                privacyScore: 100,
                category: 'excellent',
                count: 0,
                breakdown: []
            };
        }

        const sorted = [...all].sort((a, b) => {
            const ia = getPermInfo(a.name, a.isHost);
            const ib = getPermInfo(b.name, b.isHost);
            return (ib.security_impact + ib.privacy_impact) - (ia.security_impact + ia.privacy_impact);
        });

        let totalSec = 0;
        let totalPriv = 0;
        const breakdown = [];

        sorted.forEach((perm, idx) => {
            const info = getPermInfo(perm.name, perm.isHost);
            const dimFactor = Math.pow(0.88, idx);
            const levelBoost = info.level === 'high' ? 1.15 : 1.0;

            const secContrib  = info.security_impact * dimFactor * levelBoost;
            const privContrib = info.privacy_impact  * dimFactor * levelBoost;

            totalSec  += secContrib;
            totalPriv += privContrib;

            breakdown.push({
                permission: perm.name,
                isHost: perm.isHost,
                info,
                secContrib: Math.round(secContrib),
                privContrib: Math.round(privContrib)
            });
        });

        const sprawl = Math.min(all.length * 1.8, 25);
        totalSec += sprawl;
        totalPriv += sprawl;

        const maxImpact = 500;
        const secScore  = clamp(Math.round(100 - (totalSec  / maxImpact) * 100), 0, 100);
        const privScore = clamp(Math.round(100 - (totalPriv / maxImpact) * 100), 0, 100);

        const lower = Math.min(secScore, privScore);
        const upper = Math.max(secScore, privScore);
        const overall = Math.round(lower * 0.6 + upper * 0.4);

        return {
            overallScore: overall,
            securityScore: secScore,
            privacyScore: privScore,
            category: categoryForScore(overall),
            count: all.length,
            breakdown
        };
    }

    function categoryForScore(score) {
        for (const [key, lvl] of Object.entries(RISK_LEVELS)) {
            if (score >= lvl.scoreMin) return key;
        }
        return 'high-risk';
    }

    function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

    /* Color helpers */
    const _colorCache = new Map();
    function categoryColor(category) {
        if (_colorCache.has(category)) return _colorCache.get(category);
        const c = getComputedStyle(document.documentElement)
            .getPropertyValue(`--color-score-${category}`).trim() || 'var(--color-primary)';
        _colorCache.set(category, c);
        return c;
    }

    function getScoreArcOffset(score) {
        const circumference = 2 * Math.PI * 42;
        return circumference - (score / 100) * circumference;
    }

    /* Icons */
    function getExtensionIconUrl(ext, minSize = 64) {
        if (!ext.icons || ext.icons.length === 0) return null;
        const sorted = [...ext.icons].sort((a, b) => b.size - a.size);
        const best = sorted.find(i => i.size >= minSize) || sorted[0];
        return best?.url || null;
    }

    /* Popup */
    const Popup = {
        els: {},
        _lastFocus: null,

        init() {
            this.els.overlay      = $('permission-popup-overlay');
            this.els.popup        = $('permission-popup');
            this.els.close        = $('permission-popup-close');
            this.els.title        = $('permission-popup-title');
            this.els.risk         = $('permission-popup-risk');
            this.els.category     = $('permission-popup-category');
            this.els.shortDesc    = $('permission-popup-short-desc');
            this.els.detailedDesc = $('permission-popup-detailed-desc');
            this.els.useCases     = $('permission-popup-use-cases');
            this.els.link         = $('permission-popup-link');
            this.els.icon         = $('perm-popup-icon');

            if (!this.els.popup) return;

            this.els.close.addEventListener('click', () => this.close());
            this.els.overlay.addEventListener('click', () => this.close());
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape') this.close();
            });
        },

        open(name, isHost, info) {
            if (!this.els.popup) return;
            this._lastFocus = document.activeElement;

            setText(this.els.title, isHost ? `Host: ${name}` : (info.displayName || name));

            const meta = permRiskMeta[info.rawLevel] || {};
            this.els.risk.className = `perm-popup-risk-badge ${LEVEL_PILL_MAP[info.level] || 'risk-moderate'}`;
            setText(this.els.risk, meta.name || `${info.level} risk`);

            this.els.icon.textContent = RISK_ICON_LETTER[info.level] || '?';
            this.els.icon.className = `perm-popup-icon ${LEVEL_PILL_MAP[info.level] || 'risk-moderate'}`;

            clearEl(this.els.category);
            const catFrag = document.createDocumentFragment();
            info.categories.forEach(cat => {
                catFrag.appendChild(createEl('span', { className: 'perm-cat-badge', text: cat }));
            });
            this.els.category.appendChild(catFrag);

            setText(this.els.shortDesc, info.shortDescription || info.description);
            setText(this.els.detailedDesc, info.detailedDescription || info.description);

            clearEl(this.els.useCases);
            const useFrag = document.createDocumentFragment();
            const useCases = info.commonUseCases.length ? info.commonUseCases : ['General extension functionality'];
            useCases.forEach(uc => useFrag.appendChild(createEl('li', { text: uc })));
            this.els.useCases.appendChild(useFrag);

            if (info.link) {
                this.els.link.href = info.link;
                this.els.link.hidden = false;
            } else {
                this.els.link.hidden = true;
            }

            this.els.overlay.classList.add('visible');
            this.els.overlay.setAttribute('aria-hidden', 'false');
            this.els.popup.classList.add('visible');
            document.body.style.overflow = 'hidden';
            this.els.close.focus();
        },

        close() {
            if (!this.els.popup || !this.els.popup.classList.contains('visible')) return;
            this.els.overlay.classList.remove('visible');
            this.els.overlay.setAttribute('aria-hidden', 'true');
            this.els.popup.classList.remove('visible');
            document.body.style.overflow = '';
            if (this._lastFocus && typeof this._lastFocus.focus === 'function') {
                this._lastFocus.focus();
                this._lastFocus = null;
            }
        }
    };

    /* View switching */
    const Views = {
        els: {},
        init() {
            this.els.dashboard = $('all-extensions-view');
            this.els.single    = $('single-extension-view');
            this.els.filtered  = $('filtered-extensions-view');
        },
        show(view) {
            this.els.dashboard.hidden = view !== 'dashboard';
            this.els.single.hidden    = view !== 'single';
            this.els.filtered.hidden  = view !== 'filtered';

            if (view === 'dashboard') {
                const search = $('permission-search-input-inline');
                if (search) search.focus();
            }
        }
    };

    /* Tabs */
    const Tabs = {
        tabs: [],
        panels: [],

        init(tabIds, panelIds) {
            this.tabs   = tabIds.map(id => $(id)).filter(Boolean);
            this.panels = panelIds.map(id => $(id)).filter(Boolean);
            if (!this.tabs.length) return;

            this.tabs.forEach(tab => {
                const activate = e => {
                    e.preventDefault();
                    this.activate(tab.id.replace('tab-', ''));
                };
                tab.addEventListener('click', activate);
                tab.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === ' ') activate(e);
                });
            });

            window.addEventListener('hashchange', () => this.syncFromHash());
            this.syncFromHash();
        },

        activate(tabName) {
            this.tabs.forEach(tab => {
                const isActive = tab.id === `tab-${tabName}`;
                tab.setAttribute('aria-selected', String(isActive));
                tab.setAttribute('tabindex', isActive ? '0' : '-1');
            });
            this.panels.forEach(panel => {
                panel.hidden = panel.id !== `panel-${tabName}`;
            });
            if (window.location.hash !== `#${tabName}`) {
                history.replaceState(null, '', `#${tabName}`);
            }
        },

        syncFromHash() {
            const hash = window.location.hash.replace('#', '');
            this.activate(['security', 'details'].includes(hash) ? hash : 'security');
        }
    };

    /* Public API */
    global.SafetyCenter = {
        RISK_LEVELS,
        LEVEL_PILL_MAP,
        CATEGORY_ORDER,

        loadPermissionsDB,
        getPermInfo,
        calculateScores,
        categoryForScore,
        getExtensionIconUrl,
        categoryColor,

        $, createEl, clearEl, setText, debounce,
        getScoreArcOffset,

        Popup, Views, Tabs
    };

    /* Bootstrap */
    async function bootstrap() {
        try {
            await loadPermissionsDB();
            Views.init();

            if (SafetyCenter.Dashboard) SafetyCenter.Dashboard.init();
            if (SafetyCenter.Report)    SafetyCenter.Report.init();

            const params = new URLSearchParams(window.location.search);
            const extensionId = params.get('id');
            const extensions = await chrome.management.getAll();

            if (extensionId) {
                const ext = extensions.find(e => e.id === extensionId);
                if (ext && SafetyCenter.Report) {
                    SafetyCenter.Report.render(ext);
                    return;
                }
                if (window.Status) window.Status.error('Extension not found');
            }
            if (SafetyCenter.Dashboard) SafetyCenter.Dashboard.render(extensions);
        } catch (err) {
            console.error('[SafetyCenter] Bootstrap error:', err);
            if (window.Status) window.Status.error('Failed to load extension data');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }

})(typeof window !== 'undefined' ? window : this);