document.addEventListener('DOMContentLoaded', () => {

    // =========================================================================
    // Element references
    // =========================================================================
    const sidebarButtons            = document.querySelectorAll('.sidebar-button');
    const contentPanels             = document.querySelectorAll('.content-panel');
    const createBackupBtn           = document.getElementById('createBackupBtn');
    const restoreBackupBtn          = document.getElementById('restoreBackupBtn');
    const clearSelectedDataBtn      = document.getElementById('clearSelectedDataBtn');

    // Backup elements
    const backupFileNameInput           = document.getElementById('backupFileName');
    const backupStorageCheckboxes       = document.querySelectorAll('#create-backup-section .checkbox-group input[type="checkbox"]');
    const enableEncryptionCheckbox      = document.getElementById('enableEncryptionCheckbox');
    const encryptionPasswordFields      = document.getElementById('encryptionPasswordFields');
    const backupPasswordInput           = document.getElementById('backupPassword');
    const confirmBackupPasswordInput    = document.getElementById('confirmBackupPassword');
    const passwordStrengthBar           = document.getElementById('passwordStrengthBar');
    const passwordStrengthText          = document.getElementById('passwordStrengthText');
    const passwordStrengthContainer     = document.getElementById('password-strength-container');

    // Restore elements
    const restoreFileInput          = document.getElementById('restoreFile');
    const selectedFileNameDisplay   = document.getElementById('selectedFileName');
    const restorePasswordInputGroup = document.getElementById('restorePasswordInputGroup');
    const restorePasswordInput      = document.getElementById('restorePassword');
    const restoreOptionsContainer   = document.getElementById('restore-options-container');
    const restoreStorageCheckboxes  = document.querySelectorAll('#restore-options-container .checkbox-group input[type="checkbox"]');
    const backupMetadataDisplay     = document.getElementById('backup-metadata');
    const verifyPasswordBtn         = document.getElementById('verify-password-btn');

    // General UI
    const loadingOverlay                = document.getElementById('loading-overlay');
    const backupRestoreErrorDisplay     = document.getElementById('backupRestoreError');
    const dataManagementErrorDisplay    = document.getElementById('dataManagementError');
    const modalOverlay                  = document.getElementById('confirmation-modal');
    const modalTitle                    = document.getElementById('modal-title');
    const modalMessage                  = document.getElementById('modal-message');
    const modalCancelBtn                = document.getElementById('modal-cancel');
    const modalConfirmBtn               = document.getElementById('modal-confirm');

    // Data viewer modal
    const dataViewerModal       = document.getElementById('data-viewer-modal');
    const dataViewerClose       = document.getElementById('data-viewer-close');
    const dataViewerSearch      = document.getElementById('data-viewer-search');
    const dataViewerSearchClear = document.getElementById('data-viewer-search-clear');
    const dataViewerCopy        = document.getElementById('data-viewer-copy');
    const dataViewerExpandAll   = document.getElementById('data-viewer-expand-all');
    const dataViewerTree        = document.getElementById('data-viewer-tree');
    const dataViewerEmpty       = document.getElementById('data-viewer-empty');
    const dataViewerStats       = document.getElementById('viewer-stats');
    const filterChips           = document.querySelectorAll('.chip[data-filter]');
    const viewDataModalBtn      = document.getElementById('viewDataModalBtn');

    // Key edit modal
    const keyEditModal      = document.getElementById('key-edit-modal');
    const keyEditClose      = document.getElementById('key-edit-close');
    const keyEditCancel     = document.getElementById('key-edit-cancel');
    const keyEditSave       = document.getElementById('key-edit-save');
    const keyEditStorage    = document.getElementById('key-edit-storage');
    const keyEditKey        = document.getElementById('key-edit-key');
    const keyEditValue      = document.getElementById('key-edit-value');
    const keyEditErrorMsg   = document.getElementById('key-edit-error-msg');

    // State
    let allStoredData       = {};
    let currentBackupData   = null;
    let currentFilter       = 'all';
    let allExpanded         = false;
    let editContext         = null;     // { storageType, key }

    // =========================================================================
    // Auto-update copyright year
    // =========================================================================
    const copyrightEl = document.querySelector('.sidebar-footer p');
    if (copyrightEl) copyrightEl.textContent = `© ${new Date().getFullYear()} modcore`;

    // =========================================================================
    // Utility helpers
    // =========================================================================

    function setTextContent(el, text) {
        if (el) el.textContent = text;
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        }, 4000);
    }

    function showApiError(el, message) {
        const msgEl = el.querySelector('.error-message');
        if (msgEl) msgEl.textContent = message;
        el.style.display = 'flex';
        el.setAttribute('role', 'alert');
    }

    function hideApiError(el) {
        el.style.display = 'none';
        const msgEl = el.querySelector('.error-message');
        if (msgEl) msgEl.textContent = '';
        el.removeAttribute('role');
    }

    function showLoading(message = 'Processing…') {
        const p = loadingOverlay.querySelector('p');
        if (p) p.textContent = message;
        loadingOverlay.hidden = false;
        loadingOverlay.setAttribute('aria-busy', 'true');
    }

    function hideLoading() {
        loadingOverlay.hidden = true;
        loadingOverlay.removeAttribute('aria-busy');
    }

    function showConfirmationModal(title, message) {
        setTextContent(modalTitle, title);
        setTextContent(modalMessage, message);
        modalOverlay.classList.add('visible');
        modalCancelBtn.focus();

        // Focus trap
        const focusable = modalOverlay.querySelectorAll('button:not([disabled])');
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const trap = (e) => {
            if (e.key !== 'Tab') return;
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        modalOverlay.addEventListener('keydown', trap);

        return new Promise((resolve) => {
            const cleanup = () => {
                modalOverlay.classList.remove('visible');
                modalConfirmBtn.removeEventListener('click', onConfirm);
                modalCancelBtn.removeEventListener('click', onCancel);
                document.removeEventListener('keydown', onEscape);
                modalOverlay.removeEventListener('keydown', trap);
            };
            const onConfirm = () => { cleanup(); resolve(true); };
            const onCancel  = () => { cleanup(); resolve(false); };
            const onEscape  = (e) => { if (e.key === 'Escape') onCancel(); };
            modalConfirmBtn.addEventListener('click', onConfirm);
            modalCancelBtn.addEventListener('click', onCancel);
            document.addEventListener('keydown', onEscape);
        });
    }

    function generateBackupFilename() {
        const now = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `extension_backup_${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024, sizes = ['B','KB','MB','GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
    }

    function estimateSize(data) {
        try { return new Blob([JSON.stringify(data)]).size; } catch { return 0; }
    }

    function storageDisplayName(type) {
        const map = {
            chromeLocal:   'Chrome Local',
            chromeSync:    'Chrome Sync',
            webLocal:      'Web Local',
            webSession:    'Web Session',
            chromeManaged: 'Chrome Managed',
        };
        return map[type] || type;
    }

    // =========================================================================
    // Password strength
    // =========================================================================
    function checkPasswordStrength(password) {
        if (!password) {
            passwordStrengthBar.value = 0;
            setTextContent(passwordStrengthText, '');
            passwordStrengthContainer.hidden = true;
            return;
        }
        passwordStrengthContainer.hidden = false;

        let score = Math.min(password.length * 5, 50);
        const types = [/[A-Z]/, /[a-z]/, /\d/, /[!@#$%^&*(),.?":{}|<>~`\-_+=\[\]\\;'/]/]
            .filter(rx => rx.test(password)).length;
        score += types * 10;
        if (password.length >= 8 && types >= 3) score += 20;
        if (password.length >= 16) score += 10;

        const levels = [
            { min: 0,  label: 'Very Weak', cls: 'weak'   },
            { min: 30, label: 'Weak',      cls: 'weak'   },
            { min: 45, label: 'Fair',      cls: 'fair'   },
            { min: 60, label: 'Good',      cls: 'good'   },
            { min: 80, label: 'Strong',    cls: 'strong' },
        ];
        const level = levels.slice().reverse().find(l => score >= l.min) || levels[0];
        passwordStrengthBar.value = Math.min(score, 100);
        setTextContent(passwordStrengthText, level.label);
        passwordStrengthBar.className = `password-strength-bar ${level.cls}`;
    }

    // =========================================================================
    // Encryption - AES-256-GCM / PBKDF2 SHA-256 (310 000 iterations)
    // =========================================================================
    const PBKDF2_ITERATIONS = 310_000;

    async function encryptData(plaintext, password) {
        const enc = new TextEncoder();
        const salt = crypto.getRandomValues(new Uint8Array(32));
        const iv   = crypto.getRandomValues(new Uint8Array(12));

        const keyMaterial = await crypto.subtle.importKey(
            'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false, ['encrypt']
        );

        const cipherBuf = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            enc.encode(plaintext)
        );

        return {
            encrypted:  Array.from(new Uint8Array(cipherBuf)),
            iv:         Array.from(iv),
            salt:       Array.from(salt),
            iterations: PBKDF2_ITERATIONS,
            algo:       'AES-GCM-256',
        };
    }

    async function decryptData(encResult, password) {
        const { encrypted, iv, salt, iterations = PBKDF2_ITERATIONS } = encResult;
        const enc = new TextEncoder();

        const keyMaterial = await crypto.subtle.importKey(
            'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: new Uint8Array(salt), iterations, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false, ['decrypt']
        );

        const plainBuf = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(iv) },
            key,
            new Uint8Array(encrypted)
        );
        return new TextDecoder().decode(plainBuf);
    }

    // =========================================================================
    // Storage access
    // =========================================================================
    async function getAllStorageData(types) {
        const result = {};
        for (const type of types) {
            try {
                switch (type) {
                    case 'chromeLocal':
                        result.chromeLocal = (typeof chrome !== 'undefined' && chrome.storage?.local)
                            ? await chrome.storage.local.get(null)
                            : 'Chrome Local Storage not available';
                        break;
                    case 'chromeSync':
                        result.chromeSync = (typeof chrome !== 'undefined' && chrome.storage?.sync)
                            ? await chrome.storage.sync.get(null)
                            : 'Chrome Sync Storage not available';
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
                    case 'chromeManaged':
                        result.chromeManaged = (typeof chrome !== 'undefined' && chrome.storage?.managed)
                            ? await chrome.storage.managed.get(null)
                            : 'Chrome Managed Storage not available';
                        break;
                }
            } catch (err) {
                result[type] = `Error: ${err.message}`;
            }
        }
        return result;
    }

    async function updateStorageSizes() {
        try {
            const data = await getAllStorageData(['chromeLocal', 'chromeSync', 'webLocal', 'webSession']);
            document.querySelectorAll('.storage-size').forEach(el => {
                const t = el.getAttribute('data-storage');
                el.textContent = (data[t] && typeof data[t] === 'object')
                    ? formatBytes(estimateSize(data[t])) : '0 B';
            });
            document.querySelectorAll('.storage-size-inline').forEach(el => {
                const t = el.getAttribute('data-storage');
                if (data[t] && typeof data[t] === 'object') {
                    el.textContent = ' · ' + formatBytes(estimateSize(data[t]));
                    el.style.color = 'var(--text-muted)';
                    el.style.fontSize = 'var(--body-small)';
                } else {
                    el.textContent = '';
                }
            });
        } catch (err) {
            console.error('updateStorageSizes error:', err);
        }
    }

    // =========================================================================
    // Sidebar navigation
    // =========================================================================
    sidebarButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-panel');
            sidebarButtons.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            contentPanels.forEach(p => { p.hidden = true; });
            const panel = document.getElementById(`${target}-panel`);
            if (panel) {
                panel.hidden = false;
                hideApiError(backupRestoreErrorDisplay);
                hideApiError(dataManagementErrorDisplay);
                if (target === 'data-management') {
                    updateStorageSizes();
                }
            }
        });
    });

    // =========================================================================
    // Password visibility toggle
    // =========================================================================
    document.querySelectorAll('.toggle-password-visibility').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (!input) return;
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        });
    });

    // =========================================================================
    // Encryption toggle
    // =========================================================================
    function syncEncryptionFields() {
        encryptionPasswordFields.hidden = !enableEncryptionCheckbox.checked;
        if (!enableEncryptionCheckbox.checked) {
            backupPasswordInput.value = '';
            confirmBackupPasswordInput.value = '';
            passwordStrengthBar.value = 0;
            setTextContent(passwordStrengthText, '');
            passwordStrengthContainer.hidden = true;
        }
    }

    enableEncryptionCheckbox.addEventListener('change', syncEncryptionFields);
    // Ensure sync on load (handles default checked state)
    syncEncryptionFields();

    backupPasswordInput.addEventListener('input', (e) => checkPasswordStrength(e.target.value));

    backupFileNameInput.value = generateBackupFilename();

    // =========================================================================
    // Backup
    // =========================================================================
    createBackupBtn.addEventListener('click', async () => {
        hideApiError(backupRestoreErrorDisplay);

        const fileName = backupFileNameInput.value.trim() || generateBackupFilename();
        const selectedTypes = [...backupStorageCheckboxes].filter(c => c.checked).map(c => c.value);

        if (selectedTypes.length === 0) {
            showApiError(backupRestoreErrorDisplay, 'Select at least one storage area to back up.');
            return;
        }

        const doEncrypt  = enableEncryptionCheckbox.checked;
        const password   = backupPasswordInput.value;
        const confirmPwd = confirmBackupPasswordInput.value;

        if (doEncrypt) {
            if (!password) { showApiError(backupRestoreErrorDisplay, 'Enter an encryption password.'); backupPasswordInput.focus(); return; }
            if (password !== confirmPwd) { showApiError(backupRestoreErrorDisplay, 'Passwords do not match.'); confirmBackupPasswordInput.focus(); return; }
            if (password.length < 8) { showApiError(backupRestoreErrorDisplay, 'Password must be at least 8 characters.'); backupPasswordInput.focus(); return; }
        }

        showLoading('Collecting data…');
        try {
            const data      = await getAllStorageData(selectedTypes);
            const timestamp = new Date().toISOString();

            let backupObj = {
                snapshot_version: '3.0',
                timestamp,
                encrypted: doEncrypt,
                storageTypes: selectedTypes,
            };

            if (doEncrypt) {
                showLoading('Encrypting backup…');
                const payload = JSON.stringify({ data });
                const enc = await encryptData(payload, password);
                Object.assign(backupObj, {
                    encryptedData: enc.encrypted,
                    iv:            enc.iv,
                    salt:          enc.salt,
                    iterations:    enc.iterations,
                    algo:          enc.algo,
                });
            } else {
                backupObj.data = data;
            }

            const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `${fileName}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            showToast('Backup created successfully!', 'success');

            // Reset form
            backupPasswordInput.value = '';
            confirmBackupPasswordInput.value = '';
            passwordStrengthBar.value = 0;
            setTextContent(passwordStrengthText, '');
            passwordStrengthContainer.hidden = true;
            enableEncryptionCheckbox.checked = true;
            syncEncryptionFields();
            backupFileNameInput.value = generateBackupFilename();

        } catch (err) {
            console.error('Backup error:', err);
            showApiError(backupRestoreErrorDisplay, `Backup failed: ${err.message || err}`);
            showToast('Backup failed!', 'error');
        } finally {
            hideLoading();
        }
    });

    // =========================================================================
    // Restore - file select
    // =========================================================================
    restoreFileInput.addEventListener('change', async (e) => {
        hideApiError(backupRestoreErrorDisplay);
        const file = e.target.files[0];

        if (!file) {
            setTextContent(selectedFileNameDisplay, 'No file chosen');
            restorePasswordInputGroup.hidden = true;
            restoreOptionsContainer.hidden = true;
            restoreBackupBtn.disabled = true;
            currentBackupData = null;
            return;
        }

        setTextContent(selectedFileNameDisplay, file.name);
        showLoading('Reading backup…');

        try {
            const text       = await file.text();
            const backupData = JSON.parse(text);

            if (!backupData.timestamp) throw new Error('Invalid backup file - missing metadata.');

            backupData.snapshot_version = backupData.snapshot_version || backupData.version || '2.0';
            currentBackupData = backupData;

            // Strict boolean check to avoid truthy string bugs
            if (backupData.encrypted === true) {
                restorePasswordInputGroup.hidden = false;
                verifyPasswordBtn.style.display  = '';
                restorePasswordInput.disabled    = false;
                restoreOptionsContainer.hidden   = true;
                restoreBackupBtn.disabled        = true;
                restorePasswordInput.focus();
            } else {
                restorePasswordInputGroup.hidden = true;
                restorePasswordInput.value = '';
                verifyPasswordBtn.style.display = 'none';
                displayRestoreOptions(backupData);
            }

        } catch (err) {
            console.error('File read error:', err);
            showApiError(backupRestoreErrorDisplay, `Cannot read backup file: ${err.message}`);
            showToast('Failed to read file!', 'error');
            setTextContent(selectedFileNameDisplay, 'No file chosen');
            restoreFileInput.value = '';
            currentBackupData = null;
        } finally {
            hideLoading();
        }
    });

    // Verify password button
    verifyPasswordBtn.style.display = 'none';
    verifyPasswordBtn.addEventListener('click', async () => {
        const password = restorePasswordInput.value;
        if (!password) {
            showApiError(backupRestoreErrorDisplay, 'Enter the decryption password.');
            return;
        }

        showLoading('Verifying password…');
        try {
            const enc = {
                encrypted:  currentBackupData.encryptedData,
                iv:         currentBackupData.iv,
                salt:       currentBackupData.salt,
                iterations: currentBackupData.iterations || PBKDF2_ITERATIONS,
            };
            const plaintext  = await decryptData(enc, password);
            const parsed     = JSON.parse(plaintext);
            currentBackupData.data = parsed.data;

            showToast('Password verified!', 'success');
            verifyPasswordBtn.style.display  = 'none';
            restorePasswordInput.disabled    = true;
            displayRestoreOptions(currentBackupData);

        } catch (err) {
            console.error('Decryption error:', err);
            showApiError(backupRestoreErrorDisplay, 'Incorrect password or corrupted file.');
            showToast('Decryption failed!', 'error');
        } finally {
            hideLoading();
        }
    });

    restorePasswordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && verifyPasswordBtn.style.display !== 'none') {
            verifyPasswordBtn.click();
        }
    });

    function displayRestoreOptions(backupData) {
        restoreOptionsContainer.hidden = false;
        restoreBackupBtn.disabled      = false;

        backupMetadataDisplay.textContent = '';

        const wrap   = document.createElement('div');
        const title  = document.createElement('h4');
        title.textContent = 'Backup Info';
        wrap.appendChild(title);

        const rows = [
            ['Created',   new Date(backupData.timestamp).toLocaleString()],
            ['Version',   backupData.snapshot_version || backupData.version || '—'],
            ['Encrypted', backupData.encrypted === true ? 'Yes ✓' : 'No'],
        ];
        rows.forEach(([label, value]) => {
            const p  = document.createElement('p');
            const s  = document.createElement('strong');
            s.textContent = label + ': ';
            p.appendChild(s);
            p.appendChild(document.createTextNode(value));
            wrap.appendChild(p);
        });

        if (backupData.storageTypes?.length) {
            const p = document.createElement('p');
            const s = document.createElement('strong');
            s.textContent = 'Areas: ';
            p.appendChild(s);
            backupData.storageTypes.forEach(t => {
                const badge = document.createElement('span');
                badge.className   = 'badge';
                badge.textContent = storageDisplayName(t);
                p.appendChild(badge);
            });
            wrap.appendChild(p);
        }
        backupMetadataDisplay.appendChild(wrap);

        restoreStorageCheckboxes.forEach(cb => {
            const has = backupData.storageTypes?.includes(cb.value);
            cb.disabled = !has;
            cb.checked  = !!has;
            const lbl = cb.closest('label');
            if (lbl) {
                lbl.style.opacity = has ? '1' : '0.5';
                lbl.title = has ? '' : 'Not available in this backup';
            }
        });
    }

    // =========================================================================
    // Restore - execute
    // =========================================================================
    restoreBackupBtn.addEventListener('click', async () => {
        hideApiError(backupRestoreErrorDisplay);

        if (!currentBackupData?.data) {
            showApiError(backupRestoreErrorDisplay, 'No valid backup data loaded.');
            return;
        }

        const selectedTypes = [...restoreStorageCheckboxes]
            .filter(cb => cb.checked && !cb.disabled)
            .map(cb => cb.value);

        if (selectedTypes.length === 0) {
            showApiError(backupRestoreErrorDisplay, 'Select at least one storage area to restore.');
            return;
        }

        const confirmed = await showConfirmationModal(
            'Confirm Restore',
            `This will overwrite data in: ${selectedTypes.map(storageDisplayName).join(', ')}. This cannot be undone.`
        );
        if (!confirmed) { showToast('Restore cancelled.', 'info'); return; }

        showLoading('Restoring data…');
        try {
            const src = currentBackupData.data;
            let count = 0;

            for (const type of selectedTypes) {
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

            currentBackupData = null;
            restorePasswordInput.value      = '';
            restoreFileInput.value          = '';
            setTextContent(selectedFileNameDisplay, 'No file chosen');
            restorePasswordInputGroup.hidden = true;
            restoreOptionsContainer.hidden  = true;
            restoreBackupBtn.disabled       = true;
            restorePasswordInput.disabled   = false;
            verifyPasswordBtn.style.display = 'none';

            await updateStorageSizes();

        } catch (err) {
            console.error('Restore error:', err);
            showApiError(backupRestoreErrorDisplay, `Restore failed: ${err.message}`);
            showToast('Restore failed!', 'error');
        } finally {
            hideLoading();
        }
    });

    // =========================================================================
    // Clear Data
    // =========================================================================
    clearSelectedDataBtn.addEventListener('click', async () => {
        hideApiError(dataManagementErrorDisplay);

        const selectedTypes = [...document.querySelectorAll('#clear-data-section .checkbox-group input:checked')]
            .map(cb => cb.value);

        if (selectedTypes.length === 0) {
            showApiError(dataManagementErrorDisplay, 'Select at least one storage area to clear.');
            return;
        }

        const confirmed = await showConfirmationModal(
            'Confirm Clear',
            `Permanently delete data from: ${selectedTypes.map(storageDisplayName).join(', ')}. This cannot be undone.`
        );
        if (!confirmed) { showToast('Clear cancelled.', 'info'); return; }

        showLoading('Clearing data…');
        try {
            let count = 0;
            for (const type of selectedTypes) {
                try {
                    switch (type) {
                        case 'chromeLocal':  await chrome.storage.local.clear();  break;
                        case 'chromeSync':   await chrome.storage.sync.clear();   break;
                        case 'webLocal':     localStorage.clear();                break;
                        case 'webSession':   sessionStorage.clear();              break;
                    }
                    count++;
                } catch (err) {
                    showToast(`Failed clearing ${storageDisplayName(type)}: ${err.message}`, 'error');
                }
            }

            document.querySelectorAll('#clear-data-section .checkbox-group input').forEach(cb => { cb.checked = false; });
            showToast(`Cleared ${count} storage area(s)!`, 'success');
            await updateStorageSizes();

            if (dataViewerModal.classList.contains('visible')) await loadDataIntoViewer();

        } catch (err) {
            console.error('Clear error:', err);
            showApiError(dataManagementErrorDisplay, `Clear failed: ${err.message}`);
            showToast('Clear failed!', 'error');
        } finally {
            hideLoading();
        }
    });

    // =========================================================================
    // DATA VIEWER MODAL
    // =========================================================================

    async function loadDataIntoViewer() {
        showLoading('Loading storage data…');
        try {
            allStoredData = await getAllStorageData(['chromeLocal', 'chromeSync', 'webLocal', 'webSession', 'chromeManaged']);
            renderViewer();
        } catch (err) {
            console.error('Load error:', err);
            showToast('Failed to load data!', 'error');
        } finally {
            hideLoading();
        }
    }

    viewDataModalBtn.addEventListener('click', async () => {
        dataViewerModal.classList.add('visible');
        dataViewerSearch.value = '';
        dataViewerSearchClear.hidden = true;
        await loadDataIntoViewer();
        dataViewerSearch.focus();
    });

    dataViewerClose.addEventListener('click', () => dataViewerModal.classList.remove('visible'));
    dataViewerModal.addEventListener('click', (e) => { if (e.target === dataViewerModal) dataViewerModal.classList.remove('visible'); });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (keyEditModal.classList.contains('visible')) closeKeyEditModal();
            else if (dataViewerModal.classList.contains('visible')) dataViewerModal.classList.remove('visible');
        }
    });

    // Search
    dataViewerSearch.addEventListener('input', (e) => {
        dataViewerSearchClear.hidden = !e.target.value;
        renderViewer();
    });
    dataViewerSearchClear.addEventListener('click', () => {
        dataViewerSearch.value = '';
        dataViewerSearchClear.hidden = true;
        renderViewer();
        dataViewerSearch.focus();
    });

    // Filter chips
    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFilter = chip.getAttribute('data-filter');
            renderViewer();
        });
    });

    // Expand all
    dataViewerExpandAll.addEventListener('click', () => {
        allExpanded = !allExpanded;
        dataViewerTree.querySelectorAll('.tree-children').forEach(el => {
            el.hidden = !allExpanded;
        });
        dataViewerTree.querySelectorAll('.tree-toggle').forEach(el => {
            el.setAttribute('aria-expanded', String(allExpanded));
        });
    });

    // Copy visible data
    dataViewerCopy.addEventListener('click', () => {
        const text = JSON.stringify(getFilteredData(), null, 2);
        navigator.clipboard.writeText(text)
            .then(() => showToast('Copied to clipboard!', 'success'))
            .catch(() => showToast('Copy failed!', 'error'));
    });

    // -------------------------------------------------------------------------
    // Render helpers
    // -------------------------------------------------------------------------

    function getFilteredData() {
        const q = dataViewerSearch.value.toLowerCase().trim();
        const result = {};

        for (const storageType in allStoredData) {
            if (currentFilter !== 'all' && storageType !== currentFilter) continue;

            const storageData = allStoredData[storageType];
            if (typeof storageData !== 'object' || storageData === null) {
                if (!q || storageType.toLowerCase().includes(q) || String(storageData).toLowerCase().includes(q)) {
                    result[storageType] = storageData;
                }
                continue;
            }

            const filtered = {};
            for (const key in storageData) {
                const valStr = JSON.stringify(storageData[key]).toLowerCase();
                if (!q || key.toLowerCase().includes(q) || valStr.includes(q)) {
                    filtered[key] = storageData[key];
                }
            }
            if (Object.keys(filtered).length > 0) result[storageType] = filtered;
        }
        return result;
    }

    function renderViewer() {
        const filtered = getFilteredData();
        const totalKeys = Object.values(filtered).reduce((acc, v) => {
            return acc + (typeof v === 'object' && v !== null ? Object.keys(v).length : 1);
        }, 0);

        dataViewerStats.textContent = `${Object.keys(filtered).length} area(s) · ${totalKeys} key(s)`;

        const hasData = Object.keys(filtered).length > 0;
        dataViewerEmpty.hidden = hasData;
        dataViewerTree.hidden = !hasData;

        if (hasData) {
            renderTree(filtered);
        }
    }

    function renderTree(data) {
        dataViewerTree.textContent = '';
        const q = dataViewerSearch.value.toLowerCase().trim();

        for (const storageType in data) {
            const storageData = data[storageType];
            const isObj = typeof storageData === 'object' && storageData !== null;
            const keyCount = isObj ? Object.keys(storageData).length : 0;

            const group = document.createElement('div');
            group.className = 'tree-group';
            group.setAttribute('role', 'treeitem');

            const header = document.createElement('div');
            header.className = 'tree-group-header';

            const toggle = document.createElement('button');
            toggle.className = 'btn-icon tree-toggle';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', `Toggle ${storageDisplayName(storageType)}`);
            const toggleIcon = document.createElement('span');
            toggleIcon.className = 'icon icon-list';
            toggleIcon.setAttribute('aria-hidden', 'true');
            toggle.appendChild(toggleIcon);
            header.appendChild(toggle);

            const labelSpan = document.createElement('span');
            labelSpan.className = 'tree-group-name';
            labelSpan.textContent = storageDisplayName(storageType);
            header.appendChild(labelSpan);

            const countBadge = document.createElement('span');
            countBadge.className = 'badge';
            countBadge.textContent = keyCount + ' keys';
            countBadge.style.marginLeft = 'var(--spacing-small)';
            header.appendChild(countBadge);

            group.appendChild(header);

            const children = document.createElement('div');
            children.className = 'tree-children';
            children.setAttribute('role', 'group');
            children.hidden = true; // Collapsed by default

            toggle.addEventListener('click', () => {
                children.hidden = !children.hidden;
                toggle.setAttribute('aria-expanded', String(!children.hidden));
            });

            if (!isObj) {
                const row = buildErrorRow(storageType, String(storageData));
                children.appendChild(row);
            } else {
                for (const key in storageData) {
                    const row = buildKeyRow(storageType, key, storageData[key], q);
                    children.appendChild(row);
                }
            }

            group.appendChild(children);
            dataViewerTree.appendChild(group);
        }
    }

    function buildErrorRow(storageType, message) {
        const row = document.createElement('div');
        row.className = 'tree-row tree-row-error';
        const msg = document.createElement('span');
        msg.className = 'tree-value-error';
        msg.textContent = message;
        row.appendChild(msg);
        return row;
    }

    function buildKeyRow(storageType, key, value, query) {
        const row = document.createElement('div');
        row.className = 'tree-row';
        row.setAttribute('role', 'treeitem');

        const keyEl = document.createElement('span');
        keyEl.className = 'tree-key';
        keyEl.textContent = key;
        if (query && key.toLowerCase().includes(query)) {
            keyEl.classList.add('tree-highlight');
        }
        row.appendChild(keyEl);

        const valueEl = document.createElement('span');
        valueEl.className = 'tree-value';
        const preview = formatValuePreview(value);
        valueEl.textContent = preview;
        if (query && JSON.stringify(value).toLowerCase().includes(query) && !key.toLowerCase().includes(query)) {
            valueEl.classList.add('tree-highlight');
        }
        row.appendChild(valueEl);

        const typeBadge = document.createElement('span');
        typeBadge.className = 'badge badge-type';
        typeBadge.textContent = getValueType(value);
        row.appendChild(typeBadge);

        const actions = document.createElement('div');
        actions.className = 'tree-row-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-icon tree-action-btn';
        copyBtn.setAttribute('aria-label', `Copy value of ${key}`);
        copyBtn.title = 'Copy value';
        const copyIcon = document.createElement('span');
        copyIcon.className = 'icon icon-copy';
        copyIcon.setAttribute('aria-hidden', 'true');
        copyBtn.appendChild(copyIcon);
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
            navigator.clipboard.writeText(text)
                .then(() => showToast(`"${key}" copied!`, 'success'))
                .catch(() => showToast('Copy failed!', 'error'));
        });
        actions.appendChild(copyBtn);

        if (storageType !== 'chromeManaged') {
            const editBtn = document.createElement('button');
            editBtn.className = 'btn-icon tree-action-btn';
            editBtn.setAttribute('aria-label', `Edit ${key}`);
            editBtn.title = 'Edit value';
            const editIcon = document.createElement('span');
            editIcon.className = 'icon icon-settings';
            editIcon.setAttribute('aria-hidden', 'true');
            editBtn.appendChild(editIcon);
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openKeyEditModal(storageType, key, value);
            });
            actions.appendChild(editBtn);

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-icon tree-action-btn tree-action-danger';
            delBtn.setAttribute('aria-label', `Delete ${key}`);
            delBtn.title = 'Delete key';
            const delIcon = document.createElement('span');
            delIcon.className = 'icon icon-trash';
            delIcon.setAttribute('aria-hidden', 'true');
            delBtn.appendChild(delIcon);
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const confirmed = await showConfirmationModal(
                    'Delete Key',
                    `Delete "${key}" from ${storageDisplayName(storageType)}? This cannot be undone.`
                );
                if (!confirmed) return;
                await deleteKey(storageType, key);
            });
            actions.appendChild(delBtn);
        }

        row.appendChild(actions);
        return row;
    }

    function formatValuePreview(value) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'boolean') return String(value);
        if (typeof value === 'number') return String(value);
        if (typeof value === 'string') {
            return value.length > 80 ? value.slice(0, 80) + '…' : value;
        }
        if (Array.isArray(value)) return `[${value.length} items]`;
        if (typeof value === 'object') return `{${Object.keys(value).length} keys}`;
        return String(value);
    }

    function getValueType(value) {
        if (value === null) return 'null';
        if (Array.isArray(value)) return 'array';
        return typeof value;
    }

    // =========================================================================
    // Key operations: delete, edit, save
    // =========================================================================

    async function deleteKey(storageType, key) {
        showLoading(`Deleting "${key}"…`);
        try {
            switch (storageType) {
                case 'chromeLocal':  await chrome.storage.local.remove(key);  break;
                case 'chromeSync':   await chrome.storage.sync.remove(key);   break;
                case 'webLocal':     localStorage.removeItem(key);            break;
                case 'webSession':   sessionStorage.removeItem(key);          break;
                default: throw new Error('Cannot delete from this storage area.');
            }
            if (allStoredData[storageType]) delete allStoredData[storageType][key];
            renderViewer();
            await updateStorageSizes();
            showToast(`"${key}" deleted!`, 'success');
        } catch (err) {
            showToast(`Delete failed: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    function openKeyEditModal(storageType, key, value) {
        editContext = { storageType, key };
        keyEditStorage.textContent = storageDisplayName(storageType);
        keyEditKey.value = key;
        keyEditValue.value = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        keyEditErrorMsg.style.display = 'none';
        keyEditErrorMsg.textContent = '';
        keyEditModal.classList.add('visible');
        keyEditValue.focus();
    }

    function closeKeyEditModal() {
        keyEditModal.classList.remove('visible');
        editContext = null;
    }

    keyEditClose.addEventListener('click', closeKeyEditModal);
    keyEditCancel.addEventListener('click', closeKeyEditModal);
    keyEditModal.addEventListener('click', (e) => { if (e.target === keyEditModal) closeKeyEditModal(); });

    keyEditSave.addEventListener('click', async () => {
        if (!editContext) return;
        const { storageType, key } = editContext;
        const rawValue = keyEditValue.value;

        let parsedValue;
        try {
            parsedValue = JSON.parse(rawValue);
        } catch {
            parsedValue = rawValue;
        }

        showLoading(`Saving "${key}"…`);
        try {
            switch (storageType) {
                case 'chromeLocal':
                    await chrome.storage.local.set({ [key]: parsedValue });
                    break;
                case 'chromeSync':
                    await chrome.storage.sync.set({ [key]: parsedValue });
                    break;
                case 'webLocal':
                    localStorage.setItem(key, typeof parsedValue === 'string' ? parsedValue : JSON.stringify(parsedValue));
                    break;
                case 'webSession':
                    sessionStorage.setItem(key, typeof parsedValue === 'string' ? parsedValue : JSON.stringify(parsedValue));
                    break;
                default:
                    throw new Error('Cannot edit this storage area.');
            }
            if (allStoredData[storageType]) allStoredData[storageType][key] = parsedValue;
            renderViewer();
            await updateStorageSizes();
            showToast(`"${key}" saved!`, 'success');
            closeKeyEditModal();
        } catch (err) {
            keyEditErrorMsg.textContent = `Save failed: ${err.message}`;
            keyEditErrorMsg.style.display = 'block';
            showToast(`Save failed: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    });

    keyEditValue.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) keyEditSave.click();
    });

    // =========================================================================
    // Init
    // =========================================================================
    document.querySelector('.sidebar-button.active').click();
    updateStorageSizes();
});
