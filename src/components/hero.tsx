
// The top of the command center: what you pay, drawn over twelve weeks of how much you use it,
// next to the charges that are about to land.

import { currentCurrency, money, shortDate } from '@/domain/dates';
import type { Insight, Portfolio } from '@/domain/types';
import { AppLogo } from './app-logo';


const W = 640;
const H = 150;

/** Smooth curve through the points (Catmull-Rom converted to cubic Beziers). */
function curve(values: number[], max: number) {
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 12 - (v / max) * (H - 30)] as const);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6}, ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6}, ${p2[0]} ${p2[1]}`;
  }
  return { d, end: pts.at(-1)! };
}

const weeklySum = (insights: Insight[]) => insights[0]?.weekly.map((_, w) => insights.reduce((t, i) => t + i.weekly[w].hours, 0)) ?? [];

export function Hero({ portfolio: p }: { portfolio: Portfolio }) {
  const earning = p.insights.filter((i) => i.verdict === 'great' || i.verdict === 'fair');
  const idle = p.insights.filter((i) => i.verdict === 'poor' || i.verdict === 'unused');
  const a = weeklySum(earning);
  const b = weeklySum(idle);
  const max = Math.max(...a, ...b, 1);
  const good = a.length > 1 ? curve(a, max) : null;
  const low = b.length > 1 ? curve(b, max) : null;
  const lowShare = p.monthlySpend ? Math.round((p.wastedMonthly / p.monthlySpend) * 100) : 0;
  // Split the formatted amount so the symbol and decimals can be set smaller than the figure.
  const parts = new Intl.NumberFormat(currentCurrency() === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: currentCurrency(), minimumFractionDigits: 2 }).formatToParts(p.monthlySpend);
  const symbol = parts.find((x) => x.type === 'currency')?.value ?? '';
  const whole = parts.filter((x) => x.type === 'integer' || x.type === 'group').map((x) => x.value).join('');
  const cents = parts.find((x) => x.type === 'fraction')?.value ?? '00';

  return (
    <section className="panel grid overflow-hidden lg:grid-cols-[1.15fr_1fr]" aria-label="Overview">
      <div className="relative min-h-[300px] min-w-0 px-6 pb-5 pt-6">
        <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-faint">Monthly subscriptions</p>
        <p className="num mt-2 flex items-start text-[52px] font-semibold leading-none tracking-tight">
          <span className="mr-1 mt-1.5 text-[22px] font-medium text-muted">{symbol}</span>
          {whole}
          <span className="mt-1.5 text-[22px] font-medium text-muted">.{cents}</span>
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
          <div className="flex gap-1.5">
            <dt className="text-muted">Could save</dt>
            <dd className="num font-medium text-good">{money(p.potentialSavingsMonthly)}/mo</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted">Low value</dt>
            <dd className="num font-medium text-bad">
              {money(p.wastedMonthly)} ({lowShare}%)
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted">Per year</dt>
            <dd className="num font-medium">{money(Math.round(p.yearlySpend))}</dd>
          </div>
        </dl>

        {good && low && (
          <figure className="mt-4">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-[150px] w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label="Weekly hours of use over the last twelve weeks: subscriptions that earn their place against low-value ones">
              <path d={low.d} fill="none" stroke="var(--info)" strokeWidth="2" pathLength={1} className="draw" vectorEffect="non-scaling-stroke" opacity="0.9" />
              <path d={good.d} fill="none" stroke="var(--accent)" strokeWidth="2" pathLength={1} className="draw" vectorEffect="non-scaling-stroke" />
            </svg>
            <figcaption className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full border-2 border-accent" aria-hidden="true" />
                Hours on subscriptions that earn their place <span className="num text-ink">{a.at(-1)?.toFixed(0)}h this week</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full border-2 border-info" aria-hidden="true" />
                Hours on low-value ones <span className="num text-ink">{b.at(-1)?.toFixed(1)}h</span>
              </span>
              <span className="ml-auto text-faint">12 weeks</span>
            </figcaption>
          </figure>
        )}
      </div>

      <div className="min-w-0 border-t border-white/[0.06] px-6 pb-5 pt-6 lg:border-l lg:border-t-0">
        <div className="flex items-baseline justify-between">
          <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-faint">Charging next</p>
          <p className="num text-[13px] text-muted">
            <span className="text-ink">{money(p.next30Total)}</span> in 30 days
          </p>
        </div>
        {p.upcoming.length === 0 ? (
          <p className="mt-6 text-[13px] text-muted">No charges scheduled in the next 30 days.</p>
        ) : (
          <ul className="-mx-1 mt-4 flex snap-x gap-3 overflow-x-auto px-1 pb-3">
            {p.upcoming.map((u) => {
              const insight = p.insights.find((i) => i.sub.id === u.subId)!;
              const risky = insight.verdict === 'poor' || insight.verdict === 'unused';
              return (
                <li
                  key={u.subId}
                  className="relative flex h-[188px] w-[150px] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-2xl p-3.5"
                  style={{ background: `linear-gradient(155deg, color-mix(in oklab, ${insight.sub.color} 78%, #fff 0%) 0%, color-mix(in oklab, ${insight.sub.color} 55%, #0a0d14) 100%)` }}
                >
                  <span className="absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(255,255,255,0.22),transparent_60%)]" aria-hidden="true" />
                  <div className="relative flex items-start justify-between">
                    <AppLogo providerId={insight.sub.providerId} category={insight.sub.category} color={insight.sub.color} size={34} />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-white/80">{insight.sub.rail === 'paypal' ? 'PayPal' : 'Card'}</span>
                  </div>
                  <div className="relative">
                    <p className="text-[12px] text-white/75">{u.kind === 'trial_conversion' ? 'Trial converts' : 'Renews'}</p>
                    <p className="num text-[20px] font-semibold leading-tight">{money(u.amount)}</p>
                    <p className="mt-1.5 truncate text-[13px] font-medium">{u.name}</p>
                    <p className="num mt-0.5 flex items-center justify-between text-[11px] text-white/75">
                      {shortDate(u.date)}
                      {risky && <span className="rounded-full bg-black/35 px-1.5 py-0.5 font-medium text-white">{insight.verdict === 'unused' ? 'Unused' : 'Low use'}</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-1 text-[12px] text-faint">Usage is phone screen time from the Android companion. Without it, value shows as not measured.</p>
      </div>
    </section>
  );
}
