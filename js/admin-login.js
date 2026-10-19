(() => {
    'use strict';

    const signInForm = document.querySelector('#admin-signin-form');
    const setupForm = document.querySelector('#admin-setup-form');
    const passwordForm = document.querySelector('#admin-password-form');

    if (!signInForm || !setupForm || !passwordForm) {
        return;
    }

    const elements = {
        kicker: document.querySelector('#gate-kicker'),
        title: document.querySelector('#gate-title'),
        description: document.querySelector('#gate-description'),
        notice: document.querySelector('#gate-notice'),
        signInError: document.querySelector('#admin-signin-error'),
        setupError: document.querySelector('#admin-setup-error'),
        passwordError: document.querySelector('#admin-password-error'),
        passwordSuccess: document.querySelector('#admin-password-success'),
        signInSubmit: document.querySelector('#admin-signin-submit'),
        signInHint: document.querySelector('#signin-hint'),
        setupHint: document.querySelector('#setup-hint'),
        passwordChangeHint: document.querySelector('#password-change-hint'),
        signInPassword: document.querySelector('#admin-password'),
        setupPassword: document.querySelector('#setup-password'),
        setupConfirm: document.querySelector('#setup-confirm-password'),
        currentPassword: document.querySelector('#current-password'),
        newPassword: document.querySelector('#new-password'),
        newPasswordConfirm: document.querySelector('#new-password-confirm'),
        signedIn: document.querySelector('#admin-signed-in'),
        signedInText: document.querySelector('#admin-signed-in-text'),
        openDashboard: document.querySelector('#admin-open-dashboard'),
        signOut: document.querySelector('#admin-signout'),
        offline: document.querySelector('#admin-offline'),
        offlineTitle: document.querySelector('#admin-offline-title'),
        offlineText: document.querySelector('#admin-offline-text'),
        offlineUrl: document.querySelector('#admin-offline-url'),
        offlineRetry: document.querySelector('#admin-offline-retry')
    };

    const isDirectFile = window.location.protocol === 'file:';

    /* The address to open is the one this page was loaded from, so the advice
       stays correct when EstatePro runs on a non-default port. */
    const gateUrl = `${window.location.protocol === 'http:' || window.location.protocol === 'https:'
        ? window.location.origin
        : 'http://localhost:3000'}/admin-login.html`;

    const nextPath = (() => {
        const requested = new URLSearchParams(window.location.search).get('next') || '/dashboard.html';

        return requested.startsWith('/') && !requested.startsWith('//') ? requested : '/dashboard.html';
    })();

    /* The password is verified by the server, so a gate page that cannot reach
       the server must never keep looking like a working sign-in form. */
    const serverHints = {
        offline: {
            title: 'The EstatePro server is not answering',
            text: 'The admin password is checked by the EstatePro server, so the gate stays closed until it is running.'
        },
        file: {
            title: 'This page was opened from the file system',
            text: 'The admin password is checked by the EstatePro server, which a page opened from disk cannot reach. Open it through the server address instead.'
        }
    };

    const showOffline = (reason) => {
        const hints = serverHints[reason] || serverHints.offline;

        signInForm.hidden = true;
        setupForm.hidden = true;
        passwordForm.hidden = true;
        elements.signedIn.hidden = true;
        elements.offline.hidden = false;
        elements.offlineTitle.textContent = hints.title;
        elements.offlineText.textContent = hints.text;

        if (elements.offlineUrl) {
            elements.offlineUrl.textContent = gateUrl;
        }
        elements.kicker.textContent = 'SERVER REQUIRED';
        elements.title.textContent = 'Start the EstatePro server';
        elements.description.textContent = 'The landlord dashboard can only be opened through the EstatePro server.';
        elements.signInSubmit.disabled = true;
        setMessage(elements.signInError, '');
        setMessage(elements.setupError, '');
        setMessage(elements.passwordError, '');
    };

    const showOnline = () => {
        elements.offline.hidden = true;
    };

    const formatMinutes = (seconds) => {
        const minutes = Math.max(1, Math.ceil(Number(seconds) / 60));

        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    };

    const setMessage = (element, message) => {
        if (!element) {
            return;
        }

        element.textContent = message;
        element.hidden = !message;
    };

    const setNotice = (message) => {
        setMessage(elements.notice, message);
    };

    const showState = ({ mode, configured, authenticated, locked, retryAfterSeconds, attemptsRemaining, passwordPolicy }) => {
        const isSetup = mode === 'setup';
        const isSignedIn = mode === 'signed-in';
        const isLocked = Boolean(locked);

        signInForm.hidden = isSetup || isSignedIn;
        setupForm.hidden = !isSetup;
        passwordForm.hidden = !isSignedIn;
        elements.signedIn.hidden = !isSignedIn;

        if (passwordPolicy) {
            elements.setupHint.textContent = passwordPolicy;
            elements.passwordChangeHint.textContent = passwordPolicy;
        }

        if (isSetup) {
            elements.kicker.textContent = 'FIRST-TIME SETUP';
            elements.title.textContent = 'Create the admin password';
            elements.description.textContent = 'Nobody can open the landlord dashboard until this password exists.';
            setNotice('Set up the admin password now to protect the dashboard.');
        } else if (isSignedIn) {
            elements.kicker.textContent = 'ADMIN SESSION ACTIVE';
            elements.title.textContent = 'Welcome back';
            elements.description.textContent = 'This browser is already verified as the EstatePro administrator.';
            setNotice('');
        } else {
            elements.kicker.textContent = 'ADMIN ONLY';
            elements.title.textContent = 'Sign in to the dashboard';
            elements.description.textContent = 'Enter the landlord admin password to continue. Your tenants do not need this password.';
            setNotice('');
        }

        if (isLocked) {
            setMessage(
                elements.signInError,
                `Too many failed attempts. Try again in ${formatMinutes(retryAfterSeconds)}.`
            );
        } else if (typeof attemptsRemaining === 'number' && attemptsRemaining < 5 && attemptsRemaining > 0) {
            elements.signInHint.textContent = `${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} left before a temporary lock.`;
        } else {
            elements.signInHint.textContent = 'Landlord access only.';
        }

        elements.signInSubmit.disabled = isLocked;
        elements.openDashboard.href = nextPath;
    };

    const requestJson = async (url, options = {}) => {
        let response;

        try {
            response = await fetch(url, {
                credentials: 'same-origin',
                ...options,
                headers: { Accept: 'application/json', ...(options.headers || {}) }
            });
        } catch (error) {
            return { ok: false, status: 0, data: { error: 'The EstatePro server could not be reached. Make sure it is still running, then try again.' } };
        }

        let data = {};

        try {
            data = await response.json();
        } catch (error) {
            data = {};
        }

        return { ok: response.ok, status: response.status, data };
    };

    const readSessionState = async () => {
        if (isDirectFile) {
            showOffline('file');
            return;
        }

        if (elements.offlineRetry) {
            elements.offlineRetry.disabled = true;
            elements.offlineRetry.textContent = 'Checking…';
        }

        try {
            const { ok, data } = await requestJson('/api/admin/session');

            if (!ok) {
                showOffline('offline');
                return;
            }

            showOnline();

            if (!data.configured) {
                showState({ mode: 'setup', configured: false, authenticated: false, locked: false, retryAfterSeconds: 0, attemptsRemaining: 5, passwordPolicy: data.passwordPolicy });
                return;
            }

            if (data.authenticated) {
                showState({ mode: 'signed-in', configured: true, authenticated: true, locked: false, retryAfterSeconds: 0, attemptsRemaining: 5, passwordPolicy: data.passwordPolicy });
                return;
            }

            showState({
                mode: 'sign-in',
                configured: true,
                authenticated: false,
                locked: data.locked,
                retryAfterSeconds: data.retryAfterSeconds,
                attemptsRemaining: data.attemptsRemaining,
                passwordPolicy: data.passwordPolicy
            });

            const reason = new URLSearchParams(window.location.search).get('reason');

            if (reason === 'expired') {
                setNotice('Your admin session ended. Sign in again to open the dashboard.');
            } else if (reason === 'signed-out') {
                setNotice('You have been signed out of the landlord dashboard.');
            } else if (reason === 'required') {
                setNotice('The landlord dashboard is protected. Enter the admin password to continue.');
            }
        } catch (error) {
            showOffline('offline');
        } finally {
            if (elements.offlineRetry) {
                elements.offlineRetry.disabled = false;
                elements.offlineRetry.textContent = 'Check again';
            }
        }
    };

    const postJson = (url, payload) => requestJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    /* Turns a dead server into the recovery panel instead of a bare error line,
       and keeps a dead server from looking like a rejected password. */
    const handleRequestFailure = async () => {
        const { ok } = await requestJson('/api/admin/session').catch(() => ({ ok: false }));

        if (!ok) {
            showOffline(isDirectFile ? 'file' : 'offline');
            return true;
        }

        return false;
    };

    signInForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(elements.signInError, '');

        if (isDirectFile) {
            showOffline('file');
            return;
        }

        const password = elements.signInPassword.value;

        if (!password) {
            setMessage(elements.signInError, 'Enter the admin password.');
            return;
        }

        const submitButton = elements.signInSubmit;
        const originalLabel = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = 'Checking…';

        try {
            const { ok, data } = await postJson('/api/admin/session', { password });

            if (!ok) {
                if (await handleRequestFailure()) {
                    return;
                }

                setMessage(elements.signInError, data.error || 'That admin password is incorrect.');
                elements.signInPassword.value = '';
                elements.signInPassword.focus();
                await readSessionState();
                return;
            }

            window.location.replace(nextPath);
        } catch (error) {
            if (!(await handleRequestFailure())) {
                setMessage(elements.signInError, 'The admin service could not be reached. Try again.');
            }
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = originalLabel;
        }
    });

    setupForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(elements.setupError, '');

        if (isDirectFile) {
            showOffline('file');
            return;
        }

        const password = elements.setupPassword.value;

        if (password !== elements.setupConfirm.value) {
            setMessage(elements.setupError, 'The two passwords do not match.');
            return;
        }

        const submitButton = setupForm.querySelector('button[type="submit"]');
        const originalLabel = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = 'Creating…';

        try {
            const { ok, data } = await postJson('/api/admin/setup', {
                password,
                confirmPassword: elements.setupConfirm.value
            });

            if (!ok) {
                setMessage(elements.setupError, data.error || 'The admin password could not be created.');
                return;
            }

            window.location.replace(nextPath);
        } catch (error) {
            if (!(await handleRequestFailure())) {
                setMessage(elements.setupError, 'The admin service could not be reached. Try again.');
            }
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = originalLabel;
        }
    });

    passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(elements.passwordError, '');
        setMessage(elements.passwordSuccess, '');

        if (isDirectFile) {
            showOffline('file');
            return;
        }

        const newPassword = elements.newPassword.value;

        if (newPassword !== elements.newPasswordConfirm.value) {
            setMessage(elements.passwordError, 'The two new passwords do not match.');
            return;
        }

        const submitButton = passwordForm.querySelector('button[type="submit"]');
        const originalLabel = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = 'Updating…';

        try {
            const { ok, data } = await postJson('/api/admin/password', {
                currentPassword: elements.currentPassword.value,
                newPassword,
                confirmPassword: elements.newPasswordConfirm.value
            });

            if (!ok) {
                setMessage(elements.passwordError, data.error || 'The admin password could not be updated.');
                return;
            }

            passwordForm.reset();
            setMessage(elements.passwordSuccess, data.message || 'Admin password updated.');
        } catch (error) {
            if (!(await handleRequestFailure())) {
                setMessage(elements.passwordError, 'The admin service could not be reached. Try again.');
            }
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = originalLabel;
        }
    });

    elements.signOut.addEventListener('click', async () => {
        elements.signOut.disabled = true;

        try {
            await requestJson('/api/admin/session', { method: 'DELETE' });
        } catch (error) {
            // The local view is reset either way.
        }

        elements.signOut.disabled = false;
        passwordForm.reset();
        setMessage(elements.passwordSuccess, '');
        await readSessionState();
    });

    if (elements.offlineRetry) {
        elements.offlineRetry.addEventListener('click', () => readSessionState());
    }

    document.querySelectorAll('[data-password-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.passwordToggle);

            if (!input) {
                return;
            }

            const isHidden = input.type === 'password';

            input.type = isHidden ? 'text' : 'password';
            button.textContent = isHidden ? 'Hide' : 'Show';
            button.setAttribute('aria-label', `${isHidden ? 'Hide' : 'Show'} ${input.labels?.[0]?.textContent?.trim() || 'password'}`);
        });
    });

    [elements.signInPassword, elements.setupPassword, elements.setupConfirm, elements.currentPassword, elements.newPassword, elements.newPasswordConfirm]
        .forEach((input) => {
            input.addEventListener('input', () => {
                setMessage(elements.signInError, '');
                setMessage(elements.setupError, '');
                setMessage(elements.passwordError, '');
            });
        });

    readSessionState();
})();
