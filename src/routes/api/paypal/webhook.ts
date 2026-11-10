import { createFileRoute } from '@tanstack/react-router';
import { fail, handle, json, type RouteContext } from '@/server/http';
import { verifyWebhook } from '@/server/integrations/paypal';
import { log } from '@/server/logger';
import { handlePayPalEvent, type PayPalEvent } from '@/server/services/webhooks';

// Receives PayPal subscription webhooks. Every event must verify against PAYPAL_WEBHOOK_ID;
// there is no unsigned path.
async function POST({ request }: RouteContext) {
  const event = (await request.json().catch(() => null)) as PayPalEvent | null;
  if (!event?.event_type) return fail(400, 'Not a PayPal event');
  if (!(await verifyWebhook(request.headers, event))) {
    log.warn('paypal', 'Rejected a webhook that did not verify', { type: event.event_type });
    return fail(401, 'Webhook signature could not be verified');
  }
  const { handled } = await handlePayPalEvent(event);
  return json({ handled });
}

export const Route = createFileRoute('/api/paypal/webhook')({
  server: { handlers: { POST: handle('paypal.webhook', POST) } },
});
