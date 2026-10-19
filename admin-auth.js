const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_COOKIE = 'estatepro_admin';
const TENANT_SESSION_COOKIE = 'estatepro_tenant';
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 10;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const toHex = (buffer) => buffer.toString('hex');

/* Windows keeps a file locked for as long as anything holds it open, so the
   rename is retried briefly rather than reported as a failed save. */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRY_ATTEMPTS = 5;
const sleepFor = (milliseconds) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const renameWithRetry = (from, to) => {
    for (let attempt = 1; ; attempt += 1) {
        try {
            fs.renameSync(from, to);
            return;
        } catch (error) {
            if (attempt >= RENAME_RETRY_ATTEMPTS || !RENAME_RETRY_CODES.has(error.code)) {
                throw error;
            }

            sleepFor(attempt * 20);
        }
    }
};

/* A save is written to a temporary file beside the real one and then renamed
   over it, so a crash or a full disk can only ever leave the previous contents
   in place. Writing the file in place could leave it half written, which the
   next start would have to treat as corrupt data. */
const writeFileAtomically = (filePath, contents, { mode } = {}) => {
    const directory = path.dirname(filePath);
    const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);

    try {
        fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8', ...(mode === undefined ? {} : { mode }) });
        renameWithRetry(temporaryPath, filePath);
    } catch (error) {
        try {
            fs.unlinkSync(temporaryPath);
        } catch (cleanupError) {
            /* Nothing to clean up if the temporary file was never created. */
        }

        throw error;
    }
};

const writeJsonFileAtomically = (filePath, value, options) => {
    writeFileAtomically(filePath, `${JSON.stringify(value, null, 4)}\n`, options);
};

const hashPassword = (password, salt) => new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (error, derivedKey) => {
        if (error) {
            reject(error);
            return;
        }

        resolve(toHex(derivedKey));
    });
});

const isPasswordStrongEnough = (password) => {
    const value = String(password || '');

    return value.length >= PASSWORD_MIN_LENGTH
        && /[A-Za-z]/.test(value)
        && /\d/.test(value);
};

const describePasswordRequirement = () => `Use at least ${PASSWORD_MIN_LENGTH} characters with a letter and a number.`;

const createPasswordRecord = async (password) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(password, salt);

    return {
        salt,
        passwordHash,
        algorithm: 'scrypt',
        updatedAt: new Date().toISOString()
    };
};

const verifyPasswordRecord = async (record, password) => {
    if (!record || !record.salt || !record.passwordHash) {
        return false;
    }

    const candidateHash = await hashPassword(String(password || ''), record.salt);
    const expected = Buffer.from(String(record.passwordHash), 'hex');
    const candidate = Buffer.from(candidateHash, 'hex');

    if (expected.length !== candidate.length || expected.length === 0) {
        return false;
    }

    return crypto.timingSafeEqual(expected, candidate);
};

const createAdminStore = (initialRecord, { persist, onCredentialChange } = {}) => {
    let cachedRecord = initialRecord || null;

    const read = () => cachedRecord;

    const write = async (password) => {
        const record = await createPasswordRecord(password);

        if (typeof persist !== 'function') {
            throw new Error('Administrator credential storage is not configured.');
        }

        await persist(record);
        cachedRecord = record;

        if (typeof onCredentialChange === 'function') {
            onCredentialChange();
        }

        return record;
    };

    return {
        read,
        write,
        isConfigured: () => Boolean(read()?.passwordHash),
        verify: (password) => verifyPasswordRecord(read(), password)
    };
};

const createSessionStore = ({ ttlMs = SESSION_TTL_MS } = {}) => {
    const sessions = new Map();

    const prune = () => {
        const now = Date.now();

        for (const [token, session] of sessions) {
            if (session.expiresAt <= now) {
                sessions.delete(token);
            }
        }
    };

    const timer = setInterval(prune, 5 * 60 * 1000);

    if (typeof timer.unref === 'function') {
        timer.unref();
    }

    return {
        /* Sessions may carry an identifier so a token can be resolved to the
           record it belongs to. Admin sessions pass nothing and stay opaque. */
        create: (data = null) => {
            prune();
            const token = crypto.randomBytes(32).toString('hex');
            const details = data && typeof data === 'object' && !Array.isArray(data) ? data : {};

            sessions.set(token, {
                ...details,
                createdAt: Date.now(),
                expiresAt: Date.now() + ttlMs
            });

            return token;
        },
        read: (token) => {
            if (!token) {
                return null;
            }

            const session = sessions.get(token);

            if (!session) {
                return null;
            }

            if (session.expiresAt <= Date.now()) {
                sessions.delete(token);
                return null;
            }

            return session;
        },
        destroy: (token) => {
            if (token) {
                sessions.delete(token);
            }
        },
        destroyAll: () => {
            sessions.clear();
        },
        size: () => sessions.size
    };
};

const createAttemptThrottle = ({
    maxAttempts = MAX_FAILED_ATTEMPTS,
    windowMs = ATTEMPT_WINDOW_MS,
    lockoutMs = LOCKOUT_MS
} = {}) => {
    const records = new Map();

    return {
        check: (key) => {
            const record = records.get(key);
            const now = Date.now();

            if (!record) {
                return { locked: false, retryAfterSeconds: 0, remaining: maxAttempts };
            }

            if (record.lockedUntil > now) {
                return {
                    locked: true,
                    retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000),
                    remaining: 0
                };
            }

            if (now - record.windowStartedAt > windowMs) {
                records.delete(key);

                return { locked: false, retryAfterSeconds: 0, remaining: maxAttempts };
            }

            return {
                locked: false,
                retryAfterSeconds: 0,
                remaining: Math.max(0, maxAttempts - record.failures)
            };
        },
        fail: (key) => {
            const now = Date.now();
            const record = records.get(key);

            if (!record || now - record.windowStartedAt > windowMs) {
                records.set(key, { failures: 1, windowStartedAt: now, lockedUntil: 0 });
                return;
            }

            record.failures += 1;

            if (record.failures >= maxAttempts) {
                record.lockedUntil = now + lockoutMs;
            }
        },
        reset: (key) => {
            records.delete(key);
        }
    };
};

const parseCookies = (cookieHeader) => {
    const cookies = {};

    String(cookieHeader || '')
        .split(';')
        .forEach((part) => {
            const separatorIndex = part.indexOf('=');

            if (separatorIndex < 1) {
                return;
            }

            const name = part.slice(0, separatorIndex).trim();
            const value = part.slice(separatorIndex + 1).trim();

            if (!name) {
                return;
            }

            try {
                cookies[name] = decodeURIComponent(value);
            } catch (error) {
                cookies[name] = value;
            }
        });

    return cookies;
};

const buildSessionCookie = (
    token,
    maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000),
    cookieName = SESSION_COOKIE
) => [
    `${cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
].join('; ');

const buildExpiredSessionCookie = (cookieName = SESSION_COOKIE) => buildSessionCookie('', 0, cookieName);

const getClientKey = (request) => {
    const forwarded = String(request.headers['x-forwarded-for'] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)[0];

    return forwarded || request.socket?.remoteAddress || 'unknown';
};

module.exports = {
    SESSION_COOKIE,
    TENANT_SESSION_COOKIE,
    SESSION_TTL_MS,
    PASSWORD_MIN_LENGTH,
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
    describePasswordRequirement,
    writeFileAtomically,
    writeJsonFileAtomically
};
