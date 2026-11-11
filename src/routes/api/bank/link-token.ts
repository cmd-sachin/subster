import { createFileRoute } from '@tanstack/react-router';
import { handle, json, type RouteContext } from '@/server/http';
import { createLinkToken } from '@/server/services/bank';

// Token for Plaid Link, where the user signs in to their own bank.
async function POST({ request }: RouteContext) {
  return json({ linkToken: await createLinkToken(new URL(request.url).origin) });
}

export const Route = createFileRoute('/api/bank/link-token')({
  server: { handlers: { POST: handle('bank.link-token', POST, { needs: 'connect' }) } },
});
