import { createFileRoute } from '@tanstack/react-router';
import { fail, handle, json, type RouteContext } from '@/server/http';
import { verifyWebhook } from '@/server/integrations/paypal';
import { log } from '@/server/logger';
import { handlePayPalEvent, type PayPalEvent } from '@/server/services/webhooks';
import { runAs } from '@/server/store';
import { findUser } from '@/server/users';

// Receives PayPal subscription webhooks. Every event must verify against PAYPAL_WEBHOOK_ID;
// there is no unsigned path.
async function POST({ request }: RouteContext) {
  const event = (await request.json().catch(() => null)) as PayPalEvent | null;
  if (!event?.event_type) return fail(400, 'Not a PayPal event');
  if (!(await verifyWebhook(request.headers, event))) {
    log.warn('paypal', 'Rejected a webhook that did not verify', { type: event.event_type });
    return fail(401, 'Webhook signature could not be verified');
  }
  // The event carries no account: it belongs to whoever holds that agreement.
  const agreement = event.resource?.billing_agreement_id ?? event.resource?.id ?? '';
  const owner = await findUser((data) => data.subscriptions.some((s) => (agreement && s.paypalSubscriptionId === agreement) || (event.resource?.custom_id && s.id === event.resource.custom_id)));
  if (!owner) return json({ handled: 'no account holds this agreement' });
  const { handled } = await runAs(owner, () => handlePayPalEvent(event));
  return json({ handled });
}

export const Route = createFileRoute('/api/paypal/webhook')({
  server: { handlers: { POST: handle('paypal.webhook', POST, { access: 'public' }) } },
});
