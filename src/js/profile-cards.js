// profile-cards.js
// Enhanced Profile Cards module for modcore Extension Manager

// --- Storage Keys & Defaults ---
const PROFILE_STORAGE_KEY = 'modcore_profile';
const EXTENSION_NOTES_STORAGE_KEY = 'modcore_extension_notes';
const GLOBAL_STATS_STORAGE_KEY = 'modcore_global_stats';

const defaultProfile = {
    username: '',
    avatar: '', // local URL or base64
    badges: [],
    stats: {
        extensionsInstalled: 0,
        extensionsEnabled: 0,
        extensionsDisabled: 0,
        profileCreation: null
    }
};

const defaultGlobalStats = {
    firstUse: new Date().toISOString(),
    lastUse: null,
    streak: 0
};

// --- Badge Milestones & Data ---
const BADGES = {
    install_5: { name: 'Apprentice', description: 'Installed 5 extensions.' },
    install_10: { name: 'Initiate', description: 'Installed 10 extensions.' },
    enabled_10: { name: 'Enabler', description: 'Enabled 10 extensions.' },
    disabled_10: { name: 'Restrainer', description: 'Disabled 10 extensions.' },
    first_profile: { name: 'Pioneer', description: 'Created your first profile.' }
};
const ALL_BADGES_COUNT = Object.keys(BADGES).length;

