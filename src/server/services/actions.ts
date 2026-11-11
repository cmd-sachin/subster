// The permission boundary. The agent can only *propose* (createProposal / proposeSubscription).
// Money-affecting calls happen in `execute`, which runs when the user approves, or when the user
// has given a standing permission ("auto" policy) for that subscription. Every execution is
// verified by reading the agreement back from PayPal and is recorded step by step.

import { providerById } from '@/domain/catalog';
import { addDays, cycleShort, money, round, today } from '@/domain/dates';
import { analyze, monthlyCost, standingDecline } from '@/domain/intelligence';
import type { ActionStep, ActionType, AgentAction, Subscription } from '@/domain/types';
import { HttpError } from '@/server/http';
import { changeSubscription, createAgreement, getSubscriptionStatus, paypalMode } from '@/server/integrations/paypal';
import { log } from '@/server/logger';
import { db, save, uid } from '@/server/store';
import { createSubscription } from './subscriptions';

const TITLES: Record<Exclude<ActionType, 'subscribe'>, (s: Subscription) => string> = {
  cancel: (s) => `Cancel ${s.name}`,
  pause: (s) => `Pause ${s.name}`,
  resume: (s) => `Resume ${s.name}`,
  downgrade: (s) => `Downgrade ${s.name} to ${s.cheaperPlan?.name ?? 'a cheaper plan'}`,
  retry_payment: (s) => `Fix payment for ${s.name}`,
};

/** PayPal can execute lifecycle changes for agreements it manages; everything else is guided. */
const channelFor = (sub: Subscription, type: ActionType): AgentAction['channel'] =>
  sub.paypalSubscriptionId && paypalMode() !== 'off' && (type === 'cancel' || type === 'pause' || type === 'resume') ? 'paypal_api' : 'guided';

const step = (label: string, ok: boolean, detail?: string): ActionStep => ({ at: new Date().toISOString(), label, ok, detail });

export interface ProposalInput {
  subId: string;
  type: Exclude<ActionType, 'subscribe'>;
  reason: string;
  evidence?: string[];
  runId?: string;
  /** Who asked for it. A request the user makes themselves is not an agent proposal. */
  by?: 'agent' | 'user';
}

export type ProposalResult = { ok: true; action: AgentAction; outcome: 'pending_approval' | 'auto_executed' | 'already_pending' } | { ok: false; error: string };

export async function createProposal(input: ProposalInput): Promise<ProposalResult> {
  const data = db();
  const sub = data.subscriptions.find((s) => s.id === input.subId);
  if (!sub) return { ok: false, error: `Unknown subscription "${input.subId}".` };
  if (sub.policy === 'locked') return { ok: false, error: `${sub.name} is locked by the user. Do not propose changes to it.` };
  if (sub.status === 'cancelled') return { ok: false, error: `${sub.name} is already cancelled.` };
  if (input.type === 'pause' && sub.status === 'paused') return { ok: false, error: `${sub.name} is already paused.` };
  if (input.type === 'resume' && sub.status !== 'paused') return { ok: false, error: `${sub.name} is not paused.` };
  if (input.type === 'downgrade' && !sub.cheaperPlan) return { ok: false, error: `${sub.name} has no cheaper plan on record.` };

  const existing = data.actions.find((a) => a.subId === sub.id && a.status === 'pending');
  if (existing) return { ok: true, action: existing, outcome: 'already_pending' };

  const insight = analyze(data).insights.find((i) => i.sub.id === sub.id)!;
  // The user's own request always goes through; the agent has to respect an earlier "no".
  const declined = input.by === 'user' ? undefined : standingDecline(data, sub.id, input.type, sub.price, insight.hours30, today());
  if (declined) return { ok: false, error: `The user declined to ${declined.type} ${sub.name} on ${declined.at.slice(0, 10)} and nothing has changed since (same price, similar use). Do not propose it again; leave it alone.` };
  const savingsMonthly =
    input.type === 'downgrade' && sub.cheaperPlan ? round(insight.monthlyCost - sub.cheaperPlan.price) : input.type === 'cancel' || input.type === 'pause' ? insight.monthlyCost : 0;

  const action: AgentAction = {
    id: uid('act'),
    subId: sub.id,
    type: input.type,
    title: TITLES[input.type](sub),
    reason: input.reason,
    evidence: input.evidence?.length ? input.evidence : insight.issues.map((i) => i.message),
    savingsMonthly,
    deadline: addDays(sub.trialEndsAt ?? sub.nextRenewal, -1),
    status: 'pending',
    channel: channelFor(sub, input.type),
    createdAt: new Date().toISOString(),
    runId: input.runId,
    steps: [step(input.by === 'user' ? 'Requested by you' : 'Proposed by the agent', true, input.reason)],
  };
  data.actions.unshift(action);
  save('proposal created');
  log.info('actions', `Proposed: ${action.title}`, { actionId: action.id, channel: action.channel, savingsMonthly, runId: input.runId });

  // Standing permission: the user pre-approved reversible pauses for this subscription.
  if (sub.policy === 'auto' && action.type === 'pause' && action.channel === 'paypal_api') {
    action.steps.push(step('Covered by your standing permission (auto-pause when unused)', true));
    await execute(action.id, 'policy', '');
    return { ok: true, action, outcome: 'auto_executed' };
  }
  return { ok: true, action, outcome: 'pending_approval' };
}

