import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { AppLogo } from '@/components/app-logo';
import { useApp } from '@/components/app-state';
import { catalogPlans, providerById } from '@/domain/catalog';
import { cycleShort, money, shortDate } from '@/domain/dates';
import type { AppState, Insight, LivePlan } from '@/domain/types';

export const Route = createFileRoute('/savings')({ component: Savings });

type Move = 'cancel' | 'pause' | 'downgrade';
const VERB: Record<Move, string> = { cancel: 'Cancel', pause: 'Pause', downgrade: 'Downgrade' };
const round = (n: number) => Math.round(n * 100) / 100;

interface AnnualSwitch {
  insight: Insight;
  plan: LivePlan;
  yearlySaving: number;
  official: boolean;
}

/** Subscriptions paid monthly whose provider sells the same plan for less by the year. */
function annualSwitches(state: AppState, skip: Set<string>): AnnualSwitch[] {
  const found: AnnualSwitch[] = [];
  for (const insight of state.portfolio.insights) {
    const { sub } = insight;
    const provider = providerById(sub.providerId ?? '');
    if (!provider || sub.cycle !== 'monthly' || sub.status !== 'active' || skip.has(sub.id)) continue;
    const live = state.livePlans[provider.id];
    const official = live?.status === 'ok' && live.plans.length > 0;
    const firstWord = sub.plan.toLowerCase().split(/\s+/)[0];
    const plan = (official ? live.plans : catalogPlans(provider, state.settings.currency))
      // Same currency and the same tier: a yearly price for a different tier is not a like-for-like saving.
      .filter((p) => p.cycle === 'yearly' && p.currency === state.settings.currency && p.name.toLowerCase().split(/\s+/)[0] === firstWord)
      .sort((a, b) => a.price - b.price)[0];
    const yearlySaving = plan ? round(sub.price * 12 - plan.price) : 0;
    if (plan && yearlySaving > 0) found.push({ insight, plan, yearlySaving, official });
  }
  return found.sort((a, b) => b.yearlySaving - a.yearlySaving);
}

