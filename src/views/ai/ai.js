/* ==========================================================================
   ai.js — modcore AI application controller
   ========================================================================== */

import {
    EXTENSION_TOOLS,
    listInstalledExtensions, findExtensions, getExtensionDetails,
    toggleExtensions, uninstallExtensions,
    listProfiles, getProfile, applyProfileByIdentifier,
    createProfile, updateProfile, duplicateProfile, deleteProfileByIdentifier,
    suggestPage
} from './ai_tools.js';

import {
    getLatestRelease, searchIssues, getReadme, listReleases, getRepoDetails,
    getFileContent, getIssueOrPRDetails, listPullRequests, listCommits,
    getRateLimitStatus, setGithubEnabled, setGithubToken,
    getReleaseByTag, listContributors, listBranches, listTags, searchCode,
    getCommitDetails, compareCommits, getGithubUser, listIssueComments
} from './ai_web.js';

import { StreamingMarkdown, renderMarkdown, copyText, flashCopied } from './ai_markdown.js';

/* --------------------------------------------------------------------------
   DOM
   -------------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

const modelSelect = $('modelSelect');
const lockBtn = $('lockBtn');
const lockBtnText = $('lockBtnText');
const newChatBtn = $('newChatBtn');
const settingsBtn = $('settingsBtn');
const statusBanner = $('statusBanner');
const statusText = $('statusText');
const retryBtn = $('retryBtn');
const chatStream = $('chatStream');
const userPrompt = $('userPrompt');
const sendBtn = $('sendBtn');
const attachBtn = $('attachBtn');
const imageFileInput = $('imageFileInput');
const imagePreviewBar = $('imagePreviewBar');
const imagePreviewThumb = $('imagePreviewThumb');
const imagePreviewName = $('imagePreviewName');
const removeImageBtn = $('removeImageBtn');
const settingsModal = $('settingsModal');
const closeSettingsBtn = $('closeSettingsBtn');
const endpointUrlInput = $('endpointUrl');
const userNameInput = $('userNameInput');
const autoApproveToggle = $('autoApproveToggle');
const githubAccessToggle = $('githubAccessToggle');
const githubTokenInput = $('githubTokenInput');
const refreshRateLimitBtn = $('refreshRateLimitBtn');
const rateLimitStatusText = $('rateLimitStatusText');
const settingsTitle = $('settingsTitle');
const approvalModal = $('approvalModal');
const approvalDescription = $('approvalDescription');
const approveActionBtn = $('approveActionBtn');
const denyActionBtn = $('denyActionBtn');

/* --------------------------------------------------------------------------
   State
   -------------------------------------------------------------------------- */
let activeMessages = [];
let isLocked = false;
let selectedModel = '';
let currentAssistantRow = null;
let activeAbortController = null;
let attachedFile = null;
let toolRoundCount = 0;
let isGenerating = false;
let lastRegenBtn = null;

const MAX_TOOL_ROUNDS = 8;
const SCROLL_THRESHOLD = 120;

const config = {
    baseUrl: 'http://localhost:1234/v1',
    userName: 'User',
    autoApprove: false,
    githubEnabled: true,
    githubToken: ''
};

/* --------------------------------------------------------------------------
   System prompt
   -------------------------------------------------------------------------- */
function getSystemPrompt() {
    const now = new Date().toLocaleString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    return `You are modcore AI, the built-in AI assistant inside modcore Extension Manager, a Chrome extension. You are talking with ${config.userName} directly inside their browser.

Current date/time: ${now}

## CRITICAL NAMING
- "modcore" refers strictly to the developer / organization behind modcore Extension Manager.
- NEVER shorten "modcore Extension Manager" to just "modcore". Always call the product "modcore Extension Manager" or "modcore EM".

## NO-HALLUCINATION POLICY
- If you do not know where a setting is, what a feature does, or how something works, DO NOT guess.
- Inspect and search the GitHub repository using your GitHub tools (\`get_file_content\`, \`read_documentation\`, \`search_github_issues\`, \`search_code\`, etc.) to verify exact details first.
- GitHub access covers any public repository; code search requires an authenticated token.

## KEY FEATURES OF MODCORE EXTENSION MANAGER
- **modcore Snapshot**: full backups of installed extensions, their states, versions, and configs.
- **modcore Timeline**: chronological history of extension events, toggles, installs, uninstalls, and profile activations.
- **modcore Automations**: rule-based conditional extension toggling (schedules, domain/site URL, Wi-Fi, focus mode).
- **Safety Center**: permission and host-access audit dashboard.
- **Profiles page**: create, edit, and apply extension state presets (Work, Gaming, Dev, Privacy...).
- **Popup**: toolbar UI for quick toggles, profile switching, search, and snapshots.

## WHAT YOU CAN DO
- Live, real tool access to installed browser extensions and saved profiles.
- You MUST NOT disable or uninstall modcore Extension Manager itself.
- Recommend internal pages with the \`suggest_page\` tool whenever navigation fits.
- Read and analyse files the user attaches (images, text/code, documents).
- Read-only GitHub access to public repositories and organizations.

## STYLE
- Sharp, direct colleague. Skip preambles. Clean Markdown. Concise by default.`;
}

