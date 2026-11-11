// UPI IDs (virtual payment addresses), such as name@okhdfcbank. Subster cannot move money or
// change an AutoPay mandate over UPI: there is no such access for an app like this one. A linked ID
// is used to recognise the user's UPI payments in their bank feed and statements, and to send them
// to the right screen in their UPI app when a mandate needs pausing or revoking.

import type { BankTransaction, UpiId } from './types';

export const UPI_PATTERN = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$/i;

// Handle to app, for the handles in common use. Anything else is shown by its handle.
const APPS: [RegExp, string, string][] = [
  [/^ok(hdfcbank|axis|icici|sbi)$/, 'Google Pay', 'Profile photo, then Autopay'],
  [/^(ybl|ibl|axl)$/, 'PhonePe', 'Profile photo, then AutoPay Settings'],
  [/^(paytm|pt(yes|axis|hdfc|sbi))$/, 'Paytm', 'Profile, then UPI and Payment Settings, then UPI Automatic Payments'],
  [/^(apl|yapl|rapl)$/, 'Amazon Pay', 'Amazon Pay, then Autopay'],
  [/^(upi|sbi|oksbi)$/, 'BHIM', 'Menu, then Mandates'],
  [/^(jupiteraxis|fam|slice|ikwik|freecharge|axisb|kotak|icici|hdfcbank|yesbank|idfcbank|federal|indus|pnb|boi|barodampay)$/, 'your bank or UPI app', 'the Autopay or Mandates section'],
];

export function upiApp(vpa: string): { app: string; where: string } {
  const handle = vpa.split('@')[1]?.toLowerCase() ?? '';
  const hit = APPS.find(([pattern]) => pattern.test(handle));
  return hit ? { app: hit[1], where: hit[2] } : { app: `your UPI app (@${handle})`, where: 'the Autopay or Mandates section' };
}

/** Shows enough of an ID to recognise it without printing it in full. */
export const maskUpi = (vpa: string) => {
  const [name, handle] = vpa.split('@');
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(2, Math.min(6, name.length - 2)))}@${handle}`;
};

const isUpi = (description: string) => /\bUPI\b|AUTOPAY|MANDATE|\bVPA\b/i.test(description);

/** How many of the known bank payments went over UPI, and how many of those were AutoPay. */
export function upiActivity(transactions: BankTransaction[], ids: UpiId[]) {
  const mine = ids.map((i) => i.vpa.toLowerCase());
  const upi = transactions.filter((t) => t.amount > 0 && (isUpi(t.description) || mine.some((v) => t.description.toLowerCase().includes(v))));
  return { payments: upi.length, autopay: upi.filter((t) => /AUTOPAY|MANDATE/i.test(t.description)).length, subscriptions: new Set(upi.map((t) => t.subId).filter(Boolean)).size };
}