function Savings() {
  const { state, mutate } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  if (!state) return <p className="p-8 text-muted">Loading savings</p>;

  const { portfolio } = state;
  const live = portfolio.insights.filter((i) => i.sub.status !== 'cancelled' && i.sub.status !== 'paused');
  const moves = live
    .filter((i): i is Insight & { recommendation: { action: Move } } => ['cancel', 'pause', 'downgrade'].includes(i.recommendation.action) && i.recommendation.savingsMonthly > 0)
    .sort((a, b) => b.recommendation.savingsMonthly - a.recommendation.savingsMonthly);
  const annual = annualSwitches(state, new Set(moves.map((i) => i.sub.id)));
  const unmeasured = live.filter((i) => i.verdict === 'unmeasured');
  const failing = live.filter((i) => i.recommendation.action === 'retry_payment');

  const possible = round(moves.reduce((t, i) => t + i.recommendation.savingsMonthly, 0));
  const annualTotal = round(annual.reduce((t, a) => t + a.yearlySaving, 0));
  // What approved changes are already saving: cancels, pauses and downgrades that went through.
  const done = state.actions.filter((a) => a.status === 'executed' && a.savingsMonthly > 0 && a.type !== 'subscribe');
  const saved = round(done.reduce((t, a) => t + a.savingsMonthly, 0));
  const share = portfolio.monthlySpend > 0 ? Math.round((possible / portfolio.monthlySpend) * 100) : 0;

  const pendingFor = (subId: string) => state.actions.find((a) => a.subId === subId && (a.status === 'pending' || a.status === 'guided'));

  async function act(insight: Insight, action: Move) {
    setBusy(insight.sub.id);
    setNotice(null);
    const res = await mutate('/api/transactions', { intent: 'act', subId: insight.sub.id, action });
    const next = (res.data as AppState | undefined)?.actions?.find((a) => a.subId === insight.sub.id);
    setNotice(
      res.ok
        ? { ok: true, text: next?.status === 'executed' ? `${VERB[action]} done for ${insight.sub.name}, verified with PayPal.` : next?.status === 'failed' ? `${insight.sub.name}: ${next.steps.at(-1)?.detail ?? 'the change failed'}. Nothing was changed.` : `${insight.sub.name}: one step is left for you on its own site. Use the link on its row.` }
        : { ok: false, text: res.error ?? 'Something went wrong' },
    );
    setBusy(null);
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 px-4 py-6 md:px-8">
      <header>
        <p className="eyebrow">Recommendations</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">Savings</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">Every suggestion comes from your own payments and measured use. Nothing changes until you choose it.</p>
      </header>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="You could save" value={`${money(possible)}`} detail={`a month, ${money(round(possible * 12))} a year`} accent={possible > 0} />
        <Tile label="Share of your spend" value={`${share}%`} detail={`of ${money(portfolio.monthlySpend)} a month`} />
        <Tile label="By paying yearly" value={money(annualTotal)} detail={annual.length ? `a year, across ${annual.length} subscription${annual.length === 1 ? '' : 's'}` : 'no yearly offers found'} />
        <Tile label="Already saved" value={money(saved)} detail={done.length ? `a month, from ${done.length} change${done.length === 1 ? '' : 's'}` : 'no changes made yet'} />
      </dl>

      {notice && (
        <p role="status" className={`rise rounded-xl px-4 py-3 text-[13px] ${notice.ok ? 'bg-accent-soft' : 'bg-bad-soft text-bad'}`}>
          {notice.text}
        </p>
      )}

      <section className="panel" aria-label="Recommended changes">
        <h2 className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] px-4 py-3 text-[14px] font-semibold">
          Recommended changes <span className="num text-[12px] font-normal text-muted">{moves.length ? 'largest saving first' : ''}</span>
        </h2>
        {portfolio.insights.length === 0 ? (
          <p className="px-4 py-8 text-[13px] leading-relaxed text-muted">
            Nothing to review yet.{' '}
            <Link to="/services" className="text-accent underline-offset-2 hover:underline">
              Add your subscriptions
            </Link>{' '}
            and recommendations appear once there is usage to compare with the cost.
          </p>
        ) : moves.length === 0 ? (
          <p className="px-4 py-8 text-[13px] leading-relaxed text-muted">
            No changes to recommend. {unmeasured.length > 0 ? `${unmeasured.length} subscription${unmeasured.length === 1 ? ' has' : 's have'} no usage data yet, so ${unmeasured.length === 1 ? 'it' : 'they'} cannot be judged.` : 'Everything measured is earning its cost.'}
          </p>
        ) : (
          <ul>
            {moves.map((i) => {
              const move = i.recommendation.action;
              const waiting = pendingFor(i.sub.id);
              return (
                <li key={i.sub.id} className="border-b border-white/[0.06] px-4 py-4 last:border-b-0">
                  <div className="flex flex-wrap items-start gap-3">
                    <AppLogo providerId={i.sub.providerId} category={i.sub.category} color={i.sub.color} size={40} />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[14px] font-semibold">
                        {VERB[move]} {i.sub.name}
                        {move === 'downgrade' && i.sub.cheaperPlan ? ` to ${i.sub.cheaperPlan.name}` : ''}
                      </h3>
                      <p className="mt-0.5 text-[13px] leading-relaxed">{i.recommendation.reason}</p>
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        <li className="num rounded bg-white/[0.06] px-1.5 py-0.5 text-[12px] text-muted">
                          {i.sub.plan}, {money(i.sub.price)}/{cycleShort(i.sub.cycle)}
                        </li>
                        <li className="num rounded bg-white/[0.06] px-1.5 py-0.5 text-[12px] text-muted">{i.hours30} h used in 30 days</li>
                        <li className="num rounded bg-white/[0.06] px-1.5 py-0.5 text-[12px] text-muted">next charge {shortDate(i.sub.trialEndsAt ?? i.sub.nextRenewal)}</li>
                        <li className={`rounded px-1.5 py-0.5 text-[12px] ${i.recommendation.confidence === 'high' ? 'bg-accent-soft text-accent' : 'bg-warn-soft text-warn'}`}>{i.recommendation.confidence} confidence</li>
                      </ul>
                      {i.recommendation.confidence !== 'high' && i.sub.category === 'Streaming' && <p className="mt-1.5 text-[12px] text-faint">TV viewing is not measured, so check this one against how you actually watch.</p>}
                    </div>
                    <div className="text-right">
                      <p className="num text-[18px] font-semibold text-good">{money(i.recommendation.savingsMonthly)}</p>
                      <p className="num text-[11px] text-faint">a month · {money(round(i.recommendation.savingsMonthly * 12))} a year</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 pl-[52px]">
                    {waiting?.status === 'guided' ? (
                      <>
                        <a href={i.sub.cancelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-canvas hover:opacity-90">
                          Finish at {i.sub.name} <ExternalLink size={13} aria-hidden="true" />
                        </a>
                        <button
                          onClick={async () => {
                            setBusy(i.sub.id);
                            const res = await mutate(`/api/actions/${waiting.id}`, { decision: 'done' });
                            setNotice({ ok: res.ok, text: res.ok ? `${i.sub.name}: recorded as done.` : (res.error ?? 'Something went wrong') });
                            setBusy(null);
                          }}
                          disabled={busy !== null}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-[13px] hover:bg-white/[0.07] disabled:opacity-50"
                        >
                          I have done it
                        </button>
                      </>
                    ) : waiting ? (
                      <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[13px] hover:bg-white/[0.07]">
                        Waiting for your decision in the inbox <ArrowRight size={13} aria-hidden="true" />
                      </Link>
                    ) : i.sub.policy === 'locked' ? (
                      <span className="text-[12px] text-faint">You locked this subscription, so nothing is changed from here.</span>
                    ) : (
                      <button onClick={() => act(i, move)} disabled={busy !== null} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-canvas hover:opacity-90 disabled:opacity-50">
                        {busy === i.sub.id ? 'Working' : `${VERB[move]} it`}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {annual.length > 0 && (
        <section className="panel" aria-label="Pay yearly">
          <h2 className="border-b border-white/[0.06] px-4 py-3 text-[14px] font-semibold">Keep it, pay less: yearly billing</h2>
          <ul>
            {annual.map(({ insight: i, plan, yearlySaving, official }) => (
              <li key={i.sub.id} className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0">
                <AppLogo providerId={i.sub.providerId} category={i.sub.category} color={i.sub.color} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">
                    {i.sub.name}: {plan.name} at {money(plan.price)} a year
                  </span>
                  <span className="num block text-[12px] text-muted">
                    You pay {money(i.sub.price)} a month, {money(round(i.sub.price * 12))} a year. {official ? 'Price read from the official site.' : 'Catalog price, check it before switching.'}
                  </span>
                </span>
                <span className="num text-[14px] font-semibold text-good">{money(yearlySaving)} a year</span>
                <a href={i.sub.cancelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-[12px] font-medium hover:bg-white/[0.07]">
                  Switch at {i.sub.name} <ExternalLink size={12} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
          <p className="border-t border-white/[0.06] px-4 py-2.5 text-[12px] text-faint">Yearly billing only pays off for something you will keep all year. Subscriptions with a change recommended above are left out.</p>
        </section>
      )}

      {(unmeasured.length > 0 || failing.length > 0) && (
        <section className="panel" aria-label="Cannot be judged yet">
          <h2 className="border-b border-white/[0.06] px-4 py-3 text-[14px] font-semibold">Not judged yet</h2>
          <ul>
            {failing.map((i) => (
              <li key={i.sub.id} className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0">
                <AppLogo providerId={i.sub.providerId} category={i.sub.category} color={i.sub.color} size={28} />
                <span className="min-w-0 flex-1 text-[13px]">
                  <span className="font-medium">{i.sub.name}</span> <span className="text-muted">The last payment failed and you use it regularly.</span>
                </span>
                <Link to="/transactions" className="text-[12px] text-accent underline-offset-2 hover:underline">
                  Fix the payment
                </Link>
              </li>
            ))}
            {unmeasured.map((i) => (
              <li key={i.sub.id} className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0">
                <AppLogo providerId={i.sub.providerId} category={i.sub.category} color={i.sub.color} size={28} />
                <span className="min-w-0 flex-1 text-[13px]">
                  <span className="font-medium">{i.sub.name}</span>{' '}
                  <span className="num text-muted">
                    {money(i.monthlyCost)} a month, with no usage data to compare it with.
                  </span>
                </span>
                <Link to="/connect" className="text-[12px] text-accent underline-offset-2 hover:underline">
                  Set up usage tracking
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, detail, accent }: { label: string; value: string; detail: string; accent?: boolean }) {
  return (
    <div className="panel px-4 py-3.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={`num mt-1 text-[24px] font-semibold tracking-tight ${accent ? 'text-good' : ''}`}>{value}</dd>
      <dd className="num text-[12px] text-faint">{detail}</dd>
    </div>
  );
}
