/* ==========================================================================
   ai_markdown.js — streaming + full Markdown rendering
   -------------------------------------------------------------------------- */

import * as smd from '../../js/vendor/smd.min.js';

/* ---------- URL sanitisation (applied during rendering) ---------- */
const DANGEROUS_SCHEME = /^\s*(?:javascript|vbscript|data|file|blob):/i;

function sanitizeUrl(raw) {
    const url = String(raw == null ? '' : raw).trim();
    if (!url) return '';
    return DANGEROUS_SCHEME.test(url) ? '#' : url;
}

/* ---------- DOMPurify config (used only at end-of-round) ---------- */
export const PURIFY_CONFIG = {
    ALLOWED_TAGS: [
        'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'strong', 'em', 'b', 'i', 'u', 's', 'del', 'mark', 'sub', 'sup',
        'code', 'pre', 'kbd', 'samp', 'ul', 'ol', 'li',
        'blockquote', 'a', 'span',
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
        'details', 'summary', 'img', 'input'
    ],
    ALLOWED_ATTR: [
        'href', 'title', 'class', 'start', 'align', 'target', 'rel',
        'colspan', 'rowspan', 'open', 'src', 'alt', 'type', 'checked', 'disabled'
    ],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form',
        'textarea', 'select', 'meta', 'link', 'base', 'svg', 'math',
        'video', 'audio', 'source', 'track', 'canvas'],
    FORBID_ATTR: ['style', 'srcdoc', 'formaction', 'action', 'background',
        'poster', 'srcset', 'dynsrc', 'lowsrc']
};

/* Tags whose removal means the response is genuinely hostile. */
const HARD_BLOCK_TAGS = new Set([
    'script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'base',
    'frame', 'frameset', 'noscript', 'template', 'applet', 'head', 'title'
]);

function isSevereRemoval(entry) {
    if (entry.element) {
        const tag = (entry.element.tagName || '').toLowerCase();
        if (HARD_BLOCK_TAGS.has(tag)) return true;
    }
    if (entry.attribute) {
        const name = String(entry.attribute.name || '').toLowerCase();
        if (name.startsWith('on')) return true;
        if (name === 'srcdoc' || name === 'formaction') return true;
        const val = String(entry.attribute.value || '').trim().toLowerCase();
        if (val.startsWith('javascript:') ||
            val.startsWith('vbscript:') ||
            val.startsWith('data:text/html')) return true;
    }
    return false;
}

function hasDangerousContent(el) {
    if (typeof DOMPurify === 'undefined') return false;
    DOMPurify.sanitize(el.innerHTML, PURIFY_CONFIG);
    return DOMPurify.removed.some(isSevereRemoval);
}

/* --------------------------------------------------------------------------
   Incremental (streaming) renderer
   -------------------------------------------------------------------------- */
export class StreamingMarkdown {
    constructor(el, { onUnsafe } = {}) {
        this.el = el;
        this.onUnsafe = onUnsafe || null;
        this.unsafe = false;

        this.renderer = smd.default_renderer(el);

        // Wrap set_attr so every URL is neutralised at creation time.
        const origSetAttr = this.renderer.set_attr;
        const HREF = smd.HREF; // 1
        const SRC = smd.SRC;   // 2
        this.renderer.set_attr = function (data, attr, value) {
            if (attr === HREF || attr === SRC) value = sanitizeUrl(value);
            return origSetAttr.call(this, data, attr, value);
        };

        this.parser = smd.parser(this.renderer);
    }

    write(chunk) {
        if (this.unsafe || !chunk) return;
        try { smd.parser_write(this.parser, chunk); }
        catch { /* tolerate partial tokens mid-stream */ }
    }

    /** Called once per round, not per chunk — cheap and accurate. */
    end() {
        try { smd.parser_end(this.parser); } catch { /* noop */ }

        if (!this.unsafe && hasDangerousContent(this.el)) {
            this.unsafe = true;
            this.el.replaceChildren();
            this.onUnsafe?.();
        }
    }
}

/* --------------------------------------------------------------------------
   Full renderer (used to replace the streaming DOM at end of each round)
   -------------------------------------------------------------------------- */
