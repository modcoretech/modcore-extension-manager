/**
 * sc-dashboard.js — modcore Safety Center Dashboard
 * Handles the main dashboard: metrics, extension grid, search, filtering,
 * permission counts, and risk distribution.
 */
(function (global) {
    'use strict';

    const SC = global.SafetyCenter;
    if (!SC) {
        console.error('[sc-dashboard] SafetyCenter core not loaded');
        return;
    }

    const {
        $, createEl, clearEl, setText, debounce,
        RISK_LEVELS, LEVEL_LABELS, LEVEL_PILL_MAP, CATEGORY_ORDER,
        calculateScores, getPermInfo
    } = SC;

    /* ========================================================================
       1. DOM CACHE
       ======================================================================== */
    const els = {};

    function cacheElements() {
        els.allView = $('all-extensions-view');
        els.allExtensionsList = $('all-extensions-list');
        els.permissionCountList = $('permission-count-list');
        els.riskRatingList = $('risk-rating-list');
        els.totalCount = $('total-extensions-count');
        els.enabledCount = $('enabled-extensions-count');
        els.avgScore = $('avg-score-value');
        els.highRiskCount = $('high-risk-count');
        els.concerningCount = $('concerning-count');
        els.uniquePermsCount = $('unique-perms-count');
        els.searchInput = $('permission-search-input-inline');
        els.filteredList = $('filtered-extensions-list');
        els.filteredHeader = $('filtered-view-header');
        els.filteredSubtitle = $('filtered-view-subtitle');
        els.backFromFiltered = $('back-from-filtered-btn');
    }

    /* ========================================================================
       2. EXTENSION CARD FACTORY
       ======================================================================== */
    function createExtensionCard(ext) {
        const scores = calculateScores(ext.permissions, ext.hostPermissions);
        const lvl = RISK_LEVELS[scores.category];

        const card = createEl('li', {
            className: `extension-card card-accent-${scores.category}`,
            attrs: {
                tabindex: '0',
                role: 'link',
                'aria-label': `${ext.name}, Score ${scores.overallScore}, ${lvl.label}`
            },
            events: {
                click: () => {
                    window.location.href = `safety-center.html?id=${ext.id}`;
                },
                keydown: e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        window.location.href = `safety-center.html?id=${ext.id}`;
                    }
                }
            }
        });

        // Icon
        const iconWrapper = createEl('div', { className: 'extension-card-icon-wrap' });
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

        // Content
        const content = createEl('div', { className: 'extension-card-content' });
        const name = createEl('h3', { className: 'extension-card-name', text: ext.name });
        const meta = createEl('div', { className: 'extension-card-meta' });

        const count = (ext.permissions?.length || 0) + (ext.hostPermissions?.length || 0);
        meta.appendChild(createEl('span', {
            className: 'extension-card-perms',
            text: `${count} permission${count !== 1 ? 's' : ''}`
        }));

        if (!ext.enabled) {
            meta.appendChild(createEl('span', {
                className: 'extension-card-disabled-badge',
                text: 'Disabled'
            }));
        }

        content.appendChild(name);
        content.appendChild(meta);

        // Score
        const scoreDisplay = createEl('div', { className: 'extension-card-score' });
        const scoreBadge = createEl('div', {
            className: `extension-card-score-badge ${lvl.class}`,
            text: String(scores.overallScore)
        });
        const scoreLabel = createEl('div', {
            className: 'extension-card-score-label',
            text: lvl.label
        });
        scoreDisplay.appendChild(scoreBadge);
        scoreDisplay.appendChild(scoreLabel);

        card.appendChild(iconWrapper);
        card.appendChild(content);
        card.appendChild(scoreDisplay);

        // Data attributes for search/filter
        card.dataset.name = ext.name.toLowerCase();
        card.dataset.category = scores.category;
        card.dataset.permissions = [
            ...(ext.permissions || []),
            ...(ext.hostPermissions || [])
        ].join(',').toLowerCase();
        card.dataset.enabled = String(ext.enabled);

        return card;
    }

    /* ========================================================================
       3. METRICS RENDERING
       ======================================================================== */
    function renderMetrics(extensions) {
        const enabled = extensions.filter(e => e.enabled);
        const allPerms = enabled.flatMap(e => [
            ...(e.permissions || []),
            ...(e.hostPermissions || [])
        ]);

        const scores = enabled.map(e => calculateScores(e.permissions, e.hostPermissions));
        const categories = { excellent: 0, good: 0, moderate: 0, concerning: 0, 'high-risk': 0 };
        scores.forEach(s => { categories[s.category] = (categories[s.category] || 0) + 1; });

        const avgScore = enabled.length
            ? Math.round(scores.reduce((s, e) => s + e.overallScore, 0) / enabled.length)
            : 100;

        setText(els.totalCount, extensions.length);
        setText(els.enabledCount, enabled.length);
        setText(els.avgScore, avgScore);
        setText(els.highRiskCount, categories['high-risk']);
        setText(els.concerningCount, categories.concerning);
        setText(els.uniquePermsCount, new Set(allPerms).size);

        // Color-code the avg score metric
        if (els.avgScore) {
            const parent = els.avgScore.closest('.metric-card');
            if (parent) {
                parent.classList.remove('metric-card-score', 'metric-card-warn');
                if (avgScore < 50) parent.classList.add('metric-card-warn');
                else if (avgScore >= 85) parent.classList.add('metric-card-score');
            }
        }
    }

    /* ========================================================================
       4. PERMISSION COUNTS
       ======================================================================== */
    function renderPermissionCounts(permissions, extensions) {
        clearEl(els.permissionCountList);

        const sorted = Object.entries(permissions)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 12);

        if (sorted.length === 0) {
            els.permissionCountList.appendChild(createEl('li', {
                className: 'stat-item stat-item-empty',
                text: 'No permissions found.'
            }));
            return;
        }

        sorted.forEach(([permission, count]) => {
            const isHost = permission.includes('://') || permission === '<all_urls>';
            const info = getPermInfo(permission, isHost);

            const item = createEl('li', {
                className: 'stat-item stat-item-clickable',
                attrs: {
                    tabindex: '0',
                    role: 'button',
                    'aria-label': `Filter by ${permission}`
                },
                events: {
                    click: () => filterByPermission(extensions, permission),
                    keydown: e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            filterByPermission(extensions, permission);
                        }
                    }
                }
            });

            const nameWrapper = createEl('div', { className: 'stat-item-name-wrap' });
            const name = createEl('span', { className: 'stat-item-name', text: permission });
            const badge = createEl('span', {
                className: `stat-item-badge ${LEVEL_PILL_MAP[info.level] || 'risk-moderate'}`,
                text: info.level
            });
            nameWrapper.appendChild(name);
            nameWrapper.appendChild(badge);

            const value = createEl('span', {
                className: 'stat-item-value',
                text: `${count} ext${count !== 1 ? 's' : ''}`
            });

            item.appendChild(nameWrapper);
            item.appendChild(value);
            els.permissionCountList.appendChild(item);
        });
    }

    /* ========================================================================
       5. RISK DISTRIBUTION
       ======================================================================== */
    function renderRiskDistribution(categories, extensions) {
        clearEl(els.riskRatingList);

        let hasAny = false;

        CATEGORY_ORDER.forEach(category => {
            const count = categories[category];
            if (!count) return;
            hasAny = true;

            const item = createEl('li', {
                className: 'stat-item stat-item-clickable',
                attrs: {
                    tabindex: '0',
                    role: 'button',
                    'aria-label': `Filter ${RISK_LEVELS[category].label} extensions`
                },
                events: {
                    click: () => filterByCategory(extensions, category),
                    keydown: e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            filterByCategory(extensions, category);
                        }
                    }
                }
            });

            const nameWrapper = createEl('div', { className: 'stat-item-name-wrap' });
            const dot = createEl('span', {
                className: `risk-dot risk-dot-${category.replace('-', '')}`
            });
            const name = createEl('span', {
                className: 'stat-item-name',
                text: RISK_LEVELS[category].label
            });
            nameWrapper.appendChild(dot);
            nameWrapper.appendChild(name);

            const value = createEl('span', {
                className: 'stat-item-value',
                text: `${count} extension${count !== 1 ? 's' : ''}`
            });

            item.appendChild(nameWrapper);
            item.appendChild(value);
            els.riskRatingList.appendChild(item);
        });

        if (!hasAny) {
            els.riskRatingList.appendChild(createEl('li', {
                className: 'stat-item stat-item-empty',
                text: 'No extensions to categorise.'
            }));
        }
    }

    /* ========================================================================
       6. EXTENSION GRID
       ======================================================================== */
    function renderExtensionGrid(extensions) {
        clearEl(els.allExtensionsList);

        const enabled = extensions.filter(e => e.enabled);
        const disabled = extensions.filter(e => !e.enabled);

        const sortedEnabled = [...enabled].sort((a, b) => {
            const sa = calculateScores(a.permissions, a.hostPermissions);
            const sb = calculateScores(b.permissions, b.hostPermissions);
            const oi = CATEGORY_ORDER.indexOf(sa.category);
            const oj = CATEGORY_ORDER.indexOf(sb.category);
            if (oi !== oj) return oi - oj;
            return a.name.localeCompare(b.name);
        });

        const sortedDisabled = [...disabled].sort((a, b) => a.name.localeCompare(b.name));

        [...sortedEnabled, ...sortedDisabled].forEach(ext => {
            els.allExtensionsList.appendChild(createExtensionCard(ext));
        });
    }

    /* ========================================================================
       7. DASHBOARD COMPOSITION
       ======================================================================== */
    function renderDashboard(extensions) {
        SC.Views.show('dashboard');

        const enabled = extensions.filter(e => e.enabled);
        const allPerms = enabled.flatMap(e => [
            ...(e.permissions || []),
            ...(e.hostPermissions || [])
        ]);

        const permissionCounts = {};
        allPerms.forEach(p => {
            permissionCounts[p] = (permissionCounts[p] || 0) + 1;
        });

        const categories = { excellent: 0, good: 0, moderate: 0, concerning: 0, 'high-risk': 0 };
        enabled.forEach(e => {
            const s = calculateScores(e.permissions, e.hostPermissions);
            categories[s.category] = (categories[s.category] || 0) + 1;
        });

        renderMetrics(extensions);
        renderPermissionCounts(permissionCounts, extensions);
        renderRiskDistribution(categories, extensions);
        renderExtensionGrid(extensions);
    }

    /* ========================================================================
       8. SEARCH
       ======================================================================== */
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
                    emptyMsg = createEl('li', {
                        className: 'search-empty-state',
                        text: `No extensions match "${query}"`
                    });
                    els.allExtensionsList.appendChild(emptyMsg);
                }
            } else if (emptyMsg) {
                emptyMsg.remove();
            }
        }, 120);

        els.searchInput.addEventListener('input', debounced);

        document.addEventListener('keydown', e => {
            if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                els.searchInput.focus();
            }
        });
    }

    /* ========================================================================
       9. FILTERED VIEWS
       ======================================================================== */
    function filterByPermission(extensions, permission) {
        const filtered = extensions.filter(ext => {
            if (!ext.enabled) return false;
            return (ext.permissions || []).includes(permission) ||
                   (ext.hostPermissions || []).includes(permission);
        });
        renderFilteredView(
            filtered,
            `Extensions Using "${permission}"`,
            `${filtered.length} extension${filtered.length !== 1 ? 's' : ''} request this permission`
        );
    }

    function filterByCategory(extensions, category) {
        const filtered = extensions.filter(ext => {
            if (!ext.enabled) return false;
            return calculateScores(ext.permissions, ext.hostPermissions).category === category;
        });
        renderFilteredView(
            filtered,
            `${RISK_LEVELS[category].label} Extensions`,
            `${filtered.length} extension${filtered.length !== 1 ? 's' : ''} in this category`
        );
    }

    function renderFilteredView(extensions, title, subtitle) {
        SC.Views.show('filtered');
        setText(els.filteredHeader, title);
        setText(els.filteredSubtitle, subtitle);
        clearEl(els.filteredList);

        if (extensions.length === 0) {
            els.filteredList.appendChild(createEl('li', {
                className: 'search-empty-state',
                text: 'No extensions match this filter.'
            }));
            return;
        }

        extensions.forEach(ext => els.filteredList.appendChild(createExtensionCard(ext)));
    }

    function setupBackButtons() {
        els.backFromFiltered?.addEventListener('click', () => {
            SC.Views.show('dashboard');
        });
    }

    /* ========================================================================
       10. PUBLIC API
       ======================================================================== */
    const Dashboard = {
        init() {
            cacheElements();
            setupSearch();
            setupBackButtons();
        },
        render(extensions) {
            renderDashboard(extensions);
        },
        filterByPermission,
        filterByCategory
    };

    global.SafetyCenter.Dashboard = Dashboard;

})(typeof window !== 'undefined' ? window : this);