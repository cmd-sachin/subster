// Sign-in security for an account: an authenticator app, and passkeys. Opened from the account
// menu. Also holds the passkey sign-in used on the sign-in screen.

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { Fingerprint, KeyRound, Mail, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { notify } from './notifications';
import type { SessionUser } from './session';

type Result<T = Record<string, unknown>> = { ok: boolean; data: T & { error?: string } };
async function security<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<Result<T>> {
  const res = await fetch('/api/auth/security', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as T & { error?: string } };
}

export const passkeysSupported = () => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

/** Signs in with a passkey held by this device. Returns an error message, or nothing when it worked. */
export async function signInWithPasskey(): Promise<string | undefined> {
  const start = await security<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>({ action: 'passkey-signin-options' });
  if (!start.ok) return start.data.error ?? 'Passkeys are not available just now.';
  let response;
  try {
    response = await startAuthentication({ optionsJSON: start.data.options });
  } catch {
    return 'No passkey was used.';
  }
  const done = await security({ action: 'passkey-signin', challengeId: start.data.challengeId, response });
  return done.ok ? undefined : (done.data.error ?? 'That passkey did not work.');
}

const CODE = 'num w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-center text-[22px] tracking-[0.4em] placeholder:tracking-normal placeholder:text-faint focus:border-accent';

/** A six-digit code box that phones offer to fill from the authenticator app or an email. */
export function CodeInput({ value, onChange, autoFocus }: { value: string; onChange: (code: string) => void; autoFocus?: boolean }) {
  return <input value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" aria-label="Six-digit code" placeholder="000000" autoFocus={autoFocus} className={CODE} style={{ outline: 'none' }} />;
}

export function SecurityDialog({ user, emailCodes, onClose, onChanged }: { user: SessionUser; emailCodes: boolean; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const [enrol, setEnrol] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(body: Record<string, unknown>, done?: string) {
    setBusy(true);
    setError(null);
    const res = await security(body);
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error ?? 'That did not work. Please try again.');
      return false;
    }
    await onChanged();
    if (done) notify({ tone: 'good', title: done });
    return true;
  }

  async function startApp() {
    setBusy(true);
    setError(null);
    const res = await security<{ secret: string; qr: string }>({ action: 'totp-start' });
    setBusy(false);
    if (res.ok) setEnrol({ secret: res.data.secret, qr: res.data.qr });
    else setError(res.data.error ?? 'That did not work. Please try again.');
  }

  async function addPasskey() {
    setError(null);
    const start = await security<{ options: Parameters<typeof startRegistration>[0]['optionsJSON']; challengeId: string }>({ action: 'passkey-options' });
    if (!start.ok) return setError(start.data.error ?? 'Passkeys are not available just now.');
    let response;
    try {
      response = await startRegistration({ optionsJSON: start.data.options });
    } catch {
      return setError('No passkey was created.');
    }
    const where = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android phone' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Windows/.test(navigator.userAgent) ? 'Windows PC' : 'This device';
    await run({ action: 'passkey-add', challengeId: start.data.challengeId, response, name: where }, 'Passkey added');
  }

  const { totp, passkeys } = user.security;
  const row = 'flex items-start gap-3.5 rounded-2xl bg-white/[0.04] p-4';
  const chip = 'grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent';

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-scrim backdrop-blur-sm sm:items-center sm:p-5" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Sign-in security" onClick={(e) => e.stopPropagation()} className="menu-pop flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-[30px] bg-surface shadow-[0_40px_90px_-30px_rgba(10,40,110,0.55)] sm:rounded-[30px]" style={{ transformOrigin: 'center' }}>
        <header className="flex items-center justify-between px-6 pb-3 pt-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-accent text-on">
              <ShieldCheck size={18} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Sign-in security</h2>
              <p className="text-[13px] text-muted">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-white/[0.06] hover:text-ink">
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-3 overflow-y-auto px-6 pb-6">
          {error && (
            <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-2.5 text-[13px] text-bad">
              {error}
            </p>
          )}

          <section className={row}>
            <span className={chip}>
              <Fingerprint size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold">Passkeys</h3>
              <p className="text-[13px] leading-relaxed text-muted">Sign in with your fingerprint, face or device PIN. No password to type or steal.</p>
              {passkeys.length > 0 && (
                <ul className="mt-2.5 space-y-1.5">
                  {passkeys.map((k) => (
                    <li key={k.id} className="flex items-center gap-2.5 rounded-xl bg-black px-3 py-2 text-[13px]">
                      <KeyRound size={14} className="text-accent" aria-hidden="true" />
                      <span className="flex-1">
                        {k.name} <span className="text-faint">· added {new Date(k.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                      </span>
                      <button onClick={() => void run({ action: 'passkey-remove', id: k.id }, 'Passkey removed')} aria-label={`Remove the passkey on ${k.name}`} className="grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-bad-soft hover:text-bad">
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {passkeysSupported() ? (
                <button onClick={addPasskey} disabled={busy} className="mt-3 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-on disabled:opacity-50">
                  Add a passkey on this device
                </button>
              ) : (
                <p className="mt-2 text-[12px] text-faint">This browser does not support passkeys.</p>
              )}
            </div>
          </section>

          <section className={row}>
            <span className={chip}>
              <Smartphone size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                Authenticator app {totp && <span className="rounded-full bg-good-soft px-2 py-0.5 text-[11px] font-medium text-good">On</span>}
              </h3>
              <p className="text-[13px] leading-relaxed text-muted">A six-digit code from Google Authenticator, Authy or Microsoft Authenticator, asked for after your password.</p>

              {!totp && !enrol && (
                <button onClick={startApp} disabled={busy} className="mt-3 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-on disabled:opacity-50">
                  Set up an authenticator app
                </button>
              )}

              {!totp && enrol && (
                <form
                  className="mt-3 space-y-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await run({ action: 'totp-confirm', code }, 'Authenticator app turned on')) {
                      setEnrol(null);
                      setCode('');
                    }
                  }}
                >
                  <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-black p-3">
                    <img src={`data:image/svg+xml;utf8,${encodeURIComponent(enrol.qr)}`} alt="QR code to scan with your authenticator app" width={132} height={132} className="rounded-lg" />
                    <div className="min-w-0 flex-1 text-[13px]">
                      <p className="font-medium">1. Scan this in the app</p>
                      <p className="mt-1 text-muted">Or type this key:</p>
                      <code className="num mt-1 block break-all text-[12px]">{enrol.secret.match(/.{1,4}/g)?.join(' ')}</code>
                    </div>
                  </div>
                  <p className="text-[13px] font-medium">2. Enter the code it shows</p>
                  <CodeInput value={code} onChange={setCode} autoFocus />
                  <button type="submit" disabled={busy || code.length !== 6} className="w-full rounded-full bg-accent py-2.5 text-[14px] font-semibold text-on disabled:opacity-40">
                    Turn it on
                  </button>
                </form>
              )}

              {totp &&
                (removing ? (
                  <form
                    className="mt-3 space-y-2.5"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await run({ action: 'totp-remove', code }, 'Authenticator app turned off')) {
                        setRemoving(false);
                        setCode('');
                      }
                    }}
                  >
                    <p className="text-[13px]">Enter a current code to turn it off.</p>
                    <CodeInput value={code} onChange={setCode} autoFocus />
                    <div className="flex gap-2">
                      <button type="submit" disabled={busy || code.length !== 6} className="rounded-full bg-bad px-4 py-2 text-[13px] font-semibold text-on disabled:opacity-40">
                        Turn it off
                      </button>
                      <button type="button" onClick={() => setRemoving(false)} className="rounded-full border border-white/10 px-4 py-2 text-[13px]">
                        Keep it
                      </button>
                    </div>
                  </form>
                ) : (
                  <button onClick={() => setRemoving(true)} className="mt-3 rounded-full border border-white/10 px-4 py-2 text-[13px] hover:border-white/25">
                    Turn it off
                  </button>
                ))}
            </div>
          </section>

          <section className={row}>
            <span className={chip}>
              <Mail size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                Email codes {emailCodes && <span className="rounded-full bg-good-soft px-2 py-0.5 text-[11px] font-medium text-good">Available</span>}
              </h3>
              <p className="text-[13px] leading-relaxed text-muted">{emailCodes ? 'On the sign-in screen, choose "Email me a code" to sign in without your password. It also gets you back in if you forget it.' : 'Not set up on this server yet. The administrator adds an email provider key to turn it on.'}</p>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
