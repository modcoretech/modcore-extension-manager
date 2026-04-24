/**
 * Extension Notes - Note Management for modcore Extension Manager
 */

// ============================================
// CONSTANTS & CONFIGURATION
// ============================================

const STORAGE_KEY = 'modcore_extension_notes_v4_master';
const MASTER_KEY_STORAGE = 'modcore_master_key_salt_v4';
const THEME_KEY = 'modcore_notes_theme';
const SECURITY_ITERATIONS = 600000;

const ICONS = {
    default: '../../public/icons/svg/dots-circle1.svg',
    search: '../../public/icons/svg/search.svg',
    close: '../../public/icons/svg/close.svg',
    pin: '../../public/icons/svg/pin.svg',
    unpin: '../../public/icons/svg/pin-off.svg',
    lock: '../../public/icons/svg/lock.svg',
    unlock: '../../public/icons/svg/lock-open.svg',
    shield: '../../public/icons/svg/shield.svg',
    star: '../../public/icons/svg/star.svg',
    tag: '../../public/icons/svg/tag.svg',
    plus: '../../public/icons/svg/plus.svg',
    settings: '../../public/icons/svg/settings.svg',
    download: '../../public/icons/svg/install.svg',
    upload: '../../public/icons/svg/upload.svg',
    keyboard: '../../public/icons/svg/keyboard.svg',
    moon: '../../public/icons/svg/moon.svg',
    sun: '../../public/icons/svg/sun.svg',
    trash: '../../public/icons/svg/trash.svg',
    edit: '../../public/icons/svg/edit.svg',
    check: '../../public/icons/svg/check.svg',
    warning: '../../public/icons/svg/warning.svg',
    info: '../../public/icons/svg/info.svg'
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

/**
 * Secure DOM element builder - replaces innerHTML patterns
 */
function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    
    if (props.className) el.className = props.className;
    if (props.id) el.id = props.id;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.attrs) {
        Object.entries(props.attrs).forEach(([k, v]) => el.setAttribute(k, v));
    }
    if (props.style) {
        Object.entries(props.style).forEach(([k, v]) => el.style[k] = v);
    }
    if (props.on) {
        Object.entries(props.on).forEach(([event, handler]) => {
            el.addEventListener(event, handler);
        });
    }
    
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
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// ============================================
// CRYPTOGRAPHIC FUNCTIONS
// ============================================

async function deriveKey(password, salt, iterations = SECURITY_ITERATIONS) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    
    return await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encryptData(data, password) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
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
        const data = base64ToBuffer(encryptedData);
        const salt = data.slice(0, 16);
        const iv = data.slice(16, 28);
        const ciphertext = data.slice(28);
        
        const key = await deriveKey(password, new Uint8Array(salt));
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(iv) },
            key,
            new Uint8Array(ciphertext)
        );
        
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.error('Decryption failed:', e);
        return null;
    }
}

async function hashPassword(password, salt = null) {
    const encoder = new TextEncoder();
    const useSalt = salt || crypto.getRandomValues(new Uint8Array(16));
    
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    
    const hash = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: useSalt,
            iterations: SECURITY_ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );
    
    return {
        hash: bufferToBase64(hash),
        salt: bufferToBase64(useSalt)
    };
}

async function verifyPassword(storedHash, storedSalt, password) {
    const result = await hashPassword(password, base64ToBuffer(storedSalt));
    return result.hash === storedHash;
}

// ============================================
// STATE MANAGEMENT
// ============================================

class NotesState {
    constructor() {
        this.extensions = [];
        this.notes = {};
        this.selectedExtensionId = null;
        this.searchQuery = '';
        this.notesSearchQuery = '';
        this.globalSearchQuery = '';
        this.activeFilters = new Set(['all']);
        this.activeTagFilters = new Set();
        this.editingNote = null;
        this.theme = 'auto';
        this.masterPassword = null;
        this.masterKeySalt = null;
        this.isAuthenticated = false;
        this.editorTags = [];
        this.dom = {};
        this._debouncers = {};
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
            'lockScreen', 'lockScreenTitle', 'lockScreenText', 'lockScreenPass',
            'lockScreenConfirm', 'lockScreenBtn', 'masterPassBtn', 'exportBtn', 'importBtn',
            'importFileInput', 'keyboardShortcutsBtn', 'shortcutsModal', 'closeShortcuts',
            'globalSearchModal', 'closeGlobalSearch', 'globalSearchInput', 'searchResults',
            'searchTitles', 'searchContent', 'searchTags', 'noteViewerModal', 'viewerTitle',
            'viewerMeta', 'viewerContent', 'viewerClose', 'viewerCloseBtn', 'viewerEditBtn',
            'clearFiltersBtn'
        ];
        
        ids.forEach(id => {
            this.dom[id] = document.getElementById(id);
        });
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    async init() {
        this.cacheDom();
        await this.loadTheme();
        await this.loadMasterKeySalt();
        this.setupEventListeners();
        
        if (!this.hasMasterPassword()) {
            this.showLockScreen('setup');
        } else if (!this.isAuthenticated) {
            this.showLockScreen('unlock');
        } else {
            await this._bootstrap();
        }
    }

