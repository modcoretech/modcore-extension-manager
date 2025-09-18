/**
 * history.js - Refactored for new UI/UX with advanced features
 * Manages the Extension Activity History page with a design consistent
 * with the rest of the Modcore Extension Manager.
 */
(() => {
    'use strict';

    // --- Configuration ---
    const SEARCH_DEBOUNCE_MS = 200;
    const TOAST_DURATION_MS = 3000;
    const UNDO_DURATION_MS = 8000;
    const EVENT_TYPES = ['installed', 'uninstalled', 'updated', 'permissions_updated', 'enabled', 'disabled'];

    // --- State ---
    let allHistoryRecords = [];
    let filteredRecords = [];
    let currentFilters = {
        searchTerm: '',
        eventTypes: new Set(EVENT_TYPES),
        startDate: null,
        endDate: null
    };
    let settings = {
        trackingEnabled: true,
        sortOrder: 'desc',
        logsPerPage: 25,
        pruneDays: 90,
        recordLimit: 1000,
        pruneOnLimit: true,
        displayTimestamps: true,
        compactMode: false
    };
    let currentPage = 1;
    let totalPages = 1;

    // --- DOM Cache ---
    const dom = {};

    // --- Utility Functions ---
    const debounce = (func, delay) => {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    };

    const showToast = (message, type = 'info', duration = TOAST_DURATION_MS, action = null) => {
        if (!dom.toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        if (action) {
            toast.classList.add('undo');
            const messageParagraph = document.createElement('p');
            messageParagraph.textContent = message;
            const undoButton = document.createElement('button');
            undoButton.className = 'btn secondary';
            undoButton.textContent = 'Undo';
            undoButton.addEventListener('click', action.handler, { once: true });
            toast.append(messageParagraph, undoButton);
        } else {
            toast.textContent = message;
        }

        dom.toastContainer.appendChild(toast);
        requestAnimationFrame(() => {
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
                toast.addEventListener('transitionend', () => toast.remove(), { once: true });
            }, duration);
        });
    };

    const setBusyState = (isBusy) => {
        dom.initialLoading.style.display = isBusy ? 'flex' : 'none';
        dom.contentArea.style.opacity = isBusy ? '0.5' : '1';
        dom.contentArea.style.pointerEvents = isBusy ? 'none' : 'auto';
        dom.sidebarButtons.forEach(btn => btn.disabled = isBusy);
    };

    const showModal = (modalId) => {
        const modal = dom[modalId];
        if (!modal) return;
        dom.modalBackdrop.hidden = false;
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => {
            modal.classList.add('is-visible');
        });
    };

    const hideModal = (modalId) => {
        const modal = dom[modalId];
        if (!modal) return;
        modal.classList.remove('is-visible');
        modal.addEventListener('transitionend', () => {
            dom.modalBackdrop.hidden = true;
            modal.hidden = true;
            modal.setAttribute('aria-hidden', 'true');
        }, { once: true });
    };

    const formatEventType = (type) => {
        return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    // --- Initialization ---
    const initializeApp = async () => {
        cacheDomElements();
        setupEventListeners();
        await loadSettings();
        setBusyState(true);
        await loadInitialData();
        buildFilterCheckboxes();
        if (dom.currentYear) dom.currentYear.textContent = new Date().getFullYear();
    };

    const cacheDomElements = () => {
        // Main layout
        dom.sidebar = document.querySelector('.sidebar');
        dom.contentArea = document.querySelector('.content-area');
        dom.toastContainer = document.getElementById('toast-container');
        dom.initialLoading = document.getElementById('initial-loading-indicator');
        dom.currentYear = document.getElementById('current-year');

        // Panels
        dom.panels = document.querySelectorAll('.content-panel');
        dom.sidebarButtons = document.querySelectorAll('.sidebar-button');
        dom.body = document.body;

        // History Panel
        dom.historyContentWrapper = document.getElementById('history-content-wrapper');
        dom.historyList = document.getElementById('history-list');
        dom.noHistoryMessage = document.getElementById('no-history-message');
        dom.searchInput = document.getElementById('search-input');
        dom.filterToggleButton = document.getElementById('filter-toggle-btn');
        dom.filterPanel = document.getElementById('filter-panel');
        dom.eventTypeFilters = document.getElementById('event-type-filters');
        dom.startDateInput = document.getElementById('start-date-input');
        dom.endDateInput = document.getElementById('end-date-input');
        dom.clearAllButton = document.getElementById('clear-all-btn');
        dom.importButton = document.getElementById('import-btn');
        dom.exportButton = document.getElementById('export-btn');
        dom.importInput = document.getElementById('import-input');
        dom.resetFiltersBtn = document.getElementById('reset-filters-btn');

        // Pagination
        dom.paginationControls = document.getElementById('pagination-controls');
        dom.prevPageBtn = document.getElementById('prev-page-btn');
        dom.nextPageBtn = document.getElementById('next-page-btn');
        dom.currentPageDisplay = document.getElementById('current-page-display');
        dom.totalPagesDisplay = document.getElementById('total-pages-display');

        // Settings Panel
        dom.trackingEnabledToggle = document.getElementById('tracking-enabled-toggle');
        dom.pruneDaysInput = document.getElementById('prune-days-input');
        dom.pruneNowButton = document.getElementById('prune-now-btn');
        dom.pruneOnLimitToggle = document.getElementById('prune-on-limit-toggle');
        dom.sortOrderSelect = document.getElementById('sort-order-select');
        dom.logsPerPageInput = document.getElementById('logs-per-page-input');
        dom.recordLimitInput = document.getElementById('record-limit-input');
        dom.displayTimestampsToggle = document.getElementById('display-timestamps-toggle');
        dom.compactModeToggle = document.getElementById('compact-mode-toggle');
        dom.saveSettingsButton = document.getElementById('save-settings-btn');
        dom.pruneInactiveBtn = document.getElementById('prune-inactive-btn');
        dom.pruneByTypeBtn = document.getElementById('prune-by-type-btn');

        // Modals
        dom.limitModal = document.getElementById('limit-modal');
        dom.pruneByTypeModal = document.getElementById('prune-by-type-modal');
        dom.modalBackdrop = document.getElementById('modal-backdrop');
        dom.modalPruneBtn = document.getElementById('modal-prune-btn');
        dom.modalDisableBtn = document.getElementById('modal-disable-btn');
        dom.modalLimitValue = document.getElementById('modal-limit-value');
        dom.pruneTypeOptions = document.getElementById('prune-type-options');
        dom.pruneTypeCancelBtn = document.getElementById('prune-type-cancel-btn');
        dom.pruneTypeConfirmBtn = document.getElementById('prune-type-confirm-btn');
    };

    const setupEventListeners = () => {
        // Panel Navigation
        dom.sidebarButtons.forEach(btn => {
            btn.addEventListener('click', () => switchPanel(btn.dataset.panelTarget));
        });

        // History Panel Listeners
        dom.searchInput.addEventListener('input', debounce(handleSearchInput, SEARCH_DEBOUNCE_MS));
        dom.filterToggleButton.addEventListener('click', toggleFilterPanel);
        dom.resetFiltersBtn.addEventListener('click', handleResetFilters);
        dom.clearAllButton.addEventListener('click', handleClearAllHistory);
        dom.exportButton.addEventListener('click', handleExport);
        dom.importButton.addEventListener('click', () => dom.importInput.click());
        dom.importInput.addEventListener('change', handleImport);
        dom.eventTypeFilters.addEventListener('change', handleFilterChange);
        dom.startDateInput.addEventListener('change', handleDateFilterChange);
        dom.endDateInput.addEventListener('change', handleDateFilterChange);

        // Pagination
        dom.prevPageBtn.addEventListener('click', () => handlePageChange(-1));
        dom.nextPageBtn.addEventListener('click', () => handlePageChange(1));

        // Settings Panel Listeners
        dom.saveSettingsButton.addEventListener('click', saveSettings);
        dom.pruneNowButton.addEventListener('click', handlePruneNow);
        dom.pruneInactiveBtn.addEventListener('click', handlePruneInactive);
        dom.pruneByTypeBtn.addEventListener('click', handlePruneByTypeModalOpen);
        dom.sortOrderSelect.addEventListener('change', () => applyFiltersAndSort());
        dom.trackingEnabledToggle.addEventListener('change', updateSettingsControlsState);
        dom.pruneOnLimitToggle.addEventListener('change', updateSettingsControlsState);
        dom.displayTimestampsToggle.addEventListener('change', renderHistory);
        dom.compactModeToggle.addEventListener('change', toggleCompactMode);

        // Modals
        dom.modalPruneBtn.addEventListener('click', handleModalPrune);
        dom.modalDisableBtn.addEventListener('click', handleModalDisable);
        dom.pruneTypeCancelBtn.addEventListener('click', () => hideModal('pruneByTypeModal'));
        dom.pruneTypeConfirmBtn.addEventListener('click', handlePruneByTypeConfirm);
    };

    // --- Data & State Management ---
    const loadSettings = async () => {
        try {
            const settingsResult = await chrome.runtime.sendMessage({ type: 'GET_HISTORY_SETTINGS' });
            if (settingsResult?.settings) {
                settings = { ...settings, ...settingsResult.settings };
            }
            // Sync settings to UI
            dom.trackingEnabledToggle.checked = settings.trackingEnabled;
            dom.pruneDaysInput.value = settings.pruneDays;
            dom.pruneOnLimitToggle.checked = settings.pruneOnLimit;
            dom.sortOrderSelect.value = settings.sortOrder;
            dom.logsPerPageInput.value = settings.logsPerPage;
            dom.recordLimitInput.value = settings.recordLimit;
            dom.displayTimestampsToggle.checked = settings.displayTimestamps;
            dom.compactModeToggle.checked = settings.compactMode;
            updateSettingsControlsState();
            toggleCompactMode(null, settings.compactMode);
        } catch (error) {
            console.error('Error loading settings:', error);
            showToast('Failed to load settings.', 'error');
        }
    };

    const loadInitialData = async () => {
        try {
            const historyResult = await chrome.runtime.sendMessage({ type: 'GET_EXTENSION_HISTORY' });
            allHistoryRecords = historyResult.history || [];
            applyFiltersAndSort();
            checkHistoryLimit();
        } catch (error) {
            console.error('Error loading initial data:', error);
            showToast('Failed to load history data.', 'error');
            dom.noHistoryMessage.textContent = 'Could not load history.';
            dom.noHistoryMessage.hidden = false;
        } finally {
            setBusyState(false);
        }
    };

    const applyFiltersAndSort = () => {
        filteredRecords = allHistoryRecords.filter(record => {
            const searchMatch = !currentFilters.searchTerm ||
                record.extensionName.toLowerCase().includes(currentFilters.searchTerm) ||
                (record.details && record.details.toLowerCase().includes(currentFilters.searchTerm));
            const typeMatch = currentFilters.eventTypes.size === 0 || currentFilters.eventTypes.has(record.eventType);
            const dateMatch = (!currentFilters.startDate || new Date(record.timestamp) >= new Date(currentFilters.startDate)) &&
                (!currentFilters.endDate || new Date(record.timestamp) <= new Date(new Date(currentFilters.endDate).setHours(23, 59, 59, 999)));
            return searchMatch && typeMatch && dateMatch;
        });

        // Sorting logic based on new settings
        const sortOrder = settings.sortOrder;
        if (sortOrder === 'desc' || sortOrder === 'asc') {
            filteredRecords.sort((a, b) => {
                return sortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
            });
        } else if (sortOrder === 'name') {
            filteredRecords.sort((a, b) => a.extensionName.localeCompare(b.extensionName));
        } else if (sortOrder === 'type') {
            filteredRecords.sort((a, b) => a.eventType.localeCompare(b.eventType) || b.timestamp - a.timestamp);
        }
        
        currentPage = 1;
        totalPages = Math.max(1, Math.ceil(filteredRecords.length / settings.logsPerPage));
        renderHistory();
    };

    const updateSettingsControlsState = () => {
        const isTrackingEnabled = dom.trackingEnabledToggle.checked;
        dom.pruneNowButton.disabled = !isTrackingEnabled;
        dom.pruneDaysInput.disabled = !isTrackingEnabled;
        dom.pruneOnLimitToggle.disabled = !isTrackingEnabled;
        dom.recordLimitInput.disabled = !isTrackingEnabled;
    };

    const checkHistoryLimit = () => {
        if (!settings.trackingEnabled) return;
        if (allHistoryRecords.length > settings.recordLimit) {
            if (settings.pruneOnLimit) {
                handleModalPrune(false);
            } else {
                showModal('limitModal');
            }
        }
    };

    // --- UI Rendering ---
    const switchPanel = (targetId) => {
        dom.sidebarButtons.forEach(btn => {
            const active = btn.dataset.panelTarget === targetId;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-current', active ? 'page' : 'false');
        });
        dom.panels.forEach(panel => {
            panel.hidden = panel.id !== targetId;
            panel.classList.toggle('active', panel.id === targetId);
        });
    };

    const buildFilterCheckboxes = () => {
        while (dom.eventTypeFilters.firstChild) {
            dom.eventTypeFilters.removeChild(dom.eventTypeFilters.firstChild);
        }
        const fragment = document.createDocumentFragment();
        EVENT_TYPES.forEach(type => {
            const label = document.createElement('label');
            label.className = 'checkbox-container';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = type;
            input.checked = currentFilters.eventTypes.has(type);
            input.addEventListener('change', handleFilterChange);
            const checkmark = document.createElement('span');
            checkmark.className = 'checkmark';
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
            svg.appendChild(path);
            checkmark.appendChild(svg);
            const text = document.createTextNode(formatEventType(type));
            label.append(input, checkmark, text);
            fragment.appendChild(label);
        });
        dom.eventTypeFilters.appendChild(fragment);
    };

    const renderHistory = () => {
        while (dom.historyList.firstChild) {
            dom.historyList.removeChild(dom.historyList.firstChild);
        }
        const startIndex = (currentPage - 1) * settings.logsPerPage;
        const endIndex = startIndex + settings.logsPerPage;
        const recordsToDisplay = filteredRecords.slice(startIndex, endIndex);

        dom.noHistoryMessage.hidden = filteredRecords.length > 0;

        if (filteredRecords.length === 0) {
            dom.paginationControls.hidden = true;
            return;
        }

        const fragment = document.createDocumentFragment();

        if (settings.sortOrder === 'group') {
            const groupedRecords = groupRecordsByExtension(recordsToDisplay);
            for (const name in groupedRecords) {
                const groupHeader = document.createElement('h3');
                groupHeader.className = 'history-group-header';
                groupHeader.textContent = name;
                fragment.appendChild(groupHeader);
                groupedRecords[name].forEach(record => fragment.appendChild(createHistoryItemElement(record)));
            }
        } else {
            const groupedByDate = groupRecordsByDate(recordsToDisplay);
            for (const dateKey in groupedByDate) {
                const dayHeader = document.createElement('h3');
                dayHeader.className = 'history-day-header';
                dayHeader.textContent = dateKey;
                fragment.appendChild(dayHeader);
                groupedByDate[dateKey].forEach(record => fragment.appendChild(createHistoryItemElement(record)));
            }
        }

        dom.historyList.appendChild(fragment);
        renderPagination();
    };

    const createHistoryItemElement = (record) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.recordId = record.id;
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'listitem');
        
        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'item-icon';
        const icon = document.createElement('span');
        icon.className = `icon icon-${record.eventType}`;
        icon.setAttribute('aria-label', formatEventType(record.eventType));
        const badge = document.createElement('span');
        badge.className = 'status-badge';
        icon.appendChild(badge);
        iconWrapper.appendChild(icon);

        const content = document.createElement('div');
        content.className = 'history-item-content';
        const header = document.createElement('div');
        header.className = 'history-item-header';
        header.textContent = `${record.extensionName} (v${record.extensionVersion || 'N/A'})`;
        const details = document.createElement('div');
        details.className = 'history-item-details';
        details.textContent = `${formatEventType(record.eventType)}${record.details ? ` - ${record.details}` : ''}`;
        content.append(header, details);

        item.append(iconWrapper, content);

        if (settings.displayTimestamps) {
            const meta = document.createElement('div');
            meta.className = 'history-item-meta';
            const date = new Date(record.timestamp);
            meta.textContent = date.toLocaleTimeString();
            item.appendChild(meta);
        }

        return item;
    };

    const groupRecordsByDate = (records) => {
        const today = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const yesterday = new Date(Date.now() - 86400000).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        return records.reduce((acc, record) => {
            const recordDate = new Date(record.timestamp);
            let dateKey = recordDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

            if (dateKey === today) dateKey = 'Today';
            else if (dateKey === yesterday) dateKey = 'Yesterday';

            if (!acc[dateKey]) acc[dateKey] = [];
            acc[dateKey].push(record);
            return acc;
        }, {});
    };

    const groupRecordsByExtension = (records) => {
        const grouped = records.reduce((acc, record) => {
            const extensionName = record.extensionName || 'Unknown Extension';
            if (!acc[extensionName]) {
                acc[extensionName] = [];
            }
            acc[extensionName].push(record);
            return acc;
        }, {});

        for (const name in grouped) {
            grouped[name].sort((a, b) => b.timestamp - a.timestamp);
        }
        return grouped;
    };

    const toggleFilterPanel = () => {
        const isVisible = dom.filterPanel.classList.toggle('is-visible');
        dom.filterToggleButton.setAttribute('aria-expanded', isVisible);
    };

    const renderPagination = () => {
        dom.paginationControls.hidden = totalPages <= 1;
        dom.prevPageBtn.disabled = currentPage === 1;
        dom.nextPageBtn.disabled = currentPage === totalPages;
        dom.currentPageDisplay.textContent = currentPage;
        dom.totalPagesDisplay.textContent = totalPages;
    };

    const toggleCompactMode = (e, isChecked = dom.compactModeToggle.checked) => {
        dom.body.classList.toggle('compact-mode', isChecked);
    };

    // --- Event Handlers ---
    const handleSearchInput = (e) => {
        currentFilters.searchTerm = e.target.value.trim().toLowerCase();
        applyFiltersAndSort();
    };

    const handleFilterChange = (e) => {
        const checkbox = e.target;
        if (checkbox.checked) {
            currentFilters.eventTypes.add(checkbox.value);
        } else {
            currentFilters.eventTypes.delete(checkbox.value);
        }
        applyFiltersAndSort();
    };

    const handleDateFilterChange = () => {
        currentFilters.startDate = dom.startDateInput.value ? new Date(dom.startDateInput.value).getTime() : null;
        currentFilters.endDate = dom.endDateInput.value ? new Date(dom.endDateInput.value).getTime() : null;
        applyFiltersAndSort();
    };
    
    const handleResetFilters = () => {
        currentFilters = {
            searchTerm: '',
            eventTypes: new Set(EVENT_TYPES),
            startDate: null,
            endDate: null
        };
        dom.searchInput.value = '';
        dom.startDateInput.value = '';
        dom.endDateInput.value = '';
        buildFilterCheckboxes(); // Re-check all event type checkboxes
        applyFiltersAndSort();
        showToast('Filters have been reset.', 'info');
    };

    const handlePageChange = (direction) => {
        const newPage = currentPage + direction;
        if (newPage > 0 && newPage <= totalPages) {
            currentPage = newPage;
            renderHistory();
        }
    };

    const handleClearAllHistory = async () => {
        const previousRecords = allHistoryRecords;
        const undoHandler = async () => {
             try {
                await chrome.runtime.sendMessage({ type: 'IMPORT_HISTORY', payload: previousRecords });
                await loadInitialData();
                showToast('History restore successful.', 'success');
            } catch (error) {
                showToast('Failed to restore history.', 'error');
                console.error('Failed to undo clear all:', error);
            }
        };

        if (!confirm("Are you sure you want to delete ALL history records? This cannot be undone.")) return;
        try {
            await chrome.runtime.sendMessage({ type: 'CLEAR_EXTENSION_HISTORY' });
            allHistoryRecords = [];
            applyFiltersAndSort();
            showToast('All history has been cleared.', 'success', UNDO_DURATION_MS, { handler: undoHandler });
        } catch (error) {
            console.error('Error clearing history:', error);
            showToast('Failed to clear history.', 'error');
        }
    };

    const saveSettings = async () => {
        settings.trackingEnabled = dom.trackingEnabledToggle.checked;
        settings.pruneDays = parseInt(dom.pruneDaysInput.value, 10);
        settings.pruneOnLimit = dom.pruneOnLimitToggle.checked;
        settings.sortOrder = dom.sortOrderSelect.value;
        settings.logsPerPage = parseInt(dom.logsPerPageInput.value, 10);
        settings.recordLimit = parseInt(dom.recordLimitInput.value, 10);
        settings.displayTimestamps = dom.displayTimestampsToggle.checked;
        settings.compactMode = dom.compactModeToggle.checked;

        if (isNaN(settings.pruneDays) || settings.pruneDays < 1) {
            settings.pruneDays = 1;
            dom.pruneDaysInput.value = 1;
        }
        if (isNaN(settings.recordLimit) || settings.recordLimit < 100) {
            settings.recordLimit = 100;
            dom.recordLimitInput.value = 100;
        }
        if (isNaN(settings.logsPerPage) || settings.logsPerPage < 1) {
            settings.logsPerPage = 1;
            dom.logsPerPageInput.value = 1;
        }

        try {
            await chrome.runtime.sendMessage({ type: 'UPDATE_HISTORY_SETTINGS', payload: settings });
            showToast('Settings saved successfully.', 'success');
            applyFiltersAndSort();
            checkHistoryLimit();
        } catch (error) {
            console.error('Error saving settings:', error);
            showToast('Failed to save settings.', 'error');
        }
    };

    const handlePruneNow = async () => {
        const days = parseInt(dom.pruneDaysInput.value, 10);
        if (isNaN(days) || days < 1) {
            showToast('Please enter a valid number of days (1 or more).', 'error');
            return;
        }
        if (!confirm(`Are you sure you want to prune all history records older than ${days} days?`)) return;

        try {
            await chrome.runtime.sendMessage({ type: 'PRUNE_HISTORY_BY_DAYS', payload: { daysToKeep: days } });
            await loadInitialData();
            showToast(`History records older than ${days} days have been pruned.`, 'success');
        } catch (error) {
            console.error('Error pruning history:', error);
            showToast('Failed to prune history.', 'error');
        }
    };

    const handlePruneInactive = async () => {
        if (!confirm("Are you sure you want to prune all records for extensions that are currently uninstalled?")) return;
        try {
            await chrome.runtime.sendMessage({ type: 'PRUNE_INACTIVE_EXTENSIONS' });
            await loadInitialData();
            showToast('History for inactive extensions has been pruned.', 'success');
        } catch (error) {
            console.error('Error pruning inactive history:', error);
            showToast('Failed to prune inactive history.', 'error');
        }
    };

    const handlePruneByTypeModalOpen = () => {
        while (dom.pruneTypeOptions.firstChild) {
            dom.pruneTypeOptions.removeChild(dom.pruneTypeOptions.firstChild);
        }
        const fragment = document.createDocumentFragment();
        EVENT_TYPES.forEach(type => {
            const label = document.createElement('label');
            label.className = 'checkbox-container';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = type;
            input.addEventListener('change', () => {
                const checkedCount = dom.pruneTypeOptions.querySelectorAll('input:checked').length;
                dom.pruneTypeConfirmBtn.disabled = checkedCount === 0;
            });
            const checkmark = document.createElement('span');
            checkmark.className = 'checkmark';
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
            svg.appendChild(path);
            checkmark.appendChild(svg);
            const text = document.createTextNode(formatEventType(type));
            label.append(input, checkmark, text);
            fragment.appendChild(label);
        });
        dom.pruneTypeOptions.appendChild(fragment);
        dom.pruneTypeConfirmBtn.disabled = true;
        showModal('pruneByTypeModal');
    };

    const handlePruneByTypeConfirm = async () => {
        const typesToPrune = Array.from(dom.pruneTypeOptions.querySelectorAll('input:checked')).map(input => input.value);
        if (typesToPrune.length === 0) return;
        if (!confirm(`Are you sure you want to prune all history records with the selected event types?`)) return;

        try {
            await chrome.runtime.sendMessage({ type: 'PRUNE_HISTORY_BY_TYPES', payload: typesToPrune });
            await loadInitialData();
            showToast('History for selected event types has been pruned.', 'success');
            hideModal('pruneByTypeModal');
        } catch (error) {
            console.error('Error pruning by type:', error);
            showToast('Failed to prune history by type.', 'error');
        }
    };

    const handleModalPrune = async (showToastMessage = true) => {
        try {
            await chrome.runtime.sendMessage({ type: 'PRUNE_HISTORY_TO_LIMIT', payload: { limit: settings.recordLimit } });
            await loadInitialData();
            hideModal('limitModal');
            if (showToastMessage) {
                showToast(`History records pruned to meet the limit of ${settings.recordLimit}.`, 'success');
            }
        } catch (error) {
            console.error('Error pruning history to limit:', error);
            if (showToastMessage) {
                showToast('Failed to prune history to limit.', 'error');
            }
        }
    };

    const handleModalDisable = async () => {
        try {
            dom.trackingEnabledToggle.checked = false;
            await saveSettings();
            hideModal('limitModal');
            showToast('History tracking has been disabled.', 'info');
        } catch (error) {
            console.error('Error disabling history:', error);
            showToast('Failed to disable history tracking.', 'error');
        }
    };

    const handleExport = () => {
        const dataStr = JSON.stringify(allHistoryRecords, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `modcore_history_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('History exported.', 'success');
    };

    const handleImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedRecords = JSON.parse(e.target.result);
                if (!Array.isArray(importedRecords)) {
                    throw new Error("Invalid JSON format. Expected an array of records.");
                }
                await chrome.runtime.sendMessage({ type: 'IMPORT_HISTORY', payload: importedRecords });
                await loadInitialData();
                showToast(`Successfully imported ${importedRecords.length} records.`, 'success');
            } catch (error) {
                console.error('Import failed:', error);
                showToast(`Import failed: ${error.message}`, 'error');
            }
            event.target.value = null;
        };
        reader.readAsText(file);
    };

    const handleKeyboardShortcuts = (e) => {
        if (e.altKey) {
            if (e.key === 'f') {
                e.preventDefault();
                dom.searchInput.focus();
            } else if (e.key === 'g') {
                e.preventDefault();
                toggleFilterPanel();
            } else if (e.key === 'r') {
                e.preventDefault();
                handleResetFilters();
            } else if (e.key === 'c') {
                e.preventDefault();
                handleClearAllHistory();
            } else if (e.key === 's') {
                e.preventDefault();
                switchPanel('panel-settings');
            } else if (e.key === 'h') {
                e.preventDefault();
                switchPanel('panel-help');
            } else if (e.key === ',' || e.key === '<') {
                e.preventDefault();
                dom.prevPageBtn.click();
            } else if (e.key === '.' || e.key === '>') {
                e.preventDefault();
                dom.nextPageBtn.click();
            }
        }
    };

    // --- Entry Point ---
    document.addEventListener('DOMContentLoaded', initializeApp);
    document.addEventListener('keydown', handleKeyboardShortcuts);
})();
