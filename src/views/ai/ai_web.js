/* ==========================================================================
   ai_web.js - Expanded GitHub API Tools & Rate Limit Tracking
   ========================================================================== */

const GITHUB_DEFAULT_OWNER = 'modcoretech';
const GITHUB_DEFAULT_REPO  = 'modcore-extension-manager';

let isGithubEnabled = true;

let cachedRateLimit = {
    limit: 60,
    remaining: 60,
    reset: null
};

export function setGithubEnabled(enabled) {
    isGithubEnabled = Boolean(enabled);
}

export function getGithubEnabled() {
    return isGithubEnabled;
}

export function getCachedRateLimit() {
    return { ...cachedRateLimit };
}

function updateRateLimitFromHeaders(headers) {
    if (!headers) return;
    const limit = headers.get('x-ratelimit-limit');
    const remaining = headers.get('x-ratelimit-remaining');
    const reset = headers.get('x-ratelimit-reset');

    if (limit !== null) cachedRateLimit.limit = parseInt(limit, 10);
    if (remaining !== null) cachedRateLimit.remaining = parseInt(remaining, 10);
    if (reset !== null) cachedRateLimit.reset = parseInt(reset, 10);
}

/* --------------------------------------------------------------------------
   Internal HTTP fetcher with rate limit tracking & robust error handling
   -------------------------------------------------------------------------- */
async function ghFetch(path) {
    if (!isGithubEnabled) {
        throw new Error('GitHub API access is currently disabled in Preferences.');
    }

    if (!navigator.onLine) {
        throw new Error('Network error: You appear to be offline. Check your internet connection and try again.');
    }

    let res;
    try {
        res = await fetch(`https://api.github.com${path}`, {
            headers: { 'Accept': 'application/vnd.github+json' }
        });
    } catch (netErr) {
        throw new Error(`Failed to connect to GitHub API: ${netErr.message || 'Network request failed'}`);
    }

    updateRateLimitFromHeaders(res.headers);

    if (res.status === 403) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        const resetHeader = res.headers.get('x-ratelimit-reset');
        if (remaining === '0' || cachedRateLimit.remaining === 0) {
            const resetDate = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000) : null;
            const resetStr = resetDate ? resetDate.toLocaleTimeString() : 'later';
            throw new Error(`GitHub API rate limit exceeded (${cachedRateLimit.remaining}/${cachedRateLimit.limit} remaining for unauthorized requests). Resets at ${resetStr}.`);
        }
        const errData = await res.json().catch(() => ({}));
        throw new Error(`GitHub API access forbidden (HTTP 403): ${errData.message || 'Access denied'}`);
    }

    if (res.status === 404) {
        throw new Error(`Resource not found on GitHub (HTTP 404): ${path}`);
    }

    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`GitHub API error (HTTP ${res.status}): ${errData.message || res.statusText}`);
    }

    return res.json();
}

/* --------------------------------------------------------------------------
   Public Tool Handlers
   -------------------------------------------------------------------------- */

/**
 * Get the latest release for a repository.
 */
export async function getLatestRelease(owner = GITHUB_DEFAULT_OWNER, repo = GITHUB_DEFAULT_REPO) {
    const o = owner || GITHUB_DEFAULT_OWNER;
    const r = repo || GITHUB_DEFAULT_REPO;
    const data = await ghFetch(`/repos/${o}/${r}/releases/latest`);
    return {
        repository: `${o}/${r}`,
        tag: data.tag_name,
        name: data.name || data.tag_name,
        published: data.published_at,
        url: data.html_url,
        changelogExcerpt: data.body ? data.body.slice(0, 2000) : 'No changelog provided.'
    };
}

/**
 * Search issues/PRs in a repository.
 */
