// Refund help. Subster cannot issue a refund: only the company that took the payment can, and
// whether it does is its decision. What this does is the paperwork: it writes the request from
// the user's own records (the charge, and how much the service was used afterwards), says where
// to send it, and tracks the answer. A refund the user reports as received marks the charge
// refunded.

import { providerById } from '@/domain/catalog';
import { diffDays, money, round, today } from '@/domain/dates';
import type { Charge, RefundReason, RefundRequest, Subscription } from '@/domain/types';
import { HttpError } from '@/server/http';
import { paypalMode } from '@/server/integrations/paypal';
import { log } from '@/server/logger';
import { db, save, uid } from '@/server/store';

const REASON_TEXT: Record<RefundReason, (sub: Subscription) => string> = {
  charged_after_cancel: (s) => `I cancelled my ${s.name} subscription before this date and was charged anyway.`,
  unused_renewal: (s) => `My ${s.name} subscription renewed automatically and I have not used it since.`,
  trial_converted: (s) => `My ${s.name} free trial converted to a paid plan before I could cancel it.`,
  duplicate_charge: (s) => `I was charged more than once for the same ${s.name} billing period.`,
  price_changed: (s) => `The price of my ${s.name} plan changed and I did not agree to the new amount.`,
  other: (s) => `I would like to ask for a refund of this ${s.name} payment.`,
};

const RAIL_TEXT = { paypal: 'PayPal', card: 'card', bank: 'bank account' } as const;

/** Facts from the user's records that bear on a refund for this charge. */
function evidenceFor(charge: Charge, sub: Subscription): string[] {
  const data = db();
  const now = today();
  const age = diffDays(now, charge.date);
  const facts = [`Charged ${money(charge.amount)} on ${charge.date}, ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}.`];

  if (sub.coverage !== 'none') {
    const since = data.usage.filter((u) => u.subId === sub.id && u.date >= charge.date);
    const minutes = since.reduce((total, u) => total + u.minutes, 0);
    const where = sub.coverage === 'phone' ? 'on your phone' : sub.coverage === 'web' ? 'in your browser' : 'on your measured devices';
    if (since.length > 0) facts.push(minutes === 0 ? `No recorded use ${where} since the charge.` : `${round(minutes / 60, 1)} hours of recorded use ${where} since the charge.`);
  }
  const twin = data.charges.find((c) => c.id !== charge.id && c.subId === charge.subId && c.status === 'paid' && Math.abs(diffDays(c.date, charge.date)) <= 3);
  if (twin) facts.push(`Another payment of ${money(twin.amount)} was taken on ${twin.date}.`);
  const earlier = data.charges.filter((c) => c.subId === charge.subId && c.status === 'paid' && c.date < charge.date).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (earlier && earlier.amount < charge.amount) facts.push(`The payment before it was ${money(earlier.amount)}.`);
  if (sub.status === 'cancelled') facts.push('The subscription is recorded as cancelled.');
  return facts;
}

function writeMessage(charge: Charge, sub: Subscription, reason: RefundReason, note: string | undefined, evidence: string[]) {
  const usedNothing = evidence.some((fact) => fact.startsWith('No recorded use'));
  return [
    'Hello,',
    '',
    `I am writing about a payment for ${sub.name}${sub.plan && !/^detected/i.test(sub.plan) ? ` (${sub.plan})` : ''}.`,
    '',
    `Amount: ${money(charge.amount)}`,
    `Date: ${charge.date}`,
    `Paid with: ${RAIL_TEXT[charge.rail]}`,
    ...(charge.paypalTransactionId ? [`PayPal transaction ID: ${charge.paypalTransactionId}`] : []),
    '',
    `${REASON_TEXT[reason](sub)}${reason !== 'unused_renewal' && usedNothing ? ' I have not used the service since the payment.' : ''}`,
    ...(note ? ['', note] : []),
    '',
    `Please refund ${money(charge.amount)} to the original payment method${sub.status === 'cancelled' ? '' : ' and confirm that no further payments will be taken'}.`,
    '',
    'Thank you.',
  ].join('\n');
}

export function openRefund(input: { chargeId: string; reason: RefundReason; note?: string }): RefundRequest {
  const data = db();
  const charge = data.charges.find((c) => c.id === input.chargeId);
  const sub = data.subscriptions.find((s) => s.id === charge?.subId);
  if (!charge || !sub) throw new HttpError(404, 'Payment not found');
  if (charge.status !== 'paid') throw new HttpError(409, charge.status === 'refunded' ? 'This payment is already refunded.' : 'This payment failed, so nothing was taken.');
  if (!(input.reason in REASON_TEXT)) throw new HttpError(400, 'Choose a reason for the refund.');
  const refunds = (data.refunds ??= []);
  const open = refunds.find((r) => r.chargeId === charge.id && (r.status === 'drafted' || r.status === 'sent'));
  if (open) return open;

  const note = input.note?.trim().slice(0, 600) || undefined;
  const evidence = evidenceFor(charge, sub);
  const viaPayPal = charge.rail === 'paypal';
  const now = new Date().toISOString();
  const refund: RefundRequest = {
    id: uid('ref'),
    chargeId: charge.id,
    subId: sub.id,
    amount: charge.amount,
    reason: input.reason,
    note,
    status: 'drafted',
    message: writeMessage(charge, sub, input.reason, note, evidence),
    evidence,
    // PayPal payments are raised in PayPal's Resolution Centre; everything else goes to the provider.
    via: viaPayPal ? 'paypal' : 'provider',
    contactUrl: viaPayPal ? `https://www.${paypalMode() === 'sandbox' ? 'sandbox.' : ''}paypal.com/resolutioncenter` : (providerById(sub.providerId ?? '')?.manageUrl ?? sub.cancelUrl),
    createdAt: now,
    updatedAt: now,
  };
  refunds.unshift(refund);
  save('refund request drafted');
  log.info('refunds', `Refund request drafted for ${sub.name}`, { refundId: refund.id, amount: charge.amount, reason: input.reason, via: refund.via });
  return refund;
}

export function updateRefund(id: string, status: RefundRequest['status'] | 'withdrawn'): void {
  const data = db();
  const refunds = (data.refunds ??= []);
  const refund = refunds.find((r) => r.id === id);
  if (!refund) throw new HttpError(404, 'Refund request not found');
  const charge = data.charges.find((c) => c.id === refund.chargeId);

  if (status === 'withdrawn') {
    if (refund.status === 'refunded') throw new HttpError(409, 'This refund was already received.');
    data.refunds = refunds.filter((r) => r.id !== id);
  } else {
    if (!['drafted', 'sent', 'refunded', 'declined'].includes(status)) throw new HttpError(400, 'Unknown refund status');
    // The charge follows the refund: received marks it refunded, anything else puts it back.
    if (charge) charge.status = status === 'refunded' ? 'refunded' : charge.status === 'refunded' ? 'paid' : charge.status;
    refund.status = status;
    refund.updatedAt = new Date().toISOString();
  }
  save('refund request updated');
  log.info('refunds', `Refund request ${status}`, { refundId: id, amount: refund.amount });
}
