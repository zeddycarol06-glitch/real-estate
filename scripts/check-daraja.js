#!/usr/bin/env node
/* Read-only Daraja setup check. Prints whether each setting is present and
   verifies the credentials with Safaricom. Secret values are never printed. */

const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { getDarajaSettings } = require('../mpesa-daraja');

const state = (name, value, valid = Boolean(value)) => {
    const status = (valid ? 'OK' : 'MISSING').padEnd(7);
    const detail = value ? ` (${String(value).length} chars)` : '';
    console.log(`  ${status} ${name}${detail}`);
};

const main = async () => {
    console.log('EstatePro STK Push setup check\n');

    const rawCallback = String(process.env.DARAJA_CALLBACK_URL || '').trim();
    let shownCallback = 'not set';
    if (rawCallback) {
        try {
            const url = new URL(rawCallback);
            shownCallback = `${url.origin}${url.pathname}`;
        } catch (error) {
            shownCallback = 'invalid URL';
        }
    }

    state('DARAJA_ENV', process.env.DARAJA_ENV || 'sandbox (default)');
    state('DARAJA_CONSUMER_KEY', process.env.DARAJA_CONSUMER_KEY);
    state('DARAJA_CONSUMER_SECRET', process.env.DARAJA_CONSUMER_SECRET);
    state('DARAJA_SHORTCODE', process.env.DARAJA_SHORTCODE || '174379 (default)');
    state('DARAJA_PASSKEY', process.env.DARAJA_PASSKEY);
    state('DARAJA_CALLBACK_TOKEN', process.env.DARAJA_CALLBACK_TOKEN,
        String(process.env.DARAJA_CALLBACK_TOKEN || '').length >= 32);
    state('DARAJA_CALLBACK_URL', shownCallback, Boolean(rawCallback));

    let settings;
    try {
        settings = getDarajaSettings();
    } catch (error) {
        console.log(`\nSetup incomplete: ${error.message}`);
        console.log('Fix that setting, then run this check again.');
        process.exitCode = 1;
        return;
    }

    const callbackUrl = new URL(settings.callbackUrl);
    console.log(`\n  OK    Callback URL: ${callbackUrl.origin}${callbackUrl.pathname}`);

    let accessToken;
    try {
        const authorization = Buffer.from(`${settings.consumerKey}:${settings.consumerSecret}`).toString('base64');
        const response = await fetch(
            `${settings.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
            {
                headers: { Authorization: `Basic ${authorization}`, Accept: 'application/json' },
                signal: AbortSignal.timeout(20000)
            }
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.access_token) {
            throw new Error(result.error_description || `Safaricom returned HTTP ${response.status}.`);
        }
        accessToken = result.access_token;
        console.log('  OK    Safaricom authentication (consumer key and secret work)');
    } catch (error) {
        console.log(`\nSafaricom rejected the credentials: ${error.message}`);
        console.log('Check that the key and secret belong to the same app and match DARAJA_ENV.');
        process.exitCode = 1;
        return;
    }

    /* An access token alone does not prove the callback host is reachable.
       Check the public origin, not the callback path itself (which is POST). */
    try {
        const response = await fetch(`${callbackUrl.origin}/api/mpesa/config`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (data.stkConfigured !== true) {
            throw new Error(data.stkIssue || 'the running server has not loaded the new settings');
        }
        console.log('  OK    Public callback host reaches this server with STK active');
    } catch (error) {
        console.log(`\nCallback host check failed: ${error.message}`);
        console.log('Make sure the tunnel and EstatePro are running and .env has the current callback URL.');
        process.exitCode = 1;
        return;
    }

    if (!accessToken) {
        process.exitCode = 1;
        return;
    }

    console.log('\nEverything is ready. Open tenant-payment.html: STK Push is the default method.');
};

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
