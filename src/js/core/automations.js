document.addEventListener('DOMContentLoaded', async () => {
    const PROFILES_STORAGE_KEY = 'em_profiles';
    const DEFAULT_ICON_PLACEHOLDER = '../../public/icons/svg/updatelogo.svg';
    const RULES_STORAGE_KEY = 'rules';

    // --- State ---
    const state = {
        allRules: [],
        allExtensions: [],
        allProfiles: [],
        allTags: new Set(),
        selectedRuleIds: new Set(),
        currentFilters: { query: '', status: 'all', trigger: 'all', targetType: 'all', tag: 'all' },
        isRefreshing: false,
        ruleElementsCache: new Map(),
        searchDebounceTimer: null,
        currentStep: 1,
        activePanelId: null,
    };

    // --- DOM Cache ---
    const DOM = {};
    function cacheDOM() {
        const ids = [
            'rules-list-container', 'empty-state', 'no-results-placeholder', 'table-wrapper',
            'rule-search-input', 'select-all-rules', 'filter-btn',
            'filter-side-sheet', 'filter-sheet-overlay', 'close-filter-sheet',
            'apply-filters-btn', 'reset-filters-btn', 'filter-status-select',
            'filter-trigger-select', 'filter-target-type-select',
            'filter-tags-group', 'tag-chips-container',
            'bulk-actions-bar', 'selected-rules-count', 'bulk-enable-btn',
            'bulk-disable-btn', 'bulk-delete-btn',
            'add-rule-panel', 'rule-form', 'form-panel-title', 'rule-id-input',
            'rule-name-input', 'rule-tags-input',
            'trigger-conditions-container', 'add-trigger-condition-btn', 'trigger-error',
            'actions-container', 'add-action-btn', 'actions-error',
            'step-1-next', 'step-2-back', 'step-2-next', 'step-3-back',
            'rule-name-error', 'back-to-rules-list', 'cancel-rule-form',
            'confirm-dialog-overlay', 'confirm-dialog-message', 'confirm-ok-btn', 'confirm-cancel-btn',
            'empty-state-add-btn', 'reset-all-filters-btn', 'save-rule-btn',
        ];
        ids.forEach(id => { DOM[id] = document.getElementById(id); });
        DOM.panels = document.querySelectorAll('.content-panel');
        DOM.navButtons = document.querySelectorAll('.sidebar-button');
        DOM.stepTabs = document.querySelectorAll('.form-step');
        DOM.stepContents = document.querySelectorAll('.form-step-content');
    }

    // --- Utilities ---
    function sanitizeText(str) {
        if (str == null) return '';
        const temp = document.createElement('div');
        temp.textContent = String(str);
        return temp.textContent;
    }

    function createElement(tag, className, textContent) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (textContent != null) el.textContent = textContent;
        return el;
    }

    function createFragment() { return document.createDocumentFragment(); }

    // --- Data Loading ---
    async function loadProfiles() {
        try {
            const data = await chrome.storage.local.get(PROFILES_STORAGE_KEY);
            const raw = data?.[PROFILES_STORAGE_KEY];
            let profiles = [];
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                if (raw.profiles && typeof raw.profiles === 'object') profiles = Object.values(raw.profiles);
                else profiles = Object.values(raw).filter(v => v && typeof v === 'object' && v.id);
            }
            state.allProfiles = profiles.filter(p => p && typeof p === 'object').map(p => ({
                id: p.id || '',
                name: typeof p.name === 'string' ? p.name : 'Unnamed',
                extensionStates: p.extensionStates || {},
                shortcut: p.shortcut || null,
                icons: p.icons || null,
            })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        } catch (e) {
            console.error('Failed to load profiles:', e);
            state.allProfiles = [];
        }
    }

    async function refreshUI() {
        if (state.isRefreshing) return;
        state.isRefreshing = true;
        try {
            if (chrome.management?.getAll) {
                const self = await chrome.management.getSelf();
                const exts = await chrome.management.getAll();
                state.allExtensions = exts.filter(ext => ext && ext.type === 'extension' && ext.id !== self?.id);
            } else {
                state.allExtensions = [];
            }
            await loadProfiles();
            const data = await chrome.storage.local.get(RULES_STORAGE_KEY);
            state.allRules = Array.isArray(data?.[RULES_STORAGE_KEY]) ? data[RULES_STORAGE_KEY] : [];
            extractAllTags();
            applyFiltersAndRender();
            updateBulkActionBarVisibility();
            updateSelectAllCheckboxState();
        } catch (error) {
            console.error('Error refreshing UI:', error);
            Status.error('Error loading data. Please refresh.');
        } finally {
            state.isRefreshing = false;
        }
    }

    function extractAllTags() {
        state.allTags.clear();
        state.allRules.forEach(rule => {
            if (Array.isArray(rule.tags)) {
                rule.tags.forEach(t => { if (typeof t === 'string' && t.trim()) state.allTags.add(t.trim()); });
            }
        });
        renderTagFilterInSheet();
    }

    // --- Tag Filter UI (inside filter sheet) ---
    function renderTagFilterInSheet() {
        const container = DOM['tag-chips-container'];
        const group = DOM['filter-tags-group'];
        if (!container || !group) return;

        container.textContent = '';

        if (state.allTags.size === 0) {
            group.style.display = 'none';
            return;
        }

        group.style.display = '';
        const sorted = Array.from(state.allTags).sort((a, b) => a.localeCompare(b));
        sorted.forEach(tag => {
            const chip = createElement('button', 'tag-chip', sanitizeText(tag));
            chip.type = 'button';
            chip.setAttribute('aria-pressed', state.currentFilters.tag === tag ? 'true' : 'false');
            chip.dataset.tag = tag;
            if (state.currentFilters.tag === tag) chip.classList.add('active');
            chip.addEventListener('click', () => {
                state.currentFilters.tag = state.currentFilters.tag === tag ? 'all' : tag;
                renderTagFilterInSheet();
            });
            container.appendChild(chip);
        });
    }

    // --- Filtering & Rendering ---
    function applyFiltersAndRender() {
        const queryLower = (state.currentFilters.query || '').toLowerCase();
        const filtered = state.allRules.filter(rule => {
            if (!rule || typeof rule !== 'object') return false;
            const searchMatch = !queryLower ||
                (rule.name && rule.name.toLowerCase().includes(queryLower)) ||
                (Array.isArray(rule.tags) && rule.tags.some(t => typeof t === 'string' && t.toLowerCase().includes(queryLower)));
            const statusMatch = state.currentFilters.status === 'all' ||
                (state.currentFilters.status === 'enabled' && rule.enabled) ||
                (state.currentFilters.status === 'disabled' && !rule.enabled);
            const triggerMatch = state.currentFilters.trigger === 'all' ||
                (state.currentFilters.trigger === 'compound' && rule.trigger?.type === 'compound') ||
                (state.currentFilters.trigger === 'time' && (rule.trigger?.type === 'time' || rule.trigger?.conditions?.some(c => c.type === 'time'))) ||
                (state.currentFilters.trigger === 'url' && (rule.trigger?.type === 'url' || rule.trigger?.conditions?.some(c => c.type === 'url')));
            const targetTypeMatch = state.currentFilters.targetType === 'all' || getRuleTargetType(rule) === state.currentFilters.targetType;
            const tagMatch = state.currentFilters.tag === 'all' ||
                (Array.isArray(rule.tags) && rule.tags.some(t => t === state.currentFilters.tag));
            return searchMatch && statusMatch && triggerMatch && targetTypeMatch && tagMatch;
        });
        renderRules(filtered);
    }

    function getRuleTargetType(rule) {
        if (Array.isArray(rule.actions) && rule.actions.length > 0) return rule.actions[0].targetType;
        return rule.targetType || 'extension';
    }

    function renderRules(rulesToRender) {
        const container = DOM['rules-list-container'];
        const emptyState = DOM['empty-state'];
        const noResults = DOM['no-results-placeholder'];
        const tableWrapper = DOM['table-wrapper'];
        if (!container) return;

        const hasRules = state.allRules.length > 0;
        const hasResults = rulesToRender.length > 0;

        if (emptyState) emptyState.style.display = !hasRules ? 'flex' : 'none';
        if (tableWrapper) tableWrapper.style.display = hasRules ? 'block' : 'none';
        if (noResults) noResults.style.display = hasRules && !hasResults ? 'block' : 'none';

        if (!hasRules) {
            container.textContent = '';
            state.ruleElementsCache.clear();
            updateSelectAllCheckboxState();
            return;
        }

        const fragment = createFragment();
        const newCache = new Map();

        rulesToRender.forEach(rule => {
            if (!rule?.id) return;
            const el = createRuleElement(rule);
            const existing = state.ruleElementsCache.get(rule.id);
            if (existing && existing.isConnected) existing.replaceWith(el);
            else fragment.appendChild(el);
            newCache.set(rule.id, el);
        });

        state.ruleElementsCache.forEach((el, id) => {
            if (!newCache.has(id) && el?.isConnected) el.remove();
        });

        if (fragment.childNodes.length > 0) container.appendChild(fragment);
        state.ruleElementsCache = newCache;
        updateSelectAllCheckboxState();
    }

    function createRuleElement(rule) {
        const tr = createElement('tr', 'rule-row');
        tr.dataset.ruleId = rule.id;
        if (state.selectedRuleIds.has(rule.id)) tr.classList.add('selected');

        // Select cell
        const tdSelect = createElement('td', 'col-select');
        const cb = createElement('input', 'rule-select-checkbox');
        cb.type = 'checkbox';
        cb.checked = state.selectedRuleIds.has(rule.id);
        cb.setAttribute('aria-label', `Select rule "${sanitizeText(rule.name)}"`);
        tdSelect.appendChild(cb);

        // Name cell
        const tdName = createElement('td', 'col-name');
        const nameDiv = createElement('div', 'rule-name-cell');
        const nameText = createElement('span', 'rule-name-text', sanitizeText(rule.name));
        nameDiv.appendChild(nameText);
        if (Array.isArray(rule.tags) && rule.tags.length > 0) {
            const tagsDiv = createElement('div', 'tags-container');
            rule.tags.forEach(t => {
                if (typeof t === 'string' && t.trim()) {
                    tagsDiv.appendChild(createElement('span', 'tag', sanitizeText(t)));
                }
            });
            nameDiv.appendChild(tagsDiv);
        }
        tdName.appendChild(nameDiv);

        // Trigger cell
        const tdTrigger = createElement('td', 'col-trigger');
        tdTrigger.appendChild(buildTriggerSummary(rule.trigger));

        // Targets cell
        const tdTargets = createElement('td', 'col-targets');
        const targetText = buildTargetsSummary(rule);
        tdTargets.textContent = targetText;
        tdTargets.title = targetText;

        // Status cell
        const tdStatus = createElement('td', 'col-status');
        tdStatus.appendChild(createToggleSwitch(rule.id, rule.enabled));

        // Actions cell
        const tdActions = createElement('td', 'col-actions');
        const editBtn = createIconButton('icon-edit', 'edit-rule-btn', `Edit "${sanitizeText(rule.name)}"`);
        const deleteBtn = createIconButton('icon-trash', 'delete-rule-btn', `Delete "${sanitizeText(rule.name)}"`);
        tdActions.appendChild(editBtn);
        tdActions.appendChild(deleteBtn);

        tr.appendChild(tdSelect);
        tr.appendChild(tdName);
        tr.appendChild(tdTrigger);
        tr.appendChild(tdTargets);
        tr.appendChild(tdStatus);
        tr.appendChild(tdActions);
        return tr;
    }

    function buildTriggerSummary(trigger) {
        if (!trigger) return createElement('span', null, '—');
        if (trigger.type === 'compound' && Array.isArray(trigger.conditions)) {
            const wrapper = createElement('div', 'rule-condition');
            const count = trigger.conditions.length;
            const icon = createElement('span', 'icon icon-clock');
            const text = createElement('div', 'condition-text', `${count} condition${count !== 1 ? 's' : ''} (AND)`);
            wrapper.appendChild(icon);
            wrapper.appendChild(text);
            return wrapper;
        }
        if (trigger.type === 'time') {
            const days = (trigger.days || []).map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ');
            return createConditionElement('icon-clock', `${trigger.time || '00:00'} — ${days}`);
        }
        if (trigger.type === 'url') {
            return createConditionElement('icon-url', trigger.url || '');
        }
        if (trigger.type === 'time_range') {
            const days = (trigger.days || []).map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ');
            return createConditionElement('icon-clock', `${trigger.startTime || '00:00'}–${trigger.endTime || '23:59'} — ${days}`);
        }
        return createElement('span', null, '—');
    }

    function buildTargetsSummary(rule) {
        const actions = Array.isArray(rule.actions)
            ? rule.actions
            : [{ type: rule.action, targetType: rule.targetType, targetIds: rule.targetIds }];
        const parts = [];
        actions.forEach(action => {
            if (!action?.targetIds?.length) return;
            if (action.targetType === 'extension') {
                const names = state.allExtensions
                    .filter(ext => action.targetIds.includes(ext.id))
                    .map(ext => ext.name);
                parts.push(names.join(', ') || 'Unknown extensions');
            } else if (action.targetType === 'profile') {
                const p = state.allProfiles.find(pr => pr.id === action.targetIds[0]);
                parts.push(p ? sanitizeText(p.name) : 'Unknown profile');
            }
        });
        return parts.join('; ') || '—';
    }

    function createConditionElement(iconClass, text) {
        const wrap = createElement('div', 'rule-condition');
        const icon = createElement('span', `icon ${iconClass}`);
        icon.setAttribute('aria-hidden', 'true');
        const txt = createElement('div', 'condition-text', sanitizeText(text));
        wrap.appendChild(icon);
        wrap.appendChild(txt);
        return wrap;
    }

    function createIconButton(iconClass, btnClass, ariaLabel) {
        const btn = createElement('button', `btn-icon ${btnClass}`);
        btn.setAttribute('aria-label', ariaLabel);
        btn.type = 'button';
        const icon = createElement('span', `icon ${iconClass}`);
        icon.setAttribute('aria-hidden', 'true');
        btn.appendChild(icon);
        return btn;
    }

    function createToggleSwitch(ruleId, isEnabled) {
        const label = createElement('label', 'toggle-switch');
        label.setAttribute('aria-label', isEnabled ? 'Disable rule' : 'Enable rule');
        const input = createElement('input');
        input.type = 'checkbox';
        input.checked = !!isEnabled;
        input.dataset.ruleId = ruleId;
        input.classList.add('toggle-rule-btn');
        input.setAttribute('role', 'switch');
        input.setAttribute('aria-checked', String(!!isEnabled));
        const slider = createElement('span', 'slider');
        label.appendChild(input);
        label.appendChild(slider);
        return label;
    }

    // --- Stepper Logic ---
    function showStep(step) {
        state.currentStep = step;
        DOM.stepTabs.forEach((tab, idx) => {
            const num = idx + 1;
            const isActive = num === step;
            tab.classList.toggle('active', isActive);
            tab.classList.toggle('completed', num < step);
            tab.setAttribute('aria-selected', String(isActive));
            tab.setAttribute('tabindex', isActive ? '0' : '-1');
        });
        DOM.stepContents.forEach(content => {
            const contentStep = parseInt(content.dataset.stepContent, 10);
            const isActive = contentStep === step;
            content.classList.toggle('active', isActive);
            content.hidden = !isActive;
        });
        if (step === 1) DOM['rule-name-input']?.focus();
        else if (step === 2) DOM['add-trigger-condition-btn']?.focus();
        else if (step === 3) DOM['add-action-btn']?.focus();
    }

    function validateStep(step) {
        clearValidationError(DOM['rule-name-error']);
        clearValidationError(DOM['trigger-error']);
        clearValidationError(DOM['actions-error']);

        if (step === 1) {
            const name = DOM['rule-name-input']?.value?.trim();
            if (!name) {
                showValidationError(DOM['rule-name-error'], 'Rule name is required.');
                DOM['rule-name-input']?.focus();
                return false;
            }
            const isTaken = state.allRules.some(r =>
                r && r.name &&
                r.name.toLowerCase() === name.toLowerCase() &&
                r.id !== (DOM['rule-id-input']?.value || '')
            );
            if (isTaken) {
                showValidationError(DOM['rule-name-error'], 'A rule with this name already exists.');
                DOM['rule-name-input']?.focus();
                return false;
            }
            return true;
        }
        if (step === 2) {
            const conditions = collectConditionsFromForm();
            if (conditions.length === 0) {
                showValidationError(DOM['trigger-error'], 'Add at least one trigger condition.');
                return false;
            }
            for (const c of conditions) {
                if (c.type === 'time' && !c.time) {
                    showValidationError(DOM['trigger-error'], 'Time is required for all time conditions.');
                    return false;
                }
                if (c.type === 'time_range' && (!c.startTime || !c.endTime)) {
                    showValidationError(DOM['trigger-error'], 'Start and end times are required for time ranges.');
                    return false;
                }
                if (c.type === 'url' && !c.url?.trim()) {
                    showValidationError(DOM['trigger-error'], 'URL is required for all URL conditions.');
                    return false;
                }
                if ((c.type === 'time' || c.type === 'time_range') && (!c.days || c.days.length === 0)) {
                    showValidationError(DOM['trigger-error'], 'Select at least one day for each time condition.');
                    return false;
                }
            }
            return true;
        }
        if (step === 3) {
            const actions = collectActionsFromForm();
            if (actions.length === 0) {
                showValidationError(DOM['actions-error'], 'Add at least one action.');
                return false;
            }
            for (const a of actions) {
                if (!a.targetIds || a.targetIds.length === 0) {
                    showValidationError(DOM['actions-error'], 'Each action must have at least one target selected.');
                    return false;
                }
                if (a.targetType === 'profile' && a.targetIds.length > 1) {
                    showValidationError(DOM['actions-error'], 'Profile actions must select only one profile.');
                    return false;
                }
            }
            return true;
        }
        return true;
    }

    // --- Form Builders: Triggers ---
    function renderConditions(conditions = []) {
        const container = DOM['trigger-conditions-container'];
        if (!container) return;
        container.textContent = '';
        conditions.forEach((c, i) => {
            if (i > 0) container.appendChild(createAndConnector());
            container.appendChild(createConditionCard(c, i));
        });
        updateConditionBadges();
    }

    function createAndConnector() {
        const div = createElement('div', 'and-connector');
        div.textContent = 'AND';
        div.setAttribute('aria-hidden', 'true');
        return div;
    }

    function createConditionCard(condition = {}, index) {
        const card = createElement('div', 'condition-card');
        card.dataset.index = index;

        const header = createElement('div', 'condition-header');
        const badge = createElement('span', 'condition-type-badge', `Condition ${index + 1}`);
        const removeBtn = createIconButton('icon-trash', 'remove-condition-btn', 'Remove condition');
        header.appendChild(badge);
        header.appendChild(removeBtn);

        const body = createElement('div', 'condition-body');

        const typeGroup = createElement('div', 'form-group');
        const typeId = `cond-type-${index}-${Math.random().toString(36).slice(2, 7)}`;
        const typeLabel = createElement('label', 'form-label', 'Type');
        typeLabel.htmlFor = typeId;
        const typeSelect = createElement('select', 'condition-type-select');
        typeSelect.id = typeId;
        typeSelect.innerHTML = `
            <option value="time" ${condition.type === 'time' ? 'selected' : ''}>Specific Time</option>
            <option value="time_range" ${condition.type === 'time_range' ? 'selected' : ''}>Time Range</option>
            <option value="url" ${condition.type === 'url' ? 'selected' : ''}>URL Match</option>
        `;
        typeGroup.appendChild(typeLabel);
        typeGroup.appendChild(typeSelect);

        const dynamicArea = createElement('div', 'condition-dynamic-area');
        const renderDynamic = () => {
            dynamicArea.textContent = '';
            const type = typeSelect.value;
            if (type === 'time') dynamicArea.appendChild(buildTimeFields(condition));
            else if (type === 'time_range') dynamicArea.appendChild(buildTimeRangeFields(condition));
            else if (type === 'url') dynamicArea.appendChild(buildUrlFields(condition));
        };
        typeSelect.addEventListener('change', renderDynamic);
        renderDynamic();

        body.appendChild(typeGroup);
        body.appendChild(dynamicArea);
        card.appendChild(header);
        card.appendChild(body);

        removeBtn.addEventListener('click', () => {
            const cards = document.querySelectorAll('.condition-card');
            if (cards.length <= 1) {
                Status.error('A rule needs at least one condition.');
                return;
            }
            // Also remove the preceding AND connector if present
            const prev = card.previousElementSibling;
            if (prev?.classList.contains('and-connector')) prev.remove();
            card.remove();
            updateConditionBadges();
        });

        return card;
    }

    function buildTimeFields(condition = {}) {
        const wrap = createElement('div', 'condition-row');
        const uid = Math.random().toString(36).slice(2, 7);

        const timeGroup = createElement('div', 'form-group');
        const timeLbl = createElement('label', 'form-label', 'Time');
        const timeId = `cond-time-${uid}`;
        timeLbl.htmlFor = timeId;
        const timeInput = createElement('input');
        timeInput.type = 'time';
        timeInput.id = timeId;
        timeInput.className = 'condition-time-input';
        timeInput.value = condition.time || '';
        timeInput.required = true;
        timeGroup.appendChild(timeLbl);
        timeGroup.appendChild(timeInput);

        const daysGroup = createElement('div', 'form-group');
        const daysLegend = createElement('span', 'form-label', 'Days');
        daysGroup.appendChild(daysLegend);
        const daySelector = createElement('div', 'day-selector');
        const days = condition.days || [];
        const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        dayNames.forEach((name, val) => {
            const id = `cond-day-${val}-${uid}`;
            const cb = createElement('input');
            cb.type = 'checkbox';
            cb.value = val;
            cb.id = id;
            cb.checked = days.includes(val);
            const lbl = createElement('label', null, name);
            lbl.htmlFor = id;
            daySelector.appendChild(cb);
            daySelector.appendChild(lbl);
        });
        daysGroup.appendChild(daySelector);

        wrap.appendChild(timeGroup);
        wrap.appendChild(daysGroup);
        return wrap;
    }

    function buildTimeRangeFields(condition = {}) {
        const wrap = createElement('div', 'condition-row');
        const uid = Math.random().toString(36).slice(2, 7);

        const makeTimeGroup = (labelText, cls, val) => {
            const group = createElement('div', 'form-group');
            const lbl = createElement('label', 'form-label', labelText);
            const id = `cond-${cls}-${uid}`;
            lbl.htmlFor = id;
            const input = createElement('input');
            input.type = 'time';
            input.id = id;
            input.className = cls;
            input.value = val || '';
            group.appendChild(lbl);
            group.appendChild(input);
            return group;
        };

        const daysGroup = createElement('div', 'form-group');
        const daysLegend = createElement('span', 'form-label', 'Days');
        daysGroup.appendChild(daysLegend);
        const daySelector = createElement('div', 'day-selector');
        const days = condition.days || [];
        const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        dayNames.forEach((name, val) => {
            const id = `range-day-${val}-${uid}`;
            const cb = createElement('input');
            cb.type = 'checkbox';
            cb.value = val;
            cb.id = id;
            cb.checked = days.includes(val);
            const lbl = createElement('label', null, name);
            lbl.htmlFor = id;
            daySelector.appendChild(cb);
            daySelector.appendChild(lbl);
        });
        daysGroup.appendChild(daySelector);

        wrap.appendChild(makeTimeGroup('Start', 'condition-start-time-input', condition.startTime));
        wrap.appendChild(makeTimeGroup('End', 'condition-end-time-input', condition.endTime));
        wrap.appendChild(daysGroup);
        return wrap;
    }

    function buildUrlFields(condition = {}) {
        const wrap = createElement('div', 'condition-row');
        const uid = Math.random().toString(36).slice(2, 7);

        const urlGroup = createElement('div', 'form-group');
        urlGroup.style.flex = '2';
        const urlId = `cond-url-${uid}`;
        const urlLbl = createElement('label', 'form-label', 'URL or Domain');
        urlLbl.htmlFor = urlId;
        const urlInput = createElement('input');
        urlInput.type = 'text';
        urlInput.id = urlId;
        urlInput.className = 'condition-url-input';
        urlInput.placeholder = 'e.g., github.com or https://developer.chrome.com';
        urlInput.value = condition.url || '';
        urlGroup.appendChild(urlLbl);
        urlGroup.appendChild(urlInput);

        const matchGroup = createElement('div', 'form-group');
        const matchId = `cond-match-${uid}`;
        const matchLbl = createElement('label', 'form-label', 'Match');
        matchLbl.htmlFor = matchId;
        const matchSelect = createElement('select', 'condition-match-type-select');
        matchSelect.id = matchId;
        matchSelect.innerHTML = `
            <option value="contains" ${!condition.matchType || condition.matchType === 'contains' ? 'selected' : ''}>Contains</option>
            <option value="exact" ${condition.matchType === 'exact' ? 'selected' : ''}>Exact</option>
            <option value="startsWith" ${condition.matchType === 'startsWith' ? 'selected' : ''}>Starts with</option>
            <option value="regex" ${condition.matchType === 'regex' ? 'selected' : ''}>Regex</option>
        `;
        matchGroup.appendChild(matchLbl);
        matchGroup.appendChild(matchSelect);

        wrap.appendChild(urlGroup);
        wrap.appendChild(matchGroup);
        return wrap;
    }

    function updateConditionBadges() {
        document.querySelectorAll('.condition-card').forEach((card, i) => {
            const badge = card.querySelector('.condition-type-badge');
            if (badge) badge.textContent = `Condition ${i + 1}`;
        });
    }

    function collectConditionsFromForm() {
        return Array.from(document.querySelectorAll('.condition-card')).map(card => {
            const type = card.querySelector('.condition-type-select')?.value || 'time';
            const base = { type };
            if (type === 'time') {
                base.time = card.querySelector('.condition-time-input')?.value || '';
                base.days = Array.from(card.querySelectorAll('.day-selector input:checked')).map(cb => parseInt(cb.value, 10));
            } else if (type === 'time_range') {
                base.startTime = card.querySelector('.condition-start-time-input')?.value || '';
                base.endTime = card.querySelector('.condition-end-time-input')?.value || '';
                base.days = Array.from(card.querySelectorAll('.day-selector input:checked')).map(cb => parseInt(cb.value, 10));
            } else if (type === 'url') {
                base.url = (card.querySelector('.condition-url-input')?.value || '').trim();
                base.matchType = card.querySelector('.condition-match-type-select')?.value || 'contains';
            }
            return base;
        }).filter(c => {
            if (c.type === 'time') return c.time;
            if (c.type === 'time_range') return c.startTime && c.endTime;
            if (c.type === 'url') return c.url;
            return false;
        });
    }

    // --- Form Builders: Actions ---
    function renderActions(actions = []) {
        const container = DOM['actions-container'];
        if (!container) return;
        container.textContent = '';
        actions.forEach((a, i) => container.appendChild(createActionCard(a, i)));
        updateActionNumbers();
    }

    function createActionCard(action = {}, index) {
        const card = createElement('div', 'action-card');
        card.dataset.index = index;

        const header = createElement('div', 'action-header');
        const badge = createElement('span', 'action-number-badge', `Action ${index + 1}`);
        const removeBtn = createIconButton('icon-trash', 'remove-action-btn', 'Remove action');
        header.appendChild(badge);
        header.appendChild(removeBtn);

        const body = createElement('div', 'action-body');

        const typeRow = createElement('div', 'action-row');

        const typeGroup = createElement('div', 'form-group');
        const ttId = `act-tt-${index}-${Math.random().toString(36).slice(2, 7)}`;
        const ttLbl = createElement('label', 'form-label', 'Target Type');
        ttLbl.htmlFor = ttId;
        const typeSelect = createElement('select', 'action-target-type-select');
        typeSelect.id = ttId;
        typeSelect.innerHTML = `
            <option value="extension" ${action.targetType === 'extension' ? 'selected' : ''}>Extensions</option>
            <option value="profile" ${action.targetType === 'profile' ? 'selected' : ''}>Profile</option>
        `;
        typeGroup.appendChild(ttLbl);
        typeGroup.appendChild(typeSelect);

        const actGroup = createElement('div', 'form-group');
        const atId = `act-at-${index}-${Math.random().toString(36).slice(2, 7)}`;
        const atLbl = createElement('label', 'form-label', 'Action');
        atLbl.htmlFor = atId;
        const actSelect = createElement('select', 'action-type-select');
        actSelect.id = atId;
        actGroup.appendChild(atLbl);
        actGroup.appendChild(actSelect);

        typeRow.appendChild(typeGroup);
        typeRow.appendChild(actGroup);
        body.appendChild(typeRow);

        const targetGroup = createElement('div', 'form-group');
        const tgtLbl = createElement('label', 'form-label', 'Select Targets');
        targetGroup.appendChild(tgtLbl);
        const targetContainer = createElement('div', 'mini-target-selector');
        targetContainer.dataset.index = index;
        targetGroup.appendChild(targetContainer);
        body.appendChild(targetGroup);

        const populateTargets = () => {
            const tType = typeSelect.value;
            const selected = action.targetIds || [];
            targetContainer.textContent = '';
            const items = tType === 'extension' ? state.allExtensions : state.allProfiles;
            if (items.length === 0) {
                targetContainer.appendChild(createElement('p', 'placeholder-text', `No ${tType}s found.`));
                return;
            }
            items.forEach(item => {
                if (!item) return;
                const id = item.id;
                const name = item.name || 'Unnamed';
                let imgSrc = DEFAULT_ICON_PLACEHOLDER;
                if (item.icons?.length > 0 && item.icons[item.icons.length - 1]?.url) {
                    imgSrc = item.icons[item.icons.length - 1].url;
                }
                const inputId = `act-${index}-target-${id}`;
                const row = createElement('div', 'extension-selector-item');
                const input = createElement('input');
                input.type = tType === 'profile' ? 'radio' : 'checkbox';
                input.name = `action-target-${index}`;
                input.value = id;
                input.id = inputId;
                input.checked = selected.includes(id);
                const lbl = createElement('label');
                lbl.htmlFor = inputId;
                const img = createElement('img');
                img.src = imgSrc;
                img.alt = '';
                img.onerror = function() { this.src = DEFAULT_ICON_PLACEHOLDER; };
                lbl.appendChild(img);
                lbl.appendChild(createElement('span', null, sanitizeText(name)));
                row.appendChild(input);
                row.appendChild(lbl);
                targetContainer.appendChild(row);
            });
        };

        const updateActionTypeOptions = () => {
            const tType = typeSelect.value;
            const oldVal = actSelect.value;
            actSelect.textContent = '';
            if (tType === 'extension') {
                actSelect.appendChild(new Option('Enable', 'enable'));
                actSelect.appendChild(new Option('Disable', 'disable'));
            } else {
                actSelect.appendChild(new Option('Apply', 'apply'));
            }
            if (Array.from(actSelect.options).some(o => o.value === oldVal)) actSelect.value = oldVal;
        };

        typeSelect.addEventListener('change', () => {
            updateActionTypeOptions();
            populateTargets();
        });
        updateActionTypeOptions();
        populateTargets();

        card.appendChild(header);
        card.appendChild(body);

        removeBtn.addEventListener('click', () => {
            const cards = document.querySelectorAll('.action-card');
            if (cards.length <= 1) {
                Status.error('A rule needs at least one action.');
                return;
            }
            card.remove();
            updateActionNumbers();
        });

        return card;
    }

    function updateActionNumbers() {
        document.querySelectorAll('.action-card').forEach((card, i) => {
            const badge = card.querySelector('.action-number-badge');
            if (badge) badge.textContent = `Action ${i + 1}`;
            card.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(inp => {
                const newName = `action-target-${i}`;
                if (inp.name && inp.name !== newName) {
                    inp.name = newName;
                }
            });
        });
    }

    function collectActionsFromForm() {
        return Array.from(document.querySelectorAll('.action-card')).map(card => {
            const targetType = card.querySelector('.action-target-type-select')?.value || 'extension';
            const type = card.querySelector('.action-type-select')?.value || 'enable';
            const targetIds = Array.from(card.querySelectorAll('.mini-target-selector input:checked')).map(cb => cb.value);
            return { targetType, type, targetIds };
        }).filter(a => a.targetIds.length > 0);
    }

    // --- Validation Helpers ---
    function showValidationError(element, message) {
        if (!element) return;
        element.textContent = message;
        element.setAttribute('role', 'alert');
    }

    function clearValidationError(element) {
        if (!element) return;
        element.textContent = '';
        element.removeAttribute('role');
        const input = element.previousElementSibling;
        if (input && (input.tagName === 'INPUT' || input.tagName === 'SELECT' || input.tagName === 'TEXTAREA')) {
            input.classList.remove('invalid');
            input.removeAttribute('aria-invalid');
        }
    }

    function clearAllValidationErrors() {
        clearValidationError(DOM['rule-name-error']);
        clearValidationError(DOM['trigger-error']);
        clearValidationError(DOM['actions-error']);
        document.querySelectorAll('.invalid').forEach(el => {
            el.classList.remove('invalid');
            el.removeAttribute('aria-invalid');
        });
    }

    // --- Conflict Detection ---
    function findConflictingRules(newRule) {
        if (!newRule.enabled) return [];
        const conflicts = [];
        const relevant = state.allRules.filter(r => r && r.enabled && r.id !== newRule.id);
        const newActions = newRule.actions || [{ type: newRule.action, targetType: newRule.targetType, targetIds: newRule.targetIds }];
        const newTrigger = newRule.trigger;

        for (const existing of relevant) {
            if (!existing.trigger) continue;
            if (!triggersOverlap(newTrigger, existing.trigger)) continue;
            const existingActions = existing.actions || [{ type: existing.action, targetType: existing.targetType, targetIds: existing.targetIds }];
            for (const na of newActions) {
                for (const ea of existingActions) {
                    if (actionsConflict(na, ea)) {
                        conflicts.push(existing);
                        break;
                    }
                }
                if (conflicts.includes(existing)) break;
            }
        }
        return conflicts;
    }

    function triggersOverlap(t1, t2) {
        const c1 = t1?.type === 'compound' ? (t1.conditions || []) : [t1];
        const c2 = t2?.type === 'compound' ? (t2.conditions || []) : [t2];
        for (const a of c1) {
            for (const b of c2) {
                if (!a || !b) continue;
                if (a.type === 'time' && b.type === 'time') {
                    if (a.time === b.time) {
                        const d1 = a.days || [], d2 = b.days || [];
                        if (d1.some(d => d2.includes(d))) return true;
                    }
                } else if ((a.type === 'time' && b.type === 'time_range') || (a.type === 'time_range' && b.type === 'time')) {
                    const d1 = a.days || [], d2 = b.days || [];
                    if (d1.some(d => d2.includes(d))) return true;
                } else if (a.type === 'time_range' && b.type === 'time_range') {
                    const d1 = a.days || [], d2 = b.days || [];
                    if (d1.some(d => d2.includes(d))) return true;
                } else if (a.type === 'url' && b.type === 'url') {
                    const u1 = (a.url || '').toLowerCase();
                    const u2 = (b.url || '').toLowerCase();
                    if (u1.includes(u2) || u2.includes(u1)) return true;
                }
            }
        }
        return false;
    }

    function actionsConflict(a1, a2) {
        if (!a1 || !a2) return false;
        if (a1.targetType !== a2.targetType) {
            if (a1.targetType === 'profile' && a2.targetType === 'extension') {
                const profile = state.allProfiles.find(p => p.id === a1.targetIds?.[0]);
                if (profile?.extensionStates && a2.targetIds?.some(id => id in profile.extensionStates)) return true;
            }
            if (a2.targetType === 'profile' && a1.targetType === 'extension') {
                const profile = state.allProfiles.find(p => p.id === a2.targetIds?.[0]);
                if (profile?.extensionStates && a1.targetIds?.some(id => id in profile.extensionStates)) return true;
            }
            return false;
        }
        const common = (a1.targetIds || []).filter(id => (a2.targetIds || []).includes(id));
        if (common.length === 0) return false;
        if (a1.targetType === 'extension') {
            if ((a1.type === 'enable' && a2.type === 'disable') || (a1.type === 'disable' && a2.type === 'enable')) return true;
        } else if (a1.targetType === 'profile') {
            if (a1.type === 'apply' && a2.type === 'apply' && a1.targetIds[0] !== a2.targetIds[0]) return true;
        }
        return false;
    }

    // --- Form Submit ---
    async function handleFormSubmit(e) {
        e.preventDefault();

        const step1Ok = validateStep(1);
        const step2Ok = validateStep(2);
        const step3Ok = validateStep(3);

        if (!step1Ok) { showStep(1); Status.error('Please correct the errors before saving.'); return; }
        if (!step2Ok) { showStep(2); Status.error('Please correct the errors before saving.'); return; }
        if (!step3Ok) { showStep(3); Status.error('Please correct the errors before saving.'); return; }

        const conditions = collectConditionsFromForm();
        const trigger = { type: 'compound', operator: 'and', conditions };
        const actions = collectActionsFromForm();

        const ruleData = {
            id: DOM['rule-id-input']?.value || `rule_${Date.now()}`,
            name: DOM['rule-name-input']?.value?.trim() || '',
            tags: (DOM['rule-tags-input']?.value || '').split(',').map(t => t.trim()).filter(Boolean),
            trigger,
            actions,
            enabled: true,
        };

        // Preserve disabled state when editing
        const existing = state.allRules.find(r => r.id === ruleData.id);
        if (existing && existing.enabled === false) ruleData.enabled = false;

        // Legacy fields for backward compatibility
        const legacyAction = actions[0];
        if (legacyAction) {
            ruleData.action = legacyAction.type;
            ruleData.targetType = legacyAction.targetType;
            ruleData.targetIds = legacyAction.targetIds;
        }

        const conflicts = findConflictingRules(ruleData);
        if (conflicts.length > 0) {
            const names = conflicts.map(r => `"${sanitizeText(r.name)}"`).join(', ');
            Status.bar(`Cannot save: conflicts with ${names}. Disable conflicting rules first.`);
            return;
        }

        let updatedRules;
        const idx = state.allRules.findIndex(r => r.id === ruleData.id);
        if (idx > -1) {
            updatedRules = [...state.allRules];
            updatedRules[idx] = ruleData;
        } else {
            updatedRules = [...state.allRules, ruleData];
        }

        chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updatedRules }, () => {
            refreshUI();
            Status.toast('Rule saved successfully!');
            setActivePanel('rules-list-panel');
        });
    }

    // --- Rule List Interactions ---
    async function handleRulesListClick(e) {
        const row = e.target.closest('tr[data-rule-id]');
        if (!row) return;
        const ruleId = row.dataset.ruleId;
        if (!ruleId) return;

        if (e.target.closest('.edit-rule-btn')) {
            const rule = state.allRules.find(r => r?.id === ruleId);
            if (rule) showRuleForm(rule);
        } else if (e.target.closest('.delete-rule-btn')) {
            const rule = state.allRules.find(r => r?.id === ruleId);
            if (!rule) return;
            const confirmed = await showConfirmDialog(`Delete the rule "${sanitizeText(rule.name)}"? This cannot be undone.`);
            if (!confirmed) return;
            const updated = state.allRules.filter(r => r?.id !== ruleId);
            state.selectedRuleIds.delete(ruleId);
            chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updated }, () => {
                refreshUI();
                Status.toast('Rule deleted.');
            });
        } else if (e.target.classList.contains('toggle-rule-btn')) {
            const toggle = e.target;
            const rule = state.allRules.find(r => r?.id === ruleId);
            if (rule) {
                rule.enabled = toggle.checked;
                toggle.setAttribute('aria-checked', String(toggle.checked));
                const parentLabel = toggle.closest('.toggle-switch');
                if (parentLabel) parentLabel.setAttribute('aria-label', rule.enabled ? 'Disable rule' : 'Enable rule');
                chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: state.allRules }, () => {
                    refreshUI();
                    Status.toast(`Rule "${sanitizeText(rule.name)}" ${rule.enabled ? 'enabled' : 'disabled'}.`);
                });
            }
        } else if (e.target.classList.contains('rule-select-checkbox')) {
            toggleRuleSelection(ruleId, e.target.checked);
        }
    }

    function toggleRuleSelection(ruleId, isChecked) {
        if (!ruleId) return;
        if (isChecked) state.selectedRuleIds.add(ruleId);
        else state.selectedRuleIds.delete(ruleId);
        const row = document.querySelector(`tr[data-rule-id="${CSS.escape(ruleId)}"]`);
        if (row) row.classList.toggle('selected', isChecked);
        updateBulkActionBarVisibility();
        updateSelectAllCheckboxState();
    }

    function updateBulkActionBarVisibility() {
        const count = state.selectedRuleIds.size;
        const bar = DOM['bulk-actions-bar'];
        const countSpan = DOM['selected-rules-count'];
        if (countSpan) countSpan.textContent = `${count} selected`;
        if (!bar) return;
        if (count > 0) {
            bar.style.display = 'flex';
            requestAnimationFrame(() => bar.classList.add('active'));
        } else {
            bar.classList.remove('active');
            const onEnd = () => {
                if (!bar.classList.contains('active')) bar.style.display = 'none';
                bar.removeEventListener('transitionend', onEnd);
            };
            bar.addEventListener('transitionend', onEnd);
        }
    }

    function updateSelectAllCheckboxState() {
        const cb = DOM['select-all-rules'];
        if (!cb) return;
        const visibleIds = Array.from(document.querySelectorAll('#rules-list-container tr[data-rule-id]')).map(el => el.dataset.ruleId);
        if (visibleIds.length === 0) {
            cb.checked = false;
            cb.indeterminate = false;
            cb.disabled = true;
            return;
        }
        cb.disabled = false;
        const allSel = visibleIds.every(id => state.selectedRuleIds.has(id));
        const someSel = visibleIds.some(id => state.selectedRuleIds.has(id));
        cb.checked = allSel;
        cb.indeterminate = someSel && !allSel;
    }

    function handleSelectAllChange(isChecked) {
        document.querySelectorAll('#rules-list-container .rule-select-checkbox').forEach(cb => {
            cb.checked = isChecked;
            const id = cb.closest('tr')?.dataset.ruleId;
            if (id) toggleRuleSelection(id, isChecked);
        });
    }

    async function bulkDeleteSelected() {
        if (state.selectedRuleIds.size === 0) { Status.toast('No rules selected.'); return; }
        const confirmed = await showConfirmDialog(`Delete ${state.selectedRuleIds.size} selected rule(s)? This cannot be undone.`);
        if (!confirmed) return;
        const updated = state.allRules.filter(r => !state.selectedRuleIds.has(r.id));
        const count = state.selectedRuleIds.size;
        state.selectedRuleIds.clear();
        chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updated }, () => {
            refreshUI();
            Status.toast(`${count} rule(s) deleted.`);
        });
    }

    async function bulkToggleSelected(enable) {
        if (state.selectedRuleIds.size === 0) { Status.toast('No rules selected.'); return; }
        const action = enable ? 'Enable' : 'Disable';
        const confirmed = await showConfirmDialog(`${action} ${state.selectedRuleIds.size} selected rule(s)?`);
        if (!confirmed) return;
        const updated = state.allRules.map(r => state.selectedRuleIds.has(r.id) ? { ...r, enabled: enable } : r);
        const count = state.selectedRuleIds.size;
        state.selectedRuleIds.clear();
        chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updated }, () => {
            refreshUI();
            Status.toast(`${count} rule(s) ${action.toLowerCase()}d.`);
        });
    }

    // --- Panel Navigation ---
    // Bug fix: only highlight the nav button whose aria-controls matches the ACTIVE panel.
    // The 'Add New Rule' nav button must NOT stay highlighted after navigating away.
    function setActivePanel(panelId) {
        if (!panelId) return;
        state.activePanelId = panelId;

        DOM.panels.forEach(p => {
            const isActive = p.id === panelId;
            p.classList.toggle('active', isActive);
            p.setAttribute('aria-hidden', String(!isActive));
        });

        // Remove active from all nav buttons first
        DOM.navButtons.forEach(b => {
            b.classList.remove('active');
            if (b.tagName === 'BUTTON') b.removeAttribute('aria-current');
        });

        // Only set active on the button that directly controls this panel
        // (not the 'Add New Rule' button when we're on the add-rule panel via edit flow)
        const directBtn = document.querySelector(`.sidebar-button[aria-controls="${panelId}"]`);
        if (directBtn) {
            directBtn.classList.add('active');
            if (directBtn.tagName === 'BUTTON') directBtn.setAttribute('aria-current', 'page');
        }

        if (panelId === 'rules-list-panel') {
            state.selectedRuleIds.clear();
            updateBulkActionBarVisibility();
            DOM['rule-search-input']?.focus();
        }
    }

    function showRuleForm(ruleToEdit = null) {
        DOM['rule-form']?.reset();
        clearAllValidationErrors();
        showStep(1);
        if (DOM['rule-id-input']) DOM['rule-id-input'].value = '';

        if (ruleToEdit) {
            if (DOM['form-panel-title']) DOM['form-panel-title'].textContent = 'Edit Rule';
            if (DOM['rule-id-input']) DOM['rule-id-input'].value = ruleToEdit.id || '';
            if (DOM['rule-name-input']) DOM['rule-name-input'].value = ruleToEdit.name || '';
            if (DOM['rule-tags-input']) DOM['rule-tags-input'].value = (Array.isArray(ruleToEdit.tags) ? ruleToEdit.tags : []).map(t => sanitizeText(t)).join(', ');

            let trigger = ruleToEdit.trigger;
            if (trigger && trigger.type !== 'compound') {
                trigger = { type: 'compound', operator: 'and', conditions: [{ ...trigger }] };
            } else if (!trigger || !trigger.conditions) {
                trigger = { type: 'compound', operator: 'and', conditions: [{ type: 'time' }] };
            }
            renderConditions(trigger.conditions || []);

            let actions = ruleToEdit.actions;
            if (!actions && ruleToEdit.action) {
                actions = [{ targetType: ruleToEdit.targetType || 'extension', type: ruleToEdit.action || 'enable', targetIds: ruleToEdit.targetIds || [] }];
            } else if (!actions) {
                actions = [{ targetType: 'extension', type: 'enable', targetIds: [] }];
            }
            renderActions(actions);
        } else {
            if (DOM['form-panel-title']) DOM['form-panel-title'].textContent = 'Create New Rule';
            renderConditions([{ type: 'time' }]);
            renderActions([{ targetType: 'extension', type: 'enable', targetIds: [] }]);
        }

        setActivePanel('add-rule-panel');
    }

    // --- Filter Sheet ---
    function openFilterSheet() {
        DOM['filter-side-sheet']?.classList.add('active');
        DOM['filter-btn']?.setAttribute('aria-expanded', 'true');
        DOM['close-filter-sheet']?.focus();
    }

    function closeFilterSheet() {
        DOM['filter-side-sheet']?.classList.remove('active');
        DOM['filter-btn']?.setAttribute('aria-expanded', 'false');
        DOM['filter-btn']?.focus();
    }

    function resetFiltersState() {
        if (DOM['filter-status-select']) DOM['filter-status-select'].value = 'all';
        if (DOM['filter-trigger-select']) DOM['filter-trigger-select'].value = 'all';
        if (DOM['filter-target-type-select']) DOM['filter-target-type-select'].value = 'all';
        state.currentFilters.status = 'all';
        state.currentFilters.trigger = 'all';
        state.currentFilters.targetType = 'all';
        state.currentFilters.tag = 'all';
        renderTagFilterInSheet();
    }

    // --- Dialogs ---
    function showConfirmDialog(message) {
        return new Promise(resolve => {
            const overlay = DOM['confirm-dialog-overlay'];
            const msgEl = DOM['confirm-dialog-message'];
            const okBtn = DOM['confirm-ok-btn'];
            const cancelBtn = DOM['confirm-cancel-btn'];
            if (!overlay || !msgEl || !okBtn || !cancelBtn) {
                resolve(confirm(message));
                return;
            }
            msgEl.textContent = message;
            overlay.classList.add('active');
            const previouslyFocused = document.activeElement;
            okBtn.focus();

            const cleanup = result => {
                overlay.classList.remove('active');
                okBtn.removeEventListener('click', onConfirm);
                cancelBtn.removeEventListener('click', onCancel);
                document.removeEventListener('keydown', onKey);
                if (previouslyFocused?.focus) previouslyFocused.focus();
                resolve(result);
            };
            const onConfirm = () => cleanup(true);
            const onCancel = () => cleanup(false);
            const onKey = e => {
                if (e.key === 'Escape') onCancel();
                if (e.key === 'Tab') trapFocus(e, overlay);
            };
            okBtn.addEventListener('click', onConfirm);
            cancelBtn.addEventListener('click', onCancel);
            document.addEventListener('keydown', onKey);
        });
    }

    function trapFocus(e, container) {
        const focusables = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    function isTypingInInput() {
        const tag = document.activeElement?.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    }

    // --- Event Listeners ---
    function initEventListeners() {
        // Nav buttons
        DOM.navButtons.forEach(btn => {
            btn.addEventListener('click', e => {
                if (btn.tagName === 'A') return; // let anchor links behave normally
                e.preventDefault();
                const panelId = btn.getAttribute('aria-controls');
                if (!panelId) return;
                if (panelId === 'add-rule-panel') showRuleForm();
                else setActivePanel(panelId);
            });
        });

        DOM['back-to-rules-list']?.addEventListener('click', () => setActivePanel('rules-list-panel'));
        DOM['cancel-rule-form']?.addEventListener('click', () => setActivePanel('rules-list-panel'));
        DOM['rule-form']?.addEventListener('submit', handleFormSubmit);
        DOM['empty-state-add-btn']?.addEventListener('click', () => showRuleForm());

        // Stepper
        DOM['step-1-next']?.addEventListener('click', () => { if (validateStep(1)) showStep(2); });
        DOM['step-2-back']?.addEventListener('click', () => showStep(1));
        DOM['step-2-next']?.addEventListener('click', () => { if (validateStep(2)) showStep(3); });
        DOM['step-3-back']?.addEventListener('click', () => showStep(2));

        // Trigger builder
        DOM['add-trigger-condition-btn']?.addEventListener('click', () => {
            const container = DOM['trigger-conditions-container'];
            const cards = container?.querySelectorAll('.condition-card');
            const lastType = cards?.length > 0
                ? cards[cards.length - 1].querySelector('.condition-type-select')?.value
                : 'time';
            container?.appendChild(createAndConnector());
            container?.appendChild(createConditionCard({ type: lastType }, cards?.length || 0));
            updateConditionBadges();
        });

        // Action builder
        DOM['add-action-btn']?.addEventListener('click', () => {
            const container = DOM['actions-container'];
            const cards = container?.querySelectorAll('.action-card');
            container?.appendChild(createActionCard({ targetType: 'extension', type: 'enable', targetIds: [] }, cards?.length || 0));
            updateActionNumbers();
        });

        // Search — debounced
        DOM['rule-search-input']?.addEventListener('input', () => {
            clearTimeout(state.searchDebounceTimer);
            state.searchDebounceTimer = setTimeout(() => {
                state.currentFilters.query = DOM['rule-search-input']?.value || '';
                applyFiltersAndRender();
            }, 180);
        });

        // Filter sheet open / close
        DOM['filter-btn']?.addEventListener('click', openFilterSheet);
        DOM['close-filter-sheet']?.addEventListener('click', closeFilterSheet);
        DOM['filter-sheet-overlay']?.addEventListener('click', closeFilterSheet);

        // Apply filters
        DOM['apply-filters-btn']?.addEventListener('click', () => {
            state.currentFilters.status = DOM['filter-status-select']?.value || 'all';
            state.currentFilters.trigger = DOM['filter-trigger-select']?.value || 'all';
            state.currentFilters.targetType = DOM['filter-target-type-select']?.value || 'all';
            // tag filter is applied as chips are clicked; read current from rendered state
            const activeChip = DOM['tag-chips-container']?.querySelector('.tag-chip.active');
            state.currentFilters.tag = activeChip?.dataset.tag || 'all';
            applyFiltersAndRender();
            closeFilterSheet();
        });

        // Reset filters (inside sheet)
        DOM['reset-filters-btn']?.addEventListener('click', () => {
            resetFiltersState();
            applyFiltersAndRender();
        });

        // Reset all filters (no-results CTA)
        DOM['reset-all-filters-btn']?.addEventListener('click', () => {
            if (DOM['rule-search-input']) DOM['rule-search-input'].value = '';
            state.currentFilters.query = '';
            resetFiltersState();
            applyFiltersAndRender();
        });

        // Bulk actions
        DOM['select-all-rules']?.addEventListener('change', e => handleSelectAllChange(e.target.checked));
        DOM['bulk-enable-btn']?.addEventListener('click', () => bulkToggleSelected(true));
        DOM['bulk-disable-btn']?.addEventListener('click', () => bulkToggleSelected(false));
        DOM['bulk-delete-btn']?.addEventListener('click', bulkDeleteSelected);

        // List delegation
        DOM['rules-list-container']?.addEventListener('click', handleRulesListClick);

        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                if (DOM['filter-side-sheet']?.classList.contains('active')) { closeFilterSheet(); return; }
            }
            if (e.key === '/' && !isTypingInInput() && state.activePanelId === 'rules-list-panel') {
                e.preventDefault();
                DOM['rule-search-input']?.focus();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !isTypingInInput()) {
                e.preventDefault();
                showRuleForm();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 's' && state.activePanelId === 'add-rule-panel') {
                e.preventDefault();
                DOM['rule-form']?.requestSubmit();
            }
        });

        // Trap focus in filter sheet when open
        DOM['filter-side-sheet']?.addEventListener('keydown', e => {
            if (e.key === 'Tab') trapFocus(e, DOM['filter-side-sheet']);
        });
    }

    // --- Init ---
    cacheDOM();
    initEventListeners();
    await refreshUI();
    setActivePanel('rules-list-panel');
});