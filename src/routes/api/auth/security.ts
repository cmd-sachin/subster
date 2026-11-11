import { createFileRoute } from '@tanstack/react-router';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { publicAccount, startSession } from '@/server/auth';
import { addPasskey, confirmTotp, passkeyRegistrationOptions, passkeySignInOptions, removePasskey, removeTotp, signInWithPasskey, startTotp } from '@/server/auth-factors';
import { body, currentAccount, fail, handle, json, type RouteContext } from '@/server/http';

interface Input {
  action: 'totp-start' | 'totp-confirm' | 'totp-remove' | 'passkey-options' | 'passkey-add' | 'passkey-remove' | 'passkey-signin-options' | 'passkey-signin';
  code: string;
  id: string;
  name: string;
  challengeId: string;
  response: RegistrationResponseJSON | AuthenticationResponseJSON;
}

// Everything about how an account proves who it is beyond its password: turning the authenticator
// app on and off, adding and removing passkeys, and signing in with a passkey. The two sign-in
// actions are the only ones that work signed out.
async function POST({ request }: RouteContext) {
  const input = await body<Input>(request);

  if (input.action === 'passkey-signin-options') return json(await passkeySignInOptions(request));
  if (input.action === 'passkey-signin') {
    const account = await signInWithPasskey(request, { challengeId: input.challengeId ?? '', response: input.response as AuthenticationResponseJSON });
    return Response.json({ user: publicAccount(account) }, { headers: { 'Set-Cookie': startSession(account, request) } });
  }

  const account = currentAccount();
  if (!account) return fail(401, 'Sign in to continue.');
  if (account.status === 'suspended') return fail(403, 'This account is suspended.');
  if (account.guest) return fail(403, 'Create an account to set up sign-in security.');
  switch (input.action) {
    case 'totp-start':
      return json(await startTotp(account));
    case 'totp-confirm':
      confirmTotp(account, input.code ?? '');
      break;
    case 'totp-remove':
      removeTotp(account, input.code ?? '');
      break;
    case 'passkey-options':
      return json(await passkeyRegistrationOptions(account, request));
    case 'passkey-add':
      await addPasskey(account, request, { challengeId: input.challengeId ?? '', response: input.response as RegistrationResponseJSON, name: input.name });
      break;
    case 'passkey-remove':
      removePasskey(account, input.id ?? '');
      break;
    default:
      return fail(400, 'Unknown action.');
  }
  return json({ user: publicAccount(account) });
}

export const Route = createFileRoute('/api/auth/security')({
  server: { handlers: { POST: handle('auth.security', POST, { access: 'public' }) } },
});
