// Who is using the app. The gate decides what a visitor sees: the sign-in screen, the welcome
// steps for a new account, or the app itself.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Check, LogOut, ScanSearch, ShieldCheck, Sparkles, UserCog, Wallet } from 'lucide-react';
import { useState } from 'react';
import type { Currency } from '@/domain/types';
import { Loader } from './loader';
import { notify } from './notifications';
import { PayPalMark } from './paypal-mark';
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
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canCreate = me.setup || me.signups;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await post('/api/auth/session', { ...form, create });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'That did not work. Please try again.');
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
          <h2 className="text-[26px] font-semibold tracking-[-0.03em]">{me.setup ? 'Set up Subster' : create ? 'Create your account' : 'Welcome back'}</h2>
          <p className="mt-1 text-[14px] text-muted">{me.setup ? 'The first account is the administrator.' : create ? 'It takes a minute. A guided demo comes next.' : 'Sign in to your subscriptions.'}</p>

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
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-muted">Password</span>
              <input required type="password" minLength={create ? 8 : undefined} autoComplete={create ? 'new-password' : 'current-password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={FIELD} style={{ outline: 'none' }} />
              {create && <span className="mt-1.5 block text-[12px] text-faint">At least 8 characters.</span>}
            </label>
          </div>

          {!me.persistent && <p className="mt-4 rounded-2xl bg-warn-soft px-4 py-2.5 text-[13px] text-warn">This server does not keep data between restarts. Accounts created here are for trying it out only.</p>}

          {error && (
            <p role="alert" className="mt-4 rounded-2xl bg-bad-soft px-4 py-2.5 text-[13px] text-bad">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3 text-[15px] font-semibold text-on disabled:opacity-50">
            {busy ? 'One moment' : me.setup ? 'Create the administrator' : create ? 'Create account' : 'Sign in'}
            {!busy && <ArrowRight size={16} aria-hidden="true" />}
          </button>

          {!me.setup && (
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

/** Three short steps for a new account, ending in the guided demo. */
function Onboarding({ user }: { user: SessionUser }) {
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(user.name);
  const [currency, setCurrency] = useState<Currency>('INR');
  const [busy, setBusy] = useState(false);

  async function finish(demo: boolean) {
    setBusy(true);
    await post('/api/auth/onboard', { name, currency, demo });
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
          <ol className="flex gap-1.5" aria-label={`Step ${step + 1} of 3`}>
            {[0, 1, 2].map((i) => (
              <li key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-8 bg-accent' : i < step ? 'w-4 bg-accent/40' : 'w-4 bg-white/10'}`} />
            ))}
          </ol>
        </div>

        <div key={step} className="rise px-8 pb-8 pt-6">
          {step === 0 && (
            <>
              <h1 className="text-[30px] font-semibold tracking-[-0.03em]">Welcome to Subster</h1>
              <p className="mt-1.5 text-[15px] text-muted">Two quick things so everything reads right.</p>
              <label className="mt-6 block">
                <span className="mb-1.5 block text-[13px] text-muted">What should we call you?</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} style={{ outline: 'none' }} />
              </label>
              <fieldset className="mt-5">
                <legend className="mb-2 text-[13px] text-muted">Which currency do you pay in?</legend>
                <div className="grid grid-cols-2 gap-2">
                  {CURRENCIES.map(([code, label]) => (
                    <button key={code} type="button" onClick={() => setCurrency(code)} aria-pressed={currency === code} className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-[14px] transition-colors ${currency === code ? 'border-accent bg-accent-soft' : 'border-white/10 hover:border-white/25'}`}>
                      <span>
                        <span className="block font-medium">{code}</span>
                        <span className="block text-[12px] text-muted">{label}</span>
                      </span>
                      {currency === code && <Check size={16} className="text-accent" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-faint">Amounts are never converted. You can change this later.</p>
              </fieldset>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="text-[30px] font-semibold tracking-[-0.03em]">How it works</h1>
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

          {step === 2 && (
            <>
              <h1 className="text-[30px] font-semibold tracking-[-0.03em]">See it work first</h1>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">A guided demo opens with sample subscriptions. It walks you through the part that matters most:</p>
              <div className="mt-5 rounded-2xl bg-accent-soft p-5">
                <p className="flex items-center gap-2 text-[15px] font-medium">
                  <PayPalMark /> in five short steps
                </p>
                <ul className="mt-3 space-y-2 text-[14px]">
                  {['See which of your services accept PayPal', 'Start a subscription through PayPal', 'Approve it. Nothing is charged before you confirm', 'Pause or cancel in one tap, confirmed with PayPal', 'Read your PayPal payments in one ledger'].map((line) => (
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
            {step < 2 ? (
              <button type="button" onClick={() => setStep(step + 1)} disabled={!name.trim()} className="ml-auto flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-[14px] font-semibold text-on disabled:opacity-40">
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
  const { me, signOut } = useSession();
  const [open, setOpen] = useState(false);
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
              <p className="truncate text-[12px] text-muted">{user.email}</p>
              {user.role === 'admin' && <span className="mt-1.5 inline-block rounded-full bg-sun-soft px-2 py-0.5 text-[11px] font-medium">Administrator</span>}
            </div>
            {user.role === 'admin' && (
              <Link to="/admin" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-2xl px-3 py-2 text-[13px] hover:bg-accent-soft hover:text-accent">
                <UserCog size={15} aria-hidden="true" /> People and logs
              </Link>
            )}
            <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-left text-[13px] hover:bg-accent-soft hover:text-accent">
              <LogOut size={15} aria-hidden="true" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
