// discovery.js
// Command Center (v3) for modcore Extension Manager

(function (global) {
    'use strict';

    // --- Commands Registry ---
    const COMMANDS = [
        { id: 'conflicts',   name: 'Conflicts',   desc: 'Detect and resolve extension conflicts',      url: 'src/views/inspect/inspect.html',           icon: 'icon-search', category: 'Analysis' },
        { id: 'safety',      name: 'Safety',      desc: 'Security overview and risk assessment',       url: 'src/views/safety-center/safety-center.html', icon: 'icon-shield', category: 'Analysis' },
        { id: 'snapshot',    name: 'Snapshot',    desc: 'Manage environment snapshots',                url: 'src/views/snapshot/snapshot.html',           icon: 'icon-host',   category: 'Management' },
        { id: 'timeline',    name: 'Timeline',    desc: 'View activity and history',                   url: 'src/views/timeline/timeline.html',           icon: 'icon-clock',  category: 'History' },
        { id: 'automations', name: 'Automations', desc: 'Automated extension management rules',        url: 'src/views/automations/automations.html',   icon: 'icon-rules',  category: 'Management' }
    ];

    const FUSE_SCRIPT_SRC = '../../../src/js/vendor/fuze.js';

    function loadFuseScript() {
        return new Promise((resolve) => {
            if (typeof global.Fuse !== 'undefined') return resolve();

            const script = document.createElement('script');
            script.src = FUSE_SCRIPT_SRC;
            script.addEventListener('load', () => resolve());
            script.addEventListener('error', () => {
                console.warn(`Failed to load Fuse.js from ${FUSE_SCRIPT_SRC}`);
                resolve();
            });
            document.head.appendChild(script);
        });
    }

    // --- Component CSS ---
    const COMMAND_CENTER_CSS = `
        /* ── Trigger Button ── */
        .mc-cc-trigger {
            position: fixed;
            top: var(--space-4, 16px);
            right: var(--space-4, 16px);
            z-index: 9000;
            width: 36px;
            height: 36px;
            border-radius: var(--radius-md);
            background: var(--color-surface);
            border: var(--border-width) solid var(--color-border);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: var(--shadow-sm);
            transition: background var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
            color: var(--color-icon);
            outline: none;
        }
        .mc-cc-trigger:hover {
            background: var(--color-surface-hover);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }
        .mc-cc-trigger:focus-visible {
            box-shadow: 0 0 0 2px var(--color-focus-ring);
        }

        /* ── Overlay ── */
        .mc-cc-overlay {
            position: fixed;
            inset: 0;
            background: var(--color-backdrop);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            z-index: 10000;
            display: flex;
            align-items: flex-start;
            justify-content: center;
            padding-top: 12vh;
            opacity: 0;
            pointer-events: none;
            transition: opacity var(--transition-normal);
        }
        .mc-cc-overlay.mc-cc-open {
            opacity: 1;
            pointer-events: auto;
        }

        /* ── Palette Container ── */
        .mc-cc-palette {
            width: 100%;
            max-width: 580px;
            background: var(--color-surface);
            border-radius: var(--radius-xl);
            border: var(--border-width) solid var(--color-border-strong);
            box-shadow: 0 16px 48px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.08);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transform: scale(0.97) translateY(-10px);
            transition: transform var(--transition-normal);
            font-family: var(--font-sans);
        }
        .mc-cc-overlay.mc-cc-open .mc-cc-palette {
            transform: scale(1) translateY(0);
        }

        /* ── Search Header ── */
        .mc-cc-header {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            padding: var(--space-4) var(--space-5);
            border-bottom: var(--border-width) solid var(--color-border);
            background: var(--color-surface);
        }
        .mc-cc-header .icon {
            opacity: 0.6;
        }
        .mc-cc-input {
            flex: 1;
            border: none;
            background: transparent;
            font-size: var(--text-headline-sm);
            font-family: inherit;
            color: var(--color-text-primary);
            outline: none;
            min-width: 0;
        }
        .mc-cc-input::placeholder {
            color: var(--color-text-placeholder);
        }

        /* ── Clear Button ── */
        .mc-cc-clear {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border-radius: var(--radius-sm);
            background: transparent;
            border: none;
            cursor: pointer;
            color: var(--color-text-muted);
            opacity: 0;
            pointer-events: none;
            transition: opacity var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
        }
        .mc-cc-clear:hover, .mc-cc-clear:focus-visible {
            background: var(--color-surface-hover);
            color: var(--color-text-secondary);
        }
        .mc-cc-clear:focus-visible {
            box-shadow: 0 0 0 2px var(--color-focus-ring);
            outline: none;
        }
        .mc-cc-header.has-value .mc-cc-clear {
            opacity: 1;
            pointer-events: auto;
        }

        /* ── Command List ── */
        .mc-cc-list {
            list-style: none;
            margin: 0;
            padding: var(--space-2);
            max-height: 340px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .mc-cc-list::-webkit-scrollbar {
            width: 8px;
        }
        .mc-cc-list::-webkit-scrollbar-thumb {
            background: var(--color-scrollbar-thumb);
            border-radius: var(--radius-full);
            border: 2px solid var(--color-surface);
        }

        /* ── Command Item ── */
        .mc-cc-item {
            display: flex;
            align-items: center;
            gap: var(--space-4);
            padding: var(--space-3) var(--space-4);
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: background var(--transition-fast);
            color: var(--color-text-primary);
            text-decoration: none;
            position: relative;
            outline: none;
        }
        .mc-cc-item:focus-visible {
            box-shadow: 0 0 0 2px var(--color-focus-ring) inset;
        }
        .mc-cc-item[aria-selected="true"] {
            background: var(--color-surface-hover);
        }
        .mc-cc-item[aria-selected="true"]::before {
            content: '';
            position: absolute;
            left: 0;
            top: 10px;
            bottom: 10px;
            width: 3px;
            border-radius: 0 var(--radius-full) var(--radius-full) 0;
            background: var(--color-primary);
        }
        .mc-cc-item-icon-wrap {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: var(--radius-sm);
            background: var(--color-surface-high);
            color: var(--color-text-secondary);
            transition: background var(--transition-fast), color var(--transition-fast);
        }
        .mc-cc-item[aria-selected="true"] .mc-cc-item-icon-wrap {
            background: var(--color-primary-container);
            color: var(--color-primary);
        }
        .mc-cc-item-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }
        .mc-cc-item-title {
            font-size: var(--text-body-lg);
            font-weight: var(--weight-medium);
            line-height: var(--leading-dense);
        }
        .mc-cc-item-desc {
            font-size: var(--text-body-sm);
            color: var(--color-text-secondary);
            line-height: var(--leading-dense);
        }

        /* ── Number Index ── */
        .mc-cc-index {
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 20px;
            height: 20px;
            padding: 0 5px;
            border-radius: var(--radius-sm);
            background: var(--color-surface-high);
            color: var(--color-text-muted);
            font-family: var(--font-mono);
            font-size: var(--text-label-sm);
            font-weight: var(--weight-medium);
            transition: background var(--transition-fast), color var(--transition-fast);
        }
        .mc-cc-item[aria-selected="true"] .mc-cc-index {
            background: var(--color-primary-container);
            color: var(--color-primary);
        }

        /* ── Match Highlighting ── */
        .mc-cc-match {
            color: var(--color-primary);
            background: var(--color-highlight-bg);
            border-radius: 2px;
            font-weight: inherit;
        }

        /* ── Empty State ── */
        .mc-cc-empty {
            padding: var(--space-10) var(--space-5);
            text-align: center;
            color: var(--color-text-muted);
            font-size: var(--text-body-md);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: var(--space-2);
        }
        .mc-cc-empty-query {
            font-family: var(--font-mono);
            color: var(--color-text-primary);
            background: var(--color-surface-high);
            padding: 2px 6px;
            border-radius: var(--radius-sm);
            margin-top: var(--space-2);
            display: inline-block;
        }

        /* ── Footer ── */
        .mc-cc-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--space-3) var(--space-5);
            border-top: var(--border-width) solid var(--color-border);
            background: var(--color-surface-mid);
            font-size: var(--text-label-md);
            color: var(--color-text-muted);
            gap: var(--space-3);
            flex-wrap: wrap;
        }
        .mc-cc-footer-left {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            flex-wrap: wrap;
        }
        .mc-cc-footer-group {
            display: flex;
            align-items: center;
            gap: var(--space-1);
        }
        .mc-cc-footer kbd {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 20px;
            height: 20px;
            padding: 0 4px;
            background: var(--color-surface-high);
            border: var(--border-width) solid var(--color-border-strong);
            border-radius: var(--radius-sm);
            font-family: var(--font-mono);
            font-size: var(--text-label-sm);
            color: var(--color-text-secondary);
            box-shadow: 0 1px 0 var(--color-border-strong);
        }
        .mc-cc-count {
            font-variant-numeric: tabular-nums;
        }

        /* ── Screen Reader Only ── */
        .mc-sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border-width: 0;
        }

        /* ── Reduced Motion ── */
        @media (prefers-reduced-motion: reduce) {
            .mc-cc-overlay,
            .mc-cc-palette,
            .mc-cc-item,
            .mc-cc-trigger {
                transition: none !important;
                animation: none !important;
            }
        }
    `;

    // --- Safe DOM Helpers ---
    function el(tag, opts = {}) {
        const node = document.createElement(tag);
        if (opts.className) node.className = opts.className;
        if (opts.text != null) node.textContent = opts.text;
        if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
        if (opts.children) opts.children.forEach(c => c && node.appendChild(c));
        return node;
    }

    /**
     * Safely constructs a DocumentFragment with highlighted text based on Fuse.js indices.
     */
    function highlightText(text, indices) {
        const frag = document.createDocumentFragment();
        if (!indices || indices.length === 0) {
            frag.appendChild(document.createTextNode(text));
            return frag;
        }

        let currentIndex = 0;
        indices.forEach(([start, end]) => {
            if (start > currentIndex) {
                frag.appendChild(document.createTextNode(text.substring(currentIndex, start)));
            }
            const matchEl = document.createElement('strong');
            matchEl.className = 'mc-cc-match';
            matchEl.textContent = text.substring(start, end + 1);
            frag.appendChild(matchEl);
            currentIndex = end + 1;
        });

        if (currentIndex < text.length) {
            frag.appendChild(document.createTextNode(text.substring(currentIndex)));
        }
        return frag;
    }

    function injectStyles() {
        if (document.getElementById('mc-cc-styles')) return;
        document.head.appendChild(el('style', { id: 'mc-cc-styles', text: COMMAND_CENTER_CSS }));
    }

    // --- State & Dependencies ---
    let overlayNode = null;
    let inputNode = null;
    let listNode = null;
    let announcerNode = null;
    let headerNode = null;
    let clearBtnNode = null;
    let countNode = null;
    
    let isOpen = false;
    let currentResults = [];
    let activeIndex = 0;
    
    let recentCommands = []; // Session-only; no storage persistence
    let lastFocusedElement = null;
    let fuse = null;

    // --- Data Management ---
    function bumpRecent(commandId) {
        recentCommands = recentCommands.filter(id => id !== commandId);
        recentCommands.unshift(commandId);
        if (recentCommands.length > 5) recentCommands.pop();
    }

    function initFuse() {
        if (typeof global.Fuse !== 'undefined') {
            fuse = new global.Fuse(COMMANDS, {
                keys: [
                    { name: 'name', weight: 0.7 },
                    { name: 'desc', weight: 0.3 },
                    { name: 'category', weight: 0.1 }
                ],
                threshold: 0.4,
                includeMatches: true,
                shouldSort: true
            });
        } else {
            console.warn('Fuse.js not found globally. Falling back to basic search.');
        }
    }

    function getSortedCommands(query) {
        const trimmed = query.trim();
        if (!trimmed) {
            const seen = new Set(recentCommands);
            const recent = recentCommands
                .map(id => COMMANDS.find(c => c.id === id))
                .filter(Boolean);
            const rest = COMMANDS
                .filter(c => !seen.has(c.id))
                .sort((a, b) => a.name.localeCompare(b.name));
            return [...recent, ...rest].map(cmd => ({ item: cmd, matches: [] }));
        }

        if (fuse) {
            return fuse.search(trimmed);
        }

        const lowerQuery = trimmed.toLowerCase();
        return COMMANDS
            .filter(cmd => 
                cmd.name.toLowerCase().includes(lowerQuery) || 
                cmd.desc.toLowerCase().includes(lowerQuery) ||
                (cmd.category && cmd.category.toLowerCase().includes(lowerQuery))
            )
            .map(cmd => ({ item: cmd, matches: [] })); 
    }

    // --- UI Logic ---
    function updateHeaderState() {
        if (!headerNode || !inputNode) return;
        if (inputNode.value.trim()) {
            headerNode.classList.add('has-value');
        } else {
            headerNode.classList.remove('has-value');
        }
    }

    function announce(message) {
        if (!announcerNode) return;
        announcerNode.textContent = '';
        requestAnimationFrame(() => {
            announcerNode.textContent = message;
        });
    }

    function renderList(query = '') {
        currentResults = getSortedCommands(query);
        updateHeaderState();

        listNode.replaceChildren();
        activeIndex = currentResults.length > 0 ? 0 : -1;

        if (currentResults.length === 0) {
            const emptyChildren = [
                el('div', { className: 'icon icon-search-off icon-32' }),
                el('span', { text: 'No matching commands found.' })
            ];
            if (query.trim()) {
                emptyChildren.push(
                    el('span', { className: 'mc-cc-empty-query', text: query.trim() })
                );
            }
            listNode.appendChild(el('div', {
                className: 'mc-cc-empty',
                children: emptyChildren
            }));
            inputNode.removeAttribute('aria-activedescendant');
            announce('No results found.');
            if (countNode) countNode.textContent = '0 commands';
            return;
        }

        currentResults.forEach((result, idx) => {
            const cmd = result.item;
            const isSelected = idx === activeIndex;
            const itemId = `mc-cc-cmd-${idx}`;

            let titleIndices = [];
            let descIndices = [];
            if (result.matches) {
                result.matches.forEach(match => {
                    if (match.key === 'name') titleIndices = match.indices;
                    if (match.key === 'desc') descIndices = match.indices;
                });
            }

            const item = el('li', {
                className: 'mc-cc-item',
                attrs: { 
                    id: itemId, 
                    role: 'option', 
                    'aria-selected': String(isSelected),
                    'data-url': cmd.url,
                    'data-command-id': cmd.id,
                    'aria-label': `${cmd.name}: ${cmd.desc}`,
                    'aria-posinset': String(idx + 1),
                    'aria-setsize': String(currentResults.length)
                },
                children: [
                    el('div', {
                        className: 'mc-cc-item-icon-wrap',
                        children: [ el('span', { className: `icon ${cmd.icon} icon-20` }) ]
                    }),
                    el('div', {
                        className: 'mc-cc-item-content',
                        children: [
                            el('span', { 
                                className: 'mc-cc-item-title', 
                                children: [highlightText(cmd.name, titleIndices)] 
                            }),
                            el('span', { 
                                className: 'mc-cc-item-desc', 
                                children: [highlightText(cmd.desc, descIndices)] 
                            })
                        ]
                    }),
                    el('span', { className: 'mc-cc-index', text: String(idx + 1) })
                ]
            });

            item.addEventListener('mouseenter', () => updateSelection(idx));
            item.addEventListener('click', () => executeCommand(cmd));

            listNode.appendChild(item);
        });

        if (activeIndex >= 0) {
            inputNode.setAttribute('aria-activedescendant', `mc-cc-cmd-${activeIndex}`);
        }

        const countText = `${currentResults.length} command${currentResults.length === 1 ? '' : 's'}`;
        if (countNode) countNode.textContent = countText;
        announce(`${countText} available.`);
    }

    function updateSelection(newIndex) {
        if (newIndex < 0 || newIndex >= currentResults.length) return;
        
        const items = listNode.querySelectorAll('.mc-cc-item');
        if (activeIndex >= 0 && items[activeIndex]) {
            items[activeIndex].setAttribute('aria-selected', 'false');
        }
        
        activeIndex = newIndex;
        
        if (items[activeIndex]) {
            const activeItem = items[activeIndex];
            activeItem.setAttribute('aria-selected', 'true');
            inputNode.setAttribute('aria-activedescendant', activeItem.id);
            activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function executeCommand(cmd) {
        if (!cmd || !cmd.url) return;
        bumpRecent(cmd.id);
        
        try {
            chrome.tabs.create({ url: cmd.url });
        } catch {
            window.open(cmd.url, '_blank');
        }
        closeCommandCenter();
    }

    function buildCommandCenter() {
        injectStyles();

        overlayNode = el('div', {
            className: 'mc-cc-overlay',
            attrs: { 
                role: 'dialog', 
                'aria-modal': 'true', 
                'aria-label': 'Command Center',
                'aria-describedby': 'mc-cc-input-desc'
            }
        });

        const palette = el('div', { className: 'mc-cc-palette' });

        announcerNode = el('div', {
            className: 'mc-sr-only',
            attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' }
        });

        const inputDesc = el('div', {
            className: 'mc-sr-only',
            attrs: { id: 'mc-cc-input-desc' },
            text: 'Use arrow keys to navigate, Enter to select, Escape to close, Alt plus a number to jump to a command.'
        });

        inputNode = el('input', {
            className: 'mc-cc-input',
            attrs: {
                type: 'text',
                placeholder: 'Search commands or actions…',
                role: 'combobox',
                'aria-autocomplete': 'list',
                'aria-expanded': 'false',
                'aria-controls': 'mc-cc-listbox',
                'aria-describedby': 'mc-cc-input-desc',
                autocomplete: 'off',
                autocorrect: 'off',
                autocapitalize: 'off',
                spellcheck: 'false'
            }
        });

        clearBtnNode = el('button', {
            className: 'mc-cc-clear',
            attrs: { type: 'button', 'aria-label': 'Clear search', tabindex: '-1' },
            children: [ el('span', { className: 'icon icon-close icon-16' }) ]
        });
        clearBtnNode.addEventListener('click', () => {
            inputNode.value = '';
            inputNode.focus();
            renderList('');
        });

        headerNode = el('div', {
            className: 'mc-cc-header',
            children: [
                el('span', { className: 'icon icon-search icon-24' }),
                inputNode,
                clearBtnNode
            ]
        });

        listNode = el('ul', {
            className: 'mc-cc-list',
            attrs: { 
                id: 'mc-cc-listbox', 
                role: 'listbox',
                'aria-label': 'Command list',
                'aria-multiselectable': 'false',
                'aria-orientation': 'vertical'
            }
        });

        countNode = el('span', { className: 'mc-cc-count', text: '0 commands' });
        const footerNode = el('div', {
            className: 'mc-cc-footer',
            children: [
                el('div', {
                    className: 'mc-cc-footer-left',
                    children: [
                        el('div', {
                            className: 'mc-cc-footer-group',
                            children: [
                                el('kbd', { text: '↑' }),
                                el('kbd', { text: '↓' }),
                                el('span', { text: 'to navigate' })
                            ]
                        }),
                        el('div', {
                            className: 'mc-cc-footer-group',
                            children: [
                                el('kbd', { text: 'Enter' }),
                                el('span', { text: 'to open' })
                            ]
                        }),
                        el('div', {
                            className: 'mc-cc-footer-group',
                            children: [
                                el('kbd', { text: 'Esc' }),
                                el('span', { text: 'to close' })
                            ]
                        }),
                        el('div', {
                            className: 'mc-cc-footer-group',
                            children: [
                                el('kbd', { text: 'Alt' }),
                                el('kbd', { text: '1…9' }),
                                el('span', { text: 'to jump' })
                            ]
                        })
                    ]
                }),
                countNode
            ]
        });

        palette.appendChild(announcerNode);
        palette.appendChild(inputDesc);
        palette.appendChild(headerNode);
        palette.appendChild(listNode);
        palette.appendChild(footerNode);
        overlayNode.appendChild(palette);
        document.body.appendChild(overlayNode);

        overlayNode.addEventListener('click', (e) => {
            if (e.target === overlayNode) closeCommandCenter();
        });

        inputNode.addEventListener('input', (e) => renderList(e.target.value));

        inputNode.addEventListener('keydown', (e) => {
            if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
                e.preventDefault();
                const idx = parseInt(e.key, 10) - 1;
                if (idx >= 0 && idx < currentResults.length) {
                    executeCommand(currentResults[idx].item);
                }
                return;
            }

            if (currentResults.length === 0 && e.key !== 'Escape') {
                if (['ArrowDown', 'ArrowUp', 'Enter', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
                    e.preventDefault();
                }
                return;
            }

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    updateSelection(Math.min(activeIndex + 1, currentResults.length - 1));
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    updateSelection(Math.max(activeIndex - 1, 0));
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (activeIndex >= 0) executeCommand(currentResults[activeIndex].item);
                    break;
                case 'Escape':
                    e.preventDefault();
                    closeCommandCenter();
                    break;
                case 'Home':
                    e.preventDefault();
                    updateSelection(0);
                    break;
                case 'End':
                    e.preventDefault();
                    updateSelection(currentResults.length - 1);
                    break;
                case 'PageUp':
                    e.preventDefault();
                    updateSelection(Math.max(activeIndex - 5, 0));
                    break;
                case 'PageDown':
                    e.preventDefault();
                    updateSelection(Math.min(activeIndex + 5, currentResults.length - 1));
                    break;
                case 'Tab':
                    e.preventDefault();
                    break;
            }
        });
    }

    function openCommandCenter() {
        if (isOpen) return;
        if (!overlayNode) buildCommandCenter();

        lastFocusedElement = document.activeElement;
        isOpen = true;
        inputNode.value = '';
        renderList('');

        document.body.style.overflow = 'hidden';
        
        requestAnimationFrame(() => {
            overlayNode.classList.add('mc-cc-open');
            inputNode.setAttribute('aria-expanded', 'true');
            inputNode.focus();
            announce('Command Center opened.');
        });
    }

    function closeCommandCenter() {
        if (!isOpen || !overlayNode) return;
        isOpen = false;
        overlayNode.classList.remove('mc-cc-open');
        inputNode.setAttribute('aria-expanded', 'false');
        inputNode.blur();

        document.body.style.overflow = '';
        
        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
        }
    }

    // --- Initialization ---
    function init() {
        if (document.getElementById('mc-discovery-trigger')) return;
        
        loadFuseScript().then(initFuse);
        injectStyles();

        const trigger = el('button', {
            className: 'mc-cc-trigger',
            attrs: {
                id: 'mc-discovery-trigger',
                'aria-label': 'Open Command Center. Shortcuts: Alt+D, Ctrl+K, or Ctrl+Shift+P.',
                title: 'Command Center (Alt+D, Ctrl+K, Ctrl+Shift+P)'
            },
            children: [ el('span', { className: 'icon icon-grid icon-20' }) ]
        });

        trigger.addEventListener('click', openCommandCenter);
        document.body.appendChild(trigger);

        document.addEventListener('keydown', (e) => {
            const isAltD = e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'd' || e.key === 'D');
            const isCtrlK = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'k' || e.key === 'K');
            const isCtrlShiftP = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'p' || e.key === 'P');
            
            if (isAltD || isCtrlK || isCtrlShiftP) {
                e.preventDefault();
                isOpen ? closeCommandCenter() : openCommandCenter();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

})(typeof window !== 'undefined' ? window : this);