/* --------------------------------------------------------------------------
   Tool registry
   -------------------------------------------------------------------------- */
const TOOL_REGISTRY = {
    suggest_page: {
        loadingLabel: (a) => `Suggesting ${a.title || 'page'}…`,
        handler: (a) => suggestPage(a.url, a.title, a.reason)
    },
    list_extensions: {
        loadingLabel: () => 'Looking at installed extensions…',
        handler: (a) => listInstalledExtensions(a.includeDisabled ?? true)
    },
    find_extension: {
        loadingLabel: (a) => `Searching for "${a.query}"…`,
        handler: (a) => findExtensions(a.query)
    },
    get_extension_details: {
        loadingLabel: (a) => `Checking "${a.identifier}"…`,
        handler: (a) => getExtensionDetails(a.identifier)
    },
    toggle_extensions: {
        loadingLabel: () => 'Updating extensions…',
        approval: (a) => `modcore AI wants to change extension states:\n\n${(a.items || []).map(i => `${i.enable ? 'Enable' : 'Disable'} "${i.identifier}"`).join('\n')}`,
        handler: (a) => toggleExtensions(a.items || [])
    },
    uninstall_extensions: {
        loadingLabel: () => 'Uninstalling…',
        approval: (a) => `modcore AI wants to permanently uninstall: ${(a.identifiers || []).join(', ')}\n\nThis cannot be undone.`,
        handler: (a) => uninstallExtensions(a.identifiers || [])
    },
    list_profiles: { loadingLabel: () => 'Reading your profiles…', handler: () => listProfiles() },
    get_profile: { loadingLabel: (a) => `Opening "${a.identifier}"…`, handler: (a) => getProfile(a.identifier) },
    apply_profile: {
        loadingLabel: (a) => `Applying "${a.identifier}"…`,
        approval: (a) => `modcore AI wants to apply the profile "${a.identifier}". This will change several extension states.`,
        handler: (a) => applyProfileByIdentifier(a.identifier)
    },
    create_profile: { loadingLabel: (a) => `Creating "${a.name}"…`, handler: (a) => createProfile(a.name, a.extensions || [], a.shortcut || null) },
    update_profile: { loadingLabel: (a) => `Updating "${a.identifier}"…`, handler: (a) => updateProfile(a.identifier, a) },
    duplicate_profile: { loadingLabel: (a) => `Duplicating "${a.identifier}"…`, handler: (a) => duplicateProfile(a.identifier, a.newName) },
    delete_profile: {
        loadingLabel: (a) => `Deleting "${a.identifier}"…`,
        approval: (a) => `modcore AI wants to permanently delete the profile "${a.identifier}". This cannot be undone.`,
        handler: (a) => deleteProfileByIdentifier(a.identifier)
    },

    /* GitHub */
    check_latest_release: {
        loadingLabel: (a) => `Checking latest release for ${a.owner || 'modcoretech'}/${a.repo || 'modcore-extension-manager'}…`,
        handler: (a) => getLatestRelease(a.owner, a.repo)
    },
    list_recent_releases: {
        loadingLabel: (a) => `Listing releases for ${a.owner || 'modcoretech'}/${a.repo || 'modcore-extension-manager'}…`,
        handler: (a) => listReleases(a.owner, a.repo, a.perPage, a.includeChangelog !== false)
    },
    get_release_by_tag: {
        loadingLabel: (a) => `Fetching release ${a.tag}…`,
        handler: (a) => getReleaseByTag(a.owner, a.repo, a.tag)
    },
    get_repo_details: {
        loadingLabel: (a) => `Fetching repository info for ${a.owner || 'modcoretech'}/${a.repo || 'modcore-extension-manager'}…`,
        handler: (a) => getRepoDetails(a.owner, a.repo)
    },
    list_contributors: {
        loadingLabel: () => 'Listing contributors…',
        handler: (a) => listContributors(a.owner, a.repo, a.perPage)
    },
    list_branches: {
        loadingLabel: () => 'Listing branches…',
        handler: (a) => listBranches(a.owner, a.repo, a.perPage)
    },
    list_tags: {
        loadingLabel: () => 'Listing tags…',
        handler: (a) => listTags(a.owner, a.repo, a.perPage)
    },
    read_documentation: {
        loadingLabel: (a) => `Fetching ${a.path || 'README'}…`,
        handler: (a) => getReadme(a.owner, a.repo, a.path)
    },
    get_file_content: {
        loadingLabel: (a) => `Fetching "${a.path}"…`,
        handler: (a) => getFileContent(a.path, a.owner, a.repo, a.ref)
    },
    search_code: {
        loadingLabel: (a) => `Searching code for "${a.query}"…`,
        handler: (a) => searchCode(a.query, a.owner, a.repo)
    },
    search_github_issues: {
        loadingLabel: (a) => `Searching GitHub issues for "${a.query}"…`,
        handler: (a) => searchIssues(a.query, a.state || 'open', a.owner, a.repo)
    },
    get_issue_or_pr: {
        loadingLabel: (a) => `Fetching issue/PR #${a.issueNumber}…`,
        handler: (a) => getIssueOrPRDetails(a.issueNumber, a.owner, a.repo)
    },
    list_issue_comments: {
        loadingLabel: (a) => `Fetching comments for #${a.issueNumber}…`,
        handler: (a) => listIssueComments(a.issueNumber, a.owner, a.repo, a.perPage)
    },
    list_pull_requests: {
        loadingLabel: () => 'Listing pull requests…',
        handler: (a) => listPullRequests(a.state || 'open', a.owner, a.repo)
    },
    list_commits: {
        loadingLabel: () => 'Listing recent commits…',
        handler: (a) => listCommits(a.path, a.owner, a.repo, a.perPage)
    },
    get_commit: {
        loadingLabel: (a) => `Fetching commit ${String(a.sha).slice(0, 7)}…`,
        handler: (a) => getCommitDetails(a.sha, a.owner, a.repo)
    },
    compare_commits: {
        loadingLabel: (a) => `Comparing ${a.base}…${a.head}…`,
        handler: (a) => compareCommits(a.base, a.head, a.owner, a.repo)
    },
    get_github_user: {
        loadingLabel: (a) => `Fetching GitHub profile for ${a.username}…`,
        handler: (a) => getGithubUser(a.username)
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

/* --------------------------------------------------------------------------
   Preferences
   -------------------------------------------------------------------------- */
async function loadPreferences() {
    try {
        let result = {};
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            result = await new Promise(resolve => chrome.storage.local.get([
                'ai_name', 'ai_endpoint', 'ai_auto_approve', 'ai_github_enabled', 'ai_github_token'
            ], resolve));
        } else {
            result = {
                ai_name: localStorage.getItem('ai_name'),
                ai_endpoint: localStorage.getItem('ai_endpoint'),
                ai_auto_approve: localStorage.getItem('ai_auto_approve') === 'true',
                ai_github_enabled: localStorage.getItem('ai_github_enabled') !== 'false',
                ai_github_token: localStorage.getItem('ai_github_token')
            };
        }

        if (result.ai_name !== undefined && result.ai_name !== null) config.userName = result.ai_name;
        if (result.ai_endpoint) config.baseUrl = result.ai_endpoint;
        if (result.ai_auto_approve !== undefined) config.autoApprove = Boolean(result.ai_auto_approve);
        if (result.ai_github_enabled !== undefined) config.githubEnabled = Boolean(result.ai_github_enabled);
        if (result.ai_github_token) config.githubToken = result.ai_github_token;

        userNameInput.value = config.userName;
        endpointUrlInput.value = config.baseUrl;
        if (autoApproveToggle) autoApproveToggle.checked = config.autoApprove;
        if (githubAccessToggle) githubAccessToggle.checked = config.githubEnabled;
        if (githubTokenInput) githubTokenInput.value = config.githubToken;

        setGithubEnabled(config.githubEnabled);
        setGithubToken(config.githubToken);
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

function saveUserName(v) { config.userName = v || 'User'; saveSetting('ai_name', config.userName); }
function saveEndpoint(v) { config.baseUrl = v; saveSetting('ai_endpoint', v); }
function saveAutoApprove(v) { config.autoApprove = Boolean(v); saveSetting('ai_auto_approve', config.autoApprove); }

function saveGithubEnabled(v) {
    config.githubEnabled = Boolean(v);
    setGithubEnabled(config.githubEnabled);
    saveSetting('ai_github_enabled', config.githubEnabled);
    updateRateLimitUI();
}

function saveGithubToken(v) {
    config.githubToken = String(v || '').trim();
    setGithubToken(config.githubToken);
    saveSetting('ai_github_token', config.githubToken);
    updateRateLimitUI();
}

/* --------------------------------------------------------------------------
   Rate limit UI
   -------------------------------------------------------------------------- */
async function updateRateLimitUI() {
    if (!rateLimitStatusText) return;

    if (!config.githubEnabled) {
        rateLimitStatusText.textContent = 'GitHub API access is disabled in Preferences.';
        rateLimitStatusText.className = 'rate-limit-body';
        return;
    }

    rateLimitStatusText.textContent = 'Checking remaining requests…';
    rateLimitStatusText.className = 'rate-limit-body';

    try {
        const status = await getRateLimitStatus();
        if (!status.enabled) {
            rateLimitStatusText.textContent = status.message || 'GitHub API access is disabled.';
            rateLimitStatusText.className = 'rate-limit-body';
            return;
        }
        if (status.error) {
            rateLimitStatusText.textContent = `Error: ${status.error}`;
            rateLimitStatusText.className = 'rate-limit-body danger';
            return;
        }

        const auth = status.authenticated ? ' (authenticated)' : ' (unauthenticated)';
        rateLimitStatusText.textContent =
            `${status.remaining} / ${status.limit} requests remaining${auth} — resets at ${status.resetTimeString}`;

        rateLimitStatusText.className = 'rate-limit-body' +
            (status.remaining === 0 ? ' danger' : status.remaining < 10 ? ' warning' : '');
    } catch (err) {
        rateLimitStatusText.textContent = `Unable to fetch rate limit: ${err.message}`;
        rateLimitStatusText.className = 'rate-limit-body danger';
    }
}

/* --------------------------------------------------------------------------
   Event listeners
   -------------------------------------------------------------------------- */
function setupEventListeners() {
    retryBtn.addEventListener('click', fetchModels);
    lockBtn.addEventListener('click', toggleLock);
    newChatBtn.addEventListener('click', resetChat);
    sendBtn.addEventListener('click', handleSendOrStop);
    attachBtn.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', handleFileSelection);
    removeImageBtn.addEventListener('click', clearFileAttachment);

    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
        updateRateLimitUI();
    });
    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

    autoApproveToggle?.addEventListener('change', (e) => saveAutoApprove(e.target.checked));
    githubAccessToggle?.addEventListener('change', (e) => saveGithubEnabled(e.target.checked));
    githubTokenInput?.addEventListener('change', (e) => saveGithubToken(e.target.value));
    refreshRateLimitBtn?.addEventListener('click', updateRateLimitUI);

    document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.sidebar-nav .nav-item').forEach(i => i.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
            const tabId = e.currentTarget.getAttribute('data-tab');
            e.currentTarget.classList.add('active');
            $(tabId)?.classList.remove('hidden');
            settingsTitle.textContent = tabId === 'tab-model' ? 'Model Settings' : 'Preferences';
            if (tabId === 'tab-preferences') updateRateLimitUI();
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
        try {
            const parsed = new URL(e.target.value.trim());
            saveEndpoint(parsed.origin + parsed.pathname.replace(/\/+$/, ''));
            fetchModels();
        } catch {
            updateStatus("That doesn't look like a valid URL", 'error');
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
   File attachments
   -------------------------------------------------------------------------- */
function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const TEXT_EXTS = ['.txt', '.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.md',
    '.py', '.csv', '.xml', '.yml', '.yaml', '.sh', '.sql', '.rs', '.go', '.c', '.h',
    '.cpp', '.java', '.toml', '.ini', '.env', '.log'];

function isTextFile(file) {
    const type = file.type || '';
    if (type.startsWith('text/') || type.includes('json') || type.includes('javascript') || type.includes('xml')) return true;
    const name = file.name.toLowerCase();
    return TEXT_EXTS.some(ext => name.endsWith(ext));
}

function handleFileSelection(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
        showToast('That file is over 10 MB — try a smaller one.', 'error');
        return;
    }

    const isImage = file.type.startsWith('image/');
    const isText = isTextFile(file);
    const reader = new FileReader();

    reader.onerror = () => showToast('Couldn\'t read that file.', 'error');

    if (isImage) {
        reader.onload = () => {
            attachedFile = { name: file.name, type: file.type, size: file.size, isImage: true, dataUrl: reader.result };
            showFilePreviewBar(attachedFile);
        };
        reader.readAsDataURL(file);
    } else if (isText) {
        reader.onload = () => {
            attachedFile = { name: file.name, type: file.type || 'text/plain', size: file.size, isText: true, content: reader.result };
            showFilePreviewBar(attachedFile);
        };
        reader.readAsText(file);
    } else {
        reader.onload = () => {
            attachedFile = { name: file.name, type: file.type || 'application/octet-stream', size: file.size, isBinary: true, dataUrl: reader.result };
            showFilePreviewBar(attachedFile);
        };
        reader.readAsDataURL(file);
    }
}

function showFilePreviewBar(fileObj) {
    imagePreviewBar.classList.remove('hidden');
    if (fileObj.isImage) {
        imagePreviewThumb.src = fileObj.dataUrl;
        imagePreviewThumb.style.display = 'block';
    } else {
        imagePreviewThumb.src = '';
        imagePreviewThumb.style.display = 'none';
    }
    imagePreviewName.textContent = `${fileObj.name} (${formatBytes(fileObj.size)})`;
}

function clearFileAttachment() {
    attachedFile = null;
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
    modelSelect.replaceChildren(new Option('Fetching models…', ''));
    modelSelect.disabled = true;
    lockBtn.disabled = true;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(`${config.baseUrl}/models`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const valid = (data.data || []).filter(m => {
            const id = (m.id || '').toLowerCase();
            const type = (m.type || '').toLowerCase();
            return type !== 'embedding' && !id.includes('embed') && !id.includes('bge-') && !id.includes('bert');
        });

        modelSelect.replaceChildren();
        if (!valid.length) throw new Error('No chat-capable models were found on that endpoint.');

        valid.forEach(m => modelSelect.appendChild(new Option(m.id, m.id)));
        modelSelect.disabled = isLocked;
        lockBtn.disabled = false;
        updateStatus('Connected', 'success');
    } catch (err) {
        modelSelect.replaceChildren(new Option('No models available', ''));
        const msg = err.name === 'AbortError' ? 'Connection timed out' : err.message;
        updateStatus(`Can't reach your local AI (${msg})`, 'error');
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
        userPrompt.placeholder = 'Message modcore AI…';
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
    activeAbortController?.abort();
    activeAbortController = null;
    activeMessages = [];
    currentAssistantRow = null;
    toolRoundCount = 0;
    isGenerating = false;
    lastRegenBtn = null;
    updateSendButtonState();
    clearFileAttachment();
    renderWelcome();
    userPrompt.value = '';
    userPrompt.style.height = 'auto';
}

function renderWelcome() {
    chatStream.replaceChildren();
    const welcome = document.createElement('div');
    welcome.className = 'welcome-card';

    const icon = document.createElement('i');
    icon.className = 'icon icon-48 icon-chat';
    icon.setAttribute('aria-hidden', 'true');

    const title = document.createElement('h2');
    title.textContent = 'modcore AI';

    const desc = document.createElement('p');
    if (isLocked) {
        desc.textContent = "Ask me to check on an extension, tidy up your setup, inspect snapshots, or build a profile — I'm ready when you are.";
    } else {
        desc.append('Open ');
        const strong = document.createElement('strong');
        strong.textContent = 'Settings';
        desc.append(strong, ' to choose a local AI model to get started.');
    }

    welcome.append(icon, title, desc);
    chatStream.appendChild(welcome);
}

/* --------------------------------------------------------------------------
   Send / stop
   -------------------------------------------------------------------------- */
function handleSendOrStop() {
    if (isGenerating) stopGeneration();
    else handleSend();
}

function stopGeneration() {
    activeAbortController?.abort();
    activeAbortController = null;
    isGenerating = false;
    updateSendButtonState();
    finishTurn();
}

function updateSendButtonState() {
    sendBtn.replaceChildren();
    const icon = document.createElement('i');
    icon.className = `icon icon-16 ${isGenerating ? 'icon-close' : 'icon-arrow-right'}`;
    icon.setAttribute('aria-hidden', 'true');
    sendBtn.appendChild(icon);
    sendBtn.setAttribute('aria-label', isGenerating ? 'Stop generation' : 'Send message');
    sendBtn.title = isGenerating ? 'Stop generation' : 'Send message';
    sendBtn.classList.toggle('btn-stop', isGenerating);
}

async function handleSend() {
    const text = userPrompt.value.trim();
    if ((!text && !attachedFile) || !isLocked) return;

    chatStream.querySelector('.welcome-card')?.remove();

    if (activeMessages.length === 0) {
        activeMessages.push({ role: 'system', content: getSystemPrompt() });
    }

    let userContent = text;
    const fileSnapshot = attachedFile ? { ...attachedFile } : null;

    if (attachedFile) {
        if (attachedFile.isImage) {
            userContent = [
                { type: 'text', text: text || 'Take a look at this attached image.' },
                { type: 'image_url', image_url: { url: attachedFile.dataUrl } }
            ];
        } else if (attachedFile.isText) {
            userContent = `${text ? `${text}\n\n` : ''}--- Attached File: ${attachedFile.name} (${formatBytes(attachedFile.size)}) ---\n\`\`\`\n${attachedFile.content}\n\`\`\``;
        } else {
            userContent = `${text ? `${text}\n\n` : ''}[Attached file: ${attachedFile.name} (${attachedFile.type}, ${formatBytes(attachedFile.size)})]`;
        }
    }

    activeMessages.push({ role: 'user', content: userContent });
    appendUserMessage(text, fileSnapshot);

    clearFileAttachment();
    userPrompt.value = '';
    userPrompt.style.height = 'auto';
    userPrompt.disabled = true;

    isGenerating = true;
    updateSendButtonState();

    currentAssistantRow = null;
    toolRoundCount = 0;
    await queryLocalAI();
}

/* --------------------------------------------------------------------------
   Core query loop (streaming)
   -------------------------------------------------------------------------- */
async function queryLocalAI() {
    const loader = createToolLoader('Thinking…');
    if (!currentAssistantRow) currentAssistantRow = appendAssistantShell();

    activeAbortController = new AbortController();

    const body = {
        model: selectedModel,
        messages: activeMessages,
        tools: EXTENSION_TOOLS,
        stream: true
    };

    try {
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: activeAbortController.signal
        });

        if (!response.ok) {
            const txt = await response.text().catch(() => '');
            throw new Error(`Model server returned HTTP ${response.status}${txt ? ` — ${txt.slice(0, 200)}` : ''}`);
        }
        if (!response.body) throw new Error('The model server did not stream a response body.');

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        let fullContent = '';
        let toolCalls = [];
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;
                const jsonStr = trimmed.slice(6).trim();
                if (jsonStr === '[DONE]') continue;

                let parsed;
                try { parsed = JSON.parse(jsonStr); } catch { continue; }
                const delta = parsed.choices?.[0]?.delta || {};

                const reasoning = delta.reasoning_content || delta.reasoning;
                if (reasoning) currentAssistantRow.appendReasoning(reasoning);

                if (delta.content) {
                    fullContent += delta.content;
                    currentAssistantRow.appendContent(delta.content);
                }

                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0;
                        if (!toolCalls[idx]) {
                            toolCalls[idx] = { id: tc.id || `call_${Date.now()}_${idx}`, name: tc.function?.name, arguments: '' };
                        }
                        if (tc.function?.name) toolCalls[idx].name = tc.function.name;
                        if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
                    }
                }
            }
        }

        loader.remove();
        toolCalls = toolCalls.filter(Boolean);

        const assistantMsg = { role: 'assistant', content: fullContent };
        if (toolCalls.length) {
            assistantMsg.tool_calls = toolCalls.map(tc => ({
                id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments }
            }));
        }
        activeMessages.push(assistantMsg);

        if (toolCalls.length) {
            currentAssistantRow.endRound();
            toolRoundCount++;

            if (toolRoundCount > MAX_TOOL_ROUNDS) {
                currentAssistantRow.showError('Stopped after several tool calls in a row to avoid a loop. Ask again if you want me to keep going.');
                isGenerating = false;
                updateSendButtonState();
                currentAssistantRow.finalizeTurn();
                finishTurn();
                return;
            }

            for (const call of toolCalls) await executeToolCall(call);
            await queryLocalAI();
        } else {
            currentAssistantRow.finalizeTurn();
            isGenerating = false;
            updateSendButtonState();
            finishTurn();
        }
    } catch (err) {
        loader.remove();
        if (err.name !== 'AbortError') {
            currentAssistantRow.showError(friendlyNetworkError(err));
        }
        currentAssistantRow?.finalizeTurn();
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
    if (!isGenerating) sendBtn.disabled = false;
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
    } catch {
        const result = { success: false, error: `Arguments for "${fnName}" weren't valid JSON, so nothing ran.` };
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
                    loader.remove();
                    result = { success: false, status: 'denied', message: 'The user declined this action.' };
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
    if (fnName === 'suggest_page' && result?.success) renderPageSuggestionCard(result);
    activeMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
}

