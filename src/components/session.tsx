// Who is using the app. The gate decides what a visitor sees: the sign-in screen, the welcome
// steps for a new account, or the app itself.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Check, Fingerprint, LogOut, Mail, ScanSearch, ShieldCheck, Sparkles, UserCog, Wallet } from 'lucide-react';
import { useState } from 'react';
import type { Currency } from '@/domain/types';
import { Loader } from './loader';
import { notify } from './notifications';
import { PayPalMark } from './paypal-mark';
import { CodeInput, passkeysSupported, SecurityDialog, signInWithPasskey } from './security';
import { restartTour } from './walkthrough';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  status: 'active' | 'suspended';
  permissions: { assistant: boolean; paypal: boolean; connect: boolean };
  createdAt: string;
  lastSeenAt?: string;
  onboardedAt?: string;
  security: { totp: boolean; passkeys: { id: string; name: string; createdAt: string }[] };
  /** Trying the demo without an account. */
  guest: boolean;
}
interface Me {
  user: SessionUser | null;
  deviceKey?: string;
  /** No account exists yet: the first one created becomes the administrator. */
  setup: boolean;
  signups: boolean;
  singleUser: boolean;
  /** False on a host that wipes its disk, where accounts and data would not last. */
  persistent: boolean;
  /** Whether this server can email sign-in codes. */
  emailCodes: boolean;
  /** Whether the demo can be opened without an account. */
  guestDemo?: boolean;
}

export const ME_KEY = ['me'] as const;
const post = (url: string, body: unknown, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** After signing in or finishing the welcome: drop whatever was loaded before and ask again who this is. */
async function enter(client: ReturnType<typeof useQueryClient>) {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
  await client.refetchQueries({ queryKey: ME_KEY });
}

export function useSession() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ME_KEY, queryFn: async () => (await (await fetch('/api/auth/me')).json()) as Me, staleTime: 60_000 });
  const signOut = async () => {
    await fetch('/api/auth/session', { method: 'DELETE' });
    client.clear();
    window.location.assign('/');
  };
  return { me: query.data, loading: query.isLoading, refresh: () => client.invalidateQueries({ queryKey: ME_KEY }), signOut };
}

/** Shows the sign-in screen, the welcome steps, or the app. */
export function Gate({ children }: { children: React.ReactNode }) {
  const { me, loading } = useSession();
  if (loading || !me) return <Loader label="Opening Subster" />;
  if (!me.user) return <AuthScreen me={me} />;
  if (!me.user.onboardedAt) return <Onboarding user={me.user} />;
  return <>{children}</>;
}

const FIELD = 'w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-[15px] placeholder:text-faint focus:border-accent';

