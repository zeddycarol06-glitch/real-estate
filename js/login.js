(() => {
    'use strict';

    const form = document.querySelector('#auth-form');

    if (!form) {
        return;
    }

    const elements = {
        registerFields: document.querySelector('#register-fields'),
        confirmField: document.querySelector('#confirm-field'),
        rememberRow: document.querySelector('#remember-row'),
        termsRow: document.querySelector('#terms-row'),
        fullName: document.querySelector('#full-name'),
        phone: document.querySelector('#phone'),
        accountType: document.querySelector('#account-type'),
        email: document.querySelector('#email'),
        password: document.querySelector('#password'),
        confirmPassword: document.querySelector('#confirm-password'),
        remember: document.querySelector('#remember'),
        terms: document.querySelector('#terms'),
        kicker: document.querySelector('#auth-kicker'),
        title: document.querySelector('#auth-title'),
        description: document.querySelector('#auth-description'),
        submit: document.querySelector('#auth-submit'),
        error: document.querySelector('#auth-error'),
        success: document.querySelector('#auth-success'),
        successTitle: document.querySelector('#auth-success-title'),
        successText: document.querySelector('#auth-success-text'),
        successLink: document.querySelector('#auth-success-link'),
        successLinkText: document.querySelector('#auth-success-link-text'),
        switchText: document.querySelector('#auth-switch-text')
    };

    const modeButtons = [...document.querySelectorAll('.auth-tab')];
    const switchButtons = [...document.querySelectorAll('.auth-switch [data-auth-mode]')];
    const requestedMode = new URLSearchParams(window.location.search).get('mode');
    let activeMode = requestedMode === 'login' ? 'login' : 'register';

    const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

    const readStoredJson = (key) => {
        try {
            const value = window.localStorage.getItem(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            return null;
        }
    };

    const readStoredAccounts = () => {
        const storedAccounts = readStoredJson('estateproAccounts');
        const accounts = Array.isArray(storedAccounts)
            ? storedAccounts
            : [readStoredJson('estateproUser')].filter(Boolean);

        return accounts.filter((account) => account && typeof account === 'object');
    };

    const saveStoredAccounts = (accounts) => {
        try {
            const safeAccounts = accounts.slice(0, 100);
            window.localStorage.setItem('estateproAccounts', JSON.stringify(safeAccounts));

            if (safeAccounts[0]) {
                window.localStorage.setItem('estateproUser', JSON.stringify(safeAccounts[0]));
            }

            return true;
        } catch (error) {
            return false;
        }
    };

    const storeJson = (key, value, remember) => {
        try {
            window.localStorage.removeItem(key);
            window.sessionStorage.removeItem(key);
            const storage = remember ? window.localStorage : window.sessionStorage;
            storage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            return false;
        }
    };

    const getBytes = (value) => {
        if (window.TextEncoder) {
            return new TextEncoder().encode(value);
        }

        return Uint8Array.from(
            unescape(encodeURIComponent(value)),
            (character) => character.charCodeAt(0)
        );
    };

    const hashPassword = async (password) => {
        const bytes = getBytes(password);

        if (window.crypto?.subtle) {
            const digest = await window.crypto.subtle.digest('SHA-256', bytes);
            return [...new Uint8Array(digest)]
                .map((byte) => byte.toString(16).padStart(2, '0'))
                .join('');
        }

        // This fallback keeps the demo usable in older browsers without
        // storing the password in plain text.
        let hash = 2166136261;
        bytes.forEach((byte) => {
            hash ^= byte;
            hash = Math.imul(hash, 16777619);
        });

        return `fnv1a-${(hash >>> 0).toString(16)}`;
    };

    const clearMessages = () => {
        elements.error.hidden = true;
        elements.success.hidden = true;
        elements.error.textContent = '';
        elements.successText.textContent = '';
    };

    const showError = (message) => {
        elements.error.textContent = message;
        elements.error.hidden = false;
        elements.success.hidden = true;
    };

    const showSuccess = (title, message, accountType = 'tenant') => {
        const isLandlord = ['landlord', 'manager'].includes(accountType);

        elements.error.hidden = true;
        elements.successTitle.textContent = title;
        elements.successText.textContent = isLandlord
            ? `${message} The landlord dashboard is a private area, so it opens through the separate admin password.`
            : message;
        elements.successLink.href = isLandlord ? 'admin-login.html' : 'tenant-portal.html';
        elements.successLinkText.textContent = isLandlord ? 'Enter the admin password' : 'Open my tenant area';
        elements.success.hidden = false;
    };

    /* A tenant account lives on the server so it works on any device, so the
       sign-in is checked there first. The browser-local check is only the
       fallback for landlord and manager accounts, which are never stored
       server-side. A 401 is a normal "not a tenant account" answer here, not
       an error worth showing. */
    const signInTenantOnServer = async (email, password) => {
        if (window.location.protocol === 'file:') {
            return 'unavailable';
        }

        try {
            const response = await fetch('/api/tenant/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ email, password })
            });

            if (response.ok) {
                return 'signed-in';
            }

            return response.status === 401 ? 'not-a-tenant' : 'unavailable';
        } catch (error) {
            return 'unavailable';
        }
    };

    const updateUrl = (mode) => {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('mode', mode);
            window.history.replaceState({}, '', url);
        } catch (error) {
            // Some browsers restrict history updates for local files.
        }
    };

    const setMode = (mode) => {
        activeMode = mode === 'login' ? 'login' : 'register';
        const isRegistering = activeMode === 'register';

        elements.registerFields.hidden = !isRegistering;
        elements.confirmField.hidden = !isRegistering;
        elements.termsRow.hidden = !isRegistering;

        elements.fullName.required = isRegistering;
        elements.phone.required = isRegistering;
        elements.accountType.required = isRegistering;
        elements.confirmPassword.required = isRegistering;
        elements.terms.required = isRegistering;
        elements.password.autocomplete = isRegistering ? 'new-password' : 'current-password';

        elements.kicker.textContent = isRegistering ? 'CREATE YOUR ACCOUNT' : 'WELCOME BACK';
        elements.title.textContent = isRegistering
            ? 'Start your EstatePro journey'
            : 'Welcome back';
        elements.description.textContent = isRegistering
            ? 'Enter your details below so we can personalize your property experience.'
            : 'Sign in to continue finding and managing your next home.';
        elements.submit.textContent = isRegistering ? 'Create account' : 'Sign in';
        elements.switchText.textContent = isRegistering
            ? 'Already have an account?'
            : 'New to EstatePro?';

        modeButtons.forEach((button) => {
            const isActive = button.dataset.authMode === activeMode;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', String(isActive));
        });

        switchButtons.forEach((button) => {
            button.textContent = isRegistering ? 'Sign in' : 'Create an account';
            button.dataset.authMode = isRegistering ? 'login' : 'register';
        });

        clearMessages();
        updateUrl(activeMode);
    };

    const validate = (isRegistering) => {
        const email = normalizeEmail(elements.email.value);
        const password = elements.password.value;

        if (!elements.email.value.trim() || !elements.email.checkValidity()) {
            return 'Enter a valid email address.';
        }

        if (!password || password.length < 8) {
            return 'Your password must contain at least 8 characters.';
        }

        if (!isRegistering) {
            return '';
        }

        const fullName = elements.fullName.value.trim();
        const phone = elements.phone.value.trim();
        const accountType = elements.accountType.value;

        if (fullName.length < 2) {
            return 'Enter your full name.';
        }

        if (!/^[+\d][\d\s()-]{7,}$/.test(phone)) {
            return 'Enter a valid phone number.';
        }

        if (!accountType) {
            return 'Choose the type of account you need.';
        }

        if (password !== elements.confirmPassword.value) {
            return 'Your passwords do not match.';
        }

        if (!elements.terms.checked) {
            return 'Accept the terms and privacy policy to continue.';
        }

        return '';
    };

    /* Puts a tenant on the landlord's server-side list so the tenant is
       manageable from the dashboard, not just visible in this browser. The
       password goes too, so the server can hash it and open a tenant session;
       without it the new account could never reach the tenant area. A failure
       here must never block someone creating an account. */
    const registerTenantOnServer = async (account, password) => {
        if (window.location.protocol === 'file:' || account.accountType !== 'tenant') {
            return;
        }

        try {
            const response = await fetch('/api/tenants/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    fullName: account.fullName,
                    email: account.email,
                    phone: account.phone,
                    propertyId: account.propertyId || 'sunrise-residences',
                    unit: account.unit || '',
                    password
                })
            });

            if (!response.ok) {
                return;
            }

            const result = await response.json().catch(() => null);

            if (result?.tenant?.propertyId) {
                const stored = readStoredAccounts();
                const index = stored.findIndex((item) => normalizeEmail(item.email) === account.email);

                if (index !== -1) {
                    stored[index] = {
                        ...stored[index],
                        propertyId: result.tenant.propertyId,
                        unit: result.tenant.unit || stored[index].unit
                    };
                    saveStoredAccounts(stored);
                }
            }
        } catch (error) {
            // The account still works in this browser; the landlord can add them by hand.
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        clearMessages();

        const isRegistering = activeMode === 'register';
        const validationMessage = validate(isRegistering);

        if (validationMessage) {
            showError(validationMessage);
            return;
        }

        const email = normalizeEmail(elements.email.value);
        const password = elements.password.value;
        const storedAccounts = readStoredAccounts();
        const existingAccount = storedAccounts.find((account) => normalizeEmail(account.email) === email) || null;
        const passwordHash = await hashPassword(password);

        if (isRegistering) {
            if (existingAccount) {
                showError('An account with this email already exists. Switch to Sign in to continue.');
                return;
            }

            const registeredAt = new Date().toISOString();
            const account = {
                fullName: elements.fullName.value.trim(),
                email,
                phone: elements.phone.value.trim(),
                accountType: elements.accountType.value,
                passwordHash,
                createdAt: registeredAt,
                registeredAt
            };

            if (!saveStoredAccounts([account, ...storedAccounts])) {
                showError('We could not save your account in this browser. Please try again.');
                return;
            }

            const session = {
                fullName: account.fullName,
                email: account.email,
                accountType: account.accountType,
                signedInAt: new Date().toISOString()
            };

            if (!storeJson('estateproSession', session, elements.remember.checked)) {
                showError('Your account was created, but this browser could not start a session.');
                return;
            }

            await registerTenantOnServer(account, password);

            showSuccess(
                'Account created',
                `Welcome, ${account.fullName}! Your details are ready. Continue to explore EstatePro.`,
                account.accountType
            );
            return;
        }

        if (!existingAccount) {
            /* No account in this browser does not rule out a tenant who
               registered on another device, so the server is asked too. */
            const serverResult = await signInTenantOnServer(email, password);

            if (serverResult === 'signed-in') {
                window.location.replace('tenant-portal.html');
                return;
            }

            showError('No account was found for this browser. Choose Create an account to get started.');
            return;
        }

        if (normalizeEmail(existingAccount.email) !== email) {
            showError('We could not find an EstatePro account with that email address.');
            return;
        }

        if (existingAccount.passwordHash !== passwordHash) {
            showError('The password you entered is incorrect. Please try again.');
            return;
        }

        const session = {
            fullName: existingAccount.fullName,
            email: existingAccount.email,
            accountType: existingAccount.accountType,
            signedInAt: new Date().toISOString()
        };

        if (!storeJson('estateproSession', session, elements.remember.checked)) {
            showError('We could not start a session in this browser. Please try again.');
            return;
        }

        /* A tenant who also has a server-side account goes straight to the
           portal, so the two sign-in routes do not leave them guessing where
           their tenant area is. */
        if (existingAccount.accountType === 'tenant') {
            const serverResult = await signInTenantOnServer(email, password);

            if (serverResult === 'signed-in') {
                window.location.replace('tenant-portal.html');
                return;
            }
        }

        showSuccess(
            'You are signed in',
            `Welcome back, ${existingAccount.fullName}! Continue to explore EstatePro.`,
            existingAccount.accountType
        );
    };

    [...modeButtons, ...switchButtons].forEach((button) => {
        button.addEventListener('click', () => {
            setMode(button.dataset.authMode);
        });
    });

    form.addEventListener('submit', handleSubmit);
    form.addEventListener('input', () => {
        if (!elements.error.hidden) {
            elements.error.hidden = true;
        }

        if (!elements.success.hidden) {
            elements.success.hidden = true;
        }
    });

    setMode(activeMode);
})();
