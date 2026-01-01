document.addEventListener('DOMContentLoaded', () => {
    const navLinks = document.querySelectorAll('.nav-link');
    const contentBlocks = document.querySelectorAll('.content-block');
    const defaultTarget = 'authors-content';

    function applyI18n() {
        const i18nElements = document.querySelectorAll('[data-i18n]');
        i18nElements.forEach(element => {
            const messageKey = element.dataset.i18n;
            const message = chrome.i18n.getMessage(messageKey);
            
            if (message) {
                element.textContent = message;
            }
        });
        document.title = chrome.i18n.getMessage('contributions_title');
    }

    function showContent(targetId) {
        const currentActiveBlock = document.querySelector('.content-block.active');
        if (currentActiveBlock) {
            currentActiveBlock.classList.remove('active');
        }

        setTimeout(() => {
            const targetBlock = document.getElementById(targetId);
            if (targetBlock) {
                targetBlock.classList.add('active');
                targetBlock.focus();
            }
        }, 10); // Reduced delay for a faster feel
    }

    function setActiveLink(clickedLink) {
        navLinks.forEach(link => {
            link.classList.remove('active');
            link.removeAttribute('aria-current');
            link.tabIndex = -1; // Make links not tabbable by default
        });

        if (clickedLink) {
            clickedLink.classList.add('active');
            clickedLink.setAttribute('aria-current', 'page');
            clickedLink.tabIndex = 0; // Make active link tabbable
        }
    }

    function handleNavigation() {
        const hash = window.location.hash.substring(1);
        const targetId = hash || defaultTarget;
        const targetLink = document.querySelector(`.nav-link[data-target="${targetId}"]`);
        
        showContent(targetId);
        setActiveLink(targetLink);
    }
    
    function keyboardNavigation(event) {
        const focusedLink = document.activeElement;
        const navList = Array.from(document.querySelectorAll('.sidebar-nav a'));
        const focusedIndex = navList.indexOf(focusedLink);
    
        if (focusedIndex !== -1) {
            let nextIndex = focusedIndex;
            if (event.key === 'ArrowDown') {
                nextIndex = (focusedIndex + 1) % navList.length;
            } else if (event.key === 'ArrowUp') {
                nextIndex = (focusedIndex - 1 + navList.length) % navList.length;
            }
    
            if (nextIndex !== focusedIndex) {
                navList[nextIndex].focus();
                event.preventDefault();
            }
        }
    }

    applyI18n();
    handleNavigation();

    document.querySelector('.sidebar').addEventListener('keydown', keyboardNavigation);

    navLinks.forEach(link => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            const targetId = event.target.dataset.target;
            
            if (targetId) {
                window.location.hash = targetId;
            }
        });
    });

    window.addEventListener('hashchange', handleNavigation);
});
