/* ==========================================================================
   ai_tools.js - Tool Definitions & Handlers for modcore AI
   ========================================================================== */

import {
    loadProfileStore,
    saveProfileStore,
    generateProfileId,
    applyProfile
} from '../../shared/js/profiles.js';

/* --------------------------------------------------------------------------
   Tool Schemas (OpenAI-compatible "function" tool format)
   -------------------------------------------------------------------------- */
export const EXTENSION_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'suggest_page',
            description: 'Suggest an internal page or view in modcore Extension Manager for the user to open (e.g. Snapshots, Timeline, Automations, Safety Center, Profiles, Popup, Options). Use this tool call whenever recommending a specific feature or page interface to the user.',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'Relative URL of the page to open (e.g. "../../src/views/popup/popup.html", "../../src/views/snapshot/snapshot.html", "../../src/views/timeline/timeline.html", "../../src/views/automations/automations.html", "../../src/views/safety-center/safety-center.html", "../../src/views/profiles-page/profiles-page.html", "../../src/views/ai/ai.html").'
                    },
                    title: {
                        type: 'string',
                        description: 'Display title of the page (e.g. "modcore Snapshot", "Safety Center", "modcore Automations", "modcore Timeline", "Profiles Page", "Popup").'
                    },
                    reason: {
                        type: 'string',
                        description: 'Brief explanation for why opening this page helps the user.'
                    }
                },
                required: ['url', 'title']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_extensions',
            description: 'List installed browser extensions with their name, id, version, enabled state, and a short description. Use this first to see what exists before acting on a specific extension.',
            parameters: {
                type: 'object',
                properties: {
                    includeDisabled: {
                        type: 'boolean',
                        description: 'Include disabled extensions in the list. Defaults to true.'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'find_extension',
            description: 'Search installed extensions by name (partial matches allowed). Returns every close match with its exact ID. Use this whenever you are not 100% sure of an extension\'s exact ID before calling toggle_extensions or uninstall_extensions - it avoids guessing wrong.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Full or partial extension name to search for.' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_extension_details',
            description: 'Get full metadata (permissions, host permissions, install type, options page, etc.) for one extension.',
            parameters: {
                type: 'object',
                properties: {
                    identifier: { type: 'string', description: 'Extension ID or name (exact or partial).' }
                },
                required: ['identifier']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'toggle_extensions',
            description: 'Enable or disable one or more extensions in a single call. Note: You cannot disable modcore Extension Manager itself.',
            parameters: {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        description: 'Extensions to change.',
                        items: {
                            type: 'object',
                            properties: {
                                identifier: { type: 'string', description: 'Extension ID or name.' },
                                enable: { type: 'boolean', description: 'true to enable, false to disable.' }
                            },
                            required: ['identifier', 'enable']
                        }
                    }
                },
                required: ['items']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'uninstall_extensions',
            description: 'Permanently uninstall one or more extensions. Always destructive and requires user approval unless auto-approval is enabled. Note: You cannot uninstall modcore Extension Manager itself.',
            parameters: {
                type: 'object',
                properties: {
                    identifiers: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Extension IDs or names to uninstall.'
                    }
                },
                required: ['identifiers']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_profiles',
            description: 'List every saved profile preset with its name, ID, assigned shortcut, and a summary of which extensions it turns on/off.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_profile',
            description: 'Get full details for one profile, including the resolved names of every extension it references.',
            parameters: {
                type: 'object',
                properties: {
                    identifier: { type: 'string', description: 'Profile ID or name (exact or partial).' }
                },
                required: ['identifier']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'apply_profile',
            description: 'Apply a profile preset, enabling/disabling extensions to match it.',
            parameters: {
                type: 'object',
                properties: {
                    identifier: { type: 'string', description: 'Profile ID or name (exact or partial).' }
                },
                required: ['identifier']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_profile',
            description: 'Create a new profile preset. Give it a name and a list of extensions with the state you want them in when the profile is applied.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Profile name, e.g. "Work" or "Focus Mode".' },
                    extensions: {
                        type: 'array',
                        description: 'Extensions this profile controls.',
                        items: {
                            type: 'object',
                            properties: {
                                identifier: { type: 'string', description: 'Extension ID or name.' },
                                enabled: { type: 'boolean', description: 'State to set when this profile is applied.' }
                            },
                            required: ['identifier', 'enabled']
                        }
                    },
                    shortcut: { type: 'string', description: 'Optional keyboard shortcut, e.g. "Ctrl+Shift+1".' }
                },
                required: ['name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_profile',
            description: 'Modify an existing profile. Supports renaming, changing shortcut, and incrementally adding/removing/setting extension rules.',
            parameters: {
                type: 'object',
                properties: {
                    identifier: { type: 'string', description: 'Profile ID or name to modify.' },
                    name: { type: 'string', description: 'New name for the profile.' },
                    shortcut: { type: 'string', description: 'New keyboard shortcut, or an empty string to clear it.' },
                    setExtensions: {
                        type: 'array',
                        description: 'Extensions to add or update within this profile.',
                        items: {
                            type: 'object',
                            properties: {
                                identifier: { type: 'string' },
                                enabled: { type: 'boolean' }
                            },
                            required: ['identifier', 'enabled']
                        }
                    },
                    removeExtensions: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Extension names or IDs to remove from this profile entirely.'
                    },
                    replaceExtensions: {
                        type: 'boolean',
                        description: 'If true, setExtensions fully replaces the profile\'s extension list instead of merging.'
                    }
                },
                required: ['identifier']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'duplicate_profile',
            description: 'Duplicate an existing profile under a new name.',
            parameters: {
                type: 'object',
                properties: {
                    identifier: { type: 'string', description: 'Profile ID or name to duplicate.' },
                    newName: { type: 'string', description: 'Name for the duplicate.' }
                },
                required: ['identifier', 'newName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_profile',
            description: 'Permanently delete a profile preset. Requires user approval unless auto-approval is enabled.',
            parameters: {
                type: 'object',
                properties: {
                    identifier: { type: 'string', description: 'Profile ID or name to delete.' }
                },
                required: ['identifier']
            }
        }
    },
        {
        type: 'function',
        function: {
            name: 'check_latest_release',
            description: 'Get the latest release of a GitHub repository, including the full changelog.',
            parameters: {
                type: 'object',
                properties: {
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_recent_releases',
            description: 'List recent releases of a GitHub repository, optionally with full changelogs.',
            parameters: {
                type: 'object',
                properties: {
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' },
                    perPage: { type: 'number', description: 'Number of releases to return (1-100). Defaults to 10.' },
                    includeChangelog: { type: 'boolean', description: 'Include the full release notes for each release. Defaults to true.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_release_by_tag',
            description: 'Get a specific release by its tag name, including the full changelog.',
            parameters: {
                type: 'object',
                properties: {
                    tag: { type: 'string', description: 'Release tag, e.g. "v1.2.0".' },
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' }
                },
                required: ['tag']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_repo_details',
            description: 'Get details about a GitHub repository (stars, forks, open issues, license, language, topics).',
            parameters: {
                type: 'object',
                properties: {
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_contributors',
            description: 'List contributors to a GitHub repository.',
            parameters: {
                type: 'object',
                properties: {
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' },
                    perPage: { type: 'number', description: 'Number of contributors (1-100). Defaults to 20.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_branches',
            description: 'List branches in a GitHub repository.',
            parameters: {
                type: 'object',
                properties: {
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' },
                    perPage: { type: 'number', description: 'Number of branches (1-100). Defaults to 30.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_tags',
            description: 'List tags in a GitHub repository.',
            parameters: {
                type: 'object',
                properties: {
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' },
                    perPage: { type: 'number', description: 'Number of tags (1-100). Defaults to 30.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_documentation',
            description: 'Read the README or a documentation file from a GitHub repository.',
            parameters: {
                type: 'object',
                properties: {
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' },
                    path: { type: 'string', description: 'Optional relative file path, e.g. "docs/FAQ.md". Defaults to README.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_file_content',
            description: 'Read code/text content of a file or list directory contents in a GitHub repository. Handles large files via the blob API.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File or directory path within the repository.' },
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' },
                    ref: { type: 'string', description: 'Optional branch name, tag, or commit SHA.' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_code',
            description: 'Search code within a GitHub org or repository. Requires an authenticated GitHub token configured in Preferences.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Code search terms.' },
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Optional repository name to narrow the search.' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_github_issues',
            description: 'Search GitHub issues and pull requests in a repository or organization.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search terms.' },
                    state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Filter state. Defaults to "open".' },
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Optional repository name. Defaults to "modcore-extension-manager".' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_issue_or_pr',
            description: 'Get full details (including all comments) for a GitHub issue or pull request.',
            parameters: {
                type: 'object',
                properties: {
                    issueNumber: { type: 'number', description: 'The issue or pull request number.' },
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' }
                },
                required: ['issueNumber']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_issue_comments',
            description: 'List all comments on an issue or pull request.',
            parameters: {
                type: 'object',
                properties: {
                    issueNumber: { type: 'number', description: 'The issue or pull request number.' },
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' },
                    perPage: { type: 'number', description: 'Number of comments (1-100). Defaults to 30.' }
                },
                required: ['issueNumber']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_pull_requests',
            description: 'List pull requests in a GitHub repository.',
            parameters: {
                type: 'object',
                properties: {
                    state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Filter state. Defaults to "open".' },
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_commits',
            description: 'List recent commits in a GitHub repository or for a specific file path.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Optional path to filter commits.' },
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' },
                    perPage: { type: 'number', description: 'Number of commits (1-100). Defaults to 10.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_commit',
            description: 'Get details (stats, files changed, patches) for a specific commit SHA.',
            parameters: {
                type: 'object',
                properties: {
                    sha: { type: 'string', description: 'Commit SHA (full or short).' },
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' }
                },
                required: ['sha']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'compare_commits',
            description: 'Compare two commits, branches, or tags in a GitHub repository.',
            parameters: {
                type: 'object',
                properties: {
                    base: { type: 'string', description: 'Base ref (branch, tag, or SHA).' },
                    head: { type: 'string', description: 'Head ref (branch, tag, or SHA).' },
                    owner: { type: 'string', description: 'GitHub owner or organization. Defaults to "modcoretech".' },
                    repo: { type: 'string', description: 'Repository name. Defaults to "modcore-extension-manager".' }
                },
                required: ['base', 'head']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_github_user',
            description: 'Get public profile information for a GitHub user or organization.',
            parameters: {
                type: 'object',
                properties: {
                    username: { type: 'string', description: 'GitHub username or organization name.' }
                },
                required: ['username']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_github_rate_limit',
            description: 'Check the current GitHub API rate limit status.',
            parameters: { type: 'object', properties: {} }
        }
    }
];

/* --------------------------------------------------------------------------
   Small internal utilities
   -------------------------------------------------------------------------- */
class ToolError extends Error {
    constructor(message, code = 'tool_error') {
        super(message);
        this.code = code;
    }
}

function normalize(str) {
    return String(str || '').trim().toLowerCase();
}

/**
 * Check if an extension is modcore Extension Manager itself.
 */
function isSelfExtensionManager(identifier, ext) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && ext?.id === chrome.runtime.id) {
        return true;
    }
    const idNorm = normalize(identifier);
    const nameNorm = ext ? normalize(ext.name) : '';
    return idNorm === 'modcore-extension-manager' || nameNorm === 'modcore extension manager';
}

function formatExtensionInfo(ext) {
    return {
        id: ext.id,
        name: ext.name,
        enabled: ext.enabled,
        version: ext.version || 'Unknown',
        description: ext.description || 'No description provided.',
        installType: ext.installType || 'normal',
        isApp: Boolean(ext.isApp),
        mayDisable: ext.mayDisable ?? true,
        permissions: ext.permissions || [],
        hostPermissions: ext.hostPermissions || [],
        optionsUrl: ext.optionsUrl || null,
        homepageUrl: ext.homepageUrl || null
    };
}

function resolveExtension(identifier, extensions) {
    const idOrName = normalize(identifier);
    if (!idOrName) return { status: 'not_found', matches: [] };

    const byId = extensions.find(e => e.id === identifier);
    if (byId) return { status: 'ok', match: byId };

    const exactName = extensions.filter(e => normalize(e.name) === idOrName);
    if (exactName.length === 1) return { status: 'ok', match: exactName[0] };
    if (exactName.length > 1) return { status: 'ambiguous', matches: exactName };

    const partial = extensions.filter(e => normalize(e.name).includes(idOrName));
    if (partial.length === 1) return { status: 'ok', match: partial[0] };
    if (partial.length > 1) return { status: 'ambiguous', matches: partial };

    return { status: 'not_found', matches: [] };
}

function resolveProfile(identifier, profiles) {
    const idOrName = normalize(identifier);
    if (!idOrName) return { status: 'not_found', matches: [] };

    if (profiles[identifier]) return { status: 'ok', match: profiles[identifier] };

    const list = Object.values(profiles);
    const exact = list.filter(p => normalize(p.name) === idOrName);
    if (exact.length === 1) return { status: 'ok', match: exact[0] };
    if (exact.length > 1) return { status: 'ambiguous', matches: exact };

    const partial = list.filter(p => normalize(p.name).includes(idOrName));
    if (partial.length === 1) return { status: 'ok', match: partial[0] };
    if (partial.length > 1) return { status: 'ambiguous', matches: partial };

    return { status: 'not_found', matches: [] };
}

function describeAmbiguous(kind, matches) {
    const names = matches.map(m => `"${m.name}" (${m.id})`).join(', ');
    return new ToolError(`More than one ${kind} matches that description: ${names}. Please specify which one by exact ID.`, 'ambiguous');
}

function describeNotFound(kind, identifier) {
    return new ToolError(`No ${kind} matching "${identifier}" was found.`, 'not_found');
}

/* --------------------------------------------------------------------------
   Page Suggestion Handler
   -------------------------------------------------------------------------- */
export async function suggestPage(url, title, reason = '') {
    if (!url || typeof url !== 'string') {
        throw new ToolError('A page URL is required.');
    }
    return {
        success: true,
        action: 'page_suggested',
        url: url.trim(),
        title: title ? title.trim() : 'modcore Extension Manager Page',
        reason: reason ? reason.trim() : ''
    };
}

/* --------------------------------------------------------------------------
   Extension Handlers
   -------------------------------------------------------------------------- */
export async function listInstalledExtensions(includeDisabled = true) {
    return new Promise((resolve, reject) => {
        if (typeof chrome === 'undefined' || !chrome.management?.getAll) {
            return reject(new ToolError('The extension management API is unavailable in this context.'));
        }
        chrome.management.getAll((extensions) => {
            if (chrome.runtime.lastError) return reject(new ToolError(chrome.runtime.lastError.message));
            const filtered = includeDisabled ? extensions : extensions.filter(e => e.enabled);
            resolve(filtered.map(formatExtensionInfo));
        });
    });
}

export async function findExtensions(query) {
    if (!query || typeof query !== 'string') throw new ToolError('A search query is required.');
    const all = await listInstalledExtensions(true);
    const q = normalize(query);
    const matches = all.filter(e => normalize(e.name).includes(q));
    return { query, count: matches.length, matches };
}

export async function getExtensionDetails(identifier) {
    if (!identifier || typeof identifier !== 'string') throw new ToolError('An extension ID or name is required.');
    const all = await listInstalledExtensions(true);
    const resolved = resolveExtension(identifier, all);
    if (resolved.status === 'ambiguous') throw describeAmbiguous('extension', resolved.matches);
    if (resolved.status === 'not_found') throw describeNotFound('extension', identifier);
    return resolved.match;
}

async function setExtensionEnabledRaw(id, enable) {
    return new Promise((resolve, reject) => {
        chrome.management.setEnabled(id, Boolean(enable), () => {
            if (chrome.runtime.lastError) return reject(new ToolError(chrome.runtime.lastError.message));
            resolve(true);
        });
    });
}

export async function toggleExtensions(items = []) {
    if (typeof chrome === 'undefined' || !chrome.management?.setEnabled) {
        throw new ToolError('The extension management API is unavailable in this context.');
    }
    if (!Array.isArray(items) || items.length === 0) throw new ToolError('At least one extension item is required.');

    const all = await listInstalledExtensions(true);
    const results = [];

    for (const item of items) {
        const resolved = resolveExtension(item.identifier, all);
        if (resolved.status === 'not_found') {
            results.push({ identifier: item.identifier, status: 'not_found', message: `No extension matching "${item.identifier}".` });
            continue;
        }
        if (resolved.status === 'ambiguous') {
            results.push({ identifier: item.identifier, status: 'ambiguous', candidates: resolved.matches.map(m => ({ id: m.id, name: m.name })) });
            continue;
        }
        const ext = resolved.match;

        // Policy protection: Disallow disabling modcore Extension Manager itself
        if (isSelfExtensionManager(item.identifier, ext) && item.enable === false) {
            results.push({
                identifier: item.identifier,
                status: 'blocked',
                name: ext.name,
                message: 'modcore Extension Manager is the extension manager itself and cannot be disabled.'
            });
            continue;
        }

        if (!ext.mayDisable) {
            results.push({ identifier: item.identifier, status: 'blocked', name: ext.name, message: 'This extension is managed by policy and cannot be toggled.' });
            continue;
        }
        if (ext.enabled === Boolean(item.enable)) {
            results.push({ identifier: item.identifier, status: 'unchanged', id: ext.id, name: ext.name, enabled: ext.enabled });
            continue;
        }
        try {
            await setExtensionEnabledRaw(ext.id, item.enable);
            results.push({ identifier: item.identifier, status: 'success', id: ext.id, name: ext.name, enabled: Boolean(item.enable) });
        } catch (e) {
            results.push({ identifier: item.identifier, status: 'error', name: ext.name, message: e.message });
        }
    }

    const succeeded = results.filter(r => r.status === 'success').length;
    return { success: succeeded > 0 || results.every(r => r.status === 'unchanged'), results };
}

export async function uninstallExtensions(identifiers = []) {
    if (typeof chrome === 'undefined' || !chrome.management?.uninstall) {
        throw new ToolError('The extension management API is unavailable in this context.');
    }
    if (!Array.isArray(identifiers) || identifiers.length === 0) throw new ToolError('At least one extension identifier is required.');

    const all = await listInstalledExtensions(true);
    const results = [];

    for (const identifier of identifiers) {
        const resolved = resolveExtension(identifier, all);
        if (resolved.status === 'not_found') {
            results.push({ identifier, status: 'not_found' });
            continue;
        }
        if (resolved.status === 'ambiguous') {
            results.push({ identifier, status: 'ambiguous', candidates: resolved.matches.map(m => ({ id: m.id, name: m.name })) });
            continue;
        }
        const ext = resolved.match;

        // Policy protection: Disallow uninstalling modcore Extension Manager itself
        if (isSelfExtensionManager(identifier, ext)) {
            results.push({
                identifier,
                status: 'blocked',
                name: ext.name,
                message: 'modcore Extension Manager is the extension manager itself and cannot be uninstalled.'
            });
            continue;
        }

        try {
            await new Promise((resolve, reject) => {
                chrome.management.uninstall(ext.id, { showConfirmDialog: false }, () => {
                    if (chrome.runtime.lastError) return reject(new ToolError(chrome.runtime.lastError.message));
                    resolve();
                });
            });
            results.push({ identifier, status: 'success', id: ext.id, name: ext.name });
        } catch (e) {
            results.push({ identifier, status: 'error', name: ext.name, message: e.message });
        }
    }

    return { success: results.some(r => r.status === 'success'), results };
}

/* --------------------------------------------------------------------------
   Profile Handlers
   -------------------------------------------------------------------------- */
function summarizeProfile(profile, extensionsById) {
    const states = Object.entries(profile.extensionStates || {}).map(([id, enabled]) => ({
        id,
        name: extensionsById.get(id)?.name || '(uninstalled extension)',
        enabled
    }));
    return {
        id: profile.id,
        name: profile.name,
        shortcut: profile.shortcut || null,
        extensionCount: states.length,
        extensions: states
    };
}

export async function listProfiles() {
    const store = await loadProfileStore();
    const installed = await listInstalledExtensions(true).catch(() => []);
    const byId = new Map(installed.map(e => [e.id, e]));
    return store.order.map(id => store.profiles[id]).filter(Boolean).map(p => summarizeProfile(p, byId));
}

export async function getProfile(identifier) {
    const store = await loadProfileStore();
    const resolved = resolveProfile(identifier, store.profiles);
    if (resolved.status === 'ambiguous') throw describeAmbiguous('profile', resolved.matches);
    if (resolved.status === 'not_found') throw describeNotFound('profile', identifier);

    const installed = await listInstalledExtensions(true).catch(() => []);
    const byId = new Map(installed.map(e => [e.id, e]));
    return summarizeProfile(resolved.match, byId);
}

export async function applyProfileByIdentifier(identifier) {
    const store = await loadProfileStore();
    const resolved = resolveProfile(identifier, store.profiles);
    if (resolved.status === 'ambiguous') throw describeAmbiguous('profile', resolved.matches);
    if (resolved.status === 'not_found') throw describeNotFound('profile', identifier);

    const installed = await listInstalledExtensions(true);
    const extensionMap = new Map(installed.map(ext => [ext.id, ext]));

    const result = await applyProfile(resolved.match.id, extensionMap);
    return { profileName: resolved.match.name, ...result };
}

async function resolveExtensionStateList(entries = []) {
    const installed = await listInstalledExtensions(true);
    const stateMap = {};
    const unresolved = [];

    for (const entry of entries) {
        const resolved = resolveExtension(entry.identifier, installed);
        if (resolved.status === 'ok') {
            stateMap[resolved.match.id] = Boolean(entry.enabled);
        } else {
            unresolved.push({ identifier: entry.identifier, reason: resolved.status, candidates: (resolved.matches || []).map(m => ({ id: m.id, name: m.name })) });
        }
    }
    return { stateMap, unresolved };
}

export async function createProfile(name, extensions = [], shortcut = null) {
    if (!name || !name.trim()) throw new ToolError('A profile name is required.');

    const store = await loadProfileStore();
    const dupe = Object.values(store.profiles).find(p => normalize(p.name) === normalize(name));
    if (dupe) throw new ToolError(`A profile named "${name}" already exists. Use update_profile instead, or pick a different name.`);

    const { stateMap, unresolved } = await resolveExtensionStateList(extensions);

    const newId = generateProfileId();
    store.profiles[newId] = {
        id: newId,
        name: name.trim(),
        extensionStates: stateMap,
        shortcut: shortcut ? shortcut.trim() : null
    };
    store.order.push(newId);
    await saveProfileStore(store);

    return {
        success: true,
        profile: { id: newId, name: store.profiles[newId].name, extensionCount: Object.keys(stateMap).length, shortcut: store.profiles[newId].shortcut },
        unresolvedExtensions: unresolved.length ? unresolved : undefined
    };
}

export async function updateProfile(identifier, updates = {}) {
    const store = await loadProfileStore();
    const resolved = resolveProfile(identifier, store.profiles);
    if (resolved.status === 'ambiguous') throw describeAmbiguous('profile', resolved.matches);
    if (resolved.status === 'not_found') throw describeNotFound('profile', identifier);

    const profile = store.profiles[resolved.match.id];
    const changes = [];
    let unresolved = [];

    if (typeof updates.name === 'string' && updates.name.trim() && updates.name.trim() !== profile.name) {
        changes.push(`renamed to "${updates.name.trim()}"`);
        profile.name = updates.name.trim();
    }

    if (typeof updates.shortcut === 'string') {
        profile.shortcut = updates.shortcut.trim() || null;
        changes.push(profile.shortcut ? `shortcut set to ${profile.shortcut}` : 'shortcut cleared');
    }

    if (Array.isArray(updates.setExtensions) && updates.setExtensions.length > 0) {
        const resolvedList = await resolveExtensionStateList(updates.setExtensions);
        unresolved = resolvedList.unresolved;
        if (updates.replaceExtensions) {
            profile.extensionStates = resolvedList.stateMap;
            changes.push(`extension list replaced (${Object.keys(resolvedList.stateMap).length} extensions)`);
        } else {
            profile.extensionStates = { ...profile.extensionStates, ...resolvedList.stateMap };
            changes.push(`${Object.keys(resolvedList.stateMap).length} extension rule(s) added/updated`);
        }
    }

    if (Array.isArray(updates.removeExtensions) && updates.removeExtensions.length > 0) {
        const installed = await listInstalledExtensions(true);
        let removedCount = 0;
        for (const identifier2 of updates.removeExtensions) {
            const r = resolveExtension(identifier2, installed);
            const targetId = r.status === 'ok' ? r.match.id : identifier2;
            if (Object.prototype.hasOwnProperty.call(profile.extensionStates, targetId)) {
                delete profile.extensionStates[targetId];
                removedCount++;
            }
        }
        if (removedCount) changes.push(`${removedCount} extension(s) removed from profile`);
    }

    if (changes.length === 0 && unresolved.length === 0) {
        throw new ToolError('No valid changes were provided.');
    }

    await saveProfileStore(store);

    return {
        success: true,
        profile: { id: profile.id, name: profile.name, extensionCount: Object.keys(profile.extensionStates).length, shortcut: profile.shortcut },
        changes,
        unresolvedExtensions: unresolved.length ? unresolved : undefined
    };
}

export async function duplicateProfile(identifier, newName) {
    if (!newName || !newName.trim()) throw new ToolError('A name for the duplicate is required.');
    const store = await loadProfileStore();
    const resolved = resolveProfile(identifier, store.profiles);
    if (resolved.status === 'ambiguous') throw describeAmbiguous('profile', resolved.matches);
    if (resolved.status === 'not_found') throw describeNotFound('profile', identifier);

    const dupeExists = Object.values(store.profiles).find(p => normalize(p.name) === normalize(newName));
    if (dupeExists) throw new ToolError(`A profile named "${newName}" already exists.`);

    const source = resolved.match;
    const newId = generateProfileId();
    store.profiles[newId] = {
        id: newId,
        name: newName.trim(),
        extensionStates: { ...source.extensionStates },
        shortcut: null
    };
    store.order.push(newId);
    await saveProfileStore(store);

    return { success: true, profile: { id: newId, name: newName.trim(), extensionCount: Object.keys(store.profiles[newId].extensionStates).length } };
}

export async function deleteProfileByIdentifier(identifier) {
    const store = await loadProfileStore();
    const resolved = resolveProfile(identifier, store.profiles);
    if (resolved.status === 'ambiguous') throw describeAmbiguous('profile', resolved.matches);
    if (resolved.status === 'not_found') throw describeNotFound('profile', identifier);

    delete store.profiles[resolved.match.id];
    store.order = store.order.filter(id => id !== resolved.match.id);
    await saveProfileStore(store);

    return { success: true, deletedName: resolved.match.name, deletedId: resolved.match.id };
}

export { ToolError };