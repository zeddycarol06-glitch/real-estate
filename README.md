# EstatePro

A property management web app: a public site for browsing rentals, an M-Pesa
rent-payment flow, a tenant self-service portal, and a password-protected
landlord dashboard. It is a small Node.js/Express server backed by MongoDB,
with plain HTML, CSS and JavaScript on the front end.

## Requirements

- **Node.js 18+** (developed on Node 24)
- **MongoDB** reachable on the local machine (default:
  `mongodb://127.0.0.1:27017/estatepro`). On Windows it normally runs as the
  `MongoDB` service.

## Running the project

> **Do not use VS Code's "Go Live" / Live Server.** It only serves the HTML,
> CSS and JS files and does not run `server.js`, so there is no API, no
> database, and no login. Pages will look empty or fall back to saved data.
> See [Why not Live Server?](#why-not-live-server) below.

### Option A — VS Code (recommended)

1. Open this folder in VS Code.
2. Press **F5** (Run and Debug), or click the green ▶ next to
   **"EstatePro: run server (localhost:3000)"**.
3. The server starts, MongoDB is checked/started automatically, and your
   browser opens at **http://localhost:3000**.

To run the server without the debugger, press **Ctrl+Shift+B** to run the
**"EstatePro: start server"** task, then open http://localhost:3000.

These are defined in `.vscode/launch.json` and `.vscode/tasks.json`, which
behave exactly like running `npm start` from a terminal.

### Option B — terminal (PowerShell / cmd)

```powershell
npm install     # first time only
npm start
```

Then open **http://localhost:3000**.

### Option C — one click on Windows

Double-click **`start-estatepro.bat`**. It checks for Node and MongoDB, starts
them if needed, opens the browser and runs the server.

## First-time setup: the landlord password

The dashboard is protected. If no password is set yet, open
`/admin-login.html` and create one, or set it from the terminal:

```powershell
npm run admin:password
```

Password policy: at least **10 characters, including a letter and a number**.

## Configuration

Copy `.env.example` to `.env` and fill in what you need. `.env` is git-ignored.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Port the server listens on | `3000` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/estatepro` |
| `DARAJA_ENV` | `sandbox` or `production` | `sandbox` |
| `DARAJA_CONSUMER_KEY` / `DARAJA_CONSUMER_SECRET` | Safaricom Daraja API credentials | — |
| `DARAJA_SHORTCODE` | M-Pesa business shortcode | `174379` (sandbox) |
| `DARAJA_PASSKEY` | Daraja STK passkey | — |
| `DARAJA_CALLBACK_URL` | Public HTTPS URL for the M-Pesa callback | — |
| `DARAJA_CALLBACK_TOKEN` | Private token Safaricom must echo back | — |
| `MPESA_RECEIVING_NUMBER` | Pochi la Biashara number tenants send rent to (shown on the pay page and receipts) | `0796488109` |

M-Pesa (Daraja) is only needed for the STK Push payment flow. Everything else
runs without it.

### Enabling the phone prompt (STK Push)

STK Push is the prompt that appears on the tenant's own M-Pesa phone and needs
only their PIN. It cannot be sent from the browser: Safaricom requires the
request to be signed by the server, so the credentials stay in `.env`.

1. Get sandbox credentials from the Safaricom developer portal: **Consumer
   Key**, **Consumer Secret**, **Passkey** and the sandbox shortcode `174379`.
2. Add them to `.env` as `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`,
   `DARAJA_PASSKEY` and `DARAJA_SHORTCODE`.
3. Safaricom must be able to reach your server over the public internet. Expose
   port `3100` (or `3000`) with an HTTPS tunnel such as ngrok, then set
   `DARAJA_CALLBACK_URL=https://<your-tunnel-host>/api/mpesa/callback`. The URL
   must be public HTTPS and end with that exact path.
4. Keep `DARAJA_CALLBACK_TOKEN` at 32+ characters, then restart the server.

The pay-rent page detects this automatically: **M-Pesa STK Push** becomes the
selected method, the confirmation-code field is hidden, and submitting the form
sends the prompt immediately. The tenant enters their PIN on the phone, and the
page polls Safaricom until the payment is confirmed, then offers the receipt.
If any setting is missing, the page says exactly what to fix and keeps the
manual Pochi route available. `MPESA_RECEIVING_NUMBER` is only the number shown
for manual Pochi payments; STK Push always uses the Daraja shortcode.

## Pages

| Page | Who it is for |
| --- | --- |
| `index.html` | Public landing page and property listings |
| `property-details.html` | A single property's details |
| `tenant-payment.html` | Public pay-rent page (live rent bill + part payments via Pochi or STK Push) |
| `tenant-login.html` / `tenant-portal.html` | Tenant sign-in and self-service area |
| `admin-login.html` | Landlord sign-in |
| `dashboard.html` | Landlord dashboard (payments, expenses & net income, tenants, maintenance) |

The dashboard's **Expenses** section records what you spend on each property —
category, payee, amount, date and how it was paid. For the selected month it
shows rent collected, expenses and the difference as **net income**, plus a
spending-by-category breakdown, a six-month trend and a CSV export. Only rent
that has actually been received counts towards net income.

The pay-rent page shows a **live rent bill** before payment. Once a home, unit,
email and rent period are entered, it lists the rent charged, money already
received, payments awaiting confirmation/verification, and the balance due. The
"Pay this bill" button puts that balance into the payment form, and the bill can
be printed. The figures come from `GET /api/rent-bill` and use the same balance
rules as the payment checks, so the bill cannot disagree with what the server
accepts.

### Paying rent bit by bit (no Daraja needed)

Send any amount — the full balance or just part of it — from M-Pesa to the
**Pochi la Biashara** number shown on the pay page. Then choose
**Pochi la Biashara (I already sent it)**, enter the amount, rent period and the
M-Pesa confirmation code from your message, and submit. Each claim:

- appears on the bill as **Pochi payment awaiting verification** and reserves
  that part of the balance, so pending claims plus confirmed payments can never
  exceed the rent for the period;
- becomes **Rent received** only after the landlord verifies the code in the
  dashboard's *Awaiting verification* table (rejecting it releases the
  reservation);
