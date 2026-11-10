import { createFileRoute, Link } from '@tanstack/react-router';
import { Check, ExternalLink, KeyRound, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppLogo } from '@/components/app-logo';
import { useApp } from '@/components/app-state';
import { CATEGORY_ICON } from '@/components/category-icon';
import { CATALOG, catalogPlans, CATEGORIES, CATEGORY_LABEL, type Provider } from '@/domain/catalog';
import { cycleShort, money, shortDate, today } from '@/domain/dates';
import type { AppState, BillingCycle, Category, Insight, LivePlan } from '@/domain/types';

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

const VERDICT_LABEL = { great: 'Good value', fair: 'Fair value', poor: 'Low value', unused: 'Unused', unmeasured: 'Usage not measured', essential: 'Essential' } as const;

function Services() {
  const { state } = useApp();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | 'all' | 'mine'>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const mine = useMemo(() => new Map((state?.portfolio.insights ?? []).filter((i) => i.sub.providerId && i.sub.status !== 'cancelled').map((i) => [i.sub.providerId!, i])), [state]);
  if (!state) return <p className="p-8 text-muted">Loading services</p>;

  const needle = query.trim().toLowerCase();
  const visible = CATALOG.filter((app) => (!needle || app.name.toLowerCase().includes(needle)) && (category === 'all' || (category === 'mine' ? mine.has(app.id) : app.category === category)));
  const groups = CATEGORIES.map((c) => ({ category: c, apps: visible.filter((a) => a.category === c) })).filter((g) => g.apps.length > 0);
  const open = CATALOG.find((a) => a.id === openId);

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-7 md:px-8">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">Services</h1>
        <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-muted">
          Every subscription service SubSense knows: {CATALOG.length} of them across {CATEGORIES.length} categories. Open one to see its current plans, what you pay, sign in to your account
          there, or start a subscription through PayPal. You can also just tell the agent, for example "subscribe to Spotify Premium Duo".
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
            <h2 className="flex items-center gap-2 text-[13px] font-medium uppercase tracking-[0.14em] text-faint">
              <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
              {CATEGORY_LABEL[group.category]}
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.apps.map((app) => {
                const insight = mine.get(app.id);
                const linked = state.accounts.some((a) => a.providerId === app.id);
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
                          {insight ? `You pay ${money(insight.sub.price)}/${cycleShort(insight.sub.cycle)}` : cheapest ? `${official || cheapest.currency === state.settings.currency ? 'From' : 'US list price from'} ${money(cheapest.price, cheapest.currency)}/${cycleShort(cheapest.cycle)}` : CATEGORY_LABEL[app.category]}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        {insight && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Subscribed</span>}
                        {linked && (
                          <span className="flex items-center gap-1 text-[11px] text-good">
                            <KeyRound size={11} aria-hidden="true" /> Signed in
                          </span>
                        )}
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
    <button onClick={onClick} aria-pressed={active} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium ${active ? 'border-accent bg-accent-soft text-accent' : 'border-white/10 text-muted hover:text-ink'}`}>
      {children}
    </button>
  );
}

function Detail({ app, insight, state, onClose }: { app: Provider; insight?: Insight; state: AppState; onClose: () => void }) {
  const { mutate } = useApp();
  const account = state.accounts.find((a) => a.providerId === app.id);
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
    setNotice({ ok: res.ok, text: res.ok ? done : (res.error ?? 'Something went wrong') });
    setBusy(null);
    return res.ok;
  }


  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label={app.name} onClick={(e) => e.stopPropagation()} className="rise flex h-full w-full max-w-[460px] flex-col overflow-y-auto border-l border-white/10 bg-[#07090d]">
        <header className="flex items-start gap-3.5 border-b border-white/[0.06] p-5">
          <AppIcon app={app} size={52} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-semibold tracking-tight">{app.name}</h2>
            <p className="text-[13px] text-muted">{CATEGORY_LABEL[app.category]}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-white/[0.07] hover:text-ink">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-6 p-5">
          {notice && (
            <p role="status" className={`rounded-xl px-3 py-2 text-[13px] ${notice.ok ? 'bg-accent-soft' : 'bg-bad-soft text-bad'}`}>
              {notice.text}
            </p>
          )}

          <Section title="Your subscription">
            {insight ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                <Fact label="Plan" value={insight.sub.plan} />
                <Fact label="You pay" value={`${money(insight.sub.price)} per ${cycleShort(insight.sub.cycle)}`} />
                <Fact label="Next charge" value={`${shortDate(insight.sub.nextRenewal)} (${insight.daysToRenewal}d)`} />
                <Fact label="Billed via" value={insight.sub.rail === 'paypal' ? 'PayPal' : insight.sub.rail === 'bank' ? 'Bank account' : 'Card'} />
                <Fact label="Used, last 30 days" value={insight.verdict === 'unmeasured' || insight.verdict === 'essential' ? 'Not measured' : `${insight.hours30} hours`} />
                <Fact label="Value" value={`${VERDICT_LABEL[insight.verdict]}${insight.valueScore !== null ? ` (${insight.valueScore}/100)` : ''}`} />
                <Fact label="Found through" value={{ bank: 'Bank feed', statement: 'Statement', paypal: 'PayPal', manual: 'Added by you', chat: 'Started from chat' }[insight.sub.source]} />
                <Fact label="Status" value={insight.sub.status.replace('_', ' ')} />
              </dl>
            ) : pendingSubscribe ? (
              <p className="text-[13px] leading-relaxed text-muted">
                "{pendingSubscribe.title}" is waiting in your{' '}
                <Link to="/" className="text-accent underline-offset-2 hover:underline">
                  inbox
                </Link>
                .
              </p>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted">You are not tracking {app.name}. If it shows up in your bank feed or a statement it is added automatically.</p>
            )}
          </Section>

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
                .{live.error && <span className="text-warn"> The latest re-check failed: {live.error}</span>}
              </p>
            ) : (
              <p className="mb-2.5 text-[12px] leading-relaxed text-muted">
                {plans.length > 0
                  ? regional
                    ? `These prices are from the built-in catalog and may be out of date.`
                    : `These are US dollar list prices from the built-in catalog. They may be out of date and are not what ${app.name} charges in your region.`
                  : `SubSense has no confirmed price list for ${app.name}, so none is guessed here.`}{' '}
                {live?.error && <span className="text-warn">The last check of the official site failed: {live.error}</span>}
              </p>
            )}
            {live?.changes && live.changes.length > 0 && (
              <ul className="mb-2.5 rounded-xl bg-warn-soft px-3 py-2 text-[12px] text-warn">
                {live.changes.map((change) => (
                  <li key={change}>Changed {live.changedAt ? ago(live.changedAt) : 'recently'}: {change}</li>
                ))}
              </ul>
            )}
            <ul className="space-y-2">
              {plans.map((p) => {
                const current = insight?.sub.plan === p.name;
                return (
                  <li key={`${p.name}-${p.cycle}`} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${current ? 'border-accent/50 bg-accent-soft' : 'border-white/[0.07]'}`}>
                    <span>
                      <span className="block text-[14px] font-medium">{p.name}</span>
                      <span className="num block text-[12px] text-muted">
                        {money(p.price, p.currency)} per {cycleShort(p.cycle)}
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
                          onClick={() => run(`sub-${p.name}`, '/api/services', { intent: 'subscribe', providerId: app.id, plan: p.name }, `Sent to your inbox. Approve it there, then confirm at PayPal.`)}
                          disabled={busy !== null || paypalOff}
                          title={paypalOff ? 'Connect PayPal first' : undefined}
                          className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
                        >
                          {busy === `sub-${p.name}` ? 'Sending' : 'Subscribe via PayPal'}
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
              {!state.integrations.planMonitor && <span className="text-[12px] text-warn">Live checks need GEMINI_API_KEY in .env.local.</span>}
            </div>
            {!insight && plans.some((p) => p.currency !== 'USD') && (
              <p className="mt-2 text-[12px] text-muted">Plans priced in {plans.find((p) => p.currency !== 'USD')?.currency} are started on {app.name}'s own site: PayPal subscription billing only supports US dollars here.</p>
            )}
            {paypalOff && !insight && plans.some((p) => p.currency === 'USD') && <p className="mt-2 text-[12px] text-warn">PayPal is not connected, so new subscriptions cannot be started from here yet. Add your PayPal keys in .env.local.</p>}
          </Section>

          {!insight && (
            <Section title="Already paying for this?">
              {!tracking ? (
                <button onClick={() => setTracking(true)} className="rounded-xl border border-white/10 px-3 py-2 text-[13px] font-medium hover:bg-white/[0.07]">
                  Add it to my subscriptions
                </button>
              ) : (
                <form
                  className="space-y-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await run('track', '/api/services', { intent: 'track', providerId: app.id, plan, price: Number(price), cycle, lastChargedOn: lastCharged }, `${app.name} is now tracked.`)) setTracking(false);
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
            </Section>
          )}

          <Section title={`Your ${app.name} account`}>
            {app.account.type === 'oauth' ? (
              account?.method === 'oauth' ? (
                <div className="space-y-3">
                  <p className="text-[13px] leading-relaxed">
                    Signed in{account.displayName ? ` as ${account.displayName}` : ''}. Spotify reports the plan as <span className="font-medium">{account.product ?? 'unknown'}</span>.
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
                    Sign in on Spotify's own page. SubSense never sees your password: it receives permission to read your plan and your recently played tracks, which become real usage
                    for the value score.
                  </p>
                  {state.integrations.spotify ? (
                    <a href="/api/accounts/spotify/start" className="inline-flex items-center gap-2 rounded-xl bg-[#1ed760] px-3.5 py-2 text-[13px] font-semibold text-black hover:opacity-90">
                      <KeyRound size={14} aria-hidden="true" /> Sign in with Spotify
                    </a>
                  ) : (
                    <p className="text-[12px] text-warn">Spotify sign-in needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.local (free at developer.spotify.com).</p>
                  )}
                </div>
              )
            ) : account ? (
              <div className="space-y-3">
                <p className="text-[13px] leading-relaxed">You confirmed you are signed in on {app.name}'s site.</p>
                <div className="flex gap-2">
                  <a href={app.manageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-medium hover:bg-white/[0.07]">
                    Open account page <ExternalLink size={12} aria-hidden="true" />
                  </a>
                  <Small busy={busy === 'unlink'} onClick={() => run('unlink', '/api/accounts/link', { providerId: app.id, action: 'unlink' }, 'Removed.')}>
                    Remove
                  </Small>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[13px] leading-relaxed text-muted">
                  {app.name} has no public sign-in for other apps, so you sign in on its own site, where you can see and change your plan. SubSense never asks for your {app.name} password.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a href={app.manageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-[13px] font-semibold text-canvas hover:opacity-90">
                    Sign in at {app.name} <ExternalLink size={13} aria-hidden="true" />
                  </a>
                  <Small busy={busy === 'confirm'} onClick={() => run('confirm', '/api/accounts/link', { providerId: app.id, action: 'confirm' }, 'Noted.')}>
                    I've signed in
                  </Small>
                </div>
              </div>
            )}
          </Section>

          <Section title="How SubSense tracks it">
            <ul className="space-y-1.5 text-[13px] text-muted">
              <li>Payments: matched from your bank feed, statements and PayPal by the merchant name.</li>
              <li>{app.androidPackage ? `Usage: screen time of the Android app (${app.androidPackage}).` : 'Usage: no phone app to measure, so it is tracked for price and renewal only.'}</li>
            </ul>
          </Section>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 flex items-baseline justify-between text-[12px] font-medium uppercase tracking-[0.12em] text-faint">
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
