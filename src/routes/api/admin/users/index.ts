import { createFileRoute } from '@tanstack/react-router';
import { addUser, allAccounts, publicAccount, setSignups, signupsOpen, type Role } from '@/server/auth';
import { body, currentAccount, handle, json, type RouteContext } from '@/server/http';
import { db, runAs } from '@/server/store';

// Everyone with an account, with a little about what each one holds. Administrators only.
function list() {
  return {
    signups: signupsOpen(),
    users: allAccounts().map((account) => {
      const data = runAs(account.id, () => db());
      return { ...publicAccount(account), subscriptions: data.subscriptions.filter((s) => s.status !== 'cancelled').length, demo: data.demo === true, paypalAgreements: data.subscriptions.filter((s) => s.paypalSubscriptionId).length };
    }),
  };
}

const GET = () => json(list());

// Adds a person directly, or opens and closes sign-ups.
async function POST({ request }: RouteContext) {
  const input = await body<{ email: string; name: string; password: string; role: Role; signups: boolean }>(request);
  if (typeof input.signups === 'boolean') setSignups(input.signups, currentAccount()?.id ?? 'local');
  else addUser({ email: input.email ?? '', name: input.name ?? '', password: input.password ?? '', role: input.role });
  return json(list());
}

export const Route = createFileRoute('/api/admin/users/')({
  server: { handlers: { GET: handle('admin.users', GET, { quiet: true, access: 'admin' }), POST: handle('admin.users', POST, { access: 'admin' }) } },
});
