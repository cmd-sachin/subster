// The guided demo. While sample data is open, a small coach card walks through how Subster uses
// PayPal, one step at a time: it takes you to the right page, rings the thing to look at, and
// ticks a step off by itself when the app's state shows it was done. The last step ends the demo
// and hands over to the person's own data.

import { useLocation, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AppState } from '@/domain/types';
import { useApp } from './app-state';
import { notify } from './notifications';
import { PayPalMark } from './paypal-mark';

// ---- Where the tour is, remembered in the browser ----------------------------------------------

const KEY = 'subster.tour';
interface Tour {
  step: number;
  small: boolean;
}
const START: Tour = { step: 0, small: false };
let tour: Tour = START;
let read = false;
const listeners = new Set<() => void>();
const get = () => {
  if (!read && typeof window !== 'undefined') {
    read = true;
    try {
      tour = { ...START, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Tour>) };
    } catch {
      /* start from the beginning */
    }
  }
  return tour;
};
function set(next: Partial<Tour>) {
  tour = { ...get(), ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(tour));
  } catch {
    /* not remembered in private mode */
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const restartTour = () => set(START);
export const openTour = () => set({ small: false });

// ---- The steps ---------------------------------------------------------------------------------

const buttonWith = (text: string) => () => [...document.querySelectorAll<HTMLElement>('main button')].find((b) => b.textContent?.trim().startsWith(text));

interface Step {
  title: string;
  body: string;
  /** Where the step happens. */
  to?: '/' | '/services' | '/transactions' | '/chat';
  go?: string;
  /** Hands the assistant a message, for the step it can do on the person's behalf. */
  ask?: string;
  /** The thing on the page to ring. */
  target?: () => HTMLElement | null | undefined;
  /** True once the app's own state shows the step was done. */
  done?: (state: AppState) => boolean;
}

const STEPS: Step[] = [
  {
    title: 'This is sample data',
    body: 'Thirteen made-up subscriptions with a year of payments. Five short steps show how Subster works with PayPal. Your own data waits, untouched.',
  },
  {
    title: 'See where PayPal is accepted',
    body: 'Every service carries what its own help pages say about PayPal. Filter the list to see the ones that take it.',
    to: '/services',
    go: 'Open Services',
    target: buttonWith('PayPal'),
  },
  {
    title: 'Start a subscription through PayPal',
    body: 'Ask the assistant, or open a dollar-priced service and press Start with PayPal. Subster prepares it and waits for you.',
    to: '/chat',
    go: 'Let the assistant do it',
    ask: 'Subscribe to Disney+ Basic with ads',
    done: (state) => state.actions.some((a) => a.type === 'subscribe'),
  },
  {
    title: 'Approve it. Nothing is charged yet',
    body: 'The proposal waits in your inbox. Approving creates a real PayPal sandbox agreement, and PayPal asks you to confirm it.',
    to: '/',
    go: 'Open the inbox',
    target: () => document.querySelector<HTMLElement>('section[aria-label="Approval inbox"]'),
    done: (state) => state.actions.some((a) => a.type === 'subscribe' && (a.status === 'guided' || a.status === 'executed')),
  },
  {
    title: 'One tap to pause or cancel',
    body: 'Once confirmed at PayPal, the subscription is under your control here. Each pause or cancel goes through PayPal and is read back to prove it happened.',
    to: '/',
    go: 'Back to the inbox',
    done: (state) => state.portfolio.insights.some((i) => i.sub.paypalSubscriptionId),
  },
  {
    title: 'Your PayPal payments, in one ledger',
    body: 'Payments from PayPal sit beside your bank and card payments, with help for refunds and failed charges.',
    to: '/transactions',
    go: 'Open Payments',
    target: buttonWith('PayPal ledger'),
  },
  {
    title: 'That is the PayPal flow',
    body: 'End the demo to switch to your own data, then connect PayPal, your bank or a statement to begin.',
  },
];

/** Mounted once, inside the app. Shows only while sample data is open. */
export function Walkthrough() {
  const { state, mutate } = useApp();
  const navigate = useNavigate();
  const { step: at, small } = useSyncExternalStore(subscribe, get, () => START);
  const [busy, setBusy] = useState(false);
  // On the assistant page the card sits above the message box, not over it.
  const lift = useLocation({ select: (l) => l.pathname.startsWith('/chat') }) ? 'bottom-[96px]' : 'bottom-5';
  const index = Math.min(at, STEPS.length - 1);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const demo = state?.demo === true;
  const finished = Boolean(state && step.done?.(state));

  if (!state || !demo) return null;
  const paypalOff = state.integrations.paypal === 'off';

  async function endDemo() {
    setBusy(true);
    const res = await mutate('/api/demo', { open: false });
    setBusy(false);
    if (!res.ok) return notify({ tone: 'bad', title: 'The demo could not be closed', body: 'Please try again.' });
    restartTour();
    notify({ tone: 'good', title: 'Demo ended', body: 'You are on your own data now. Connect PayPal, your bank or a statement to begin.' });
    void navigate({ to: '/connect' });
  }

  function go() {
    if (step.ask) void navigate({ to: '/chat', search: { q: step.ask } });
    else if (step.to) void navigate({ to: step.to });
  }

  if (small)
    return (
      <button onClick={openTour} className={`toast fixed ${lift} right-5 z-[60] flex items-center gap-2.5 py-2 pl-2 pr-4 text-[13px] font-medium`} style={{ borderRadius: 999 }}>
        <span className="num grid h-7 min-w-7 place-items-center rounded-full bg-accent px-1.5 text-[12px] font-semibold text-on">
          {index + 1}/{STEPS.length}
        </span>
        Walkthrough
      </button>
    );

  return (
    <>
      <Spotlight target={step.target} step={index} />
      <aside className={`toast fixed ${lift} right-5 z-[60] w-[min(380px,calc(100vw-40px))] overflow-hidden`} aria-label="Walkthrough">
        <div className="h-1 bg-white/[0.07]">
          <div className="h-full rounded-r-full bg-accent transition-[width] duration-500" style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
        </div>
        <div className="p-5">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <PayPalMark /> walkthrough
              <span className="num text-faint">
                {index + 1} of {STEPS.length}
              </span>
            </p>
            <button onClick={() => set({ small: true })} aria-label="Make the walkthrough small" title="Minimise" className="grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-white/[0.06] hover:text-ink">
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          </div>

          <div key={index} className="rise">
            <h2 className="mt-2.5 flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em]">
              {finished && (
                <span className="toast-icon grid h-5 w-5 shrink-0 place-items-center rounded-full bg-good text-on">
                  <Check size={12} strokeWidth={3} aria-hidden="true" />
                </span>
              )}
              {step.title}
            </h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{step.body}</p>
            {paypalOff && index >= 2 && index <= 4 && <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-[12px] text-warn">PayPal is not connected on this server yet, so this step can be read but not tried.</p>}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {index > 0 && (
              <button onClick={() => set({ step: index - 1 })} className="rounded-full border border-white/10 px-3.5 py-2 text-[13px] hover:border-white/25">
                Back
              </button>
            )}
            {step.go && !finished && (
              <button onClick={go} className="rounded-full border border-accent px-3.5 py-2 text-[13px] font-medium text-accent hover:bg-accent-soft">
                {step.go}
              </button>
            )}
            {last ? (
              <button onClick={endDemo} disabled={busy} className="ml-auto flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-on disabled:opacity-50">
                {busy ? 'Ending' : 'End demo, use my data'}
              </button>
            ) : (
              <button onClick={() => set({ step: index + 1 })} className="ml-auto flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-on">
                {index === 0 ? 'Start' : finished || !step.done ? 'Next' : 'Skip'} <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          {!last && (
            <button onClick={endDemo} disabled={busy} className="mt-3 flex items-center gap-1 text-[12px] text-faint hover:text-ink">
              <X size={12} aria-hidden="true" /> End the demo now
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

/** A soft pulsing ring around the thing the current step is about, kept in place as the page moves. */
function Spotlight({ target, step }: { target?: Step['target']; step: number }) {
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = target?.();
      const r = el?.getBoundingClientRect();
      setBox((was) => {
        if (!r || r.width === 0) return was === null ? was : null;
        const next = { top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 };
        return was && was.top === next.top && was.left === next.left && was.width === next.width && was.height === next.height ? was : next;
      });
    };
    const timer = setInterval(measure, 300);
    return () => clearInterval(timer);
  }, [target, step]);

  if (!box) return null;
  return <span className="tour-ring pointer-events-none fixed z-[55]" style={box} aria-hidden="true" />;
}
