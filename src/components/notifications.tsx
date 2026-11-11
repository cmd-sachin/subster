// Alerts. A watcher compares each new state with the last one and raises an alert for what
// changed: a new proposal, a change carried out, a payment event. Each alert slides in as a toast
// with a short chime and is kept in the bell's list. The chimes are synthesised, so there are no
// sound files, and they can be switched off from the bell.

import { Link } from '@tanstack/react-router';
import { AlertTriangle, Bell, BellRing, Check, CircleAlert, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { diffDays, money, today } from '@/domain/dates';
import type { AppState } from '@/domain/types';
import { useApp } from './app-state';

type Tone = 'info' | 'good' | 'warn' | 'bad';
interface Alert {
  id: string;
  tone: Tone;
  title: string;
  body?: string;
  href?: '/' | '/timeline' | '/transactions' | '/chat';
  at: number;
  /** On screen as a toast. */
  showing: boolean;
  leaving?: boolean;
  read: boolean;
}

const SHOW_MS = 6500;
const SOUND_KEY = 'subster.sound';

// ---- A small store, outside React, so anything can raise an alert ------------------------------

let snapshot: { alerts: Alert[]; muted: boolean } = { alerts: [], muted: false };
const EMPTY = snapshot;
const listeners = new Set<() => void>();
const set = (next: Partial<typeof snapshot>) => {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const useAlerts = () => useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
const patch = (id: string, change: Partial<Alert>) => set({ alerts: snapshot.alerts.map((a) => (a.id === id ? { ...a, ...change } : a)) });

function dismiss(id: string) {
  if (!snapshot.alerts.some((a) => a.id === id && a.showing && !a.leaving)) return;
  patch(id, { leaving: true });
  setTimeout(() => patch(id, { showing: false, leaving: false }), 260);
}

export function notify(alert: Pick<Alert, 'tone' | 'title' | 'body' | 'href'>) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  set({ alerts: [{ ...alert, id, at: Date.now(), showing: true, read: false }, ...snapshot.alerts].slice(0, 30) });
  chime(alert.tone);
  setTimeout(() => dismiss(id), SHOW_MS);
}

// ---- Sound ------------------------------------------------------------------------------------

const NOTES: Record<Tone, number[]> = {
  info: [659.25, 880],
  good: [523.25, 659.25, 783.99],
  warn: [587.33, 440],
  bad: [392, 293.66],
};
let audio: AudioContext | undefined;

/** A soft two or three note chime. Browsers only allow sound after the first click or key press. */
function chime(tone: Tone) {
  if (snapshot.muted || typeof window === 'undefined') return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const start = audio.currentTime + 0.02;
    NOTES[tone].forEach((frequency, i) => {
      const at = start + i * 0.12;
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.09, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
      osc.connect(gain).connect(audio!.destination);
      osc.start(at);
      osc.stop(at + 0.36);
    });
  } catch {
    /* no sound available; the toast still shows */
  }
}

function setMuted(muted: boolean) {
  set({ muted });
  try {
    localStorage.setItem(SOUND_KEY, muted ? 'off' : 'on');
  } catch {
    /* private mode; the choice lasts for this visit */
  }
  if (!muted) chime('info');
}

// ---- Watching the state for things worth an alert ---------------------------------------------

function changes(before: AppState, after: AppState): Parameters<typeof notify>[0][] {
  const out: Parameters<typeof notify>[0][] = [];
  const was = new Map(before.actions.map((a) => [a.id, a.status]));
  const fresh = after.actions.filter((a) => !was.has(a.id) && a.status === 'pending');
  if (fresh.length > 3) {
    const saving = fresh.reduce((t, a) => t + a.savingsMonthly, 0);
    out.push({ tone: 'info', title: `${fresh.length} things need your decision`, body: saving > 0 ? `Worth ${money(saving)} a month if you approve them all` : undefined, href: '/' });
  } else {
    for (const a of fresh) out.push({ tone: 'info', title: 'Needs your decision', body: `${a.title}${a.savingsMonthly > 0 ? `, saves ${money(a.savingsMonthly)} a month` : ''}`, href: '/' });
  }
  for (const a of after.actions) {
    const prior = was.get(a.id);
    if (!prior || prior === a.status) continue;
    if (a.status === 'executed') out.push({ tone: 'good', title: 'Done', body: `${a.title}${a.channel === 'paypal_api' ? ', confirmed with PayPal' : ''}`, href: '/' });
    else if (a.status === 'failed') out.push({ tone: 'bad', title: 'That did not go through', body: a.title, href: '/' });
    else if (a.status === 'guided') out.push({ tone: 'warn', title: 'One step left', body: a.type === 'subscribe' ? `${a.title}: confirm it at PayPal` : `${a.title}: finish on the provider's page`, href: '/' });
  }
  const known = new Set(before.notes.map((n) => n.id));
  for (const n of after.notes) if (!known.has(n.id) && (n.kind === 'webhook' || n.kind === 'bank')) out.push({ tone: 'info', title: n.kind === 'webhook' ? 'From PayPal' : 'From your bank', body: n.label, href: '/timeline' });
  return out;
}

