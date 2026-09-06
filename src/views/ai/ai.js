/* ==========================================================================
   ai.js - modcore AI Application Controller
   ========================================================================== */

import {
    EXTENSION_TOOLS,
    listInstalledExtensions,
    findExtensions,
    getExtensionDetails,
    toggleExtensions,
    uninstallExtensions,
    listProfiles,
    getProfile,
    applyProfileByIdentifier,
    createProfile,
    updateProfile,
    duplicateProfile,
    deleteProfileByIdentifier
} from './ai_tools.js';

import {
    getLatestRelease,
    searchIssues,
    getReadme,
    listReleases,
    getRepoDetails,
    getFileContent,
    getIssueOrPRDetails,
    listPullRequests,
    listCommits,
    getRateLimitStatus,
    setGithubEnabled
} from './ai_web.js';

// Cached DOM Elements
const modelSelect = document.getElementById('modelSelect');
const lockBtn = document.getElementById('lockBtn');
const lockBtnText = document.getElementById('lockBtnText');
const newChatBtn = document.getElementById('newChatBtn');
const settingsBtn = document.getElementById('settingsBtn');

const statusBanner = document.getElementById('statusBanner');
const statusText = document.getElementById('statusText');
const retryBtn = document.getElementById('retryBtn');

const chatStream = document.getElementById('chatStream');
const userPrompt = document.getElementById('userPrompt');
const sendBtn = document.getElementById('sendBtn');
const attachBtn = document.getElementById('attachBtn');
const imageFileInput = document.getElementById('imageFileInput');
const imagePreviewBar = document.getElementById('imagePreviewBar');
const imagePreviewThumb = document.getElementById('imagePreviewThumb');
const imagePreviewName = document.getElementById('imagePreviewName');
const removeImageBtn = document.getElementById('removeImageBtn');

const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const endpointUrlInput = document.getElementById('endpointUrl');
const userNameInput = document.getElementById('userNameInput');
const autoApproveToggle = document.getElementById('autoApproveToggle');
const githubAccessToggle = document.getElementById('githubAccessToggle');
const refreshRateLimitBtn = document.getElementById('refreshRateLimitBtn');
const rateLimitStatusText = document.getElementById('rateLimitStatusText');
const settingsTitle = document.getElementById('settingsTitle');

const approvalModal = document.getElementById('approvalModal');
const approvalDescription = document.getElementById('approvalDescription');
const approveActionBtn = document.getElementById('approveActionBtn');
const denyActionBtn = document.getElementById('denyActionBtn');

// State
let activeMessages = [];
let isLocked = false;
let selectedModel = '';
let currentAssistantRow = null;
let activeAbortController = null;
let attachedImage = null; // { dataUrl, mime, name }
let toolRoundCount = 0;
let isGenerating = false;

const MAX_TOOL_ROUNDS = 8;

const config = {
    baseUrl: 'http://localhost:1234/v1',
    userName: 'User',
    autoApprove: false,
    githubEnabled: true
};

/* --------------------------------------------------------------------------
   System Prompt
   -------------------------------------------------------------------------- */
function getSystemPrompt() {
    const now = new Date();
    const timeString = now.toLocaleString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    return `You are modcore AI, the built-in assistant inside modcore Extension Manager, a Chrome extension. You are talking with ${config.userName} directly inside their browser.

Current date/time: ${timeString}

## What you can actually do
You have live, real tool access to this browser's installed extensions and to the user's saved profile presets (a profile is a named group of extensions with a target on/off state, e.g. "Work" = disable social media, enable password manager). Every tool call has a real effect. There is no access to extension or page storage data; that surface does not exist for you.

You also have read-only access to GitHub repositories (defaulting to modcoretech/modcore-extension-manager) via GitHub web tools. You can fetch releases, search issues/PRs, read files/documentation, inspect repositories, list commits, and check pull requests.

## How to work with extensions and profiles
- You almost never need a raw extension ID. Use names. If you're unsure an extension exists or which one the user means, call find_extension or list_extensions first.
- Tool results will tell you plainly when something is "not_found" or "ambiguous". Ask the user when needed or show candidates.
- For profiles, prefer update_profile's incremental setExtensions/removeExtensions over recreating a profile from scratch.
- Actions that change extension state or modify profiles may prompt the user for approval unless auto-approval is enabled in preferences.
- After a batch tool call, check each item's individual status in the result. Summarize accurately.

## How to work with GitHub tools
- These tools are read-only and require an active internet connection and GitHub API access.
- If GitHub access is disabled or offline, explain plainly and do not retry.

## Style
- Talk like a sharp, direct colleague, not a manual. Skip preambles.
- Use Markdown where useful (tables for lists, code blocks for code), but keep simple responses lightweight.
- Be concise by default.
- You can see and discuss images the user attaches to the chat directly.`;
}

