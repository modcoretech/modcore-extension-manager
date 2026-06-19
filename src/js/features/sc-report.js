/**
 * sc-report.js — modcore Safety Center Extension Report
 * Single-extension view: hero scores, tabbed panels, permission details,
 * structured metadata list, and enhanced support developer integration.
 */
(function (global) {
    'use strict';

    const SC = global.SafetyCenter;
    if (!SC) {
        console.error('[sc-report] SafetyCenter core not loaded');
        return;
    }

    const {
        $, createEl, clearEl, setText, debounce,
        RISK_LEVELS, LEVEL_ORDER, LEVEL_LABELS, LEVEL_PILL_MAP,
        calculateScores, getPermInfo, applyScoreColor, getScoreArcOffset,
        Popup, Tabs, loadSupportData, findSupportEntry
    } = SC;

    /* ========================================================================
       1. DOM CACHE
       ======================================================================== */
    const els = {};

    function cacheElements() {
        els.extensionIcon = $('extension-icon');
        els.extensionName = $('extension-name');
        els.extensionVersion = $('extension-version');
        els.heroScoreRing = $('hero-score-ring');
        els.heroScoreArc = $('hero-score-arc');
        els.heroScoreNumber = $('hero-score-number');
        els.heroScoreLabel = $('hero-score-label');

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

        els.metadataList = $('ext-metadata-list');

        els.supportExtIcon = $('support-ext-icon');
        els.supportTitle = $('support-title');
        els.supportTagline = $('support-tagline');
        els.supportLoading = $('support-loading');
        els.supportData = $('support-data');
        els.supportNotFound = $('support-not-found');
        els.supportContent = $('support-content');

        els.backToDash = $('back-to-dashboard-btn');
    }

    /* ========================================================================
       2. HERO & SCORE DISPLAYS
       ======================================================================== */
    function updateHeroScores(scores) {
        const lvl = RISK_LEVELS[scores.category];

        const offset = getScoreArcOffset(scores.overallScore);
        els.heroScoreArc.style.strokeDashoffset = offset;

        const colorVar = `--color-score-${scores.category}`;
        const color = getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim();
        els.heroScoreArc.style.stroke = color || 'var(--color-primary)';

        setText(els.heroScoreNumber, scores.overallScore);
        els.heroScoreLabel.className = `hero-score-label ${lvl.class}`;
        els.heroScoreLabel.style.background = color || 'var(--color-neutral)';
        setText(els.heroScoreLabel, lvl.label);
    }

    function updateScoreStrip(scores) {
        const lvl = RISK_LEVELS[scores.category];

        setText(els.overallScoreCategory, lvl.label);
        els.overallScoreCategory.className = `score-cat-badge ${lvl.class}`;
        setText(els.scoreExplanation, lvl.description);

        setText(els.securityScoreValue, scores.securityScore);
        els.securityScoreGraph.style.setProperty('--score-value', scores.securityScore);
        applyScoreColor(els.securityScoreGraph, scores.securityScore);

        setText(els.privacyScoreValue, scores.privacyScore);
        els.privacyScoreGraph.style.setProperty('--score-value', scores.privacyScore);
        applyScoreColor(els.privacyScoreGraph, scores.privacyScore);
    }

    function renderScoreBreakdown(scores) {
        clearEl(els.scoreBreakdown);

        if (!scores.breakdown || scores.breakdown.length === 0) {
            els.scoreBreakdown.appendChild(createEl('p', {
                className: 'score-breakdown-empty',
                text: 'No permissions to analyse.'
            }));
            return;
        }

        const top = [...scores.breakdown]
            .sort((a, b) => (b.secContrib + b.privContrib) - (a.secContrib + a.privContrib))
            .slice(0, 6);

        top.forEach(({ permission, info }) => {
            const row = createEl('div', { className: 'score-breakdown-row' });
            row.appendChild(createEl('span', {
                className: 'score-breakdown-label',
                text: permission
            }));
            row.appendChild(createEl('span', {
                className: `score-breakdown-pill ${LEVEL_PILL_MAP[info.level] || 'risk-moderate'}`,
                text: info.level
            }));
            els.scoreBreakdown.appendChild(row);
        });
    }

    /* ========================================================================
       3. PERMISSION DETAILS
       ======================================================================== */
    let permFilterState = {
        risk: new Set(['critical', 'high', 'moderate', 'low']),
        type: new Set(['api', 'host']),
        search: ''
    };

    function createPermItem(name, isHost) {
        const info = getPermInfo(name, isHost);

        const item = createEl('li', {
            className: `perm-item perm-item-${info.level}`,
            attrs: {
                'data-perm-name': name.toLowerCase(),
                'data-perm-risk': info.level,
                'data-perm-type': isHost ? 'host' : 'api',
                'data-perm-text': `${name} ${info.description} ${info.categories.join(' ')}`.toLowerCase()
            }
        });

        // Risk stripe
        const stripe = createEl('div', { className: 'perm-item-stripe' });
        item.appendChild(stripe);

        // Content wrapper
        const content = createEl('div', { className: 'perm-item-content' });

        // Header row: name + risk badge + more info
        const header = createEl('div', { className: 'perm-item-header' });

        const nameWrap = createEl('div', { className: 'perm-item-name-wrap' });
        const permName = createEl('h4', {
            className: 'perm-item-name',
            text: info.displayName || name
        });
        nameWrap.appendChild(permName);

        // Type badge
        const typeBadge = createEl('span', {
            className: `perm-item-type-badge ${isHost ? 'perm-type-host' : 'perm-type-api'}`,
            text: isHost ? 'Host' : 'API'
        });
        nameWrap.appendChild(typeBadge);
        header.appendChild(nameWrap);

        const actions = createEl('div', { className: 'perm-item-actions' });

        const riskBadge = createEl('span', {
            className: `perm-item-risk-badge ${LEVEL_PILL_MAP[info.level] || 'risk-moderate'}`,
            text: info.level
        });
        actions.appendChild(riskBadge);

        const moreBtn = createEl('button', {
            className: 'btn-more-info',
            attrs: { type: 'button', 'aria-label': `More details about ${name}` },
            events: {
                click: e => {
                    e.stopPropagation();
                    Popup.open(name, isHost, info);
                }
            },
            children: [
                createEl('span', { className: 'icon icon-info', attrs: { 'aria-hidden': 'true' } }),
                document.createTextNode('More info')
            ]
        });
        actions.appendChild(moreBtn);
        header.appendChild(actions);
        content.appendChild(header);

        // Description
        const desc = createEl('p', {
            className: 'perm-item-desc',
            text: info.description
        });
        content.appendChild(desc);

        // Flags row
        const flags = createEl('div', { className: 'perm-item-flags' });
        if (info.requiresHost) {
            flags.appendChild(createEl('span', {
                className: 'perm-flag perm-flag-host',
                text: 'Needs host access',
                attrs: { title: 'Requires host/URL permissions to be effective' }
            }));
        }
        if (!info.mv3Compatible) {
            flags.appendChild(createEl('span', {
                className: 'perm-flag perm-flag-mv2',
                text: 'MV2 only',
                attrs: { title: 'Not compatible with Manifest V3' }
            }));
        }
        info.categories.forEach(cat => {
            flags.appendChild(createEl('span', {
                className: 'perm-item-cat',
                text: cat
            }));
        });
        if (flags.children.length) content.appendChild(flags);

        item.appendChild(content);
        return item;
    }

    function renderPermissionsList(apiPerms, hostPerms) {
        clearEl(els.allPermissionsList);

        const all = [
            ...(apiPerms || []).map(p => ({ name: p, isHost: false })),
            ...(hostPerms || []).map(p => ({ name: p, isHost: true }))
        ];

        if (all.length === 0) {
            els.allPermissionsList.appendChild(createEl('p', {
                className: 'no-permissions-msg',
                text: 'This extension does not request any special permissions.'
            }));
            return;
        }

        // Sort by risk level (worst first) then alphabetically
        const levelOrder = { critical: 0, high: 1, moderate: 2, low: 3 };
        all.sort((a, b) => {
            const ia = getPermInfo(a.name, a.isHost);
            const ib = getPermInfo(b.name, b.isHost);
            const oa = levelOrder[ia.level] ?? 2;
            const ob = levelOrder[ib.level] ?? 2;
            if (oa !== ob) return oa - ob;
            return a.name.localeCompare(b.name);
        });

        const list = createEl('ul', { className: 'perm-flat-list', role: 'list' });
        all.forEach(perm => {
            list.appendChild(createPermItem(perm.name, perm.isHost));
        });
        els.allPermissionsList.appendChild(list);

        applyPermFilters();
    }

    /* ========================================================================
       4. PERMISSION FILTERING
       ======================================================================== */
    function setupPermFilters() {
        if (!els.permSearchInput) return;

        const debounced = debounce(() => {
            permFilterState.search = els.permSearchInput.value.trim().toLowerCase();
            applyPermFilters();
        }, 150);

        els.permSearchInput.addEventListener('input', debounced);

        els.permFilterBtn.addEventListener('click', e => {
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

        document.addEventListener('click', e => {
            if (!els.permFilterDropdown.hidden) {
                const wrapper = els.permFilterBtn?.closest('.filter-dropdown-wrap');
                if (wrapper && !wrapper.contains(e.target)) {
                    closeAllDropdowns();
                }
            }
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeAllDropdowns();
        });
    }

    function updatePermFilterState() {
        permFilterState.risk.clear();
        permFilterState.type.clear();

        els.permFilterDropdown.querySelectorAll('input[name="risk-filter"]:checked').forEach(cb => {
            permFilterState.risk.add(cb.value);
        });
        els.permFilterDropdown.querySelectorAll('input[name="type-filter"]:checked').forEach(cb => {
            permFilterState.type.add(cb.value);
        });
    }

    function applyPermFilters() {
        const { search, risk, type } = permFilterState;
        const items = els.allPermissionsList.querySelectorAll('.perm-item');
        let visible = 0;

        items.forEach(item => {
            const matchesSearch = !search ||
                item.dataset.permName.includes(search) ||
                item.dataset.permText.includes(search);
            const matchesRisk = risk.has(item.dataset.permRisk);
            const matchesType = type.has(item.dataset.permType);

            const show = matchesSearch && matchesRisk && matchesType;
            item.hidden = !show;
            if (show) visible++;
        });

        let emptyMsg = els.allPermissionsList.querySelector('.perm-filter-empty');
        if (visible === 0 && items.length > 0) {
            if (!emptyMsg) {
                emptyMsg = createEl('p', {
                    className: 'perm-filter-empty',
                    text: 'No permissions match your filters.'
                });
                els.allPermissionsList.appendChild(emptyMsg);
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

    /* ========================================================================
       5. METADATA LIST (Details Tab — structured list, not grid)
       ======================================================================== */
    function renderMetadata(ext) {
        clearEl(els.metadataList);

        const sections = [
            {
                title: 'Identity',
                items: [
                    { key: 'Name', value: ext.name },
                    { key: 'Short Name', value: ext.shortName || '—' },
                    { key: 'Description', value: ext.description || '—' },
                    { key: 'Extension ID', value: ext.id, mono: true, copy: true }
                ]
            },
            {
                title: 'Version & Type',
                items: [
                    { key: 'Version', value: ext.version },
                    { key: 'Type', value: ext.type === 'extension' ? 'Extension' : ext.type },
                    { key: 'Manifest Version', value: ext.manifestVersion ? `V${ext.manifestVersion}` : '—' },
                    { key: 'Install Type', value: ext.installType || 'Unknown' }
                ]
            },
            {
                title: 'Status',
                items: [
                    { key: 'Enabled', value: ext.enabled ? 'Yes' : 'No', pill: true, enabled: ext.enabled },
                    { key: 'May Disable', value: ext.mayDisable ? 'Yes' : 'No' },
                    { key: 'Allow Access to File URLs', value: ext.allowFileAccess ? 'Yes' : 'No' },
                    { key: 'Incognito Access', value: ext.incognitoAccess ? 'Allowed' : 'Not allowed' }
                ]
            },
            {
                title: 'URLs',
                items: [
                    { key: 'Homepage', value: ext.homepageUrl, link: true },
                    { key: 'Update URL', value: ext.updateUrl, link: true, mono: true },
                    { key: 'Options Page', value: ext.optionsUrl, link: true }
                ]
            }
        ];

        sections.forEach(section => {
            const secEl = createEl('li', { className: 'metadata-section' });
            secEl.appendChild(createEl('h3', {
                className: 'metadata-section-title',
                text: section.title
            }));

            const list = createEl('ul', { className: 'metadata-section-list' });
            section.items.forEach(({ key, value, mono, pill, enabled, link, copy }) => {
                if (!value && value !== false && value !== 0) return;

                const item = createEl('li', { className: 'metadata-item' });

                const keyEl = createEl('span', { className: 'metadata-key', text: key });
                item.appendChild(keyEl);

                const valueWrap = createEl('div', { className: 'metadata-value-wrap' });
                let valueEl;
                if (pill) {
                    valueEl = createEl('span', {
                        className: `metadata-pill metadata-pill-${enabled ? 'enabled' : 'disabled'}`,
                        text: value
                    });
                } else if (link && value) {
                    valueEl = createEl('a', {
                        className: `metadata-value${mono ? ' mono' : ''}`,
                        attrs: { href: value, target: '_blank', rel: 'noopener noreferrer' },
                        text: value
                    });
                } else {
                    valueEl = createEl('span', {
                        className: `metadata-value${mono ? ' mono' : ''}`,
                        text: value
                    });
                }
                valueWrap.appendChild(valueEl);

                if (copy && value) {
                    const copyBtn = createEl('button', {
                        className: 'metadata-copy-btn',
                        attrs: { type: 'button', 'aria-label': `Copy ${key}` },
                        events: {
                            click: () => {
                                navigator.clipboard.writeText(value).catch(() => {});
                            }
                        },
                        children: [
                            createEl('span', { className: 'icon icon-copy', attrs: { 'aria-hidden': 'true' } })
                        ]
                    });
                    valueWrap.appendChild(copyBtn);
                }

                item.appendChild(valueWrap);
                list.appendChild(item);
            });

            secEl.appendChild(list);
            els.metadataList.appendChild(secEl);
        });
    }

    /* ========================================================================
       6. SUPPORT DEVELOPER (Enhanced)
       ======================================================================== */
    async function renderSupport(ext) {
        // Reset all states
        els.supportLoading.hidden = false;
        els.supportData.hidden = true;
        els.supportNotFound.hidden = true;

        els.supportExtIcon.src = ext.icons?.[0]?.url || '../../public/icons/svg/code.svg';
        els.supportExtIcon.onerror = () => {
            els.supportExtIcon.src = '../../public/icons/svg/code.svg';
        };

        setText(els.supportTitle, `Support ${ext.name}`);
        setText(els.supportTagline, 'Help the developer continue building great tools.');

        try {
            const data = await loadSupportData();
            const entry = findSupportEntry(ext.id);

            els.supportLoading.hidden = true;

            if (!entry) {
                els.supportNotFound.hidden = false;
                return;
            }

            clearEl(els.supportData);
            els.supportData.hidden = false;

            // Developer card
            const devCard = createEl('div', { className: 'support-dev-card' });
            const devHeader = createEl('div', { className: 'support-dev-header' });
            const devInfo = createEl('div', { className: 'support-dev-info' });
            devInfo.appendChild(createEl('h3', {
                className: 'support-dev-name',
                text: entry.developerName || ext.name
            }));
            devInfo.appendChild(createEl('p', {
                className: 'support-dev-by',
                text: `Developer of ${entry.name || ext.name}`
            }));
            devHeader.appendChild(devInfo);

            if (entry.supportEmail) {
                const emailLink = createEl('a', {
                    className: 'support-dev-email',
                    attrs: { href: `mailto:${entry.supportEmail}` },
                    children: [
                        createEl('span', { className: 'icon icon-support', attrs: { 'aria-hidden': 'true' } }),
                        document.createTextNode(entry.supportEmail)
                    ]
                });
                devHeader.appendChild(emailLink);
            }
            devCard.appendChild(devHeader);

            if (entry.description) {
                devCard.appendChild(createEl('p', {
                    className: 'support-desc',
                    text: entry.description
                }));
            }

            // Support links
            if (entry.support && Object.keys(entry.support).length > 0) {
                devCard.appendChild(createEl('h4', {
                    className: 'support-links-title',
                    text: 'Support Options'
                }));

                const linksGrid = createEl('div', { className: 'support-links-grid' });
                Object.entries(entry.support).forEach(([name, url]) => {
                    const linkCard = createEl('a', {
                        className: 'support-link-card',
                        attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' },
                        children: [
                            createEl('span', {
                                className: 'icon icon-store support-link-icon',
                                attrs: { 'aria-hidden': 'true' }
                            }),
                            createEl('span', { className: 'support-link-name', text: name }),
                            createEl('span', {
                                className: 'support-link-arrow',
                                attrs: { 'aria-hidden': 'true' },
                                text: '→'
                            })
                        ]
                    });
                    linksGrid.appendChild(linkCard);
                });
                devCard.appendChild(linksGrid);
            }

            els.supportData.appendChild(devCard);

        } catch (err) {
            console.error('[sc-report] Support render error:', err);
            els.supportLoading.hidden = true;
            els.supportNotFound.hidden = false;
        }
    }

    /* ========================================================================
       7. MAIN RENDER
       ======================================================================== */
    function renderExtensionDetails(ext) {
        SC.Views.show('single');

        els.extensionIcon.src = ext.icons?.[0]?.url || '../../public/icons/svg/code.svg';
        els.extensionIcon.onerror = () => {
            els.extensionIcon.src = '../../public/icons/svg/code.svg';
        };
        setText(els.extensionName, ext.name);
        setText(els.extensionVersion, ext.version ? `v${ext.version}` : '');

        const scores = calculateScores(ext.permissions, ext.hostPermissions);

        updateHeroScores(scores);
        updateScoreStrip(scores);
        renderScoreBreakdown(scores);

        renderPermissionsList(ext.permissions, ext.hostPermissions);
        renderMetadata(ext);
        renderSupport(ext);

        Tabs.init(
            ['tab-security', 'tab-details', 'tab-support'],
            ['panel-security', 'panel-details', 'panel-support']
        );
    }

    /* ========================================================================
       8. NAVIGATION
       ======================================================================== */
    function setupBackButtons() {
        els.backToDash?.addEventListener('click', () => {
            window.location.href = 'safety-center.html';
        });
    }

    /* ========================================================================
       9. PUBLIC API
       ======================================================================== */
    const Report = {
        init() {
            cacheElements();
            setupPermFilters();
            setupBackButtons();
            Popup.init();
        },
        render(ext) {
            renderExtensionDetails(ext);
        }
    };

    global.SafetyCenter.Report = Report;

})(typeof window !== 'undefined' ? window : this);