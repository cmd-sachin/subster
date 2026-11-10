// Dates, money and billing cycles. Dates are stored as ISO calendar dates (YYYY-MM-DD) in UTC.

import type { BillingCycle, Currency } from './types';

const DAY = 86_400_000;

export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const today = () => iso(new Date());
export const parse = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
export const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * DAY));
export const diffDays = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / DAY);

export function addMonths(s: string, n: number) {
  const d = parse(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
}

export const shortDate = (s: string) => parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

// ---- Money ---------------------------------------------------------------------------------

// The user's currency is one setting for the whole app, so formatting reads it from here rather
// than taking it as an argument at every call. The server sets it per request from the store;
// the browser sets it when state arrives.
let active: Currency = 'USD';
const LOCALE: Record<Currency, string> = { USD: 'en-US', INR: 'en-IN', EUR: 'en-IE', GBP: 'en-GB' };

export const setCurrency = (currency: Currency) => {
  active = currency;
};
export const currentCurrency = () => active;

/** Formats an amount in the user's currency, or in an explicit one (catalog list prices are USD). */
export const money = (n: number, currency: Currency = active) =>
  n.toLocaleString(LOCALE[currency], { style: 'currency', currency, minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });

// ---- Billing cycles ------------------------------------------------------------------------

const CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, yearly: 12 };
export const cycleMonths = (cycle: BillingCycle) => CYCLE_MONTHS[cycle];
export const cycleShort = (cycle: BillingCycle) => ({ monthly: 'mo', quarterly: 'qtr', yearly: 'yr' })[cycle];
