/**
 * sc-dashboard.js | modcore Safety Center Dashboard
 * Metrics, aggregate score, extension list, insights, search, filtered views.
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
        RISK_LEVELS, LEVEL_PILL_MAP, CATEGORY_ORDER,
        calculateScores, categoryForScore, getPermInfo,
        getExtensionIconUrl, categoryColor, getScoreArcOffset
    } = SC;

    const FALLBACK_ICON = '../../../public/icons/svg/code.svg';
    const els = {};

    function cacheElements() {
        els.allExtensionsList  = $('all-extensions-list');
        els.allExtensionsTitle = $('all-ext-subtitle');
        els.permissionCountList = $('permission-count-list');
        els.riskRatingList     = $('risk-rating-list');
        els.overviewMetrics    = $('overview-metrics');
        els.overviewScoreArc   = $('overview-score-arc');
        els.overviewScoreNum   = $('overview-score-number');
        els.overviewScoreLabel = $('overview-score-label');
        els.overviewScoreDesc  = $('overview-score-desc');
        els.searchInput        = $('permission-search-input-inline');
        els.filteredList       = $('filtered-extensions-list');
        els.filteredHeader     = $('filtered-view-header');
        els.filteredSubtitle   = $('filtered-view-subtitle');
        els.backFromFiltered   = $('back-from-filtered-btn');
    }

    /* Overview */
    function renderOverview(extensions, enabled, categories) {
        const scores = enabled.map(e => calculateScores(e.permissions, e.hostPermissions).overallScore);
        const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 100;
        const category = categoryForScore(avg);

        els.overviewScoreArc.style.strokeDashoffset = getScoreArcOffset(avg);
        els.overviewScoreArc.style.stroke = categoryColor(category);
        setText(els.overviewScoreNum, avg);
        setText(els.overviewScoreLabel, RISK_LEVELS[category].label);
        setText(els.overviewScoreDesc, RISK_LEVELS[category].description);

        clearEl(els.overviewMetrics);
        const healthy = (categories.good || 0) + (categories.excellent || 0);

        const metrics = [
            { label: 'Extensions', value: extensions.length,            meta: `${enabled.length} active` },
            { label: 'High Risk',  value: categories['high-risk'] || 0, meta: 'need review',      variant: 'danger' },
            { label: 'Concerning', value: categories.concerning || 0,   meta: 'warrant attention', variant: 'warn' },
            { label: 'Healthy',    value: healthy,                      meta: 'good or better',   variant: 'good' }
        ];

        const frag = document.createDocumentFragment();
        metrics.forEach(m => {
            const tile = createEl('div', {
                className: 'metric-tile' + (m.variant ? ` metric-tile-${m.variant}` : '')
            });
            tile.appendChild(createEl('span', { className: 'metric-tile-label', text: m.label }));
            tile.appendChild(createEl('span', { className: 'metric-tile-value', text: m.value }));
            tile.appendChild(createEl('span', { className: 'metric-tile-meta',  text: m.meta  }));
            frag.appendChild(tile);
        });
        els.overviewMetrics.appendChild(frag);
    }

    /* Risk distribution */
    function renderRiskDistribution(categories, extensions) {
        clearEl(els.riskRatingList);

        const total = Object.values(categories).reduce((a, b) => a + b, 0);
        if (!total) {
            els.riskRatingList.appendChild(createEl('li', {
                className: 'insight-empty',
                text: 'No extensions to analyse.'
            }));
            return;
        }

        const frag = document.createDocumentFragment();

        CATEGORY_ORDER.forEach(category => {
            const count = categories[category];
            if (!count) return;

            const item = createEl('li', {
                className: 'insight-item',
                attrs: {
                    tabindex: '0',
                    role: 'button',
                    'aria-label': `Show ${RISK_LEVELS[category].label} extensions`
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

            const header = createEl('div', { className: 'insight-item-header' });
            const label = createEl('div', { className: 'insight-item-label' });
            label.appendChild(createEl('span', { className: `risk-dot risk-dot-${category.replace('-', '')}` }));
            label.appendChild(createEl('span', { className: 'insight-item-label-text', text: RISK_LEVELS[category].label }));
            header.appendChild(label);
            header.appendChild(createEl('span', { className: 'insight-item-count', text: String(count) }));

            const bar = createEl('div', { className: 'insight-item-bar' });
            const fill = createEl('div', { className: `insight-item-bar-fill risk-${category}` });
            fill.style.width = `${(count / total) * 100}%`;
            bar.appendChild(fill);

            item.appendChild(header);
            item.appendChild(bar);
            frag.appendChild(item);
        });

        els.riskRatingList.appendChild(frag);
    }

    /* Top permissions */
    function renderTopPermissions(permissionCounts, extensions) {
        clearEl(els.permissionCountList);

        const entries = Object.entries(permissionCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 8);

        if (!entries.length) {
            els.permissionCountList.appendChild(createEl('li', {
                className: 'insight-empty',
                text: 'No permissions found across active extensions.'
            }));
            return;
        }

        const max = entries[0][1];
        const frag = document.createDocumentFragment();

        entries.forEach(([permission, count]) => {
            const isHost = permission.includes('://') || permission === '<all_urls>';
            const info = getPermInfo(permission, isHost);

            const item = createEl('li', {
                className: 'insight-item',
                attrs: { tabindex: '0', role: 'button', 'aria-label': `Filter extensions using ${permission}` },
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

            const header = createEl('div', { className: 'insight-item-header' });
            const label = createEl('div', { className: 'insight-item-label' });
            label.appendChild(createEl('span', {
                className: 'insight-item-label-text mono',
                text: permission,
                attrs: { title: permission }
            }));
            header.appendChild(label);
            header.appendChild(createEl('span', { className: 'insight-item-count', text: String(count) }));

            const bar = createEl('div', { className: 'insight-item-bar' });
            const fill = createEl('div', {
                className: `insight-item-bar-fill ${LEVEL_PILL_MAP[info.level] || 'risk-moderate'}`
            });
            fill.style.width = `${(count / max) * 100}%`;
            bar.appendChild(fill);

            item.appendChild(header);
            item.appendChild(bar);
            frag.appendChild(item);
        });

        els.permissionCountList.appendChild(frag);
    }

    /* Extension card */
    function createExtensionCard(ext) {
        const scores = calculateScores(ext.permissions, ext.hostPermissions);
        const lvl = RISK_LEVELS[scores.category];
        const open = () => { window.location.href = `safety-center.html?id=${ext.id}`; };

        const card = createEl('li', {
            className: 'extension-card',
            attrs: {
                tabindex: '0',
                role: 'link',
                'aria-label': `${ext.name}, score ${scores.overallScore}, ${lvl.label}`
            },
            events: {
                click: open,
                keydown: e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        open();
                    }
                }
            }
        });

        const iconUrl = getExtensionIconUrl(ext) || FALLBACK_ICON;
        const icon = createEl('img', {
            className: 'extension-card-icon',
            attrs: { src: iconUrl, alt: '', loading: 'lazy' }
        });
        icon.onerror = () => { icon.src = FALLBACK_ICON; };

        const content = createEl('div', { className: 'extension-card-content' });
        content.appendChild(createEl('h3', { className: 'extension-card-name', text: ext.name }));

        const meta = createEl('div', { className: 'extension-card-meta' });
        const count = (ext.permissions?.length || 0) + (ext.hostPermissions?.length || 0);
        meta.appendChild(createEl('span', {
            text: `${count} permission${count !== 1 ? 's' : ''}`
        }));
        if (!ext.enabled) {
            meta.appendChild(createEl('span', {
                className: 'extension-card-disabled-badge',
                text: 'Disabled'
            }));
        }
        content.appendChild(meta);

        const scoreWrap = createEl('div', { className: 'extension-card-score' });
        scoreWrap.appendChild(createEl('div', {
            className: `extension-card-score-badge ${lvl.class}`,
            text: String(scores.overallScore)
        }));
        scoreWrap.appendChild(createEl('div', {
            className: 'extension-card-score-label',
            text: lvl.label
        }));

        card.appendChild(icon);
        card.appendChild(content);
        card.appendChild(scoreWrap);

        card.dataset.name = ext.name.toLowerCase();
        card.dataset.category = scores.category;
        card.dataset.permissions = [
            ...(ext.permissions || []),
            ...(ext.hostPermissions || [])
        ].join(',').toLowerCase();
        card.dataset.enabled = String(ext.enabled);

        return card;
    }

    /* Extension list */
    function renderExtensionList(extensions) {
        clearEl(els.allExtensionsList);

        if (!extensions.length) {
            els.allExtensionsList.appendChild(createEmptyState(
                'icon-shield',
                'No extensions installed',
                'Extensions you install will appear here with their safety analysis.'
            ));
            setText(els.allExtensionsTitle, 'No extensions found');
            return;
        }

        const enabled = extensions.filter(e => e.enabled);
        const disabled = extensions.filter(e => !e.enabled);

        const sortedEnabled = [...enabled].sort((a, b) => {
            const sa = calculateScores(a.permissions, a.hostPermissions);
            const sb = calculateScores(b.permissions, b.hostPermissions);
            const oi = CATEGORY_ORDER.indexOf(sa.category);
            const oj = CATEGORY_ORDER.indexOf(sb.category);
            return oi !== oj ? oi - oj : a.name.localeCompare(b.name);
        });

        const sortedDisabled = [...disabled].sort((a, b) => a.name.localeCompare(b.name));

        const frag = document.createDocumentFragment();
        [...sortedEnabled, ...sortedDisabled].forEach(ext => {
            frag.appendChild(createExtensionCard(ext));
        });
        els.allExtensionsList.appendChild(frag);

        setText(els.allExtensionsTitle,
            `Sorted by risk score, ${enabled.length} active, ${disabled.length} disabled`);
    }

    function createEmptyState(icon, title, description) {
        const li = createEl('li', { className: 'empty-state' });
        li.appendChild(createEl('div', {
            className: 'empty-state-icon',
            children: [createEl('span', { className: `icon ${icon}`, attrs: { 'aria-hidden': 'true' } })]
        }));
        li.appendChild(createEl('h3', { className: 'empty-state-title', text: title }));
        li.appendChild(createEl('p',  { className: 'empty-state-desc',  text: description }));
        return li;
    }

    /* Dashboard composition */
    function renderDashboard(extensions) {
        SC.Views.show('dashboard');

        const enabled = extensions.filter(e => e.enabled);
        const allPerms = enabled.flatMap(e => [
            ...(e.permissions || []),
            ...(e.hostPermissions || [])
        ]);

        const permissionCounts = {};
        allPerms.forEach(p => { permissionCounts[p] = (permissionCounts[p] || 0) + 1; });

        const categories = { excellent: 0, good: 0, moderate: 0, concerning: 0, 'high-risk': 0 };
        enabled.forEach(e => {
            const s = calculateScores(e.permissions, e.hostPermissions);
            categories[s.category] = (categories[s.category] || 0) + 1;
        });

        renderOverview(extensions, enabled, categories);
        renderRiskDistribution(categories, extensions);
        renderTopPermissions(permissionCounts, extensions);
        renderExtensionList(extensions);
    }

    /* Search */
    function setupSearch() {
        if (!els.searchInput) return;

        const wrapper = els.searchInput.parentElement;
        const clearBtn = createEl('button', {
            className: 'search-clear-btn',
            attrs: { type: 'button', 'aria-label': 'Clear search', title: 'Clear search' },
            events: {
                click: () => {
                    els.searchInput.value = '';
                    els.searchInput.focus();
                    debounced();
                }
            },
            children: [createEl('span', { className: 'icon icon-close', attrs: { 'aria-hidden': 'true' } })]
        });
        wrapper.appendChild(clearBtn);

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

            clearBtn.style.display = query ? 'flex' : 'none';

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
            if (e.key === '/' &&
                document.activeElement.tagName !== 'INPUT' &&
                document.activeElement.tagName !== 'TEXTAREA') {
                e.preventDefault();
                els.searchInput.focus();
            }
        });
    }

    /* Filtered views */
    function filterByPermission(extensions, permission) {
        const filtered = extensions.filter(ext => {
            if (!ext.enabled) return false;
            return (ext.permissions || []).includes(permission) ||
                   (ext.hostPermissions || []).includes(permission);
        });
        renderFilteredView(
            filtered,
            `Using "${permission}"`,
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

        if (!extensions.length) {
            els.filteredList.appendChild(createEmptyState(
                'icon-search',
                'Nothing to show',
                'No extensions match this filter. Try a different category or permission.'
            ));
            return;
        }

        const frag = document.createDocumentFragment();
        extensions.forEach(ext => frag.appendChild(createExtensionCard(ext)));
        els.filteredList.appendChild(frag);
    }

    function setupBackButtons() {
        els.backFromFiltered?.addEventListener('click', () => SC.Views.show('dashboard'));
    }

    /* Public API */
    global.SafetyCenter.Dashboard = {
        init() {
            cacheElements();
            setupSearch();
            setupBackButtons();
        },
        render(extensions) {
            renderDashboard(extensions);
        }
    };

})(typeof window !== 'undefined' ? window : this);