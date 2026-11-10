import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { syncBank } from '@/server/services/bank';
import { db } from '@/server/store';

// Plaid calls this when new transactions are ready (SYNC_UPDATES_AVAILABLE). The body is treated
// only as a signal: the data itself is always pulled from Plaid with our own access token, so a
// forged call can at worst cause one extra sync.
async function POST({ request }: RouteContext) {
  const event = (await request.json().catch(() => ({}))) as { webhook_type?: string; webhook_code?: string };
  if (event.webhook_type !== 'TRANSACTIONS' || !db().bank) return Response.json({ handled: false });
  if (!['SYNC_UPDATES_AVAILABLE', 'DEFAULT_UPDATE', 'INITIAL_UPDATE', 'HISTORICAL_UPDATE'].includes(event.webhook_code ?? '')) return Response.json({ handled: false });
  try {
    const result = await syncBank({ source: `WEBHOOK ${event.webhook_code}` });
    return Response.json({ handled: true, newTransactions: result.newTransactions });
  } catch (error) {
    return Response.json({ handled: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

export const Route = createFileRoute('/api/bank/webhook')({
  server: {
    handlers: {
      POST: handle('bank.webhook', POST),
    },
  },
});