    async _bootstrap() {
        await this.loadExtensions();
        await this.loadNotes();
        this.applyTheme();
        this.render();
    }

    // ============================================
    // LOCK SCREEN
    // ============================================

    showLockScreen(mode) {
        const screen = this.dom.lockScreen;
        const title = this.dom.lockScreenTitle;
        const text = this.dom.lockScreenText;
        const pass = this.dom.lockScreenPass;
        const confirm = this.dom.lockScreenConfirm;
        const btn = this.dom.lockScreenBtn;
        
        if (!screen) return;
        
        pass.value = '';
        confirm.value = '';
        
        if (mode === 'setup') {
            title.textContent = 'Welcome to Extension Notes';
            text.textContent = 'Set up a Master Password to encrypt and protect your notes.';
            confirm.style.display = 'block';
            btn.textContent = 'Set Password';
        } else {
            title.textContent = 'Unlock Extension Notes';
            text.textContent = 'Enter your Master Password to continue.';
            confirm.style.display = 'none';
            btn.textContent = 'Unlock';
        }
        
        const handler = async () => {
            const password = pass.value.trim();
            
            if (!password || password.length < 6) {
                this.showToast('Password must be at least 6 characters', 'error');
                return;
            }
            
            if (mode === 'setup') {
                const confirmPass = confirm.value.trim();
                if (password !== confirmPass) {
                    this.showToast('Passwords do not match', 'error');
                    return;
                }
                await this.setMasterPassword(password);
                this.masterPassword = password;
                this.isAuthenticated = true;
                this.hideLockScreen();
                await this._bootstrap();
                this.showToast('Master Password set successfully', 'success');
            } else {
                const isValid = await this.authenticateMasterPassword(password);
                if (isValid) {
                    const decrypted = await this.decryptNotesWithMaster(password);
                    if (decrypted) {
                        this.isAuthenticated = true;
                        this.hideLockScreen();
                        await this._bootstrap();
                        this.showToast('Welcome back', 'success');
                    } else {
                        this.showToast('Failed to decrypt notes', 'error');
                    }
                } else {
                    this.showToast('Incorrect Master Password', 'error');
                    pass.value = '';
                    pass.focus();
                }
            }
        };
        
        btn.onclick = handler;
        pass.onkeydown = (e) => {
            if (e.key === 'Enter') {
                if (mode === 'setup' && confirm.style.display !== 'none') {
                    confirm.focus();
                } else {
                    handler();
                }
            }
        };
        confirm.onkeydown = (e) => {
            if (e.key === 'Enter') handler();
        };
        
        screen.classList.add('open');
        setTimeout(() => pass.focus(), 100);
    }

    hideLockScreen() {
        if (this.dom.lockScreen) {
            this.dom.lockScreen.classList.remove('open');
        }
    }

    // ============================================
    // MASTER PASSWORD OPERATIONS
    // ============================================

    async loadMasterKeySalt() {
        return new Promise((resolve) => {
            chrome.storage.local.get([MASTER_KEY_STORAGE], (result) => {
                if (result[MASTER_KEY_STORAGE]) {
                    this.masterKeySalt = result[MASTER_KEY_STORAGE];
                }
                resolve();
            });
        });
    }

