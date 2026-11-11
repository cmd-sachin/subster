// PayPal integration through the official TypeScript Server SDK: Subscriptions (create, read,
// cancel, suspend, activate) and Transaction Search. There is no simulated mode: without
// PAYPAL_CLIENT_ID and PAYPAL_SECRET every function here refuses with a clear message, and the
// rest of the app treats PayPal as not connected. PAYPAL_ENV=live switches from the sandbox to
// production.

import '../env';
import { ApiError, Client, Environment, IntervalUnit, SubscriptionsController, TenureType, TransactionSearchController } from '@paypal/paypal-server-sdk';
import type { BillingCycle } from '@/domain/types';
import { HttpError } from '../http';
import { log } from '../logger';

export type PayPalStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'APPROVAL_PENDING' | 'APPROVED' | 'EXPIRED' | 'UNKNOWN';
export type PayPalMode = 'sandbox' | 'live' | 'off';

const clientId = () => process.env.PAYPAL_CLIENT_ID;
const clientSecret = () => process.env.PAYPAL_SECRET;
const live = () => process.env.PAYPAL_ENV === 'live';
const api = () => (live() ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

export const paypalMode = (): PayPalMode => (!clientId() || !clientSecret() ? 'off' : live() ? 'live' : 'sandbox');

function requireConfigured() {
  if (paypalMode() === 'off') throw new HttpError(503, 'PayPal is not connected yet.');
}

let sdk: { subscriptions: SubscriptionsController; transactions: TransactionSearchController } | undefined;
function controllers() {
  requireConfigured();
  if (!sdk) {
    const client = new Client({
      environment: live() ? Environment.Production : Environment.Sandbox,
      clientCredentialsAuthCredentials: { oAuthClientId: clientId()!, oAuthClientSecret: clientSecret()! },
    });
    sdk = { subscriptions: new SubscriptionsController(client), transactions: new TransactionSearchController(client) };
  }
  return sdk;
}

const describe = (error: unknown) =>
  error instanceof ApiError ? `PayPal ${error.statusCode}: ${typeof error.body === 'string' ? error.body.slice(0, 300) : error.message}` : error instanceof Error ? error.message : String(error);

/** Runs one PayPal call, logging its outcome and duration. */
async function call<T>(operation: string, meta: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await fn();
    log.info('paypal', operation, { ...meta, mode: paypalMode(), ms: Math.round(performance.now() - started) });
    return result;
  } catch (error) {
    const message = describe(error);
    log.error('paypal', `${operation} failed`, { ...meta, mode: paypalMode(), error: message, ms: Math.round(performance.now() - started) });
    // The reason is in the log. What reaches the screen stays plain.
    throw error instanceof HttpError ? error : new Error('PayPal could not complete this right now. Nothing was changed.');
  }
}

// ---- Subscription lifecycle (what approved actions call) -----------------------------------

export async function getSubscriptionStatus(id: string): Promise<PayPalStatus> {
  return call('get subscription', { id }, async () => {
    const { result } = await controllers().subscriptions.getSubscription({ id });
    return (result.status as PayPalStatus | undefined) ?? 'UNKNOWN';
  });
}

type Lifecycle = 'cancel' | 'suspend' | 'activate';

/** Runs one lifecycle call, then re-reads the agreement so the caller can verify the result. */
export async function changeSubscription(id: string, op: Lifecycle, reason: string): Promise<{ before: PayPalStatus; after: PayPalStatus }> {
  const before = await getSubscriptionStatus(id);
  await call(`${op} subscription`, { id, before }, async () => {
    const { subscriptions } = controllers();
    if (op === 'cancel') await subscriptions.cancelSubscription({ id, body: { reason } });
    else if (op === 'suspend') await subscriptions.suspendSubscription({ id, body: { reason } });
    else await subscriptions.activateSubscription({ id, body: { reason } });
  });
  return { before, after: await getSubscriptionStatus(id) };
}

// ---- Starting a new agreement --------------------------------------------------------------

