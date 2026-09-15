/* ==========================================================================
   ai_web.js — GitHub API access (unrestricted owners, token support, full data)
   ========================================================================== */

const DEFAULT_OWNER = 'modcoretech';
const DEFAULT_REPO = 'modcore-extension-manager';
const API = 'https://api.github.com';
const DEFAULT_MAX_TEXT = 40_000;

let githubEnabled = true;
let githubToken = '';
let cachedRateLimit = { limit: 60, remaining: 60, reset: null, authenticated: false };

export function setGithubEnabled(v) { githubEnabled = Boolean(v); }
export function getGithubEnabled() { return githubEnabled; }
export function setGithubToken(t) { githubToken = String(t || '').trim(); }
export function getGithubToken() { return githubToken; }
export function getCachedRateLimit() { return { ...cachedRateLimit }; }

const clamp = (n, min, max, def) => Math.min(Math.max(Number(n) || def, min), max);

function requestHeaders() {
    const h = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
    if (githubToken) h.Authorization = `Bearer ${githubToken}`;
    return h;
}

function trackRate(res) {
    const limit = res.headers.get('x-ratelimit-limit');
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (limit !== null) cachedRateLimit.limit = Number(limit);
    if (remaining !== null) cachedRateLimit.remaining = Number(remaining);
    if (reset !== null) cachedRateLimit.reset = Number(reset);
    cachedRateLimit.authenticated = Boolean(githubToken);
}

async function gh(path) {
    if (!githubEnabled) throw new Error('GitHub API access is disabled in Preferences.');
    if (!navigator.onLine) throw new Error('You appear to be offline. Check your connection and try again.');

    let res;
    try {
        res = await fetch(`${API}${path}`, { headers: requestHeaders() });
    } catch (err) {
        throw new Error(`Couldn't reach GitHub: ${err.message}`);
    }
    trackRate(res);

    if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        if (remaining === '0' || cachedRateLimit.remaining === 0) {
            const reset = cachedRateLimit.reset ? new Date(cachedRateLimit.reset * 1000) : null;
            const when = reset ? reset.toLocaleTimeString() : 'later';
            const hint = githubToken ? '' : ' Add a GitHub token in Preferences to raise the limit to 5,000/hour.';
            throw new Error(`GitHub rate limit reached (${cachedRateLimit.remaining}/${cachedRateLimit.limit}). Resets at ${when}.${hint}`);
        }
        const body = await res.json().catch(() => ({}));
        throw new Error(`GitHub access forbidden (HTTP ${res.status}): ${body.message || 'access denied'}`);
    }
    if (res.status === 404) throw new Error(`Not found on GitHub: ${path}`);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`GitHub API error ${res.status}: ${body.message || res.statusText}`);
    }
    return res.json();
}

function qs(params) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') p.set(k, v);
    }
    const s = p.toString();
    return s ? `?${s}` : '';
}

