# Subster

A subscription agent. It finds what you pay for, measures whether you actually use it, and helps
you act on the answer. The agent proposes; you approve; PayPal carries it out and Subster reads
the result back to prove it happened.

Built for the PayPal AI Hackathon with PayPal, AG Studio (AG Grid) and Bryntum Scheduler, on
TanStack Start with Google Gemini.

## Why this matters to PayPal

- **PayPal becomes the place where subscriptions are safe.** A subscription billed through PayPal
  can be paused or cancelled in one tap and the change is confirmed with PayPal, not assumed.
  That is the answer to the cancellation maze, and a reason to choose PayPal at checkout.
- **Fewer disputes.** Most subscription chargebacks start as "I forgot" or "I could not cancel".
  Subster warns before a charge, and when a charge is already taken it writes the refund request
  from the user's own records instead of leaving a dispute as the only route.
- **It shows where PayPal is accepted.** Each of the 273 services in the catalog carries what its
  own help pages say about PayPal, with the source link.

## See it in five minutes

```bash
npm install
cp .env.example .env.local    # PayPal sandbox keys are enough to see the PayPal flow
npm run dev                   # http://localhost:3000
```

1. **Create the first account.** It becomes the administrator. Three welcome steps follow.
2. **The guided demo opens by itself**, with thirteen sample subscriptions and a notification that
   you are in demo mode. A walkthrough card leads through the PayPal flow, ringing what to look at
   and ticking each step off when the app sees it done:
   see where PayPal is accepted, start a subscription through PayPal, approve it (a real sandbox
   plan and agreement are created and PayPal asks you to confirm), pause or cancel in one tap with
   the result read back from PayPal, and read the PayPal ledger.
3. **End the demo** from the walkthrough. You land on your own, empty data, on the Connect page,
   ready to link PayPal, a bank, a statement, UPI IDs and the browser extension.
4. Along the way: **Assistant** (ask anything, or run an audit; it answers with checklists,
   pickers and approval cards), **Savings**, **Timeline** (Bryntum) and **Insights** (AG Studio).

Without any keys the app still runs on the sample data, with the built-in rules in place of the
model and PayPal shown as not connected.

## How PayPal is used

| What | API | Where |
| --- | --- | --- |
| Start a subscription | Catalog Products, Billing Plans, Subscriptions (create) | `createAgreement` in `src/server/integrations/paypal.ts` |
| Pause, cancel, resume | Subscriptions (suspend, cancel, activate) | `changeSubscription`, same file |
| Prove the change | Subscriptions (show details), read before and after | `execute` in `src/server/services/actions.ts` |
| Notice changes made elsewhere | Subscriptions (show details) every 10 minutes | `verifyConnections` in `src/server/services/connections.ts` |
| Ledger | Transaction Search | `recentTransactions`; shown on Transactions |
| Live events | Webhooks, signature verified before anything is recorded | `verifyWebhook`, `src/server/services/webhooks.ts` |

The official PayPal TypeScript Server SDK is used throughout; Catalog Products and webhook
verification, which the SDK does not cover, are plain REST.

**The model, stated plainly.** For a subscription started through Subster, Subster is the
merchant of record: it creates the PayPal plan and agreement and bills in US dollars. That is
what gives it the right to pause and cancel. It does not open an account at the provider. PayPal
has no API that lets a third party manage an agreement a user holds with another merchant, so
subscriptions paid elsewhere are handled by giving the user the provider's exact page and
tracking the step to done.

## What it does

- **Finds subscriptions.** From PayPal, a linked bank account, a bank statement, or by adding a
  service from the catalog.
- **Measures use.** A Chrome extension reports time on each service's site, live, and whether you
  are signed in there. An Android companion reports screen time. Totals only.
- **Scores value.** Cost against use gives a cost per hour, a 0 to 100 score and a plain verdict.
  Without usage a subscription is "not measured", never "unused".
- **Proposes, never acts alone.** Cancel, pause, downgrade or fix a payment. Nothing happens until
  you approve. A change you turn down is remembered and not suggested again until the price or
  your use changes.
- **Audits daily on its own**, so a trial about to convert is caught before the charge.
- **Fit check.** A short dialog asks how you use a service, then checks it: for video, whether the
  titles you want are on it and what renting them costs; for storage and AI, how it compares with
  the alternatives at current prices.
- **Keeps prices current** by reading providers' own price pages directly.
- **Refund and payment help** on the Transactions page.

## The agentic workflow

```
trigger ──> agent run ──> tools ──> proposal ──> your approval ──> execute ──> verify ──> audit trail
(manual,    (Gemini or    (read     (inbox, with   (or standing    (PayPal     (read the   (every step
 daily,      rules)        only +    evidence and    permission)     API or      agreement   recorded)
 webhook,                  propose)  a deadline)                     guided)     back)
 bank, chat)
```