/* --------------------------------------------------------------------------
   Tool Registry
   -------------------------------------------------------------------------- */
const TOOL_REGISTRY = {
    list_extensions: {
        loadingLabel: () => 'Looking at installed extensions…',
        handler: (args) => listInstalledExtensions(args.includeDisabled ?? true)
    },
    find_extension: {
        loadingLabel: (a) => `Searching for "${a.query}"…`,
        handler: (args) => findExtensions(args.query)
    },
    get_extension_details: {
        loadingLabel: (a) => `Checking "${a.identifier}"…`,
        handler: (args) => getExtensionDetails(args.identifier)
    },
    toggle_extensions: {
        loadingLabel: () => 'Updating extensions…',
        approval: (args) => {
            const items = args.items || [];
            const lines = items.map(i => `${i.enable ? 'Enable' : 'Disable'} "${i.identifier}"`).join('\n');
            return `modcore AI wants to change extension states:\n\n${lines}`;
        },
        handler: (args) => toggleExtensions(args.items || [])
    },
    uninstall_extensions: {
        loadingLabel: () => 'Uninstalling…',
        approval: (args) => {
            const list = (args.identifiers || []).join(', ');
            return `modcore AI wants to permanently uninstall: ${list}\n\nThis cannot be undone.`;
        },
        handler: (args) => uninstallExtensions(args.identifiers || [])
    },
    list_profiles: {
        loadingLabel: () => 'Reading your profiles…',
        handler: () => listProfiles()
    },
    get_profile: {
        loadingLabel: (a) => `Opening "${a.identifier}"…`,
        handler: (args) => getProfile(args.identifier)
    },
    apply_profile: {
        loadingLabel: (a) => `Applying "${a.identifier}"…`,
        approval: (args) => `modcore AI wants to apply the profile "${args.identifier}". This will change several extension states.`,
        handler: (args) => applyProfileByIdentifier(args.identifier)
    },
    create_profile: {
        loadingLabel: (a) => `Creating "${a.name}"…`,
        handler: (args) => createProfile(args.name, args.extensions || [], args.shortcut || null)
    },
    update_profile: {
        loadingLabel: (a) => `Updating "${a.identifier}"…`,
        handler: (args) => updateProfile(args.identifier, args)
    },
    duplicate_profile: {
        loadingLabel: (a) => `Duplicating "${a.identifier}"…`,
        handler: (args) => duplicateProfile(args.identifier, args.newName)
    },
    delete_profile: {
        loadingLabel: (a) => `Deleting "${a.identifier}"…`,
        approval: (args) => `modcore AI wants to permanently delete the profile "${args.identifier}". This cannot be undone.`,
        handler: (args) => deleteProfileByIdentifier(args.identifier)
    },
    check_latest_release: {
        loadingLabel: (a) => `Checking release for ${a.owner || 'modcoretech'}/${a.repo || 'modcore-extension-manager'}…`,
        handler: (args) => getLatestRelease(args.owner, args.repo)
    },
    search_github_issues: {
        loadingLabel: (a) => `Searching GitHub issues for "${a.query}"…`,
        handler: (args) => searchIssues(args.query, args.state || 'open', args.owner, args.repo)
    },
    read_documentation: {
        loadingLabel: (a) => `Fetching ${a.path || 'README'} from GitHub…`,
        handler: (args) => getReadme(args.owner, args.repo, args.path)
    },
    list_recent_releases: {
        loadingLabel: (a) => `Listing releases for ${a.owner || 'modcoretech'}/${a.repo || 'modcore-extension-manager'}…`,
        handler: (args) => listReleases(args.owner, args.repo, args.perPage)
    },
    get_repo_details: {
        loadingLabel: (a) => `Fetching repository info for ${a.owner || 'modcoretech'}/${a.repo || 'modcore-extension-manager'}…`,
        handler: (args) => getRepoDetails(args.owner, args.repo)
    },
    get_file_content: {
        loadingLabel: (a) => `Fetching "${a.path}" from GitHub…`,
        handler: (args) => getFileContent(args.path, args.owner, args.repo, args.ref)
    },
    get_issue_or_pr: {
        loadingLabel: (a) => `Fetching GitHub issue/PR #${a.issueNumber}…`,
        handler: (args) => getIssueOrPRDetails(args.issueNumber, args.owner, args.repo)
    },
    list_pull_requests: {
        loadingLabel: (a) => `Listing pull requests for ${a.owner || 'modcoretech'}/${a.repo || 'modcore-extension-manager'}…`,
        handler: (args) => listPullRequests(args.state || 'open', args.owner, args.repo)
    },
    list_commits: {
        loadingLabel: (a) => `Listing recent commits from GitHub…`,
        handler: (args) => listCommits(args.path, args.owner, args.repo, args.perPage)
    },
    get_github_rate_limit: {
        loadingLabel: () => 'Checking GitHub rate limit…',
        handler: () => getRateLimitStatus()
    }
};

