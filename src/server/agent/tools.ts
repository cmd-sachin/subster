// The agent's tools. Both engines (Gemini and the built-in rules engine) act only through these,
// so the run trace in the UI is the complete record of what the agent looked at and did.

import { CATALOG, catalogPlans, CATEGORY_LABEL } from '@/domain/catalog';
import { livePlansForRegion } from '@/server/services/plans';
import { createProposal, proposeSubscription } from '@/server/services/actions';
import { log } from '@/server/logger';
import { addDays, currentCurrency, diffDays, money, today } from '@/domain/dates';
import { analyze } from '@/domain/intelligence';
import { getSubscriptionStatus, paypalMode } from '@/server/integrations/paypal';
import { db, save, uid } from '@/server/store';
import type { ActionType, Insight } from '@/domain/types';

/** A tool as the model sees it: a name, what it is for, and a JSON Schema for its arguments. */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_subscriptions',
    description:
      'Portfolio overview: every subscription with price, monthly cost, hours used in the last 30 days, usage trend, cost per hour, value score (0-100), verdict, days to renewal, detected issues, the rules engine\'s recommendation, the usage coverage (which devices are measured) and the user\'s autonomy policy. Call this first.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_subscription_detail',
    description:
      'Everything known about one subscription: 12 weeks of usage, charge history (including failed payments and price changes), trial dates, cheaper plan, PayPal agreement id and cancellation URL. Call before proposing an action on it.',
    input_schema: {
      type: 'object',
      properties: { subscription_id: { type: 'string', description: 'Subscription id from list_subscriptions, e.g. "netflix"' } },
      required: ['subscription_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'forecast_renewals',
    description: 'Upcoming charges (renewals and trial conversions) in the next N days, with the total. Use to find deadlines and answer "what will I pay next month".',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', description: 'Look-ahead window in days (1-90)' } },
      required: ['days'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_paypal_status',
    description: 'Live status of a PayPal-managed subscription agreement (ACTIVE, SUSPENDED, CANCELLED). Only works for subscriptions billed through PayPal.',
    input_schema: {
      type: 'object',
      properties: { subscription_id: { type: 'string' } },
      required: ['subscription_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_action',
    description:
      'Put an action in the user\'s approval inbox. This never changes anything by itself: the user approves or declines, unless they gave a standing "auto" permission for that subscription, in which case a reversible pause executes immediately. For PayPal-managed agreements, cancel/pause/resume are executed through the PayPal API after approval; for everything else the user is guided to the merchant\'s official page. One open proposal per subscription.',
    input_schema: {
      type: 'object',
      properties: {
        subscription_id: { type: 'string' },
        type: { type: 'string', enum: ['cancel', 'pause', 'resume', 'downgrade', 'retry_payment'] },
        reason: { type: 'string', description: 'One or two plain sentences the user will read. Cite the numbers. State any measurement caveat (e.g. TV viewing is not measured).' },
        evidence: { type: 'array', items: { type: 'string' }, description: 'Short factual bullet points backing the proposal' },
      },
      required: ['subscription_id', 'type', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'schedule_review',
    description: 'Put a review reminder on the renewal timeline for a subscription, for cases where the evidence is not strong enough to propose an action yet.',
    input_schema: {
      type: 'object',
      properties: {
        subscription_id: { type: 'string' },
        date: { type: 'string', description: 'ISO date (YYYY-MM-DD), today or later' },
        note: { type: 'string', description: 'What to check on that date' },
      },
      required: ['subscription_id', 'date', 'note'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_services',
    description:
      'Search the catalog of subscription services (AI tools, entertainment, music, gaming, cloud storage, software, developer tools, mobile recharge, broadband, wellness, learning, news, memberships). Returns each service\'s id, category, plans, and whether the user already subscribes. Plans marked "official" were read from the provider\'s own site for the user\'s region; plans marked "catalog" are US list prices that may be out of date. Use it to answer "what is available" and before propose_subscription.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Part of an app name, e.g. "spotify". Omit to list a whole category.' },
        category: { type: 'string', description: 'Optional category filter, e.g. "Streaming", "AI", "Gaming"' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'propose_subscription',
    description:
      'Put a proposal to START a new subscription in the user\'s approval inbox. Nothing is bought by this call. When the user approves, a PayPal billing agreement is created and the user confirms it at PayPal; only then is the subscription active. Use when the user asks to subscribe to, sign up for, or start an app.',
    input_schema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'Catalog id from search_services, e.g. "spotify"' },
        plan: { type: 'string', description: 'Exact plan name from search_services. Omit for the first listed plan.' },
        reason: { type: 'string', description: 'One sentence the user will read: what they asked for and what it costs.' },
      },
      required: ['app_id', 'reason'],
      additionalProperties: false,
    },
  },
];

const compact = (i: Insight) => ({
  id: i.sub.id,
  name: i.sub.name,
  plan: i.sub.plan,
  category: i.sub.category,
  category_decided_by: i.sub.classifiedBy,
  status: i.sub.status,
  price: i.sub.price,
  cycle: i.sub.cycle,
  monthly_cost: i.monthlyCost,
  billed_via: i.sub.rail,
  paypal_managed: Boolean(i.sub.paypalSubscriptionId),
  policy: i.sub.policy,
  usage_coverage: i.sub.coverage,
  hours_last_30d: i.hours30,
  hours_prev_30d: i.hoursPrev30,
  trend_pct: i.trendPct,
  days_since_last_use: i.daysSinceLastUse,
  cost_per_hour: i.costPerHour,
  value_score: i.valueScore,
  verdict: i.verdict,
  days_to_renewal: i.daysToRenewal,
  next_renewal: i.sub.nextRenewal,
  issues: i.issues.map((x) => x.message),
  rules_recommendation: i.recommendation,
});

export interface ToolOutcome {
  /** JSON-serialisable result handed back to the model. */
  result: unknown;
  /** One-line human summary for the run trace. */
  summary: string;
  isError?: boolean;
  proposed?: boolean;
}

export async function runTool(name: string, input: Record<string, unknown>, runId: string): Promise<ToolOutcome> {
  const data = db();
  const portfolio = analyze(data);
  const find = (id: unknown) => portfolio.insights.find((i) => i.sub.id === id);
  const unknown = (id: unknown): ToolOutcome => ({ result: { error: `Unknown subscription "${id}"` }, summary: `Unknown subscription "${id}"`, isError: true });

  log.debug('agent', `tool ${name}`, { input, runId });
  switch (name) {
    case 'list_subscriptions':
      return {
        result: {
          as_of: portfolio.asOf,
          currency: currentCurrency(),
          monthly_spend: portfolio.monthlySpend,
          yearly_spend: portfolio.yearlySpend,
          low_value_spend_monthly: portfolio.wastedMonthly,
          paypal_mode: paypalMode(),
          subscriptions: portfolio.insights.map(compact),
        },
        summary: `${portfolio.insights.length} subscriptions, ${money(portfolio.monthlySpend)}/month, ${money(portfolio.wastedMonthly)}/month on low-value ones`,
      };

    case 'get_subscription_detail': {
      const i = find(input.subscription_id);
      if (!i) return unknown(input.subscription_id);
      return {
        result: {
          ...compact(i),
          trial_ends: i.sub.trialEndsAt,
          cheaper_plan: i.sub.cheaperPlan,
          cancel_url: i.sub.cancelUrl,
          paypal_subscription_id: i.sub.paypalSubscriptionId,
          weekly_hours: i.weekly,
          charges: data.charges.filter((c) => c.subId === i.sub.id).map(({ date, amount, status }) => ({ date, amount, status })),
          open_proposal: data.actions.find((a) => a.subId === i.sub.id && a.status === 'pending')?.title,
        },
        summary: `${i.sub.name}: ${i.hours30}h in 30 days${i.costPerHour ? `, ${money(i.costPerHour)}/hour` : ''}, score ${i.valueScore ?? 'n/a'}`,
      };
    }

    case 'forecast_renewals': {
      const days = Math.max(1, Math.min(90, Number(input.days) || 30));
      const until = addDays(today(), days);
      const charges = portfolio.upcoming.filter((u) => u.date <= until);
      const total = Math.round(charges.reduce((t, c) => t + c.amount, 0) * 100) / 100;
      return { result: { window_days: days, total, charges }, summary: `${charges.length} charges in the next ${days} days, ${money(total)} total` };
    }

    case 'get_paypal_status': {
      const i = find(input.subscription_id);
      if (!i) return unknown(input.subscription_id);
      if (!i.sub.paypalSubscriptionId)
        return { result: { error: `${i.sub.name} is billed to a card, not through PayPal.` }, summary: `${i.sub.name} is not PayPal-managed`, isError: true };
      const status = await getSubscriptionStatus(i.sub.paypalSubscriptionId);
      return { result: { paypal_subscription_id: i.sub.paypalSubscriptionId, status, mode: paypalMode() }, summary: `PayPal says ${i.sub.name} is ${status}` };
    }

    case 'propose_action': {
      const proposal = await createProposal({
        subId: String(input.subscription_id),
        type: input.type as Exclude<ActionType, 'subscribe'>,
        reason: String(input.reason ?? ''),
        evidence: Array.isArray(input.evidence) ? input.evidence.map(String) : undefined,
        runId,
      });
      if (!proposal.ok) return { result: { error: proposal.error }, summary: proposal.error, isError: true };
      const { action, outcome } = proposal;
      return {
        result: { action_id: action.id, outcome, title: action.title, channel: action.channel, savings_monthly: action.savingsMonthly, approve_by: action.deadline, status: action.status },
        summary:
          outcome === 'auto_executed'
            ? `${action.title}: executed under your standing permission`
            : outcome === 'already_pending'
              ? `${action.title}: already waiting for your approval`
              : `${action.title}: sent to your inbox (${action.savingsMonthly > 0 ? `saves ${money(action.savingsMonthly)}/month, ` : ''}decide by ${action.deadline})`,
        proposed: outcome !== 'already_pending',
      };
    }

    case 'schedule_review': {
      const i = find(input.subscription_id);
      if (!i) return unknown(input.subscription_id);
      const date = String(input.date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || diffDays(date, today()) < 0)
        return { result: { error: 'date must be an ISO date, today or later' }, summary: 'Invalid review date', isError: true };
      const note = String(input.note ?? 'Review');
      const existing = data.notes.find((n) => n.subId === i.sub.id && n.kind === 'review');
      if (existing) Object.assign(existing, { date, label: note });
      else data.notes.push({ id: uid('note'), subId: i.sub.id, date, kind: 'review', label: note });
      save();
      return { result: { scheduled: true, date }, summary: `Review of ${i.sub.name} put on the timeline for ${date}` };
    }

    case 'search_services': {
      const query = String(input.query ?? '').toLowerCase().trim();
      const category = String(input.category ?? '').toLowerCase().trim();
      const apps = CATALOG.filter(
        (app) =>
          (!query || app.name.toLowerCase().includes(query) || app.id.includes(query)) &&
          (!category || app.category.toLowerCase() === category || CATEGORY_LABEL[app.category].toLowerCase().includes(category)),
      ).slice(0, 25);
      return {
        result: {
          apps: apps.map((app) => {
            const mine = data.subscriptions.find((s) => s.providerId === app.id && s.status !== 'cancelled');
            const live = livePlansForRegion()[app.id];
            const official = live?.status === 'ok' && live.plans.length > 0;
            const listed = catalogPlans(app, currentCurrency());
            return {
              id: app.id,
              name: app.name,
              category: app.category,
              plans: official ? live.plans : listed,
              plans_source: official ? `official site, checked ${live.checkedAt}` : listed.some((p) => p.currency === currentCurrency()) ? 'catalog (list prices for the user\'s region, not live)' : 'catalog (US list prices, not live)',
              subscribed: Boolean(mine),
              your_plan: mine?.plan,
              account_page: app.manageUrl,
            };
          }),
        },
        summary: apps.length ? `Found ${apps.length} service${apps.length === 1 ? '' : 's'}: ${apps.slice(0, 5).map((a) => a.name).join(', ')}${apps.length > 5 ? ' and more' : ''}` : 'No services matched',
      };
    }

    case 'propose_subscription': {
      const proposal = proposeSubscription({ providerId: String(input.app_id ?? ''), planName: input.plan ? String(input.plan) : undefined, reason: String(input.reason ?? ''), runId });
      if (!proposal.ok) return { result: { error: proposal.error }, summary: proposal.error, isError: true };
      const { action, outcome } = proposal;
      return {
        result: { action_id: action.id, outcome, title: action.title, plan: action.plan, paypal_mode: paypalMode(), next_step: 'The user approves in the inbox, then confirms the agreement at PayPal.' },
        summary: outcome === 'already_pending' ? `${action.title}: already waiting for your approval` : `${action.title}: sent to your inbox (${money(action.plan!.price, 'USD')} per ${action.plan!.cycle.replace('ly', '')}, nothing is charged until you approve)`,
        proposed: outcome !== 'already_pending',
      };
    }

    default:
      return { result: { error: `Unknown tool ${name}` }, summary: `Unknown tool ${name}`, isError: true };
  }
}
