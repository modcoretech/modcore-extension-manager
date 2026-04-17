/**
 * Extension Notes - for modcore Extension Manager
 */

// ============================================
// CONSTANTS & CONFIGURATION
// ============================================

const STORAGE_KEY = 'modcore_extension_notes_v3_secure';
const MASTER_KEY_STORAGE = 'modcore_master_key_salt';
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

/**
 * Safely escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Safely create DOM element with text content
 */
function createElement(tag, className, textContent) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent !== undefined && textContent !== null) {
        el.textContent = textContent;
    }
    return el;
}

/**
 * Convert ArrayBuffer to Base64
 */
function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Convert Base64 to ArrayBuffer
 */
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

/**
 * Derive a key from password using PBKDF2
 */
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

/**
 * Encrypt data with AES-GCM
 */
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
    
    // Combine salt + iv + ciphertext
    const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);
    
    return bufferToBase64(result);
}

/**
 * Decrypt data with AES-GCM
 */
async function decryptData(encryptedData, password) {
    try {
        const data = base64ToBuffer(encryptedData);
        const salt = data.slice(0, 16);
        const iv = data.slice(16, 28);
        const ciphertext = data.slice(28);
        
        const key = await deriveKey(password, salt);
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

/**
 * Create a secure hash for password verification (not for encryption)
 */
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

/**
 * Verify a password against stored hash
 */
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
        this.unlockedSecureNotes = new Map(); // Session-only unlocked notes with decrypted content
        this.masterPassword = null; // Session-only master password
        this.masterKeySalt = null;
        this.eventListenersBound = false;
    }

    async init() {
        await this.loadTheme();
        await this.loadExtensions();
        await this.loadNotes();
        await this.loadMasterKeySalt();
        if (!this.eventListenersBound) {
            this.setupEventListeners();
            this.eventListenersBound = true;
        }
        this.render();
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

    isMasterPasswordSet() {
        return this.masterPassword !== null;
    }

    async setMasterPassword(password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const hashResult = await hashPassword(password, salt);
        await this.saveMasterKeySalt({
            hash: hashResult.hash,
            salt: hashResult.salt
        });
        this.masterPassword = password;
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

    clearMasterPassword() {
        this.masterPassword = null;
    }

    // ============================================
    // STORAGE OPERATIONS
    // ============================================

    async loadNotes() {
        return new Promise((resolve) => {
            chrome.storage.local.get([STORAGE_KEY], async (result) => {
                const stored = result[STORAGE_KEY];
                if (stored && stored.encrypted) {
                    // Data is encrypted, need master password to decrypt
                    this.notes = { _encrypted: true, data: stored.data };
                } else {
                    this.notes = stored || {};
                }
                resolve();
            });
        });
    }

    async saveNotes() {
        return new Promise((resolve) => {
            const dataToSave = this.masterPassword ? 
                { encrypted: true, data: this.notes } : 
                this.notes;
            
            chrome.storage.local.set({ [STORAGE_KEY]: dataToSave }, () => {
                this.showToast('Changes saved', 'success');
                resolve();
            });
        });
    }

    async encryptAndSaveNotes() {
        if (!this.masterPassword) {
            await this.saveNotes();
            return;
        }

        // Encrypt all notes with master password
        const encrypted = await encryptData(JSON.stringify(this.notes), this.masterPassword);
        return new Promise((resolve) => {
            chrome.storage.local.set({ [STORAGE_KEY]: { encrypted: true, data: encrypted } }, () => {
                this.showToast('Changes saved securely', 'success');
                resolve();
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
        this.applyTheme();
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
                const contentMatch = note.content && note.content.toLowerCase().includes(query);
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
        
        // Encrypt content if secure
        let secureContent = null;
        let secureHash = null;
        let displayContent = noteData.content;
        
        if (noteData.isSecure && noteData.password) {
            secureContent = await encryptData(noteData.content, noteData.password);
            const hashResult = await hashPassword(noteData.password);
            secureHash = hashResult.hash;
            secureSalt = hashResult.salt;
            displayContent = '[SECURED]';
        }

        const newNote = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
            title: noteData.title,
            content: displayContent,
            tags: noteData.tags || [],
            isPinned: noteData.isPinned || false,
            isSecure: noteData.isSecure || false,
            secureHash: secureHash,
            secureSalt: secureSalt || null,
            secureContent: secureContent,
            allowMasterAccess: noteData.allowMasterAccess !== false, // Default true
            allowMasterReset: noteData.allowMasterReset !== false, // Default true
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        notes.push(newNote);
        this.notes[extId] = notes;
        
        if (this.masterPassword) {
            await this.encryptAndSaveNotes();
        } else {
            await this.saveNotes();
        }
        
        return newNote;
    }

    async updateNote(extId, noteId, updates) {
        const notes = this.getExtensionNotes(extId);
        const noteIndex = notes.findIndex(n => n.id === noteId);
        
        if (noteIndex === -1) return null;

        const note = notes[noteIndex];
        const isSecureChanging = updates.isSecure !== undefined && updates.isSecure !== note.isSecure;
        
        // Handle security changes
        if (isSecureChanging) {
            if (updates.isSecure && !note.isSecure) {
                // Converting to secure - encrypt content
                if (updates.password) {
                    updates.secureContent = await encryptData(updates.content, updates.password);
                    const hashResult = await hashPassword(updates.password);
                    updates.secureHash = hashResult.hash;
                    updates.secureSalt = hashResult.salt;
                    updates.content = '[SECURED]';
                }
            } else if (!updates.isSecure && note.isSecure) {
                // Converting from secure - decrypt if we have password
                if (updates.password) {
                    const decrypted = await this.decryptNoteContent(note, updates.password);
                    if (decrypted) {
                        updates.content = decrypted;
                        updates.secureContent = null;
                        updates.secureHash = null;
                        updates.secureSalt = null;
                    } else {
                        this.showToast('Incorrect password - cannot remove security', 'error');
                        return null;
                    }
                }
            }
        } else if (note.isSecure && updates.content && updates.password) {
            // Updating secure note content
            updates.secureContent = await encryptData(updates.content, updates.password);
        }

        // Handle master password permission updates
        if (updates.allowMasterAccess !== undefined) {
            note.allowMasterAccess = updates.allowMasterAccess;
        }
        if (updates.allowMasterReset !== undefined) {
            note.allowMasterReset = updates.allowMasterReset;
        }

        notes[noteIndex] = {
            ...note,
            ...updates,
            updatedAt: Date.now()
        };

        this.notes[extId] = notes;
        
        if (this.masterPassword) {
            await this.encryptAndSaveNotes();
        } else {
            await this.saveNotes();
        }
        
        return notes[noteIndex];
    }

    async deleteNote(extId, noteId) {
        const notes = this.getExtensionNotes(extId);
        const filtered = notes.filter(n => n.id !== noteId);
        
        if (filtered.length === notes.length) return false;

        this.notes[extId] = filtered;
        if (filtered.length === 0) {
            delete this.notes[extId];
        }
        
        if (this.masterPassword) {
            await this.encryptAndSaveNotes();
        } else {
            await this.saveNotes();
        }
        
        return true;
    }

    async togglePin(extId, noteId) {
        const notes = this.getExtensionNotes(extId);
        const note = notes.find(n => n.id === noteId);
        if (note) {
            note.isPinned = !note.isPinned;
            note.updatedAt = Date.now();
            
            if (this.masterPassword) {
                await this.encryptAndSaveNotes();
            } else {
                await this.saveNotes();
            }
            
            return note.isPinned;
        }
        return null;
    }

    async decryptNoteContent(note, password, useMaster = false) {
        if (!note.isSecure || !note.secureContent) return note.content;
        
        // Try direct password first
        if (password) {
            const isValid = await verifyPassword(note.secureHash, note.secureSalt, password);
            if (isValid) {
                return await decryptData(note.secureContent, password);
            }
        }
        
        // Try master password if allowed
        if (useMaster && this.masterPassword && note.allowMasterAccess) {
            return await decryptData(note.secureContent, this.masterPassword);
        }
        
        return null;
    }

    async resetNotePassword(extId, noteId, newPassword) {
        const notes = this.getExtensionNotes(extId);
        const note = notes.find(n => n.id === noteId);
        
        if (!note || !note.isSecure) return false;
        
        // Decrypt with master password
        const decrypted = await this.decryptNoteContent(note, null, true);
        if (!decrypted) return false;
        
        // Re-encrypt with new password
        const newSecureContent = await encryptData(decrypted, newPassword);
        const hashResult = await hashPassword(newPassword);
        
        note.secureContent = newSecureContent;
        note.secureHash = hashResult.hash;
        note.secureSalt = hashResult.salt;
        note.updatedAt = Date.now();
        
        if (this.masterPassword) {
            await this.encryptAndSaveNotes();
        } else {
            await this.saveNotes();
        }
        
        return true;
    }

    unlockSecureNote(noteId, decryptedContent) {
        this.unlockedSecureNotes.set(noteId, decryptedContent);
    }

    isNoteUnlocked(noteId) {
        return this.unlockedSecureNotes.has(noteId);
    }

    getUnlockedContent(noteId) {
        return this.unlockedSecureNotes.get(noteId);
    }

    // ============================================
    // EXPORT/IMPORT WITH MASTER PASSWORD
    // ============================================

    async exportNotes() {
        if (!this.masterPassword) {
            const setup = await this.showConfirm(
                'Export Security',
                'To export notes securely, you need to set up a Master Password first. This protects your exported data. Would you like to set one up now?'
            );
            if (setup) {
                this.openMasterPasswordModal(() => this.exportNotes());
                return;
            } else {
                // Allow unencrypted export with warning
                const confirmUnsafe = await this.showConfirm(
                    'Warning: Unencrypted Export',
                    'Exporting without a Master Password will expose all your notes and passwords in plain text. Are you sure?'
                );
                if (!confirmUnsafe) return;
            }
        }

        const exportData = {
            version: 3,
            exportedAt: new Date().toISOString(),
            encrypted: !!this.masterPassword,
            notes: null,
            stats: {
                totalExtensions: Object.keys(this.notes).length,
                totalNotes: Object.values(this.notes).reduce((sum, arr) => sum + (arr ? arr.length : 0), 0)
            }
        };

        if (this.masterPassword) {
            // Encrypt entire export with master password
            const jsonStr = JSON.stringify(this.notes);
            exportData.notes = await encryptData(jsonStr, this.masterPassword);
        } else {
            exportData.notes = this.notes;
        }

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `modcore-notes-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showToast(this.masterPassword ? 'Notes exported securely' : 'Notes exported (unencrypted)', 'success');
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
                    let needsDecryption = false;

                    if (data.encrypted) {
                        needsDecryption = true;
                        // Need master password to decrypt
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
                        
                        // Set this as master password if not already set
                        if (!this.hasMasterPassword()) {
                            await this.setMasterPassword(password);
                        }
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

                    if (this.masterPassword) {
                        await this.encryptAndSaveNotes();
                    } else {
                        await this.saveNotes();
                    }
                    
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
                    preview = this.highlightText(note.title, lowerQuery);
                }

                if (options.content && note.content && !note.isSecure && note.content.toLowerCase().includes(lowerQuery)) {
                    match = true;
                    matchType.push('content');
                    if (!preview) {
                        const idx = note.content.toLowerCase().indexOf(lowerQuery);
                        const start = Math.max(0, idx - 50);
                        const end = Math.min(note.content.length, idx + query.length + 50);
                        preview = '...' + note.content.slice(start, end) + '...';
                        preview = this.highlightText(preview, lowerQuery);
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

    highlightText(text, query) {
        if (!text || !query) return text;
        const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${safeQuery})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
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
        
        const themeIcon = document.getElementById('themeIcon');
        if (themeIcon) {
            themeIcon.src = isDark ? ICONS.sun : ICONS.moon;
            themeIcon.alt = isDark ? 'Light mode' : 'Dark mode';
        }
    }

    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const iconImg = document.createElement('img');
        iconImg.className = 'toast-icon';
        iconImg.alt = '';
        iconImg.src = ICONS[type === 'success' ? 'check' : type === 'error' ? 'warning' : 'info'];
        
        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        
        toast.appendChild(iconImg);
        toast.appendChild(messageSpan);
        
        container.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, duration);
    }

    showConfirm(title, message) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmModal');
            if (!modal) {
                resolve(false);
                return;
            }
            
            const titleEl = document.getElementById('confirmTitle');
            const messageEl = document.getElementById('confirmMessage');
            const confirmBtn = document.getElementById('confirmAction');
            const cancelBtn = document.getElementById('confirmCancel');

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
            // Create a simple prompt modal
            const modal = document.createElement('div');
            modal.className = 'modal-overlay open';
            modal.innerHTML = `
                <div class="modal-content unlock-modal">
                    <h2>${escapeHtml(message)}</h2>
                    <div class="form-group">
                        <input type="password" id="promptPassword" placeholder="Enter password..." autofocus>
                    </div>
                    <div class="modal-footer">
                        <button class="modcore-btn modcore-btn-text" id="promptCancel">Cancel</button>
                        <button class="modcore-btn modcore-btn-primary" id="promptConfirm">Confirm</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            const input = modal.querySelector('#promptPassword');
            const confirmBtn = modal.querySelector('#promptConfirm');
            const cancelBtn = modal.querySelector('#promptCancel');
            
            const cleanup = () => {
                if (modal.parentNode) modal.remove();
            };
            
            confirmBtn.onclick = () => {
                cleanup();
                resolve(input.value);
            };
            
            cancelBtn.onclick = () => {
                cleanup();
                resolve(null);
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
    // MASTER PASSWORD MODAL
    // ============================================

    openMasterPasswordModal(onSuccess = null) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay open';
        modal.id = 'masterPasswordModal';
        
        const hasExisting = this.hasMasterPassword();
        
        modal.innerHTML = `
            <div class="modal-content note-editor">
                <div class="modal-header">
                    <h2>${hasExisting ? 'Enter Master Password' : 'Set Up Master Password'}</h2>
                    <button class="close-btn" id="closeMasterModal">
                        <img src="${ICONS.close}" alt="Close">
                    </button>
                </div>
                <div class="modal-body">
                    ${!hasExisting ? `
                        <div class="security-banner">
                            <img src="${ICONS.shield}" alt="Security">
                            <div>
                                <strong>Protect Your Notes</strong>
                                <p>A Master Password encrypts all your notes and secures exports. You can also use it to access notes when you forget specific passwords.</p>
                            </div>
                        </div>
                    ` : ''}
                    <div class="form-group">
                        <label for="masterPassInput">${hasExisting ? 'Master Password' : 'Create Master Password'}</label>
                        <input type="password" id="masterPassInput" placeholder="${hasExisting ? 'Enter password...' : 'Create a strong password...'}" minlength="6">
                    </div>
                    ${!hasExisting ? `
                        <div class="form-group">
                            <label for="masterPassConfirm">Confirm Master Password</label>
                            <input type="password" id="masterPassConfirm" placeholder="Confirm password...">
                        </div>
                    ` : ''}
                </div>
                <div class="modal-footer">
                    <button class="modcore-btn modcore-btn-text" id="cancelMaster">Cancel</button>
                    <button class="modcore-btn modcore-btn-primary" id="saveMaster">${hasExisting ? 'Unlock' : 'Set Password'}</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const closeBtn = modal.querySelector('#closeMasterModal');
        const cancelBtn = modal.querySelector('#cancelMaster');
        const saveBtn = modal.querySelector('#saveMaster');
        const passInput = modal.querySelector('#masterPassInput');
        const confirmInput = modal.querySelector('#masterPassConfirm');
        
        const cleanup = () => {
            if (modal.parentNode) modal.remove();
        };
        
        closeBtn.onclick = cleanup;
        cancelBtn.onclick = cleanup;
        
        saveBtn.onclick = async () => {
            const password = passInput.value;
            
            if (!password || password.length < 6) {
                this.showToast('Password must be at least 6 characters', 'error');
                return;
            }
            
            if (!hasExisting) {
                if (password !== confirmInput.value) {
                    this.showToast('Passwords do not match', 'error');
                    return;
                }
                await this.setMasterPassword(password);
                this.showToast('Master Password set successfully', 'success');
                cleanup();
                if (onSuccess) onSuccess();
                this.render();
            } else {
                const isValid = await this.authenticateMasterPassword(password);
                if (isValid) {
                    // Decrypt notes
                    const decrypted = await this.decryptNotesWithMaster(password);
                    if (decrypted) {
                        this.showToast('Master Password accepted', 'success');
                        cleanup();
                        if (onSuccess) onSuccess();
                        this.render();
                    } else {
                        this.showToast('Failed to decrypt notes', 'error');
                    }
                } else {
                    this.showToast('Incorrect Master Password', 'error');
                }
            }
        };
        
        passInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                if (!hasExisting && confirmInput) {
                    confirmInput.focus();
                } else {
                    saveBtn.click();
                }
            }
        };
        
        if (confirmInput) {
            confirmInput.onkeydown = (e) => {
                if (e.key === 'Enter') saveBtn.click();
            };
        }
        
        modal.onclick = (e) => {
            if (e.target === modal) cleanup();
        };
        
        passInput.focus();
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    setupEventListeners() {
        // Extension search
        const extSearch = document.getElementById('extensionSearch');
        const clearExtSearch = document.getElementById('clearExtSearch');
        
        if (extSearch) {
            extSearch.addEventListener('input', (e) => {
                this.searchQuery = e.target.value;
                this.renderSidebar();
            });
        }

        if (clearExtSearch) {
            clearExtSearch.addEventListener('click', () => {
                if (extSearch) {
                    extSearch.value = '';
                    this.searchQuery = '';
                    this.renderSidebar();
                    extSearch.focus();
                }
            });
        }

        // Filter chips
        document.querySelectorAll('.chip[data-filter]').forEach(chip => {
            chip.addEventListener('click', () => {
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
        });

        // Clear filters
        const clearFiltersBtn = document.getElementById('clearFiltersBtn');
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => {
                this.activeFilters.clear();
                this.activeFilters.add('all');
                this.searchQuery = '';
                if (extSearch) extSearch.value = '';
                this.updateFilterChips();
                this.renderSidebar();
            });
        }

        // Notes search
        const notesSearch = document.getElementById('notesSearch');
        const clearNotesSearch = document.getElementById('clearNotesSearch');
        
        if (notesSearch) {
            notesSearch.addEventListener('input', (e) => {
                this.notesSearchQuery = e.target.value;
                this.renderNotes();
            });
        }

        if (clearNotesSearch) {
            clearNotesSearch.addEventListener('click', () => {
                if (notesSearch) {
                    notesSearch.value = '';
                    this.notesSearchQuery = '';
                    this.renderNotes();
                    notesSearch.focus();
                }
            });
        }

        // New note
        const newNoteBtn = document.getElementById('newNoteBtn');
        if (newNoteBtn) {
            newNoteBtn.addEventListener('click', () => this.openNoteEditor());
        }
        
        const createFirstNoteBtn = document.getElementById('createFirstNoteBtn');
        if (createFirstNoteBtn) {
            createFirstNoteBtn.addEventListener('click', () => this.openNoteEditor());
        }

        // Manage extension
        const manageExtBtn = document.getElementById('manageExtBtn');
        if (manageExtBtn) {
            manageExtBtn.addEventListener('click', () => {
                const ext = this.getSelectedExtension();
                if (ext) {
                    chrome.tabs.create({ url: `chrome://extensions/?id=${ext.id}` });
                }
            });
        }

        // Export/Import
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportNotes());
        }
        
        const importBtn = document.getElementById('importBtn');
        const importFileInput = document.getElementById('importFileInput');
        
        if (importBtn && importFileInput) {
            importBtn.addEventListener('click', () => {
                importFileInput.click();
            });
            
            importFileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (file) {
                    await this.importNotes(file);
                    this.render();
                    e.target.value = '';
                }
            });
        }

        // Master password button (add to header)
        const headerActions = document.querySelector('.header-actions');
        if (headerActions && !document.getElementById('masterPassBtn')) {
            const masterBtn = document.createElement('button');
            masterBtn.id = 'masterPassBtn';
            masterBtn.className = 'icon-btn';
            masterBtn.setAttribute('aria-label', 'Master Password');
            masterBtn.innerHTML = `<img src="${ICONS.shield}" alt="Master Password">`;
            masterBtn.addEventListener('click', () => this.openMasterPasswordModal());
            headerActions.insertBefore(masterBtn, headerActions.firstChild);
        }

        // Keyboard shortcuts modal
        const keyboardShortcutsBtn = document.getElementById('keyboardShortcutsBtn');
        const closeShortcuts = document.getElementById('closeShortcuts');
        const shortcutsModal = document.getElementById('shortcutsModal');
        
        if (keyboardShortcutsBtn && shortcutsModal) {
            keyboardShortcutsBtn.addEventListener('click', () => {
                shortcutsModal.classList.add('open');
            });
        }
        
        if (closeShortcuts && shortcutsModal) {
            closeShortcuts.addEventListener('click', () => {
                shortcutsModal.classList.remove('open');
            });
        }

        // Global search
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                this.openGlobalSearch();
            }
        });

        const closeGlobalSearch = document.getElementById('closeGlobalSearch');
        const globalSearchModal = document.getElementById('globalSearchModal');
        
        if (closeGlobalSearch && globalSearchModal) {
            closeGlobalSearch.addEventListener('click', () => {
                globalSearchModal.classList.remove('open');
            });
        }

        // Back button
        const backBtn = document.getElementById('backBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                window.history.back();
            });
        }

        // Modal close on backdrop
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    if (modal.id === 'unlockModal') {
                        const unlockInput = document.getElementById('unlockPassword');
                        if (unlockInput && document.activeElement === unlockInput) {
                            return;
                        }
                    }
                    modal.classList.remove('open');
                }
            });
        });

        // Keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.target.matches('input, textarea')) return;

            switch(e.key) {
                case '?':
                    e.preventDefault();
                    const shortcutsModal = document.getElementById('shortcutsModal');
                    if (shortcutsModal) shortcutsModal.classList.add('open');
                    break;
                case 'Escape':
                    document.querySelectorAll('.modal-overlay.open').forEach(m => {
                        if (m.id !== 'unlockModal') m.classList.remove('open');
                    });
                    break;
                case 'k':
                case 'K':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        const extSearch = document.getElementById('extensionSearch');
                        if (extSearch) extSearch.focus();
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
    // RENDERING (Fixed animation and empty states)
    // ============================================

    render() {
        this.renderSidebar();
        this.renderMainContent();
    }

    renderSidebar() {
        const list = document.getElementById('extensionsList');
        const empty = document.getElementById('emptySidebar');
        const filtered = this.getFilteredExtensions();

        if (!list || !empty) return;

        if (filtered.length === 0) {
            list.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }

        list.style.display = 'block';
        empty.style.display = 'none';
        
        // Clear and rebuild list (preserve animations by checking if items exist)
        const existingItems = new Set();
        list.querySelectorAll('.ext-item').forEach(item => {
            existingItems.add(item.dataset.extId);
        });
        
        const newIds = new Set(filtered.map(ext => ext.id));
        
        // Remove items that shouldn't be there
        list.querySelectorAll('.ext-item').forEach(item => {
            if (!newIds.has(item.dataset.extId)) {
                item.remove();
            }
        });
        
        // Add or update items
        filtered.forEach((ext) => {
            let item = list.querySelector(`.ext-item[data-ext-id="${ext.id}"]`);
            const extNotes = this.getExtensionNotes(ext.id);
            const hasNotes = extNotes.length > 0;
            const hasPinned = extNotes.some(n => n.isPinned);
            
            if (!item) {
                item = document.createElement('div');
                item.className = `ext-item ${ext.id === this.selectedExtensionId ? 'active' : ''} ${hasNotes ? 'has-notes' : ''} ${hasPinned ? 'has-pinned' : ''}`;
                item.dataset.extId = ext.id;
                item.setAttribute('role', 'listitem');
                item.setAttribute('tabindex', '0');
                item.setAttribute('aria-selected', ext.id === this.selectedExtensionId);
                
                item.innerHTML = `
                    <img src="${escapeHtml(ext.icons?.[0]?.url || ICONS.default)}" alt="" class="ext-icon-small">
                    <div class="ext-item-info">
                        <div class="ext-item-name"></div>
                        <div class="ext-item-meta"></div>
                    </div>
                `;
                
                item.addEventListener('click', () => this.selectExtension(ext.id));
                item.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') this.selectExtension(ext.id);
                });
                
                list.appendChild(item);
            }
            
            // Update content
            item.className = `ext-item ${ext.id === this.selectedExtensionId ? 'active' : ''} ${hasNotes ? 'has-notes' : ''} ${hasPinned ? 'has-pinned' : ''}`;
            item.setAttribute('aria-selected', ext.id === this.selectedExtensionId);
            
            const nameEl = item.querySelector('.ext-item-name');
            const metaEl = item.querySelector('.ext-item-meta');
            const iconEl = item.querySelector('.ext-icon-small');
            
            nameEl.textContent = ext.name;
            metaEl.textContent = hasNotes ? `${extNotes.length} note${extNotes.length !== 1 ? 's' : ''}` : 'No notes';
            iconEl.src = ext.icons?.[0]?.url || ICONS.default;
        });
    }

    renderMainContent() {
        const welcome = document.getElementById('welcomeState');
        const view = document.getElementById('extensionNotesView');

        if (!welcome || !view) return;

        if (!this.selectedExtensionId) {
            welcome.style.display = 'flex';
            view.style.display = 'none';
            return;
        }

        welcome.style.display = 'none';
        view.style.display = 'block';

        const ext = this.getSelectedExtension();
        if (!ext) return;

        const selectedExtIcon = document.getElementById('selectedExtIcon');
        const selectedExtName = document.getElementById('selectedExtName');
        const extNoteCount = document.getElementById('extNoteCount');
        
        if (selectedExtIcon) selectedExtIcon.src = ext.icons?.[0]?.url || ICONS.default;
        if (selectedExtIcon) selectedExtIcon.alt = ext.name;
        if (selectedExtName) selectedExtName.textContent = ext.name;

        const notes = this.getExtensionNotes(ext.id);
        if (extNoteCount) {
            extNoteCount.textContent = `${notes.length} note${notes.length !== 1 ? 's' : ''}`;
        }

        this.renderTagsFilter();
        this.renderNotes();
    }

    renderTagsFilter() {
        const container = document.getElementById('tagsFilter');
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

        container.innerHTML = '';
        
        Array.from(allTags).sort().forEach(tag => {
            const btn = document.createElement('button');
            btn.className = `tag-filter ${this.activeTagFilters.has(tag) ? 'active' : ''}`;
            
            const tagText = document.createElement('span');
            tagText.textContent = tag;
            btn.appendChild(tagText);
            
            if (this.activeTagFilters.has(tag)) {
                const removeSpan = document.createElement('span');
                removeSpan.className = 'remove-tag';
                removeSpan.textContent = '×';
                btn.appendChild(removeSpan);
            }
            
            btn.addEventListener('click', () => {
                if (this.activeTagFilters.has(tag)) {
                    this.activeTagFilters.delete(tag);
                } else {
                    this.activeTagFilters.add(tag);
                }
                this.renderTagsFilter();
                this.renderNotes();
            });
            
            container.appendChild(btn);
        });
    }

    renderNotes() {
        const container = document.getElementById('notesContainer');
        const empty = document.getElementById('emptyNotes');
        const notes = this.getFilteredNotes(this.selectedExtensionId);

        if (!container || !empty) return;

        if (notes.length === 0) {
            container.style.display = 'none';
            empty.style.display = 'flex';
            
            // Update empty state message based on search
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
        empty.style.display = 'none';
        
        // Clear container
        container.innerHTML = '';

        notes.forEach((note, index) => {
            const card = document.createElement('div');
            card.className = `note-card ${note.isPinned ? 'pinned' : ''} ${note.isSecure ? 'secure' : ''}`;
            
            const isUnlocked = !note.isSecure || this.isNoteUnlocked(note.id);
            let displayContent = note.content;
            
            if (note.isSecure && !isUnlocked) {
                displayContent = '🔒 This note is secured. Click to unlock.';
            } else if (note.isSecure && isUnlocked) {
                displayContent = this.getUnlockedContent(note.id) || note.content;
            }

            // Build card content safely
            const header = document.createElement('div');
            header.className = 'note-header';
            
            const titleRow = document.createElement('div');
            titleRow.className = 'note-title-row';
            
            const title = document.createElement('h3');
            title.className = 'note-title';
            title.textContent = note.title;
            titleRow.appendChild(title);
            
            const badges = document.createElement('div');
            badges.className = 'note-badges';
            
            if (note.isPinned) {
                const pinBadge = document.createElement('span');
                pinBadge.className = 'badge pinned';
                pinBadge.title = 'Pinned';
                pinBadge.textContent = '📌';
                badges.appendChild(pinBadge);
            }
            
            if (note.isSecure) {
                const secureBadge = document.createElement('span');
                secureBadge.className = 'badge secure';
                secureBadge.title = 'Secure';
                secureBadge.textContent = '🔒';
                badges.appendChild(secureBadge);
            }
            
            if (badges.children.length > 0) {
                titleRow.appendChild(badges);
            }
            
            header.appendChild(titleRow);
            
            // Actions
            const actions = document.createElement('div');
            actions.className = 'note-actions';
            
            const pinBtn = document.createElement('button');
            pinBtn.className = 'note-action-btn pin-btn';
            pinBtn.title = note.isPinned ? 'Unpin' : 'Pin';
            pinBtn.innerHTML = `<img src="${note.isPinned ? ICONS.unpin : ICONS.pin}" alt="">`;
            pinBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.togglePin(this.selectedExtensionId, note.id);
                this.renderNotes();
            });
            
            const editBtn = document.createElement('button');
            editBtn.className = 'note-action-btn edit-btn';
            editBtn.title = 'Edit';
            editBtn.innerHTML = `<img src="${ICONS.edit}" alt="">`;
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (note.isSecure && !this.isNoteUnlocked(note.id)) {
                    this.showUnlockModal(note, () => this.openNoteEditor(note));
                } else {
                    this.openNoteEditor(note);
                }
            });
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'note-action-btn delete-btn';
            deleteBtn.title = 'Delete';
            deleteBtn.innerHTML = `<img src="${ICONS.trash}" alt="">`;
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const confirmed = await this.showConfirm('Delete Note', 'Are you sure you want to delete this note?');
                if (confirmed) {
                    card.classList.add('deleting');
                    setTimeout(async () => {
                        await this.deleteNote(this.selectedExtensionId, note.id);
                        this.render();
                    }, 300);
                }
            });
            
            actions.appendChild(pinBtn);
            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);
            header.appendChild(actions);
            
            // Meta
            const meta = document.createElement('div');
            meta.className = 'note-meta';
            const date = note.updatedAt ? new Date(note.updatedAt).toLocaleDateString() : 'Unknown date';
            const tags = note.tags && note.tags.length ? note.tags.map(t => `#${t}`).join(' ') : 'No tags';
            meta.textContent = `${date} · ${tags}`;
            
            // Preview
            const preview = document.createElement('div');
            preview.className = 'note-preview';
            preview.textContent = displayContent;
            
            card.appendChild(header);
            card.appendChild(meta);
            card.appendChild(preview);
            
            // Tags
            if (note.tags && note.tags.length) {
                const tagsContainer = document.createElement('div');
                tagsContainer.className = 'note-tags';
                
                note.tags.forEach(tag => {
                    const tagSpan = document.createElement('span');
                    tagSpan.className = 'note-tag';
                    tagSpan.textContent = tag;
                    tagsContainer.appendChild(tagSpan);
                });
                
                card.appendChild(tagsContainer);
            }
            
            // Card click
            card.addEventListener('click', () => {
                if (note.isSecure && !this.isNoteUnlocked(note.id)) {
                    this.showUnlockModal(note, () => this.showNoteViewer(note));
                } else {
                    this.showNoteViewer(note);
                }
            });
            
            container.appendChild(card);
        });
    }

    // ============================================
    // MODALS
    // ============================================

    selectExtension(id) {
        this.selectedExtensionId = id;
        this.notesSearchQuery = '';
        this.activeTagFilters.clear();
        const notesSearch = document.getElementById('notesSearch');
        if (notesSearch) notesSearch.value = '';
        this.render();
    }

    openNoteEditor(note = null) {
        this.editingNote = note;
        const modal = document.getElementById('noteEditorModal');
        if (!modal) return;
        
        const title = document.getElementById('editorTitle');
        const titleInput = document.getElementById('noteTitle');
        const contentInput = document.getElementById('noteContent');
        const pinInput = document.getElementById('notePinned');
        const secureInput = document.getElementById('noteSecure');
        const securityPanel = document.getElementById('securityPanel');
        const allowMasterAccess = document.getElementById('allowMasterAccess');
        const allowMasterReset = document.getElementById('allowMasterReset');

        if (title) title.textContent = note ? 'Edit Note' : 'New Note';
        if (titleInput) titleInput.value = note?.title || '';
        if (contentInput) contentInput.value = note?.content || '';
        if (pinInput) pinInput.checked = note?.isPinned || false;
        if (secureInput) secureInput.checked = note?.isSecure || false;
        if (securityPanel) securityPanel.style.display = note?.isSecure ? 'block' : 'none';
        
        // Master password permissions
        if (allowMasterAccess) allowMasterAccess.checked = note ? (note.allowMasterAccess !== false) : true;
        if (allowMasterReset) allowMasterReset.checked = note ? (note.allowMasterReset !== false) : true;

        this.editorTags = note?.tags ? [...note.tags] : [];
        this.renderEditorTags();

        const securityPassword = document.getElementById('securityPassword');
        const confirmPassword = document.getElementById('confirmPassword');
        if (securityPassword) securityPassword.value = '';
        if (confirmPassword) confirmPassword.value = '';

        this.renderTagSuggestions();

        modal.classList.add('open');
        if (titleInput) titleInput.focus();

        this.setupTagInput();

        // Security toggle
        if (secureInput) {
            secureInput.onchange = () => {
                if (securityPanel) securityPanel.style.display = secureInput.checked ? 'block' : 'none';
            };
        }

        // Save handler
        const saveBtn = document.getElementById('saveNote');
        const cancelBtn = document.getElementById('cancelNote');
        const closeEditor = document.getElementById('closeEditor');

        if (saveBtn) {
            saveBtn.onclick = async () => {
                if (!titleInput || !titleInput.value.trim()) {
                    this.showToast('Title is required', 'error');
                    if (titleInput) titleInput.focus();
                    return;
                }

                const isSecure = secureInput && secureInput.checked;
                let password = null;
                
                if (isSecure) {
                    const pass = securityPassword ? securityPassword.value : '';
                    const confirm = confirmPassword ? confirmPassword.value : '';
                    
                    if (!note?.isSecure) { // New secure note or converting to secure
                        if (pass.length < 4) {
                            this.showToast('Password must be at least 4 characters', 'error');
                            return;
                        }
                        if (pass !== confirm) {
                            this.showToast('Passwords do not match', 'error');
                            return;
                        }
                        password = pass;
                    } else {
                        // Editing existing secure note
                        password = pass;
                    }
                }

                const noteData = {
                    title: titleInput.value.trim(),
                    content: contentInput ? contentInput.value : '',
                    tags: this.editorTags,
                    isPinned: pinInput ? pinInput.checked : false,
                    isSecure: isSecure,
                    password: password,
                    allowMasterAccess: allowMasterAccess ? allowMasterAccess.checked : true,
                    allowMasterReset: allowMasterReset ? allowMasterReset.checked : true
                };

                if (note) {
                    const updated = await this.updateNote(this.selectedExtensionId, note.id, noteData);
                    if (updated && note.isSecure && noteData.password) {
                        this.unlockSecureNote(note.id, noteData.content);
                    }
                } else {
                    const newNote = await this.createNote(this.selectedExtensionId, noteData);
                    if (newNote && newNote.isSecure) {
                        this.unlockSecureNote(newNote.id, noteData.content);
                    }
                }

                modal.classList.remove('open');
                this.render();
            };
        }

        if (cancelBtn) {
            cancelBtn.onclick = () => {
                modal.classList.remove('open');
            };
        }

        if (closeEditor) {
            closeEditor.onclick = () => {
                modal.classList.remove('open');
            };
        }
    }

    setupTagInput() {
        const input = document.getElementById('noteTags');
        const datalist = document.getElementById('existingTags');
        
        if (!input || !datalist) return;
        
        const allTags = this.getAllTags();
        datalist.innerHTML = '';
        allTags.forEach(tag => {
            const option = document.createElement('option');
            option.value = tag;
            datalist.appendChild(option);
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
        const container = document.getElementById('editorTagsList');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.editorTags.forEach((tag, i) => {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'tag-item';
            tagSpan.textContent = tag;
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'tag-remove';
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', () => {
                this.editorTags.splice(i, 1);
                this.renderEditorTags();
                this.renderTagSuggestions();
            });
            
            tagSpan.appendChild(removeBtn);
            container.appendChild(tagSpan);
        });
    }

    renderTagSuggestions() {
        const container = document.getElementById('tagSuggestions');
        if (!container) return;
        
        const suggestions = this.getRecommendedTags(this.editorTags);
        
        container.innerHTML = '';
        suggestions.forEach(tag => {
            const btn = document.createElement('button');
            btn.className = 'tag-suggestion';
            btn.textContent = `+ ${tag}`;
            btn.addEventListener('click', () => {
                this.editorTags.push(tag);
                this.renderEditorTags();
                this.renderTagSuggestions();
            });
            container.appendChild(btn);
        });
    }

    showNoteViewer(note) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay open';
        
        const isUnlocked = this.isNoteUnlocked(note.id);
        let displayContent = note.content;
        
        if (note.isSecure && isUnlocked) {
            displayContent = this.getUnlockedContent(note.id) || note.content;
        }
        
        const contentHtml = escapeHtml(displayContent).replace(/\n/g, '<br>');
        
        modal.innerHTML = `
            <div class="modal-content note-viewer">
                <div class="modal-header">
                    <h2>${escapeHtml(note.title)}</h2>
                    <button class="close-btn" id="viewerClose">
                        <img src="${ICONS.close}" alt="Close">
                    </button>
                </div>
                <div class="modal-body">
                    <div class="note-view-meta">
                        ${note.isPinned ? '📌 Pinned · ' : ''}
                        ${note.updatedAt ? new Date(note.updatedAt).toLocaleString() : ''}
                        ${note.tags && note.tags.length ? ' · ' + note.tags.map(t => '#' + escapeHtml(t)).join(' ') : ''}
                    </div>
                    <div class="note-view-content">${contentHtml}</div>
                </div>
                <div class="modal-footer">
                    <button class="modcore-btn modcore-btn-text" id="viewerCloseBtn">Close</button>
                    <button class="modcore-btn modcore-btn-primary" id="viewerEditBtn">Edit</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const closeModal = () => {
            if (modal.parentNode) modal.remove();
        };
        
        modal.querySelector('#viewerClose').onclick = closeModal;
        modal.querySelector('#viewerCloseBtn').onclick = closeModal;
        
        modal.querySelector('#viewerEditBtn').onclick = () => {
            closeModal();
            this.openNoteEditor(note);
        };

        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };
    }

    showUnlockModal(note, onUnlock) {
        const modal = document.getElementById('unlockModal');
        if (!modal) return;
        
        const input = document.getElementById('unlockPassword');
        const confirmBtn = document.getElementById('confirmUnlock');
        const cancelBtn = document.getElementById('cancelUnlock');

        if (input) input.value = '';
        modal.classList.add('open');
        if (input) input.focus();

        const doUnlock = async () => {
            const password = input ? input.value : '';
            if (!password) return;

            const decrypted = await this.decryptNoteContent(note, password);
            if (decrypted) {
                this.unlockSecureNote(note.id, decrypted);
                modal.classList.remove('open');
                onUnlock();
            } else {
                // Try master password if allowed
                if (note.allowMasterAccess && this.masterPassword) {
                    const masterDecrypted = await this.decryptNoteContent(note, null, true);
                    if (masterDecrypted) {
                        this.unlockSecureNote(note.id, masterDecrypted);
                        modal.classList.remove('open');
                        onUnlock();
                        return;
                    }
                }
                
                this.showToast('Incorrect password', 'error');
                if (input) {
                    input.value = '';
                    input.focus();
                }
            }
        };

        if (confirmBtn) confirmBtn.onclick = doUnlock;
        if (cancelBtn) cancelBtn.onclick = () => modal.classList.remove('open');

        if (input) {
            input.onkeydown = (e) => {
                if (e.key === 'Enter') doUnlock();
            };
        }
    }

    openGlobalSearch() {
        const modal = document.getElementById('globalSearchModal');
        const input = document.getElementById('globalSearchInput');
        const results = document.getElementById('searchResults');

        if (!modal) return;
        
        modal.classList.add('open');
        if (input) {
            input.value = '';
            input.focus();
        }
        if (results) {
            results.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px;">Start typing to search across all notes...</p>';
        }

        const doSearch = () => {
            if (!input || !results) return;
            
            const query = input.value.trim();
            const searchTitles = document.getElementById('searchTitles');
            const searchContent = document.getElementById('searchContent');
            const searchTags = document.getElementById('searchTags');

            if (!query) {
                results.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px;">Start typing to search across all notes...</p>';
                return;
            }

            const searchResults = this.searchAllNotes(query, {
                titles: searchTitles ? searchTitles.checked : true,
                content: searchContent ? searchContent.checked : true,
                tags: searchTags ? searchTags.checked : false
            });

            if (searchResults.length === 0) {
                results.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px;">No results found</p>';
                return;
            }

            results.innerHTML = '';
            searchResults.forEach(result => {
                const item = document.createElement('div');
                item.className = 'search-result-item';
                item.dataset.extId = result.extension.id;
                item.dataset.noteId = result.note.id;
                
                const icon = document.createElement('img');
                icon.src = result.extension.icons?.[0]?.url || ICONS.default;
                icon.alt = '';
                icon.className = 'search-result-icon';
                
                const content = document.createElement('div');
                content.className = 'search-result-content';
                
                const header = document.createElement('div');
                header.className = 'search-result-header';
                
                const title = document.createElement('span');
                title.className = 'search-result-title';
                title.textContent = result.note.title;
                
                const ext = document.createElement('span');
                ext.className = 'search-result-ext';
                ext.textContent = result.extension.name;
                
                header.appendChild(title);
                header.appendChild(ext);
                
                const preview = document.createElement('div');
                preview.className = 'search-result-preview';
                preview.innerHTML = result.preview; // Already escaped in searchAllNotes
                
                const meta = document.createElement('div');
                meta.className = 'search-result-meta';
                const date = result.note.updatedAt ? new Date(result.note.updatedAt).toLocaleDateString() : '';
                meta.textContent = `${result.note.isPinned ? '📌 ' : ''}${result.note.isSecure ? '🔒 ' : ''}${date}`;
                
                content.appendChild(header);
                content.appendChild(preview);
                content.appendChild(meta);
                
                item.appendChild(icon);
                item.appendChild(content);
                
                item.onclick = () => {
                    const extId = item.dataset.extId;
                    const noteId = item.dataset.noteId;
                    const note = this.notes[extId]?.find(n => n.id === noteId);
                    
                    modal.classList.remove('open');
                    this.selectExtension(extId);
                    
                    if (note) {
                        setTimeout(() => {
                            if (note.isSecure && !this.isNoteUnlocked(note.id)) {
                                this.showUnlockModal(note, () => this.showNoteViewer(note));
                            } else {
                                this.showNoteViewer(note);
                            }
                        }, 100);
                    }
                };
                
                results.appendChild(item);
            });
        };

        if (input) input.oninput = doSearch;
        document.querySelectorAll('.search-filters input').forEach(cb => {
            cb.onchange = doSearch;
        });
    }
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const app = new NotesState();
    app.init();
});
