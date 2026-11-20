const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { connectDatabase, loadApplicationData, saveCollection, saveAdminRecord } = require('./database');
const {
    SESSION_COOKIE,
    TENANT_SESSION_COOKIE,
    createAdminStore,
    createAttemptThrottle,
    createSessionStore,
    createPasswordRecord,
    verifyPasswordRecord,
    parseCookies,
    buildSessionCookie,
    buildExpiredSessionCookie,
    getClientKey,
    isPasswordStrongEnough,
    describePasswordRequirement
} = require('./admin-auth');
const {
    getDarajaSettings,
    initiateDarajaStkPush,
    queryDarajaStkStatus,
    isValidDarajaCallbackToken,
    getMpesaReceivingNumber,
    normalizeKenyanPhone
} = require('./mpesa-daraja');

const rootDirectory = __dirname;
const port = Number(process.env.PORT) || 3000;
const maxBodyBytes = 100000;
const properties = [];
const payments = [];
const tenants = [];
const maintenanceRequests = [];
const expenses = [];
const propertyImageDirectory = path.join(rootDirectory, 'uploads', 'properties');
const propertyImageTypes = new Map([
    ['image/jpeg', { extension: '.jpg', signature: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
    ['image/png', { extension: '.png', signature: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
    ['image/webp', { extension: '.webp', signature: (buffer) => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' }],
    ['image/gif', { extension: '.gif', signature: (buffer) => buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6)) }]
]);
const maxPropertyImages = 20;
const maxPropertyImageBytes = 5 * 1024 * 1024;
const propertyImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: maxPropertyImageBytes,
        files: 1,
        fields: 0,
        parts: 1
    }
}).single('image');

const adminSessions = createSessionStore();
const tenantSessions = createSessionStore();
const adminLoginThrottle = createAttemptThrottle();
const tenantLoginThrottle = createAttemptThrottle();
const paymentThrottle = createAttemptThrottle({ maxAttempts: 20, windowMs: 10 * 60 * 1000, lockoutMs: 10 * 60 * 1000 });
/* One Safaricom checkout is settled by either the callback or a status query
   at a time, never both, so the same payment cannot be recorded twice. */
const safaricomCheckoutsInFlight = new Set();
const registrationThrottle = createAttemptThrottle({ maxAttempts: 10, windowMs: 60 * 60 * 1000, lockoutMs: 60 * 60 * 1000 });
const maintenanceThrottle = createAttemptThrottle({ maxAttempts: 12, windowMs: 60 * 60 * 1000, lockoutMs: 60 * 60 * 1000 });
let adminCredentials;
const createAdminCredentials = (record) => createAdminStore(record, {
    persist: saveAdminRecord,
    onCredentialChange: () => adminSessions.destroyAll()
});

const adminOnlyPages = new Set(['/dashboard.html']);
const tenantOnlyPages = new Set(['/tenant-portal.html']);

const isAdminOnlyPage = (pathname) => {
    const normalized = pathname.toLowerCase();

    return adminOnlyPages.has(normalized) || normalized.startsWith('/admin/');
};

const isTenantOnlyPage = (pathname) => tenantOnlyPages.has(pathname.toLowerCase());

const readSessionToken = (request) => parseCookies(request.headers.cookie)[SESSION_COOKIE] || '';

const isAdminAuthenticated = (request) => Boolean(adminSessions.read(readSessionToken(request)));

const readTenantSessionToken = (request) => parseCookies(request.headers.cookie)[TENANT_SESSION_COOKIE] || '';

/* A tenant session only stores the tenant id, so a renamed or deleted record
   cannot leave a session pointing at somebody else's data. */
const getTenantSessionTenantId = (request) => {
    const session = tenantSessions.read(readTenantSessionToken(request));
    return session ? String(session.tenantId || '') : '';
};

const isTenantAuthenticated = (request) => Boolean(getTenantSessionTenantId(request));

const isSameOriginRequest = (request) => {
    const origin = String(request.headers.origin || '');

    if (!origin) {
        return true;
    }

    try {
        return new URL(origin).host === (request.headers.host || 'localhost');
    } catch (error) {
        return false;
    }
};

const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'"
].join('; ');

const buildSecurityHeaders = ({ noStore = false } = {}) => ({
    'Content-Security-Policy': contentSecurityPolicy,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Cache-Control': noStore ? 'no-store' : 'no-cache'
});

/* Every response, static or JSON, carries the same hardening headers, so they
   are set once here instead of being repeated at each response site. */
const applySecurityHeaders = (request, response, next) => {
    response.set(buildSecurityHeaders());
    response.set('Vary', 'Cookie');
    next();
};

const sendJson = (response, statusCode, payload, extraHeaders = {}) => {
    response.set(extraHeaders);
    response.set('Cache-Control', 'no-store');
    response.status(statusCode).json(payload);
};

/* Query values arrive as an array when a parameter is repeated, and the old
   URL-based router only ever read the first one. */
const queryValue = (value) => (Array.isArray(value) ? value[0] : value) || '';

const paymentMethods = new Set(['M-Pesa STK Push', 'Pochi la Biashara', 'Mobile Money', 'Bank Transfer', 'Card', 'Cash']);
const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

/* A payment record only counts once money has actually been received, so
   tenants who have not paid are never listed in the payment records. */
const hasRecordedPayment = (payment) => Number(payment?.paidAmount) > 0 && Boolean(payment?.paidOn);

const getPeriodDetails = (periodKey) => {
    const match = String(periodKey || '').match(/^(\d{4})-(\d{2})$/);
    const now = new Date();
    const year = match ? Number(match[1]) : now.getUTCFullYear();
    const month = match ? Number(match[2]) : now.getUTCMonth() + 1;
    const safePeriodKey = `${year}-${String(month).padStart(2, '0')}`;

    return {
        periodKey: safePeriodKey,
        period: `${monthNames[month - 1] || 'Current'} ${year}`
    };
};

const persistPayments = () => {
    return saveCollection('payments', payments);
};

const reconcileInterruptedMpesaRequests = async () => {
    const interruptedRequests = payments.filter((payment) => (
        payment.method === 'M-Pesa STK Push' && payment.stkStatus === 'initiating'
    ));

    if (interruptedRequests.length === 0) {
        return;
    }

    const updatedAt = new Date().toISOString();
    interruptedRequests.forEach((payment) => {
        payment.status = 'STK Push outcome needs reconciliation';
        payment.stkStatus = 'reconciliation_required';
        payment.paymentRequestStatus = 'callback_review';
        payment.failureReason = 'The server restarted before Safaricom returned a definitive result. Use "Check with Safaricom" on this request before retrying.';
        payment.updatedAt = updatedAt;
    });

    await persistPayments();
    console.warn(`Moved ${interruptedRequests.length} interrupted Safaricom STK request(s) to reconciliation review.`);
};

const persistProperties = () => {
    return saveCollection('properties', properties);
};

const persistTenants = () => {
    return saveCollection('tenants', tenants);
};

const persistMaintenanceRequests = () => {
    return saveCollection('maintenance', maintenanceRequests);
};

const persistExpenses = () => {
    return saveCollection('expenses', expenses);
};

const tenantStatuses = new Set(['Active', 'Inactive']);
const normaliseEmail = (value) => String(value || '').trim().toLowerCase();
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const findTenant = (tenantId) => tenants.find((tenant) => tenant.id === tenantId) || null;
const findTenantByEmail = (email) => tenants.find((tenant) => normaliseEmail(tenant.email) === normaliseEmail(email)) || null;

/* Every payment is kept as its own record, so one rent period can hold several
   of them. This key is what ties those separate payments back to the single
   rent they are paying towards. It is built from the tenant id, so a tenant who
   changes their email or moves to another unit still owes one rent a month and
   the payments they already made stay against it. */
const rentPeriodKeyOf = (payment) => {
    const tenantId = String(payment?.tenantId || '').trim();

    if (tenantId) {
        return `${tenantId}|${String(payment?.monthKey || payment?.period || '')}`;
    }

    /* A payment that belongs to no tenant, and so was made under details that
       may since have changed, is still gathered by who and where it was made. */
    return [
        'unlinked',
        normaliseEmail(payment?.tenantEmail),
        String(payment?.propertyId || ''),
        String(payment?.unit || '').trim().toLowerCase(),
        String(payment?.monthKey || payment?.period || '')
    ].join('|');
};

/* The rent for a period is owed once in total, however many payments were
   recorded against it, so balances are worked out over the whole group. */
const totalPaidForRentPeriod = (paymentList, period) => paymentList
    .filter(hasRecordedPayment)
    .filter((payment) => rentPeriodKeyOf(payment) === rentPeriodKeyOf(period))
    .reduce((total, payment) => total + (Number(payment.paidAmount) || 0), 0);

const rentPeriodOutstanding = (paymentList, period) => Math.max(0, Number(period?.amount || 0) - totalPaidForRentPeriod(paymentList, period));

/* Money that has been requested but not confirmed yet still reserves part of
   a rent period. An unanswered STK Push and a Pochi payment waiting for the
   landlord's verification are both "paid" from the payer's point of view, so
   neither may be paid twice. Confirming one replaces the reservation with a
   real payment record; rejecting one releases it. */
const stkPendingStatuses = [
    'initiating', 'pending', 'processing', 'finalization_pending', 'callback_review', 'reconciliation_required'
];
const pochiPendingStatuses = ['pending', 'callback_review'];
const isReservedRentPayment = (payment) => (
    (payment?.method === 'M-Pesa STK Push' && stkPendingStatuses.includes(payment.stkStatus))
    || (payment?.method === 'Pochi la Biashara' && pochiPendingStatuses.includes(payment.paymentRequestStatus))
);
const reservedRentForPeriod = (paymentList, period, method = '') => paymentList
    .filter((payment) => isReservedRentPayment(payment)
        && (!method || payment.method === method)
        && rentPeriodKeyOf(payment) === rentPeriodKeyOf(period))
    .reduce((total, payment) => total + (Number(payment.requestedAmount) || 0), 0);

/* Sums what is still owed, counting each rent period once no matter how many
   part payments it holds. */
const summariseOutstanding = (paymentList) => {
    const countedPeriods = new Set();

    return paymentList.reduce((total, payment) => {
        const key = rentPeriodKeyOf(payment);

        if (countedPeriods.has(key)) {
            return total;
        }

        countedPeriods.add(key);
        return total + rentPeriodOutstanding(paymentList, payment);
    }, 0);
};

/* A tenant's payment history is matched on their id, so a tenant who changes
   their email address or moves to another unit keeps every payment they have
   ever made and the balance that came with it. */
const paymentBelongsToTenant = (payment, tenant) => {
    const paymentTenantId = String(payment?.tenantId || '').trim();

    if (paymentTenantId) {
        return paymentTenantId === tenant.id;
    }

    /* Money recorded before payments were linked to a tenant, or recorded for
       somebody who is not on the list yet, is matched on the email it was made
       with so it is not lost off the account. */
    return normaliseEmail(payment?.tenantEmail) === normaliseEmail(tenant.email);
};

const getTenantPayments = (tenant) => payments
    .filter(hasRecordedPayment)
    .filter((payment) => paymentBelongsToTenant(payment, tenant));

const summariseTenant = (tenant) => {
    const tenantPayments = getTenantPayments(tenant);
    const totalPaid = tenantPayments.reduce((total, payment) => total + (Number(payment.paidAmount) || 0), 0);
    const outstanding = summariseOutstanding(tenantPayments);
    const lastPaymentOn = tenantPayments.reduce((latest, payment) => {
        if (!payment.paidOn) {
            return latest;
        }

        return !latest || payment.paidOn > latest ? payment.paidOn : latest;
    }, '');
    /* The stored password record must never leave the server, so it is
       replaced with a simple yes/no flag. */
    const { password, ...safeTenant } = tenant;

    return {
        ...safeTenant,
        monthlyRent: Math.max(0, Number(tenant.monthlyRent) || 0),
        hasPassword: Boolean(password?.passwordHash),
        paymentCount: tenantPayments.length,
        totalPaid,
        outstanding,
        hasPaid: tenantPayments.length > 0,
        lastPaymentOn: lastPaymentOn || null
    };
};

const buildTenantFromPayload = (payload, existing = null, { defaultPropertyId = '' } = {}) => {
    const pick = (key, fallback = '') => (payload[key] === undefined ? fallback : String(payload[key] || '').trim());
    const requestedPropertyId = pick('propertyId', existing?.propertyId);
    const propertyId = requestedPropertyId || defaultPropertyId;
    const property = properties.find((item) => item.id === propertyId);
    const rentWasProvided = payload.monthlyRent !== undefined && String(payload.monthlyRent).trim() !== '';
    const monthlyRent = rentWasProvided
        ? Math.round(Number(payload.monthlyRent))
        : existing
            ? Math.max(0, Number(existing.monthlyRent) || 0)
            : Math.round(Number(property?.monthlyRent) || 0);

    return {
        fullName: pick('fullName', existing?.fullName),
        email: normaliseEmail(pick('email', existing?.email)),
        phone: pick('phone', existing?.phone),
        propertyId,
        propertyName: property?.name || existing?.propertyName || '',
        location: property?.location || existing?.location || '',
        unit: pick('unit', existing?.unit),
        monthlyRent,
        status: pick('status', existing?.status || 'Active'),
        notes: pick('notes', existing?.notes).slice(0, 500)
    };
};

const describeTenantProblem = (candidate) => {
    if (candidate.fullName.length < 2 || candidate.fullName.length > 100) {
        return 'Enter the tenant\'s full name.';
    }

    if (!isValidEmail(candidate.email)) {
        return 'Enter a valid email address for the tenant.';
    }

    if (candidate.phone && !/^[+\d][\d\s()-]{7,}$/.test(candidate.phone)) {
        return 'Enter a valid phone number.';
    }

    if (!properties.some((item) => item.id === candidate.propertyId)) {
        return 'Choose the property this tenant is in.';
    }

    if (candidate.unit.length > 30) {
        return 'The unit or house number is too long.';
    }

    if (!tenantStatuses.has(candidate.status)) {
        return 'Choose a valid tenant status.';
    }

    if (!Number.isFinite(candidate.monthlyRent) || candidate.monthlyRent < 0) {
        return 'Enter the monthly rent for this tenant.';
    }

    return null;
};

const describeTenantEmailConflict = (email, ignoreTenantId = '') => {
    const existing = findTenantByEmail(email);

    if (!existing || existing.id === ignoreTenantId) {
        return '';
    }

    return 'Another tenant already uses that email address.';
};

/* The tenant a payment belongs to. A payment made from inside the portal names
   its tenant by id, while one from the public payment page only has the email
   the payer typed, so the email is the fallback rather than the link. */
const findTenantForPayment = (payment) => {
    const requestedTenantId = String(payment?.tenantId || '').trim();
    const byId = requestedTenantId ? findTenant(requestedTenantId) : null;

    return byId || findTenantByEmail(payment?.tenantEmail) || null;
};

/* Somebody paying for the first time is added to the tenant list at that moment,
   so their rent period can be keyed on the id they keep from here on rather than
   on details they are free to change later. */