function decodeBase64(content) {
    const binary = atob(content.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
}

const repoPath = (owner, repo) => `/repos/${owner || DEFAULT_OWNER}/${repo || DEFAULT_REPO}`;

/* --------------------------------------------------------------------------
   Releases
   -------------------------------------------------------------------------- */
export async function getLatestRelease(owner, repo) {
    const data = await gh(`${repoPath(owner, repo)}/releases/latest`);
    return {
        repository: `${owner || DEFAULT_OWNER}/${repo || DEFAULT_REPO}`,
        tag: data.tag_name,
        name: data.name || data.tag_name,
        published: data.published_at,
        url: data.html_url,
        prerelease: data.prerelease,
        changelog: data.body || 'No changelog provided.'
    };
}

export async function listReleases(owner, repo, perPage = 10, includeChangelog = true) {
    const count = clamp(perPage, 1, 100, 10);
    const releases = await gh(`${repoPath(owner, repo)}/releases${qs({ per_page: count })}`);
    return releases.map(r => ({
        tag: r.tag_name,
        name: r.name || r.tag_name,
        published: r.published_at,
        url: r.html_url,
        prerelease: r.prerelease,
        draft: r.draft,
        changelog: includeChangelog ? (r.body || 'No changelog provided.') : undefined
    }));
}

export async function getReleaseByTag(owner, repo, tag) {
    if (!tag) throw new Error('A release tag is required.');
    const data = await gh(`${repoPath(owner, repo)}/releases/tags/${encodeURIComponent(tag)}`);
    return {
        tag: data.tag_name,
        name: data.name || data.tag_name,
        published: data.published_at,
        url: data.html_url,
        prerelease: data.prerelease,
        changelog: data.body || 'No changelog provided.'
    };
}

/* --------------------------------------------------------------------------
   Repository metadata
   -------------------------------------------------------------------------- */
export async function getRepoDetails(owner, repo) {
    const d = await gh(repoPath(owner, repo));
    return {
        fullName: d.full_name,
        description: d.description,
        stars: d.stargazers_count,
        forks: d.forks_count,
        watchers: d.subscribers_count,
        openIssues: d.open_issues_count,
        defaultBranch: d.default_branch,
        license: d.license?.spdx_id || d.license?.name || 'None',
        language: d.language,
        topics: d.topics || [],
        url: d.html_url,
        createdAt: d.created_at,
        updatedAt: d.updated_at
    };
}

export async function listContributors(owner, repo, perPage = 20) {
    const count = clamp(perPage, 1, 100, 20);
    const data = await gh(`${repoPath(owner, repo)}/contributors${qs({ per_page: count })}`);
    return data.map(c => ({
        login: c.login,
        contributions: c.contributions,
        type: c.type,
        url: c.html_url
    }));
}

export async function listBranches(owner, repo, perPage = 30) {
    const count = clamp(perPage, 1, 100, 30);
    const data = await gh(`${repoPath(owner, repo)}/branches${qs({ per_page: count })}`);
    return data.map(b => ({ name: b.name, protected: b.protected, sha: b.commit?.sha?.slice(0, 7) }));
}

export async function listTags(owner, repo, perPage = 30) {
    const count = clamp(perPage, 1, 100, 30);
    const data = await gh(`${repoPath(owner, repo)}/tags${qs({ per_page: count })}`);
    return data.map(t => ({ name: t.name, sha: t.commit?.sha?.slice(0, 7) }));
}

/* --------------------------------------------------------------------------
   Files & code
   -------------------------------------------------------------------------- */
export async function getReadme(owner, repo, path = '') {
    const endpoint = path
        ? `${repoPath(owner, repo)}/contents/${encodeURIComponent(path)}`
        : `${repoPath(owner, repo)}/readme`;
    const data = await gh(endpoint);

    let text = '';
    if (data.content && data.encoding === 'base64') text = decodeBase64(data.content);
    else if (data.download_url) text = await (await fetch(data.download_url)).text();

    const truncated = text.length > DEFAULT_MAX_TEXT;
    return {
        repository: `${owner || DEFAULT_OWNER}/${repo || DEFAULT_REPO}`,
        path: data.path || path || 'README.md',
        url: data.html_url,
        truncated,
        content: truncated ? text.slice(0, DEFAULT_MAX_TEXT) : text
    };
}

export async function getFileContent(path, owner, repo, ref = '') {
    if (!path) throw new Error('A file path is required.');
    const data = await gh(`${repoPath(owner, repo)}/contents/${encodeURIComponent(path)}${qs({ ref })}`);

    if (Array.isArray(data)) {
        return {
            type: 'directory',
            repository: `${owner || DEFAULT_OWNER}/${repo || DEFAULT_REPO}`,
            path,
            items: data.map(i => ({ name: i.name, type: i.type, path: i.path, size: i.size }))
        };
    }

    let text = '';
    if (data.content && data.encoding === 'base64') {
        text = decodeBase64(data.content);
    } else if (data.git_url && data.size > 1_000_000) {
        // Contents API omits base64 for files > 1 MB — fall back to the blob API.
        const blob = await gh(`/repos/${owner || DEFAULT_OWNER}/${repo || DEFAULT_REPO}/git/blobs/${data.sha}`);
        if (blob.content) text = blob.encoding === 'base64' ? decodeBase64(blob.content) : atob(blob.content);
    }

    const truncated = text.length > DEFAULT_MAX_TEXT;
    return {
        type: 'file',
        repository: `${owner || DEFAULT_OWNER}/${repo || DEFAULT_REPO}`,
        path: data.path,
        size: data.size,
        url: data.html_url,
        truncated,
        content: truncated ? text.slice(0, DEFAULT_MAX_TEXT) : text
    };
}

export async function searchCode(query, owner, repo) {
    if (!query) throw new Error('A code search query is required.');
    if (!githubToken) throw new Error('GitHub code search requires an authenticated token. Add one in Preferences.');
    const scope = repo ? `repo:${owner || DEFAULT_OWNER}/${repo}` : `org:${owner || DEFAULT_OWNER}`;
    const data = await gh(`/search/code${qs({ q: `${scope} ${query}`, per_page: 20 })}`);
    return {
        totalCount: data.total_count,
        items: (data.items || []).map(i => ({
            name: i.name,
            path: i.path,
            repository: i.repository?.full_name,
            url: i.html_url
        }))
    };
}

/* --------------------------------------------------------------------------
   Issues & pull requests
   -------------------------------------------------------------------------- */
export async function searchIssues(query, state = 'open', owner, repo) {
    if (!query) throw new Error('A search query is required.');
    const stateFilter = state && state !== 'all' ? ` state:${state}` : '';
    const scope = repo ? `repo:${owner || DEFAULT_OWNER}/${repo}` : `org:${owner || DEFAULT_OWNER}`;
    const data = await gh(`/search/issues${qs({ q: `${scope} ${query}${stateFilter}`, per_page: 30 })}`);
    return {
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

export async function getIssueOrPRDetails(issueNumber, owner, repo) {
    if (!issueNumber) throw new Error('An issue or PR number is required.');
    const base = `${repoPath(owner, repo)}/issues/${issueNumber}`;
    const data = await gh(base);

    let comments = [];
    if (data.comments > 0) {
        const list = await gh(`${base}/comments${qs({ per_page: 100 })}`).catch(() => []);
        comments = list.map(c => ({ user: c.user?.login, body: c.body || '', createdAt: c.created_at }));
    }

    return {
        repository: `${owner || DEFAULT_OWNER}/${repo || DEFAULT_REPO}`,
        number: data.number,
        title: data.title,
        state: data.state,
        isPullRequest: Boolean(data.pull_request),
        user: data.user?.login,
        labels: (data.labels || []).map(l => l.name),
        assignees: (data.assignees || []).map(a => a.login),
        milestone: data.milestone?.title || null,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        url: data.html_url,
        body: data.body || '',
        commentsCount: data.comments,
        comments
    };
}

export async function listIssueComments(issueNumber, owner, repo, perPage = 30) {
    if (!issueNumber) throw new Error('An issue number is required.');
    const count = clamp(perPage, 1, 100, 30);
    const data = await gh(`${repoPath(owner, repo)}/issues/${issueNumber}/comments${qs({ per_page: count })}`);
    return data.map(c => ({
        user: c.user?.login,
        body: c.body || '',
        createdAt: c.created_at,
        url: c.html_url
    }));
}

export async function listPullRequests(state = 'open', owner, repo) {
    const data = await gh(`${repoPath(owner, repo)}/pulls${qs({ state: state || 'open', per_page: 30 })}`);
    return data.map(pr => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        user: pr.user?.login,
        draft: pr.draft,
        url: pr.html_url,
        createdAt: pr.created_at,
        mergedAt: pr.merged_at,
        head: pr.head?.ref,
        base: pr.base?.ref
    }));
}

/* --------------------------------------------------------------------------
   Commits
   -------------------------------------------------------------------------- */
export async function listCommits(path = '', owner, repo, perPage = 10) {
    const count = clamp(perPage, 1, 100, 10);
    const pathParam = path ? `&path=${encodeURIComponent(path)}` : '';
    const data = await gh(`${repoPath(owner, repo)}/commits${qs({ per_page: count })}${pathParam}`);
    return data.map(c => ({
        sha: c.sha?.slice(0, 7),
        author: c.commit?.author?.name || c.author?.login,
        message: c.commit?.message?.split('\n')[0],
        date: c.commit?.author?.date,
        url: c.html_url
    }));
}

export async function getCommitDetails(sha, owner, repo) {
    if (!sha) throw new Error('A commit SHA is required.');
    const d = await gh(`${repoPath(owner, repo)}/commits/${encodeURIComponent(sha)}`);
    return {
        sha: d.sha,
        author: d.commit?.author?.name,
        email: d.commit?.author?.email,
        date: d.commit?.author?.date,
        message: d.commit?.message,
        url: d.html_url,
        stats: d.stats,
        files: (d.files || []).map(f => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ? f.patch.slice(0, 2000) : undefined
        }))
    };
}