/* --------------------------------------------------------------------------
   Init
   -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', async () => {
    await loadPreferences();
    fetchModels();
    setupEventListeners();
});

async function loadPreferences() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            const result = await new Promise(resolve => chrome.storage.local.get([
                'ai_name',
                'ai_endpoint',
                'ai_auto_approve',
                'ai_github_enabled'
            ], resolve));

            if (result.ai_name !== undefined) config.userName = result.ai_name;
            if (result.ai_endpoint !== undefined) config.baseUrl = result.ai_endpoint;
            if (result.ai_auto_approve !== undefined) config.autoApprove = Boolean(result.ai_auto_approve);
            if (result.ai_github_enabled !== undefined) config.githubEnabled = Boolean(result.ai_github_enabled);
        } else {
            config.userName = localStorage.getItem('ai_name') || 'User';
            config.baseUrl = localStorage.getItem('ai_endpoint') || 'http://localhost:1234/v1';
            config.autoApprove = localStorage.getItem('ai_auto_approve') === 'true';
            config.githubEnabled = localStorage.getItem('ai_github_enabled') !== 'false';
        }

        userNameInput.value = config.userName;
        endpointUrlInput.value = config.baseUrl;
        if (autoApproveToggle) autoApproveToggle.checked = config.autoApprove;
        if (githubAccessToggle) githubAccessToggle.checked = config.githubEnabled;

        setGithubEnabled(config.githubEnabled);
    } catch (e) {
        console.error('Failed to load preferences:', e);
    }
}

function saveSetting(key, val) {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [key]: val });
    } else {
        localStorage.setItem(key, String(val));
    }
}

function saveUserName(val) {
    config.userName = val || 'User';
    saveSetting('ai_name', config.userName);
}

function saveEndpoint(url) {
    config.baseUrl = url;
    saveSetting('ai_endpoint', config.baseUrl);
}

function saveAutoApprove(val) {
    config.autoApprove = Boolean(val);
    saveSetting('ai_auto_approve', config.autoApprove);
}

function saveGithubEnabled(val) {
    config.githubEnabled = Boolean(val);
    setGithubEnabled(config.githubEnabled);
    saveSetting('ai_github_enabled', config.githubEnabled);
    updateRateLimitUI();
}

async function updateRateLimitUI() {
    if (!rateLimitStatusText) return;

    if (!config.githubEnabled) {
        rateLimitStatusText.textContent = 'GitHub API access is currently disabled in Preferences.';
        rateLimitStatusText.className = 'rate-limit-body';
        return;
    }

    rateLimitStatusText.textContent = 'Checking remaining requests…';
    rateLimitStatusText.className = 'rate-limit-body';

    try {
        const status = await getRateLimitStatus();
        if (!status.enabled) {
            rateLimitStatusText.textContent = 'GitHub API access is disabled.';
            rateLimitStatusText.className = 'rate-limit-body';
            return;
        }

        if (status.error) {
            rateLimitStatusText.textContent = `Error: ${status.error}`;
            rateLimitStatusText.className = 'rate-limit-body danger';
            return;
        }

        const rem = status.remaining;
        const lim = status.limit;
        const resetStr = status.resetTimeString || 'N/A';

        rateLimitStatusText.textContent = `${rem} / ${lim} unauthorized requests remaining (Resets at ${resetStr})`;

        if (rem === 0) {
            rateLimitStatusText.className = 'rate-limit-body danger';
        } else if (rem < 10) {
            rateLimitStatusText.className = 'rate-limit-body warning';
        } else {
            rateLimitStatusText.className = 'rate-limit-body';
        }
    } catch (err) {
        rateLimitStatusText.textContent = `Unable to fetch rate limit: ${err.message}`;
        rateLimitStatusText.className = 'rate-limit-body danger';
    }
}

function setupEventListeners() {
    retryBtn.addEventListener('click', fetchModels);
    lockBtn.addEventListener('click', toggleLock);
    newChatBtn.addEventListener('click', resetChat);
    sendBtn.addEventListener('click', handleSendOrStop);

    attachBtn.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', handleImageSelection);
    removeImageBtn.addEventListener('click', clearImageAttachment);

    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
        updateRateLimitUI();
    });

    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

    if (autoApproveToggle) {
        autoApproveToggle.addEventListener('change', (e) => saveAutoApprove(e.target.checked));
    }

    if (githubAccessToggle) {
        githubAccessToggle.addEventListener('change', (e) => saveGithubEnabled(e.target.checked));
    }

    if (refreshRateLimitBtn) {
        refreshRateLimitBtn.addEventListener('click', () => updateRateLimitUI());
    }

    document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.sidebar-nav .nav-item').forEach(i => i.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));

            const tabId = e.currentTarget.getAttribute('data-tab');
            e.currentTarget.classList.add('active');
            const targetTab = document.getElementById(tabId);
            if (targetTab) targetTab.classList.remove('hidden');
            settingsTitle.textContent = tabId === 'tab-model' ? 'Model Settings' : 'Preferences';

            if (tabId === 'tab-preferences') {
                updateRateLimitUI();
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            settingsModal.classList.add('hidden');
            approvalModal.classList.add('hidden');
        }
    });

    settingsModal.addEventListener('mousedown', (e) => {
        if (e.target === settingsModal) settingsModal.classList.add('hidden');
    });

    endpointUrlInput.addEventListener('change', (e) => {
        const raw = e.target.value.trim();
        try {
            const parsed = new URL(raw);
            const sanitizedUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '');
            saveEndpoint(sanitizedUrl);
            fetchModels();
        } catch (err) {
            updateStatus('That doesn\'t look like a valid URL', 'error');
        }
    });

    userNameInput.addEventListener('input', (e) => saveUserName(e.target.value.trim()));

    userPrompt.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendOrStop();
        }
    });

    userPrompt.addEventListener('input', () => {
        userPrompt.style.height = 'auto';
        userPrompt.style.height = `${Math.min(userPrompt.scrollHeight, 150)}px`;
    });
}

/* --------------------------------------------------------------------------
   Attachments
   -------------------------------------------------------------------------- */
