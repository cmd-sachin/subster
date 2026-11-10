# SubSense

An agent that makes every subscription earn its place. It reads your own bank, statement and
PayPal data, measures how much you actually use what you pay for, and proposes what to do before
the next charge. You approve; it acts through PayPal and verifies the result. You can also start
a new subscription by asking for it in chat.

Built for the PayPal AI Hackathon with PayPal, AG Studio (AG Grid), Bryntum Scheduler and APIMatic,
on TanStack Start.

## Run it

```bash
npm install
cp env.example .env.local   # add the keys for the services you want connected
npm run dev                 # http://localhost:3000
```

```bash
npm run build && npm start  # production build, served from .output
npm run typecheck && npm run lint
npm test                    # statement parser tests (57 cases)
npm run smoke               # end-to-end checks against the dev server. ERASES stored data.
```

**There is no sample data and no simulated mode.** A fresh install is empty. A service without
keys is shown as not connected, and the features that need it say so.

| To get | You need |
| --- | --- |
| Subscriptions found from your payments | Nothing: upload your bank statement as CSV on the Connections page |
| A live link to your bank | Plaid keys (US, Canada, UK, Europe) or Setu keys (India, see limits) |
| Pause, cancel, resume and subscribe through PayPal | `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` |
| The agent reasoning with Gemini, live plan checks, and the AG Studio assistant | `GEMINI_API_KEY` |
| Value scores | The Android companion in `android/` reporting usage |
| Spotify plan and listening as usage | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` |

## Webhooks and callbacks

PayPal, Plaid, Setu and Spotify need a public HTTPS address to call back. The app has no login,
so do not tunnel to it directly. Tunnel to the gateway, which forwards only the webhook and
callback paths and answers 404 to everything else:

```bash
npm run gateway   # http://localhost:3001 -> the app on :3000, allowlisted paths only
npm run tunnel    # public https URL for the gateway (Cloudflare quick tunnel)
```

Register `<tunnel url>/api/paypal/webhook` in the PayPal developer dashboard, then put the
webhook id in `PAYPAL_WEBHOOK_ID` and the tunnel url in `PUBLIC_URL`. A quick tunnel gets a new
address every time it starts, so the webhook has to be re-registered after a restart; a deployment
or a named tunnel gives a stable one.

## What it does

1. **Follows the money.** Netflix, Hotstar, SonyLIV, PlayStation, Jio, Airtel and the rest publish
   no billing APIs, so SubSense reads where they all surface: a linked bank account, an uploaded
   statement, or a PayPal agreement. A catalog of 273 apps in 13 categories maps statement text to the service, its
   plans, its Android app and its official account page. Regular payments the catalog does not
   know are held for you to confirm.
2. **Classifies.** Every subscription gets a category in three tiers: the catalog (a fact), keyword
   rules, then Gemini for names neither can place. You can override any of them, and the app shows
   which tier decided.
3. **Measures value, not just spend.** The Android companion reports per-app screen time. Cost and
   usage become cost per hour and a 0 to 100 value score. Broadband, storage and mobile recharge
   are tracked for price and renewal only. Without usage data a subscription is "not measured",
   never "unused".
4. **Acts, with permission.** The agent can only propose. Approving a proposal executes it:
   through the PayPal Subscriptions API where PayPal manages the agreement (then re-reads the
   agreement to verify), otherwise by handing you the provider's official page. Per subscription
   you choose: ask me first, auto-pause when unused, or never touch.
5. **Subscribes from chat.** "Subscribe to Spotify Premium Duo" becomes a proposal in the inbox.
   Approving it creates a PayPal billing plan and agreement; you confirm it at PayPal, and only
   then is the subscription recorded.
6. **Lists every service, with its logo.** The Services page shows each service with its brand mark, plans, what you pay, and its account
   page. Signing in to a provider is done on the provider's side: OAuth where it exists (Spotify),
   the provider's own page otherwise. SubSense never asks for a provider password.
   Logos come from Simple Icons (157 apps, bundled; regenerate with `npm run logos`) and otherwise
   from the provider's own site icon, fetched through Google's favicon service. Apps whose prices
   could not be stated with confidence are listed without a plan table rather than with guesses.
7. **Monitors official prices.** For any service, Gemini looks up the provider's own site with
   Google Search grounding and URL reading, and reports the plans sold in your region and
   currency, with the source pages and check time. A result is discarded unless its grounding
   sources include the provider's own domain. A background monitor re-checks the
   services you subscribe to every 6 hours and records changes. This needs `GEMINI_API_KEY`;
   without it the page shows built-in catalog prices, labelled as not live. `src/server/services/plans.ts`
8. **Logs everything.** Structured logs for every request, agent run, tool call, PayPal and bank
   call, with request ids, secrets redacted, on disk at `.data/logs/app.log` and live on the Logs
   page.

## The agentic workflow

```
trigger ──> agent run ──> tools ──> proposal ──> your approval ──> execute ──> verify ──> audit trail
(manual,    (Gemini or    (read     (inbox, with   (or standing    (PayPal     (read the   (every step
 webhook,    rules         only +    evidence and    permission)     API or      agreement   recorded
 bank sync,  engine)       propose)  a deadline)                     guided)     back)       and logged)
 chat)