The agent's tools can read and propose. None can change or buy anything. The only code that calls
PayPal's create, cancel, suspend or activate is in `src/server/services/actions.ts`, reached from
the approval endpoint or from a standing permission the user gave for one subscription. That
boundary is in the server, not in a prompt.

## The assistant and its API

The Assistant page is a conversation with the agent. Replies are markdown, and the agent can show
components in place of text: a checklist, a plan picker, a confirm dialog, progress bars, headline
numbers, subscription rows, a table, and approval cards that carry the PayPal buttons.

Conversations are kept on the server. A client sends only the new message; the agent is given the
conversation so far, including what it showed, from the server's own record.

| Call | What it does |
| --- | --- |
| `GET /api/chat/sessions` | List conversations |
| `POST /api/chat/sessions` | Start one |
| `GET`, `PATCH`, `DELETE /api/chat/sessions/{id}` | Read with full history, rename, delete |
| `POST /api/chat/sessions/{id}/messages` | Send a message; the reply streams as NDJSON |
| `POST /api/actions/{id}` | Approve or decline a proposal |

The contract is in `openapi/subster-chat.yaml` (OpenAPI 3.0). Import it into APIMatic to generate
SDKs and a developer portal for it.

## Accounts and administration

- Each person has their own account and their own data, kept apart on disk. Passwords are stored
  as salted scrypt hashes and sessions as hashes of their tokens, in an HttpOnly cookie.
- **Demo without an account.** The sign-in screen has a "Try the demo" button. It makes a guest who
  sees sample data only, cannot link anything real, may try PayPal only in test mode, lasts an
  hour at most, and is signed out and deleted when the demo ends. An administrator can switch it
  off.
- **Signing in.** Email and password, plus three free additions an account can use:
  an **authenticator app** (six-digit codes, checked here with no outside service), **passkeys**
  (fingerprint, face or device PIN through WebAuthn), and **email codes** (a six-digit code in
  place of the password, which is also the way back in after a forgotten one; needs
  `RESEND_API_KEY` and `EMAIL_FROM`). They are managed under the account menu, Sign-in security.
- The first account is the administrator (or name one with `ADMIN_EMAIL` and `ADMIN_PASSWORD`).
  The **Admin** page lists accounts, opens or closes sign-ups, adds people, changes roles,
  suspends or deletes an account, and switches three permissions per person: the assistant,
  PayPal actions, and linking accounts. It also shows the server logs, live.
- An administrator sees who has an account and how much it holds, not anyone's subscriptions.
- The browser extension sets itself up: open Subster in a browser that has it and the site hands
  it the account's **device key**. On a deployed address, press Connect in the extension once.
  The phone app takes the same key, pasted from the Connect page. The key opens nothing else.
- Background work (the daily audit, connection checks, price reading) runs for every account, and
  a PayPal webhook is handed to whichever account holds that agreement.

## Deploying

The app is one Node server that keeps accounts and data as files, so it needs a disk that lasts.

```bash
docker compose up --build        # http://localhost:3000, data in a named volume
# or
docker build -t subster . && docker run -p 3000:3000 -v subster-data:/data --env-file .env subster
```

The image runs as an unprivileged user, has a health check, and reads its keys from the
environment. Any host that runs a container with a volume works (Render, Railway, Fly.io, a VM).
Set `PUBLIC_URL` to the public https address so PayPal can return to it.

**Vercel, or any serverless host.** Nothing stays running there and no disk lasts, so the app
keeps its documents in a database that every copy shares (MongoDB or Redis), and switches to it by
itself when it finds the connection settings.

1. Import the repository in Vercel and deploy.
2. Give it a database, one of:
   - **MongoDB.** Set `MONGODB_URI` to the connection address of a deployed database (MongoDB
     Atlas has a free plan; allow network access from anywhere, as Vercel has no fixed address).
     Documents go in a `documents` collection, in the database named in the address or `subster`.
   - **Redis.** In the project's Storage tab, add an Upstash Redis database and connect it. Vercel
     adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Add the keys from `.env.example`, `PUBLIC_URL` set to the site's address, and `CRON_SECRET`
   set to a long random string. Redeploy.

What is different there: each request fetches what it needs from the database and writes its
changes back at the end; the daily audit, connection checks and price reading run from a scheduled
call to `/api/cron` once a day; and the page checks for changes every 20 seconds, since a
connection cannot be held open. Two requests changing the same account at the same instant can
overwrite one another, as each writes the whole document. Server logs are kept per copy and do not
last. Without the database the app still starts, and says on the sign-in screen that nothing is
kept.

## Sponsor technology

- **PayPal**: see the table above.
- **AG Studio**: the Analytics page. Three report pages with cross-filtering, a custom ranked
  "value board" widget that queries through the widget API, a custom theme, and an assistant
  backed by Gemini. `src/components/studio/`