const createTenantFromPayment = (payment) => {
    const now = new Date().toISOString();
    const tenant = {
        id: `ten-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        fullName: payment.tenantName,
        email: normaliseEmail(payment.tenantEmail),
        phone: payment.tenantPhone || '',
        propertyId: payment.propertyId,
        propertyName: payment.propertyName,
        location: payment.location,
        unit: payment.unit,
        monthlyRent: Math.round(Number(payment.amount) || 0),
        status: 'Active',
        notes: '',
        source: 'payment',
        createdAt: now,
        updatedAt: now
    };

    tenants.push(tenant);

    return tenant;
};

/* Takes over any payment that was never linked to a tenant, so an account
   opening today still picks up the money already recorded under its email.
   Returns the payments it took over so they can be let go again if the payment
   that triggered this cannot be saved. */
const adoptUnlinkedPayments = (tenant) => {
    const adopted = payments.filter((payment) => !String(payment.tenantId || '').trim())
        .filter((payment) => normaliseEmail(payment.tenantEmail) === normaliseEmail(tenant.email));

    adopted.forEach((payment) => {
        payment.tenantId = tenant.id;
    });

    return adopted;
};

/* Keeps the tenant file in step with money that actually arrived, so tenant
   management stays complete without the landlord entering anything twice. */
const syncTenantFromPayment = (payment, tenant) => {
    const now = new Date().toISOString();
    const detailsChanged = tenant.propertyId !== payment.propertyId
        || String(tenant.unit || '') !== String(payment.unit || '')
        || !tenant.phone;

    tenant.propertyId = payment.propertyId;
    tenant.propertyName = payment.propertyName;
    tenant.location = payment.location;
    tenant.unit = payment.unit;
    tenant.phone = tenant.phone || payment.tenantPhone || '';

    if (!tenant.monthlyRent) {
        tenant.monthlyRent = Math.round(Number(payment.amount) || 0);
    }

    if (detailsChanged) {
        tenant.updatedAt = now;
    }
};

/* Payments used to be tied to a tenant by their email address and unit, which
   lost track of a tenant's history the moment either changed. Records written
   before that link existed are joined to a tenant here, once, using the details
   they were made with, so the balances already on file carry over intact. */
const linkPaymentsToTenants = async () => {
    const linked = [];
    const unmatched = [];

    payments.forEach((payment) => {
        const existingTenantId = String(payment.tenantId || '').trim();

        if (existingTenantId && findTenant(existingTenantId)) {
            return;
        }

        const email = normaliseEmail(payment.tenantEmail);
        const fullName = String(payment.tenantName || '').trim().toLowerCase();
        const unit = String(payment.unit || '').trim().toLowerCase();
        /* The email is how a payer is recognised. A name that matches the same
           home catches a payment whose email was later corrected on the file. */
        const tenant = tenants.find((tenant) => Boolean(email) && normaliseEmail(tenant.email) === email)
            || tenants.find((tenant) => String(tenant.fullName || '').trim().toLowerCase() === fullName
                && tenant.propertyId === payment.propertyId
                && String(tenant.unit || '').trim().toLowerCase() === unit);

        if (!tenant) {
            unmatched.push(payment.id);
            return;
        }

        payment.tenantId = tenant.id;
        linked.push(payment.id);
    });

    if (linked.length) {
        try {
            await persistPayments();
            console.log(`Linked ${linked.length} payment(s) to the tenant they belong to.`);
        } catch (error) {
            console.error(`Payments could not be linked to their tenant: ${error.message}`);
        }
    }

    if (unmatched.length) {
        console.log(`${unmatched.length} payment(s) do not match any tenant and are still held by the details they were made with.`);
    }

    return { linked: linked.length, unmatched: unmatched.length };
};

const requireAdminSession = (request, response, next) => {
    if (!isAdminAuthenticated(request)) {
        sendJson(response, 401, { error: 'Admin authentication is required to manage this workspace.' });
        return;
    }

    next();
};

const requireTenantSession = (request, response, next) => {
    const tenantId = getTenantSessionTenantId(request);

    if (!tenantId || !findTenant(tenantId)) {
        sendJson(response, 401, { error: 'Please sign in to your EstatePro tenant account to continue.' });
        return;
    }

    request.tenantId = tenantId;
    next();
};

const handleAdminSessionStatus = (request, response) => {
    const clientKey = getClientKey(request);
    const throttle = adminLoginThrottle.check(clientKey);
    const authenticated = isAdminAuthenticated(request);

    sendJson(response, 200, {
        configured: adminCredentials.isConfigured(),
        authenticated,
        sessionExpiresInSeconds: authenticated
            ? Math.max(0, Math.floor((adminSessions.read(readSessionToken(request))?.expiresAt - Date.now()) / 1000))
            : 0,
        passwordPolicy: describePasswordRequirement(),
        locked: throttle.locked,
        retryAfterSeconds: throttle.retryAfterSeconds,
        attemptsRemaining: throttle.remaining
    });
};

const handleAdminSignIn = async (request, response) => {
    const clientKey = getClientKey(request);
    const throttle = adminLoginThrottle.check(clientKey);

    if (throttle.locked) {
        sendJson(response, 429, {
            error: `Too many failed attempts. Try again in ${Math.ceil(throttle.retryAfterSeconds / 60)} minute(s).`,
            retryAfterSeconds: throttle.retryAfterSeconds
        });
        return;
    }

    if (!adminCredentials.isConfigured()) {
        sendJson(response, 409, { error: 'No admin password is set yet. Create one to secure the dashboard.' });
        return;
    }

    const password = String(request.body.password || '');
    const verified = await adminCredentials.verify(password);

    if (!verified) {
        adminLoginThrottle.fail(clientKey);
        const remaining = Math.max(0, adminLoginThrottle.check(clientKey).remaining);

        sendJson(response, 401, {
            error: 'That admin password is incorrect.',
            attemptsRemaining: remaining
        });
        return;
    }

    adminLoginThrottle.reset(clientKey);
    const token = adminSessions.create();

    sendJson(response, 200, {
        message: 'Admin access granted.',
        expiresInSeconds: Math.floor((adminSessions.read(token).expiresAt - Date.now()) / 1000)
    }, {
        'Set-Cookie': buildSessionCookie(token)
    });
};

const handleAdminSignOut = (request, response) => {
    adminSessions.destroy(readSessionToken(request));
    sendJson(response, 200, { message: 'Admin session closed.' }, {
        'Set-Cookie': buildExpiredSessionCookie()
    });
};

const handleAdminSetup = async (request, response) => {
    const clientKey = getClientKey(request);
    const throttle = adminLoginThrottle.check(clientKey);

    if (throttle.locked) {
        sendJson(response, 429, { error: 'Too many failed attempts. Try again later.', retryAfterSeconds: throttle.retryAfterSeconds });
        return;
    }

    if (adminCredentials.isConfigured()) {
        sendJson(response, 409, { error: 'An admin password already exists. Sign in and change it instead.' });
        return;
    }

    const password = String(request.body.password || '');

    if (password !== String(request.body.confirmPassword || '')) {
        sendJson(response, 400, { error: 'The two passwords do not match.' });
        return;
    }

    if (!isPasswordStrongEnough(password)) {
        sendJson(response, 400, { error: describePasswordRequirement() });
        return;
    }

    await adminCredentials.write(password);
    adminLoginThrottle.reset(clientKey);
    const token = adminSessions.create();

    sendJson(response, 201, { message: 'Admin password created. You now have dashboard access.' }, {
        'Set-Cookie': buildSessionCookie(token)
    });
};

const handleAdminPasswordChange = async (request, response) => {
    const clientKey = getClientKey(request);

    if (!isAdminAuthenticated(request)) {
        sendJson(response, 401, { error: 'Sign in with the admin password to change it.' });
        return;
    }

    const throttle = adminLoginThrottle.check(clientKey);

    if (throttle.locked) {
        sendJson(response, 429, { error: 'Too many failed attempts. Try again later.', retryAfterSeconds: throttle.retryAfterSeconds });
        return;
    }

    const currentPassword = String(request.body.currentPassword || '');
    const newPassword = String(request.body.newPassword || '');

    if (newPassword !== String(request.body.confirmPassword || '')) {
        sendJson(response, 400, { error: 'The two new passwords do not match.' });
        return;
    }

    if (!isPasswordStrongEnough(newPassword)) {
        sendJson(response, 400, { error: describePasswordRequirement() });
        return;
    }

    const verified = await adminCredentials.verify(currentPassword);

    if (!verified) {
        adminLoginThrottle.fail(clientKey);
        sendJson(response, 401, { error: 'The current admin password is incorrect.' });
        return;
    }

    adminLoginThrottle.reset(clientKey);
    await adminCredentials.write(newPassword);
    const token = adminSessions.create();

    sendJson(response, 200, { message: 'Admin password updated. Other sessions were signed out.' }, {
        'Set-Cookie': buildSessionCookie(token)
    });
};

const createMpesaPaymentRequest = async (input) => {
    const tenantName = String(input.tenantName || '').trim();
    const tenantEmail = normaliseEmail(input.tenantEmail);
    const tenantPhone = String(input.tenantPhone || '').trim();
    const phoneNumber = normalizeKenyanPhone(input.phoneNumber || tenantPhone);
    const propertyId = String(input.propertyId || '').trim();
    const unit = String(input.unit || '').trim();
    const requestedAmount = Number(input.paidAmount);

    if (tenantName.length < 2 || tenantName.length > 100) {
        return { code: 400, body: { error: 'Enter the tenant\'s full name.' } };
    }

    if (!isValidEmail(tenantEmail)) {
        return { code: 400, body: { error: 'Enter a valid tenant email address.' } };
    }

    const property = properties.find((item) => item.id === propertyId);
    if (!property) {
        return { code: 404, body: { error: 'Choose a valid property.' } };
    }

    if (!phoneNumber) {
        return { code: 400, body: { error: 'Enter a valid Safaricom number to receive the STK Push.' } };
    }

    if (!unit || unit.length > 30) {
        return { code: 400, body: { error: 'Enter the unit or house number.' } };
    }

    const knownTenant = findTenantForPayment({ tenantId: input.tenantId, tenantEmail });
    const agreedRent = Number(input.rent);
    const rentForPeriod = Number.isFinite(agreedRent) && agreedRent > 0
        ? Math.round(agreedRent)
        : Math.round(Number(knownTenant?.monthlyRent || property.monthlyRent));

    if (!Number.isSafeInteger(requestedAmount) || requestedAmount <= 0 || requestedAmount > rentForPeriod) {
        return { code: 400, body: { error: `Enter an amount up to KSh ${rentForPeriod.toLocaleString('en-KE')}.` } };
    }

    const requestedPeriodKey = String(input.periodKey || '').trim();
    if (requestedPeriodKey && !/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPeriodKey)) {
        return { code: 400, body: { error: 'Choose a valid rent period.' } };
    }

    const { periodKey, period } = getPeriodDetails(requestedPeriodKey);
    const rentPeriod = {
        tenantId: knownTenant?.id || '',
        tenantEmail,
        propertyId: property.id,
        unit,
        monthKey: periodKey
    };
    const reservedAmount = reservedRentForPeriod(payments, rentPeriod);
    const outstanding = Math.max(0, rentForPeriod - totalPaidForRentPeriod(payments, rentPeriod) - reservedAmount);

    if (outstanding <= 0) {
        return { code: 409, body: { error: 'This rent period has already been paid in full.' } };
    }

    if (requestedAmount > outstanding) {
        return { code: 400, body: { error: `The outstanding balance is KSh ${outstanding.toLocaleString('en-KE')}.` } };
    }

    let darajaSettings;
    try {
        darajaSettings = getDarajaSettings();
    } catch (error) {
        return { code: 503, body: { error: error.message } };
    }

    const paymentRequest = {
        id: `preq-${crypto.randomBytes(24).toString('hex')}`,
        tenantId: knownTenant?.id || '',
        tenantName,
        tenantEmail,
        tenantPhone: tenantPhone || null,
        payerPhone: phoneNumber,
        propertyId: property.id,
        propertyName: property.name,
        location: property.location,
        unit,
        period,
        monthKey: periodKey,
        dueDate: `${periodKey}-05`,
        amount: rentForPeriod,
        paidAmount: 0,
        requestedAmount,
        businessShortCode: darajaSettings.shortcode,
        method: 'M-Pesa STK Push',
        status: 'STK Push initiating',
        paymentRequestStatus: 'stk_pending',
        stkStatus: 'initiating',
        reference: '',
        source: input.source || 'payment-page',
        createdAt: new Date().toISOString()
    };

    payments.push(paymentRequest);
    try {
        await persistPayments();
    } catch (error) {
        payments.pop();
        return { code: 500, body: { error: 'Your payment request could not be saved. Please try again.' } };
    }

    let stkResponse;
    try {
        stkResponse = await initiateDarajaStkPush({
            phoneNumber,
            amount: requestedAmount
        });
    } catch (error) {
        if (error.outcomeUnknown) {
            paymentRequest.status = 'STK Push outcome needs reconciliation';
            paymentRequest.stkStatus = 'reconciliation_required';
            paymentRequest.paymentRequestStatus = 'callback_review';
            paymentRequest.failureReason = 'Safaricom did not return a definitive result. Use "Check with Safaricom" on this request before retrying.';
            paymentRequest.updatedAt = new Date().toISOString();
            try {
                await persistPayments();
            } catch (persistError) {
                console.error(`Uncertain STK request ${paymentRequest.id} could not be updated: ${persistError.message}`);
                return {
                    code: 500,
                    body: { error: 'Safaricom may have received this STK request, but its status could not be saved. Do not retry; contact the landlord.' }
                };
            }

            return {
                code: 202,
                body: {
                    message: 'Safaricom did not return a clear result. Check your phone and contact your landlord before trying again.',
                    request: {
                        id: paymentRequest.id,
                        requestedAmount: paymentRequest.requestedAmount,
                        phoneNumber: paymentRequest.payerPhone,
                        status: paymentRequest.stkStatus
                    },
                    businessShortCode: paymentRequest.businessShortCode,
                    receivingNumber: getMpesaReceivingNumber()
                }
            };
        }

        paymentRequest.status = 'STK Push failed';
        paymentRequest.stkStatus = 'failed';
        paymentRequest.paymentRequestStatus = 'failed';
        paymentRequest.failureReason = error.message;
        paymentRequest.updatedAt = new Date().toISOString();
        try {
            await persistPayments();
        } catch (persistError) {
            console.error(`Failed STK request ${paymentRequest.id} could not be persisted: ${persistError.message}`);
        }
        return { code: 502, body: { error: error.message || 'Safaricom could not start the STK Push.' } };
    }

    paymentRequest.checkoutRequestId = stkResponse.checkoutRequestId;
    paymentRequest.merchantRequestId = stkResponse.merchantRequestId;
    paymentRequest.status = 'STK Push sent';
    paymentRequest.stkStatus = 'pending';
    paymentRequest.customerMessage = stkResponse.customerMessage;
    paymentRequest.updatedAt = new Date().toISOString();
    try {
        await persistPayments();
    } catch (error) {
        paymentRequest.status = 'STK Push sent; status storage failed';
        paymentRequest.stkStatus = 'reconciliation_required';
        paymentRequest.paymentRequestStatus = 'callback_review';
        paymentRequest.failureReason = 'The STK request was accepted, but its provider identifiers could not be saved.';
        console.error(`Accepted STK request ${paymentRequest.id} could not be updated: ${error.message}`);
        return {
            code: 500,
            body: { error: 'The STK prompt may have been sent, but its status could not be saved. Do not retry the payment; contact the landlord.' }
        };
    }

    return {
        code: 201,
        body: {
            message: 'An M-Pesa prompt was sent to your phone. Your rent will be recorded after Safaricom confirms the payment.',
            request: {
                id: paymentRequest.id,
                requestedAmount: paymentRequest.requestedAmount,
                phoneNumber: paymentRequest.payerPhone,
                status: paymentRequest.stkStatus
            },
            businessShortCode: paymentRequest.businessShortCode,
            receivingNumber: getMpesaReceivingNumber(),
            customerMessage: paymentRequest.customerMessage
        }
    };
};

/* One place where received money becomes a payment record, used after a Pochi
   request is verified or when the landlord records another payment method. */
const recordPayment = async (input) => {
    const tenantName = String(input.tenantName || '').trim();
    const tenantEmail = normaliseEmail(input.tenantEmail);
    const tenantPhone = String(input.tenantPhone || '').trim();
    const propertyId = String(input.propertyId || '').trim();
    const unit = String(input.unit || '').trim();
    const method = String(input.method || '').trim();
    const paidAmount = Math.round(Number(input.paidAmount));

    if (tenantName.length < 2 || tenantName.length > 100) {
        return { code: 400, body: { error: 'Enter the tenant\'s full name.' } };
    }

    if (!isValidEmail(tenantEmail)) {
        return { code: 400, body: { error: 'Enter a valid tenant email address.' } };
    }

    const property = properties.find((item) => item.id === propertyId);

    if (!property) {
        return { code: 404, body: { error: 'Choose a valid property.' } };
    }

    if (!unit || unit.length > 30) {
        return { code: 400, body: { error: 'Enter the unit or house number.' } };
    }

    if (!paymentMethods.has(method)) {
        return { code: 400, body: { error: 'Choose a valid payment method.' } };
    }

    /* A tenant's own agreed rent can differ from the rent advertised for the
       property, so the tenant's figure is used when we know it. Validating
       against the property alone rejected a tenant paying exactly what the
       landlord had agreed with them. */
    const agreedRent = Number(input.rent);
    const rentForPeriod = Number.isFinite(agreedRent) && agreedRent > 0 ? Math.round(agreedRent) : Number(property.monthlyRent);

    if (!Number.isFinite(paidAmount) || paidAmount <= 0 || paidAmount > rentForPeriod) {
        return { code: 400, body: { error: `Enter an amount up to KSh ${rentForPeriod.toLocaleString('en-KE')}.` } };
    }

    const requestedPeriodKey = String(input.periodKey || '').trim();

    if (requestedPeriodKey && !/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPeriodKey)) {
        return { code: 400, body: { error: 'Choose a valid rent period.' } };
    }

    const { periodKey, period } = getPeriodDetails(requestedPeriodKey);
    const paidOn = new Date().toISOString().slice(0, 10);
    const reference = String(input.reference || `EP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`).trim();
    /* Both Safaricom-fed paths guard against the same transaction being
       recorded twice: the callback arrives with Safaricom's receipt, the
       status query settles under the checkout reference it asked about. */
    const previousPayment = ['mpesa-stk-callback', 'mpesa-stk-query'].includes(input.source)
        ? payments.find((payment) => (
            hasRecordedPayment(payment)
            && payment.method === 'M-Pesa STK Push'
            && payment.reference === reference
        ))
        : null;
    if (previousPayment) {
        return {
            code: 200,
            body: {
                message: 'This Safaricom transaction has already been recorded.',
                payment: previousPayment,
                periodOutstanding: rentPeriodOutstanding(payments, previousPayment)
            }
        };
    }

    const receiptNumber = `EP-${periodKey.replace('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    /* Each payment is stored as its own record, so nothing already in the
       ledger is rewritten. Money already received for this same rent period
       still counts towards it, which is what leaves a balance to pay. The
       period is looked up by the tenant it belongs to, so paying on for a
       tenant who has since changed email or unit lands on the same rent. */
    const knownTenant = findTenantForPayment({ tenantId: input.tenantId, tenantEmail });
    const rentPeriod = {
        tenantId: knownTenant?.id || '',
        tenantEmail,
        propertyId: property.id,
        unit,
        monthKey: periodKey
    };
    const alreadyPaid = totalPaidForRentPeriod(payments, rentPeriod);
    const outstanding = Math.max(0, rentForPeriod - alreadyPaid);

    if (outstanding <= 0) {
        return { code: 409, body: { error: 'This rent period has already been paid in full.' } };
    }

    if (paidAmount > outstanding) {
        return { code: 400, body: { error: `The outstanding balance is KSh ${outstanding.toLocaleString('en-KE')}.` } };
    }

    const payment = {
        id: `pay-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        /* Filled in below, once it is known which tenant the money joins. */
        tenantId: knownTenant?.id || '',
        tenantName,
        tenantEmail,
        tenantPhone: tenantPhone || null,
        payerPhone: String(input.payerPhone || input.phoneNumber || tenantPhone || '').trim() || null,
        propertyId: property.id,
        propertyName: property.name,
        location: property.location,
        unit,
        period,
        monthKey: periodKey,
        dueDate: `${periodKey}-05`,
        paidOn,
        amount: rentForPeriod,
        paidAmount,
        method,
        /* Whether this payment left the rent for the period settled, so a part
           payment that still owes something is never shown as complete. */
        status: (alreadyPaid + paidAmount) >= rentForPeriod ? 'Paid' : 'Partial',
        reference,
        receiptNumber,
        source: input.source || 'tenant-portal',
        createdAt: new Date().toISOString()
    };

    /* A payer who is not on the tenant list yet is added here, and the payment
       is written down against the id they will keep from now on. */
    const isNewTenant = !knownTenant;
    const tenant = knownTenant || createTenantFromPayment(payment);
    const adopted = isNewTenant ? adoptUnlinkedPayments(tenant) : [];

    payment.tenantId = tenant.id;
    payments.push(payment);

    try {
        await persistPayments();
    } catch (error) {
        payments.pop();
        adopted.forEach((adoptedPayment) => {
            delete adoptedPayment.tenantId;
        });

        if (isNewTenant) {
            tenants.pop();
        }

        return { code: 500, body: { error: 'The payment could not be saved. Please try again.' } };
    }

    if (!isNewTenant) {
        syncTenantFromPayment(payment, tenant);
    }

    try {
        await persistTenants();
    } catch (error) {
        // The payment is safely stored; the tenant file is rebuilt on the next add.
        console.error(`Tenant file could not be written: ${error.message}`);
    }

    return {
        code: 201,
        body: {
            message: 'Payment recorded successfully.',
            payment,
            tenant,
            /* What is still owed for the whole rent period, so a receipt can
               show the balance rather than just this one payment. */
            periodOutstanding: Math.max(0, rentForPeriod - (alreadyPaid + paidAmount))
        }
    };
};

const handlePaymentSubmission = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin payment submissions are not allowed.' });
        return;
    }

    const throttle = paymentThrottle.check(getClientKey(request));

    if (throttle.locked) {
        sendJson(response, 429, { error: 'Too many payment submissions. Please try again later.' });
        return;
    }

    const result = await createMpesaPaymentRequest({
        tenantName: request.body.tenantName,
        tenantEmail: request.body.tenantEmail,
        tenantPhone: request.body.tenantPhone,
        /* Only a signed-in tenant's own session names who is paying. The form
           itself is public, so an id typed into it is never trusted, and the
           email falls back to finding the same tenant. */
        tenantId: getTenantSessionTenantId(request),
        propertyId: request.body.propertyId,
        unit: request.body.unit,
        periodKey: request.body.periodKey,
        paidAmount: request.body.amount,
        phoneNumber: request.body.phoneNumber,
        source: 'payment-page'
    });

    paymentThrottle.fail(getClientKey(request));

    if (result.code >= 400) {
        sendJson(response, result.code, result.body);
        return;
    }

    sendJson(response, result.code, result.body);
};

/* Public version of the Pochi claim, for the pay-rent page. Somebody who has
   already sent part of the rent to the Pochi la Biashara number records the
   M-Pesa code here so the landlord can verify it. No tenant session is needed,
   so no tenant id typed into the public form is trusted — the email is the
   only link to an existing tenancy. */
const handlePublicPochiClaim = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin payment submissions are not allowed.' });
        return;
    }

    const throttle = paymentThrottle.check(getClientKey(request));

    if (throttle.locked) {
        sendJson(response, 429, { error: 'Too many payment submissions. Please try again later.' });
        return;
    }

    const tenantName = String(request.body.tenantName || '').trim();
    const tenantEmail = normaliseEmail(request.body.tenantEmail);
    const tenantPhone = String(request.body.tenantPhone || '').trim();
    const propertyId = String(request.body.propertyId || '').trim();
    const unit = String(request.body.unit || '').trim();
    const amount = Math.round(Number(request.body.amount));
    const reference = String(request.body.reference || '').trim().toUpperCase();
    const payerPhone = normalizeKenyanPhone(request.body.phoneNumber);

    if (tenantName.length < 2 || tenantName.length > 100) {
        sendJson(response, 400, { error: 'Enter the full name on the tenancy.' });
        return;
    }

    if (!isValidEmail(tenantEmail)) {
        sendJson(response, 400, { error: 'Enter a valid email address.' });
        return;
    }

    const property = properties.find((item) => item.id === propertyId);

    if (!property) {
        sendJson(response, 404, { error: 'Choose a valid property.' });
        return;
    }

    if (!unit || unit.length > 30) {
        sendJson(response, 400, { error: 'Enter the unit or house number.' });
        return;
    }

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(request.body.periodKey || '').trim())) {
        sendJson(response, 400, { error: 'Choose the rent period you paid for.' });
        return;
    }

    if (!Number.isSafeInteger(amount) || amount <= 0) {
        sendJson(response, 400, { error: 'Enter the amount you sent.' });
        return;
    }

    if (!/^[A-Z0-9]{4,20}$/.test(reference)) {
        sendJson(response, 400, { error: 'Enter the M-Pesa confirmation code, such as SJL4K9ZQ2M.' });
        return;
    }

    if (!payerPhone) {
        sendJson(response, 400, { error: 'Enter the Safaricom number you sent the money from.' });
        return;
    }

    const knownTenant = findTenantForPayment({ tenantEmail });
    const { periodKey, period } = getPeriodDetails(String(request.body.periodKey).trim());
    const rentForPeriod = Math.round(Number(knownTenant?.monthlyRent) || Number(property.monthlyRent) || 0);
    const rentPeriod = {
        tenantId: knownTenant?.id || '',
        tenantEmail,
        propertyId: property.id,
        unit,
        monthKey: periodKey
    };
    const reserved = reservedRentForPeriod(payments, rentPeriod);
    const outstanding = Math.max(0, rentForPeriod
        - totalPaidForRentPeriod(payments, rentPeriod) - reserved);

    if (outstanding <= 0) {
        sendJson(response, 409, {
            error: reserved > 0
                ? 'This rent period is already paid or has a payment waiting for verification. Do not pay twice.'
                : 'This rent period has already been paid in full.'
        });
        return;
    }

    if (amount > outstanding) {
        sendJson(response, 400, { error: `The balance you can still pay is KSh ${outstanding.toLocaleString('en-KE')}.` });
        return;
    }

    /* The same M-Pesa code must not be claimed twice, whether it is still
       waiting for verification or has already been recorded against rent. */
    const duplicate = payments.find((payment) => (
        payment.method === 'Pochi la Biashara'
        && String(payment.reference || '').toUpperCase() === reference
        && (
            (knownTenant && paymentBelongsToTenant(payment, knownTenant))
            || (!knownTenant && normaliseEmail(payment.tenantEmail) === tenantEmail)
        )
    ));

    if (duplicate) {
        sendJson(response, 409, {
            error: hasRecordedPayment(duplicate)
                ? 'That M-Pesa code has already been recorded against this rent.'
                : 'That M-Pesa code has already been submitted and is waiting for verification.'
        });
        return;
    }

    const claim = {
        id: `claim-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        tenantId: knownTenant?.id || '',
        tenantName,
        tenantEmail,
        tenantPhone: tenantPhone || knownTenant?.phone || null,
        payerPhone,
        propertyId: property.id,
        propertyName: property.name,
        location: property.location,
        unit,
        period,
        monthKey: periodKey,
        dueDate: `${periodKey}-05`,
        amount: rentForPeriod,
        paidAmount: 0,
        requestedAmount: amount,
        method: 'Pochi la Biashara',
        reference,
        providerReceipt: reference,
        status: 'Awaiting verification',
        paymentRequestStatus: 'pending',
        source: 'payment-page',
        createdAt: new Date().toISOString()
    };

    payments.push(claim);
    try {
        await persistPayments();
    } catch (error) {
        const index = payments.indexOf(claim);

        if (index !== -1) {
            payments.splice(index, 1);
        }

        console.error(`Public Pochi claim ${claim.id} could not be saved: ${error.message}`);
        sendJson(response, 500, { error: 'Your payment could not be submitted just now. Please try again.' });
        return;
    }

    paymentThrottle.fail(getClientKey(request));

    const bill = buildRentBill({
        propertyId: property.id,
        unit,
        email: tenantEmail,
        periodKey
    });

    sendJson(response, 201, {
        message: `Submitted. Your landlord will verify M-Pesa code ${reference} before this rent is recorded.`,
        claim: {
            id: claim.id,
            amount: claim.requestedAmount,
            period: claim.period,
            reference: claim.reference,
            status: claim.paymentRequestStatus
        },
        bill: bill.body,
        receivingNumber: getMpesaReceivingNumber()
    });
};

const handlePaymentRequestList = (request, response) => {
    sendJson(response, 200, payments
        .filter((payment) => ['pending', 'callback_review'].includes(payment.paymentRequestStatus))
        .sort((first, second) => String(first.createdAt).localeCompare(String(second.createdAt))));
};

const handlePaymentRequestConfirmation = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin payment confirmations are not allowed.' });
        return;
    }

    const paymentRequest = payments.find((payment) => (
        payment.id === request.params.requestId && payment.paymentRequestStatus === 'pending'
    ));

    if (!paymentRequest) {
        sendJson(response, 404, { error: 'That pending payment request could not be found.' });
        return;
    }

    const previousStatus = paymentRequest.status;
    paymentRequest.status = 'Confirmed';
    paymentRequest.paymentRequestStatus = 'confirmed';
    paymentRequest.confirmedAt = new Date().toISOString();

    const result = await recordPayment({
        tenantName: paymentRequest.tenantName,
        tenantEmail: paymentRequest.tenantEmail,
        tenantPhone: paymentRequest.tenantPhone,
        tenantId: paymentRequest.tenantId,
        propertyId: paymentRequest.propertyId,
        unit: paymentRequest.unit,
        periodKey: paymentRequest.monthKey,
        paidAmount: paymentRequest.requestedAmount,
        payerPhone: paymentRequest.payerPhone || paymentRequest.tenantPhone,
        method: 'Pochi la Biashara',
        reference: paymentRequest.reference,
        source: paymentRequest.source
    });

    if (result.code !== 201 && result.code !== 200) {
        paymentRequest.status = previousStatus;
        paymentRequest.paymentRequestStatus = 'pending';
        delete paymentRequest.confirmedAt;
        sendJson(response, result.code, result.body);
        return;
    }

    sendJson(response, 200, {
        message: 'Pochi receipt verified and payment recorded.',
        payment: result.body.payment
    });
};

const handlePaymentRequestRejection = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin payment decisions are not allowed.' });
        return;
    }

    const paymentRequest = payments.find((payment) => (
        payment.id === request.params.requestId && payment.paymentRequestStatus === 'pending'
    ));

    if (!paymentRequest) {
        sendJson(response, 404, { error: 'That pending payment request could not be found.' });
        return;
    }

    paymentRequest.status = 'Rejected';
    paymentRequest.paymentRequestStatus = 'rejected';
    paymentRequest.rejectedAt = new Date().toISOString();

    try {
        await persistPayments();
    } catch (error) {
        paymentRequest.status = 'Awaiting confirmation';
        paymentRequest.paymentRequestStatus = 'pending';
        delete paymentRequest.rejectedAt;
        sendJson(response, 500, { error: 'The payment request decision could not be saved. Please try again.' });
        return;
    }

    sendJson(response, 200, { message: 'Payment request rejected.' });
};