export async function searchIssues(query, state = 'open', owner = GITHUB_DEFAULT_OWNER, repo = GITHUB_DEFAULT_REPO) {
    if (!query || typeof query !== 'string') {
        throw new Error('A search query is required.');
    }
    const o = owner || GITHUB_DEFAULT_OWNER;
    const r = repo || GITHUB_DEFAULT_REPO;
    const stateFilter = state && state !== 'all' ? ` state:${state}` : '';
    const q = encodeURIComponent(`repo:${o}/${r} ${query}${stateFilter}`);
    const data = await ghFetch(`/search/issues?q=${q}&per_page=10`);
    return {
        repository: `${o}/${r}`,
        totalCount: data.total_count,
        issues: (data.items || []).map(i => ({
            number: i.number,
            title: i.title,
            state: i.state,
            isPullRequest: Boolean(i.pull_request),
            url: i.html_url,
            labels: (i.labels || []).map(l => l.name),
            createdAt: i.created_at,
            comments: i.comments
        }))
    };
}

/**
 * Get README or documentation file from a repository.
 */
export async function getReadme(owner = GITHUB_DEFAULT_OWNER, repo = GITHUB_DEFAULT_REPO, path = '') {
    const o = owner || GITHUB_DEFAULT_OWNER;
    const r = repo || GITHUB_DEFAULT_REPO;
    const endpoint = path ? `/repos/${o}/${r}/contents/${encodeURIComponent(path)}` : `/repos/${o}/${r}/readme`;
    const data = await ghFetch(endpoint);

    let text = '';
    if (data.content && data.encoding === 'base64') {
        try {
            const binary = atob(data.content.replace(/\s/g, ''));
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            text = new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
            text = atob(data.content.replace(/\s/g, ''));
        }
    }

    return {
        repository: `${o}/${r}`,
        path: data.path || path || 'README.md',
        url: data.html_url,
        content: text.slice(0, 4000)
    };
}

/**
 * List recent releases for a repository.
 */
export async function listReleases(owner = GITHUB_DEFAULT_OWNER, repo = GITHUB_DEFAULT_REPO, perPage = 5) {
    const o = owner || GITHUB_DEFAULT_OWNER;
    const r = repo || GITHUB_DEFAULT_REPO;
    const count = Math.min(Math.max(1, perPage || 5), 20);
    const releases = await ghFetch(`/repos/${o}/${r}/releases?per_page=${count}`);
    return releases.map(rel => ({
        tag: rel.tag_name,
        name: rel.name || rel.tag_name,
        published: rel.published_at,
        url: rel.html_url,
        prerelease: rel.prerelease
    }));
}

/**
 * Get general details for a GitHub repository.
 */
export async function getRepoDetails(owner = GITHUB_DEFAULT_OWNER, repo = GITHUB_DEFAULT_REPO) {
    const o = owner || GITHUB_DEFAULT_OWNER;
    const r = repo || GITHUB_DEFAULT_REPO;
    const data = await ghFetch(`/repos/${o}/${r}`);
    return {
        fullName: data.full_name,
        description: data.description,
        stars: data.stargazers_count,
        forks: data.forks_count,
        openIssues: data.open_issues_count,
        defaultBranch: data.default_branch,
        license: data.license?.spdx_id || data.license?.name || 'None',
        url: data.html_url,
        updatedAt: data.updated_at
    };
}

/**
 * Read text file content or list directory contents in a repository.
 */
export async function getFileContent(path, owner = GITHUB_DEFAULT_OWNER, repo = GITHUB_DEFAULT_REPO, ref = '') {
    if (!path) throw new Error('File path is required.');
    const o = owner || GITHUB_DEFAULT_OWNER;
    const r = repo || GITHUB_DEFAULT_REPO;
    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const data = await ghFetch(`/repos/${o}/${r}/contents/${encodeURIComponent(path)}${refParam}`);

    if (Array.isArray(data)) {
        return {
            type: 'directory',
            repository: `${o}/${r}`,
            path,
            items: data.map(item => ({ name: item.name, type: item.type, path: item.path, size: item.size }))
        };
    }

    let text = '';
    if (data.content && data.encoding === 'base64') {
        try {
            const binary = atob(data.content.replace(/\s/g, ''));
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            text = new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
            text = atob(data.content.replace(/\s/g, ''));
        }
    }

    return {
        type: 'file',
        repository: `${o}/${r}`,
        path: data.path,
        size: data.size,
        url: data.html_url,
        content: text.slice(0, 4000)
    };
}