function AuthScreen({ me }: { me: Me }) {
  const client = useQueryClient();
  const [create, setCreate] = useState(me.setup);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', currency: 'INR' as Currency });
  const [show, setShow] = useState(false);
  /** After the first step: a code from the authenticator app, or one sent by email. */
  const [asking, setAsking] = useState<null | { kind: 'authenticator'; ticket: string } | { kind: 'email' }>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canCreate = me.setup || me.signups;

  /** Sends a sign-in request and moves on: into the app, or to the authenticator step. */
  async function attempt(body: Record<string, unknown>, method = 'POST') {
    setBusy(true);
    setError(null);
    const res = await post('/api/auth/session', body, method);
    const data = (await res.json().catch(() => ({}))) as { error?: string; step?: string; ticket?: string };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? 'That did not work. Please try again.');
      return false;
    }
    if (data.step === 'authenticator' && data.ticket) {
      setCode('');
      setAsking({ kind: 'authenticator', ticket: data.ticket });
      return true;
    }
    if (method === 'POST') await enter(client);
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (asking?.kind === 'authenticator') return void attempt({ ticket: asking.ticket, code });
    if (asking?.kind === 'email') return void attempt({ email: form.email, code });
    if (create && form.password !== form.confirm) return setError('The two passwords do not match.');
    const { name, email, password, currency } = form;
    await attempt(create ? { name, email, password, currency, create } : { email, password });
  }

  async function emailCode() {
    if (!form.email.trim()) return setError('Enter your email first, then ask for a code.');
    if (await attempt({ email: form.email }, 'PUT')) {
      setCode('');
      setAsking({ kind: 'email' });
    }
  }

  async function passkey() {
    setBusy(true);
    setError(null);
    const problem = await signInWithPasskey();
    setBusy(false);
    if (problem) setError(problem);
    else await enter(client);
  }

  /** Opens the demo without an account. The guest is signed out and deleted when the demo ends. */
  async function tryDemo() {
    setBusy(true);
    setError(null);
    const res = await post('/api/auth/guest', {});
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'The demo could not be opened just now.');
    restartTour();
    notify({ tone: 'info', title: 'Demo mode is on', body: 'This is sample data. Nothing here is saved, and you are signed out when the demo ends.' });
    await enter(client);
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <section className="brand-blue relative hidden flex-col justify-between overflow-hidden p-12 text-on lg:flex">
        <img src="/logo-mark.png" alt="" aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-20 h-[420px] w-[420px] rotate-6 opacity-[0.12]" />
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-on">
            <img src="/logo-mark.png" alt="" className="h-7 w-7" />
          </span>
          <span className="text-[20px] font-semibold tracking-[-0.03em]">Subster</span>
        </div>
        <div className="relative max-w-[460px]">
          <h1 className="text-[44px] font-medium leading-[1.05] tracking-[-0.04em]">Every subscription should earn its place.</h1>
          <ul className="mt-8 space-y-4 text-[15px] text-on/85">
            {[
              [Wallet, 'Finds what you pay for, and what it really costs you per hour'],
              [ScanSearch, 'An agent proposes what to pause, cancel or switch. You approve'],
              [ShieldCheck, 'Changes go through PayPal and are read back to prove they happened'],
            ].map(([Icon, text]) => {
              const I = Icon as typeof Wallet;
              return (
                <li key={text as string} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-on/15">
                    <I size={14} aria-hidden="true" />
                  </span>
                  {text as string}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="relative text-[13px] text-on/70">Subster never asks for the password to any service you subscribe to.</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="panel w-full max-w-[420px] p-8">
          <img src="/logo-mark.png" alt="" className="mb-5 h-10 w-10 lg:hidden" />
          <h2 className="text-[26px] font-semibold tracking-[-0.03em]">{asking ? 'One more step' : me.setup ? 'Set up Subster' : create ? 'Create your account' : 'Welcome back'}</h2>
          <p className="mt-1 text-[14px] text-muted">{me.setup ? 'The first account is the administrator.' : create ? 'A few details, then a guided demo.' : 'Sign in to your subscriptions.'}</p>

          {asking ? (
            <div className="mt-6 space-y-3">
              <p className="text-[14px] leading-relaxed text-muted">
                {asking.kind === 'authenticator' ? 'Enter the six-digit code from your authenticator app.' : `If ${form.email} has an account, a six-digit code is on its way. It works for 10 minutes.`}
              </p>
              <CodeInput value={code} onChange={setCode} autoFocus />
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {create && (
                <label className="block">
                  <span className="mb-1.5 block text-[13px] text-muted">Your name</span>
                  <input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={FIELD} style={{ outline: 'none' }} />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-[13px] text-muted">Email</span>
                <input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={FIELD} style={{ outline: 'none' }} />
              </label>
              {create && (
                <fieldset>
                  <legend className="mb-1.5 text-[13px] text-muted">Currency you pay in</legend>
                  <div className="grid grid-cols-4 gap-1.5">
                    {CURRENCIES.map(([code, label]) => (
                      <button
                        key={code}
                        type="button"
                        title={label}
                        onClick={() => setForm({ ...form, currency: code })}
                        aria-pressed={form.currency === code}
                        className={`rounded-2xl border py-2.5 text-[14px] font-medium transition-colors ${form.currency === code ? 'border-accent bg-accent-soft text-accent' : 'border-white/10 hover:border-white/25'}`}
                      >
                        {code}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
              <label className="block">
                <span className="mb-1.5 flex items-center justify-between text-[13px] text-muted">
                  Password
                  <button type="button" onClick={() => setShow(!show)} className="text-[12px] text-accent hover:underline">
                    {show ? 'Hide' : 'Show'}
                  </button>
                </span>
                <input
                  required
                  type={show ? 'text' : 'password'}
                  minLength={create ? 8 : undefined}
                  autoComplete={create ? 'new-password' : 'current-password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={FIELD}
                  style={{ outline: 'none' }}
                />
                {create && <span className={`mt-1.5 block text-[12px] ${form.password.length >= 8 ? 'text-good' : 'text-faint'}`}>{form.password.length >= 8 ? 'Long enough.' : 'At least 8 characters.'}</span>}
              </label>
              {create && (
                <label className="block">
                  <span className="mb-1.5 block text-[13px] text-muted">Confirm password</span>
                  <input required type={show ? 'text' : 'password'} autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} className={FIELD} style={{ outline: 'none' }} />
                  {form.confirm && form.confirm !== form.password && <span className="mt-1.5 block text-[12px] text-bad">These do not match yet.</span>}
                </label>
              )}
            </div>
          )}

          {!me.persistent && <p className="mt-4 rounded-2xl bg-warn-soft px-4 py-2.5 text-[13px] text-warn">This server does not keep data between restarts. Accounts created here are for trying it out only.</p>}

          {error && (
            <p role="alert" className="mt-4 rounded-2xl bg-bad-soft px-4 py-2.5 text-[13px] text-bad">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy || (asking !== null && code.length !== 6)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3 text-[15px] font-semibold text-on disabled:opacity-50">
            {busy ? 'One moment' : asking ? 'Continue' : me.setup ? 'Create the administrator' : create ? 'Create account' : 'Sign in'}
            {!busy && <ArrowRight size={16} aria-hidden="true" />}
          </button>

          {asking && (
            <button
              type="button"
              onClick={() => {
                setAsking(null);
                setError(null);
              }}
              className="mt-3 w-full text-center text-[13px] text-muted hover:text-ink"
            >
              Start again
            </button>
          )}

          {!asking && !create && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {passkeysSupported() && (
                <button
                  type="button"
                  onClick={passkey}
                  disabled={busy}
                  className={`flex items-center justify-center gap-2 rounded-full border border-white/10 py-2.5 text-[14px] hover:border-accent hover:text-accent ${me.emailCodes ? '' : 'sm:col-span-2'}`}
                >
                  <Fingerprint size={16} aria-hidden="true" /> Use a passkey
                </button>
              )}
              {me.emailCodes && (
                <button
                  type="button"
                  onClick={emailCode}
                  disabled={busy}
                  className={`flex items-center justify-center gap-2 rounded-full border border-white/10 py-2.5 text-[14px] hover:border-accent hover:text-accent ${passkeysSupported() ? '' : 'sm:col-span-2'}`}
                >
                  <Mail size={16} aria-hidden="true" /> Email me a code
                </button>
              )}
            </div>
          )}

          {me.guestDemo && !asking && (
            <>
              <div className="my-5 flex items-center gap-3 text-[12px] text-faint" aria-hidden="true">
                <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
              </div>
              <button type="button" onClick={tryDemo} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-full bg-sun py-3 text-[15px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-50">
                <Sparkles size={16} aria-hidden="true" /> Try the demo, no account needed
              </button>
              <p className="mt-2 text-center text-[12px] text-faint">Sample data only. You are signed out when the demo ends.</p>
            </>
          )}

          {!me.setup && !asking && (
            <p className="mt-5 text-center text-[13px] text-muted">
              {create ? 'Already have an account?' : canCreate ? 'New here?' : 'New accounts are closed. Ask your administrator.'}{' '}
              {(create || canCreate) && (
                <button
                  type="button"
                  onClick={() => {
                    setCreate(!create);
                    setError(null);
                  }}
                  className="font-medium text-accent hover:underline"
                >
                  {create ? 'Sign in' : 'Create an account'}
                </button>
              )}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}

const CURRENCIES: [Currency, string][] = [
  ['INR', 'Indian rupee'],
  ['USD', 'US dollar'],
  ['EUR', 'Euro'],
  ['GBP', 'British pound'],
];

/** Two short steps for a new account, ending in the guided demo. */
function Onboarding({ user }: { user: SessionUser }) {
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  async function finish(demo: boolean) {
    setBusy(true);
    await post('/api/auth/onboard', { demo });
    restartTour();
    await enter(client);
    if (demo) notify({ tone: 'info', title: 'Demo mode is on', body: 'This is sample data. Follow the walkthrough to see PayPal at work.' });
    else notify({ tone: 'good', title: 'You are all set', body: 'Connect your real data to begin.', href: '/' });
  }

  return (
    <div className="flex min-h-full items-center justify-center p-5">
      <div className="panel w-full max-w-[640px] overflow-hidden">
        <div className="flex items-center justify-between px-8 pt-7">
          <img src="/logo-mark.png" alt="Subster" className="h-9 w-9" />
          <ol className="flex gap-1.5" aria-label={`Step ${step + 1} of 2`}>
            {[0, 1].map((i) => (
              <li key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-8 bg-accent' : i < step ? 'w-4 bg-accent/40' : 'w-4 bg-white/10'}`} />
            ))}
          </ol>
        </div>

        <div key={step} className="rise px-8 pb-8 pt-6">
          {step === 0 && (
            <>
              <h1 className="text-[30px] font-semibold tracking-[-0.03em]">Welcome, {user.name.split(' ')[0]}</h1>
              <p className="mt-1.5 text-[15px] text-muted">Here is how Subster works.</p>
              <ol className="mt-5 space-y-3">
                {[
                  [Wallet, 'It finds what you pay for', 'From PayPal, your bank, a statement, or by adding a service yourself.'],
                  [ScanSearch, 'It measures what you use', 'A browser extension and a phone app report time only. Never pages or content.'],
                  [Sparkles, 'An agent proposes. You approve.', 'Pause, cancel or switch. Nothing changes until you say so.'],
                ].map(([Icon, title, body], i) => {
                  const I = Icon as typeof Wallet;
                  return (
                    <li key={i} className="flex items-start gap-4 rounded-2xl bg-white/[0.04] p-4">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-on">
                        <I size={18} aria-hidden="true" />
                      </span>
                      <span>
                        <span className="block text-[15px] font-medium">{title as string}</span>
                        <span className="block text-[13px] leading-relaxed text-muted">{body as string}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-4 flex items-center gap-2 text-[13px] text-muted">
                <ShieldCheck size={15} className="text-good" aria-hidden="true" /> Subster never asks for the password to any service.
              </p>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="text-[30px] font-semibold tracking-[-0.03em]">See it work first</h1>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">A guided demo opens with sample subscriptions. It walks you through the part that matters most:</p>
              <div className="mt-5 rounded-2xl bg-accent-soft p-5">
                <p className="flex items-center gap-2 text-[15px] font-medium">
                  <PayPalMark /> in five short steps
                </p>
                <ul className="mt-3 space-y-2 text-[14px]">
                  {[
                    'See which of your services accept PayPal',
                    'Start a subscription through PayPal',
                    'Approve it. Nothing is charged before you confirm',
                    'Pause or cancel in one tap, confirmed with PayPal',
                    'Read your PayPal payments in one ledger',
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2.5">
                      <Check size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" /> {line}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="mt-3 text-[13px] text-faint">Your own data stays separate and empty until you end the demo.</p>
            </>
          )}

          <div className="mt-7 flex items-center gap-3">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} disabled={busy} className="rounded-full border border-white/10 px-5 py-2.5 text-[14px] hover:border-white/25">
                Back
              </button>
            )}
            {step < 1 ? (
              <button type="button" onClick={() => setStep(step + 1)} className="ml-auto flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-[14px] font-semibold text-on disabled:opacity-40">
                Continue <ArrowRight size={15} aria-hidden="true" />
              </button>
            ) : (
              <>
                <button type="button" onClick={() => finish(false)} disabled={busy} className="ml-auto text-[14px] text-muted hover:text-ink">
                  Skip the demo
                </button>
                <button type="button" onClick={() => finish(true)} disabled={busy} className="flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-[14px] font-semibold text-on disabled:opacity-50">
                  {busy ? 'Opening' : 'Start the demo'} {!busy && <ArrowRight size={15} aria-hidden="true" />}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The round button at the top right: who you are, the admin page for administrators, sign out. */
export function AccountMenu() {
  const { me, signOut, refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [securing, setSecuring] = useState(false);
  const user = me?.user;
  if (!user || me.singleUser) return null;

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Account: ${user.name}`} className="grid h-9 w-9 place-items-center rounded-full bg-accent text-[13px] font-semibold text-on shadow-sm" style={{ padding: 0 }}>
        {user.name.trim().charAt(0).toUpperCase() || 'U'}
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="toast absolute right-0 top-full z-50 mt-2 w-[260px] overflow-hidden p-2" role="menu">
            <div className="px-3 pb-2 pt-2">
              <p className="truncate text-[14px] font-semibold">{user.name}</p>
              <p className="truncate text-[12px] text-muted">{user.guest ? 'Nothing here is saved' : user.email}</p>
              {user.role === 'admin' && <span className="mt-1.5 inline-block rounded-full bg-sun-soft px-2 py-0.5 text-[11px] font-medium">Administrator</span>}
              {user.guest && <span className="mt-1.5 inline-block rounded-full bg-sun-soft px-2 py-0.5 text-[11px] font-medium">Demo guest</span>}
            </div>
            {user.role === 'admin' && (
              <Link to="/admin" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-2xl px-3 py-2 text-[13px] hover:bg-accent-soft hover:text-accent">
                <UserCog size={15} aria-hidden="true" /> People and logs
              </Link>
            )}
            {!user.guest && (
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setSecuring(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-left text-[13px] hover:bg-accent-soft hover:text-accent"
              >
                <ShieldCheck size={15} aria-hidden="true" /> Sign-in security
              </button>
            )}
            <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-left text-[13px] hover:bg-accent-soft hover:text-accent">
              <LogOut size={15} aria-hidden="true" /> {user.guest ? 'End demo and sign out' : 'Sign out'}
            </button>
          </div>
        </>
      )}
      {securing && <SecurityDialog user={user} emailCodes={me.emailCodes} onClose={() => setSecuring(false)} onChanged={refresh} />}
    </div>
  );
}
