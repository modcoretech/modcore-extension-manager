/**
 * sc-core.js — modcore Safety Center Core Layer
 * Shared utilities, constants, permission database, scoring engine, popup system.
 */
(function (global) {
    'use strict';

    /* ========================================================================
       1. CONSTANTS
       ======================================================================== */
    const PERMISSIONS_JSON_CANDIDATES = [
        '../data/permissions.json',
        '../../data/permissions.json',
        'data/permissions.json'
    ];

    const SUPPORT_API_URL = 'https://raw.githubusercontent.com/modcoretech/api/main/modcoreEM/support-data.json';
    const SUPPORT_CACHE_KEY = '_mc_support_data_v2';
    const SUPPORT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

    const RISK_LEVELS = Object.freeze({
        excellent: {
            scoreMin: 85,
            class: 'risk-excellent',
            label: 'Excellent',
            description: 'This extension requests minimal permissions and demonstrates exceptional respect for your security and privacy. Safe for use.'
        },
        good: {
            scoreMin: 70,
            class: 'risk-good',
            label: 'Good',
            description: 'Requests standard permissions appropriate for its functionality. Generally safe with acceptable privacy practices.'
        },
        moderate: {
            scoreMin: 50,
            class: 'risk-moderate',
            label: 'Moderate',
            description: 'Requests permissions that warrant review. Verify the extensions purpose aligns with requested capabilities.'
        },
        concerning: {
            scoreMin: 30,
            class: 'risk-concerning',
            label: 'Concerning',
            description: 'Requests sensitive permissions that could impact privacy or security. Carefully evaluate necessity before use.'
        },
        'high-risk': {
            scoreMin: 0,
            class: 'risk-high-risk',
            label: 'High Risk',
            description: 'Requests extensive permissions with significant security and privacy implications. Only install from thoroughly trusted sources.'
        }
    });

    const LEVEL_ORDER = Object.freeze(['critical', 'high', 'moderate', 'low']);

    const LEVEL_LABELS = Object.freeze({
        critical: 'Critical Risk',
        high: 'High Risk',
        moderate: 'Moderate Risk',
        low: 'Standard'
    });

    const LEVEL_PILL_MAP = Object.freeze({
        critical: 'risk-high-risk',
        high: 'risk-high-risk',
        moderate: 'risk-moderate',
        low: 'risk-good'
    });

    const JSON_TO_INTERNAL = Object.freeze({
        low: 'low',
        medium: 'moderate',
        high: 'high',
        varies: 'moderate'
    });

    const LEVEL_BASE_IMPACT = Object.freeze({
        critical: { security: 90, privacy: 85 },
        high: { security: 65, privacy: 70 },
        moderate: { security: 35, privacy: 38 },
        low: { security: 8, privacy: 8 }
    });

    const CATEGORY_ORDER = Object.freeze(['high-risk', 'concerning', 'moderate', 'good', 'excellent']);

    /* ========================================================================
       2. STATE
       ======================================================================== */
    let permDB = {};
    let permCats = {};
    let permRiskMeta = {};
    let supportDataCache = null;

    /* ========================================================================
       3. DOM UTILITIES
       ======================================================================== */
    const $ = id => document.getElementById(id);

    function clearEl(el) {
        while (el.firstChild) el.removeChild(el.firstChild);
    }

    function createEl(tag, opts = {}) {
        const el = document.createElement(tag);
        if (opts.className) el.className = opts.className;
        if (opts.id) el.id = opts.id;
        if (opts.text != null) el.textContent = String(opts.text);
        if (opts.attrs) {
            Object.entries(opts.attrs).forEach(([k, v]) => el.setAttribute(k, v));
        }
        if (opts.events) {
            Object.entries(opts.events).forEach(([evt, handler]) => {
                el.addEventListener(evt, handler);
            });
        }
        if (opts.children) {
            opts.children.forEach(child => {
                if (child) el.appendChild(child);
            });
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

    function capitalise(str) {
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
    }

    /* ========================================================================
       4. DATA LOADING — Permissions DB
       ======================================================================== */
    async function loadPermissionsDB() {
        for (const url of PERMISSIONS_JSON_CANDIDATES) {
            try {
                const r = await fetch(url);
                if (r.ok) {
                    const d = await r.json();
                    permDB = d.permissions || {};
                    permCats = d.categories || {};
                    permRiskMeta = d.riskLevels || {};
                    return;
                }
            } catch (_) { /* try next candidate */ }
        }
        console.warn('[SafetyCenter] permissions.json not loaded');
    }

    /* ========================================================================
       5. SUPPORT DEVELOPER API — Cached 24h
       ======================================================================== */
    async function loadSupportData() {
        if (supportDataCache) return supportDataCache;

        try {
            const raw = localStorage.getItem(SUPPORT_CACHE_KEY);
            if (raw) {
                const cached = JSON.parse(raw);
                if (cached.ts && (Date.now() - cached.ts) < SUPPORT_CACHE_TTL_MS) {
                    supportDataCache = cached.data;
                    return supportDataCache;
                }
            }
        } catch (_) { /* invalid cache */ }

        try {
            const r = await fetch(SUPPORT_API_URL, { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            supportDataCache = data;

            try {
                localStorage.setItem(SUPPORT_CACHE_KEY, JSON.stringify({
                    ts: Date.now(),
                    data
                }));
            } catch (_) { /* storage full or private mode */ }

            return data;
        } catch (err) {
            console.warn('[SafetyCenter] Support API fetch failed:', err);
            try {
                const raw = localStorage.getItem(SUPPORT_CACHE_KEY);
                if (raw) {
                    const cached = JSON.parse(raw);
                    supportDataCache = cached.data;
                    return supportDataCache;
                }
            } catch (_) {}
            return { schemaVersion: 2, extensions: [] };
        }
    }

    function findSupportEntry(extId) {
        if (!supportDataCache || !supportDataCache.extensions) return null;
        return supportDataCache.extensions.find(e => e.id === extId) || null;
    }

    /* ========================================================================
       6. PERMISSION RESOLVER
       ======================================================================== */
    function getPermInfo(permission, isHost = false) {
        if (isHost) {
            const base = permDB['<<all_urls>'] || permDB['host_permissions'] || {};
            let riskLevel = 'varies';
            let description = 'Access specific websites or patterns.';

            if (permission === '<all_urls>') {
                riskLevel = 'high';
                description = 'Access data and modify behavior on ALL websites you visit.';
            } else if (permission.includes('*')) {
                riskLevel = 'medium';
                description = `Access websites matching pattern: "${permission}". Can read and change data on matching sites.`;
            } else {
                riskLevel = 'low';
                description = `Access specific site: "${permission}". Can read and change data on this site.`;
            }

            return {
                level: JSON_TO_INTERNAL[riskLevel] || 'moderate',
                rawLevel: riskLevel,
                security_impact: riskLevel === 'high' ? 80 : riskLevel === 'medium' ? 50 : 15,
                privacy_impact: riskLevel === 'high' ? 75 : riskLevel === 'medium' ? 45 : 12,
                type: 'host',
                categories: (base.category || ['functionality']).map(c => permCats[c]?.name || capitalise(c)),
                description: description,
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

        let entry = permDB[permission];
        if (!entry) {
            if (/^https?:\/\/\*/.test(permission) || permission === '<all_urls>') {
                entry = permDB['<<all_urls>'] || permDB['host_permissions'];
            }
        }

        if (entry) {
            const jsonLevel = entry.riskLevel || 'low';
            const internalLvl = JSON_TO_INTERNAL[jsonLevel] || 'low';
            const cats = Array.isArray(entry.category) ? entry.category : [entry.category || 'functionality'];

            let secImpact = LEVEL_BASE_IMPACT[internalLvl].security;
            let privImpact = LEVEL_BASE_IMPACT[internalLvl].privacy;
            const hasPriv = cats.includes('privacy') || cats.includes('data');
            const hasSec = cats.includes('security');
            if (hasPriv) privImpact = Math.min(100, privImpact * 1.25);
            if (hasSec) secImpact = Math.min(100, secImpact * 1.25);

            return {
                level: internalLvl,
                rawLevel: jsonLevel,
                security_impact: secImpact,
                privacy_impact: privImpact,
                type: 'api',
                categories: cats.map(c => permCats[c]?.name || capitalise(c)),
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

        return {
            level: 'moderate',
            rawLevel: 'medium',
            security_impact: 45,
            privacy_impact: 45,
            type: 'api',
            categories: ['Unclassified'],
            description: 'Unrecognised permission. Exercise caution as impact cannot be determined without additional analysis.',
            shortDescription: 'Unknown permission',
            link: null,
            requiresHost: false,
            mv3Compatible: true,
            commonUseCases: [],
            mitigationTips: [],
            displayName: permission
        };
    }

    /* ========================================================================
       7. SCORING ENGINE
       ======================================================================== */
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

        let totalSec = 0, totalPriv = 0;
        const breakdown = [];

        const sorted = [...all].sort((a, b) => {
            const ia = getPermInfo(a.name, a.isHost);
            const ib = getPermInfo(b.name, b.isHost);
            return (ib.security_impact + ib.privacy_impact) - (ia.security_impact + ia.privacy_impact);
        });

        sorted.forEach((perm, idx) => {
            const info = getPermInfo(perm.name, perm.isHost);
            const dimFactor = Math.pow(0.88, idx);
            const criticalBoost = info.level === 'critical' ? 1.5 : info.level === 'high' ? 1.15 : 1.0;

            const secContrib = info.security_impact * dimFactor * criticalBoost;
            const privContrib = info.privacy_impact * dimFactor * criticalBoost;

            totalSec += secContrib;
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
        const secScore = Math.max(0, Math.min(100, Math.round(100 - (totalSec / maxImpact) * 100)));
        const privScore = Math.max(0, Math.min(100, Math.round(100 - (totalPriv / maxImpact) * 100)));

        const lower = Math.min(secScore, privScore);
        const upper = Math.max(secScore, privScore);
        const overall = Math.round(lower * 0.6 + upper * 0.4);

        let category = 'high-risk';
        for (const [key, lvl] of Object.entries(RISK_LEVELS)) {
            if (overall >= lvl.scoreMin) { category = key; break; }
        }

        return {
            overallScore: overall,
            securityScore: secScore,
            privacyScore: privScore,
            category,
            count: all.length,
            breakdown
        };
    }

    /* ========================================================================
       8. POPUP SYSTEM — Permission Detail Modal
       ======================================================================== */
    const Popup = {
        els: {},

        init() {
            this.els.overlay = $('permission-popup-overlay');
            this.els.popup = $('permission-popup');
            this.els.close = $('permission-popup-close');
            this.els.title = $('permission-popup-title');
            this.els.risk = $('permission-popup-risk');
            this.els.category = $('permission-popup-category');
            this.els.shortDesc = $('permission-popup-short-desc');
            this.els.detailedDesc = $('permission-popup-detailed-desc');
            this.els.useCases = $('permission-popup-use-cases');
            this.els.link = $('permission-popup-link');
            this.els.icon = $('perm-popup-icon');

            this.els.close.addEventListener('click', () => this.close());
            this.els.overlay.addEventListener('click', () => this.close());
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape') this.close();
            });
        },

        open(name, isHost, info) {
            this.close();

            setText(this.els.title, isHost ? `Host: ${name}` : (info.displayName || name));

            const meta = permRiskMeta[info.rawLevel] || {};
            this.els.risk.className = `perm-popup-risk-badge ${LEVEL_PILL_MAP[info.level] || 'risk-moderate'}`;
            setText(this.els.risk, meta.name || `${info.level} risk`);

            const iconLetter = { critical: '!', high: '!', moderate: '~', low: '✓' }[info.level] || '?';
            this.els.icon.textContent = iconLetter;
            this.els.icon.className = `perm-popup-icon ${LEVEL_PILL_MAP[info.level] || 'risk-moderate'}`;

            clearEl(this.els.category);
            info.categories.forEach(cat => {
                this.els.category.appendChild(createEl('span', {
                    className: 'perm-cat-badge',
                    text: cat
                }));
            });

            setText(this.els.shortDesc, info.shortDescription || info.description);
            setText(this.els.detailedDesc, info.detailedDescription || info.description);

            clearEl(this.els.useCases);
            const useCases = info.commonUseCases.length ? info.commonUseCases : ['General extension functionality'];
            useCases.forEach(uc => this.els.useCases.appendChild(createEl('li', { text: uc })));



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
            this.els.overlay.classList.remove('visible');
            this.els.overlay.setAttribute('aria-hidden', 'true');
            this.els.popup.classList.remove('visible');
            document.body.style.overflow = '';
        }
    };

    /* ========================================================================
       9. SCORE COLOR HELPERS
       ======================================================================== */
    function applyScoreColor(circle, score) {
        const varName = score >= 85 ? '--color-score-excellent' :
                        score >= 70 ? '--color-score-good' :
                        score >= 50 ? '--color-score-moderate' :
                        score >= 30 ? '--color-score-concerning' : '--color-score-high-risk';
        const color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        circle.style.background = `conic-gradient(${color || 'var(--color-primary)'} calc(${score} * 1%), var(--color-border-strong) calc(${score} * 1%))`;
    }

    function getScoreArcOffset(score) {
        const circumference = 2 * Math.PI * 34;
        return circumference - (score / 100) * circumference;
    }

    /* ========================================================================
       10. VIEW SWITCHING
       ======================================================================== */
    const Views = {
        els: {},

        init() {
            this.els.dashboard = $('all-extensions-view');
            this.els.single = $('single-extension-view');
            this.els.filtered = $('filtered-extensions-view');
        },

        show(view) {
            this.els.dashboard.hidden = view !== 'dashboard';
            this.els.single.hidden = view !== 'single';
            this.els.filtered.hidden = view !== 'filtered';

            if (view === 'dashboard') {
                const search = $('permission-search-input-inline');
                if (search) search.focus();
            }
        }
    };

    /* ========================================================================
       11. TAB SYSTEM (Hash-based navigation)
       ======================================================================== */
    const Tabs = {
        tabs: [],
        panels: [],

        init(tabIds, panelIds) {
            this.tabs = tabIds.map(id => $(id)).filter(Boolean);
            this.panels = panelIds.map(id => $(id)).filter(Boolean);

            this.tabs.forEach(tab => {
                tab.addEventListener('click', e => {
                    e.preventDefault();
                    this.activate(tab.id.replace('tab-', ''));
                });
                tab.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        this.activate(tab.id.replace('tab-', ''));
                    }
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
                const isActive = panel.id === `panel-${tabName}`;
                panel.hidden = !isActive;
                if (isActive) {
                    panel.classList.add('tab-panel-active');
                } else {
                    panel.classList.remove('tab-panel-active');
                }
            });

            if (window.location.hash !== `#${tabName}`) {
                history.replaceState(null, '', `#${tabName}`);
            }
        },

        syncFromHash() {
            const hash = window.location.hash.replace('#', '');
            const valid = ['security', 'details', 'support'];
            if (valid.includes(hash)) {
                this.activate(hash);
            } else {
                this.activate('security');
            }
        }
    };

    /* ========================================================================
       12. PUBLIC API
       ======================================================================== */
    global.SafetyCenter = {
        RISK_LEVELS,
        LEVEL_ORDER,
        LEVEL_LABELS,
        LEVEL_PILL_MAP,
        CATEGORY_ORDER,

        loadPermissionsDB,
        loadSupportData,
        findSupportEntry,

        getPermInfo,
        calculateScores,

        $,
        createEl,
        clearEl,
        setText,
        debounce,
        capitalise,
        applyScoreColor,
        getScoreArcOffset,

        Popup,
        Views,
        Tabs
    };

    /* ========================================================================
       13. BOOTSTRAP
       ======================================================================== */
    async function bootstrap() {
        try {
            await loadPermissionsDB();
            Views.init();

            if (SafetyCenter.Dashboard) SafetyCenter.Dashboard.init();
            if (SafetyCenter.Report) SafetyCenter.Report.init();

            const params = new URLSearchParams(window.location.search);
            const extensionId = params.get('id');
            const extensions = await chrome.management.getAll();

            if (extensionId) {
                const ext = extensions.find(e => e.id === extensionId);
                if (ext && SafetyCenter.Report) {
                    SafetyCenter.Report.render(ext);
                } else {
                    if (window.Status) window.Status.error('Extension not found');
                    if (SafetyCenter.Dashboard) SafetyCenter.Dashboard.render(extensions);
                }
            } else {
                if (SafetyCenter.Dashboard) SafetyCenter.Dashboard.render(extensions);
            }
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