/* The landlord's version of the status poll: asks Safaricom how a stuck
   request actually ended, so one whose callback was lost can still be
   settled without the tenant paying again. */
const handlePaymentRequestCheck = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin payment checks are not allowed.' });
        return;
    }

    const paymentRequest = payments.find((payment) => (
        payment.id === request.params.requestId && payment.method === 'M-Pesa STK Push'
    ));

    if (!paymentRequest) {
        sendJson(response, 404, { error: 'That Safaricom payment request could not be found.' });
        return;
    }

    if (paymentRequest.stkStatus === 'paid' || paymentRequest.stkStatus === 'failed') {
        sendJson(response, 409, { error: `That payment request is already settled as "${paymentRequest.status}".` });
        return;
    }

    if (!paymentRequest.checkoutRequestId) {
        sendJson(response, 409, { error: 'Safaricom never accepted this request, so there is no transaction to check.' });
        return;
    }

    /* A callback that arrived but could not be trusted is reported, not
       applied, so a mismatched amount or payer still gets a human decision
       through the confirm and reject buttons. */
    if (['callback_review', 'processing', 'finalization_pending'].includes(paymentRequest.stkStatus)) {
        paymentRequest.lastQueriedAt = new Date().toISOString();

        let outcome;
        try {
            outcome = await queryDarajaStkStatus({ checkoutRequestId: paymentRequest.checkoutRequestId });
        } catch (error) {
            sendJson(response, 502, { error: `Safaricom could not be asked: ${error.message}` });
            return;
        }

        if (!outcome.definitive) {
            sendJson(response, 200, {
                message: `Safaricom has no final answer yet: ${outcome.resultDescription} This request is unchanged.`,
                request: paymentRequest
            });
            return;
        }

        sendJson(response, 200, {
            message: String(outcome.resultCode) === '0'
                ? `Safaricom reports this payment was completed (${paymentRequest.checkoutRequestId}). It was left for your review because an earlier callback did not match this request, so verify it in the M-Pesa statement before recording it.`
                : `Safaricom reports this payment was not completed: ${describeStkFailure(outcome.resultCode, outcome.resultDescription)} It was left for your review; reject it if you agree.`,
            request: paymentRequest
        });
        return;
    }

    const outcome = await applyStkQueryOutcome(paymentRequest);

    sendJson(response, 200, {
        message: outcome.changed
            ? (paymentRequest.stkStatus === 'paid'
                ? 'Safaricom confirmed this payment and it has been recorded in the rent ledger.'
                : `Safaricom closed this payment request: ${outcome.note}`)
            : `Safaricom has no final answer yet: ${outcome.note}`,
        request: paymentRequest
    });
};

/* Safaricom sends what a successful transaction actually carried — amount,
   receipt, payer — as a list of name/value items. */
const readCallbackMetadata = (callback) => new Map(
    (Array.isArray(callback.CallbackMetadata?.Item) ? callback.CallbackMetadata.Item : [])
        .filter((item) => item && typeof item.Name === 'string')
        .map((item) => [item.Name, item.Value])
);

/* Public configuration the pay-rent page needs to show tenants where to send
   money. Only non-secret values are exposed; the receiving number is the
   personal M-Pesa number rent is sent to, not the Daraja shortcode. */
const handleMpesaConfig = (request, response) => {
    let businessShortCode = '';
    let stkConfigured = false;

    try {
        businessShortCode = getDarajaSettings().shortcode;
        stkConfigured = true;
    } catch (error) {
        /* STK Push simply is not configured yet; the receiving number is still
           returned so tenants can pay manually. */
        stkConfigured = false;
    }

    sendJson(response, 200, {
        receivingNumber: getMpesaReceivingNumber(),
        businessShortCode,
        stkConfigured
    });
};

/* A rent bill is a read-only view of what one payer owes for one property,
   unit and rent period. It is public so the pay-rent page can show it before
   asking for an STK Push, but it returns only figures for the details supplied
   — never another tenant's name or payment history. The balance uses exactly
   the same rent-period grouping as the payment checks, so the bill and the
   amount the server will accept cannot disagree. */
