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
cp env.example .env.local     # PayPal sandbox keys are enough to see the PayPal flow
npm run dev                   # http://localhost:3000
```

1. Open **Connections** and press **Open demo**. Thirteen sample subscriptions appear with a year
   of payments and 60 days of usage. Your own data is set aside and returns when you close it.
2. **Command center**: one number (what you could keep a year), one quick win, the inbox of
   proposals. Press **Run audit** to watch the agent work.
3. **Savings**: every recommendation with its reason and yearly saving.
4. **Services**: pick a service priced in dollars, press **Start with PayPal**, approve it in the
   inbox. Subster creates a real PayPal sandbox plan and agreement and sends you to PayPal to
   confirm. Back in Subster the subscription is under one-tap control: pause or cancel it and the
   agreement's new status is read back from PayPal.
5. **Transactions**: open any payment and press **Help** for a refund request, a cancellation or a
   failed-payment fix.
6. **Timeline** (Bryntum) and **Analytics** (AG Studio).

Without any keys the app still runs on the demo data, with the built-in rules in place of the
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
- The Chrome extension, loaded in Chrome: it synced and reported a site as in use within seconds.

Written but not run against the real service:
- Plaid, the Setu Account Aggregator connector and Spotify sign-in. No keys were available.
- The Android companion builds (`cd android && ./gradlew assembleDebug`) but has not been run on
  a phone.
- Pausing or cancelling a PayPal agreement after a buyer has approved it. The code path is the
  same one the smoke test exercises up to approval; the approval itself needs a person signed in
  to a PayPal sandbox buyer account.

## Limits

- **No sign-in.** The app is single-user and holds financial data. Do not expose it publicly.
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
npm test             # statement parser tests
npm run test:extension
npm run smoke        # end to end against the dev server. Open the demo first: it erases the open data set.
npm run gateway      # forwards only webhook and callback paths, for use behind a tunnel
npm run tunnel       # public https address for the gateway
```

For PayPal webhooks, register `<tunnel address>/api/paypal/webhook` in the PayPal developer
dashboard and set `PAYPAL_WEBHOOK_ID` and `PUBLIC_URL`.

## Layout

```
src/
  domain/          pure logic shared by server and browser: data model, catalog, scoring
  server/
    integrations/  one module per outside system (paypal.ts, bank/)
    services/      use cases: actions (the permission boundary), connections, refunds, plans, scrape
    agent/         tools, the audit loop, the fit check, the daily schedule
    store/         persistence behind an adapter (one JSON document today), demo data
  routes/          pages, and server routes under routes/api
  components/      UI, including timeline (Bryntum) and studio/ (AG Studio)
extension/         Chrome extension: live usage and sign-in monitoring
android/           companion app: screen time
scripts/           smoke test, parser and extension tests
```