function handleImageSelection(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Please choose an image file (PNG, JPEG, WebP, or GIF).', 'error');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showToast('That image is over 5MB - try a smaller one.', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        attachedImage = { dataUrl: reader.result, mime: file.type, name: file.name };
        imagePreviewThumb.src = reader.result;
        imagePreviewName.textContent = file.name;
        imagePreviewBar.classList.remove('hidden');
    };
    reader.onerror = () => showToast('Couldn\'t read that image - please try again.', 'error');
    reader.readAsDataURL(file);
}

function clearImageAttachment() {
    attachedImage = null;
    imageFileInput.value = '';
    imagePreviewThumb.src = '';
    imagePreviewName.textContent = '';
    imagePreviewBar.classList.add('hidden');
}

/* --------------------------------------------------------------------------
   Model discovery / lock
   -------------------------------------------------------------------------- */
async function fetchModels() {
    updateStatus('Connecting…', 'warning');

    clearElement(modelSelect);
    modelSelect.appendChild(new Option('Fetching models…', ''));
    modelSelect.disabled = true;
    lockBtn.disabled = true;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(`${config.baseUrl}/models`, { method: 'GET', signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Server responded with HTTP ${response.status}`);

        const data = await response.json();
        const rawModels = Array.isArray(data.data) ? data.data : [];

        const validModels = rawModels.filter(m => {
            const id = (m.id || '').toLowerCase();
            const type = (m.type || '').toLowerCase();
            return type !== 'embedding' && !id.includes('embed') && !id.includes('bge-') && !id.includes('bert');
        });

        clearElement(modelSelect);
        if (validModels.length > 0) {
            validModels.forEach(model => modelSelect.appendChild(new Option(model.id, model.id)));
            modelSelect.disabled = isLocked;
            lockBtn.disabled = false;
            updateStatus('Connected', 'success');
        } else {
            throw new Error('No chat-capable models were found on that endpoint.');
        }
    } catch (err) {
        clearElement(modelSelect);
        modelSelect.appendChild(new Option('No models available', ''));
        const errMsg = err.name === 'AbortError' ? 'Connection timed out' : err.message;
        updateStatus(`Can't reach your local AI (${errMsg})`, 'error');
    }
}

function toggleLock() {
    isLocked = !isLocked;

    if (isLocked) {
        selectedModel = modelSelect.value;
        if (!selectedModel) {
            isLocked = false;
            showToast('Pick a model first.', 'error');
            return;
        }
        modelSelect.disabled = true;
        lockBtn.classList.add('btn-locked');
        lockBtnText.textContent = 'Locked in';

        userPrompt.disabled = false;
        sendBtn.disabled = false;
        attachBtn.disabled = false;
        userPrompt.placeholder = `Message modcore AI…`;

        settingsModal.classList.add('hidden');
        userPrompt.focus();
    } else {
        selectedModel = '';
        modelSelect.disabled = false;
        lockBtn.classList.remove('btn-locked');
        lockBtnText.textContent = 'Lock in';

        userPrompt.disabled = true;
        sendBtn.disabled = true;
        attachBtn.disabled = true;
        userPrompt.placeholder = 'Pick a model in Settings to start chatting…';
    }
}

function resetChat() {
    if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
    }
    activeMessages = [];
    currentAssistantRow = null;
    toolRoundCount = 0;
    isGenerating = false;
    updateSendButtonState();
    clearImageAttachment();

    clearElement(chatStream);

    const welcome = document.createElement('div');
    welcome.className = 'welcome-card';

    const icon = document.createElement('i');
    icon.className = 'icon icon-48 icon-chat';
    icon.setAttribute('aria-hidden', 'true');

    const title = document.createElement('h2');
    title.textContent = 'modcore AI';

    const desc = document.createElement('p');
    if (isLocked) {
        desc.textContent = 'Ask me to check on an extension, tidy up your setup, or build a profile - I\'m ready when you are.';
    } else {
        desc.textContent = 'Open ';
        const strong = document.createElement('strong');
        strong.textContent = 'Settings';
        desc.appendChild(strong);
        desc.appendChild(document.createTextNode(' to choose a local AI model to get started.'));
    }

    welcome.appendChild(icon);
    welcome.appendChild(title);
    welcome.appendChild(desc);
    chatStream.appendChild(welcome);

    userPrompt.value = '';
    userPrompt.style.height = 'auto';
}