const buildRentBill = (input) => {
    const propertyId = String(input.propertyId || '').trim();
    const unit = String(input.unit || '').trim();
    const email = normaliseEmail(input.email);
    const property = properties.find((item) => item.id === propertyId);

    if (!property) {
        return { code: 404, body: { error: 'Choose a valid property.' } };
    }

    if (!unit) {
        return { code: 400, body: { error: 'Enter the unit or house number to see your bill.' } };
    }

    if (!isValidEmail(email)) {
        return { code: 400, body: { error: 'Enter a valid email address to see your bill.' } };
    }

    const { periodKey, period } = getPeriodDetails(input.periodKey);
    const knownTenant = findTenantByEmail(email);
    const rent = Math.round(Number(knownTenant?.monthlyRent) || Number(property.monthlyRent) || 0);
    const rentPeriod = {
        tenantId: knownTenant?.id || '',
        tenantEmail: email,
        propertyId: property.id,
        unit,
        monthKey: periodKey
    };
    const received = totalPaidForRentPeriod(payments, rentPeriod);
    /* Money asked for but not yet confirmed is listed separately from rent
       received: STK Pushes and Pochi claims reserve part of the balance but
       are not the same as rent paid. */
    const stkReserved = reservedRentForPeriod(payments, rentPeriod, 'M-Pesa STK Push');
    const pochiReserved = reservedRentForPeriod(payments, rentPeriod, 'Pochi la Biashara');
    const reserved = stkReserved + pochiReserved;
    const balance = Math.max(0, rent - received - reserved);
    const unitCode = String(unit).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'UNIT';
    const propertyCode = property.id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'PROP';
    let status = 'Unpaid';

    if (rent > 0 && received >= rent) {
        status = 'Paid in full';
    } else if (reserved > 0 && received + reserved >= rent) {
        status = 'Awaiting confirmation';
    } else if (received > 0 || reserved > 0) {
        status = 'Partially paid';
    }

    return {
        code: 200,
        body: {
            billNumber: `BILL-${periodKey.replace('-', '')}-${unitCode}-${propertyCode}`,
            status,
            propertyName: property.name,
            location: property.location || '',
            unit,
            period,
            periodKey,
            dueDate: `${periodKey}-05`,
            issuedOn: `${periodKey}-01`,
            email,
            rent,
            received,
            reserved,
            balance,
            hasTenantRecord: Boolean(knownTenant),
            items: [
                { label: `Monthly rent — ${property.name} (${unit})`, amount: rent },
                { label: 'Rent received', amount: received, credit: true },
                { label: 'Awaiting M-Pesa STK confirmation', amount: stkReserved, credit: true },
                { label: 'Pochi payment awaiting verification', amount: pochiReserved, credit: true }
            ].filter((item) => item.amount > 0)
        }
    };
};

const handleRentBill = (request, response) => {
    const result = buildRentBill({
        propertyId: queryValue(request.query.property),
        unit: queryValue(request.query.unit),
        email: queryValue(request.query.email),
        periodKey: queryValue(request.query.period)
    });

    sendJson(response, result.code, result.body);
};

const handleMpesaCallback = async (request, response) => {
    if (!isValidDarajaCallbackToken(request.query.token)) {
        sendJson(response, 403, { ResultCode: 1, ResultDesc: 'Invalid callback token.' });
        return;
    }

    const callback = request.body?.Body?.stkCallback;
    const checkoutRequestId = String(callback?.CheckoutRequestID || '');
    const merchantRequestId = String(callback?.MerchantRequestID || '');
    if (!checkoutRequestId || !merchantRequestId
        || callback.ResultCode === undefined
        || callback.ResultCode === null
        || !/^-?\d+$/.test(String(callback.ResultCode))) {
        sendJson(response, 400, { ResultCode: 1, ResultDesc: 'Invalid STK callback.' });
        return;
    }

    const paymentRequest = payments.find((payment) => (
        payment.checkoutRequestId === checkoutRequestId
        && payment.merchantRequestId === merchantRequestId
        && payment.method === 'M-Pesa STK Push'
    ));
    if (!paymentRequest) {
        console.warn(`Ignored unmatched Safaricom STK callback for checkout ${checkoutRequestId}.`);
        sendJson(response, 200, { ResultCode: 0, ResultDesc: 'Callback acknowledged.' });
        return;
    }

    if (paymentRequest.stkStatus === 'paid') {
        /* A payment recorded through the status query settled under the
           checkout reference because the query carries no receipt. If the
           callback turns up afterwards, it can hand over the real one without
           the money ever being recorded twice. */
        const metadata = readCallbackMetadata(callback);
        const receipt = String(metadata.get('MpesaReceiptNumber') || '').trim().toUpperCase();
        const amount = Number(metadata.get('Amount'));

        if (Number(callback.ResultCode) === 0
            && paymentRequest.providerVerifiedVia === 'stk-query'
            && receipt
            && /^[A-Z0-9]{6,20}$/.test(receipt)
            && amount === Number(paymentRequest.requestedAmount)) {
            const recorded = payments.find((payment) => (
                hasRecordedPayment(payment)
                && payment.method === 'M-Pesa STK Push'
                && payment.reference === checkoutRequestId
            ));

            if (recorded) {
                recorded.reference = receipt;
            }

            paymentRequest.reference = receipt;
            paymentRequest.providerReceipt = receipt;
            paymentRequest.updatedAt = new Date().toISOString();
        } else if (paymentRequest.providerVerifiedVia === 'stk-query' && Number(callback.ResultCode) === 0) {
            console.warn(`Late callback for query-confirmed ${paymentRequest.id} did not match; the checkout reference was kept.`);
        }

        try {
            await persistPayments();
        } catch (error) {
            sendJson(response, 500, { ResultCode: 1, ResultDesc: 'Payment status could not be saved.' });
            return;
        }
        sendJson(response, 200, { ResultCode: 0, ResultDesc: 'Payment already recorded.' });
        return;
    }

    if (safaricomCheckoutsInFlight.has(checkoutRequestId)) {
        sendJson(response, 200, { ResultCode: 0, ResultDesc: 'Callback processing.' });
        return;
    }

    safaricomCheckoutsInFlight.add(checkoutRequestId);
    try {
        const resultCode = Number(callback.ResultCode);
        if (resultCode !== 0) {
            paymentRequest.stkStatus = 'failed';
            paymentRequest.paymentRequestStatus = 'failed';
            paymentRequest.status = 'STK Push cancelled';
            paymentRequest.failureReason = String(callback.ResultDesc || 'The M-Pesa request was not completed.').slice(0, 250);
            paymentRequest.updatedAt = new Date().toISOString();
            await persistPayments();
            sendJson(response, 200, { ResultCode: 0, ResultDesc: 'Payment failure recorded.' });
            return;
        }

        let settings;
        try {
            settings = getDarajaSettings();
        } catch (error) {
            throw new Error(`Daraja configuration is unavailable while processing a successful callback: ${error.message}`);
        }

        const metadata = readCallbackMetadata(callback);
        const amount = Number(metadata.get('Amount'));
        const receipt = String(metadata.get('MpesaReceiptNumber') || '').trim().toUpperCase();
        const payerPhone = normalizeKenyanPhone(String(metadata.get('PhoneNumber') || ''));
        const expectedPhone = normalizeKenyanPhone(paymentRequest.payerPhone);

        if (String(settings.shortcode) !== String(paymentRequest.businessShortCode)
            || amount !== Number(paymentRequest.requestedAmount)
            || !receipt
            || !/^[A-Z0-9]{6,20}$/.test(receipt)
            || !payerPhone
            || payerPhone !== expectedPhone) {
            paymentRequest.stkStatus = 'callback_review';
            paymentRequest.paymentRequestStatus = 'callback_review';
            paymentRequest.status = 'Safaricom callback needs review';
            paymentRequest.providerReceipt = receipt || null;
            paymentRequest.providerAmount = Number.isFinite(amount) ? amount : null;
            paymentRequest.providerPhone = payerPhone || null;
            paymentRequest.failureReason = 'The callback amount, phone, or receipt did not match this STK request.';
            paymentRequest.updatedAt = new Date().toISOString();
            await persistPayments();
            console.warn(`Safaricom callback for ${paymentRequest.id} did not match the requested amount, phone, or receipt.`);
            sendJson(response, 200, { ResultCode: 0, ResultDesc: 'Callback requires transaction review.' });
            return;
        }

        paymentRequest.stkStatus = 'processing';
        paymentRequest.providerReceipt = receipt;
        paymentRequest.providerAmount = amount;
        paymentRequest.providerPhone = payerPhone;
        paymentRequest.updatedAt = new Date().toISOString();
        await persistPayments();

        const result = await recordPayment({
            tenantName: paymentRequest.tenantName,
            tenantEmail: paymentRequest.tenantEmail,
            tenantPhone: paymentRequest.tenantPhone || paymentRequest.payerPhone,
            payerPhone: payerPhone || paymentRequest.payerPhone,
            tenantId: paymentRequest.tenantId,
            propertyId: paymentRequest.propertyId,
            unit: paymentRequest.unit,
            periodKey: paymentRequest.monthKey,
            paidAmount: amount,
            /* The rent this request was opened against, which may be the
               tenant's own agreed rent rather than the property's. */
            rent: paymentRequest.amount,
            method: 'M-Pesa STK Push',
            reference: receipt,
            source: 'mpesa-stk-callback'
        });

        if (result.code !== 201 && result.code !== 200) {
            paymentRequest.stkStatus = 'callback_review';
            paymentRequest.paymentRequestStatus = 'callback_review';
            paymentRequest.status = 'Safaricom payment needs ledger review';
            paymentRequest.failureReason = result.body.error || 'Safaricom confirmed payment, but the rent ledger could not record it.';
            paymentRequest.updatedAt = new Date().toISOString();
            await persistPayments();
            console.error(`Safaricom payment ${receipt} needs ledger review: ${paymentRequest.failureReason}`);
            sendJson(response, 200, { ResultCode: 0, ResultDesc: 'Successful payment requires ledger review.' });
            return;
        }

        paymentRequest.stkStatus = 'paid';
        paymentRequest.paymentRequestStatus = 'paid';
        paymentRequest.status = 'Paid';
        paymentRequest.paidOn = result.body.payment.paidOn;
        paymentRequest.reference = receipt;
        paymentRequest.receiptNumber = result.body.payment.receiptNumber;
        paymentRequest.confirmedAt = new Date().toISOString();
        paymentRequest.updatedAt = new Date().toISOString();
        try {
            await persistPayments();
        } catch (error) {
            paymentRequest.stkStatus = 'finalization_pending';
            paymentRequest.paymentRequestStatus = 'callback_review';
            paymentRequest.failureReason = 'Safaricom payment was recorded; final request status needs a callback retry.';
            console.error(`Safaricom payment ${receipt} was recorded, but request finalization failed: ${error.message}`);
            sendJson(response, 500, { ResultCode: 1, ResultDesc: 'Payment recorded; final status save failed.' });
            return;
        }

        sendJson(response, 200, { ResultCode: 0, ResultDesc: 'Payment verified and recorded.' });
    } catch (error) {
        console.error(`Safaricom callback processing failed: ${error.message}`);
        sendJson(response, 500, { ResultCode: 1, ResultDesc: 'Callback processing failed; please retry.' });
    } finally {
        safaricomCheckoutsInFlight.delete(checkoutRequestId);
    }
};

/* What Safaricom's own result codes mean to the person reading them, so the
   reason a prompt failed is said plainly rather than as a provider code. */
const describeStkFailure = (resultCode, resultDescription) => {
    const messages = {
        1: 'The M-Pesa balance was too low for this payment.',
        17: 'Safaricom could not process this payment. Try again later.',
        1001: 'Another M-Pesa session was already open on that phone, so this prompt could not be completed.',
        1019: 'The M-Pesa prompt expired before it was answered.',
        1031: 'The M-Pesa PIN was not entered in time, so the payment was not completed.',
        1032: 'The M-Pesa prompt was cancelled, so no money was taken.',
        1037: 'The phone could not be reached with the M-Pesa prompt.',
        2001: 'The M-Pesa PIN entered was not correct, so the payment was not completed.'
    };

    return messages[Number(resultCode)] || resultDescription || 'The M-Pesa payment was not completed.';
};

const stkQueryFirstDelayMs = 15 * 1000;
const stkQueryIntervalMs = 10 * 1000;

const millisecondsSince = (isoTimestamp) => {
    const parsed = Date.parse(isoTimestamp || '');

    /* A timestamp that was never written reads as infinitely old, so an
       unqueried request is always due its first check. */
    return Number.isFinite(parsed) ? Date.now() - parsed : Number.POSITIVE_INFINITY;
};

/* A pending request is only asked about once the prompt has had time to
   reach the phone, and never more often than the interval, so the tenant's
   page polling every few seconds never hammers Safaricom. */
const shouldAutoQueryPaymentRequest = (paymentRequest) => (
    paymentRequest.stkStatus === 'pending'
    && paymentRequest.checkoutRequestId
    && !paymentRequest.reference
    && millisecondsSince(paymentRequest.updatedAt || paymentRequest.createdAt) >= stkQueryFirstDelayMs
    && millisecondsSince(paymentRequest.lastQueriedAt) >= stkQueryIntervalMs
);

/* Asks Safaricom how an STK request ended and writes that answer into the
   rent ledger. Never throws: a query Safaricom cannot answer simply leaves
   the payment request exactly as it was, ready for the next attempt. */
const applyStkQueryOutcome = async (paymentRequest) => {
    const checkoutRequestId = paymentRequest.checkoutRequestId;

    if (safaricomCheckoutsInFlight.has(checkoutRequestId)) {
        return { changed: false, note: 'A Safaricom answer for this payment is already being processed.' };
    }

    safaricomCheckoutsInFlight.add(checkoutRequestId);
    try {
        paymentRequest.lastQueriedAt = new Date().toISOString();

        let outcome;
        try {
            outcome = await queryDarajaStkStatus({ checkoutRequestId });
        } catch (error) {
            return { changed: false, note: error.message };
        }

        if (!outcome.definitive) {
            return { changed: false, note: outcome.resultDescription };
        }

        if (String(outcome.resultCode) !== '0') {
            const failureReason = describeStkFailure(outcome.resultCode, outcome.resultDescription).slice(0, 250);

            paymentRequest.stkStatus = 'failed';
            paymentRequest.paymentRequestStatus = 'failed';
            paymentRequest.status = 'STK Push cancelled';
            paymentRequest.failureReason = failureReason;
            paymentRequest.lastQueryResultCode = String(outcome.resultCode);
            paymentRequest.updatedAt = new Date().toISOString();

            try {
                await persistPayments();
            } catch (error) {
                console.error(`Queried STK failure ${paymentRequest.id} could not be persisted: ${error.message}`);
            }

            return { changed: true, note: failureReason };
        }

        /* Safaricom finished this payment. The query carries no receipt, so
           the checkout reference the money settled under stands in for one
           until a late callback hands over the real receipt. */
        const result = await recordPayment({
            tenantName: paymentRequest.tenantName,
            tenantEmail: paymentRequest.tenantEmail,
            tenantPhone: paymentRequest.tenantPhone || paymentRequest.payerPhone,
            payerPhone: paymentRequest.payerPhone,
            tenantId: paymentRequest.tenantId,
            propertyId: paymentRequest.propertyId,
            unit: paymentRequest.unit,
            periodKey: paymentRequest.monthKey,
            paidAmount: paymentRequest.requestedAmount,
            /* The rent this request was opened against, which may be the
               tenant's own agreed rent rather than the property's. */
            rent: paymentRequest.amount,
            method: 'M-Pesa STK Push',
            reference: checkoutRequestId,
            source: 'mpesa-stk-query'
        });

        if (result.code !== 201 && result.code !== 200) {
            paymentRequest.stkStatus = 'callback_review';
            paymentRequest.paymentRequestStatus = 'callback_review';
            paymentRequest.status = 'Safaricom payment needs ledger review';
            paymentRequest.failureReason = result.body.error || 'Safaricom confirmed payment, but the rent ledger could not record it.';
            paymentRequest.updatedAt = new Date().toISOString();

            try {
                await persistPayments();
            } catch (error) {
                console.error(`Queried STK payment ${paymentRequest.id} could not be marked for review: ${error.message}`);
            }

            return { changed: true, note: paymentRequest.failureReason };
        }

        paymentRequest.stkStatus = 'paid';
        paymentRequest.paymentRequestStatus = 'paid';
        paymentRequest.status = 'Paid';
        paymentRequest.paidOn = result.body.payment.paidOn;
        paymentRequest.reference = checkoutRequestId;
        paymentRequest.receiptNumber = result.body.payment.receiptNumber;
        paymentRequest.providerVerifiedVia = 'stk-query';
        paymentRequest.confirmedAt = new Date().toISOString();
        paymentRequest.updatedAt = new Date().toISOString();

        try {
            await persistPayments();
        } catch (error) {
            paymentRequest.stkStatus = 'finalization_pending';
            paymentRequest.paymentRequestStatus = 'callback_review';
            paymentRequest.failureReason = 'Safaricom payment was recorded; final request status needs a callback retry.';
            console.error(`Safaricom payment recorded via query ${checkoutRequestId} could not be finalized: ${error.message}`);
            return { changed: true, note: paymentRequest.failureReason };
        }

        return { changed: true, note: 'Safaricom confirmed this payment.' };
    } finally {
        safaricomCheckoutsInFlight.delete(checkoutRequestId);
    }
};

