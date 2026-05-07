/**
 * Extension Notes - Note Management for modcore Extension Manager
 * Enhanced: Passkey auth, PSF encryption, Settings/Recovery modal, bug fixes
 */

// ============================================
// CONSTANTS & CONFIGURATION
// ============================================

const STORAGE_KEY        = 'modcore_extension_notes_v5_psf';
const PSF_META_KEY       = 'modcore_psf_meta_v5';
const RECOVERY_KEY       = 'modcore_recovery_codes_v5';
const THEME_KEY          = 'modcore_notes_theme';
const SECURITY_ITERATIONS = 600000;
const PSF_VERSION        = 5;

// How many recovery codes to generate
const RECOVERY_CODE_COUNT = 8;

const ICONS = {
    default:  '../../public/icons/svg/dots-circle1.svg',
    search:   '../../public/icons/svg/search.svg',
    close:    '../../public/icons/svg/close.svg',
    pin:      '../../public/icons/svg/pin.svg',
    unpin:    '../../public/icons/svg/pin-off.svg',
    lock:     '../../public/icons/svg/lock.svg',
    unlock:   '../../public/icons/svg/lock-open.svg',
    shield:   '../../public/icons/svg/shield.svg',
    star:     '../../public/icons/svg/star.svg',
    tag:      '../../public/icons/svg/tag.svg',
    plus:     '../../public/icons/svg/plus.svg',
    settings: '../../public/icons/svg/settings.svg',
    download: '../../public/icons/svg/install.svg',
    upload:   '../../public/icons/svg/upload.svg',
    keyboard: '../../public/icons/svg/keyboard.svg',
    moon:     '../../public/icons/svg/moon.svg',
    sun:      '../../public/icons/svg/sun.svg',
    trash:    '../../public/icons/svg/trash.svg',
    edit:     '../../public/icons/svg/edit.svg',
    check:    '../../public/icons/svg/check.svg',
    warning:  '../../public/icons/svg/warning.svg',
    info:     '../../public/icons/svg/info.svg',
    key:      '../../public/icons/svg/key.svg',
    passkey:  '../../public/icons/svg/shield.svg'
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/** Secure DOM element builder */
function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    if (props.className) el.className = props.className;
    if (props.id)        el.id = props.id;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.attrs) Object.entries(props.attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (props.style) Object.entries(props.style).forEach(([k, v]) => el.style[k] = v);
    if (props.on)    Object.entries(props.on).forEach(([ev, fn]) => el.addEventListener(ev, fn));
    children.forEach(child => {
        if (child == null) return;
        if (typeof child === 'string' || typeof child === 'number') {
            el.appendChild(document.createTextNode(String(child)));
        } else if (child instanceof Node) {
            el.appendChild(child);
        }
    });
    return el;
}

function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function generateRecoveryCode() {
    // Format: XXXX-XXXX-XXXX (uppercase alphanumeric, no ambiguous chars)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const rand = crypto.getRandomValues(new Uint8Array(12));
    for (let i = 0; i < 12; i++) {
        if (i > 0 && i % 4 === 0) code += '-';
        code += chars[rand[i] % chars.length];
    }
    return code;
}

// ============================================
// CRYPTOGRAPHIC FUNCTIONS
// ============================================

async function deriveKey(password, salt, iterations = SECURITY_ITERATIONS) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encryptData(data, password) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const key  = await deriveKey(password, salt);
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(data)
    );
    const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);
    return bufferToBase64(result);
}

async function decryptData(encryptedData, password) {
    try {
        const data       = base64ToBuffer(encryptedData);
        const salt       = data.slice(0, 16);
        const iv         = data.slice(16, 28);
        const ciphertext = data.slice(28);
        const key = await deriveKey(password, new Uint8Array(salt));
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(iv) },
            key,
            new Uint8Array(ciphertext)
        );
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        return null;
    }
}

async function hashData(data, salt = null) {
    const encoder  = new TextEncoder();
    const useSalt  = salt || crypto.getRandomValues(new Uint8Array(16));
    const keyMat   = await crypto.subtle.importKey(
        'raw', encoder.encode(data), { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const hash = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: useSalt, iterations: SECURITY_ITERATIONS, hash: 'SHA-256' },
        keyMat, 256
    );
    return { hash: bufferToBase64(hash), salt: bufferToBase64(useSalt) };
}

async function verifyHash(stored, data) {
    const result = await hashData(data, base64ToBuffer(stored.salt));
    return result.hash === stored.hash;
}

// ============================================
// PSF (Passkey Storage Format) KEY MANAGEMENT
//
// Design:
//   - A random 32-byte "vault key" is generated once and stored AES-GCM
//     encrypted by a key derived from the passkey's PRF output (or
//     a recovery code for fallback).
//   - All notes are encrypted with the vault key.
//   - This means a passkey change only re-wraps the vault key, not all notes.
// ============================================

class PSFKeyManager {
    constructor() {
        this.vaultKey      = null;   // CryptoKey (AES-GCM, 256-bit)
        this.vaultKeyRaw   = null;   // Uint8Array (raw bytes for re-export)
        this.meta          = null;   // stored PSF metadata
    }

    /** Load PSF metadata from chrome.storage */
    async loadMeta() {
        return new Promise(resolve => {
            chrome.storage.local.get([PSF_META_KEY], r => {
                this.meta = r[PSF_META_KEY] || null;
                resolve(this.meta);
            });
        });
    }

    /** Save PSF metadata */
    async saveMeta(meta) {
        this.meta = meta;
        return new Promise(resolve => {
            chrome.storage.local.set({ [PSF_META_KEY]: meta }, resolve);
        });
    }

    get isSetup() { return !!this.meta; }

