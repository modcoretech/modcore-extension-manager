document.addEventListener('DOMContentLoaded', async () => {
    const PROFILES_STORAGE_KEY = 'em_profiles';
    const DEFAULT_ICON_PLACEHOLDER = '../../public/icons/svg/updatelogo.svg';
    const SETTINGS_KEY = 'automations_settings';
    const RULES_STORAGE_KEY = 'rules';

    const DEFAULT_SETTINGS = {
        confirmBeforeDelete: true,
        autoDisableConflicts: false,
        defaultTargetType: 'extension',
        defaultTriggerType: 'time'
    };

    // --- Global State ---
    let allRules = [];
    let allExtensions = [];
    let allProfiles = [];
    let currentActivePanelId = 'rules-list-panel';
    let selectedRuleIds = new Set();
    let currentFilters = { query: '', status: 'all', trigger: 'all', targetType: 'all' };
    let settings = { ...DEFAULT_SETTINGS };
    let searchDebounceTimer = null;
    let isRefreshing = false;
    let ruleElementsCache = new Map(); // Cache for DOM elements

    // --- DOM Element Cache ---
    const DOM = {};
    
    function cacheDOM() {
        const ids = [
            'rules-list-container', 'no-rules-placeholder', 'no-results-placeholder',
            'rule-search-input', 'select-all-rules', 'filter-btn',
            'filter-side-sheet', 'filter-sheet-overlay', 'close-filter-sheet',
            'apply-filters-btn', 'reset-filters-btn', 'filter-status-select',
            'filter-trigger-select', 'filter-target-type-select',
            'bulk-actions-bar', 'selected-rules-count', 'bulk-enable-btn',
            'bulk-disable-btn', 'bulk-delete-btn',
            'add-rule-panel', 'rule-form', 'form-panel-title', 'rule-id-input',
            'rule-name-input', 'rule-tags-input', 'rule-target-type-select',
            'target-selector-container', 'target-selector-label', 'rule-action-select',
            'trigger-type-select', 'time-condition-fields', 'url-condition-fields',
            'rule-time-input', 'rule-url-input',
            'step-1-next', 'step-2-back', 'step-2-next', 'step-3-back',
            'rule-name-error', 'target-selector-error', 'rule-action-error',
            'rule-time-error', 'day-selector-error', 'rule-url-error',
            'toast-container', 'back-to-rules-list', 'cancel-rule-form',
            'setting-confirm-delete', 'setting-auto-disable-conflicts',
            'setting-default-target-type', 'setting-default-trigger-type',
            'confirm-dialog-overlay', 'confirm-dialog-message', 'confirm-ok-btn', 'confirm-cancel-btn'
        ];
        
        ids.forEach(id => {
            DOM[id] = document.getElementById(id);
        });
        
        DOM.panels = document.querySelectorAll('.content-panel');
        DOM.navButtons = document.querySelectorAll('.sidebar-button');
        DOM.daySelector = document.querySelector('.day-selector');
        DOM.dayCheckboxes = document.querySelectorAll('.day-selector input');
    }

    // --- Utility Functions ---
    function sanitizeText(str) {
        if (str === null || typeof str === 'undefined') return '';
        const temp = document.createElement('div');
        temp.textContent = String(str);
        return temp.textContent;
    }

    const createElement = (tag, className, textContent) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (textContent !== undefined && textContent !== null) {
            element.textContent = textContent;
        }
        return element;
    };

    const createFragment = () => document.createDocumentFragment();

    // --- Settings Logic ---
    async function loadSettings() {
        try {
            const result = await chrome.storage.local.get(SETTINGS_KEY);
            const stored = result[SETTINGS_KEY] || {};
            settings = { ...DEFAULT_SETTINGS, ...stored };

            if (DOM['setting-confirm-delete']) DOM['setting-confirm-delete'].checked = settings.confirmBeforeDelete;
            if (DOM['setting-auto-disable-conflicts']) DOM['setting-auto-disable-conflicts'].checked = settings.autoDisableConflicts;
            if (DOM['setting-default-target-type']) DOM['setting-default-target-type'].value = settings.defaultTargetType;
            if (DOM['setting-default-trigger-type']) DOM['setting-default-trigger-type'].value = settings.defaultTriggerType;
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }

    async function saveSettings() {
        try {
            await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
            showToast('Settings saved.', 'success');
        } catch (e) {
            console.error('Failed to save settings:', e);
            showToast('Failed to save settings.', 'error');
        }
    }

    // --- Profile Loading (FIXED) ---
    async function loadProfiles() {
        try {
            const profilesData = await chrome.storage.local.get(PROFILES_STORAGE_KEY);
            const raw = profilesData[PROFILES_STORAGE_KEY];
            
            // popup.js stores: { profiles: { [id]: Profile }, order: string[] }
            // We need to extract the profiles object, not the wrapper
            if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.profiles) {
                allProfiles = Object.values(raw.profiles);
            } else {
                // Fallback: handle legacy format or empty storage
                allProfiles = [];
            }
            
            // Normalize and validate profiles
            allProfiles = allProfiles.filter(p => p && typeof p === 'object').map(p => ({
                id: p.id || '',
                name: typeof p.name === 'string' ? p.name : 'Unnamed',
                extensionStates: p.extensionStates || {},
                shortcut: p.shortcut || null,
                icons: p.icons || null
            }));
            
            allProfiles.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        } catch (e) {
            console.error('Failed to load profiles:', e);
            allProfiles = [];
        }
    }

    // --- Helper Functions for DOM Manipulation & Validation ---

    const createIconButton = (iconClass, buttonClass, ariaLabel) => {
        const button = createElement('button', `btn-icon ${buttonClass}`);
        button.setAttribute('aria-label', ariaLabel);
        button.type = 'button';
        const icon = createElement('span', `icon ${iconClass}`);
        button.appendChild(icon);
        return button;
    };

    const createToggleSwitch = (ruleId, isEnabled) => {
        const label = createElement('label', 'toggle-switch');
        label.setAttribute('aria-label', 'Enable or disable rule');
        const input = createElement('input');
        input.type = 'checkbox';
        input.checked = isEnabled;
        input.dataset.ruleId = ruleId;
        input.classList.add('toggle-rule-btn');
        input.setAttribute('role', 'switch');
        input.setAttribute('aria-checked', isEnabled);
        const slider = createElement('span', 'slider');
        label.appendChild(input);
        label.appendChild(slider);
        return label;
    };

    const createConditionElement = (iconClass, text) => {
        const condition = createElement('div', 'rule-condition');
        const icon = createElement('span', `icon ${iconClass}`);
        const textDiv = createElement('div', 'condition-text', sanitizeText(text));
        condition.appendChild(icon);
        condition.appendChild(textDiv);
        return condition;
    };

    /** Populates the target selector based on type. */
    const populateTargetSelector = (targetType, selectedIds = []) => {
        const container = DOM['target-selector-container'];
        container.textContent = '';
        let items = [];
        let labelText = '';

        switch (targetType) {
            case 'extension':
                items = allExtensions;
                labelText = 'Select Extensions';
                break;
            case 'profile':
                items = allProfiles;
                labelText = 'Select Profile (One only)';
                break;
        }

        if (items.length === 0) {
            const placeholder = createElement('p', 'placeholder-text', `No ${targetType}s found.`);
            placeholder.style.textAlign = 'center';
            placeholder.style.color = 'var(--color-text-secondary)';
            placeholder.style.padding = 'var(--space-4)';
            container.appendChild(placeholder);
            DOM['target-selector-label'].textContent = labelText + ' *';
            return;
        }

        const fragment = createFragment();
        items.forEach(item => {
            const id = item.id;
            const name = item.name || 'Unnamed';
            const itemImgSrc = item.icons && item.icons.length > 0 && item.icons[item.icons.length - 1].url
                               ? item.icons[item.icons.length - 1].url
                               : DEFAULT_ICON_PLACEHOLDER;

            const itemDiv = createElement('div', 'extension-selector-item');
            const input = createElement('input');
            input.type = targetType === 'profile' ? 'radio' : 'checkbox';
            input.name = 'target-item-selection';
            input.id = `target-sel-${id}`;
            input.value = id;
            if (selectedIds.includes(id)) {
                input.checked = true;
            }
            
            const label = createElement('label');
            label.htmlFor = input.id;
            
            const img = createElement('img');
            img.src = itemImgSrc;
            img.alt = `Icon for ${sanitizeText(name)}`;
            img.onerror = function() { this.src = DEFAULT_ICON_PLACEHOLDER; };

            label.appendChild(img);
            label.appendChild(createElement('span', null, sanitizeText(name)));
            itemDiv.appendChild(input);
            itemDiv.appendChild(label);
            fragment.appendChild(itemDiv);
        });
        
        container.appendChild(fragment);
        DOM['target-selector-label'].textContent = labelText + ' *';
    };

    /** Populates the action type select based on target type. */
    const populateActionTypeSelect = (targetType, selectedAction = 'enable') => {
        const select = DOM['rule-action-select'];
        select.textContent = '';
        let options = [];

        if (targetType === 'extension') {
            options = [
                { value: 'enable', text: 'Enable' },
                { value: 'disable', text: 'Disable' }
            ];
        } else if (targetType === 'profile') {
            options = [
                { value: 'apply', text: 'Apply Profile' }
            ];
        }

        options.forEach(optionData => {
            const option = createElement('option');
            option.value = optionData.value;
            option.textContent = optionData.text;
            if (optionData.value === selectedAction) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    };

    const showValidationError = (element, message) => {
        if (!element) return;
        element.textContent = message;
        element.setAttribute('role', 'alert');
        
        // Add visual invalid state to related input
        if (element.id === 'target-selector-error') {
            DOM['target-selector-container'].classList.add('invalid-border');
        } else if (element.id === 'day-selector-error') {
            if (DOM.daySelector) DOM.daySelector.style.borderColor = 'var(--color-danger)';
        } else {
            const prev = element.previousElementSibling;
            if (prev && (prev.tagName === 'INPUT' || prev.tagName === 'SELECT')) {
                prev.classList.add('invalid');
            }
        }
    };

    const clearValidationError = (element) => {
        if (!element) return;
        element.textContent = '';
        element.removeAttribute('role');
        
        if (element.id === 'target-selector-error') {
            DOM['target-selector-container'].classList.remove('invalid-border');
        } else if (element.id === 'day-selector-error') {
            if (DOM.daySelector) DOM.daySelector.style.borderColor = '';
        } else {
            const prev = element.previousElementSibling;
            if (prev && (prev.tagName === 'INPUT' || prev.tagName === 'SELECT')) {
                prev.classList.remove('invalid');
            }
        }
    };

    const clearAllValidationErrors = () => {
        [
            DOM['rule-name-error'], DOM['target-selector-error'], DOM['rule-action-error'],
            DOM['rule-time-error'], DOM['day-selector-error'], DOM['rule-url-error']
        ].forEach(clearValidationError);
        
        DOM['target-selector-container'].classList.remove('invalid-border');
        if (DOM.daySelector) DOM.daySelector.style.borderColor = '';
    };

    /** Custom confirmation dialog. Returns a Promise. */
    const showConfirmDialog = (message) => {
        return new Promise((resolve) => {
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
            okBtn.focus();

            const cleanup = (result) => {
                overlay.classList.remove('active');
                okBtn.removeEventListener('click', onConfirm);
                cancelBtn.removeEventListener('click', onCancel);
                document.removeEventListener('keydown', handleEsc);
                resolve(result);
            };

            const onConfirm = () => cleanup(true);
            const onCancel = () => cleanup(false);
            const handleEsc = (e) => {
                if (e.key === 'Escape') onCancel();
            };

            okBtn.addEventListener('click', onConfirm);
            cancelBtn.addEventListener('click', onCancel);
            document.addEventListener('keydown', handleEsc);
        });
    };

    // --- Stepper Logic ---
    let currentStep = 1;
    const totalSteps = 3;

    const showStep = (step) => {
        currentStep = step;
        document.querySelectorAll('.form-step').forEach((el, idx) => {
            const stepNum = idx + 1;
            el.classList.toggle('active', stepNum === step);
            el.classList.toggle('completed', stepNum < step);
        });
        document.querySelectorAll('.form-step-content').forEach(el => {
            const contentStep = parseInt(el.dataset.stepContent, 10);
            el.classList.toggle('active', contentStep === step);
        });
    };

    const validateStep = (step) => {
        if (step === 1) {
            const ruleName = DOM['rule-name-input'].value.trim();
            if (!ruleName) {
                showValidationError(DOM['rule-name-error'], 'Rule name is required.');
                return false;
            }
            const isNameTaken = allRules.some(r => 
                r.name.toLowerCase() === ruleName.toLowerCase() && r.id !== DOM['rule-id-input'].value);
            if (isNameTaken) {
                showValidationError(DOM['rule-name-error'], 'A rule with this name already exists.');
                return false;
            }
            clearValidationError(DOM['rule-name-error']);
            return true;
        }
        if (step === 2) {
            const selectedTargets = Array.from(DOM['target-selector-container'].querySelectorAll('input:checked')).map(cb => cb.value);
            if (selectedTargets.length === 0) {
                showValidationError(DOM['target-selector-error'], 'Please select at least one target.');
                return false;
            }
            if (DOM['rule-target-type-select'].value === 'profile' && selectedTargets.length > 1) {
                showValidationError(DOM['target-selector-error'], 'Please select only one profile.');
                return false;
            }
            clearValidationError(DOM['target-selector-error']);
            clearValidationError(DOM['rule-action-error']);
            return true;
        }
        if (step === 3) {
            if (DOM['trigger-type-select'].value === 'time') {
                if (!DOM['rule-time-input'].value) {
                    showValidationError(DOM['rule-time-error'], 'Please select a time.');
                    return false;
                }
                const days = Array.from(document.querySelectorAll('.day-selector input:checked')).map(cb => parseInt(cb.value, 10));
                if (days.length === 0) {
                    showValidationError(DOM['day-selector-error'], 'Please select at least one day.');
                    return false;
                }
                clearValidationError(DOM['rule-time-error']);
                clearValidationError(DOM['day-selector-error']);
                return true;
            } else {
                if (!DOM['rule-url-input'].value.trim()) {
                    showValidationError(DOM['rule-url-error'], 'URL cannot be empty.');
                    return false;
                }
                clearValidationError(DOM['rule-url-error']);
                return true;
            }
        }
        return true;
    };

    // --- Data & UI Management ---

    const refreshUI = async () => {
        if (isRefreshing) return;
        isRefreshing = true;
        
        try {
            // Load extensions
            if (chrome.management && chrome.management.getSelf) {
                const self = await chrome.management.getSelf();
                const extensions = await chrome.management.getAll();
                allExtensions = extensions.filter(ext => ext.type === 'extension' && ext.id !== self.id);
            }
            
            // Load profiles (FIXED)
            await loadProfiles();

            // Load rules
            const data = await chrome.storage.local.get(RULES_STORAGE_KEY);
            allRules = data[RULES_STORAGE_KEY] || [];
            
            applyFiltersAndRender();
            updateBulkActionBarVisibility();
            updateSelectAllCheckboxState();
        } catch (error) {
            console.error('Error initializing the page:', error);
            showToast('Error loading data. Please refresh.', 'error');
        } finally {
            isRefreshing = false;
        }
    };

    const applyFiltersAndRender = () => {
        const queryLower = currentFilters.query.toLowerCase();
        const filtered = allRules.filter(rule => {
            const searchMatch = !queryLower || 
                rule.name.toLowerCase().includes(queryLower) ||
                (rule.tags && rule.tags.some(tag => tag.toLowerCase().includes(queryLower)));
            const statusMatch = currentFilters.status === 'all' || 
                (currentFilters.status === 'enabled' && rule.enabled) || 
                (currentFilters.status === 'disabled' && !rule.enabled);
            const triggerMatch = currentFilters.trigger === 'all' || rule.trigger.type === currentFilters.trigger;
            const targetTypeMatch = currentFilters.targetType === 'all' || rule.targetType === currentFilters.targetType;

            return searchMatch && statusMatch && triggerMatch && targetTypeMatch;
        });
        renderRules(filtered);
    };
    
    const renderRules = (rulesToRender) => {
        const container = DOM['rules-list-container'];
        const hasRules = allRules.length > 0;
        
        DOM['no-rules-placeholder'].style.display = !hasRules ? 'block' : 'none';
        
        if (!hasRules) {
            DOM['no-rules-placeholder'].textContent = '';
            DOM['no-rules-placeholder'].appendChild(createElement('span', 'icon icon-list'));
            DOM['no-rules-placeholder'].appendChild(createElement('h3', null, 'No Automation Rules Found'));
            DOM['no-rules-placeholder'].appendChild(createElement('p', null, 'Use the sidebar to "Add New Rule" and get started.'));
            const learnMoreLink = createElement('a', null, 'Learn more about Automation Rules...');
            learnMoreLink.href = 'https://sites.google.com/view/modcore-em-help/manage-extensions/rules-page';
            learnMoreLink.target = '_blank';
            learnMoreLink.rel = 'noopener noreferrer';
            learnMoreLink.style.display = 'block';
            learnMoreLink.style.marginTop = '12px';
            DOM['no-rules-placeholder'].appendChild(learnMoreLink);
            container.textContent = '';
            ruleElementsCache.clear();
            updateSelectAllCheckboxState();
            return;
        }

        // Use a DocumentFragment for batch DOM updates
        const fragment = createFragment();
        const newCache = new Map();
        
        rulesToRender.forEach(rule => {
            const existingElement = ruleElementsCache.get(rule.id);
            const newElement = createRuleElement(rule);
            
            if (existingElement && existingElement.isConnected) {
                // Efficient replacement
                existingElement.replaceWith(newElement);
            } else {
                fragment.appendChild(newElement);
            }
            newCache.set(rule.id, newElement);
        });
        
        // Remove elements for rules that are no longer rendered
        ruleElementsCache.forEach((element, ruleId) => {
            if (!newCache.has(ruleId) && element.isConnected) {
                element.remove();
            }
        });
        
        // Append new elements
        if (fragment.childNodes.length > 0) {
            container.appendChild(fragment);
        }
        
        ruleElementsCache = newCache;
        
        const hasResults = container.children.length > 0;
        DOM['no-results-placeholder'].style.display = hasRules && !hasResults ? 'block' : 'none';
        
        if (hasRules && !hasResults) {
            DOM['no-results-placeholder'].textContent = '';
            DOM['no-results-placeholder'].appendChild(createElement('span', 'icon icon-search'));
            DOM['no-results-placeholder'].appendChild(createElement('h3', null, 'No Rules Match Your Search'));
            DOM['no-results-placeholder'].appendChild(createElement('p', null, 'Try searching for a different name or adjusting your filters.'));
        }

        updateSelectAllCheckboxState();
    };
    
    const createRuleElement = (rule) => {
        const tr = createElement('tr', 'rule-row');
        tr.dataset.ruleId = rule.id;
        if (selectedRuleIds.has(rule.id)) {
            tr.classList.add('selected');
        }

        // Checkbox cell
        const tdSelect = createElement('td', 'col-select');
        const checkbox = createElement('input', 'rule-select-checkbox');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedRuleIds.has(rule.id);
        checkbox.setAttribute('aria-label', `Select rule ${sanitizeText(rule.name)}`);
        tdSelect.appendChild(checkbox);

        // Name cell
        const tdName = createElement('td', 'col-name');
        const nameDiv = createElement('div', 'rule-name-cell');
        const nameText = createElement('span', 'rule-name-text', sanitizeText(rule.name));
        nameDiv.appendChild(nameText);
        
        if (rule.tags && rule.tags.length > 0) {
            const tagsDiv = createElement('div', 'tags-container');
            rule.tags.forEach(tagText => {
                tagsDiv.appendChild(createElement('span', 'tag', sanitizeText(tagText)));
            });
            nameDiv.appendChild(tagsDiv);
        }
        tdName.appendChild(nameDiv);

        // Trigger cell
        const tdTrigger = createElement('td', 'col-trigger');
        if (rule.trigger.type === 'time') {
            const days = rule.trigger.days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ');
            tdTrigger.appendChild(createConditionElement('icon-clock', `${rule.trigger.time} — ${days}`));
        } else {
            tdTrigger.appendChild(createConditionElement('icon-url', rule.trigger.url));
        }

        // Targets cell
        const tdTargets = createElement('td', 'col-targets');
        let targetsText = '';
        if (rule.targetType === 'extension') {
            const names = allExtensions.filter(ext => rule.targetIds.includes(ext.id)).map(ext => ext.name);
            targetsText = names.join(', ') || 'None';
        } else if (rule.targetType === 'profile') {
            const profile = allProfiles.find(p => p.id === rule.targetIds[0]);
            targetsText = profile ? sanitizeText(profile.name) : 'Unknown';
        }
        tdTargets.textContent = targetsText;
        tdTargets.title = targetsText;

        // Status cell
        const tdStatus = createElement('td', 'col-status');
        tdStatus.appendChild(createToggleSwitch(rule.id, rule.enabled));

        // Actions cell
        const tdActions = createElement('td', 'col-actions');
        const editBtn = createIconButton('icon-edit', 'edit-rule-btn', `Edit ${sanitizeText(rule.name)}`);
        const deleteBtn = createIconButton('icon-trash', 'delete-rule-btn', `Delete ${sanitizeText(rule.name)}`);
        tdActions.appendChild(editBtn);
        tdActions.appendChild(deleteBtn);

        tr.appendChild(tdSelect);
        tr.appendChild(tdName);
        tr.appendChild(tdTrigger);
        tr.appendChild(tdTargets);
        tr.appendChild(tdStatus);
        tr.appendChild(tdActions);
        return tr;
    };

    const findConflictingRules = (newRule) => {
        const relevantRules = allRules.filter(r => r.enabled && r.id !== newRule.id);
        const conflicts = [];
        
        for (const existingRule of relevantRules) {
            let triggersOverlap = false;
            if (newRule.trigger.type === 'time' && existingRule.trigger.type === 'time') {
                if (newRule.trigger.time === existingRule.trigger.time) {
                    const commonDays = newRule.trigger.days.filter(day => existingRule.trigger.days.includes(day));
                    if (commonDays.length > 0) triggersOverlap = true;
                }
            } else if (newRule.trigger.type === 'url' && existingRule.trigger.type === 'url') {
                const newUrl = newRule.trigger.url.toLowerCase();
                const existingUrl = existingRule.trigger.url.toLowerCase();
                if (newUrl.includes(existingUrl) || existingUrl.includes(newUrl)) triggersOverlap = true;
            }
            
            if (!triggersOverlap) continue;
            
            let hasConflict = false;
            if (newRule.targetType === existingRule.targetType) {
                const commonTargets = newRule.targetIds.filter(id => existingRule.targetIds.includes(id));
                if (commonTargets.length > 0) {
                    if (newRule.targetType === 'extension' && newRule.action !== existingRule.action) {
                        hasConflict = true;
                    } else if (newRule.targetType === 'profile' && newRule.action === 'apply' && existingRule.action === 'apply') {
                        hasConflict = true;
                    }
                }
            }
            
            if (hasConflict) conflicts.push(existingRule);
        }
        return conflicts;
    };

    // --- Bulk Action Logic (ENHANCED) ---

    const toggleRuleSelection = (ruleId, isChecked) => {
        if (isChecked) {
            selectedRuleIds.add(ruleId);
        } else {
            selectedRuleIds.delete(ruleId);
        }
        const ruleRowElement = document.querySelector(`tr[data-rule-id="${ruleId}"]`);
        if (ruleRowElement) {
            ruleRowElement.classList.toggle('selected', isChecked);
        }
        updateBulkActionBarVisibility();
        updateSelectAllCheckboxState();
    };

    const updateBulkActionBarVisibility = () => {
        const count = selectedRuleIds.size;
        const bar = DOM['bulk-actions-bar'];
        const countSpan = DOM['selected-rules-count'];
        
        if (countSpan) countSpan.textContent = `${count} selected`;
        
        if (count > 0) {
            bar.style.display = 'flex';
            requestAnimationFrame(() => bar.classList.add('active'));
        } else {
            bar.classList.remove('active');
            // Use transitionend for smooth hide
            const onTransitionEnd = () => {
                if (!bar.classList.contains('active')) {
                    bar.style.display = 'none';
                }
                bar.removeEventListener('transitionend', onTransitionEnd);
            };
            bar.addEventListener('transitionend', onTransitionEnd);
        }
    };

    const updateSelectAllCheckboxState = () => {
        const checkbox = DOM['select-all-rules'];
        const visibleRuleIds = Array.from(DOM['rules-list-container'].querySelectorAll('tr[data-rule-id]')).map(el => el.dataset.ruleId);
        
        if (visibleRuleIds.length === 0) {
            checkbox.checked = false;
            checkbox.indeterminate = false;
            checkbox.disabled = true;
            return;
        }
        
        checkbox.disabled = false;
        const allVisibleSelected = visibleRuleIds.every(id => selectedRuleIds.has(id));
        const someVisibleSelected = visibleRuleIds.some(id => selectedRuleIds.has(id));
        
        checkbox.checked = allVisibleSelected;
        checkbox.indeterminate = someVisibleSelected && !allVisibleSelected;
    };

    const handleSelectAllChange = (isChecked) => {
        const visibleRuleCheckboxes = document.querySelectorAll('#rules-list-container .rule-select-checkbox');
        visibleRuleCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
            const ruleId = checkbox.closest('tr')?.dataset.ruleId;
            if (ruleId) toggleRuleSelection(ruleId, isChecked);
        });
    };

    const bulkDeleteSelected = async () => {
        if (selectedRuleIds.size === 0) {
            showToast('No rules selected for deletion.', 'info');
            return;
        }
        if (settings.confirmBeforeDelete) {
            const confirmed = await showConfirmDialog(`Are you sure you want to delete ${selectedRuleIds.size} selected rule(s)?`);
            if (!confirmed) return;
        }

        const updatedRules = allRules.filter(r => !selectedRuleIds.has(r.id));
        const deletedCount = selectedRuleIds.size;
        selectedRuleIds.clear();
        
        chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updatedRules }, () => {
            refreshUI();
            showToast(`${deletedCount} rule(s) deleted.`, 'success');
        });
    };

    const bulkToggleSelected = async (enable) => {
        if (selectedRuleIds.size === 0) {
            showToast(`No rules selected to ${enable ? 'enable' : 'disable'}.`, 'info');
            return;
        }

        const actionText = enable ? 'enable' : 'disable';
        const confirmed = await showConfirmDialog(`Are you sure you want to ${actionText} ${selectedRuleIds.size} selected rule(s)?`);
        
        if (confirmed) {
            const updatedRules = allRules.map(rule => {
                if (selectedRuleIds.has(rule.id)) {
                    return { ...rule, enabled: enable };
                }
                return rule;
            });
            const affectedCount = selectedRuleIds.size;
            selectedRuleIds.clear();
            
            chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updatedRules }, () => {
                refreshUI();
                showToast(`${affectedCount} rule(s) ${actionText}d.`, 'success');
            });
        }
    };

    // --- Event Handlers ---

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        
        if (!validateStep(1) || !validateStep(2) || !validateStep(3)) {
            if (!validateStep(1)) showStep(1);
            else if (!validateStep(2)) showStep(2);
            else showStep(3);
            showToast('Please correct the errors in the form.', 'error');
            return;
        }

        const selectedTargetType = DOM['rule-target-type-select'].value;
        const selectedTargetIds = Array.from(DOM['target-selector-container'].querySelectorAll('input:checked')).map(cb => cb.value);

        const ruleData = {
            id: DOM['rule-id-input'].value || `rule_${Date.now()}`,
            name: DOM['rule-name-input'].value.trim(),
            tags: DOM['rule-tags-input'].value.split(',').map(tag => tag.trim()).filter(Boolean),
            targetType: selectedTargetType,
            targetIds: selectedTargetIds,
            action: DOM['rule-action-select'].value,
            trigger: { type: DOM['trigger-type-select'].value },
            enabled: allRules.find(r => r.id === DOM['rule-id-input'].value)?.enabled ?? true,
        };
        
        if (ruleData.trigger.type === 'time') {
            const selectedDays = Array.from(document.querySelectorAll('.day-selector input:checked')).map(cb => parseInt(cb.value, 10));
            ruleData.trigger.time = DOM['rule-time-input'].value;
            ruleData.trigger.days = selectedDays;
        } else {
            ruleData.trigger.url = DOM['rule-url-input'].value.trim();
        }
        
        const conflicts = findConflictingRules(ruleData);
        if (conflicts.length > 0) {
            if (settings.autoDisableConflicts) {
                conflicts.forEach(r => {
                    const idx = allRules.findIndex(rule => rule.id === r.id);
                    if (idx !== -1) allRules[idx].enabled = false;
                });
                showToast(`Auto-disabled ${conflicts.length} conflicting rule(s).`, 'info');
            } else {
                const names = conflicts.map(r => `"${sanitizeText(r.name)}"`).join(', ');
                showToast(`Conflicts with: ${names}. Disable them or enable auto-disable in Settings.`, 'error');
                return;
            }
        }

        const existingRuleIndex = allRules.findIndex(r => r.id === ruleData.id);
        let updatedRules;
        if (existingRuleIndex > -1) {
            updatedRules = [...allRules];
            updatedRules[existingRuleIndex] = ruleData;
        } else {
            updatedRules = [...allRules, ruleData];
        }

        chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updatedRules }, () => {
            refreshUI();
            showToast('Rule saved successfully!', 'success');
            setActivePanel('rules-list-panel');
        });
    };
    
    const handleRulesListClick = async (e) => {
        const ruleRow = e.target.closest('tr[data-rule-id]');
        if (!ruleRow) return;
        const ruleId = ruleRow.dataset.ruleId;

        if (e.target.closest('.edit-rule-btn')) {
            const ruleToEdit = allRules.find(r => r.id === ruleId);
            if (ruleToEdit) showRuleForm(ruleToEdit);
        } 
        else if (e.target.closest('.delete-rule-btn')) {
            const ruleToDelete = allRules.find(r => r.id === ruleId);
            if (!ruleToDelete) return;
            
            if (settings.confirmBeforeDelete) {
                const confirmed = await showConfirmDialog(`Are you sure you want to delete the rule "${sanitizeText(ruleToDelete.name)}"?`);
                if (!confirmed) return;
            }
            
            const updatedRules = allRules.filter(r => r.id !== ruleId);
            selectedRuleIds.delete(ruleId);
            chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updatedRules }, () => {
                refreshUI();
                showToast('Rule deleted.', 'success');
            });
        }
        else if (e.target.classList.contains('toggle-rule-btn')) {
            const toggleInput = e.target;
            const ruleToToggle = allRules.find(r => r.id === ruleId);
            if (ruleToToggle) {
                ruleToToggle.enabled = toggleInput.checked;
                toggleInput.setAttribute('aria-checked', toggleInput.checked);
                chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: allRules }, () => {
                    refreshUI();
                    showToast(`Rule "${sanitizeText(ruleToToggle.name)}" ${ruleToToggle.enabled ? 'enabled' : 'disabled'}.`, 'success');
                });
            }
        }
        else if (e.target.classList.contains('rule-select-checkbox')) {
            toggleRuleSelection(ruleId, e.target.checked);
        }
    };

    const handleSearchInput = () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            currentFilters.query = DOM['rule-search-input'].value;
            applyFiltersAndRender();
        }, 150);
    };

    const handleTargetTypeChange = () => {
        const selectedType = DOM['rule-target-type-select'].value;
        populateTargetSelector(selectedType);
        populateActionTypeSelect(selectedType);
        clearValidationError(DOM['target-selector-error']);
        clearValidationError(DOM['rule-action-error']);
    };

    const handleTriggerTypeChange = () => {
        const isTime = DOM['trigger-type-select'].value === 'time';
        DOM['time-condition-fields'].style.display = isTime ? 'block' : 'none';
        DOM['url-condition-fields'].style.display = isTime ? 'none' : 'block';
        clearAllValidationErrors();
    };

    // Filter Side Sheet
    const openFilterSheet = () => DOM['filter-side-sheet'].classList.add('active');
    const closeFilterSheet = () => DOM['filter-side-sheet'].classList.remove('active');

    const handleApplyFilters = () => {
        currentFilters.status = DOM['filter-status-select'].value;
        currentFilters.trigger = DOM['filter-trigger-select'].value;
        currentFilters.targetType = DOM['filter-target-type-select'].value;
        applyFiltersAndRender();
        closeFilterSheet();
    };

    const handleResetFilters = () => {
        DOM['filter-status-select'].value = 'all';
        DOM['filter-trigger-select'].value = 'all';
        DOM['filter-target-type-select'].value = 'all';
        currentFilters = { query: currentFilters.query, status: 'all', trigger: 'all', targetType: 'all' };
        applyFiltersAndRender();
    };

    // --- Panel Navigation Logic ---

    const setActivePanel = (panelId) => {
        DOM.panels.forEach(panel => {
            panel.classList.remove('active');
            panel.setAttribute('aria-hidden', 'true');
        });
        DOM.navButtons.forEach(btn => btn.classList.remove('active'));

        const targetPanel = document.getElementById(panelId);
        if (targetPanel) {
            targetPanel.classList.add('active');
            targetPanel.setAttribute('aria-hidden', 'false');
            currentActivePanelId = panelId;

            const navButton = document.querySelector(`[aria-controls="${panelId}"]`);
            if (navButton) navButton.classList.add('active');
        }

        if (panelId === 'rules-list-panel') {
            DOM['rule-search-input']?.focus();
            selectedRuleIds.clear();
            updateBulkActionBarVisibility();
        } else if (panelId === 'add-rule-panel') {
            DOM['rule-name-input']?.focus();
        }
    };

    const showRuleForm = (ruleToEdit = null) => {
        DOM['rule-form'].reset();
        clearAllValidationErrors();
        showStep(1);
        
        DOM['time-condition-fields'].style.display = 'block';
        DOM['url-condition-fields'].style.display = 'none';
        
        DOM['target-selector-container'].textContent = '';
        DOM.dayCheckboxes.forEach(cb => cb.checked = false);

        if (ruleToEdit) {
            DOM['form-panel-title'].textContent = 'Edit Rule';
            DOM['rule-id-input'].value = ruleToEdit.id;
            DOM['rule-name-input'].value = ruleToEdit.name;
            DOM['rule-tags-input'].value = (ruleToEdit.tags || []).map(tag => sanitizeText(tag)).join(', ');
            
            DOM['rule-target-type-select'].value = ruleToEdit.targetType;
            populateTargetSelector(ruleToEdit.targetType, ruleToEdit.targetIds);
            populateActionTypeSelect(ruleToEdit.targetType, ruleToEdit.action);
            DOM['rule-action-select'].value = ruleToEdit.action;

            DOM['trigger-type-select'].value = ruleToEdit.trigger.type;
            
            if (ruleToEdit.trigger.type === 'time') {
                DOM['rule-time-input'].value = ruleToEdit.trigger.time;
                ruleToEdit.trigger.days.forEach(day => {
                    const checkbox = document.querySelector(`.day-selector input[value="${day}"]`);
                    if (checkbox) checkbox.checked = true;
                });
            } else {
                DOM['rule-url-input'].value = ruleToEdit.trigger.url;
            }
        } else {
            DOM['form-panel-title'].textContent = 'Create New Rule';
            DOM['rule-id-input'].value = '';
            DOM['rule-tags-input'].value = '';
            
            DOM['rule-target-type-select'].value = settings.defaultTargetType;
            populateTargetSelector(settings.defaultTargetType);
            populateActionTypeSelect(settings.defaultTargetType);
            
            DOM['trigger-type-select'].value = settings.defaultTriggerType;
        }
        
        handleTriggerTypeChange();
        handleTargetTypeChange();
        setActivePanel('add-rule-panel');
        DOM['rule-name-input']?.focus();
    };

    // --- Toast Notification ---
    const showToast = (message, type = 'info') => {
        const container = DOM['toast-container'];
        if (!container) return;
        
        const toast = createElement('div', `toast ${type}`, message);
        container.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show')); 
        
        const timer = setTimeout(() => {
            toast.classList.remove('show');
            const onTransitionEnd = () => {
                toast.remove();
                toast.removeEventListener('transitionend', onTransitionEnd);
            };
            toast.addEventListener('transitionend', onTransitionEnd);
        }, 3000);
        
        // Store timer for potential early dismissal
        toast._dismissTimer = timer;
    };

    // --- Initialization & Event Wiring ---
    
    function initEventListeners() {
        // Navigation
        DOM.navButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                if (button.tagName === 'A') return;
                const panelId = button.getAttribute('aria-controls');
                if (!panelId) return;
                if (panelId === 'add-rule-panel') showRuleForm();
                else setActivePanel(panelId);
            });
        });

        DOM['back-to-rules-list']?.addEventListener('click', () => setActivePanel('rules-list-panel'));
        DOM['cancel-rule-form']?.addEventListener('click', () => setActivePanel('rules-list-panel'));
        DOM['rule-form']?.addEventListener('submit', handleFormSubmit);

        // Stepper
        DOM['step-1-next']?.addEventListener('click', () => { if (validateStep(1)) showStep(2); });
        DOM['step-2-back']?.addEventListener('click', () => showStep(1));
        DOM['step-2-next']?.addEventListener('click', () => { if (validateStep(2)) showStep(3); });
        DOM['step-3-back']?.addEventListener('click', () => showStep(2));

        // Search & Filters
        DOM['rule-search-input']?.addEventListener('input', handleSearchInput);
        DOM['rule-target-type-select']?.addEventListener('change', handleTargetTypeChange);
        DOM['trigger-type-select']?.addEventListener('change', handleTriggerTypeChange);

        // Filter Sheet
        DOM['filter-btn']?.addEventListener('click', openFilterSheet);
        DOM['close-filter-sheet']?.addEventListener('click', closeFilterSheet);
        DOM['filter-sheet-overlay']?.addEventListener('click', closeFilterSheet);
        DOM['apply-filters-btn']?.addEventListener('click', handleApplyFilters);
        DOM['reset-filters-btn']?.addEventListener('click', handleResetFilters);

        // Bulk Actions
        DOM['select-all-rules']?.addEventListener('change', (e) => handleSelectAllChange(e.target.checked));
        DOM['bulk-enable-btn']?.addEventListener('click', () => bulkToggleSelected(true));
        DOM['bulk-disable-btn']?.addEventListener('click', () => bulkToggleSelected(false));
        DOM['bulk-delete-btn']?.addEventListener('click', bulkDeleteSelected);

        // Rules list delegation
        DOM['rules-list-container']?.addEventListener('click', handleRulesListClick);

        // Settings
        DOM['setting-confirm-delete']?.addEventListener('change', (e) => {
            settings.confirmBeforeDelete = e.target.checked;
            saveSettings();
        });
        DOM['setting-auto-disable-conflicts']?.addEventListener('change', (e) => {
            settings.autoDisableConflicts = e.target.checked;
            saveSettings();
        });
        DOM['setting-default-target-type']?.addEventListener('change', (e) => {
            settings.defaultTargetType = e.target.value;
            saveSettings();
        });
        DOM['setting-default-trigger-type']?.addEventListener('change', (e) => {
            settings.defaultTriggerType = e.target.value;
            saveSettings();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === '/' && currentActivePanelId === 'rules-list-panel') {
                e.preventDefault(); 
                DOM['rule-search-input']?.focus();
            } 
            else if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault(); 
                showRuleForm();
            }
            else if ((e.ctrlKey || e.metaKey) && e.key === 's' && currentActivePanelId === 'add-rule-panel') {
                e.preventDefault();
                DOM['rule-form']?.requestSubmit();
            }
        });
    }

    // --- Main Initialization ---
    cacheDOM();
    initEventListeners();
    await loadSettings();
    await refreshUI();
    setActivePanel('rules-list-panel');
});