const handlePaymentRequestStatus = async (request, response) => {
    const paymentRequest = payments.find((payment) => (
        payment.id === request.params.requestId && payment.method === 'M-Pesa STK Push'
    ));

    if (!paymentRequest) {
        sendJson(response, 404, { error: 'STK payment request not found.' });
        return;
    }

    /* A callback can be lost on the way back, so once the prompt has had time
       to reach the phone, the poll itself asks Safaricom how the request
       ended and settles it the same way the callback would have. */
    if (shouldAutoQueryPaymentRequest(paymentRequest)) {
        try {
            await applyStkQueryOutcome(paymentRequest);
        } catch (error) {
            console.error(`STK status query for ${paymentRequest.id} failed unexpectedly: ${error.message}`);
        }
    }

    if (paymentRequest.stkStatus === 'paid') {
        const receivingNumber = getMpesaReceivingNumber();

        /* The confirmation modal and the gated receipt need the whole story:
           what was received, the number the tenant paid from, and the number
           the rent was received on. */
        sendJson(response, 200, {
            state: 'paid',
            message: 'Safaricom confirmed the payment. Your rent has been received.',
            receiptNumber: paymentRequest.receiptNumber,
            reference: paymentRequest.reference,
            paidAmount: paymentRequest.requestedAmount,
            paidOn: paymentRequest.paidOn,
            period: paymentRequest.period,
            amount: paymentRequest.amount,
            periodPaid: totalPaidForRentPeriod(payments, paymentRequest),
            periodOutstanding: rentPeriodOutstanding(payments, paymentRequest),
            method: paymentRequest.method,
            payerPhone: paymentRequest.payerPhone,
            tenantName: paymentRequest.tenantName,
            propertyName: paymentRequest.propertyName,
            unit: paymentRequest.unit,
            receivingNumber,
            paidTo: receivingNumber
        });
        return;
    }

    if (paymentRequest.stkStatus === 'failed') {
        sendJson(response, 200, {
            state: 'failed',
            message: paymentRequest.failureReason || 'The STK Push was not completed.'
        });
        return;
    }

    if (paymentRequest.stkStatus === 'callback_review'
        || paymentRequest.stkStatus === 'finalization_pending'
        || paymentRequest.stkStatus === 'reconciliation_required') {
        sendJson(response, 200, {
            state: 'review',
            message: 'Safaricom returned a payment result that needs landlord reconciliation. Contact the landlord before paying again.'
        });
        return;
    }

    sendJson(response, 200, {
        state: 'pending',
        message: paymentRequest.customerMessage || 'Check your phone and enter your M-Pesa PIN.'
    });
};

const handlePaymentList = (request, response) => {
    if (!isAdminAuthenticated(request)) {
        sendJson(response, 401, { error: 'Admin authentication is required to read the payment ledger.' });
        return;
    }

    const requestedProperty = queryValue(request.query.property);
    const requestedStatus = queryValue(request.query.status);
    const requestedPeriod = queryValue(request.query.period);
    const searchTerm = queryValue(request.query.q).trim().toLowerCase();

    const filteredPayments = payments.filter(hasRecordedPayment).filter((payment) => {
        const propertyMatches = !requestedProperty || payment.propertyId === requestedProperty;
        const statusMatches = !requestedStatus || payment.status === requestedStatus;
        const periodMatches = !requestedPeriod || payment.period === requestedPeriod;
        const searchMatches = !searchTerm || [
            payment.tenantName,
            payment.tenantEmail,
            payment.propertyName,
            payment.location,
            payment.unit,
            payment.reference,
            payment.payerPhone,
            payment.tenantPhone
        ].some((value) => String(value || '').toLowerCase().includes(searchTerm));

        return propertyMatches && statusMatches && periodMatches && searchMatches;
    });

    sendJson(response, 200, filteredPayments);
};

const handleTenantList = (request, response) => {
    const requestedProperty = queryValue(request.query.property);
    const requestedPayment = queryValue(request.query.payment) || 'all';
    const requestedStatus = queryValue(request.query.status);
    const searchTerm = queryValue(request.query.q).trim().toLowerCase();

    const listed = tenants
        .map(summariseTenant)
        .filter((tenant) => {
            const propertyMatches = !requestedProperty || tenant.propertyId === requestedProperty;
            const statusMatches = !requestedStatus || tenant.status === requestedStatus;
            const paymentMatches = requestedPayment === 'all'
                || (requestedPayment === 'paid' && tenant.hasPaid)
                || (requestedPayment === 'unpaid' && !tenant.hasPaid);
            const searchMatches = !searchTerm || [
                tenant.fullName,
                tenant.email,
                tenant.phone,
                tenant.propertyName,
                tenant.location,
                tenant.unit
            ].some((value) => String(value || '').toLowerCase().includes(searchTerm));

            return propertyMatches && statusMatches && paymentMatches && searchMatches;
        })
        .sort((first, second) => String(first.fullName).localeCompare(String(second.fullName)));

    sendJson(response, 200, listed);
};

const handleTenantProfile = (request, response) => {
    const tenant = findTenant(request.params.tenantId);

    if (!tenant) {
        sendJson(response, 404, { error: 'That tenant could not be found.' });
        return;
    }

    const tenantPayments = getTenantPayments(tenant).sort((first, second) => {
        return String(second.paidOn || '').localeCompare(String(first.paidOn || ''))
            || String(second.monthKey || '').localeCompare(String(first.monthKey || ''));
    });

    sendJson(response, 200, { tenant: summariseTenant(tenant), payments: tenantPayments });
};

const handleTenantCreate = async (request, response) => {
    const candidate = buildTenantFromPayload(request.body);
    const problem = describeTenantProblem(candidate);

    if (problem) {
        sendJson(response, 400, { error: problem });
        return;
    }

    const emailConflict = describeTenantEmailConflict(candidate.email);

    if (emailConflict) {
        sendJson(response, 409, { error: emailConflict });
        return;
    }

    const now = new Date().toISOString();
    const tenant = {
        id: `ten-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        ...candidate,
        source: 'admin',
        createdAt: now,
        updatedAt: now
    };

    tenants.push(tenant);

    try {
        await persistTenants();
    } catch (error) {
        tenants.pop();
        sendJson(response, 500, { error: 'The tenant could not be saved. Please try again.' });
        return;
    }

    sendJson(response, 201, { message: `${tenant.fullName} was added to your tenants.`, tenant: summariseTenant(tenant) });
};

const handleTenantUpdate = async (request, response) => {
    const tenant = findTenant(request.params.tenantId);

    if (!tenant) {
        sendJson(response, 404, { error: 'That tenant could not be found.' });
        return;
    }

    const candidate = buildTenantFromPayload(request.body, tenant);
    const problem = describeTenantProblem(candidate);

    if (problem) {
        sendJson(response, 400, { error: problem });
        return;
    }

    const emailConflict = describeTenantEmailConflict(candidate.email, tenant.id);

    if (emailConflict) {
        sendJson(response, 409, { error: emailConflict });
        return;
    }

    const previous = { ...tenant };

    Object.assign(tenant, candidate, { updatedAt: new Date().toISOString() });

    try {
        await persistTenants();
    } catch (error) {
        Object.assign(tenant, previous);
        sendJson(response, 500, { error: 'The tenant could not be updated. Please try again.' });
        return;
    }

    sendJson(response, 200, { message: `${tenant.fullName}'s details were updated.`, tenant: summariseTenant(tenant) });
};

const handleTenantDelete = async (request, response) => {
    const index = tenants.findIndex((tenant) => tenant.id === request.params.tenantId);

    if (index === -1) {
        sendJson(response, 404, { error: 'That tenant could not be found.' });
        return;
    }

    const [removed] = tenants.splice(index, 1);

    try {
        await persistTenants();
    } catch (error) {
        tenants.splice(index, 0, removed);
        sendJson(response, 500, { error: 'The tenant could not be removed. Please try again.' });
        return;
    }

    sendJson(response, 200, {
        message: `${removed.fullName} was removed from your tenants.`,
        keptPayments: getTenantPayments(removed).length
    });
};

const handleTenantPayment = async (request, response) => {
    const tenant = findTenant(request.params.tenantId);

    if (!tenant) {
        sendJson(response, 404, { error: 'That tenant could not be found.' });
        return;
    }

    const result = await recordPayment({
        tenantName: tenant.fullName,
        tenantEmail: tenant.email,
        tenantPhone: tenant.phone,
        tenantId: tenant.id,
        propertyId: request.body.propertyId || tenant.propertyId,
        unit: request.body.unit || tenant.unit,
        periodKey: request.body.periodKey,
        paidAmount: request.body.amount,
        method: request.body.method,
        payerPhone: request.body.payerPhone || tenant.phone,
        rent: tenant.monthlyRent,
        source: 'landlord-dashboard'
    });

    sendJson(response, result.code, result.body);
};

const maintenanceCategories = new Set(['Plumbing', 'Electrical', 'Appliance', 'Structural', 'Pest control', 'Other']);
const maintenanceUrgencies = new Set(['Low', 'Normal', 'High', 'Emergency']);
const maintenanceStatuses = new Set(['Open', 'In progress', 'Resolved', 'Cancelled']);

/* Only the tenant who raised a request may read or change it. */
const findMaintenanceRequest = (requestId) => maintenanceRequests.find((item) => item.id === requestId) || null;

const getTenantMaintenanceRequests = (tenantId) => maintenanceRequests
    .filter((item) => item.tenantId === tenantId)
    .sort((first, second) => String(second.createdAt).localeCompare(String(first.createdAt)));

const summariseMaintenanceRequest = (item) => ({
    ...item,
    propertyName: item.propertyName || properties.find((p) => p.id === item.propertyId)?.name || ''
});

const buildMaintenanceRequest = (payload, tenant, existing = null) => {
    const pick = (key, fallback = '') => (payload[key] === undefined ? fallback : String(payload[key] || '').trim());

    return {
        tenantId: tenant.id,
        tenantName: tenant.fullName,
        tenantEmail: tenant.email,
        tenantPhone: tenant.phone,
        propertyId: pick('propertyId', tenant.propertyId),
        unit: pick('unit', tenant.unit),
        category: pick('category', existing?.category),
        urgency: pick('urgency', existing?.urgency) || 'Normal',
        title: pick('title', existing?.title),
        description: pick('description', existing?.description),
        status: existing?.status || 'Open',
        landlordNotes: pick('landlordNotes', existing?.landlordNotes)
    };
};

const describeMaintenanceProblem = (candidate) => {
    if (!candidate.propertyId) {
        return 'Your account is not linked to a property yet, so we cannot route this request.';
    }

    if (!maintenanceCategories.has(candidate.category)) {
        return `Choose a category from: ${[...maintenanceCategories].join(', ')}.`;
    }

    if (!maintenanceUrgencies.has(candidate.urgency)) {
        return 'Choose how urgent this request is.';
    }

    if (candidate.title.length < 4 || candidate.title.length > 120) {
        return 'Give the request a short title between 4 and 120 characters.';
    }

    if (candidate.description.length < 10) {
        return 'Describe the problem in at least 10 characters so the landlord knows what to expect.';
    }

    if (candidate.description.length > 2000) {
        return 'Please keep the description under 2000 characters.';
    }

    return '';
};

/* The whole portal in one call: who you are, the home you rent, the rent
   position, and the requests you have raised. */
const buildTenantPortal = (tenant) => {
    const property = properties.find((item) => item.id === tenant.propertyId) || null;
    const summary = summariseTenant(tenant);
    const tenantPayments = getTenantPayments(tenant);
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentPeriod = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
    /* A month can hold several part payments, so everything received towards
       this month's rent is added up rather than read from a single record. */
    const paidThisMonth = tenantPayments
        .filter((payment) => payment.monthKey === currentMonthKey)
        .reduce((total, payment) => total + (Number(payment.paidAmount) || 0), 0);
    const rent = Math.max(0, Number(tenant.monthlyRent) || 0);
    /* Rent is due on the last day of the month. Formatted from the local date
       rather than toISOString(), which would shift it a day either side of UTC
       midnight and show the tenant the wrong due date. */
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const dueDate = [
        lastDayOfMonth.getFullYear(),
        String(lastDayOfMonth.getMonth() + 1).padStart(2, '0'),
        String(lastDayOfMonth.getDate()).padStart(2, '0')
    ].join('-');
    const openRequests = getTenantMaintenanceRequests(tenant.id)
        .filter((item) => item.status !== 'Resolved' && item.status !== 'Cancelled');

    return {
        tenant: {
            id: tenant.id,
            fullName: tenant.fullName,
            email: tenant.email,
            phone: tenant.phone,
            unit: tenant.unit,
            propertyId: tenant.propertyId,
            propertyName: tenant.propertyName,
            location: tenant.location,
            monthlyRent: summary.monthlyRent,
            status: tenant.status,
            notes: tenant.notes,
            hasPassword: Boolean(tenant.password?.passwordHash),
            createdAt: tenant.createdAt
        },
        property,
        rent: {
            monthlyRent: rent,
            currentMonthKey,
            currentPeriod,
            dueDate,
            paidThisMonth,
            outstandingThisMonth: Math.max(0, rent - paidThisMonth),
            totalPaid: summary.totalPaid,
            outstanding: summary.outstanding,
            paymentCount: summary.paymentCount,
            lastPaymentOn: summary.lastPaymentOn,
            isCurrentMonthPaid: rent > 0 && paidThisMonth >= rent
        },
        /* Each payment carries the balance of the rent period it was paid
           towards, so a receipt can show what is still owed for that month and
           not only the amount of this one payment. */
        payments: tenantPayments
            .slice()
            .sort((first, second) => String(second.paidOn).localeCompare(String(first.paidOn)))
            .map((payment) => ({
                ...payment,
                periodPaid: totalPaidForRentPeriod(payments, payment),
                periodOutstanding: rentPeriodOutstanding(payments, payment)
            })),
        maintenance: getTenantMaintenanceRequests(tenant.id).map(summariseMaintenanceRequest),
        openRequestCount: openRequests.length,
        /* Pochi payments the tenant has recorded but that are not yet verified
           (or were turned down), so they can see what is still waiting. */
        claims: payments
            .filter((payment) => paymentBelongsToTenant(payment, tenant))
            .filter((payment) => payment.method === 'Pochi la Biashara' && !hasRecordedPayment(payment))
            .filter((payment) => ['pending', 'callback_review', 'rejected'].includes(payment.paymentRequestStatus))
            .sort((first, second) => String(second.createdAt).localeCompare(String(first.createdAt)))
            .map((payment) => ({
                id: payment.id,
                amount: payment.requestedAmount,
                period: payment.period,
                reference: payment.reference,
                submittedAt: payment.createdAt,
                status: payment.paymentRequestStatus,
                statusLabel: payment.paymentRequestStatus === 'rejected'
                    ? 'Not verified'
                    : (payment.paymentRequestStatus === 'callback_review' ? 'Needs reconciliation' : 'Awaiting verification')
            })),
        /* The M-Pesa number rent is received on, shown to the tenant and
           printed on every receipt. */
        receivingNumber: getMpesaReceivingNumber()
    };
};

const handleTenantSessionStatus = (request, response) => {
    const tenantId = getTenantSessionTenantId(request);
    const tenant = tenantId ? findTenant(tenantId) : null;

    if (!tenant) {
        sendJson(response, 200, { authenticated: false, portalUrl: 'tenant-portal.html', loginUrl: 'tenant-login.html' });
        return;
    }

    sendJson(response, 200, {
        authenticated: true,
        tenant: { id: tenant.id, fullName: tenant.fullName, email: tenant.email },
        portalUrl: 'tenant-portal.html'
    });
};

const handleTenantSignIn = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin sign-in is not allowed.' });
        return;
    }

    const clientKey = getClientKey(request);
    const throttle = tenantLoginThrottle.check(clientKey);

    if (throttle.locked) {
        sendJson(response, 429, {
            error: `Too many sign-in attempts. Try again in ${throttle.retryAfterSeconds} seconds.`
        });
        return;
    }

    const email = normaliseEmail(request.body.email);
    const password = String(request.body.password || '');
    const tenant = email ? findTenantByEmail(email) : null;

    if (!tenant || !tenant.password?.passwordHash) {
        tenantLoginThrottle.fail(clientKey);
        sendJson(response, 401, { error: 'We could not match that email and password to a tenant account.' });
        return;
    }

    const passwordMatches = await verifyPasswordRecord(tenant.password, password);

    if (!passwordMatches) {
        tenantLoginThrottle.fail(clientKey);
        sendJson(response, 401, { error: 'We could not match that email and password to a tenant account.' });
        return;
    }

    tenantLoginThrottle.reset(clientKey);
    const token = tenantSessions.create({ tenantId: tenant.id });

    sendJson(response, 200, {
        message: `Welcome back, ${tenant.fullName}.`,
        tenant: { id: tenant.id, fullName: tenant.fullName, email: tenant.email },
        portalUrl: 'tenant-portal.html'
    }, { 'Set-Cookie': buildSessionCookie(token, Math.floor(2 * 60 * 60), TENANT_SESSION_COOKIE) });
};

const handleTenantSignOut = (request, response) => {
    const token = readTenantSessionToken(request);

    if (token) {
        tenantSessions.destroy(token);
    }

    sendJson(response, 200, { message: 'You are signed out.' }, { 'Set-Cookie': buildExpiredSessionCookie(TENANT_SESSION_COOKIE) });
};

const handleTenantPortal = (request, response) => {
    sendJson(response, 200, buildTenantPortal(findTenant(request.tenantId)));
};

