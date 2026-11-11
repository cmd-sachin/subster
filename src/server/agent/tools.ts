// The agent's tools. Both engines (Gemini and the built-in rules engine) act only through these,
// so the run trace in the UI is the complete record of what the agent looked at and did.

import { CATALOG, catalogPlans, CATEGORY_LABEL } from '@/domain/catalog';
import { acceptsPayPal, PAYPAL_ACCEPTANCE } from '@/domain/paypal-acceptance.gen';
import { livePlansForRegion } from '@/server/services/plans';
import { createProposal, proposeSubscription } from '@/server/services/actions';
import { log } from '@/server/logger';
import { addDays, currentCurrency, diffDays, money, today } from '@/domain/dates';
import { analyze } from '@/domain/intelligence';
import { maskUpi } from '@/domain/upi';
import { getSubscriptionStatus, paypalMode } from '@/server/integrations/paypal';
import { db, save, uid } from '@/server/store';
import type { ActionType, Insight, Widget, WidgetItem } from '@/domain/types';

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
    name: 'show',
    description:
      'Show a component under your reply instead of writing the same thing as text. Types: "progress" (bars: each item has label, value, max, text), "stats" (two to four big numbers: label, text), "subscriptions" (rows drawn from live data: each item has subscription_id), "table" (columns and rows, for comparing plans or alternatives), "choices" (the user picks one: each item has label and optionally send, the message their pick sends back to you), "checklist" (the user ticks several and confirms: items have label, optionally detail, text, checked; prompt is the instruction their selection is sent back with), "confirm" (a dialog asking yes or no before you do something: title, note, confirm_label, prompt is the message a yes sends back). After choices, checklist or confirm, stop and wait: the answer arrives as the user\'s next message.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['progress', 'stats', 'choices', 'checklist', 'confirm', 'subscriptions', 'table'] },
        title: { type: 'string', description: 'Short heading, a few words' },
        note: { type: 'string', description: 'One short line under the component, or the body of a confirm dialog' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              value: { type: 'number' },
              max: { type: 'number' },
              text: { type: 'string', description: 'The value as the user reads it, with its unit or currency' },
              detail: { type: 'string', description: 'A few words of supporting detail' },
              tone: { type: 'string', enum: ['good', 'warn', 'bad'] },
              subscription_id: { type: 'string' },
              send: { type: 'string' },
              checked: { type: 'boolean' },
            },
          },
        },
        columns: { type: 'array', items: { type: 'string' } },
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
        confirm_label: { type: 'string' },
        prompt: { type: 'string' },
      },
      required: ['type'],
    },
  },
  {
    name: 'get_account_context',
    description:
      'What Subster is connected to and what it does and does not know about the user: PayPal connection, linked bank, linked service accounts, usage sources, and whether sample data is open. Call it before answering any question about accounts, payment methods, privacy, or "how do you know".',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
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
  ...(i.keptByChoice && { user_declined: `${i.keptByChoice.type} on ${i.keptByChoice.at.slice(0, 10)}; nothing has changed since, so do not propose it again` }),
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
  /** The proposal this call created or found. */
  actionId?: string;
  /** A component to draw under the reply. */
  widget?: Widget;
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
        actionId: action.id,
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
              // From the provider's own help pages; absent when it could not be confirmed either way.
              ...(acceptsPayPal(app.id, currentCurrency()) !== undefined && { accepts_paypal: acceptsPayPal(app.id, currentCurrency()), accepts_paypal_source: PAYPAL_ACCEPTANCE[app.id].source }),
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
        result: {
          action_id: action.id,
          outcome,
          title: action.title,
          plan: action.plan,
          paypal_mode: paypalMode(),
          billed_by: 'Subster, through a PayPal agreement in US dollars. This does not open an account at the provider.',
          paid_from: 'Whichever PayPal account the user signs in to at PayPal when they confirm. Subster does not know it in advance.',
          next_step: 'An approval card is shown to the user under your reply. They approve there, then confirm the agreement at PayPal.',
        },
        summary: outcome === 'already_pending' ? `${action.title}: already waiting for your approval` : `${action.title}: sent to your inbox (${money(action.plan!.price, 'USD')} per ${action.plan!.cycle.replace('ly', '')}, nothing is charged until you approve)`,
        proposed: outcome !== 'already_pending',
        actionId: action.id,
      };
    }

    case 'get_account_context': {
      const usageDays = new Set(data.usage.map((u) => u.date)).size;
      return {
        result: {
          currency: currentCurrency(),
          paypal: {
            connection: paypalMode() === 'off' ? 'not connected' : paypalMode(),
            what_subster_knows: 'Only the agreements started through Subster and the payments PayPal reports for them. Subster never sees the PayPal password, and it does not know which PayPal account a new agreement will be paid from until the user signs in at PayPal and confirms.',
            agreements_managed_here: data.subscriptions.filter((s) => s.paypalSubscriptionId).map((s) => ({ name: s.name, status: s.status })),
          },
          bank: data.bank ? { institution: data.bank.institution, account_ending: data.bank.accountMask, last_read: data.bank.lastSyncAt } : 'not linked',
          upi: (data.upiIds ?? []).length ? { linked: (data.upiIds ?? []).map((u) => maskUpi(u.vpa)), what_it_is_for: 'Recognising UPI and AutoPay payments, and pointing the user to their UPI app to manage a mandate. Subster cannot change a mandate over UPI.' } : 'no UPI ID linked',
          payments_on_record: data.charges.length + data.bankTransactions.length,
          linked_service_accounts: data.accounts.map((a) => ({ service: a.providerId, shown_as: a.displayName, how: a.method })),
          usage: usageDays ? `${usageDays} days of usage totals from the browser extension or the phone app` : 'no usage reported yet',
          never_held: 'Provider passwords, card numbers, PayPal sign-in details.',
          sample_data: data.demo === true,
        },
        summary: `PayPal ${paypalMode() === 'off' ? 'not connected' : paypalMode()}, bank ${data.bank ? 'linked' : 'not linked'}${data.demo ? ', sample data open' : ''}`,
      };
    }

    case 'show': {
      const types: Widget['type'][] = ['progress', 'stats', 'choices', 'checklist', 'confirm', 'subscriptions', 'table'];
      const type = types.find((x) => x === input.type);
      if (!type) return { result: { error: `type must be one of ${types.join(', ')}` }, summary: 'Nothing to show', isError: true };
      const str = (v: unknown, max = 140) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
      const items: WidgetItem[] = (Array.isArray(input.items) ? (input.items as Record<string, unknown>[]) : [])
        .slice(0, 12)
        .map((raw) => {
          const sub = find(raw.subscription_id)?.sub;
          return {
            label: str(raw.label, 80) ?? sub?.name ?? '',
            value: Number.isFinite(Number(raw.value)) && raw.value !== undefined ? Number(raw.value) : undefined,
            max: Number(raw.max) > 0 ? Number(raw.max) : undefined,
            text: str(raw.text, 40),
            detail: str(raw.detail),
            tone: (['good', 'warn', 'bad'] as const).find((x) => x === raw.tone),
            subscriptionId: sub?.id,
            send: str(raw.send, 200),
            checked: raw.checked === true,
          };
        })
        .filter((item) => item.label);
      const columns = Array.isArray(input.columns) ? input.columns.slice(0, 5).map((c) => String(c).slice(0, 40)) : undefined;
      const rows = Array.isArray(input.rows) ? (input.rows as unknown[]).slice(0, 10).filter(Array.isArray).map((r) => (r as unknown[]).slice(0, 5).map((c) => String(c).slice(0, 80))) : undefined;
      if (type === 'table' ? !columns?.length || !rows?.length : type !== 'confirm' && items.length === 0)
        return { result: { error: type === 'table' ? 'A table needs columns and rows.' : 'Give at least one item.' }, summary: 'Nothing to show', isError: true };
      if (type === 'subscriptions' && items.some((i) => !i.subscriptionId)) return { result: { error: 'Every item needs a subscription_id from list_subscriptions.' }, summary: 'Nothing to show', isError: true };
      const widget: Widget = { type, title: str(input.title, 80), note: str(input.note, 240), items, columns, rows, confirmLabel: str(input.confirm_label, 30), prompt: str(input.prompt, 200) };
      const waits = type === 'choices' || type === 'checklist' || type === 'confirm';
      return {
        result: { shown: true, next: waits ? 'The user sees it under your reply. End your turn with one short sentence and wait for their answer.' : 'The user sees it under your reply. Do not repeat its contents in text.' },
        summary: widget.title ?? 'Shown below',
        widget,
      };
    }

    default:
      return { result: { error: `Unknown tool ${name}` }, summary: `Unknown tool ${name}`, isError: true };
  }
}
