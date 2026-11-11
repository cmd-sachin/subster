import { createFileRoute } from '@tanstack/react-router';
import { endSession, login, publicAccount, register, startSession } from '@/server/auth';
import { body, handle, type RouteContext } from '@/server/http';

// POST signs in, or creates an account when `name` is sent. DELETE signs out.
async function POST({ request }: RouteContext) {
  const input = await body<{ email: string; password: string; name: string; create: boolean }>(request);
  const from = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'direct';
  const account = input.create ? register({ email: input.email ?? '', name: input.name ?? '', password: input.password ?? '' }) : login(input.email ?? '', input.password ?? '', from);
  return Response.json({ user: publicAccount(account) }, { headers: { 'Set-Cookie': startSession(account, request) } });
}

function DELETE({ request }: RouteContext) {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': endSession(request) } });
}

export const Route = createFileRoute('/api/auth/session')({
  server: { handlers: { POST: handle('auth.session', POST, { access: 'public' }), DELETE: handle('auth.signout', DELETE, { access: 'public' }) } },
});