/* --------------------------------------------------------------------------
   Send / Stop handling
   -------------------------------------------------------------------------- */
function handleSendOrStop() {
    if (isGenerating) {
        stopGeneration();
    } else {
        handleSend();
    }
}

function stopGeneration() {
    if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
    }
    isGenerating = false;
    updateSendButtonState();
    finishTurn();
}

function updateSendButtonState() {
    if (isGenerating) {
        sendBtn.innerHTML = '';
        const stopIcon = document.createElement('i');
        stopIcon.className = 'icon icon-16 icon-close';
        stopIcon.setAttribute('aria-hidden', 'true');
        sendBtn.appendChild(stopIcon);
        sendBtn.setAttribute('aria-label', 'Stop generation');
        sendBtn.title = 'Stop generation';
        sendBtn.classList.add('btn-stop');
    } else {
        sendBtn.innerHTML = '';
        const sendIcon = document.createElement('i');
        sendIcon.className = 'icon icon-16 icon-arrow-right';
        sendIcon.setAttribute('aria-hidden', 'true');
        sendBtn.appendChild(sendIcon);
        sendBtn.setAttribute('aria-label', 'Send message');
        sendBtn.title = 'Send message';
        sendBtn.classList.remove('btn-stop');
    }
}

/* --------------------------------------------------------------------------
   Send / receive
   -------------------------------------------------------------------------- */
async function handleSend() {
    const text = userPrompt.value.trim();
    if ((!text && !attachedImage) || !isLocked) return;

    const welcomeCard = chatStream.querySelector('.welcome-card');
    if (welcomeCard) welcomeCard.remove();

    if (activeMessages.length === 0) {
        activeMessages.push({ role: 'system', content: getSystemPrompt() });
    }

    let userPayloadContent = text;
    if (attachedImage) {
        userPayloadContent = [
            { type: 'text', text: text || 'Take a look at this image.' },
            { type: 'image_url', image_url: { url: attachedImage.dataUrl } }
        ];
    }

    activeMessages.push({ role: 'user', content: userPayloadContent });
    appendMessageUI('user', text, attachedImage?.dataUrl);

    clearImageAttachment();
    userPrompt.value = '';
    userPrompt.style.height = 'auto';
    userPrompt.disabled = true;

    isGenerating = true;
    updateSendButtonState();

    currentAssistantRow = null;
    toolRoundCount = 0;
    await queryLocalAI();
}

