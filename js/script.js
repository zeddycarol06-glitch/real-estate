(() => {
    'use strict';

    const header = document.querySelector('.header');
    const menuButton = document.querySelector('.menu-btn');
    const navbar = document.querySelector('.navbar');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* Mobile navigation */
    const setMenuState = (isOpen) => {
        if (!menuButton || !navbar) {
            return;
        }

        navbar.classList.toggle('is-open', isOpen);
        menuButton.setAttribute('aria-expanded', String(isOpen));
        menuButton.setAttribute(
            'aria-label',
            isOpen ? 'Close navigation menu' : 'Open navigation menu'
        );
        menuButton.textContent = isOpen ? '×' : '☰';
    };

    if (menuButton && navbar) {
        menuButton.addEventListener('click', () => {
            setMenuState(!navbar.classList.contains('is-open'));
        });

        navbar.addEventListener('click', (event) => {
            if (event.target.closest('a')) {
                setMenuState(false);
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                setMenuState(false);
            }
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 800) {
                setMenuState(false);
            }
        });
    }

    /* Smooth in-page navigation with room for the sticky header */
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        const hash = link.getAttribute('href');

        if (!hash || hash === '#') {
            return;
        }

        const target = document.querySelector(hash);

        if (!target) {
            return;
        }

        link.addEventListener('click', (event) => {
            event.preventDefault();
            target.scrollIntoView({
                behavior: prefersReducedMotion ? 'auto' : 'smooth',
                block: 'start'
            });
            window.history.replaceState(null, '', hash);
            setMenuState(false);
        });
    });

    /* Highlight the navigation item for the section currently in view */
    const navLinks = [...document.querySelectorAll('.nav-links a[href^="#"]')];
    const sections = navLinks
        .map((link) => document.querySelector(link.getAttribute('href')))
        .filter(Boolean);

    const setActiveLink = (sectionId) => {
        navLinks.forEach((link) => {
            const isActive = link.getAttribute('href') === `#${sectionId}`;
            link.classList.toggle('active', isActive);
            link.setAttribute('aria-current', isActive ? 'page' : 'false');
        });
    };

    const updateActiveLink = () => {
        if (!sections.length) {
            return;
        }

        const marker = window.scrollY + (header?.offsetHeight || 0) + 28;
        let currentSection = sections[0];

        sections.forEach((section) => {
            const sectionTop = section.getBoundingClientRect().top + window.scrollY;

            if (sectionTop <= marker) {
                currentSection = section;
            }
        });

        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
            currentSection = sections[sections.length - 1];
        }

        setActiveLink(currentSection.id);
    };

    let scrollFramePending = false;
    window.addEventListener('scroll', () => {
        if (scrollFramePending) {
            return;
        }

        scrollFramePending = true;
        window.requestAnimationFrame(() => {
            updateActiveLink();
            header?.classList.toggle('is-scrolled', window.scrollY > 8);
            scrollFramePending = false;
        });
    }, { passive: true });

    updateActiveLink();
    header?.classList.toggle('is-scrolled', window.scrollY > 8);

    /* Keep the footer year current without editing the HTML every year */
    const currentYear = String(new Date().getFullYear());
    document.querySelectorAll('.footer-bottom p, .admin-footer p').forEach((element) => {
        element.innerHTML = element.innerHTML.replace(/20\d{2}/g, currentYear);
    });

    /* Hide unavailable images so the styled gradient fallbacks remain visible */
    document.querySelectorAll('img').forEach((image) => {
        const hideImage = () => {
            image.style.display = 'none';
        };

        image.addEventListener('error', hideImage, { once: true });

        if (image.complete && image.naturalWidth === 0) {
            hideImage();
        }
    });
})();
