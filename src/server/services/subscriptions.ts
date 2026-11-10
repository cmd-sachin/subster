// The single place a Subscription record is created, whatever the source: a bank feed, a
// statement, a PayPal agreement started from chat, or the user adding one by hand.

import { providerById, providerForName, UTILITY_CATEGORIES } from '@/domain/catalog';
import { classify } from '@/domain/classify';
import { addMonths, currentCurrency, cycleMonths, diffDays, today } from '@/domain/dates';
import type { BillingCycle, Category, Classifier, PaymentRail, Subscription } from '@/domain/types';
import { log } from '@/server/logger';
import { db, uid } from '@/server/store';

const PALETTE = ['#4d7fa8', '#a8674d', '#5f8f5a', '#8d6aa8', '#a89a4d', '#4d9a94'];
const slug = (name: string) => name.toLowerCase().replace(/\+/g, ' plus').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface NewSubscription {
  name: string;
  providerId?: string;
  plan?: string;
  price: number;
  cycle: BillingCycle;
  rail: PaymentRail;
  source: Subscription['source'];
  /** Date of the most recent charge, used to work out the next renewal. Defaults to today. */
  lastChargedOn?: string;
  startedAt?: string;
  paypalSubscriptionId?: string;
  paypalPlanId?: string;
  category?: { value: Category; by: Classifier };
}

export function createSubscription(input: NewSubscription): Subscription {
  const data = db();
  const provider = (input.providerId && providerById(input.providerId)) || providerForName(input.name);
  const classification = input.category ?? (provider ? { value: provider.category, by: 'catalog' as const } : (({ category, by }) => ({ value: category, by }))(classify(input.name)));

  let id = slug(provider?.name ?? input.name) || uid('sub');
  if (data.subscriptions.some((s) => s.id === id)) id = `${id}-${uid('s').slice(-4)}`;

  const anchor = input.lastChargedOn ?? today();
  let nextRenewal = addMonths(anchor, cycleMonths(input.cycle));
  while (diffDays(nextRenewal, today()) < 0) nextRenewal = addMonths(nextRenewal, cycleMonths(input.cycle));

  const sub: Subscription = {
    id,
    name: provider?.name ?? input.name,
    plan: input.plan ?? (input.source === 'bank' ? 'Detected from bank' : input.source === 'statement' ? 'Detected from statement' : 'Standard'),
    category: classification.value,
    classifiedBy: classification.by,
    providerId: provider?.id,
    source: input.source,
    color: provider?.color ?? PALETTE[data.subscriptions.length % PALETTE.length],
    price: input.price,
    cycle: input.cycle,
    rail: input.rail,
    status: 'active',
    policy: 'ask',
    // Screen time is unknown until the Android companion reports this app; essentials never need it.
    coverage: 'none',
    startedAt: input.startedAt ?? anchor,
    nextRenewal,
    paypalSubscriptionId: input.paypalSubscriptionId,
    paypalPlanId: input.paypalPlanId,
    cancelUrl: provider?.manageUrl ?? `https://www.google.com/search?q=${encodeURIComponent(`cancel ${input.name} subscription`)}`,
    androidPackage: provider?.androidPackage,
    cheaperPlan: cheaperPlanFor(provider?.id, input.price, input.cycle),
  };
  data.subscriptions.push(sub);
  log.info('subscriptions', `Tracking ${sub.name}`, { id, source: sub.source, category: sub.category, classifiedBy: sub.classifiedBy, price: sub.price, cycle: sub.cycle, rail: sub.rail, essential: UTILITY_CATEGORIES.includes(sub.category) });
  return sub;
}

/** The next plan down in the provider's catalog, if the user is not already on the cheapest. */
export function cheaperPlanFor(providerId: string | undefined, price: number, cycle: BillingCycle) {
  const plans = providerById(providerId ?? '')?.plans.filter((p) => p.currency === currentCurrency() && p.cycle === cycle && p.price < price * 0.95);
  const best = plans?.sort((a, b) => b.price - a.price)[0];
  return best ? { name: best.name, price: best.price } : undefined;
}

export function setCategory(subId: string, category: Category) {
  const sub = db().subscriptions.find((s) => s.id === subId);
  if (!sub) return null;
  log.info('classification', `${sub.name} set to ${category} by the user`, { from: sub.category, was: sub.classifiedBy });
  sub.category = category;
  sub.classifiedBy = 'user';
  return sub;
}
