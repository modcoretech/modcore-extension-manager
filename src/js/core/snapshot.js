document.addEventListener('DOMContentLoaded', () => {

    // =====================================================================
    // CONSTANTS
    // =====================================================================
    const STORAGE_TYPES = ['chromeLocal', 'chromeSync', 'webLocal', 'webSession'];
    const STORAGE_NAMES = {
        chromeLocal: 'Chrome Local',
        chromeSync:  'Chrome Sync',
        webLocal:    'Web Local',
        webSession:  'Web Session',
    };
    const TOAST_DURATION = 4000;

    // =====================================================================
    // DOM REFERENCES
    // =====================================================================

    // Navigation
    const sidebarButtons = document.querySelectorAll('.sidebar-button');
    const contentPanels  = document.querySelectorAll('.content-panel');

    // Wizard: Welcome
    const wizardWelcome     = document.getElementById('br-welcome');
    const cardBackup        = document.getElementById('card-backup');
    const cardRestore       = document.getElementById('card-restore');

    // Wizard: Backup Step 1 (Storage areas)
    const backupStep1       = document.getElementById('br-backup-step1');
    const backupBackWelcome = document.getElementById('backup-back-welcome');
    const backupCancelS1    = document.getElementById('backup-cancel-step1');
    const backupNextS1      = document.getElementById('backup-next-step1');
    const backupS1Error     = document.getElementById('backup-step1-error');
    const backupCheckboxes  = {
        chromeLocal:  document.getElementById('wiz-backup-chromeLocal'),
        chromeSync:   document.getElementById('wiz-backup-chromeSync'),
        webLocal:     document.getElementById('wiz-backup-webLocal'),
        webSession:   document.getElementById('wiz-backup-webSession'),
    };

    // Wizard: Backup Step 2 (File name)
    const backupStep2       = document.getElementById('br-backup-step2');
    const backupBackS1      = document.getElementById('backup-back-step1');
    const backupCancelS2    = document.getElementById('backup-cancel-step2');
    const backupNextS2      = document.getElementById('backup-next-step2');
    const backupS2Error     = document.getElementById('backup-step2-error');
    const backupFilename    = document.getElementById('wiz-backup-filename');

    // Wizard: Backup Step 3 (Review)
    const backupStep3       = document.getElementById('br-backup-step3');
    const backupBackS2      = document.getElementById('backup-back-step2');
    const backupCancelS3    = document.getElementById('backup-cancel-step3');
    const backupCreateFinal = document.getElementById('backup-create-final');
    const backupS3Error     = document.getElementById('backup-step3-error');
    const reviewBackupName  = document.getElementById('review-backup-filename');
    const reviewBackupAreas = document.getElementById('review-backup-areas');
    const reviewBackupSize  = document.getElementById('review-backup-size');

    // Wizard: Restore Step 1 (Upload)
    const restoreStep1      = document.getElementById('br-restore-step1');
    const restoreBackWelcome= document.getElementById('restore-back-welcome');
    const restoreCancelS1   = document.getElementById('restore-cancel-step1');
    const restoreNextS1     = document.getElementById('restore-next-step1');
    const restoreS1Error    = document.getElementById('restore-step1-error');
    const restoreFileInput  = document.getElementById('wiz-restore-file');
    const restoreUploadZone = document.getElementById('restore-upload-zone');
    const restoreFileInfo   = document.getElementById('restore-file-info');
    const restoreFileName   = document.getElementById('restore-file-name');
    const restoreFileRemove = document.getElementById('restore-file-remove');

    // Wizard: Restore Step 2 (Select areas)
    const restoreStep2      = document.getElementById('br-restore-step2');
    const restoreBackS1     = document.getElementById('restore-back-step1');
    const restoreCancelS2   = document.getElementById('restore-cancel-step2');
    const restoreNextS2     = document.getElementById('restore-next-step2');
    const restoreS2Error    = document.getElementById('restore-step2-error');
    const restoreMeta       = document.getElementById('restore-meta');
    const restoreCheckboxes = {
        chromeLocal:  document.getElementById('wiz-restore-chromeLocal'),
        chromeSync:   document.getElementById('wiz-restore-chromeSync'),
        webLocal:     document.getElementById('wiz-restore-webLocal'),
        webSession:   document.getElementById('wiz-restore-webSession'),
    };
    const restoreStatuses = {
        chromeLocal:  document.getElementById('wiz-restore-status-chromeLocal'),
        chromeSync:   document.getElementById('wiz-restore-status-chromeSync'),
        webLocal:     document.getElementById('wiz-restore-status-webLocal'),
        webSession:   document.getElementById('wiz-restore-status-webSession'),
    };

    // Wizard: Restore Step 3 (Confirm)
    const restoreStep3      = document.getElementById('br-restore-step3');
    const restoreBackS2     = document.getElementById('restore-back-step2');
    const restoreCancelS3   = document.getElementById('restore-cancel-step3');
    const restoreFinal      = document.getElementById('restore-final');
    const restoreS3Error    = document.getElementById('restore-step3-error');
    const reviewRestoreFile = document.getElementById('review-restore-filename');
    const reviewRestoreAreas= document.getElementById('review-restore-areas');
    const reviewRestoreDate = document.getElementById('review-restore-date');

    // Global error
    const backupRestoreError = document.getElementById('backupRestoreError');

    // Data Management
    const clearSelectedDataBtn = document.getElementById('clearSelectedDataBtn');
    const dataManagementError  = document.getElementById('dataManagementError');

    // Modals
    const loadingOverlay  = document.getElementById('loading-overlay');
    const modalOverlay    = document.getElementById('confirmation-modal');
    const modalTitle      = document.getElementById('modal-title');
    const modalMessage    = document.getElementById('modal-message');
    const modalCancelBtn  = document.getElementById('modal-cancel');
    const modalConfirmBtn = document.getElementById('modal-confirm');

    // =====================================================================
    // STATE
    // =====================================================================
    let currentBackup = null;

    let wizardState = {
        backupAreas: [],
        backupFilename: '',
        restoreFile: null,
        restoreAreas: [],
    };

    // =====================================================================
    // UTILITIES
    // =====================================================================

    function setText(el, text) {
        if (el) el.textContent = text;
    }

    function formatBytes(bytes) {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
        return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
    }

    function estimateSize(data) {
        try { return new Blob([JSON.stringify(data)]).size; } catch { return 0; }
    }

    // Returns a filesystem-safe "YYYY-MM-DD_HHMMSS" timestamp for the given date.
    // Shared by both the review-step preview and the actual downloaded file name,
    // so the two always stay in sync.
    function formatTimestamp(date) {
        const p = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
    }

    function storageDisplayName(type) {
        return STORAGE_NAMES[type] || type;
    }

    function renderBadges(container, types) {
        container.textContent = '';
        types.forEach(type => {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = storageDisplayName(type);
            container.appendChild(badge);
        });
    }

    // =====================================================================
    // TOAST
    // =====================================================================

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');
        toast.textContent = message;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        }, TOAST_DURATION);
    }

    // =====================================================================
    // ERROR DISPLAY
    // =====================================================================

    function showError(el, message) {
        if (!el) return;
        const msgEl = el.querySelector('.error-message, .wizard-validation-text');
        if (msgEl) msgEl.textContent = message;
        el.hidden = false;
        el.setAttribute('role', 'alert');
    }

    function hideError(el) {
        if (!el) return;
        el.hidden = true;
        const msgEl = el.querySelector('.error-message, .wizard-validation-text');
        if (msgEl) msgEl.textContent = '';
        el.removeAttribute('role');
    }

    // =====================================================================
    // LOADING
    // =====================================================================

    function showLoading(message = 'Processing...') {
        const p = loadingOverlay.querySelector('p');
        if (p) p.textContent = message;
        loadingOverlay.hidden = false;
        loadingOverlay.setAttribute('aria-busy', 'true');
    }

    function hideLoading() {
        loadingOverlay.hidden = true;
        loadingOverlay.removeAttribute('aria-busy');
    }

    // =====================================================================
    // CONFIRMATION MODAL
    // =====================================================================

    function showConfirmation(title, message) {
        return new Promise((resolve) => {
            setText(modalTitle, title);
            setText(modalMessage, message);
            modalOverlay.classList.add('visible');
            modalCancelBtn.focus();

            const focusable = Array.from(modalOverlay.querySelectorAll('button:not([disabled])'));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            const onKeydown = (e) => {
                if (e.key !== 'Tab') return;
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            };

            const cleanup = () => {
                modalOverlay.classList.remove('visible');
                modalConfirmBtn.removeEventListener('click', onConfirm);
                modalCancelBtn.removeEventListener('click', onCancel);
                document.removeEventListener('keydown', onEscape);
                modalOverlay.removeEventListener('keydown', onKeydown);
            };

            const onConfirm = () => { cleanup(); resolve(true); };
            const onCancel  = () => { cleanup(); resolve(false); };
            const onEscape  = (e) => { if (e.key === 'Escape') onCancel(); };

            modalConfirmBtn.addEventListener('click', onConfirm);
            modalCancelBtn.addEventListener('click', onCancel);
            document.addEventListener('keydown', onEscape);
            modalOverlay.addEventListener('keydown', onKeydown);
        });
    }

    // =====================================================================
    // STORAGE ACCESS
    // =====================================================================

    async function getAllStorageData(types = STORAGE_TYPES) {
        const result = {};
        for (const type of types) {
            try {
                switch (type) {
                    case 'chromeLocal':
                        result.chromeLocal = (typeof chrome !== 'undefined' && chrome.storage?.local)
                            ? await chrome.storage.local.get(null)
                            : { __error: 'Chrome Local Storage not available' };
                        break;
                    case 'chromeSync':
                        result.chromeSync = (typeof chrome !== 'undefined' && chrome.storage?.sync)
                            ? await chrome.storage.sync.get(null)
                            : { __error: 'Chrome Sync Storage not available' };
                        break;
                    case 'webLocal': {
                        const d = {};
                        for (let i = 0; i < localStorage.length; i++) {
                            const k = localStorage.key(i);
                            d[k] = localStorage.getItem(k);
                        }
                        result.webLocal = d;
                        break;
                    }
                    case 'webSession': {
                        const d = {};
                        for (let i = 0; i < sessionStorage.length; i++) {
                            const k = sessionStorage.key(i);
                            d[k] = sessionStorage.getItem(k);
                        }
                        result.webSession = d;
                        break;
                    }
                }
            } catch (err) {
                result[type] = { __error: `Error: ${err.message}` };
            }
        }
        return result;
    }

    async function updateStorageSizes() {
        try {
            const data = await getAllStorageData();
            document.querySelectorAll('.storage-size, .wizard-option-size').forEach(el => {
                const t = el.getAttribute('data-storage');
                const d = data[t];
                el.textContent = (d && typeof d === 'object' && !d.__error)
                    ? formatBytes(estimateSize(d))
                    : '0 B';
            });
        } catch (err) {
            console.error('updateStorageSizes error:', err);
        }
    }

    // =====================================================================
    // SIDEBAR NAVIGATION - ARIA Tabs
    // =====================================================================

    function activateTab(btn) {
        const target = btn.getAttribute('data-panel');
        sidebarButtons.forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
            b.setAttribute('tabindex', '-1');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        btn.setAttribute('tabindex', '0');

        contentPanels.forEach(p => { p.hidden = true; });
        const panel = document.getElementById(`${target}-panel`);
        if (panel) {
            panel.hidden = false;
            hideError(backupRestoreError);
            hideError(dataManagementError);
            if (target === 'data-management') updateStorageSizes();
        }
    }

    sidebarButtons.forEach((btn, index) => {
        btn.setAttribute('tabindex', btn.classList.contains('active') ? '0' : '-1');
        btn.addEventListener('click', () => activateTab(btn));
        btn.addEventListener('keydown', (e) => {
            const buttons = Array.from(sidebarButtons);
            let nextIndex = index;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                nextIndex = (index + 1) % buttons.length;
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                nextIndex = (index - 1 + buttons.length) % buttons.length;
            } else if (e.key === 'Home') {
                e.preventDefault();
                nextIndex = 0;
            } else if (e.key === 'End') {
                e.preventDefault();
                nextIndex = buttons.length - 1;
            } else {
                return;
            }
            buttons[nextIndex].focus();
            activateTab(buttons[nextIndex]);
        });
    });

    // =====================================================================
    // WIZARD - Navigation Helpers
    // =====================================================================

    function showWizardStep(stepEl) {
        document.querySelectorAll('.wizard-step').forEach(el => { el.hidden = true; });
        stepEl.hidden = false;
        // Focus first interactive element for accessibility
        const focusable = stepEl.querySelector('button, input, [tabindex]:not([tabindex="-1"])');
        if (focusable) focusable.focus();
    }

    function resetWizard() {
        wizardState = {
            backupAreas: [],
            backupFilename: '',
            restoreFile: null,
            restoreAreas: [],
        };
        currentBackup = null;

        // Reset backup checkboxes to their default selection
        Object.values(backupCheckboxes).forEach(cb => { cb.checked = cb.value !== 'webSession'; });
        backupFilename.value = '';

        // Reset restore
        restoreFileInput.value = '';
        restoreFileInfo.hidden = true;
        restoreNextS1.disabled = true;
        Object.values(restoreCheckboxes).forEach(cb => {
            cb.checked = false;
            cb.disabled = true;
        });
        Object.values(restoreStatuses).forEach(s => { s.textContent = 'Not in backup'; });
        restoreMeta.hidden = true;
        restoreMeta.textContent = '';

        // Hide all errors
        document.querySelectorAll('.wizard-validation').forEach(el => { el.hidden = true; });
        hideError(backupRestoreError);
    }

    function goToWelcome() {
        resetWizard();
        showWizardStep(wizardWelcome);
    }

    // =====================================================================
    // WIZARD - Backup Flow
    // =====================================================================

    cardBackup.addEventListener('click', () => {
        resetWizard();
        updateStorageSizes();
        showWizardStep(backupStep1);
    });

    backupBackWelcome.addEventListener('click', goToWelcome);
    backupCancelS1.addEventListener('click', goToWelcome);

    backupNextS1.addEventListener('click', () => {
        hideError(backupS1Error);
        const selected = Object.entries(backupCheckboxes)
            .filter(([, cb]) => cb.checked)
            .map(([type]) => type);

        if (selected.length === 0) {
            showError(backupS1Error, 'Select at least one storage area to back up.');
            return;
        }

        wizardState.backupAreas = selected;
        showWizardStep(backupStep2);
    });

    backupBackS1.addEventListener('click', () => showWizardStep(backupStep1));
    backupCancelS2.addEventListener('click', goToWelcome);

    backupNextS2.addEventListener('click', async () => {
        hideError(backupS2Error);
        const rawName = backupFilename.value.trim();
        wizardState.backupFilename = rawName || 'extension_backup';

        showLoading('Calculating backup size...');
        try {
            const previewData = await getAllStorageData(wizardState.backupAreas);
            const totalSize = Object.values(previewData).reduce((acc, d) => {
                return acc + (d && typeof d === 'object' && !d.__error ? estimateSize(d) : 0);
            }, 0);

            setText(reviewBackupName, `${wizardState.backupFilename}_${formatTimestamp(new Date())}.json`);
            renderBadges(reviewBackupAreas, wizardState.backupAreas);
            setText(reviewBackupSize, formatBytes(totalSize));

            showWizardStep(backupStep3);
        } catch (err) {
            showError(backupS2Error, `Failed to prepare backup: ${err.message}`);
        } finally {
            hideLoading();
        }
    });

    backupBackS2.addEventListener('click', () => showWizardStep(backupStep2));
    backupCancelS3.addEventListener('click', goToWelcome);

    backupCreateFinal.addEventListener('click', async () => {
        hideError(backupS3Error);
        hideError(backupRestoreError);

        showLoading('Creating backup...');
        try {
            // Fetch fresh data at the moment of creation rather than reusing the
            // snapshot taken during the review step, so the backup always reflects
            // the latest values even if time has passed since the review screen.
            const backupData = await getAllStorageData(wizardState.backupAreas);
            const timestamp = new Date();

            const backupObj = {
                snapshot_version: '3.0',
                timestamp: timestamp.toISOString(),
                storageTypes: wizardState.backupAreas,
                data: backupData,
            };

            const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `${wizardState.backupFilename}_${formatTimestamp(timestamp)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            showToast('Backup created successfully!', 'success');
            goToWelcome();

        } catch (err) {
            console.error('Backup error:', err);
            showError(backupS3Error, `Backup failed: ${err.message || err}`);
            showToast('Backup failed!', 'error');
        } finally {
            hideLoading();
        }
    });

    // =====================================================================
    // WIZARD - Restore Flow
    // =====================================================================

    cardRestore.addEventListener('click', () => {
        resetWizard();
        showWizardStep(restoreStep1);
    });

    restoreBackWelcome.addEventListener('click', goToWelcome);
    restoreCancelS1.addEventListener('click', goToWelcome);

    // File upload handling with drag & drop
    restoreFileInput.addEventListener('change', (e) => handleRestoreFile(e.target.files[0]));

    restoreUploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        restoreUploadZone.classList.add('dragover');
    });
    restoreUploadZone.addEventListener('dragleave', () => {
        restoreUploadZone.classList.remove('dragover');
    });
    restoreUploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        restoreUploadZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleRestoreFile(file);
    });

    restoreFileRemove.addEventListener('click', () => {
        restoreFileInput.value = '';
        restoreFileInfo.hidden = true;
        restoreNextS1.disabled = true;
        wizardState.restoreFile = null;
        currentBackup = null;
    });

    async function handleRestoreFile(file) {
        hideError(restoreS1Error);
        if (!file) return;

        wizardState.restoreFile = file;
        setText(restoreFileName, file.name);
        restoreFileInfo.hidden = false;
        restoreNextS1.disabled = true;

        showLoading('Reading backup file...');
        try {
            const text = await file.text();
            const backupData = JSON.parse(text);

            if (!backupData.timestamp) {
                throw new Error('Invalid backup file - missing metadata.');
            }
            if (!backupData.data || typeof backupData.data !== 'object') {
                throw new Error('Invalid backup file - missing data.');
            }

            currentBackup = backupData;
            restoreNextS1.disabled = false;
            showToast('File loaded successfully!', 'success');

        } catch (err) {
            console.error('File read error:', err);
            showError(restoreS1Error, `Cannot read backup file: ${err.message}`);
            showToast('Failed to read file!', 'error');
            restoreFileInput.value = '';
            restoreFileInfo.hidden = true;
            wizardState.restoreFile = null;
        } finally {
            hideLoading();
        }
    }

    restoreNextS1.addEventListener('click', () => {
        if (!currentBackup) return;
        hideError(restoreS1Error);

        // Populate metadata
        restoreMeta.hidden = false;
        restoreMeta.textContent = '';

        const createdRow = document.createElement('p');
        const createdLabel = document.createElement('strong');
        createdLabel.textContent = 'Created: ';
        createdRow.appendChild(createdLabel);
        createdRow.appendChild(document.createTextNode(new Date(currentBackup.timestamp).toLocaleString()));
        restoreMeta.appendChild(createdRow);

        const versionRow = document.createElement('p');
        const versionLabel = document.createElement('strong');
        versionLabel.textContent = 'Version: ';
        versionRow.appendChild(versionLabel);
        versionRow.appendChild(document.createTextNode(currentBackup.snapshot_version || currentBackup.version || '-'));
        restoreMeta.appendChild(versionRow);

        if (currentBackup.storageTypes?.length) {
            const areasRow = document.createElement('p');
            const areasLabel = document.createElement('strong');
            areasLabel.textContent = 'Areas: ';
            areasRow.appendChild(areasLabel);
            const badgeWrap = document.createElement('span');
            renderBadges(badgeWrap, currentBackup.storageTypes);
            areasRow.appendChild(badgeWrap);
            restoreMeta.appendChild(areasRow);
        }

        // Populate checkboxes
        const availableTypes = currentBackup.storageTypes || [];
        Object.entries(restoreCheckboxes).forEach(([type, cb]) => {
            const has = availableTypes.includes(type);
            cb.disabled = !has;
            cb.checked = has;
            restoreStatuses[type].textContent = has
                ? formatBytes(estimateSize(currentBackup.data[type] || {}))
                : 'Not in backup';
        });

        showWizardStep(restoreStep2);
    });

    restoreBackS1.addEventListener('click', () => showWizardStep(restoreStep1));
    restoreCancelS2.addEventListener('click', goToWelcome);

    restoreNextS2.addEventListener('click', () => {
        hideError(restoreS2Error);
        const selected = Object.entries(restoreCheckboxes)
            .filter(([, cb]) => cb.checked && !cb.disabled)
            .map(([type]) => type);

        if (selected.length === 0) {
            showError(restoreS2Error, 'Select at least one storage area to restore.');
            return;
        }

        wizardState.restoreAreas = selected;

        // Populate review
        setText(reviewRestoreFile, wizardState.restoreFile?.name || '-');
        renderBadges(reviewRestoreAreas, selected);
        setText(reviewRestoreDate, currentBackup?.timestamp
            ? new Date(currentBackup.timestamp).toLocaleString()
            : '-');

        showWizardStep(restoreStep3);
    });

    restoreBackS2.addEventListener('click', () => showWizardStep(restoreStep2));
    restoreCancelS3.addEventListener('click', goToWelcome);

    restoreFinal.addEventListener('click', async () => {
        hideError(restoreS3Error);
        hideError(backupRestoreError);

        if (!currentBackup?.data) {
            showError(restoreS3Error, 'No valid backup data loaded.');
            return;
        }

        const confirmed = await showConfirmation(
            'Confirm Restore',
            `This will overwrite data in: ${wizardState.restoreAreas.map(storageDisplayName).join(', ')}. This cannot be undone.`
        );
        if (!confirmed) {
            showToast('Restore cancelled.', 'info');
            return;
        }

        showLoading('Restoring data...');
        try {
            const src = currentBackup.data;
            let count = 0;

            for (const type of wizardState.restoreAreas) {
                if (!src[type] || typeof src[type] !== 'object') continue;
                try {
                    switch (type) {
                        case 'chromeLocal':
                            await chrome.storage.local.clear();
                            await chrome.storage.local.set(src[type]);
                            break;
                        case 'chromeSync':
                            await chrome.storage.sync.clear();
                            await chrome.storage.sync.set(src[type]);
                            break;
                        case 'webLocal':
                            localStorage.clear();
                            Object.entries(src[type]).forEach(([k, v]) => localStorage.setItem(k, v));
                            break;
                        case 'webSession':
                            sessionStorage.clear();
                            Object.entries(src[type]).forEach(([k, v]) => sessionStorage.setItem(k, v));
                            break;
                    }
                    count++;
                } catch (err) {
                    showToast(`Failed restoring ${storageDisplayName(type)}: ${err.message}`, 'error');
                }
            }

            showToast(`Restored ${count} storage area(s)!`, 'success');
            goToWelcome();
            await updateStorageSizes();

        } catch (err) {
            console.error('Restore error:', err);
            showError(restoreS3Error, `Restore failed: ${err.message}`);
            showToast('Restore failed!', 'error');
        } finally {
            hideLoading();
        }
    });

    // =====================================================================
    // CLEAR DATA
    // =====================================================================

    clearSelectedDataBtn.addEventListener('click', async () => {
        hideError(dataManagementError);

        const selectedTypes = Array.from(
            document.querySelectorAll('#clear-data-section .checkbox-group input:checked')
        ).map(cb => cb.value);

        if (selectedTypes.length === 0) {
            showError(dataManagementError, 'Select at least one storage area to clear.');
            return;
        }

        const confirmed = await showConfirmation(
            'Confirm Clear',
            `Permanently delete data from: ${selectedTypes.map(storageDisplayName).join(', ')}. This cannot be undone.`
        );
        if (!confirmed) {
            showToast('Clear cancelled.', 'info');
            return;
        }

        showLoading('Clearing data...');
        try {
            let count = 0;
            for (const type of selectedTypes) {
                try {
                    switch (type) {
                        case 'chromeLocal': await chrome.storage.local.clear(); break;
                        case 'chromeSync':  await chrome.storage.sync.clear(); break;
                        case 'webLocal':    localStorage.clear(); break;
                        case 'webSession':  sessionStorage.clear(); break;
                    }
                    count++;
                } catch (err) {
                    showToast(`Failed clearing ${storageDisplayName(type)}: ${err.message}`, 'error');
                }
            }

            document.querySelectorAll('#clear-data-section .checkbox-group input').forEach(cb => { cb.checked = false; });
            showToast(`Cleared ${count} storage area(s)!`, 'success');
            await updateStorageSizes();

        } catch (err) {
            console.error('Clear error:', err);
            showError(dataManagementError, `Clear failed: ${err.message}`);
            showToast('Clear failed!', 'error');
        } finally {
            hideLoading();
        }
    });

    // =====================================================================
    // TOOLTIP POSITIONING
    // =====================================================================

    function positionTooltips() {
        document.querySelectorAll('.tooltip-trigger').forEach(trigger => {
            const tooltip = trigger.querySelector('.tooltip-content');
            if (!tooltip) return;

            trigger.addEventListener('mouseover', () => {
                const rect = trigger.getBoundingClientRect();
                const ttRect = tooltip.getBoundingClientRect();
                const ttWidth = Math.max(ttRect.width, 200);
                const ttHeight = Math.max(ttRect.height, 40);
                const gap = 8;

                let left = rect.left + rect.width / 2 - ttWidth / 2;
                let top = rect.top - ttHeight - gap;

                if (left < gap) left = gap;
                if (left + ttWidth > window.innerWidth - gap) {
                    left = window.innerWidth - ttWidth - gap;
                }
                if (top < gap) top = rect.bottom + gap;
                if (top + ttHeight > window.innerHeight - gap) {
                    top = rect.top - ttHeight - gap;
                }

                tooltip.style.left = left + 'px';
                tooltip.style.top = top + 'px';
            });
        });
    }

    // =====================================================================
    // COPYRIGHT
    // =====================================================================

    const copyrightEl = document.querySelector('.sidebar-footer p');
    if (copyrightEl) {
        copyrightEl.textContent = `© ${new Date().getFullYear()} modcore`;
    }

    // =====================================================================
    // INITIALIZATION
    // =====================================================================

    function init() {
        sidebarButtons.forEach(b => {
            b.setAttribute('tabindex', b.classList.contains('active') ? '0' : '-1');
        });
        const activeBtn = document.querySelector('.sidebar-button.active');
        if (activeBtn) activateTab(activeBtn);
        updateStorageSizes();
        positionTooltips();
    }

    init();
});