const handleTenantProfileUpdate = async (request, response) => {
    const tenant = findTenant(request.tenantId);
    const nextEmail = normaliseEmail(request.body.email);

    if (!isValidEmail(nextEmail)) {
        sendJson(response, 400, { error: 'Enter a valid email address.' });
        return;
    }

    const conflict = tenants.find((item) => item.id !== request.tenantId && normaliseEmail(item.email) === nextEmail);

    if (conflict) {
        sendJson(response, 409, { error: 'Another EstatePro tenant already uses that email address.' });
        return;
    }

    const fullName = String(request.body.fullName || '').trim();
    const phone = String(request.body.phone || '').trim();
    const unit = String(request.body.unit || '').trim();

    if (fullName.length < 2) {
        sendJson(response, 400, { error: 'Enter your full name.' });
        return;
    }

    if (phone && !/^[+\d][\d\s()-]{7,}$/.test(phone)) {
        sendJson(response, 400, { error: 'Enter a valid phone number.' });
        return;
    }

    if (unit.length > 40) {
        sendJson(response, 400, { error: 'Please keep the unit reference under 40 characters.' });
        return;
    }

    tenant.fullName = fullName;
    tenant.email = nextEmail;
    tenant.phone = phone;
    tenant.unit = unit;
    tenant.updatedAt = new Date().toISOString();

    try {
        await persistTenants();
    } catch (error) {
        sendJson(response, 500, { error: 'Your profile could not be saved. Please try again.' });
        return;
    }

    sendJson(response, 200, { message: 'Your profile has been updated.', portal: buildTenantPortal(tenant) });
};

const handleTenantPasswordChange = async (request, response) => {
    const tenant = findTenant(request.tenantId);

    if (!tenant.password?.passwordHash) {
        sendJson(response, 409, {
            error: 'This account was created by your landlord, so there is no password to change yet.'
        });
        return;
    }

    const currentPassword = String(request.body.currentPassword || '');
    const currentMatches = await verifyPasswordRecord(tenant.password, currentPassword);

    if (!currentMatches) {
        sendJson(response, 401, { error: 'Your current password is not correct.' });
        return;
    }

    const newPassword = String(request.body.newPassword || '');

    if (!isPasswordStrongEnough(newPassword)) {
        sendJson(response, 400, { error: describePasswordRequirement() });
        return;
    }

    if (newPassword === currentPassword) {
        sendJson(response, 400, { error: 'Choose a password different from your current one.' });
        return;
    }

    tenant.password = await createPasswordRecord(newPassword);
    tenant.updatedAt = new Date().toISOString();

    try {
        await persistTenants();
    } catch (error) {
        sendJson(response, 500, { error: 'Your password could not be saved. Please try again.' });
        return;
    }

    sendJson(response, 200, { message: 'Your password has been changed.' });
};

const handleTenantPaymentSubmission = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin payment submissions are not allowed.' });
        return;
    }

    const tenant = findTenant(request.tenantId);

    const result = await createMpesaPaymentRequest({
        tenantName: tenant.fullName,
        tenantEmail: tenant.email,
        tenantPhone: tenant.phone,
        tenantId: tenant.id,
        propertyId: tenant.propertyId,
        unit: tenant.unit,
        periodKey: request.body.periodKey,
        paidAmount: request.body.amount,
        phoneNumber: request.body.phoneNumber || tenant.phone,
        /* Their own agreed rent governs what the portal already offered them. */
        rent: tenant.monthlyRent,
        source: 'tenant-portal'
    });

    if (result.code >= 400) {
        sendJson(response, result.code, result.body);
        return;
    }

    sendJson(response, result.code, {
        ...result.body,
        portal: buildTenantPortal(tenant)
    });
};

/* A tenant who has already sent rent to the Pochi la Biashara number records
   the M-Pesa confirmation code here. Nothing counts as paid yet: the claim
   waits for the landlord to verify it against the M-Pesa statement, which is
   what the dashboard's "awaiting verification" table is for. */
const handleTenantPochiClaim = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin payment submissions are not allowed.' });
        return;
    }

    const tenant = findTenant(request.tenantId);
    const property = properties.find((item) => item.id === tenant.propertyId) || null;

    if (!property) {
        sendJson(response, 400, {
            error: 'Your tenancy is not linked to a property yet, so a Pochi payment cannot be submitted. Contact your landlord.'
        });
        return;
    }

    const amount = Math.round(Number(request.body.amount));
    const unit = String(request.body.unit || tenant.unit || '').trim();
    const reference = String(request.body.reference || '').trim().toUpperCase();
    const payerPhone = normalizeKenyanPhone(request.body.phoneNumber || tenant.phone);
    const rentForPeriod = Math.max(0, Number(tenant.monthlyRent) || Number(property.monthlyRent) || 0);

    if (!Number.isFinite(amount) || amount <= 0 || amount > rentForPeriod) {
        sendJson(response, 400, { error: `Enter the amount you sent, up to KSh ${rentForPeriod.toLocaleString('en-KE')}.` });
        return;
    }

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(request.body.periodKey || '').trim())) {
        sendJson(response, 400, { error: 'Choose the rent period you paid for.' });
        return;
    }

    if (!unit || unit.length > 30) {
        sendJson(response, 400, { error: 'Enter the unit or house number.' });
        return;
    }

    if (!/^[A-Z0-9]{4,20}$/.test(reference)) {
        sendJson(response, 400, { error: 'Enter the M-Pesa confirmation code, such as SJL4K9ZQ2M.' });
        return;
    }

    if (!payerPhone) {
        sendJson(response, 400, { error: 'Enter the Safaricom number you sent the money from.' });
        return;
    }

    /* The same M-Pesa code must not be claimed twice, whether the earlier one
       is still waiting or has already been recorded against the rent. */
    const duplicate = payments.find((payment) => (
        paymentBelongsToTenant(payment, tenant)
        && payment.method === 'Pochi la Biashara'
        && String(payment.reference || '').toUpperCase() === reference
    ));

    if (duplicate) {
        sendJson(response, 409, {
            error: hasRecordedPayment(duplicate)
                ? 'That M-Pesa code has already been recorded against your rent.'
                : 'That M-Pesa code has already been submitted and is waiting for verification.'
        });
        return;
    }

    const { periodKey, period } = getPeriodDetails(String(request.body.periodKey).trim());
    const rentPeriod = {
        tenantId: tenant.id,
        tenantEmail: tenant.email,
        propertyId: property.id,
        unit,
        monthKey: periodKey
    };
    const outstanding = Math.max(0, rentForPeriod
        - totalPaidForRentPeriod(payments, rentPeriod) - reservedRentForPeriod(payments, rentPeriod));

    if (outstanding <= 0 || amount > outstanding) {
        sendJson(response, 400, {
            error: outstanding <= 0
                ? 'This rent period is already paid or has a payment waiting for verification. Do not pay twice.'
                : `The balance you can still pay is KSh ${outstanding.toLocaleString('en-KE')}.`
        });
        return;
    }

    const claim = {
        id: `claim-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        tenantId: tenant.id,
        tenantName: tenant.fullName,
        tenantEmail: tenant.email,
        tenantPhone: tenant.phone || null,
        payerPhone,
        propertyId: property.id,
        propertyName: property.name,
        location: property.location,
        unit,
        period,
        monthKey: periodKey,
        requestedAmount: amount,
        method: 'Pochi la Biashara',
        reference,
        providerReceipt: reference,
        status: 'Awaiting verification',
        paymentRequestStatus: 'pending',
        source: 'tenant-portal',
        createdAt: new Date().toISOString()
    };

    payments.push(claim);

    try {
        await persistPayments();
    } catch (error) {
        const index = payments.indexOf(claim);

        if (index !== -1) {
            payments.splice(index, 1);
        }

        console.error(`Pochi claim ${claim.id} could not be saved: ${error.message}`);
        sendJson(response, 500, { error: 'Your payment could not be submitted just now. Please try again.' });
        return;
    }

    sendJson(response, 201, {
        message: `Submitted. Your landlord will verify the M-Pesa code ${reference} before your rent is recorded.`,
        claim: {
            id: claim.id,
            amount: claim.requestedAmount,
            period: claim.period,
            reference: claim.reference,
            status: claim.paymentRequestStatus
        },
        portal: buildTenantPortal(tenant)
    });
};

const handleTenantMaintenanceList = (request, response) => {
    const listed = getTenantMaintenanceRequests(request.tenantId).map(summariseMaintenanceRequest);

    sendJson(response, 200, {
        requests: listed,
        openCount: listed.filter((item) => item.status !== 'Resolved' && item.status !== 'Cancelled').length
    });
};

const handleTenantMaintenanceCreate = async (request, response) => {
    const tenantId = request.tenantId;
    const throttle = maintenanceThrottle.check(tenantId);

    if (throttle.locked) {
        sendJson(response, 429, {
            error: `You have sent several requests already. Try again in ${throttle.retryAfterSeconds} seconds.`
        });
        return;
    }

    const tenant = findTenant(tenantId);
    const candidate = buildMaintenanceRequest(request.body, tenant);
    const problem = describeMaintenanceProblem(candidate);

    if (problem) {
        sendJson(response, 400, { error: problem });
        return;
    }

    const openDuplicate = getTenantMaintenanceRequests(tenantId).find((item) => item.status !== 'Resolved'
            && item.status !== 'Cancelled'
            && normaliseEmail(item.tenantEmail) === normaliseEmail(candidate.tenantEmail)
            && item.title.toLowerCase() === candidate.title.toLowerCase());

    if (openDuplicate) {
        sendJson(response, 409, { error: 'You already have an open request with that title.' });
        return;
    }

    const now = new Date().toISOString();
    const created = {
        id: `mnt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        ...candidate,
        propertyName: properties.find((item) => item.id === candidate.propertyId)?.name || tenant.propertyName || '',
        createdAt: now,
        updatedAt: now
    };

    maintenanceRequests.push(created);
    maintenanceThrottle.fail(tenantId);

    try {
        await persistMaintenanceRequests();
    } catch (error) {
        maintenanceRequests.pop();
        sendJson(response, 500, { error: 'Your request could not be saved. Please try again.' });
        return;
    }

    sendJson(response, 201, {
        message: 'Your maintenance request has been sent to your landlord.',
        request: summariseMaintenanceRequest(created),
        portal: buildTenantPortal(tenant)
    });
};

const handleTenantMaintenanceCancel = async (request, response) => {
    const tenantId = request.tenantId;
    const found = findMaintenanceRequest(request.params.requestId);

    if (!found || found.tenantId !== tenantId) {
        sendJson(response, 404, { error: 'We could not find that maintenance request on your account.' });
        return;
    }

    if (found.status === 'Resolved' || found.status === 'Cancelled') {
        sendJson(response, 409, { error: `That request is already ${found.status.toLowerCase()}.` });
        return;
    }

    found.status = 'Cancelled';
    found.landlordNotes = found.landlordNotes || 'Cancelled by the tenant.';
    found.updatedAt = new Date().toISOString();

    try {
        await persistMaintenanceRequests();
    } catch (error) {
        sendJson(response, 500, { error: 'Your request could not be updated. Please try again.' });
        return;
    }

    sendJson(response, 200, {
        message: 'Your request has been cancelled.',
        request: summariseMaintenanceRequest(found),
        portal: buildTenantPortal(findTenant(tenantId))
    });
};

const handleMaintenanceList = (request, response) => {
    const requestedStatus = queryValue(request.query.status) || 'all';
    const requestedProperty = queryValue(request.query.property);
    const searchTerm = queryValue(request.query.q).trim().toLowerCase();

    const listed = maintenanceRequests
        .map(summariseMaintenanceRequest)
        .filter((item) => {
            const statusMatches = requestedStatus === 'all' || item.status === requestedStatus;
            const propertyMatches = !requestedProperty || item.propertyId === requestedProperty;
            const searchMatches = !searchTerm || [
                item.title,
                item.description,
                item.category,
                item.tenantName,
                item.tenantEmail,
                item.unit,
                item.propertyName
            ].some((value) => String(value || '').toLowerCase().includes(searchTerm));

            return statusMatches && propertyMatches && searchMatches;
        })
        .sort((first, second) => {
            if (first.status === 'Resolved' || first.status === 'Cancelled') {
                if (second.status !== 'Resolved' && second.status !== 'Cancelled') {
                    return 1;
                }
            } else if (second.status === 'Resolved' || second.status === 'Cancelled') {
                return -1;
            }

            return String(second.createdAt).localeCompare(String(first.createdAt));
        });

    sendJson(response, 200, {
        requests: listed,
        counts: {
            all: maintenanceRequests.length,
            open: maintenanceRequests.filter((item) => item.status === 'Open').length,
            inProgress: maintenanceRequests.filter((item) => item.status === 'In progress').length,
            resolved: maintenanceRequests.filter((item) => item.status === 'Resolved').length,
            emergency: maintenanceRequests.filter((item) => item.urgency === 'Emergency' && item.status !== 'Resolved' && item.status !== 'Cancelled').length
        }
    });
};

const handleMaintenanceUpdate = async (request, response) => {
    const found = findMaintenanceRequest(request.params.requestId);

    if (!found) {
        sendJson(response, 404, { error: 'We could not find that maintenance request.' });
        return;
    }

    const nextStatus = request.body.status === undefined ? found.status : String(request.body.status || '').trim();
    const nextNotes = request.body.landlordNotes === undefined
        ? found.landlordNotes
        : String(request.body.landlordNotes || '').trim();

    if (!maintenanceStatuses.has(nextStatus)) {
        sendJson(response, 400, { error: `Status must be one of: ${[...maintenanceStatuses].join(', ')}.` });
        return;
    }

    if (nextNotes.length > 2000) {
        sendJson(response, 400, { error: 'Please keep notes under 2000 characters.' });
        return;
    }

    found.status = nextStatus;
    found.landlordNotes = nextNotes;
    found.updatedAt = new Date().toISOString();

    try {
        await persistMaintenanceRequests();
    } catch (error) {
        sendJson(response, 500, { error: 'The request could not be updated. Please try again.' });
        return;
    }

    sendJson(response, 200, {
        message: `Request marked ${nextStatus.toLowerCase()}.`,
        request: summariseMaintenanceRequest(found)
    });
};

/* ---- expenses and net income ---------------------------------------- */

/* A fixed category list keeps the "spending by category" breakdown tidy;
   anything unrecognised is filed under Other rather than creating a new
   bucket every time somebody types a variation. */
const expenseCategories = [
    'Repairs & maintenance',
    'Utilities',
    'Management fees',
    'Insurance',
    'Property tax',
    'Security',
    'Cleaning',
    'Supplies',
    'Marketing',
    'Other'
];
const expenseCategorySet = new Set(expenseCategories);
const expenseMethods = new Set(['Cash', 'M-Pesa', 'Bank Transfer', 'Card', 'Cheque', 'Other']);

const findExpense = (expenseId) => expenses.find((expense) => expense.id === expenseId) || null;

const expenseMonthKey = (expense) => String(expense?.expenseDate || '').slice(0, 7);

const currentMonthKeyNow = () => {
    const now = new Date();

    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const labelForMonthKey = (monthKey) => {
    const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);

    if (!match) {
        return String(monthKey || '');
    }

    const month = Number(match[2]);

    return `${monthNames[month - 1] || 'Current'} ${match[1]}`;
};

const buildExpenseFromPayload = (payload, existing = null) => {
    const pick = (key, fallback = '') => (payload[key] === undefined ? fallback : String(payload[key] || '').trim());
    const propertyId = pick('propertyId', existing?.propertyId);
    const property = properties.find((item) => item.id === propertyId);
    const amountWasProvided = payload.amount !== undefined && String(payload.amount).trim() !== '';
    const amount = amountWasProvided
        ? Math.round(Number(payload.amount))
        : Math.round(Number(existing?.amount) || 0);
    const requestedCategory = pick('category', existing?.category);
    const requestedMethod = pick('method', existing?.method);

    return {
        propertyId,
        propertyName: property?.name || existing?.propertyName || '',
        category: expenseCategorySet.has(requestedCategory) ? requestedCategory : 'Other',
        description: pick('description', existing?.description),
        vendor: pick('vendor', existing?.vendor),
        amount,
        /* The day the money left, which is what an expense is dated by, not the
           day the record was typed in. */
        expenseDate: pick('expenseDate', existing?.expenseDate) || new Date().toISOString().slice(0, 10),
        method: expenseMethods.has(requestedMethod) ? requestedMethod : (requestedMethod ? 'Other' : ''),
        notes: pick('notes', existing?.notes)
    };
};

const describeExpenseProblem = (candidate) => {
    if (!candidate.propertyId) {
        return 'Choose the property this expense belongs to.';
    }

    if (!properties.some((property) => property.id === candidate.propertyId)) {
        return 'That property could not be found.';
    }

    if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) {
        return 'Enter the amount you spent, as a number greater than zero.';
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate.expenseDate)) {
        return 'Enter the date the money was spent as YYYY-MM-DD.';
    }

    if (!candidate.description) {
        return 'Add a short description of what the expense was for.';
    }

    if (candidate.description.length > 200) {
        return 'Keep the description under 200 characters.';
    }

    if (candidate.vendor.length > 120) {
        return 'Keep the payee name under 120 characters.';
    }

    if (candidate.notes.length > 2000) {
        return 'Keep the notes under 2000 characters.';
    }

    return '';
};

