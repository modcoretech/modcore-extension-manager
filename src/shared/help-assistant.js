/**
 * help-assistant.js
 * Chrome Extension Module for inline link preview sidebar
 */

(function () {
  'use strict';

  // --- Configuration & Constants ---
  const SIDEBAR_ID = 'help-assistant-sidebar';
  const CONTAINER_ID = 'help-assistant-content-container';
  const DEFAULT_WIDTH = '400px';

  let sidebarElement = null;
  let contentElement = null;
  let externalLinkBtn = null;

  /**
   * Initializes the Help Assistant module
   */
  function init() {
    setupPageLayout();
    createSidebarUI();
    attachLinkListeners();
    attachKeyboardListeners();
  }

  /**
   * Adjusts host page layout for sidebar pushing
   */
  function setupPageLayout() {
    if (document.getElementById(CONTAINER_ID)) return;

    document.body.style.transition = `margin-right var(--transition-normal, 280ms cubic-bezier(0.2, 0.8, 0.2, 1))`;
    document.documentElement.style.height = '100%';
  }

  /**
   * Creates Sidebar DOM Structure
   */
  function createSidebarUI() {
    if (document.getElementById(SIDEBAR_ID)) return;

    sidebarElement = document.createElement('aside');
    sidebarElement.id = SIDEBAR_ID;

    Object.assign(sidebarElement.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: `var(--sidebar-width, ${DEFAULT_WIDTH})`,
      height: '100vh',
      backgroundColor: 'var(--color-bg, #ffffff)',
      borderLeft: 'var(--border-width, 1px) solid var(--color-border, #e6eaf0)',
      boxSizing: 'border-box',
      zIndex: '2147483647',
      transform: 'translateX(100%)',
      transition: 'transform var(--transition-normal, 280ms cubic-bezier(0.2, 0.8, 0.2, 1))',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-sans, sans-serif)',
      color: 'var(--color-text-primary, #121317)'
    });

    sidebarElement.innerHTML = `
      <header style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-4, 16px);
        border-bottom: var(--border-width, 1px) solid var(--color-border, #e6eaf0);
        background-color: var(--color-surface, #ffffff);
        flex-shrink: 0;
      ">
        <span style="
          font-size: var(--text-title-md, 15px);
          font-weight: var(--weight-semibold, 600);
          color: var(--color-text-primary, #121317);
        ">Help Assistant</span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <a id="help-assistant-external-btn" href="#" target="_blank" rel="noopener noreferrer" style="
            display: none;
            background: transparent;
            border: none;
            cursor: pointer;
            padding: var(--space-1, 4px);
            align-items: center;
            justify-content: center;
            border-radius: var(--radius-sm, 10px);
            color: var(--color-text-secondary, #45474d);
            text-decoration: none;
          " aria-label="Open original page in new tab" title="Open page in new tab">
            <span class="icon icon-link icon-20"></span>
          </a>
          <button id="help-assistant-close-btn" style="
            background: transparent;
            border: none;
            cursor: pointer;
            padding: var(--space-1, 4px);
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: var(--radius-sm, 10px);
            color: var(--color-text-secondary, #45474d);
          " aria-label="Close Assistant">
            <span class="icon icon-close icon-20"></span>
          </button>
        </div>
      </header>
      <main id="help-assistant-body" style="
        flex: 1;
        overflow-y: auto;
        padding: var(--space-4, 16px);
        position: relative;
        box-sizing: border-box;
      "></main>
    `;

    document.body.appendChild(sidebarElement);
    contentElement = document.getElementById('help-assistant-body');
    externalLinkBtn = document.getElementById('help-assistant-external-btn');

    document.getElementById('help-assistant-close-btn').addEventListener('click', closeSidebar);
  }

  /**
   * Event Listeners for links and in-text TOC navigation
   */
  function attachLinkListeners() {
    document.addEventListener('click', function (event) {
      // 1. In-text TOC fragment links scroll internally inside sidebar
      const tocLink = event.target.closest('.ha-intext-toc, a[href*="#"]');
      if (tocLink && sidebarElement.contains(tocLink)) {
        const href = tocLink.getAttribute('href') || '';
        if (href.includes('#')) {
          event.preventDefault();
          event.stopPropagation();
          const targetId = href.split('#')[1];
          if (targetId) {
            const targetEl = contentElement.querySelector(`[id="${CSS.escape(targetId)}"]`);
            if (targetEl) {
              targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }
          return;
        }
      }

      // 2. Navigation Link Interceptor
      const link = event.target.closest('a');
      if (!link || !link.href) return;

      // Bypass interceptor if the link is inside sidebar UI with target="_blank"
      if (sidebarElement.contains(link) && (link.id === 'help-assistant-external-btn' || link.getAttribute('target') === '_blank')) {
        return;
      }

      const href = link.getAttribute('href') || '';
      if (href.startsWith('javascript:') || href.startsWith('mailto:')) return;

      event.preventDefault();
      openSidebar();
      loadUrlContent(link.href);
    }, true);
  }

  /**
   * Keyboard shortcut (ESC to close)
   */
  function attachKeyboardListeners() {
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && sidebarElement && sidebarElement.style.transform === 'translateX(0px)') {
        closeSidebar();
      }
    });
  }

  function openSidebar() {
    document.body.style.marginRight = `var(--sidebar-width, ${DEFAULT_WIDTH})`;
    sidebarElement.style.transform = 'translateX(0)';
  }

  function closeSidebar() {
    document.body.style.marginRight = '0px';
    sidebarElement.style.transform = 'translateX(100%)';
  }

  /**
   * Fetches URL and initiates rendering pipeline
   */
  async function loadUrlContent(url) {
    if (externalLinkBtn) {
      externalLinkBtn.href = url;
      externalLinkBtn.style.display = 'inline-flex';
    }

    if (!navigator.onLine) {
      renderError('Offline', 'Internet connection required to load content. Please check your network connection.', url);
      return;
    }

    renderLoading();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText || 'Failed to fetch'}`);
      }

      const htmlText = await response.text();
      renderEnhancedContent(htmlText, url);

    } catch (error) {
      let msg = error.message || 'An unexpected error occurred.';
      if (error.name === 'AbortError') {
        msg = 'Request timed out while loading page content.';
      }
      renderError('Failed to load content', msg, url);
    }
  }

  function renderLoading() {
    contentElement.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: var(--space-3, 12px);
        color: var(--color-text-muted, #6a6e7a);
      ">
        <span class="icon icon-loading icon-primary icon-32"></span>
        <span style="font-size: var(--text-body-md, 13px);">Loading documentation...</span>
      </div>
    `;
  }

  function renderError(title, message, urlToRetry = null) {
    contentElement.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        text-align: center;
        padding: var(--space-4, 16px);
        box-sizing: border-box;
      ">
        <span class="icon icon-error icon-danger icon-32" style="margin-bottom: var(--space-3, 12px);"></span>
        <h4 style="
          margin: 0 0 var(--space-2, 8px) 0;
          font-size: var(--text-headline-sm, 18px);
          color: var(--color-danger, #d93025);
        ">${escapeHTML(title)}</h4>
        <p style="
          margin: 0 0 var(--space-4, 16px) 0;
          font-size: var(--text-body-sm, 12px);
          color: var(--color-text-secondary, #45474d);
          line-height: var(--leading-normal, 1.5);
        ">${escapeHTML(message)}</p>
        ${urlToRetry ? `
          <button id="ha-retry-btn" style="
            background-color: var(--color-primary, #0b57d0);
            color: #ffffff;
            border: none;
            padding: 8px 16px;
            border-radius: var(--radius-sm, 8px);
            font-size: var(--text-body-sm, 12px);
            font-weight: var(--weight-semibold, 600);
            cursor: pointer;
          ">Retry Loading</button>
        ` : ''}
      </div>
    `;

    if (urlToRetry) {
      document.getElementById('ha-retry-btn')?.addEventListener('click', () => loadUrlContent(urlToRetry));
    }
  }

  /**
   * Main Parsing and Clean Extraction Routine
   */
  function renderEnhancedContent(htmlText, baseUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    const renderContainer = document.createElement('div');
    renderContainer.className = 'ha-documentation-root';

    // 1. Purge structural junk & cookie popups across languages
    purgeUnwantedElements(doc);

    // 2. Extract Title
    const titleEl = doc.querySelector('h1') || doc.querySelector('title');
    let pageTitle = 'Documentation';
    if (titleEl && titleEl.textContent.trim()) {
      pageTitle = titleEl.textContent.replace(/\s*-\s*Google Sites$/i, '').trim();
    }

    const titleHeader = document.createElement('div');
    titleHeader.style.cssText = 'border-bottom: 1px solid var(--color-border, #e6eaf0); padding-bottom: 12px; margin-bottom: 16px;';
    titleHeader.innerHTML = `
      <h2 style="font-size: var(--text-headline-sm, 18px); margin: 0; color: var(--color-text-primary, #121317); font-weight: 600;">${escapeHTML(pageTitle)}</h2>
    `;
    renderContainer.appendChild(titleHeader);

    // 3. Extract Best Content Container
    let bodyContainer = getBestContentContainer(doc);
    let bodyHTML = bodyContainer ? bodyContainer.innerHTML : extractScriptFallbackContent(doc);

    const tempBody = document.createElement('div');
    tempBody.innerHTML = bodyHTML;

    // Direct removal of any element containing the word "cookies" / cookie links
    purgeCookieAndConsentText(tempBody);

    // Security & Normalization
    sanitizeDOMNode(tempBody);
    removeDuplicateTitles(tempBody, pageTitle);
    processHeadingIDs(tempBody);
    processMarkdownFormatting(tempBody);
    processResourcesAndLinks(tempBody, baseUrl);

    renderContainer.appendChild(tempBody);

    contentElement.innerHTML = '';
    contentElement.appendChild(renderContainer);
  }

  /**
   * Comprehensive DOM selector purging
   */
  function purgeUnwantedElements(doc) {
    const junkSelectors = [
      // Navigation Chrome
      'header', 'footer', 'nav', '[role="navigation"]', '[role="banner"]',
      '.site-header', '.site-footer', '#sites-chrome-header', '#sites-chrome-sidebar',
      '#sites-chrome-footer', 'script', 'style', 'noscript', 'iframe', 'form',

      // Native TOCs
      '.sites-embed-type-toc', '[role="directory"]', '.sites-tile-name-toc',

      // Multi-language Cookie, Consent & Banner IDs/Classes
      '[id*="cookie" i]', '[class*="cookie" i]', '[aria-label*="cookie" i]',
      '[id*="consent" i]', '[class*="consent" i]', '[aria-label*="consent" i]',
      '[id*="consentement" i]', '[class*="consentement" i]',
      '[id*="privacy" i]', '[class*="privacy" i]', '[aria-label*="privacy" i]',
      '[id*="banner" i]', '[class*="banner" i]', '[class*="notice" i]',
      'a[href*="policies.google.com/technologies/cookies"]',
      'a[href*="cookies"]',
      '.glue-cookie-notification-bar', '#uc-main-panel', '#onetrust-consent-sdk',
      '.cc-window', '.notice-bar', '.gdpr-banner', '.privacy-notice', '.cookie-notice',
      '.cookie-banner', '#cookie-banner', '#cookie-notice', '#cookie-law-info-bar',

      // Embedded Edit & Action Buttons
      'button', '[role="button"]', '.sites-action-button', '[data-action]',
      '[aria-label*="Edit" i]', '[aria-label*="Report" i]', '[aria-label*="Feedback" i]',
      'a[href*="edit"]', 'a[href*="reportedabuse"]', 'a[href*="ServiceLogin"]'
    ];

    junkSelectors.forEach(sel => {
      doc.querySelectorAll(sel).forEach(el => el.remove());
    });
  }

  /**
   * Detects the word "Cookies" or cookie link occurrences and strips the entire block or section
   */
  function purgeCookieAndConsentText(tempBody) {
    // Matches the standalone word "cookies" or "cookie" in any language context
    const cookieRegex = /\bcookies?\b/i;

    // 1. First remove any links specifically referencing cookies policy
    tempBody.querySelectorAll('a').forEach(a => {
      if (cookieRegex.test(a.textContent) || (a.href && a.href.includes('cookies'))) {
        const parentBlock = a.closest('p, div, section, li');
        if (parentBlock) {
          parentBlock.remove();
        } else {
          a.remove();
        }
      }
    });

    // 2. Scan paragraphs, headings, and containers for residual cookie notices
    const targets = tempBody.querySelectorAll('p, div, section, h1, h2, h3, h4, h5, h6, span');
    targets.forEach(el => {
      if (cookieRegex.test(el.textContent)) {
        // Remove container block if it's primarily a notice string (< 400 chars)
        if (el.textContent.trim().length < 400) {
          const outerContainer = el.closest('div, section, p') || el;
          outerContainer.remove();
        }
      }
    });
  }

  /**
   * Security Sanitizer
   */
  function sanitizeDOMNode(node) {
    const dangerousTags = ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'BASE'];
    node.querySelectorAll(dangerousTags.join(',')).forEach(el => el.remove());

    node.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith('on') || attr.name.startsWith('data-js')) {
          el.removeAttribute(attr.name);
        }
      });

      ['href', 'src', 'action'].forEach(attrName => {
        if (el.hasAttribute(attrName)) {
          const val = el.getAttribute(attrName).trim().toLowerCase();
          if (val.startsWith('javascript:') || val.startsWith('data:text/html')) {
            el.removeAttribute(attrName);
          }
        }
      });
    });
  }

  /**
   * Extracts best inner container containing main text content
   */
  function getBestContentContainer(doc) {
    const candidates = [
      doc.querySelector('#sites-canvas-main'),
      doc.querySelector('.site-content'),
      doc.querySelector('[role="main"]'),
      doc.querySelector('main'),
      doc.querySelector('article'),
      doc.querySelector('.W4B3vd'),
      doc.querySelector('.zFr3Q'),
      doc.body
    ].filter(Boolean);

    for (const el of candidates) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('h1, h2, h3, title').forEach(h => h.remove());
      if (clone.textContent.trim().length > 50) {
        return el;
      }
    }

    const fallbackDiv = doc.createElement('div');
    const blocks = doc.querySelectorAll('p, ul, ol, table, pre, blockquote, div[data-string-id]');
    if (blocks.length > 0) {
      blocks.forEach(b => fallbackDiv.appendChild(b.cloneNode(true)));
      if (fallbackDiv.textContent.trim().length > 30) {
        return fallbackDiv;
      }
    }

    return null;
  }

  /**
   * Strips repeated title elements inside main body
   */
  function removeDuplicateTitles(tempBody, pageTitle) {
    const headings = tempBody.querySelectorAll('h1, h2');
    headings.forEach((h, idx) => {
      const hText = h.textContent.replace(/\s*#.*$/, '').trim();
      if (idx === 0 || hText.toLowerCase() === pageTitle.toLowerCase() || h.tagName.toLowerCase() === 'h1') {
        h.remove();
      }
    });
  }

  /**
   * Normalizes heading IDs for in-text TOC links
   */
  function processHeadingIDs(tempBody) {
    const headings = tempBody.querySelectorAll('h2, h3, h4, h5, h6');
    headings.forEach((heading, idx) => {
      const headingText = heading.textContent.trim();
      heading.id = heading.id || headingText.toLowerCase().replace(/[^\w]+/g, '-') || `ha-heading-${idx}`;
      heading.style.cssText = 'margin-top: 16px; margin-bottom: 8px; color: var(--color-text-primary, #121317); font-weight: 600;';
    });
  }

  /**
   * Formats tables, blockquotes, and pre/code blocks
   */
  function processMarkdownFormatting(tempBody) {
    tempBody.querySelectorAll('pre, code').forEach(el => {
      if (el.tagName.toLowerCase() === 'pre') {
        el.style.cssText = `
          background-color: var(--color-surface-hover, #f8f9fc);
          border: 1px solid var(--color-border, #e6eaf0);
          border-radius: var(--radius-sm, 10px);
          padding: var(--space-3, 12px);
          overflow-x: auto;
          font-family: var(--font-mono, monospace);
          font-size: var(--text-body-sm, 12px);
          margin: 12px 0;
        `;
      } else if (el.tagName.toLowerCase() === 'code' && el.parentElement.tagName.toLowerCase() !== 'pre') {
        el.style.cssText = `
          background-color: var(--color-surface-hover, #f8f9fc);
          padding: 2px 6px;
          border-radius: 4px;
          font-family: var(--font-mono, monospace);
          font-size: 0.9em;
          border: 1px solid var(--color-border, #e6eaf0);
        `;
      }
    });

    tempBody.querySelectorAll('blockquote').forEach(quote => {
      quote.style.cssText = `
        border-left: 3px solid var(--color-primary, #0b57d0);
        margin: 12px 0;
        padding-left: 12px;
        color: var(--color-text-secondary, #45474d);
        font-style: italic;
      `;
    });

    tempBody.querySelectorAll('table').forEach(table => {
      table.style.cssText = `
        width: 100%;
        border-collapse: collapse;
        margin: 12px 0;
        font-size: var(--text-body-sm, 12px);
      `;
      table.querySelectorAll('th, td').forEach(cell => {
        cell.style.cssText = `
          border: 1px solid var(--color-border, #e6eaf0);
          padding: 6px 10px;
          text-align: left;
        `;
      });
      table.querySelectorAll('th').forEach(th => {
        th.style.backgroundColor = 'var(--color-surface-hover, #f8f9fc)';
        th.style.fontWeight = 'var(--weight-semibold, 600)';
      });
    });
  }

  /**
   * Resolves relative image src paths and flags in-text TOC links
   */
  function processResourcesAndLinks(tempBody, baseUrl) {
    tempBody.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      if (src && !src.startsWith('data:')) {
        try {
          img.src = new URL(src, baseUrl).href;
        } catch (e) {}
      }
      img.style.cssText = 'max-width: 100%; height: auto; border-radius: var(--radius-sm, 10px); margin: 8px 0; display: block;';
    });

    tempBody.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href');
      if (!href) return;

      if (href.startsWith('#') || href.includes(`${baseUrl}#`)) {
        a.classList.add('ha-intext-toc');
        const fragment = href.includes('#') ? href.split('#')[1] : href;
        a.setAttribute('href', '#' + fragment);
        a.style.cssText = 'color: var(--color-primary, #0b57d0); text-decoration: underline; cursor: pointer;';
      } else if (!href.startsWith('javascript:')) {
        try {
          a.href = new URL(href, baseUrl).href;
        } catch (e) {}
      }
    });
  }

  /**
   * Fallback script extractor with strict cookie/consent string filtering
   */
  function extractScriptFallbackContent(doc) {
    const scripts = doc.querySelectorAll('script');
    let chunks = [];

    scripts.forEach(script => {
      const content = script.textContent || '';
      if (content.includes('AF_initDataCallback') || content.includes('IJ_values')) {
        const stringMatches = content.match(/"([^"\\]|\\.)*"/g) || [];
        stringMatches.forEach(str => {
          let unquoted = str.slice(1, -1).replace(/\\n/g, '<br>').replace(/\\"/g, '"');
          
          const isJunk = /cookie|consent|privacy|banner|terms|gdpr|manage preferences|accept|reject|http|var |window\./i.test(unquoted);
          if (unquoted.length > 30 && !isJunk) {
            chunks.push(`<p style="line-height: var(--leading-normal, 1.5); margin-bottom: 8px;">${unquoted}</p>`);
          }
        });
      }
    });

    return chunks.join('') || '<p>No readable content found on this page.</p>';
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();