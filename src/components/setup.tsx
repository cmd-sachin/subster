// The setup path. Four steps, in the order that gets someone to value fastest: add what you
// already pay for, link the bank so charges are found automatically, connect PayPal so approved
// actions can actually run, and report usage so value can be scored. Shown in full on an empty
// account and as a slim progress row until every step is done.

import { Link } from '@tanstack/react-router';
import { Check, ChevronRight, Landmark, LayoutGrid, Smartphone, Wallet } from 'lucide-react';
import type { AppState } from '@/domain/types';

export function setupSteps(state: AppState) {
  const subscriptions = state.portfolio.insights.length;
  return [
    {
      key: 'subscriptions',
      icon: LayoutGrid,
      title: 'Add your subscriptions',
      body: 'Pick the services you pay for and enter what you pay. Ten seconds each.',
      unlocks: 'Spend, renewals and reminders',
      to: '/services' as const,
      cta: 'Add a subscription',
      done: subscriptions > 0,
      status: subscriptions > 0 ? `${subscriptions} tracked` : undefined,
    },
    {
      key: 'bank',
      icon: Landmark,
      title: 'Link your bank account',
      body: 'Read-only. New charges, price rises and forgotten subscriptions are found for you.',
      unlocks: 'Automatic detection',
      to: '/connect' as const,
      cta: 'Link a bank',
      done: Boolean(state.integrations.bank.link),
      status: state.integrations.bank.link?.institution,
    },
    {
      key: 'paypal',
      icon: Wallet,
      title: 'Connect PayPal',
      body: 'Lets the agent pause, cancel or start PayPal subscriptions once you approve.',
      unlocks: 'Actions, not just advice',
      to: '/connect' as const,
      cta: 'Connect PayPal',
      done: state.integrations.paypal !== 'off',
      status: state.integrations.paypal === 'off' ? undefined : state.integrations.paypal === 'live' ? 'Live' : 'Sandbox',
    },
    {
      key: 'usage',
      icon: Smartphone,
      title: 'Measure your usage',
      body: 'The browser extension and the Android companion report time per subscription, nothing else.',
      unlocks: 'Value scores and cancel advice',
      to: '/connect' as const,
      cta: 'Set up usage tracking',
      done: state.usage.length > 0,
      status: state.usage.length > 0 ? 'Reporting' : undefined,
    },
  ];
}

export function Setup({ state }: { state: AppState }) {
  const steps = setupSteps(state);
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find((s) => !s.done)!;

  // Once there is data, setup steps aside: one row, the next step, and progress.
  if (state.portfolio.insights.length > 0) {
    return (
      <section className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3" aria-label="Setup progress">
        <div className="flex items-center gap-2.5">
          <span className="eyebrow">Setup</span>
          <span className="flex gap-1" role="img" aria-label={`${done} of ${steps.length} steps done`}>
            {steps.map((s) => (
              <span key={s.key} className={`h-1.5 w-6 rounded-full ${s.done ? 'bg-accent' : 'bg-white/[0.12]'}`} />
            ))}
          </span>
          <span className="num text-[12px] text-muted">
            {done} of {steps.length}
          </span>
        </div>
        <p className="min-w-0 flex-1 truncate text-[13px] text-muted">
          <span className="font-medium text-ink">Next: {next.title.toLowerCase()}.</span> {next.body}
        </p>
        <Link to={next.to} className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[13px] font-medium hover:bg-white/[0.06]">
          {next.cta} <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Get set up">
      <header className="border-b border-[var(--hairline)] px-6 py-5">
        <h2 className="text-[18px] font-semibold tracking-[-0.01em]">Get set up</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
          Subster starts empty and only ever holds your own data. Start with the first step; each one after it makes the agent more useful.
        </p>
      </header>
      <ol className="grid divide-y divide-[var(--hairline)] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const current = step === next;
          return (
            <li key={step.key} className="flex flex-col p-5">
              <div className="flex items-center justify-between">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${step.done ? 'bg-accent text-on' : current ? 'bg-[var(--blue)] text-on' : 'bg-white/[0.06] text-muted'}`} aria-hidden="true">
                  {step.done ? <Check size={17} strokeWidth={2.5} /> : <Icon size={17} strokeWidth={1.75} />}
                </span>
                <span className="num text-[12px] text-faint">
                  {step.done ? (step.status ?? 'Done') : `Step ${index + 1}`}
                </span>
              </div>
              <h3 className="mt-4 text-[14px] font-semibold">{step.title}</h3>
              <p className="mt-1 flex-1 text-[13px] leading-relaxed text-muted">{step.body}</p>
              <p className="mt-3 text-[12px] text-faint">Unlocks: {step.unlocks}</p>
              {!step.done && (
                <Link
                  to={step.to}
                  className={`mt-3 w-fit rounded-lg px-3 py-1.5 text-[13px] font-semibold ${current ? 'bg-accent text-on hover:opacity-90' : 'border border-[var(--hairline)] font-medium hover:bg-white/[0.06]'}`}
                >
                  {step.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
