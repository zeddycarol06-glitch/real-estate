(() => {
    'use strict';

    const signInForm = document.querySelector('#tenant-signin-form');

    if (!signInForm) {
        return;
    }

    const elements = {
        kicker: document.querySelector('.auth-card-header .subtitle'),
        title: document.querySelector('#tenant-signin-title'),
        description: document.querySelector('#tenant-signin-description'),
        notice: document.querySelector('#tenant-signin-notice'),
        error: document.querySelector('#tenant-signin-error'),
        email: document.querySelector('#tenant-email'),
        password: document.querySelector('#tenant-password'),
        submit: document.querySelector('#tenant-signin-submit'),
        signedIn: document.querySelector('#tenant-signed-in'),
        signedInText: document.querySelector('#tenant-signed-in-text'),
        openPortal: document.querySelector('#tenant-open-portal'),
        signOut: document.querySelector('#tenant-signout'),
        offline: document.querySelector('#tenant-offline'),
        offlineUrl: document.querySelector('#tenant-offline-url'),
        offlineRetry: document.querySelector('#tenant-offline-retry')
    };

    const isDirectFile = window.location.protocol === 'file:';

    const gateUrl = `${window.location.protocol === 'http:' || window.location.protocol === 'https:'
        ? window.location.origin
        : 'http://localhost:3000'}/tenant-login.html`;

    /* Only same-site relative paths are honoured, so ?next= cannot be used to
       bounce a signed-in tenant to another site. */
    const nextPath = (() => {
        const requested = new URLSearchParams(window.location.search).get('next') || '/tenant-portal.html';

        return requested.startsWith('/') && !requested.startsWith('//') ? requested : '/tenant-portal.html';
    })();

    const setMessage = (element, message) => {
        if (!element) {
            return;
        }

        element.textContent = message;
        element.hidden = !message;
    };

    const setNotice = (message) => setMessage(elements.notice, message);

    const showOffline = (reason) => {
        const isFile = reason === 'file';

        signInForm.hidden = true;
        elements.signedIn.hidden = true;
        elements.offline.hidden = false;
        elements.kicker.textContent = 'SERVER REQUIRED';
        elements.title.textContent = 'Start the EstatePro server';
        elements.description.textContent = isFile
            ? 'This page was opened from the file system, so it cannot reach the EstatePro server that checks tenant passwords.'
            : 'Tenant passwords are checked by the EstatePro server, so this page cannot sign you in until it is running.';
        elements.submit.disabled = true;
        setMessage(elements.error, '');

        if (elements.offlineUrl) {
            elements.offlineUrl.textContent = gateUrl;
        }
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
            const { ok, data } = await requestJson('/api/tenant/session');

            if (!ok) {
                showOffline('offline');
                return;
            }

            elements.offline.hidden = true;
            elements.submit.disabled = false;

            if (data.authenticated) {
                signInForm.hidden = true;
                elements.signedIn.hidden = false;
                elements.kicker.textContent = 'TENANT SESSION ACTIVE';
                elements.title.textContent = `Welcome back, ${data.tenant?.fullName || 'tenant'}`;
                elements.description.textContent = 'This browser is already verified as your EstatePro tenant account.';
                elements.signedInText.textContent = 'You are signed in and can open your tenant area straight away.';
                elements.openPortal.href = nextPath;
                setNotice('');
                return;
            }

            signInForm.hidden = false;
            elements.signedIn.hidden = true;
            elements.kicker.textContent = 'TENANT SIGN IN';
            elements.title.textContent = 'Open your tenant area';
            elements.description.textContent = 'Use the email and password you registered with. This is separate from the landlord admin password.';

            const reason = new URLSearchParams(window.location.search).get('reason');

            if (reason === 'expired') {
                setNotice('Your tenant session ended. Sign in again to continue.');
            } else if (reason === 'signed-out') {
                setNotice('You have been signed out of your tenant area.');
            } else if (reason === 'required') {
                setNotice('Sign in to open your tenant area.');
            } else {
                setNotice('');
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

    /* A dead server must not look like a rejected password. */
    const handleRequestFailure = async () => {
        const { ok } = await requestJson('/api/tenant/session').catch(() => ({ ok: false }));

        if (!ok) {
            showOffline(isDirectFile ? 'file' : 'offline');
            return true;
        }

        return false;
    };

    signInForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(elements.error, '');

        if (isDirectFile) {
            showOffline('file');
            return;
        }

        const email = elements.email.value.trim();
        const password = elements.password.value;

        if (!email || !password) {
            setMessage(elements.error, 'Enter both your email address and your password.');
            return;
        }

        const originalLabel = elements.submit.textContent;
        elements.submit.disabled = true;
        elements.submit.textContent = 'Signing in…';

        try {
            const { ok, data } = await postJson('/api/tenant/session', { email, password });

            if (!ok) {
                if (await handleRequestFailure()) {
                    return;
                }

                setMessage(elements.error, data.error || 'We could not sign you in with that email and password.');
                elements.password.value = '';
                elements.password.focus();
                return;
            }

            window.location.replace(nextPath);
        } catch (error) {
            if (!(await handleRequestFailure())) {
                setMessage(elements.error, 'The tenant sign-in service could not be reached. Try again.');
            }
        } finally {
            elements.submit.disabled = false;
            elements.submit.textContent = originalLabel;
        }
    });

    elements.signOut.addEventListener('click', async () => {
        elements.signOut.disabled = true;

        try {
            await requestJson('/api/tenant/session', { method: 'DELETE' });
        } catch (error) {
            // The local view is reset either way.
        }

        elements.signOut.disabled = false;
        window.location.replace('/tenant-login.html?reason=signed-out');
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

    [elements.email, elements.password].forEach((input) => {
        input.addEventListener('input', () => setMessage(elements.error, ''));
    });

    readSessionState();
})();
