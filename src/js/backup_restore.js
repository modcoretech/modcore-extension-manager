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
    const backupFileTypeInput = document.getElementById('backupFileType');
    const enableEncryptionCheckbox = document.getElementById('enableEncryptionCheckbox');
    const encryptionPasswordFields = document.getElementById('encryptionPasswordFields');
    const backupPasswordInput = document.getElementById('backupPassword');
    const confirmBackupPasswordInput = document.getElementById('confirmBackupPassword');

    // Restore elements
    const restoreFileInput = document.getElementById('restoreFile');
    const selectedFileNameDisplay = document.getElementById('selectedFileName');
    const restorePasswordInputGroup = document.getElementById('restorePasswordInputGroup');
    const restorePasswordInput = document.getElementById('restorePassword');

    // General UI elements
    const loadingOverlay = document.getElementById('loading-overlay');
    const backupRestoreErrorDisplay = document.getElementById('backupRestoreError');
    const dataManagementErrorDisplay = document.getElementById('dataManagementError');
    const modalOverlay = document.getElementById('confirmation-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalCancelBtn = document.getElementById('modal-cancel');
    const modalConfirmBtn = document.getElementById('modal-confirm');

    // Storage size displays
    const storageSizeElements = document.querySelectorAll('.storage-size');

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

        // Animate in
        setTimeout(() => toast.classList.add('show'), 10);

        // Animate out and remove
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

    // --- Navigation Logic ---
    sidebarButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active state from all buttons
            sidebarButtons.forEach(btn => btn.classList.remove('active'));
            // Add active state to the clicked button
            button.classList.add('active');

            // Hide all content panels
            contentPanels.forEach(panel => panel.hidden = true);
            // Show the target panel
            const targetPanelId = button.dataset.panel + '-panel';
            document.getElementById(targetPanelId).hidden = false;

            // Hide any active error messages when switching panels
            hideApiError(backupRestoreErrorDisplay);
            hideApiError(dataManagementErrorDisplay);

            // If switching to data management, load storage sizes
            if (button.dataset.panel === 'data-management') {
                updateStorageSizes();
            }
        });
    });

    // --- Encryption/Decryption Helper Functions (Web Crypto API) ---
    // Note: Constants for AES-GCM are standardized.
    const ENCRYPTION_ALGORITHM = 'AES-GCM';
    const IV_LENGTH_BYTES = 12; // 96 bits for AES-GCM recommended IV length
    const SALT_LENGTH_BYTES = 16; // Recommended salt length for PBKDF2

    /**
     * Derives a key from a password using PBKDF2.
     * @param {string} password - The password to derive the key from.
     * @param {Uint8Array} salt - The salt for key derivation.
     * @returns {Promise<CryptoKey>} - The derived AES-GCM key.
     */
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
                iterations: 100000, // Recommended iterations
                hash: "SHA-256",
            },
            keyMaterial,
            { name: ENCRYPTION_ALGORITHM, length: 256 }, // AES-256
            false,
            ["encrypt", "decrypt"]
        );
    }

    /**
     * Encrypts data using AES-GCM.
     * @param {ArrayBuffer} data - The data to encrypt.
     * @param {string} password - The password for encryption.
     * @returns {Promise<ArrayBuffer>} - The encrypted data (concatenated salt + IV + ciphertext).
     */
    async function encryptData(data, password) {
        const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
        const key = await deriveKey(password, salt);

        const ciphertext = await crypto.subtle.encrypt(
            { name: ENCRYPTION_ALGORITHM, iv: iv },
            key,
            data
        );

        // Prepend salt and IV to ciphertext for storage
        const encryptedBuffer = new Uint8Array(salt.byteLength + iv.byteLength + ciphertext.byteLength);
        encryptedBuffer.set(salt, 0);
        encryptedBuffer.set(iv, salt.byteLength);
        encryptedBuffer.set(new Uint8Array(ciphertext), salt.byteLength + iv.byteLength);

        return encryptedBuffer.buffer;
    }

    /**
     * Decrypts data using AES-GCM.
     * @param {ArrayBuffer} encryptedData - The encrypted data (concatenated salt + IV + ciphertext).
     * @param {string} password - The password for decryption.
     * @returns {Promise<ArrayBuffer>} - The decrypted data.
     */
    async function decryptData(encryptedData, password) {
        try {
            const encryptedBytes = new Uint8Array(encryptedData);

            // Ensure the buffer is large enough for salt and IV
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

    /**
     * Checks if a given ArrayBuffer looks like an encrypted backup.
     * This is a heuristic check based on expected header (salt + IV length).
     * @param {ArrayBuffer} buffer - The data buffer to check.
     * @returns {boolean} - True if it likely contains an encrypted header.
     */
    function isEncryptedBackup(buffer) {
        // Encrypted backups should at least contain the salt and IV
        return buffer.byteLength >= (SALT_LENGTH_BYTES + IV_LENGTH_BYTES);
    }

    // --- Chrome Storage & Web Storage Interactions ---

    /**
     * Fetches all data from specified storage types.
     * @returns {Promise<Object>} Object containing data from all storage types.
     */
    async function getAllStorageData() {
        const data = {};

        // Chrome Local Storage
        try {
            data.chromeLocal = await chrome.storage.local.get(null);
        } catch (e) {
            console.warn("Could not retrieve chrome.storage.local:", e);
            data.chromeLocal = { "__error__": "Permission denied or API not available" };
        }

        // Chrome Sync Storage
        try {
            data.chromeSync = await chrome.storage.sync.get(null);
        } catch (e) {
            console.warn("Could not retrieve chrome.storage.sync:", e);
            data.chromeSync = { "__error__": "Permission denied or API not available" };
        }

        // Chrome Managed Storage (read-only)
        try {
            data.chromeManaged = await chrome.storage.managed.get(null);
        } catch (e) {
            console.warn("Could not retrieve chrome.storage.managed (expected for non-managed extensions):", e);
            data.chromeManaged = { "__info__": "Managed storage is read-only and may not be set by policy." };
        }

        // Web Local Storage (window.localStorage)
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

        // Web Session Storage (window.sessionStorage)
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

        return data;
    }

    /**
     * Restores data to specified storage types.
     * @param {Object} data - The data object to restore.
     */
    async function restoreStorageData(data) {
        let restoredCount = 0;

        if (data.chromeLocal) {
            try {
                await chrome.storage.local.clear(); // Clear existing
                await chrome.storage.local.set(data.chromeLocal);
                restoredCount++;
            } catch (e) {
                console.error("Failed to restore chrome.storage.local:", e);
                showToast(`Failed to restore Chrome Local: ${e.message}`, 'error');
            }
        }

        if (data.chromeSync) {
            try {
                await chrome.storage.sync.clear(); // Clear existing
                await chrome.storage.sync.set(data.chromeSync);
                restoredCount++;
            } catch (e) {
                console.error("Failed to restore chrome.storage.sync:", e);
                showToast(`Failed to restore Chrome Sync: ${e.message}`, 'error');
            }
        }

        if (data.webLocal) {
            try {
                localStorage.clear(); // Clear existing
                for (const key in data.webLocal) {
                    if (Object.prototype.hasOwnProperty.call(data.webLocal, key)) {
                        localStorage.setItem(key, data.webLocal[key]);
                    }
                }
                restoredCount++;
            } catch (e) {
                console.error("Failed to restore web localStorage:", e);
                showToast(`Failed to restore Web Local: ${e.message}`, 'error');
            }
        }

        if (data.webSession) {
            try {
                sessionStorage.clear(); // Clear existing
                for (const key in data.webSession) {
                    if (Object.prototype.hasOwnProperty.call(data.webSession, key)) {
                        sessionStorage.setItem(key, data.webSession[key]);
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

    /**
     * Calculates size of an object in bytes.
     * @param {Object} obj - The object to measure.
     * @returns {number} Size in bytes.
     */
    function roughSizeOfObject(obj) {
        if (obj === null || typeof obj !== 'object') return 0;
        let bytes = 0;
        for (const key in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
            bytes += key.length * 2; // Key string length * 2 bytes/char (UTF-16)
            const value = obj[key];
            if (typeof value === 'string') {
                bytes += value.length * 2;
            } else if (typeof value === 'number') {
                bytes += 8; // Double precision float is 8 bytes
            } else if (typeof value === 'boolean') {
                bytes += 4; // Boolean
            } else if (typeof value === 'object') {
                bytes += roughSizeOfObject(value);
            }
        }
        return bytes;
    }

    /**
     * Updates the displayed size for each storage type.
     */
    async function updateStorageSizes() {
        const allData = await getAllStorageData();

        storageSizeElements.forEach(el => {
            const storageType = el.dataset.storage;
            let size = 0;
            switch (storageType) {
                case 'chromeLocal':
                    size = roughSizeOfObject(allData.chromeLocal);
                    break;
                case 'chromeSync':
                    size = roughSizeOfObject(allData.chromeSync);
                    break;
                case 'chromeManaged':
                    size = roughSizeOfObject(allData.chromeManaged);
                    break;
                case 'webLocal':
                    size = roughSizeOfObject(allData.webLocal);
                    break;
                case 'webSession':
                    size = roughSizeOfObject(allData.webSession);
                    break;
            }
            // Convert bytes to KB/MB if necessary
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

    // Toggle password fields based on encryption checkbox
    enableEncryptionCheckbox.addEventListener('change', () => {
        encryptionPasswordFields.hidden = !enableEncryptionCheckbox.checked;
        if (!enableEncryptionCheckbox.checked) {
            backupPasswordInput.value = '';
            confirmBackupPasswordInput.value = '';
            hideApiError(backupRestoreErrorDisplay); // Hide password mismatch error if encryption is disabled
        }
    });

    createBackupBtn.addEventListener('click', async () => {
        hideApiError(backupRestoreErrorDisplay);
        const fileName = backupFileNameInput.value.trim();
        const fileType = backupFileTypeInput.value;
        const encryptBackup = enableEncryptionCheckbox.checked;
        const password = backupPasswordInput.value;
        const confirmPassword = confirmBackupPasswordInput.value;

        if (!fileName) {
            showApiError(backupRestoreErrorDisplay, 'Backup file name cannot be empty.');
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
            const allStorageData = await getAllStorageData();
            let dataToBackup;

            if (fileType === 'json') {
                dataToBackup = new TextEncoder().encode(JSON.stringify(allStorageData, null, 2));
            } else if (fileType === 'txt') {
                // For text, just stringify JSON
                dataToBackup = new TextEncoder().encode(JSON.stringify(allStorageData, null, 2));
            } else if (fileType === 'dat') {
                // For binary, convert JSON string to a Uint8Array buffer
                dataToBackup = new TextEncoder().encode(JSON.stringify(allStorageData)).buffer;
            } else {
                 throw new Error('Unsupported file type selected.');
            }

            let finalDataBlob;
            if (encryptBackup) {
                const encryptedBuffer = await encryptData(dataToBackup, password);
                finalDataBlob = new Blob([encryptedBuffer], { type: 'application/octet-stream' });
                showToast('Backup will be encrypted.', 'info');
            } else {
                finalDataBlob = new Blob([dataToBackup], { type: 'application/octet-stream' });
                showToast('Backup will NOT be encrypted.', 'warning');
            }

            // Use chrome.downloads API if available, otherwise fallback to URL.createObjectURL
            if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
                 await chrome.downloads.download({
                    url: URL.createObjectURL(finalDataBlob),
                    filename: `${fileName}.${fileType}`,
                    saveAs: true
                });
                showToast('Backup download initiated!', 'success');
            } else {
                // Fallback for non-extension environments or if downloads permission is missing
                const url = URL.createObjectURL(finalDataBlob);
                const downloadLink = document.createElement('a');
                downloadLink.href = url;
                downloadLink.download = `${fileName}.${fileType}`;
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                URL.revokeObjectURL(url);
                showToast('Backup file prepared for download. Check your browser\'s downloads.', 'success');
            }

            // Clear password fields regardless of download method
            backupPasswordInput.value = '';
            confirmBackupPasswordInput.value = '';
            enableEncryptionCheckbox.checked = false;
            encryptionPasswordFields.hidden = true;

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
        restoreBackupBtn.disabled = !file; // Enable restore button if file is selected

        if (file) {
            showLoading('Analyzing file...');
            try {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const arrayBuffer = e.target.result;
                    // Heuristically check if the file might be encrypted
                    if (isEncryptedBackup(arrayBuffer)) {
                        restorePasswordInputGroup.hidden = false;
                        showToast('Encrypted backup detected. Please enter password.', 'info');
                    } else {
                        restorePasswordInputGroup.hidden = true;
                        restorePasswordInput.value = ''; // Clear password field if not needed
                        showToast('Unencrypted backup detected.', 'info');
                    }
                    hideLoading();
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
        } else {
            restorePasswordInputGroup.hidden = true;
            restorePasswordInput.value = '';
        }
    });

    restoreBackupBtn.addEventListener('click', async () => {
        hideApiError(backupRestoreErrorDisplay);
        const file = restoreFileInput.files[0];
        const password = restorePasswordInput.value;

        if (!file) {
            showApiError(backupRestoreErrorDisplay, 'Please select a backup file.');
            return;
        }

        showLoading('Restoring backup...');

        try {
            const reader = new FileReader();
            const fileContentPromise = new Promise((resolve, reject) => {
                reader.onload = (event) => resolve(event.target.result);
                reader.onerror = (event) => reject(new Error('Failed to read file.'));
                reader.readAsArrayBuffer(file);
            });

            let fileContentBuffer = await fileContentPromise;
            let decryptedDataBuffer = fileContentBuffer;

            // Check if password field is visible (implies encrypted backup)
            if (!restorePasswordInputGroup.hidden) {
                if (!password) {
                     showApiError(backupRestoreErrorDisplay, 'Please enter the decryption password.');
                     hideLoading();
                     return;
                }
                decryptedDataBuffer = await decryptData(fileContentBuffer, password);
                showToast('File decrypted successfully.', 'success');
            } else {
                showToast('Restoring unencrypted file.', 'info');
            }

            // Convert ArrayBuffer to string assuming UTF-8 JSON content
            const restoredDataString = new TextDecoder('utf-8').decode(decryptedDataBuffer);

            let restoredDataObject;
            try {
                restoredDataObject = JSON.parse(restoredDataString);
            } catch (e) {
                throw new Error('Failed to parse file content as JSON. The file might be corrupted or not a valid backup format.');
            }

            const confirmed = await showConfirmationModal(
                'Confirm Restore',
                'Restoring data will OVERWRITE your current extension data. Are you sure you want to proceed?'
            );

            if (!confirmed) {
                showToast('Restore cancelled.', 'info');
                hideLoading();
                return;
            }

            showLoading('Applying restored data...');
            const restoredCount = await restoreStorageData(restoredDataObject);
            showToast(`Successfully restored data to ${restoredCount} storage areas!`, 'success');

            restorePasswordInput.value = '';
            restoreFileInput.value = ''; // Clear file input
            selectedFileNameDisplay.textContent = 'No file chosen';
            restorePasswordInputGroup.hidden = true; // Hide password field again
            restoreBackupBtn.disabled = true; // Disable restore button

            // After restore, update data view and storage sizes
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

    async function loadAllDataIntoDisplay() {
        showLoading('Loading all stored data...');
        try {
            const data = await getAllStorageData();
            storedDataDisplay.textContent = JSON.stringify(data, null, 2);
            showToast('All data loaded successfully!', 'success');
        } catch (error) {
            console.error('Error loading data:', error);
            showApiError(dataManagementErrorDisplay, `Failed to load data: ${error.message || error}`);
            showToast('Failed to load data!', 'error');
        } finally {
            hideLoading();
        }
    }

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
        document.querySelectorAll('.checkbox-group input[type="checkbox"]:checked').forEach(checkbox => {
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
                        // chromeManaged is disabled and cannot be cleared by the extension
                    }
                    console.log(`Cleared ${type} storage.`);
                }
                catch (e) {
                    console.error(`Error clearing ${type} storage:`, e);
                    showToast(`Failed to clear ${type} storage: ${e.message}`, 'error');
                }
            }

            storedDataDisplay.textContent = 'No data loaded yet. Click \'Load Data\' to view.'; // Clear display
            document.querySelectorAll('.checkbox-group input[type="checkbox"]').forEach(checkbox => checkbox.checked = false); // Uncheck all
            showToast(`Cleared data from ${clearedCount} selected storage areas!`, 'success');

            // Update storage sizes after clearing
            await updateStorageSizes();

        } catch (error) {
            console.error('Error clearing data:', error);
            showApiError(dataManagementErrorDisplay, `Failed to clear data: ${error.message || error}`);
            showToast('Failed to clear data!', 'error');
        } finally {
            hideLoading();
        }
    });

    // Initial load: show the first panel and update storage sizes
    document.querySelector('.sidebar-button.active').click();
    updateStorageSizes();
});