export function renderMarkdown(text) {
    const frag = document.createDocumentFragment();
    if (!text) return frag;

    const lines = String(text).split('\n');
    let inCode = false, codeLang = '', codeBuf = [];
    let list = null, listType = null;

    const flushList = () => {
        if (list) { frag.appendChild(list); list = null; listType = null; }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('```')) {
            if (inCode) {
                frag.appendChild(buildCodeBlock(codeBuf.join('\n'), codeLang));
                codeBuf = []; inCode = false; codeLang = '';
            } else {
                flushList();
                inCode = true;
                codeLang = line.slice(3).trim();
            }
            continue;
        }
        if (inCode) { codeBuf.push(line); continue; }

        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
            flushList();
            const tbl = [];
            let j = i;
            while (j < lines.length && lines[j].trim().startsWith('|') && lines[j].trim().endsWith('|')) {
                tbl.push(lines[j].trim()); j++;
            }
            if (tbl.length >= 2 && /^\|(?:\s*:?-+:?\s*\|)+$/.test(tbl[1])) {
                frag.appendChild(buildTable(tbl));
                i = j - 1;
                continue;
            }
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flushList();
            const h = document.createElement(`h${heading[1].length}`);
            inline(h, heading[2]);
            frag.appendChild(h);
            continue;
        }

        if (line.startsWith('>')) {
            flushList();
            const bq = document.createElement('blockquote');
            inline(bq, line.replace(/^>\s?/, ''));
            frag.appendChild(bq);
            continue;
        }

        const ul = line.match(/^\s*[-*+]\s+(.*)$/);
        if (ul) {
            if (listType !== 'ul') {
                flushList();
                list = document.createElement('ul');
                listType = 'ul';
            }
            const li = document.createElement('li');
            inline(li, ul[1]);
            list.appendChild(li);
            continue;
        }

        const ol = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (ol) {
            if (listType !== 'ol') {
                flushList();
                list = document.createElement('ol');
                listType = 'ol';
            }
            const li = document.createElement('li');
            inline(li, ol[2]);
            list.appendChild(li);
            continue;
        }

        flushList();
        if (line.trim() === '') continue;
        const p = document.createElement('p');
        inline(p, line);
        frag.appendChild(p);
    }

    if (inCode && codeBuf.length) frag.appendChild(buildCodeBlock(codeBuf.join('\n'), codeLang));
    flushList();
    return frag;
}

/* --------------------------------------------------------------------------
   Inline formatting
   -------------------------------------------------------------------------- */
const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_|\[([^\]]+)\]\(([^)]+)\))/g;

function inline(el, text) {
    if (!text) return;
    let last = 0, m;
    INLINE_RE.lastIndex = 0;
    while ((m = INLINE_RE.exec(text))) {
        if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
        const tok = m[0];
        if (tok.startsWith('`')) {
            const c = document.createElement('code');
            c.textContent = tok.slice(1, -1);
            el.appendChild(c);
        } else if (tok.startsWith('**') || tok.startsWith('__')) {
            const s = document.createElement('strong');
            s.textContent = tok.slice(2, -2);
            el.appendChild(s);
        } else if (tok.startsWith('~~')) {
            const d = document.createElement('del');
            d.textContent = tok.slice(2, -2);
            el.appendChild(d);
        } else if (tok.startsWith('*') || tok.startsWith('_')) {
            const em = document.createElement('em');
            em.textContent = tok.slice(1, -1);
            el.appendChild(em);
        } else if (tok.startsWith('[')) {
            const a = document.createElement('a');
            a.href = sanitizeUrl(m[2]);
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = m[1];
            el.appendChild(a);
        }
        last = m.index + tok.length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

/* --------------------------------------------------------------------------
   Code blocks & tables
   -------------------------------------------------------------------------- */
function buildCodeBlock(text, lang) {
    const wrap = document.createElement('div');
    wrap.className = 'code-block';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-copy-btn';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code');
    btn.addEventListener('click', async () => {
        await copyText(text);
        const prev = btn.textContent;
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = prev;
            btn.classList.remove('copied');
        }, 1400);
    });

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    if (lang) code.className = `language-${lang.replace(/[^\w-]/g, '')}`;
    code.textContent = text;
    pre.appendChild(code);

    wrap.append(btn, pre);
    return wrap;
}

function buildTable(rows) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-container';

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

    const headTr = document.createElement('tr');
    cells(rows[0]).forEach(txt => {
        const th = document.createElement('th');
        inline(th, txt);
        headTr.appendChild(th);
    });
    thead.appendChild(headTr);

    for (let r = 2; r < rows.length; r++) {
        const tr = document.createElement('tr');
        cells(rows[r]).forEach(txt => {
            const td = document.createElement('td');
            inline(td, txt);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    }

    table.append(thead, tbody);
    wrapper.appendChild(table);
    return wrapper;
}

/* --------------------------------------------------------------------------
   Clipboard helper
   -------------------------------------------------------------------------- */
export async function copyText(text, btn) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch { /* noop */ }
        ta.remove();
    }
    if (btn) flashCopied(btn);
}

export function flashCopied(btn) {
    if (!btn) return;
    btn.classList.add('copied');
    const t = btn.getAttribute('title');
    btn.setAttribute('title', 'Copied!');
    setTimeout(() => {
        btn.classList.remove('copied');
        if (t) btn.setAttribute('title', t);
    }, 1400);
}