// --- CSS-in-JS for Modern UI & Dark Mode ---
const profileStyles = `
    /* General component styles to avoid global conflicts */
    .modcore-profile-ui,
    .modcore-profile-ui button,
    .modcore-profile-ui input[type="text"],
    .modcore-profile-ui textarea,
    .modcore-profile-ui .modcore-toast {
        font-family: 'modcore-inter-font-custom', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #212529;
        font-size: 14px;
        transition: color 0.3s ease, background-color 0.3s ease;
    }
    .modcore-profile-ui h2, .modcore-profile-ui h4, .modcore-profile-ui h3 {
        font-family: 'modcore-inter-font-custom', sans-serif;
    }
    .modcore-profile-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        object-fit: cover;
        border: none;
        transition: transform 0.2s ease;
    }
    .modcore-profile-icon-container:hover .modcore-profile-avatar {
        transform: scale(1.05);
    }
    .modcore-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 12px;
        padding: 8px 12px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: background-color 0.2s ease, opacity 0.2s ease;
        text-decoration: none;
    }
    .modcore-btn-primary { background-color: #007bff; color: #fff; }
    .modcore-btn-primary:hover { opacity: 0.9; }
    .modcore-btn-secondary { background-color: #e9ecef; color: #212529; }
    .modcore-btn-secondary:hover { background-color: #dee2e6; }
    .modcore-btn-text { background: transparent; color: #6c757d; }
    .modcore-btn-text:hover { color: #212529; }
    .modcore-profile-dropdown hr, .modcore-profile-popup hr, .modcore-modal-content hr {
        border: 0;
        border-top: 1px solid #e9ecef;
        margin: 8px 0;
    }
    .modcore-modal-overlay {
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        background-color: rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
        padding: 20px;
        box-sizing: border-box;
    }
    .modcore-modal-overlay.open {
        opacity: 1;
        pointer-events: auto;
    }
    .modcore-modal-content {
        background: #fff;
        padding: 24px;
        border-radius: 16px;
        max-width: 600px;
        width: 90%;
        box-shadow: 0 8px 30px rgba(0,0,0,0.2);
        transform: translateY(20px);
        opacity: 0;
        transition: transform 0.3s ease, opacity 0.3s ease;
        max-height: 80vh;
        overflow-y: auto;
    }
    .modcore-modal-overlay.open .modcore-modal-content {
        transform: translateY(0);
        opacity: 1;
    }
    .modcore-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
        flex-shrink: 0;
        gap: 15px;
    }
    .modcore-modal-header h2 { margin: 0; font-size: 20px; }
    .modcore-modal-header .modcore-close-btn, .modcore-modal-header .modcore-back-btn { background: none; border: none; cursor: pointer; padding: 0; width: 24px; height: 24px; flex-shrink: 0;}
    .modcore-modal-header .modcore-close-btn img, .modcore-modal-header .modcore-back-btn img { filter: none; transition: filter 0.3s ease; }
    .modcore-modal-header-left {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-grow: 1;
    }
    
    /* Onboarding/Customize Modal Specifics */
    .modcore-profile-popup-content {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }
    .modcore-security-banner {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        background-color: #e6f7ff;
        border: 1px solid #91d5ff;
        border-radius: 12px;
        color: #1f506c;
    }
    .modcore-security-banner img {
        width: 20px;
        height: 20px;
    }
    .modcore-profile-popup .greeting { font-weight: 500; font-size: 16px; margin-bottom: 10px; }
    .modcore-profile-popup form { display: flex; flex-direction: column; gap: 15px; }
    .modcore-profile-popup .form-group { display: flex; flex-direction: column; }
    .modcore-profile-popup label { font-size: 14px; font-weight: 500; margin-bottom: 5px; }
    .modcore-profile-popup input[type="text"] {
        padding: 10px;
        border: 1px solid #ccc;
        border-radius: 12px;
        background: #fff;
        color: #212529;
    }
    .modcore-profile-popup .preview-group { display: flex; align-items: center; gap: 15px; }
    .modcore-profile-popup .preview-avatar { width: 50px; height: 50px; border-radius: 50%; object-fit: cover; border: none; }
    .modcore-profile-popup-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 10px;
    }
    .modcore-profile-popup-actions .modcore-btn:first-child { margin-right: auto; }

    /* Profile Dropdown Specifics */
    .modcore-profile-icon-container {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 10000;
        cursor: pointer;
    }
    .modcore-profile-dropdown {
        position: absolute;
        top: 55px;
        right: 0;
        background: #fff;
        border: 1px solid #eee;
        border-radius: 16px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        display: none;
        opacity: 0;
        transform: translateY(-10px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        min-width: 220px;
        max-width: 280px;
        padding: 15px;
        box-sizing: border-box;
        overflow-y: auto;
    }
    .modcore-profile-dropdown.open {
        display: block;
        opacity: 1;
        transform: translateY(0);
    }
    .modcore-profile-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding-bottom: 10px;
        margin-bottom: 10px;
        border-bottom: 1px solid #e9ecef;
    }
    .modcore-profile-header h4 { margin: 0; font-size: 16px; }
    .modcore-profile-header .modcore-stats-summary { font-size: 12px; color: #6c757d; }
    .modcore-profile-dropdown button, .modcore-profile-dropdown a {
        display: block;
        width: 100%;
        text-align: left;
        padding: 8px 10px;
        margin: 5px 0;
        background: none;
        border: none;
        border-radius: 12px;
        color: #212529;
        transition: background-color 0.2s ease, color 0.2s ease;
    }
    .modcore-profile-dropdown button:hover { background-color: #e9ecef; }
    
    /* Stats and Badges Modals */
    .modcore-stats-list li, .modcore-badges-grid strong { font-weight: 500; }
    .modcore-stats-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 15px;
    }
    .modcore-stats-list li {
        background-color: #f8f9fa;
        padding: 15px;
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        transition: background-color 0.2s ease, transform 0.2s ease;
        text-align: left;
        border: 1px solid #e9ecef;
    }
    .modcore-stats-list li:hover { transform: translateY(-2px); }
    .modcore-stats-list li strong { font-size: 24px; color: #007bff; margin-bottom: 5px; }
    .modcore-stats-list li small { color: #6c757d; }

    .modcore-all-badges-complete {
        text-align: center;
        margin-top: 10px;
        font-weight: 600;
        color: #28a745;
    }
    
    .modcore-badges-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        gap: 20px;
        margin-top: 20px;
    }
    .modcore-badge-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        text-align: center;
        opacity: 0.5;
        transition: opacity 0.3s ease;
    }
    .modcore-badge-card.unlocked { opacity: 1; }
    .modcore-badge-icon {
        width: 60px;
        height: 60px;
        background: #f8f9fa;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        border: 2px solid #ccc;
        transition: transform 0.2s ease;
    }
    .modcore-badge-card.unlocked .modcore-badge-icon:hover { transform: scale(1.1); }
    
    /* Extension Notes Modal */
    .modcore-notes-container {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }
    .modcore-notes-search {
        width: 100%;
        padding: 8px;
        border: 1px solid #ccc;
        border-radius: 12px;
    }
    .modcore-notes-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 10px;
        max-height: 400px;
        overflow-y: auto;
    }
    .modcore-notes-ext-card {
        padding: 15px;
        border-radius: 12px;
        border: 1px solid #e9ecef;
        background: #f8f9fa;
        text-align: center;
        cursor: pointer;
        transition: background-color 0.2s ease, transform 0.2s ease;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
    }
    .modcore-notes-ext-card:hover {
        background-color: #e9ecef;
        transform: translateY(-2px);
    }
    .modcore-notes-ext-card.selected {
        border-color: #007bff;
        background-color: #e6f7ff;
    }
    .modcore-notes-ext-card-img {
        width: 40px;
        height: 40px;
        object-fit: contain;
    }
    .modcore-notes-ext-card-name {
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        width: 100%;
    }
    .modcore-notes-ext-card.has-notes {
        border-color: #007bff;
        position: relative;
    }
    .modcore-notes-ext-card.has-notes::after {
        content: '📝';
        position: absolute;
        top: 5px;
        right: 5px;
    }

    .modcore-note-editor-modal .modcore-modal-content {
        max-width: 700px;
    }
    .modcore-note-editor-modal .note-search-wrapper {
        position: relative;
        margin-bottom: 15px;
    }
    .modcore-note-editor-modal .note-search-wrapper input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #ccc;
        border-radius: 12px;
        box-sizing: border-box;
    }
    .modcore-note-editor-modal .note-search-wrapper .search-icon {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        width: 16px;
        height: 16px;
        filter: invert(0.5);
    }
    
    .modcore-note-editor-modal .note-list-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 10px;
        padding-top: 10px;
        border-top: 1px solid #e9ecef;
    }

    .modcore-note-editor-modal .note-list-controls .modcore-btn {
        flex-shrink: 0;
    }
    
    .modcore-note-editor-modal .note-list {
        list-style: none;
        padding: 0;
        margin: 0;
        max-height: 250px;
        overflow-y: auto;
    }
    .modcore-note-editor-modal .note-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        border-bottom: 1px solid #e9ecef;
        cursor: pointer;
        gap: 10px;
        transition: background-color 0.2s ease;
    }
    .modcore-note-editor-modal .note-item:hover {
        background-color: #f1f3f5;
    }
    .modcore-note-editor-modal .note-item.is-pinned {
      background-color: #fffbe6;
      border-left: 4px solid #ffc107;
    }
    .modcore-note-editor-modal .note-item.is-selected {
      background-color: #e6f7ff;
      border-left: 4px solid #007bff;
    }
    .modcore-note-editor-modal .note-item:last-child { border-bottom: none; }
    .modcore-note-editor-modal .note-actions {
        display: flex;
        gap: 5px;
        flex-shrink: 0;
    }
    .modcore-note-editor-modal .note-actions button, .modcore-note-editor-modal .note-actions .note-action-icon {
        font-size: 11px;
        padding: 5px 8px;
        background: #e9ecef;
        color: #495057;
        border-radius: 4px;
        white-space: nowrap;
        opacity: 0.8;
        transition: opacity 0.2s ease, background-color 0.2s ease;
    }
    .modcore-note-editor-modal .note-actions button:hover {
        opacity: 1;
        background-color: #dee2e6;
    }
    .modcore-note-editor-modal textarea {
        width: 100%;
        min-height: 150px;
        padding: 10px;
        border: 1px solid #ccc;
        border-radius: 12px;
        resize: vertical;
    }
    .modcore-note-title {
        font-weight: 500;
        flex-grow: 1;
        display: flex;
        align-items: center;
        gap: 5px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }
    .modcore-note-title .modcore-pin-icon {
        color: #ffc107;
    }
    .modcore-note-checkbox {
      margin-right: 10px;
      flex-shrink: 0;
    }
    
    .modcore-view-note-content p {
        white-space: pre-wrap;
        word-wrap: break-word;
        font-size: 15px;
        line-height: 1.6;
    }

    /* Quick Actions Modal */
    .modcore-quick-actions-grid, .modcore-quick-links-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 15px;
    }
    .modcore-quick-actions-grid button, .modcore-quick-links-grid a {
        height: 100px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        text-align: center;
        border: 1px solid #e9ecef;
        border-radius: 12px;
        background: #f8f9fa;
        color: #212529;
        transition: transform 0.2s ease;
        text-decoration: none;
    }
    .modcore-quick-actions-grid button:hover, .modcore-quick-links-grid a:hover { transform: translateY(-2px); }
    .modcore-quick-actions-grid button small, .modcore-quick-links-grid a small {
        font-size: 12px;
        color: #6c757d;
    }
    .modcore-quick-links-grid a {
      width: auto;
    }

    /* Quick Links Modal Specific Styling for Wider View */
    .modcore-modal-content.modcore-wide-modal {
        max-width: 900px;
    }
    
    .modcore-modal-header-nav {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    /* Notification Toast */
    .modcore-toast {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background-color: #333;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 10001;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.3s, visibility 0.3s;
        min-width: 250px;
        text-align: center;
    }
    .modcore-toast.show {
        opacity: 1;
        visibility: visible;
    }
    
    .modcore-note-form .form-group {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-bottom: 15px;
    }
    .modcore-note-form .form-group label {
      font-weight: 600;
    }
    .modcore-note-form .form-group textarea {
      resize: vertical;
      min-height: 120px;
    }

    /* Responsive adjustments */
    @media (max-width: 768px) {
        .modcore-notes-grid {
            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        }
    }

    /* Note list base */
                    .note-list { list-style: none; padding: 0; margin: 0; }
                    .note-item { display: flex; align-items: center; justify-content: space-between; padding: 12px; gap: 12px; transition: background-color 0.15s ease, transform 0.12s ease; border-bottom: 1px solid #e9ecef; background: transparent; }
                    .note-item:hover { transform: translateY(-2px); }
                    .note-item.is-selected { background-color: #e6f7ff; }
                    .note-item.is-pinned { background-color: #fffbe6; }

                    /* Checkbox */
                    .modcore-note-checkbox { margin-right: 10px; flex-shrink: 0; }

                    /* Note actions */
                    .note-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
                    .note-actions .modcore-btn { padding: 6px 8px; font-size: 12px; border-radius: 8px; background: #e9ecef; color: #495057; border: none; cursor: pointer; }
                    .note-actions .modcore-btn:hover { opacity: 0.95; transform: translateY(-1px); }
                    .note-actions .modcore-btn.modcore-btn-text { background: transparent; color: #6c757d; }

                    /* compact title */
                    .modcore-note-title { display: flex; align-items: center; gap: 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; flex-grow: 1; }

                    @media (prefers-color-scheme: dark) {
                        .note-item { border-bottom-color: #3e3e3e; color: #e0e0e0; }
                        .note-item:hover { transform: translateY(-2px); background: rgba(255,255,255,0.02); }
                        .note-item.is-selected { background-color: #1a3a4d; }
                        .note-item.is-pinned { background-color: #3a3219; }
                        .note-actions .modcore-btn { background: #1a1a1b; color: #e0e0e0; border: 1px solid #333; }
                        .note-actions .modcore-btn.modcore-btn-text { background: transparent; color: #adb5bd; }
                    }

                    .note-search-wrapper {
                position: relative;
                display: flex;
                align-items: center;
                width: 100%;
                margin-bottom: 10px;
            }
            .note-search-wrapper input {
                width: 100%;
                padding: 10px 40px 10px 12px;
                border: 1px solid #ccc;
                border-radius: 12px;
                box-sizing: border-box;
                background: #fff;
                color: #212529;
                transition: border-color 0.15s ease, box-shadow 0.15s ease;
            }
            .note-search-wrapper input:focus {
                outline: none;
                border-color: #007bff;
                box-shadow: 0 0 0 3px rgba(0,123,255,0.08);
            }
            .note-search-wrapper .search-icon {
                position: absolute;
                right: 12px;
                top: 50%;
                transform: translateY(-50%);
                width: 16px;
                height: 16px;
                pointer-events: none;
                opacity: 0.7;
                filter: none;
            }
            .modcore-note-list-controls {
                display: flex;
                gap: 8px;
                align-items: center;
                justify-content: flex-start;
                margin: 8px 0 12px 0;
                flex-wrap: wrap;
            }
            .modcore-note-list-controls .modcore-btn {
                padding: 6px 10px;
                border-radius: 10px;
                font-size: 13px;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            .modcore-note-list-controls .modcore-btn.modcore-btn-secondary {
                background-color: #e9ecef;
                color: #212529;
            }
            .modcore-note-list-controls .modcore-btn.modcore-btn-text {
                background: transparent;
                color: #6c757d;
            }
            .modcore-note-list-controls .modcore-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            @media (prefers-color-scheme: dark) {
                .note-search-wrapper input {
                    background: #111112;
                    border-color: #333;
                    color: #e0e0e0;
                }
                .note-search-wrapper .search-icon {
                    filter: invert(1) grayscale(1) brightness(1.4);
                }
                .modcore-note-list-controls .modcore-btn.modcore-btn-secondary {
                    background-color: #1a1a1b;
                    color: #e0e0e0;
                    border: 1px solid #333;
                }
                .modcore-note-list-controls .modcore-btn.modcore-btn-text {
                    color: #adb5bd;
                }
            }

    /* --- 🌑 DARK MODE STYLES 🌑 --- */
    @media (prefers-color-scheme: dark) {
        /* General Overrides */
        .modcore-profile-ui,
        .modcore-profile-ui h2, .modcore-profile-ui h4, .modcore-profile-ui h3,
        .modcore-profile-ui button,
        .modcore-profile-ui .modcore-toast,
        .modcore-badge-card {
            color: #e0e0e0;
        }

        .modcore-profile-avatar-fallback {
            filter: invert(1) grayscale(100%) brightness(150%);
        }

        /* Buttons */
        .modcore-btn-secondary { background-color: #111112; color: #e0e0e0; }
        .modcore-btn-secondary:hover { background-color: #48494a; }
        .modcore-btn-text { color: #adb5bd; }
        .modcore-btn-text:hover { color: #e0e0e0; }
        
        /* Modals & Dropdown */
        .modcore-modal-content,
        .modcore-profile-dropdown {
            background: #111112;
            box-shadow: 0 0 20px rgba(0,0,0,0.5);
            border: 1px solid #333;
        }
        .modcore-modal-header .modcore-close-btn img, .modcore-modal-header .modcore-back-btn img { filter: invert(1); }
        .modcore-profile-dropdown hr, .modcore-profile-popup hr, .modcore-modal-content hr {
            border-top-color: #3e3e3e;
        }

        /* Profile Dropdown */
        .modcore-profile-dropdown button { color: #e0e0e0; }
        .modcore-profile-dropdown button:hover { background-color: #111112; }
        .modcore-profile-header { border-bottom-color: #3e3e3e; }
        .modcore-profile-header .modcore-stats-summary { color: #adb5bd; }

        /* Onboarding / Customize Form */
        .modcore-profile-popup input[type="text"] {
            background: #111112;
            border-color: #555;
            color: #e0e0e0;
        }
        .modcore-security-banner {
            background-color: #1a3a4d;
            border-color: #2b5570;
            color: #b3e0ff;
        }
        .modcore-security-banner img { filter: invert(0.8) sepia(1) saturate(5) hue-rotate(180deg); }

        /* Statistics Modal */
        .modcore-stats-list li {
            background-color: #111112;
            color: #e0e0e0;
            border: 1px solid #3e3e3e;
        }
        .modcore-stats-list li:hover { background-color: #111112; }
        .modcore-stats-list li strong { color: #63a6f1; }
        .modcore-stats-list li small { color: #c5c5c7; }
        .modcore-all-badges-complete {
            color: #47b25e;
        }

        /* Badges Modal */
        .modcore-badge-icon { 
            background: #111112; 
            border-color: #555; 
            color: #e0e0e0; 
        }

        /* Quick Actions & Quick Links Modals */
        .modcore-quick-actions-grid button, 
        .modcore-quick-links-grid a { 
            background: #111112; 
            border-color: #3e3e3e; 
            color: #e0e0e0; 
        }
        .modcore-quick-actions-grid button:hover, 
        .modcore-quick-links-grid a:hover {
            background: #111112;
        }
        .modcore-quick-actions-grid button small, 
        .modcore-quick-links-grid a small { 
            color: #adb5bd;
        } 

        /* Extension Notes Modal */
        .modcore-notes-search {
            background: #111112;
            border-color: #555;
            color: #e0e0e0;
        }
        .modcore-notes-ext-card {
            background: #111112;
            border-color: #3e3e3e;
        }
        .modcore-notes-ext-card:hover { background: #111112; }
        .modcore-notes-ext-card.selected {
            border-color: #007bff;
            background-color: #1a3a4d;
        }
        
        .modcore-note-editor-modal input[type="text"],
        .modcore-note-editor-modal textarea {
            background: #111112;
            border-color: #555;
            color: #e0e0e0;
        }
        .modcore-note-editor-modal .note-search-wrapper .search-icon {
            filter: invert(0.5) grayscale(1) brightness(200%);
        }
        .modcore-note-editor-modal .note-item { 
            border-bottom-color: #3e3e3e; 
            color: #e0e0e0;
        }
        .modcore-note-editor-modal .note-item:hover {
            background-color: #111112;
        }
        .modcore-note-editor-modal .note-item.is-pinned {
          background-color: #3a3219;
          border-left-color: #ffc107;
        }
        .modcore-note-editor-modal .note-item.is-selected {
          background-color: #1a3a4d;
          border-left-color: #007bff;
        }
        .modcore-note-editor-modal .note-actions button {
            background: #111112;
            color: #e0e0e0;
        }
        .modcore-note-editor-modal .note-actions button:hover {
            background-color: #48494a;
        }
        .modcore-note-editor-modal .note-actions .note-action-icon {
            filter: invert(1);
        }
    }
`;

