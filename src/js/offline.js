// --- Global State and Helper Variables ---
let modalTriggerElement = null; // To store the element that opened the modal for focus return
let lastOnlineState = navigator.onLine; // Browser's reported state
let isUIActive = false; // Tracks if the banner or modal is currently visible

// --- Helper Functions ---

/**
 * Checks if the browser reports being offline.
 * Note: navigator.onLine can be unreliable.
 */
function isOffline() {
    return !navigator.onLine;
}

/**
 * Gets a list of focusable elements within a container.
 * @param {Element} container
 * @returns {NodeList}
 */
function getFocusableElements(container) {
    return container.querySelectorAll(
        'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
    );
}

/**
 * Applies i18n messages to elements with `data-i18n` attributes.
 * @param {HTMLElement} container
 */
function applyI18n(container) {
    container.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            el.textContent = message;
        }
    });

    // Handle attributes like title and aria-label
    container.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            el.title = message;
            el.setAttribute('aria-label', message);
        }
    });
}

// --- Element Creation Functions ---

/**
 * Creates the offline banner element structure.
 * @returns {HTMLDivElement}
 */
function createOfflineBannerElement() {
    const offlineBanner = document.createElement("div");
    offlineBanner.id = "offline-banner";
    offlineBanner.setAttribute('role', 'alert');
    offlineBanner.setAttribute('aria-live', 'polite');
    offlineBanner.classList.add('offline-detector-ui');

    const span = document.createElement("span");
    span.setAttribute('data-i18n', 'offlineBannerMessage');
    offlineBanner.appendChild(span);

    const helpIcon = document.createElement("img");
    helpIcon.id = "offline-help-icon";
    helpIcon.className = "offline-icon";
    helpIcon.src = chrome.runtime.getURL("../../public/icons/svg/info.svg");
    helpIcon.setAttribute('tabindex', '0');
    helpIcon.setAttribute('data-i18n-title', 'offlineHelpIconTitle');
    helpIcon.ondragstart = function() { return false; };
    offlineBanner.appendChild(helpIcon);

    const dismissButton = document.createElement("button");
    dismissButton.id = "dismiss-offline-banner";
    dismissButton.setAttribute('data-i18n', 'offlineDismissButton');
    offlineBanner.appendChild(dismissButton);

    // Apply i18n messages
    applyI18n(offlineBanner);

    // Add listeners
    helpIcon.addEventListener("click", () => {
        modalTriggerElement = helpIcon;
        showHelpModal();
    });
    helpIcon.addEventListener("keydown", (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            modalTriggerElement = helpIcon;
            showHelpModal();
        }
    });
    dismissButton.addEventListener("click", removeOfflineBanner);

    return offlineBanner;
}

/**
 * Creates the help modal element structure.
 * @returns {HTMLDivElement}
 */
function createHelpModalElement() {
    const helpModal = document.createElement("div");
    helpModal.id = "offline-help-modal";
    helpModal.setAttribute('role', 'dialog');
    helpModal.setAttribute('aria-modal', 'true');
    helpModal.setAttribute('aria-labelledby', 'offline-modal-title');
    helpModal.classList.add('offline-detector-ui');

    const modalContent = document.createElement("div");
    modalContent.id = "offline-help-modal-content";

    const title = document.createElement("h2");
    title.id = "offline-modal-title";
    title.setAttribute('data-i18n', 'modalTitle');
    modalContent.appendChild(title);

    const introP = document.createElement("p");
    introP.setAttribute('data-i18n', 'modalIntroText');
    modalContent.appendChild(introP);

    const ol = document.createElement("ol");
    [
        'step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7'
    ].forEach(key => {
        const li = document.createElement("li");
        const strong = document.createElement("strong");
        strong.setAttribute('data-i18n', key);
        li.appendChild(strong);
        ol.appendChild(li);
    });
    modalContent.appendChild(ol);

    const closeButton = document.createElement("button");
    closeButton.id = "close-offline-help";
    closeButton.className = "button-primary";
    closeButton.setAttribute('data-i18n', 'modalCloseButton');
    modalContent.appendChild(closeButton);

    helpModal.appendChild(modalContent);

    // Apply i18n messages
    applyI18n(helpModal);

    // Add close listeners
    closeButton.addEventListener("click", hideHelpModal);
    helpModal.addEventListener("click", (event) => {
        if (event.target === helpModal) {
            hideHelpModal();
        }
    });
    helpModal.addEventListener('keydown', handleModalKeydown);

    return helpModal;
}

// --- Banner Functions ---

/**
 * Applies or shows the offline banner.
 */
function applyOfflineBanner() {
    let offlineBanner = document.getElementById("offline-banner");
    if (!offlineBanner && document.body) {
        offlineBanner = createOfflineBannerElement();
        document.body.prepend(offlineBanner);
    }
    if (offlineBanner && !isUIActive) {
        offlineBanner.style.display = 'flex';
        offlineBanner.classList.add('is-visible');
        void offlineBanner.offsetWidth; // Force reflow
        isUIActive = true;
    }
}

