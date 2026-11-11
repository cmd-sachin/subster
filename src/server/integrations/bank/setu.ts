// Setu Account Aggregator connector (v2 FIU APIs). The flow is redirect based: create a consent,
// send the user to Setu's consent screens, then pull statements through short-lived data sessions.
// Which data a consent covers (FI types, fetch frequency, purpose) is configured on the Setu
// Bridge product, so the requests here only carry what varies per user.

import type { BankTransaction } from '@/domain/types';
import type { BankConnector, SyncResult } from './connector';

const base = () => (process.env.SETU_BASE_URL ?? 'https://fiu-sandbox.setu.co').replace(/\/$/, '');
// Setu documents this one login host for the AA gateway; it is not under the FIU base URL.
const TOKEN_URL = 'https://orgservice-prod.setu.co/v1/users/login';
const DAY = 86_400_000;

export const setuConfigured = () =>
  Boolean(process.env.SETU_CLIENT_ID && process.env.SETU_CLIENT_SECRET && process.env.SETU_PRODUCT_INSTANCE_ID);

interface SetuError {
  errorCode?: string;
  errorMsg?: string;
}

let token: string | undefined;

async function login(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', client: 'bridge' },
    body: JSON.stringify({ clientID: process.env.SETU_CLIENT_ID, grant_type: 'client_credentials', secret: process.env.SETU_CLIENT_SECRET }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string } & SetuError;
  if (!res.ok || !data.access_token) throw new Error(`Setu login ${data.errorCode ?? res.status}: ${data.errorMsg ?? 'could not get an access token'}`);
  return data.access_token;
}