async function accessToken() {
  requireConfigured();
  const res = await fetch(`${api()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal token request failed (${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const INTERVAL: Record<BillingCycle, { unit: IntervalUnit; count: number }> = {
  monthly: { unit: IntervalUnit.Month, count: 1 },
  quarterly: { unit: IntervalUnit.Month, count: 3 },
  yearly: { unit: IntervalUnit.Year, count: 1 },
};

/**
 * Creates a catalog product, a billing plan and an agreement for it, and returns the approval
 * link the buyer opens at PayPal. The Catalog Products API is not in the SDK, so that one call is
 * plain REST. PayPal bills subscriptions in USD here: its subscription billing does not support INR.
 */
export async function createAgreement(input: { name: string; price: number; cycle: BillingCycle; customId: string; returnUrl: string; cancelUrl: string }) {
  return call('create agreement', { name: input.name, price: input.price, cycle: input.cycle }, async () => {
    const token = await accessToken();
    const productRes = await fetch(`${api()}/v1/catalogs/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.name.slice(0, 120), type: 'DIGITAL', category: 'SOFTWARE' }),
    });
    if (!productRes.ok) throw new Error(`PayPal product creation failed (${productRes.status}): ${(await productRes.text()).slice(0, 200)}`);
    const product = (await productRes.json()) as { id: string };

    const { subscriptions } = controllers();
    const interval = INTERVAL[input.cycle];
    const plan = await subscriptions.createBillingPlan({
      prefer: 'return=representation',
      body: {
        productId: product.id,
        name: `${input.name} ${input.cycle}`.slice(0, 120),
        billingCycles: [
          {
            frequency: { intervalUnit: interval.unit, intervalCount: interval.count },
            tenureType: TenureType.Regular,
            sequence: 1,
            totalCycles: 0,
            pricingScheme: { fixedPrice: { currencyCode: 'USD', value: input.price.toFixed(2) } },
          },
        ],
        paymentPreferences: { autoBillOutstanding: true, paymentFailureThreshold: 1 },
      },
    });
    const subscription = await subscriptions.createSubscription({
      prefer: 'return=representation',
      body: { planId: plan.result.id!, customId: input.customId, applicationContext: { brandName: 'Subster', returnUrl: input.returnUrl, cancelUrl: input.cancelUrl } },
    });
    const approveUrl = subscription.result.links?.find((l) => l.rel === 'approve')?.href;
    if (!subscription.result.id || !approveUrl) throw new Error('PayPal did not return an approval link.');
    return { subscriptionId: subscription.result.id, planId: plan.result.id!, approveUrl };
  });
}

// ---- Transaction Search --------------------------------------------------------------------

export interface PayPalTransaction {
  id: string;
  date: string;
  amount: number;
  currency: string;
  status: string;
  subject: string;
}

/** Last 30 days of the account's ledger. Requires the app's "Transaction search" feature. */
export async function recentTransactions(): Promise<PayPalTransaction[]> {
  return call('search transactions', { days: 30 }, async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86_400_000);
    const { result } = await controllers().transactions.searchTransactions({ startDate: start.toISOString(), endDate: end.toISOString(), fields: 'all', pageSize: 100, page: 1 });
    return (result.transactionDetails ?? []).map((t) => ({
      id: t.transactionInfo?.transactionId ?? '',
      date: t.transactionInfo?.transactionInitiationDate ?? '',
      amount: Number(t.transactionInfo?.transactionAmount?.value ?? 0),
      currency: t.transactionInfo?.transactionAmount?.currencyCode ?? 'USD',
      status: t.transactionInfo?.transactionStatus ?? '',
      subject: t.transactionInfo?.transactionSubject ?? t.transactionInfo?.transactionNote ?? '',
    }));
  });
}

// ---- Webhooks ------------------------------------------------------------------------------

/** Verifies a webhook against PAYPAL_WEBHOOK_ID. Anything that does not verify is rejected. */
export async function verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (paypalMode() === 'off' || !webhookId) return false;
  const res = await fetch(`${api()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers.get('paypal-auth-algo'),
      cert_url: headers.get('paypal-cert-url'),
      transmission_id: headers.get('paypal-transmission-id'),
      transmission_sig: headers.get('paypal-transmission-sig'),
      transmission_time: headers.get('paypal-transmission-time'),
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  if (!res.ok) return false;
  return ((await res.json()) as { verification_status?: string }).verification_status === 'SUCCESS';
}
