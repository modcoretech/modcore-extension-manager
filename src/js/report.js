// report.js

/**
 * Global variable for the main modal element.
 * @type {HTMLElement|null}
 */
let reportDialogElement = null;

/**
 * Configuration for the GitHub repository.
 */
const GITHUB_REPO_OWNER = 'modcoretech';
const GITHUB_REPO_NAME = 'modcore-extension-manager';
const GITHUB_BASE_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/new`;
const TOTAL_STEPS = 3;

/**
 * Conversational Issue templates to guide the user and format the GitHub issue.
 * The 'description' now includes a more helpful, conversational name.
 */
const ISSUE_TEMPLATES = {
    BUG: {
        name: '🐛 Something is broken (Bug Report)',
        titlePrefix: '[BUG]',
        label: 'bug',
        summaryPlaceholder: 'e.g., The settings button disappears on page reload.',
        descriptionPlaceholder: '1. What are the clear, repeatable steps to see the issue?\n2. What should have happened (expected result)?\n3. What actually happened (incorrect result)?',
        instructions: 'Crucial: Provide clear **steps to reproduce** the bug so we can fix it quickly.',
    },
    FEATURE: {
        name: '✨ I have an idea (Feature Suggestion)',
        titlePrefix: '[FEATURE]',
        label: 'enhancement',
        summaryPlaceholder: 'e.g., Add a dark mode toggle button.',
        descriptionPlaceholder: 'Describe the feature in detail. Why is it needed, and how would it improve the extension?',
        instructions: 'Clearly explain the **value and usage** of your suggestion.',
    },
    GENERAL: {
        name: '💬 General question or feedback',
        titlePrefix: '[FEEDBACK]',
        label: 'feedback',
        summaryPlaceholder: 'e.g., Question about installation process.',
        descriptionPlaceholder: 'Please provide your detailed question or general feedback here, including context.',
        instructions: 'Provide full context for your question or feedback.',
    }
};

/**
 * Creates a DOM element with specified tag, classes, and attributes.
 * @param {string} tag The HTML tag name.
 * @param {string} [className=''] Class names to apply.
 * @param {Object} [attributes={}] Attributes to set.
 * @returns {HTMLElement} The created element.
 */
function createElement(tag, className = '', attributes = {}) {
    const el = document.createElement(tag);
    if (className) {
        el.className = className;
    }
    for (const key in attributes) {
        if (attributes.hasOwnProperty(key)) {
            el.setAttribute(key, attributes[key]);
        }
    }
    return el;
}

/**
 * Fetches the extension version from the manifest.
 * @returns {string} The extension version, or 'N/A' if unavailable.
 */
function getExtensionVersion() {
    try {
        // Using optional chaining and nullish coalescing for cleaner error handling
        return chrome.runtime.getManifest()?.version ?? 'N/A';
    } catch (e) {
        return 'N/A';
    }
}

/**
 * Gathers enhanced technical information using modern browser APIs.
 * Includes more specific platform details and browser engine.
 * @returns {Promise<string>} A promise that resolves to a formatted string of technical details.
 */
async function getAccurateTechnicalInfo() {
    let browserName = 'N/A';
    let browserVersion = 'N/A';
    let browserEngine = 'N/A';
    let os = 'Unknown';
    let osVersion = 'N/A';
    const userAgent = navigator.userAgent;

    if (navigator.userAgentData) {
        try {
            // High entropy values provide more accurate and detailed client hints
            const highEntropyValues = await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion', 'fullVersionList', 'architecture']);
            
            os = highEntropyValues.platform || 'Unknown';
            osVersion = highEntropyValues.platformVersion || 'N/A';

            // Heuristic to determine the primary, non-spoofing browser brand
            const primaryBrowser = highEntropyValues.fullVersionList?.find(b => !b.brand.includes('Not')) || highEntropyValues.fullVersionList?.[0];
            if (primaryBrowser) {
                browserName = primaryBrowser.brand;
                browserVersion = primaryBrowser.version;
            }

        } catch (e) { /* Fallback to User Agent parsing */ }
    } else {
        // Basic fallback for older browsers without User-Agent Client Hints
        if (userAgent.includes('Win')) os = 'Windows';
        else if (userAgent.includes('Mac')) os = 'macOS';
        else if (userAgent.includes('Linux')) os = 'Linux';
    }

    // Attempt to determine rendering engine (will be an approximation)
    if (userAgent.includes('Chrome') || userAgent.includes('CriOS')) browserEngine = 'Blink';
    else if (userAgent.includes('Firefox')) browserEngine = 'Gecko';
    else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) browserEngine = 'WebKit';

    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
    const colorDepth = window.screen.colorDepth;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const pixelRatio = window.devicePixelRatio;
    const lang = navigator.language;
    const memory = navigator.deviceMemory ?? 'N/A'; // deviceMemory is non-standard but often available

    return `