```

Agent tools: `list_subscriptions`, `get_subscription_detail`, `forecast_renewals`,
`get_paypal_status`, `search_services`, `propose_action`, `propose_subscription`, `schedule_review`.
None of them can change or buy anything. The only code that calls PayPal's create, cancel, suspend
or activate is in `src/server/services/actions.ts`, reached from the approval endpoint or a standing
permission.

## How the sponsor tech is used

- **PayPal**: Subscriptions API (create plan and agreement, cancel, suspend, activate, read back to
  verify), Transaction Search, signature-verified webhooks that trigger agent runs.
  `src/server/integrations/paypal.ts`
- **AG Studio**: the Analytics page. Three report pages on related data sources with a shared
  calendar and cross-filtering, a custom widget (the ranked value board) that queries through the
  widget API, a custom theme, and a custom lead agent in the Studio Agent Framework that delegates
  to Studio's built-in agents, backed by Gemini through an adapter. `src/components/studio/`
- **Bryntum Scheduler**: the renewal timeline. One row per subscription, billing periods as
  resource time ranges, milestones for charges, trial conversions, price rises, failed payments,
  bank charges and the agent's "decide by" deadlines. Reviews the agent schedules can be dragged.
  `src/components/timeline.tsx`
- **APIMatic**: the PayPal Context Plugin supplies accurate PayPal SDK context during development.
  Install it with `npx context-plugins install paypal`.

## Architecture

```
src/
  domain/              Pure logic shared by server and browser. No I/O.
    types.ts             the data model
    catalog.ts           the app catalog (statement text, plans, account pages)
    classify.ts          category classification (catalog, then keyword rules)
    intelligence.ts      cost per hour, value score, issues, recommendation
    dates.ts             dates, money in the user's currency, billing cycles
  server/
    http.ts              handle(): the wrapper every API route goes through
    logger.ts            structured logs: console, NDJSON file, live stream
    events.ts            in-process event bus behind the live updates
    store/               persistence behind a two-method adapter (JSON file today)
    integrations/        one module per outside system, each behind an interface
      paypal.ts
      bank/                BankConnector contract; plaid.ts and setu.ts implement it
    services/            use cases
      actions.ts           the permission boundary: propose, approve, execute, verify
      discovery.ts         payments -> subscriptions and charges
      statement.ts         bank statement parser
      subscriptions.ts     the one place a subscription record is created
      classifier.ts        the Gemini classification tier
      accounts.ts          provider account linking (Spotify OAuth)
      plans.ts             live plans from official sites, and the background monitor
      bank.ts, webhooks.ts, state.ts
    llm.ts               the one module that talks to the model (Google Gemini)
    agent/               tools.ts (what the agent can do), run.ts (Gemini loop and rules engine)
  routes/              TanStack Start: pages, and server routes under routes/api
  components/          UI: command center, services, timeline (Bryntum), studio/ (AG Studio)
android/               companion app (usage reporting)
scripts/               smoke test, parser tests, vendor asset copy
```

Rules the layout enforces: `domain` imports nothing from `server`; route handlers contain no
business logic; every outside system sits behind an interface.

**Scaling path.** The store is one JSON document and the event bus is in-process, which is right
for a single node. For several instances: implement the store adapter on Postgres (the document
splits along its arrays into tables), move the bus to Postgres `LISTEN/NOTIFY` or Redis, and run
agent runs from a queue instead of inside the request. None of that touches `domain`, the agent or
the UI.

## Limits you should know

- **No authentication.** The app is single-user and holds financial data. Do not expose it publicly
  as it is.
- **Indian bank accounts.** Plaid does not cover India. The Setu Account Aggregator connector is
  written against Setu's documented API but has not been run, and Setu grants production access
  only to RBI, SEBI, IRDAI or PFRDA regulated entities. For an Indian account, statement upload is
  the route that works today.
- **Statements** are read as CSV or delimited text. PDF and Excel exports are not supported.
- **Usage** is phone screen time. TV and console use are invisible to it.
- **PayPal** can only act on agreements PayPal manages, and bills subscriptions in USD here (its
  subscription billing does not support INR), so only dollar-priced plans can be started from here.
- **Catalog prices** are a built-in snapshot, mostly US list prices, and go stale. Only Claude and
  Google AI were checked against the official pages (2026-11-10). Live checks replace them per
  service once a Gemini key is set.
- **Value scoring** uses per-category "fair cost per hour" benchmarks scaled per currency. They
  are judgement calls in `domain/intelligence.ts`, not measured data.
- **Not yet run against the real services:** the Gemini agent loop and Studio assistant, PayPal
  calls, live plan checks, Plaid, Setu and Spotify. No credentials were available while building. The Android app
  compiles (`cd android && ./gradlew assembleDebug`) but has not been run on a device.
