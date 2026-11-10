// AG Studio data sources: one table per fact type, joined on the subscription, with a shared
// calendar so charges and usage line up on the same time axis.

import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat, AgRelationDefinition } from 'ag-studio';
import { cycleShort, today } from '@/domain/dates';
import type { AppState } from '@/domain/types';

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];
const fields = (specs: FieldSpec[]): AgFieldDefinition[] => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));

const toSubscription = (table: string): AgRelationDefinition => ({
  id: `${table}-subscription`,
  source: { tableId: table, fieldId: 'subId' },
  target: { tableId: 'subscriptions', fieldId: 'id' },
  type: 'many-to-one',
});

const onCalendar = (tableId: string): AgRelationDefinition => ({ id: `${tableId}-calendar`, source: { tableId, fieldId: 'date' }, target: { calendarId: 'calendar' } });

const VERDICT_LABEL = { great: 'Good value', fair: 'Fair', poor: 'Low value', unused: 'Unused', unmeasured: 'Not measured', essential: 'Essential' } as const;

export function buildStudioData(state: AppState): AgDataSourcesDefinition {
  const subscriptions = state.portfolio.insights.map((i) => ({
    id: i.sub.id,
    name: i.sub.name,
    plan: i.sub.plan,
    category: i.sub.category,
    status: i.sub.status,
    billedVia: i.sub.rail === 'paypal' ? 'PayPal' : i.sub.rail === 'bank' ? 'Bank' : 'Card',
    billed: cycleShort(i.sub.cycle),
    price: i.sub.price,
    monthlyCost: i.monthlyCost,
    yearlyCost: i.yearlyCost,
    hours30: i.hours30,
    hoursPrev30: i.hoursPrev30,
    costPerHour: i.costPerHour,
    valueScore: i.valueScore,
    verdict: VERDICT_LABEL[i.verdict],
    recommendation: i.recommendation.action.replace('_', ' '),
    classifiedBy: { catalog: 'Known app', rules: 'Keyword rules', ai: 'Gemini', user: 'You' }[i.sub.classifiedBy],
    foundThrough: { bank: 'Bank feed', statement: 'Statement', paypal: 'PayPal', manual: 'Added by hand', chat: 'Started from chat' }[i.sub.source],
    savings: i.recommendation.savingsMonthly,
    daysToRenewal: i.daysToRenewal,
    nextRenewal: i.sub.nextRenewal,
  }));
  const charges = state.charges.map((c) => ({ id: c.id, subId: c.subId, date: c.date, amount: c.amount, status: c.status }));
  const usage = state.usage.map((u, n) => ({ id: `u${n}`, subId: u.subId, date: u.date, hours: Math.round((u.minutes / 60) * 100) / 100, source: u.source }));
  const dates = [...charges.map((c) => c.date), ...usage.map((u) => u.date)].sort();

  return {
    description:
      `Personal subscription data for one user, in ${state.settings.currency}. "subscriptions" has one row per subscription with its monthly cost, hours of use in the last 30 days (phone screen time), cost per hour of use and a 0-100 value score (higher is better value). "charges" are individual payments; "usage" is hours per subscription per day. Subscriptions marked Essential or Not measured have no usage-based score.`,
    sources: [
      {
        id: 'subscriptions',
        description: 'One row per subscription. Sum monthlyCost for spend; sum savings for what the recommended actions would save per month.',
        data: subscriptions,
        fields: fields([
          ['id', 'Subscription ID', 'textFormat', true],
          ['name', 'Subscription', 'textFormat'],
          ['plan', 'Plan', 'textFormat'],
          ['category', 'Category', 'textFormat'],
          ['status', 'Status', 'textFormat'],
          ['billedVia', 'Billed via', 'textFormat'],
          ['billed', 'Billing cycle', 'textFormat'],
          ['price', 'Price', 'currencyFormat'],
          ['monthlyCost', 'Monthly cost', 'currencyFormat'],
          ['yearlyCost', 'Yearly cost', 'currencyFormat'],
          ['hours30', 'Hours used (30d)', 'decimalFormat'],
          ['hoursPrev30', 'Hours used (prior 30d)', 'decimalFormat'],
          ['costPerHour', 'Cost per hour', 'currencyFormat'],
          ['valueScore', 'Value score', 'integerFormat'],
          ['verdict', 'Verdict', 'textFormat'],
          ['recommendation', 'Recommendation', 'textFormat'],
          ['classifiedBy', 'Classified by', 'textFormat'],
          ['foundThrough', 'Found through', 'textFormat'],
          ['savings', 'Potential saving / month', 'currencyFormat'],
          ['daysToRenewal', 'Days to renewal', 'integerFormat'],
          ['nextRenewal', 'Next renewal', 'dateFormat'],
        ]),
      },
      {
        id: 'charges',
        description: 'Payments collected or attempted. Status is paid, failed or refunded.',
        data: charges,
        fields: fields([
          ['id', 'Charge ID', 'textFormat', true],
          ['subId', 'Subscription ID', 'textFormat', true],
          ['date', 'Charge date', 'dateFormat'],
          ['amount', 'Charge amount', 'currencyFormat'],
          ['status', 'Charge status', 'textFormat'],
        ]),
      },
      {
        id: 'usage',
        description: 'Hours of use per subscription per day, from the Android companion.',
        data: usage,
        fields: fields([
          ['id', 'Usage ID', 'textFormat', true],
          ['subId', 'Subscription ID', 'textFormat', true],
          ['date', 'Usage date', 'dateFormat'],
          ['hours', 'Hours used', 'decimalFormat'],
          ['source', 'Usage source', 'textFormat'],
        ]),
      },
    ],
    relationships: [toSubscription('charges'), toSubscription('usage'), onCalendar('charges'), onCalendar('usage')],
    calendars: [
      {
        id: 'calendar',
        label: 'Calendar',
        range: { from: { type: 'date', value: dates[0] ?? today() }, to: { type: 'date', value: dates.at(-1) ?? today() } },
        fragments: ['year', 'quarter', 'month', 'week', 'day'],
      },
    ],
  };
}