const summariseExpense = (expense) => ({
    ...expense,
    amount: Math.max(0, Number(expense.amount) || 0),
    monthKey: expenseMonthKey(expense)
});

/* Rent collected for a month, optionally narrowed to one property. Only money
   that actually arrived counts, so an unpaid Pochi claim never flatters the
   net income figure. */
const collectedRentForMonth = (monthKey, propertyId = '') => payments
    .filter(hasRecordedPayment)
    .filter((payment) => !propertyId || payment.propertyId === propertyId)
    .filter((payment) => String(payment.monthKey || '') === monthKey)
    .reduce((total, payment) => total + (Number(payment.paidAmount) || 0), 0);

const expensesForMonth = (monthKey, propertyId = '') => expenses
    .filter((expense) => !propertyId || expense.propertyId === propertyId)
    .filter((expense) => expenseMonthKey(expense) === monthKey)
    .reduce((total, expense) => total + (Number(expense.amount) || 0), 0);

/* The last few months of collected rent, expenses and the difference between
   them, newest first, so the trend table always ends on the selected month. */
const buildNetIncomeMonths = (propertyId, endMonthKey, count) => {
    const match = String(endMonthKey || '').match(/^(\d{4})-(\d{2})$/);
    const now = new Date();
    let year = match ? Number(match[1]) : now.getFullYear();
    let month = match ? Number(match[2]) : now.getMonth() + 1;
    const rows = [];

    for (let index = 0; index < count; index += 1) {
        const key = `${year}-${String(month).padStart(2, '0')}`;
        const collected = collectedRentForMonth(key, propertyId);
        const spent = expensesForMonth(key, propertyId);

        rows.push({
            month: key,
            label: labelForMonthKey(key),
            collected,
            expenses: spent,
            net: collected - spent
        });

        month -= 1;

        if (month === 0) {
            month = 12;
            year -= 1;
        }
    }

    return rows;
};

const handleExpenseList = (request, response) => {
    const requestedProperty = queryValue(request.query.property);
    const requestedCategory = queryValue(request.query.category);
    const requestedMonth = queryValue(request.query.month) || currentMonthKeyNow();
    const searchTerm = queryValue(request.query.q).trim().toLowerCase();

    /* Property scope drives every figure, so a landlord looking at one property
       sees that property's net income rather than the whole portfolio's. */
    const scoped = expenses
        .map(summariseExpense)
        .filter((expense) => !requestedProperty || expense.propertyId === requestedProperty);

    const listed = scoped
        .filter((expense) => {
            const categoryMatches = !requestedCategory || expense.category === requestedCategory;
            const searchMatches = !searchTerm || [
                expense.description,
                expense.vendor,
                expense.propertyName,
                expense.category,
                expense.notes
            ].some((value) => String(value || '').toLowerCase().includes(searchTerm));

            return categoryMatches && searchMatches;
        })
        .sort((first, second) => (
            String(second.expenseDate).localeCompare(String(first.expenseDate))
            || String(second.createdAt).localeCompare(String(first.createdAt))
        ));

    const monthExpenses = scoped.filter((expense) => expense.monthKey === requestedMonth);
    const expenseTotal = monthExpenses.reduce((total, expense) => total + expense.amount, 0);
    const collected = collectedRentForMonth(requestedMonth, requestedProperty);
    const yearExpense = scoped
        .filter((expense) => expense.monthKey.slice(0, 4) === requestedMonth.slice(0, 4))
        .reduce((total, expense) => total + expense.amount, 0);

    const byCategory = expenseCategories
        .map((category) => {
            const matching = monthExpenses.filter((expense) => expense.category === category);

            return {
                category,
                total: matching.reduce((total, expense) => total + expense.amount, 0),
                count: matching.length
            };
        })
        .filter((row) => row.count)
        .sort((first, second) => second.total - first.total);

    sendJson(response, 200, {
        expenses: listed,
        counts: {
            all: scoped.length,
            filtered: listed.length,
            month: monthExpenses.length
        },
        categories: expenseCategories,
        methods: [...expenseMethods],
        totals: {
            month: requestedMonth,
            monthLabel: labelForMonthKey(requestedMonth),
            expenseTotal,
            expenseCount: monthExpenses.length,
            collected,
            netIncome: collected - expenseTotal,
            yearExpense,
            allTimeExpense: scoped.reduce((total, expense) => total + expense.amount, 0)
        },
        byCategory,
        months: buildNetIncomeMonths(requestedProperty, requestedMonth, 6)
    });
};

const handleExpenseCreate = async (request, response) => {
    const candidate = buildExpenseFromPayload(request.body);
    const problem = describeExpenseProblem(candidate);

    if (problem) {
        sendJson(response, 400, { error: problem });
        return;
    }

    const now = new Date().toISOString();
    const created = {
        id: `exp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        ...candidate,
        createdAt: now,
        updatedAt: now
    };

    expenses.push(created);

    try {
        await persistExpenses();
    } catch (error) {
        expenses.pop();
        sendJson(response, 500, { error: 'The expense could not be saved. Please try again.' });
        return;
    }

    sendJson(response, 201, {
        message: 'Expense recorded.',
        expense: summariseExpense(created)
    });
};

const handleExpenseUpdate = async (request, response) => {
    const found = findExpense(request.params.expenseId);

    if (!found) {
        sendJson(response, 404, { error: 'That expense could not be found.' });
        return;
    }

    const candidate = buildExpenseFromPayload(request.body, found);
    const problem = describeExpenseProblem(candidate);

    if (problem) {
        sendJson(response, 400, { error: problem });
        return;
    }

    const previous = { ...found };

    Object.assign(found, candidate, { updatedAt: new Date().toISOString() });

    try {
        await persistExpenses();
    } catch (error) {
        Object.assign(found, previous);
        sendJson(response, 500, { error: 'The expense could not be updated. Please try again.' });
        return;
    }

    sendJson(response, 200, {
        message: 'Expense updated.',
        expense: summariseExpense(found)
    });
};

const handleExpenseDelete = async (request, response) => {
    const index = expenses.findIndex((expense) => expense.id === request.params.expenseId);

    if (index === -1) {
        sendJson(response, 404, { error: 'That expense could not be found.' });
        return;
    }

    const [removed] = expenses.splice(index, 1);

    try {
        await persistExpenses();
    } catch (error) {
        expenses.splice(index, 0, removed);
        sendJson(response, 500, { error: 'The expense could not be removed. Please try again.' });
        return;
    }

    sendJson(response, 200, { message: 'Expense removed.' });
};

const handleTenantRegistration = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin registrations are not allowed.' });
        return;
    }

    const throttle = registrationThrottle.check(getClientKey(request));

    if (throttle.locked) {
        sendJson(response, 429, { error: 'Too many registrations from this device. Please try again later.' });
        return;
    }

    const candidate = buildTenantFromPayload(request.body);
    const problem = describeTenantProblem(candidate);

    if (problem) {
        sendJson(response, 400, { error: problem });
        return;
    }

    const alreadyOnFile = findTenantByEmail(candidate.email);
    const requestedPassword = String(request.body.password || '');

    if (alreadyOnFile) {
        /* Returning here rather than rejecting lets a tenant re-register on a
           new device, but the password is only set the first time so an
           existing account cannot be taken over by guessing an email. */
        const alreadyHasPassword = Boolean(alreadyOnFile.password?.passwordHash);

        if (alreadyHasPassword || !requestedPassword) {
            sendJson(response, 200, {
                message: 'You are already on the landlord\'s tenant list.',
                canSignIn: alreadyHasPassword,
                tenant: summariseTenant(alreadyOnFile)
            });
            return;
        }

        if (!isPasswordStrongEnough(requestedPassword)) {
            sendJson(response, 400, { error: describePasswordRequirement() });
            return;
        }

        alreadyOnFile.password = await createPasswordRecord(requestedPassword);
        alreadyOnFile.updatedAt = new Date().toISOString();

        try {
            await persistTenants();
        } catch (error) {
            delete alreadyOnFile.password;
            sendJson(response, 500, { error: 'Your account could not be updated. Please try again.' });
            return;
        }

        const claimToken = tenantSessions.create({ tenantId: alreadyOnFile.id });

        sendJson(response, 200, {
            message: 'Welcome back. Your tenant account is ready to use.',
            canSignIn: true,
            tenant: summariseTenant(alreadyOnFile)
        }, { 'Set-Cookie': buildSessionCookie(claimToken, Math.floor(2 * 60 * 60), TENANT_SESSION_COOKIE) });
        return;
    }

    if (!requestedPassword) {
        sendJson(response, 400, { error: 'Choose a password so you can sign in to your tenant area.' });
        return;
    }

    if (!isPasswordStrongEnough(requestedPassword)) {
        sendJson(response, 400, { error: describePasswordRequirement() });
        return;
    }

    const now = new Date().toISOString();
    const tenant = {
        id: `ten-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        ...candidate,
        password: await createPasswordRecord(requestedPassword),
        source: 'registration',
        createdAt: now,
        updatedAt: now
    };

    tenants.push(tenant);
    registrationThrottle.fail(getClientKey(request));

    try {
        await persistTenants();
    } catch (error) {
        tenants.pop();
        sendJson(response, 500, { error: 'Your registration could not be saved. Please try again.' });
        return;
    }

    const token = tenantSessions.create({ tenantId: tenant.id });

    sendJson(response, 201, {
        message: 'Registration received.',
        canSignIn: true,
        tenant: summariseTenant(tenant)
    }, { 'Set-Cookie': buildSessionCookie(token, Math.floor(2 * 60 * 60), TENANT_SESSION_COOKIE) });
};

/* Moves accounts created in the older browser-only build onto the server, so
   the landlord's tenant list is not silently missing tenants already known. */
const handleTenantImport = async (request, response) => {
    const incoming = Array.isArray(request.body.accounts) ? request.body.accounts : [];
    const created = [];
    let skipped = 0;
    const now = new Date().toISOString();
    /* Accounts from the older build never recorded a property, so they land on
       the first property and the landlord can correct them afterwards. */
    const fallback = properties.length ? properties[0].id : '';

    incoming.forEach((account) => {
        const candidate = buildTenantFromPayload(account, null, { defaultPropertyId: fallback });

        if (describeTenantProblem(candidate) || findTenantByEmail(candidate.email)) {
            skipped += 1;
            return;
        }

        const tenant = {
            id: `ten-${Date.now()}-${created.length}-${crypto.randomBytes(2).toString('hex')}`,
            ...candidate,
            source: 'browser-import',
            createdAt: account.registeredAt || now,
            updatedAt: now
        };

        tenants.push(tenant);
        created.push(tenant.fullName);
    });

    if (created.length) {
        try {
            await persistTenants();
        } catch (error) {
            sendJson(response, 500, { error: 'Those accounts could not be imported. Please try again.' });
            return;
        }
    }

    sendJson(response, 200, { imported: created.length, skipped });
};

const handlePropertyList = (request, response) => {
    sendJson(response, 200, properties);
};

const handlePropertyRecommend = (request, response) => {
    const requestedType = queryValue(request.query.type);
    const budgetParam = queryValue(request.query.maxBudget);
    const requestedBudget = budgetParam ? Number(budgetParam) : Number.NaN;

    let recommendations = properties.filter((property) => {
        const typeMatches = !requestedType || property.size === requestedType;
        const budgetMatches = !Number.isFinite(requestedBudget) || property.monthlyRent <= requestedBudget;
        return typeMatches && budgetMatches;
    });

    recommendations = recommendations.filter((property) => property.status === 'Available');

    sendJson(response, 200, recommendations);
};

const handlePropertyDetail = (request, response) => {
    const property = properties.find((item) => item.id === request.params.propertyId);

    if (!property) {
        sendJson(response, 404, { error: 'Property not found' });
        return;
    }

    sendJson(response, 200, property);
};

const propertyStatuses = new Set(['Available', 'Occupied']);
const propertySizes = new Set(['single-room', 'bedsitter', '1-bedroom', '2-bedroom', '3-bedroom', '4-bedroom']);
const propertyTypeForSize = {
    'single-room': 'Single room',
    bedsitter: 'Bedsitter',
    '1-bedroom': 'Apartment',
    '2-bedroom': 'Apartment',
    '3-bedroom': 'Apartment',
    '4-bedroom': 'Family home'
};
const bedsForSize = {
    'single-room': 1,
    bedsitter: 1,
    '1-bedroom': 1,
    '2-bedroom': 2,
    '3-bedroom': 3,
    '4-bedroom': 4
};
const rentPriceFormatter = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });

const formatPropertyPrice = (monthlyRent) => `KSh ${rentPriceFormatter.format(monthlyRent)}/month`;

const slugifyPropertyName = (name) => String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

const uniquePropertyId = (name) => {
    const base = slugifyPropertyName(name) || `property-${crypto.randomBytes(3).toString('hex')}`;

    if (!properties.some((item) => item.id === base)) {
        return base;
    }

    return `${base}-${crypto.randomBytes(3).toString('hex')}`;
};

const parseAmenityList = (value) => {
    const raw = Array.isArray(value) ? value : String(value || '').split(/[,;\n]/);

    return [...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 12);
};

const buildPropertyFromPayload = (payload, existing = null) => {
    const pick = (key, fallback = '') => (payload[key] === undefined ? fallback : String(payload[key] || '').trim());
    const size = pick('size', existing?.size);
    const type = pick('type', existing?.type || propertyTypeForSize[size] || 'Apartment');
    const rentWasProvided = payload.monthlyRent !== undefined && String(payload.monthlyRent).trim() !== '';
    const monthlyRent = rentWasProvided
        ? Math.round(Number(payload.monthlyRent))
        : Math.round(Number(existing?.monthlyRent) || 0);
    const bedsWereProvided = payload.beds !== undefined && String(payload.beds).trim() !== '';
    const bathsWereProvided = payload.baths !== undefined && String(payload.baths).trim() !== '';
    const beds = bedsWereProvided ? Math.round(Number(payload.beds)) : Number(existing?.beds ?? bedsForSize[size] ?? 1);
    const baths = bathsWereProvided ? Math.round(Number(payload.baths)) : Number(existing?.baths ?? 1);
    const name = pick('name', existing?.name);
    const location = pick('location', existing?.location);
    const amenities = payload.amenities === undefined && existing
        ? (Array.isArray(existing.amenities) ? existing.amenities : [])
        : parseAmenityList(payload.amenities);

    return {
        name,
        location,
        status: pick('status', existing?.status || 'Available'),
        type,
        size,
        monthlyRent,
        price: Number.isFinite(monthlyRent) && monthlyRent >= 0 ? formatPropertyPrice(monthlyRent) : '',
        beds,
        baths,
        parking: pick('parking', existing?.parking || 'Parking'),
        description: pick('description', existing?.description),
        owner: pick('owner', existing?.owner),
        alt: pick('alt', existing?.alt) || (name && location ? `${name} in ${location}` : name),
        availability: pick('availability', existing?.availability || (pick('status', existing?.status || 'Available') === 'Occupied' ? 'Occupied' : 'Available now')),
        amenities
    };
};

const describePropertyProblem = (candidate) => {
    if (candidate.name.length < 2 || candidate.name.length > 120) {
        return 'Enter a property name between 2 and 120 characters.';
    }

    if (candidate.location.length < 2 || candidate.location.length > 120) {
        return 'Enter the property location.';
    }

    if (!propertySizes.has(candidate.size)) {
        return 'Choose a home type from single room through to 4 bedroom.';
    }

    if (candidate.type.length < 2 || candidate.type.length > 40) {
        return 'Enter a short property type, such as Apartment or Family home.';
    }

    if (!propertyStatuses.has(candidate.status)) {
        return 'Choose whether this property is available or occupied.';
    }

    if (!Number.isFinite(candidate.monthlyRent) || candidate.monthlyRent < 0 || candidate.monthlyRent > 10000000) {
        return 'Enter a monthly rent in Kenya Shillings.';
    }

    if (!Number.isInteger(candidate.beds) || candidate.beds < 0 || candidate.beds > 20) {
        return 'Enter how many bedrooms this home has.';
    }

    if (!Number.isInteger(candidate.baths) || candidate.baths < 0 || candidate.baths > 20) {
        return 'Enter how many bathrooms this home has.';
    }

    if (candidate.parking.length > 40) {
        return 'Keep the parking note under 40 characters.';
    }

    if (candidate.description.length > 800) {
        return 'Keep the description under 800 characters.';
    }

    if (candidate.owner.length > 80) {
        return 'Keep the owner or company name under 80 characters.';
    }

    if (candidate.availability.length > 60) {
        return 'Keep the availability note under 60 characters.';
    }

    return null;
};

const findProperty = (propertyId) => properties.find((item) => item.id === propertyId) || null;

const countTenantsOnProperty = (propertyId) => tenants.filter((tenant) => tenant.propertyId === propertyId).length;

const syncPropertyDetailsToDependents = (property) => {
    tenants.forEach((tenant) => {
        if (tenant.propertyId === property.id) {
            tenant.propertyName = property.name;
            tenant.location = property.location;
        }
    });

    payments.forEach((payment) => {
        if (payment.propertyId === property.id) {
            payment.propertyName = property.name;
            payment.location = property.location;
        }
    });
};

