#!/usr/bin/env node
/* Start a free Cloudflare quick tunnel to the local EstatePro server and keep
   DARAJA_CALLBACK_URL in .env in sync with the public URL. Quick-tunnel URLs
   change on every restart, so this removes the manual copy/paste step.

   Usage: npm run mpesa:tunnel
   Optional: set CLOUDFLARED_PATH if the binary is somewhere else. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const envPath = path.join(__dirname, '..', '.env');
const port = String(process.env.PORT || '3100');
const candidates = [
    process.env.CLOUDFLARED_PATH,
    path.join(os.tmpdir(), 'opencode', 'cloudflared.exe'),
    path.join(os.tmpdir(), 'opencode', 'cloudflared'),
    path.join(__dirname, '..', 'cloudflared.exe'),
    'cloudflared'
].filter(Boolean);

const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const setCallback = (host) => {
    const callback = `${host.replace(/\/+$/, '')}/api/mpesa/callback`;
    let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const pattern = /^\s*DARAJA_CALLBACK_URL\s*=.*$/m;
    const line = `DARAJA_CALLBACK_URL=${callback}`;
    text = pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
    fs.writeFileSync(`${envPath}.tmp`, text, { mode: 0o600 });
    fs.renameSync(`${envPath}.tmp`, envPath);
    return callback;
};

const binary = candidates.find((candidate) => {
    if (candidate === 'cloudflared') {
        return true;
    }
    return fs.existsSync(candidate);
});

if (!binary) {
    console.error('Could not find cloudflared. Download it or set CLOUDFLARED_PATH.');
    process.exit(1);
}

console.log(`Starting tunnel to http://localhost:${port} ...`);
const child = spawn(binary, ['tunnel', `--url=http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe']
});

let announced = '';
const readOutput = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    const match = text.match(urlPattern);
    if (match && match[0] !== announced) {
        announced = match[0];
        try {
            const callback = setCallback(announced);
            console.log(`\nPublic URL: ${announced}`);
            console.log(`Callback saved to .env: ${callback}`);
            console.log('Restart EstatePro on port 3100 so it loads the new URL.\n');
        } catch (error) {
            console.error(`Could not update .env: ${error.message}`);
        }
    }
};

child.stdout.on('data', readOutput);
child.stderr.on('data', readOutput);

child.on('error', (error) => {
    console.error(`Could not start cloudflared: ${error.message}`);
    process.exitCode = 1;
});

child.on('exit', (code) => {
    console.log(`\nTunnel stopped (exit ${code}).`);
    process.exitCode = process.exitCode || (code === 0 ? 0 : 1);
});

const shutdown = () => {
    if (!child.killed) {
        child.kill();
    }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
