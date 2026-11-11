// Accounts and sign-in. Everything here is kept in one small file beside the data, separate from
// any person's subscriptions: who can sign in, their role and permissions, and their sessions.
// Passwords are stored only as salted scrypt hashes, sessions only as hashes of their tokens.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './data-dir';
import { log } from './logger';
import { adoptLocalData, eraseUserData, LOCAL_USER } from './store';

export type Role = 'admin' | 'user';
export const PERMISSIONS = ['assistant', 'paypal', 'connect'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface Account {
  id: string;
  email: string;
  name: string;
  salt: string;
  passwordHash: string;
  role: Role;
  status: 'active' | 'suspended';
  permissions: Record<Permission, boolean>;
  /** Lets the browser extension and the phone app report usage for this account. */
  deviceKey: string;
  createdAt: string;
  lastSeenAt?: string;
  onboardedAt?: string;
}

interface AuthDb {
  users: Account[];
  sessions: { hash: string; userId: string; expiresAt: number }[];
  signups: 'open' | 'closed';
}

/** What the browser is allowed to know about an account. */
export type PublicAccount = Pick<Account, 'id' | 'email' | 'name' | 'role' | 'status' | 'permissions' | 'createdAt' | 'lastSeenAt' | 'onboardedAt'>;
export const publicAccount = ({ id, email, name, role, status, permissions, createdAt, lastSeenAt, onboardedAt }: Account): PublicAccount => ({ id, email, name, role, status, permissions, createdAt, lastSeenAt, onboardedAt });

const FILE = path.join(DATA_DIR, 'accounts.json');
const SESSION_DAYS = 30;
const COOKIE = 'subster_session';
const held = globalThis as unknown as { __substerAuth?: AuthDb; __substerAttempts?: Map<string, { count: number; until: number }> };

/** Single-user mode: no accounts, one local data set. For local development and the smoke test. */
export const singleUser = () => process.env.SUBSTER_SINGLE_USER === '1';

function store(): AuthDb {
  if (held.__substerAuth) return held.__substerAuth;
  let data: AuthDb = { users: [], sessions: [], signups: 'open' };
  try {
    data = { ...data, ...(JSON.parse(fs.readFileSync(FILE, 'utf8')) as AuthDb) };
  } catch {
    /* first run */
  }
  held.__substerAuth = data;
  seedAdmin();
  return data;
}

function persist() {
  const data = store();
  data.sessions = data.sessions.filter((s) => s.expiresAt > Date.now());
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const hashPassword = (password: string, salt: string) => crypto.scryptSync(password, salt, 64).toString('hex');
const sameHash = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const cleanEmail = (email: unknown) => String(email ?? '').trim().toLowerCase();

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function create(input: { email: string; name: string; password: string; role: Role }): Account {
  const data = store();
  const email = cleanEmail(input.email);
  const name = String(input.name ?? '').trim().slice(0, 60);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, 'Enter a valid email address.');
  if (!name) throw new AuthError(400, 'Enter your name.');
  if (String(input.password ?? '').length < 8) throw new AuthError(400, 'Use a password of at least 8 characters.');
  if (data.users.some((u) => u.email === email)) throw new AuthError(400, 'There is already an account with that email. Sign in instead.');
  const salt = token(16);
  const account: Account = {
    id: `u_${token(9)}`,
    email,
    name,
    salt,
    passwordHash: hashPassword(input.password, salt),
    role: input.role,
    status: 'active',
    permissions: { assistant: true, paypal: true, connect: true },
    deviceKey: `sk_${token(24)}`,
    createdAt: new Date().toISOString(),
  };
  data.users.push(account);
  // Whatever was kept before accounts existed belongs to the first person in.
  if (data.users.length === 1) adoptLocalData(account.id);
  persist();
  log.info('auth', `Account created (${account.role})`, { userId: account.id });
  return account;
}

/** An administrator named in the environment is created on first start, so a deployment has one. */
function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || held.__substerAuth!.users.length > 0) return;
  try {
    create({ email, name: process.env.ADMIN_NAME || 'Administrator', password, role: 'admin' });
  } catch (error) {
    log.warn('auth', 'The administrator named in the environment could not be created', { error: error instanceof Error ? error.message : String(error) });
  }
}

export const needsSetup = () => store().users.length === 0;
export const signupsOpen = () => store().signups === 'open';

/** Creates an account. The very first one becomes the administrator. */
export function register(input: { email: string; name: string; password: string }): Account {
  const first = needsSetup();
  if (!first && !signupsOpen()) throw new AuthError(403, 'New accounts are closed. Ask the administrator to add you.');
  return create({ ...input, role: first ? 'admin' : 'user' });
}

/** An administrator adds someone directly, whether or not sign-ups are open. */
export const addUser = (input: { email: string; name: string; password: string; role?: Role }) => create({ ...input, role: input.role === 'admin' ? 'admin' : 'user' });

export function login(emailInput: string, password: string, from: string): Account {
  const email = cleanEmail(emailInput);
  const attempts = (held.__substerAttempts ??= new Map());
  const key = `${email}|${from}`;
  const record = attempts.get(key);
  if (record && record.count >= 8 && record.until > Date.now()) throw new AuthError(429, 'Too many attempts. Wait a few minutes and try again.');
  const account = store().users.find((u) => u.email === email);
  // The hash is computed either way, so a wrong email takes as long as a wrong password.
  const ok = sameHash(hashPassword(password ?? '', account?.salt ?? 'no-such-account'), account?.passwordHash ?? '0'.repeat(128)) && Boolean(account);
  if (!ok || !account) {
    attempts.set(key, { count: (record && record.until > Date.now() ? record.count : 0) + 1, until: Date.now() + 10 * 60_000 });
    log.warn('auth', 'Sign-in failed', { from });
    throw new AuthError(401, 'That email and password do not match.');
  }
  attempts.delete(key);
  if (account.status === 'suspended') throw new AuthError(403, 'This account is suspended. Contact the administrator.');
  return account;
}