/**
 * Removes or hides the offline banner.
 */
function removeOfflineBanner() {
    const offlineBanner = document.getElementById("offline-banner");
    if (offlineBanner) {
        offlineBanner.classList.remove('is-visible');
        offlineBanner.addEventListener('transitionend', function handler(event) {
            if (event.propertyName === 'opacity') {
                offlineBanner.style.display = 'none';
                offlineBanner.removeEventListener('transitionend', handler);
                isUIActive = false;
            }
        }, { once: true });
    }
}

// --- Modal Functions ---

/**
 * Shows the help modal. Creates it if it doesn't exist. Handles focus.
 */
function showHelpModal() {
    let helpModal = document.getElementById("offline-help-modal");
    if (!helpModal && document.body) {
        helpModal = createHelpModalElement();
        document.body.appendChild(helpModal);
    }
    if (helpModal) {
        helpModal.classList.add('is-visible');
        helpModal.style.display = 'flex';
        void helpModal.offsetWidth; // Force reflow
        isUIActive = true;
        setTimeout(() => {
            const firstFocusable = helpModal.querySelector('#close-offline-help');
            if (firstFocusable) {
                firstFocusable.focus();
            }
        }, 50);
    }
}

/**
 * Hides the help modal. Returns focus to the trigger element.
 */
function hideHelpModal() {
    const helpModal = document.getElementById("offline-help-modal");
    if (helpModal) {
        helpModal.classList.remove('is-visible');
        helpModal.addEventListener('transitionend', function handler(event) {
            if (event.propertyName === 'opacity') {
                helpModal.style.display = 'none';
                helpModal.removeEventListener('transitionend', handler);
                isUIActive = false;
                if (modalTriggerElement && typeof modalTriggerElement.focus === 'function') {
                    modalTriggerElement.focus();
                }
            }
        }, { once: true });
    }
}

/**
 * Handles keydown events on the modal for focus trap and escape key.
 * @param {KeyboardEvent} event
 */