// --- Helper Functions ---
function showToast(message, duration = 3000) {
    const existingToast = document.querySelector('.modcore-toast');
    if (existingToast) existingToast.remove();
    
    const toast = document.createElement('div');
    toast.className = 'modcore-toast modcore-profile-ui';
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function injectStyles() {
    if (!document.querySelector('style#modcore-profile-styles')) {
        const styleTag = document.createElement('style');
        styleTag.id = 'modcore-profile-styles';
        styleTag.textContent = profileStyles;
        document.head.appendChild(styleTag);
    }
}

async function resizeImageAndStore(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_SIZE = 128;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_SIZE) {
                        height *= MAX_SIZE / width;
                        width = MAX_SIZE;
                    }
                } else {
                    if (height > MAX_SIZE) {
                        width *= MAX_SIZE / height;
                        height = MAX_SIZE;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        resolve(reader.result); // Base64 for now, can be optimized later
                    };
                    reader.readAsDataURL(blob);
                }, 'image/jpeg', 0.8);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function getFormattedDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
        return 'N/A';
    }
}

function createModal(title, contentElement, isWide = false, headerExtras = null) {
    const existingOverlay = document.querySelector('.modcore-modal-overlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modcore-modal-overlay modcore-profile-ui';
    const popup = document.createElement('div');
    popup.className = 'modcore-modal-content';
    if (isWide) {
      popup.classList.add('modcore-wide-modal');
    }
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');

    const header = document.createElement('div');
    header.className = 'modcore-modal-header';
    const headerLeft = document.createElement('div');
    headerLeft.className = 'modcore-modal-header-left';
    
    if (headerExtras) {
        headerLeft.appendChild(headerExtras);
    }
    
    const titleEl = document.createElement('h2');
    titleEl.textContent = title;
    headerLeft.appendChild(titleEl);
    header.appendChild(headerLeft);
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modcore-close-btn';
    closeBtn.setAttribute('aria-label', `Close ${title} dialog`);
    const closeImg = document.createElement('img');
    closeImg.src = '../../public/icons/svg/close.svg';
    closeImg.alt = 'Close';
    closeBtn.appendChild(closeImg);
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        overlay.remove();
    });
    header.appendChild(closeBtn);
    
    popup.appendChild(header);
    popup.appendChild(contentElement);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    overlay.classList.add('open');
    popup.focus();
    return overlay;
}

