// The top of the Command center: a greeting, one honest sentence about where things stand, and
// three nudges. The nudges lean on well-known quirks in how people judge money, always in the
// user's favour and always with their own numbers:
//   - loss framing and a yearly figure, because a monthly price hides what a subscription costs;
//   - a visible, already-started progress bar, because people finish what looks under way;
//   - one small next step with a deadline, because a single easy action beats a long list.
// The "Money mindset" card says the quiet part out loud, one idea at a time.

import { Link } from '@tanstack/react-router';
import { ArrowRight, Lightbulb, RefreshCw, Sparkles, Target } from 'lucide-react';
import { useState } from 'react';
import { cycleShort, diffDays, money, shortDate, today } from '@/domain/dates';
import type { AppState, Insight } from '@/domain/types';
import { AppLogo } from './app-logo';

const round = (n: number) => Math.round(n);

export function greeting(hour = new Date().getHours()) {
  return hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** Ideas about money that apply to this user's data right now, most relevant first. */
function mindsetTips(state: AppState): { title: string; body: string }[] {
  const { portfolio } = state;
  const live = portfolio.insights.filter((i) => i.sub.status !== 'cancelled' && i.sub.status !== 'paused');
  const tips: { title: string; body: string }[] = [];

  const trial = live.find((i) => i.sub.status === 'trial' && i.sub.trialEndsAt);
  if (trial) {
    const days = diffDays(trial.sub.trialEndsAt!, today());
    tips.push({ title: 'Free trials count on you forgetting', body: `${trial.sub.name} starts charging ${money(trial.sub.price)} ${days <= 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}. Deciding now takes a minute. Deciding later usually means paying.` });
  }
  if (portfolio.monthlySpend > 0) {
    tips.push({ title: 'Think in years, not months', body: `A monthly price is built to feel small. Yours add up to ${money(round(portfolio.yearlySpend))} a year, which is the number worth judging.` });
  }
  const priciest = [...live].filter((i) => i.costPerHour !== null && i.hours30 > 0).sort((a, b) => (b.costPerHour ?? 0) - (a.costPerHour ?? 0))[0];
  if (priciest) {
    tips.push({ title: 'Price per use tells the truth', body: `${priciest.sub.name} cost you ${money(priciest.costPerHour!)} for each hour you used it this month. Would you pay that at the door?` });
  }
  const idle = live.find((i) => i.verdict === 'unused' || i.verdict === 'poor');
  if (idle) {
    tips.push({ title: 'What you already paid is gone either way', body: `Keeping ${idle.sub.name} to "get your money's worth" does not bring past payments back. Only the next ${money(idle.sub.price)} is still your choice.` });
  }
  const soon = live.filter((i) => i.daysToRenewal >= 0 && i.daysToRenewal <= 7).length;
  if (soon > 0) {
    tips.push({ title: 'Doing nothing is also a decision', body: `Auto-renewal works because the easy option is to do nothing. ${soon} of your subscriptions renew${soon === 1 ? 's' : ''} in the next 7 days. Make it a choice, not a default.` });
  }
  const loved = [...live].filter((i) => i.verdict === 'great').sort((a, b) => b.hours30 - a.hours30)[0];
  if (loved) {
    tips.push({ title: 'Spend freely on what you love', body: `${loved.sub.name} got ${loved.hours30} hours from you this month. Cutting what you ignore is what makes paying for this one guilt-free.` });
  }
  if (tips.length === 0) tips.push({ title: 'Small leaks are the easy ones to miss', body: 'Nobody notices one small monthly charge. Subster adds them up so you can see them as one number and decide once.' });
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
  const possibleYear = round(portfolio.potentialSavingsMonthly * 12);
  const savedYear = round(state.actions.filter((a) => a.status === 'executed' && a.type !== 'subscribe').reduce((t, a) => t + a.savingsMonthly, 0) * 12);
  const goal = savedYear + possibleYear;
  const win = quickWin(portfolio.insights);
  const tips = mindsetTips(state);
  const tip = tips[tipIndex % tips.length];

  const summary =
    possibleYear > 0
      ? `${money(possibleYear)} a year is going to things you barely use. ${win ? 'One small change gets you started.' : ''}`
      : scored.length > 0
        ? `Nicely done: ${earning} of ${scored.length} measured subscription${scored.length === 1 ? ' is' : 's are'} earning ${scored.length === 1 ? 'its' : 'their'} place, and there is nothing to cut right now.`
        : 'Your subscriptions are tracked. Once your browser or phone reports some usage, I can tell you which ones are worth it.';

  return (
    <section className="grid gap-4 lg:grid-cols-12" aria-label="Where you stand">
      <div className="brand-blue relative overflow-hidden rounded-[22px] p-5 text-white lg:col-span-7">
        <img src="/logo-mark.png" alt="" aria-hidden="true" className="pointer-events-none absolute -right-6 -top-8 h-44 w-44 rotate-6 opacity-[0.16]" />
        <p className="max-w-xl text-[17px] font-semibold leading-snug tracking-[-0.01em]">{summary}</p>

        {goal > 0 && (
          <div className="mt-5 max-w-lg">
            <div className="flex items-baseline justify-between text-[12px] font-medium text-white/80">
              <span className="flex items-center gap-1.5">
                <Target size={13} aria-hidden="true" /> Savings claimed
              </span>
              <span className="num">
                {money(savedYear)} of {money(goal)} a year
              </span>
            </div>
            {/* The bar never starts empty: a goal that looks under way is one people finish. */}
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/20" role="img" aria-label={`${money(savedYear)} of ${money(goal)} a year claimed`}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(6, Math.min(100, (savedYear / goal) * 100))}%` }} />
            </div>
            <p className="mt-1.5 text-[12px] text-white/70">{savedYear === 0 ? 'The first one is the hardest. After that it is a habit.' : possibleYear === 0 ? 'All claimed. That money stays with you every year.' : `${money(possibleYear)} a year still on the table.`}</p>
          </div>
        )}

        {win && (
          <Link to="/savings" className="mt-5 flex max-w-lg items-center gap-3 rounded-2xl bg-black/25 p-3 transition-colors hover:bg-black/35">
            <AppLogo providerId={win.sub.providerId} category={win.sub.category} color={win.sub.color} size={36} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
                <Sparkles size={12} aria-hidden="true" /> Quick win, about two minutes
              </span>
              <span className="block truncate text-[14px] font-semibold">
                {win.recommendation.action === 'downgrade' ? 'Downgrade' : win.recommendation.action === 'pause' ? 'Pause' : 'Cancel'} {win.sub.name} before {shortDate(win.sub.trialEndsAt ?? win.sub.nextRenewal)}
              </span>
              <span className="num block text-[12px] text-white/75">
                Keeps {money(round(win.recommendation.savingsMonthly * 12))} a year with you, instead of {money(win.sub.price)}/{cycleShort(win.sub.cycle)} leaving
              </span>
            </span>
            <ArrowRight size={18} className="shrink-0 text-accent" aria-hidden="true" />
          </Link>
        )}
      </div>

      <aside className="panel flex flex-col p-5 lg:col-span-5" aria-label="Money mindset">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
          <Lightbulb size={14} aria-hidden="true" /> Money mindset
        </p>
        <h2 className="mt-2 text-[16px] font-semibold leading-snug">{tip.title}</h2>
        <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-muted">{tip.body}</p>
        {tips.length > 1 && (
          <button onClick={() => setTipIndex((i) => i + 1)} className="mt-3 flex items-center gap-1.5 self-start rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] font-medium text-muted hover:bg-white/[0.06] hover:text-ink">
            <RefreshCw size={12} aria-hidden="true" /> Another one
          </button>
        )}
      </aside>
    </section>
  );
}
