// safety-center.js - modcore Safety Center (permissions.json-driven)

(function () {

    // ─── DOM refs ────────────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);

    const extensionIcon          = $('extension-icon');
    const extensionName          = $('extension-name');
    const overallScoreValue      = $('overall-score-value');
    const overallScoreCategory   = $('overall-score-category');
    const overallScoreExplanation= $('score-explanation');
    const allPermissionsList     = $('all-permissions-list');
    const toastContainer         = $('toast-container');
    const singleExtensionView    = $('single-extension-view');
    const allExtensionsView      = $('all-extensions-view');
    const allExtensionsList      = $('all-extensions-list');
    const permissionCountList    = $('permission-count-list');
    const riskRatingList         = $('risk-rating-list');
    const filteredExtensionsView = $('filtered-extensions-view');
    const filteredExtensionsList = $('filtered-extensions-list');
    const filteredViewHeader     = $('filtered-view-header');
    const permissionSearchInput  = $('permission-search-input');
    const privacyScoreGraph      = $('privacy-score-graph');
    const securityScoreGraph     = $('security-score-graph');
    const privacyScoreValue      = $('privacy-score-value');
    const securityScoreValue     = $('security-score-value');

    // ─── permissions.json data (populated after fetch) ───────────────────────
    let PERM_DB       = {};   // keyed by permission name
    let PERM_CATS     = {};   // categories meta
    let PERM_RISK_META= {};   // riskLevels meta

    // ─── Internal risk mapping: json riskLevel → our scoring buckets ─────────
    // permissions.json uses: "low" | "medium" | "high" | "varies"
    // We keep: "low" | "moderate" | "high" | "critical"   (unchanged UI labels)
    const JSON_TO_INTERNAL = {
        low:    'low',
        medium: 'moderate',
        high:   'high',
        varies: 'moderate'
    };

    // Base impact scores per internal level (security, privacy)
    const LEVEL_BASE_IMPACT = {
        critical: { security: 90, privacy: 85 },
        high:     { security: 65, privacy: 70 },
        moderate: { security: 35, privacy: 38 },
        low:      { security:  8, privacy:  8 }
    };

    // Category privacy/security weights
    // categories in json: privacy, security, functionality, accessibility, data
    const CAT_WEIGHTS = {
        privacy:       { security: 0.4, privacy: 1.0 },
        security:      { security: 1.0, privacy: 0.5 },
        data:          { security: 0.5, privacy: 0.9 },
        functionality: { security: 0.1, privacy: 0.1 },
        accessibility: { security: 0.2, privacy: 0.2 }
    };

    // ─── Risk level definitions (UI display) ─────────────────────────────────
    const RISK_LEVELS = {
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
            description: 'Requests permissions that warrant review. Verify the extension\'s purpose aligns with requested capabilities.'
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
    };

    // ─── Fetch permissions.json ───────────────────────────────────────────────
    async function loadPermissionsDB() {
        // Resolve path relative to this script's location
        const scriptSrc = document.currentScript?.src || '';
        let base = scriptSrc ? scriptSrc.replace(/\/js\/.*$/, '') : '';
        const candidates = [
            base ? `${base}/data/permissions.json` : null,
            '../js/features/permissions.json',
            '../js/features/permissions.json',
            'permissions.json'
        ].filter(Boolean);

        for (const url of candidates) {
            try {
                const resp = await fetch(url);
                if (resp.ok) {
                    const data = await resp.json();
                    PERM_DB        = data.permissions   || {};
                    PERM_CATS      = data.categories    || {};
                    PERM_RISK_META = data.riskLevels    || {};
                    return;
                }
            } catch (_) { /* try next */ }
        }
        console.warn('[SafetyCenter] Could not load permissions.json - falling back to empty DB.');
    }

    // ─── Permission info resolver ─────────────────────────────────────────────
    /**
     * Returns a normalised info object for a given permission string.
     * Pulls from permissions.json (PERM_DB); falls back gracefully.
     */
    function getPermInfo(permission) {
        // Direct lookup
        let entry = PERM_DB[permission];

        // Prefix lookup: e.g. "http://*/*" → use "<all_urls>" logic
        if (!entry) {
            if (/^https?:\/\/\*/.test(permission) || permission === '<all_urls>') {
                entry = PERM_DB['<all_urls>'] || PERM_DB['host_permissions'];
            }
        }

        if (entry) {
            const jsonLevel   = entry.riskLevel || 'low';
            const internalLvl = JSON_TO_INTERNAL[jsonLevel] || 'low';
            const cats        = Array.isArray(entry.category) ? entry.category : [entry.category || 'functionality'];

            // Build weighted base impacts from categories
            let secImpact = LEVEL_BASE_IMPACT[internalLvl].security;
            let privImpact= LEVEL_BASE_IMPACT[internalLvl].privacy;

            // Adjust based on declared categories
            const hasPriv = cats.includes('privacy') || cats.includes('data');
            const hasSec  = cats.includes('security');
            if (hasPriv)  privImpact  = Math.min(100, privImpact * 1.25);
            if (hasSec)   secImpact   = Math.min(100, secImpact  * 1.25);

            return {
                level:           internalLvl,
                security_impact: secImpact,
                privacy_impact:  privImpact,
                type:            cats[0] || 'functionality',
                categories:      cats.map(c => PERM_CATS[c]?.name || capitalise(c)),
                description:     entry.detailedDescription || entry.shortDescription || 'No description available.',
                shortDescription:entry.shortDescription || '',
                link:            entry.chromeLink || null,
                requiresHost:    entry.requiresHostPermission || false,
                mv3Compatible:   entry.mv3Compatible !== false,
                commonUseCases:  entry.commonUseCases || [],
                mitigationTips:  entry.mitigationTips || [],
                displayName:     entry.name || permission
            };
        }

        // Unknown / unrecognised permission
        return {
            level:           'moderate',
            security_impact: 45,
            privacy_impact:  45,
            type:            'unknown',
            categories:      ['Unclassified'],
            description:     'Unrecognised permission. Exercise caution as impact cannot be determined without additional analysis.',
            shortDescription:'Unknown permission',
            link:            null,
            requiresHost:    false,
            mv3Compatible:   true,
            commonUseCases:  [],
            mitigationTips:  ['Research this permission before granting'],
            displayName:     permission
        };
    }

    function capitalise(str) {
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
    }

    // ─── Score calculation ────────────────────────────────────────────────────
    /**
     * Calculate comprehensive security assessment scores from a permissions array.
     * Uses permissions.json data for accurate weighted impact.
     */
    function calculateSecurityScores(permissions) {
        if (!permissions || permissions.length === 0) {
            return { overallScore: 100, securityScore: 100, privacyScore: 100, category: 'excellent', permissionCount: 0, breakdown: [] };
        }

        let totalSecurity = 0;
        let totalPrivacy  = 0;
        const breakdown   = [];

        // First pass: highest-impact permissions are counted fully; subsequent ones
        // have diminishing returns to prevent score collapse on big but benign extensions.
        const sorted = [...permissions].sort((a, b) => {
            const ia = getPermInfo(a);
            const ib = getPermInfo(b);
            return (ib.security_impact + ib.privacy_impact) - (ia.security_impact + ia.privacy_impact);
        });

        sorted.forEach((permission, idx) => {
            const info = getPermInfo(permission);

            // Diminishing returns: each successive permission adds 85% of previous weight
            const dimFactor = Math.pow(0.88, idx);

            // Critical permissions bypass diminishing returns partially
            const criticalBoost = info.level === 'critical' ? 1.5 :
                                  info.level === 'high'     ? 1.15 : 1.0;

            const secContrib  = info.security_impact * dimFactor * criticalBoost;
            const privContrib = info.privacy_impact  * dimFactor * criticalBoost;

            totalSecurity += secContrib;
            totalPrivacy  += privContrib;

            breakdown.push({ permission, info, secContrib: Math.round(secContrib), privContrib: Math.round(privContrib) });
        });

        // Sprawl bonus: many permissions increase risk regardless of individual level
        const sprawlBonus = Math.min(permissions.length * 1.8, 25);
        totalSecurity += sprawlBonus;
        totalPrivacy  += sprawlBonus;

        // Normalise against a calibrated max
        const maxImpact    = 500;
        const securityScore = Math.max(0, Math.min(100, Math.round(100 - (totalSecurity / maxImpact) * 100)));
        const privacyScore  = Math.max(0, Math.min(100, Math.round(100 - (totalPrivacy  / maxImpact) * 100)));

        // Overall: 55% lower score + 45% higher score (penalises one bad dimension strongly)
        const lower = Math.min(securityScore, privacyScore);
        const upper = Math.max(securityScore, privacyScore);
        const overallScore = Math.round(lower * 0.6 + upper * 0.4);

        // Determine category
        let category = 'high-risk';
        for (const [key, lvl] of Object.entries(RISK_LEVELS)) {
            if (overallScore >= lvl.scoreMin) { category = key; break; }
        }

        return { overallScore, securityScore, privacyScore, category, permissionCount: permissions.length, breakdown };
    }

    // ─── Score display ────────────────────────────────────────────────────────
    function updateScoreDisplays(scores) {
        const levelInfo = RISK_LEVELS[scores.category];

        // Overall
        overallScoreValue.textContent      = scores.overallScore;
        overallScoreCategory.textContent   = levelInfo.label;
        overallScoreCategory.className     = `score-label ${levelInfo.class}`;
        overallScoreExplanation.textContent= levelInfo.description;

        // Security circle
        securityScoreValue.textContent = scores.securityScore;
        securityScoreGraph.style.setProperty('--score-value', scores.securityScore);
        applyScoreColor(securityScoreGraph, securityScoreValue, scores.securityScore);

        // Privacy circle
        privacyScoreValue.textContent = scores.privacyScore;
        privacyScoreGraph.style.setProperty('--score-value', scores.privacyScore);
        applyScoreColor(privacyScoreGraph, privacyScoreValue, scores.privacyScore);
    }

    function applyScoreColor(circle, label, score) {
        const colorVar = score >= 85 ? '--color-excellent' :
                         score >= 70 ? '--color-good'      :
                         score >= 50 ? '--color-moderate'  :
                         score >= 30 ? '--color-concerning': '--color-high-risk';
        const color = getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim();
        circle.style.background = `conic-gradient(${color} calc(${score} * 1%), var(--color-border-light) calc(${score} * 1%))`;
    }

    // ─── Permission list rendering ────────────────────────────────────────────
    function createPermissionListItem(permission) {
        const info = getPermInfo(permission);

        const item = document.createElement('li');
        item.className = `permission-item permission-${info.level}`;

        // Icon
        const iconContainer = document.createElement('div');
        iconContainer.className = `permission-icon ${RISK_LEVELS[info.level]?.class || 'risk-moderate'}`;
        const iconSymbol = { critical: '!', high: '!', moderate: '~', low: '✓' }[info.level] || '?';
        iconContainer.setAttribute('aria-label', `${info.level} risk`);
        iconContainer.textContent = iconSymbol;

        // Content
        const content = document.createElement('div');
        content.className = 'permission-content';

        // Header row
        const header = document.createElement('div');
        header.className = 'permission-header';

        const titleRow = document.createElement('div');
        titleRow.className = 'permission-title-row';

        const title = document.createElement('h5');
        title.className = 'permission-title';
        title.textContent = info.displayName || permission;

        // Flags row: host required, mv3 compat
        const flags = document.createElement('div');
        flags.className = 'permission-flags';

        if (info.requiresHost) {
            const flag = document.createElement('span');
            flag.className = 'permission-flag permission-flag-host';
            flag.textContent = 'Needs host access';
            flag.title = 'This permission requires host/URL permissions to be effective';
            flags.appendChild(flag);
        }
        if (!info.mv3Compatible) {
            const flag = document.createElement('span');
            flag.className = 'permission-flag permission-flag-mv2';
            flag.textContent = 'MV2 only';
            flag.title = 'This permission is not compatible with Manifest V3';
            flags.appendChild(flag);
        }

        titleRow.appendChild(title);
        if (flags.children.length) titleRow.appendChild(flags);

        const rightSide = document.createElement('div');
        rightSide.className = 'permission-right';

        // Badges
        const badges = document.createElement('div');
        badges.className = 'permission-badges';
        info.categories.forEach(cat => {
            const badge = document.createElement('span');
            badge.className = 'permission-badge';
            badge.textContent = cat;
            badges.appendChild(badge);
        });

        // Docs link
        if (info.link) {
            const link = document.createElement('a');
            link.href = info.link;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'permission-link';
            link.setAttribute('aria-label', `View ${permission} documentation`);
            
            const svgImg = document.createElement('img');
            svgImg.src = '../../public/icons/svg/link.svg'; // 
            svgImg.alt = ''; // decorative, already described by aria-label
            svgImg.width = 14;
            svgImg.height = 14;
            svgImg.style.marginRight = '4px'; // optional spacing

            link.appendChild(svgImg);
            link.appendChild(document.createTextNode('Docs'));
            
            rightSide.appendChild(link);
}

        header.appendChild(titleRow);
        rightSide.insertBefore(badges, rightSide.firstChild);
        header.appendChild(rightSide);
        content.appendChild(header);

        // Description
        const desc = document.createElement('p');
        desc.className = 'permission-description';
        desc.textContent = info.description;
        content.appendChild(desc);

        // Common use-cases (collapsible extras)
        if (info.commonUseCases.length || info.mitigationTips.length) {
            const extras = document.createElement('details');
            extras.className = 'permission-extras';

            const extSummary = document.createElement('summary');
            extSummary.textContent = 'Details & tips';
            extras.appendChild(extSummary);

            const extBody = document.createElement('div');
            extBody.className = 'permission-extras-body';

            if (info.commonUseCases.length) {
                const useCasesLabel = document.createElement('p');
                useCasesLabel.className = 'permission-extras-label';
                useCasesLabel.textContent = 'Common use cases';
                extBody.appendChild(useCasesLabel);
                const ucList = document.createElement('ul');
                ucList.className = 'permission-extras-list';
                info.commonUseCases.forEach(uc => {
                    const li = document.createElement('li');
                    li.textContent = uc;
                    ucList.appendChild(li);
                });
                extBody.appendChild(ucList);
            }

            if (info.mitigationTips.length) {
                const tipsLabel = document.createElement('p');
                tipsLabel.className = 'permission-extras-label';
                tipsLabel.textContent = 'What to watch for';
                extBody.appendChild(tipsLabel);
                const tList = document.createElement('ul');
                tList.className = 'permission-extras-list permission-extras-list-tips';
                info.mitigationTips.forEach(tip => {
                    const li = document.createElement('li');
                    li.textContent = tip;
                    tList.appendChild(li);
                });
                extBody.appendChild(tList);
            }

            extras.appendChild(extBody);
            content.appendChild(extras);
        }

        item.appendChild(iconContainer);
        item.appendChild(content);

        return item;
    }

    function renderPermissionsList(permissions) {
        while (allPermissionsList.firstChild) allPermissionsList.removeChild(allPermissionsList.firstChild);

        if (!permissions || permissions.length === 0) {
            const msg = document.createElement('p');
            msg.className = 'no-permissions-message';
            msg.textContent = 'This extension does not request any special permissions.';
            allPermissionsList.appendChild(msg);
            return;
        }

        // Group by internal level
        const grouped = { critical: [], high: [], moderate: [], low: [] };
        permissions.forEach(perm => {
            const info = getPermInfo(perm);
            (grouped[info.level] || grouped.moderate).push(perm);
        });

        const order  = ['critical', 'high', 'moderate', 'low'];
        const labels = { critical: 'Critical Risk', high: 'High Risk', moderate: 'Moderate Risk', low: 'Standard' };

        order.forEach(level => {
            if (!grouped[level].length) return;

            const section = document.createElement('details');
            section.className = `permission-category permission-category-${level}`;
            if (level === 'critical' || level === 'high') section.open = true;

            const summary = document.createElement('summary');
            summary.className = 'permission-category-summary';

            const summaryLeft = document.createElement('span');
            summaryLeft.className = 'permission-category-label';
            summaryLeft.textContent = `${labels[level]} Permissions`;

            const summaryCount = document.createElement('span');
            summaryCount.className = 'permission-category-count';
            summaryCount.textContent = grouped[level].length;

            summary.appendChild(summaryLeft);
            summary.appendChild(summaryCount);
            section.appendChild(summary);

            const list = document.createElement('ul');
            list.className = 'permission-list';
            grouped[level].forEach(perm => list.appendChild(createPermissionListItem(perm)));
            section.appendChild(list);
            allPermissionsList.appendChild(section);
        });
    }

    // ─── Extension card ───────────────────────────────────────────────────────
    function createExtensionCard(extension) {
        const scores = calculateSecurityScores(extension.permissions || []);
        const lvl    = RISK_LEVELS[scores.category];

        const card = document.createElement('li');
        card.className = 'extension-card';
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `View ${extension.name} details`);
        card.addEventListener('click', () => {
            window.location.href = `safety-center.html?id=${extension.id}`;
        });
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                window.location.href = `safety-center.html?id=${extension.id}`;
            }
        });

        // Icon
        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'extension-card-icon-wrapper';
        const icon = document.createElement('img');
        icon.className = 'extension-card-icon';
        icon.src = extension.icons?.[0]?.url || '../../public/icons/svg/code.svg';
        icon.alt = '';
        icon.loading = 'lazy';
        icon.onerror = () => { icon.src = '../../public/icons/svg/code.svg'; };
        iconWrapper.appendChild(icon);

        // Content
        const content = document.createElement('div');
        content.className = 'extension-card-content';

        const name = document.createElement('h3');
        name.className = 'extension-card-name';
        name.textContent = extension.name;

        const meta = document.createElement('div');
        meta.className = 'extension-card-meta';

        const count = extension.permissions?.length || 0;
        const permCount = document.createElement('span');
        permCount.className = 'extension-card-permissions';
        permCount.textContent = `${count} permission${count !== 1 ? 's' : ''}`;
        meta.appendChild(permCount);

        // Disabled badge
        if (!extension.enabled) {
            const disabledBadge = document.createElement('span');
            disabledBadge.className = 'extension-card-disabled-badge';
            disabledBadge.textContent = 'Disabled';
            meta.appendChild(disabledBadge);
        }

        content.appendChild(name);
        content.appendChild(meta);

        // Score
        const scoreDisplay = document.createElement('div');
        scoreDisplay.className = 'extension-card-score';

        const scoreValue = document.createElement('div');
        scoreValue.className = `extension-card-score-value ${lvl.class}`;
        scoreValue.textContent = scores.overallScore;
        scoreValue.setAttribute('aria-label', `Score: ${scores.overallScore}`);

        const scoreLabel = document.createElement('div');
        scoreLabel.className = 'extension-card-score-label';
        scoreLabel.textContent = lvl.label;

        scoreDisplay.appendChild(scoreValue);
        scoreDisplay.appendChild(scoreLabel);

        card.appendChild(iconWrapper);
        card.appendChild(content);
        card.appendChild(scoreDisplay);

        // Data attributes for search/filter
        card.dataset.name       = extension.name.toLowerCase();
        card.dataset.category   = scores.category;
        card.dataset.permissions= (extension.permissions || []).join(',').toLowerCase();

        return card;
    }

    // ─── Score info tooltip ───────────────────────────────────────────────────
    function setupScoreInfoTooltip() {
        const infoBtn = $('score-info-btn');
        const tooltip = $('score-info-tooltip');
        if (!infoBtn || !tooltip) return;

        let open = false;

        function toggleTooltip(show) {
            open = show;
            tooltip.hidden = !show;
            infoBtn.setAttribute('aria-expanded', String(show));
        }

        infoBtn.addEventListener('click', e => {
            e.stopPropagation();
            toggleTooltip(!open);
        });

        infoBtn.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTooltip(!open); }
            if (e.key === 'Escape') toggleTooltip(false);
        });

        document.addEventListener('click', e => {
            if (open && !tooltip.contains(e.target) && e.target !== infoBtn) toggleTooltip(false);
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && open) toggleTooltip(false);
        });
    }

    // ─── Dashboard rendering ──────────────────────────────────────────────────
    function renderDashboard(extensions) {
        singleExtensionView.style.display  = 'none';
        filteredExtensionsView.style.display= 'none';
        allExtensionsView.style.display    = 'block';

        while (allExtensionsList.firstChild) allExtensionsList.removeChild(allExtensionsList.firstChild);

        const enabled = extensions.filter(ext => ext.enabled);
        const stats = {
            total: extensions.length,
            enabled: enabled.length,
            categories: { excellent: 0, good: 0, moderate: 0, concerning: 0, 'high-risk': 0 },
            permissions: {}
        };

        // Sort enabled by risk (worst first), then name
        const categoryOrder = ['high-risk', 'concerning', 'moderate', 'good', 'excellent'];
        const sorted = [...enabled].sort((a, b) => {
            const sa = calculateSecurityScores(a.permissions || []);
            const sb = calculateSecurityScores(b.permissions || []);
            const oi = categoryOrder.indexOf(sa.category);
            const oj = categoryOrder.indexOf(sb.category);
            if (oi !== oj) return oi - oj;
            return a.name.localeCompare(b.name);
        });

        sorted.forEach(ext => {
            const scores = calculateSecurityScores(ext.permissions || []);
            stats.categories[scores.category]++;
            (ext.permissions || []).forEach(p => {
                stats.permissions[p] = (stats.permissions[p] || 0) + 1;
            });
            allExtensionsList.appendChild(createExtensionCard(ext));
        });

        // Also show disabled extensions (at the end, sorted alphabetically)
        extensions.filter(e => !e.enabled)
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(ext => allExtensionsList.appendChild(createExtensionCard(ext)));

        // Stats
        $('total-extensions-count').textContent   = stats.total;
        $('enabled-extensions-count').textContent = stats.enabled;
        $('high-risk-count').textContent          = stats.categories['high-risk'];
        $('concerning-count').textContent         = stats.categories.concerning;
        $('moderate-risk-count').textContent      = stats.categories.moderate;

        renderPermissionCounts(stats.permissions, extensions);
        renderRiskDistribution(stats.categories, extensions);
        setupDashboardAnalytics(extensions);
    }

    // ─── Analytics bar (new feature) ─────────────────────────────────────────
    function setupDashboardAnalytics(extensions) {
        const container = $('analytics-summary');
        if (!container) return;

        const enabled = extensions.filter(e => e.enabled);
        const allPerms = enabled.flatMap(e => e.permissions || []);
        const criticalCount = allPerms.filter(p => getPermInfo(p).level === 'critical').length;
        const uniquePerms   = new Set(allPerms).size;
        const avgScore      = enabled.length
            ? Math.round(enabled.reduce((s, e) => s + calculateSecurityScores(e.permissions || []).overallScore, 0) / enabled.length)
            : 100;

        container.innerHTML = '';

        const items = [
            { label: 'Avg. Safety Score', value: avgScore, suffix: '/100' },
            { label: 'Unique Permissions', value: uniquePerms },
            { label: 'Critical Permissions', value: criticalCount, warn: criticalCount > 0 }
        ];

        items.forEach(({ label, value, suffix = '', warn = false }) => {
            const el = document.createElement('div');
            el.className = 'analytics-item';
            el.innerHTML = `
                <span class="analytics-value${warn ? ' analytics-value-warn' : ''}">${value}${suffix}</span>
                <span class="analytics-label">${label}</span>
            `;
            container.appendChild(el);
        });
    }

    // ─── Permission frequency list ────────────────────────────────────────────
    function renderPermissionCounts(permissions, extensions) {
        while (permissionCountList.firstChild) permissionCountList.removeChild(permissionCountList.firstChild);

        const sorted = Object.entries(permissions)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 12);

        if (sorted.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'stat-item stat-item-empty';
            empty.textContent = 'No permissions found.';
            permissionCountList.appendChild(empty);
            return;
        }

        sorted.forEach(([permission, count]) => {
            const info = getPermInfo(permission);
            const item = document.createElement('li');
            item.className = 'stat-item stat-item-clickable';
            item.setAttribute('tabindex', '0');
            item.setAttribute('role', 'button');
            item.setAttribute('aria-label', `Filter by ${permission}`);
            item.addEventListener('click', () => filterExtensionsByPermission(extensions, permission));
            item.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); filterExtensionsByPermission(extensions, permission); }
            });

            const nameWrapper = document.createElement('div');
            nameWrapper.className = 'stat-item-name-wrapper';

            const name = document.createElement('span');
            name.className = 'stat-item-name';
            name.textContent = permission;

            const badge = document.createElement('span');
            const badgeLevel = info.level === 'low' ? 'good' : info.level;
            badge.className = `stat-item-badge ${RISK_LEVELS[badgeLevel]?.class || 'risk-moderate'}`;
            badge.textContent = info.level;

            nameWrapper.appendChild(name);
            nameWrapper.appendChild(badge);

            const value = document.createElement('span');
            value.className = 'stat-item-value';
            value.textContent = `${count} ext${count !== 1 ? 's' : ''}`;

            item.appendChild(nameWrapper);
            item.appendChild(value);
            permissionCountList.appendChild(item);
        });
    }

    // ─── Risk distribution ────────────────────────────────────────────────────
    function renderRiskDistribution(categories, extensions) {
        while (riskRatingList.firstChild) riskRatingList.removeChild(riskRatingList.firstChild);

        const order = ['high-risk', 'concerning', 'moderate', 'good', 'excellent'];
        let hasAny = false;

        order.forEach(category => {
            const count = categories[category];
            if (!count) return;
            hasAny = true;

            const item = document.createElement('li');
            item.className = 'stat-item stat-item-clickable';
            item.setAttribute('tabindex', '0');
            item.setAttribute('role', 'button');
            item.setAttribute('aria-label', `Filter ${RISK_LEVELS[category].label} extensions`);
            item.addEventListener('click', () => filterExtensionsByCategory(extensions, category));
            item.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); filterExtensionsByCategory(extensions, category); }
            });

            const nameWrapper = document.createElement('div');
            nameWrapper.className = 'stat-item-name-wrapper';

            const dot = document.createElement('span');
            dot.className = `risk-dot risk-dot-${category.replace('-', '')}`;

            const name = document.createElement('span');
            name.className = `stat-item-name ${RISK_LEVELS[category].class}`;
            name.textContent = RISK_LEVELS[category].label;

            nameWrapper.appendChild(dot);
            nameWrapper.appendChild(name);

            const value = document.createElement('span');
            value.className = 'stat-item-value';
            value.textContent = `${count} extension${count !== 1 ? 's' : ''}`;

            item.appendChild(nameWrapper);
            item.appendChild(value);
            riskRatingList.appendChild(item);
        });

        if (!hasAny) {
            const empty = document.createElement('li');
            empty.className = 'stat-item stat-item-empty';
            empty.textContent = 'No extensions to categorise.';
            riskRatingList.appendChild(empty);
        }
    }

    // ─── Single extension view ────────────────────────────────────────────────
    function renderExtensionDetails(extension) {
        singleExtensionView.style.display  = 'block';
        allExtensionsView.style.display    = 'none';
        filteredExtensionsView.style.display= 'none';

        extensionIcon.src = extension.icons?.[0]?.url || '../../public/icons/svg/code.svg';
        extensionIcon.alt = '';
        extensionIcon.onerror = () => { extensionIcon.src = '../../public/icons/svg/code.svg'; };
        extensionName.textContent = extension.name;

        const scores = calculateSecurityScores(extension.permissions || []);
        updateScoreDisplays(scores);
        renderPermissionsList(extension.permissions || []);
        renderScoreBreakdown(scores);
        setupScoreInfoTooltip();
    }

    // ─── Score breakdown (new feature) ───────────────────────────────────────
    function renderScoreBreakdown(scores) {
        const container = $('score-breakdown');
        if (!container) return;
        container.innerHTML = '';

        if (!scores.breakdown || scores.breakdown.length === 0) {
            container.innerHTML = '<p class="score-breakdown-empty">No permissions to analyse.</p>';
            return;
        }

        // Top contributors
        const top = [...scores.breakdown]
            .sort((a, b) => (b.secContrib + b.privContrib) - (a.secContrib + a.privContrib))
            .slice(0, 6);

        top.forEach(({ permission, info }) => {
            const row = document.createElement('div');
            row.className = `score-breakdown-row score-breakdown-${info.level}`;

            const label = document.createElement('span');
            label.className = 'score-breakdown-label';
            label.textContent = permission;

            const pill = document.createElement('span');
            pill.className = `score-breakdown-pill ${RISK_LEVELS[info.level]?.class || 'risk-moderate'}`;
            pill.textContent = info.level;

            row.appendChild(label);
            row.appendChild(pill);
            container.appendChild(row);
        });
    }

    // ─── Filter views ─────────────────────────────────────────────────────────
    function filterExtensionsByPermission(extensions, permission) {
        const filtered = extensions.filter(ext =>
            ext.enabled && (ext.permissions || []).includes(permission)
        );
        renderFilteredView(
            filtered,
            `Extensions Using "${permission}"`,
            `${filtered.length} extension${filtered.length !== 1 ? 's' : ''} request this permission`
        );
    }

    function filterExtensionsByCategory(extensions, category) {
        const filtered = extensions.filter(ext => {
            if (!ext.enabled) return false;
            return calculateSecurityScores(ext.permissions || []).category === category;
        });
        renderFilteredView(
            filtered,
            `${RISK_LEVELS[category].label} Extensions`,
            `${filtered.length} extension${filtered.length !== 1 ? 's' : ''} in this category`
        );
    }

    function renderFilteredView(extensions, title, subtitle) {
        allExtensionsView.style.display    = 'none';
        singleExtensionView.style.display  = 'none';
        filteredExtensionsView.style.display= 'block';

        filteredViewHeader.textContent = title;
        const sub = $('filtered-view-subtitle');
        if (sub) sub.textContent = subtitle;

        while (filteredExtensionsList.firstChild) filteredExtensionsList.removeChild(filteredExtensionsList.firstChild);

        if (extensions.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'no-permissions-message';
            empty.textContent = 'No extensions match this filter.';
            filteredExtensionsList.appendChild(empty);
            return;
        }

        extensions.forEach(ext => filteredExtensionsList.appendChild(createExtensionCard(ext)));
    }

    // ─── Search ───────────────────────────────────────────────────────────────
    if (permissionSearchInput) {
        let debounceTimer;
        permissionSearchInput.addEventListener('input', e => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const query = e.target.value.toLowerCase().trim();
                const cards = allExtensionsList.querySelectorAll('.extension-card');
                let visible = 0;
                cards.forEach(card => {
                    const matches = !query ||
                        (card.dataset.name        || '').includes(query) ||
                        (card.dataset.permissions || '').includes(query) ||
                        (card.dataset.category    || '').includes(query);
                    card.style.display = matches ? '' : 'none';
                    if (matches) visible++;
                });

                // Show empty state
                let emptyMsg = allExtensionsList.querySelector('.search-empty-state');
                if (visible === 0 && query) {
                    if (!emptyMsg) {
                        emptyMsg = document.createElement('li');
                        emptyMsg.className = 'search-empty-state';
                        emptyMsg.textContent = `No extensions match "${query}"`;
                        allExtensionsList.appendChild(emptyMsg);
                    }
                } else if (emptyMsg) {
                    emptyMsg.remove();
                }
            }, 120);
        });

        // Keyboard shortcut: Ctrl/Cmd+K or '/'
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                permissionSearchInput.focus();
                permissionSearchInput.select();
            }
            if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                permissionSearchInput.focus();
            }
        });
    }

    // ─── Back buttons ─────────────────────────────────────────────────────────
    const backToDash = $('back-to-dashboard-btn');
    if (backToDash) {
        backToDash.addEventListener('click', () => { window.location.href = 'safety-center.html'; });
    }

    const backFromFiltered = $('back-from-filtered-btn');
    if (backFromFiltered) {
        backFromFiltered.addEventListener('click', () => {
            allExtensionsView.style.display    = 'block';
            filteredExtensionsView.style.display= 'none';
        });
    }

    // ─── Toast ────────────────────────────────────────────────────────────────
    function showToast(message, type = 'info', duration = 3500) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.setAttribute('role', 'alert');
        toast.textContent = message;
        toastContainer.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('toast-show'));
        setTimeout(() => {
            toast.classList.remove('toast-show');
            setTimeout(() => toast.parentNode && toastContainer.removeChild(toast), 300);
        }, duration);
    }

    // ─── Initialise ───────────────────────────────────────────────────────────
    async function initialize() {
        try {
            // Load permissions.json first - all scoring depends on it
            await loadPermissionsDB();

            const params      = new URLSearchParams(window.location.search);
            const extensionId = params.get('id');
            const extensions  = await chrome.management.getAll();

            if (extensionId) {
                const extension = extensions.find(ext => ext.id === extensionId);
                if (extension) {
                    renderExtensionDetails(extension);
                } else {
                    showToast('Extension not found', 'error');
                    renderDashboard(extensions);
                }
            } else {
                renderDashboard(extensions);
            }
        } catch (err) {
            console.error('[SafetyCenter] Initialization error:', err);
            showToast('Failed to load extension data', 'error');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
