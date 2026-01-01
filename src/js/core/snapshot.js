document.addEventListener('DOMContentLoaded', () => {
    const sidebarButtons = document.querySelectorAll('.sidebar-button');
    const contentPanels = document.querySelectorAll('.content-panel');
    const createBackupBtn = document.getElementById('createBackupBtn');
    const restoreBackupBtn = document.getElementById('restoreBackupBtn');
    const loadDataBtn = document.getElementById('loadDataBtn');
    const clearSelectedDataBtn = document.getElementById('clearSelectedDataBtn');
    const storedDataDisplay = document.querySelector('#stored-data-display pre code');
    const copyDataBtn = document.querySelector('#stored-data-display .btn-copy');

    // Backup elements
    const backupFileNameInput = document.getElementById('backupFileName');
    const backupStorageCheckboxes = document.querySelectorAll('#create-backup-section .checkbox-group input[type="checkbox"]');
    const enableEncryptionCheckbox = document.getElementById('enableEncryptionCheckbox');
    const encryptionPasswordFields = document.getElementById('encryptionPasswordFields');
    const backupPasswordInput = document.getElementById('backupPassword');
    const confirmBackupPasswordInput = document.getElementById('confirmBackupPassword');
    const passwordStrengthBar = document.getElementById('passwordStrengthBar');
    const passwordStrengthText = document.getElementById('passwordStrengthText');
    const passwordStrengthContainer = document.getElementById('password-strength-container');

    // Restore elements
    const restoreFileInput = document.getElementById('restoreFile');
    const selectedFileNameDisplay = document.getElementById('selectedFileName');
    const restorePasswordInputGroup = document.getElementById('restorePasswordInputGroup');
    const restorePasswordInput = document.getElementById('restorePassword');
    const restoreOptionsContainer = document.getElementById('restore-options-container');
    const restoreStorageCheckboxes = document.querySelectorAll('#restore-options-container .checkbox-group input[type="checkbox"]');
    const backupMetadataDisplay = document.getElementById('backup-metadata');

    // Data Management elements
    const dataSearchInput = document.getElementById('dataSearchInput');
    const downloadLoadedDataBtn = document.getElementById('downloadLoadedDataBtn');
    const storedDataCodeView = document.getElementById('stored-data-display');

    // General UI elements
    const loadingOverlay = document.getElementById('loading-overlay');
    const backupRestoreErrorDisplay = document.getElementById('backupRestoreError');
    const dataManagementErrorDisplay = document.getElementById('dataManagementError');
    const modalOverlay = document.getElementById('confirmation-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalCancelBtn = document.getElementById('modal-cancel');
    const modalConfirmBtn = document.getElementById('modal-confirm');

    // Storage size displays and clear data checkboxes
    const storageSizeElements = document.querySelectorAll('.storage-size');
    const clearDataCheckboxes = document.querySelectorAll('#clear-data-section .checkbox-group input[type="checkbox"]');

    let allStoredData = {}; // Cache the loaded data

    // --- Utility Functions ---

    /**
     * Displays a toast notification.
     * @param {string} message - The message to display.
     * @param {'success'|'error'|'info'|'warning'} type - The type of toast.
     */
    function showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 10);

        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove());
        }, 4000);
    }

    /**
     * Shows an error message in the dedicated error display area.
     * @param {HTMLElement} errorDisplayElement - The error display div.
     * @param {string} message - The error message.
     */
    function showApiError(errorDisplayElement, message) {
        errorDisplayElement.querySelector('.error-message').textContent = message;
        errorDisplayElement.style.display = 'flex';
    }

    /**
     * Hides the error message.
     * @param {HTMLElement} errorDisplayElement - The error display div.
     */
    function hideApiError(errorDisplayElement) {
        errorDisplayElement.style.display = 'none';
        errorDisplayElement.querySelector('.error-message').textContent = '';
    }

    /**
     * Shows the loading overlay.
     * @param {string} message - Message to display under spinner.
     */
    function showLoading(message = 'Processing...') {
        loadingOverlay.querySelector('p').textContent = message;
        loadingOverlay.hidden = false;
    }

    /**
     * Hides the loading overlay.
     */
    function hideLoading() {
        loadingOverlay.hidden = true;
    }

    /**
     * Displays a confirmation modal.
     * @param {string} title - Modal title.
     * @param {string} message - Modal message.
     * @returns {Promise<boolean>} Resolves true if confirmed, false if cancelled.
     */
    function showConfirmationModal(title, message) {
        modalTitle.textContent = title;
        modalMessage.textContent = message;
        modalOverlay.classList.add('visible');

        return new Promise((resolve) => {
            const handleConfirm = () => {
                modalOverlay.classList.remove('visible');
                modalConfirmBtn.removeEventListener('click', handleConfirm);
                modalCancelBtn.removeEventListener('click', handleCancel);
                resolve(true);
            };

            const handleCancel = () => {
                modalOverlay.classList.remove('visible');
                modalConfirmBtn.removeEventListener('click', handleConfirm);
                modalCancelBtn.removeEventListener('click', handleCancel);
                resolve(false);
            };

            modalConfirmBtn.addEventListener('click', handleConfirm);
            modalCancelBtn.addEventListener('click', handleCancel);
        });
    }

    /**
     * Generates a backup filename with a timestamp.
     * @returns {string} The generated filename.
     */
    function generateBackupFilename() {
        const now = new Date();
        const pad = (num) => num.toString().padStart(2, '0');
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        return `extension_backup_${dateStr}_${timeStr}`;
    }

    /**
     * Checks password strength and updates the UI.
     * @param {string} password - The password to check.
     */
    function checkPasswordStrength(password) {
        let score = 0;
        if (!password) {
            passwordStrengthBar.value = 0;
            passwordStrengthText.textContent = '';
            passwordStrengthContainer.hidden = true;
            return;
        }

        passwordStrengthContainer.hidden = false;

        // Score based on length
        score += Math.min(password.length * 5, 50);

        // Score based on character types
        let hasUpperCase = /[A-Z]/.test(password);
        let hasLowerCase = /[a-z]/.test(password);
        let hasNumbers = /\d/.test(password);
        let hasSymbols = /[!@#$%^&*(),.?":{}|<>]/.test(password);

        let charTypes = [hasUpperCase, hasLowerCase, hasNumbers, hasSymbols].filter(Boolean).length;
        score += charTypes * 10;

        // Adjust score for length and character type combination
        if (password.length >= 8 && charTypes >= 3) {
            score += 20;
        }

        let strengthText = '';
        let strengthClass = '';

        if (score > 90) {
            strengthText = 'Very Strong';
            strengthClass = 'very-strong';
        } else if (score > 70) {
            strengthText = 'Strong';
            strengthClass = 'strong';
        } else if (score > 50) {
            strengthText = 'Medium';
            strengthClass = 'medium';
        } else if (score > 20) {
            strengthText = 'Weak';
            strengthClass = 'weak';
        } else {
            strengthText = 'Very Weak';
            strengthClass = 'very-weak';
        }

        passwordStrengthBar.value = score;
        passwordStrengthBar.className = strengthClass;
        passwordStrengthText.textContent = strengthText;
        passwordStrengthText.className = `strength-text ${strengthClass}`;
    }

    // --- Navigation Logic ---
    sidebarButtons.forEach(button => {
        button.addEventListener('click', () => {
            sidebarButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            contentPanels.forEach(panel => panel.hidden = true);
            const targetPanelId = button.dataset.panel + '-panel';
            document.getElementById(targetPanelId).hidden = false;

            hideApiError(backupRestoreErrorDisplay);
            hideApiError(dataManagementErrorDisplay);

            if (button.dataset.panel === 'data-management') {
                updateStorageSizes();
            }
        });
    });

    // --- Encryption/Decryption Helper Functions (Web Crypto API) ---
    const ENCRYPTION_ALGORITHM = 'AES-GCM';
    const IV_LENGTH_BYTES = 12;
    const SALT_LENGTH_BYTES = 16;
    const METADATA_KEY = '__backup_metadata__';

    async function deriveKey(password, salt) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            enc.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveBits", "deriveKey"]
        );
        return crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: salt,
                iterations: 100000,
                hash: "SHA-256",
            },
            keyMaterial,
            { name: ENCRYPTION_ALGORITHM, length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    async function encryptData(data, password) {
        const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
        const key = await deriveKey(password, salt);

        const ciphertext = await crypto.subtle.encrypt(
            { name: ENCRYPTION_ALGORITHM, iv: iv },
            key,
            data
        );

        const encryptedBuffer = new Uint8Array(salt.byteLength + iv.byteLength + ciphertext.byteLength);
        encryptedBuffer.set(salt, 0);
        encryptedBuffer.set(iv, salt.byteLength);
        encryptedBuffer.set(new Uint8Array(ciphertext), salt.byteLength + iv.byteLength);

        return encryptedBuffer.buffer;
    }

    async function decryptData(encryptedData, password) {
        try {
            const encryptedBytes = new Uint8Array(encryptedData);

            if (encryptedBytes.byteLength < SALT_LENGTH_BYTES + IV_LENGTH_BYTES) {
                throw new Error("Encrypted data is too short to contain salt and IV.");
            }

            const salt = encryptedBytes.slice(0, SALT_LENGTH_BYTES);
            const iv = encryptedBytes.slice(SALT_LENGTH_BYTES, SALT_LENGTH_BYTES + IV_LENGTH_BYTES);
            const ciphertext = encryptedBytes.slice(SALT_LENGTH_BYTES + IV_LENGTH_BYTES);

            const key = await deriveKey(password, salt);

            const decrypted = await crypto.subtle.decrypt(
                { name: ENCRYPTION_ALGORITHM, iv: iv },
                key,
                ciphertext
            );
            return decrypted;
        } catch (e) {
            console.error("Decryption failed:", e);
            throw new Error("Decryption failed. Incorrect password, corrupted file, or not an encrypted backup.");
        }
    }
    
    function isEncryptedBackup(buffer) {
        try {
            const fileContent = new TextDecoder('utf-8').decode(buffer);
            JSON.parse(fileContent);
            return false;
        } catch (e) {
            return true;
        }
    }

    // --- Chrome Storage & Web Storage Interactions ---

    async function getAllStorageData(storageTypes = ['chromeLocal', 'chromeSync', 'webLocal', 'webSession']) {
        const data = {};

        if (storageTypes.includes('chromeLocal')) {
            try {
                data.chromeLocal = await chrome.storage.local.get(null);
            } catch (e) {
                console.warn("Could not retrieve chrome.storage.local:", e);
                data.chromeLocal = { "__error__": "Permission denied or API not available" };
            }
        }

        if (storageTypes.includes('chromeSync')) {
            try {
                data.chromeSync = await chrome.storage.sync.get(null);
            } catch (e) {
                console.warn("Could not retrieve chrome.storage.sync:", e);
                data.chromeSync = { "__error__": "Permission denied or API not available" };
            }
        }

        if (storageTypes.includes('chromeManaged')) {
            try {
                data.chromeManaged = await chrome.storage.managed.get(null);
            } catch (e) {
                console.warn("Could not retrieve chrome.storage.managed (expected for non-managed extensions):", e);
                data.chromeManaged = { "__info__": "Managed storage is read-only and may not be set by policy." };
            }
        }

        if (storageTypes.includes('webLocal')) {
            data.webLocal = {};
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    data.webLocal[key] = localStorage.getItem(key);
                }
            } catch (e) {
                console.warn("Could not retrieve localStorage:", e);
                data.webLocal = { "__error__": "Access denied or quota exceeded" };
            }
        }

        if (storageTypes.includes('webSession')) {
            data.webSession = {};
            try {
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    data.webSession[key] = sessionStorage.getItem(key);
                }
            } catch (e) {
                console.warn("Could not retrieve sessionStorage:", e);
                data.webSession = { "__error__": "Access denied or quota exceeded" };
            }
        }

        return data;
    }

    async function restoreStorageData(data, storageTypes) {
        let restoredCount = 0;
        const originalData = data[METADATA_KEY] ? { ...data } : data;

        if (storageTypes.includes('chromeLocal') && originalData.chromeLocal) {
            try {
                await chrome.storage.local.clear();
                await chrome.storage.local.set(originalData.chromeLocal);
                restoredCount++;
            } catch (e) {
                console.error("Failed to restore chrome.storage.local:", e);
                showToast(`Failed to restore Chrome Local: ${e.message}`, 'error');
            }
        }

        if (storageTypes.includes('chromeSync') && originalData.chromeSync) {
            try {
                await chrome.storage.sync.clear();
                await chrome.storage.sync.set(originalData.chromeSync);
                restoredCount++;
            } catch (e) {
                console.error("Failed to restore chrome.storage.sync:", e);
                showToast(`Failed to restore Chrome Sync: ${e.message}`, 'error');
            }
        }

        if (storageTypes.includes('webLocal') && originalData.webLocal) {
            try {
                localStorage.clear();
                for (const key in originalData.webLocal) {
                    if (Object.prototype.hasOwnProperty.call(originalData.webLocal, key)) {
                        localStorage.setItem(key, originalData.webLocal[key]);
                    }
                }
                restoredCount++;
            } catch (e) {
                console.error("Failed to restore web localStorage:", e);
                showToast(`Failed to restore Web Local: ${e.message}`, 'error');
            }
        }

        if (storageTypes.includes('webSession') && originalData.webSession) {
            try {
                sessionStorage.clear();
                for (const key in originalData.webSession) {
                    if (Object.prototype.hasOwnProperty.call(originalData.webSession, key)) {
                        sessionStorage.setItem(key, originalData.webSession[key]);
                    }
                }
                restoredCount++;
            } catch (e) {
                console.error("Failed to restore web sessionStorage:", e);
                showToast(`Failed to restore Web Session: ${e.message}`, 'error');
            }
        }
        return restoredCount;
    }

    function roughSizeOfObject(obj) {
        if (obj === null || typeof obj !== 'object') return 0;
        let bytes = 0;
        for (const key in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
            bytes += key.length * 2;
            const value = obj[key];
            if (typeof value === 'string') {
                bytes += value.length * 2;
            } else if (typeof value === 'number') {
                bytes += 8;
            } else if (typeof value === 'boolean') {
                bytes += 4;
            } else if (typeof value === 'object') {
                bytes += roughSizeOfObject(value);
            }
        }
        return bytes;
    }

    async function updateStorageSizes() {
        const allData = await getAllStorageData(['chromeLocal', 'chromeSync', 'webLocal', 'webSession', 'chromeManaged']);

        storageSizeElements.forEach(el => {
            const storageType = el.dataset.storage;
            let size = 0;
            if (allData[storageType]) {
                size = roughSizeOfObject(allData[storageType]);
            }
            if (size < 1024) {
                el.textContent = `${size} B`;
            } else if (size < 1024 * 1024) {
                el.textContent = `${(size / 1024).toFixed(2)} KB`;
            } else {
                el.textContent = `${(size / (1024 * 1024)).toFixed(2)} MB`;
            }
        });
    }

    // --- Backup Logic ---

    enableEncryptionCheckbox.addEventListener('change', () => {
        const isChecked = enableEncryptionCheckbox.checked;
        encryptionPasswordFields.hidden = !isChecked;
        passwordStrengthContainer.hidden = !isChecked;
        if (!isChecked) {
            backupPasswordInput.value = '';
            confirmBackupPasswordInput.value = '';
            hideApiError(backupRestoreErrorDisplay);
            checkPasswordStrength('');
        }
    });
    
    backupPasswordInput.addEventListener('input', (e) => {
        if (enableEncryptionCheckbox.checked) {
            checkPasswordStrength(e.target.value);
        }
    });

    createBackupBtn.addEventListener('click', async () => {
        hideApiError(backupRestoreErrorDisplay);
        const fileName = backupFileNameInput.value.trim() || generateBackupFilename();
        const encryptBackup = enableEncryptionCheckbox.checked;
        const password = backupPasswordInput.value;
        const confirmPassword = confirmBackupPasswordInput.value;

        const selectedStorageTypes = Array.from(backupStorageCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);

        if (selectedStorageTypes.length === 0) {
            showApiError(backupRestoreErrorDisplay, 'Please select at least one storage type to backup.');
            return;
        }

        if (encryptBackup) {
            if (!password) {
                showApiError(backupRestoreErrorDisplay, 'Encryption password cannot be empty.');
                return;
            }
            if (password !== confirmPassword) {
                showApiError(backupRestoreErrorDisplay, 'Passwords do not match.');
                return;
            }
        }

        showLoading('Collecting data and creating backup...');

        try {
            const allStorageData = await getAllStorageData(selectedStorageTypes);
            const metadata = {
                created_at: new Date().toISOString(),
                version: chrome.runtime.getManifest().version,
                storage_types: selectedStorageTypes
            };
            const dataWithMetadata = { [METADATA_KEY]: metadata, ...allStorageData };

            let dataToBackup;
            dataToBackup = new TextEncoder().encode(JSON.stringify(dataWithMetadata, null, 2));

            let finalDataBlob;
            if (encryptBackup) {
                const encryptedBuffer = await encryptData(dataToBackup.buffer, password);
                finalDataBlob = new Blob([encryptedBuffer], { type: 'application/octet-stream' });
                showToast('Backup will be encrypted.', 'info');
            } else {
                finalDataBlob = new Blob([dataToBackup], { type: 'application/json' });
                showToast('Backup will NOT be encrypted.', 'warning');
            }

            const downloadUrl = URL.createObjectURL(finalDataBlob);
            const downloadLink = document.createElement('a');
            downloadLink.href = downloadUrl;
            downloadLink.download = `${fileName}.json`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            URL.revokeObjectURL(downloadUrl);

            showToast('Backup download initiated!', 'success');

            backupPasswordInput.value = '';
            confirmBackupPasswordInput.value = '';
            enableEncryptionCheckbox.checked = false;
            encryptionPasswordFields.hidden = true;
            passwordStrengthContainer.hidden = true;
        } catch (error) {
            console.error('Error creating backup:', error);
            showApiError(backupRestoreErrorDisplay, `Failed to create backup: ${error.message || error}`);
            showToast('Failed to create backup!', 'error');
        } finally {
            hideLoading();
        }
    });

    // --- Restore Logic ---

    restoreFileInput.addEventListener('change', async (event) => {
        hideApiError(backupRestoreErrorDisplay);
        const file = event.target.files[0];
        selectedFileNameDisplay.textContent = file ? file.name : 'No file chosen';
        restoreBackupBtn.disabled = !file;
        restorePasswordInput.value = '';
        backupMetadataDisplay.innerHTML = '';

        restoreOptionsContainer.hidden = true;
        restorePasswordInputGroup.hidden = true;
        restoreBackupBtn.disabled = true;

        if (!file) return;
        
        showLoading('Analyzing file...');
        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const arrayBuffer = e.target.result;
                const isEncrypted = isEncryptedBackup(arrayBuffer);

                if (isEncrypted) {
                    restorePasswordInputGroup.hidden = false;
                    restoreOptionsContainer.hidden = true;
                    restoreBackupBtn.disabled = true;
                    showToast('Encrypted backup detected. Please enter a password to restore.', 'info');
                    hideLoading();
                } else {
                    restorePasswordInputGroup.hidden = true;
                    restoreOptionsContainer.hidden = false;
                    restoreBackupBtn.disabled = false;
                    
                    const fileContent = new TextDecoder('utf-8').decode(arrayBuffer);
                    let restoredDataObject = JSON.parse(fileContent);

                    if (restoredDataObject[METADATA_KEY]) {
                         displayBackupMetadata(restoredDataObject[METADATA_KEY]);
                    } else {
                         displayBackupMetadata(null);
                    }
                    updateRestoreCheckboxesBasedOnLoadedData(restoredDataObject);

                    showToast('Unencrypted backup detected.', 'info');
                    hideLoading();
                }
            };
            reader.onerror = (e) => {
                hideLoading();
                showApiError(backupRestoreErrorDisplay, 'Failed to read file.');
                showToast('Failed to read file!', 'error');
            };
            reader.readAsArrayBuffer(file);
        } catch (error) {
            hideLoading();
            console.error('Error analyzing file:', error);
            showApiError(backupRestoreErrorDisplay, `Error analyzing file: ${error.message}`);
            showToast('Error analyzing file!', 'error');
        }
    });

    restorePasswordInput.addEventListener('input', () => {
        // Only enable the restore button if a password is typed
        restoreBackupBtn.disabled = restorePasswordInput.value.trim() === '';
    });


    function displayBackupMetadata(metadata) {
        if (metadata) {
            const date = new Date(metadata.created_at).toLocaleString();
            backupMetadataDisplay.innerHTML = `
                <h4>Backup File Information:</h4>
                <p><strong>Created At:</strong> ${date}</p>
                <p><strong>Extension Version:</strong> ${metadata.version || 'N/A'}</p>
                <p><strong>Storage Types:</strong> ${metadata.storage_types ? metadata.storage_types.join(', ') : 'All'}</p>
            `;
        } else {
            backupMetadataDisplay.innerHTML = `<p>No metadata found in this backup file.</p>`;
        }
    }

    function updateRestoreCheckboxesBasedOnLoadedData(data) {
        restoreStorageCheckboxes.forEach(checkbox => {
            const storageType = checkbox.value;
            checkbox.checked = data[storageType] && Object.keys(data[storageType]).length > 0;
            checkbox.disabled = !checkbox.checked;
        });
    }

    restoreBackupBtn.addEventListener('click', async () => {
        hideApiError(backupRestoreErrorDisplay);
        const file = restoreFileInput.files[0];
        const password = restorePasswordInput.value;
        const isPasswordNeeded = !restorePasswordInputGroup.hidden;

        if (!file) {
            showApiError(backupRestoreErrorDisplay, 'Please select a backup file.');
            return;
        }

        if (isPasswordNeeded && !password) {
            showApiError(backupRestoreErrorDisplay, 'Please enter the decryption password.');
            return;
        }
        
        let restoredDataString;
        showLoading('Reading file...');

        try {
            const reader = new FileReader();
            const fileContentPromise = new Promise((resolve, reject) => {
                reader.onload = (event) => resolve(event.target.result);
                reader.onerror = (event) => reject(new Error('Failed to read file.'));
                reader.readAsArrayBuffer(file);
            });

            let fileContentBuffer = await fileContentPromise;
            
            showLoading('Analyzing backup...');
            const isEncrypted = isEncryptedBackup(fileContentBuffer);

            if (isEncrypted) {
                // If encrypted, but restore options were already shown (bug), hide them
                restoreOptionsContainer.hidden = true;
                if (!password) {
                     showApiError(backupRestoreErrorDisplay, 'Please enter the decryption password.');
                     hideLoading();
                     return;
                }
                showLoading('Decrypting backup...');
                const decryptedDataBuffer = await decryptData(fileContentBuffer, password);
                restoredDataString = new TextDecoder('utf-8').decode(decryptedDataBuffer);
                showToast('File decrypted successfully.', 'success');
            } else {
                restoredDataString = new TextDecoder('utf-8').decode(fileContentBuffer);
                showToast('Restoring unencrypted file.', 'info');
            }

            let restoredDataObject;
            try {
                restoredDataObject = JSON.parse(restoredDataString);
            } catch (e) {
                throw new Error('Failed to parse file content as JSON. The file might be corrupted or not a valid backup format.');
            }
            
            // At this point, we have a valid JS object. We show the options and wait for a second click.
            // This is the implementation of the user's requested flow.
            
            if (isEncrypted) {
                // If this is the first click on an encrypted file, show the options and metadata.
                // The user must click again to confirm the restore.
                
                if (restoredDataObject[METADATA_KEY]) {
                     displayBackupMetadata(restoredDataObject[METADATA_KEY]);
                } else {
                     displayBackupMetadata(null);
                }
                updateRestoreCheckboxesBasedOnLoadedData(restoredDataObject);
                restoreOptionsContainer.hidden = false;
                
                showToast('Backup details loaded. Select data to restore and click again to confirm.', 'info');
                hideLoading();
                
                // Store the parsed object for the next click
                restoreBackupBtn.dataset.parsedData = JSON.stringify(restoredDataObject);
                restorePasswordInput.disabled = true; // Prevent changing password after successful decryption
                return; // End the function here to wait for a second click
            }

            const selectedRestoreTypes = Array.from(restoreStorageCheckboxes)
                .filter(cb => cb.checked)
                .map(cb => cb.value);
            
            if (selectedRestoreTypes.length === 0) {
                 showApiError(backupRestoreErrorDisplay, 'Please select at least one storage type to restore.');
                 hideLoading();
                 return;
            }

            const confirmed = await showConfirmationModal(
                'Confirm Restore',
                `Restoring data will OVERWRITE your current extension data for the selected storage types: ${selectedRestoreTypes.join(', ')}. Are you sure you want to proceed?`
            );

            if (!confirmed) {
                showToast('Restore cancelled.', 'info');
                hideLoading();
                return;
            }

            showLoading('Applying restored data...');
            const restoredCount = await restoreStorageData(restoredDataObject, selectedRestoreTypes);
            showToast(`Successfully restored data to ${restoredCount} storage areas!`, 'success');

            restorePasswordInput.value = '';
            restoreFileInput.value = '';
            selectedFileNameDisplay.textContent = 'No file chosen';
            restorePasswordInputGroup.hidden = true;
            restoreOptionsContainer.hidden = true;
            restoreBackupBtn.disabled = true;
            restorePasswordInput.disabled = false; // Reset for next time
            delete restoreBackupBtn.dataset.parsedData; // Clear stored data
            
            await loadAllDataIntoDisplay();
            await updateStorageSizes();

        } catch (error) {
            console.error('Error restoring backup:', error);
            showApiError(backupRestoreErrorDisplay, `Failed to restore backup: ${error.message || error}`);
            showToast('Failed to restore backup!', 'error');
        } finally {
            hideLoading();
        }
    });

    // --- Data Management Logic ---

    function renderData(data, filterText = '') {
        renderDataCodeView(data, filterText);
    }

    function renderDataCodeView(data, filterText) {
        let filteredData = {};
        const lowerFilter = filterText.toLowerCase();

        for (const storageType in data) {
            const storageData = data[storageType];
            if (typeof storageData === 'object' && storageData !== null) {
                const newStorageData = {};
                for (const key in storageData) {
                    if (key.toLowerCase().includes(lowerFilter) || JSON.stringify(storageData[key]).toLowerCase().includes(lowerFilter)) {
                        newStorageData[key] = storageData[key];
                    }
                }
                if (Object.keys(newStorageData).length > 0) {
                    filteredData[storageType] = newStorageData;
                }
            } else {
                // Handle error messages
                if (storageType.toLowerCase().includes(lowerFilter) || JSON.stringify(storageData).toLowerCase().includes(lowerFilter)) {
                    filteredData[storageType] = storageData;
                }
            }
        }
        storedDataDisplay.textContent = JSON.stringify(filteredData, null, 2);
    }

    async function loadAllDataIntoDisplay() {
        showLoading('Loading all stored data...');
        try {
            allStoredData = await getAllStorageData(['chromeLocal', 'chromeSync', 'webLocal', 'webSession', 'chromeManaged']);
            renderData(allStoredData);
            showToast('All data loaded successfully!', 'success');
        } catch (error) {
            console.error('Error loading data:', error);
            showApiError(dataManagementErrorDisplay, `Failed to load data: ${error.message || error}`);
            showToast('Failed to load data!', 'error');
        } finally {
            hideLoading();
        }
    }

    dataSearchInput.addEventListener('input', (e) => {
        if (Object.keys(allStoredData).length > 0) {
            renderData(allStoredData, e.target.value);
        }
    });

    downloadLoadedDataBtn.addEventListener('click', () => {
        const textToDownload = storedDataDisplay.textContent;
        const fileName = `extension_data_export_${new Date().toISOString()}.json`;
        const blob = new Blob([textToDownload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = fileName;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
        showToast('Data download initiated!', 'success');
    });

    loadDataBtn.addEventListener('click', loadAllDataIntoDisplay);

    copyDataBtn.addEventListener('click', () => {
        const textToCopy = storedDataDisplay.textContent;
        navigator.clipboard.writeText(textToCopy).then(() => {
            showToast('Data copied to clipboard!', 'info');
        }).catch(err => {
            console.error('Failed to copy text:', err);
            showToast('Failed to copy data!', 'error');
        });
    });

    clearSelectedDataBtn.addEventListener('click', async () => {
        hideApiError(dataManagementErrorDisplay);
        const selectedStorageTypes = [];
        document.querySelectorAll('#clear-data-section .checkbox-group input[type="checkbox"]:checked').forEach(checkbox => {
            selectedStorageTypes.push(checkbox.value);
        });

        if (selectedStorageTypes.length === 0) {
            showApiError(dataManagementErrorDisplay, 'Please select at least one storage type to clear.');
            return;
        }

        const storageNames = selectedStorageTypes.map(s => {
            switch (s) {
                case 'chromeLocal': return 'Chrome Local Storage';
                case 'chromeSync': return 'Chrome Sync Storage';
                case 'webLocal': return 'Web Local Storage';
                case 'webSession': return 'Web Session Storage';
                default: return s;
            }
        });

        const confirmed = await showConfirmationModal(
            'Confirm Data Deletion',
            `Are you sure you want to permanently clear data from: ${storageNames.join(', ')}? This action cannot be undone.`
        );

        if (!confirmed) {
            showToast('Data deletion cancelled.', 'info');
            return;
        }

        showLoading('Clearing selected data...');

        try {
            let clearedCount = 0;
            for (const type of selectedStorageTypes) {
                try {
                    switch (type) {
                        case 'chromeLocal':
                            await chrome.storage.local.clear();
                            clearedCount++;
                            break;
                        case 'chromeSync':
                            await chrome.storage.sync.clear();
                            clearedCount++;
                            break;
                        case 'webLocal':
                            localStorage.clear();
                            clearedCount++;
                            break;
                        case 'webSession':
                            sessionStorage.clear();
                            clearedCount++;
                            break;
                    }
                    console.log(`Cleared ${type} storage.`);
                }
                catch (e) {
                    console.error(`Error clearing ${type} storage:`, e);
                    showToast(`Failed to clear ${type} storage: ${e.message}`, 'error');
                }
            }

            storedDataDisplay.innerHTML = `<code>No data loaded yet. Click 'Load Data' to view.</code>`;
            document.querySelectorAll('#clear-data-section .checkbox-group input[type="checkbox"]').forEach(checkbox => checkbox.checked = false);
            showToast(`Cleared data from ${clearedCount} selected storage areas!`, 'success');

            await updateStorageSizes();
            await loadAllDataIntoDisplay(); // Reload to reflect changes

        } catch (error) {
            console.error('Error clearing data:', error);
            showApiError(dataManagementErrorDisplay, `Failed to clear data: ${error.message || error}`);
            showToast('Failed to clear data!', 'error');
        } finally {
            hideLoading();
        }
    });

    document.querySelector('.sidebar-button.active').click();
    updateStorageSizes();
});