function getBadgesContent(profile) {
    const content = document.createElement('div');
    const intro = document.createElement('p');
    intro.textContent = 'Badges are unlocked for reaching certain milestones. Keep exploring to earn more!';
    content.appendChild(intro);

    if (profile.badges.length === ALL_BADGES_COUNT) {
        const completeMessage = document.createElement('p');
        completeMessage.className = 'modcore-all-badges-complete';
        completeMessage.textContent = '🎉 Congratulations! You\'ve earned all the badges! 🎉';
        content.appendChild(completeMessage);
    }

    const badgesGrid = document.createElement('div');
    badgesGrid.className = 'modcore-badges-grid';

    Object.keys(BADGES).forEach(badgeKey => {
        const badgeDiv = document.createElement('div');
        const isUnlocked = profile.badges.includes(badgeKey);
        badgeDiv.className = `modcore-badge-card ${isUnlocked ? 'unlocked' : ''}`;
        badgeDiv.setAttribute('aria-label', `${BADGES[badgeKey].name}: ${BADGES[badgeKey].description}`);

        const badgeIcon = document.createElement('div');
        badgeIcon.className = 'modcore-badge-icon';
        const milestone = BADGES[badgeKey].description.match(/\d+/) ? BADGES[badgeKey].description.match(/\d+/)[0] : '';
        let iconSymbol = '?';
        if (badgeKey.startsWith('install')) {
            iconSymbol = milestone;
        } else if (badgeKey.startsWith('enabled')) {
            iconSymbol = '✔';
        } else if (badgeKey.startsWith('disabled')) {
            iconSymbol = '✖';
        } else if (badgeKey === 'first_profile') {
            iconSymbol = '★';
        }
        badgeIcon.textContent = iconSymbol;

        const badgeName = document.createElement('strong');
        badgeName.textContent = BADGES[badgeKey].name;

        const badgeDesc = document.createElement('small');
        badgeDesc.textContent = BADGES[badgeKey].description;

        badgeDiv.appendChild(badgeIcon);
        badgeDiv.appendChild(badgeName);
        badgeDiv.appendChild(badgeDesc);
        badgesGrid.appendChild(badgeDiv);
    });

    content.appendChild(badgesGrid);
    return content;
}

function getStatsContent(profile, globalStats) {
    const content = document.createElement('div');
    const intro = document.createElement('p');
    intro.textContent = 'A snapshot of your usage and activity in modcore Extension Manager.';
    content.appendChild(intro);

    const statsList = document.createElement('ul');
    statsList.className = 'modcore-stats-list';

    // Privacy notice: data is stored locally only
    const privacyNotice = document.createElement('div');
    privacyNotice.className = 'modcore-security-banner';
    privacyNotice.style.marginTop = '10px';
    privacyNotice.style.marginBottom = '15px';
    privacyNotice.style.fontSize = '13px';
    privacyNotice.setAttribute('role', 'note');
    privacyNotice.textContent = 'Your profile data and extension notes are stored only on this device and are never sent to any server. Your data remains private and under your control.';
    content.appendChild(privacyNotice);

    const items = [
        { label: 'Installed Extensions', value: profile.stats.extensionsInstalled },
        { label: 'Enabled Extensions', value: profile.stats.extensionsEnabled },
        { label: 'Disabled Extensions', value: profile.stats.extensionsDisabled },
        { label: 'Badges Unlocked', value: `${profile.badges.length} / ${ALL_BADGES_COUNT}` },
        { label: 'First Use', value: getFormattedDate(globalStats.firstUse) },
        { label: 'Current Streak', value: `${globalStats.streak} days` }
    ];

    items.forEach(item => {
        const li = document.createElement('li');
        const valueStrong = document.createElement('strong');
        valueStrong.textContent = item.value;
        const labelSmall = document.createElement('small');
        labelSmall.textContent = item.label;
        li.appendChild(valueStrong);
        li.appendChild(labelSmall);
        statsList.appendChild(li);
    });

    content.appendChild(statsList);
    return content;
}

// --- Main Profile Logic ---
async function initProfileCards() {
    injectStyles();

    let [profile, globalStats] = await Promise.all([getProfile(), getGlobalStats()]);
    profile = await updateExtensionStats(profile);
    globalStats = await updateUsageStreak(globalStats);
    
    if (!profile.stats.profileCreation) {
        showOnboarding(true, profile);
    } else {
        createProfileDropdown(profile, globalStats);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const openModal = document.querySelector('.modcore-modal-overlay.open');
            if (openModal) {
                openModal.remove();
            }
            const openMenu = document.querySelector('.modcore-profile-dropdown.open');
            const menuContainer = document.querySelector('.modcore-profile-icon-container');
            if (openMenu) {
                openMenu.classList.remove('open');
                menuContainer.setAttribute('aria-expanded', 'false');
            }
        }
    });

    chrome.management.onInstalled.addListener(() => updateAndRefreshProfile());
    chrome.management.onEnabled.addListener(() => updateAndRefreshProfile());
    chrome.management.onDisabled.addListener(() => updateAndRefreshProfile());
}

async function updateAndRefreshProfile() {
    let profile = await getProfile();
    let globalStats = await getGlobalStats();
    profile = await updateExtensionStats(profile);
    globalStats = await updateUsageStreak(globalStats);
    createProfileDropdown(profile, globalStats);
}

async function getProfile() {
    return new Promise((resolve) => {
        chrome.storage.local.get([PROFILE_STORAGE_KEY], (result) => {
            resolve(result[PROFILE_STORAGE_KEY] || { ...defaultProfile });
        });
    });
}

async function getGlobalStats() {
    return new Promise((resolve) => {
        chrome.storage.local.get([GLOBAL_STATS_STORAGE_KEY], (result) => {
            resolve(result[GLOBAL_STATS_STORAGE_KEY] || { ...defaultGlobalStats });
        });
    });
}

async function getExtensionNotes() {
    return new Promise((resolve) => {
        chrome.storage.local.get([EXTENSION_NOTES_STORAGE_KEY], (result) => {
            resolve(result[EXTENSION_NOTES_STORAGE_KEY] || {});
        });
    });
}

async function saveProfile(profile) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: profile }, () => resolve());
    });
}

async function saveGlobalStats(stats) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [GLOBAL_STATS_STORAGE_KEY]: stats }, () => resolve());
    });
}

async function saveExtensionNotes(notes) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [EXTENSION_NOTES_STORAGE_KEY]: notes }, () => resolve());
    });
}

async function updateUsageStreak(globalStats) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastUseDate = globalStats.lastUse ? new Date(globalStats.lastUse) : null;
    let newStreak = globalStats.streak;
    
    if (lastUseDate) {
        lastUseDate.setHours(0, 0, 0, 0);
        const diffInDays = Math.floor((today - lastUseDate) / (1000 * 60 * 60 * 24));
        if (diffInDays === 1) {
            newStreak++;
        } else if (diffInDays > 1) {
            newStreak = 1;
        }
    } else {
        newStreak = 1;
    }

    const updatedStats = {
        ...globalStats,
        lastUse: today.toISOString(),
        streak: newStreak
    };

    await saveGlobalStats(updatedStats);
    return updatedStats;
}

async function updateExtensionStats(profile) {
    try {
        const extensions = await new Promise((resolve) => {
            chrome.management.getAll((exts) => resolve(exts.filter(ext => !ext.isApp && !ext.id.includes('modcore'))));
        });
        profile.stats.extensionsInstalled = extensions.length;
        profile.stats.extensionsEnabled = extensions.filter(ext => ext.enabled).length;
        profile.stats.extensionsDisabled = extensions.filter(ext => !ext.enabled).length;

        const oldBadges = new Set(profile.badges);
        const unlockedBadges = new Set(profile.badges);
        if (profile.stats.profileCreation) unlockedBadges.add('first_profile');
        if (profile.stats.extensionsInstalled >= 5) unlockedBadges.add('install_5');
        if (profile.stats.extensionsInstalled >= 10) unlockedBadges.add('install_10');
        if (profile.stats.extensionsInstalled >= 20) unlockedBadges.add('install_20');
        if (profile.stats.extensionsEnabled >= 10) unlockedBadges.add('enabled_10');
        if (profile.stats.extensionsDisabled >= 10) unlockedBadges.add('disabled_10');
        
        const newBadges = Array.from(unlockedBadges);
        profile.badges = newBadges;

        await saveProfile(profile);

        // Notify user about new badges
        newBadges.forEach(badgeKey => {
            if (!oldBadges.has(badgeKey)) {
                showToast(`🎉 Badge Unlocked: ${BADGES[badgeKey].name}!`);
            }
        });

        // Notify user if all badges are unlocked
        if (newBadges.length === ALL_BADGES_COUNT && oldBadges.size !== ALL_BADGES_COUNT) {
            showToast('🏆 You\'ve unlocked all available badges! Great job!');
        }

        return profile;
    } catch (e) {
        console.error("Failed to get extension stats:", e);
        return profile;
    }
}