    async saveMasterKeySalt(salt) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [MASTER_KEY_STORAGE]: salt }, resolve);
        });
    }

    hasMasterPassword() {
        return !!this.masterKeySalt;
    }

    async setMasterPassword(password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const hashResult = await hashPassword(password, salt);
        await this.saveMasterKeySalt({
            hash: hashResult.hash,
            salt: hashResult.salt
        });
        return true;
    }

    async verifyMasterPassword(password) {
        if (!this.hasMasterPassword()) return false;
        return await verifyPassword(this.masterKeySalt.hash, this.masterKeySalt.salt, password);
    }

    async authenticateMasterPassword(password) {
        const isValid = await this.verifyMasterPassword(password);
        if (isValid) {
            this.masterPassword = password;
        }
        return isValid;
    }

    lockApp() {
        this.masterPassword = null;
        this.isAuthenticated = false;
        this.notes = {};
        this.extensions = [];
        this.selectedExtensionId = null;
        this.searchQuery = '';
        this.notesSearchQuery = '';
        this.showLockScreen('unlock');
    }

    // ============================================
    // STORAGE OPERATIONS
    // ============================================

    async loadNotes() {
        return new Promise((resolve) => {
            chrome.storage.local.get([STORAGE_KEY], async (result) => {
                const stored = result[STORAGE_KEY];
                if (stored && stored.encrypted && this.masterPassword) {
                    const decrypted = await decryptData(stored.data, this.masterPassword);
                    if (decrypted) {
                        try {
                            this.notes = JSON.parse(decrypted);
                        } catch (e) {
                            this.notes = {};
                        }
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
        return new Promise((resolve) => {
            if (!this.masterPassword) {
                resolve();
                return;
            }
            encryptData(JSON.stringify(this.notes), this.masterPassword).then(encrypted => {
                chrome.storage.local.set({
                    [STORAGE_KEY]: { encrypted: true, data: encrypted }
                }, () => {
                    this.showToast('Changes saved securely', 'success');
                    resolve();
                });
            });
        });
    }

    async decryptNotesWithMaster(password) {
        try {
            const stored = await new Promise((resolve) => {
                chrome.storage.local.get([STORAGE_KEY], (result) => resolve(result[STORAGE_KEY]));
            });
            
            if (stored && stored.encrypted) {
                const decrypted = await decryptData(stored.data, password);
                if (decrypted) {
                    this.notes = JSON.parse(decrypted);
                    this.masterPassword = password;
                    return true;
                }
            }
            return false;
        } catch (e) {
            console.error('Failed to decrypt notes:', e);
            return false;
        }
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
        return new Promise((resolve) => {
            chrome.management.getAll((exts) => {
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
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(ext => 
                ext.name.toLowerCase().includes(query) ||
                (ext.description && ext.description.toLowerCase().includes(query))
            );
        }

        if (this.activeFilters.has('has-notes')) {
            filtered = filtered.filter(ext => {
                const extNotes = this.notes[ext.id] || [];
                return extNotes.length > 0;
            });
        }

        if (this.activeFilters.has('pinned')) {
            filtered = filtered.filter(ext => {
                const extNotes = this.notes[ext.id] || [];
                return extNotes.some(n => n.isPinned);
            });
        }

        return filtered;
    }

    getSelectedExtension() {
        return this.extensions.find(ext => ext.id === this.selectedExtensionId);
    }

    // ============================================
    // NOTE OPERATIONS
    // ============================================

    getExtensionNotes(extId) {
        return this.notes[extId] || [];
    }

    getFilteredNotes(extId) {
        let notes = this.getExtensionNotes(extId);

        if (this.notesSearchQuery) {
            const query = this.notesSearchQuery.toLowerCase();
            notes = notes.filter(note => {
                const titleMatch = note.title && note.title.toLowerCase().includes(query);
                const contentMatch = !note.isSecure && note.content && note.content.toLowerCase().includes(query);
                const tagMatch = note.tags && note.tags.some(tag => tag.toLowerCase().includes(query));
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
        const notes = this.getExtensionNotes(extId);
        let displayContent = noteData.content;
        let secureContent = null;

        if (noteData.isSecure && this.masterPassword) {
            secureContent = await encryptData(noteData.content, this.masterPassword);
            displayContent = '[SECURED]';
        }

        const newNote = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
            title: noteData.title,
            content: displayContent,
            tags: noteData.tags || [],
            isPinned: noteData.isPinned || false,
            isSecure: noteData.isSecure || false,
            secureContent: secureContent,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        notes.push(newNote);
        this.notes[extId] = notes;
        await this.saveNotes();
        return newNote;
    }

    async updateNote(extId, noteId, updates) {
        const notes = this.getExtensionNotes(extId);
        const noteIndex = notes.findIndex(n => n.id === noteId);
        
        if (noteIndex === -1) return null;

        const note = notes[noteIndex];
        const isSecureChanging = updates.isSecure !== undefined && updates.isSecure !== note.isSecure;
        
        if (isSecureChanging) {
            if (updates.isSecure && !note.isSecure) {
                // Converting to secure
                if (this.masterPassword && updates.content) {
                    updates.secureContent = await encryptData(updates.content, this.masterPassword);
                    updates.content = '[SECURED]';
                }
            } else if (!updates.isSecure && note.isSecure) {
                // Converting from secure
                if (note.secureContent && this.masterPassword) {
                    const decrypted = await decryptData(note.secureContent, this.masterPassword);
                    if (decrypted) {
                        updates.content = decrypted;
                        updates.secureContent = null;
                    } else {
                        this.showToast('Failed to decrypt note', 'error');
                        return null;
                    }
                }
            }
        } else if (note.isSecure && updates.content && this.masterPassword) {
            // Updating secure note content
            updates.secureContent = await encryptData(updates.content, this.masterPassword);
        }

        notes[noteIndex] = {
            ...note,
            ...updates,
            updatedAt: Date.now()
        };

        this.notes[extId] = notes;
        await this.saveNotes();
        return notes[noteIndex];
    }

    async deleteNote(extId, noteId) {
        const notes = this.getExtensionNotes(extId);
        const filtered = notes.filter(n => n.id !== noteId);
        
        if (filtered.length === notes.length) return false;

        if (filtered.length === 0) {
            delete this.notes[extId];
        } else {
            this.notes[extId] = filtered;
        }
        
        await this.saveNotes();
        return true;
    }

    async togglePin(extId, noteId) {
        const notes = this.getExtensionNotes(extId);
        const note = notes.find(n => n.id === noteId);
        if (note) {
            note.isPinned = !note.isPinned;
            note.updatedAt = Date.now();
            await this.saveNotes();
            return note.isPinned;
        }
        return null;
    }

    async decryptNoteContent(note) {
        if (!note.isSecure || !note.secureContent || !this.masterPassword) {
            return note.content;
        }
        return await decryptData(note.secureContent, this.masterPassword);
    }

    // ============================================
    // EXPORT/IMPORT
    // ============================================

    async exportNotes() {
        if (!this.masterPassword) {
            this.showToast('Master Password required to export', 'error');
            return;
        }

        const exportData = {
            version: 4,
            exportedAt: new Date().toISOString(),
            encrypted: true,
            notes: null,
            stats: {
                totalExtensions: Object.keys(this.notes).length,
                totalNotes: Object.values(this.notes).reduce((sum, arr) => sum + (arr ? arr.length : 0), 0)
            }
        };

        const jsonStr = JSON.stringify(this.notes);
        exportData.notes = await encryptData(jsonStr, this.masterPassword);

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
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
                    
                    if (!data.notes) {
                        throw new Error('Invalid backup format');
                    }

                    let importedNotes;

                    if (data.encrypted) {
                        const password = await this.promptForPassword('Enter Master Password to decrypt import');
                        if (!password) {
                            resolve(false);
                            return;
                        }
                        
                        const decrypted = await decryptData(data.notes, password);
                        if (!decrypted) {
                            this.showToast('Incorrect password or corrupted backup', 'error');
                            resolve(false);
                            return;
                        }
                        importedNotes = JSON.parse(decrypted);
                    } else {
                        importedNotes = data.notes;
                    }

                    const existingCount = Object.values(this.notes).reduce((s, a) => s + (a ? a.length : 0), 0);
                    const importCount = Object.values(importedNotes).reduce((s, a) => s + (a ? a.length : 0), 0);

                    if (existingCount > 0) {
                        const shouldMerge = await this.showConfirm(
                            'Import Options',
                            `You have ${existingCount} existing notes. Import ${importCount} notes and merge with existing?`
                        );
                        
                        if (!shouldMerge) {
                            resolve(false);
                            return;
                        }

                        Object.entries(importedNotes).forEach(([extId, notes]) => {
                            if (!this.notes[extId]) {
                                this.notes[extId] = [];
                            }
                            const existingIds = new Set(this.notes[extId].map(n => n.id));
                            notes.forEach(note => {
                                if (!existingIds.has(note.id)) {
                                    this.notes[extId].push(note);
                                }
                            });
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
        const results = [];
        const lowerQuery = query.toLowerCase();

        Object.entries(this.notes).forEach(([extId, notes]) => {
            const ext = this.extensions.find(e => e.id === extId);
            if (!ext || !Array.isArray(notes)) return;

            notes.forEach(note => {
                let match = false;
                const matchType = [];
                let preview = '';

                if (options.titles && note.title && note.title.toLowerCase().includes(lowerQuery)) {
                    match = true;
                    matchType.push('title');
                    preview = note.title;
                }

                if (options.content && note.content && !note.isSecure && note.content.toLowerCase().includes(lowerQuery)) {
                    match = true;
                    matchType.push('content');
                    if (!preview) {
                        const idx = note.content.toLowerCase().indexOf(lowerQuery);
                        const start = Math.max(0, idx - 50);
                        const end = Math.min(note.content.length, idx + query.length + 50);
                        preview = '...' + note.content.slice(start, end) + '...';
                    }
                }

                if (options.tags && note.tags && note.tags.some(t => t.toLowerCase().includes(lowerQuery))) {
                    match = true;
                    matchType.push('tag');
                }

                if (match) {
                    results.push({
                        note,
                        extension: ext,
                        matchType,
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
                notes.forEach(note => {
                    if (note.tags) {
                        note.tags.forEach(tag => tags.add(tag));
                    }
                });
            }
        });
        return Array.from(tags).sort();
    }

    getRecommendedTags(currentTags = []) {
        const allTags = this.getAllTags();
        const currentSet = new Set(currentTags);
        return allTags.filter(tag => !currentSet.has(tag)).slice(0, 5);
    }

    // ============================================
    // UI HELPERS
    // ============================================

    applyTheme() {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const isDark = this.theme === 'dark' || (this.theme === 'auto' && prefersDark);
        
        document.body.classList.toggle('dark-mode', isDark);
    }

    showToast(message, type = 'info', duration = 3000) {
        const container = this.dom.toastContainer;
        if (!container) return;
        
        const toast = h('div', { className: `toast ${type}` },
            h('img', { className: 'toast-icon', attrs: { src: ICONS[type === 'success' ? 'check' : type === 'error' ? 'warning' : 'info'], alt: '' } }),
            h('span', { text: message })
        );
        
        container.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, duration);
    }

    showConfirm(title, message) {
        return new Promise((resolve) => {
            const modal = this.dom.confirmModal;
            if (!modal) {
                resolve(false);
                return;
            }
            
            const titleEl = this.dom.confirmTitle;
            const messageEl = this.dom.confirmMessage;
            const confirmBtn = this.dom.confirmAction;
            const cancelBtn = this.dom.confirmCancel;

            titleEl.textContent = title;
            messageEl.textContent = message;
            
            const cleanup = () => {
                modal.classList.remove('open');
                confirmBtn.onclick = null;
                cancelBtn.onclick = null;
            };

            confirmBtn.onclick = () => {
                cleanup();
                resolve(true);
            };

            cancelBtn.onclick = () => {
                cleanup();
                resolve(false);
            };

            modal.classList.add('open');
        });
    }

    async promptForPassword(message) {
        return new Promise((resolve) => {
            const modal = h('div', { className: 'modal-overlay open', attrs: { 'aria-modal': 'true', role: 'dialog' } },
                h('div', { className: 'modal-content unlock-modal' },
                    h('h2', { text: message }),
                    h('div', { className: 'form-group' },
                        h('input', { attrs: { type: 'password', placeholder: 'Enter password...', autofocus: 'true' }, id: 'promptPasswordInput' })
                    ),
                    h('div', { className: 'modal-footer' },
                        h('button', { className: 'modcore-btn modcore-btn-text', on: { click: () => { cleanup(); resolve(null); } } }, 'Cancel'),
                        h('button', { className: 'modcore-btn modcore-btn-primary', on: { click: () => { cleanup(); resolve(input.value); } } }, 'Confirm')
                    )
                )
            );
            
            document.body.appendChild(modal);
            const input = modal.querySelector('#promptPasswordInput');
            input.focus();
            
            const cleanup = () => {
                if (modal.parentNode) modal.remove();
            };
            
            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    cleanup();
                    resolve(input.value);
                }
            };
            
            modal.onclick = (e) => {
                if (e.target === modal) {
                    cleanup();
                    resolve(null);
                }
            };
        });
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    setupEventListeners() {
        // Debounced search helpers
        const debounce = (key, fn, ms = 150) => {
            clearTimeout(this._debouncers[key]);
            this._debouncers[key] = setTimeout(fn, ms);
        };

        // Extension search
        if (this.dom.extensionSearch) {
            this.dom.extensionSearch.addEventListener('input', (e) => {
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

        // Filter chips - event delegation
        if (this.dom.filterChips) {
            this.dom.filterChips.addEventListener('click', (e) => {
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
                        if (this.activeFilters.size === 0) {
                            this.activeFilters.add('all');
                        }
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
            this.dom.notesSearch.addEventListener('input', (e) => {
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

        // New note buttons
        if (this.dom.newNoteBtn) {
            this.dom.newNoteBtn.addEventListener('click', () => this.openNoteEditor());
        }
        
        if (this.dom.createFirstNoteBtn) {
            this.dom.createFirstNoteBtn.addEventListener('click', () => this.openNoteEditor());
        }

        // Manage extension
        if (this.dom.manageExtBtn) {
            this.dom.manageExtBtn.addEventListener('click', () => {
                const ext = this.getSelectedExtension();
                if (ext) {
                    chrome.tabs.create({ url: `chrome://extensions/?id=${ext.id}` });
                }
            });
        }

        // Export/Import
        if (this.dom.exportBtn) {
            this.dom.exportBtn.addEventListener('click', () => this.exportNotes());
        }
        
        if (this.dom.importBtn && this.dom.importFileInput) {
            this.dom.importBtn.addEventListener('click', () => {
                this.dom.importFileInput.click();
            });
            
            this.dom.importFileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (file) {
                    await this.importNotes(file);
                    this.render();
                    e.target.value = '';
                }
            });
        }

        // Master password button - lock app
        if (this.dom.masterPassBtn) {
            this.dom.masterPassBtn.addEventListener('click', () => this.lockApp());
        }

        // Keyboard shortcuts modal
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
        document.addEventListener('keydown', (e) => {
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

        // Modal close on backdrop
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('open');
                }
            });
        });

        // Note container event delegation
        if (this.dom.notesContainer) {
            this.dom.notesContainer.addEventListener('click', (e) => {
                const card = e.target.closest('.note-card');
                if (!card) return;
                
                const noteId = card.dataset.noteId;
                
                if (e.target.closest('.pin-btn')) {
                    e.stopPropagation();
                    this.handlePinClick(noteId);
                } else if (e.target.closest('.edit-btn')) {
                    e.stopPropagation();
                    this.handleEditClick(noteId);
                } else if (e.target.closest('.delete-btn')) {
                    e.stopPropagation();
                    this.handleDeleteClick(noteId);
                } else {
                    this.handleNoteCardClick(noteId);
                }
            });
        }

        // Keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.target.matches('input, textarea')) return;

            switch(e.key) {
                case '?':
                    e.preventDefault();
                    if (this.dom.shortcutsModal) this.dom.shortcutsModal.classList.add('open');
                    break;
                case 'Escape':
                    document.querySelectorAll('.modal-overlay.open').forEach(m => {
                        m.classList.remove('open');
                    });
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

    updateFilterChips() {
        document.querySelectorAll('.chip[data-filter]').forEach(chip => {
            const filter = chip.dataset.filter;
            chip.setAttribute('aria-pressed', this.activeFilters.has(filter));
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
        const extNotes = this.getExtensionNotes(ext.id);
        const hasNotes = extNotes.length > 0;
        const hasPinned = extNotes.some(n => n.isPinned);
        
        const item = h('div', {
            className: `ext-item ${ext.id === this.selectedExtensionId ? 'active' : ''} ${hasNotes ? 'has-notes' : ''} ${hasPinned ? 'has-pinned' : ''}`,
            attrs: {
                'data-ext-id': ext.id,
                role: 'listitem',
                tabindex: '0',
                'aria-selected': String(ext.id === this.selectedExtensionId)
            },
            on: {
                click: () => this.selectExtension(ext.id),
                keydown: (e) => {
                    if (e.key === 'Enter') this.selectExtension(ext.id);
                }
            }
        },
            h('img', { className: 'ext-icon-small', attrs: { src: ext.icons?.[0]?.url || ICONS.default, alt: '' } }),
            h('div', { className: 'ext-item-info' },
                h('div', { className: 'ext-item-name', text: ext.name }),
                h('div', { className: 'ext-item-meta', text: hasNotes ? `${extNotes.length} note${extNotes.length !== 1 ? 's' : ''}` : 'No notes' })
            )
        );
        
        return item;
    }

    _updateExtensionItem(el, ext) {
        const extNotes = this.getExtensionNotes(ext.id);
        const hasNotes = extNotes.length > 0;
        const hasPinned = extNotes.some(n => n.isPinned);
        const isActive = ext.id === this.selectedExtensionId;
        
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
        const list = this.dom.extensionsList;
        const empty = this.dom.emptySidebar;
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
        list.querySelectorAll('.ext-item').forEach(el => {
            currentMap.set(el.dataset.extId, el);
        });
        
        const newIds = new Set(filtered.map(e => e.id));
        
        // Remove items no longer in filtered list
        currentMap.forEach((el, id) => {
            if (!newIds.has(id)) el.remove();
        });
        
        // Add or update items
        filtered.forEach((ext, index) => {
            let item = currentMap.get(ext.id);
            
            if (!item) {
                item = this._createExtensionItem(ext);
                if (index < list.children.length) {
                    list.insertBefore(item, list.children[index]);
                } else {
                    list.appendChild(item);
                }
            } else {
                this._updateExtensionItem(item, ext);
                if (list.children[index] !== item) {
                    list.insertBefore(item, list.children[index] || null);
                }
            }
        });
    }

    renderMainContent() {
        const welcome = this.dom.welcomeState;
        const view = this.dom.extensionNotesView;

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

        if (this.dom.selectedExtIcon) this.dom.selectedExtIcon.src = ext.icons?.[0]?.url || ICONS.default;
        if (this.dom.selectedExtIcon) this.dom.selectedExtIcon.alt = ext.name;
        if (this.dom.selectedExtName) this.dom.selectedExtName.textContent = ext.name;

        const notes = this.getExtensionNotes(ext.id);
        if (this.dom.extNoteCount) {
            this.dom.extNoteCount.textContent = `${notes.length} note${notes.length !== 1 ? 's' : ''}`;
        }

        this.renderTagsFilter();
        this.renderNotes();
    }

    renderTagsFilter() {
        const container = this.dom.tagsFilter;
        if (!container) return;
        
        const allTags = new Set();
        const notes = this.getExtensionNotes(this.selectedExtensionId);
        
        if (Array.isArray(notes)) {
            notes.forEach(note => {
                if (note.tags) {
                    note.tags.forEach(tag => allTags.add(tag));
                }
            });
        }

        container.textContent = '';
        
        const fragment = document.createDocumentFragment();
        
        Array.from(allTags).sort().forEach(tag => {
            const isActive = this.activeTagFilters.has(tag);
            const btn = h('button', {
                className: `tag-filter ${isActive ? 'active' : ''}`,
                on: { click: () => {
                    if (this.activeTagFilters.has(tag)) {
                        this.activeTagFilters.delete(tag);
                    } else {
                        this.activeTagFilters.add(tag);
                    }
                    this.renderTagsFilter();
                    this.renderNotes();
                }}
            });
            
            btn.appendChild(document.createTextNode(tag));
            
            if (isActive) {
                btn.appendChild(h('span', { className: 'remove-tag', text: '×' }));
            }
            
            fragment.appendChild(btn);
        });
        
        container.appendChild(fragment);
    }

    renderNotes() {
        const container = this.dom.notesContainer;
        const empty = this.dom.emptyNotes;
        const notes = this.getFilteredNotes(this.selectedExtensionId);

        if (!container || !empty) return;

        if (notes.length === 0) {
            container.style.display = 'none';
            empty.classList.add('open');
            
            const emptyTitle = empty.querySelector('h3');
            const emptyText = empty.querySelector('p');
            
            if (this.notesSearchQuery || this.activeTagFilters.size > 0) {
                if (emptyTitle) emptyTitle.textContent = 'No matching notes';
                if (emptyText) emptyText.textContent = 'Try adjusting your search or filters.';
            } else {
                if (emptyTitle) emptyTitle.textContent = 'No notes yet';
                if (emptyText) emptyText.textContent = 'Create your first note to remember important details about this extension.';
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

            const header = h('div', { className: 'note-header' });
            const titleRow = h('div', { className: 'note-title-row' });
            const title = h('h3', { className: 'note-title', text: note.title });
            titleRow.appendChild(title);
            
            const badges = h('div', { className: 'note-badges' });
            if (note.isPinned) {
                badges.appendChild(h('span', { className: 'badge pinned', attrs: { title: 'Pinned' }, text: '📌' }));
            }
            if (note.isSecure) {
                badges.appendChild(h('span', { className: 'badge secure', attrs: { title: 'Secure' }, text: '🔒' }));
            }
            if (badges.children.length > 0) {
                titleRow.appendChild(badges);
            }
            header.appendChild(titleRow);
            
            const actions = h('div', { className: 'note-actions' });
            actions.appendChild(h('button', {
                className: 'note-action-btn pin-btn',
                attrs: { title: note.isPinned ? 'Unpin' : 'Pin' }
            }, h('img', { attrs: { src: note.isPinned ? ICONS.unpin : ICONS.pin, alt: '' } })));
            
            actions.appendChild(h('button', {
                className: 'note-action-btn edit-btn',
                attrs: { title: 'Edit' }
            }, h('img', { attrs: { src: ICONS.edit, alt: '' } })));
            
            actions.appendChild(h('button', {
                className: 'note-action-btn delete-btn',
                attrs: { title: 'Delete' }
            }, h('img', { attrs: { src: ICONS.trash, alt: '' } })));
            
            header.appendChild(actions);
            card.appendChild(header);
            
            const date = note.updatedAt ? new Date(note.updatedAt).toLocaleDateString() : 'Unknown date';
            const tags = note.tags && note.tags.length ? note.tags.map(t => `#${t}`).join(' ') : 'No tags';
            card.appendChild(h('div', { className: 'note-meta', text: `${date} · ${tags}` }));
            
            let previewText = note.content;
            if (note.isSecure) {
                previewText = '🔒 This note is secured. Click to view.';
            }
            card.appendChild(h('div', { className: 'note-preview', text: previewText }));
            
            if (note.tags && note.tags.length) {
                const tagsContainer = h('div', { className: 'note-tags' });
                note.tags.forEach(tag => {
                    tagsContainer.appendChild(h('span', { className: 'note-tag', text: tag }));
                });
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
        this.notesSearchQuery = '';
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
        const note = notes.find(n => n.id === noteId);
        if (!note) return;
        
        if (note.isSecure) {
            const decrypted = await this.decryptNoteContent(note);
            if (decrypted) {
                const editableNote = { ...note, content: decrypted };
                this.openNoteEditor(editableNote);
            } else {
                this.showToast('Failed to decrypt note', 'error');
            }
        } else {
            this.openNoteEditor(note);
        }
    }

    async handleDeleteClick(noteId) {
        const confirmed = await this.showConfirm('Delete Note', 'Are you sure you want to delete this note?');
        if (confirmed) {
            const card = this.dom.notesContainer.querySelector(`[data-note-id="${noteId}"]`);
            if (card) card.classList.add('deleting');
            
            setTimeout(async () => {
                await this.deleteNote(this.selectedExtensionId, noteId);
                this.render();
            }, 300);
        }
    }

    async handleNoteCardClick(noteId) {
        const notes = this.getExtensionNotes(this.selectedExtensionId);
        const note = notes.find(n => n.id === noteId);
        if (!note) return;
        this.showNoteViewer(note);
    }

    // ============================================
    // NOTE EDITOR
    // ============================================

    openNoteEditor(note = null) {
        this.editingNote = note;
        const modal = this.dom.noteEditorModal;
        if (!modal) return;
        
        this.dom.editorTitle.textContent = note ? 'Edit Note' : 'New Note';
        this.dom.noteTitle.value = note?.title || '';
        this.dom.noteContent.value = note?.content || '';
        this.dom.notePinned.checked = note?.isPinned || false;
        this.dom.noteSecure.checked = note?.isSecure || false;
        
        if (this.dom.securityPanel) {
            this.dom.securityPanel.classList.toggle('open', !!note?.isSecure);
        }

        this.editorTags = note?.tags ? [...note.tags] : [];
        this.renderEditorTags();
        this.renderTagSuggestions();

        modal.classList.add('open');
        this.dom.noteTitle.focus();

        this.setupTagInput();

        // Security toggle
        if (this.dom.noteSecure) {
            this.dom.noteSecure.onchange = () => {
                if (this.dom.securityPanel) {
                    this.dom.securityPanel.classList.toggle('open', this.dom.noteSecure.checked);
                }
            };
        }

        // Save handler
        this.dom.saveNote.onclick = async () => {
            if (!this.dom.noteTitle.value.trim()) {
                this.showToast('Title is required', 'error');
                this.dom.noteTitle.focus();
                return;
            }

            const isSecure = this.dom.noteSecure && this.dom.noteSecure.checked;
            const noteData = {
                title: this.dom.noteTitle.value.trim(),
                content: this.dom.noteContent ? this.dom.noteContent.value : '',
                tags: this.editorTags,
                isPinned: this.dom.notePinned ? this.dom.notePinned.checked : false,
                isSecure: isSecure
            };

            if (note) {
                await this.updateNote(this.selectedExtensionId, note.id, noteData);
            } else {
                await this.createNote(this.selectedExtensionId, noteData);
            }

            modal.classList.remove('open');
            this.render();
        };

        this.dom.cancelNote.onclick = () => {
            modal.classList.remove('open');
        };

        this.dom.closeEditor.onclick = () => {
            modal.classList.remove('open');
        };
    }

    setupTagInput() {
        const input = this.dom.noteTags;
        const datalist = this.dom.existingTags;
        
        if (!input || !datalist) return;
        
        const allTags = this.getAllTags();
        datalist.textContent = '';
        allTags.forEach(tag => {
            datalist.appendChild(h('option', { attrs: { value: tag } }));
        });

        input.onkeydown = (e) => {
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
            const removeBtn = h('button', {
                className: 'tag-remove',
                text: '×',
                on: { click: () => {
                    this.editorTags.splice(i, 1);
                    this.renderEditorTags();
                    this.renderTagSuggestions();
                }}
            });
            tagSpan.appendChild(removeBtn);
            container.appendChild(tagSpan);
        });
    }

    renderTagSuggestions() {
        const container = this.dom.tagSuggestions;
        if (!container) return;
        
        const suggestions = this.getRecommendedTags(this.editorTags);
        
        container.textContent = '';
        suggestions.forEach(tag => {
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
        
        const date = note.updatedAt ? new Date(note.updatedAt).toLocaleString() : '';
        const tags = note.tags && note.tags.length ? ' · ' + note.tags.map(t => '#' + t).join(' ') : '';
        const pinned = note.isPinned ? '📌 Pinned · ' : '';
        this.dom.viewerMeta.textContent = `${pinned}${date}${tags}`;
        
        // Set content with line breaks using safe DOM methods
        this.dom.viewerContent.textContent = '';
        const lines = displayContent.split('\n');
        lines.forEach((line, i) => {
            if (i > 0) this.dom.viewerContent.appendChild(document.createElement('br'));
            this.dom.viewerContent.appendChild(document.createTextNode(line));
        });
        
        this.dom.viewerCloseBtn.onclick = () => modal.classList.remove('open');
        this.dom.viewerClose.onclick = () => modal.classList.remove('open');
        this.dom.viewerEditBtn.onclick = () => {
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
            this.dom.searchResults.appendChild(h('p', {
                className: 'search-empty',
                text: 'Start typing to search across all notes...'
            }));
        }

        const doSearch = () => {
            if (!this.dom.globalSearchInput || !this.dom.searchResults) return;
            
            const query = this.dom.globalSearchInput.value.trim();
            
            if (!query) {
                this.dom.searchResults.textContent = '';
                this.dom.searchResults.appendChild(h('p', {
                    className: 'search-empty',
                    text: 'Start typing to search across all notes...'
                }));
                return;
            }

            const searchResults = this.searchAllNotes(query, {
                titles: this.dom.searchTitles ? this.dom.searchTitles.checked : true,
                content: this.dom.searchContent ? this.dom.searchContent.checked : true,
                tags: this.dom.searchTags ? this.dom.searchTags.checked : false
            });

            this.dom.searchResults.textContent = '';

            if (searchResults.length === 0) {
                this.dom.searchResults.appendChild(h('p', {
                    className: 'search-empty',
                    text: 'No results found'
                }));
                return;
            }

            const fragment = document.createDocumentFragment();
            
            searchResults.forEach(result => {
                const item = h('div', { className: 'search-result-item' });
                
                const icon = h('img', {
                    className: 'search-result-icon',
                    attrs: { src: result.extension.icons?.[0]?.url || ICONS.default, alt: '' }
                });
                
                const content = h('div', { className: 'search-result-content' });
                const header = h('div', { className: 'search-result-header' });
                header.appendChild(h('span', { className: 'search-result-title', text: result.note.title }));
                header.appendChild(h('span', { className: 'search-result-ext', text: result.extension.name }));
                
                const preview = h('div', { className: 'search-result-preview' });
                // Safe highlight
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
                    
                    setTimeout(() => {
                        this.showNoteViewer(result.note);
                    }, 100);
                });
                
                fragment.appendChild(item);
            });
            
            this.dom.searchResults.appendChild(fragment);
        };

        if (this.dom.globalSearchInput) {
            this.dom.globalSearchInput.oninput = doSearch;
        }
        document.querySelectorAll('.search-filters input').forEach(cb => {
            cb.onchange = doSearch;
        });
    }

    _appendHighlightedText(container, text, query) {
        if (!text || !query) {
            container.textContent = text || '';
            return;
        }
        const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${safeQuery})`, 'gi');
        let lastIndex = 0;
        let match;
        
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
            }
            const mark = document.createElement('mark');
            mark.textContent = match[1];
            container.appendChild(mark);
            lastIndex = regex.lastIndex;
        }
        
        if (lastIndex < text.length) {
            container.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
    }
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const app = new NotesState();
    app.init();
});