function handleModalKeydown(event) {
    const helpModal = document.getElementById("offline-help-modal");
    if (!helpModal || !helpModal.classList.contains('is-visible')) {
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        hideHelpModal();
        return;
    }
    if (event.key === 'Tab') {
        const focusable = getFocusableElements(helpModal);
        if (focusable.length === 0) {
            event.preventDefault();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeElement = document.activeElement;
        if (event.shiftKey) { // Shift + Tab
            if (activeElement === first || !helpModal.contains(activeElement)) {
                last.focus();
                event.preventDefault();
            }
        } else { // Tab
            if (activeElement === last || !helpModal.contains(activeElement)) {
                first.focus();
                event.preventDefault();
            }
        }
    }
}

// --- Temporary Message / Toast Function ---
/**
 * Shows a small temporary message (like a toast).
 * @param {string} messageKey - The i18n message key to display.
 * @param {number} duration - How long to display the message in milliseconds.
 */
function showTemporaryMessage(messageKey, duration = 4000) {
    let messageElement = document.getElementById("temporary-status-message");
    if (!messageElement && document.body) {
        messageElement = document.createElement("div");
        messageElement.id = "temporary-status-message";
        messageElement.classList.add('offline-detector-ui');
        document.body.appendChild(messageElement);
        messageElement.addEventListener('transitionend', function handler(event) {
            if (event.propertyName === 'opacity' && !messageElement.classList.contains('is-visible')) {
                messageElement.style.display = 'none';
            }
        });
    }
    if (messageElement) {
        if (messageElement._currentTimer) {
            clearTimeout(messageElement._currentTimer);
        }
        messageElement.textContent = chrome.i18n.getMessage(messageKey);
        messageElement.style.display = 'block';
        void messageElement.offsetWidth; // Force reflow
        messageElement.classList.add('is-visible');
        messageElement._currentTimer = setTimeout(() => {
            messageElement.classList.remove('is-visible');
        }, duration);
    }
}


// --- CSS Injection and Main Initialization ---

function injectOfflineDetectorCSS() {
    if (document.getElementById('offline-detector-styles')) {
        return;
    }
    const style = document.createElement('style');
    style.id = 'offline-detector-styles';
    style.textContent = `
        :root {
            --offline-banner-bg: #fff3cd;
            --offline-banner-color: #664d03;
            --offline-banner-border: #ffecb5;
            --offline-modal-overlay-bg: rgba(0, 0, 0, 0.6);
            --offline-modal-content-bg: #ffffff;
            --offline-modal-content-color: #333;
            --offline-modal-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
            --button-default-bg: #e9ecef;
            --button-default-color: #333;
            --button-default-border: #ced4da;
            --button-primary-bg: #007bff;
            --button-primary-color: white;
            --temporary-message-bg: rgba(50, 50, 50, 0.95);
            --temporary-message-color: white;
            --font-family: 'modcore-inter-font-custom', sans-serif;
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --offline-banner-bg: #7a6000;
                --offline-banner-color: #ffecb5;
                --offline-banner-border: #997d00;
                --offline-modal-overlay-bg: rgba(0, 0, 0, 0.85);
                --offline-modal-content-bg: #343a40;
                --offline-modal-content-color: #dee2e6;
                --offline-modal-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
                --button-default-bg: #495057;
                --button-default-color: #dee2e6;
                --button-default-border: #6c757d;
                --button-primary-bg: #0056b3;
                --temporary-message-bg: rgba(220, 220, 220, 0.95);
                --temporary-message-color: #333;
            }
            #offline-banner .offline-icon { filter: invert(100%); }
        }
        @media (prefers-reduced-motion: reduce) {
            #offline-banner, #offline-help-modal, #temporary-status-message { transition: none !important; }
        }
        #offline-banner {
            position: fixed; top: 0; left: 0; width: 100%; box-sizing: border-box;
            padding: 8px 15px; text-align: center; z-index: 99999;
            background-color: var(--offline-banner-bg); color: var(--offline-banner-color);
            border-bottom: 1px solid var(--offline-banner-border);
            font-family: sans-serif; font-size: 14px; line-height: 1.5;
            display: none; align-items: center; justify-content: center; gap: 10px;
            opacity: 0; visibility: hidden; transition: opacity 0.3s ease-in-out, visibility 0.3s ease-in-out;
        }
        #offline-banner.is-visible { opacity: 1; visibility: visible; display: flex !important; }
        #offline-banner .offline-icon { width: 18px; height: 18px; cursor: pointer; flex-shrink: 0; transition: filter 0.3s ease-in-out; }
        #offline-banner button {
            font-family: var(--font-family);
            padding: 3px 10px; cursor: pointer; border: 1px solid var(--button-default-border);
            background: var(--button-default-bg); color: var(--button-default-color);
            border-radius: 10px; font-size: 13px; flex-shrink: 0;
            transition: background-color 0.2s;
        }
        #offline-help-modal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: var(--offline-modal-overlay-bg); z-index: 100000;
            display: none; justify-content: center; align-items: center;
            opacity: 0; visibility: hidden; transition: opacity 0.3s ease-in-out;
            padding: 20px;
        }
        #offline-help-modal.is-visible { opacity: 1; visibility: visible; display: flex !important; }
        #offline-help-modal-content {
            background-color: var(--offline-modal-content-bg); color: var(--offline-modal-content-color);
            padding: 25px; border-radius: 8px; box-shadow: var(--offline-modal-shadow);
            width: 95%; max-width: 450px;
            transform: scale(0.95); transition: transform 0.3s ease-in-out;
        }
        #offline-help-modal.is-visible #offline-help-modal-content { transform: scale(1); }
        #offline-help-modal-content h2 { font-size: 1.4em; margin-top: 0; margin-bottom: 15px; }
        #offline-help-modal-content p { font-size: 0.95em; margin-bottom: 15px; }
        #offline-help-modal-content ol { padding-left: 20px; margin-bottom: 20px; }
        #offline-help-modal-content li { margin-bottom: 8px; font-size: 0.95em; }
        #offline-help-modal-content button {
            font-family: var(--font-family);
            display: block; width: 100%; padding: 10px; margin-top: 20px;
            cursor: pointer; border-radius: 16px; font-size: 15px; 
            background-color: var(--button-primary-bg); color: var(--button-primary-color);
            border: 1px solid var(--button-primary-bg); transition: background-color 0.2s, border-color 0.2s;
        }
        #temporary-status-message {
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            padding: 10px 20px; background-color: var(--temporary-message-bg);
            color: var(--temporary-message-color); border-radius: 5px; z-index: 100001;
            opacity: 0; visibility: hidden; transition: opacity 0.3s ease-in-out;
            font-size: 14px;
        }
        #temporary-status-message.is-visible { opacity: 1; visibility: visible; }
    `;
    document.head.appendChild(style);
}

document.addEventListener("DOMContentLoaded", () => {
    injectOfflineDetectorCSS();
    if (isOffline()) {
        applyOfflineBanner();
        lastOnlineState = false;
    } else {
        lastOnlineState = true;
    }
    window.addEventListener("online", () => {
        setTimeout(() => {
            if (!isOffline() && !lastOnlineState) {
                lastOnlineState = true;
                removeOfflineBanner();
                setTimeout(() => { showTemporaryMessage('temporaryOnlineMessage'); }, 300);
            }
        }, 500);
    });
    window.addEventListener("offline", () => {
        setTimeout(() => {
            if (isOffline() && lastOnlineState) {
                lastOnlineState = false;
                applyOfflineBanner();
            }
        }, 500);
    });
});
