(function () {
  'use strict';

  /* ======================================================
     CONFIGURATION
     (Updated: Color, Timing, Permanent Dismissal Key)
  ====================================================== */

  const DEV_MODE = false; //  Set to true to always show the sidebar for testing.

  const PRIMARY_COLOR = '#2196F3'; // Modern Vibrant Blue
  const BORDER_RADIUS = '16px';
  const ANIMATION_DURATION = '0.5s';

  const DONATE_URL = 'https://www.patreon.com/modcore';

  const STORAGE = {
    firstVisit: 'modcore_donate_first_visit',
    snoozedUntil: 'modcore_donate_snoozed_until',
    // New key for indefinite closure
    permanentDismissed: 'modcore_donate_permanent_dismissed',
    showCount: 'modcore_donate_show_count',
  };

  const MS_PER_DAY = 86400000;

  // New, more intelligent timing system
  const TIMING = {
    // Delay before the *first* show (in days)
    initialDelayDays: 1, 
    // Minimum time between shows if snoozed (in days)
    snoozeDurationDays: 7,
    // How many times to show the sidebar before suggesting permanent dismiss
    maxShowCount: 5, 
  };

  // Humanized and Believable Benefits Text
  const BENEFITS = [
    { title: 'Stay Private & Ad-Free', icon: '🔒', description: 'We promise no tracking, no selling data, and no annoying ads—ever. Your support makes this possible.' },
    { title: 'Support Open-Source', icon: '💻', description: 'Help fund development costs and ensure modcore remains transparent, secure, and community-driven.' },
    { title: 'Faster, Better Tools', icon: '⚡', description: 'Your donation accelerates new feature development and better tooling for a smoother extension management experience.' },
    { title: 'Long-Term Stability', icon: '🏡', description: 'Ensure the project is sustainable for years to come, providing reliability and continued compatibility.' },
  ];

  /* ======================================================
     STORAGE HELPERS (Enhanced Robustness)
  ====================================================== */

  function setStorageItem(key, value) {
    try {
      localStorage.setItem(key, value.toString());
    } catch (e) {
      console.warn('modcore Storage Write Error:', e);
    }
  }

  function getStorageItem(key, defaultValue = null) {
    try {
      return localStorage.getItem(key) || defaultValue;
    } catch (e) {
      console.warn('modcore Storage Read Error:', e);
      return defaultValue;
    }
  }

  /* ======================================================
     LOGIC – SHOULD WE SHOW? (Smarter & Intelligent System)
  ====================================================== */

  function shouldShow() {
    if (DEV_MODE) return true;

    const now = Date.now();

    // 1. Check for permanent dismissal (New Feature)
    if (getStorageItem(STORAGE.permanentDismissed)) return false;

    // 2. Check for temporary snooze
    const snoozedUntil = Number(getStorageItem(STORAGE.snoozedUntil, 0));
    if (now < snoozedUntil) return false;

    // 3. Handle first visit and initial delay
    let firstVisit = Number(getStorageItem(STORAGE.firstVisit, 0));
    if (!firstVisit) {
      setStorageItem(STORAGE.firstVisit, now);
      // Wait for the initial delay before showing for the first time
      return false; 
    }

    const initialDelayMs = TIMING.initialDelayDays * MS_PER_DAY;
    
    // Only show if the initial delay has passed
    const isReadyToShow = now >= firstVisit + initialDelayMs;

    if (isReadyToShow) {
        // 4. Increment show count and check limit (Robustness Enhancement)
        let showCount = Number(getStorageItem(STORAGE.showCount, 0));
        setStorageItem(STORAGE.showCount, showCount + 1);
        
        // After max shows, the permanent close option is more prominent, 
        // but we still show it until they choose permanent or donate.
    }

    return isReadyToShow;
  }

  if (!shouldShow()) return;

  /* ======================================================
     CREATE SIDEBAR (Modern UI, Animations, Accessibility)
  ====================================================== */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  let sidebarHost;
  let shadowRoot;

  function init() {
    sidebarHost = document.createElement('div');
    sidebarHost.id = 'modcore-donate-host';
    document.body.appendChild(sidebarHost);

    // Use a Shadow DOM for encapsulation
    shadowRoot = sidebarHost.attachShadow({ mode: 'open' });
    
    createStyles();
    // Using a DocumentFragment for performant DOM creation
    const contentFragment = createSidebarContent();
    shadowRoot.appendChild(contentFragment);

    attachEventListeners();

    // Focus the sidebar for screen readers when it opens
    shadowRoot.querySelector('.sidebar').focus(); 

    // Trigger the animation to show the sidebar after DOM construction
    setTimeout(() => {
        shadowRoot.querySelector('.sidebar-overlay').setAttribute('data-visible', 'true');
        shadowRoot.querySelector('.sidebar').setAttribute('data-visible', 'true');
    }, 10);
  }

  function createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        font-family: 'modcore-inter-font-custom', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 16px;
        line-height: 1.5;
        z-index: 999999;
      }

      .sidebar-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0); /* Start transparent */
        transition: background ${ANIMATION_DURATION} ease-out;
        z-index: 999998;
        pointer-events: none;
      }

      .sidebar-overlay[data-visible="true"] {
        background: rgba(0, 0, 0, 0.6);
        pointer-events: auto;
      }

      .sidebar {
        position: fixed;
        top: 0;
        right: 0;
        height: 100vh;
        width: 100%;
        max-width: 420px; /* Slightly wider for better UX */
        background: #ffffff;
        color: #111;
        box-shadow: -6px 0 30px rgba(0, 0, 0, 0.3);
        transform: translateX(100%);
        transition: transform ${ANIMATION_DURATION} cubic-bezier(0.4, 0, 0.2, 1); /* Enhanced transition */
        overflow-y: auto;
        padding: 40px 30px 30px;
        box-sizing: border-box;
        z-index: 999999;
        isolation: isolate; /* Create new stacking context */
      }

      .sidebar[data-visible="true"] {
        transform: translateX(0);
      }

      @media (max-width: 450px) {
        .sidebar {
          max-width: 100%;
        }
      }

      @media (prefers-color-scheme: dark) {
        .sidebar {
          background: #1a1a1a;
          color: #f0f0f0;
        }
      }

      /* === Sidebar Content Styling === */

      .header {
        text-align: center;
        margin-bottom: 30px;
      }

      .header h2 {
        font-size: 32px;
        color: ${PRIMARY_COLOR};
        margin: 0 0 8px;
        font-weight: 800;
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 0.3s ease-out 0.2s, transform 0.3s ease-out 0.2s;
      }
      .sidebar[data-visible="true"] .header h2 {
          opacity: 1;
          transform: translateY(0);
      }

      .header p {
        font-size: 16px;
        color: #777;
        margin: 0;
      }

      .intro-text {
        margin-bottom: 35px;
        padding: 20px;
        background: #f0f8ff; /* Light blue background */
        border-left: 6px solid ${PRIMARY_COLOR};
        border-radius: ${BORDER_RADIUS};
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 0.3s ease-out 0.3s, transform 0.3s ease-out 0.3s;
      }
      .sidebar[data-visible="true"] .intro-text {
          opacity: 1;
          transform: translateY(0);
      }

      @media (prefers-color-scheme: dark) {
        .intro-text {
          background: #2b2b2b;
          border-left-color: ${PRIMARY_COLOR};
        }
      }

      .intro-text p {
        margin: 0;
        font-size: 16px;
        font-style: italic;
      }

      .benefits-list {
        list-style: none;
        padding: 0;
        margin: 0 0 35px;
      }

      .benefit-item {
        display: flex;
        align-items: flex-start;
        padding: 15px 0;
        border-bottom: 1px solid #eee;
        opacity: 0;
        transform: translateY(10px);
      }
      .sidebar[data-visible="true"] .benefit-item {
          opacity: 1;
          transform: translateY(0);
      }
      /* Staggered transition delay for benefits list */
      .benefit-item:nth-child(1) { transition: opacity 0.3s ease-out 0.4s, transform 0.3s ease-out 0.4s; }
      .benefit-item:nth-child(2) { transition: opacity 0.3s ease-out 0.5s, transform 0.3s ease-out 0.5s; }
      .benefit-item:nth-child(3) { transition: opacity 0.3s ease-out 0.6s, transform 0.3s ease-out 0.6s; }
      .benefit-item:nth-child(4) { transition: opacity 0.3s ease-out 0.7s, transform 0.3s ease-out 0.7s; }
      
      @media (prefers-color-scheme: dark) {
        .benefit-item {
          border-bottom: 1px solid #333;
        }
      }

      .benefit-item:last-child {
        border-bottom: none;
      }

      .icon {
        font-size: 26px;
        margin-right: 18px;
        line-height: 1;
        flex-shrink: 0;
        color: ${PRIMARY_COLOR};
      }

      .details strong {
        display: block;
        font-size: 17px;
        margin-bottom: 4px;
      }

      .details p {
        font-size: 15px;
        margin: 0;
        color: #555;
      }
      
      @media (prefers-color-scheme: dark) {
        .details p {
          color: #bbb;
        }
      }

      /* === Actions Styling === */

      .actions {
        margin-top: 25px;
        display: flex;
        flex-direction: column;
        gap: 15px;
        padding-bottom: 24px;
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 0.3s ease-out 0.8s, transform 0.3s ease-out 0.8s;
      }
      .sidebar[data-visible="true"] .actions {
          opacity: 1;
          transform: translateY(0);
      }

      .btn {
        font-family: 'modcore-inter-font-custom', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 18px;
        font-weight: 700;
        padding: 16px 20px;
        border-radius: ${BORDER_RADIUS}; /* 16px radius */
        border: none;
        cursor: pointer;
        text-decoration: none;
        text-align: center;
        transition: background 0.3s, box-shadow 0.3s, transform 0.1s;
        display: block;
      }

      .primary {
        background: ${PRIMARY_COLOR};
        color: #fff;
      }
      
      .primary:hover {
        background: #1e88e5; /* Slightly darker blue on hover */
        box-shadow: 0 4px 15px rgba(33, 150, 243, 0.4);
      }
      
      .primary:active {
        transform: scale(0.99);
      }

      .link-action {
        font-family: 'modcore-inter-font-custom', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: none;
        border: none;
        color: #777;
        text-decoration: underline;
        cursor: pointer;
        font-size: 15px;
        margin-top: 5px;
        align-self: center;
      }
      
      .link-action:hover {
        color: #111;
      }
      
      @media (prefers-color-scheme: dark) {
        .link-action {
            color: #ccc;
        }
        .link-action:hover {
            color: #fff;
        }
      }

      /* Close Button for Accessibility */
      .close-btn {
        position: absolute;
        top: 15px;
        right: 15px; /* Moved to right for better flow with sidebar */
        width: 40px;
        height: 40px;
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 26px;
        line-height: 1;
        color: #777;
        transition: color 0.2s, transform 0.1s;
        z-index: 10;
        border-radius: 50%;
        padding: 0;
      }

      .close-btn:hover {
        color: ${PRIMARY_COLOR};
        background: rgba(33, 150, 243, 0.1);
      }
      
      .close-btn:active {
        transform: scale(0.9);
      }

      @media (prefers-color-scheme: dark) {
        .close-btn {
          color: #ccc;
        }
        .close-btn:hover {
          color: ${PRIMARY_COLOR};
          background: rgba(33, 150, 243, 0.2);
        }
      }
    `;
    shadowRoot.appendChild(style);
  }

  // Use DocumentFragment for performance
  function createSidebarContent() {
    const fragment = document.createDocumentFragment();
    
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    fragment.appendChild(overlay);

    const sidebar = document.createElement('section');
    sidebar.className = 'sidebar';
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
    sidebar.setAttribute('aria-labelledby', 'modcore-title');
    sidebar.setAttribute('aria-describedby', 'modcore-description');
    sidebar.tabIndex = -1; 

    // Close Button (Accessible)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn later';
    closeBtn.setAttribute('aria-label', 'Snooze and Close');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    sidebar.appendChild(closeBtn);
    
    // Header
    const header = document.createElement('div');
    header.className = 'header';
    const title = document.createElement('h2');
    title.id = 'modcore-title';
    title.textContent = 'Support modcore';
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Help us keep the lights on and the code flowing.';
    header.appendChild(title);
    header.appendChild(subtitle);
    sidebar.appendChild(header);

    // Intro Text (Humanized)
    const intro = document.createElement('div');
    intro.className = 'intro-text';
    const introP = document.createElement('p');
    introP.id = 'modcore-description';
    introP.textContent = 'modcore is built by a small team who believe in a truly private, ad-free internet. If we’ve saved you time or made your day easier, consider contributing to our open-source efforts.';
    intro.appendChild(introP);
    sidebar.appendChild(intro);

    // Benefits List
    const benefitsList = document.createElement('ul');
    benefitsList.className = 'benefits-list';
    
    BENEFITS.forEach(b => {
      const item = document.createElement('li');
      item.className = 'benefit-item';
      
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = b.icon;
      icon.setAttribute('aria-hidden', 'true');
      
      const details = document.createElement('div');
      details.className = 'details';
      
      const titleEl = document.createElement('strong');
      titleEl.textContent = b.title;
      
      const descEl = document.createElement('p');
      descEl.textContent = b.description;
      
      details.appendChild(titleEl);
      details.appendChild(descEl);
      
      item.appendChild(icon);
      item.appendChild(details);
      
      benefitsList.appendChild(item);
    });
    sidebar.appendChild(benefitsList);
    
    // Actions
    const actions = document.createElement('div');
    actions.className = 'actions';

    // Primary Donation Button (Membership Details removed as requested)
    const donateLink = document.createElement('a');
    donateLink.className = 'btn primary';
    donateLink.href = DONATE_URL;
    donateLink.target = '_blank';
    donateLink.rel = 'noopener noreferrer';
    donateLink.textContent = 'Become a Supporter';
    donateLink.addEventListener('click', markDismissed);
    actions.appendChild(donateLink);

    // Snooze/Later Button
    const laterBtn = document.createElement('button');
    laterBtn.className = 'link-action later';
    laterBtn.type = 'button';
    laterBtn.textContent = `Maybe Later (Snooze for ${TIMING.snoozeDurationDays} days)`;
    actions.appendChild(laterBtn);
    
    // Dismiss/Don't Ask Again Button (Now Permanent)
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'link-action permanent-dismiss';
    dismissBtn.type = 'button';
    dismissBtn.textContent = 'Close Permanently';
    actions.appendChild(dismissBtn);
    
    sidebar.appendChild(actions);
    fragment.appendChild(sidebar);
    
    return fragment;
  }

  function attachEventListeners() {
    const sidebar = shadowRoot.querySelector('.sidebar');
    const overlay = shadowRoot.querySelector('.sidebar-overlay');
    const laterBtns = shadowRoot.querySelectorAll('.later');
    const permanentDismissBtn = shadowRoot.querySelector('.permanent-dismiss');

    // Snooze/Close Handlers
    laterBtns.forEach(btn => {
        btn.addEventListener('click', () => snooze(TIMING.snoozeDurationDays));
    });

    // Permanent Dismiss Handler (New Feature)
    permanentDismissBtn.addEventListener('click', markPermanentDismissed);

    // Overlay Click Handler (snooze)
    overlay.addEventListener('click', () => snooze(TIMING.snoozeDurationDays));

    // Keyboard Escape Key Handler
    shadowRoot.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        snooze(TIMING.snoozeDurationDays);
      }
    });
  }


  /* ======================================================
     ACTION HANDLERS (Enhanced Logic)
  ====================================================== */

  function remove() {
    if (!sidebarHost) return;
    
    // Animate removal first
    const sidebar = shadowRoot.querySelector('.sidebar');
    const overlay = shadowRoot.querySelector('.sidebar-overlay');
    
    if (sidebar && overlay) {
        sidebar.setAttribute('data-visible', 'false');
        overlay.setAttribute('data-visible', 'false');
        
        // Remove after the animation completes
        setTimeout(() => {
            sidebarHost.remove();
            sidebarHost = null;
            shadowRoot = null;
        }, parseInt(ANIMATION_DURATION) * 1000); 
    } else {
        sidebarHost.remove();
        sidebarHost = null;
        shadowRoot = null;
    }
  }

  function snooze(days) {
    const targetTime = Date.now() + days * MS_PER_DAY;
    setStorageItem(STORAGE.snoozedUntil, targetTime);
    remove();
  }

  function markDismissed() {
    // Fired when the user clicks the "Become a Supporter" link
    // Assuming a user who clicks donate shouldn't see the ad again.
    markPermanentDismissed();
  }
  
  function markPermanentDismissed() {
    // Fired when the user clicks "Close Permanently"
    setStorageItem(STORAGE.permanentDismissed, 'true');
    setStorageItem(STORAGE.showCount, 0); // Reset count just in case
    remove();
  }

})();