async function queryLocalAI() {
    const loader = createToolLoader('Thinking…');
    if (!currentAssistantRow) {
        currentAssistantRow = appendAssistantShell();
    }

    activeAbortController = new AbortController();

    const requestBody = {
        model: selectedModel,
        messages: activeMessages,
        tools: EXTENSION_TOOLS,
        stream: true
    };

    try {
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: activeAbortController.signal
        });

        if (!response.ok) {
            const bodyText = await response.text().catch(() => '');
            throw new Error(`The model server returned HTTP ${response.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}`);
        }
        if (!response.body) throw new Error('The model server did not stream a response body.');

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        let fullContent = '';
        let toolCalls = [];
        let sseBuffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;

                const jsonStr = trimmed.slice(6).trim();
                if (jsonStr === '[DONE]') continue;

                try {
                    const parsed = JSON.parse(jsonStr);
                    const delta = parsed.choices?.[0]?.delta || {};

                    if (delta.reasoning_content || delta.reasoning) {
                        currentAssistantRow.appendReasoning(delta.reasoning_content || delta.reasoning);
                    }

                    if (delta.content) {
                        fullContent += delta.content;
                        currentAssistantRow.updateContent(fullContent);
                    }

                    if (delta.tool_calls) {
                        delta.tool_calls.forEach(tc => {
                            if (!toolCalls[tc.index]) {
                                toolCalls[tc.index] = { id: tc.id || `call_${Date.now()}_${tc.index}`, name: tc.function?.name, arguments: '' };
                            }
                            if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
                            if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
                        });
                    }
                } catch (e) {
                    // Partial/malformed SSE chunk
                }
            }
        }

        loader.remove();
        toolCalls = toolCalls.filter(Boolean);

        const assistantMsg = { role: 'assistant', content: fullContent };
        if (toolCalls.length > 0) {
            assistantMsg.tool_calls = toolCalls.map(tc => ({
                id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments }
            }));
        }
        activeMessages.push(assistantMsg);

        if (toolCalls.length > 0) {
            toolRoundCount++;
            if (toolRoundCount > MAX_TOOL_ROUNDS) {
                currentAssistantRow.updateContent(fullContent + '\n\n_Stopped after several tool calls in a row to avoid a loop. Let me know if you\'d like me to keep going._');
                isGenerating = false;
                updateSendButtonState();
                finishTurn();
                return;
            }
            for (const call of toolCalls) {
                await executeToolCall(call);
            }
            // Trigger next completion turn after all tool calls in round execute
            await queryLocalAI();
        } else {
            isGenerating = false;
            updateSendButtonState();
            finishTurn();
        }
    } catch (err) {
        loader.remove();
        if (err.name !== 'AbortError') {
            currentAssistantRow.updateContent(`⚠️ ${friendlyNetworkError(err)}`);
        }
        isGenerating = false;
        updateSendButtonState();
        finishTurn();
    } finally {
        activeAbortController = null;
    }
}

function friendlyNetworkError(err) {
    if (err.message?.includes('Failed to fetch')) {
        return `Couldn't reach your local AI server at ${config.baseUrl}. Make sure it's running, then try again.`;
    }
    return `Something went wrong talking to the model: ${err.message}`;
}

function finishTurn() {
    userPrompt.disabled = false;
    if (!isGenerating) {
        sendBtn.disabled = false;
    }
    userPrompt.focus();
}

/* --------------------------------------------------------------------------
   Tool dispatch
   -------------------------------------------------------------------------- */
async function executeToolCall(toolCall) {
    const fnName = toolCall.name;
    let args = {};
    try {
        args = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
    } catch (e) {
        const result = { success: false, error: `Your arguments for "${fnName}" weren't valid JSON, so nothing ran. Re-check the format and try again.` };
        currentAssistantRow.renderToolCall(fnName, toolCall.arguments, result);
        activeMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
        return;
    }

    const entry = TOOL_REGISTRY[fnName];
    let result;

    if (!entry) {
        result = { success: false, error: `"${fnName}" isn't a tool modcore AI has access to.` };
    } else {
        const loader = createToolLoader(entry.loadingLabel ? entry.loadingLabel(args) : `Running ${fnName}…`);
        try {
            if (entry.approval && !config.autoApprove) {
                const approved = await requestApproval(entry.approval(args));
                if (!approved) {
                    result = { success: false, status: 'denied', message: 'The user declined this action.' };
                    loader.remove();
                    currentAssistantRow.renderToolCall(fnName, args, result);
                    activeMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
                    return;
                }
            }
            result = await entry.handler(args);
        } catch (err) {
            result = { success: false, error: err.message || String(err) };
        } finally {
            loader.remove();
        }
    }

    currentAssistantRow.renderToolCall(fnName, args, result);
    activeMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
}

function requestApproval(message) {
    return new Promise((resolve) => {
        approvalDescription.textContent = message;
        approvalModal.classList.remove('hidden');

        const onApprove = () => { cleanup(); resolve(true); };
        const onDeny = () => { cleanup(); resolve(false); };

        function cleanup() {
            approveActionBtn.removeEventListener('click', onApprove);
            denyActionBtn.removeEventListener('click', onDeny);
            approvalModal.classList.add('hidden');
        }

        approveActionBtn.addEventListener('click', onApprove);
        denyActionBtn.addEventListener('click', onDeny);
    });
}

/* --------------------------------------------------------------------------
   Toasts
   -------------------------------------------------------------------------- */
