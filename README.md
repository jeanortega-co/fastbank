# .

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Compile and Minify for Production

```sh
npm run build
```

## Banking simulator API

The banking API runs from `server/index.js`; transaction and credit rules are in `server/banking.js`. SQLite schema upgrades run idempotently when `server/db.js` starts. Existing browser balances are not imported or treated as authoritative.

### Neon migration status

The PostgreSQL schema and guarded SQLite import utility are present, but the live API is **still SQLite-backed**: its synchronous database calls and transaction boundaries have not yet been converted to asynchronous PostgreSQL operations. A production process configured with `DATABASE_URL` therefore exits instead of silently using an ephemeral SQLite database. Do not deploy the Render service until that application conversion is complete.

After the backend is converted, the migration utility can be run with `DATABASE_URL` set to the Neon connection string and `DATABASE_PATH` optionally set to the local SQLite database. It makes a consistent SQLite backup using SQLite's backup API, imports in foreign-key order inside a PostgreSQL transaction, takes a transaction-scoped advisory lock, inserts without overwriting existing rows, rejects conflicting records, and verifies per-table row counts and ledger balances. It never prints row contents or credentials:

```sh
npm run migrate:sqlite-to-neon
```

The backup is retained beside the source database. Keep `DATABASE_URL` private. The Render blueprint and Vercel proxy are configuration templates; set Render's `CLIENT_ORIGIN` and Neon `DATABASE_URL`, and Vercel's `API_ORIGIN`, only after the backend conversion has passed its production validation.

### Vercel deployment status

Vercel can host the Vue frontend, but the banking API is not active until the PostgreSQL backend conversion is complete and a persistent API service is deployed. The Vercel `/api/*` proxy requires `API_ORIGIN`; without it, API requests return `503` rather than pretending to access Neon. Add `DATABASE_URL` to the private API service's environment—not a `VITE_` variable or browser code—after the PostgreSQL adapter is ready. `.env.example` contains placeholders only and must never be replaced with real credentials in source control.

