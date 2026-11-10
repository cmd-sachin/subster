// Bank link lifecycle: link an account, sync it, and react to what the sync finds. A sync that
// discovers a subscription, or sees a charge land on one that is not earning its place, starts an
// agent run on its own. This is the live path: bank event -> sync -> discovery -> agent -> inbox.

import { addDays, money, today } from '@/domain/dates';
import { analyze } from '@/domain/intelligence';
import type { AgentRun, BankLink } from '@/domain/types';
import { runAgent } from '@/server/agent/run';
import { availableBanks, connectorFor, plaidIsSandbox, type BankProvider } from '@/server/integrations/bank';
import { HttpError } from '@/server/http';
import { log } from '@/server/logger';
import { db, save, uid } from '@/server/store';
import { classifyUnknownWithAi } from './classifier';
import { ingest, type IngestResult } from './discovery';

export interface SyncOutcome extends IngestResult {
  run?: AgentRun;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function requireProvider(provider: BankProvider) {
  if (!availableBanks().includes(provider)) throw new HttpError(503, `${provider === 'plaid' ? 'Plaid' : 'Setu'} is not configured. Add its keys to .env.local.`);
  return connectorFor(provider);
}

function store(link: BankLink) {
  db().bank = link;
  save('bank linked');
  log.info('bank', `Linked ${link.institution}`, { provider: link.provider, account: link.accountMask });
  return link;
}

/** Token for Plaid Link, the provider-hosted UI where the user signs in to their bank. */
export const createLinkToken = (origin: string) => requireProvider('plaid').createLinkToken!(origin);

/** Completes a Plaid Link session. */
export const linkWithPlaid = async (input: { publicToken: string; institution?: string; mask?: string }) => store(await requireProvider('plaid').exchange!(input.publicToken, input));

/** Plaid sandbox only: links Plaid's test institution without the UI. */
export async function linkPlaidSandbox(origin: string) {
  if (!plaidIsSandbox()) throw new HttpError(400, 'Instant link exists only in the Plaid sandbox.');
  return store(await requireProvider('plaid').instantLink(origin));
}

/** Account Aggregator (India): creates a consent request and returns where to send the user. */
export async function startAggregatorConsent(origin: string, mobile: string) {
  if (!/^[6-9]\d{9}$/.test(mobile)) throw new HttpError(400, 'Enter the 10 digit mobile number registered with your bank.');
  const started = await requireProvider('setu').startRedirect!(origin, { mobile });
  db().pendingConsent = started.reference;
  save('consent started');
  log.info('bank', 'Account Aggregator consent created', { reference: started.reference });
  return started.url;
}

/** Called when the Account Aggregator sends the user back. The reference must be the one we issued. */
export async function completeAggregatorConsent(reference: string) {
  const data = db();
  if (!reference || data.pendingConsent !== reference) throw new HttpError(400, 'This consent does not match the one started from this app.');
  const link = await requireProvider('setu').completeRedirect!(reference);
  data.pendingConsent = undefined;
  return store(link);
}

export function unlinkBank() {
  const link = db().bank;
  db().bank = null;
  save('bank unlinked');
  if (link) log.info('bank', `Unlinked ${link.institution}`);
}

/**
 * Pulls new transactions and feeds them to discovery. `expectNew` retries for a few seconds,
 * because Plaid can take a moment to surface a transaction that was just posted.
 */
export async function syncBank(options: { expectNew?: boolean; source?: string } = {}): Promise<SyncOutcome> {
  const data = db();
  const link = data.bank;
  if (!link) throw new HttpError(400, 'No bank account is linked.');
  const connector = connectorFor(link.provider);
  const started = performance.now();

  let result: IngestResult = { newTransactions: 0, charged: [], discovered: [], candidates: [] };
  // Each Setu sync opens a metered data session, so it is never retried in a loop.
  const attempts = options.expectNew && link.provider === 'plaid' ? 6 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await wait(2000);
    const { added, cursor } = await connector.sync(link);
    link.cursor = cursor;
    link.lastSyncAt = new Date().toISOString();
    result = ingest(added, 'bank');
    if (result.newTransactions > 0) break;
  }
  if (result.discovered.length > 0) await classifyUnknownWithAi();

  // Charges from the last two days go on the timeline.
  const recent = addDays(today(), -2);
  for (const c of result.charged.filter((c) => c.date >= recent)) {
    data.notes.push({ id: uid('note'), subId: c.subId, date: c.date, kind: 'bank', label: c.previousPrice !== undefined ? `Charged ${money(c.amount)} (was ${money(c.previousPrice)})` : `Charged ${money(c.amount)}` });
  }
  const handled = `${result.newTransactions} new transactions, ${result.charged.length} matched to subscriptions, ${result.discovered.length} discovered`;
  data.webhookLog.unshift({ at: new Date().toISOString(), source: 'bank', type: options.source ?? 'SYNC', resource: link.institution, handled });
  data.webhookLog = data.webhookLog.slice(0, 50);
  save('bank sync');
  log.info('bank', `Sync finished: ${handled}`, { provider: link.provider, trigger: options.source ?? 'SYNC', ms: Math.round(performance.now() - started) });

  const task = agentTask(result);
  if (!task) return result;
  const run = await runAgent({ trigger: 'bank', triggerDetail: task.detail, task: task.prompt, focus: task.focus }, () => {});
  return { ...result, run };
}

/** Decides whether a sync is worth the agent's attention, and what to tell it. */
function agentTask(result: IngestResult) {
  const insights = analyze(db()).insights;
  const recent = addDays(today(), -2);
  const worrying = result.charged.filter((c) => {
    const verdict = insights.find((i) => i.sub.id === c.subId)?.verdict;
    return c.date >= recent && (c.previousPrice !== undefined || verdict === 'poor' || verdict === 'unused');
  });
  if (worrying.length === 0 && result.discovered.length === 0) return null;

  const parts = [
    ...worrying.map((c) =>
      c.previousPrice !== undefined ? `${c.name} was just charged ${money(c.amount)}, up from ${money(c.previousPrice)}.` : `${c.name} was just charged ${money(c.amount)} even though it gets little or no use.`,
    ),
    result.discovered.length ? `New subscriptions found in the bank feed: ${result.discovered.join(', ')}.` : '',
  ].filter(Boolean);
  const focus = [...worrying.map((c) => c.subId), ...insights.filter((i) => result.discovered.includes(i.sub.name)).map((i) => i.sub.id)];
  return {
    detail: parts.join(' '),
    focus,
    prompt: `The linked bank account just synced. ${parts.join(' ')} Look at the affected subscriptions and decide whether anything should be proposed or scheduled because of this. Stay focused on these events.`,
  };
}

/**
 * Plaid sandbox only: asks Plaid to post a transaction to the test institution, then syncs it
 * back through the normal path. For exercising the live pipeline before production access.
 */
export async function postSandboxTransaction(description: string, amount: number) {
  const link = db().bank;
  if (!link || link.provider !== 'plaid' || !plaidIsSandbox()) throw new HttpError(400, 'Test transactions can only be posted to a Plaid sandbox account.');
  await connectorFor('plaid').postTestTransactions(link, [{ date: today(), description, amount }]);
  log.info('bank', 'Posted a sandbox transaction', { description, amount });
  return syncBank({ expectNew: true, source: 'SANDBOX_TRANSACTION' });
}
