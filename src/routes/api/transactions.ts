import { createFileRoute } from '@tanstack/react-router';
import type { ChargeStatus, PaymentRail, RefundReason, RefundRequest } from '@/domain/types';
import { body, fail, handle, json, type RouteContext } from '@/server/http';
import { log } from '@/server/logger';
import { createProposal, execute } from '@/server/services/actions';
import { openRefund, updateRefund } from '@/server/services/refunds';
import { buildState } from '@/server/services/state';
import { db, save, uid } from '@/server/store';

interface Body {
  intent: 'refund' | 'refund_status' | 'act' | 'record' | 'mark' | 'remove';
  chargeId: string;
  refundId: string;
  subId: string;
  reason: RefundReason;
  note: string;
  status: RefundRequest['status'] | 'withdrawn' | ChargeStatus;
  action: 'cancel' | 'pause' | 'resume' | 'retry_payment' | 'downgrade';
  date: string;
  amount: number;
  rail: PaymentRail;
}

const RAILS: PaymentRail[] = ['card', 'bank', 'paypal'];

// Everything the Transactions page does. Each intent is something the user asked for directly:
//   refund / refund_status  prepare a refund request and track the provider's answer
//   act                     cancel, pause, resume or fix payment for the subscription behind a payment
//   record / mark / remove  keep the payment history itself correct
async function POST({ request }: RouteContext) {
  const input = await body<Body>(request);
  const data = db();

  if (input.intent === 'refund') {
    openRefund({ chargeId: input.chargeId ?? '', reason: input.reason ?? 'other', note: input.note });
  } else if (input.intent === 'refund_status') {
    updateRefund(input.refundId ?? '', input.status as RefundRequest['status'] | 'withdrawn');
  } else if (input.intent === 'act') {
    if (!input.action || !['cancel', 'pause', 'resume', 'retry_payment', 'downgrade'].includes(input.action)) return fail(400, 'Unknown action');
    const reason = { cancel: 'You asked to cancel this yourself.', pause: 'You asked to pause this yourself.', resume: 'You asked to resume this yourself.', retry_payment: 'You asked for help fixing this payment.', downgrade: 'You asked to move to the cheaper plan.' }[input.action];
    const proposal = await createProposal({ subId: input.subId ?? '', type: input.action, reason, by: 'user' });
    if (!proposal.ok) return fail(409, proposal.error);
    // The user asked for this themselves, so it does not wait in the inbox for a second approval.
    if (proposal.action.status === 'pending') await execute(proposal.action.id, 'user', new URL(request.url).origin);
  } else if (input.intent === 'record') {
    const sub = data.subscriptions.find((s) => s.id === input.subId);
    const amount = Number(input.amount);
    if (!sub) return fail(404, 'Choose the subscription this payment was for.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') || Number.isNaN(Date.parse(input.date!))) return fail(400, 'Enter the date of the payment.');
    if (input.date! > new Date().toISOString().slice(0, 10)) return fail(400, 'A payment cannot be dated in the future.');
    if (!(amount > 0 && amount < 10_000_000)) return fail(400, 'Enter the amount that was charged.');
    if (data.charges.some((c) => c.subId === sub.id && c.date === input.date && c.amount === amount)) return fail(409, 'That payment is already recorded.');
    data.charges.push({ id: uid('ch'), subId: sub.id, date: input.date!, amount: Math.round(amount * 100) / 100, status: 'paid', rail: input.rail && RAILS.includes(input.rail) ? input.rail : sub.rail });
    save('payment recorded');
    log.info('transactions', `Payment recorded for ${sub.name}`, { amount, date: input.date });
  } else if (input.intent === 'mark') {
    const charge = data.charges.find((c) => c.id === input.chargeId);
    if (!charge) return fail(404, 'Payment not found');
    if (input.status !== 'paid' && input.status !== 'failed') return fail(400, 'A payment can be marked paid or failed. Refunds are tracked through a refund request.');
    if ((data.refunds ?? []).some((r) => r.chargeId === charge.id && r.status !== 'declined')) return fail(409, 'This payment has a refund request. Withdraw it first.');
    charge.status = input.status;
    save('payment updated');
    log.info('transactions', `Payment marked ${input.status}`, { chargeId: charge.id });
  } else if (input.intent === 'remove') {
    const charge = data.charges.find((c) => c.id === input.chargeId);
    if (!charge) return fail(404, 'Payment not found');
    if (charge.paypalTransactionId) return fail(409, 'This payment came from PayPal and cannot be removed here.');
    data.charges = data.charges.filter((c) => c.id !== charge.id);
    data.refunds = (data.refunds ?? []).filter((r) => r.chargeId !== charge.id);
    save('payment removed');
    log.info('transactions', 'Payment removed', { chargeId: charge.id });
  } else {
    return fail(400, 'Unknown intent');
  }
  return json(buildState());
}

export const Route = createFileRoute('/api/transactions')({
  server: { handlers: { POST: handle('transactions', POST) } },
});
