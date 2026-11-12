import { createFileRoute } from '@tanstack/react-router';
import { guestDemoOpen, needsSetup, publicAccount, signupsOpen, singleUser } from '@/server/auth';
import { mailAvailable } from '@/server/auth-factors';
import { dataPersists } from '@/server/data-dir';
import { currentAccount, handle, json } from '@/server/http';
import { storage } from '@/server/vfs';

// Who is signed in, and what the sign-in screen should offer. Safe to call signed out.
function GET() {
  if (singleUser()) {
    const now = new Date().toISOString();
    return json({ user: { id: 'local', email: '', name: 'You', role: 'admin', status: 'active', permissions: { assistant: true, paypal: true, connect: true }, createdAt: now, onboardedAt: now, security: { totp: false, passkeys: [] }, guest: false }, setup: false, signups: false, singleUser: true, persistent: dataPersists, storage, emailCodes: false });
  }
  const account = currentAccount();
  return json({ user: account ? publicAccount(account) : null, deviceKey: account?.guest ? undefined : account?.deviceKey, guestDemo: guestDemoOpen(), setup: needsSetup(), signups: signupsOpen(), singleUser: false, persistent: dataPersists, storage, emailCodes: mailAvailable() });
}

export const Route = createFileRoute('/api/auth/me')({
  server: { handlers: { GET: handle('auth.me', GET, { quiet: true, access: 'public' }) } },
});