- can then be followed by another part payment until the bill is clear.

An M-Pesa code can only be claimed once. A printable receipt is offered only
after a payment has been confirmed. Where Daraja is configured, **M-Pesa STK
Push** remains available and its pending requests reserve the balance the same
way; without Daraja the option is disabled and Pochi is selected by default.

## Project structure

```
server.js              Express app: API routes, sessions, static hosting
database.js            MongoDB connection, load/save, one-time JSON import
admin-auth.js          Admin/tenant sessions, password hashing, throttling
mpesa-daraja.js        Safaricom Daraja (STK Push and status query)
set-admin-password.js  CLI to set the landlord password
js/                    Front-end scripts (one per page/feature)
style.css              All styling
uploads/properties/    Uploaded property images
data/                  Legacy JSON data (imported into MongoDB once, then removed)
.vscode/               Run/debug config for VS Code
```

## How data is stored

All records (properties, payments, tenants, maintenance, expenses) live in
**MongoDB** collections. The first time the server starts, any legacy JSON files in
`data/` are imported once and then deleted. Admin credentials are stored in a
`settings` collection as a salted scrypt hash — never in plain text.

## Why not Live Server?

Live Server is a static file server. It hands the browser your files directly
but never executes `server.js`, so:

- `/api/...` requests return Live Server's 404 HTML page, so the property list
  falls back to the saved copy in `js/property-fallback.js` ("showing saved
  details, the server is not reachable").
- Login, the dashboard, the tenant portal and payments cannot work — there is
  no session, no database and no API.
- Pages meant to be private (`dashboard.html`, `tenant-portal.html`) are not
  redirected to their sign-in form.

Use **F5**, **Ctrl+Shift+B**, `npm start`, or `start-estatepro.bat` instead.