function renderPageSuggestionCard(result) {
    const card = document.createElement('div');
    card.className = 'page-suggestion-card';

    const header = document.createElement('div');
    header.className = 'page-suggestion-header';
    const icon = document.createElement('i');
    icon.className = 'icon icon-16 icon-link';
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong');
    title.textContent = result.title || 'Suggested Page';
    header.append(icon, title);
    card.appendChild(header);

    if (result.reason) {
        const reason = document.createElement('p');
        reason.className = 'page-suggestion-reason';
        reason.textContent = result.reason;
        card.appendChild(reason);
    }

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn btn-secondary btn-open-page';
    openBtn.textContent = `Open ${result.title || 'Page'}`;
    openBtn.addEventListener('click', () => {
        if (typeof chrome !== 'undefined' && chrome.tabs?.create) chrome.tabs.create({ url: result.url });
        else window.open(result.url, '_blank');
    });
    card.appendChild(openBtn);

    (currentAssistantRow?.containerRow || chatStream).appendChild(card);
    scrollIfNearBottom();
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
   Regenerate
   -------------------------------------------------------------------------- */
async function regenerateLast() {
    if (isGenerating || !isLocked) return;

    let lastUser = -1;
    for (let i = activeMessages.length - 1; i >= 0; i--) {
        if (activeMessages[i].role === 'user') { lastUser = i; break; }
    }
    if (lastUser === -1) return;

    activeMessages = activeMessages.slice(0, lastUser + 1);
    removeTrailingAssistantUI();

    currentAssistantRow = null;
    toolRoundCount = 0;
    isGenerating = true;
    updateSendButtonState();
    await queryLocalAI();
}

function removeTrailingAssistantUI() {
    const rows = [...chatStream.children].filter(el => el.classList?.contains('message-row'));
    let lastUser = -1;
    rows.forEach((r, i) => { if (r.classList.contains('user')) lastUser = i; });
    rows.slice(lastUser + 1).forEach(r => r.remove());
    chatStream.querySelectorAll('.tool-loader-badge').forEach(l => l.remove());
    lastRegenBtn = null;
}

/* --------------------------------------------------------------------------
   Toasts
   -------------------------------------------------------------------------- */
let toastTimer = null;
function showToast(message, type = 'info') {
    let toast = $('aiToast');
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
   Scrolling
   -------------------------------------------------------------------------- */
function scrollIfNearBottom() {
    const distance = chatStream.scrollHeight - chatStream.scrollTop - chatStream.clientHeight;
    if (distance < SCROLL_THRESHOLD) chatStream.scrollTop = chatStream.scrollHeight;
}

/* --------------------------------------------------------------------------
   UI builders
   -------------------------------------------------------------------------- */
function appendUserMessage(content, fileObj = null) {
    const row = document.createElement('div');
    row.className = 'message-row user';

    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (fileObj) {
        if (fileObj.isImage) {
            const imgWrap = document.createElement('div');
            imgWrap.className = 'message-attachment';
            const img = document.createElement('img');
            img.src = fileObj.dataUrl;
            img.alt = 'User attachment';
            imgWrap.appendChild(img);
            bubble.appendChild(imgWrap);
        } else {
            const fileCard = document.createElement('div');
            fileCard.className = 'message-file-card';
            const icon = document.createElement('i');
            icon.className = 'icon icon-16 icon-code';
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.textContent = `${fileObj.name} (${formatBytes(fileObj.size)})`;
            fileCard.append(icon, label);
            bubble.appendChild(fileCard);
        }
    }

    if (content) bubble.appendChild(renderMarkdown(content));

    wrapper.appendChild(bubble);
    row.appendChild(wrapper);
    chatStream.appendChild(row);
    scrollIfNearBottom();
}

function appendAssistantShell() {
    if (lastRegenBtn) { lastRegenBtn.remove(); lastRegenBtn = null; }

    const row = document.createElement('div');
    row.className = 'message-row assistant';

    let reasoningDetails = null;
    let reasoningContent = null;
    let currentBubble = null;
    let currentStream = null;
    let roundText = '';
    let turnText = '';
    let unsafe = false;
    let finalized = false;

    chatStream.appendChild(row);
    scrollIfNearBottom();

    const ensureReasoning = () => {
        if (!reasoningDetails) {
            reasoningDetails = document.createElement('details');
            reasoningDetails.className = 'reasoning-block';
            const summary = document.createElement('summary');
            summary.textContent = 'Thinking it through';
            reasoningContent = document.createElement('div');
            reasoningContent.className = 'reasoning-content';
            reasoningDetails.append(summary, reasoningContent);
            row.insertBefore(reasoningDetails, row.firstChild);
        }
    };

    const markUnsafe = () => {
        unsafe = true;
        if (currentBubble) {
            currentBubble.replaceChildren();
            const note = document.createElement('div');
            note.className = 'unsafe-notice';
            note.textContent = 'This response contained unsafe content and was blocked.';
            currentBubble.appendChild(note);
        }
    };

    return {
        containerRow: row,
        appendReasoning(chunk) {
            if (!chunk) return;
            ensureReasoning();
            reasoningContent.appendChild(document.createTextNode(chunk));
            scrollIfNearBottom();
        },
        renderToolCall(fnName, args, result) {
            const card = document.createElement('details');
            const failed = result && (result.success === false || result.error);
            card.className = `tool-call-card${failed ? ' tool-call-failed' : ''}`;

            const summary = document.createElement('summary');
            const icon = document.createElement('i');
            icon.className = `icon icon-16 ${failed ? 'icon-warning-status' : 'icon-code'}`;
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            const strong = document.createElement('strong');
            strong.textContent = humanizeToolName(fnName);
            label.append(' ', strong);
            summary.append(icon, label);

            const pre = document.createElement('pre');
            pre.textContent = JSON.stringify({ arguments: args, result }, null, 2);
            card.append(summary, pre);
            row.appendChild(card);
            scrollIfNearBottom();
        },
        appendContent(delta) {
            if (!delta || unsafe) return;
            if (!currentBubble) {
                const wrapper = document.createElement('div');
                wrapper.className = 'message-wrapper';
                currentBubble = document.createElement('div');
                currentBubble.className = 'message-bubble';
                wrapper.appendChild(currentBubble);
                row.appendChild(wrapper);
                currentStream = new StreamingMarkdown(currentBubble, { onUnsafe: markUnsafe });
            }
            roundText += delta;
            turnText += delta;
            currentStream.write(delta);
            scrollIfNearBottom();
        },
        endRound() {
            if (currentStream) {
                currentStream.end();
                if (currentBubble && !unsafe) currentBubble.replaceChildren(renderMarkdown(roundText));
                currentStream = null;
            }
            currentBubble = null;
            roundText = '';
        },
        finalizeTurn() {
            if (finalized) return;
            finalized = true;
            if (currentStream) {
                currentStream.end();
                if (currentBubble && !unsafe) currentBubble.replaceChildren(renderMarkdown(roundText));
                currentStream = null;
                currentBubble = null;
                roundText = '';
            }
            if (turnText && !unsafe) addMessageActions(row, turnText);
        },
        showError(message) {
            const wrapper = document.createElement('div');
            wrapper.className = 'message-wrapper';
            const bubble = document.createElement('div');
            bubble.className = 'message-bubble error-bubble';
            bubble.textContent = `⚠️ ${message}`;
            wrapper.appendChild(bubble);
            row.appendChild(wrapper);
            scrollIfNearBottom();
        }
    };
}

function addMessageActions(row, text) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'msg-action-btn';
    copyBtn.title = 'Copy response';
    copyBtn.setAttribute('aria-label', 'Copy response');
    copyBtn.innerHTML = '<i class="icon icon-16 icon-copy" aria-hidden="true"></i>';
    copyBtn.addEventListener('click', () => copyText(text, copyBtn));

    const regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.className = 'msg-action-btn';
    regenBtn.title = 'Regenerate';
    regenBtn.setAttribute('aria-label', 'Regenerate response');
    regenBtn.innerHTML = '<i class="icon icon-16 icon-refresh" aria-hidden="true"></i>';
    regenBtn.addEventListener('click', regenerateLast);

    actions.append(copyBtn, regenBtn);
    row.appendChild(actions);
    lastRegenBtn = regenBtn;
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
    badge.append(icon, span);
    chatStream.appendChild(badge);
    scrollIfNearBottom();
    return badge;
}

function updateStatus(message, type) {
    statusText.textContent = message;
    statusBanner.className = `status-banner ${type}`;
}