async function toggleAllExtensions(profile, enableState) {
    try {
        const extensions = await new Promise(resolve => chrome.management.getAll(resolve));
        const modcoreId = chrome.runtime.id;
        const extensionsToToggle = extensions.filter(ext => ext.id !== modcoreId && !ext.isApp);
        
        const actionMessage = `All extensions have been ${enableState ? 'enabled' : 'disabled'}.`;

        for (const ext of extensionsToToggle) {
            if (ext.enabled !== enableState) {
                try {
                    await chrome.management.setEnabled(ext.id, enableState);
                } catch (e) {
                    console.warn(`Could not set enabled state for extension ${ext.name}:`, e);
                }
            }
        }

        await updateExtensionStats(profile);
        showToast(actionMessage);
    } catch (e) {
        showToast('Error toggling extensions.');
        console.error("Failed to toggle extensions:", e);
    }
}

async function resetProfile() {
    if (!confirm('Are you sure you want to reset your profile? All data will be lost.')) return;
    try {
        await new Promise(resolve => chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: { ...defaultProfile } }, resolve));
        await new Promise(resolve => chrome.storage.local.set({ [GLOBAL_STATS_STORAGE_KEY]: { ...defaultGlobalStats } }, resolve));
        await new Promise(resolve => chrome.storage.local.set({ [EXTENSION_NOTES_STORAGE_KEY]: {} }, resolve));
        location.reload();
    } catch (e) {
        showToast('Failed to reset profile.');
        console.error('Reset error:', e);
    }
}

// --- UI Components ---
function showOnboarding(isInitialOnboarding = false, profile) {
    const overlay = document.querySelector('.modcore-modal-overlay');
    if (overlay) overlay.remove();

    const container = document.createElement('div');
    container.className = 'modcore-modal-overlay modcore-profile-ui';
    const popup = document.createElement('div');
    popup.className = 'modcore-modal-content modcore-profile-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('tabindex', '-1');

    const header = document.createElement('div');
    header.className = 'modcore-modal-header';
    const title = document.createElement('h2');
    title.textContent = isInitialOnboarding ? 'Set Up Your Profile' : 'Customize Profile Card';
    header.appendChild(title);
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modcore-close-btn';
    closeBtn.setAttribute('aria-label', 'Close dialog');
    const closeImg = document.createElement('img');
    closeImg.src = '../../public/icons/svg/close.svg';
    closeImg.alt = 'Close';
    closeBtn.appendChild(closeImg);
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); container.remove(); });
    header.appendChild(closeBtn);
    
    const popupContent = document.createElement('div');
    popupContent.className = 'modcore-profile-popup-content';
    
    const securityBanner = document.createElement('div');
    securityBanner.className = 'modcore-security-banner';
    const shieldImg = document.createElement('img');
    shieldImg.src = '../../public/icons/svg/shield.svg';
    shieldImg.alt = 'Security Shield';
    const bannerText = document.createElement('span');
    bannerText.textContent = 'This is not an account creation. Your data is stored locally and is completely secure. ';
    const learnMoreLink = document.createElement('a');
    learnMoreLink.href = 'https://sites.google.com/view/modcore-em-help/general-information/additional-features/profile-cards';
    learnMoreLink.target = '_blank';
    learnMoreLink.rel = 'noopener noreferrer';
    learnMoreLink.textContent = 'Learn more';
    learnMoreLink.style.marginLeft = '6px';
    learnMoreLink.style.fontWeight = '500';
    learnMoreLink.style.textDecoration = 'underline';
    learnMoreLink.style.color = '#b3e0ff';
    bannerText.appendChild(learnMoreLink);
    securityBanner.appendChild(shieldImg);
    securityBanner.appendChild(bannerText);
    popupContent.appendChild(securityBanner);

    const greeting = document.createElement('p');
    greeting.className = 'greeting';
    greeting.textContent = isInitialOnboarding ? 'Welcome to modcore Extension Manager! Please create a profile to get started.' : `Hello, ${profile.username}! Customize your profile card below.`;
    popupContent.appendChild(greeting);

    const form = document.createElement('form');
    const usernameGroup = document.createElement('div');
    usernameGroup.className = 'form-group';
    const usernameLabel = document.createElement('label');
    usernameLabel.setAttribute('for', 'username');
    usernameLabel.textContent = 'Display Name';
    const usernameInput = document.createElement('input');
    usernameInput.type = 'text';
    usernameInput.id = 'username';
    usernameInput.value = profile.username;
    usernameInput.placeholder = 'Enter your name';
    usernameInput.maxLength = 25;
    usernameInput.required = true;
    usernameGroup.appendChild(usernameLabel);
    usernameGroup.appendChild(usernameInput);
    form.appendChild(usernameGroup);

    const avatarGroup = document.createElement('div');
    avatarGroup.className = 'form-group';
    const avatarLabel = document.createElement('label');
    avatarLabel.textContent = 'Profile Picture';
    const previewGroup = document.createElement('div');
    previewGroup.className = 'preview-group';
    const avatarPreview = document.createElement('img');
    avatarPreview.id = 'avatar-preview';
    avatarPreview.className = 'preview-avatar';
    avatarPreview.src = profile.avatar || '../../public/icons/svg/dots-circle1.svg';
    avatarPreview.alt = 'Avatar preview';
    const avatarBtn = document.createElement('button');
    avatarBtn.type = 'button';
    avatarBtn.className = 'modcore-btn modcore-btn-secondary';
    avatarBtn.id = 'avatar-btn';
    avatarBtn.textContent = 'Choose File';
    const avatarInput = document.createElement('input');
    avatarInput.type = 'file';
    avatarInput.id = 'avatar-input';
    avatarInput.accept = 'image/*';
    avatarInput.style.display = 'none';
    previewGroup.appendChild(avatarPreview);
    previewGroup.appendChild(avatarBtn);
    previewGroup.appendChild(avatarInput);
    avatarGroup.appendChild(avatarLabel);
    avatarGroup.appendChild(previewGroup);
    form.appendChild(avatarGroup);
    
    const divider = document.createElement('hr');
    form.appendChild(divider);

    const actions = document.createElement('div');
    actions.className = 'modcore-profile-popup-actions';
    
    const saveButton = document.createElement('button');
    saveButton.className = 'modcore-btn modcore-btn-primary';
    saveButton.textContent = 'Save Profile';
    actions.appendChild(saveButton);

    popupContent.appendChild(form);
    popupContent.appendChild(actions);
    popup.appendChild(header);
    popup.appendChild(popupContent);
    container.appendChild(popup);
    document.body.appendChild(container);

    container.classList.add('open');
    popup.focus();
    usernameInput.focus();

    avatarBtn.addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', async () => {
        if (avatarInput.files && avatarInput.files[0]) {
            try {
                const resizedDataUrl = await resizeImageAndStore(avatarInput.files[0]);
                avatarPreview.src = resizedDataUrl;
            } catch (e) {
                showToast('Failed to load image.');
                console.error('Image resize error:', e);
            }
        }
    });

    saveButton.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            const username = usernameInput.value.trim();
            if (username.length < 1 || username.length > 25) {
                showToast('Username must be between 1 and 25 characters long.');
                return;
            }
            
            let avatar = avatarPreview.src;
            if (avatar.endsWith('dots-circle1.svg')) {
                avatar = profile.avatar;
            }
            
            const newProfile = {
                ...profile,
                username: username,
                avatar: avatar,
                stats: {
                    ...profile.stats,
                    profileCreation: profile.stats.profileCreation || new Date().toISOString()
                }
            };

            await saveProfile(newProfile);
            container.remove();
            updateAndRefreshProfile();
            showToast('Profile saved!');
        } catch (e) {
            showToast('Failed to save profile.');
            console.error('Save profile error:', e);
        }
    });
}