/**
 * Get full details and recent comments for a specific issue or pull request.
 */
export async function getIssueOrPRDetails(issueNumber, owner = GITHUB_DEFAULT_OWNER, repo = GITHUB_DEFAULT_REPO) {
    if (!issueNumber) throw new Error('Issue or PR number is required.');
    const o = owner || GITHUB_DEFAULT_OWNER;
    const r = repo || GITHUB_DEFAULT_REPO;
    const data = await ghFetch(`/repos/${o}/${r}/issues/${issueNumber}`);

    let comments = [];
    if (data.comments > 0) {
        try {
            const commentData = await ghFetch(`/repos/${o}/${r}/issues/${issueNumber}/comments?per_page=5`);
            comments = commentData.map(c => ({ user: c.user?.login, body: (c.body || '').slice(0, 500), createdAt: c.created_at }));
        } catch (e) {
            // non-critical failure
        }
    }

    return {
        repository: `${o}/${r}`,
        number: data.number,
        title: data.title,
        state: data.state,
        isPullRequest: Boolean(data.pull_request),
        user: data.user?.login,
        labels: (data.labels || []).map(l => l.name),
        createdAt: data.created_at,
        url: data.html_url,
        body: (data.body || '').slice(0, 2500),
        commentsCount: data.comments,
        recentComments: comments
    };
}

/**
 * List pull requests in a repository.
 */
export async function listPullRequests(state = 'open', owner = GITHUB_DEFAULT_OWNER, repo = GITHUB_DEFAULT_REPO) {
    const o = owner || GITHUB_DEFAULT_OWNER;
    const r = repo || GITHUB_DEFAULT_REPO;
    const st = state || 'open';
    const data = await ghFetch(`/repos/${o}/${r}/pulls?state=${st}&per_page=10`);
    return data.map(pr => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        user: pr.user?.login,
        draft: pr.draft,
        url: pr.html_url,
        createdAt: pr.created_at,
        head: pr.head?.ref,
        base: pr.base?.ref
    }));
}

/**
 * List recent commits in a repository or for a specific path.
 */
export async function listCommits(path = '', owner = GITHUB_DEFAULT_OWNER, repo = GITHUB_DEFAULT_REPO, perPage = 5) {
    const o = owner || GITHUB_DEFAULT_OWNER;
    const r = repo || GITHUB_DEFAULT_REPO;
    const count = Math.min(Math.max(1, perPage || 5), 20);
    const pathParam = path ? `&path=${encodeURIComponent(path)}` : '';
    const data = await ghFetch(`/repos/${o}/${r}/commits?per_page=${count}${pathParam}`);
    return data.map(c => ({
        sha: c.sha?.slice(0, 7),
        author: c.commit?.author?.name || c.author?.login,
        message: c.commit?.message?.split('\n')[0],
        date: c.commit?.author?.date,
        url: c.html_url
    }));
}

/**
 * Query current GitHub API rate limit status.
 */
export async function getRateLimitStatus() {
    if (!isGithubEnabled) {
        return {
            enabled: false,
            message: 'GitHub API access is disabled in Preferences.'
        };
    }
    try {
        const data = await ghFetch('/rate_limit');
        const core = data.resources?.core || data.rate || {};
        const limit = core.limit ?? 60;
        const remaining = core.remaining ?? 60;
        const reset = core.reset;
        const resetDate = reset ? new Date(reset * 1000) : null;

        cachedRateLimit = { limit, remaining, reset };

        return {
            enabled: true,
            limit,
            remaining,
            reset: resetDate ? resetDate.toISOString() : null,
            resetTimeString: resetDate ? resetDate.toLocaleTimeString() : 'N/A'
        };
    } catch (err) {
        return {
            enabled: true,
            error: err.message,
            limit: cachedRateLimit.limit,
            remaining: cachedRateLimit.remaining,
            resetTimeString: cachedRateLimit.reset ? new Date(cachedRateLimit.reset * 1000).toLocaleTimeString() : 'N/A'
        };
    }
}