import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { log } from '@/server/logger';
import { completeSubscription } from '@/server/services/actions';

// PayPal sends the buyer back here after they approve an agreement started from the inbox.
async function GET({ request }: RouteContext) {
  const url = new URL(request.url);
  let ok = false;
  try {
    ok = await completeSubscription(url.searchParams.get('action') ?? '', url.searchParams.get('subscription_id') ?? '');
  } catch (error) {
    log.error('paypal', 'Return from PayPal could not be completed', { error: error instanceof Error ? error.message : String(error) });
  }
  return Response.redirect(new URL(`/?paypal=${ok ? 'subscribed' : 'failed'}`, url.origin), 302);
}

export const Route = createFileRoute('/api/paypal/return')({
  server: { handlers: { GET: handle('paypal.return', GET) } },
});
