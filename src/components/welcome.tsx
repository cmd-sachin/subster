// The top of the Command center. One number, one next step, and two quiet cards beside it.
//
// It is short on purpose: a person decides from a single clear figure faster than from a
// paragraph. The figure is yearly, because a monthly price is built to feel small. The bar is
// never empty, because a goal that looks under way gets finished. The next step is the one with
// the nearest deadline, because one easy action beats a list.

import { Link } from '@tanstack/react-router';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { diffDays, money, shortDate, today } from '@/domain/dates';
import { acceptsPayPal } from '@/domain/paypal-acceptance.gen';
import type { AppState, Insight } from '@/domain/types';
import { AppLogo } from './app-logo';
import { PayPalMark } from './paypal-mark';

const round = (n: number) => Math.round(n);

export function greeting(hour = new Date().getHours()) {
  return hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** One-line ideas about money that fit this user's data right now, most relevant first. */
function mindsetTips(state: AppState): { title: string; body: string }[] {
  const { portfolio } = state;
  const live = portfolio.insights.filter((i) => i.sub.status !== 'cancelled' && i.sub.status !== 'paused');
  const tips: { title: string; body: string }[] = [];

  const trial = live.find((i) => i.sub.status === 'trial' && i.sub.trialEndsAt);
  if (trial) {
    const days = diffDays(trial.sub.trialEndsAt!, today());
    tips.push({ title: 'Free trials count on you forgetting', body: `${trial.sub.name} starts charging ${days <= 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}.` });
  }
  if (portfolio.monthlySpend > 0) tips.push({ title: 'Think in years, not months', body: `Yours add up to ${money(round(portfolio.yearlySpend))} a year.` });
  const priciest = [...live].filter((i) => i.costPerHour !== null && i.hours30 > 0).sort((a, b) => (b.costPerHour ?? 0) - (a.costPerHour ?? 0))[0];
  if (priciest) tips.push({ title: 'Price per use tells the truth', body: `${priciest.sub.name} cost you ${money(priciest.costPerHour!)} an hour this month.` });
  const idle = live.find((i) => i.verdict === 'unused' || i.verdict === 'poor');
  if (idle) tips.push({ title: 'What you already paid is gone', body: `Only the next ${money(idle.sub.price)} for ${idle.sub.name} is still your choice.` });
  const soon = live.filter((i) => i.daysToRenewal >= 0 && i.daysToRenewal <= 7).length;
  if (soon > 0) tips.push({ title: 'Doing nothing is also a decision', body: `${soon} renew${soon === 1 ? 's' : ''} this week. Make it a choice.` });
  const loved = [...live].filter((i) => i.verdict === 'great').sort((a, b) => b.hours30 - a.hours30)[0];
  if (loved) tips.push({ title: 'Spend freely on what you love', body: `${loved.sub.name} got ${loved.hours30} hours from you this month.` });
  if (tips.length === 0) tips.push({ title: 'Small leaks are easy to miss', body: 'Subster adds them up so you decide once.' });
  return tips;
}

/** The recommended change that is easiest to say yes to: the nearest deadline, then the biggest saving. */
function quickWin(insights: Insight[]) {
  return insights
    .filter((i) => i.sub.status !== 'cancelled' && i.sub.status !== 'paused' && i.sub.policy !== 'locked' && ['cancel', 'pause', 'downgrade'].includes(i.recommendation.action) && i.recommendation.savingsMonthly > 0)
    .sort((a, b) => a.daysToRenewal - b.daysToRenewal || b.recommendation.savingsMonthly - a.recommendation.savingsMonthly)[0];
}

export function Welcome({ state }: { state: AppState }) {
  const [tipIndex, setTipIndex] = useState(() => new Date().getDate());
  const { portfolio } = state;
  const live = portfolio.insights.filter((i) => i.sub.status !== 'cancelled' && i.sub.status !== 'paused');
  const scored = live.filter((i) => i.valueScore !== null);
  const earning = scored.filter((i) => i.verdict === 'great' || i.verdict === 'fair').length;
  const changes = live.filter((i) => ['cancel', 'pause', 'downgrade'].includes(i.recommendation.action) && i.recommendation.savingsMonthly > 0).length;
  const possibleYear = round(portfolio.potentialSavingsMonthly * 12);
  const savedYear = round(state.actions.filter((a) => a.status === 'executed' && a.type !== 'subscribe').reduce((t, a) => t + a.savingsMonthly, 0) * 12);
  const goal = savedYear + possibleYear;
  const win = quickWin(portfolio.insights);
  const tips = mindsetTips(state);
  const tip = tips[tipIndex % tips.length];

  return (
    <section className="grid gap-4 lg:grid-cols-12" aria-label="Where you stand">
      <div className="brand-blue relative overflow-hidden rounded-[28px] p-7 text-on lg:col-span-8">
        <img src="/logo-mark.png" alt="" aria-hidden="true" className="pointer-events-none absolute -right-8 -top-10 h-52 w-52 rotate-6 opacity-[0.13]" />
        {possibleYear > 0 ? (
          <>
            <p className="text-[14px] font-medium text-on/80">You could keep</p>
            <p className="num mt-1 text-[56px] font-semibold leading-none tracking-[-0.035em]">{money(possibleYear)}</p>
            <p className="mt-2 text-[15px] text-on/85">
              a year, with {changes} small change{changes === 1 ? '' : 's'}
            </p>
          </>
        ) : (
          <>
            <p className="text-[14px] font-medium text-on/80">{scored.length > 0 ? 'You are all set' : 'Almost there'}</p>
            <p className="mt-1 max-w-md text-[34px] font-semibold leading-tight tracking-[-0.03em]">{scored.length > 0 ? `${earning} of ${scored.length} are earning their place` : 'Usage will tell us what is worth it'}</p>
          </>
        )}

        {goal > 0 && (
          <div className="mt-6 max-w-md">
            <div className="h-1.5 overflow-hidden rounded-full bg-on/20" role="img" aria-label={`${money(savedYear)} of ${money(goal)} a year saved`}>
              <div className="h-full rounded-full bg-sun transition-[width] duration-700" style={{ width: `${Math.max(6, Math.min(100, (savedYear / goal) * 100))}%` }} />
            </div>
            <p className="num mt-2 text-[13px] text-on/75">{savedYear === 0 ? 'Nothing claimed yet. The first one is the hardest.' : `${money(savedYear)} of ${money(goal)} claimed`}</p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {possibleYear > 0 && (
            <Link to="/savings" className="rounded-full bg-on px-5 py-2.5 text-[14px] font-semibold text-[#0035c5] transition-transform hover:scale-[1.02]">
              Review savings
            </Link>
          )}
          {win && (
            <Link to="/savings" className="flex min-w-0 items-center gap-2.5 rounded-full bg-black/20 py-1.5 pl-1.5 pr-4 text-[13px] font-medium transition-colors hover:bg-black/30">
              <AppLogo providerId={win.sub.providerId} category={win.sub.category} color={win.sub.color} size={28} />
              <span className="truncate">
                {win.recommendation.action === 'downgrade' ? 'Downgrade' : win.recommendation.action === 'pause' ? 'Pause' : 'Cancel'} {win.sub.name} before {shortDate(win.sub.trialEndsAt ?? win.sub.nextRenewal)}
              </span>
              <ArrowRight size={15} className="shrink-0 text-sun" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:col-span-4">
        <PayPalCard state={state} />
        <button onClick={() => setTipIndex((i) => i + 1)} className="panel group p-5 text-left transition-colors hover:bg-white/[0.03]" aria-label="Money mindset. Show another.">
          <p className="text-[12px] font-medium text-sun">Money mindset</p>
          <p className="mt-1.5 text-[16px] font-semibold leading-snug">{tip.title}</p>
          <p className="mt-1 text-[13px] text-muted">{tip.body}</p>
        </button>
      </div>
    </section>
  );
}

/**
 * PayPal's part, in the user's own numbers: how much of what they pay sits where one tap can
 * pause or cancel it, and what that has already saved them.
 */
function PayPalCard({ state }: { state: AppState }) {
  const live = state.portfolio.insights.filter((i) => i.sub.status !== 'cancelled');
  const managed = live.filter((i) => i.sub.paypalSubscriptionId);
  const viaPayPal = state.actions.filter((a) => a.status === 'executed' && a.channel === 'paypal_api');
  const saved = round(viaPayPal.filter((a) => a.type !== 'subscribe').reduce((t, a) => t + a.savingsMonthly, 0));
  const connected = state.integrations.paypal !== 'off';
  // Subscriptions paid another way whose provider is confirmed to take PayPal here.
  const movable = live.filter((i) => !i.sub.paypalSubscriptionId && acceptsPayPal(i.sub.providerId, state.settings.currency)).length;

  return (
    <Link to={connected ? '/services' : '/connect'} className="panel group flex flex-col justify-between p-5 transition-colors hover:bg-white/[0.03]">
      <div className="flex items-center justify-between">
        <span className="text-[16px]"><PayPalMark size={17} /></span>
        <span className="flex items-center gap-1.5 text-[12px] text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-good' : 'bg-faint'}`} aria-hidden="true" />
          {!connected ? 'Not connected' : state.integrations.paypal === 'live' ? 'Connected' : 'Test mode'}
        </span>
      </div>
      <div className="mt-4">
        {managed.length > 0 ? (
          <>
            <p className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
              <span className="num">{managed.length}</span> of <span className="num">{live.length}</span> on one-tap control
            </p>
            <p className="num mt-1 text-[13px] text-muted">{saved > 0 ? `${money(saved)} a month saved through PayPal` : movable > 0 ? `${movable} more accept PayPal` : 'Pause or cancel instantly, confirmed by PayPal'}</p>
          </>
        ) : (
          <>
            <p className="text-[18px] font-semibold leading-snug tracking-[-0.02em]">{movable > 0 ? `${movable} of yours accept PayPal` : 'Cancel in one tap, not ten screens'}</p>
            <p className="mt-1 text-[13px] text-muted">{movable > 0 ? 'Pay with PayPal to manage them from one account.' : 'Subscriptions started here with PayPal can be paused or cancelled in one tap.'}</p>
          </>
        )}
      </div>
      <span className="mt-4 flex items-center gap-1 text-[13px] font-medium text-accent">
        {connected ? 'Start one with PayPal' : 'Connect PayPal'} <ChevronRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}
