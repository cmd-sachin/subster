import { createFileRoute, Link } from '@tanstack/react-router';
import { Check, ExternalLink, KeyRound, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppLogo } from '@/components/app-logo';
import { ConnectionBadge, ConnectionPanel, since } from '@/components/connection';
import { FitCheck } from '@/components/fit-check';
import { useApp } from '@/components/app-state';
import { CATEGORY_ICON } from '@/components/category-icon';
import { acceptsPayPal, PAYPAL_ACCEPTANCE, PAYPAL_CHECKED_ON } from '@/domain/paypal-acceptance.gen';
import { CATALOG, catalogPlans, webDomains, CATEGORIES, CATEGORY_LABEL, type Provider } from '@/domain/catalog';
import { cycleShort, money, shortDate, today } from '@/domain/dates';
import type { AppState, BillingCycle, Category, Insight, LivePlan } from '@/domain/types';
import { Loader } from '@/components/loader';
import { PayPalMark } from '@/components/paypal-mark';

/** "3 minutes ago", "2 days ago". */
function ago(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export const Route = createFileRoute('/services')({ component: Services });

const VERDICT_LABEL = {
  great: 'Good value',
  fair: 'Fair value',
  poor: 'Low value',
  unused: 'Unused',
  unmeasured: 'Usage not measured',
  essential: 'Essential',
} as const;

function Services() {
  const { state, refresh } = useApp();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | 'all' | 'mine' | 'paypal'>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const mine = useMemo(() => new Map((state?.portfolio.insights ?? []).filter((i) => i.sub.providerId && i.sub.status !== 'cancelled').map((i) => [i.sub.providerId!, i])), [state]);
  // "In use now" lapses on its own when the browser goes quiet, so re-read while anything is live.
  const anyLive = Object.values(state?.connections ?? {}).some((c) => c.state === 'live');
  useEffect(() => {
    if (!anyLive) return;
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [anyLive, refresh]);
  if (!state) return <Loader label="Loading services" />;

  const needle = query.trim().toLowerCase();
  // The PayPal mark on a service means its own help pages say it accepts PayPal where the user
  // is (see domain/paypal-acceptance.gen.ts). "one tap" is added when the user's own subscription
  // already runs on a PayPal agreement that can be paused or cancelled from here.
  const paypalOf = (app: Provider): 'managed' | 'accepted' | null => {
    if (mine.get(app.id)?.sub.paypalSubscriptionId) return 'managed';
    return acceptsPayPal(app.id, state.settings.currency) ? 'accepted' : null;
  };
  const paypalCount = CATALOG.filter((app) => paypalOf(app)).length;
  const visible = CATALOG.filter(
    (app) => (!needle || app.name.toLowerCase().includes(needle)) && (category === 'all' || (category === 'mine' ? mine.has(app.id) : category === 'paypal' ? paypalOf(app) !== null : app.category === category)),
  );
  const groups = CATEGORIES.map((c) => ({
    category: c,
    apps: visible.filter((a) => a.category === c),
  })).filter((g) => g.apps.length > 0);
  const open = CATALOG.find((a) => a.id === openId);

  return (
    <div className="px-4 py-7 md:px-8">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">Services</h1>
        <p className="mt-1.5 text-[14px] text-muted">
          {CATALOG.length} services. Those marked <PayPalMark /> accept PayPal, according to their own help pages.
        </p>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
          <label htmlFor="app-search" className="sr-only">
            Search services
          </label>
          <input id="app-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search services" className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-[13px] placeholder:text-faint" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
          <Chip active={category === 'all'} onClick={() => setCategory('all')}>
            All <span className="num text-faint">{CATALOG.length}</span>
          </Chip>
          <Chip active={category === 'paypal'} onClick={() => setCategory('paypal')}>
            <PayPalMark /> <span className="num text-faint">{paypalCount}</span>
          </Chip>
          <Chip active={category === 'mine'} onClick={() => setCategory('mine')}>
            Yours <span className="num text-faint">{mine.size}</span>
          </Chip>
          {CATEGORIES.filter((c) => CATALOG.some((a) => a.category === c)).map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {CATEGORY_LABEL[c]}
            </Chip>
          ))}
        </div>
      </div>

      {groups.length === 0 && <p className="mt-10 text-[14px] text-muted">No services match. The catalog covers known services; anything else is picked up from your bank or statement.</p>}

      {groups.map((group) => {
        const Icon = CATEGORY_ICON[group.category];
        return (
          <section key={group.category} className="mt-8" aria-label={CATEGORY_LABEL[group.category]}>
            <h2 className="flex items-center gap-2 text-[13px] font-medium text-faint">
              <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
              {CATEGORY_LABEL[group.category]}
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.apps.map((app) => {
                const insight = mine.get(app.id);
                const connection = insight ? state.connections[insight.sub.id] : undefined;
                const live = state.livePlans[app.id];
                const official = live?.status === 'ok' && live.plans.length > 0;
                const cheapest = [...(official ? live.plans : catalogPlans(app, state.settings.currency))].sort((a, b) => a.price - b.price)[0];
                return (
                  <li key={app.id}>
                    <button onClick={() => setOpenId(app.id)} className="panel flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-white/[0.07]">
                      <AppIcon app={app} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{app.name}</span>
                        <span className="num block text-[12px] text-muted">
                          {insight
                            ? `You pay ${money(insight.sub.price)}/${cycleShort(insight.sub.cycle)}`
                            : cheapest
                              ? `${official || cheapest.currency === state.settings.currency ? 'From' : 'US list price from'} ${money(cheapest.price, cheapest.currency)}/${cycleShort(cheapest.cycle)}`
                              : CATEGORY_LABEL[app.category]}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        {insight && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Subscribed</span>}
                        {paypalOf(app) && (
                          <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px]" title={paypalOf(app) === 'managed' ? 'Paid through PayPal: pause or cancel in one tap' : `${app.name} accepts PayPal`}>
                            <PayPalMark />
                            {paypalOf(app) === 'managed' && <span className="ml-1 text-muted">one tap</span>}
                          </span>
                        )}
                        {connection && <ConnectionBadge connection={connection} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {open && <Detail app={open} insight={mine.get(open.id)} state={state} onClose={() => setOpenId(null)} />}
    </div>
  );
}

const AppIcon = ({ app, size = 40 }: { app: Provider; size?: number }) => <AppLogo providerId={app.id} category={app.category} color={app.color} size={size} />;

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium ${active ? 'border-accent bg-accent-soft text-accent' : 'border-white/10 text-muted hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

function Detail({ app, insight, state, onClose }: { app: Provider; insight?: Insight; state: AppState; onClose: () => void }) {
  const { mutate } = useApp();
  const account = state.accounts.find((a) => a.providerId === app.id);
  const connection = insight ? state.connections[insight.sub.id] : undefined;
  const pendingSubscribe = state.actions.find((a) => a.providerId === app.id && a.type === 'subscribe' && (a.status === 'pending' || a.status === 'guided'));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [tracking, setTracking] = useState(false);
  const [plan, setPlan] = useState(catalogPlans(app, state.settings.currency)[0]?.name ?? 'Standard');
  const [cycle, setCycle] = useState<BillingCycle>(catalogPlans(app, state.settings.currency)[0]?.cycle ?? 'monthly');
  const [price, setPrice] = useState('');
  const [lastCharged, setLastCharged] = useState(today());
  const paypalOff = state.integrations.paypal === 'off';
  const live = state.livePlans[app.id];
  const official = live?.status === 'ok' && live.plans.length > 0;
  // What the official site sells in the user's region when it has been read; otherwise the catalog's US list prices.
  const plans: LivePlan[] = official ? live.plans : catalogPlans(app, state.settings.currency);
  const regional = plans.some((p) => p.currency === state.settings.currency);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(key: string, url: string, body: unknown, done: string) {
    setBusy(key);
    setNotice(null);
    const res = await mutate(url, body);
    setNotice({
      ok: res.ok,
      text: res.ok ? done : (res.error ?? 'Something went wrong'),
    });
    setBusy(null);
    return res.ok;
  }

  const pp = PAYPAL_ACCEPTANCE[app.id];
  const accepts = acceptsPayPal(app.id, state.settings.currency);
  const cheapest = plans.length > 0 ? [...plans].sort((x, y) => x.price - y.price)[0] : undefined;
  const scored = insight && insight.valueScore !== null && insight.verdict !== 'essential' && insight.verdict !== 'unmeasured';
  const tone = !insight ? 'text-muted' : insight.verdict === 'great' ? 'text-good' : insight.verdict === 'fair' ? 'text-info' : insight.verdict === 'poor' ? 'text-warn' : insight.verdict === 'unused' ? 'text-bad' : 'text-muted';
  const weeks = insight?.weekly.slice(-12) ?? [];
  const peak = Math.max(1, ...weeks.map((w) => w.hours));
  const advice = insight && insight.recommendation.action !== 'keep' && insight.recommendation.action !== 'review' ? insight.recommendation : undefined;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-scrim backdrop-blur-sm sm:items-center sm:p-5" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={app.name}
        onClick={(e) => e.stopPropagation()}
        className="menu-pop flex max-h-[94vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-t-[30px] bg-surface shadow-[0_40px_90px_-30px_rgba(10,40,110,0.55)] sm:rounded-[30px]"
        style={{ transformOrigin: 'center' }}
      >
        {/* The service in one glance: who it is, what it costs you, whether PayPal works. */}
        <header
          className="relative shrink-0 overflow-hidden px-6 pb-5 pt-6 sm:px-8"
          style={{
            background: `linear-gradient(120deg, color-mix(in srgb, ${app.color} 15%, white) 0%, color-mix(in srgb, ${app.color} 5%, white) 45%, white 100%)`,
          }}
        >
          <span className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full opacity-20 blur-3xl" style={{ background: app.color }} aria-hidden="true" />
          <div className="relative flex flex-wrap items-center gap-x-5 gap-y-4">
            <div className="rounded-[22px] bg-black p-1.5 shadow-[0_12px_28px_-14px_rgba(10,40,110,0.5)]">
              <AppIcon app={app} size={60} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">{app.name}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                <span className="rounded-full bg-black/70 px-2.5 py-1 text-muted">{CATEGORY_LABEL[app.category]}</span>
                {insight && <span className="rounded-full bg-accent px-2.5 py-1 font-medium text-on">{insight.sub.status === 'active' ? 'Subscribed' : insight.sub.status.replace('_', ' ')}</span>}
                {accepts && (
                  <span className="flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1">
                    <PayPalMark /> accepted
                  </span>
                )}
                {connection && <ConnectionBadge connection={connection} />}
              </div>
            </div>
            <div className="text-right">
              {insight ? (
                <>
                  <p className="num text-[30px] font-semibold leading-none tracking-[-0.03em]">
                    {money(insight.sub.price)}
                    <span className="text-[14px] font-normal text-muted"> / {cycleShort(insight.sub.cycle)}</span>
                  </p>
                  <p className={`mt-1.5 text-[13px] ${insight.daysToRenewal <= 3 ? 'font-medium text-bad' : 'text-muted'}`}>
                    {insight.sub.plan} · next charge {shortDate(insight.sub.nextRenewal)}, in {insight.daysToRenewal} day
                    {insight.daysToRenewal === 1 ? '' : 's'}
                  </p>
                </>
              ) : (
                cheapest && (
                  <>
                    <p className="text-[12px] text-muted">From</p>
                    <p className="num text-[30px] font-semibold leading-none tracking-[-0.03em]">
                      {money(cheapest.price, cheapest.currency)}
                      <span className="text-[14px] font-normal text-muted"> / {cycleShort(cheapest.cycle)}</span>
                    </p>
                  </>
                )
              )}
            </div>
            <button onClick={onClose} aria-label="Close" className="absolute -right-2 -top-2 grid h-9 w-9 place-items-center rounded-full bg-black/70 text-muted shadow-sm hover:text-ink sm:static sm:self-start">
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:overflow-hidden">
          {/* Left: is it worth it, and what else it sells. */}
          <div className="space-y-7 px-6 py-6 sm:px-8 lg:overflow-y-auto">
            {notice && (
              <p role="status" className={`rounded-2xl px-3.5 py-2.5 text-[13px] ${notice.ok ? 'bg-accent-soft text-accent' : 'bg-bad-soft text-bad'}`}>
                {notice.text}
              </p>
            )}

            {insight ? (
              <section aria-label="Is it worth it">
                <div className="flex flex-wrap items-center gap-6">
                  <div className="relative h-[108px] w-[108px] shrink-0">
                    <svg viewBox="0 0 100 100" className={`h-full w-full -rotate-90 ${tone}`} aria-hidden="true">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="9" />
                      {scored && <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" pathLength={100} strokeDasharray={`${Math.max(2, insight.valueScore ?? 0)} 100`} className="draw" />}
                    </svg>
                    <div className="absolute inset-0 grid place-items-center text-center">
                      <span>
                        <span className="num block text-[28px] font-semibold leading-none tracking-[-0.03em]">{scored ? insight.valueScore : '–'}</span>
                        <span className="text-[11px] text-faint">{scored ? 'of 100' : 'no score'}</span>
                      </span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[20px] font-semibold tracking-[-0.02em] ${tone}`}>{VERDICT_LABEL[insight.verdict]}</p>
                    <dl className="mt-2 flex flex-wrap gap-x-7 gap-y-2 text-[13px]">
                      <Fact label="Used, last 30 days" value={insight.verdict === 'unmeasured' || insight.verdict === 'essential' ? 'Not measured' : `${insight.hours30} hours`} />
                      <Fact label="Each hour costs" value={insight.costPerHour ? money(insight.costPerHour) : 'Not known'} />
                      <Fact label="Billed via" value={insight.sub.rail === 'paypal' ? 'PayPal' : insight.sub.rail === 'bank' ? 'Bank account' : 'Card'} />
                      <Fact
                        label="Found through"
                        value={
                          {
                            bank: 'Bank feed',
                            statement: 'Statement',
                            paypal: 'PayPal',
                            manual: 'Added by you',
                            chat: 'Started from chat',
                          }[insight.sub.source]
                        }
                      />
                    </dl>
                  </div>
                </div>

                {weeks.some((w) => w.hours > 0) && (
                  <div className="mt-5">
                    <p className="mb-1.5 flex justify-between text-[11px] text-faint">
                      <span>Hours a week, last {weeks.length} weeks</span>
                      <span className="num">peak {Math.round(peak * 10) / 10}h</span>
                    </p>
                    <div className="flex h-14 items-end gap-1.5" role="img" aria-label={`Weekly use over ${weeks.length} weeks, peaking at ${Math.round(peak)} hours`}>
                      {weeks.map((w, i) => (
                        <span
                          key={w.weekStart}
                          className={`flex-1 rounded-t-md ${i === weeks.length - 1 ? 'bg-accent' : 'bg-accent/25'}`}
                          style={{
                            height: `${Math.max(4, (w.hours / peak) * 100)}%`,
                          }}
                          title={`Week of ${shortDate(w.weekStart)}: ${Math.round(w.hours * 10) / 10}h`}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {advice && (
                  <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl bg-sun-soft px-4 py-3">
                    <p className="min-w-0 flex-1 text-[13px] leading-relaxed">
                      <span className="font-semibold capitalize">{advice.action} it.</span> {advice.reason}
                    </p>
                    {advice.savingsMonthly > 0 && <span className="num shrink-0 rounded-full bg-black px-3 py-1 text-[13px] font-semibold text-good">saves {money(advice.savingsMonthly)}/mo</span>}
                  </div>
                )}

                {insight.sub.status !== 'cancelled' && (
                  <div className="mt-5 rounded-2xl border border-white/[0.08] p-4">
                    <FitCheck key={insight.sub.id} sub={insight.sub} check={state.fitChecks[insight.sub.id]} />
                  </div>
                )}
              </section>
            ) : pendingSubscribe ? (
              <p className="rounded-2xl bg-accent-soft px-4 py-3 text-[13px] leading-relaxed">
                "{pendingSubscribe.title}" is waiting in your{' '}
                <Link to="/" className="font-medium text-accent underline-offset-2 hover:underline">
                  inbox
                </Link>
                .
              </p>
            ) : (
              <section className="rounded-2xl border border-dashed border-white/15 p-4" aria-label="Already paying for this?">
                <p className="mb-3 text-[13px] leading-relaxed text-muted">You are not tracking {app.name}. Already paying for it? Add it, or link your bank and it is picked up automatically.</p>
                {!tracking ? (
                  <button onClick={() => setTracking(true)} className="rounded-xl border border-white/10 px-3 py-2 text-[13px] font-medium hover:bg-white/[0.07]">
                    Add it to my subscriptions
                  </button>
                ) : (
                  <form
                    className="space-y-3"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (
                        await run(
                          'track',
                          '/api/services',
                          {
                            intent: 'track',
                            providerId: app.id,
                            plan,
                            price: Number(price),
                            cycle,
                            lastChargedOn: lastCharged,
                          },
                          `${app.name} is now tracked.`,
                        )
                      )
                        setTracking(false);
                    }}
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Plan">
                        {app.plans.length > 0 ? (
                          <select
                            value={plan}
                            onChange={(e) => {
                              setPlan(e.target.value);
                              setCycle(app.plans.find((p) => p.name === e.target.value)?.cycle ?? cycle);
                            }}
                            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px]"
                          >
                            {app.plans.map((p) => (
                              <option key={p.name}>{p.name}</option>
                            ))}
                          </select>
                        ) : (
                          <input value={plan} onChange={(e) => setPlan(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px]" />
                        )}
                      </Field>
                      <Field label="Billed">
                        <select value={cycle} onChange={(e) => setCycle(e.target.value as BillingCycle)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px]">
                          <option value="monthly">Every month</option>
                          <option value="quarterly">Every 3 months</option>
                          <option value="yearly">Every year</option>
                        </select>
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={`What you pay per ${cycleShort(cycle)} (${state.settings.currency})`}>
                        <input required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px]" />
                      </Field>
                      <Field label="Last charged on">
                        <input type="date" required max={today()} value={lastCharged} onChange={(e) => setLastCharged(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px]" />
                      </Field>
                    </div>
                    <button type="submit" disabled={busy !== null} className="rounded-xl bg-ink px-3 py-2 text-[13px] font-semibold text-canvas hover:opacity-90 disabled:opacity-50">
                      {busy === 'track' ? 'Adding' : 'Track this subscription'}
                    </button>
                  </form>
                )}
              </section>
            )}

            <Section title="Plans" note={official ? `Official site, ${live.region}` : plans.length > 0 ? (regional ? 'Built-in catalog, not live' : 'US list prices, not live') : undefined}>
              {official ? (
                <p className="mb-2.5 text-[12px] leading-relaxed text-muted">
                  Read from {app.name}'s own site {ago(live.checkedAt)}
                  {live.sourceUrls[0] && (
                    <>
                      {' '}
                      (
                      <a href={live.sourceUrls[0]} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
                        source
                      </a>
                      )
                    </>
                  )}
                  .{live.error && <span className="text-muted"> The latest re-check did not go through.</span>}
                </p>
              ) : (
                <p className="mb-2.5 text-[12px] leading-relaxed text-muted">
                  {plans.length > 0
                    ? regional
                      ? `These prices are from the built-in catalog and may be out of date.`
                      : `These are US dollar list prices from the built-in catalog. They may be out of date and are not what ${app.name} charges in your region.`
                    : `Subster has no confirmed price list for ${app.name}, so none is guessed here.`}{' '}
                  {live?.error && <span>The official site could not be read just now.</span>}
                </p>
              )}
              {live?.changes && live.changes.length > 0 && (
                <ul className="mb-2.5 rounded-xl bg-warn-soft px-3 py-2 text-[12px] text-warn">
                  {live.changes.map((change) => (
                    <li key={change}>
                      Changed {live.changedAt ? ago(live.changedAt) : 'recently'}: {change}
                    </li>
                  ))}
                </ul>
              )}
              <ul className="grid gap-2 sm:grid-cols-2">
                {plans.map((p) => {
                  const current = insight?.sub.plan === p.name;
                  return (
                    <li key={`${p.name}-${p.cycle}`} className={`flex flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-colors ${current ? 'border-accent bg-accent-soft' : 'border-white/[0.08] hover:border-white/20'}`}>
                      <span>
                        <span className="block text-[13px] text-muted">{p.name}</span>
                        <span className="num mt-0.5 block text-[20px] font-semibold tracking-[-0.02em]">
                          {money(p.price, p.currency)}
                          <span className="text-[12px] font-normal text-muted"> / {cycleShort(p.cycle)}</span>
                          {p.note && <span className="text-faint"> · {p.note}</span>}
                        </span>
                      </span>
                      {current ? (
                        <span className="flex items-center gap-1 text-[12px] font-medium text-accent">
                          <Check size={13} aria-hidden="true" /> Your plan
                        </span>
                      ) : (
                        !insight &&
                        !pendingSubscribe &&
                        // PayPal bills these agreements in US dollars, so only dollar plans can be started here.
                        p.currency === 'USD' && (
                          <button
                            onClick={() =>
                              run(
                                `sub-${p.name}`,
                                '/api/services',
                                {
                                  intent: 'subscribe',
                                  providerId: app.id,
                                  plan: p.name,
                                },
                                `Sent to your inbox. Approve it there, then confirm at PayPal.`,
                              )
                            }
                            disabled={busy !== null || paypalOff}
                            title={paypalOff ? 'Connect PayPal first' : undefined}
                            className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-on hover:opacity-90 disabled:opacity-40"
                          >
                            {busy === `sub-${p.name}` ? 'Sending' : 'Start with PayPal'}
                          </button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Small busy={busy === 'plans'} onClick={() => run('plans', '/api/service-plans', { providerId: app.id }, `Plans updated from ${app.name}'s official site.`)}>
                  {official ? 'Check official site again' : 'Check official site now'}
                </Small>
              </div>
              {!insight && !paypalOff && plans.some((p) => p.currency === 'USD') && (
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Started here, the plan is billed by Subster through a PayPal agreement in dollars. That is what makes pausing and cancelling one tap. It does not open an account at {app.name}.
                </p>
              )}
              {!insight && plans.some((p) => p.currency !== 'USD') && (
                <p className="mt-2 text-[12px] text-muted">
                  Plans in {plans.find((p) => p.currency !== 'USD')?.currency} are started on {app.name}&apos;s own site.
                </p>
              )}
              {paypalOff && !insight && plans.some((p) => p.currency === 'USD') && <p className="mt-2 text-[12px] text-muted">Starting a subscription from here needs PayPal, which is not connected yet.</p>}
            </Section>
          </div>

          {/* Right: how it connects to you. */}
          <div className="space-y-6 border-t border-white/[0.06] bg-sunken/70 px-6 py-6 sm:px-7 lg:overflow-y-auto lg:border-l lg:border-t-0">
            {pp && (
              <Section title="PayPal" note={`Checked ${shortDate(PAYPAL_CHECKED_ON)}`}>
                <div className="rounded-2xl bg-black p-4 shadow-sm">
                  <p className="flex items-center gap-2 text-[14px] font-medium">
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${accepts ? 'bg-good text-on' : 'bg-white/10 text-muted'}`}>
                      {accepts ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
                    </span>
                    {accepts ? `${app.name} accepts PayPal` : pp.accepts ? 'Accepts PayPal, but not in your country' : `${app.name} does not take PayPal`}
                  </p>
                  {pp.note && <p className="mt-2 text-[12px] leading-relaxed text-muted">{pp.note}</p>}
                  <a href={pp.source} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] text-accent underline-offset-2 hover:underline">
                    {app.name}&apos;s own page <ExternalLink size={11} aria-hidden="true" />
                  </a>
                  {insight && !insight.sub.paypalSubscriptionId && accepts && (
                    <p className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-[12px] leading-relaxed">You could pay for this with PayPal and manage the automatic payment from your PayPal account.</p>
                  )}
                </div>
              </Section>
            )}

            {connection && (
              <Section title="Connection" note={state.monitor.checkedAt ? `Verified ${since(state.monitor.checkedAt)}` : 'Monitored automatically'}>
                <ConnectionPanel connection={connection} />
                {connection.state === 'waiting' && (
                  <p className="mt-2.5 text-[12px] leading-relaxed text-faint">
                    Nothing reports for {app.name} yet.{' '}
                    <Link to="/connect" className="text-accent underline-offset-2 hover:underline">
                      Set up the browser extension or the Android companion
                    </Link>{' '}
                    and it connects by itself.
                  </p>
                )}
                {connection.auth.status === 'signed_out' && connection.auth.via === 'browser' && (
                  <a href={app.manageUrl} target="_blank" rel="noreferrer" className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-on hover:opacity-90">
                    Sign in at {app.name} <ExternalLink size={12} aria-hidden="true" />
                  </a>
                )}
              </Section>
            )}

            <Section title={`Your ${app.name} account`}>
              {app.account.type === 'oauth' ? (
                account?.method === 'oauth' ? (
                  <div className="space-y-3">
                    <p className="text-[13px] leading-relaxed">
                      Signed in
                      {account.displayName ? ` as ${account.displayName}` : ''}. Spotify reports the plan as <span className="font-medium">{account.product ?? 'unknown'}</span>.
                      {account.lastSyncAt && <span className="text-muted"> Listening last synced {new Date(account.lastSyncAt).toLocaleString()}.</span>}
                    </p>
                    <div className="flex gap-2">
                      <Small busy={busy === 'sync'} onClick={() => run('sync', '/api/accounts/link', { providerId: app.id, action: 'sync' }, 'Listening history synced.')}>
                        Sync listening now
                      </Small>
                      <Small busy={busy === 'unlink'} onClick={() => run('unlink', '/api/accounts/link', { providerId: app.id, action: 'unlink' }, 'Account unlinked.')}>
                        Sign out
                      </Small>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[13px] leading-relaxed text-muted">
                      Sign in on Spotify's own page. Subster never sees your password: it receives permission to read your plan and your recently played tracks, which become real usage for the value score.
                    </p>
                    {state.integrations.spotify ? (
                      <a href="/api/accounts/spotify/start" className="inline-flex items-center gap-2 rounded-xl bg-[#1ed760] px-3.5 py-2 text-[13px] font-semibold text-ink hover:opacity-90">
                        <KeyRound size={14} aria-hidden="true" /> Sign in with Spotify
                      </a>
                    ) : (
                      <p className="text-[12px] text-muted">Spotify sign-in is not available yet.</p>
                    )}
                  </div>
                )
              ) : (
                <div className="space-y-3">
                  <p className="text-[13px] leading-relaxed text-muted">
                    {app.name} has no sign-in for other apps, so there is nothing to link by hand.{' '}
                    {insight ? 'The connection above is read from your own browser and phone.' : `Once you track it, Subster picks up your ${app.name} session from your browser by itself.`} Subster never asks for your {app.name} password.
                  </p>
                  <a href={app.manageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-medium hover:bg-white/[0.07]">
                    Open {app.name} account page <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </div>
              )}
            </Section>

            <Section title="How Subster tracks it">
              <ul className="space-y-1.5 text-[13px] text-muted">
                <li>Payments: matched from your bank feed, statements and PayPal by the merchant name.</li>
                <li>{app.androidPackage ? `Phone usage: screen time of the Android app (${app.androidPackage}).` : 'Phone usage: no Android app to measure.'}</li>
                <li>{webDomains(app).length > 0 ? `Web usage: time on ${webDomains(app).join(', ')} in a browser with the Subster extension.` : 'Web usage: not measured, because its site is shared with other products.'}</li>
              </ul>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 flex items-baseline justify-between text-[12px] font-medium text-faint">
        {title}
        {note && <span className="normal-case tracking-normal">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="font-medium capitalize">{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-faint">{label}</span>
      {children}
    </label>
  );
}

function Small({ children, onClick, busy }: { children: React.ReactNode; onClick: () => void; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-medium hover:bg-white/[0.07] disabled:opacity-50">
      {busy ? 'Working' : children}
    </button>
  );
}