/** Mounted once. Raises alerts as the state changes, and one heads-up on arrival if a charge is close. */
export function AlertWatcher() {
  const { state } = useApp();
  const last = useRef<AppState | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(SOUND_KEY) === 'off') set({ muted: true });
    } catch {
      /* default: sound on */
    }
  }, []);

  useEffect(() => {
    if (!state) return;
    const before = last.current;
    last.current = state;
    if (before && before.demo === state.demo) {
      changes(before, state).forEach((alert, i) => setTimeout(() => notify(alert), i * 450));
      return;
    }
    if (before) return;
    // First sight of the data: one heads-up about the nearest charge, once a day.
    const next = state.portfolio.upcoming[0];
    const days = next ? diffDays(next.date, today()) : 99;
    const key = `subster.headsup.${today()}`;
    try {
      if (!next || days > 2 || sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      return;
    }
    setTimeout(
      () => notify({ tone: 'warn', title: `${next.name} ${next.kind === 'trial_conversion' ? 'trial converts' : 'charges'} ${days <= 0 ? 'today' : days === 1 ? 'tomorrow' : 'in 2 days'}`, body: `${money(next.amount)} on ${new Date(next.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`, href: '/timeline' }),
      1400,
    );
  }, [state]);

  return null;
}

// ---- Toasts -----------------------------------------------------------------------------------

const LOOK: Record<Tone, { icon: typeof Check; chip: string }> = {
  info: { icon: Sparkles, chip: 'bg-accent text-on' },
  good: { icon: Check, chip: 'bg-good text-on' },
  warn: { icon: AlertTriangle, chip: 'bg-warn text-on' },
  bad: { icon: CircleAlert, chip: 'bg-bad text-on' },
};

export function Toasts() {
  const { alerts } = useAlerts();
  const showing = alerts.filter((a) => a.showing).slice(0, 4);
  return (
    <div className="pointer-events-none fixed right-4 top-[68px] z-[70] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2.5 max-md:top-[120px] max-md:[&>*:nth-child(n+2)]:hidden" role="status" aria-live="polite">
      {showing.map((alert) => {
        const { icon: Icon, chip } = LOOK[alert.tone];
        const inner = (
          <>
            <span className={`toast-icon grid h-9 w-9 shrink-0 place-items-center rounded-full ${chip}`}>
              <Icon size={17} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold leading-snug">{alert.title}</span>
              {alert.body && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted">{alert.body}</span>}
            </span>
          </>
        );
        return (
          <div key={alert.id} className={`toast pointer-events-auto relative overflow-hidden ${alert.leaving ? 'toast-out' : ''}`}>
            {alert.href ? (
              <Link to={alert.href} onClick={() => dismiss(alert.id)} className="flex items-start gap-3 p-3.5 pr-10">
                {inner}
              </Link>
            ) : (
              <div className="flex items-start gap-3 p-3.5 pr-10">{inner}</div>
            )}
            <button onClick={() => dismiss(alert.id)} aria-label="Dismiss" className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-white/[0.06] hover:text-ink">
              <X size={14} aria-hidden="true" />
            </button>
            <span className="toast-timer" style={{ animationDuration: `${SHOW_MS}ms` }} aria-hidden="true" />
          </div>
        );
      })}
    </div>
  );
}

// ---- The bell ---------------------------------------------------------------------------------

const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60000);
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes} min ago` : new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

export function BellMenu({ pending }: { pending: number }) {
  const { alerts, muted } = useAlerts();
  const [open, setOpen] = useState(false);
  const unread = alerts.filter((a) => !a.read).length;
  const count = unread || pending;

  const toggle = () => {
    // Opening the list takes the toasts off the screen; closing it marks everything as seen.
    set({ alerts: snapshot.alerts.map((a) => (open ? { ...a, read: true } : { ...a, showing: false })) });
    setOpen(!open);
  };

  return (
    <div className="relative">
      <button onClick={toggle} aria-expanded={open} aria-label={count > 0 ? `Alerts, ${count} new` : 'Alerts'} className="relative grid h-9 w-9 place-items-center rounded-full bg-black/70 text-muted shadow-sm hover:text-ink">
        {/* The key restarts the ring each time a new alert arrives. */}
        <span key={alerts[0]?.id ?? 'still'} className={unread > 0 ? 'bell-ring grid' : 'grid'}>
          {unread > 0 ? <BellRing size={16} strokeWidth={1.75} aria-hidden="true" /> : <Bell size={16} strokeWidth={1.75} aria-hidden="true" />}
        </span>
        {count > 0 && <span className={`num absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-semibold text-on ${unread > 0 ? 'badge-pop bg-bad' : 'bg-accent'}`}>{count}</span>}
      </button>

      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Close alerts" onClick={toggle} />
          <div className="toast absolute right-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-32px))] overflow-hidden" role="dialog" aria-label="Alerts">
            <header className="flex items-center justify-between px-4 pb-2 pt-3.5">
              <h2 className="text-[15px] font-semibold">Alerts</h2>
              <button onClick={() => setMuted(!muted)} aria-pressed={!muted} className="flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[12px] text-muted hover:text-ink">
                {muted ? <VolumeX size={13} aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
                Sound {muted ? 'off' : 'on'}
              </button>
            </header>
            {pending > 0 && (
              <Link to="/" onClick={toggle} className="mx-2 mb-1 flex items-center justify-between rounded-2xl bg-white/[0.05] px-3 py-2.5 text-[13px] font-medium">
                {pending} waiting for your decision
                <span className="text-muted">Open</span>
              </Link>
            )}
            <ul className="max-h-[340px] overflow-auto px-2 pb-2">
              {alerts.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">Nothing new. You will hear a chime when something changes.</li>}
              {alerts.slice(0, 12).map((alert) => {
                const { icon: Icon, chip } = LOOK[alert.tone];
                return (
                  <li key={alert.id} className="flex items-start gap-3 rounded-2xl px-2 py-2">
                    <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${chip}`}>
                      <Icon size={13} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-snug">{alert.title}</span>
                      {alert.body && <span className="block text-[12px] leading-snug text-muted">{alert.body}</span>}
                      <span className="num block text-[11px] text-faint">{ago(alert.at)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