function createProfileDropdown(profile, globalStats) {
    const existingIcon = document.querySelector('.modcore-profile-icon-container');
    if (existingIcon) existingIcon.remove();
    
    const iconContainer = document.createElement('div');
    iconContainer.className = 'modcore-profile-icon-container modcore-profile-ui';
    iconContainer.setAttribute('aria-haspopup', 'true');
    iconContainer.setAttribute('aria-expanded', 'false');

    const img = document.createElement('img');
    img.className = `modcore-profile-avatar ${!profile.avatar ? 'modcore-profile-avatar-fallback' : ''}`;
    img.src = profile.avatar || '../../public/icons/svg/dots-circle1.svg';
    img.alt = 'Profile';
    iconContainer.appendChild(img);

    const dropdown = document.createElement('div');
    dropdown.className = 'modcore-profile-dropdown modcore-profile-ui';
    dropdown.setAttribute('role', 'menu');
    dropdown.id = 'profile-dropdown-menu';

    const header = document.createElement('div');
    header.className = 'modcore-profile-header';
    const headerAvatar = document.createElement('img');
    headerAvatar.className = 'modcore-profile-avatar';
    headerAvatar.src = profile.avatar || '../../public/icons/svg/dots-circle1.svg';
    headerAvatar.alt = 'Profile';
    const headerInfo = document.createElement('div');
    const headerTitle = document.createElement('h4');
    const truncatedUsername = profile.username.length > 10 ? profile.username.substring(0, 10) + '...' : profile.username;
    headerTitle.textContent = `Hello, ${truncatedUsername}!`;
    const headerStats = document.createElement('span');
    headerStats.className = 'modcore-stats-summary';
    headerStats.textContent = `${profile.stats.extensionsInstalled} extensions`;
    headerInfo.appendChild(headerTitle);
    headerInfo.appendChild(headerStats);
    header.appendChild(headerAvatar);
    header.appendChild(headerInfo);
    dropdown.appendChild(header);

    const dropdownContent = document.createElement('div');
    dropdownContent.className = 'modcore-profile-dropdown-content';
    
    const customizeBtn = document.createElement('button');
    customizeBtn.role = 'menuitem';
    customizeBtn.id = 'customizeBtn';
    customizeBtn.textContent = 'Customize Profile Card';
    customizeBtn.addEventListener('click', () => showOnboarding(false, profile));
    dropdownContent.appendChild(customizeBtn);

    const notesBtn = document.createElement('button');
    notesBtn.role = 'menuitem';
    notesBtn.id = 'notesBtn';
    notesBtn.textContent = 'Extension Notes';
    notesBtn.addEventListener('click', () => showNotesModal());
    dropdownContent.appendChild(notesBtn);

    const badgesBtn = document.createElement('button');
    badgesBtn.role = 'menuitem';
    badgesBtn.id = 'badgesBtn';
    badgesBtn.textContent = 'Badges';
    badgesBtn.addEventListener('click', () => createModal('Your Badges', getBadgesContent(profile)));
    dropdownContent.appendChild(badgesBtn);

    const statsBtn = document.createElement('button');
    statsBtn.role = 'menuitem';
    statsBtn.id = 'statsBtn';
    statsBtn.textContent = 'Stats';
    statsBtn.addEventListener('click', () => createModal('Profile Stats', getStatsContent(profile, globalStats)));
    dropdownContent.appendChild(statsBtn);

    const quickActionsBtn = document.createElement('button');
    quickActionsBtn.role = 'menuitem';
    quickActionsBtn.id = 'quickActionsBtn';
    quickActionsBtn.textContent = 'Quick Actions';
    quickActionsBtn.addEventListener('click', () => showQuickActionsModal(profile));
    dropdownContent.appendChild(quickActionsBtn);

    const quickLinksBtn = document.createElement('button');
    quickLinksBtn.role = 'menuitem';
    quickLinksBtn.id = 'quickLinksBtn';
    quickLinksBtn.textContent = 'Quick Links';
    quickLinksBtn.addEventListener('click', () => showQuickLinksModal());
    dropdownContent.appendChild(quickLinksBtn);

    const divider = document.createElement('hr');
    dropdownContent.appendChild(divider);

    const helpLink = document.createElement('button');
    helpLink.role = 'menuitem';
    helpLink.id = 'helpLink';
    helpLink.textContent = 'About Profile Cards';
    helpLink.addEventListener('click', () => { window.open('https://sites.google.com/view/modcore-em-help/general-information/additional-features/profile-cards', '_blank'); });
    dropdownContent.appendChild(helpLink);

    const resetBtn = document.createElement('button');
    resetBtn.role = 'menuitem';
    resetBtn.id = 'resetBtn';
    resetBtn.textContent = 'Reset Profile';
    resetBtn.addEventListener('click', () => resetProfile());
    dropdownContent.appendChild(resetBtn);

    dropdown.appendChild(dropdownContent);
    iconContainer.appendChild(dropdown);
    document.body.appendChild(iconContainer);

    iconContainer.addEventListener('click', async (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
        const isExpanded = dropdown.classList.contains('open');
        iconContainer.setAttribute('aria-expanded', isExpanded);
        
        if (isExpanded) {
            const updatedProfile = await updateExtensionStats(profile);
            const updatedGlobalStats = await updateUsageStreak(globalStats);
            headerStats.textContent = `${updatedProfile.stats.extensionsInstalled} extensions`;
        }
    });

    document.addEventListener('click', (e) => {
        if (!iconContainer.contains(e.target) && dropdown.classList.contains('open')) {
            dropdown.classList.remove('open');
            iconContainer.setAttribute('aria-expanded', 'false');
        }
    });
}

function showQuickActionsModal(profile) {
    const content = document.createElement('div');
    const intro = document.createElement('p');
    intro.textContent = "Easily manage and control your extensions with these quick actions. The enable and disabling options don't apply to the modcore EM itself.";
    content.appendChild(intro);

    const actionsGrid = document.createElement('div');
    actionsGrid.className = 'modcore-quick-actions-grid';

    const manageBtn = document.createElement('button');
    manageBtn.textContent = 'Manage Extensions';
    const manageInfo = document.createElement('small');
    manageInfo.textContent = 'Open the Chrome extensions page.';
    manageBtn.appendChild(manageInfo);
    manageBtn.addEventListener('click', () => { chrome.tabs.create({ url: 'chrome://extensions' }); });
    actionsGrid.appendChild(manageBtn);

    const disableAllBtn = document.createElement('button');
    disableAllBtn.textContent = 'Disable All';
    const disableInfo = document.createElement('small');
    disableInfo.textContent = 'Turn off every extension.';
    disableAllBtn.appendChild(disableInfo);
    disableAllBtn.addEventListener('click', () => toggleAllExtensions(profile, false));
    actionsGrid.appendChild(disableAllBtn);

    const enableAllBtn = document.createElement('button');
    enableAllBtn.textContent = 'Enable All';
    const enableInfo = document.createElement('small');
    enableInfo.textContent = 'Turn on every extension.';
    enableAllBtn.appendChild(enableInfo);
    enableAllBtn.addEventListener('click', () => toggleAllExtensions(profile, true));
    actionsGrid.appendChild(enableAllBtn);

    content.appendChild(actionsGrid);
    createModal('Quick Actions', content);
}

function showQuickLinksModal() {
    const content = document.createElement('div');
    const intro = document.createElement('p');
    intro.textContent = 'Quickly access useful features and resources for modcore Extension Manager.';
    content.appendChild(intro);

    const generalSection = document.createElement('div');
    const generalHeader = document.createElement('h4');
    generalHeader.textContent = 'General';
    const generalGrid = document.createElement('div');
    generalGrid.className = 'modcore-quick-links-grid';
    
    const generalLinks = [
        { name: 'Extension Conflict Scanner', url: 'extension-conflict.html' },
        { name: 'Safety Center', url: 'safety-center.html' },
        { name: 'Backup & Restore', url: 'backup_restore.html' },
        { name: 'Extension Activity Log', url: 'history.html' },
        { name: 'Automation Rules', url: 'rules.html' },
        { name: 'Cloud Sync', url: 'cloud-sync.html' },
    ];

    generalLinks.forEach(link => {
        const a = document.createElement('a');
        a.href = link.url;
        a.textContent = link.name;
        a.className = 'modcore-btn modcore-btn-secondary';
        a.target = '_blank';
        a.setAttribute('aria-label', `Open ${link.name} page in a new tab.`);
        generalGrid.appendChild(a);
    });

    generalSection.appendChild(generalHeader);
    generalSection.appendChild(generalGrid);
    content.appendChild(generalSection);

    const extraSection = document.createElement('div');
    const extraHeader = document.createElement('h4');
    extraHeader.textContent = 'Extra Links';
    const extraGrid = document.createElement('div');
    extraGrid.className = 'modcore-quick-links-grid';

    const extraLinks = [
        { name: 'Discuss & Ask Questions', url: 'https://github.com/modcoretech/modcore-extension-manager/discussions' },
        { name: 'Report an Issue', url: 'https://github.com/modcoretech/modcore-extension-manager/issues' },
        { name: 'View Documentation', url: 'https://sites.google.com/view/modcore-em-help/' },
        { name: 'Give Feedback', url: 'https://forms.gle/BwnxtmQQcE3Y4fNb8' },
        { name: 'Donate & Support', url: 'https://sites.google.com/view/modcore-pricing/modcore-extension-manager' },
        { name: 'Visit Marketplace', url: 'https://sites.google.com/view/modcore-pricing/modcore-extension-manager' },
    ];
    
    extraLinks.forEach(link => {
        const a = document.createElement('a');
        a.href = link.url;
        a.textContent = link.name;
        a.className = 'modcore-btn modcore-btn-secondary';
        a.target = '_blank';
        a.setAttribute('aria-label', `Open external link for ${link.name}.`);
        extraGrid.appendChild(a);
    });

    extraSection.appendChild(extraHeader);
    extraSection.appendChild(extraGrid);
    content.appendChild(extraSection);

    createModal('Quick Links', content, true);
}


