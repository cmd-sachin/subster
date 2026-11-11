// The ways to prove who you are besides a password: a code from an authenticator app, a code sent
// by email, and a passkey. None of them needs a paid service: authenticator codes are computed
// here (RFC 6238), passkeys are verified here (WebAuthn), and email goes out through whichever
// provider the deployment has a key for.

// The passkey library's certificate code needs this in place before it loads.
import 'reflect-metadata';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import QRCode from 'qrcode';
import { accountByEmail, accountById, allAccounts, AuthError, saveAccounts, type Account } from './auth';
import { DATA_DIR } from './data-dir';
import { log } from './logger';

// Loaded on first use, never at start-up: its certificate code must find the polyfill above already
// in place, and a bundled build does not promise the order of two plain imports.
const webauthn = () => import('@simplewebauthn/server');

const random = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

// Short-lived things that need no disk: half-finished sign-ins, emailed codes, passkey challenges.
interface Pending {
  tickets: Map<string, { userId: string; until: number }>;
  codes: Map<string, { hash: string; until: number; tries: number; sentAt: number }>;
  challenges: Map<string, { challenge: string; userId?: string; until: number }>;
}
const held = globalThis as unknown as { __substerPending?: Pending };
const pending = (held.__substerPending ??= { tickets: new Map(), codes: new Map(), challenges: new Map() });
const sweep = () => {
  const now = Date.now();
  for (const map of [pending.tickets, pending.codes, pending.challenges]) for (const [key, value] of map) if (value.until < now) map.delete(key);
};

// ---- Authenticator app (TOTP) -----------------------------------------------------------------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const toBase32 = (bytes: Buffer) => {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return (bits.match(/.{1,5}/g) ?? []).map((chunk) => BASE32[parseInt(chunk.padEnd(5, '0'), 2)]).join('');
};
const fromBase32 = (text: string) => {
  const bits = [...text.replace(/=+$/, '').toUpperCase()].map((c) => BASE32.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
};

/** The six-digit code for a secret at a moment in time. */
export function totpCode(secret: string, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = crypto.createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Accepts the current code and the ones either side of it, to allow for a slow clock. */
const totpMatches = (secret: string, code: string) => {
  const given = String(code ?? '').replace(/\s/g, '');
  return /^\d{6}$/.test(given) && [-1, 0, 1].some((step) => crypto.timingSafeEqual(Buffer.from(totpCode(secret, Date.now() + step * 30_000)), Buffer.from(given)));
};

export async function startTotp(account: Account) {
  account.pendingTotp = toBase32(crypto.randomBytes(20));
  saveAccounts();
  const uri = `otpauth://totp/${encodeURIComponent(`Subster:${account.email}`)}?secret=${account.pendingTotp}&issuer=Subster&algorithm=SHA1&digits=6&period=30`;
  return { secret: account.pendingTotp, uri, qr: await QRCode.toString(uri, { type: 'svg', margin: 1, width: 200 }) };
}

export function confirmTotp(account: Account, code: string) {
  if (!account.pendingTotp || !totpMatches(account.pendingTotp, code)) throw new AuthError(400, 'That code does not match. Check the time on your phone and try the next code.');
  account.totp = { secret: account.pendingTotp, enabledAt: new Date().toISOString() };
  delete account.pendingTotp;
  saveAccounts();
  log.info('auth', 'Authenticator app turned on', { userId: account.id });
}

export function removeTotp(account: Account, code: string) {
  if (account.totp && !totpMatches(account.totp.secret, code)) throw new AuthError(400, 'Enter a current code from the app to turn it off.');
  delete account.totp;
  delete account.pendingTotp;
  saveAccounts();
  log.info('auth', 'Authenticator app turned off', { userId: account.id });
}

/** Password or email code was right, but this account also needs its authenticator code. */
export function needsSecondStep(account: Account) {
  if (!account.totp) return undefined;
  sweep();
  const ticket = random();
  pending.tickets.set(ticket, { userId: account.id, until: Date.now() + 5 * 60_000 });
  return ticket;
}

export function finishSecondStep(ticket: string, code: string): Account {
  sweep();
  const waiting = pending.tickets.get(ticket ?? '');
  const account = waiting && accountById(waiting.userId);
  if (!waiting || !account?.totp) throw new AuthError(401, 'That sign-in took too long. Start again.');
  if (!totpMatches(account.totp.secret, code)) throw new AuthError(401, 'That code does not match.');
  pending.tickets.delete(ticket);
  return account;
}

// ---- Email ------------------------------------------------------------------------------------

const outbox = () => path.join(DATA_DIR, 'outbox.json');
/** Email can go out when a provider key is set. The outbox file is for tests only. */
export const mailAvailable = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) || process.env.SUBSTER_EMAIL_OUTBOX === '1';

async function sendMail(to: string, subject: string, text: string) {
  if (process.env.SUBSTER_EMAIL_OUTBOX === '1') {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(outbox(), JSON.stringify({ to, subject, text, at: new Date().toISOString() }), { mode: 0o600 });
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`The email provider answered ${res.status}`);
}

/**
 * Sends a sign-in code to an address. The answer is the same whether or not there is an account,
 * so this cannot be used to find out who has one.
 */
export async function sendEmailCode(emailInput: string) {
  if (!mailAvailable()) throw new AuthError(400, 'Email codes are not set up on this server.');
  sweep();
  const account = accountByEmail(emailInput);
  if (!account || account.status !== 'active') return;
  const last = pending.codes.get(account.email);
  if (last && Date.now() - last.sentAt < 45_000) return;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  pending.codes.set(account.email, { hash: sha(code), until: Date.now() + 10 * 60_000, tries: 0, sentAt: Date.now() });
  try {
    await sendMail(account.email, `${code} is your Subster code`, `Your Subster sign-in code is ${code}.\n\nIt works for 10 minutes. If you did not ask for it, you can ignore this email.`);
    log.info('auth', 'Sign-in code sent by email', { userId: account.id });
  } catch (error) {
    pending.codes.delete(account.email);
    log.warn('auth', 'A sign-in code could not be emailed', { error: error instanceof Error ? error.message : String(error) });
    throw new AuthError(502, 'The code could not be sent just now. Try again in a moment.');
  }
}

export function checkEmailCode(emailInput: string, code: string): Account {
  sweep();
  const account = accountByEmail(emailInput);
  const waiting = account && pending.codes.get(account.email);
  const wrong = new AuthError(401, 'That code is not right, or it has run out. Ask for a new one.');
  if (!account || !waiting) throw wrong;
  waiting.tries++;
  if (waiting.tries > 5) {
    pending.codes.delete(account.email);
    throw wrong;
  }
  if (sha(String(code ?? '').replace(/\s/g, '')) !== waiting.hash) throw wrong;
  pending.codes.delete(account.email);
  if (account.status === 'suspended') throw new AuthError(403, 'This account is suspended. Contact the administrator.');
  return account;
}

// ---- Passkeys (WebAuthn) ----------------------------------------------------------------------

/**
 * The site as the browser sees it, which is what a passkey is tied to. The browser says where it
 * is in the Origin header; that is believed only when it matches the host this request came to,
 * or the public address the deployment was given. Otherwise the request's own address is used.
 */
function site(request: Request) {
  const here = new URL(request.url);
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? here.host).split(',')[0].trim();
  const allowed = new Set([host]);
  try {
    if (process.env.PUBLIC_URL) allowed.add(new URL(process.env.PUBLIC_URL).host);
  } catch {
    /* a malformed PUBLIC_URL is ignored */
  }
  let url = here;
  try {
    const claimed = new URL(request.headers.get('origin') ?? '');
    if (allowed.has(claimed.host)) url = claimed;
  } catch {
    /* no Origin header: a same-origin GET, or not a browser */
  }
  return { origin: url.origin, rpID: url.hostname };
}

