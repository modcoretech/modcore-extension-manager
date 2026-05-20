(function () {
    'use strict';

    // ─── Constants ───────────────────────────────────────────────────────────
    const PERMISSIONS_JSON_CANDIDATES = [
        '../data/permissions.json',
        '../../data/permissions.json',
        'data/permissions.json'
    ];

    const RISK_LEVELS = {
        excellent:  { scoreMin: 85, class: 'risk-excellent',  label: 'Excellent',  description: 'This extension requests minimal permissions and demonstrates exceptional respect for your security and privacy. Safe for use.' },
        good:       { scoreMin: 70, class: 'risk-good',       label: 'Good',       description: 'Requests standard permissions appropriate for its functionality. Generally safe with acceptable privacy practices.' },
        moderate:   { scoreMin: 50, class: 'risk-moderate',   label: 'Moderate',   description: 'Requests permissions that warrant review. Verify the extension\'s purpose aligns with requested capabilities.' },
        concerning: { scoreMin: 30, class: 'risk-concerning', label: 'Concerning', description: 'Requests sensitive permissions that could impact privacy or security. Carefully evaluate necessity before use.' },
        'high-risk':{ scoreMin: 0,  class: 'risk-high-risk',  label: 'High Risk',  description: 'Requests extensive permissions with significant security and privacy implications. Only install from thoroughly trusted sources.' }
    };

    const LEVEL_ORDER = ['critical', 'high', 'moderate', 'low'];
    const LEVEL_LABELS = {
        critical: 'Critical Risk',
        high: 'High Risk',
        moderate: 'Moderate Risk',
        low: 'Standard'
    };

    const LEVEL_PILL_MAP = {
        critical: 'risk-high-risk',
        high: 'risk-high-risk',
        moderate: 'risk-moderate',
        low: 'risk-good'
    };

    const JSON_TO_INTERNAL = {
        low: 'low', medium: 'moderate', high: 'high', varies: 'moderate'
    };

    const LEVEL_BASE_IMPACT = {
        critical: { security: 90, privacy: 85 },
        high:     { security: 65, privacy: 70 },
        moderate: { security: 35, privacy: 38 },
        low:      { security:  8, privacy:  8 }
    };

    const CAT_WEIGHTS = {
        privacy:       { security: 0.4, privacy: 1.0 },
        security:      { security: 1.0, privacy: 0.5 },
        data:          { security: 0.5, privacy: 0.9 },
        functionality: { security: 0.1, privacy: 0.1 },
        accessibility: { security: 0.2, privacy: 0.2 }
    };

    // ─── State ─────────────────────────────────────────────────────────────────
    let permDB = {};
    let permCats = {};
    let permRiskMeta = {};
    let permFilterState = {
        risk: new Set(['critical', 'high', 'moderate', 'low']),
        type: new Set(['api', 'host']),
        search: ''
    };

    // ─── DOM Refs ──────────────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);

    const els = {};

    function cacheElements() {
        els.allView = $('all-extensions-view');
        els.singleView = $('single-extension-view');
        els.filteredView = $('filtered-extensions-view');

        els.allExtensionsList = $('all-extensions-list');
        els.permissionCountList = $('permission-count-list');
        els.riskRatingList = $('risk-rating-list');
        els.totalCount = $('total-extensions-count');
        els.enabledCount = $('enabled-extensions-count');
        els.highRiskCount = $('high-risk-count');
        els.concerningCount = $('concerning-count');
        els.moderateCount = $('moderate-risk-count');
        els.analyticsSummary = $('analytics-summary');
        els.searchInput = $('permission-search-input');

        els.extensionIcon = $('extension-icon');
        els.extensionName = $('extension-name');
        els.overallScoreValue = $('overall-score-value');
        els.overallScoreCategory = $('overall-score-category');
        els.scoreExplanation = $('score-explanation');
        els.securityScoreGraph = $('security-score-graph');
        els.securityScoreValue = $('security-score-value');
        els.privacyScoreGraph = $('privacy-score-graph');
        els.privacyScoreValue = $('privacy-score-value');
        els.scoreBreakdown = $('score-breakdown');
        els.allPermissionsList = $('all-permissions-list');
        els.permSearchInput = $('perm-search-input');
        els.permFilterBtn = $('perm-filter-btn');
        els.permFilterDropdown = $('perm-filter-dropdown');
        els.backToDash = $('back-to-dashboard-btn');
        els.scoreInfoBtn = $('score-info-btn');
        els.scoreInfoTooltip = $('score-info-tooltip');

        els.filteredList = $('filtered-extensions-list');
        els.filteredHeader = $('filtered-view-header');
        els.filteredSubtitle = $('filtered-view-subtitle');
        els.backFromFiltered = $('back-from-filtered-btn');

        els.toastContainer = $('toast-container');

        els.permPopup = $('permission-popup');
        els.permPopupOverlay = $('permission-popup-overlay');
        els.permPopupClose = $('permission-popup-close');
        els.permPopupTitle = $('permission-popup-title');
        els.permPopupRisk = $('permission-popup-risk');
        els.permPopupCategory = $('permission-popup-category');
        els.permPopupShortDesc = $('permission-popup-short-desc');
        els.permPopupDetailedDesc = $('permission-popup-detailed-desc');
        els.permPopupUseCases = $('permission-popup-use-cases');
        els.permPopupMitigation = $('permission-popup-mitigation');
        els.permPopupLink = $('permission-popup-link');
    }

    // ─── Utilities ─────────────────────────────────────────────────────────────
    const clearEl = el => { while (el.firstChild) el.removeChild(el.firstChild); };

    const createEl = (tag, opts = {}) => {
        const el = document.createElement(tag);
        if (opts.className) el.className = opts.className;
        if (opts.id) el.id = opts.id;
        if (opts.text) el.textContent = opts.text;
        if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    };

    const setText = (el, text) => { if (el) el.textContent = text ?? ''; };

    const debounce = (fn, ms) => {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    };

    // ─── Data Loading ────────────────────────────────────────────────────────────
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
            } catch (_) {}
        }
        console.warn('[SafetyCenter] permissions.json not loaded');
    }

    // ─── Permission Resolver ───────────────────────────────────────────────────
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
            mitigationTips: ['Research this permission before granting'],
            displayName: permission
        };
    }

    function capitalise(str) {
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
    }

    // ─── Scoring ───────────────────────────────────────────────────────────────
    function calculateScores(apiPerms, hostPerms) {
        const all = [
            ...(apiPerms || []).map(p => ({ name: p, isHost: false })),
            ...(hostPerms || []).map(p => ({ name: p, isHost: true }))
        ];

        if (all.length === 0) {
            return {
                overallScore: 100, securityScore: 100, privacyScore: 100,
                category: 'excellent', count: 0, breakdown: []
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

    // ─── UI: Toast ─────────────────────────────────────────────────────────────
    function showToast(message, type = 'info', duration = 3500) {
        const toast = createEl('div', { className: `toast toast-${type}`, attrs: { role: 'alert' } });
        toast.textContent = message;
        els.toastContainer.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('toast-show'));
        setTimeout(() => {
            toast.classList.remove('toast-show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ─── UI: Popup ─────────────────────────────────────────────────────────────
    function showPermPopup(name, isHost, info) {
        closePermPopup();

        setText(els.permPopupTitle, isHost ? `Host: ${name}` : info.displayName || name);

        const meta = permRiskMeta[info.rawLevel] || {};
        els.permPopupRisk.className = `permission-popup-risk risk-${info.rawLevel}`;
        setText(els.permPopupRisk, meta.name || `${info.level} risk`);
        els.permPopupRisk.style.backgroundColor = meta.containerColor || '';
        els.permPopupRisk.style.color = meta.color || '';

        clearEl(els.permPopupCategory);
        info.categories.forEach(cat => {
            els.permPopupCategory.appendChild(createEl('span', { className: 'category-badge', text: cat }));
        });

        setText(els.permPopupShortDesc, info.shortDescription || info.description);
        setText(els.permPopupDetailedDesc, info.detailedDescription || info.description);

        clearEl(els.permPopupUseCases);
        const useCases = info.commonUseCases.length ? info.commonUseCases : ['General extension functionality'];
        useCases.forEach(uc => els.permPopupUseCases.appendChild(createEl('li', { text: uc })));

        clearEl(els.permPopupMitigation);
        const tips = info.mitigationTips.length ? info.mitigationTips : ['Review permission carefully before granting'];
        tips.forEach(tip => els.permPopupMitigation.appendChild(createEl('li', { text: tip })));

        if (info.link) {
            els.permPopupLink.href = info.link;
            els.permPopupLink.hidden = false;
        } else {
            els.permPopupLink.hidden = true;
        }

        els.permPopupOverlay.classList.add('visible');
        els.permPopupOverlay.setAttribute('aria-hidden', 'false');
        els.permPopup.classList.add('visible');
        document.body.style.overflow = 'hidden';
        els.permPopupClose.focus();
    }

    function closePermPopup() {
        els.permPopupOverlay.classList.remove('visible');
        els.permPopupOverlay.setAttribute('aria-hidden', 'true');
        els.permPopup.classList.remove('visible');
        document.body.style.overflow = '';
    }

    // ─── UI: Score Display ─────────────────────────────────────────────────────
    function updateScoreDisplays(scores) {
        const lvl = RISK_LEVELS[scores.category];

        setText(els.overallScoreValue, scores.overallScore);
        els.overallScoreCategory.className = `score-label ${lvl.class}`;
        setText(els.overallScoreCategory, lvl.label);
        setText(els.scoreExplanation, lvl.description);

        setText(els.securityScoreValue, scores.securityScore);
        els.securityScoreGraph.style.setProperty('--score-value', scores.securityScore);
        applyScoreColor(els.securityScoreGraph, scores.securityScore);

        setText(els.privacyScoreValue, scores.privacyScore);
        els.privacyScoreGraph.style.setProperty('--score-value', scores.privacyScore);
        applyScoreColor(els.privacyScoreGraph, scores.privacyScore);
    }

    function applyScoreColor(circle, score) {
        const varName = score >= 85 ? '--color-score-excellent' :
                        score >= 70 ? '--color-score-good'      :
                        score >= 50 ? '--color-score-moderate'  :
                        score >= 30 ? '--color-score-concerning': '--color-score-high-risk';
        const color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        circle.style.background = `conic-gradient(${color || 'var(--color-primary)'} calc(${score} * 1%), var(--color-border-strong) calc(${score} * 1%))`;
    }

    // ─── UI: Permission List (Single View) ───────────────────────────────────
    function renderPermissionsList(apiPerms, hostPerms) {
        clearEl(els.allPermissionsList);

        const all = [
            ...(apiPerms || []).map(p => ({ name: p, isHost: false })),
            ...(hostPerms || []).map(p => ({ name: p, isHost: true }))
        ];

        if (all.length === 0) {
            els.allPermissionsList.appendChild(createEl('p', {
                className: 'no-permissions-message',
                text: 'This extension does not request any special permissions.'
            }));
            return;
        }

        const grouped = { critical: [], high: [], moderate: [], low: [] };
        all.forEach(perm => {
            const info = getPermInfo(perm.name, perm.isHost);
            (grouped[info.level] || grouped.moderate).push(perm);
        });

        LEVEL_ORDER.forEach(level => {
            if (!grouped[level].length) return;

            const section = createEl('details', { className: `permission-category permission-category-${level}` });
            if (level === 'critical' || level === 'high') section.setAttribute('open', 'true');

            const summary = createEl('summary', { className: 'permission-category-summary' });
            const label = createEl('span', { className: 'permission-category-label', text: `${LEVEL_LABELS[level]} Permissions` });
            const count = createEl('span', { className: 'permission-category-count', text: String(grouped[level].length) });
            summary.appendChild(label);
            summary.appendChild(count);
            section.appendChild(summary);

            const list = createEl('ul', { className: 'permission-list' });
            grouped[level].forEach(perm => list.appendChild(createPermItem(perm.name, perm.isHost)));
            section.appendChild(list);
            els.allPermissionsList.appendChild(section);
        });

        applyPermFilters();
    }

    function createPermItem(name, isHost) {
        const info = getPermInfo(name, isHost);

        const item = createEl('li', { className: `permission-item permission-${info.level}` });

        const iconContainer = createEl('div', {
            className: `permission-icon ${LEVEL_PILL_MAP[info.level] || 'risk-moderate'}`
        });
        iconContainer.setAttribute('aria-label', `${info.level} risk`);
        iconContainer.textContent = { critical: '!', high: '!', moderate: '~', low: '✓' }[info.level] || '?';
        item.appendChild(iconContainer);

        const content = createEl('div', { className: 'permission-content' });

        const header = createEl('div', { className: 'permission-header' });
        const titleRow = createEl('div', { className: 'permission-title-row' });

        const title = createEl('h5', { className: 'permission-title', text: info.displayName || name });
        titleRow.appendChild(title);

        const flags = createEl('div', { className: 'permission-flags' });
        if (info.requiresHost) {
            flags.appendChild(createEl('span', {
                className: 'permission-flag permission-flag-host',
                text: 'Needs host access',
                attrs: { title: 'This permission requires host/URL permissions to be effective' }
            }));
        }
        if (!info.mv3Compatible) {
            flags.appendChild(createEl('span', {
                className: 'permission-flag permission-flag-mv2',
                text: 'MV2 only',
                attrs: { title: 'This permission is not compatible with Manifest V3' }
            }));
        }
        if (isHost) {
            flags.appendChild(createEl('span', {
                className: 'permission-flag permission-flag-host',
                text: 'Host',
                attrs: { title: 'Host permission allowing access to websites' }
            }));
        }
        if (flags.children.length) titleRow.appendChild(flags);

        const rightSide = createEl('div', { className: 'permission-right' });

        const badges = createEl('div', { className: 'permission-badges' });
        info.categories.forEach(cat => {
            badges.appendChild(createEl('span', { className: 'permission-badge', text: cat }));
        });
        rightSide.appendChild(badges);

        if (info.link) {
            const link = createEl('a', {
                className: 'permission-link',
                attrs: { href: info.link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `View ${name} documentation` }
            });
            link.textContent = 'Docs';
            rightSide.appendChild(link);
        }

        const moreBtn = createEl('button', {
            className: 'btn secondary btn-sm',
            attrs: { type: 'button', 'aria-label': `More details about ${name}` }
        });
        moreBtn.textContent = 'More info';
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showPermPopup(name, isHost, info);
        });
        rightSide.appendChild(moreBtn);

        header.appendChild(titleRow);
        header.appendChild(rightSide);
        content.appendChild(header);

        const desc = createEl('p', { className: 'permission-description', text: info.description });
        content.appendChild(desc);

        if (info.commonUseCases.length || info.mitigationTips.length) {
            const extras = createEl('details', { className: 'permission-extras' });
            extras.appendChild(createEl('summary', { text: 'Details & tips' }));

            const extBody = createEl('div', { className: 'permission-extras-body' });

            if (info.commonUseCases.length) {
                extBody.appendChild(createEl('p', { className: 'permission-extras-label', text: 'Common use cases' }));
                const ucList = createEl('ul', { className: 'permission-extras-list' });
                info.commonUseCases.forEach(uc => ucList.appendChild(createEl('li', { text: uc })));
                extBody.appendChild(ucList);
            }

            if (info.mitigationTips.length) {
                extBody.appendChild(createEl('p', { className: 'permission-extras-label', text: 'What to watch for' }));
                const tList = createEl('ul', { className: 'permission-extras-list permission-extras-list-tips' });
                info.mitigationTips.forEach(tip => tList.appendChild(createEl('li', { text: tip })));
                extBody.appendChild(tList);
            }

            extras.appendChild(extBody);
            content.appendChild(extras);
        }

        item.appendChild(iconContainer);
        item.appendChild(content);

        item.dataset.permName = name.toLowerCase();
        item.dataset.permRisk = info.level;
        item.dataset.permType = isHost ? 'host' : 'api';
        item.dataset.permText = `${name} ${info.description} ${info.categories.join(' ')}`.toLowerCase();

        return item;
    }

    // ─── Permission Filtering ──────────────────────────────────────────────────
    function setupPermFilters() {
        if (!els.permSearchInput) return;

        const debounced = debounce(() => {
            permFilterState.search = els.permSearchInput.value.trim().toLowerCase();
            applyPermFilters();
        }, 150);

        els.permSearchInput.addEventListener('input', debounced);

        els.permFilterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = !els.permFilterDropdown.hidden;
            closeAllDropdowns();
            if (!isOpen) {
                els.permFilterDropdown.hidden = false;
                els.permFilterBtn.setAttribute('aria-expanded', 'true');
            } else {
                els.permFilterBtn.setAttribute('aria-expanded', 'false');
            }
        });

        els.permFilterDropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                updatePermFilterState();
                applyPermFilters();
            });
        });

        document.addEventListener('click', (e) => {
            if (!els.permFilterDropdown.hidden) {
                const wrapper = els.permFilterBtn?.closest('.permissions-filters');
                if (wrapper && !wrapper.contains(e.target)) {
                    closeAllDropdowns();
                }
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeAllDropdowns();
        });
    }

    function updatePermFilterState() {
        permFilterState.risk.clear();
        permFilterState.type.clear();

        els.permFilterDropdown.querySelectorAll('input[name="risk-filter"]:checked').forEach(cb => permFilterState.risk.add(cb.value));
        els.permFilterDropdown.querySelectorAll('input[name="type-filter"]:checked').forEach(cb => permFilterState.type.add(cb.value));
    }

    function applyPermFilters() {
        const { search, risk, type } = permFilterState;
        const items = els.allPermissionsList.querySelectorAll('.permission-item');
        let visible = 0;

        items.forEach(item => {
            const matchesSearch = !search ||
                item.dataset.permName.includes(search) ||
                item.dataset.permText.includes(search);
            const matchesRisk = risk.has(item.dataset.permRisk);
            const matchesType = type.has(item.dataset.permType);

            const show = matchesSearch && matchesRisk && matchesType;
            item.style.display = show ? '' : 'none';
            if (show) visible++;
        });

        els.allPermissionsList.querySelectorAll('.permission-category').forEach(cat => {
            const list = cat.querySelector('.permission-list');
            const hasVisible = Array.from(list.children).some(li => li.style.display !== 'none');
            cat.style.display = hasVisible ? '' : 'none';
        });

        let emptyMsg = els.allPermissionsList.querySelector('.no-permissions-message');
        if (visible === 0 && items.length > 0) {
            if (!emptyMsg) {
                emptyMsg = createEl('p', { className: 'no-permissions-message', text: 'No permissions match your filters.' });
                els.allPermissionsList.insertBefore(emptyMsg, els.allPermissionsList.firstChild);
            }
        } else if (emptyMsg) {
            emptyMsg.remove();
        }
    }

    function closeAllDropdowns() {
        if (els.permFilterDropdown) {
            els.permFilterDropdown.hidden = true;
            els.permFilterBtn.setAttribute('aria-expanded', 'false');
        }
    }

    // ─── UI: Score Breakdown ───────────────────────────────────────────────────
    function renderScoreBreakdown(scores) {
        clearEl(els.scoreBreakdown);

        if (!scores.breakdown || scores.breakdown.length === 0) {
            els.scoreBreakdown.appendChild(createEl('p', { className: 'score-breakdown-empty', text: 'No permissions to analyse.' }));
            return;
        }

        const top = [...scores.breakdown]
            .sort((a, b) => (b.secContrib + b.privContrib) - (a.secContrib + a.privContrib))
            .slice(0, 6);

        top.forEach(({ permission, info }) => {
            const row = createEl('div', { className: `score-breakdown-row score-breakdown-${info.level}` });
            row.appendChild(createEl('span', { className: 'score-breakdown-label', text: permission }));
            row.appendChild(createEl('span', {
                className: `score-breakdown-pill ${LEVEL_PILL_MAP[info.level] || 'risk-moderate'}`,
                text: info.level
            }));
            els.scoreBreakdown.appendChild(row);
        });
    }

    // ─── UI: Extension Card ────────────────────────────────────────────────────
    function createExtensionCard(ext) {
        const scores = calculateScores(ext.permissions, ext.hostPermissions);
        const lvl = RISK_LEVELS[scores.category];

        const card = createEl('li', {
            className: 'extension-card',
            attrs: { tabindex: '0', role: 'button', 'aria-label': `View ${ext.name} details` }
        });

        card.addEventListener('click', () => {
            window.location.href = `safety-center.html?id=${ext.id}`;
        });
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                window.location.href = `safety-center.html?id=${ext.id}`;
            }
        });

        const iconWrapper = createEl('div', { className: 'extension-card-icon-wrapper' });
        const icon = createEl('img', {
            className: 'extension-card-icon',
            attrs: {
                src: ext.icons?.[0]?.url || '../../public/icons/svg/code.svg',
                alt: '',
                loading: 'lazy'
            }
        });
        icon.onerror = () => { icon.src = '../../public/icons/svg/code.svg'; };
        iconWrapper.appendChild(icon);

        const content = createEl('div', { className: 'extension-card-content' });
        const name = createEl('h3', { className: 'extension-card-name', text: ext.name });
        const meta = createEl('div', { className: 'extension-card-meta' });

        const count = (ext.permissions?.length || 0) + (ext.hostPermissions?.length || 0);
        meta.appendChild(createEl('span', {
            className: 'extension-card-permissions',
            text: `${count} permission${count !== 1 ? 's' : ''}`
        }));

        if (!ext.enabled) {
            meta.appendChild(createEl('span', { className: 'extension-card-disabled-badge', text: 'Disabled' }));
        }

        content.appendChild(name);
        content.appendChild(meta);

        const scoreDisplay = createEl('div', { className: 'extension-card-score' });
        const scoreValue = createEl('div', {
            className: `extension-card-score-value ${lvl.class}`,
            text: String(scores.overallScore),
            attrs: { 'aria-label': `Score: ${scores.overallScore}` }
        });
        const scoreLabel = createEl('div', { className: 'extension-card-score-label', text: lvl.label });

        scoreDisplay.appendChild(scoreValue);
        scoreDisplay.appendChild(scoreLabel);

        card.appendChild(iconWrapper);
        card.appendChild(content);
        card.appendChild(scoreDisplay);

        card.dataset.name = ext.name.toLowerCase();
        card.dataset.category = scores.category;
        card.dataset.permissions = [
            ...(ext.permissions || []),
            ...(ext.hostPermissions || [])
        ].join(',').toLowerCase();

        return card;
    }

    // ─── UI: Dashboard ─────────────────────────────────────────────────────────
    function renderDashboard(extensions) {
        showView('dashboard');
        clearEl(els.allExtensionsList);

        const enabled = extensions.filter(e => e.enabled);
        const stats = {
            total: extensions.length,
            enabled: enabled.length,
            categories: { excellent: 0, good: 0, moderate: 0, concerning: 0, 'high-risk': 0 },
            permissions: {}
        };

        const categoryOrder = ['high-risk', 'concerning', 'moderate', 'good', 'excellent'];
        const sorted = [...enabled].sort((a, b) => {
            const sa = calculateScores(a.permissions, a.hostPermissions);
            const sb = calculateScores(b.permissions, b.hostPermissions);
            const oi = categoryOrder.indexOf(sa.category);
            const oj = categoryOrder.indexOf(sb.category);
            if (oi !== oj) return oi - oj;
            return a.name.localeCompare(b.name);
        });

        sorted.forEach(ext => {
            const scores = calculateScores(ext.permissions, ext.hostPermissions);
            stats.categories[scores.category]++;
            [...(ext.permissions || []), ...(ext.hostPermissions || [])].forEach(p => {
                stats.permissions[p] = (stats.permissions[p] || 0) + 1;
            });
            els.allExtensionsList.appendChild(createExtensionCard(ext));
        });

        extensions.filter(e => !e.enabled)
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(ext => els.allExtensionsList.appendChild(createExtensionCard(ext)));

        setText(els.totalCount, stats.total);
        setText(els.enabledCount, stats.enabled);
        setText(els.highRiskCount, stats.categories['high-risk']);
        setText(els.concerningCount, stats.categories.concerning);
        setText(els.moderateCount, stats.categories.moderate);

        renderPermissionCounts(stats.permissions, extensions);
        renderRiskDistribution(stats.categories, extensions);
        renderAnalytics(extensions);
    }

    function renderAnalytics(extensions) {
        if (!els.analyticsSummary) return;

        const enabled = extensions.filter(e => e.enabled);
        const allPerms = enabled.flatMap(e => [...(e.permissions || []), ...(e.hostPermissions || [])]);
        const criticalCount = allPerms.filter(p => getPermInfo(p, false).level === 'critical' || getPermInfo(p, true).level === 'critical').length;
        const uniquePerms = new Set(allPerms).size;
        const avgScore = enabled.length
            ? Math.round(enabled.reduce((s, e) => s + calculateScores(e.permissions, e.hostPermissions).overallScore, 0) / enabled.length)
            : 100;

        clearEl(els.analyticsSummary);

        const items = [
            { label: 'Avg. Safety Score', value: avgScore, suffix: '/100' },
            { label: 'Unique Permissions', value: uniquePerms },
            { label: 'Critical Permissions', value: criticalCount, warn: criticalCount > 0 }
        ];

        items.forEach(({ label, value, suffix = '', warn = false }) => {
            const el = createEl('div', { className: 'analytics-item' });
            el.appendChild(createEl('span', {
                className: `analytics-value${warn ? ' analytics-value-warn' : ''}`,
                text: `${value}${suffix}`
            }));
            el.appendChild(createEl('span', { className: 'analytics-label', text: label }));
            els.analyticsSummary.appendChild(el);
        });
    }

    function renderPermissionCounts(permissions, extensions) {
        clearEl(els.permissionCountList);

        const sorted = Object.entries(permissions).sort(([, a], [, b]) => b - a).slice(0, 12);

        if (sorted.length === 0) {
            els.permissionCountList.appendChild(createEl('li', { className: 'stat-item stat-item-empty', text: 'No permissions found.' }));
            return;
        }

        sorted.forEach(([permission, count]) => {
            const isHost = permission.includes('://') || permission === '<all_urls>';
            const info = getPermInfo(permission, isHost);

            const item = createEl('li', {
                className: 'stat-item stat-item-clickable',
                attrs: { tabindex: '0', role: 'button', 'aria-label': `Filter by ${permission}` }
            });

            item.addEventListener('click', () => filterByPermission(extensions, permission));
            item.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    filterByPermission(extensions, permission);
                }
            });

            const nameWrapper = createEl('div', { className: 'stat-item-name-wrapper' });
            const name = createEl('span', { className: 'stat-item-name', text: permission });
            const badgeLevel = info.level === 'low' ? 'good' : info.level;
            const badge = createEl('span', {
                className: `stat-item-badge ${RISK_LEVELS[badgeLevel]?.class || 'risk-moderate'}`,
                text: info.level
            });
            nameWrapper.appendChild(name);
            nameWrapper.appendChild(badge);

            const value = createEl('span', { className: 'stat-item-value', text: `${count} ext${count !== 1 ? 's' : ''}` });

            item.appendChild(nameWrapper);
            item.appendChild(value);
            els.permissionCountList.appendChild(item);
        });
    }

    function renderRiskDistribution(categories, extensions) {
        clearEl(els.riskRatingList);

        const order = ['high-risk', 'concerning', 'moderate', 'good', 'excellent'];
        let hasAny = false;

        order.forEach(category => {
            const count = categories[category];
            if (!count) return;
            hasAny = true;

            const item = createEl('li', {
                className: 'stat-item stat-item-clickable',
                attrs: { tabindex: '0', role: 'button', 'aria-label': `Filter ${RISK_LEVELS[category].label} extensions` }
            });

            item.addEventListener('click', () => filterByCategory(extensions, category));
            item.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    filterByCategory(extensions, category);
                }
            });

            const nameWrapper = createEl('div', { className: 'stat-item-name-wrapper' });
            const dot = createEl('span', { className: `risk-dot risk-dot-${category.replace('-', '')}` });
            const name = createEl('span', { className: `stat-item-name ${RISK_LEVELS[category].class}`, text: RISK_LEVELS[category].label });
            nameWrapper.appendChild(dot);
            nameWrapper.appendChild(name);

            const value = createEl('span', { className: 'stat-item-value', text: `${count} extension${count !== 1 ? 's' : ''}` });

            item.appendChild(nameWrapper);
            item.appendChild(value);
            els.riskRatingList.appendChild(item);
        });

        if (!hasAny) {
            els.riskRatingList.appendChild(createEl('li', { className: 'stat-item stat-item-empty', text: 'No extensions to categorise.' }));
        }
    }

    // ─── Filtered Views ────────────────────────────────────────────────────────
    function filterByPermission(extensions, permission) {
        const isHost = permission.includes('://') || permission === '<all_urls>';
        const filtered = extensions.filter(ext => {
            if (!ext.enabled) return false;
            return (ext.permissions || []).includes(permission) || (ext.hostPermissions || []).includes(permission);
        });
        renderFilteredView(filtered, `Extensions Using "${permission}"`, `${filtered.length} extension${filtered.length !== 1 ? 's' : ''} request this permission`);
    }

    function filterByCategory(extensions, category) {
        const filtered = extensions.filter(ext => {
            if (!ext.enabled) return false;
            return calculateScores(ext.permissions, ext.hostPermissions).category === category;
        });
        renderFilteredView(filtered, `${RISK_LEVELS[category].label} Extensions`, `${filtered.length} extension${filtered.length !== 1 ? 's' : ''} in this category`);
    }

    function renderFilteredView(extensions, title, subtitle) {
        showView('filtered');
        setText(els.filteredHeader, title);
        setText(els.filteredSubtitle, subtitle);
        clearEl(els.filteredList);

        if (extensions.length === 0) {
            els.filteredList.appendChild(createEl('p', { className: 'no-permissions-message', text: 'No extensions match this filter.' }));
            return;
        }

        extensions.forEach(ext => els.filteredList.appendChild(createExtensionCard(ext)));
    }

    // ─── Single Extension View ───────────────────────────────────────────────────
    function renderExtensionDetails(ext) {
        showView('single');

        els.extensionIcon.src = ext.icons?.[0]?.url || '../../public/icons/svg/code.svg';
        els.extensionIcon.alt = '';
        els.extensionIcon.onerror = () => { els.extensionIcon.src = '../../public/icons/svg/code.svg'; };
        setText(els.extensionName, ext.name);

        const scores = calculateScores(ext.permissions, ext.hostPermissions);
        updateScoreDisplays(scores);
        renderPermissionsList(ext.permissions, ext.hostPermissions);
        renderScoreBreakdown(scores);
    }

    function setupScoreInfoTooltip() {
        if (!els.scoreInfoBtn || !els.scoreInfoTooltip) return;

        let open = false;

        function toggle(show) {
            open = show;
            els.scoreInfoTooltip.hidden = !show;
            els.scoreInfoBtn.setAttribute('aria-expanded', String(show));
        }

        els.scoreInfoBtn.addEventListener('click', e => {
            e.stopPropagation();
            toggle(!open);
        });

        els.scoreInfoBtn.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(!open); }
            if (e.key === 'Escape') toggle(false);
        });

        document.addEventListener('click', e => {
            if (open && !els.scoreInfoTooltip.contains(e.target) && e.target !== els.scoreInfoBtn) toggle(false);
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && open) toggle(false);
        });
    }

    // ─── View Switching ────────────────────────────────────────────────────────
    function showView(view) {
        els.allView.style.display = view === 'dashboard' ? 'block' : 'none';
        els.singleView.style.display = view === 'single' ? 'block' : 'none';
        els.filteredView.style.display = view === 'filtered' ? 'block' : 'none';
    }

    // ─── Search ─────────────────────────────────────────────────────────────────
    function setupSearch() {
        if (!els.searchInput) return;

        const debounced = debounce(() => {
            const query = els.searchInput.value.toLowerCase().trim();
            const cards = els.allExtensionsList.querySelectorAll('.extension-card');
            let visible = 0;

            cards.forEach(card => {
                const matches = !query ||
                    (card.dataset.name || '').includes(query) ||
                    (card.dataset.permissions || '').includes(query) ||
                    (card.dataset.category || '').includes(query);
                card.style.display = matches ? '' : 'none';
                if (matches) visible++;
            });

            let emptyMsg = els.allExtensionsList.querySelector('.search-empty-state');
            if (visible === 0 && query) {
                if (!emptyMsg) {
                    emptyMsg = createEl('li', { className: 'search-empty-state', text: `No extensions match "${query}"` });
                    els.allExtensionsList.appendChild(emptyMsg);
                }
            } else if (emptyMsg) {
                emptyMsg.remove();
            }
        }, 120);

        els.searchInput.addEventListener('input', debounced);

        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                els.searchInput.focus();
                els.searchInput.select();
            }
            if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                els.searchInput.focus();
            }
        });
    }

    // ─── Back Buttons ──────────────────────────────────────────────────────────
    function setupBackButtons() {
        els.backToDash?.addEventListener('click', () => {
            window.location.href = 'safety-center.html';
        });

        els.backFromFiltered?.addEventListener('click', () => {
            showView('dashboard');
        });
    }

    // ─── Popup Listeners ─────────────────────────────────────────────────────────
    function setupPopupListeners() {
        els.permPopupClose?.addEventListener('click', closePermPopup);
        els.permPopupOverlay?.addEventListener('click', closePermPopup);

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closePermPopup();
        });
    }

    // ─── Init ──────────────────────────────────────────────────────────────────
    async function init() {
        try {
            cacheElements();
            await loadPermissionsDB();

            const params = new URLSearchParams(window.location.search);
            const extensionId = params.get('id');
            const extensions = await chrome.management.getAll();

            setupSearch();
            setupBackButtons();
            setupPopupListeners();
            setupPermFilters();
            setupScoreInfoTooltip();

            if (extensionId) {
                const ext = extensions.find(e => e.id === extensionId);
                if (ext) {
                    renderExtensionDetails(ext);
                } else {
                    showToast('Extension not found', 'error');
                    renderDashboard(extensions);
                }
            } else {
                renderDashboard(extensions);
            }
        } catch (err) {
            console.error('[SafetyCenter] Init error:', err);
            showToast('Failed to load extension data', 'error');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();