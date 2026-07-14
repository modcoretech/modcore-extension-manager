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
    const STORAGE_DESCS = {
        chromeLocal: 'Device-only storage for this extension.',
        chromeSync:  'Synced across all your signed-in Chrome profiles.',
        webLocal:    'Standard web localStorage data.',
        webSession:  'Temporary sessionStorage. Cleared when browser closes.',
    };
    const STORAGE_ICONS = {
        chromeLocal: 'icon-host',
        chromeSync:  'icon-link',
        webLocal:    'icon-code',
        webSession:  'icon-power',
    };
    const TOAST_DURATION = 4000;
    const ENC = new TextEncoder();

    // =====================================================================
    // DOM REFERENCES (cached once)
    // =====================================================================
    const sidebarButtons = document.querySelectorAll('.sidebar-button');
    const contentPanels  = document.querySelectorAll('.content-panel');
    const wizardSteps    = document.querySelectorAll('.wizard-step');

    // Wizard: Welcome
    const wizardWelcome     = document.getElementById('br-welcome');
    const cardBackup        = document.getElementById('card-backup');
    const cardRestore       = document.getElementById('card-restore');

    // Wizard: Backup Step 1 (Select areas)
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

    // Wizard: Backup Step 2 (Review & Create — was step 3)
    const backupStep2       = document.getElementById('br-backup-step2');
    const backupBackS1      = document.getElementById('backup-back-step1');
    const backupCancelS2    = document.getElementById('backup-cancel-step2');
    const backupCreateFinal = document.getElementById('backup-create-final');
    const backupS2Error     = document.getElementById('backup-step2-error');
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
    const storageTableBody  = document.getElementById('storage-table-body');
    const dataManagementError = document.getElementById('dataManagementError');

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
        try { return ENC.encode(JSON.stringify(data)).length; } catch { return 0; }
    }

    function formatTimestamp(date) {
        const p = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
    }

    function storageDisplayName(type) {
        return STORAGE_NAMES[type] || type;
    }

    function renderBadges(container, types) {
        container.textContent = '';
        for (const type of types) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = storageDisplayName(type);
            container.appendChild(badge);
        }
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
    // STORAGE ACCESS (parallel reads for speed)
    // =====================================================================

    async function getStorageData(type) {
        try {
            switch (type) {
                case 'chromeLocal':
                    return (typeof chrome !== 'undefined' && chrome.storage?.local)
                        ? await chrome.storage.local.get(null)
                        : { __error: 'Chrome Local Storage not available' };
                case 'chromeSync':
                    return (typeof chrome !== 'undefined' && chrome.storage?.sync)
                        ? await chrome.storage.sync.get(null)
                        : { __error: 'Chrome Sync Storage not available' };
                case 'webLocal': {
                    const d = {};
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        d[k] = localStorage.getItem(k);
                    }
                    return d;
                }
                case 'webSession': {
                    const d = {};
                    for (let i = 0; i < sessionStorage.length; i++) {
                        const k = sessionStorage.key(i);
                        d[k] = sessionStorage.getItem(k);
                    }
                    return d;
                }
                default:
                    return { __error: `Unknown storage type: ${type}` };
            }
        } catch (err) {
            return { __error: `Error: ${err.message}` };
        }
    }

    async function getAllStorageData(types = STORAGE_TYPES) {
        const results = await Promise.all(types.map(t => getStorageData(t)));
        const result = {};
        for (let i = 0; i < types.length; i++) {
            result[types[i]] = results[i];
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
    // DATA MANAGEMENT TABLE
    // =====================================================================

    function buildStorageTable() {
        if (!storageTableBody) return;
        storageTableBody.textContent = '';

        for (const type of STORAGE_TYPES) {
            const tr = document.createElement('tr');
            tr.setAttribute('data-storage', type);

            // Name cell
            const nameTd = document.createElement('td');
            const nameWrap = document.createElement('div');
            nameWrap.className = 'storage-name-wrap';
            const icon = document.createElement('span');
            icon.className = `icon ${STORAGE_ICONS[type]}`;
            icon.setAttribute('aria-hidden', 'true');
            const nameSpan = document.createElement('span');
            nameSpan.textContent = STORAGE_NAMES[type];
            nameWrap.append(icon, nameSpan);
            const descSmall = document.createElement('small');
            descSmall.textContent = STORAGE_DESCS[type];
            nameTd.append(nameWrap, descSmall);

            // Usage cell
            const usageTd = document.createElement('td');
            const sizeCode = document.createElement('code');
            sizeCode.className = 'storage-size';
            sizeCode.setAttribute('data-storage', type);
            sizeCode.textContent = '…';
            usageTd.appendChild(sizeCode);

            // Actions cell
            const actionTd = document.createElement('td');
            const clearBtn = document.createElement('button');
            clearBtn.className = 'btn danger btn-small';
            clearBtn.innerHTML = '<span class="icon icon-trash" aria-hidden="true"></span> Clear';
            clearBtn.setAttribute('data-action', 'clear');
            clearBtn.setAttribute('data-storage', type);
            clearBtn.addEventListener('click', () => handleClearSingle(type));
            actionTd.appendChild(clearBtn);

            tr.append(nameTd, usageTd, actionTd);
            storageTableBody.appendChild(tr);
        }
    }

    async function handleClearSingle(type) {
        hideError(dataManagementError);

        const confirmed = await showConfirmation(
            'Confirm Clear',
            `Permanently delete all data from ${storageDisplayName(type)}. This cannot be undone.`
        );
        if (!confirmed) {
            showToast('Clear cancelled.', 'info');
            return;
        }

        showLoading('Clearing data...');
        try {
            switch (type) {
                case 'chromeLocal': await chrome.storage.local.clear(); break;
                case 'chromeSync':  await chrome.storage.sync.clear(); break;
                case 'webLocal':    localStorage.clear(); break;
                case 'webSession':  sessionStorage.clear(); break;
            }
            showToast(`Cleared ${storageDisplayName(type)}!`, 'success');
            await updateStorageSizes();
        } catch (err) {
            console.error('Clear error:', err);
            showError(dataManagementError, `Clear failed: ${err.message}`);
            showToast('Clear failed!', 'error');
        } finally {
            hideLoading();
        }
    }

    // =====================================================================
    // SIDEBAR NAVIGATION - ARIA Tabs
    // =====================================================================

    function activateTab(btn) {
        const target = btn.getAttribute('data-panel');
        for (const b of sidebarButtons) {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
            b.setAttribute('tabindex', '-1');
        }
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        btn.setAttribute('tabindex', '0');

        for (const p of contentPanels) { p.hidden = true; }
        const panel = document.getElementById(`${target}-panel`);
        if (panel) {
            panel.hidden = false;
            hideError(backupRestoreError);
            hideError(dataManagementError);
            if (target === 'data-management') updateStorageSizes();
        }
    }

    for (let i = 0; i < sidebarButtons.length; i++) {
        const btn = sidebarButtons[i];
        btn.setAttribute('tabindex', btn.classList.contains('active') ? '0' : '-1');
        btn.addEventListener('click', () => activateTab(btn));
        btn.addEventListener('keydown', (e) => {
            const buttons = Array.from(sidebarButtons);
            let nextIndex = i;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                nextIndex = (i + 1) % buttons.length;
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                nextIndex = (i - 1 + buttons.length) % buttons.length;
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
    }

    // =====================================================================
    // WIZARD - Navigation Helpers
    // =====================================================================

    function showWizardStep(stepEl) {
        for (const el of wizardSteps) { el.hidden = true; }
        stepEl.hidden = false;
        const focusable = stepEl.querySelector('button, input, [tabindex]:not([tabindex="-1"])');
        if (focusable) focusable.focus();
    }

    function resetWizard() {
        wizardState = {
            backupAreas: [],
            restoreFile: null,
            restoreAreas: [],
        };
        currentBackup = null;

        for (const cb of Object.values(backupCheckboxes)) {
            cb.checked = cb.value !== 'webSession';
        }

        restoreFileInput.value = '';
        restoreFileInfo.hidden = true;
        restoreNextS1.disabled = true;
        for (const cb of Object.values(restoreCheckboxes)) {
            cb.checked = false;
            cb.disabled = true;
        }
        for (const s of Object.values(restoreStatuses)) {
            s.textContent = 'Not in backup';
        }
        restoreMeta.hidden = true;
        restoreMeta.textContent = '';

        document.querySelectorAll('.wizard-validation').forEach(el => { el.hidden = true; });
        hideError(backupRestoreError);
    }

    function goToWelcome() {
        resetWizard();
        showWizardStep(wizardWelcome);
    }

    // =====================================================================
    // WIZARD - Backup Flow (2 steps: Select → Review/Create)
    // =====================================================================

    cardBackup.addEventListener('click', () => {
        resetWizard();
        updateStorageSizes();
        showWizardStep(backupStep1);
    });

    backupBackWelcome.addEventListener('click', goToWelcome);
    backupCancelS1.addEventListener('click', goToWelcome);

    backupNextS1.addEventListener('click', async () => {
        hideError(backupS1Error);
        const selected = [];
        for (const [type, cb] of Object.entries(backupCheckboxes)) {
            if (cb.checked) selected.push(type);
        }

        if (selected.length === 0) {
            showError(backupS1Error, 'Select at least one storage area to back up.');
            return;
        }

        wizardState.backupAreas = selected;

        showLoading('Calculating backup size...');
        try {
            const previewData = await getAllStorageData(selected);
            let totalSize = 0;
            for (const d of Object.values(previewData)) {
                if (d && typeof d === 'object' && !d.__error) {
                    totalSize += estimateSize(d);
                }
            }

            const timestamp = new Date();
            setText(reviewBackupName, `extension_backup_${formatTimestamp(timestamp)}.json`);
            renderBadges(reviewBackupAreas, selected);
            setText(reviewBackupSize, formatBytes(totalSize));

            showWizardStep(backupStep2);
        } catch (err) {
            showError(backupS1Error, `Failed to prepare backup: ${err.message}`);
        } finally {
            hideLoading();
        }
    });

    backupBackS1.addEventListener('click', () => showWizardStep(backupStep1));
    backupCancelS2.addEventListener('click', goToWelcome);

    backupCreateFinal.addEventListener('click', async () => {
        hideError(backupS2Error);
        hideError(backupRestoreError);

        showLoading('Creating backup...');
        try {
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
            a.download = `extension_backup_${formatTimestamp(timestamp)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            showToast('Backup created successfully!', 'success');
            goToWelcome();
        } catch (err) {
            console.error('Backup error:', err);
            showError(backupS2Error, `Backup failed: ${err.message || err}`);
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
        currentBackup = null;

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
            currentBackup = null;
        } finally {
            hideLoading();
        }
    }

    restoreNextS1.addEventListener('click', () => {
        if (!currentBackup) return;
        hideError(restoreS1Error);

        restoreMeta.hidden = false;
        restoreMeta.textContent = '';

        const createdRow = document.createElement('p');
        const createdLabel = document.createElement('strong');
        createdLabel.textContent = 'Created: ';
        createdRow.append(createdLabel, document.createTextNode(new Date(currentBackup.timestamp).toLocaleString()));
        restoreMeta.appendChild(createdRow);

        const versionRow = document.createElement('p');
        const versionLabel = document.createElement('strong');
        versionLabel.textContent = 'Version: ';
        versionRow.append(versionLabel, document.createTextNode(currentBackup.snapshot_version || currentBackup.version || '-'));
        restoreMeta.appendChild(versionRow);

        if (currentBackup.storageTypes?.length) {
            const areasRow = document.createElement('p');
            const areasLabel = document.createElement('strong');
            areasLabel.textContent = 'Areas: ';
            const badgeWrap = document.createElement('span');
            renderBadges(badgeWrap, currentBackup.storageTypes);
            areasRow.append(areasLabel, badgeWrap);
            restoreMeta.appendChild(areasRow);
        }

        const availableTypes = currentBackup.storageTypes || [];
        for (const [type, cb] of Object.entries(restoreCheckboxes)) {
            const has = availableTypes.includes(type);
            cb.disabled = !has;
            cb.checked = has;
            restoreStatuses[type].textContent = has
                ? formatBytes(estimateSize(currentBackup.data[type] || {}))
                : 'Not in backup';
        }

        showWizardStep(restoreStep2);
    });

    restoreBackS1.addEventListener('click', () => showWizardStep(restoreStep1));
    restoreCancelS2.addEventListener('click', goToWelcome);

    restoreNextS2.addEventListener('click', () => {
        hideError(restoreS2Error);
        const selected = [];
        for (const [type, cb] of Object.entries(restoreCheckboxes)) {
            if (cb.checked && !cb.disabled) selected.push(type);
        }

        if (selected.length === 0) {
            showError(restoreS2Error, 'Select at least one storage area to restore.');
            return;
        }

        wizardState.restoreAreas = selected;

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
                            for (const [k, v] of Object.entries(src[type])) {
                                localStorage.setItem(k, v);
                            }
                            break;
                        case 'webSession':
                            sessionStorage.clear();
                            for (const [k, v] of Object.entries(src[type])) {
                                sessionStorage.setItem(k, v);
                            }
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
    // TOOLTIP POSITIONING (delegated, no memory leak)
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
    // INITIALIZATION
    // =====================================================================

    function init() {
        const activeBtn = document.querySelector('.sidebar-button.active');
        if (activeBtn) activateTab(activeBtn);
        buildStorageTable();
        updateStorageSizes();
        positionTooltips();

        const copyrightEl = document.querySelector('.sidebar-footer p');
        if (copyrightEl) {
            copyrightEl.textContent = `\u00a9 ${new Date().getFullYear()} modcore`;
        }
    }

    init();
});