    /** Check if WebAuthn PRF extension is available */
    async checkPasskeySupport() {
        if (!window.PublicKeyCredential) return false;
        if (!PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return false;
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        return available;
    }

    /**
     * Create a new passkey and initialize the vault.
     * Returns { success, credentialId, recoveryCodes }
     */
    async setupPasskey(userId = 'modcore-notes-user') {
        const challenge   = crypto.getRandomValues(new Uint8Array(32));
        const userIdBytes = new TextEncoder().encode(userId);

        let credential;
        try {
            credential = await navigator.credentials.create({
                publicKey: {
                    rp: { name: 'modcore Extension Notes', id: location.hostname || 'localhost' },
                    user: { id: userIdBytes, name: userId, displayName: 'Extension Notes User' },
                    challenge,
                    pubKeyCredParams: [
                        { type: 'public-key', alg: -7  },   // ES256
                        { type: 'public-key', alg: -257 }   // RS256
                    ],
                    authenticatorSelection: {
                        authenticatorAttachment: 'platform',
                        userVerification: 'required',
                        residentKey: 'required'
                    },
                    extensions: { prf: { eval: { first: new Uint8Array(32).fill(1) } } },
                    timeout: 60000
                }
            });
        } catch (e) {
            console.error('Passkey creation failed:', e);
            return { success: false, error: e.message };
        }

        // Generate the vault key (random 256-bit key)
        const vaultKeyRaw = crypto.getRandomValues(new Uint8Array(32));
        const vaultKey    = await crypto.subtle.importKey(
            'raw', vaultKeyRaw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
        );

        // Wrap vault key using PRF output if available, otherwise derive from credential id
        const prfResult = credential.getClientExtensionResults()?.prf?.results?.first;
        const wrapSecret = prfResult
            ? bufferToBase64(prfResult)
            : bufferToBase64(new Uint8Array(credential.rawId));

        const wrappedKey = await encryptData(bufferToBase64(vaultKeyRaw), wrapSecret);

        // Generate recovery codes and hash them for verification
        const codes     = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
        const codeHashes = await Promise.all(codes.map(c => hashData(c)));

        // Encrypt vault key with each recovery code for independent recovery
        const recoveryWraps = await Promise.all(
            codes.map(code => encryptData(bufferToBase64(vaultKeyRaw), code))
        );

        const meta = {
            version:      PSF_VERSION,
            credentialId: bufferToBase64(new Uint8Array(credential.rawId)),
            wrappedKey,
            hasPRF:       !!prfResult,
            createdAt:    Date.now(),
            userId
        };

        await this.saveMeta(meta);

        // Save hashed recovery codes + wrapped vault key per code
        const recoveryData = {
            codes: codeHashes.map((h, i) => ({
                hash: h.hash,
                salt: h.salt,
                wrappedKey: recoveryWraps[i],
                used: false,
                createdAt: Date.now()
            }))
        };
        await this._saveRecoveryData(recoveryData);

        this.vaultKey    = vaultKey;
        this.vaultKeyRaw = vaultKeyRaw;

        return { success: true, credentialId: meta.credentialId, recoveryCodes: codes };
    }

    /**
     * Authenticate using passkey and unlock vault key.
     * Returns { success }
     */
    async authenticatePasskey() {
        if (!this.meta) return { success: false, error: 'Not set up' };

        const challenge = crypto.getRandomValues(new Uint8Array(32));

        let assertion;
        try {
            assertion = await navigator.credentials.get({
                publicKey: {
                    challenge,
                    rpId: location.hostname || 'localhost',
                    userVerification: 'required',
                    allowCredentials: [{
                        type: 'public-key',
                        id: base64ToBuffer(this.meta.credentialId)
                    }],
                    extensions: { prf: { eval: { first: new Uint8Array(32).fill(1) } } },
                    timeout: 60000
                }
            });
        } catch (e) {
            console.error('Passkey assertion failed:', e);
            return { success: false, error: e.message };
        }

        const prfResult = assertion.getClientExtensionResults()?.prf?.results?.first;
        const wrapSecret = prfResult
            ? bufferToBase64(prfResult)
            : bufferToBase64(new Uint8Array(assertion.rawId));

        const vaultKeyB64 = await decryptData(this.meta.wrappedKey, wrapSecret);
        if (!vaultKeyB64) return { success: false, error: 'Failed to unwrap vault key' };

        const vaultKeyRaw = new Uint8Array(base64ToBuffer(vaultKeyB64));
        const vaultKey    = await crypto.subtle.importKey(
            'raw', vaultKeyRaw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
        );

        this.vaultKey    = vaultKey;
        this.vaultKeyRaw = vaultKeyRaw;
        return { success: true };
    }

    /**
     * Recover using a recovery code.
     * Returns { success, remainingCodes }
     */
    async recoverWithCode(code) {
        const recoveryData = await this._loadRecoveryData();
        if (!recoveryData) return { success: false, error: 'No recovery data' };

        const cleanCode = code.trim().toUpperCase().replace(/\s/g, '');
        let matchIdx = -1;

        for (let i = 0; i < recoveryData.codes.length; i++) {
            const entry = recoveryData.codes[i];
            if (entry.used) continue;
            const valid = await verifyHash({ hash: entry.hash, salt: entry.salt }, cleanCode);
            if (valid) { matchIdx = i; break; }
        }

        if (matchIdx === -1) return { success: false, error: 'Invalid or already-used recovery code' };

        const entry       = recoveryData.codes[matchIdx];
        const vaultKeyB64 = await decryptData(entry.wrappedKey, cleanCode);
        if (!vaultKeyB64) return { success: false, error: 'Corrupted recovery entry' };

        // Mark code as used
        recoveryData.codes[matchIdx].used       = true;
        recoveryData.codes[matchIdx].usedAt     = Date.now();
        await this._saveRecoveryData(recoveryData);

        const vaultKeyRaw = new Uint8Array(base64ToBuffer(vaultKeyB64));
        const vaultKey    = await crypto.subtle.importKey(
            'raw', vaultKeyRaw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
        );

        this.vaultKey    = vaultKey;
        this.vaultKeyRaw = vaultKeyRaw;

        const remaining = recoveryData.codes.filter(c => !c.used).length;
        return { success: true, remainingCodes: remaining };
    }

    /** Regenerate recovery codes (requires vault to be unlocked) */
    async regenerateRecoveryCodes() {
        if (!this.vaultKeyRaw) return null;
        const vaultKeyB64 = bufferToBase64(this.vaultKeyRaw);

        const codes       = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
        const codeHashes  = await Promise.all(codes.map(c => hashData(c)));
        const recoveryWraps = await Promise.all(
            codes.map(code => encryptData(vaultKeyB64, code))
        );

        const recoveryData = {
            codes: codeHashes.map((h, i) => ({
                hash: h.hash,
                salt: h.salt,
                wrappedKey: recoveryWraps[i],
                used: false,
                createdAt: Date.now()
            }))
        };
        await this._saveRecoveryData(recoveryData);
        return codes;
    }

    /** Get recovery code status (count used / remaining) */
    async getRecoveryStatus() {
        const data = await this._loadRecoveryData();
        if (!data) return { total: 0, used: 0, remaining: 0 };
        const used = data.codes.filter(c => c.used).length;
        return { total: data.codes.length, used, remaining: data.codes.length - used };
    }

    /** Encrypt data with vault key (AES-GCM direct) */
    async encryptWithVault(plaintext) {
        if (!this.vaultKey) throw new Error('Vault not unlocked');
        const iv        = crypto.getRandomValues(new Uint8Array(12));
        const encoded   = new TextEncoder().encode(plaintext);
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.vaultKey, encoded);
        const result    = new Uint8Array(iv.length + encrypted.byteLength);
        result.set(iv, 0);
        result.set(new Uint8Array(encrypted), iv.length);
        return bufferToBase64(result);
    }

    /** Decrypt data with vault key */
    async decryptWithVault(ciphertext) {
        if (!this.vaultKey) throw new Error('Vault not unlocked');
        try {
            const data       = base64ToBuffer(ciphertext);
            const iv         = data.slice(0, 12);
            const encrypted  = data.slice(12);
            const decrypted  = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: new Uint8Array(iv) },
                this.vaultKey,
                new Uint8Array(encrypted)
            );
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            return null;
        }
    }

    lock() {
        this.vaultKey    = null;
        this.vaultKeyRaw = null;
    }

    get isUnlocked() { return !!this.vaultKey; }

    async _loadRecoveryData() {
        return new Promise(resolve => {
            chrome.storage.local.get([RECOVERY_KEY], r => resolve(r[RECOVERY_KEY] || null));
        });
    }

    async _saveRecoveryData(data) {
        return new Promise(resolve => {
            chrome.storage.local.set({ [RECOVERY_KEY]: data }, resolve);
        });
    }
}

// ============================================
// STATE MANAGEMENT
// ============================================

class NotesState {
    constructor() {
        this.extensions          = [];
        this.notes               = {};
        this.selectedExtensionId = null;
        this.searchQuery         = '';
        this.notesSearchQuery    = '';
        this.globalSearchQuery   = '';
        this.activeFilters       = new Set(['all']);
        this.activeTagFilters    = new Set();
        this.editingNote         = null;
        this.theme               = 'auto';
        this.isAuthenticated     = false;
        this.editorTags          = [];
        this.dom                 = {};
        this._debouncers         = {};
        this.psf                 = new PSFKeyManager();
    }

    // ============================================
    // DOM CACHING
    // ============================================