let toastTimer = null;
function showToast(message, type = 'info') {
    let toast = document.getElementById('aiToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'aiToast';
        toast.className = 'ai-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `ai-toast ai-toast-${type} visible`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

/* --------------------------------------------------------------------------
   XSS-safe Markdown renderer
   -------------------------------------------------------------------------- */
function renderMarkdownNode(text) {
    const container = document.createElement('div');
    if (!text) return container;

    const lines = text.split('\n');
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockBuffer = [];
    let currentList = null;
    let currentListType = null;

    const flushList = () => {
        if (currentList) {
            container.appendChild(currentList);
            currentList = null;
            currentListType = null;
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('```')) {
            if (inCodeBlock) {
                const pre = document.createElement('pre');
                const code = document.createElement('code');
                if (codeBlockLang) code.className = `language-${codeBlockLang}`;
                code.textContent = codeBlockBuffer.join('\n');
                pre.appendChild(code);
                container.appendChild(pre);

                codeBlockBuffer = [];
                inCodeBlock = false;
                codeBlockLang = '';
            } else {
                flushList();
                inCodeBlock = true;
                codeBlockLang = line.replace('```', '').trim();
            }
            continue;
        }

        if (inCodeBlock) {
            codeBlockBuffer.push(line);
            continue;
        }

        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
            flushList();
            const tableLines = [];
            let j = i;
            while (j < lines.length && lines[j].trim().startsWith('|') && lines[j].trim().endsWith('|')) {
                tableLines.push(lines[j].trim());
                j++;
            }
            if (tableLines.length >= 2 && /^\|(?:\s*:?-+:?\s*\|)+$/.test(tableLines[1])) {
                container.appendChild(buildTableNode(tableLines));
                i = j - 1;
                continue;
            }
        }

        if (/^#{1,3}\s/.test(line)) {
            flushList();
            const level = line.indexOf(' ');
            const heading = document.createElement(`h${level}`);
            appendFormattedInlineText(heading, line.slice(level + 1));
            container.appendChild(heading);
            continue;
        }

        if (line.startsWith('>')) {
            flushList();
            const bq = document.createElement('blockquote');
            appendFormattedInlineText(bq, line.replace(/^>\s?/, ''));
            container.appendChild(bq);
            continue;
        }

        const unorderedMatch = line.match(/^\s*[-*]\s+(.*$)/);
        const orderedMatch = line.match(/^\s*(\d+)\.\s+(.*$)/);

        if (unorderedMatch) {
            if (currentListType !== 'ul') {
                flushList();
                currentList = document.createElement('ul');
                currentListType = 'ul';
            }
            const li = document.createElement('li');
            appendFormattedInlineText(li, unorderedMatch[1]);
            currentList.appendChild(li);
            continue;
        }

        if (orderedMatch) {
            if (currentListType !== 'ol') {
                flushList();
                currentList = document.createElement('ol');
                currentListType = 'ol';
            }
            const li = document.createElement('li');
            appendFormattedInlineText(li, orderedMatch[2]);
            currentList.appendChild(li);
            continue;
        }

        flushList();
        if (line.trim() === '') continue;

        const p = document.createElement('p');
        appendFormattedInlineText(p, line);
        container.appendChild(p);
    }

    if (inCodeBlock && codeBlockBuffer.length > 0) {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = codeBlockBuffer.join('\n');
        pre.appendChild(code);
        container.appendChild(pre);
    }

    flushList();
    return container;
}

function buildTableNode(tableLines) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-container';

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    const parseRowCells = (rowStr) => rowStr.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

    const headers = parseRowCells(tableLines[0]);
    const headerTr = document.createElement('tr');
    headers.forEach(hText => {
        const th = document.createElement('th');
        appendFormattedInlineText(th, hText);
        headerTr.appendChild(th);
    });
    thead.appendChild(headerTr);

    for (let r = 2; r < tableLines.length; r++) {
        const cells = parseRowCells(tableLines[r]);
        const tr = document.createElement('tr');
        cells.forEach(cText => {
            const td = document.createElement('td');
            appendFormattedInlineText(td, cText);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
}

function appendFormattedInlineText(targetEl, text) {
    if (!text) return;
    const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    const parts = text.split(tokenRegex);

    parts.forEach(part => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
            const code = document.createElement('code');
            code.textContent = part.slice(1, -1);
            targetEl.appendChild(code);
        } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
            const strong = document.createElement('strong');
            strong.textContent = part.slice(2, -2);
            targetEl.appendChild(strong);
        } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
            const em = document.createElement('em');
            em.textContent = part.slice(1, -1);
            targetEl.appendChild(em);
        } else if (part) {
            targetEl.appendChild(document.createTextNode(part));
        }
    });
}

function clearElement(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
}

/* --------------------------------------------------------------------------
   UI builders
   -------------------------------------------------------------------------- */
