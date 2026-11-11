import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { syncBank } from '@/server/services/bank';
import { db } from '@/server/store';
import { eachUser } from '@/server/users';

// Plaid calls this when new transactions are ready (SYNC_UPDATES_AVAILABLE). The body is treated
// only as a signal: the data itself is always pulled from Plaid with our own access token, so a
// forged call can at worst cause one extra sync.
async function POST({ request }: RouteContext) {
  const event = (await request.json().catch(() => ({}))) as { webhook_type?: string; webhook_code?: string };
  if (event.webhook_type !== 'TRANSACTIONS') return Response.json({ handled: false });
  if (!['SYNC_UPDATES_AVAILABLE', 'DEFAULT_UPDATE', 'INITIAL_UPDATE', 'HISTORICAL_UPDATE'].includes(event.webhook_code ?? '')) return Response.json({ handled: false });
  // The signal names no account, so every account with a Plaid link pulls its own new transactions.
  let newTransactions = 0;
  await eachUser(async () => {
    if (db().bank?.provider !== 'plaid') return;
    newTransactions += (await syncBank({ source: `WEBHOOK ${event.webhook_code}` })).newTransactions;
  });
  return Response.json({ handled: true, newTransactions });
}

export const Route = createFileRoute('/api/bank/webhook')({
  server: {
    handlers: {
      POST: handle('bank.webhook', POST, { access: 'public' }),
    },
  },
});