### Technical Environment
| Detail | Value |
| :--- | :--- |
| **Extension Version** | \`${getExtensionVersion()}\` |
| **Current URL** | \`${window.location.href}\` |
| **Browser** | \`${browserName} (\`\`${browserVersion}\`\` \`\`${browserEngine}\`\`) |
| **Operating System** | \`${os} (\`\`${osVersion}\`\`) |
| **Device Memory (GB)** | \`${memory}\` |
| **Screen Resolution** | \`${screenWidth}x${screenHeight} (${colorDepth}bit) @ ${pixelRatio}x DPR\` |
| **Viewport Size** | \`${windowWidth}x${windowHeight}\` |
| **Language** | \`${lang}\` |
    `.trim();
}

/**
 * Creates the modal's HTML structure with styles and step-by-step logic.
 * @returns {HTMLElement} The complete dialog element.
 */
function createReportDialog() {
    // --- Styles for the Modal (Modern, Compact, Fixed Dark Mode) ---
    // Note: Styles are kept in a <style> tag for simplicity in a single file scenario.
    const style = createElement('style');
    style.textContent = `
        /* Theme variables (light defaults, overridden in dark mode) */
        .modcore-dialog-overlay {
            --mc-bg: #ffffff;
            --mc-text: #1a1a1a;
            --mc-accent: #007bff;
            --mc-surface: #f9f9f9;
            --mc-border: #ccc;
            --mc-note-bg: #f0f8ff;
            --mc-note-text: #1a1a1a;
            --mc-privacy-bg: #fff3cd;
            --mc-privacy-text: #856404;
            --mc-btn-secondary: #6c757d;
            --mc-btn-primary: #007bff;
            --mc-btn-success: #28a745;
            --mc-type-bg: #f9f9f9;
            --mc-type-border: #ccc;
        }

        /* Custom Font Specification */
        .modcore-dialog-overlay * {
            box-sizing: border-box;
            font-family: modcore-inter-font-custom, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
            line-height: 1.4;
        }

        /* Dialog Overlay and Transitions */
        .modcore-dialog-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.75);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 2147483647; 
            opacity: 0;
            transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .modcore-dialog-overlay.is-open { opacity: 1; }

        /* Dialog Content Box */
        .modcore-dialog-content {
            background-color: var(--mc-bg);
            color: var(--mc-text);
            padding: 20px;
            border-radius: 16px;
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
            width: 90%;
            max-width: 450px;
            max-height: 90vh;
            overflow-y: auto;
            transform: scale(0.98);
            transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s;
            opacity: 0;
        }
        .modcore-dialog-overlay.is-open .modcore-dialog-content {
            transform: scale(1);
            opacity: 1;
        }
        
        /* Reduced Motion support */
        @media (prefers-reduced-motion: reduce) {
            .modcore-dialog-overlay, .modcore-dialog-content, .modcore-form-step { 
                transition: none !important; 
                transform: none !important; 
                opacity: 1 !important; 
                animation: none !important;
            }
        }

        /* Dark Mode: override variables for consistent theming */
        @media (prefers-color-scheme: dark) {
            .modcore-dialog-overlay {
                --mc-bg: #0a0a0a;
                --mc-text: #d4d4d4;
                --mc-accent: #63b3ed;
                --mc-surface: #2d2d2d;
                --mc-border: #3c3c3c;
                --mc-note-bg: #2d2d2d;
                --mc-note-text: #a0a0a0;
                --mc-privacy-bg: #2b2a22;
                --mc-privacy-text: #f0dca3;
                --mc-btn-secondary: #444;
                --mc-btn-primary: #1f6feb;
                --mc-btn-success: #218838;
                --mc-type-bg: #2d2d2d;
                --mc-type-border: #444;
            }
        }

        /* Typography and Structure */
        .modcore-form-header {
            font-size: 1.15em;
            font-weight: 600;
            margin-bottom: 15px;
            padding-bottom: 5px;
            border-bottom: 2px solid var(--mc-accent);
            color: var(--mc-accent);
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
        }
        .modcore-form-step-status {
            font-size: 0.8em;
            font-weight: 400;
            color: rgba(0,0,0,0.45);
        }
        .modcore-dialog-content label {
            display: block;
            margin-bottom: 3px;
            font-size: 0.9em;
            font-weight: 500;
            color: var(--mc-text);
        }
        .modcore-dialog-content input:not([type="checkbox"]):not(.modcore-type-radio),
        .modcore-dialog-content textarea,
        .modcore-dialog-content select {
            width: 100%;
            padding: 8px;
            border-radius: 12px;
            margin-top: 3px;
            margin-bottom: 10px;
            font-size: 0.9em;
            border: 1px solid var(--mc-border);
            background-color: var(--mc-surface);
            color: var(--mc-text);
        }
        .modcore-dialog-content input:not([type="checkbox"]):focus,
        .modcore-dialog-content textarea:focus,
        .modcore-dialog-content select:focus {
            outline: none;
            border-color: var(--mc-accent);
            box-shadow: 0 0 0 4px rgba(0, 123, 255, 0.08);
        }
        .modcore-dialog-content textarea { min-height: 80px; }
        .modcore-modal-note {
            background-color: var(--mc-note-bg);
            color: var(--mc-note-text);
            padding: 8px;
            border-radius: 12px;
            font-size: 0.8em;
            margin-top: 5px;
            border: 1px solid rgba(0,0,0,0.06);
        }
        .modcore-privacy-note {
            margin-top: 15px;
            padding: 8px;
            font-size: 0.75em;
            background-color: var(--mc-privacy-bg);
            color: var(--mc-privacy-text);
            border: 1px solid rgba(0,0,0,0.06);
            border-radius: 12px;
        }

        /* Stepper Logic */
        .modcore-form-step {
            display: none;
            flex-direction: column;
            gap: 12px;
            animation: fadeInStep 0.3s forwards;
        }
        .modcore-form-step.current { display: flex; }
        @keyframes fadeInStep {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Conversational Type Selection (New UI) */
        .modcore-type-options-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .modcore-type-option {
            position: relative; /* ensure hidden radio stays in flow */
            display: flex;
            align-items: center;
            padding: 10px 12px 10px 44px; /* leave space for radio (accessible) */
            border: 1px solid var(--mc-type-border);
            border-radius: 12px;
            cursor: pointer;
            transition: background-color 0.15s, border-color 0.15s, box-shadow 0.15s;
            background-color: var(--mc-type-bg);
            color: inherit;
        }

        .modcore-type-option:hover {
            background-color: rgba(0,0,0,0.04);
        }
        .modcore-type-option.is-selected {
            border-color: var(--mc-accent);
            background-color: rgba(0, 123, 255, 0.06);
            box-shadow: 0 0 0 4px rgba(0, 123, 255, 0.06);
        }
        .modcore-type-radio {
            position: absolute;
            left: 14px;
            top: 50%;
            transform: translateY(-50%);
            margin: 0;
            width: 16px;
            height: 16px;
            opacity: 0; /* keep hidden visually but present for screen readers */
        }
        /* Provide a visible custom marker for selected state */
        .modcore-type-option::before {
            content: "";
            position: absolute;
            left: 18px;
            top: 50%;
            transform: translateY(-50%);
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background-color: transparent;
            border: 2px solid rgba(0,0,0,0.15);
        }
        .modcore-type-option.is-selected::before {
            background-color: var(--mc-accent);
            border-color: var(--mc-accent);
        }
        .modcore-type-option-text {
            font-weight: 500;
        }

        /* Buttons */
        .modcore-form-actions {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            margin-top: 15px;
            padding-top: 10px;
            border-top: 1px solid rgba(0,0,0,0.06);
        }
        .modcore-dialog-content button {
            padding: 8px 12px;
            border: none;
            border-radius: 12px;
            cursor: pointer;
            font-weight: 500;
            font-size: 0.9em;
            transition: background-color 0.2s, box-shadow 0.2s;
            color: #fff;
        }
        .modcore-dialog-content button:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; }
        .btn-secondary { background-color: var(--mc-btn-secondary); color: #ffffff; }
        .btn-primary { background-color: var(--mc-btn-primary); color: #ffffff; }
        .btn-success { background-color: var(--mc-btn-success); color: #ffffff; }

        /* Ensure the modal visuals override page-level styles where needed */
        .modcore-dialog-content,
        .modcore-dialog-content * {
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
    `;

    // --- Modal Structure Elements ---
    const overlay = createElement('div', 'modcore-dialog-overlay', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'modcore-dialog-title'
    });
    // Security: Only close if the background overlay is clicked (not elements inside)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            removeModal();
        }
    });

    const content = createElement('div', 'modcore-dialog-content', { 'aria-live': 'polite' });

    const header = createElement('div', 'modcore-form-header', { id: 'modcore-dialog-title' });
    header.textContent = 'modcore Issue Reporter';

    const stepStatus = createElement('span', 'modcore-form-step-status', { id: 'step-status' });
    stepStatus.textContent = `Step 1 of ${TOTAL_STEPS}`;
    header.appendChild(stepStatus);

    const form = createElement('form');

    // --- Step 1: Conversational Issue Type Selection ---
    const step1 = createStepElement('step-1');
    
    const typeHeading = createElement('label');
    typeHeading.textContent = '1. What kind of report are you submitting?';

    const typeOptionsGroup = createElement('div', 'modcore-type-options-group', { role: 'radiogroup', 'aria-labelledby': typeHeading.id });
    
    // Create radio buttons for conversational selection
    Object.keys(ISSUE_TEMPLATES).forEach(key => {
        const template = ISSUE_TEMPLATES[key];
        
        const optionLabel = createElement('label', 'modcore-type-option');
        optionLabel.setAttribute('for', `issue-type-${key}`);
        optionLabel.setAttribute('tabindex', '0'); // Make label focusable

        const radio = createElement('input', 'modcore-type-radio', {
            type: 'radio',
            id: `issue-type-${key}`,
            name: 'issue-type',
            value: key,
            'aria-required': 'true'
        });
        
        const optionText = createElement('span', 'modcore-type-option-text');
        optionText.textContent = template.name;
        
        optionLabel.appendChild(radio);
        optionLabel.appendChild(optionText);
        
        // Handle selection state on click
        optionLabel.addEventListener('click', () => {
            document.querySelectorAll('.modcore-type-option').forEach(el => el.classList.remove('is-selected'));
            optionLabel.classList.add('is-selected');
            radio.checked = true;
            updateStep2Template(key); // Update step 2 template immediately
        });

        typeOptionsGroup.appendChild(optionLabel);
    });
    
    // Set initial selection and styling
    const initialType = Object.keys(ISSUE_TEMPLATES)[0];
    const initialRadio = typeOptionsGroup.querySelector(`input[value="${initialType}"]`);
    if (initialRadio) {
        initialRadio.checked = true;
        initialRadio.parentElement.classList.add('is-selected');
    }

    step1.appendChild(typeHeading);
    step1.appendChild(typeOptionsGroup);


    // --- Step 2: Details ---
    const step2 = createStepElement('step-2');

    const summaryLabel = createElement('label', '', { for: 'issue-summary' });
    summaryLabel.textContent = '2. Short Summary/Title: (e.g., The button is gone)';
    const summaryInput = createElement('input', '', {
        type: 'text',
        id: 'issue-summary',
        name: 'issue-summary',
        required: 'true',
        'aria-label': 'Short Summary/Title for the Issue'
    });
    
    const descriptionLabel = createElement('label', '', { for: 'issue-description' });
    descriptionLabel.textContent = '3. Detailed Description:';
    const descriptionTextarea = createElement('textarea', '', {
        id: 'issue-description',
        name: 'issue-description',
        required: 'true',
        'aria-label': 'Detailed steps, description, or reasons'
    });
    
    const instructionsNote = createElement('div', 'modcore-modal-note', { id: 'instructions-note' });

    step2.appendChild(summaryLabel);
    step2.appendChild(summaryInput);
    step2.appendChild(descriptionLabel);
    step2.appendChild(descriptionTextarea);
    step2.appendChild(instructionsNote);


    // --- Step 3: Technical Info and Submit ---
    const step3 = createStepElement('step-3');

    const techInfoDiv = createElement('div', 'tech-info-checkbox');
    techInfoDiv.style.display = 'flex';
    techInfoDiv.style.alignItems = 'center';
    
    const techInfoCheckbox = createElement('input', '', {
        type: 'checkbox',
        id: 'include-tech-info',
        name: 'include-tech-info',
        checked: 'true',
        'aria-describedby': 'tech-info-desc'
    });
    
    const techInfoLabel = createElement('label', '', { for: 'include-tech-info' });
    techInfoLabel.textContent = 'Include technical environment details (Recommended)';
    techInfoLabel.style.fontWeight = '500';
    techInfoLabel.style.marginBottom = '0';

    const techInfoDesc = createElement('div', 'modcore-modal-note', { id: 'tech-info-desc' });
    techInfoDesc.textContent = 'We collect accurate details (browser, OS, screen, extension version) to quickly reproduce and debug the issue. This information is submitted publicly with your report.';
    
    const privacyNote = createElement('div', 'modcore-privacy-note');
    privacyNote.textContent = `⚠️ **PRIVACY NOTE**: Your submission will be redirected to the public ${GITHUB_REPO_NAME} GitHub page. Ensure your summary and description do not contain sensitive personal information.`;


    techInfoDiv.appendChild(techInfoCheckbox);
    techInfoDiv.appendChild(techInfoLabel);

    step3.appendChild(techInfoDiv);
    step3.appendChild(techInfoDesc);
    step3.appendChild(privacyNote);

    // --- Action Buttons (Global for all steps) ---
    const actionsDiv = createElement('div', 'modcore-form-actions');

    const cancelButton = createElement('button', 'btn-secondary', { type: 'button' });
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', removeModal);

    const backButton = createElement('button', 'btn-secondary', { type: 'button', id: 'back-button', disabled: 'true' });
    backButton.textContent = 'Back';
    backButton.style.visibility = 'hidden';
    backButton.addEventListener('click', () => navigateStep(-1));

    const nextButton = createElement('button', 'btn-primary', { type: 'button', id: 'next-button' });
    nextButton.textContent = 'Next';
    nextButton.addEventListener('click', () => navigateStep(1));

    // Assembly
    actionsDiv.appendChild(cancelButton);
    actionsDiv.appendChild(backButton);
    actionsDiv.appendChild(nextButton);

    form.appendChild(step1);
    form.appendChild(step2);
    form.appendChild(step3);
    form.appendChild(actionsDiv);

    content.appendChild(header);
    content.appendChild(form);

    overlay.appendChild(style);
    overlay.appendChild(content);

    // Initial setup
    updateStep2Template(initialType);
    step1.classList.add('current');

    return overlay;

    // --- Inner Helper Functions (Scope-contained) ---

    /** Creates a standard step container with ARIA attributes. */
    function createStepElement(id) {
        const step = createElement('div', 'modcore-form-step', {
            id: id,
            role: 'group',
            'aria-labelledby': 'modcore-dialog-title'
        });
        return step;
    }

    /** Updates the description field's placeholder and instructions based on the selected type. */
    function updateStep2Template(type) {
        const template = ISSUE_TEMPLATES[type] || ISSUE_TEMPLATES.BUG;
        summaryInput.placeholder = template.summaryPlaceholder;
        descriptionTextarea.placeholder = template.descriptionPlaceholder;
        instructionsNote.textContent = template.instructions;
    }
    
    /** Handles the step navigation logic. */
    function navigateStep(direction) {
        const steps = [step1, step2, step3];
        let currentStepIndex = steps.findIndex(s => s.classList.contains('current'));
        let newStepIndex = currentStepIndex + direction;

        // Validation for Step 2 -> Step 3 transition
        if (direction > 0 && currentStepIndex === 1) {
            const isSummaryEmpty = !summaryInput.value.trim();
            const isDescriptionEmpty = !descriptionTextarea.value.trim();

            if (isSummaryEmpty || isDescriptionEmpty) {
                // Apply/clear visual feedback
                summaryInput.style.borderColor = isSummaryEmpty ? 'red' : '';
                descriptionTextarea.style.borderColor = isDescriptionEmpty ? 'red' : '';
                summaryInput.setAttribute('aria-invalid', isSummaryEmpty ? 'true' : 'false');
                descriptionTextarea.setAttribute('aria-invalid', isDescriptionEmpty ? 'true' : 'false');
                
                // Show accessibility/visual error message
                let errorDiv = document.getElementById('validation-error');
                if (!errorDiv) {
                    errorDiv = createElement('div', 'modcore-modal-note', { id: 'validation-error' });
                    errorDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
                    errorDiv.style.color = 'darkred';
                    form.insertBefore(errorDiv, actionsDiv);
                }
                errorDiv.textContent = 'Please fill out all required fields before continuing.';
                setTimeout(() => errorDiv.remove(), 4000); // Auto-dismiss error
                
                (isSummaryEmpty ? summaryInput : descriptionTextarea).focus();
                return;
            }
            // Clear validation on success
            summaryInput.style.borderColor = '';
            descriptionTextarea.style.borderColor = '';
            summaryInput.setAttribute('aria-invalid', 'false');
            descriptionTextarea.setAttribute('aria-invalid', 'false');
            document.getElementById('validation-error')?.remove();
        }

        if (newStepIndex >= 0 && newStepIndex < steps.length) {
            steps[currentStepIndex].classList.remove('current');
            steps[newStepIndex].classList.add('current');
            
            // Update button visibility, state, and text
            backButton.style.visibility = newStepIndex > 0 ? 'visible' : 'hidden';
            backButton.disabled = newStepIndex === 0;
            nextButton.textContent = newStepIndex === steps.length - 1 ? 'Send to GitHub' : 'Next';
            nextButton.className = newStepIndex === steps.length - 1 ? 'btn-success' : 'btn-primary';
            stepStatus.textContent = `Step ${newStepIndex + 1} of ${TOTAL_STEPS}`;

            // Focus management
            const firstFocusable = steps[newStepIndex].querySelector('input:not([type="hidden"]), select, textarea, button:not(#back-button), .modcore-type-option');
            if (firstFocusable) {
                firstFocusable.focus();
            }

        } else if (newStepIndex === steps.length) {
            // Final step: Submission
            nextButton.disabled = true; 
            handleFormSubmission(form);
        }
    }
}

