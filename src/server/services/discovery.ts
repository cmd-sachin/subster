// Turns money movements into subscriptions. Every source (bank sync, statement upload) feeds the
// same `ingest` function:
//   1. a transaction from a merchant we already track becomes a charge on that subscription
//      (and reveals a price increase the moment it is billed);
//   2. the rest are grouped per merchant, and a merchant charged at a regular interval becomes a
//      subscription if it is in the provider catalog, or a candidate the user confirms if not.

import { findProvider } from '@/domain/catalog';
import { classify } from '@/domain/classify';
import { addMonths, cycleMonths, diffDays } from '@/domain/dates';
import type { BankTransaction, BillingCycle, Charge, PaymentRail } from '@/domain/types';
import { log } from '@/server/logger';
import { db, uid } from '@/server/store';
import { createSubscription } from './subscriptions';

export interface IngestResult {
  newTransactions: number;
  charged: { subId: string; name: string; amount: number; date: string; previousPrice?: number }[];
  discovered: string[];
  candidates: string[];
}

/** Statement narrations wrap the merchant in rail noise (UPI/ACH/POS references); this strips it. */
const merchantKey = (description: string) =>
  description
    .toLowerCase()
    .replace(/[0-9#*@/_:.-]+/g, ' ')
    .replace(/\b(inc|llc|ltd|pvt|com|www|payment|purchase|subscription|pos|debit|card|upi|autopay|recurring|ach|neft|imps|mandate|bill|pay|india|online|ecom|si)\b/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .slice(0, 2)
    .join(' ');

function cycleOf(gaps: number[]): BillingCycle | null {
  if (gaps.every((g) => g >= 26 && g <= 33)) return 'monthly'; // includes 28-day prepaid plans
  if (gaps.every((g) => g >= 80 && g <= 95)) return 'quarterly'; // includes 84-day prepaid plans
  if (gaps.every((g) => g >= 355 && g <= 375)) return 'yearly';
  return null;
}

function matchSubscription(description: string) {
  const subs = db().subscriptions;
  const provider = findProvider(description);
  if (provider) {
    const byProvider = subs.find((s) => s.providerId === provider.id || s.name === provider.name);
    if (byProvider) return byProvider;
  }
  const key = merchantKey(description);
  return key ? subs.find((s) => merchantKey(s.name) === key) : undefined;
}

export function ingest(transactions: BankTransaction[], source: 'bank' | 'statement'): IngestResult {
  const data = db();
  const rail: PaymentRail = source === 'bank' ? 'bank' : 'card';
  const seen = new Set(data.bankTransactions.map((t) => t.id));
  const fresh = transactions.filter((t) => t.amount > 0 && !seen.has(t.id)).sort((a, b) => a.date.localeCompare(b.date));
  const result: IngestResult = { newTransactions: fresh.length, charged: [], discovered: [], candidates: [] };
  if (fresh.length === 0) return result;
  data.bankTransactions.push(...fresh);

  // 1. Charges on subscriptions we already track.
  for (const tx of fresh) {
    const sub = matchSubscription(tx.description);
    if (!sub) continue;
    tx.subId = sub.id;
    const duplicate = data.charges.some((c) => c.subId === sub.id && Math.abs(diffDays(c.date, tx.date)) <= 3 && c.status !== 'failed');
    if (duplicate) continue;

    const previousPrice = tx.amount > sub.price * 1.02 ? sub.price : undefined;
    data.charges.push({ id: uid('ch'), subId: sub.id, date: tx.date, amount: tx.amount, status: 'paid', rail: sub.rail });
    if (previousPrice !== undefined || tx.amount < sub.price * 0.98) sub.price = tx.amount;
    if (sub.status === 'past_due' || sub.status === 'trial') sub.status = 'active';
    // A charge at or near the due date starts the next period.
    if (diffDays(sub.nextRenewal, tx.date) <= 10) sub.nextRenewal = addMonths(tx.date, cycleMonths(sub.cycle));
    result.charged.push({ subId: sub.id, name: sub.name, amount: tx.amount, date: tx.date, previousPrice });
    if (previousPrice !== undefined) log.warn('discovery', `${sub.name} price rose`, { from: previousPrice, to: tx.amount, date: tx.date });
  }

  // 2. Recurring merchants we do not track yet, judged over everything seen so far.
  const groups = new Map<string, BankTransaction[]>();
  for (const tx of data.bankTransactions) {
    if (tx.subId) continue;
    const key = findProvider(tx.description)?.name ?? merchantKey(tx.description);
    if (key) groups.set(key, [...(groups.get(key) ?? []), tx]);
  }

  for (const [key, txs] of groups) {
    if (txs.length < 2 || !txs.some((t) => fresh.includes(t))) continue;
    txs.sort((a, b) => a.date.localeCompare(b.date));
    const cycle = cycleOf(txs.slice(1).map((t, i) => diffDays(t.date, txs[i].date)));
    const last = txs.at(-1)!;
    const stable = txs.every((t) => Math.abs(t.amount - last.amount) / last.amount <= 0.35);
    if (!cycle || !stable) continue;

    const provider = findProvider(last.description);
    if (!provider) {
      // Regular, but not a known subscription service (rent, a gym, a loan). Ask the user.
      if (!data.ignoredMerchants.includes(key) && !data.candidates.some((c) => c.key === key)) {
        const name = key.replace(/\b\w/g, (c) => c.toUpperCase());
        data.candidates.push({ key, name, amount: last.amount, cycle, lastDate: last.date, count: txs.length, category: classify(last.description).category });
        result.candidates.push(name);
      }
      continue;
    }
    const sub = createSubscription({ name: provider.name, providerId: provider.id, price: last.amount, cycle, rail, source, lastChargedOn: last.date, startedAt: txs[0].date });
    attachCharges(sub.id, txs, rail);
    result.discovered.push(provider.name);
  }

  data.charges.sort((a, b) => a.date.localeCompare(b.date));
  log.info('discovery', `Ingested ${fresh.length} transactions from ${source}`, { matched: result.charged.length, discovered: result.discovered, candidates: result.candidates });
  return result;
}

function attachCharges(subId: string, transactions: BankTransaction[], rail: PaymentRail) {
  db().charges.push(
    ...transactions.map<Charge>((t) => {
      t.subId = subId;
      return { id: uid('ch'), subId, date: t.date, amount: t.amount, status: 'paid', rail };
    }),
  );
}

/** The user's decision on a recurring merchant the catalog does not know. */
export function resolveCandidate(key: string, decision: 'track' | 'ignore') {
  const data = db();
  const candidate = data.candidates.find((c) => c.key === key);
  if (!candidate) return null;
  data.candidates = data.candidates.filter((c) => c.key !== key);
  log.info('discovery', `Candidate ${candidate.name}: ${decision}`, { key });
  if (decision === 'ignore') {
    data.ignoredMerchants.push(key);
    return null;
  }
  const transactions = data.bankTransactions.filter((t) => !t.subId && merchantKey(t.description) === key).sort((a, b) => a.date.localeCompare(b.date));
  if (transactions.length === 0) return null;
  const sub = createSubscription({ name: candidate.name, price: candidate.amount, cycle: candidate.cycle, rail: 'bank', source: 'bank', lastChargedOn: candidate.lastDate, startedAt: transactions[0].date, category: { value: candidate.category, by: 'rules' } });
  attachCharges(sub.id, transactions, 'bank');
  data.charges.sort((a, b) => a.date.localeCompare(b.date));
  return sub;
}