function appendMessageUI(role, content, attachmentDataUrl = null) {
    const row = document.createElement('div');
    row.className = `message-row ${role}`;

    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (attachmentDataUrl) {
        const imgWrap = document.createElement('div');
        imgWrap.className = 'message-attachment';
        const img = document.createElement('img');
        img.src = attachmentDataUrl;
        img.alt = 'User attachment';
        imgWrap.appendChild(img);
        bubble.appendChild(imgWrap);
    }

    if (content) bubble.appendChild(renderMarkdownNode(content));

    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-btn';
    copyBtn.title = 'Copy message';
    const copyIcon = document.createElement('i');
    copyIcon.className = 'icon icon-16 icon-copy';
    copyIcon.setAttribute('aria-hidden', 'true');
    copyBtn.appendChild(copyIcon);
    copyBtn.onclick = () => {
        navigator.clipboard.writeText(content);
        copyIcon.className = 'icon icon-16 icon-check';
        setTimeout(() => copyIcon.className = 'icon icon-16 icon-copy', 1500);
    };
    actions.appendChild(copyBtn);

    wrapper.appendChild(bubble);
    wrapper.appendChild(actions);
    row.appendChild(wrapper);
    chatStream.appendChild(row);
    chatStream.scrollTop = chatStream.scrollHeight;
    return bubble;
}

function appendAssistantShell() {
    const row = document.createElement('div');
    row.className = 'message-row assistant';

    let reasoningDetails = null;
    let reasoningContent = null;
    let bubble = null;
    let rawContentText = '';

    chatStream.appendChild(row);

    const ensureReasoningBlock = () => {
        if (!reasoningDetails) {
            reasoningDetails = document.createElement('details');
            reasoningDetails.className = 'reasoning-block';
            reasoningDetails.open = false;

            const summary = document.createElement('summary');
            summary.textContent = 'Thinking it through';

            reasoningContent = document.createElement('div');
            reasoningContent.className = 'reasoning-content';

            reasoningDetails.appendChild(summary);
            reasoningDetails.appendChild(reasoningContent);
            row.appendChild(reasoningDetails);
        }
    };

    return {
        containerRow: row,
        appendReasoning: (textChunk) => {
            ensureReasoningBlock();
            reasoningContent.appendChild(document.createTextNode(textChunk));
            chatStream.scrollTop = chatStream.scrollHeight;
        },
        renderToolCall: (fnName, args, result) => {
            ensureReasoningBlock();
            const card = document.createElement('details');
            const failed = result && (result.success === false || result.error);
            card.className = `tool-call-card${failed ? ' tool-call-failed' : ''}`;
            card.open = false;

            const summary = document.createElement('summary');
            const icon = document.createElement('i');
            icon.className = `icon icon-16 ${failed ? 'icon-warning-status' : 'icon-code'}`;
            icon.setAttribute('aria-hidden', 'true');

            const label = document.createElement('span');
            label.appendChild(document.createTextNode(' '));
            const strong = document.createElement('strong');
            strong.textContent = humanizeToolName(fnName);
            label.appendChild(strong);

            summary.appendChild(icon);
            summary.appendChild(label);

            const pre = document.createElement('pre');
            pre.textContent = JSON.stringify({ arguments: args, result }, null, 2);

            card.appendChild(summary);
            card.appendChild(pre);
            reasoningContent.appendChild(card);
            chatStream.scrollTop = chatStream.scrollHeight;
        },
        updateContent: (text) => {
            rawContentText = text;
            if (!bubble) {
                const wrapper = document.createElement('div');
                wrapper.className = 'message-wrapper';

                bubble = document.createElement('div');
                bubble.className = 'message-bubble';

                const actions = document.createElement('div');
                actions.className = 'message-actions';

                const copyBtn = document.createElement('button');
                copyBtn.className = 'action-btn';
                copyBtn.title = 'Copy response';
                const copyIcon = document.createElement('i');
                copyIcon.className = 'icon icon-16 icon-copy';
                copyIcon.setAttribute('aria-hidden', 'true');
                copyBtn.appendChild(copyIcon);
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(rawContentText);
                    copyIcon.className = 'icon icon-16 icon-check';
                    setTimeout(() => copyIcon.className = 'icon icon-16 icon-copy', 1500);
                };

                actions.appendChild(copyBtn);
                wrapper.appendChild(bubble);
                wrapper.appendChild(actions);
                row.appendChild(wrapper);
            }

            clearElement(bubble);
            bubble.appendChild(renderMarkdownNode(rawContentText));
            chatStream.scrollTop = chatStream.scrollHeight;
        }
    };
}

function humanizeToolName(name) {
    return String(name || '').replace(/_/g, ' ');
}

function createToolLoader(text) {
    const badge = document.createElement('div');
    badge.className = 'tool-loader-badge';

    const icon = document.createElement('i');
    icon.className = 'icon icon-16 icon-loading';
    icon.setAttribute('aria-hidden', 'true');

    const span = document.createElement('span');
    span.textContent = text;

    badge.appendChild(icon);
    badge.appendChild(span);
    chatStream.appendChild(badge);
    chatStream.scrollTop = chatStream.scrollHeight;
    return badge;
}

function updateStatus(message, type) {
    statusText.textContent = message;
    statusBanner.className = `status-banner ${type}`;
}