/** A proposal to start a new subscription through PayPal. Nothing is bought until it is approved. */
export function proposeSubscription(input: { providerId: string; planName?: string; reason: string; runId?: string }): ProposalResult {
  const data = db();
  const provider = providerById(input.providerId);
  if (!provider) return { ok: false, error: `Unknown service "${input.providerId}". Use search_services to find the right id.` };
  // PayPal bills these agreements in USD, so only USD plans can be started: the official site's
  // when it has been read, otherwise the catalog's list prices.
  const liveUsd = (data.livePlans[provider.id]?.plans ?? []).filter((p) => p.currency === 'USD').map(({ name, price, cycle }) => ({ name, price, cycle }));
  const plans = liveUsd.length > 0 ? liveUsd : provider.plans.filter((p) => p.currency === 'USD').map(({ name, price, cycle }) => ({ name, price, cycle }));
  if (plans.length === 0) return { ok: false, error: `${provider.name} has no plan list in the catalog, so it cannot be started from here. The user can subscribe on its site (${provider.manageUrl}) and Subster will pick up the payment.` };
  const plan = (input.planName && plans.find((p) => p.name.toLowerCase() === input.planName!.toLowerCase())) || (input.planName ? undefined : plans[0]);
  if (!plan) return { ok: false, error: `${provider.name} has no plan called "${input.planName}". Plans: ${plans.map((p) => p.name).join(', ')}.` };
  if (data.subscriptions.some((s) => s.providerId === provider.id && s.status !== 'cancelled')) return { ok: false, error: `The user already has an active ${provider.name} subscription.` };

  const existing = data.actions.find((a) => a.providerId === provider.id && a.type === 'subscribe' && (a.status === 'pending' || a.status === 'guided'));
  if (existing) return { ok: true, action: existing, outcome: 'already_pending' };

  const action: AgentAction = {
    id: uid('act'),
    subId: provider.id,
    providerId: provider.id,
    plan,
    type: 'subscribe',
    title: `Subscribe to ${provider.name} ${plan.name}`,
    reason: input.reason,
    evidence: [`${money(plan.price, 'USD')} per ${cycleShort(plan.cycle)}, billed through PayPal`, 'You can cancel or pause it from here at any time'],
    savingsMonthly: 0,
    deadline: addDays(today(), 7),
    status: 'pending',
    channel: 'paypal_api',
    createdAt: new Date().toISOString(),
    runId: input.runId,
    steps: [step(input.runId ? 'Proposed by the agent' : 'Requested by you', true, input.reason)],
  };
  data.actions.unshift(action);
  save('subscription proposed');
  log.info('actions', `Proposed: ${action.title}`, { actionId: action.id, price: plan.price, cycle: plan.cycle, runId: input.runId });
  return { ok: true, action, outcome: 'pending_approval' };
}

