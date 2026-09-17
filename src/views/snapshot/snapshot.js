document.addEventListener('DOMContentLoaded', () => {

    // =====================================================================
    // CONSTANTS
    // =====================================================================
    const SNAPSHOT_VERSION = '4.0';
    const MAX_BACKUP_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    const FILENAME_PREFIX = 'modcore_snapshot';

    // Internal mapping of user-facing categories to chrome.storage.local keys.
    // Keys are never shown to the user.
    const DATA_CATEGORIES = {
        profiles: {
            name: 'Profiles',
            desc: 'Your saved profiles and their settings.',
            icon: 'icon-profiles',
            keys: ['em_profiles'],
        },
        automations: {
            name: 'Automations',
            desc: 'Your automation rules and triggers.',
            icon: 'icon-rules',
            keys: ['rules'],
        },
        timeline: {
            name: 'Timeline',
            desc: 'Your activity history and timeline preferences.',
            icon: 'icon-clock',
            keys: ['timeline_activity', 'timeline_ext_state_cache', 'timeline_settings'],
        },
        other: {
            name: 'Other data',
            desc: 'Additional app state and preferences.',
            icon: 'icon-dots',
            keys: ['action_previous_state'],
        },
    };
    const CATEGORY_IDS = Object.keys(DATA_CATEGORIES);

    // =====================================================================
    // DOM
    // =====================================================================
    const actionBackup  = document.getElementById('action-backup');
    const actionRestore = document.getElementById('action-restore');
    const dataGrid      = document.getElementById('data-grid');

    const backupDialog  = document.getElementById('backup-dialog');
    const backupOptions = document.getElementById('backup-options');
    const backupError   = document.getElementById('backup-error');
    const backupCreate  = document.getElementById('backup-create');
    const backupChecks  = {}; // filled during render

    const restoreDialog     = document.getElementById('restore-dialog');
    const restoreUploadZone = document.getElementById('restore-upload-zone');
    const restoreFileInput  = document.getElementById('restore-file-input');
    const restoreReview     = document.getElementById('restore-review');
    const restoreFileName   = document.getElementById('restore-file-name');
    const restoreFileRemove = document.getElementById('restore-file-remove');
    const restoreOptions    = document.getElementById('restore-options');
    const restoreSummaryLbl = document.getElementById('restore-summary-label');
    const restoreConfirm    = document.getElementById('restore-confirm');
    const restoreError      = document.getElementById('restore-error');
    const restoreChecks     = {}; // filled during render

    const confirmDialog  = document.getElementById('confirm-dialog');
    const confirmMessage = document.getElementById('confirm-dialog-message');
    const confirmOk      = document.getElementById('confirm-ok');
    const confirmCancel  = document.getElementById('confirm-cancel');

    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText    = document.getElementById('loading-text');

    // =====================================================================
    // STATE
    // =====================================================================
    let currentBackup = null;

    // =====================================================================
    // DIALOG WIRING (native <dialog>)
    // =====================================================================
    // Close buttons: any element with [data-close] closes its ancestor dialog.
    document.querySelectorAll('dialog [data-close]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const dialog = btn.closest('dialog');
            if (dialog) dialog.close();
        });
    });

    // Backdrop click closes. In Chrome, clicks on the ::backdrop target the
    // dialog element itself, so this is reliable.
    document.querySelectorAll('dialog.modal').forEach((dialog) => {
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) dialog.close();
        });
    });

    // =====================================================================
    // LOADING
    // =====================================================================
    function showLoading(message = 'Working…') {
        loadingText.textContent = message;
        loadingOverlay.hidden = false;
    }
    function hideLoading() {
        loadingOverlay.hidden = true;
    }

    // =====================================================================
    // CONFIRM DIALOG (returns a promise)
    // =====================================================================
    function showConfirm(message) {
        return new Promise((resolve) => {
            confirmMessage.textContent = message;
            let result = false;

            const onOk = () => { result = true; confirmDialog.close(); };
            const onClose = () => {
                confirmOk.removeEventListener('click', onOk);
                confirmDialog.removeEventListener('close', onClose);
                resolve(result);
            };

            confirmOk.addEventListener('click', onOk);
            confirmDialog.addEventListener('close', onClose, { once: true });
            confirmDialog.showModal();
        });
    }

    // =====================================================================
    // FORMATTING
    // =====================================================================
    const pad = (n) => String(n).padStart(2, '0');
    function formatTimestamp(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    }

    // =====================================================================
    // STORAGE HELPERS
    // =====================================================================
    function ensureChromeStorage() {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            throw new Error('Extension storage is not available in this context.');
        }
    }

    async function readCategories(categoryIds) {
        ensureChromeStorage();
        const result = {};
        for (const id of categoryIds) {
            const cat = DATA_CATEGORIES[id];
            if (!cat) continue;
            try {
                result[id] = await chrome.storage.local.get(cat.keys);
            } catch (err) {
                console.warn(`Could not read "${id}":`, err);
                result[id] = {};
            }
        }
        return result;
    }

    async function restoreCategory(id, data) {
        const cat = DATA_CATEGORIES[id];
        if (!cat) return;
        ensureChromeStorage();

        const dataObj = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
        const keysToSet = {};
        const keysToRemove = [];

        for (const key of cat.keys) {
            if (Object.prototype.hasOwnProperty.call(dataObj, key)) {
                keysToSet[key] = dataObj[key];
            } else {
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length) await chrome.storage.local.remove(keysToRemove);
        if (Object.keys(keysToSet).length) await chrome.storage.local.set(keysToSet);
    }

    async function clearCategory(id) {
        const cat = DATA_CATEGORIES[id];
        if (!cat) return;
        ensureChromeStorage();
        await chrome.storage.local.remove(cat.keys);
    }

    // =====================================================================
    // OPTION ELEMENT BUILDER
    // =====================================================================
    function buildOption(id, { checked = false, disabled = false, statusText = '' } = {}) {
        const cat = DATA_CATEGORIES[id];
        if (!cat) return null;

        const label = document.createElement('label');
        label.className = 'option';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'option-input';
        input.value = id;
        input.checked = checked;
        input.disabled = disabled;

        const box = document.createElement('span');
        box.className = 'option-box';

        const iconWrap = document.createElement('span');
        iconWrap.className = 'option-icon-wrap';
        const icon = document.createElement('span');
        icon.className = `icon ${cat.icon}`;
        icon.setAttribute('aria-hidden', 'true');
        iconWrap.appendChild(icon);

        const text = document.createElement('span');
        text.className = 'option-text';

        const name = document.createElement('span');
        name.className = 'option-name';
        name.textContent = cat.name;
        text.appendChild(name);

        if (statusText) {
            const status = document.createElement('span');
            status.className = 'option-status';
            status.textContent = statusText;
            text.appendChild(status);
        } else if (cat.desc) {
            const desc = document.createElement('span');
            desc.className = 'option-desc';
            desc.textContent = cat.desc;
            text.appendChild(desc);
        }

        box.append(iconWrap, text);
        label.append(input, box);

        return { label, input };
    }

    // =====================================================================
    // BACKUP DIALOG
    // =====================================================================
    function renderBackupOptions() {
        backupOptions.textContent = '';
        for (const key of Object.keys(backupChecks)) delete backupChecks[key];

        for (const id of CATEGORY_IDS) {
            const built = buildOption(id, { checked: true });
            if (!built) continue;
            backupOptions.appendChild(built.label);
            backupChecks[id] = built.input;
        }
    }

    function resetBackupDialog() {
        for (const id of CATEGORY_IDS) {
            if (backupChecks[id]) backupChecks[id].checked = true;
        }
        backupError.hidden = true;
        backupError.textContent = '';
    }

    actionBackup.addEventListener('click', () => {
        resetBackupDialog();
        backupDialog.showModal();
    });

    backupCreate.addEventListener('click', async () => {
        backupError.hidden = true;
        backupError.textContent = '';

        const selected = CATEGORY_IDS.filter((id) => backupChecks[id] && backupChecks[id].checked);
        if (!selected.length) {
            backupError.textContent = 'Pick at least one item to include in your backup.';
            backupError.hidden = false;
            return;
        }

        showLoading('Creating backup…');
        try {
            const data = await readCategories(selected);
            const timestamp = new Date();

            const payload = {
                snapshot_version: SNAPSHOT_VERSION,
                timestamp: timestamp.toISOString(),
                categories: selected,
                data,
            };

            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${FILENAME_PREFIX}_${formatTimestamp(timestamp)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            Status.success('Backup saved.');
            backupDialog.close();
        } catch (err) {
            console.error('Backup error:', err);
            backupError.textContent = `Could not create backup: ${err.message || err}`;
            backupError.hidden = false;
            Status.error('Backup failed.');
        } finally {
            hideLoading();
        }
    });

    // =====================================================================
    // RESTORE DIALOG
    // =====================================================================
    function resetRestoreDialog() {
        currentBackup = null;
        restoreFileInput.value = '';
        restoreReview.hidden = true;
        restoreUploadZone.hidden = false;
        restoreConfirm.disabled = true;
        restoreError.hidden = true;
        restoreError.textContent = '';
        restoreOptions.textContent = '';
        for (const key of Object.keys(restoreChecks)) delete restoreChecks[key];
    }

    actionRestore.addEventListener('click', () => {
        resetRestoreDialog();
        restoreDialog.showModal();
    });

    // Drag & drop on upload zone
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

    restoreFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleRestoreFile(file);
    });

    restoreFileRemove.addEventListener('click', () => {
        resetRestoreDialog();
    });

    function validateBackup(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error('This file is not a modcore Snapshot backup.');
        }
        if (typeof raw.timestamp !== 'string' || Number.isNaN(Date.parse(raw.timestamp))) {
            throw new Error('This backup is missing a valid creation date.');
        }
        if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) {
            throw new Error('This backup does not contain any restorable data.');
        }

        let categories = Array.isArray(raw.categories) ? raw.categories.slice() : Object.keys(raw.data);
        categories = categories.filter((id) => CATEGORY_IDS.includes(id));

        if (!categories.length) {
            throw new Error('This backup does not contain any recognized data.');
        }

        return {
            snapshot_version: raw.snapshot_version || raw.version || 'unknown',
            timestamp: raw.timestamp,
            categories,
            data: raw.data,
        };
    }

    /**
     * Render the restore option list for the categories that are actually
     * present in the loaded backup. Categories not in the backup are not
     * rendered at all so the dialog never looks half-finished.
     */
    function renderRestoreOptions() {
        restoreOptions.textContent = '';
        for (const key of Object.keys(restoreChecks)) delete restoreChecks[key];

        const usable = [];
        for (const id of currentBackup.categories) {
            const catData = currentBackup.data[id];
            const isEmpty = !catData || typeof catData !== 'object' || Object.keys(catData).length === 0;
            if (isEmpty) continue;
            usable.push(id);
        }

        if (!usable.length) {
            throw new Error('This backup does not contain any data to restore.');
        }

        for (const id of usable) {
            const built = buildOption(id, { checked: true, statusText: 'Ready to restore' });
            if (!built) continue;
            restoreOptions.appendChild(built.label);
            restoreChecks[id] = built.input;
        }

        const n = usable.length;
        restoreSummaryLbl.textContent = n === 1
            ? 'This backup contains 1 category:'
            : `This backup contains ${n} categories:`;

        restoreConfirm.disabled = false;
    }

    async function handleRestoreFile(file) {
        restoreError.hidden = true;
        restoreError.textContent = '';

        if (file.size > MAX_BACKUP_FILE_SIZE) {
            const mb = Math.round(MAX_BACKUP_FILE_SIZE / 1024 / 1024);
            restoreError.textContent = `That file is too large (limit is ${mb} MB).`;
            restoreError.hidden = false;
            Status.error('File too large.');
            restoreFileInput.value = '';
            return;
        }

        showLoading('Reading backup file…');
        try {
            const text = await file.text();
            const raw = JSON.parse(text);
            currentBackup = validateBackup(raw);

            restoreFileName.textContent = file.name;
            renderRestoreOptions();

            restoreUploadZone.hidden = true;
            restoreReview.hidden = false;
            Status.success('Backup loaded.');
        } catch (err) {
            console.error('File read error:', err);
            restoreError.textContent = err.message || 'Could not read this file.';
            restoreError.hidden = false;
            Status.error('Could not read that file.');
            restoreFileInput.value = '';
            currentBackup = null;
        } finally {
            hideLoading();
        }
    }

    restoreConfirm.addEventListener('click', async () => {
        restoreError.hidden = true;
        restoreError.textContent = '';

        if (!currentBackup || !currentBackup.data) {
            restoreError.textContent = 'No backup data is currently loaded.';
            restoreError.hidden = false;
            return;
        }

        const selected = CATEGORY_IDS.filter((id) => {
            const cb = restoreChecks[id];
            return cb && cb.checked && !cb.disabled;
        });
        if (!selected.length) {
            restoreError.textContent = 'Pick at least one item to restore.';
            restoreError.hidden = false;
            return;
        }

        showLoading('Restoring data…');
        let successCount = 0;
        try {
            for (const id of selected) {
                try {
                    await restoreCategory(id, currentBackup.data[id]);
                    successCount++;
                } catch (err) {
                    console.error(`Could not restore "${id}":`, err);
                    Status.error(`Could not restore ${DATA_CATEGORIES[id].name}.`);
                }
            }
            if (successCount > 0) {
                Status.success(
                    successCount === 1
                        ? 'Restore complete.'
                        : `Restored ${successCount} categories.`
                );
            }
            restoreDialog.close();
        } catch (err) {
            console.error('Restore error:', err);
            restoreError.textContent = `Could not restore backup: ${err.message}`;
            restoreError.hidden = false;
            Status.error('Restore failed.');
        } finally {
            hideLoading();
        }
    });

    // =====================================================================
    // DATA GRID
    // =====================================================================
    function buildDataGrid() {
        if (!dataGrid) return;
        dataGrid.textContent = '';

        for (const id of CATEGORY_IDS) {
            const cat = DATA_CATEGORIES[id];

            const card = document.createElement('article');
            card.className = 'data-card';

            const iconWrap = document.createElement('span');
            iconWrap.className = 'data-card-icon-wrap';
            const icon = document.createElement('span');
            icon.className = `icon ${cat.icon}`;
            icon.setAttribute('aria-hidden', 'true');
            iconWrap.appendChild(icon);

            const body = document.createElement('div');
            body.className = 'data-card-body';
            const title = document.createElement('h3');
            title.className = 'data-card-title';
            title.textContent = cat.name;
            const desc = document.createElement('p');
            desc.className = 'data-card-desc';
            desc.textContent = cat.desc;
            body.append(title, desc);

            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'btn-icon data-card-clear';
            clearBtn.setAttribute('aria-label', `Clear ${cat.name}`);
            const clearIcon = document.createElement('span');
            clearIcon.className = 'icon icon-trash';
            clearIcon.setAttribute('aria-hidden', 'true');
            clearBtn.appendChild(clearIcon);
            clearBtn.addEventListener('click', () => handleClearCategory(id));

            card.append(iconWrap, body, clearBtn);
            dataGrid.appendChild(card);
        }
    }

    async function handleClearCategory(id) {
        const cat = DATA_CATEGORIES[id];
        if (!cat) return;

        const confirmed = await showConfirm(
            `This will permanently delete "${cat.name}" from this device. This cannot be undone.`
        );
        if (!confirmed) return;

        showLoading('Clearing data…');
        try {
            await clearCategory(id);
            Status.success(`${cat.name} cleared.`);
        } catch (err) {
            console.error('Clear error:', err);
            Status.error(`Could not clear ${cat.name}.`);
        } finally {
            hideLoading();
        }
    }

    // =====================================================================
    // INIT
    // =====================================================================
    function init() {
        renderBackupOptions();
        buildDataGrid();
    }

    init();
});