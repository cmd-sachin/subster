// Demo data: a made-up household's subscriptions, payments and usage, for showing the product
// without anyone's real accounts. It is built relative to today so renewals and trends always
// look current, and from a fixed seed so every load is the same. None of it is real, the UI says
// so while it is open, and it never mixes with the user's own data (see openDemo in ./index).
//
// Each entry is written to trigger one thing the product does: a pause, a downgrade, a duplicate,
// an unused service, a trial about to convert, a failed payment, a price rise, an essential, and
// a service that cannot be measured.

import { addDays, addMonths, cycleMonths, setCurrency, today } from '@/domain/dates';
import type { BillingCycle, Coverage, Db, PaymentRail, UsageDay } from '@/domain/types';
import { createSubscription } from '@/server/services/subscriptions';

/** Minutes a day on one device: [average on a day it is used, share of days it is used]. */
type Pattern = [minutes: number, share: number];

interface DemoSub {
  providerId: string;
  plan: string;
  price: number;
  cycle?: BillingCycle;
  rail: PaymentRail;
  monthsAgo: number;
  renewsIn: number;
  coverage: Coverage;
  /** Use in the last 30 days and in the 30 before, per device. */
  phone?: { recent: Pattern; prior: Pattern };
  web?: { recent: Pattern; prior: Pattern };
  /** An earlier, lower price: charges before the last three were at this amount. */
  earlierPrice?: number;
  lastChargeFailed?: boolean;
  trialEndsIn?: number;
}

const NONE: Pattern = [0, 0];

const SUBS: DemoSub[] = [
  // Used daily on both devices: good value.
  { providerId: 'spotify', plan: 'Premium Standard', price: 199, rail: 'bank', monthsAgo: 26, renewsIn: 12, coverage: 'phone+web', phone: { recent: [75, 0.9], prior: [70, 0.9] }, web: { recent: [45, 0.6], prior: [40, 0.6] } },
  // A second music service that is barely opened: duplicate.
  { providerId: 'apple-music', plan: 'Student', price: 59, rail: 'card', monthsAgo: 5, renewsIn: 19, coverage: 'phone+web', phone: { recent: [12, 0.1], prior: [20, 0.15] }, web: { recent: [10, 0.05], prior: NONE } },
  // The top plan for a few hours a month: downgrade.
  { providerId: 'netflix', plan: 'Premium 4K', price: 649, rail: 'card', monthsAgo: 31, renewsIn: 9, coverage: 'phone+web', phone: { recent: [35, 0.2], prior: [35, 0.2] }, web: { recent: [55, 0.1], prior: [55, 0.1] } },
  // Heavy last month, almost nothing this month: pause.
  { providerId: 'jiohotstar', plan: 'Premium', price: 499, cycle: 'quarterly', rail: 'bank', monthsAgo: 8, renewsIn: 5, coverage: 'phone+web', phone: { recent: [25, 0.08], prior: [95, 0.55] }, web: { recent: NONE, prior: [80, 0.2] } },
  // Daily use, and the price went up.
  { providerId: 'youtube-premium', plan: 'Individual', price: 149, rail: 'bank', monthsAgo: 22, renewsIn: 23, coverage: 'phone+web', phone: { recent: [55, 0.95], prior: [50, 0.95] }, web: { recent: [40, 0.7], prior: [45, 0.7] }, earlierPrice: 129 },
  // The AI assistant that is used for work every day.
  { providerId: 'chatgpt-plus', plan: 'Plus', price: 1999, rail: 'card', monthsAgo: 14, renewsIn: 16, coverage: 'phone+web', phone: { recent: [15, 0.5], prior: [15, 0.5] }, web: { recent: [70, 0.75], prior: [65, 0.75] } },
  // A second AI plan abandoned five weeks ago, renewing in three days: cancel.
  { providerId: 'google-ai-gemini', plan: 'AI Pro', price: 1950, rail: 'card', monthsAgo: 4, renewsIn: 3, coverage: 'phone+web', phone: { recent: NONE, prior: [10, 0.1] }, web: { recent: NONE, prior: [35, 0.25] } },
  // Barely used and the last payment bounced.
  { providerId: 'audible', plan: 'Membership', price: 199, rail: 'card', monthsAgo: 11, renewsIn: 27, coverage: 'phone', phone: { recent: [15, 0.07], prior: [20, 0.1] }, lastChargeFailed: true },
  // A free trial about to start charging.
  { providerId: 'crunchyroll', plan: 'Mega Fan', price: 99, rail: 'card', monthsAgo: 0, renewsIn: 2, coverage: 'phone+web', phone: { recent: [20, 0.07], prior: NONE }, trialEndsIn: 2 },
  // Read a few evenings a week: fair value.
  { providerId: 'kindle-unlimited', plan: 'Monthly', price: 169, rail: 'card', monthsAgo: 9, renewsIn: 14, coverage: 'phone', phone: { recent: [40, 0.4], prior: [45, 0.4] } },
  // Played on a console, which nothing here can see: not measured.
  { providerId: 'playstation-plus', plan: 'Extra', price: 749, rail: 'card', monthsAgo: 7, renewsIn: 21, coverage: 'none' },
  // Essentials: tracked for price and renewal only.
  { providerId: 'jio-prepaid', plan: '28 days, 1.5 GB a day', price: 299, rail: 'bank', monthsAgo: 30, renewsIn: 6, coverage: 'none' },
  { providerId: 'airtel-xstream-fiber', plan: '100 Mbps', price: 799, rail: 'bank', monthsAgo: 18, renewsIn: 11, coverage: 'none' },
];