Authenticated endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register/email-code` | Send a five-digit email ownership code before registration |
| POST | `/api/auth/register/email-code/verify` | Verify the registration code and issue a one-use registration token |
| POST | `/api/auth/register` | Create an account with verified email, an adult birth date, and a document image |
| GET | `/api/cards/requests` | List the authenticated user's requested cards and active virtual cards |
| POST | `/api/cards/requests` | Request any combination of debit/credit and physical/digital cards; physical requests require delivery details |
| GET | `/api/cards/requests/:cardRequestId/cvv` | Retrieve the CVV of the authenticated user's active card |
| PATCH | `/api/cards` | Change the lock state of an active card or set its credit limit by card request ID |
| GET | `/api/support/requests` | List the authenticated user's support requests and responses |
| POST | `/api/support/requests` | Submit a support request for account, cards, payments, transfers, credit, security, or another topic |
| GET | `/api/admin/support/requests` | Admin-only support inbox |
| PATCH | `/api/admin/support/requests/:id` | Admin-only: update a case status and send a response visible to its owner |
| POST | `/api/admin/users/:id/password-reset` | Admin-only: issue a one-time password reset code that expires in 15 minutes |
| POST | `/api/auth/pin-reset/request` | Email a one-time code to the registered address to reset a user's PIN |
| POST | `/api/auth/pin-reset` | Replace a user's four-digit PIN with a valid email code |
| POST | `/api/auth/password-reset` | Replace a user's password with a valid reset code |
| GET | `/api/banking/summary` | Account balances, pockets, loans, transactions, and credit assessment |
| POST | `/api/transfers` | Internal Fastbank transfer; send `Idempotency-Key` |
| POST | `/api/services/payments` | Register a simulated utility, mobile, transport, or digital subscription payment; send `Idempotency-Key` |
| POST | `/api/pockets` | Create a savings pocket |
| PATCH | `/api/pockets/:pocketId` | Deposit or withdraw from a pocket; send `Idempotency-Key` |
| PATCH | `/api/pockets/:pocketId/lock` | Lock or unlock withdrawals |
| GET | `/api/loans/assessment` | Return the user's score-based credit level and available limit |
| POST | `/api/loans` | Assess and disburse a loan atomically; send `Idempotency-Key` |
| POST | `/api/loans/:loanId/payments` | Post an installment atomically; send `Idempotency-Key` |
| PATCH | `/api/cards` | Change card limit or lock state |
| GET | `/api/investments` | Reference quotes and the authenticated user's investment positions |
| POST | `/api/investments` | Create a position and reserve funds for a fixed term |
| POST | `/api/investments/:investmentId/withdraw` | Withdraw a matured position at its current reference value |
| GET | `/api/casino/aviator/state` | Current round and the authenticated user's bets |
| POST | `/api/casino/aviator/bet` | Place a checking-account wager; send `slot`, `amount`, and `idempotency_key` |
| POST | `/api/casino/aviator/cashout` | Cash out an active bet; send `slot` only |
| GET | `/api/casino/aviator/history` | Recent verified crash points and the user's bet history |
| GET | `/api/casino/aviator/verify/:roundId` | Reveal and verify a completed round's server seed |
| GET | `/api/casino/limits` | Read casino limits and today's wager/loss totals |
| PUT | `/api/casino/limits` | Update limits, self-exclusion, or submit a birth date for 18+ eligibility |
| POST | `/api/transactions/:transactionId/reverse` | Admin-only reversal of eligible transfers and pocket movements |

Aviator runs only when the API server starts. Wagers and payouts use the checking account, the banking ledger, and idempotent transactions; the server controls round timing, crash points, and payouts. `AVIATOR_HOUSE_EDGE` defaults to `0.03`; crash points are capped at 1000x to bound payout exposure. `CASINO_HOUSE_BANKROLL` defaults to COP 1,000,000,000 and is recorded as a one-time opening ledger transaction. Default player limits are COP 500,000 per bet, COP 2,000,000 wagered per UTC day, and COP 500,000 in net daily losses. Birth-date eligibility is checked server-side, but the date is self-reported and is not verified against a government identity source.

For local credential recovery, the user chooses **¿Olvidaste tu contraseña?** or **¿Olvidaste tu PIN?** at login, enters their email, and requests a five-digit verification code; the code is sent to the registered address, after which they enter the code and a new credential. The PIN flow accepts exactly four digits. An administrator can also send a password reset code from the client's card in **Administración**. Users start with no card. The **Pedir tarjetas** page lets them select debit, credit, physical, and digital options independently, including requesting all four combinations at once, and pre-fills personal details from the authenticated account. A credit card starts with a COP 1,500,000 available limit. Digital cards are activated immediately for use in Fastbank. Physical cards show an estimated seven-day preparation and delivery status, simulated in the app; no real card is printed or mailed. Registration also verifies email ownership with a five-digit code before account creation, requires a Colombian ID number of 6–10 digits, a Colombian mobile number of exactly 10 digits starting with 3, an adult birth date, and a JPG, PNG, or WebP image of the identity document. The image is not retained. Age is checked from the birth date entered by the applicant; document-image OCR or government identity verification is not integrated. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in `.env` first. For Gmail, use `smtp.gmail.com`, port `465`, secure mode `true`, and a Google App Password (requires 2-Step Verification); never use or commit the normal account password. Reset codes are single-use, expire after 15 minutes, are bound to their purpose, and only their SHA-256 hashes are stored. Registration codes expire after 10 minutes, are limited to five incorrect attempts, and are also stored as SHA-256 hashes. Resetting a password or PIN invalidates the user's existing sessions; both credentials continue to be stored using bcrypt. Reset requests are rate-limited and return a generic response to avoid disclosing whether an email is registered.

The authenticated **Pagos y recargas** section offers water, electricity, gas, mobile top-ups, transport cards, and digital subscriptions. Mobile top-ups present example data plans for Claro, Movistar, Tigo, and WOM with their displayed price and validity; the server verifies the selected plan and its price before charging. Other service payments validate the account reference and a COP 1,000–5,000,000 amount. Successful operations debit the user's checking balance and appear in banking history. These are simulated Fastbank ledger operations and example plan offers only: no utility, telecom, transport, or subscription provider is connected, and no external payment or service activation occurs.

The authenticated **Ayuda y soporte** section includes FAQs and a form for submitting a case. Requests are stored privately for the account owner and appear in the admin support inbox, where an administrator can track the status and send a response that the user can read in the help center. This provides in-app case follow-up; it is not a live chat or call center.

The `accounts` table stores checking, pocket, treasury, loan-receivable, and service-clearing balances. Each processed movement writes balanced debit and credit rows to `ledger_entries` in the same SQLite transaction as the balance changes. FastCredit records accrued interest alongside each disbursement so the full repayment remains balanced. Transaction states are `Pendiente`, `Procesado`, `Rechazado`, and `Revertido`; rejected requests do not post ledger entries. The demo Ana account receives a one-time COP 1,000,000 opening entry, balanced against simulator treasury.

FastCredit gives new accounts a score of 60 and a Base limit of COP 100,000, so an eligible user can request a credit without first building transaction history. The score-based limit increases to COP 200,000 at 70 points (Escalada), COP 500,000 at 80 (Avanzado), and COP 1,500,000 at 90 (Premium); COP 1,500,000 is the program maximum. Fully repaying a credit on or before its due date adds 10 score points, up to 100. Credit requests have a COP 100,000 minimum, and a user must settle an active credit before requesting another. The assessment still reports account activity and balance metrics, but the available limit is determined by the user's score. The server enforces eligibility and limits independently of client values.

Passkeys can be enrolled from **Seguridad** and used from the login username autofill or fingerprint/passkey button. The authenticator verifies the user's fingerprint, face, or device PIN locally; FastBank stores only the public key and signature counter. WebAuthn requires a secure context: `localhost` is accepted for development, while a phone accessing an `http://192.168.x.x` LAN address must use HTTPS before passkeys will be available. When serving through an HTTPS tunnel or reverse proxy, add the exact browser origin to `CLIENT_ORIGIN`, set `WEBAUTHN_ORIGIN` to that full HTTPS origin, and set `WEBAUTHN_RP_ID` to its hostname. The RP ID and origin must match the hostname visible in the phone browser.

