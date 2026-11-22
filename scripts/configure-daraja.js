#!/usr/bin/env node
/* Safely store Daraja credentials in .env from your own machine.
   Secrets are never printed and never sent anywhere except Safaricom by the
   main server. Values can also be supplied through DARAJA_CONSUMER_KEY and
   DARAJA_CONSUMER_SECRET environment variables for non-interactive use. */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const envPath = path.join(__dirname, '..', '.env');

const formatValue = (value) => {
    const clean = String(value).replace(/\r?\n/g, ' ').trim();
    return /[\s#"'\\]/.test(clean) ? `"${clean.replace(/["\\]/g, '\\$&')}"` : clean;
};

const setEnvValue = (text, key, value) => {
    const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
    const line = `${key}=${formatValue(value)}`;
    return pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
};

const visiblePrompt = (question) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
    });
});

/* Raw-mode entry keeps the secret off the screen and out of shell history.
   Falls back to a normal prompt when stdin is not a terminal (CI, pipes). */
const hiddenPrompt = (question) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
        return visiblePrompt(question);
    }

    return new Promise((resolve) => {
        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;
        let value = '';

        process.stdout.write(question);
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        const redraw = () => {
            process.stdout.write(`\r${' '.repeat(80)}\r${question}${'*'.repeat(value.length)}`);
        };

        const cleanup = () => {
            stdin.off('data', onData);
            stdin.pause();
            stdin.setRawMode(Boolean(wasRaw));
        };

        const onData = (chunk) => {
            for (const character of chunk) {
                if (character === '\r' || character === '\n') {
                    cleanup();
                    process.stdout.write('\n');
                    resolve(value);
                    return;
                }
                if (character === '\u0003') {
                    cleanup();
                    process.stdout.write('\n');
                    process.exit(130);
                }
                if (character === '\u007f' || character === '\b') {
                    value = value.slice(0, -1);
                } else if (character >= ' ') {
                    value += character;
                }
            }
            redraw();
        };

        stdin.on('data', onData);
    });
};

const validCallback = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && url.pathname.replace(/\/+$/, '') === '/api/mpesa/callback'
            && !/(^localhost$|\.localhost$|\.local$|\.example$|\.test$|\.invalid$)/i.test(url.hostname);
    } catch (error) {
        return false;
    }
};

const main = async () => {
    let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const args = process.argv.slice(2);
    const callbackIndex = args.indexOf('--callback');

    if (callbackIndex !== -1) {
        const url = args[callbackIndex + 1];
        if (!validCallback(url || '')) {
            console.error('Callback must be a public HTTPS URL ending with /api/mpesa/callback.');
            process.exitCode = 1;
            return;
        }
        text = setEnvValue(text, 'DARAJA_CALLBACK_URL', url);
        console.log(`Callback URL updated: ${new URL(url).origin}/api/mpesa/callback`);
    }

    const keyFromEnv = String(process.env.DARAJA_CONSUMER_KEY || '').trim();
    const secretFromEnv = String(process.env.DARAJA_CONSUMER_SECRET || '').trim();
    const shouldPrompt = !keyFromEnv || !secretFromEnv;

    if (shouldPrompt) {
        console.log('Enter the Consumer Key and Consumer Secret from your Daraja app.');
        console.log('They are hidden as you type and are written only to .env.\n');
    }

    const consumerKey = keyFromEnv || await hiddenPrompt('Consumer Key: ');
    const consumerSecret = secretFromEnv || await hiddenPrompt('Consumer Secret: ');

    if (consumerKey.length < 8 || consumerSecret.length < 8) {
        console.error('Both values must be at least 8 characters. Nothing was changed.');
        process.exitCode = 1;
        return;
    }

    text = setEnvValue(text, 'DARAJA_CONSUMER_KEY', consumerKey);
    text = setEnvValue(text, 'DARAJA_CONSUMER_SECRET', consumerSecret);

    if (!/^\s*DARAJA_SHORTCODE\s*=/m.test(text)) {
        text = setEnvValue(text, 'DARAJA_SHORTCODE', '174379');
    }
    if (!/^\s*DARAJA_ENV\s*=/m.test(text)) {
        text = setEnvValue(text, 'DARAJA_ENV', 'sandbox');
    }

    const temporaryPath = `${envPath}.tmp`;
    fs.writeFileSync(temporaryPath, text, { mode: 0o600 });
    fs.renameSync(temporaryPath, envPath);

    console.log('\nCredentials saved to .env (values hidden).');
    console.log('Restart EstatePro on port 3100, then run: npm run mpesa:check');
};

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