async function showNotesModal() {
    const extensions = await new Promise(resolve => chrome.management.getAll(resolve));
    const notes = await getExtensionNotes();
    const sortedExtensions = extensions.sort((a, b) => a.name.localeCompare(b.name));

    const content = document.createElement('div');
    content.className = 'modcore-notes-container';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search extensions...';
    searchInput.className = 'modcore-notes-search';
    searchInput.setAttribute('aria-label', 'Search extensions by name');
    content.appendChild(searchInput);

    const extensionGrid = document.createElement('div');
    extensionGrid.className = 'modcore-notes-grid';
    content.appendChild(extensionGrid);
    
    const modal = createModal('Extension Notes', content);

    const renderGrid = (extensionsToRender) => {
        extensionGrid.innerHTML = '';
        const fragment = document.createDocumentFragment();
        extensionsToRender.forEach(ext => {
            const card = document.createElement('div');
            const hasNotes = notes[ext.id] && notes[ext.id].length > 0;
            card.className = `modcore-notes-ext-card ${hasNotes ? 'has-notes' : ''}`;
            card.setAttribute('data-extension-id', ext.id);
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-label', `View and edit notes for ${ext.name}`);
            
            const extIcon = document.createElement('img');
            extIcon.src = ext.icons && ext.icons.length > 0 ? ext.icons[0].url : '../../public/icons/svg/dots-circle1.svg';
            extIcon.className = 'modcore-notes-ext-card-img';
            extIcon.alt = `${ext.name} icon`;

            const extName = document.createElement('span');
            extName.className = 'modcore-notes-ext-card-name';
            extName.textContent = ext.name;

            card.appendChild(extIcon);
            card.appendChild(extName);
            
            card.addEventListener('click', () => showNoteEditorModal(ext, notes));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    showNoteEditorModal(ext, notes);
                }
            });
            fragment.appendChild(card);
        });
        extensionGrid.appendChild(fragment);
    };

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filteredExtensions = sortedExtensions.filter(ext => ext.name.toLowerCase().includes(query));
        renderGrid(filteredExtensions);
    });

    renderGrid(sortedExtensions);
}

async function showNoteEditorModal(extension, allNotes) {
    // Use a mutable reference so we can refresh it when notes change
    let extNotes = allNotes[extension.id] || [];
    let selectedNotes = new Set();
    let isMultiSelectMode = false;

    const content = document.createElement('div');
    content.className = 'modcore-note-editor';    

    const noteSearchWrapper = document.createElement('div');
    noteSearchWrapper.className = 'note-search-wrapper';
    const noteSearchInput = document.createElement('input');
    noteSearchInput.type = 'text';
    noteSearchInput.placeholder = 'Search notes...';
    noteSearchInput.setAttribute('aria-label', 'Search notes by title or content');
    const searchIcon = document.createElement('img');
    searchIcon.src = '../../public/icons/svg/search.svg';
    searchIcon.alt = 'Search';
    searchIcon.className = 'search-icon';
    noteSearchWrapper.appendChild(noteSearchInput);
    noteSearchWrapper.appendChild(searchIcon);
    
    const noteListControls = document.createElement('div');
    noteListControls.className = 'modcore-note-list-controls';
    
    const multiSelectBtn = document.createElement('button');
    multiSelectBtn.className = 'modcore-btn modcore-btn-secondary';
    multiSelectBtn.textContent = 'Select Notes';
    
    const batchDeleteBtn = document.createElement('button');
    batchDeleteBtn.className = 'modcore-btn modcore-btn-text';
    batchDeleteBtn.textContent = 'Delete Selected';
    batchDeleteBtn.style.display = 'none';

    multiSelectBtn.addEventListener('click', () => {
        isMultiSelectMode = !isMultiSelectMode;
        if (isMultiSelectMode) {
            multiSelectBtn.textContent = 'Cancel Selection';
            batchDeleteBtn.style.display = 'inline-block';
            selectedNotes.clear();
        } else {
            multiSelectBtn.textContent = 'Select Notes';
            batchDeleteBtn.style.display = 'none';
            selectedNotes.clear();
        }
        // Re-render with the current extNotes
        renderNotes(extNotes);
    });
    
    batchDeleteBtn.addEventListener('click', async () => {
      if (selectedNotes.size === 0) {
          showToast('No notes selected.');
          return;
      }
      if (confirm(`Are you sure you want to delete ${selectedNotes.size} notes?`)) {
          const notesToDelete = Array.from(selectedNotes);
          const currentList = allNotes[extension.id] || [];
          allNotes[extension.id] = currentList.filter(n => !notesToDelete.includes(n.id));
          await saveExtensionNotes(allNotes);
          showToast(`${selectedNotes.size} notes deleted.`);
          selectedNotes.clear();
          isMultiSelectMode = false;
          multiSelectBtn.textContent = 'Select Notes';
          batchDeleteBtn.style.display = 'none';
          extNotes = allNotes[extension.id] || [];
          renderNotes(extNotes);
      }
    });
    
    noteListControls.appendChild(multiSelectBtn);
    noteListControls.appendChild(batchDeleteBtn);

    const noteList = document.createElement('ul');
    noteList.className = 'note-list';
    
    const addNoteBtn = document.createElement('button');
    addNoteBtn.className = 'modcore-btn modcore-btn-primary';
    addNoteBtn.textContent = 'Add New Note';
    addNoteBtn.addEventListener('click', () => openNoteForm(extension, allNotes, null));
    
    content.appendChild(noteSearchWrapper);
    content.appendChild(noteListControls);
    content.appendChild(noteList);
    content.appendChild(document.createElement('hr'));
    content.appendChild(addNoteBtn);

    const clearChildren = (el) => {
        while (el.firstChild) el.removeChild(el.firstChild);
    };

    const renderNotes = (notesToRender) => {
        clearChildren(noteList);

        // Ensure we have an array
        const ns = Array.isArray(notesToRender) ? notesToRender : [];

        const pinnedNotes = ns.filter(note => note.isPinned).sort((a,b) => b.id - a.id);
        const unpinnedNotes = ns.filter(note => !note.isPinned).sort((a,b) => b.id - a.id);
        const sortedNotes = [...pinnedNotes, ...unpinnedNotes];

        if (sortedNotes.length === 0) {
            const noNotesMessageWrap = document.createElement('li');
            noNotesMessageWrap.style.listStyle = 'none';
            const noNotesMessage = document.createElement('p');
            noNotesMessage.textContent = "No notes exist for this extension. Use 'Add New Note' to create one.";
            noNotesMessage.style.textAlign = 'center';
            noNotesMessage.style.color = '#6c757d';
            noNotesMessageWrap.appendChild(noNotesMessage);
            noteList.appendChild(noNotesMessageWrap);
            return;
        }

        sortedNotes.forEach((note) => {
            const li = document.createElement('li');
            li.className = `note-item ${note.isPinned ? 'is-pinned' : ''} ${selectedNotes.has(note.id) ? 'is-selected' : ''}`;
            li.setAttribute('aria-label', `Note title: ${note.title}`);
            li.setAttribute('tabindex', '0');
            
            const noteTitle = document.createElement('span');
            noteTitle.className = 'modcore-note-title';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'modcore-note-checkbox';
            checkbox.checked = selectedNotes.has(note.id);
            checkbox.style.display = isMultiSelectMode ? 'inline-block' : 'none';
            checkbox.setAttribute('aria-label', `Select note titled: ${note.title}`);
            // Toggle selection when checkbox changes
            checkbox.addEventListener('change', (ev) => {
                ev.stopPropagation();
                if (checkbox.checked) selectedNotes.add(note.id);
                else selectedNotes.delete(note.id);
                // reflect selection immediately
                renderNotes(extNotes);
            });
            
            const titleText = document.createElement('span');
            titleText.textContent = note.title;

            if (note.isPinned) {
                const pinIcon = document.createElement('span');
                pinIcon.className = 'modcore-pin-icon';
                pinIcon.textContent = '📌';
                noteTitle.appendChild(pinIcon);
            }
            noteTitle.appendChild(titleText);

            const actions = document.createElement('div');
            actions.className = 'note-actions';

            const pinBtn = document.createElement('button');
            pinBtn.className = 'modcore-btn';
            pinBtn.type = 'button';
            pinBtn.setAttribute('aria-label', note.isPinned ? 'Unpin note' : 'Pin note');
            pinBtn.textContent = note.isPinned ? 'Unpin' : 'Pin';
            pinBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const currentList = allNotes[extension.id] || [];
                const existing = currentList.find(n => n.id === note.id);
                if (existing) {
                    existing.isPinned = !existing.isPinned;
                    await saveExtensionNotes(allNotes);
                    showToast(`Note ${existing.isPinned ? 'pinned' : 'unpinned'}.`);
                    extNotes = allNotes[extension.id] || [];
                    renderNotes(extNotes);
                }
            });
            actions.appendChild(pinBtn);

            const viewBtn = document.createElement('button');
            viewBtn.className = 'modcore-btn';
            viewBtn.type = 'button';
            viewBtn.setAttribute('aria-label', 'View note');
            viewBtn.textContent = 'View';
            viewBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                showNoteViewer(extension, note, allNotes);
            });
            actions.appendChild(viewBtn);

            const editBtn = document.createElement('button');
            editBtn.className = 'modcore-btn';
            editBtn.type = 'button';
            editBtn.setAttribute('aria-label', 'Edit note');
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                openNoteForm(extension, allNotes, note);
            });
            actions.appendChild(editBtn);

            // Per-note delete action
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'modcore-btn modcore-btn-text';
            deleteBtn.type = 'button';
            deleteBtn.setAttribute('aria-label', 'Delete note');
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                if (!confirm('Are you sure you want to delete this note?')) return;
                const currentList = allNotes[extension.id] || [];
                allNotes[extension.id] = currentList.filter(n => n.id !== note.id);
                await saveExtensionNotes(allNotes);
                showToast('Note deleted.');
                selectedNotes.delete(note.id);
                extNotes = allNotes[extension.id] || [];
                renderNotes(extNotes);
            });
            actions.appendChild(deleteBtn);

            // If clicking the list item: toggle selection in multi-select, open viewer otherwise
            li.addEventListener('click', (e) => {
                if (isMultiSelectMode) {
                    e.preventDefault();
                    if (selectedNotes.has(note.id)) {
                        selectedNotes.delete(note.id);
                    } else {
                        selectedNotes.add(note.id);
                    }
                    renderNotes(extNotes);
                } else {
                    // open viewer on regular click
                    showNoteViewer(extension, note, allNotes);
                }
            });

            // prevent actions from triggering li click handler when clicking action buttons
            actions.addEventListener('click', (ev) => ev.stopPropagation());

            li.appendChild(checkbox);
            li.appendChild(noteTitle);
            li.appendChild(actions);

            noteList.appendChild(li);
        });
    };

    // Search should always operate on the latest stored notes
    noteSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const current = allNotes[extension.id] || [];
        const filteredNotes = current.filter(note => 
            (note.title || '').toLowerCase().includes(query) || (note.content || '').toLowerCase().includes(query)
        );
        extNotes = current; // refresh our local reference
        renderNotes(filteredNotes);
    });

    // initial render from up-to-date stored notes
    extNotes = allNotes[extension.id] || [];
    renderNotes(extNotes);

    const backBtn = document.createElement('button');
    backBtn.className = 'modcore-back-btn';
    backBtn.setAttribute('aria-label', 'Back to extensions list');
    const backImg = document.createElement('img');
    backImg.src = '../../public/icons/svg/arrow-left.svg';
    backImg.alt = 'Back';
    backBtn.appendChild(backImg);
    backBtn.addEventListener('click', () => {
        const openOverlay = document.querySelector('.modcore-modal-overlay.open');
        if (openOverlay) openOverlay.remove();
        showNotesModal();
    });

    const headerExtras = document.createElement('div');
    headerExtras.className = 'modcore-modal-header-nav';
    headerExtras.appendChild(backBtn);
    
    createModal(`Notes for ${extension.name}`, content, true, headerExtras);
}

