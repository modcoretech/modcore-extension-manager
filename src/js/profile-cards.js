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
    firstUse: new Date().toISOString()
};

// --- Badge Milestones & Data ---
const BADGES = {
    install_5: { name: 'Apprentice', description: 'Installed 5 extensions.' },
    install_10: { name: 'Initiate', description: 'Installed 10 extensions.' },
    install_20: { name: 'Master', description: 'Installed 20 extensions.' },
    enabled_10: { name: 'Enabler', description: 'Enabled 10 extensions.' },
    disabled_10: { name: 'Restrainer', description: 'Disabled 10 extensions.' },
    first_profile: { name: 'Pioneer', description: 'Created your first profile.' }
};

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
    .modcore-profile-ui h2, .modcore-profile-ui h4 {
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
        border-radius: 6px;
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
    }
    .modcore-modal-overlay.open {
        opacity: 1;
        pointer-events: auto;
    }
    .modcore-modal-content {
        background: #fff;
        padding: 24px;
        border-radius: 12px;
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
    }
    .modcore-modal-header h2 { margin: 0; font-size: 20px; }
    .modcore-modal-header .modcore-close-btn { background: none; border: none; cursor: pointer; padding: 0; width: 24px; height: 24px; flex-shrink: 0;}
    .modcore-modal-header .modcore-close-btn img { filter: none; transition: filter 0.3s ease; }
    
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
        border-radius: 8px;
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
        border-radius: 6px;
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
        border-radius: 10px;
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
        border-radius: 6px;
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
        border-radius: 8px;
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
        gap: 20px;
        flex-wrap: wrap;
    }
    .modcore-notes-sidebar {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 250px;
    }
    .modcore-notes-search {
        width: 100%;
        padding: 8px;
        border: 1px solid #ccc;
        border-radius: 6px;
    }
    .modcore-notes-list {
        list-style: none;
        padding: 0;
        margin: 0;
        flex-grow: 1;
        overflow-y: auto;
        border: 1px solid #e9ecef;
        border-radius: 6px;
        max-height: 400px;
    }
    .modcore-notes-list li {
        padding: 10px;
        cursor: pointer;
        transition: background-color 0.2s ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .modcore-notes-list li:hover { background-color: #f8f9fa; }
    .modcore-notes-list li.selected { background-color: #e9ecef; }
    .modcore-notes-list li strong { display: block; }
    .modcore-notes-list li span { display: block; font-size: 12px; color: #6c757d; margin-top: 4px; }
    .modcore-note-editor {
        flex: 2;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .modcore-note-editor textarea {
        width: 100%;
        min-height: 250px; /* Fixed size */
        padding: 10px;
        border: 1px solid #ccc;
        border-radius: 6px;
        resize: vertical;
        box-sizing: border-box;
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
        border-radius: 8px;
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
        max-width: 800px;
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
    }
    .modcore-toast.show {
        opacity: 1;
        visibility: visible;
    }

    /* Responsive adjustments */
    @media (max-width: 768px) {
        .modcore-notes-container {
            flex-direction: column;
        }
    }

    /* --- 🌑 DARK MODE STYLES 🌑 --- */
    @media (prefers-color-scheme: dark) {
        /* General Overrides */
        .modcore-profile-ui,
        .modcore-profile-ui h2, .modcore-profile-ui h4,
        .modcore-profile-ui button,
        .modcore-profile-ui .modcore-toast,
        .modcore-badge-card {
            color: #e0e0e0;
        }

        .modcore-profile-avatar-fallback {
            filter: invert(1) grayscale(100%) brightness(150%);
        }

        /* Buttons */
        .modcore-btn-secondary { background-color: #3a3b3c; color: #e0e0e0; }
        .modcore-btn-secondary:hover { background-color: #48494a; }
        .modcore-btn-text { color: #adb5bd; }
        .modcore-btn-text:hover { color: #e0e0e0; }
        
        /* Modals & Dropdown */
        .modcore-modal-content,
        .modcore-profile-dropdown {
            background: #1e1e1e;
            box-shadow: 0 0 20px rgba(0,0,0,0.5);
            border: 1px solid #333;
        }
        .modcore-modal-header .modcore-close-btn img { filter: invert(1); }
        .modcore-profile-dropdown hr, .modcore-profile-popup hr, .modcore-modal-content hr {
            border-top-color: #3e3e3e;
        }

        /* Profile Dropdown */
        .modcore-profile-dropdown button { color: #e0e0e0; }
        .modcore-profile-dropdown button:hover { background-color: #3a3b3c; }
        .modcore-profile-header { border-bottom-color: #3e3e3e; }
        .modcore-profile-header .modcore-stats-summary { color: #adb5bd; }

        /* Onboarding / Customize Form */
        .modcore-profile-popup input[type="text"] {
            background: #3a3b3c;
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
            background-color: #2c2c2e;
            color: #e0e0e0;
            border: 1px solid #3e3e3e;
        }
        .modcore-stats-list li:hover { background-color: #3a3b3c; }
        .modcore-stats-list li strong { color: #63a6f1; }
        .modcore-stats-list li small { color: #c5c5c7; }

        /* Badges Modal */
        .modcore-badge-icon { 
            background: #3a3b3c; 
            border-color: #555; 
            color: #e0e0e0; 
        }

        /* Quick Actions & Quick Links Modals */
        .modcore-quick-actions-grid button, 
        .modcore-quick-links-grid a { 
            background: #2c2c2e; 
            border-color: #3e3e3e; 
            color: #e0e0e0; 
        }
        .modcore-quick-actions-grid button:hover, 
        .modcore-quick-links-grid a:hover {
            background: #3a3b3c;
        }
        .modcore-quick-actions-grid button small, 
        .modcore-quick-links-grid a small { 
            color: #adb5bd;
        } 

        /* Extension Notes Modal */
        .modcore-notes-search,
        .modcore-note-editor textarea {
            background: #3a3b3c;
            border-color: #555;
            color: #e0e0e0;
        }
        .modcore-note-editor label { color: #e0e0e0; }
        .modcore-notes-list { 
            border-color: #3e3e3e; 
            background: #2c2c2e; 
        }
        .modcore-notes-list li { color: #e0e0e0; }
        .modcore-notes-list li:hover { background-color: #3a3b3c; }
        .modcore-notes-list li.selected { background-color: #007bff; color: #fff; } /* Higher contrast selected */
        .modcore-notes-list li.selected span, .modcore-notes-list li.selected strong { color: #fff; }
        .modcore-notes-list li span { color: #adb5bd; }
    }
`;

// --- Helper Functions ---
function showToast(message, duration = 3000) {
    const existingToast = document.querySelector('.modcore-toast');
    if (existingToast) existingToast.remove();
    
    const toast = document.createElement('div');
    toast.className = 'modcore-toast modcore-profile-ui';
    toast.textContent = message;
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

function resizeImage(file) {
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
                resolve(canvas.toDataURL('image/jpeg', 0.8));
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

function createModal(title, contentElement, isWide = false) {
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
    const titleEl = document.createElement('h2');
    titleEl.textContent = title;
    header.appendChild(titleEl);
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modcore-close-btn';
    closeBtn.setAttribute('aria-label', 'Close dialog');
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
}

function getBadgesContent(profile) {
    const content = document.createElement('div');
    const intro = document.createElement('p');
    intro.textContent = 'Badges are unlocked for reaching certain milestones. Keep exploring to earn more!';
    content.appendChild(intro);

    const badgesGrid = document.createElement('div');
    badgesGrid.className = 'modcore-badges-grid';

    Object.keys(BADGES).forEach(badgeKey => {
        const badgeDiv = document.createElement('div');
        const isUnlocked = profile.badges.includes(badgeKey);
        badgeDiv.className = `modcore-badge-card ${isUnlocked ? 'unlocked' : ''}`;

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

function getStatsContent(profile) {
    const content = document.createElement('div');
    const intro = document.createElement('p');
    intro.textContent = 'A snapshot of your usage and activity in modcore Extension Manager.';
    content.appendChild(intro);

    const statsList = document.createElement('ul');
    statsList.className = 'modcore-stats-list';

    const items = [
        { label: 'Installed Extensions', value: profile.stats.extensionsInstalled },
        { label: 'Enabled Extensions', value: profile.stats.extensionsEnabled },
        { label: 'Disabled Extensions', value: profile.stats.extensionsDisabled },
        { label: 'Badges Unlocked', value: profile.badges.length },
        { label: 'First Use', value: getFormattedDate(profile.stats.profileCreation) }
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

    let profile = await getProfile();
    profile = await updateExtensionStats(profile);
    
    if (!profile.stats.profileCreation) {
        showOnboarding(true, profile);
    } else {
        createProfileDropdown(profile);
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
}

async function getProfile() {
    return new Promise((resolve) => {
        chrome.storage.local.get([PROFILE_STORAGE_KEY], (result) => {
            resolve(result[PROFILE_STORAGE_KEY] || { ...defaultProfile });
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

async function saveExtensionNotes(notes) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [EXTENSION_NOTES_STORAGE_KEY]: notes }, () => resolve());
    });
}

async function updateExtensionStats(profile) {
    try {
        const extensions = await new Promise((resolve) => {
            chrome.management.getAll((exts) => resolve(exts.filter(ext => !ext.isApp && !ext.id.includes('modcore'))));
        });
        profile.stats.extensionsInstalled = extensions.length;
        profile.stats.extensionsEnabled = extensions.filter(ext => ext.enabled).length;
        profile.stats.extensionsDisabled = extensions.filter(ext => !ext.enabled).length;

        const unlockedBadges = new Set(profile.badges);
        if (profile.stats.profileCreation) unlockedBadges.add('first_profile');
        if (profile.stats.extensionsInstalled >= 5) unlockedBadges.add('install_5');
        if (profile.stats.extensionsInstalled >= 10) unlockedBadges.add('install_10');
        if (profile.stats.extensionsInstalled >= 20) unlockedBadges.add('install_20');
        if (profile.stats.extensionsEnabled >= 10) unlockedBadges.add('enabled_10');
        if (profile.stats.extensionsDisabled >= 10) unlockedBadges.add('disabled_10');
        profile.badges = Array.from(unlockedBadges);

        await saveProfile(profile);
        return profile;
    } catch (e) {
        console.error("Failed to get extension stats:", e);
        return profile;
    }
}

async function toggleAllExtensions(profile, enableState = null) {
    try {
        const extensions = await new Promise(resolve => chrome.management.getAll(resolve));
        const modcoreId = chrome.runtime.id;
        const extensionsToToggle = extensions.filter(ext => ext.id !== modcoreId && !ext.isApp);
        
        let targetState = enableState;
        let actionMessage = '';

        if (targetState === null) { // This is the "Toggle All" case
            const allEnabled = extensionsToToggle.every(ext => ext.enabled);
            if (allEnabled) {
                targetState = false; // If all are on, turn them off
            } else {
                targetState = true; // Otherwise, turn them all on (simplest toggle logic)
            }
        }
        
        actionMessage = `All extensions have been ${targetState ? 'enabled' : 'disabled'}.`;

        for (const ext of extensionsToToggle) {
            if (ext.enabled !== targetState) {
                try {
                    await chrome.management.setEnabled(ext.id, targetState);
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
        await saveProfile({ ...defaultProfile });
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
    bannerText.textContent = 'This is not an account creation. Your data is stored locally and is completely secure.';
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

    if (isInitialOnboarding) {
        const importBtn = document.createElement('button');
        importBtn.className = 'modcore-btn modcore-btn-text';
        importBtn.textContent = 'Import Profile';
        importBtn.addEventListener('click', (e) => { e.preventDefault(); importProfile(); });
        actions.appendChild(importBtn);
    } else {
        const exportBtn = document.createElement('button');
        exportBtn.className = 'modcore-btn modcore-btn-text';
        exportBtn.textContent = 'Export Profile';
        exportBtn.addEventListener('click', (e) => { e.preventDefault(); exportProfile(profile); });
        actions.appendChild(exportBtn);
    }
    
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
    usernameInput.focus();

    avatarBtn.addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', async () => {
        if (avatarInput.files && avatarInput.files[0]) {
            try {
                const resizedDataUrl = await resizeImage(avatarInput.files[0]);
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
            
            let avatar = avatarPreview.src; // Start with the current preview
            if (avatar.startsWith('file:') || avatar.endsWith('.svg')) { // Don't save default icon
                avatar = profile.avatar; // Keep old avatar if no new one is chosen
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
            createProfileDropdown(newProfile); // Re-create dropdown with new info
            showToast('Profile saved!');
        } catch (e) {
            showToast('Failed to save profile.');
            console.error('Save profile error:', e);
        }
    });
}

function createProfileDropdown(profile) {
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
    const truncatedUsername = profile.username.length > 15 ? profile.username.substring(0, 15) + '...' : profile.username;
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
    notesBtn.addEventListener('click', () => showNotesModal(profile));
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
    statsBtn.addEventListener('click', () => createModal('Profile Stats', getStatsContent(profile)));
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
    intro.textContent = 'Easily manage and control your extensions with these quick actions.';
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

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = 'Toggle All';
    const toggleInfo = document.createElement('small');
    toggleInfo.textContent = 'Flip enabled state of extensions.';
    toggleBtn.appendChild(toggleInfo);
    toggleBtn.addEventListener('click', () => toggleAllExtensions(profile));
    actionsGrid.appendChild(toggleBtn);


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
        { name: 'TrustGuard', url: 'trustguard.html' },
        { name: 'Backup & Restore', url: 'backup_restore.html' },
        { name: 'Extension Activity Log', url: 'history.html' },
        { name: 'Automation Rules', url: 'rules.html' },
    ];

    generalLinks.forEach(link => {
        const a = document.createElement('a');
        a.href = link.url;
        a.textContent = link.name;
        a.className = 'modcore-btn modcore-btn-secondary';
        a.target = '_blank';
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
        { name: 'Donate & Support', url: 'https://sites.google.com/view/ng-extension-manager/general-info/donations' },
    ];
    
    extraLinks.forEach(link => {
        const a = document.createElement('a');
        a.href = link.url;
        a.textContent = link.name;
        a.className = 'modcore-btn modcore-btn-secondary';
        a.target = '_blank';
        extraGrid.appendChild(a);
    });

    extraSection.appendChild(extraHeader);
    extraSection.appendChild(extraGrid);
    content.appendChild(extraSection);

    createModal('Quick Links', content, true);
}


async function showNotesModal(profile) {
    const extensions = await new Promise(resolve => chrome.management.getAll(resolve));
    const notes = await getExtensionNotes();
    const sortedExtensions = extensions.sort((a, b) => a.name.localeCompare(b.name));

    const content = document.createElement('div');
    content.className = 'modcore-notes-container';

    const sidebar = document.createElement('div');
    sidebar.className = 'modcore-notes-sidebar';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search extensions...';
    searchInput.className = 'modcore-notes-search';
    const extensionList = document.createElement('ul');
    extensionList.className = 'modcore-notes-list';
    sidebar.appendChild(searchInput);
    sidebar.appendChild(extensionList);
    content.appendChild(sidebar);

    const editorContainer = document.createElement('div');
    editorContainer.className = 'modcore-note-editor';
    const noteLabel = document.createElement('label');
    noteLabel.textContent = 'Note for: (select extension)';
    const noteTextarea = document.createElement('textarea');
    noteTextarea.placeholder = 'Write your notes here...';
    noteTextarea.setAttribute('aria-label', 'Extension notes');
    const saveBtn = document.createElement('button');
    saveBtn.className = 'modcore-btn modcore-btn-primary';
    saveBtn.textContent = 'Save Note';
    editorContainer.appendChild(noteLabel);
    editorContainer.appendChild(noteTextarea);
    editorContainer.appendChild(saveBtn);
    content.appendChild(editorContainer);
    
    let selectedExtId = null;

    const renderList = (extensionsToRender) => {
        extensionList.innerHTML = '';
        extensionsToRender.forEach(ext => {
            const li = document.createElement('li');
            li.setAttribute('data-extension-id', ext.id);
            li.setAttribute('role', 'option');
            const extName = document.createElement('strong');
            extName.textContent = ext.name.length > 25 ? ext.name.substring(0, 25) + '...' : ext.name;
            const notePreview = document.createElement('span');
            notePreview.textContent = notes[ext.id] ? notes[ext.id].substring(0, 50) + '...' : 'No note yet';
            li.appendChild(extName);
            li.appendChild(notePreview);
            li.addEventListener('click', () => {
                document.querySelectorAll('.modcore-notes-list li').forEach(item => item.classList.remove('selected'));
                li.classList.add('selected');
                selectedExtId = ext.id;
                noteLabel.textContent = `Note for: ${ext.name}`;
                noteTextarea.value = notes[ext.id] || '';
                noteTextarea.focus();
            });
            extensionList.appendChild(li);
        });
    };

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filteredExtensions = sortedExtensions.filter(ext => ext.name.toLowerCase().includes(query));
        renderList(filteredExtensions);
    });

    saveBtn.addEventListener('click', async () => {
        if (!selectedExtId) {
            showToast('Please select an extension first.');
            return;
        }
        try {
            const newNotes = await getExtensionNotes();
            newNotes[selectedExtId] = noteTextarea.value;
            await saveExtensionNotes(newNotes);
            showToast('Note saved!');
            
            const notePreview = document.querySelector(`.modcore-notes-list li[data-extension-id="${selectedExtId}"] span`);
            if (notePreview) {
                notePreview.textContent = noteTextarea.value ? noteTextarea.value.substring(0, 50) + '...' : 'No note yet';
            }
        } catch (e) {
            showToast('Error saving note.');
            console.error('Save note error:', e);
        }
    });

    renderList(sortedExtensions);
    createModal('Extension Notes', content);
}

// Initialize the System
initProfileCards();