async function setu<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
  if (!setuConfigured()) throw new Error('Bank linking through Account Aggregator is not available yet.');
  // The token lifetime is not documented, so one is reused until Setu answers 401, then replaced once.
  for (let attempt = 0; ; attempt++) {
    token ??= await login();
    const res = await fetch(`${base()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-product-instance-id': process.env.SETU_PRODUCT_INSTANCE_ID!,
      },
      body: body && JSON.stringify(body),
    });
    if (res.status === 401 && attempt === 0) {
      token = undefined;
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as T & SetuError;
    if (!res.ok) throw new Error(`Setu ${data.errorCode ?? res.status}: ${data.errorMsg ?? 'request failed'}`);
    return data;
  }
}

interface SetuConsent {
  id: string;
  url: string;
  status: string;
  detail?: { dataRange?: { from: string; to: string } };
  accountsLinked?: { fipId?: string; maskedAccNumber?: string }[];
}

interface SetuTransaction {
  txnId?: string;
  type?: string;
  amount?: string;
  narration?: string;
  transactionTimestamp?: string;
  valueDate?: string;
}

interface SetuSession {
  id: string;
  status: 'ACTIVE' | 'PENDING' | 'PARTIAL' | 'COMPLETED' | 'EXPIRED' | 'FAILED';
  fips?: { fipID: string; accounts: { linkRefNumber?: string; data?: { account?: { transactions?: { transaction?: SetuTransaction[] | null } } } | null }[] }[] | null;
}

const consentPath = (id: string) => `/v2/consents/${encodeURIComponent(id)}`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const setuConnector: BankConnector = {
  id: 'setu',

  async startRedirect(origin, input) {
    const mobile = input.mobile.replace(/\D/g, '').slice(-10);
    if (mobile.length !== 10) throw new Error('Enter the 10 digit mobile number registered with your bank.');
    const now = Date.now();
    const consent = await setu<SetuConsent>('POST', '/v2/consents', {
      consentDuration: { unit: 'YEAR', value: 1 },
      // A bare mobile number lets Setu pick the best performing AA for the user.
      vua: mobile,
      // Data sessions must stay inside this range, so it runs to the consent's expiry and
      // later syncs can still ask for transactions that have not happened yet.
      dataRange: { from: new Date(now - 365 * DAY).toISOString(), to: new Date(now + 365 * DAY).toISOString() },
      redirectUrl: `${(process.env.PUBLIC_URL ?? origin).replace(/\/$/, '')}/api/bank/callback`,
      context: [],
    });
    return { url: consent.url, reference: consent.id };
  },

  async completeRedirect(reference) {
    const consent = await setu<SetuConsent>('GET', consentPath(reference));
    if (consent.status !== 'ACTIVE') throw new Error(`Setu consent is ${consent.status}, not ACTIVE. Approve the request in the Account Aggregator screen first.`);
    // Setu identifies the bank by its FIP id (for example "setu-fip"), not a display name.
    const account = consent.accountsLinked?.[0];
    return {
      provider: 'setu',
      institution: account?.fipId ?? 'Account Aggregator (Setu)',
      accountMask: account?.maskedAccNumber?.slice(-4),
      linkedAt: new Date().toISOString(),
      accessToken: consent.id,
    };
  },

  instantLink() {
    throw new Error('Instant link does not exist for Account Aggregator. Link a real bank through the Setu consent redirect.');
  },

  async sync(link): Promise<SyncResult> {
    if (!link.accessToken) throw new Error('This bank link has no Setu consent id.');
    const cursor = link.cursor ?? '';
    const consent = await setu<SetuConsent>('GET', `${consentPath(link.accessToken)}?expanded=true`);
    if (consent.status !== 'ACTIVE') throw new Error(`Setu consent is ${consent.status}. Link the bank again to keep syncing.`);

    const range = consent.detail?.dataRange;
    const from = Math.max(Date.parse(cursor) || 0, range ? Date.parse(range.from) : Date.now() - 365 * DAY);
    const to = Math.min(Date.now(), range ? Date.parse(range.to) : Infinity);
    if (from >= to) return { added: [], cursor };

    let session = await setu<SetuSession>('POST', '/v2/sessions', {
      consentId: link.accessToken,
      dataRange: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      format: 'json',
    });
    // Banks answer asynchronously. Setu also sends a webhook, but a short poll keeps sync self-contained.
    for (let attempt = 0; attempt < 8 && session.status !== 'COMPLETED' && session.status !== 'PARTIAL'; attempt++) {
      if (session.status === 'FAILED' || session.status === 'EXPIRED') throw new Error(`Setu data session ${session.status.toLowerCase()}. Try syncing again.`);
      await wait(2500);
      session = await setu<SetuSession>('GET', `/v2/sessions/${encodeURIComponent(session.id)}`);
    }
    // Still preparing: keep the old cursor so the next sync asks for the same window again.
    if (session.status !== 'COMPLETED' && session.status !== 'PARTIAL') return { added: [], cursor };

    const added: BankTransaction[] = [];
    let latest = cursor;
    for (const fip of session.fips ?? []) {
      for (const account of fip.accounts) {
        for (const t of account.data?.account?.transactions?.transaction ?? []) {
          const at = t.transactionTimestamp || t.valueDate || '';
          const time = Date.parse(at);
          const amount = Number(t.amount);
          // Only money leaving the account matters. The cursor boundary is inclusive because some
          // banks report date-only timestamps; ids are stable, so a repeat is dropped downstream.
          if (t.type?.toUpperCase() !== 'DEBIT' || !(amount > 0) || Number.isNaN(time) || time < (Date.parse(cursor) || 0)) continue;
          // txnId is only unique within one account, and a few banks leave it empty.
          const ref = t.txnId || `${at}:${t.amount}:${t.narration ?? ''}`;
          added.push({ id: `setu:${account.linkRefNumber ?? fip.fipID}:${ref}`, date: at.slice(0, 10), description: t.narration?.trim() || 'Unknown', amount });
          if (time > (Date.parse(latest) || 0)) latest = new Date(time).toISOString();
        }
      }
    }
    // PARTIAL means some accounts have not delivered yet. Moving the cursor would skip their
    // older transactions for good, so it only advances once every account has answered.
    return { added, cursor: session.status === 'COMPLETED' ? latest : cursor };
  },

  async postTestTransactions() {
    throw new Error('Test transactions cannot be posted to a real bank account linked through Account Aggregator.');
  },
};
