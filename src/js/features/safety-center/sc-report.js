/**
 * sc-report.js | modcore Safety Center Extension Report
 * Single-extension view: hero score, assessment, permission details, metadata.
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
        RISK_LEVELS, LEVEL_PILL_MAP,
        calculateScores, getPermInfo,
        getScoreArcOffset, getExtensionIconUrl, categoryColor,
        Popup, Tabs
    } = SC;

    const FALLBACK_ICON = '../../../public/icons/svg/code.svg';
    const els = {};

    function cacheElements() {
        els.extensionIcon    = $('extension-icon');
        els.extensionName    = $('extension-name');
        els.extensionVersion = $('extension-version');
        els.heroScoreArc     = $('hero-score-arc');
        els.heroScoreNumber  = $('hero-score-number');
        els.heroScoreLabel   = $('hero-score-label');

        els.scoreExplanation  = $('score-explanation');
        els.scoreBreakdown    = $('score-breakdown');

        els.allPermissionsList = $('all-permissions-list');
        els.permSearchInput    = $('perm-search-input');
        els.permFilterBtn      = $('perm-filter-btn');
        els.permFilterDropdown = $('perm-filter-dropdown');

        els.metadataList = $('ext-metadata-list');
        els.backToDash   = $('back-to-dashboard-btn');
    }

    /* Hero & score */
    function updateHeroScore(scores) {
        const lvl = RISK_LEVELS[scores.category];

        els.heroScoreArc.style.strokeDashoffset = getScoreArcOffset(scores.overallScore);
        els.heroScoreArc.style.stroke = categoryColor(scores.category);

        setText(els.heroScoreNumber, scores.overallScore);
        setText(els.heroScoreLabel, lvl.label);
        els.heroScoreLabel.style.background = categoryColor(scores.category);
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

        const frag = document.createDocumentFragment();
        top.forEach(({ permission, info }) => {
            const row = createEl('div', { className: 'score-breakdown-row' });
            row.appendChild(createEl('span', {
                className: 'score-breakdown-label',
                text: permission,
                attrs: { title: permission }
            }));
            row.appendChild(createEl('span', {
                className: `score-breakdown-pill ${LEVEL_PILL_MAP[info.level] || 'risk-moderate'}`,
                text: info.level
            }));
            frag.appendChild(row);
        });
        els.scoreBreakdown.appendChild(frag);
    }

    /* Permissions */
    const permFilterState = {
        risk: new Set(['high', 'moderate', 'low']),
        type: new Set(['api', 'host']),
        search: ''
    };

    function createPermItem(name, isHost) {
        const info = getPermInfo(name, isHost);
        const levelClass = LEVEL_PILL_MAP[info.level] || 'risk-moderate';

        const item = createEl('li', {
            className: 'perm-item',
            attrs: {
                'data-perm-name': name.toLowerCase(),
                'data-perm-risk': info.level,
                'data-perm-type': isHost ? 'host' : 'api',
                'data-perm-text': `${name} ${info.description} ${info.categories.join(' ')}`.toLowerCase()
            }
        });

        const content = createEl('div', { className: 'perm-item-content' });

        const header = createEl('div', { className: 'perm-item-header' });
        const nameWrap = createEl('div', { className: 'perm-item-name-wrap' });
        nameWrap.appendChild(createEl('h4', {
            className: 'perm-item-name',
            text: info.displayName || name
        }));
        nameWrap.appendChild(createEl('span', {
            className: `perm-item-type-badge ${isHost ? 'perm-type-host' : 'perm-type-api'}`,
            text: isHost ? 'Host' : 'API'
        }));
        header.appendChild(nameWrap);

        const actions = createEl('div', { className: 'perm-item-actions' });
        actions.appendChild(createEl('span', {
            className: `perm-item-risk-badge ${levelClass}`,
            text: info.level
        }));
        actions.appendChild(createEl('button', {
            className: 'icon-button',
            attrs: {
                type: 'button',
                'aria-label': `More details about ${name}`,
                title: 'More details'
            },
            events: {
                click: e => {
                    e.stopPropagation();
                    Popup.open(name, isHost, info);
                }
            },
            children: [
                createEl('span', { className: 'icon icon-info-status', attrs: { 'aria-hidden': 'true' } })
            ]
        }));
        header.appendChild(actions);
        content.appendChild(header);

        content.appendChild(createEl('p', {
            className: 'perm-item-desc',
            text: info.description
        }));

        const flags = createEl('div', { className: 'perm-item-flags' });
        if (info.requiresHost) {
            flags.appendChild(createEl('span', {
                className: 'perm-flag',
                text: 'Needs host access',
                attrs: { title: 'Requires host/URL permissions to be effective' }
            }));
        }
        if (!info.mv3Compatible) {
            flags.appendChild(createEl('span', {
                className: 'perm-flag',
                text: 'MV2 only',
                attrs: { title: 'Not compatible with Manifest V3' }
            }));
        }
        info.categories.forEach(cat => {
            flags.appendChild(createEl('span', { className: 'perm-item-cat', text: cat }));
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
            els.allPermissionsList.appendChild(createEmptyPermissionsState());
            return;
        }

        const levelOrder = { high: 0, moderate: 1, low: 2 };
        all.sort((a, b) => {
            const ia = getPermInfo(a.name, a.isHost);
            const ib = getPermInfo(b.name, b.isHost);
            const oa = levelOrder[ia.level] ?? 2;
            const ob = levelOrder[ib.level] ?? 2;
            return oa !== ob ? oa - ob : a.name.localeCompare(b.name);
        });

        const list = createEl('ul', { className: 'perm-flat-list', role: 'list' });
        const frag = document.createDocumentFragment();
        all.forEach(perm => frag.appendChild(createPermItem(perm.name, perm.isHost)));
        list.appendChild(frag);
        els.allPermissionsList.appendChild(list);

        applyPermFilters();
    }

    function createEmptyPermissionsState() {
        const empty = createEl('div', { className: 'empty-state' });
        empty.appendChild(createEl('div', {
            className: 'empty-state-icon',
            children: [createEl('span', { className: 'icon icon-check', attrs: { 'aria-hidden': 'true' } })]
        }));
        empty.appendChild(createEl('h3', {
            className: 'empty-state-title',
            text: 'No special permissions'
        }));
        empty.appendChild(createEl('p', {
            className: 'empty-state-desc',
            text: 'This extension does not request any special permissions.'
        }));
        return empty;
    }

    /* Permission filtering */
    function setupPermFilters() {
        if (!els.permSearchInput) return;

        const wrapper = els.permSearchInput.parentElement;
        const clearBtn = createEl('button', {
            className: 'perms-search-clear-btn',
            attrs: { type: 'button', 'aria-label': 'Clear permission search', title: 'Clear search' },
            events: {
                click: () => {
                    els.permSearchInput.value = '';
                    els.permSearchInput.focus();
                    debouncedFilter();
                }
            },
            children: [createEl('span', { className: 'icon icon-close', attrs: { 'aria-hidden': 'true' } })]
        });
        wrapper.appendChild(clearBtn);

        const debouncedFilter = debounce(() => {
            permFilterState.search = els.permSearchInput.value.trim().toLowerCase();
            clearBtn.style.display = permFilterState.search ? 'flex' : 'none';
            applyPermFilters();
        }, 150);

        els.permSearchInput.addEventListener('input', debouncedFilter);

        els.permFilterBtn.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = !els.permFilterDropdown.hidden;
            closeAllDropdowns();
            if (!isOpen) {
                els.permFilterDropdown.hidden = false;
                els.permFilterBtn.setAttribute('aria-expanded', 'true');
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
                const w = els.permFilterBtn?.closest('.filter-dropdown-wrap');
                if (w && !w.contains(e.target)) closeAllDropdowns();
            }
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeAllDropdowns();
        });
    }

    function updatePermFilterState() {
        permFilterState.risk.clear();
        permFilterState.type.clear();
        els.permFilterDropdown.querySelectorAll('input[name="risk-filter"]:checked')
            .forEach(cb => permFilterState.risk.add(cb.value));
        els.permFilterDropdown.querySelectorAll('input[name="type-filter"]:checked')
            .forEach(cb => permFilterState.type.add(cb.value));
    }

    function applyPermFilters() {
        const { search, risk, type } = permFilterState;
        const items = els.allPermissionsList.querySelectorAll('.perm-item');
        let visible = 0;

        items.forEach(item => {
            const matches =
                (!search ||
                    item.dataset.permName.includes(search) ||
                    item.dataset.permText.includes(search)) &&
                risk.has(item.dataset.permRisk) &&
                type.has(item.dataset.permType);
            item.hidden = !matches;
            if (matches) visible++;
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
        if (!els.permFilterDropdown || els.permFilterDropdown.hidden) return;
        els.permFilterDropdown.hidden = true;
        els.permFilterBtn.setAttribute('aria-expanded', 'false');
    }

    function resetPermFilters() {
        if (!els.permSearchInput) return;

        els.permSearchInput.value = '';
        permFilterState.search = '';
        permFilterState.risk = new Set(['high', 'moderate', 'low']);
        permFilterState.type = new Set(['api', 'host']);

        els.permFilterDropdown.querySelectorAll('input[type="checkbox"]')
            .forEach(cb => { cb.checked = true; });

        const clearBtn = els.permSearchInput.parentElement.querySelector('.perms-search-clear-btn');
        if (clearBtn) clearBtn.style.display = 'none';

        closeAllDropdowns();
    }

    /* Metadata */
    function renderMetadata(ext) {
        clearEl(els.metadataList);

        const sections = [
            {
                title: 'About',
                items: [
                    { key: 'Name',        value: ext.name },
                    { key: 'Short Name',  value: ext.shortName },
                    { key: 'Description', value: ext.description }
                ]
            },
            {
                title: 'Technical',
                items: [
                    { key: 'Extension ID', value: ext.id, mono: true, copy: true },
                    { key: 'Version',      value: ext.version },
                    { key: 'Type',         value: ext.type === 'extension' ? 'Extension' : ext.type },
                    { key: 'Install Type', value: ext.installType || 'Unknown' }
                ]
            },
            {
                title: 'Status',
                items: [
                    { key: 'Enabled',     value: ext.enabled ? 'Active' : 'Disabled', pill: true, enabled: ext.enabled },
                    { key: 'May Disable', value: ext.mayDisable ? 'Yes' : 'No' }
                ]
            },
            {
                title: 'Links',
                items: [
                    { key: 'Homepage',     value: ext.homepageUrl, link: true },
                    { key: 'Update URL',   value: ext.updateUrl,   link: true, mono: true },
                    { key: 'Options Page', value: ext.optionsUrl,  link: true }
                ]
            }
        ];

        const frag = document.createDocumentFragment();

        sections.forEach(section => {
            const secEl = createEl('li', { className: 'metadata-section' });
            secEl.appendChild(createEl('h3', {
                className: 'metadata-section-title',
                text: section.title
            }));

            const list = createEl('ul', { className: 'metadata-section-list' });
            section.items.forEach(item => {
                const rendered = renderMetadataItem(item);
                if (rendered) list.appendChild(rendered);
            });
            secEl.appendChild(list);

            frag.appendChild(secEl);
        });

        els.metadataList.appendChild(frag);
    }

    function renderMetadataItem({ key, value, mono, pill, enabled, link, copy }) {
        if (value == null || value === '') return null;

        const item = createEl('li', { className: 'metadata-item' });
        item.appendChild(createEl('span', { className: 'metadata-key', text: key }));

        const valueWrap = createEl('div', { className: 'metadata-value-wrap' });
        let valueEl;

        if (pill) {
            valueEl = createEl('span', {
                className: `metadata-pill metadata-pill-${enabled ? 'enabled' : 'disabled'}`,
                text: value
            });
        } else if (link) {
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

        if (copy) {
            valueWrap.appendChild(createEl('button', {
                className: 'metadata-copy-btn',
                attrs: { type: 'button', 'aria-label': `Copy ${key}`, title: 'Copy to clipboard' },
                events: {
                    click: () => navigator.clipboard.writeText(value).catch(() => {})
                },
                children: [createEl('span', { className: 'icon icon-copy', attrs: { 'aria-hidden': 'true' } })]
            }));
        }

        item.appendChild(valueWrap);
        return item;
    }

    /* Render */
    function renderExtensionDetails(ext) {
        SC.Views.show('single');
        resetPermFilters();

        const iconUrl = getExtensionIconUrl(ext) || FALLBACK_ICON;
        els.extensionIcon.src = iconUrl;
        els.extensionIcon.onerror = () => { els.extensionIcon.src = FALLBACK_ICON; };

        setText(els.extensionName, ext.name);
        setText(els.extensionVersion, ext.version ? `v${ext.version}` : '');

        const scores = calculateScores(ext.permissions, ext.hostPermissions);
        updateHeroScore(scores);
        setText(els.scoreExplanation, RISK_LEVELS[scores.category].description);
        renderScoreBreakdown(scores);

        renderPermissionsList(ext.permissions, ext.hostPermissions);
        renderMetadata(ext);
    }

    /* Navigation */
    function setupBackButtons() {
        els.backToDash?.addEventListener('click', () => {
            window.location.href = 'safety-center.html';
        });
    }

    /* Public API */
    global.SafetyCenter.Report = {
        init() {
            cacheElements();
            setupPermFilters();
            setupBackButtons();
            Popup.init();
            Tabs.init(['tab-security', 'tab-details'], ['panel-security', 'panel-details']);
        },
        render(ext) {
            renderExtensionDetails(ext);
        }
    };

})(typeof window !== 'undefined' ? window : this);