- **Bryntum Scheduler**: the Timeline. Rows grouped by category with group totals, a summary row
  that adds up what is charged in each day, week or month on screen, a toolbar (find, span, today,
  zoom, filters), billing periods as resource time ranges, a year of upcoming charges as
  milestones, context menus that pause, cancel or pin a reminder, and drag to move a reminder.
  `src/components/timeline.tsx`

## What has been run, and what has not

Run and checked:
- PayPal sandbox: creating a plan and agreement, Transaction Search, webhook signature
  verification. `npm run smoke` creates a real sandbox agreement on every run.
- The agent loop on Gemini, the fit check with live lookups, the daily audit, decline memory.
- Direct reading of price pages (Netflix, Spotify, Apple Music, iCloud+, Google One, Claude) and of
  JustWatch title pages.
- The Chrome extension, loaded in Chrome: it synced and reported a site as in use within seconds
  (before device keys were added; the key path is covered by the end-to-end test, not in Chrome).
- Accounts, permissions, onboarding, the demo and its ending, authenticator codes and email
  codes, and the guest demo: 71 end-to-end checks, run against the dev server, the built container,
  and the serverless storage path (with a stand-in for the database, `tests/fake-upstash.mjs`).
  Two copies of the built app sharing that database were also checked against each other. Passkeys and
  the extension's self set-up were run in Chrome (passkeys with a virtual authenticator).
- Email codes were run through a test outbox, not through a real email provider.

Written but not run against the real service:
- Plaid, the Setu Account Aggregator connector and Spotify sign-in. No keys were available.
- The Android companion builds (`cd android && ./gradlew assembleDebug`) but has not been run on
  a phone.
- Pausing or cancelling a PayPal agreement after a buyer has approved it. The code path is the
  same one the smoke test exercises up to approval; the approval itself needs a person signed in
  to a PayPal sandbox buyer account.

## Limits

- **Storage is one JSON document per account**, in files or in Redis. It suits a small
  deployment; a larger one wants a real database behind the same adapter.
- **Forgotten passwords** are recovered with an email code where email is set up; otherwise an
  administrator sets a new one.
- **PayPal bills subscriptions in US dollars here**, so only dollar-priced plans can be started
  from Subster. Everything else works in the user's own currency, never converted.
- **Indian bank accounts.** Plaid does not cover India and production Account Aggregator access is
  limited to regulated entities, so a statement file is the route that works today.
- **Usage** covers Chrome and Android. TV, console and desktop apps are invisible to it.
- **PayPal acceptance list.** 102 services confirmed as accepting PayPal, 67 as not, 104 unknown.
  Many help centres block automated readers, so a large share were read through a search engine's
  extract of the official page. Acceptance varies by country; each entry keeps its source.
- **Price pages and JustWatch pages are read directly**, honestly identified and within
  robots.txt. A layout change makes a page "could not be read", never a guess. A product would
  license title data rather than read JustWatch.
- **Gemini's free tier** allows about 20 requests a day per model and key. Several keys can be
  listed and are used in turn; when all are used up the built-in rules take over and say so.
- **Value scoring** uses per-category "fair cost per hour" benchmarks. They are judgement calls
  in `src/domain/intelligence.ts`, not measured data.

## Commands

```bash
npm run dev          # the app
npm run build && npm start
npm run typecheck && npm run lint
npm test             # statement parser
npm run test:extension
npm run test:e2e     # the whole path over HTTP, against a server with an empty data folder (see tests/e2e.mjs)
npm run smoke        # older single-user checks: start the server with SUBSTER_SINGLE_USER=1
npm run gateway      # forwards only webhook and callback paths, for use behind a tunnel
npm run tunnel       # public https address for the gateway
```

For PayPal webhooks, register `<tunnel address>/api/paypal/webhook` in the PayPal developer
dashboard and set `PAYPAL_WEBHOOK_ID` and `PUBLIC_URL`.

## Layout

```
src/
  domain/          pure logic shared by server and browser: data model, catalog, scoring, UPI
  server/
    auth.ts        accounts, sessions, roles and permissions
    http.ts        the one wrapper every API route goes through: who is calling, what they may do
    integrations/  one module per outside system (paypal.ts, bank/)
    services/      use cases: actions (the permission boundary), chat, connections, refunds, plans
    agent/         tools, the audit loop, the fit check, the daily schedule
    vfs.ts         where documents live: files on a server with a disk, Redis on a serverless host
    store/         one document per account behind an adapter, and the sample data
  routes/          pages, and server routes under routes/api
  components/      UI: chat, walkthrough, notifications, timeline (Bryntum), studio/ (AG Studio)
extension/         Chrome extension: live usage and sign-in monitoring
android/           companion app: screen time
openapi/           the assistant API contract
tests/             parser, extension, end-to-end and smoke tests
scripts/           build helpers and the webhook gateway
Dockerfile, docker-compose.yml
```