    cacheDom() {
        const ids = [
            'app', 'extensionsList', 'emptySidebar', 'extensionSearch', 'clearExtSearch',
            'filterChips', 'mainContent', 'welcomeState', 'extensionNotesView',
            'selectedExtIcon', 'selectedExtName', 'extNoteCount', 'manageExtBtn',
            'newNoteBtn', 'notesSearch', 'clearNotesSearch', 'tagsFilter', 'notesContainer',
            'emptyNotes', 'createFirstNoteBtn', 'noteEditorModal', 'editorTitle',
            'noteTitle', 'noteContent', 'notePinned', 'noteSecure', 'securityPanel',
            'tagsInputContainer', 'editorTagsList', 'noteTags', 'existingTags',
            'tagSuggestions', 'saveNote', 'cancelNote', 'closeEditor', 'toastContainer',
            'confirmModal', 'confirmTitle', 'confirmMessage', 'confirmAction', 'confirmCancel',
            'lockScreen', 'lockScreenTitle', 'lockScreenText', 'lockScreenPasskeyBtn',
            'lockScreenRecoveryBtn', 'lockScreenRecoverySection', 'lockScreenRecoveryInput',
            'lockScreenRecoverySubmit',
            'shieldBtn', 'exportBtn', 'importBtn',
            'importFileInput', 'keyboardShortcutsBtn', 'shortcutsModal', 'closeShortcuts',
            'globalSearchModal', 'closeGlobalSearch', 'globalSearchInput', 'searchResults',
            'searchTitles', 'searchContent', 'searchTags', 'noteViewerModal', 'viewerTitle',
            'viewerMeta', 'viewerContent', 'viewerClose', 'viewerCloseBtn', 'viewerEditBtn',
            'clearFiltersBtn',
            // Settings modal
            'settingsModal', 'closeSettings',
            'settingsRecoveryStatus', 'settingsRegenCodes', 'settingsViewCodes',
            'settingsLockBtn', 'settingsResetBtn'
        ];
        ids.forEach(id => { this.dom[id] = document.getElementById(id); });
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    async init() {
        this.cacheDom();
        await this.loadTheme();
        await this.psf.loadMeta();
        this.setupEventListeners();

        if (!this.psf.isSetup) {
            this.showLockScreen('setup');
        } else {
            this.showLockScreen('unlock');
        }
    }

    async _bootstrap() {
        await this.loadExtensions();
        await this.loadNotes();
        this.applyTheme();
        this.render();
    }

    // ============================================
    // LOCK SCREEN (Passkey-based)
    // ============================================

    showLockScreen(mode) {
        const screen = this.dom.lockScreen;
        if (!screen) return;

        const title   = this.dom.lockScreenTitle;
        const text    = this.dom.lockScreenText;
        const pkBtn   = this.dom.lockScreenPasskeyBtn;
        const recBtn  = this.dom.lockScreenRecoveryBtn;
        const recSec  = this.dom.lockScreenRecoverySection;
        const recIn   = this.dom.lockScreenRecoveryInput;
        const recSub  = this.dom.lockScreenRecoverySubmit;

        if (recSec) recSec.style.display = 'none';
        if (recIn)  recIn.value = '';

        if (mode === 'setup') {
            if (title) title.textContent = 'Welcome to Extension Notes';
            if (text)  text.textContent  = 'Create a passkey to encrypt and protect your notes. Your device biometrics keep the vault key secure.';
            if (pkBtn) {
                pkBtn.textContent = '🔑 Create Passkey';
                pkBtn.onclick = () => this._handleSetupPasskey();
            }
            if (recBtn) recBtn.style.display = 'none';
        } else {
            if (title) title.textContent = 'Unlock Extension Notes';
            if (text)  text.textContent  = 'Authenticate with your passkey to continue.';
            if (pkBtn) {
                pkBtn.textContent = '🔑 Use Passkey';
                pkBtn.onclick = () => this._handleUnlockPasskey();
            }
            if (recBtn) {
                recBtn.style.display = 'block';
                recBtn.onclick = () => {
                    if (recSec) recSec.style.display = recSec.style.display === 'none' ? 'block' : 'none';
                    if (recIn)  recIn.focus();
                };
            }
        }

        if (recSub) {
            recSub.onclick = () => this._handleRecoveryCode();
        }
        if (recIn) {
            recIn.onkeydown = (e) => { if (e.key === 'Enter') this._handleRecoveryCode(); };
        }

        screen.classList.add('open');

        // Auto-trigger passkey prompt on unlock (after short delay for UX)
        if (mode === 'unlock') {
            setTimeout(() => this._handleUnlockPasskey(), 400);
        }
    }

    hideLockScreen() {
        if (this.dom.lockScreen) this.dom.lockScreen.classList.remove('open');
    }

    async _handleSetupPasskey() {
        const btn = this.dom.lockScreenPasskeyBtn;
        if (btn) { btn.disabled = true; btn.textContent = 'Creating passkey…'; }

        const result = await this.psf.setupPasskey();

        if (!result.success) {
            this.showToast('Passkey creation failed: ' + result.error, 'error');
            if (btn) { btn.disabled = false; btn.textContent = '🔑 Create Passkey'; }
            return;
        }

        this.isAuthenticated = true;
        this.hideLockScreen();
        await this._bootstrap();

        // Show recovery codes to user immediately
        this._showNewRecoveryCodes(result.recoveryCodes);
        this.showToast('Passkey created! Save your recovery codes.', 'success');
    }

    async _handleUnlockPasskey() {
        const btn = this.dom.lockScreenPasskeyBtn;
        if (btn) { btn.disabled = true; btn.textContent = 'Waiting for passkey…'; }

        const result = await this.psf.authenticatePasskey();

        if (!result.success) {
            if (btn) { btn.disabled = false; btn.textContent = '🔑 Use Passkey'; }
            // Don't show error for user cancellation
            if (!result.error?.includes('cancelled') && !result.error?.includes('abort')) {
                this.showToast('Passkey failed. Try a recovery code below.', 'error');
            }
            return;
        }

        this.isAuthenticated = true;
        this.hideLockScreen();
        await this._bootstrap();
        this.showToast('Welcome back', 'success');
    }

    async _handleRecoveryCode() {
        const input = this.dom.lockScreenRecoveryInput;
        const code  = input ? input.value.trim() : '';

        if (!code) {
            this.showToast('Enter a recovery code', 'error');
            return;
        }

        const result = await this.psf.recoverWithCode(code);

        if (!result.success) {
            this.showToast(result.error || 'Invalid recovery code', 'error');
            if (input) { input.value = ''; input.focus(); }
            return;
        }

        this.isAuthenticated = true;
        this.hideLockScreen();
        await this._bootstrap();

        if (result.remainingCodes <= 2) {
            this.showToast(
                `Unlocked! Only ${result.remainingCodes} recovery code(s) left — regenerate them in Settings.`,
                'warning',
                6000
            );
        } else {
            this.showToast(`Unlocked with recovery code. ${result.remainingCodes} codes remaining.`, 'success');
        }
    }

    _showNewRecoveryCodes(codes) {
        const overlay = h('div', { className: 'modal-overlay open', attrs: { role: 'dialog', 'aria-modal': 'true' } });
        const modal   = h('div', { className: 'modal-content recovery-codes-modal' });

        modal.appendChild(h('div', { className: 'modal-header' },
            h('h2', { text: '🔐 Recovery Codes' })
        ));

        const body = h('div', { className: 'modal-body' });
        body.appendChild(h('p', { className: 'recovery-warning', text: '⚠️ Save these codes somewhere safe. Each code can only be used once. You\'ll need them if your passkey is lost.' }));

        const grid = h('div', { className: 'recovery-codes-grid' });
        codes.forEach(code => {
            grid.appendChild(h('code', { className: 'recovery-code-item', text: code }));
        });
        body.appendChild(grid);

        const copyBtn = h('button', {
            className: 'modcore-btn modcore-btn-secondary',
            text: '📋 Copy All Codes',
            on: { click: () => {
                navigator.clipboard.writeText(codes.join('\n'));
                copyBtn.textContent = '✓ Copied!';
                setTimeout(() => { copyBtn.textContent = '📋 Copy All Codes'; }, 2000);
            }}
        });
        body.appendChild(copyBtn);
        modal.appendChild(body);

        const footer = h('div', { className: 'modal-footer' });
        footer.appendChild(h('button', {
            className: 'modcore-btn modcore-btn-primary',
            text: 'I\'ve saved these codes',
            on: { click: () => overlay.remove() }
        }));
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    }

    // ============================================
    // SETTINGS MODAL (Shield button)
    // ============================================

    async openSettings() {
        const modal = this.dom.settingsModal;
        if (!modal) return;

        // Refresh recovery status display
        await this._refreshSettingsRecoveryStatus();

        modal.classList.add('open');
    }

    async _refreshSettingsRecoveryStatus() {
        const el = this.dom.settingsRecoveryStatus;
        if (!el) return;

        const status = await this.psf.getRecoveryStatus();
        el.textContent = '';

        const statusClass = status.remaining <= 2 ? 'status-warn' : 'status-ok';
        el.appendChild(h('span', {
            className: `recovery-status-badge ${statusClass}`,
            text: `${status.remaining} of ${status.total} codes remaining`
        }));

        if (status.remaining === 0) {
            el.appendChild(h('p', { className: 'status-alert', text: '⚠️ All recovery codes used! Regenerate now.' }));
        } else if (status.remaining <= 2) {
            el.appendChild(h('p', { className: 'status-alert', text: '⚠️ Low on recovery codes. Consider regenerating.' }));
        }
    }

    // ============================================
    // STORAGE OPERATIONS
    // ============================================

    async loadNotes() {
        return new Promise(resolve => {
            chrome.storage.local.get([STORAGE_KEY], async result => {
                const stored = result[STORAGE_KEY];
                if (stored && stored.encrypted && this.psf.isUnlocked) {
                    const decrypted = await this.psf.decryptWithVault(stored.data);
                    if (decrypted) {
                        try { this.notes = JSON.parse(decrypted); }
                        catch (e) { this.notes = {}; }
                    } else {
                        this.notes = {};
                    }
                } else {
                    this.notes = {};
                }
                resolve();
            });
        });
    }

    async saveNotes() {
        if (!this.psf.isUnlocked) return;
        const encrypted = await this.psf.encryptWithVault(JSON.stringify(this.notes));
        return new Promise(resolve => {
            chrome.storage.local.set({
                [STORAGE_KEY]: { encrypted: true, psfVersion: PSF_VERSION, data: encrypted }
            }, () => {
                this.showToast('Changes saved securely', 'success');
                resolve();
            });
        });
    }

    async loadTheme() {
        const result = await chrome.storage.local.get([THEME_KEY]);
        this.theme = result[THEME_KEY] || 'auto';
    }

    async saveTheme() {
        await chrome.storage.local.set({ [THEME_KEY]: this.theme });
    }

    // ============================================
    // EXTENSION OPERATIONS
    // ============================================

    async loadExtensions() {
        return new Promise(resolve => {
            chrome.management.getAll(exts => {
                this.extensions = exts
                    .filter(ext => !ext.isApp && ext.id !== chrome.runtime.id)
                    .sort((a, b) => a.name.localeCompare(b.name));
                resolve();
            });
        });
    }

    getFilteredExtensions() {
        let filtered = this.extensions;
        if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            filtered = filtered.filter(ext =>
                ext.name.toLowerCase().includes(q) ||
                (ext.description && ext.description.toLowerCase().includes(q))
            );
        }
        if (this.activeFilters.has('has-notes')) {
            filtered = filtered.filter(ext => (this.notes[ext.id] || []).length > 0);
        }
        if (this.activeFilters.has('pinned')) {
            filtered = filtered.filter(ext => (this.notes[ext.id] || []).some(n => n.isPinned));
        }
        return filtered;
    }