/**
 * Displays the modal and handles focus management.
 */
function displayModal() {
    if (reportDialogElement) return;

    reportDialogElement = createReportDialog();
    document.body.appendChild(reportDialogElement);

    setTimeout(() => {
        reportDialogElement.classList.add('is-open');
    }, 10);
    
    // Initial focus on the first conversational element
    const firstFocusable = reportDialogElement.querySelector('.modcore-type-option');
    if (firstFocusable) {
        firstFocusable.focus();
    }
}

/**
 * Removes the modal from the document body.
 */
function removeModal() {
    if (reportDialogElement) {
        reportDialogElement.classList.remove('is-open');
        
        // Wait for animation, then remove
        setTimeout(() => {
            reportDialogElement?.remove();
            reportDialogElement = null;
        }, 300);
    }
}

/**
 * Handles form submission, constructs the GitHub issue URL, and redirects.
 * @param {HTMLFormElement} form The form element containing the user data.
 */
async function handleFormSubmission(form) {
    const typeKey = form.elements['issue-type'].value;
    const summary = form.elements['issue-summary'].value.trim();
    const description = form.elements['issue-description'].value.trim();
    const includeTechInfo = form.elements['include-tech-info'].checked;

    const template = ISSUE_TEMPLATES[typeKey] || ISSUE_TEMPLATES.GENERAL;

    const issueTitle = `${template.titlePrefix} ${summary}`;

    let issueBody = `## Detailed Report\n\n${description}\n\n`;

    if (includeTechInfo) {
        issueBody += '\n---\n';
        issueBody += await getAccurateTechnicalInfo();
        issueBody += '\n---\n';
        issueBody += '*Note: This section contains technical environment details (Browser, OS, Screen, Version) voluntarily provided by the user to aid in debugging this public issue.*';
    }


    // --- Construct and Encode the Final URL ---
    const params = new URLSearchParams();
    params.append('title', issueTitle);
    params.append('body', issueBody);
    params.append('labels', template.label);

    const finalUrl = `${GITHUB_BASE_URL}?${params.toString()}`;

    // Redirect the user to the generated GitHub Issue page
    window.open(finalUrl, '_blank');

    // Close the modal after redirection
    removeModal();
}

/**
 * Global keyboard listener to trigger the modal ('R' key) and manage 'Escape'.
 * @param {KeyboardEvent} event The keyboard event.
 */
function handleKeydown(event) {
    const hasModifier = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
    const activeElement = document.activeElement;
    
    // Robust check if the user is currently typing in an input field
    const isTyping = activeElement && (
        activeElement.tagName === 'INPUT' && activeElement.type !== 'checkbox' && activeElement.type !== 'submit' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable ||
        activeElement.tagName === 'SELECT'
    );

    // Trigger on 'R' key, no modifiers, and not currently typing
    if (event.key === 'r' && !hasModifier && !isTyping) {
        event.preventDefault();
        displayModal();
        return;
    }

    // Allow 'Escape' key to close the modal if it's open
    if (event.key === 'Escape' && reportDialogElement) {
        event.preventDefault();
        removeModal();
    }
}

// Initialize the listener when the content script loads
document.addEventListener('keydown', handleKeydown);
