import { createFileRoute } from '@tanstack/react-router';
import { handle } from '@/server/http';
import { paypalMode, recentTransactions } from '@/server/integrations/paypal';

async function GET() {
  if (paypalMode() !== 'sandbox') return Response.json({ mode: 'simulator', transactions: [] });
  try {
    return Response.json({ mode: 'sandbox', transactions: await recentTransactions() });
  } catch (error) {
    return Response.json({ mode: 'sandbox', transactions: [], error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

export const Route = createFileRoute('/api/paypal/transactions')({
  server: {
    handlers: {
      GET: handle('paypal.transactions', GET),
    },
  },
});
