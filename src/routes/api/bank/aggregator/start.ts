import { createFileRoute } from '@tanstack/react-router';
import { body, handle, json, type RouteContext } from '@/server/http';
import { startAggregatorConsent } from '@/server/services/bank';

// Account Aggregator (India): creates a consent request and returns the URL where the user
// approves it with their bank.
async function POST({ request }: RouteContext) {
  const { mobile = '' } = await body<{ mobile: string }>(request);
  return json({ url: await startAggregatorConsent(new URL(request.url).origin, mobile.replace(/\D/g, '').slice(-10)) });
}

export const Route = createFileRoute('/api/bank/aggregator/start')({
  server: { handlers: { POST: handle('bank.aggregator.start', POST, { needs: 'connect' }) } },
});
