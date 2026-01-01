document.addEventListener('DOMContentLoaded', async () => {
    // --- Constants (copied from popup.js for consistency) ---
    const PREFERENCES_STORAGE_KEY = 'extensionManagerPreferences_v4';
    const GROUPS_STORAGE_KEY = 'extensionManagerGroups_v4'; // Incremented for shortcutAction
    const PROFILES_STORAGE_KEY = 'extensionManagerProfiles_v2';
    const DEFAULT_ICON_PLACEHOLDER = '../../public/icons/svg/updatelogo.svg';

    // --- Global State ---
    let allRules = [];
    let allExtensions = [];
    let allProfiles = []; // New state for profiles
    let allGroups = {}; // New state for groups
    let currentActivePanelId = 'rules-list-panel';
    let selectedRuleIds = new Set();
    let currentViewMode = 'list';
    let currentFilters = {
        query: '',
        status: 'all',
        trigger: 'all',
        targetType: 'all' // New filter
    };

    // --- Utility Functions ---
    // Moved sanitizeText here as it's needed by this script
    function sanitizeText(str) {
        if (str === null || typeof str === 'undefined') return '';
        const temp = document.createElement('div');
        temp.textContent = String(str);
        return temp.textContent;
    }

    // --- DOM Element Selection ---
    const rulesListContainer = document.getElementById('rules-list-container');
    const noRulesPlaceholder = document.getElementById('no-rules-placeholder');
    const noResultsPlaceholder = document.getElementById('no-results-placeholder');
    const ruleSearchInput = document.getElementById('rule-search-input');
    const selectAllRulesCheckbox = document.getElementById('select-all-rules');
    const viewToggleBtn = document.getElementById('view-toggle-btn');
    const viewToggleIcon = document.getElementById('view-toggle-icon');
    
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
    const ruleTargetTypeSelect = document.getElementById('rule-target-type-select'); // NEW
    const targetSelectorContainer = document.getElementById('target-selector-container'); // Renamed from extensionSelector
    const targetSelectorLabel = document.getElementById('target-selector-label'); // Label for the selector
    const ruleActionSelect = document.getElementById('rule-action-select');
    const triggerTypeSelect = document.getElementById('trigger-type-select');
    const timeConditionFields = document.getElementById('time-condition-fields');
    const urlConditionFields = document.getElementById('url-condition-fields');
    const ruleTimeInput = document.getElementById('rule-time-input');
    const ruleUrlInput = document.getElementById('rule-url-input');

    // Error message elements
    const ruleNameError = document.getElementById('rule-name-error');
    const targetSelectorError = document.getElementById('target-selector-error'); // Renamed
    const ruleActionError = document.getElementById('rule-action-error'); // NEW
    const ruleTimeError = document.getElementById('rule-time-error');
    const daySelectorError = document.getElementById('day-selector-error');
    const ruleUrlError = document.getElementById('rule-url-error');

    const toastContainer = document.getElementById('toast-container');
    const panels = document.querySelectorAll('.content-panel');
    const navButtons = document.querySelectorAll('.sidebar-button');
    const backToRulesListBtn = document.getElementById('back-to-rules-list');
    const cancelRuleFormBtn = document.getElementById('cancel-rule-form');

    // Custom Confirmation Dialog Elements
    const confirmDialogOverlay = document.getElementById('confirm-dialog-overlay');
    const confirmDialogMessage = document.getElementById('confirm-dialog-message');
    const confirmOkBtn = document.getElementById('confirm-ok-btn');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

    // NEW: Elements for new features
    const importRulesBtn = document.getElementById('import-rules-btn');
    const exportRulesBtn = document.getElementById('export-rules-btn');
    const importFileInput = document.getElementById('import-file-input');
    const filterStatusSelect = document.getElementById('filter-status-select');
    const filterTriggerSelect = document.getElementById('filter-trigger-select');
    const filterTargetTypeSelect = document.getElementById('filter-target-type-select'); // NEW

    // --- Helper Functions for DOM Manipulation & Validation ---

    /** Creates a DOM element with specified tag, class, and text content. */
    const createElement = (tag, className, textContent) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (textContent) element.textContent = textContent;
        return element;
    };

    /** Securely builds and appends a single rule item to the list. */
    const createRuleElement = (rule) => {
        const ruleItem = createElement('div', 'rule-item');
        ruleItem.dataset.ruleId = rule.id;
        ruleItem.setAttribute('role', 'listitem');

        const checkbox = createElement('input', 'rule-select-checkbox');
        checkbox.type = 'checkbox';
        checkbox.id = `select-rule-${rule.id}`;
        checkbox.value = rule.id;
        checkbox.checked = selectedRuleIds.has(rule.id);
        checkbox.setAttribute('aria-label', `Select rule named ${sanitizeText(rule.name)}`); // ACCESSIBILITY: Enhanced label
        ruleItem.appendChild(checkbox);

        if (selectedRuleIds.has(rule.id)) {
            ruleItem.classList.add('selected');
        }

        const ruleDetails = createElement('div', 'rule-details');
        const ruleName = createElement('h4', 'rule-name', sanitizeText(rule.name));
        const conditionsGrid = createElement('div', 'rule-conditions-grid');

        // Rule Action Display
        let actionIconClass = '';
        let actionText = '';
        if (rule.targetType === 'extension') {
            actionIconClass = rule.action === 'enable' ? 'icon-toggle-on' : 'icon-toggle-off';
            actionText = `Action: ${rule.action.charAt(0).toUpperCase() + rule.action.slice(1)}`;
        } else if (rule.targetType === 'profile') {
            actionIconClass = 'icon-profiles'; // Placeholder icon for apply profile
            actionText = `Action: Apply Profile`;
        } else if (rule.targetType === 'group') {
             actionIconClass = 'icon-groups'; // Placeholder icon for groups
             if (rule.action === 'toggle') {
                actionText = `Action: Toggle Group`;
            } else {
                actionText = `Action: ${rule.action.charAt(0).toUpperCase() + rule.action.slice(1)}`;
            }
        }
        conditionsGrid.appendChild(createConditionElement(actionIconClass, actionText, true));

        // Rule Trigger Display
        let triggerCondition;
        if (rule.trigger.type === 'time') {
            const days = rule.trigger.days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') || 'No days';
            triggerCondition = createConditionElement('icon-clock', `At ${rule.trigger.time} on ${days}`, true);
        } else {
            triggerCondition = createConditionElement('icon-url', `On visit to ${rule.trigger.url}`, true);
        }
        conditionsGrid.appendChild(triggerCondition);
        
        // Rule Targets Display
        let targetsText = 'None';
        let targetsIconClass = 'icon-grid'; // Default icon
        if (rule.targetType === 'extension') {
            const names = allExtensions.filter(ext => rule.targetIds.includes(ext.id)).map(ext => ext.name);
            targetsText = `Targets Extensions: ${names.join(', ') || 'None'}`;
            targetsIconClass = 'icon-grid';
        } else if (rule.targetType === 'profile') {
            const profile = allProfiles.find(p => p.id === rule.targetIds[0]); // Profiles only target one
            targetsText = `Targets Profile: ${profile ? sanitizeText(profile.name) : 'Unknown Profile'}`;
            targetsIconClass = 'icon-profiles'; // SVG for profiles icon
        } else if (rule.targetType === 'group') {
            // Group IDs are their names in the data structure
            const groupNames = rule.targetIds.map(id => allGroups[id]?.name || id); 
            targetsText = `Targets Groups: ${groupNames.map(name => sanitizeText(name)).join(', ') || 'None'}`;
            targetsIconClass = 'icon-groups'; // SVG for groups icon
        }
        const targetsCondition = createConditionElement(targetsIconClass, targetsText, false);
        targetsCondition.title = targetsText; // Use full text for tooltip
        conditionsGrid.appendChild(targetsCondition);
        
        ruleDetails.append(ruleName, conditionsGrid);

        // Display tags
        if (rule.tags && rule.tags.length > 0) {
            const tagsContainer = createElement('div', 'tags-container');
            rule.tags.forEach(tagText => {
                const tagElement = createElement('span', 'tag', sanitizeText(tagText));
                tagsContainer.appendChild(tagElement);
            });
            ruleDetails.appendChild(tagsContainer);
        }

        const ruleActions = createElement('div', 'rule-actions');
        const toggleSwitch = createToggleSwitch(rule.id, rule.enabled);
        const editBtn = createIconButton('icon-edit', 'edit-rule-btn', `Edit rule named ${sanitizeText(rule.name)}`);
        const deleteBtn = createIconButton('icon-trash', 'delete-rule-btn', `Delete rule named ${sanitizeText(rule.name)}`);
        ruleActions.append(toggleSwitch, editBtn, deleteBtn);

        ruleItem.append(checkbox, ruleDetails, ruleActions); // Order checkbox, details, actions
        return ruleItem;
    };
    
    const createConditionElement = (iconClass, text, isStrong) => {
        const condition = createElement('div', 'rule-condition');
        const icon = createElement('span', `icon ${iconClass}`);
        const textDiv = createElement('div', 'condition-text');
        if (isStrong) {
            const parts = text.split(':');
            textDiv.textContent = `${sanitizeText(parts[0])}: `;
            textDiv.appendChild(createElement('strong', null, sanitizeText(parts.slice(1).join(':').trim())));
        } else {
            textDiv.textContent = sanitizeText(text);
        }
        condition.append(icon, textDiv);
        return condition;
    };

    const createIconButton = (iconClass, buttonClass, ariaLabel) => {
        const button = createElement('button', `btn-icon ${buttonClass}`);
        button.setAttribute('aria-label', ariaLabel);
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

    /** Populates the target selector based on type. */
    const populateTargetSelector = (targetType, selectedIds = []) => {
        targetSelectorContainer.textContent = ''; // Clear existing content
        let items = [];
        let labelText = '';

        switch (targetType) {
            case 'extension':
                items = allExtensions;
                labelText = 'Select Extensions';
                break;
            case 'profile':
                items = allProfiles; // This is an array of profile objects
                labelText = 'Select Profile (One only)';
                break;
            case 'group':
                items = Object.values(allGroups); // This converts the allGroups object into an array of group objects
                labelText = 'Select Groups';
                break;
        }

        console.log(`Rules.js: Populating target selector for type: ${targetType}. Items to render:`, items); // DEBUG LOG

        if (items.length === 0) {
            const placeholder = createElement('p', 'placeholder-text', `No ${targetType}s found.`);
            placeholder.style.textAlign = 'center';
            placeholder.style.color = 'var(--on-surface-variant-color)';
            targetSelectorContainer.appendChild(placeholder);
            return;
        }

        items.forEach(item => {
            // Use item.id for profiles, item.name for groups (as per data structure)
            const id = item.id || item.name; 
            const name = item.name;
            const itemImgSrc = item.icons && item.icons.length > 0 && item.icons[item.icons.length - 1].url
                               ? item.icons[item.icons.length - 1].url
                               : DEFAULT_ICON_PLACEHOLDER; // Use generic placeholder if no icon specific to target type

            const itemDiv = createElement('div', 'extension-selector-item'); // Reusing style class
            const input = createElement('input');
            input.type = targetType === 'profile' ? 'radio' : 'checkbox';
            input.name = 'target-item-selection'; // Radio buttons need same name
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
            img.onerror = function() { this.src = DEFAULT_ICON_PLACEHOLDER; }; // Fallback for broken image

            label.append(img, createElement('span', null, sanitizeText(name))); // Sanitize name before displaying
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

        if (targetType === 'extension' || targetType === 'group') {
            options = [
                { value: 'enable', text: 'Enable' },
                { value: 'disable', text: 'Disable' }
            ];
            if (targetType === 'group') {
                options.push({ value: 'toggle', text: 'Toggle (Enable/Disable)' }); // Add toggle for groups
            }
        } else if (targetType === 'profile') {
            options = [
                { value: 'apply', text: 'Apply Profile' }
            ];
        }

        options.forEach(optionData => {
            const option = createElement('option');
            option.value = optionData.value;
            option.textContent = optionData.text; // Use textContent
            // Set selected if it matches
            if (optionData.value === selectedAction) {
                option.selected = true;
            }
            ruleActionSelect.appendChild(option);
        });
    };


    const showValidationError = (element, message) => {
        element.textContent = message;
        // Check if the previous sibling is an element (input/select)
        if (element.previousElementSibling && (element.previousElementSibling.tagName === 'INPUT' || element.previousElementSibling.tagName === 'SELECT')) {
            element.previousElementSibling.classList.add('invalid');
        } else { // For the whole selector container (like target-selector-container)
            if (element.id === 'target-selector-error') {
                 targetSelectorContainer.classList.add('invalid-border');
            }
        }
        element.setAttribute('role', 'alert');
    };

    const clearValidationError = (element) => {
        element.textContent = '';
        if (element.previousElementSibling && (element.previousElementSibling.tagName === 'INPUT' || element.previousElementSibling.tagName === 'SELECT')) {
            element.previousElementSibling.classList.remove('invalid');
        } else {
             if (element.id === 'target-selector-error') {
                targetSelectorContainer.classList.remove('invalid-border');
            }
        }
        element.removeAttribute('role');
    };

    const clearAllValidationErrors = () => {
        clearValidationError(ruleNameError);
        clearValidationError(targetSelectorError);
        clearValidationError(ruleActionError);
        clearValidationError(ruleTimeError);
        clearValidationError(daySelectorError);
        clearValidationError(ruleUrlError);
        targetSelectorContainer.classList.remove('invalid-border');
    };

    /** Custom confirmation dialog. Returns a Promise. */
    const showConfirmDialog = (message) => {
        return new Promise((resolve) => {
            confirmDialogMessage.textContent = message;
            confirmDialogOverlay.classList.add('active');
            confirmOkBtn.focus();

            const onConfirm = () => {
                confirmDialogOverlay.classList.remove('active');
                confirmOkBtn.removeEventListener('click', onConfirm);
                confirmCancelBtn.removeEventListener('click', onCancel);
                resolve(true);
            };

            const onCancel = () => {
                confirmDialogOverlay.classList.remove('active');
                confirmOkBtn.removeEventListener('click', onConfirm);
                confirmCancelBtn.removeEventListener('click', onCancel);
                resolve(false);
            };

            confirmOkBtn.addEventListener('click', onConfirm);
            confirmCancelBtn.addEventListener('click', onCancel);

            const handleEsc = (e) => {
                if (e.key === 'Escape') {
                    onCancel();
                    document.removeEventListener('keydown', handleEsc);
                }
            };
            document.addEventListener('keydown', handleEsc);
        });
    };


    // --- Data & UI Management ---

    const refreshUI = async () => {
        try {
            // Fetch extensions
            if (chrome.management && chrome.management.getSelf) {
                const self = await chrome.management.getSelf();
                const extensions = await chrome.management.getAll();
                // Filter out the extension manager itself and ensure it's a regular extension type
                allExtensions = extensions.filter(ext => ext.type === 'extension' && ext.id !== self.id);
            }
            
            // Fetch profiles and groups
            console.log(`Rules.js: Fetching profiles using key: '${PROFILES_STORAGE_KEY}'`);
            const profilesData = await chrome.storage.local.get(PROFILES_STORAGE_KEY);
            console.log("Rules.js: Raw data from PROFILES_STORAGE_KEY:", profilesData);
            allProfiles = Object.values(profilesData[PROFILES_STORAGE_KEY] || {});
            allProfiles.sort((a,b) => (a.name || '').localeCompare(b.name || '')); // Ensure sorting
            console.log("Rules.js: Processed allProfiles array:", allProfiles); // DEBUG LOG

            console.log(`Rules.js: Fetching groups using key: '${GROUPS_STORAGE_KEY}'`);
            const groupsData = await chrome.storage.local.get(GROUPS_STORAGE_KEY);
            console.log("Rules.js: Raw data from GROUPS_STORAGE_KEY:", groupsData);
            allGroups = groupsData[GROUPS_STORAGE_KEY] || {}; // Keep as object for easy lookup
            console.log("Rules.js: Processed allGroups object:", allGroups); // DEBUG LOG


            const data = await chrome.storage.local.get('rules');
            allRules = data.rules || [];
            
            applyFiltersAndRender();
            updateBulkActionBarVisibility();
            updateSelectAllCheckboxState();
            // Also re-populate filter dropdown for target type, in case new profiles/groups were added
            populateTargetTypeFilterDropdown(); 
        } catch (error) {
            console.error("Rules.js: Error initializing the page:", error);
            showToast("Error loading data. Please refresh.", "error");
        }
    };
    
    // NEW: Populate the target type filter dropdown in the main view
    const populateTargetTypeFilterDropdown = () => {
        // Ensure that any existing options are preserved if they match new values
        const currentSelectedValue = filterTargetTypeSelect.value;
        
        while (filterTargetTypeSelect.firstChild) {
            filterTargetTypeSelect.removeChild(filterTargetTypeSelect.firstChild);
        }

        const optionsData = [
            { value: "all", text: "All Targets" },
            { value: "extension", text: "Extensions" },
            { value: "profile", text: "Profiles" },
            { value: "group", text: "Groups" }
        ];

        optionsData.forEach(optionData => {
            const option = createElement('option');
            option.value = optionData.value;
            option.textContent = optionData.text;
            filterTargetTypeSelect.appendChild(option);
        });

        if (Array.from(filterTargetTypeSelect.options).some(opt => opt.value === currentSelectedValue)) {
            filterTargetTypeSelect.value = currentSelectedValue;
        }
    }


    // NEW: Centralized filtering logic
    const applyFiltersAndRender = () => {
        const filtered = allRules.filter(rule => {
            const queryLower = currentFilters.query.toLowerCase();
            const searchMatch = rule.name.toLowerCase().includes(queryLower) ||
                (rule.tags && rule.tags.some(tag => tag.toLowerCase().includes(queryLower)));
            const statusMatch = currentFilters.status === 'all' || (currentFilters.status === 'enabled' && rule.enabled) || (currentFilters.status === 'disabled' && !rule.enabled);
            const triggerMatch = currentFilters.trigger === 'all' || rule.trigger.type === currentFilters.trigger;
            const targetTypeMatch = currentFilters.targetType === 'all' || rule.targetType === currentFilters.targetType;

            return searchMatch && statusMatch && triggerMatch && targetTypeMatch;
        });
        renderRules(filtered);
    };
    
    /**
     * PERFORMANCE: Renders rules by diffing the DOM, not replacing it entirely.
     */
    const renderRules = (rulesToRender) => {
        rulesListContainer.classList.remove('list-view', 'grid-view');
        rulesListContainer.classList.add(`${currentViewMode}-view`);
        viewToggleIcon.className = `icon icon-layout-${currentViewMode === 'list' ? 'grid' : 'list'}`;

        const hasRules = allRules.length > 0;
        noRulesPlaceholder.style.display = !hasRules ? 'block' : 'none';
        if (!hasRules) {
            noRulesPlaceholder.textContent = ''; // Clear existing content
            noRulesPlaceholder.appendChild(createElement('span', 'icon icon-list'));
            noRulesPlaceholder.appendChild(createElement('h3', null, 'No Automation Rules Found'));
            noRulesPlaceholder.appendChild(createElement('p', null, 'Use the sidebar to "Add New Rule" and get started.'));
            const learnMoreLink = createElement('a', null, 'Learn more about Automation Rules...');
            learnMoreLink.href = "https://sites.google.com/view/modcore-em-help/manage-extensions/rules-page";
            learnMoreLink.target = "_blank";
            learnMoreLink.rel = "noopener noreferrer";
            learnMoreLink.style.display = "block";
            learnMoreLink.style.marginTop = "12px";
            noRulesPlaceholder.appendChild(learnMoreLink);
        }


        const ruleElementsOnPage = new Map();
        rulesListContainer.querySelectorAll('.rule-item').forEach(el => {
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
            noResultsPlaceholder.textContent = ''; // Clear existing content
            noResultsPlaceholder.appendChild(createElement('span', 'icon icon-search'));
            noResultsPlaceholder.appendChild(createElement('h3', null, 'No Rules Match Your Search'));
            noResultsPlaceholder.appendChild(createElement('p', null, 'Try searching for a different name or adjusting your filters.'));
        }

        updateSelectAllCheckboxState();
    };
    
    const validateForm = () => {
        let isValid = true;
        clearAllValidationErrors();

        const ruleName = ruleNameInput.value.trim();
        if (ruleName === '') {
            showValidationError(ruleNameError, 'Rule name cannot be empty.');
            isValid = false;
        } else {
            const isNameTaken = allRules.some(r => 
                sanitizeText(r.name).toLowerCase() === sanitizeText(ruleName).toLowerCase() && r.id !== ruleIdInput.value);
            if (isNameTaken) {
                showValidationError(ruleNameError, 'A rule with this name already exists. Please choose a unique name.');
                isValid = false;
            }
        }

        const selectedTargetType = ruleTargetTypeSelect.value;
        const selectedTargets = Array.from(targetSelectorContainer.querySelectorAll('input:checked')).map(cb => cb.value);

        if (selectedTargets.length === 0) {
            showValidationError(targetSelectorError, `Please select at least one ${selectedTargetType}.`);
            isValid = false;
        } else if (selectedTargetType === 'profile' && selectedTargets.length > 1) {
            showValidationError(targetSelectorError, 'Please select only one profile for automation.');
            isValid = false;
        }

        const selectedAction = ruleActionSelect.value;
        if (selectedTargetType === 'profile' && selectedAction !== 'apply') {
            showValidationError(ruleActionError, 'For profiles, the only supported action is "Apply Profile".');
            isValid = false;
        } else if (selectedTargetType === 'extension' && !['enable', 'disable'].includes(selectedAction)) { // Extensions only enable/disable
             showValidationError(ruleActionError, 'For extensions, action must be "Enable" or "Disable".');
             isValid = false;
        } else if (selectedTargetType === 'group' && !['enable', 'disable', 'toggle'].includes(selectedAction)) { // Groups can toggle
             showValidationError(ruleActionError, 'For groups, action must be "Enable", "Disable", or "Toggle".');
             isValid = false;
        }


        if (triggerTypeSelect.value === 'time') {
            if (!ruleTimeInput.value) {
                showValidationError(ruleTimeError, 'Please select a time for the rule.');
                isValid = false;
            }
            const selectedDays = Array.from(document.querySelectorAll('.day-selector input:checked')).map(cb => parseInt(cb.value));
            if (selectedDays.length === 0) {
                showValidationError(daySelectorError, 'Please select at least one day.');
                isValid = false;
            }
        } else { // URL trigger
            if (!ruleUrlInput.value.trim()) {
                showValidationError(ruleUrlError, 'URL or Domain cannot be empty.');
                isValid = false;
            }
        }
        return isValid;
    };

    /**
     * ENHANCED: More robust conflict checking for URLs and new target types.
     * Conflicts defined as: two ENABLED rules targeting the SAME item(s) with OPPOSITE actions and OVERLAPPING triggers.
     * For profiles/groups, we primarily check for direct conflicts on the profile/group itself.
     * Cross-target conflicts (e.g., profile X enables extension A, but a separate rule disables extension A)
     * are extremely complex to manage at the rule-creation stage without significant performance impact
     * and a deeper state tracking, so for now, we focus on direct target conflicts.
     */
    const checkRuleConflicts = (newRule) => {
        const relevantRules = allRules.filter(r => r.enabled && r.id !== newRule.id);

        for (const existingRule of relevantRules) {
            // Check if triggers overlap
            let triggersOverlap = false;
            if (newRule.trigger.type === 'time' && existingRule.trigger.type === 'time') {
                if (newRule.trigger.time === existingRule.trigger.time) {
                    const commonDays = newRule.trigger.days.filter(day => existingRule.trigger.days.includes(day));
                    if (commonDays.length > 0) triggersOverlap = true;
                }
            } else if (newRule.trigger.type === 'url' && existingRule.trigger.type === 'url') {
                const newUrlStr = newRule.trigger.url.toLowerCase();
                const existingUrlStr = existingRule.trigger.url.toLowerCase();
                // Simple check: if one URL contains the other (e.g., youtube.com vs youtube.com/watch)
                if (newUrlStr.includes(existingUrlStr) || existingUrlStr.includes(newUrlStr)) {
                    triggersOverlap = true;
                }
            }

            if (!triggersOverlap) continue; // No trigger overlap means no conflict for this pair

            // Check for target and action conflicts
            let hasDirectConflict = false;

            // Case 1: Same target type, conflicting actions
            if (newRule.targetType === existingRule.targetType) {
                const commonTargets = newRule.targetIds.filter(id => existingRule.targetIds.includes(id));
                if (commonTargets.length > 0) {
                    if (newRule.targetType === 'extension') {
                        if (newRule.action !== existingRule.action) {
                            hasDirectConflict = true;
                        }
                    } else if (newRule.targetType === 'profile') {
                        // Two "apply profile" actions on the same profile conflict if triggered at the same time,
                        // but technically they'd just apply the same profile.
                        // Conflict here is more about two different profiles being applied to the *same* profile target
                        // which isn't possible with current UI (only one profile can be selected).
                        // If they both target the same profile, they implicitly conflict if trying to set different states.
                        // Simplification: if two rules target the *same profile* they are considered conflicting IF their actions are different, which they can't be (only 'apply').
                        // So, the most direct conflict is trying to apply the *same* profile with different actions, which won't happen.
                        // The primary conflict is two *different* profiles being applied, but the UI limits to one target.
                        // A more nuanced conflict: Rule A applies Profile X, Rule B applies Profile Y, and both rules trigger.
                        // For simplicity now, we only check if the target profile ID is the same, which means they would be redundant or directly conflicting if multiple selection was allowed.
                         if (newRule.action === 'apply' && existingRule.action === 'apply') {
                            hasDirectConflict = true; // Two apply rules for the same profile is a conflict
                         }
                    } else if (newRule.targetType === 'group') {
                        const newAction = newRule.action; // enable, disable, toggle
                        const existingAction = existingRule.action;

                        if (newAction === 'toggle' || existingAction === 'toggle') {
                             // If either is 'toggle', it conflicts with a direct enable/disable of the same group.
                             if ((newAction === 'toggle' && (existingAction === 'enable' || existingAction === 'disable')) ||
                                 (existingAction === 'toggle' && (newAction === 'enable' || newAction === 'disable'))) {
                                 hasDirectConflict = true;
                             }
                        } else if (newAction !== existingAction) {
                            // If both are direct enable/disable, they conflict if different
                            hasDirectConflict = true;
                        }
                    }
                }
            }

            // More complex cross-type conflicts (e.g., profile rule vs extension rule) are outside this scope for initial implementation.

            if (hasDirectConflict) {
                const conflictingItemNames = newRule.targetIds
                    .filter(id => existingRule.targetIds.includes(id))
                    .map(id => {
                        if (newRule.targetType === 'extension') return allExtensions.find(ext => ext.id === id)?.name;
                        if (newRule.targetType === 'profile') return allProfiles.find(p => p.id === id)?.name;
                        if (newRule.targetType === 'group') return allGroups[id]?.name || id; // Groups use name as ID
                        return id;
                    })
                    .filter(name => name)
                    .map(name => sanitizeText(name)) // Sanitize here too
                    .join(', ');

                return `Rule "${sanitizeText(newRule.name)}" conflicts with existing enabled rule "${sanitizeText(existingRule.name)}". They both target the same ${newRule.targetType}(s): ${conflictingItemNames} with opposite/redundant actions and overlapping ${newRule.trigger.type} triggers.`;
            }
        }
        return null; // No conflicts
    };


    // --- Bulk Action Logic ---

    const toggleRuleSelection = (ruleId, isChecked) => {
        if (isChecked) {
            selectedRuleIds.add(ruleId);
        } else {
            selectedRuleIds.delete(ruleId);
        }
        const ruleItemElement = document.querySelector(`.rule-item[data-rule-id="${ruleId}"]`);
        if (ruleItemElement) {
            ruleItemElement.classList.toggle('selected', isChecked);
        }
        updateBulkActionBarVisibility();
        updateSelectAllCheckboxState();
    };

    const updateBulkActionBarVisibility = () => {
        const count = selectedRuleIds.size;
        selectedRulesCountSpan.textContent = `${count} selected`;
        if (count > 0) {
            bulkActionsBar.style.display = 'flex';
            setTimeout(() => bulkActionsBar.classList.add('active'), 10);
        } else {
            bulkActionsBar.classList.remove('active');
            setTimeout(() => bulkActionsBar.style.display = 'none', 300);
        }
    };

    const updateSelectAllCheckboxState = () => {
        const visibleRuleIds = Array.from(rulesListContainer.querySelectorAll('.rule-item')).map(el => el.dataset.ruleId);
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
            toggleRuleSelection(checkbox.value, isChecked);
        });
    };

    const bulkDeleteSelected = async () => {
        if (selectedRuleIds.size === 0) {
            showToast("No rules selected for deletion.", "info");
            return;
        }

        const confirmed = await showConfirmDialog(`Are you sure you want to delete ${selectedRuleIds.size} selected rule(s)?`);
        if (confirmed) {
            const updatedRules = allRules.filter(r => !selectedRuleIds.has(r.id));
            selectedRuleIds.clear();
            chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updatedRules }, () => {
                refreshUI();
                showToast("Selected rules deleted.", "success");
            });
        }
    };

    const bulkToggleSelected = async (enable) => {
        if (selectedRuleIds.size === 0) {
            showToast(`No rules selected to ${enable ? 'enable' : 'disable'}.`, "info");
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
                showToast(`Selected rules ${actionText}d.`, "success");
            });
        }
    };

    // --- UI View Mode Logic ---
    const toggleViewMode = () => {
        currentViewMode = currentViewMode === 'list' ? 'grid' : 'list';
        applyFiltersAndRender();
    };


    // --- Event Handlers ---

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        
        if (!validateForm()) {
            showToast('Please correct the errors in the form.', 'error');
            return;
        }

        const selectedTargetType = ruleTargetTypeSelect.value;
        const selectedTargetIds = Array.from(targetSelectorContainer.querySelectorAll('input:checked')).map(cb => cb.value);

        const ruleData = {
            id: ruleIdInput.value || `rule_${Date.now()}`,
            name: ruleNameInput.value.trim(),
            tags: ruleTagsInput.value.split(',').map(tag => tag.trim()).filter(Boolean),
            targetType: selectedTargetType, // NEW
            targetIds: selectedTargetIds, // Renamed from extensionIds
            action: ruleActionSelect.value, // This can now be 'apply' for profiles
            trigger: { type: triggerTypeSelect.value },
            enabled: allRules.find(r => r.id === ruleIdInput.value)?.enabled ?? true, // Preserve enabled state on edit
        };
        
        if (ruleData.trigger.type === 'time') {
            const selectedDays = Array.from(document.querySelectorAll('.day-selector input:checked')).map(cb => parseInt(cb.value));
            ruleData.trigger.time = ruleTimeInput.value;
            ruleData.trigger.days = selectedDays;
        } else { // URL trigger
            ruleData.trigger.url = ruleUrlInput.value.trim();
        }
        
        const conflictMessage = checkRuleConflicts(ruleData);
        if (conflictMessage) {
            showToast(`Conflict detected: ${conflictMessage}`, 'error');
            return;
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
            showToast("Rule saved successfully!", "success");
            setActivePanel('rules-list-panel');
        });
    };
    
    rulesListContainer.addEventListener('click', async (e) => {
        const ruleItem = e.target.closest('.rule-item');
        if (!ruleItem) return;
        const ruleId = ruleItem.dataset.ruleId;

        if (e.target.closest('.edit-rule-btn')) {
            const ruleToEdit = allRules.find(r => r.id === ruleId);
            if (ruleToEdit) showRuleForm(ruleToEdit);
        } 
        else if (e.target.closest('.delete-rule-btn')) {
            const ruleToDelete = allRules.find(r => r.id === ruleId);
            if (!ruleToDelete) return;
            const confirmed = await showConfirmDialog(`Are you sure you want to delete the rule "${sanitizeText(ruleToDelete.name)}"?`);
            if (confirmed) {
                const updatedRules = allRules.filter(r => r.id !== ruleId);
                selectedRuleIds.delete(ruleId);
                chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updatedRules }, () => {
                    refreshUI();
                    showToast("Rule deleted.", "success");
                });
            }
        }
        else if (e.target.classList.contains('toggle-rule-btn')) {
            const toggleInput = e.target;
            const ruleToToggle = allRules.find(r => r.id === ruleId);
            if (ruleToToggle) {
                ruleToToggle.enabled = toggleInput.checked;
                toggleInput.setAttribute('aria-checked', toggleInput.checked);
                chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: allRules }, () => {
                    refreshUI(); // Re-render to update status count if any
                    showToast(`Rule "${sanitizeText(ruleToToggle.name)}" ${ruleToToggle.enabled ? 'enabled' : 'disabled'}.`, "success");
                });
            }
        }
        else if (e.target.classList.contains('rule-select-checkbox')) {
            toggleRuleSelection(ruleId, e.target.checked);
        }
    });

    ruleSearchInput.addEventListener('input', () => {
        currentFilters.query = ruleSearchInput.value;
        applyFiltersAndRender();
    });
    
    filterStatusSelect.addEventListener('change', () => {
        currentFilters.status = filterStatusSelect.value;
        applyFiltersAndRender();
    });

    filterTriggerSelect.addEventListener('change', () => {
        currentFilters.trigger = filterTriggerSelect.value;
        applyFiltersAndRender();
    });

    filterTargetTypeSelect.addEventListener('change', () => { // NEW listener
        currentFilters.targetType = filterTargetTypeSelect.value;
        applyFiltersAndRender();
    });

    ruleTargetTypeSelect.addEventListener('change', () => { // NEW listener
        const selectedType = ruleTargetTypeSelect.value;
        populateTargetSelector(selectedType);
        populateActionTypeSelect(selectedType); // Update actions based on target type
        clearValidationError(targetSelectorError); // Clear error when type changes
        clearValidationError(ruleActionError); // Clear action error too
    });

    triggerTypeSelect.addEventListener('change', () => {
        const isTime = triggerTypeSelect.value === 'time';
        timeConditionFields.style.display = isTime ? 'block' : 'none';
        urlConditionFields.style.display = isTime ? 'none' : 'block';
        clearAllValidationErrors();
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
        
        // Default visibility for condition fields
        timeConditionFields.style.display = 'block';
        urlConditionFields.style.display = 'none';
        
        // Clear all target selectors and day checkboxes
        while (targetSelectorContainer.firstChild) {
            targetSelectorContainer.removeChild(targetSelectorContainer.firstChild);
        }
        document.querySelectorAll('.day-selector input').forEach(cb => cb.checked = false);

        if (ruleToEdit) {
            formPanelTitle.textContent = 'Edit Rule';
            ruleIdInput.value = ruleToEdit.id;
            ruleNameInput.value = ruleToEdit.name;
            ruleTagsInput.value = (ruleToEdit.tags || []).map(tag => sanitizeText(tag)).join(', ');
            
            ruleTargetTypeSelect.value = ruleToEdit.targetType; // Set target type
            populateTargetSelector(ruleToEdit.targetType, ruleToEdit.targetIds); // Populate based on type and selected IDs
            populateActionTypeSelect(ruleToEdit.targetType, ruleToEdit.action); // Populate actions based on type
            ruleActionSelect.value = ruleToEdit.action; // Set specific action

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
            ruleTargetTypeSelect.value = 'extension'; // Default to extensions
            populateTargetSelector('extension'); // Populate with extensions initially
            populateActionTypeSelect('extension'); // Populate actions for extensions
        }
        
        triggerTypeSelect.dispatchEvent(new Event('change')); // Trigger change to show/hide condition fields correctly
        ruleTargetTypeSelect.dispatchEvent(new Event('change')); // Trigger change to populate target selector
        setActivePanel('add-rule-panel');
        ruleNameInput.focus();
    };

    // --- Toast Notification ---
    const showToast = (message, type = 'info') => {
        const toast = createElement('div', `toast ${type}`, message);
        toastContainer.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 10); 
        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove());
        }, 3000);
    };

    // --- NEW: Import/Export Logic ---

    const handleExportRules = () => {
        if (allRules.length === 0) {
            showToast("No rules to export.", "info");
            return;
        }
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allRules, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `modcore_rules_backup_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        showToast("Rules exported successfully.", "success");
    };

    const handleImportRules = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedRules = JSON.parse(e.target.result);
                // Basic validation for imported rules structure
                if (!Array.isArray(importedRules) || (importedRules.length > 0 && !importedRules[0].id)) {
                    throw new Error("Invalid or corrupted rules file: Must be an array of rule objects with 'id'.");
                }
                // Further validation could check for targetType, action etc.

                const ruleMap = new Map(allRules.map(rule => [rule.id, rule]));
                importedRules.forEach(rule => {
                    // Ensure new properties are set if missing from older imported rules
                    rule.targetType = rule.targetType || 'extension';
                    // For backward compatibility: if old `extensionIds` exist, use them for `targetIds`
                    rule.targetIds = rule.targetIds || rule.extensionIds || []; 
                    if (rule.extensionIds) delete rule.extensionIds; // Clean up old property if present

                    // Ensure action is valid for the target type
                    rule.action = rule.action || 'enable'; // Default to 'enable'
                    if (rule.targetType === 'profile' && rule.action !== 'apply') {
                        rule.action = 'apply'; // Force 'apply' for profiles if imported incorrectly
                    } else if (rule.targetType === 'group' && !['enable', 'disable', 'toggle'].includes(rule.action)) {
                        rule.action = 'toggle'; // Default to toggle for groups if unknown action
                    } else if (rule.targetType === 'extension' && !['enable', 'disable'].includes(rule.action)) {
                        rule.action = 'enable'; // Default to enable for extensions if unknown action
                    }

                    ruleMap.set(rule.id, rule);
                });
                const updatedRules = Array.from(ruleMap.values());

                const confirmed = await showConfirmDialog(`Import ${importedRules.length} rules? This will merge with existing rules, overwriting those with the same ID.`);
                if (confirmed) {
                    chrome.runtime.sendMessage({ type: 'SAVE_RULES', payload: updatedRules }, () => {
                        refreshUI();
                        showToast("Rules imported successfully!", "success");
                    });
                }
            } catch (error) {
                console.error("Import error:", error);
                showToast(`Import failed: ${sanitizeText(error.message)}`, "error");
            } finally {
                importFileInput.value = '';
            }
        };
        reader.readAsText(file);
    };

    // --- Initial Load & Event Listeners ---
    
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            const panelId = button.getAttribute('aria-controls');
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
    viewToggleBtn.addEventListener('click', toggleViewMode);

    exportRulesBtn.addEventListener('click', handleExportRules);
    importRulesBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', handleImportRules);

    // Initial population of the target type and action type selects
    // These will be properly set when showRuleForm is called for new rules or edits
    populateTargetSelector('extension'); // Default populate for extensions
    populateActionTypeSelect('extension'); // Default populate for extensions


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

    refreshUI();
    setActivePanel('rules-list-panel'); // Ensure rules list is visible on load
});