const remember = (challenge: string, userId?: string) => {
  sweep();
  const id = random(12);
  pending.challenges.set(id, { challenge, userId, until: Date.now() + 5 * 60_000 });
  return id;
};
const recall = (id: string) => {
  sweep();
  const found = pending.challenges.get(id ?? '');
  pending.challenges.delete(id ?? '');
  if (!found) throw new AuthError(400, 'That took too long. Try again.');
  return found;
};

export async function passkeyRegistrationOptions(account: Account, request: Request) {
  const { rpID } = site(request);
  const options = await (await webauthn()).generateRegistrationOptions({
    rpName: 'Subster',
    rpID,
    userName: account.email,
    userDisplayName: account.name,
    userID: new TextEncoder().encode(account.id),
    attestationType: 'none',
    excludeCredentials: (account.passkeys ?? []).map((k) => ({ id: k.id })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  return { options, challengeId: remember(options.challenge, account.id) };
}

export async function addPasskey(account: Account, request: Request, input: { challengeId: string; response: RegistrationResponseJSON; name?: string }) {
  const { origin, rpID } = site(request);
  const waiting = recall(input.challengeId);
  if (waiting.userId !== account.id) throw new AuthError(400, 'That took too long. Try again.');
  const result = await (await webauthn()).verifyRegistrationResponse({ response: input.response, expectedChallenge: waiting.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false }).catch(() => null);
  if (!result?.verified || !result.registrationInfo) throw new AuthError(400, 'That passkey could not be verified.');
  const { credential } = result.registrationInfo;
  (account.passkeys ??= []).push({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports,
    name: String(input.name ?? '').trim().slice(0, 40) || 'Passkey',
    createdAt: new Date().toISOString(),
  });
  saveAccounts();
  log.info('auth', 'Passkey added', { userId: account.id });
}

export function removePasskey(account: Account, id: string) {
  account.passkeys = (account.passkeys ?? []).filter((k) => k.id !== id);
  saveAccounts();
  log.info('auth', 'Passkey removed', { userId: account.id });
}

export async function passkeySignInOptions(request: Request) {
  const options = await (await webauthn()).generateAuthenticationOptions({ rpID: site(request).rpID, userVerification: 'preferred' });
  return { options, challengeId: remember(options.challenge) };
}

export async function signInWithPasskey(request: Request, input: { challengeId: string; response: AuthenticationResponseJSON }): Promise<Account> {
  const { origin, rpID } = site(request);
  const waiting = recall(input.challengeId);
  const refused = new AuthError(401, 'That passkey is not known here.');
  const account = allAccounts().find((u) => (u.passkeys ?? []).some((k) => k.id === input.response?.id));
  const passkey = account?.passkeys?.find((k) => k.id === input.response.id);
  if (!account || !passkey) throw refused;
  const result = await (await webauthn()).verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: waiting.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: { id: passkey.id, publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')), counter: passkey.counter, transports: passkey.transports as never },
  }).catch(() => null);
  if (!result?.verified) throw refused;
  passkey.counter = result.authenticationInfo.newCounter;
  saveAccounts();
  if (account.status === 'suspended') throw new AuthError(403, 'This account is suspended. Contact the administrator.');
  return account;
}
