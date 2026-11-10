// The top of the command center: the four figures that matter, the usage trend, what charges
// next, and where the money goes by category.

import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { CATEGORY_LABEL } from '@/domain/catalog';
import { money, shortDate } from '@/domain/dates';
import type { Category, Insight, Portfolio } from '@/domain/types';
import { AppLogo } from './app-logo';

const live = (i: Insight) => i.sub.status !== 'cancelled' && i.sub.status !== 'paused';

// ---- Metric strip ----------------------------------------------------------------------------

export function MetricStrip({ portfolio: p }: { portfolio: Portfolio }) {
  const active = p.insights.filter(live);
  const measured = active.filter((i) => i.valueScore !== null).length;
  const scorable = active.filter((i) => i.verdict !== 'essential').length;
  const next = p.upcoming[0];
  const lowShare = p.monthlySpend ? Math.round((p.wastedMonthly / p.monthlySpend) * 100) : 0;

  const metrics = [
    { label: 'Monthly spend', value: money(p.monthlySpend), note: `${money(Math.round(p.yearlySpend))} a year across ${p.activeCount} subscriptions` },
    {
      label: 'You could save',
      value: money(p.potentialSavingsMonthly),
      suffix: '/mo',
      tone: p.potentialSavingsMonthly > 0 ? 'text-accent' : '',
      note: p.wastedMonthly > 0 ? `${money(p.wastedMonthly)} (${lowShare}%) goes to low-value subscriptions` : 'Nothing flagged as low value',
    },
    { label: 'Charging in 30 days', value: money(p.next30Total), note: next ? `Next: ${next.name}, ${shortDate(next.date)}` : 'Nothing scheduled' },
    {
      label: 'Usage measured',
      value: `${measured}`,
      suffix: ` of ${scorable}`,
      note: measured === scorable ? 'Every scorable subscription has usage data' : 'Install the Android companion to measure the rest',
    },
  ];

  return (
    <dl className="panel grid divide-y divide-[var(--hairline)] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4 [&>div:nth-child(n+3)]:max-xl:border-t [&>div:nth-child(n+3)]:max-xl:border-[var(--hairline)]">
      {metrics.map((m) => (
        <div key={m.label} className="px-5 py-4">
          <dt className="eyebrow">{m.label}</dt>
          <dd className={`num mt-2 text-[28px] font-semibold leading-none tracking-[-0.02em] ${m.tone ?? ''}`}>
            {m.value}
            {m.suffix && <span className="text-[15px] font-medium text-faint">{m.suffix}</span>}
          </dd>
          <dd className="mt-2 truncate text-[12px] text-muted">{m.note}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---- Usage trend -----------------------------------------------------------------------------

const W = 760;
const H = 230;
const PAD = { top: 14, right: 16, bottom: 26, left: 34 };

function path(values: number[], max: number) {
  const x = (i: number) => PAD.left + (i / (values.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  // Monotone-ish smoothing: horizontal control points keep the curve from overshooting the data.
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const mid = (pts[i][0] + pts[i + 1][0]) / 2;
    d += ` C ${mid} ${pts[i][1]}, ${mid} ${pts[i + 1][1]}, ${pts[i + 1][0]} ${pts[i + 1][1]}`;
  }
  return { d, pts, area: `${d} L ${pts.at(-1)![0]} ${H - PAD.bottom} L ${pts[0][0]} ${H - PAD.bottom} Z` };
}

const niceMax = (v: number) => {
  if (v <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / (step / 2)) * (step / 2);
};

export function UsageTrend({ portfolio: p }: { portfolio: Portfolio }) {
  const active = p.insights.filter(live);
  const weeks = active[0]?.weekly.map((w) => w.weekStart) ?? [];
  const sum = (items: Insight[]) => weeks.map((_, w) => items.reduce((t, i) => t + i.weekly[w].hours, 0));
  const earning = sum(active.filter((i) => i.verdict === 'great' || i.verdict === 'fair'));
  const idle = sum(active.filter((i) => i.verdict === 'poor' || i.verdict === 'unused'));
  const hasData = [...earning, ...idle].some((v) => v > 0);
  const max = niceMax(Math.max(...earning, ...idle, 1));
  const ticks = [0, max / 2, max];

  return (
    <section className="panel" aria-label="Usage trend">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline)] px-5 py-3.5">
        <div>
          <h2 className="text-[14px] font-semibold">Usage, last 12 weeks</h2>
          <p className="text-[12px] text-muted">Hours per week on your phone, split by whether the subscription earns its cost.</p>
        </div>
        <ul className="flex gap-4 text-[12px] text-muted">
          <li className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-accent" aria-hidden="true" /> Earning their place
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[var(--info)]" aria-hidden="true" /> Low value
          </li>
        </ul>
      </header>
      {!hasData || weeks.length < 2 ? (
        <p className="px-5 py-10 text-center text-[13px] text-muted">No usage reported yet. Once the Android companion syncs, the trend appears here.</p>
      ) : (
        <div className="px-3 pb-2 pt-3">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Weekly hours of use. This week: ${earning.at(-1)?.toFixed(1)} hours on subscriptions that earn their place, ${idle.at(-1)?.toFixed(1)} on low-value ones.`}>
            <defs>
              <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--lime)" stopOpacity="0.22" />
                <stop offset="1" stopColor="var(--lime)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => {
              const y = PAD.top + (1 - t / max) * (H - PAD.top - PAD.bottom);
              return (
                <g key={t}>
                  <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--hairline)" strokeDasharray={t === 0 ? undefined : '3 5'} />
                  <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--faint)" className="num">
                    {t}h
                  </text>
                </g>
              );
            })}
            {weeks.map((week, i) =>
              i % 3 === 2 || i === weeks.length - 1 ? (
                <text key={week} x={PAD.left + (i / (weeks.length - 1)) * (W - PAD.left - PAD.right)} y={H - 6} textAnchor={i === weeks.length - 1 ? 'end' : 'middle'} fontSize="11" fill="var(--faint)">
                  {i === weeks.length - 1 ? 'This week' : shortDate(week)}
                </text>
              ) : null,
            )}
            {(() => {
              const a = path(earning, max);
              const b = path(idle, max);
              return (
                <>
                  <path d={a.area} fill="url(#trend-fill)" />
                  <path d={b.d} fill="none" stroke="var(--info)" strokeWidth="1.75" pathLength={1} className="draw" />
                  <path d={a.d} fill="none" stroke="var(--lime)" strokeWidth="2" pathLength={1} className="draw" />
                  <circle cx={b.pts.at(-1)![0]} cy={b.pts.at(-1)![1]} r="3.5" fill="var(--canvas)" stroke="var(--info)" strokeWidth="1.75" />
                  <circle cx={a.pts.at(-1)![0]} cy={a.pts.at(-1)![1]} r="3.5" fill="var(--canvas)" stroke="var(--lime)" strokeWidth="2" />
                </>
              );
            })()}
          </svg>
        </div>
      )}
    </section>
  );
}

// ---- Upcoming charges ------------------------------------------------------------------------

export function Upcoming({ portfolio: p }: { portfolio: Portfolio }) {
  const rows = p.upcoming.slice(0, 6);
  return (
    <section className="panel" aria-label="Upcoming charges">
      <header className="flex items-center justify-between border-b border-[var(--hairline)] px-5 py-3.5">
        <h2 className="text-[14px] font-semibold">Charging next</h2>
        <Link to="/timeline" className="flex items-center gap-1 text-[12px] text-muted hover:text-ink">
          Timeline <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      </header>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-[13px] text-muted">No charges in the next 30 days.</p>
      ) : (
        <ul className="divide-y divide-[var(--hairline)]">
          {rows.map((u) => {
            const insight = p.insights.find((i) => i.sub.id === u.subId)!;
            const risky = insight.verdict === 'poor' || insight.verdict === 'unused';
            return (
              <li key={u.subId} className="flex items-center gap-3 px-5 py-2.5">
                <AppLogo providerId={insight.sub.providerId} category={insight.sub.category} color={insight.sub.color} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{u.name}</span>
                  <span className="block text-[12px] text-muted">
                    {shortDate(u.date)} · in {insight.daysToRenewal}d{u.kind === 'trial_conversion' ? ' · trial converts' : ''}
                  </span>
                </span>
                {risky && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">{insight.verdict === 'unused' ? 'Unused' : 'Low use'}</span>}
                <span className="num text-[13px] font-medium">{money(u.amount)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---- Categories ------------------------------------------------------------------------------

// Steps from the palette's lime through its blue, so segments stay distinguishable without new hues.
const SEGMENTS = ['#d4ff24', '#1558c9', '#7aa7f7', '#9fbf1c', '#0f3f94', '#c9d1dc', '#4d7fe0', '#6b8a12', '#5d6b82', '#2a3550'];

export function CategoryBar({ portfolio: p }: { portfolio: Portfolio }) {
  const totals = new Map<Category, { spend: number; count: number }>();
  for (const i of p.insights.filter(live)) {
    const entry = totals.get(i.sub.category) ?? { spend: 0, count: 0 };
    totals.set(i.sub.category, { spend: entry.spend + i.monthlyCost, count: entry.count + 1 });
  }
  const rows = [...totals.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.spend - a.spend);
  const total = rows.reduce((t, r) => t + r.spend, 0);
  if (rows.length === 0 || total === 0) return null;

  return (
    <section className="panel px-5 py-4" aria-label="Spend by category">
      <h2 className="text-[14px] font-semibold">By category</h2>
      <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={rows.map((r) => `${CATEGORY_LABEL[r.category]} ${Math.round((r.spend / total) * 100)}%`).join(', ')}>
        {rows.map((r, i) => (
          <span key={r.category} style={{ width: `${(r.spend / total) * 100}%`, background: SEGMENTS[i % SEGMENTS.length] }} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {rows.map((r, i) => (
          <li key={r.category} className="flex items-center gap-2.5 text-[13px]">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: SEGMENTS[i % SEGMENTS.length] }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {CATEGORY_LABEL[r.category]} <span className="num text-faint">{r.count}</span>
            </span>
            <span className="num text-muted">{Math.round((r.spend / total) * 100)}%</span>
            <span className="num w-20 text-right font-medium">{money(Math.round(r.spend * 100) / 100)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