    getSelectedExtension() {
        return this.extensions.find(ext => ext.id === this.selectedExtensionId);
    }

    // ============================================
    // NOTE OPERATIONS
    // ============================================

    getExtensionNotes(extId) { return this.notes[extId] || []; }

    getFilteredNotes(extId) {
        let notes = this.getExtensionNotes(extId);
        if (this.notesSearchQuery) {
            const q = this.notesSearchQuery.toLowerCase();
            notes = notes.filter(note => {
                const titleMatch   = note.title && note.title.toLowerCase().includes(q);
                const contentMatch = !note.isSecure && note.content && note.content.toLowerCase().includes(q);
                const tagMatch     = note.tags && note.tags.some(tag => tag.toLowerCase().includes(q));
                return titleMatch || contentMatch || tagMatch;
            });
        }
        if (this.activeTagFilters.size > 0) {
            notes = notes.filter(note =>
                note.tags && note.tags.some(tag => this.activeTagFilters.has(tag))
            );
        }
        return notes.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
    }

    async createNote(extId, noteData) {
        const notes         = this.getExtensionNotes(extId);
        let displayContent  = noteData.content;
        let secureContent   = null;

        if (noteData.isSecure && this.psf.isUnlocked) {
            secureContent  = await this.psf.encryptWithVault(noteData.content);
            displayContent = '[SECURED]';
        }

        const newNote = {
            id:           Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
            title:        noteData.title,
            content:      displayContent,
            tags:         noteData.tags || [],
            isPinned:     noteData.isPinned || false,
            isSecure:     noteData.isSecure || false,
            secureContent,
            createdAt:    Date.now(),
            updatedAt:    Date.now()
        };

        notes.push(newNote);
        this.notes[extId] = notes;
        await this.saveNotes();
        return newNote;
    }

    async updateNote(extId, noteId, updates) {
        const notes     = this.getExtensionNotes(extId);
        const noteIndex = notes.findIndex(n => n.id === noteId);
        if (noteIndex === -1) return null;

        const note              = notes[noteIndex];
        const isSecureChanging  = updates.isSecure !== undefined && updates.isSecure !== note.isSecure;

        if (isSecureChanging) {
            if (updates.isSecure && !note.isSecure) {
                if (this.psf.isUnlocked && updates.content) {
                    updates.secureContent = await this.psf.encryptWithVault(updates.content);
                    updates.content       = '[SECURED]';
                }
            } else if (!updates.isSecure && note.isSecure) {
                if (note.secureContent && this.psf.isUnlocked) {
                    const decrypted = await this.psf.decryptWithVault(note.secureContent);
                    if (decrypted) {
                        updates.content       = decrypted;
                        updates.secureContent = null;
                    } else {
                        this.showToast('Failed to decrypt note', 'error');
                        return null;
                    }
                }
            }
        } else if (note.isSecure && updates.content !== undefined && this.psf.isUnlocked) {
            updates.secureContent = await this.psf.encryptWithVault(updates.content);
            updates.content       = '[SECURED]';
        }

        notes[noteIndex] = { ...note, ...updates, updatedAt: Date.now() };
        this.notes[extId] = notes;
        await this.saveNotes();
        return notes[noteIndex];
    }

    async deleteNote(extId, noteId) {
        const notes    = this.getExtensionNotes(extId);
        const filtered = notes.filter(n => n.id !== noteId);
        if (filtered.length === notes.length) return false;
        if (filtered.length === 0) { delete this.notes[extId]; }
        else { this.notes[extId] = filtered; }
        await this.saveNotes();
        return true;
    }

    async togglePin(extId, noteId) {
        const notes = this.getExtensionNotes(extId);
        const note  = notes.find(n => n.id === noteId);
        if (note) {
            note.isPinned = !note.isPinned;
            note.updatedAt = Date.now();
            await this.saveNotes();
            return note.isPinned;
        }
        return null;
    }

    async decryptNoteContent(note) {
        if (!note.isSecure || !note.secureContent || !this.psf.isUnlocked) return note.content;
        return this.psf.decryptWithVault(note.secureContent);
    }

    // ============================================
    // EXPORT / IMPORT
    // ============================================