/** Starts a session and returns the cookie that carries it. */
export function startSession(account: Account, request: Request): string {
  const value = token();
  store().sessions.push({ hash: sha(value), userId: account.id, expiresAt: Date.now() + SESSION_DAYS * 86_400_000 });
  account.lastSeenAt = new Date().toISOString();
  persist();
  log.info('auth', 'Signed in', { userId: account.id });
  return cookie(value, SESSION_DAYS * 86_400, request);
}

const cookie = (value: string, maxAge: number, request: Request) => {
  const secure = new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https' || (process.env.PUBLIC_URL ?? '').startsWith('https://');
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
};

const sessionToken = (request: Request) =>
  (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === COOKIE)?.[1];

export function endSession(request: Request): string {
  const value = sessionToken(request);
  if (value) {
    const data = store();
    data.sessions = data.sessions.filter((s) => s.hash !== sha(value));
    persist();
  }
  return cookie('', 0, request);
}

/** Who is making this request: by session cookie, or for devices by their key. */
export function accountFor(request: Request, allowDeviceKey = false): Account | undefined {
  const data = store();
  const value = sessionToken(request);
  if (value) {
    const session = data.sessions.find((s) => s.hash === sha(value) && s.expiresAt > Date.now());
    const account = session && data.users.find((u) => u.id === session.userId);
    if (account) return seen(account);
  }
  const bearer = allowDeviceKey ? request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] : undefined;
  if (bearer) {
    const account = data.users.find((u) => u.deviceKey.length === bearer.length && crypto.timingSafeEqual(Buffer.from(u.deviceKey), Buffer.from(bearer)));
    if (account) return seen(account);
  }
  return undefined;
}

/** Notes that an account was active, written at most every few minutes. */
function seen(account: Account) {
  if (!account.lastSeenAt || Date.now() - Date.parse(account.lastSeenAt) > 5 * 60_000) {
    account.lastSeenAt = new Date().toISOString();
    persist();
  }
  return account;
}

export const allAccounts = () => store().users;
export const accountById = (id: string) => store().users.find((u) => u.id === id);
/** Every account whose data background jobs should look after. */
export const activeUserIds = () => (singleUser() ? [LOCAL_USER] : store().users.filter((u) => u.status === 'active').map((u) => u.id));

export function markOnboarded(id: string, name?: string) {
  const account = accountById(id);
  if (!account) return;
  account.onboardedAt = new Date().toISOString();
  if (name?.trim()) account.name = name.trim().slice(0, 60);
  persist();
}

export function newDeviceKey(id: string) {
  const account = accountById(id);
  if (!account) return undefined;
  account.deviceKey = `sk_${token(24)}`;
  persist();
  return account.deviceKey;
}

const admins = () => store().users.filter((u) => u.role === 'admin' && u.status === 'active');

/** An administrator changes someone's role, status, permissions or password. */
export function updateAccount(id: string, change: { role?: Role; status?: Account['status']; permissions?: Partial<Record<Permission, boolean>>; password?: string }, by: string): Account {
  const account = accountById(id);
  if (!account) throw new AuthError(404, 'No such account.');
  const losesAdmin = account.role === 'admin' && account.status === 'active' && ((change.role && change.role !== 'admin') || change.status === 'suspended');
  if (losesAdmin && admins().length === 1) throw new AuthError(400, 'This is the only administrator. Make someone else an administrator first.');
  if (change.status === 'suspended' && id === by) throw new AuthError(400, 'You cannot suspend your own account.');
  if (change.role === 'admin' || change.role === 'user') account.role = change.role;
  if (change.status === 'active' || change.status === 'suspended') account.status = change.status;
  if (change.permissions) for (const key of PERMISSIONS) if (typeof change.permissions[key] === 'boolean') account.permissions[key] = change.permissions[key];
  if (change.password !== undefined) {
    if (change.password.length < 8) throw new AuthError(400, 'Use a password of at least 8 characters.');
    account.salt = token(16);
    account.passwordHash = hashPassword(change.password, account.salt);
  }
  // A suspended account, or one with a new password, is signed out everywhere.
  if (change.status === 'suspended' || change.password !== undefined) store().sessions = store().sessions.filter((s) => s.userId !== id);
  persist();
  log.info('admin', 'Account changed', { target: id, by, role: change.role, status: change.status, permissions: change.permissions, passwordReset: change.password !== undefined });
  return account;
}

export function deleteAccount(id: string, by: string) {
  const data = store();
  const account = accountById(id);
  if (!account) throw new AuthError(404, 'No such account.');
  if (id === by) throw new AuthError(400, 'You cannot delete your own account.');
  if (account.role === 'admin' && admins().length === 1) throw new AuthError(400, 'This is the only administrator.');
  data.users = data.users.filter((u) => u.id !== id);
  data.sessions = data.sessions.filter((s) => s.userId !== id);
  persist();
  eraseUserData(id);
  log.info('admin', 'Account deleted with its data', { target: id, by });
}

export function setSignups(open: boolean, by: string) {
  store().signups = open ? 'open' : 'closed';
  persist();
  log.info('admin', `Sign-ups ${open ? 'opened' : 'closed'}`, { by });
}
