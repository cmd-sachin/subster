import { createFileRoute } from '@tanstack/react-router';
import { handle } from '@/server/http';
import { paypalMode, recentTransactions } from '@/server/integrations/paypal';

async function GET() {
  const mode = paypalMode();
  if (mode === 'off') return Response.json({ mode, transactions: [], error: 'PayPal is not connected.' }, { status: 503 });
  try {
    return Response.json({ mode, transactions: await recentTransactions() });
  } catch (error) {
    return Response.json({ mode, transactions: [], error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

export const Route = createFileRoute('/api/paypal/transactions')({
  server: {
    handlers: {
      GET: handle('paypal.transactions', GET),
    },
  },
});
