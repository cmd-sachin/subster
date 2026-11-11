import { createFileRoute } from '@tanstack/react-router';
import type { Currency } from '@/domain/types';
import { endSession, login, publicAccount, register, startSession, type Account } from '@/server/auth';
import { checkEmailCode, finishSecondStep, needsSecondStep, sendEmailCode } from '@/server/auth-factors';
import { body, handle, json, type RouteContext } from '@/server/http';
import { db, runAs, save } from '@/server/store';
import { loadUsers } from '@/server/users';

interface Input {
  email: string;
  password: string;
  name: string;
  create: boolean;
  currency: Currency;
  /** A code: from email when `email` is sent with no password, from the authenticator app with a `ticket`. */
  code: string;
  ticket: string;
}

/** Signs the account in, unless it also needs its authenticator code, in which case it says so. */
function enter(account: Account, request: Request, secondStepDone = false) {
  const ticket = secondStepDone ? undefined : needsSecondStep(account);
  if (ticket) return json({ step: 'authenticator', ticket });
  return Response.json({ user: publicAccount(account) }, { headers: { 'Set-Cookie': startSession(account, request) } });
}

// POST signs in or creates an account. Signing in takes a password, or a code sent by email, and
// then a code from the authenticator app when the account has one. DELETE signs out.
async function POST({ request }: RouteContext) {
  const input = await body<Input>(request);
  const from = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'direct';

  if (input.ticket) return enter(finishSecondStep(input.ticket, input.code ?? ''), request, true);

  if (input.create) {
    const account = register({ email: input.email ?? '', name: input.name ?? '', password: input.password ?? '' });
    // A new account starts in the currency chosen at sign-up.
    await loadUsers([account.id]);
    if (input.currency && ['INR', 'USD', 'EUR', 'GBP'].includes(input.currency)) {
      runAs(account.id, () => {
        db().settings.currency = input.currency!;
        save('currency');
      });
    }
    return enter(account, request);
  }

  if (input.code) return enter(checkEmailCode(input.email ?? '', input.code), request);
  return enter(login(input.email ?? '', input.password ?? '', from), request);
}

// PUT asks for a sign-in code to be emailed. It answers the same whether or not the address has
// an account.
async function PUT({ request }: RouteContext) {
  const { email } = await body<Input>(request);
  await sendEmailCode(email ?? '');
  return json({ sent: true });
}

function DELETE({ request }: RouteContext) {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': endSession(request) } });
}

export const Route = createFileRoute('/api/auth/session')({
  server: { handlers: { POST: handle('auth.session', POST, { access: 'public' }), PUT: handle('auth.email-code', PUT, { access: 'public' }), DELETE: handle('auth.signout', DELETE, { access: 'public' }) } },
});