function showNoteViewer(extension, note, allNotes) {
    const viewContent = document.createElement('div');
    viewContent.className = 'modcore-view-note-content';
    const titleHeading = document.createElement('h3');
    titleHeading.textContent = note.title;
    const contentText = document.createElement('p');
    contentText.textContent = note.content;
    viewContent.appendChild(titleHeading);
    viewContent.appendChild(contentText);

    const backBtn = document.createElement('button');
    backBtn.className = 'modcore-back-btn';
    backBtn.setAttribute('aria-label', 'Back to notes list');
    const backImg = document.createElement('img');
    backImg.src = '../../public/icons/svg/arrow-left.svg';
    backImg.alt = 'Back';
    backBtn.appendChild(backImg);
    backBtn.addEventListener('click', () => {
        document.querySelector('.modcore-modal-overlay.open').remove();
        showNoteEditorModal(extension, allNotes);
    });

    const headerExtras = document.createElement('div');
    headerExtras.className = 'modcore-modal-header-nav';
    headerExtras.appendChild(backBtn);

    createModal(`Viewing Note`, viewContent, true, headerExtras);
}


function openNoteForm(extension, allNotes, note = null) {
    const formContent = document.createElement('div');
    formContent.className = 'modcore-note-form-container modcore-note-form';
    
    const introText = document.createElement('p');
    introText.textContent = note ? 'Edit your note details below.' : 'Add a new note to help you remember important information about this extension.';
    formContent.appendChild(introText);
    
    const titleGroup = document.createElement('div');
    titleGroup.className = 'form-group';
    const titleLabel = document.createElement('label');
    titleLabel.setAttribute('for', 'note-title-input');
    titleLabel.textContent = 'Note Title (required)';
    const titleInput = document.createElement('input');
    titleInput.id = 'note-title-input';
    titleInput.type = 'text';
    titleInput.value = note ? note.title : '';
    titleInput.placeholder = 'e.g., "Extension login details"';
    titleInput.className = 'modcore-note-input modcore-profile-ui';
    titleGroup.appendChild(titleLabel);
    titleGroup.appendChild(titleInput);
    
    const contentGroup = document.createElement('div');
    contentGroup.className = 'form-group';
    const contentLabel = document.createElement('label');
    contentLabel.setAttribute('for', 'note-content-textarea');
    contentLabel.textContent = 'Note Content';
    const contentTextarea = document.createElement('textarea');
    contentTextarea.id = 'note-content-textarea';
    contentTextarea.value = note ? note.content : '';
    contentTextarea.placeholder = 'Write your notes here...';
    contentTextarea.className = 'modcore-note-textarea modcore-profile-ui';
    contentGroup.appendChild(contentLabel);
    contentGroup.appendChild(contentTextarea);

    // Ensure the container carries the editor modal class so dark-mode rules targeting
    // .modcore-note-editor-modal are applied as well.
    formContent.className = (formContent.className ? formContent.className + ' ' : '') + 'modcore-note-editor-modal modcore-profile-ui';

    const saveNoteBtn = document.createElement('button');
    saveNoteBtn.className = 'modcore-btn modcore-btn-primary';
    saveNoteBtn.textContent = note ? 'Save Changes' : 'Add Note';
    saveNoteBtn.addEventListener('click', async () => {
        if (titleInput.value.trim() === '') {
            showToast('Note title cannot be empty.');
            return;
        }

        const extNotes = allNotes[extension.id] || [];
        if (note) {
            const existingNote = extNotes.find(n => n.id === note.id);
            if (existingNote) {
                existingNote.title = titleInput.value;
                existingNote.content = contentTextarea.value;
            }
        } else {
            // New notes get a unique ID and are unpinned by default
            extNotes.push({ id: Date.now(), title: titleInput.value, content: contentTextarea.value, isPinned: false });
            allNotes[extension.id] = extNotes;
        }

        await saveExtensionNotes(allNotes);
        showToast('Note saved!');
        
        // Close the form and re-render the editor to show the new/updated note
        document.querySelector('.modcore-modal-overlay.open').remove();
        showNoteEditorModal(extension, allNotes);
    });

    formContent.appendChild(titleGroup);
    formContent.appendChild(contentGroup);
    formContent.appendChild(saveNoteBtn);
    
    createModal(note ? 'Edit Note' : 'Add New Note', formContent);
}


// Initialize the System
initProfileCards();
