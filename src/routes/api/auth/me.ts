import { createFileRoute } from '@tanstack/react-router';
import { needsSetup, publicAccount, signupsOpen, singleUser } from '@/server/auth';
import { dataPersists } from '@/server/data-dir';
import { currentAccount, handle, json } from '@/server/http';

// Who is signed in, and what the sign-in screen should offer. Safe to call signed out.
function GET() {
  if (singleUser()) {
    const now = new Date().toISOString();
    return json({ user: { id: 'local', email: '', name: 'You', role: 'admin', status: 'active', permissions: { assistant: true, paypal: true, connect: true }, createdAt: now, onboardedAt: now }, setup: false, signups: false, singleUser: true, persistent: dataPersists });
  }
  const account = currentAccount();
  return json({ user: account ? publicAccount(account) : null, deviceKey: account?.deviceKey, setup: needsSetup(), signups: signupsOpen(), singleUser: false, persistent: dataPersists });
}

export const Route = createFileRoute('/api/auth/me')({
  server: { handlers: { GET: handle('auth.me', GET, { quiet: true, access: 'public' }) } },
});
