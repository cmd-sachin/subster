// PayPal subscription webhooks -> state changes -> (for failures) a reactive agent run.

import { runAgent, webhookTask } from '@/server/agent/run';
import { addMonths, cycleMonths, money, today } from '@/domain/dates';
import { db, save, uid } from '@/server/store';
import type { AgentRun } from '@/domain/types';

export interface PayPalEvent {
  event_type?: string;
  resource?: {
    id?: string;
    billing_agreement_id?: string;
    amount?: { total?: string; value?: string };
    custom_id?: string;
  };
}

export const SUPPORTED_EVENTS = [
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'PAYMENT.SALE.COMPLETED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.ACTIVATED',
] as const;

export async function handlePayPalEvent(event: PayPalEvent): Promise<{ handled: string; run?: AgentRun }> {
  const data = db();
  const type = event.event_type ?? 'UNKNOWN';
  // Sale events reference the agreement; subscription events are the agreement.
  const agreementId = event.resource?.billing_agreement_id ?? event.resource?.id ?? '';
  const sub = data.subscriptions.find((s) => s.paypalSubscriptionId === agreementId || (event.resource?.custom_id && s.id === event.resource.custom_id));

  const log = (handled: string) => {
    data.webhookLog.unshift({ at: new Date().toISOString(), source: 'paypal', type, resource: agreementId, handled });
    data.webhookLog = data.webhookLog.slice(0, 50);
    save();
    return handled;
  };
  if (!sub) return { handled: log('Ignored: no matching subscription') };

  const note = (label: string) => data.notes.push({ id: uid('note'), subId: sub.id, date: today(), kind: 'webhook', label });
  const amount = Number(event.resource?.amount?.total ?? event.resource?.amount?.value ?? sub.price);
  let run: AgentRun | undefined;
  let handled: string;

  switch (type) {
    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
      sub.status = 'past_due';
      data.charges.push({ id: uid('ch'), subId: sub.id, date: today(), amount, status: 'failed', rail: 'paypal' });
      note('Payment failed');
      save();
      // The agent reacts to the event on its own; anything it wants done still needs approval.
      run = await runAgent(
        { trigger: 'webhook', triggerDetail: `${type} · ${sub.name}`, task: webhookTask(type, sub.name, `A payment of ${money(amount)} failed today.`), focus: [sub.id] },
        () => {},
      );
      handled = `${sub.name} marked past due; agent run ${run.id} started`;
      break;
    case 'PAYMENT.SALE.COMPLETED':
      sub.status = 'active';
      data.charges.push({ id: uid('ch'), subId: sub.id, date: today(), amount, status: 'paid', rail: 'paypal', paypalTransactionId: event.resource?.id });
      sub.nextRenewal = addMonths(today(), cycleMonths(sub.cycle));
      note(`Charged ${money(amount)}`);
      handled = `${sub.name} charge recorded; next renewal ${sub.nextRenewal}`;
      break;
    case 'BILLING.SUBSCRIPTION.CANCELLED':
      sub.status = 'cancelled';
      note('Cancelled at PayPal');
      handled = `${sub.name} marked cancelled`;
      break;
    case 'BILLING.SUBSCRIPTION.SUSPENDED':
      sub.status = 'paused';
      note('Suspended at PayPal');
      handled = `${sub.name} marked paused`;
      break;
    case 'BILLING.SUBSCRIPTION.ACTIVATED':
      sub.status = 'active';
      note('Activated at PayPal');
      handled = `${sub.name} marked active`;
      break;
    default:
      handled = 'Ignored: unsupported event type';
  }
  return { handled: log(handled), run };
}
