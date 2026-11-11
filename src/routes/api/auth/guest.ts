import { createFileRoute } from '@tanstack/react-router';
import { createGuest, publicAccount, startSession } from '@/server/auth';
import { handle, type RouteContext } from '@/server/http';
import { paypalMode } from '@/server/integrations/paypal';
import { fillDemo } from '@/server/store/demo';
import { openDemo, runAs } from '@/server/store';

// The demo without an account: makes a short-lived guest, opens the sample data for them and signs
// them in. Signing out, or an hour passing, deletes the guest and everything they did.
function POST({ request }: RouteContext) {
  const from = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'direct';
  // A guest may try PayPal only where no real money can move.
  const guest = createGuest(from, paypalMode() === 'sandbox');
  runAs(guest.id, () => openDemo(fillDemo));
  return Response.json({ user: publicAccount(guest) }, { headers: { 'Set-Cookie': startSession(guest, request) } });
}

export const Route = createFileRoute('/api/auth/guest')({
  server: { handlers: { POST: handle('auth.guest', POST, { access: 'public' }) } },
});
