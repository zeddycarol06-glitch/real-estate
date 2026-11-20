const path = require('node:path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });

const tokenCache = {
    value: '',
    expiresAt: 0
};

const getDarajaCallbackToken = () => {
    const callbackSecret = String(process.env.DARAJA_CALLBACK_TOKEN || '').trim();
    if (callbackSecret.length < 32) {
        throw new Error('DARAJA_CALLBACK_TOKEN must contain at least 32 characters.');
    }

    return callbackSecret;
};

const getDarajaSettings = () => {
    const environment = String(process.env.DARAJA_ENV || 'sandbox').trim().toLowerCase();
    if (!['sandbox', 'production'].includes(environment)) {
        throw new Error('DARAJA_ENV must be either sandbox or production.');
    }

    const settings = {
        environment,
        baseUrl: environment === 'production'
            ? 'https://api.safaricom.co.ke'
            : 'https://sandbox.safaricom.co.ke',
        consumerKey: String(process.env.DARAJA_CONSUMER_KEY || '').trim(),
        consumerSecret: String(process.env.DARAJA_CONSUMER_SECRET || '').trim(),
        shortcode: String(process.env.DARAJA_SHORTCODE || (environment === 'sandbox' ? '174379' : '')).trim(),
        passkey: String(process.env.DARAJA_PASSKEY || '').trim(),
        callbackSecret: getDarajaCallbackToken(),
        accountReference: String(process.env.DARAJA_ACCOUNT_REFERENCE || 'ZEDTECH').trim().slice(0, 12),
        transactionDescription: String(process.env.DARAJA_TRANSACTION_DESCRIPTION || 'Payment').trim().slice(0, 13)
    };

    const callbackValue = String(process.env.DARAJA_CALLBACK_URL || '').trim();
    if (!callbackValue) {
        throw new Error('Set DARAJA_CALLBACK_URL to your public HTTPS /api/mpesa/callback URL.');
    }

    let callbackUrl;
    try {
        callbackUrl = new URL(callbackValue);
    } catch (error) {
        throw new Error('DARAJA_CALLBACK_URL must be an absolute public HTTPS URL.');
    }

    if (callbackUrl.protocol !== 'https:'
        || callbackUrl.pathname.replace(/\/+$/, '') !== '/api/mpesa/callback'
        || callbackUrl.username
        || callbackUrl.password
        || callbackUrl.hash
        || /(^localhost$|\.localhost$|\.local$|\.example$|\.test$|\.invalid$)/i.test(callbackUrl.hostname)) {
        throw new Error('DARAJA_CALLBACK_URL must use a public HTTPS host and end with /api/mpesa/callback.');
    }

    if (settings.consumerKey.length < 8 || settings.consumerSecret.length < 8) {
        throw new Error('Set valid DARAJA_CONSUMER_KEY and DARAJA_CONSUMER_SECRET values.');
    }
    if (!/^\d{5,7}$/.test(settings.shortcode) || !settings.passkey) {
        throw new Error('Set a valid DARAJA_SHORTCODE and DARAJA_PASSKEY.');
    }
    callbackUrl.searchParams.set('token', settings.callbackSecret);
    settings.callbackUrl = callbackUrl.toString();
    return settings;
};

const getAccessToken = async (settings) => {
    if (tokenCache.value && tokenCache.expiresAt > Date.now()) {
        return tokenCache.value;
    }

    const authorization = Buffer.from(`${settings.consumerKey}:${settings.consumerSecret}`).toString('base64');
    const response = await fetch(
        `${settings.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        {
            headers: { Authorization: `Basic ${authorization}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(15000)
        }
    );
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.access_token) {
        throw new Error(result.error_description || `Safaricom authentication failed (HTTP ${response.status}).`);
    }

    tokenCache.value = result.access_token;
    tokenCache.expiresAt = Date.now() + Math.max(0, (Number(result.expires_in) - 60) * 1000);
    return tokenCache.value;
};

const getNairobiTimestamp = () => {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date()).reduce((result, part) => {
        if (part.type !== 'literal') {
            result[part.type] = part.value;
        }
        return result;
    }, {});

    return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
};

const normalizeKenyanPhone = (value) => {
    const phone = String(value || '').trim().replace(/[\s()-]/g, '');

    if (/^0[17]\d{8}$/.test(phone)) {
        return `254${phone.slice(1)}`;
    }
    if (/^\+254[17]\d{8}$/.test(phone)) {
        return phone.slice(1);
    }
    if (/^254[17]\d{8}$/.test(phone)) {
        return phone;
    }

    return '';
};

/* The Pochi la Biashara number tenants send rent to when they pay manually.
   Money is received on an ordinary phone number rather than a paybill or till.
   This is deliberately separate from the Daraja business shortcode: STK Push
   can only target a business shortcode, so the Pochi la Biashara number is what
   tenants are shown and what the receipt records as "rent paid to". */
const DEFAULT_MPESA_RECEIVING_NUMBER = '0796488109';

const getMpesaReceivingNumber = () => {
    const configured = String(process.env.MPESA_RECEIVING_NUMBER || '').trim();
    const normalized = normalizeKenyanPhone(configured || DEFAULT_MPESA_RECEIVING_NUMBER);

    if (!normalized) {
        return DEFAULT_MPESA_RECEIVING_NUMBER;
    }

    /* Kept in the local 0XXXXXXXXX form tenants actually dial. */
    return `0${normalized.slice(3)}`;
};