export async function execute(actionId: string, approvedBy: 'user' | 'policy', origin: string): Promise<AgentAction> {
  const data = db();
  const action = data.actions.find((a) => a.id === actionId);
  if (!action) throw new HttpError(404, 'Action not found');
  if (action.status !== 'pending') return action;
  action.approvedBy = approvedBy;
  if (approvedBy === 'user') action.steps.push(step('Approved by you', true));
  log.info('actions', `Approved: ${action.title}`, { actionId, approvedBy });

  if (action.type === 'subscribe') return startSubscription(action, origin);

  const sub = data.subscriptions.find((s) => s.id === action.subId)!;
  if (action.channel === 'guided') {
    action.status = 'guided';
    const why = sub.paypalSubscriptionId
      ? paypalMode() === 'off'
        ? 'PayPal is not connected, so this cannot be done for you.'
        : 'PayPal can cancel or pause this agreement but not change its plan.'
      : `${sub.name} is not billed through PayPal, so PayPal cannot act on it.`;
    action.steps.push(step('Handed to you to finish', true, `${why} Finish at ${sub.cancelUrl}`));
    save('action guided');
    return action;
  }

  const op = action.type === 'cancel' ? 'cancel' : action.type === 'pause' ? 'suspend' : 'activate';
  const expected = op === 'cancel' ? 'CANCELLED' : op === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
  try {
    action.steps.push(step(`Asking PayPal to ${op === 'suspend' ? 'pause' : op === 'activate' ? 'resume' : 'cancel'} agreement ${sub.paypalSubscriptionId}`, true));
    const { before, after } = await changeSubscription(sub.paypalSubscriptionId!, op, `Subster: ${action.reason}`.slice(0, 127));
    const verified = after === expected;
    action.steps.push(step(`Verified with PayPal: ${before} to ${after}`, verified, verified ? undefined : `Expected ${expected}`));
    if (!verified) throw new Error(`Subscription is ${after}, expected ${expected}`);

    sub.status = op === 'cancel' ? 'cancelled' : op === 'suspend' ? 'paused' : 'active';
    action.status = 'executed';
    action.steps.push(step(op === 'activate' ? 'Subscription is active again' : `Next charge of ${money(sub.price)} on ${sub.nextRenewal} will not happen`, true));
    log.info('actions', `Executed and verified: ${action.title}`, { actionId, before, after });
  } catch (error) {
    action.status = 'failed';
    const message = error instanceof Error ? error.message : String(error);
    action.steps.push(step('Execution failed. Nothing was changed.', false, message));
    log.error('actions', `Execution failed: ${action.title}`, { actionId, error: message });
  }
  action.resolvedAt = new Date().toISOString();
  save('action executed');
  return action;
}

/** Creates the PayPal agreement. The buyer still has to approve it at PayPal, so it ends "guided". */
async function startSubscription(action: AgentAction, origin: string): Promise<AgentAction> {
  const provider = providerById(action.providerId ?? '');
  const plan = action.plan;
  try {
    if (!provider || !plan) throw new Error('The app or plan for this proposal is no longer in the catalog.');
    action.steps.push(step(`Asking PayPal to create a ${plan.cycle} plan and agreement`, true));
    const base = process.env.PUBLIC_URL?.replace(/\/$/, '') || origin;
    const agreement = await createAgreement({
      name: `${provider.name} ${plan.name}`,
      price: plan.price,
      cycle: plan.cycle,
      customId: action.id,
      returnUrl: `${base}/api/paypal/return?action=${encodeURIComponent(action.id)}`,
      cancelUrl: `${base}/?paypal=cancelled`,
    });
    action.approveUrl = agreement.approveUrl;
    action.status = 'guided';
    action.steps.push(step('Agreement created. Waiting for you to approve it at PayPal.', true, agreement.subscriptionId));
  } catch (error) {
    action.status = 'failed';
    action.resolvedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    action.steps.push(step('Could not start the subscription. Nothing was charged.', false, message));
    log.error('actions', `Subscribe failed: ${action.title}`, { actionId: action.id, error: message });
  }
  save('subscription started');
  return action;
}

