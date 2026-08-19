(() => {
    'use strict';

    if (window.__mcSidebarMounted) return;
    window.__mcSidebarMounted = true;

    const EXPANDED_STATE_KEY = 'mc-sidebar-expanded-groups';
    const DEFAULT_HELP_LINK = 'https://sites.google.com/view/modcore-em-help/';
    const BREAKPOINT_SMALL = 900;
    
    // Manage popover delay globally
    let activePopoverTimeout = null;

    const NAV_TREE = [
        {
            id: 'timeline',
            label: 'Timeline',
            icon: 'icon-clock',
            href: 'src/views/timeline/timeline.html',
            helpUrl: 'https://sites.google.com/view/modcore-em-help/manage-extensions/extension-activity-log-page',
            sub: [
                { id: 'panel-history', label: 'Activity', hash: '#panel-history' },
                { id: 'panel-settings', label: 'Settings', hash: '#panel-settings' }
            ]
        },
        {
            id: 'automations',
            label: 'Automations',
            icon: 'icon-rules',
            href: 'src/views/automations/automations.html',
            helpUrl: 'https://sites.google.com/view/modcore-em-help/manage-extensions/automations',
            sub: [
                { id: 'panel-rules', label: 'Rules', hash: '#panel-rules' },
                { id: 'add-rule-panel', label: 'Create Rule', hash: '#add-rule-panel' }
            ]
        }
    ];

    const extRoot = () =>
        (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
            ? chrome.runtime.getURL('/')
            : '/';

    const resolve = (relPath) => extRoot() + String(relPath || '').replace(/^\/+/, '');

    const currentFileName = () => location.pathname.split('/').pop() || '';

    const isSamePage = (href) => {
        if (!href) return false;
        try {
            return resolve(href).split('/').pop() === currentFileName();
        } catch {
            return false;
        }
    };

    const getCurrentPageConfig = () => NAV_TREE.find(item => isSamePage(item.href)) || null;

    const containsCurrentPage = (item) => {
        if (item.href && isSamePage(item.href)) return true;
        if (Array.isArray(item.sub)) return item.sub.some(containsCurrentPage);
        return false;
    };

    const isSmallScreen = () => window.innerWidth <= BREAKPOINT_SMALL;

    const readExpanded = () => {
        try {
            return new Set(JSON.parse(localStorage.getItem(EXPANDED_STATE_KEY) || '[]'));
        } catch {
            return new Set();
        }
    };

    const writeExpanded = (set) => {
        try { localStorage.setItem(EXPANDED_STATE_KEY, JSON.stringify([...set])); } catch {}
    };

    let expandedGroups = readExpanded();

    const toggleGroup = (id) => {
        if (expandedGroups.has(id)) expandedGroups.delete(id);
        else expandedGroups.add(id);
        writeExpanded(expandedGroups);
        renderNav();
    };

    const el = (tag, className) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        return node;
    };

    const buildIcon = (iconClass) => {
        const span = el('span', `icon icon-20 ${iconClass}`);
        span.setAttribute('aria-hidden', 'true');
        return span;
    };

    const buildChevron = (expanded) => {
        const span = el('span', 'icon icon-16 icon-arrow-right mc-chevron');
        span.setAttribute('aria-hidden', 'true');
        if (expanded) span.classList.add('is-expanded');
        return span;
    };

    const firstHashOf = (item) =>
        (item.sub && item.sub[0] && item.sub[0].hash) ? item.sub[0].hash : '';

    const goToPage = (item) => {
        if (isSamePage(item.href)) {
            const hash = firstHashOf(item);
            if (hash && location.hash !== hash) location.hash = hash;
            return;
        }
        location.href = resolve(item.href) + firstHashOf(item);
    };

    const goToHash = (item) => {
        if (location.hash === item.hash) {
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        } else {
            location.hash = item.hash;
        }
    };

    const buildPopover = (item) => {
        const popover = el('div', 'mc-popover');
        popover.setAttribute('role', 'menu');
        
        const popHeader = el('div', 'mc-popover-header');
        popHeader.textContent = item.label;
        popover.appendChild(popHeader);

        const list = el('ul', 'mc-popover-list');
        item.sub.forEach(subItem => {
            const isActive = isSamePage(item.href) && location.hash === subItem.hash;
            const li = el('li', 'mc-popover-item');
            const a = el('a', 'mc-popover-link' + (isActive ? ' is-active' : ''));
            a.href = subItem.hash;
            a.textContent = subItem.label;
            a.setAttribute('role', 'menuitem');
            a.addEventListener('click', (e) => {
                e.preventDefault();
                goToHash(subItem);
            });
            li.appendChild(a);
            list.appendChild(li);
        });
        popover.appendChild(list);
        return popover;
    };

    const buildNavItem = (item, depth) => {
        const li = el('li', 'mc-nav-item');
        const hasSub = Array.isArray(item.sub) && item.sub.length > 0;
        const isCurrentMainPage = item.href ? isSamePage(item.href) : false;
        
        // Active state evaluation
        const isHashActive = (!item.href && item.hash) ? location.hash === item.hash : false;
        const active = isCurrentMainPage || isHashActive;
        const expanded = hasSub && (containsCurrentPage(item) || expandedGroups.has(item.id));
        const small = isSmallScreen();

        const row = el('div', `mc-row mc-row-depth-${depth}`);
        const isNavigable = !!(item.href || item.hash);
        
        const control = el(isNavigable ? 'a' : 'button', 'mc-link' + (active ? ' is-active' : ''));
        if (isNavigable) {
            control.href = item.href ? resolve(item.href) + firstHashOf(item) : item.hash;
            control.setAttribute('aria-current', active ? 'page' : 'false');
        } else {
            control.type = 'button';
            control.setAttribute('aria-expanded', String(expanded));
        }

        if (depth === 0 && item.icon) control.appendChild(buildIcon(item.icon));

        const label = el('span', 'mc-link-label');
        label.textContent = item.label;
        control.appendChild(label);

        control.addEventListener('click', (event) => {
            event.preventDefault();
            if (item.href) {
                goToPage(item);
            } else if (item.hash) {
                goToHash(item);
            } else if (hasSub) {
                toggleGroup(item.id);
            }
        });

        row.appendChild(control);

        if (hasSub && depth === 0) {
            const popover = buildPopover(item);
            li.appendChild(popover);

            const handleMouseEnter = () => {
                if (small || !expanded) {
                    clearTimeout(activePopoverTimeout);
                    
                    // Enforce single popover visible at a time
                    document.querySelectorAll('.mc-popover.is-visible').forEach(p => {
                        if (p !== popover) p.classList.remove('is-visible');
                    });
                    
                    const rect = control.getBoundingClientRect();
                    popover.style.top = `${rect.top}px`;
                    popover.classList.add('is-visible');
                }
            };

            const handleMouseLeave = () => {
                // Add a small delay so the user can traverse the gap to the popover
                activePopoverTimeout = setTimeout(() => {
                    popover.classList.remove('is-visible');
                }, 200);
            };

            // Bind triggers to the outer li item
            li.addEventListener('mouseenter', handleMouseEnter);
            li.addEventListener('mouseleave', handleMouseLeave);
            
            // Allow hover on the popover itself to clear the removal timeout
            popover.addEventListener('mouseenter', () => clearTimeout(activePopoverTimeout));
            popover.addEventListener('mouseleave', handleMouseLeave);
        }

        if (hasSub && !small) {
            const toggle = el('button', 'mc-chevron-btn');
            toggle.type = 'button';
            toggle.setAttribute('aria-label', `Toggle ${item.label} section`);
            toggle.setAttribute('aria-expanded', String(expanded));
            toggle.appendChild(buildChevron(expanded));
            toggle.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleGroup(item.id);
            });
            row.appendChild(toggle);
        }

        li.appendChild(row);

        if (hasSub && isCurrentMainPage && !small) {
            const subList = buildNavList(item.sub, depth + 1);
            subList.classList.add('mc-sub-list');
            subList.classList.toggle('is-collapsed', !expanded);
            li.appendChild(subList);
        }

        return li;
    };

    const buildNavList = (items, depth) => {
        const ul = el('ul', `mc-nav-list mc-depth-${depth}`);
        items.forEach((item) => ul.appendChild(buildNavItem(item, depth)));
        return ul;
    };

    const buildFooterLink = () => {
        const currentConfig = getCurrentPageConfig();
        const helpUrl = (currentConfig && currentConfig.helpUrl) ? currentConfig.helpUrl : DEFAULT_HELP_LINK;

        const a = el('a', 'mc-link mc-footer-link');
        a.href = helpUrl;
        a.target = '_blank';
        a.rel = 'noopener';

        a.appendChild(buildIcon('icon-help'));
        const label = el('span', 'mc-link-label');
        label.textContent = 'Help';
        a.appendChild(label);
        return a;
    };

    let navContainer = null;
    let footerContainer = null;

    const renderNav = () => {
        if (!navContainer) return;
        while (navContainer.firstChild) navContainer.removeChild(navContainer.firstChild);
        navContainer.appendChild(buildNavList(NAV_TREE, 0));
    };

    const renderFooter = () => {
        if (!footerContainer) return;
        while (footerContainer.firstChild) footerContainer.removeChild(footerContainer.firstChild);
        footerContainer.appendChild(buildFooterLink());
        const copyright = el('p', 'mc-copyright');
        copyright.textContent = `© ${new Date().getFullYear()} modcore`;
        footerContainer.appendChild(copyright);
    };

    const buildSidebar = () => {
        const aside = el('aside', 'mc-sidebar');
        aside.setAttribute('aria-label', 'Primary navigation');

        const header = el('div', 'mc-sidebar-header');
        const logo = document.createElement('img');
        logo.className = 'mc-logo';
        logo.alt = 'modcore logo';
        logo.src = resolve('public/icons/png/modcore-em.png');
        const title = el('span', 'mc-sidebar-title');
        title.textContent = 'modcore EM';
        header.appendChild(logo);
        header.appendChild(title);

        const nav = el('nav', 'mc-nav');
        nav.setAttribute('aria-label', 'Main navigation');
        navContainer = nav;

        footerContainer = el('div', 'mc-sidebar-footer');

        aside.appendChild(header);
        aside.appendChild(nav);
        aside.appendChild(footerContainer);

        renderNav();
        renderFooter();
        return aside;
    };

    const SIDEBAR_CSS = `
    .mc-shell-body { margin: 0; min-height: 100vh; }
    .mc-shell { display: flex; align-items: flex-start; width: 100%; min-height: 100vh; background-color: var(--color-bg); }
    .mc-content-host { flex: 1 1 auto; min-width: 0; min-height: 100vh; }
    .mc-sidebar { width: var(--sidebar-width); flex-shrink: 0; display: flex; flex-direction: column; gap: var(--space-4); background-color: var(--color-surface); border-right: var(--border-width) solid var(--color-border); padding: var(--space-5) var(--space-4); position: sticky; top: 0; align-self: flex-start; height: 100vh; overflow-y: auto; box-shadow: none; z-index: 100; }
    .mc-sidebar-header { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2); }
    .mc-logo { width: 32px; height: 32px; border-radius: var(--radius-md); flex-shrink: 0; }
    .mc-sidebar-title { font-size: var(--text-headline-sm); font-weight: var(--weight-semibold); color: var(--color-text-primary); }
    .mc-nav { flex: 1 1 auto; }
    .mc-nav-list { list-style: none; display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding: 0; }
    .mc-nav-list.mc-depth-0 { gap: var(--space-2); }
    .mc-nav-list.mc-sub-list { margin: var(--space-1) 0 var(--space-2) var(--space-5); padding-left: var(--space-3); border-left: var(--border-width) solid var(--color-border); }
    .mc-nav-list.mc-sub-list.is-collapsed { display: none; }
    .mc-nav-item { display: flex; flex-direction: column; position: relative; }
    .mc-row { display: flex; align-items: center; gap: var(--space-1); }
    .mc-link { flex: 1 1 auto; display: flex; align-items: center; gap: var(--space-3); min-height: 40px; padding: var(--space-2) var(--space-3); border-radius: var(--radius-lg); font-family: inherit; font-size: var(--text-body-lg); font-weight: var(--weight-medium); color: var(--color-text-secondary); background-color: transparent; border: none; text-decoration: none; cursor: pointer; text-align: left; transition: var(--transition-fast); box-shadow: none; }
    .mc-row-depth-0 > .mc-link { color: var(--color-text-primary); }
    .mc-row-depth-1 > .mc-link, .mc-row-depth-2 > .mc-link { font-size: var(--text-body-md); min-height: 34px; }
    .mc-link:hover, .mc-link:focus-visible { background-color: var(--color-surface-hover); color: var(--color-text-primary); outline: none; }
    .mc-link.is-active { background-color: var(--color-surface-selected); color: var(--color-primary); font-weight: var(--weight-semibold); }
    .mc-link .icon { background-color: currentColor; }
    .mc-link-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mc-chevron-btn { flex-shrink: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background-color: transparent; border: none; border-radius: var(--radius-full); color: var(--color-text-muted); cursor: pointer; box-shadow: none; }
    .mc-chevron-btn:hover, .mc-chevron-btn:focus-visible { background-color: var(--color-surface-high); color: var(--color-text-primary); outline: none; }
    .mc-chevron { background-color: currentColor; transition: transform var(--duration-fast) var(--ease-standard); }
    .mc-chevron.is-expanded { transform: rotate(90deg); }
    .mc-sidebar-footer { margin-top: auto; padding-top: var(--space-4); border-top: var(--border-width) solid var(--color-border); display: flex; flex-direction: column; gap: var(--space-1); }
    .mc-footer-link { color: var(--color-text-secondary); }
    .mc-copyright { padding: var(--space-2) var(--space-3); font-size: var(--text-body-sm); color: var(--color-text-muted); margin: 0; }
    .mc-popover { position: fixed; left: calc(var(--sidebar-width) + var(--space-2)); background-color: var(--color-surface); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-lg); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); padding: var(--space-2); min-width: 160px; z-index: 9999; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity var(--duration-fast), visibility var(--duration-fast); }
    .mc-popover.is-visible { opacity: 1; visibility: visible; pointer-events: auto; }
    .mc-popover-header { font-size: var(--text-body-sm); font-weight: var(--weight-semibold); color: var(--color-text-muted); padding: var(--space-1) var(--space-3); border-bottom: var(--border-width) solid var(--color-border); margin-bottom: var(--space-1); }
    .mc-popover-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .mc-popover-item { display: flex; }
    .mc-popover-link { flex: 1; padding: var(--space-2) var(--space-3); font-size: var(--text-body-md); color: var(--color-text-secondary); text-decoration: none; border-radius: var(--radius-md); transition: var(--transition-fast); }
    .mc-popover-link:hover, .mc-popover-link:focus-visible { background-color: var(--color-surface-hover); color: var(--color-text-primary); outline: none; }
    .mc-popover-link.is-active { background-color: var(--color-surface-selected); color: var(--color-primary); font-weight: var(--weight-semibold); }
    @media (max-width: 900px) {
        .mc-sidebar { width: 72px; padding: var(--space-4) var(--space-2); }
        .mc-sidebar-title, .mc-link-label, .mc-copyright { display: none; }
        .mc-nav-list.mc-sub-list { display: none; }
        .mc-chevron-btn { display: none; }
        .mc-sidebar-header { justify-content: center; }
        .mc-popover { left: calc(72px + var(--space-2)); }
    }`;

    const injectStyles = () => {
        if (document.getElementById('mc-sidebar-styles')) return;
        const style = document.createElement('style');
        style.id = 'mc-sidebar-styles';
        style.textContent = SIDEBAR_CSS;
        document.head.appendChild(style);
    };

    const mount = () => {
        injectStyles();

        const existingChildren = Array.from(document.body.childNodes);
        const shell = el('div', 'mc-shell');
        const contentHost = el('div', 'mc-content-host');
        existingChildren.forEach((node) => contentHost.appendChild(node));

        shell.appendChild(buildSidebar());
        shell.appendChild(contentHost);

        document.body.appendChild(shell);
        document.body.classList.add('mc-shell-body');
    };

    window.addEventListener('hashchange', () => {
        renderNav();
        renderFooter();
    });

    window.addEventListener('resize', renderNav);

    mount();
})();