const initiateDarajaStkPush = async ({ phoneNumber, amount }) => {
    const settings = getDarajaSettings();
    const normalizedPhone = normalizeKenyanPhone(phoneNumber);

    if (!normalizedPhone) {
        throw new Error('Enter a valid Safaricom phone number, such as 0712345678 or 254712345678.');
    }
    if (!Number.isSafeInteger(amount) || amount < 1) {
        throw new Error('Enter a valid whole-number amount in KSh.');
    }

    const accessToken = await getAccessToken(settings);
    const timestamp = getNairobiTimestamp();
    const password = Buffer.from(`${settings.shortcode}${settings.passkey}${timestamp}`).toString('base64');
    let response;
    try {
        response = await fetch(`${settings.baseUrl}/mpesa/stkpush/v1/processrequest`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(20000),
            body: JSON.stringify({
                BusinessShortCode: settings.shortcode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: 'CustomerPayBillOnline',
                Amount: amount,
                PartyA: normalizedPhone,
                PartyB: settings.shortcode,
                PhoneNumber: normalizedPhone,
                CallBackURL: settings.callbackUrl,
                AccountReference: settings.accountReference,
                TransactionDesc: settings.transactionDescription
            })
        });
    } catch (cause) {
        const error = new Error('Safaricom did not return a response for the STK request.');
        error.outcomeUnknown = true;
        error.cause = cause;
        throw error;
    }

    let result;
    try {
        result = await response.json();
    } catch (cause) {
        if (response.ok || response.status >= 500) {
            const error = new Error('Safaricom returned an unreadable STK response.');
            error.outcomeUnknown = true;
            error.cause = cause;
            throw error;
        }
        result = {};
    }

    if (!response.ok) {
        const error = new Error(result.errorMessage || result.ResponseDescription || `Safaricom rejected the STK Push request (HTTP ${response.status}).`);
        error.outcomeUnknown = response.status >= 500;
        throw error;
    }

    if (result.ResponseCode === undefined || result.ResponseCode === null) {
        const error = new Error('Safaricom returned an incomplete STK response.');
        error.outcomeUnknown = true;
        throw error;
    }

    if (String(result.ResponseCode) !== '0') {
        throw new Error(result.errorMessage || result.ResponseDescription || 'Safaricom rejected the STK Push request.');
    }

    if (!result.CheckoutRequestID || !result.MerchantRequestID) {
        const error = new Error('Safaricom accepted the STK request but returned incomplete request identifiers.');
        error.outcomeUnknown = true;
        throw error;
    }

    return {
        checkoutRequestId: String(result.CheckoutRequestID),
        merchantRequestId: String(result.MerchantRequestID),
        customerMessage: String(result.CustomerMessage || 'Check your phone and enter your M-Pesa PIN.')
    };
};

/* Asks Safaricom how an STK request actually ended, which is the only way to
   settle a payment whose callback never arrived. The password is built the
   same way as for the push itself, from a fresh timestamp. */
const queryDarajaStkStatus = async ({ checkoutRequestId }) => {
    const settings = getDarajaSettings();
    const checkoutId = String(checkoutRequestId || '').trim();

    if (!checkoutId) {
        throw new Error('The payment request has no Safaricom checkout reference to query.');
    }

    const accessToken = await getAccessToken(settings);
    const timestamp = getNairobiTimestamp();
    const password = Buffer.from(`${settings.shortcode}${settings.passkey}${timestamp}`).toString('base64');

    let response;
    try {
        response = await fetch(`${settings.baseUrl}/mpesa/stkpushquery/v1/query`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(20000),
            body: JSON.stringify({
                BusinessShortCode: settings.shortcode,
                Password: password,
                Timestamp: timestamp,
                CheckoutRequestID: checkoutId
            })
        });
    } catch (cause) {
        const error = new Error('Safaricom did not answer the transaction status query.');
        error.cause = cause;
        throw error;
    }

    let result;
    try {
        result = await response.json();
    } catch (cause) {
        const error = new Error('Safaricom returned an unreadable status query response.');
        error.cause = cause;
        throw error;
    }

    /* While the subscriber has not answered the prompt, Safaricom answers
       this query with an HTTP error saying the transaction is still being
       processed. That is a normal "not finished yet", not a payment failure. */
    const description = String(result.errorMessage || result.ResultDesc || '').trim();

    if (!response.ok && /being processed/i.test(description)) {
        return { definitive: false, resultCode: null, resultDescription: 'The transaction is still being processed.' };
    }

    if (!response.ok) {
        throw new Error(result.errorMessage || `Safaricom rejected the status query (HTTP ${response.status}).`);
    }

    if (result.ResponseCode === undefined
        || result.ResultCode === undefined
        || result.ResultCode === null
        || !/^-?\d+$/.test(String(result.ResultCode))) {
        throw new Error('Safaricom returned an incomplete status query response.');
    }

    if (String(result.ResponseCode) !== '0') {
        throw new Error(result.errorMessage || result.ResponseDescription || 'Safaricom rejected the status query.');
    }

    /* ResultCode is the transaction's own outcome: 0 means Safaricom finished
       it successfully, anything else is a final failure with its reason. */
    return {
        definitive: true,
        resultCode: String(result.ResultCode),
        resultDescription: String(result.ResultDesc || '').trim()
    };
};

const isValidDarajaCallbackToken = (receivedToken) => {
    let expectedToken;
    try {
        expectedToken = getDarajaCallbackToken();
    } catch (error) {
        return false;
    }

    const received = Buffer.from(String(receivedToken || ''));
    const expected = Buffer.from(expectedToken);
    return received.length === expected.length && require('node:crypto').timingSafeEqual(received, expected);
};

module.exports = {
    getDarajaSettings,
    initiateDarajaStkPush,
    queryDarajaStkStatus,
    isValidDarajaCallbackToken,
    getDarajaCallbackToken,
    getMpesaReceivingNumber,
    normalizeKenyanPhone
};