/** PayPal sent the buyer back after approving. Confirms with PayPal before recording anything. */
export async function completeSubscription(actionId: string, paypalId: string): Promise<boolean> {
  const data = db();
  const action = data.actions.find((a) => a.id === actionId && a.type === 'subscribe');
  const provider = providerById(action?.providerId ?? '');
  if (!action || !provider || !action.plan || action.status !== 'guided' || !/^I-[A-Z0-9]+$/.test(paypalId)) return false;

  const status = await getSubscriptionStatus(paypalId);
  const active = status === 'ACTIVE' || status === 'APPROVED';
  action.steps.push(step(`Verified with PayPal: agreement is ${status}`, active));
  if (active) {
    const sub = createSubscription({ name: provider.name, providerId: provider.id, plan: action.plan.name, price: action.plan.price, cycle: action.plan.cycle, rail: 'paypal', source: 'chat', paypalSubscriptionId: paypalId });
    data.charges.push({ id: uid('ch'), subId: sub.id, date: today(), amount: action.plan.price, status: 'paid', rail: 'paypal' });
    action.subId = sub.id;
    action.status = 'executed';
    action.steps.push(step(`${provider.name} is now tracked. Next charge ${sub.nextRenewal}.`, true));
    log.info('actions', `Subscribed and verified: ${action.title}`, { actionId, paypalId, monthly: round(monthlyCost(sub)) });
  } else {
    action.status = 'failed';
    log.warn('actions', `Agreement not active after approval: ${action.title}`, { actionId, status });
  }
  action.approveUrl = undefined;
  action.resolvedAt = new Date().toISOString();
  save('subscription completed');
  return active;
}

export function reject(actionId: string): AgentAction {
  const action = db().actions.find((a) => a.id === actionId);
  if (!action) throw new HttpError(404, 'Action not found');
  if (action.status === 'pending' || (action.type === 'subscribe' && action.status === 'guided')) {
    action.status = 'rejected';
    action.approveUrl = undefined;
    action.resolvedAt = new Date().toISOString();
    action.steps.push(step('Declined by you. No change made.', true));
    // Remembered, so the same suggestion does not come back while nothing has changed.
    const insight = analyze(db()).insights.find((i) => i.sub.id === action.subId);
    if (action.type !== 'subscribe' && insight) {
      const data = db();
      data.declines = [{ subId: action.subId, type: action.type, at: new Date().toISOString(), price: insight.sub.price, hours30: insight.hours30 }, ...(data.declines ?? []).filter((d) => !(d.subId === action.subId && d.type === action.type))].slice(0, 200);
      action.steps.push(step('Noted. This will not be suggested again unless the price or your use changes.', true));
    }
    save('action rejected');
    log.info('actions', `Declined: ${action.title}`, { actionId });
  }
  return action;
}

/** The user confirms they finished a guided action on the merchant's site. */
export function confirmGuided(actionId: string): AgentAction {
  const data = db();
  const action = data.actions.find((a) => a.id === actionId);
  if (!action) throw new HttpError(404, 'Action not found');
  if (action.status === 'guided' && action.type !== 'subscribe') {
    const sub = data.subscriptions.find((s) => s.id === action.subId)!;
    if (action.type === 'cancel') sub.status = 'cancelled';
    if (action.type === 'pause') sub.status = 'paused';
    if (action.type === 'downgrade' && sub.cheaperPlan) {
      sub.plan = sub.cheaperPlan.name;
      sub.price = sub.cheaperPlan.price;
      sub.cheaperPlan = undefined;
    }
    if (action.type === 'retry_payment') sub.status = 'active';
    action.status = 'executed';
    action.resolvedAt = new Date().toISOString();
    action.steps.push(step('You confirmed it is done (self-reported, not verified by PayPal)', true));
    save('guided action confirmed');
    log.info('actions', `Confirmed by the user: ${action.title}`, { actionId });
  }
  return action;
}