const getPropertyImages = (property) => {
    const images = Array.isArray(property?.images)
        ? property.images.filter((image) => typeof image === 'string' && image)
        : [];

    if (images.length) {
        return images;
    }

    return property?.image ? [property.image] : [];
};

const unlinkUploadedPropertyImage = async (image) => {
    if (!String(image || '').startsWith('/uploads/properties/')) {
        return;
    }

    const absolutePath = path.join(propertyImageDirectory, path.basename(image));

    try {
        await fs.promises.unlink(absolutePath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(error);
        }
    }
};

const handlePropertyCreate = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin property changes are not allowed.' });
        return;
    }

    const candidate = buildPropertyFromPayload(request.body);
    const problem = describePropertyProblem(candidate);

    if (problem) {
        sendJson(response, 400, { error: problem });
        return;
    }

    const now = new Date().toISOString();
    const property = {
        id: uniquePropertyId(candidate.name),
        ...candidate,
        image: '',
        images: [],
        createdAt: now,
        updatedAt: now
    };

    properties.push(property);

    try {
        await persistProperties();
    } catch (error) {
        properties.pop();
        sendJson(response, 500, { error: 'The property could not be saved. Please try again.' });
        return;
    }

    sendJson(response, 201, { message: `${property.name} was added to your listings.`, property });
};

const handlePropertyUpdate = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin property changes are not allowed.' });
        return;
    }

    const property = findProperty(request.params.propertyId);

    if (!property) {
        sendJson(response, 404, { error: 'Property not found.' });
        return;
    }

    const candidate = buildPropertyFromPayload(request.body, property);
    const problem = describePropertyProblem(candidate);

    if (problem) {
        sendJson(response, 400, { error: problem });
        return;
    }

    const previous = { ...property };
    Object.assign(property, candidate, { updatedAt: new Date().toISOString() });
    syncPropertyDetailsToDependents(property);

    try {
        await persistProperties();
        await persistTenants();
        await persistPayments();
    } catch (error) {
        Object.assign(property, previous);
        sendJson(response, 500, { error: 'The property could not be updated. Please try again.' });
        return;
    }

    sendJson(response, 200, { message: `${property.name} was updated.`, property });
};

const handlePropertyDelete = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin property changes are not allowed.' });
        return;
    }

    const index = properties.findIndex((item) => item.id === request.params.propertyId);

    if (index === -1) {
        sendJson(response, 404, { error: 'Property not found.' });
        return;
    }

    const occupantCount = countTenantsOnProperty(request.params.propertyId);

    if (occupantCount) {
        sendJson(response, 409, {
            error: `Move or remove ${occupantCount} tenant${occupantCount === 1 ? '' : 's'} from this property before deleting it.`
        });
        return;
    }

    const [removed] = properties.splice(index, 1);

    try {
        await persistProperties();
    } catch (error) {
        properties.splice(index, 0, removed);
        sendJson(response, 500, { error: 'The property could not be removed. Please try again.' });
        return;
    }

    await Promise.all(getPropertyImages(removed).map((image) => unlinkUploadedPropertyImage(image)));

    sendJson(response, 200, { message: `${removed.name} was removed from your listings.` });
};

const handlePropertyImageUpload = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin property photo uploads are not allowed.' });
        return;
    }

    const property = properties.find((item) => item.id === request.params.propertyId);

    if (!property) {
        sendJson(response, 404, { error: 'Property not found.' });
        return;
    }

    const file = request.file;
    const imageType = file && Array.from(propertyImageTypes.values()).find(({ signature }) => signature(file.buffer));

    if (!imageType) {
        sendJson(response, 415, { error: 'Choose a valid JPEG, PNG, WebP, or GIF image.' });
        return;
    }

    const images = Array.isArray(property.images)
        ? property.images.filter((image) => typeof image === 'string' && image)
        : (property.image ? [property.image] : []);

    if (images.length >= maxPropertyImages) {
        sendJson(response, 400, { error: `A property can have up to ${maxPropertyImages} photos.` });
        return;
    }

    const filename = `${crypto.randomBytes(16).toString('hex')}${imageType.extension}`;
    const imagePath = `/uploads/properties/${filename}`;
    const absolutePath = path.join(propertyImageDirectory, filename);
    const previousImages = property.images;
    const previousImage = property.image;

    try {
        await fs.promises.mkdir(propertyImageDirectory, { recursive: true });
        await fs.promises.writeFile(absolutePath, file.buffer, { flag: 'wx' });

        property.images = [imagePath, ...images];
        property.image = imagePath;
        await persistProperties();
    } catch (error) {
        property.images = previousImages;
        property.image = previousImage;

        try {
            await fs.promises.unlink(absolutePath);
        } catch (cleanupError) {
            if (cleanupError.code !== 'ENOENT') {
                console.error(cleanupError);
            }
        }

        throw error;
    }

    sendJson(response, 201, { image: imagePath, images: property.images });
};

const handlePropertyImageUploadError = (error, request, response, next) => {
    if (!(error instanceof multer.MulterError)) {
        next(error);
        return;
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
        sendJson(response, 413, { error: 'Each photo must be 5 MB or smaller.' });
        return;
    }

    sendJson(response, 400, { error: 'The selected photos could not be uploaded.' });
};

const handlePropertyImageDelete = async (request, response) => {
    if (!isSameOriginRequest(request)) {
        sendJson(response, 403, { error: 'Cross-origin property photo changes are not allowed.' });
        return;
    }

    const property = properties.find((item) => item.id === request.params.propertyId);

    if (!property) {
        sendJson(response, 404, { error: 'Property not found.' });
        return;
    }

    const index = Number(request.params.imageIndex);
    const images = Array.isArray(property.images)
        ? property.images.filter((image) => typeof image === 'string' && image)
        : (property.image ? [property.image] : []);

    if (!Number.isInteger(index) || index < 0 || index >= images.length) {
        sendJson(response, 404, { error: 'Property photo not found.' });
        return;
    }

    const [removedImage] = images.splice(index, 1);
    const previousImages = property.images;
    const previousImage = property.image;

    try {
        property.images = images;
        property.image = images[0] || '';
        await persistProperties();
    } catch (error) {
        property.images = previousImages;
        property.image = previousImage;
        throw error;
    }

    const uploadPrefix = '/uploads/properties/';
    if (removedImage.startsWith(uploadPrefix)) {
        const filename = path.basename(removedImage);
        const absolutePath = path.join(propertyImageDirectory, filename);
        try {
            await fs.promises.unlink(absolutePath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(error);
            }
        }
    }

    sendJson(response, 200, { images: property.images });
};

const app = express();

app.disable('x-powered-by');
/* API answers were never cached, and the previous server sent no ETag, so no
   304 responses are generated here either. */
app.set('etag', false);
app.use(applySecurityHeaders);

/* Preserve the legacy JSON parsing behavior for non-multipart bodies, but
   leave multipart requests untouched for route-specific upload middleware. */
const parseJsonBody = express.json({
    limit: maxBodyBytes,
    strict: false,
    type: (request) => !/^multipart\/form-data(?:;|$)/i.test(request.headers['content-type'] || '')
});

const requireJsonObject = (request, response, next) => {
    /* Express leaves the body undefined when the request carries none, which a
       read-only route or a sign-out is a normal case for. */
    const payload = request.body ?? {};

    if (typeof payload !== 'object' || Array.isArray(payload)) {
        sendJson(response, 400, { error: 'Request body must be a JSON object' });
        return;
    }

    request.body = payload;
    next();
};

/* A body that is oversized, malformed, or not valid UTF-8 becomes the same
   plain JSON error the old hand-rolled reader produced. */
const handleBodyError = (error, request, response, next) => {
    if (!error) {
        next();
        return;
    }

    if (error.type === 'entity.too.large' || error.status === 413) {
        sendJson(response, 413, { error: 'Request body is too large' });
        return;
    }

    if (error.type === 'entity.parse.failed' || error.type === 'charset.unsupported' || error.status === 400) {
        sendJson(response, 400, { error: error.message || 'Invalid request' });
        return;
    }

    next(error);
};

const api = express.Router();

api.use(parseJsonBody, handleBodyError, requireJsonObject);

api.post('/mpesa/callback', handleMpesaCallback);
api.get('/mpesa/config', handleMpesaConfig);
api.get('/health', (request, response) => {
    sendJson(response, 200, { status: 'ok' });
});

api.get('/admin/session', handleAdminSessionStatus);
api.post('/admin/session', handleAdminSignIn);
api.delete('/admin/session', handleAdminSignOut);
api.post('/admin/setup', handleAdminSetup);
api.post('/admin/password', handleAdminPasswordChange);

api.get('/properties', handlePropertyList);
api.get('/properties/recommend', handlePropertyRecommend);
api.post('/properties', requireAdminSession, handlePropertyCreate);
api.get('/properties/:propertyId', handlePropertyDetail);
api.put('/properties/:propertyId', requireAdminSession, handlePropertyUpdate);
api.patch('/properties/:propertyId', requireAdminSession, handlePropertyUpdate);
api.delete('/properties/:propertyId', requireAdminSession, handlePropertyDelete);
api.delete('/properties/:propertyId/images/:imageIndex', requireAdminSession, handlePropertyImageDelete);

api.post('/payments', handlePaymentSubmission);
api.post('/pochi-claim', handlePublicPochiClaim);
api.get('/payments', handlePaymentList);
api.get('/rent-bill', handleRentBill);
api.get('/payment-requests', requireAdminSession, handlePaymentRequestList);
api.post('/payment-requests/:requestId/confirm', requireAdminSession, handlePaymentRequestConfirmation);
api.post('/payment-requests/:requestId/reject', requireAdminSession, handlePaymentRequestRejection);
api.post('/payment-requests/:requestId/check', requireAdminSession, handlePaymentRequestCheck);
api.get('/payment-requests/:requestId/status', handlePaymentRequestStatus);

/* Tenant self-service namespace. Kept singular so it never collides with
   the landlord's /tenants/:tenantId routes. */
api.get('/tenant/session', handleTenantSessionStatus);
api.post('/tenant/session', handleTenantSignIn);
api.delete('/tenant/session', handleTenantSignOut);
api.get('/tenant/portal', requireTenantSession, handleTenantPortal);
api.put('/tenant/profile', requireTenantSession, handleTenantProfileUpdate);
api.patch('/tenant/profile', requireTenantSession, handleTenantProfileUpdate);
api.post('/tenant/password', requireTenantSession, handleTenantPasswordChange);
api.post('/tenant/payments', requireTenantSession, handleTenantPaymentSubmission);
api.post('/tenant/payments/pochi', requireTenantSession, handleTenantPochiClaim);
api.get('/tenant/maintenance', requireTenantSession, handleTenantMaintenanceList);
api.post('/tenant/maintenance', requireTenantSession, handleTenantMaintenanceCreate);
api.post('/tenant/maintenance/:requestId/cancel', requireTenantSession, handleTenantMaintenanceCancel);

/* Landlord maintenance workspace. */
api.get('/maintenance', requireAdminSession, handleMaintenanceList);
api.post('/maintenance', (request, response) => {
    sendJson(response, 405, { error: 'Maintenance requests are raised by tenants, not created here.' });
});
api.put('/maintenance/:requestId', requireAdminSession, handleMaintenanceUpdate);
api.patch('/maintenance/:requestId', requireAdminSession, handleMaintenanceUpdate);

/* Landlord expense ledger, which feeds the net income figures. */
api.get('/expenses', requireAdminSession, handleExpenseList);
api.post('/expenses', requireAdminSession, handleExpenseCreate);
api.put('/expenses/:expenseId', requireAdminSession, handleExpenseUpdate);
api.patch('/expenses/:expenseId', requireAdminSession, handleExpenseUpdate);
api.delete('/expenses/:expenseId', requireAdminSession, handleExpenseDelete);

api.post('/tenants/register', handleTenantRegistration);
api.post('/tenants/import', requireAdminSession, handleTenantImport);
api.get('/tenants', requireAdminSession, handleTenantList);
api.post('/tenants', requireAdminSession, handleTenantCreate);
api.get('/tenants/:tenantId', requireAdminSession, handleTenantProfile);
api.put('/tenants/:tenantId', requireAdminSession, handleTenantUpdate);
api.patch('/tenants/:tenantId', requireAdminSession, handleTenantUpdate);
api.delete('/tenants/:tenantId', requireAdminSession, handleTenantDelete);
api.post('/tenants/:tenantId/payments', requireAdminSession, handleTenantPayment);

/* Anything under /api that reached here matched no route, so it is a missing
   endpoint on a read, or a method the endpoint does not support. */
api.all('/{*path}', (request, response) => {
    if (request.method === 'GET' || request.method === 'HEAD') {
        sendJson(response, 404, { error: 'API route not found' });
        return;
    }

    sendJson(response, 405, { error: 'Method not allowed' });
});

app.post(
    '/api/properties/:propertyId/images',
    requireAdminSession,
    propertyImageUpload,
    handlePropertyImageUploadError,
    handlePropertyImageUpload
);
app.use('/api', api);

/* Only reading is ever meant to happen outside the API. */
app.use((request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
    }

    next();
});

app.use('/data', (request, response) => {
    sendJson(response, 404, { error: 'Not found' });
});

/* A page behind a sign-in is sent to the matching sign-in form with the address
   it was asked for, so the visitor lands back where they were going. */
const redirectToSignIn = (request, response, loginPage) => {
    const location = `/${loginPage}?next=${encodeURIComponent(request.originalUrl)}`;

    response.set('Cache-Control', 'no-store');
    response.redirect(302, location);
};

app.use((request, response, next) => {
    if (isAdminOnlyPage(request.path) && !isAdminAuthenticated(request)) {
        redirectToSignIn(request, response, 'admin-login.html');
        return;
    }

    if (isTenantOnlyPage(request.path) && !isTenantAuthenticated(request)) {
        redirectToSignIn(request, response, 'tenant-login.html');
        return;
    }

    next();
});

app.use(express.static(rootDirectory, {
    index: 'index.html',
    redirect: false,
    setHeaders: (response, filePath) => {
        const relative = path.relative(rootDirectory, filePath).split(path.sep).join('/');
        /* Anything behind a sign-in must never sit in a shared cache. */
        const isPrivateAsset = isAdminOnlyPage(`/${relative}`) || isTenantOnlyPage(`/${relative}`);

        response.setHeader('Cache-Control', isPrivateAsset ? 'no-store' : 'no-cache');
    }
}));

app.use((request, response) => {
    response.set('Content-Type', 'text/plain; charset=utf-8');
    response.status(404).send('Not found');
});

/* Nothing below should ever be reached, but a crash must not take the
   process down or leak a stack trace to the browser. */
app.use((error, request, response, next) => {
    if (response.headersSent) {
        next(error);
        return;
    }

    const status = Number(error.status || error.statusCode) || 500;

    if (status >= 500) {
        console.error(error);
    }

    sendJson(response, status, { error: status >= 500 ? 'Server error' : (error.message || 'Invalid request') });
});

const describePortConflict = async () => {
    try {
        const response = await fetch(`http://localhost:${port}/api/admin/session`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(2000)
        });
        const data = await response.json().catch(() => ({}));
        const isEstatePro = typeof data?.configured === 'boolean';

        if (isEstatePro) {
            return `EstatePro is already running at http://localhost:${port}. Open that address instead of starting a second copy.`;
        }
    } catch {
        // Nothing answered on the port, so it belongs to another program.
    }

    return `Port ${port} is already in use by another program. Close it, or start EstatePro on a different port with: set PORT=3001 && npm start`;
};

let server;

const stopWithError = (message) => {
    console.error(message);
    process.exitCode = 1;
    server?.close();
};

const startServer = async () => {
    await connectDatabase();
    console.log('Connected to MongoDB.');

    const data = await loadApplicationData();
    properties.push(...data.properties.map(({ _id, ...record }) => record));
    payments.push(...data.payments.map(({ _id, ...record }) => record));
    tenants.push(...data.tenants.map(({ _id, ...record }) => record));
    maintenanceRequests.push(...data.maintenance.map(({ _id, ...record }) => record));
    expenses.push(...data.expenses.map(({ _id, ...record }) => record));
    await reconcileInterruptedMpesaRequests();
    adminCredentials = createAdminCredentials(data.admin);
    await linkPaymentsToTenants();

    server = app.listen(port, () => {
        const configured = adminCredentials.isConfigured();

        console.log(`EstatePro is running at http://localhost:${port}`);
        console.log(`Landlord sign-in: http://localhost:${port}/admin-login.html`);
        console.log(configured
            ? 'Landlord dashboard is password protected.'
            : 'No admin password yet. Open the sign-in page to create one before the dashboard is used.');

        if (!configured) {
            console.log('Tip: run "npm run admin:password" to set it from the terminal.');
        }
    });

    server.on('error', async (error) => {
        if (error.code === 'EADDRINUSE') {
            stopWithError(await describePortConflict());
            return;
        }

        if (error.code === 'EACCES') {
            stopWithError(`EstatePro cannot use port ${port}. Try a different port: set PORT=3001 && npm start`);
            return;
        }

        stopWithError(`The EstatePro server could not start: ${error.message}`);
    });
};

startServer().catch((error) => {
    stopWithError(`EstatePro could not connect to MongoDB at ${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/estatepro'}: ${error.message}`);
    process.exitCode = 1;
});
