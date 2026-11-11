
import { ChevronDown, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { cycleShort, money, shortDate } from '@/domain/dates';
import { CATEGORIES, CATEGORY_LABEL } from '@/domain/catalog';
import type { Category, Coverage, Insight, Policy, Verdict } from '@/domain/types';
import { useApp } from './app-state';
import { AppLogo } from './app-logo';

const VERDICT: Record<Verdict, { label: string; tone: string; bar: string }> = {
  great: { label: 'Good value', tone: 'bg-accent-soft text-good', bar: 'var(--good)' },
  fair: { label: 'Fair', tone: 'bg-info-soft text-info', bar: 'var(--info)' },
  poor: { label: 'Low value', tone: 'bg-warn-soft text-warn', bar: 'var(--warn)' },
  unused: { label: 'Unused', tone: 'bg-bad-soft text-bad', bar: 'var(--bad)' },
  unmeasured: { label: 'Not measured', tone: 'bg-white/[0.06] text-muted', bar: 'var(--faint)' },
  essential: { label: 'Essential', tone: 'bg-white/[0.06] text-muted', bar: 'var(--faint)' },
};

const POLICY_LABEL: Record<Policy, string> = { ask: 'Ask me first', auto: 'Auto-pause if unused', locked: 'Never touch' };
const COVERAGE_LABEL: Record<Coverage, string> = { phone: 'Phone only', web: 'Browser only', 'phone+web': 'Phone + browser', 'phone+tv': 'Everywhere, TV included', none: 'No usage data' };

export function SubscriptionTable() {
  const { state, mutate } = useApp();
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!state) return null;

  // Worst value first: that is where the money is.
  const rows = [...state.portfolio.insights].sort((a, b) => rank(a) - rank(b));

  return (
    <section className="panel" aria-label="Subscriptions">
      <header className="flex items-baseline justify-between border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-[14px] font-semibold">Subscriptions</h2>
        <span className="text-[12px] text-muted">Cost against the last 30 days of use, worst value first</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-[13px]">
          <thead>
            <tr className="whitespace-nowrap text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2 font-medium">Subscription</th>
              <th className="px-2 py-2 text-right font-medium">Cost</th>
              <th className="px-2 py-2 text-right font-medium">Used</th>
              <th className="px-2 py-2 font-medium">12 weeks</th>
              <th className="px-2 py-2 text-right font-medium">Per hour</th>
              <th className="px-2 py-2 font-medium">Value</th>
              <th className="px-4 py-2 font-medium">Renews</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const v = VERDICT[i.verdict];
              const inactive = i.sub.status === 'cancelled' || i.sub.status === 'paused';
              const isOpen = expanded === i.sub.id;
              return (
                <Row key={i.sub.id}>
                  <tr className={`border-t border-white/[0.06] ${inactive ? 'opacity-55' : ''}`}>
                    <td className="px-4 py-2.5">
                      <button onClick={() => setExpanded(isOpen ? null : i.sub.id)} aria-expanded={isOpen} className="flex items-center gap-2.5 text-left">
                        <AppLogo providerId={i.sub.providerId} category={i.sub.category} color={i.sub.color} size={36} />
                        <span>
                          <span className="block font-medium">
                            {i.sub.name}
                            {i.sub.status !== 'active' && <span className="ml-1.5 rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-normal text-muted">{i.sub.status.replace('_', ' ')}</span>}
                          </span>
                          <span className="block whitespace-nowrap text-[12px] text-faint">
                            {CATEGORY_LABEL[i.sub.category]} · {i.sub.rail === 'paypal' ? 'PayPal' : i.sub.rail === 'bank' ? 'Bank' : 'Card'}
                          </span>
                        </span>
                        <ChevronDown size={14} className={`text-faint transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </button>
                    </td>
                    <td className="num px-2 py-2.5 text-right">
                      {money(i.sub.price)}
                      <span className="text-faint">/{cycleShort(i.sub.cycle)}</span>
                    </td>
                    <td className="num px-2 py-2.5 text-right">
                      {i.verdict === 'unmeasured' || i.verdict === 'essential' ? <span className="text-faint">n/a</span> : `${i.hours30}h`}
                      {i.trendPct !== null && Math.abs(i.trendPct) >= 20 && (
                        <span className={`ml-1.5 inline-flex items-center gap-0.5 text-[11px] ${i.trendPct < 0 ? 'text-bad' : 'text-good'}`}>
                          {i.trendPct < 0 ? <TrendingDown size={12} aria-label="down" /> : <TrendingUp size={12} aria-label="up" />}
                          {Math.abs(i.trendPct)}%
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <Spark values={i.weekly.map((w) => w.hours)} color={v.bar} label={`${i.sub.name} weekly hours`} />
                    </td>
                    <td className="num px-2 py-2.5 text-right">{i.costPerHour !== null ? money(i.costPerHour) : <span className="text-faint">n/a</span>}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${v.tone}`}>{v.label}</span>
                        {i.valueScore !== null && (
                          <span className="flex items-center gap-1.5" title={`Value score ${i.valueScore} of 100`}>
                            <span className="block h-1.5 w-12 overflow-hidden rounded-full bg-white/[0.06]">
                              <span className="block h-full rounded-full" style={{ width: `${i.valueScore}%`, background: v.bar }} />
                            </span>
                            <span className="num text-[11px] text-muted">{i.valueScore}</span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="num whitespace-nowrap px-4 py-2.5 text-muted">{inactive ? 'n/a' : `${shortDate(i.sub.nextRenewal)} · ${i.daysToRenewal}d`}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-white/[0.025]">
                      <td colSpan={7} className="px-4 pb-4 pt-1">
                        <Detail insight={i} onChange={(body) => mutate(`/api/subscriptions/${i.sub.id}`, body, 'PATCH')} />
                      </td>
                    </tr>
                  )}
                </Row>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// A row plus its optional detail row.
const Row = ({ children }: { children: React.ReactNode }) => <>{children}</>;

const rank = (i: Insight) => {
  if (i.sub.status === 'cancelled') return 300;
  if (i.sub.status === 'paused') return 200;
  if (i.verdict === 'unmeasured' || i.verdict === 'essential') return 150;
  return i.valueScore ?? 0;
};

function Detail({ insight: i, onChange }: { insight: Insight; onChange: (body: { policy?: Policy; coverage?: Coverage; resume?: boolean; category?: Category }) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
      <div className="space-y-2">
        {i.issues.length > 0 ? (
          <ul className="space-y-1">
            {i.issues.map((issue) => (
              <li key={issue.type} className="flex items-start gap-2 text-[13px]">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${issue.severity === 'critical' ? 'bg-bad' : issue.severity === 'warn' ? 'bg-warn' : 'bg-info'}`}
                  aria-hidden="true"
                />
                {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No issues detected.</p>
        )}
        <p className="text-[13px]">
          <span className="font-medium capitalize">{i.recommendation.action.replace('_', ' ')}:</span> {i.recommendation.reason}{' '}
          <span className="text-faint">({i.recommendation.confidence} confidence)</span>
        </p>
        {i.sub.category === 'Streaming' && i.sub.coverage !== 'phone+tv' && i.sub.coverage !== 'none' && (
          <p className="text-[12px] text-muted">Usage here is measured on your phone and browser only. If you watch on a TV, say so on the right and the agent will stop treating this as low use.</p>
        )}
        {i.sub.status === 'paused' && (
          <button onClick={() => onChange({ resume: true })} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[13px] hover:bg-white/[0.07]">
            Resume subscription
          </button>
        )}
      </div>
      <div className="space-y-3">
        <Choice label="What the agent may do" value={i.sub.policy} options={POLICY_LABEL} onChange={(policy) => onChange({ policy })} />
        <Choice label="Where usage is measured" value={i.sub.coverage} options={COVERAGE_LABEL} onChange={(coverage) => onChange({ coverage })} />
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-faint">
            Category <span className="normal-case tracking-normal">(decided by {{ catalog: "the app catalog", rules: "keyword rules", ai: "Gemini", user: "you" }[i.sub.classifiedBy]})</span>
          </span>
          <select value={i.sub.category} onChange={(e) => onChange({ category: e.target.value as Category })} className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[12px]">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {(Object.keys(options) as T[]).map((key) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            aria-pressed={value === key}
            className={`rounded-md border px-2 py-1 text-[12px] ${value === key ? 'border-accent bg-accent-soft text-accent' : 'border-white/10 bg-white/[0.04] text-muted hover:text-ink'}`}
          >
            {options[key]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Spark({ values, color, label }: { values: number[]; color: string; label: string }) {
  const max = Math.max(...values, 1);
  const w = 6;
  return (
    <svg width={values.length * w} height="22" role="img" aria-label={label}>
      {values.map((v, i) => {
        const h = Math.max(1.5, (v / max) * 20);
        return <rect key={i} x={i * w} y={22 - h} width={w - 2} height={h} rx="1" fill={v > 0 ? color : 'var(--line)'} />;
      })}
    </svg>
  );
}