/** Small fixed-seed generator, so the demo is identical on every load. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export function fillDemo(data: Db) {
  const now = today();
  const random = seeded(20261111);
  data.settings.currency = 'INR';
  setCurrency('INR');

  for (const spec of SUBS) {
    const cycle = spec.cycle ?? 'monthly';
    const step = cycleMonths(cycle);
    const nextRenewal = addDays(now, spec.renewsIn);
    const trial = spec.trialEndsIn !== undefined;
    const lastCharged = addMonths(nextRenewal, -step);
    const startedAt = trial ? addDays(now, -12) : addMonths(lastCharged, -Math.floor(spec.monthsAgo / step) * step);

    const sub = createSubscription({ name: spec.providerId, providerId: spec.providerId, plan: spec.plan, price: spec.price, cycle, rail: spec.rail, source: 'manual', lastChargedOn: trial ? now : lastCharged, startedAt });
    sub.coverage = spec.coverage;
    sub.nextRenewal = nextRenewal;
    if (trial) {
      sub.status = 'trial';
      sub.trialEndsAt = nextRenewal;
    }

    // Up to a year of payments, newest first.
    if (!trial) {
      for (let n = 0, date = lastCharged; date >= startedAt && n < Math.ceil(12 / step); n++, date = addMonths(date, -step)) {
        data.charges.push({
          id: `demo_${sub.id}_${date}`,
          subId: sub.id,
          date,
          amount: spec.earlierPrice !== undefined && n >= 3 ? spec.earlierPrice : spec.price,
          status: n === 0 && spec.lastChargeFailed ? 'failed' : 'paid',
          rail: spec.rail,
        });
      }
    }

    // Sixty days of daily totals per device. A device that reports sends zeros too.
    const devices: [UsageDay['source'], DemoSub['phone']][] = [
      ['android', spec.phone],
      ['web', spec.web],
    ];
    for (const [source, pattern] of devices) {
      if (!pattern) continue;
      for (let back = 0; back < 60; back++) {
        const date = addDays(now, -back);
        if (date < startedAt) break;
        const [minutes, share] = back < 30 ? pattern.recent : pattern.prior;
        const used = random() < share;
        const spread = 0.5 + random();
        data.usage.push({ subId: sub.id, date, minutes: used ? Math.max(1, Math.round(minutes * spread)) : 0, source });
      }
    }
  }
}
