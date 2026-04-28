document.addEventListener('DOMContentLoaded', async () => {
    const PROFILES_STORAGE_KEY = 'extensionManagerProfiles_v2';
    const DEFAULT_ICON_PLACEHOLDER = '../../public/icons/svg/updatelogo.svg';
    const SETTINGS_KEY = 'automationsSettings';

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

    // --- DOM Element Selection ---
    const rulesListContainer = document.getElementById('rules-list-container');
    const noRulesPlaceholder = document.getElementById('no-rules-placeholder');
    const noResultsPlaceholder = document.getElementById('no-results-placeholder');
    const ruleSearchInput = document.getElementById('rule-search-input');
    const selectAllRulesCheckbox = document.getElementById('select-all-rules');
    const filterBtn = document.getElementById('filter-btn');

    // Filter Side Sheet
    const filterSideSheet = document.getElementById('filter-side-sheet');
    const filterSheetOverlay = document.getElementById('filter-sheet-overlay');
    const closeFilterSheetBtn = document.getElementById('close-filter-sheet');
    const applyFiltersBtn = document.getElementById('apply-filters-btn');
    const resetFiltersBtn = document.getElementById('reset-filters-btn');
    const filterStatusSelect = document.getElementById('filter-status-select');
    const filterTriggerSelect = document.getElementById('filter-trigger-select');
    const filterTargetTypeSelect = document.getElementById('filter-target-type-select');

    // Bulk Actions Bar elements
    const bulkActionsBar = document.getElementById('bulk-actions-bar');
    const selectedRulesCountSpan = document.getElementById('selected-rules-count');
    const bulkEnableBtn = document.getElementById('bulk-enable-btn');
    const bulkDisableBtn = document.getElementById('bulk-disable-btn');
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');

    // Add Rule Panel elements
    const addRulePanel = document.getElementById('add-rule-panel');
    const ruleForm = document.getElementById('rule-form');
    const formPanelTitle = document.getElementById('form-panel-title');
    const ruleIdInput = document.getElementById('rule-id-input');
    const ruleNameInput = document.getElementById('rule-name-input');
    const ruleTagsInput = document.getElementById('rule-tags-input');
    const ruleTargetTypeSelect = document.getElementById('rule-target-type-select');
    const targetSelectorContainer = document.getElementById('target-selector-container');
    const targetSelectorLabel = document.getElementById('target-selector-label');
    const ruleActionSelect = document.getElementById('rule-action-select');
    const triggerTypeSelect = document.getElementById('trigger-type-select');
    const timeConditionFields = document.getElementById('time-condition-fields');
    const urlConditionFields = document.getElementById('url-condition-fields');
    const ruleTimeInput = document.getElementById('rule-time-input');
    const ruleUrlInput = document.getElementById('rule-url-input');

    // Stepper buttons
    const step1Next = document.getElementById('step-1-next');
    const step2Back = document.getElementById('step-2-back');
    const step2Next = document.getElementById('step-2-next');
    const step3Back = document.getElementById('step-3-back');

    // Error message elements
    const ruleNameError = document.getElementById('rule-name-error');
    const targetSelectorError = document.getElementById('target-selector-error');
    const ruleActionError = document.getElementById('rule-action-error');
    const ruleTimeError = document.getElementById('rule-time-error');
    const daySelectorError = document.getElementById('day-selector-error');
    const ruleUrlError = document.getElementById('rule-url-error');

    const toastContainer = document.getElementById('toast-container');
    const panels = document.querySelectorAll('.content-panel');
    const navButtons = document.querySelectorAll('.sidebar-button');
    const backToRulesListBtn = document.getElementById('back-to-rules-list');
    const cancelRuleFormBtn = document.getElementById('cancel-rule-form');

    // Settings elements
    const settingConfirmDelete = document.getElementById('setting-confirm-delete');
    const settingAutoDisableConflicts = document.getElementById('setting-auto-disable-conflicts');
    const settingDefaultTargetType = document.getElementById('setting-default-target-type');
    const settingDefaultTriggerType = document.getElementById('setting-default-trigger-type');

    // Custom Confirmation Dialog Elements
    const confirmDialogOverlay = document.getElementById('confirm-dialog-overlay');
    const confirmDialogMessage = document.getElementById('confirm-dialog-message');
    const confirmOkBtn = document.getElementById('confirm-ok-btn');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

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
        if (textContent) element.textContent = textContent;
        return element;
    };

    // --- Settings Logic ---
    async function loadSettings() {
        try {
            const result = await chrome.storage.local.get(SETTINGS_KEY);
            const stored = result[SETTINGS_KEY] || {};
            settings = { ...DEFAULT_SETTINGS, ...stored };

            settingConfirmDelete.checked = settings.confirmBeforeDelete;
            settingAutoDisableConflicts.checked = settings.autoDisableConflicts;
            settingDefaultTargetType.value = settings.defaultTargetType;
            settingDefaultTriggerType.value = settings.defaultTriggerType;
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

    settingConfirmDelete.addEventListener('change', (e) => {
        settings.confirmBeforeDelete = e.target.checked;
        saveSettings();
    });
    settingAutoDisableConflicts.addEventListener('change', (e) => {
        settings.autoDisableConflicts = e.target.checked;
        saveSettings();
    });
    settingDefaultTargetType.addEventListener('change', (e) => {
        settings.defaultTargetType = e.target.value;
        saveSettings();
    });
    settingDefaultTriggerType.addEventListener('change', (e) => {
        settings.defaultTriggerType = e.target.value;
        saveSettings();
    });

    // --- Helper Functions for DOM Manipulation & Validation ---

    const createIconButton = (iconClass, buttonClass, ariaLabel) => {
        const button = createElement('button', `btn-icon ${buttonClass}`);
        button.setAttribute('aria-label', ariaLabel);
        button.type = 'button';
        button.appendChild(createElement('span', `icon ${iconClass}`));
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
        label.append(input, slider);
        return label;
    };

    const createConditionElement = (iconClass, text) => {
        const condition = createElement('div', 'rule-condition');
        const icon = createElement('span', `icon ${iconClass}`);
        const textDiv = createElement('div', 'condition-text', sanitizeText(text));
        condition.append(icon, textDiv);
        return condition;
    };

    /** Populates the target selector based on type. */
    const populateTargetSelector = (targetType, selectedIds = []) => {
        targetSelectorContainer.textContent = '';
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
            targetSelectorContainer.appendChild(placeholder);
            return;
        }

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

            label.append(img, createElement('span', null, sanitizeText(name)));
            itemDiv.append(input, label);
            targetSelectorContainer.appendChild(itemDiv);
        });
        targetSelectorLabel.textContent = labelText + ' *';
    };

    /** Populates the action type select based on target type. */
    const populateActionTypeSelect = (targetType, selectedAction = 'enable') => {
        while (ruleActionSelect.firstChild) {
            ruleActionSelect.removeChild(ruleActionSelect.firstChild);
        }
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
            ruleActionSelect.appendChild(option);
        });
    };

    const showValidationError = (element, message) => {
        element.textContent = message;
        const prev = element.previousElementSibling;
        if (prev && (prev.tagName === 'INPUT' || prev.tagName === 'SELECT')) {
            prev.classList.add('invalid');
        } else if (element.id === 'target-selector-error') {
            targetSelectorContainer.classList.add('invalid-border');
        } else if (element.id === 'day-selector-error') {
            // day selector container is the div, previous is the label
            const daySelector = document.querySelector('.day-selector');
            if (daySelector) daySelector.style.borderColor = 'var(--color-danger)';
        }
        element.setAttribute('role', 'alert');
    };

    const clearValidationError = (element) => {
        element.textContent = '';
        const prev = element.previousElementSibling;
        if (prev && (prev.tagName === 'INPUT' || prev.tagName === 'SELECT')) {
            prev.classList.remove('invalid');
        } else if (element.id === 'target-selector-error') {
            targetSelectorContainer.classList.remove('invalid-border');
        } else if (element.id === 'day-selector-error') {
            const daySelector = document.querySelector('.day-selector');
            if (daySelector) daySelector.style.borderColor = '';
        }
        element.removeAttribute('role');
    };

    const clearAllValidationErrors = () => {
        [ruleNameError, targetSelectorError, ruleActionError, ruleTimeError, daySelectorError, ruleUrlError].forEach(clearValidationError);
        targetSelectorContainer.classList.remove('invalid-border');
        const daySelector = document.querySelector('.day-selector');
        if (daySelector) daySelector.style.borderColor = '';
    };

    /** Custom confirmation dialog. Returns a Promise. */
    const showConfirmDialog = (message) => {
        return new Promise((resolve) => {
            confirmDialogMessage.textContent = message;
            confirmDialogOverlay.classList.add('active');
            confirmOkBtn.focus();

            const onConfirm = () => cleanup(true);
            const onCancel = () => cleanup(false);

            const cleanup = (result) => {
                confirmDialogOverlay.classList.remove('active');
                confirmOkBtn.removeEventListener('click', onConfirm);
                confirmCancelBtn.removeEventListener('click', onCancel);
                document.removeEventListener('keydown', handleEsc);
                resolve(result);
            };

            const handleEsc = (e) => {
                if (e.key === 'Escape') onCancel();
            };

            confirmOkBtn.addEventListener('click', onConfirm);
            confirmCancelBtn.addEventListener('click', onCancel);
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
            const ruleName = ruleNameInput.value.trim();
            if (!ruleName) {
                showValidationError(ruleNameError, 'Rule name is required.');
                return false;
            }
            const isNameTaken = allRules.some(r => 
                sanitizeText(r.name).toLowerCase() === sanitizeText(ruleName).toLowerCase() && r.id !== ruleIdInput.value);
            if (isNameTaken) {
                showValidationError(ruleNameError, 'A rule with this name already exists.');
                return false;
            }
            clearValidationError(ruleNameError);
            return true;
        }
        if (step === 2) {
            const selectedTargets = Array.from(targetSelectorContainer.querySelectorAll('input:checked')).map(cb => cb.value);
            if (selectedTargets.length === 0) {
                showValidationError(targetSelectorError, 'Please select at least one target.');
                return false;
            }
            if (ruleTargetTypeSelect.value === 'profile' && selectedTargets.length > 1) {
                showValidationError(targetSelectorError, 'Please select only one profile.');
                return false;
            }
            clearValidationError(targetSelectorError);
            clearValidationError(ruleActionError);
            return true;
        }
        if (step === 3) {
            if (triggerTypeSelect.value === 'time') {
                if (!ruleTimeInput.value) {
                    showValidationError(ruleTimeError, 'Please select a time.');
                    return false;
                }
                const days = Array.from(document.querySelectorAll('.day-selector input:checked')).map(cb => parseInt(cb.value, 10));
                if (days.length === 0) {
                    showValidationError(daySelectorError, 'Please select at least one day.');
                    return false;
                }
                clearValidationError(ruleTimeError);
                clearValidationError(daySelectorError);
                return true;
            } else {
                if (!ruleUrlInput.value.trim()) {
                    showValidationError(ruleUrlError, 'URL cannot be empty.');
                    return false;
                }
                clearValidationError(ruleUrlError);
                return true;
            }
        }
        return true;
    };

    step1Next.addEventListener('click', () => {
        if (validateStep(1)) showStep(2);
    });
    step2Back.addEventListener('click', () => showStep(1));
    step2Next.addEventListener('click', () => {
        if (validateStep(2)) showStep(3);
    });
    step3Back.addEventListener('click', () => showStep(2));

    // --- Data & UI Management ---

    const refreshUI = async () => {
        try {
            if (chrome.management && chrome.management.getSelf) {
                const self = await chrome.management.getSelf();
                const extensions = await chrome.management.getAll();
                allExtensions = extensions.filter(ext => ext.type === 'extension' && ext.id !== self.id);
            }
            
            const profilesData = await chrome.storage.local.get(PROFILES_STORAGE_KEY);
            allProfiles = Object.values(profilesData[PROFILES_STORAGE_KEY] || {});
            allProfiles.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            const data = await chrome.storage.local.get('rules');
            allRules = data.rules || [];
            
            applyFiltersAndRender();
            updateBulkActionBarVisibility();
            updateSelectAllCheckboxState();
        } catch (error) {
            console.error('Error initializing the page:', error);
            showToast('Error loading data. Please refresh.', 'error');
        }
    };

    const applyFiltersAndRender = () => {
        const queryLower = currentFilters.query.toLowerCase();
        const filtered = allRules.filter(rule => {
            const searchMatch = rule.name.toLowerCase().includes(queryLower) ||
                (rule.tags && rule.tags.some(tag => tag.toLowerCase().includes(queryLower)));
            const statusMatch = currentFilters.status === 'all' || (currentFilters.status === 'enabled' && rule.enabled) || (currentFilters.status === 'disabled' && !rule.enabled);
            const triggerMatch = currentFilters.trigger === 'all' || rule.trigger.type === currentFilters.trigger;
            const targetTypeMatch = currentFilters.targetType === 'all' || rule.targetType === currentFilters.targetType;

            return searchMatch && statusMatch && triggerMatch && targetTypeMatch;
        });
        renderRules(filtered);
    };
    
    const renderRules = (rulesToRender) => {
        const hasRules = allRules.length > 0;
        noRulesPlaceholder.style.display = !hasRules ? 'block' : 'none';
        if (!hasRules) {
            noRulesPlaceholder.textContent = '';
            noRulesPlaceholder.appendChild(createElement('span', 'icon icon-list'));
            noRulesPlaceholder.appendChild(createElement('h3', null, 'No Automation Rules Found'));
            noRulesPlaceholder.appendChild(createElement('p', null, 'Use the sidebar to "Add New Rule" and get started.'));
            const learnMoreLink = createElement('a', null, 'Learn more about Automation Rules...');
            learnMoreLink.href = 'https://sites.google.com/view/modcore-em-help/manage-extensions/rules-page';
            learnMoreLink.target = '_blank';
            learnMoreLink.rel = 'noopener noreferrer';
            learnMoreLink.style.display = 'block';
            learnMoreLink.style.marginTop = '12px';
            noRulesPlaceholder.appendChild(learnMoreLink);
        }

        const ruleElementsOnPage = new Map();
        rulesListContainer.querySelectorAll('tr[data-rule-id]').forEach(el => {
            ruleElementsOnPage.set(el.dataset.ruleId, el);
        });

        const rulesToRenderIds = new Set(rulesToRender.map(r => r.id));

        for (const [ruleId, element] of ruleElementsOnPage.entries()) {
            if (!rulesToRenderIds.has(ruleId)) {
                element.remove();
            }
        }

        rulesToRender.forEach(rule => {
            const existingElement = ruleElementsOnPage.get(rule.id);
            const newElement = createRuleElement(rule);
            if (existingElement) {
                existingElement.replaceWith(newElement);
            } else {
                rulesListContainer.appendChild(newElement);
            }
        });
        
        const hasResults = rulesListContainer.children.length > 0;
        noResultsPlaceholder.style.display = hasRules && !hasResults ? 'block' : 'none';
        if (hasRules && !hasResults) {
            noResultsPlaceholder.textContent = '';
            noResultsPlaceholder.appendChild(createElement('span', 'icon icon-search'));
            noResultsPlaceholder.appendChild(createElement('h3', null, 'No Rules Match Your Search'));
            noResultsPlaceholder.appendChild(createElement('p', null, 'Try searching for a different name or adjusting your filters.'));
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
        tdActions.append(editBtn, deleteBtn);

        tr.append(tdSelect, tdName, tdTrigger, tdTargets, tdStatus, tdActions);
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

    // --- Bulk Action Logic ---

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
        selectedRulesCountSpan.textContent = `${count} selected`;
        if (count > 0) {
            bulkActionsBar.style.display = 'flex';
            requestAnimationFrame(() => bulkActionsBar.classList.add('active'));
        } else {
            bulkActionsBar.classList.remove('active');
            setTimeout(() => { bulkActionsBar.style.display = 'none'; }, 300);
        }
    };

    const updateSelectAllCheckboxState = () => {
        const visibleRuleIds = Array.from(rulesListContainer.querySelectorAll('tr[data-rule-id]')).map(el => el.dataset.ruleId);
        if (visibleRuleIds.length === 0) {
            selectAllRulesCheckbox.checked = false;
            selectAllRulesCheckbox.indeterminate = false;
            return;
        }
        const allVisibleSelected = visibleRuleIds.every(id => selectedRuleIds.has(id));
        selectAllRulesCheckbox.checked = allVisibleSelected;
        selectAllRulesCheckbox.indeterminate = selectedRuleIds.size > 0 && !allVisibleSelected;
    };

    const handleSelectAllChange = (isChecked) => {
        const visibleRuleCheckboxes = document.querySelectorAll('#rules-list-container .rule-select-checkbox');
        visibleRuleCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
            toggleRuleSelection(checkbox.closest('tr')?.dataset.ruleId, isChecked);
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
        selectedRuleIds.clear();
        chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updatedRules }, () => {
            refreshUI();
            showToast('Selected rules deleted.', 'success');
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
            selectedRuleIds.clear();
            chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updatedRules }, () => {
                refreshUI();
                showToast(`Selected rules ${actionText}d.`, 'success');
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

        const selectedTargetType = ruleTargetTypeSelect.value;
        const selectedTargetIds = Array.from(targetSelectorContainer.querySelectorAll('input:checked')).map(cb => cb.value);

        const ruleData = {
            id: ruleIdInput.value || `rule_${Date.now()}`,
            name: ruleNameInput.value.trim(),
            tags: ruleTagsInput.value.split(',').map(tag => tag.trim()).filter(Boolean),
            targetType: selectedTargetType,
            targetIds: selectedTargetIds,
            action: ruleActionSelect.value,
            trigger: { type: triggerTypeSelect.value },
            enabled: allRules.find(r => r.id === ruleIdInput.value)?.enabled ?? true,
        };
        
        if (ruleData.trigger.type === 'time') {
            const selectedDays = Array.from(document.querySelectorAll('.day-selector input:checked')).map(cb => parseInt(cb.value, 10));
            ruleData.trigger.time = ruleTimeInput.value;
            ruleData.trigger.days = selectedDays;
        } else {
            ruleData.trigger.url = ruleUrlInput.value.trim();
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
    
    rulesListContainer.addEventListener('click', async (e) => {
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
    });

    ruleSearchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            currentFilters.query = ruleSearchInput.value;
            applyFiltersAndRender();
        }, 150);
    });

    ruleTargetTypeSelect.addEventListener('change', () => {
        const selectedType = ruleTargetTypeSelect.value;
        populateTargetSelector(selectedType);
        populateActionTypeSelect(selectedType);
        clearValidationError(targetSelectorError);
        clearValidationError(ruleActionError);
    });

    triggerTypeSelect.addEventListener('change', () => {
        const isTime = triggerTypeSelect.value === 'time';
        timeConditionFields.style.display = isTime ? 'block' : 'none';
        urlConditionFields.style.display = isTime ? 'none' : 'block';
        clearAllValidationErrors();
    });

    // Filter Side Sheet
    const openFilterSheet = () => filterSideSheet.classList.add('active');
    const closeFilterSheet = () => filterSideSheet.classList.remove('active');

    filterBtn.addEventListener('click', openFilterSheet);
    closeFilterSheetBtn.addEventListener('click', closeFilterSheet);
    filterSheetOverlay.addEventListener('click', closeFilterSheet);

    applyFiltersBtn.addEventListener('click', () => {
        currentFilters.status = filterStatusSelect.value;
        currentFilters.trigger = filterTriggerSelect.value;
        currentFilters.targetType = filterTargetTypeSelect.value;
        applyFiltersAndRender();
        closeFilterSheet();
    });

    resetFiltersBtn.addEventListener('click', () => {
        filterStatusSelect.value = 'all';
        filterTriggerSelect.value = 'all';
        filterTargetTypeSelect.value = 'all';
        currentFilters = { query: currentFilters.query, status: 'all', trigger: 'all', targetType: 'all' };
        applyFiltersAndRender();
    });

    // --- Panel Navigation Logic ---

    const setActivePanel = (panelId) => {
        panels.forEach(panel => {
            panel.classList.remove('active');
            panel.setAttribute('aria-hidden', 'true');
        });
        navButtons.forEach(btn => btn.classList.remove('active'));

        const targetPanel = document.getElementById(panelId);
        if (targetPanel) {
            targetPanel.classList.add('active');
            targetPanel.setAttribute('aria-hidden', 'false');
            currentActivePanelId = panelId;

            const navButton = document.querySelector(`[aria-controls="${panelId}"]`);
            if (navButton) navButton.classList.add('active');
        }

        if (panelId === 'rules-list-panel') {
            ruleSearchInput.focus();
            selectedRuleIds.clear();
            updateBulkActionBarVisibility();
        } else if (panelId === 'add-rule-panel') {
            ruleNameInput.focus();
        }
    };

    const showRuleForm = (ruleToEdit = null) => {
        ruleForm.reset();
        clearAllValidationErrors();
        showStep(1);
        
        timeConditionFields.style.display = 'block';
        urlConditionFields.style.display = 'none';
        
        while (targetSelectorContainer.firstChild) {
            targetSelectorContainer.removeChild(targetSelectorContainer.firstChild);
        }
        document.querySelectorAll('.day-selector input').forEach(cb => cb.checked = false);

        if (ruleToEdit) {
            formPanelTitle.textContent = 'Edit Rule';
            ruleIdInput.value = ruleToEdit.id;
            ruleNameInput.value = ruleToEdit.name;
            ruleTagsInput.value = (ruleToEdit.tags || []).map(tag => sanitizeText(tag)).join(', ');
            
            ruleTargetTypeSelect.value = ruleToEdit.targetType;
            populateTargetSelector(ruleToEdit.targetType, ruleToEdit.targetIds);
            populateActionTypeSelect(ruleToEdit.targetType, ruleToEdit.action);
            ruleActionSelect.value = ruleToEdit.action;

            triggerTypeSelect.value = ruleToEdit.trigger.type;
            
            if (ruleToEdit.trigger.type === 'time') {
                ruleTimeInput.value = ruleToEdit.trigger.time;
                ruleToEdit.trigger.days.forEach(day => {
                    const checkbox = document.querySelector(`.day-selector input[value="${day}"]`);
                    if (checkbox) checkbox.checked = true;
                });
            } else {
                ruleUrlInput.value = ruleToEdit.trigger.url;
            }
        } else {
            formPanelTitle.textContent = 'Create New Rule';
            ruleIdInput.value = '';
            ruleTagsInput.value = '';
            
            ruleTargetTypeSelect.value = settings.defaultTargetType;
            populateTargetSelector(settings.defaultTargetType);
            populateActionTypeSelect(settings.defaultTargetType);
            
            triggerTypeSelect.value = settings.defaultTriggerType;
        }
        
        triggerTypeSelect.dispatchEvent(new Event('change'));
        ruleTargetTypeSelect.dispatchEvent(new Event('change'));
        setActivePanel('add-rule-panel');
        ruleNameInput.focus();
    };

    // --- Toast Notification ---
    const showToast = (message, type = 'info') => {
        const toast = createElement('div', `toast ${type}`, message);
        toastContainer.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show')); 
        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        }, 3000);
    };

    // --- Initial Load & Event Listeners ---
    
    navButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            if (button.tagName === 'A') return; // Let external links navigate naturally
            const panelId = button.getAttribute('aria-controls');
            if (!panelId) return;
            if (panelId === 'add-rule-panel') showRuleForm();
            else setActivePanel(panelId);
        });
    });

    backToRulesListBtn.addEventListener('click', () => setActivePanel('rules-list-panel'));
    cancelRuleFormBtn.addEventListener('click', () => setActivePanel('rules-list-panel'));
    ruleForm.addEventListener('submit', handleFormSubmit);

    selectAllRulesCheckbox.addEventListener('change', (e) => handleSelectAllChange(e.target.checked));
    bulkEnableBtn.addEventListener('click', () => bulkToggleSelected(true));
    bulkDisableBtn.addEventListener('click', () => bulkToggleSelected(false));
    bulkDeleteBtn.addEventListener('click', bulkDeleteSelected);

    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && currentActivePanelId === 'rules-list-panel') {
            e.preventDefault(); 
            ruleSearchInput.focus();
        } 
        else if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault(); 
            showRuleForm();
        }
        else if ((e.ctrlKey || e.metaKey) && e.key === 's' && currentActivePanelId === 'add-rule-panel') {
            e.preventDefault();
            ruleForm.requestSubmit();
        }
    });

    await loadSettings();
    refreshUI();
    setActivePanel('rules-list-panel');
});