export async function compareCommits(base, head, owner, repo) {
    if (!base || !head) throw new Error('Both base and head refs are required.');
    const d = await gh(`${repoPath(owner, repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
    return {
        status: d.status,
        aheadBy: d.ahead_by,
        behindBy: d.behind_by,
        totalCommits: d.total_commits,
        commits: (d.commits || []).map(c => ({
            sha: c.sha?.slice(0, 7),
            message: c.commit?.message?.split('\n')[0],
            author: c.commit?.author?.name
        })),
        files: (d.files || []).map(f => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions
        }))
    };
}

/* --------------------------------------------------------------------------
   Users / orgs
   -------------------------------------------------------------------------- */
export async function getGithubUser(username) {
    if (!username) throw new Error('A GitHub username is required.');
    const d = await gh(`/users/${encodeURIComponent(username)}`);
    return {
        login: d.login,
        name: d.name,
        type: d.type,
        bio: d.bio,
        company: d.company,
        blog: d.blog,
        location: d.location,
        publicRepos: d.public_repos,
        publicGists: d.public_gists,
        followers: d.followers,
        following: d.following,
        createdAt: d.created_at,
        url: d.html_url
    };
}

/* --------------------------------------------------------------------------
   Rate limit
   -------------------------------------------------------------------------- */
export async function getRateLimitStatus() {
    if (!githubEnabled) return { enabled: false, message: 'GitHub API access is disabled in Preferences.' };
    try {
        const data = await gh('/rate_limit');
        const core = data.resources?.core || data.rate || {};
        const limit = core.limit ?? (githubToken ? 5000 : 60);
        const remaining = core.remaining ?? limit;
        const reset = core.reset;
        const resetDate = reset ? new Date(reset * 1000) : null;
        cachedRateLimit = { limit, remaining, reset, authenticated: Boolean(githubToken) };
        return {
            enabled: true,
            authenticated: Boolean(githubToken),
            limit,
            remaining,
            reset: resetDate ? resetDate.toISOString() : null,
            resetTimeString: resetDate ? resetDate.toLocaleTimeString() : 'N/A'
        };
    } catch (err) {
        return {
            enabled: true,
            authenticated: Boolean(githubToken),
            error: err.message,
            limit: cachedRateLimit.limit,
            remaining: cachedRateLimit.remaining,
            resetTimeString: cachedRateLimit.reset
                ? new Date(cachedRateLimit.reset * 1000).toLocaleTimeString()
                : 'N/A'
        };
    }
}