Investment reference quotes are generated within FastBank and are not live exchange prices. Positions reserve the selected amount for 7, 30, 90, or 180 days; at maturity, withdrawal is paid at the then-current reference value, so users may receive less or more than they invested. No investment orders are sent to a stock exchange, and no real funds are moved. The displayed card also remains a simulation; no external bank network or card processor is connected.

Run the backend and client with `npm run dev`; run the isolated SQLite integration test with `npm test`.

## Shared balances across devices

Balances are shared only when every device uses the same API and its one persistent SQLite database. Do not run a separate backend/database on each device.

For devices on the same Wi-Fi network:

1. On the host PC, copy `.env.example` to `.env` and set `CLIENT_ORIGIN` to include the localhost and LAN origins on Vite ports `5173` and `5174`, replacing `192.168.1.50` with the host's actual IP.
2. Start FastBank on that PC with `npm run dev`. Vite listens on the LAN and proxies `/api` to the host's backend and `data/fastbank.sqlite`.
3. Open `http://192.168.1.50:5173` on the phone or other device, replacing the address with the host PC's LAN IP. Keep both devices on the same trusted network and allow the development port through the host firewall.

For devices outside that network, deploy one API with persistent storage, build every frontend with the same `VITE_API_URL`, and allow the deployed frontend origins in `CLIENT_ORIGIN`. The nested `Fastbank/` directory is an older standalone client that stores financial state in `localStorage`; use the workspace root app for shared balances.
