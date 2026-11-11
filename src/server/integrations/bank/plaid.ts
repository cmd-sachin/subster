// Plaid connector. Uses the REST API directly: link token, token exchange, /transactions/sync,
// and the sandbox helpers that create an Item and post test transactions. Set PLAID_ENV to
// "production" with production keys to link real accounts through the same code path.

import type { BankLink, BankTransaction } from '@/domain/types';
import type { BankConnector, SyncResult } from './connector';

const env = () => (process.env.PLAID_ENV === 'production' ? 'production' : 'sandbox');
const base = () => `https://${env()}.plaid.com`;

export const plaidConfigured = () => Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);

async function plaid<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error_code?: string; error_message?: string };
  if (!res.ok) throw new Error(`Plaid ${data.error_code ?? res.status}: ${data.error_message ?? 'request failed'}`);
  return data;
}

/** Where Plaid should send webhooks. Needs a public URL (a tunnel or a deployment). */
const webhookUrl = (origin: string) => {
  const publicUrl = process.env.PUBLIC_URL ?? origin;
  return /localhost|127\.0\.0\.1/.test(publicUrl) ? undefined : `${publicUrl.replace(/\/$/, '')}/api/bank/webhook`;
};

async function exchangeToken(publicToken: string, institution: string, mask?: string): Promise<BankLink> {
  const { access_token } = await plaid<{ access_token: string }>('/item/public_token/exchange', { public_token: publicToken });
  return { provider: 'plaid', institution, accountMask: mask, linkedAt: new Date().toISOString(), accessToken: access_token };
}

interface PlaidTransaction {
  transaction_id: string;
  date: string;
  name?: string;
  merchant_name?: string | null;
  amount: number;
  pending: boolean;
}

export const plaidConnector: BankConnector = {
  id: 'plaid',

  async createLinkToken(origin) {
    const { link_token } = await plaid<{ link_token: string }>('/link/token/create', {
      user: { client_user_id: 'subster-demo-user' },
      client_name: 'Subster',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
      transactions: { days_requested: 365 },
      webhook: webhookUrl(origin),
    });
    return link_token;
  },

  exchange(publicToken, meta) {
    return exchangeToken(publicToken, meta.institution ?? 'Linked bank', meta.mask);
  },

  async instantLink(origin) {
    if (env() !== 'sandbox') throw new Error('Instant link only exists in the Plaid sandbox. Use the Link flow.');
    const { public_token } = await plaid<{ public_token: string }>('/sandbox/public_token/create', {
      institution_id: 'ins_109508',
      initial_products: ['transactions'],
      options: { webhook: webhookUrl(origin), transactions: { days_requested: 365 } },
    });
    return exchangeToken(public_token, 'First Platypus Bank (Plaid sandbox)', '0000');
  },

  async sync(link): Promise<SyncResult> {
    const added: BankTransaction[] = [];
    let cursor = link.cursor ?? '';
    for (let page = 0; page < 20; page++) {
      const res = await plaid<{ added: PlaidTransaction[]; next_cursor: string; has_more: boolean }>('/transactions/sync', {
        access_token: link.accessToken,
        cursor: cursor || undefined,
        count: 500,
      });
      for (const t of res.added) {
        // Plaid reports money leaving the account as a positive amount. Pending charges are
        // skipped: they reappear under a new id once posted.
        if (t.pending || t.amount <= 0) continue;
        added.push({ id: t.transaction_id, date: t.date, description: t.merchant_name ?? t.name ?? 'Unknown', amount: t.amount });
      }
      // An empty cursor means Plaid is still preparing the Item: keep the old one and retry later.
      if (res.next_cursor) cursor = res.next_cursor;
      if (!res.has_more) break;
    }
    return { added, cursor };
  },

  async postTestTransactions(link, transactions) {
    if (env() !== 'sandbox') throw new Error('Test transactions can only be posted in the Plaid sandbox.');
    // The sandbox accepts ten transactions per call.
    for (let i = 0; i < transactions.length; i += 10) {
      await plaid('/sandbox/transactions/create', {
        access_token: link.accessToken,
        transactions: transactions.slice(i, i + 10).map((t) => ({ date_transacted: t.date, date_posted: t.date, amount: t.amount, description: t.description })),
      });
    }
  },
};