    async exportNotes() {
        if (!this.psf.isUnlocked) {
            this.showToast('Vault must be unlocked to export', 'error');
            return;
        }

        const exportData = {
            version:    PSF_VERSION,
            exportedAt: new Date().toISOString(),
            encrypted:  true,
            notes:      null,
            stats: {
                totalExtensions: Object.keys(this.notes).length,
                totalNotes:      Object.values(this.notes).reduce((s, a) => s + (a ? a.length : 0), 0)
            }
        };

        exportData.notes = await this.psf.encryptWithVault(JSON.stringify(this.notes));

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `modcore-notes-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showToast('Notes exported securely', 'success');
    }

    async importNotes(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data.notes) throw new Error('Invalid backup format');

                    let importedNotes;

                    if (data.encrypted) {
                        if (!this.psf.isUnlocked) {
                            this.showToast('Vault must be unlocked to import encrypted backup', 'error');
                            resolve(false);
                            return;
                        }
                        const decrypted = await this.psf.decryptWithVault(data.notes);
                        if (!decrypted) {
                            this.showToast('Could not decrypt backup — was it exported from this vault?', 'error');
                            resolve(false);
                            return;
                        }
                        importedNotes = JSON.parse(decrypted);
                    } else {
                        importedNotes = data.notes;
                    }

                    const existingCount = Object.values(this.notes).reduce((s, a) => s + (a ? a.length : 0), 0);
                    const importCount   = Object.values(importedNotes).reduce((s, a) => s + (a ? a.length : 0), 0);

                    if (existingCount > 0) {
                        const shouldMerge = await this.showConfirm(
                            'Import Options',
                            `You have ${existingCount} existing notes. Import ${importCount} notes and merge?`
                        );
                        if (!shouldMerge) { resolve(false); return; }

                        Object.entries(importedNotes).forEach(([extId, notes]) => {
                            if (!this.notes[extId]) this.notes[extId] = [];
                            const existingIds = new Set(this.notes[extId].map(n => n.id));
                            notes.forEach(note => { if (!existingIds.has(note.id)) this.notes[extId].push(note); });
                        });
                    } else {
                        this.notes = importedNotes;
                    }

                    await this.saveNotes();
                    this.showToast(`Imported ${importCount} notes successfully`, 'success');
                    resolve(true);
                } catch (err) {
                    this.showToast('Failed to import: ' + err.message, 'error');
                    reject(err);
                }
            };
            reader.readAsText(file);
        });
    }

    // ============================================
    // GLOBAL SEARCH
    // ============================================

    searchAllNotes(query, options = { titles: true, content: true, tags: false }) {
        const results   = [];
        const lowerQ    = query.toLowerCase();

        Object.entries(this.notes).forEach(([extId, notes]) => {
            const ext = this.extensions.find(e => e.id === extId);
            if (!ext || !Array.isArray(notes)) return;

            notes.forEach(note => {
                let match = false;
                const matchType = [];
                let preview = '';

                if (options.titles && note.title && note.title.toLowerCase().includes(lowerQ)) {
                    match = true;
                    matchType.push('title');
                    preview = note.title;
                }
                if (options.content && note.content && !note.isSecure && note.content.toLowerCase().includes(lowerQ)) {
                    match = true;
                    matchType.push('content');
                    if (!preview) {
                        const idx   = note.content.toLowerCase().indexOf(lowerQ);
                        const start = Math.max(0, idx - 50);
                        const end   = Math.min(note.content.length, idx + query.length + 50);
                        preview = '...' + note.content.slice(start, end) + '...';
                    }
                }
                if (options.tags && note.tags && note.tags.some(t => t.toLowerCase().includes(lowerQ))) {
                    match = true;
                    matchType.push('tag');
                }

                if (match) {
                    results.push({
                        note, extension: ext, matchType,
                        preview: preview || (note.content ? note.content.slice(0, 100) + '...' : '')
                    });
                }
            });
        });

        return results.sort((a, b) => {
            if (a.matchType.includes('title') && !b.matchType.includes('title')) return -1;
            if (!a.matchType.includes('title') && b.matchType.includes('title')) return 1;
            return (b.note.updatedAt || 0) - (a.note.updatedAt || 0);
        });
    }

    // ============================================
    // TAG OPERATIONS
    // ============================================

    getAllTags() {
        const tags = new Set();
        Object.values(this.notes).forEach(notes => {
            if (Array.isArray(notes)) {
                notes.forEach(note => { if (note.tags) note.tags.forEach(tag => tags.add(tag)); });
            }
        });
        return Array.from(tags).sort();
    }

    getRecommendedTags(currentTags = []) {
        const cs = new Set(currentTags);
        return this.getAllTags().filter(t => !cs.has(t)).slice(0, 5);
    }

    // ============================================
    // UI HELPERS
    // ============================================

    applyTheme() {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const isDark      = this.theme === 'dark' || (this.theme === 'auto' && prefersDark);
        document.body.classList.toggle('dark-mode', isDark);
    }

    showToast(message, type = 'info', duration = 3000) {
        const container = this.dom.toastContainer;
        if (!container) return;
        const iconKey = type === 'success' ? 'check' : type === 'error' ? 'warning' : 'info';
        const toast = h('div', { className: `toast ${type}` },
            h('img', { className: 'toast-icon', attrs: { src: ICONS[iconKey], alt: '' } }),
            h('span', { text: message })
        );
        container.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, duration);
    }

    showConfirm(title, message) {
        return new Promise(resolve => {
            const modal     = this.dom.confirmModal;
            if (!modal)     { resolve(false); return; }
            const titleEl   = this.dom.confirmTitle;
            const messageEl = this.dom.confirmMessage;
            const confirmBtn = this.dom.confirmAction;
            const cancelBtn  = this.dom.confirmCancel;

            if (titleEl)   titleEl.textContent   = title;
            if (messageEl) messageEl.textContent = message;

            const cleanup = () => {
                modal.classList.remove('open');
                confirmBtn.onclick = null;
                cancelBtn.onclick  = null;
            };
            confirmBtn.onclick = () => { cleanup(); resolve(true);  };
            cancelBtn.onclick  = () => { cleanup(); resolve(false); };
            modal.classList.add('open');
        });
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    setupEventListeners() {
        const debounce = (key, fn, ms = 150) => {
            clearTimeout(this._debouncers[key]);
            this._debouncers[key] = setTimeout(fn, ms);
        };

        // Extension search
        if (this.dom.extensionSearch) {
            this.dom.extensionSearch.addEventListener('input', e => {
                this.searchQuery = e.target.value;
                debounce('extSearch', () => this.renderSidebar());
            });
        }
        if (this.dom.clearExtSearch) {
            this.dom.clearExtSearch.addEventListener('click', () => {
                if (this.dom.extensionSearch) {
                    this.dom.extensionSearch.value = '';
                    this.searchQuery = '';
                    this.renderSidebar();
                    this.dom.extensionSearch.focus();
                }
            });
        }

        // Filter chips
        if (this.dom.filterChips) {
            this.dom.filterChips.addEventListener('click', e => {
                const chip = e.target.closest('.chip[data-filter]');
                if (!chip) return;
                const filter = chip.dataset.filter;
                if (filter === 'all') {
                    this.activeFilters.clear();
                    this.activeFilters.add('all');
                } else {
                    this.activeFilters.delete('all');
                    if (this.activeFilters.has(filter)) {
                        this.activeFilters.delete(filter);
                        if (this.activeFilters.size === 0) this.activeFilters.add('all');
                    } else {
                        this.activeFilters.add(filter);
                    }
                }
                this.updateFilterChips();
                this.renderSidebar();
            });
        }

        // Clear filters
        if (this.dom.clearFiltersBtn) {
            this.dom.clearFiltersBtn.addEventListener('click', () => {
                this.activeFilters.clear();
                this.activeFilters.add('all');
                this.searchQuery = '';
                if (this.dom.extensionSearch) this.dom.extensionSearch.value = '';
                this.updateFilterChips();
                this.renderSidebar();
            });
        }

        // Notes search
        if (this.dom.notesSearch) {
            this.dom.notesSearch.addEventListener('input', e => {
                this.notesSearchQuery = e.target.value;
                debounce('notesSearch', () => this.renderNotes());
            });
        }
        if (this.dom.clearNotesSearch) {
            this.dom.clearNotesSearch.addEventListener('click', () => {
                if (this.dom.notesSearch) {
                    this.dom.notesSearch.value = '';
                    this.notesSearchQuery = '';
                    this.renderNotes();
                    this.dom.notesSearch.focus();
                }
            });
        }

        // New note
        if (this.dom.newNoteBtn)       this.dom.newNoteBtn.addEventListener('click', () => this.openNoteEditor());
        if (this.dom.createFirstNoteBtn) this.dom.createFirstNoteBtn.addEventListener('click', () => this.openNoteEditor());

        // Manage extension
        if (this.dom.manageExtBtn) {
            this.dom.manageExtBtn.addEventListener('click', () => {
                const ext = this.getSelectedExtension();
                if (ext) chrome.tabs.create({ url: `chrome://extensions/?id=${ext.id}` });
            });
        }

        // Export / Import
        if (this.dom.exportBtn) this.dom.exportBtn.addEventListener('click', () => this.exportNotes());
        if (this.dom.importBtn && this.dom.importFileInput) {
            this.dom.importBtn.addEventListener('click', () => this.dom.importFileInput.click());
            this.dom.importFileInput.addEventListener('change', async e => {
                const file = e.target.files[0];
                if (file) {
                    await this.importNotes(file);
                    this.render();
                    e.target.value = '';
                }
            });
        }

        // Shield / Settings button — now opens Settings modal
        if (this.dom.shieldBtn) {
            this.dom.shieldBtn.addEventListener('click', () => this.openSettings());
        }

        // Settings modal controls
        if (this.dom.closeSettings) {
            this.dom.closeSettings.addEventListener('click', () => {
                if (this.dom.settingsModal) this.dom.settingsModal.classList.remove('open');
            });
        }
        if (this.dom.settingsLockBtn) {
            this.dom.settingsLockBtn.addEventListener('click', () => {
                if (this.dom.settingsModal) this.dom.settingsModal.classList.remove('open');
                this.lockApp();
            });
        }
        if (this.dom.settingsRegenCodes) {
            this.dom.settingsRegenCodes.addEventListener('click', async () => {
                const confirmed = await this.showConfirm(
                    'Regenerate Recovery Codes',
                    'This will invalidate all existing recovery codes and generate new ones. Continue?'
                );
                if (!confirmed) return;
                const codes = await this.psf.regenerateRecoveryCodes();
                if (codes) {
                    await this._refreshSettingsRecoveryStatus();
                    this._showNewRecoveryCodes(codes);
                } else {
                    this.showToast('Failed to regenerate codes — vault must be unlocked', 'error');
                }
            });
        }
        if (this.dom.settingsViewCodes) {
            this.dom.settingsViewCodes.addEventListener('click', async () => {
                const status = await this.psf.getRecoveryStatus();
                this.showToast(
                    `${status.remaining} recovery codes remaining (${status.used} used). Regenerate to get new ones.`,
                    'info', 5000
                );
            });
        }
        if (this.dom.settingsResetBtn) {
            this.dom.settingsResetBtn.addEventListener('click', async () => {
                const confirmed = await this.showConfirm(
                    'Reset Everything',
                    '⚠️ This will permanently delete all notes, passkey data, and recovery codes. This CANNOT be undone. Are you absolutely sure?'
                );
                if (!confirmed) return;
                const confirmed2 = await this.showConfirm(
                    'Final Confirmation',
                    'All data will be destroyed. Type-click Confirm to proceed.'
                );
                if (!confirmed2) return;
                await chrome.storage.local.remove([STORAGE_KEY, PSF_META_KEY, RECOVERY_KEY]);
                window.location.reload();
            });
        }

        // Keyboard shortcuts
        if (this.dom.keyboardShortcutsBtn && this.dom.shortcutsModal) {
            this.dom.keyboardShortcutsBtn.addEventListener('click', () => {
                this.dom.shortcutsModal.classList.add('open');
            });
        }
        if (this.dom.closeShortcuts && this.dom.shortcutsModal) {
            this.dom.closeShortcuts.addEventListener('click', () => {
                this.dom.shortcutsModal.classList.remove('open');
            });
        }

        // Global search
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                this.openGlobalSearch();
            }
        });
        if (this.dom.closeGlobalSearch && this.dom.globalSearchModal) {
            this.dom.closeGlobalSearch.addEventListener('click', () => {
                this.dom.globalSearchModal.classList.remove('open');
            });
        }

        // Modal backdrop close
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', e => {
                if (e.target === modal) modal.classList.remove('open');
            });
        });

        // Note container event delegation
        if (this.dom.notesContainer) {
            this.dom.notesContainer.addEventListener('click', e => {
                const card = e.target.closest('.note-card');
                if (!card) return;
                const noteId = card.dataset.noteId;
                if      (e.target.closest('.pin-btn'))    { e.stopPropagation(); this.handlePinClick(noteId); }
                else if (e.target.closest('.edit-btn'))   { e.stopPropagation(); this.handleEditClick(noteId); }
                else if (e.target.closest('.delete-btn')) { e.stopPropagation(); this.handleDeleteClick(noteId); }
                else                                       { this.handleNoteCardClick(noteId); }
            });
        }

        this.setupKeyboardShortcuts();

        // Theme toggle via media query
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (this.theme === 'auto') this.applyTheme();
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', e => {
            if (e.target.matches('input, textarea')) return;
            switch (e.key) {
                case '?':
                    e.preventDefault();
                    if (this.dom.shortcutsModal) this.dom.shortcutsModal.classList.add('open');
                    break;
                case 'Escape':
                    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
                    break;
                case 'k':
                case 'K':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        if (this.dom.extensionSearch) this.dom.extensionSearch.focus();
                    }
                    break;
                case 'n':
                case 'N':
                    if (e.ctrlKey && this.selectedExtensionId) {
                        e.preventDefault();
                        this.openNoteEditor();
                    }
                    break;
            }
        });
    }

    lockApp() {
        this.psf.lock();
        this.isAuthenticated     = false;
        this.notes               = {};
        this.extensions          = [];
        this.selectedExtensionId = null;
        this.searchQuery         = '';
        this.notesSearchQuery    = '';
        this.showLockScreen('unlock');
    }

    updateFilterChips() {
        document.querySelectorAll('.chip[data-filter]').forEach(chip => {
            chip.setAttribute('aria-pressed', this.activeFilters.has(chip.dataset.filter));
        });
    }

    // ============================================
    // RENDERING
    // ============================================

    render() {
        this.renderSidebar();
        this.renderMainContent();
    }

    _createExtensionItem(ext) {
        const extNotes  = this.getExtensionNotes(ext.id);
        const hasNotes  = extNotes.length > 0;
        const hasPinned = extNotes.some(n => n.isPinned);

        return h('div', {
            className: `ext-item ${ext.id === this.selectedExtensionId ? 'active' : ''} ${hasNotes ? 'has-notes' : ''} ${hasPinned ? 'has-pinned' : ''}`,
            attrs: {
                'data-ext-id': ext.id,
                role:          'listitem',
                tabindex:      '0',
                'aria-selected': String(ext.id === this.selectedExtensionId)
            },
            on: {
                click:   () => this.selectExtension(ext.id),
                keydown: e => { if (e.key === 'Enter') this.selectExtension(ext.id); }
            }
        },
            h('img', { className: 'ext-icon-small', attrs: { src: ext.icons?.[0]?.url || ICONS.default, alt: '' } }),
            h('div', { className: 'ext-item-info' },
                h('div', { className: 'ext-item-name',  text: ext.name }),
                h('div', { className: 'ext-item-meta',  text: hasNotes ? `${extNotes.length} note${extNotes.length !== 1 ? 's' : ''}` : 'No notes' })
            )
        );
    }

    _updateExtensionItem(el, ext) {
        const extNotes  = this.getExtensionNotes(ext.id);
        const hasNotes  = extNotes.length > 0;
        const hasPinned = extNotes.some(n => n.isPinned);
        const isActive  = ext.id === this.selectedExtensionId;

        el.className = `ext-item ${isActive ? 'active' : ''} ${hasNotes ? 'has-notes' : ''} ${hasPinned ? 'has-pinned' : ''}`;
        el.setAttribute('aria-selected', String(isActive));

        const nameEl = el.querySelector('.ext-item-name');
        const metaEl = el.querySelector('.ext-item-meta');
        const iconEl = el.querySelector('.ext-icon-small');

        if (nameEl) nameEl.textContent = ext.name;
        if (metaEl) metaEl.textContent = hasNotes ? `${extNotes.length} note${extNotes.length !== 1 ? 's' : ''}` : 'No notes';
        if (iconEl) iconEl.src = ext.icons?.[0]?.url || ICONS.default;
    }

    renderSidebar() {
        const list     = this.dom.extensionsList;
        const empty    = this.dom.emptySidebar;
        const filtered = this.getFilteredExtensions();
        if (!list || !empty) return;

        if (filtered.length === 0) {
            list.style.display = 'none';
            empty.classList.add('open');
            return;
        }

        list.style.display = 'block';
        empty.classList.remove('open');

        const currentMap = new Map();
        list.querySelectorAll('.ext-item').forEach(el => currentMap.set(el.dataset.extId, el));

        const newIds = new Set(filtered.map(e => e.id));
        currentMap.forEach((el, id) => { if (!newIds.has(id)) el.remove(); });

        filtered.forEach((ext, index) => {
            let item = currentMap.get(ext.id);
            if (!item) {
                item = this._createExtensionItem(ext);
                if (index < list.children.length) list.insertBefore(item, list.children[index]);
                else list.appendChild(item);
            } else {
                this._updateExtensionItem(item, ext);
                if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null);
            }
        });
    }

    renderMainContent() {
        const welcome = this.dom.welcomeState;
        const view    = this.dom.extensionNotesView;
        if (!welcome || !view) return;

        if (!this.selectedExtensionId) {
            welcome.classList.add('open');
            view.classList.remove('open');
            return;
        }

        welcome.classList.remove('open');
        view.classList.add('open');

        const ext = this.getSelectedExtension();
        if (!ext) return;

        if (this.dom.selectedExtIcon) { this.dom.selectedExtIcon.src = ext.icons?.[0]?.url || ICONS.default; this.dom.selectedExtIcon.alt = ext.name; }
        if (this.dom.selectedExtName)  this.dom.selectedExtName.textContent = ext.name;

        const notes = this.getExtensionNotes(ext.id);
        if (this.dom.extNoteCount) this.dom.extNoteCount.textContent = `${notes.length} note${notes.length !== 1 ? 's' : ''}`;

        this.renderTagsFilter();
        this.renderNotes();
    }

    renderTagsFilter() {
        const container = this.dom.tagsFilter;
        if (!container) return;
        const allTags = new Set();
        const notes   = this.getExtensionNotes(this.selectedExtensionId);
        if (Array.isArray(notes)) notes.forEach(n => { if (n.tags) n.tags.forEach(t => allTags.add(t)); });

        container.textContent = '';
        const fragment = document.createDocumentFragment();
        Array.from(allTags).sort().forEach(tag => {
            const isActive = this.activeTagFilters.has(tag);
            const btn = h('button', {
                className: `tag-filter ${isActive ? 'active' : ''}`,
                on: { click: () => {
                    if (this.activeTagFilters.has(tag)) this.activeTagFilters.delete(tag);
                    else this.activeTagFilters.add(tag);
                    this.renderTagsFilter();
                    this.renderNotes();
                }}
            });
            btn.appendChild(document.createTextNode(tag));
            if (isActive) btn.appendChild(h('span', { className: 'remove-tag', text: '×' }));
            fragment.appendChild(btn);
        });
        container.appendChild(fragment);
    }

    renderNotes() {
        const container = this.dom.notesContainer;
        const empty     = this.dom.emptyNotes;
        const notes     = this.getFilteredNotes(this.selectedExtensionId);
        if (!container || !empty) return;

        if (notes.length === 0) {
            container.style.display = 'none';
            empty.classList.add('open');
            const emptyTitle = empty.querySelector('h3');
            const emptyText  = empty.querySelector('p');
            if (this.notesSearchQuery || this.activeTagFilters.size > 0) {
                if (emptyTitle) emptyTitle.textContent = 'No matching notes';
                if (emptyText)  emptyText.textContent  = 'Try adjusting your search or filters.';
            } else {
                if (emptyTitle) emptyTitle.textContent = 'No notes yet';
                if (emptyText)  emptyText.textContent  = 'Create your first note to remember important details about this extension.';
            }
            return;
        }

        container.style.display = 'flex';
        empty.classList.remove('open');
        container.textContent = '';

        const fragment = document.createDocumentFragment();
        notes.forEach(note => {
            const card = h('div', {
                className: `note-card ${note.isPinned ? 'pinned' : ''} ${note.isSecure ? 'secure' : ''}`,
                attrs: { 'data-note-id': note.id }
            });

            const header   = h('div', { className: 'note-header' });
            const titleRow = h('div', { className: 'note-title-row' });
            titleRow.appendChild(h('h3', { className: 'note-title', text: note.title }));

            const badges = h('div', { className: 'note-badges' });
            if (note.isPinned) badges.appendChild(h('span', { className: 'badge pinned', attrs: { title: 'Pinned' }, text: '📌' }));
            if (note.isSecure) badges.appendChild(h('span', { className: 'badge secure', attrs: { title: 'Secure' }, text: '🔒' }));
            if (badges.children.length > 0) titleRow.appendChild(badges);
            header.appendChild(titleRow);

            const actions = h('div', { className: 'note-actions' });
            actions.appendChild(h('button', { className: 'note-action-btn pin-btn',    attrs: { title: note.isPinned ? 'Unpin' : 'Pin' }    }, h('img', { attrs: { src: note.isPinned ? ICONS.unpin : ICONS.pin, alt: '' } })));
            actions.appendChild(h('button', { className: 'note-action-btn edit-btn',   attrs: { title: 'Edit' }   }, h('img', { attrs: { src: ICONS.edit,  alt: '' } })));
            actions.appendChild(h('button', { className: 'note-action-btn delete-btn', attrs: { title: 'Delete' } }, h('img', { attrs: { src: ICONS.trash, alt: '' } })));
            header.appendChild(actions);
            card.appendChild(header);

            const date = note.updatedAt ? new Date(note.updatedAt).toLocaleDateString() : 'Unknown date';
            const tags = note.tags && note.tags.length ? note.tags.map(t => `#${t}`).join(' ') : 'No tags';
            card.appendChild(h('div', { className: 'note-meta', text: `${date} · ${tags}` }));

            const previewText = note.isSecure ? '🔒 This note is secured. Click to view.' : note.content;
            card.appendChild(h('div', { className: 'note-preview', text: previewText }));

            if (note.tags && note.tags.length) {
                const tagsContainer = h('div', { className: 'note-tags' });
                note.tags.forEach(tag => tagsContainer.appendChild(h('span', { className: 'note-tag', text: tag })));
                card.appendChild(tagsContainer);
            }

            fragment.appendChild(card);
        });

        container.appendChild(fragment);
    }

    // ============================================
    // NOTE INTERACTIONS
    // ============================================

    selectExtension(id) {
        this.selectedExtensionId = id;
        this.notesSearchQuery    = '';
        this.activeTagFilters.clear();
        if (this.dom.notesSearch) this.dom.notesSearch.value = '';
        this.render();
    }

    async handlePinClick(noteId) {
        await this.togglePin(this.selectedExtensionId, noteId);
        this.renderNotes();
    }

    async handleEditClick(noteId) {
        const notes = this.getExtensionNotes(this.selectedExtensionId);
        const note  = notes.find(n => n.id === noteId);
        if (!note) return;

        if (note.isSecure) {
            const decrypted = await this.decryptNoteContent(note);
            if (decrypted) this.openNoteEditor({ ...note, content: decrypted });
            else           this.showToast('Failed to decrypt note', 'error');
        } else {
            this.openNoteEditor(note);
        }
    }

    async handleDeleteClick(noteId) {
        const confirmed = await this.showConfirm('Delete Note', 'Are you sure you want to delete this note?');
        if (confirmed) {
            const card = this.dom.notesContainer ? this.dom.notesContainer.querySelector(`[data-note-id="${noteId}"]`) : null;
            if (card) card.classList.add('deleting');
            setTimeout(async () => {
                await this.deleteNote(this.selectedExtensionId, noteId);
                this.render();
            }, 300);
        }
    }

    async handleNoteCardClick(noteId) {
        const notes = this.getExtensionNotes(this.selectedExtensionId);
        const note  = notes.find(n => n.id === noteId);
        if (note) this.showNoteViewer(note);
    }

    // ============================================
    // NOTE EDITOR
    // ============================================

    openNoteEditor(note = null) {
        this.editingNote = note;
        const modal = this.dom.noteEditorModal;
        if (!modal) return;

        this.dom.editorTitle.textContent = note ? 'Edit Note' : 'New Note';
        this.dom.noteTitle.value         = note?.title   || '';
        this.dom.noteContent.value       = note?.content || '';
        this.dom.notePinned.checked      = note?.isPinned || false;
        this.dom.noteSecure.checked      = note?.isSecure || false;

        if (this.dom.securityPanel) {
            this.dom.securityPanel.classList.toggle('open', !!note?.isSecure);
        }

        this.editorTags = note?.tags ? [...note.tags] : [];
        this.renderEditorTags();
        this.renderTagSuggestions();

        modal.classList.add('open');
        this.dom.noteTitle.focus();

        this.setupTagInput();

        if (this.dom.noteSecure) {
            // Use a new function reference to avoid stale closures
            this.dom.noteSecure.onchange = () => {
                if (this.dom.securityPanel) {
                    this.dom.securityPanel.classList.toggle('open', this.dom.noteSecure.checked);
                }
            };
        }

        this.dom.saveNote.onclick = async () => {
            if (!this.dom.noteTitle.value.trim()) {
                this.showToast('Title is required', 'error');
                this.dom.noteTitle.focus();
                return;
            }
            const noteData = {
                title:    this.dom.noteTitle.value.trim(),
                content:  this.dom.noteContent ? this.dom.noteContent.value : '',
                tags:     this.editorTags,
                isPinned: this.dom.notePinned  ? this.dom.notePinned.checked  : false,
                isSecure: this.dom.noteSecure  ? this.dom.noteSecure.checked  : false
            };
            if (note) await this.updateNote(this.selectedExtensionId, note.id, noteData);
            else      await this.createNote(this.selectedExtensionId, noteData);

            modal.classList.remove('open');
            this.render();
        };

        this.dom.cancelNote.onclick = () => modal.classList.remove('open');
        this.dom.closeEditor.onclick = () => modal.classList.remove('open');
    }

    setupTagInput() {
        const input    = this.dom.noteTags;
        const datalist = this.dom.existingTags;
        if (!input || !datalist) return;

        const allTags = this.getAllTags();
        datalist.textContent = '';
        allTags.forEach(tag => datalist.appendChild(h('option', { attrs: { value: tag } })));

        input.onkeydown = e => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                const tag = input.value.trim().replace(/,/g, '');
                if (tag && !this.editorTags.includes(tag)) {
                    this.editorTags.push(tag);
                    this.renderEditorTags();
                    this.renderTagSuggestions();
                    input.value = '';
                }
            } else if (e.key === 'Backspace' && !input.value && this.editorTags.length) {
                this.editorTags.pop();
                this.renderEditorTags();
                this.renderTagSuggestions();
            }
        };

        input.onblur = () => {
            const tag = input.value.trim();
            if (tag && !this.editorTags.includes(tag)) {
                this.editorTags.push(tag);
                this.renderEditorTags();
                this.renderTagSuggestions();
                input.value = '';
            }
        };
    }

    renderEditorTags() {
        const container = this.dom.editorTagsList;
        if (!container) return;
        container.textContent = '';
        this.editorTags.forEach((tag, i) => {
            const tagSpan = h('span', { className: 'tag-item', text: tag });
            tagSpan.appendChild(h('button', {
                className: 'tag-remove',
                text: '×',
                on: { click: () => {
                    this.editorTags.splice(i, 1);
                    this.renderEditorTags();
                    this.renderTagSuggestions();
                }}
            }));
            container.appendChild(tagSpan);
        });
    }

    renderTagSuggestions() {
        const container = this.dom.tagSuggestions;
        if (!container) return;
        container.textContent = '';
        this.getRecommendedTags(this.editorTags).forEach(tag => {
            container.appendChild(h('button', {
                className: 'tag-suggestion',
                text: `+ ${tag}`,
                on: { click: () => {
                    this.editorTags.push(tag);
                    this.renderEditorTags();
                    this.renderTagSuggestions();
                }}
            }));
        });
    }

    // ============================================
    // NOTE VIEWER
    // ============================================

    async showNoteViewer(note) {
        const modal = this.dom.noteViewerModal;
        if (!modal) return;

        let displayContent = note.content;
        if (note.isSecure) {
            displayContent = await this.decryptNoteContent(note);
            if (!displayContent) {
                this.showToast('Failed to decrypt note', 'error');
                return;
            }
        }

        this.dom.viewerTitle.textContent = note.title;

        const date   = note.updatedAt ? new Date(note.updatedAt).toLocaleString() : '';
        const tags   = note.tags && note.tags.length ? ' · ' + note.tags.map(t => '#' + t).join(' ') : '';
        const pinned = note.isPinned ? '📌 Pinned · ' : '';
        this.dom.viewerMeta.textContent = `${pinned}${date}${tags}`;

        this.dom.viewerContent.textContent = '';
        displayContent.split('\n').forEach((line, i) => {
            if (i > 0) this.dom.viewerContent.appendChild(document.createElement('br'));
            this.dom.viewerContent.appendChild(document.createTextNode(line));
        });

        this.dom.viewerCloseBtn.onclick = () => modal.classList.remove('open');
        this.dom.viewerClose.onclick    = () => modal.classList.remove('open');
        this.dom.viewerEditBtn.onclick  = () => {
            modal.classList.remove('open');
            this.openNoteEditor(note);
        };

        modal.classList.add('open');
    }

    // ============================================
    // GLOBAL SEARCH
    // ============================================

    openGlobalSearch() {
        const modal = this.dom.globalSearchModal;
        if (!modal) return;

        modal.classList.add('open');
        if (this.dom.globalSearchInput) {
            this.dom.globalSearchInput.value = '';
            this.dom.globalSearchInput.focus();
        }
        if (this.dom.searchResults) {
            this.dom.searchResults.textContent = '';
            this.dom.searchResults.appendChild(h('p', { className: 'search-empty', text: 'Start typing to search across all notes...' }));
        }

        const doSearch = () => {
            if (!this.dom.globalSearchInput || !this.dom.searchResults) return;
            const query = this.dom.globalSearchInput.value.trim();

            if (!query) {
                this.dom.searchResults.textContent = '';
                this.dom.searchResults.appendChild(h('p', { className: 'search-empty', text: 'Start typing to search across all notes...' }));
                return;
            }

            const results = this.searchAllNotes(query, {
                titles:  this.dom.searchTitles  ? this.dom.searchTitles.checked  : true,
                content: this.dom.searchContent ? this.dom.searchContent.checked : true,
                tags:    this.dom.searchTags    ? this.dom.searchTags.checked    : false
            });

            this.dom.searchResults.textContent = '';

            if (results.length === 0) {
                this.dom.searchResults.appendChild(h('p', { className: 'search-empty', text: 'No results found' }));
                return;
            }

            const fragment = document.createDocumentFragment();
            results.forEach(result => {
                const item    = h('div', { className: 'search-result-item' });
                const icon    = h('img', { className: 'search-result-icon', attrs: { src: result.extension.icons?.[0]?.url || ICONS.default, alt: '' } });
                const content = h('div', { className: 'search-result-content' });
                const header  = h('div', { className: 'search-result-header' });
                header.appendChild(h('span', { className: 'search-result-title', text: result.note.title }));
                header.appendChild(h('span', { className: 'search-result-ext',   text: result.extension.name }));
                const preview = h('div', { className: 'search-result-preview' });
                this._appendHighlightedText(preview, result.preview, query);
                const meta = h('div', { className: 'search-result-meta' });
                const date = result.note.updatedAt ? new Date(result.note.updatedAt).toLocaleDateString() : '';
                meta.textContent = `${result.note.isPinned ? '📌 ' : ''}${result.note.isSecure ? '🔒 ' : ''}${date}`;
                content.appendChild(header);
                content.appendChild(preview);
                content.appendChild(meta);
                item.appendChild(icon);
                item.appendChild(content);
                item.addEventListener('click', () => {
                    modal.classList.remove('open');
                    this.selectExtension(result.extension.id);
                    setTimeout(() => this.showNoteViewer(result.note), 100);
                });
                fragment.appendChild(item);
            });
            this.dom.searchResults.appendChild(fragment);
        };

        if (this.dom.globalSearchInput) this.dom.globalSearchInput.oninput = doSearch;
        document.querySelectorAll('.search-filters input').forEach(cb => { cb.onchange = doSearch; });
    }

    _appendHighlightedText(container, text, query) {
        if (!text || !query) { container.textContent = text || ''; return; }
        const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex     = new RegExp(`(${safeQuery})`, 'gi');
        let lastIndex   = 0, match;
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
            const mark = document.createElement('mark');
            mark.textContent = match[1];
            container.appendChild(mark);
            lastIndex = regex.lastIndex;
        }
        if (lastIndex < text.length) container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const app = new NotesState();
    app.init();
});