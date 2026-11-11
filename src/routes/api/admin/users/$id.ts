import { createFileRoute } from '@tanstack/react-router';
import { deleteAccount, publicAccount, updateAccount, type Account, type Permission, type Role } from '@/server/auth';
import { body, currentAccount, handle, json, type RouteContext } from '@/server/http';

// Changes one account's role, status, permissions or password, or deletes it with its data.
async function POST({ request, params }: RouteContext) {
  const change = await body<{ role: Role; status: Account['status']; permissions: Partial<Record<Permission, boolean>>; password: string }>(request);
  return json({ user: publicAccount(updateAccount(params.id, change, currentAccount()?.id ?? 'local')) });
}

function DELETE({ params }: RouteContext) {
  deleteAccount(params.id, currentAccount()?.id ?? 'local');
  return json({ deleted: true });
}

export const Route = createFileRoute('/api/admin/users/$id')({
  server: { handlers: { POST: handle('admin.user', POST, { access: 'admin' }), DELETE: handle('admin.user', DELETE, { access: 'admin' }) } },
});
