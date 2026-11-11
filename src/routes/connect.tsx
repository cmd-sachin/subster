import { createFileRoute, Link } from '@tanstack/react-router';
import { Activity, Banknote, Bot, Check, Copy, Download, ExternalLink, FlaskConical, Globe, KeyRound, Landmark, RefreshCw, Settings2, Smartphone, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AppLogo } from '@/components/app-logo';
import { ConnectionBadge, since } from '@/components/connection';
import { useApp, type MutateResult } from '@/components/app-state';
import { CATEGORY_LABEL, providerById, webDomains } from '@/domain/catalog';
import { diffDays, money, today } from '@/domain/dates';
import type { AppState, Currency, Subscription } from '@/domain/types';

export const Route = createFileRoute('/connect')({ component: Connections });

declare global {
  interface Window {
    Plaid?: { create(config: { token: string; onSuccess: (publicToken: string, metadata: { institution?: { name?: string }; accounts?: { mask?: string }[] }) => void; onExit?: () => void }): { open(): void } };
  }
}

function loadPlaid(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Plaid Link'));
    document.head.appendChild(script);
  });
}

type SyncData = { result?: { newTransactions: number; discovered: string[]; charged: unknown[]; candidates: string[]; rows?: number; format?: string; run?: { summary?: string } } };

const describeSync = (data: unknown) => {
  const r = (data as SyncData).result;
  if (!r) return 'Done.';
  return [
    r.rows !== undefined ? `Read ${r.rows} rows (${r.format}).` : '',
    `${r.newTransactions} new payment${r.newTransactions === 1 ? '' : 's'}.`,
    r.discovered.length ? `Found subscriptions: ${r.discovered.join(', ')}.` : 'No new subscriptions found.',
    r.charged.length ? `${r.charged.length} matched to subscriptions you already track.` : '',
    r.candidates.length ? `Please confirm below: ${r.candidates.join(', ')}.` : '',
    r.run?.summary ? `Agent: ${r.run.summary}` : '',
  ]
    .filter(Boolean)
    .join(' ');
};

/** The domains the browser extension measures for a subscription. */
function sitesOf(sub: Subscription) {
  const provider = providerById(sub.providerId ?? '');
  return provider ? webDomains(provider) : [];
}

function Connections() {
  const { state, mutate } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [mobile, setMobile] = useState('');
  const [testText, setTestText] = useState('');
  const [testAmount, setTestAmount] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  if (!state) return <p className="p-8 text-muted">Loading connections</p>;

  const subs = state.portfolio.insights.map((i) => i.sub).filter((s) => s.status !== 'cancelled');
  const reportOf = (source: 'web' | 'android') => {
    const days = state.usage.filter((u) => u.source === source);
    return { days: days.length, last: days.reduce<string | null>((latest, u) => (!latest || u.date > latest ? u.date : latest), null), subs: new Set(days.map((u) => u.subId)).size };
  };
  const web = reportOf('web');
  const phone = reportOf('android');
  const webSites = subs.filter((s) => sitesOf(s).length > 0);
  const phoneApps = subs.filter((s) => s.androidPackage);
  const scorable = state.portfolio.insights.filter((i) => i.sub.status !== 'cancelled' && i.verdict !== 'essential');
  const measured = scorable.filter((i) => i.verdict !== 'unmeasured');
  const unmeasured = scorable.filter((i) => i.verdict === 'unmeasured');
  const managed = subs.filter((s) => s.paypalSubscriptionId);
  const lastPayPalEvent = state.integrations.webhookLog.find((e) => e.source === 'paypal');
  const liveChecks = Object.values(state.livePlans);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const ago = (date: string | null) => (date ? (diffDays(today(), date) <= 0 ? 'today' : `${diffDays(today(), date)} day${diffDays(today(), date) === 1 ? '' : 's'} ago`) : 'never');

  const { bank, paypal, webhookLog } = state.integrations;
  const query = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
  const returned = query?.get('bank');

  async function act(key: string, fn: () => Promise<MutateResult>, done: (data: unknown) => string) {
    setBusy(key);
    setNotice(null);
    const res = await fn();
    setNotice(res.ok ? { ok: true, text: done(res.data) } : { ok: false, text: res.error ?? 'Something went wrong' });
    setBusy(null);
  }

  function copy(key: string, text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  async function checkPayPal() {
    setBusy('paypal');
    setNotice(null);
    const res = await fetch('/api/paypal/transactions').catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as { transactions?: unknown[]; error?: string } | undefined;
    setNotice(res?.ok ? { ok: true, text: `PayPal answered: ${data?.transactions?.length ?? 0} transactions on the account in the last 30 days.` } : { ok: false, text: `PayPal check failed: ${data?.error ?? 'no answer'}` });
    setBusy(null);
  }

  function exportData() {
    // Your records only: the integrations block describes this server, not you.
    const mine: Partial<AppState> = { ...state! };
    delete mine.integrations;
    const url = URL.createObjectURL(new Blob([JSON.stringify(mine, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: `subster-data-${today()}.json` }).click();
    URL.revokeObjectURL(url);
  }

  async function linkWithPlaid() {
    setBusy('plaid');
    setNotice(null);
    try {
      const tokenRes = await fetch('/api/bank/link-token', { method: 'POST' });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenData.error);
      await loadPlaid();
      window.Plaid!.create({
        token: tokenData.linkToken,
        onSuccess: (publicToken, metadata) => void act('plaid', () => mutate('/api/bank/link', { publicToken, institution: metadata.institution?.name, mask: metadata.accounts?.[0]?.mask }), describeSync),
        onExit: () => setBusy(null),
      }).open();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) });
      setBusy(null);
    }
  }

  async function startAggregator() {
    setBusy('setu');
    setNotice(null);
    const res = await fetch('/api/bank/aggregator/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) window.location.assign(data.url);
    else {
      setNotice({ ok: false, text: data.error ?? 'Could not start the consent request' });
      setBusy(null);
    }
  }

  async function uploadStatement(file: File | undefined) {
    if (!file) return;
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
      setNotice({ ok: false, text: 'Choose the CSV or delimited text export of your statement. PDF and Excel files are not supported yet.' });
      return;
    }
    const csv = await file.text();
    await act('csv', () => mutate('/api/import', { csv, filename: file.name }), describeSync);
  }

  return (
    <div className="mx-auto max-w-[1180px] space-y-6 px-4 py-6 md:px-8">
      <header>
        <p className="eyebrow">Sources and settings</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">Connections</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">Where Subster gets its facts: money from your bank and PayPal, usage from your browser and phone. Each source says what it is doing and what it still needs.</p>
      </header>

      <nav aria-label="Connection status" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Health href="#bank" icon={Landmark} name="Bank" ok={Boolean(bank.link)} status={bank.link ? bank.link.institution : 'Not linked'} detail={bank.link ? `synced ${bank.link.lastSyncAt ? ago(bank.link.lastSyncAt.slice(0, 10)) : 'never'}` : `${bank.transactionCount} payments imported`} />
        <Health href="#paypal" icon={Banknote} name="PayPal" ok={paypal !== 'off'} status={paypal === 'off' ? 'Not connected' : paypal === 'live' ? 'Live' : 'Sandbox'} detail={`${managed.length} agreement${managed.length === 1 ? '' : 's'} managed`} />
        <Health href="#browser" icon={Globe} name="Browser usage" ok={web.days > 0} status={web.days > 0 ? 'Reporting' : 'Not reporting'} detail={web.days > 0 ? `last report ${ago(web.last)}` : `${webSites.length} site${webSites.length === 1 ? '' : 's'} to measure`} />
        <Health href="#phone" icon={Smartphone} name="Phone usage" ok={phone.days > 0} status={phone.days > 0 ? 'Reporting' : 'Not reporting'} detail={phone.days > 0 ? `last report ${ago(phone.last)}` : `${phoneApps.length} app${phoneApps.length === 1 ? '' : 's'} to measure`} />
        <Health href="#agent" icon={Bot} name="Agent" ok={state.integrations.agent === 'gemini'} status={state.integrations.agent === 'gemini' ? 'Gemini' : 'Rules engine'} detail={`${state.runs.length} run${state.runs.length === 1 ? '' : 's'} so far`} />
        <Health href="#agent" icon={Tags} name="Live prices" ok={liveChecks.some((l) => l.status === 'ok')} status={!state.integrations.planMonitor ? 'No API key' : liveChecks.some((l) => l.status === 'ok') ? 'Working' : liveChecks.length ? 'Checks failing' : 'Not run yet'} detail={`${liveChecks.filter((l) => l.status === 'ok').length} services read`} />
      </nav>

      {(notice || returned) && (
        <p role="status" className={`rise rounded-xl px-4 py-3 text-[13px] leading-relaxed ${(notice ? notice.ok : returned === 'linked') ? 'bg-accent-soft text-ink' : 'bg-bad-soft text-bad'}`}>
          {notice?.text ?? (returned === 'linked' ? 'Your bank account is linked and synced.' : returned === 'declined' ? 'The consent request was not approved, so nothing was linked.' : 'The bank link could not be completed.')}
        </p>
      )}

      <Group title="Money" note="How Subster learns what you pay, and where it can act for you.">
        <Card id="bank" icon={Landmark} title="Bank account" badge={bank.link ? 'Linked' : 'Not linked'} live={Boolean(bank.link)}>
        {bank.link ? (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
              <Fact label="Institution" value={bank.link.institution} />
              <Fact label="Account" value={bank.link.accountMask ? `ending ${bank.link.accountMask}` : 'n/a'} />
              <Fact label="Through" value={bank.link.provider === 'plaid' ? `Plaid${bank.plaidSandbox ? ' sandbox' : ''}` : 'Account Aggregator'} />
              <Fact label="Last sync" value={bank.link.lastSyncAt ? new Date(bank.link.lastSyncAt).toLocaleString() : 'never'} />
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button busy={busy === 'sync'} onClick={() => act('sync', () => mutate('/api/bank/sync'), describeSync)}>
                <RefreshCw size={14} className="mr-1.5 inline" aria-hidden="true" />
                Sync now
              </Button>
              <Button busy={busy === 'unlink'} onClick={() => act('unlink', () => mutate('/api/bank/link', undefined, 'DELETE'), () => 'Bank account unlinked. Your imported history is kept.')}>
                Unlink
              </Button>
            </div>
            {bank.link.provider === 'plaid' && bank.plaidSandbox && (
              <div className="mt-5 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
                <h3 className="text-[13px] font-semibold">Plaid sandbox: post a test transaction</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  This account is Plaid's test institution. You can ask Plaid to post a transaction to it and watch it come back through the normal sync. This control disappears on
                  production keys.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Field label="Statement text">
                    <input value={testText} onChange={(e) => setTestText(e.target.value)} placeholder="NETFLIX.COM" className="w-56 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] placeholder:text-faint" />
                  </Field>
                  <Field label="Amount">
                    <input value={testAmount} onChange={(e) => setTestAmount(e.target.value)} inputMode="decimal" placeholder="15.49" className="w-28 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] placeholder:text-faint" />
                  </Field>
                  <Button busy={busy === 'test'} onClick={() => act('test', () => mutate('/api/bank/sandbox-transaction', { description: testText, amount: Number(testAmount) }), describeSync)}>
                    Post and sync
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Option title="Plaid" subtitle="US, Canada, UK and Europe" ready={bank.available.includes('plaid')} missing="Add PLAID_CLIENT_ID and PLAID_SECRET to .env.local (dashboard.plaid.com). Real accounts need Plaid production access; sandbox keys link Plaid's test bank.">
              <p className="text-[13px] leading-relaxed text-muted">You sign in to your bank inside Plaid's own window. Subster receives read-only transaction access and never sees your banking password.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button primary busy={busy === 'plaid'} onClick={linkWithPlaid}>
                  Link my bank with Plaid
                </Button>
                {bank.plaidSandbox && (
                  <Button busy={busy === 'instant'} onClick={() => act('instant', () => mutate('/api/bank/link', { sandbox: true }), describeSync)}>
                    Link Plaid's test bank
                  </Button>
                )}
              </div>
            </Option>
            <Option title="Account Aggregator" subtitle="Indian banks, through Setu" ready={bank.available.includes('setu')} missing="Add SETU_CLIENT_ID, SETU_CLIENT_SECRET and SETU_PRODUCT_INSTANCE_ID to .env.local (bridge.setu.co). Setu only issues production access to RBI, SEBI, IRDAI or PFRDA regulated entities; sandbox keys work with Setu's test banks.">
              <p className="text-[13px] leading-relaxed text-muted">You approve a consent request in your Account Aggregator app. The consent is read-only, time-limited and can be revoked there.</p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="Mobile number registered with your bank">
                  <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" autoComplete="tel-national" placeholder="10 digits" className="w-44 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] placeholder:text-faint" />
                </Field>
                <Button primary busy={busy === 'setu'} onClick={startAggregator}>
                  Request consent
                </Button>
              </div>
            </Option>
          </div>
        )}

        {!bank.link && (
          <p className="mt-4 text-[12px] text-faint">
            Bank not supported yet?{' '}
            <label className="cursor-pointer text-muted underline underline-offset-2 hover:text-ink">
              {busy === 'csv' ? 'Reading the file' : 'Import a statement file instead'}
              <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" className="sr-only" onChange={(e) => uploadStatement(e.target.files?.[0])} />
            </label>
            . HDFC NetBanking: download the statement in the "Delimited" format.
          </p>
        )}

        {bank.candidates.length > 0 && (
          <div className="mt-5">
            <h3 className="text-[12px] font-medium uppercase tracking-[0.12em] text-faint">Regular payments that might be subscriptions</h3>
            <ul className="mt-2 space-y-2">
              {bank.candidates.map((c) => (
                <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-[13px]">
                  <span>
                    <span className="font-medium">{c.name}</span>{' '}
                    <span className="num text-muted">
                      {money(c.amount)} {c.cycle}, seen {c.count} times · looks like {CATEGORY_LABEL[c.category].toLowerCase()}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <Button busy={busy === c.key} onClick={() => act(c.key, () => mutate('/api/bank/candidates', { key: c.key, decision: 'track' }), () => `Now tracking ${c.name}.`)}>
                      Track it
                    </Button>
                    <Button busy={busy === c.key} onClick={() => act(c.key, () => mutate('/api/bank/candidates', { key: c.key, decision: 'ignore' }), () => `${c.name} will be ignored.`)}>
                      Not a subscription
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
          {bank.transactionCount > 0 && (
            <p className="mt-4 text-[12px] text-muted">
              {bank.transactionCount} bank payments imported.{' '}
              <Link to="/transactions" className="text-accent underline-offset-2 hover:underline">
                See them in Transactions
              </Link>
            </p>
          )}
        </Card>

        <Card id="paypal" icon={Banknote} title="PayPal" badge={paypal === 'off' ? 'Not connected' : paypal === 'live' ? 'Live' : 'Sandbox'} live={paypal !== 'off'}>
          {paypal === 'off' ? (
            <>
              <p className="text-[13px] leading-relaxed text-muted">With PayPal connected, Subster starts, pauses, cancels and resumes PayPal agreements you approve, and verifies each change by reading the agreement back. Without it, those changes are handed to you with a link.</p>
              <Steps items={['Create a REST app at developer.paypal.com and copy its client ID and secret.', 'Add PAYPAL_CLIENT_ID and PAYPAL_SECRET to .env.local.', 'Restart the server. This card turns green.']} />
            </>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
                <Fact label="Environment" value={paypal === 'live' ? 'Production' : 'Sandbox'} />
                <Fact label="Agreements managed" value={String(managed.length)} />
                <Fact label="Last webhook" value={lastPayPalEvent ? new Date(lastPayPalEvent.at).toLocaleString() : 'None received'} />
                <Fact label="Can do for you" value="Start, pause, cancel, resume" />
              </dl>
              {managed.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {managed.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 rounded-lg bg-white/[0.04] py-1 pl-1 pr-2.5 text-[12px]">
                      <AppLogo providerId={s.providerId} category={s.category} color={s.color} size={22} /> {s.name} <span className="text-faint">{s.status}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4">
                <span className="mb-1 block text-[11px] text-faint">Webhook address to register in the PayPal dashboard</span>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 truncate rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-[12px]">{origin}/api/paypal/webhook</code>
                  <Button onClick={() => copy('hook', `${origin}/api/paypal/webhook`)}>
                    <Copy size={13} className="mr-1.5 inline" aria-hidden="true" />
                    {copied === 'hook' ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="mt-1.5 text-[12px] text-faint">PayPal can only reach a public https address. On this machine, run the gateway and tunnel and register the tunnel address instead. Events must verify against PAYPAL_WEBHOOK_ID.</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button busy={busy === 'paypal'} onClick={checkPayPal}>
                  <RefreshCw size={14} className="mr-1.5 inline" aria-hidden="true" />
                  Test the connection
                </Button>
                <Link to="/transactions" className="rounded-xl border border-white/10 px-3 py-2 text-[13px] font-medium hover:bg-white/[0.07]">
                  Open the PayPal ledger
                </Link>
              </div>
            </>
          )}
        </Card>
      </Group>

      <Group title="Usage" note="How Subster learns what you actually use. Without usage, a subscription cannot be scored.">
        <section className="panel p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[14px] font-semibold">
              Usage is measured for <span className="num">{measured.length}</span> of <span className="num">{scorable.length}</span> subscriptions
            </h3>
            <span className="text-[12px] text-faint">Essentials such as mobile and broadband are not scored</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]" role="img" aria-label={`${measured.length} of ${scorable.length} measured`}>
            <div className="h-full rounded-full bg-accent" style={{ width: `${scorable.length ? (measured.length / scorable.length) * 100 : 0}%` }} />
          </div>
          {unmeasured.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {unmeasured.map((i) => (
                <li key={i.sub.id} className="flex items-center gap-2 rounded-lg bg-white/[0.04] py-1 pl-1 pr-2.5 text-[12px]" title="No usage reported yet">
                  <AppLogo providerId={i.sub.providerId} category={i.sub.category} color={i.sub.color} size={22} /> {i.sub.name}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-label="Live connections">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
            <div>
              <h3 className="text-[14px] font-semibold">Live connections</h3>
              <p className="text-[12px] text-faint">
                Worked out automatically for every subscription. {state.monitor.extensionSeenAt ? `Browser extension last called in ${since(state.monitor.extensionSeenAt)}.` : 'The browser extension has not called in yet.'}{' '}
                {state.monitor.checkedAt ? `PayPal and linked accounts verified ${since(state.monitor.checkedAt)}.` : ''}
              </p>
            </div>
            <Button busy={busy === 'verify'} onClick={() => act('verify', () => mutate('/api/presence', undefined, 'PUT'), (data) => ((data as { changes?: string[] }).changes?.length ? (data as { changes: string[] }).changes.join(' ') : 'Everything verified. Nothing changed.'))}>
              <RefreshCw size={14} className="mr-1.5 inline" aria-hidden="true" />
              Verify now
            </Button>
          </div>
          {subs.length === 0 ? (
            <p className="px-5 py-5 text-[13px] text-muted">Track a subscription and it shows up here, connecting by itself as your browser and phone report.</p>
          ) : (
            <ul className="grid gap-x-6 px-5 py-2 sm:grid-cols-2 xl:grid-cols-3">
              {subs.map((s) => {
                const connection = state.connections[s.id];
                return (
                  <li key={s.id} className="flex items-center gap-2.5 border-b border-white/[0.04] py-2 text-[13px]">
                    <AppLogo providerId={s.providerId} category={s.category} color={s.color} size={24} />
                    <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                    {connection && <ConnectionBadge connection={connection} />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card id="browser" icon={Globe} title="Browser extension" badge={web.days > 0 ? `Last report ${ago(web.last)}` : 'Not reporting'} live={web.days > 0}>
            <p className="text-[13px] leading-relaxed text-muted">Reports live when one of your subscription sites is open, measures time on it (including music in a background tab), and checks whether you are signed in there. It sends totals and yes or no answers only: no page addresses, titles, content or cookie values.</p>
            {web.days > 0 ? (
              <dl className="mt-3 grid grid-cols-3 gap-x-6 text-[13px]">
                <Fact label="Subscriptions reported" value={String(web.subs)} />
                <Fact label="Day totals" value={String(web.days)} />
                <Fact label="Sites it can measure" value={String(webSites.length)} />
              </dl>
            ) : (
              <Steps items={['Open chrome://extensions and turn on Developer mode.', 'Choose "Load unpacked" and pick the extension folder of this project.', `Open its popup and press "Sync now". It reports to ${origin || 'this server'}.`, 'Press "Monitor sign-in" in the popup to let it tell signed in from signed out on those sites.']} />
            )}
            <SiteList label="It measures" empty="None of your subscriptions has a site of its own to measure." items={webSites.map((s) => ({ sub: s, text: sitesOf(s).join(', ') }))} />
          </Card>

          <Card id="phone" icon={Smartphone} title="Android companion" badge={phone.days > 0 ? `Last report ${ago(phone.last)}` : 'Not reporting'} live={phone.days > 0}>
            <p className="text-[13px] leading-relaxed text-muted">Reports daily screen time for your subscription apps only, read from Android&apos;s own usage statistics. No titles, content or passwords.</p>
            {phone.days > 0 ? (
              <dl className="mt-3 grid grid-cols-3 gap-x-6 text-[13px]">
                <Fact label="Subscriptions reported" value={String(phone.subs)} />
                <Fact label="Day totals" value={String(phone.days)} />
                <Fact label="Apps it can measure" value={String(phoneApps.length)} />
              </dl>
            ) : (
              <Steps items={['Build the app in the android folder and install it on your phone.', 'With the phone on USB, run: adb reverse tcp:3000 tcp:3000, and keep the server address as http://localhost:3000.', 'Allow usage access when the app asks, then tap "Sync now".']} />
            )}
            <SiteList label="It measures" empty="None of your subscriptions has an Android app in the catalog." items={phoneApps.map((s) => ({ sub: s, text: s.androidPackage! }))} />
          </Card>
        </div>

        <Card id="accounts" icon={KeyRound} title="Linked accounts" badge={`${state.accounts.length}`}>
          <p className="text-[13px] leading-relaxed text-muted">Your own account at a provider, linked through the provider&apos;s sign-in. Subster never asks for a provider password.</p>
          {state.accounts.length > 0 && (
            <ul className="mt-3 divide-y divide-white/[0.05]">
              {state.accounts.map((a) => {
                const app = providerById(a.providerId);
                return (
                  <li key={a.providerId} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]">
                    <AppLogo providerId={a.providerId} category={app?.category ?? 'Other'} color={app?.color ?? '#0473fd'} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{app?.name ?? a.providerId}</span>
                      <span className="block text-[12px] text-muted">
                        {a.method === 'oauth' ? `Signed in${a.displayName ? ` as ${a.displayName}` : ''}${a.product ? `, ${a.product} plan` : ''}` : 'You confirmed you are signed in on its site'}
                        {a.lastSyncAt ? ` · synced ${new Date(a.lastSyncAt).toLocaleString()}` : ''}
                      </span>
                    </span>
                    {a.method === 'oauth' && a.providerId === 'spotify' && (
                      <Button busy={busy === `sync-${a.providerId}`} onClick={() => act(`sync-${a.providerId}`, () => mutate('/api/accounts/link', { providerId: a.providerId, action: 'sync' }), () => 'Listening history synced.')}>
                        Sync
                      </Button>
                    )}
                    <Button busy={busy === `unlink-${a.providerId}`} onClick={() => act(`unlink-${a.providerId}`, () => mutate('/api/accounts/link', { providerId: a.providerId, action: 'unlink' }), () => 'Account removed.')}>
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {state.integrations.spotify && !state.accounts.some((a) => a.providerId === 'spotify') && (
              <a href="/api/accounts/spotify/start" className="inline-flex items-center gap-2 rounded-xl bg-[#1ed760] px-3 py-2 text-[13px] font-semibold text-black hover:opacity-90">
                <KeyRound size={14} aria-hidden="true" /> Sign in with Spotify
              </a>
            )}
            <Link to="/services" className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-[13px] font-medium hover:bg-white/[0.07]">
              Link an account from Services <ExternalLink size={13} aria-hidden="true" />
            </Link>
            {!state.integrations.spotify && <span className="text-[12px] text-faint">Spotify sign-in needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.local.</span>}
          </div>
        </Card>
      </Group>

      <Group title="Intelligence" note="What reasons over your data.">
        <Card id="agent" icon={Bot} title="Agent and live prices" badge={state.integrations.agent === 'gemini' ? 'Gemini' : 'Rules engine'} live={state.integrations.agent === 'gemini'}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
            <Fact label="Agent engine" value={state.integrations.agent === 'gemini' ? 'Gemini, with tools' : 'Built-in rules'} />
            <Fact label="Agent runs" value={String(state.runs.length)} />
            <Fact label="Services with live prices" value={String(liveChecks.filter((l) => l.status === 'ok').length)} />
            <Fact label="Price checks failing" value={String(liveChecks.filter((l) => l.error).length)} />
          </dl>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            {state.integrations.agent === 'gemini'
              ? 'The agent reads your subscriptions through tools and can only propose: every change waits for you. Live prices are read from each provider\'s official site with Google Search grounding.'
              : 'No Gemini key is set, so recommendations come from the built-in rules and prices from the built-in catalog. Add GEMINI_API_KEY to .env.local for the agent and live prices.'}
          </p>
          {state.integrations.agent === 'gemini' && (
            <div className="mt-3">
              <div className="flex items-baseline justify-between text-[12px] text-muted">
                <span>
                  Free AI allowance today, across {state.integrations.ai.keys} key{state.integrations.ai.keys === 1 ? '' : 's'}
                </span>
                <span className="num">
                  {state.integrations.ai.sentToday} of about {state.integrations.ai.dailyAllowance} requests used
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]" role="img" aria-label={`${state.integrations.ai.sentToday} of about ${state.integrations.ai.dailyAllowance} requests used`}>
                <div className={`h-full rounded-full ${state.integrations.ai.availableAgainAt ? 'bg-bad' : 'bg-accent'}`} style={{ width: `${state.integrations.ai.availableAgainAt ? 100 : Math.min(100, (state.integrations.ai.sentToday / Math.max(1, state.integrations.ai.dailyAllowance)) * 100)}%` }} />
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
                {state.integrations.ai.availableAgainAt
                  ? `Used up on every key. Available again around ${new Date(state.integrations.ai.availableAgainAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Until then recommendations come from the built-in rules.`
                  : `Counted since the server started. An audit uses a handful of requests, a fit check two or three. Add more keys as GEMINI_API_KEYS in .env.local, separated by commas.`}
              </p>
            </div>
          )}
          {liveChecks.find((l) => l.error) && <p className="mt-2 text-[12px] leading-relaxed text-warn">Latest price check problem: {liveChecks.find((l) => l.error)!.error}</p>}
        </Card>
      </Group>

      <Group title="Preferences and data" note="Everything is stored on this machine.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card icon={Settings2} title="Your currency">
            <p className="text-[13px] leading-relaxed text-muted">The currency your own payments are in. Amounts are shown as charged and never converted. Services shows prices for the matching region.</p>
            <div className="mt-3 flex gap-1.5" role="group" aria-label="Currency">
              {(['INR', 'USD', 'EUR', 'GBP'] as Currency[]).map((c) => (
                <button
                  key={c}
                  onClick={() => act('currency', () => mutate('/api/settings', { currency: c }), () => `Amounts are now shown in ${c}.`)}
                  aria-pressed={state.settings.currency === c}
                  className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium ${state.settings.currency === c ? 'border-accent bg-accent-soft text-accent' : 'border-white/10 text-muted hover:text-ink'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </Card>

          <Card icon={FlaskConical} title="Demo data" badge={state.demo ? 'Open' : 'Off'} live={state.demo}>
            <p className="text-[13px] leading-relaxed text-muted">
              {state.demo
                ? 'You are looking at sample data: 13 made-up subscriptions with a year of payments and 60 days of usage. Your own data is set aside and comes back unchanged when you close the demo.'
                : 'Fills Subster with 13 made-up subscriptions, a year of payments and 60 days of usage. Your own data is set aside, not erased, and comes back when you close the demo.'}
            </p>
            <div className="mt-3">
              <Button busy={busy === 'demo'} onClick={() => act('demo', () => mutate('/api/demo', { open: !state.demo }), () => (state.demo ? 'Demo closed. Your own data is back.' : 'Demo data is open. Savings and Transactions now have something to show.'))}>
                {state.demo ? 'Close demo and restore my data' : 'Open demo data'}
              </Button>
            </div>
          </Card>
        </div>

        <Card icon={Activity} title="Recent activity" badge={`${webhookLog.length}`}>
          {webhookLog.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing yet. Bank syncs and PayPal webhooks are listed here as they are handled.</p>
          ) : (
            <ul className="divide-y divide-white/[0.05] text-[12px]">
              {webhookLog.map((e, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                  <span className="num text-faint">{new Date(e.at).toLocaleString()}</span>
                  <span className={`rounded px-1.5 text-[11px] font-medium uppercase ${e.source === 'bank' ? 'bg-info-soft text-info' : 'bg-warn-soft text-warn'}`}>{e.source}</span>
                  <span className="font-mono text-[11px] text-muted">{e.type}</span>
                  <span className="min-w-0 flex-1">{e.handled}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] px-4 py-3">
          <p className="text-[13px] text-muted">
            <span className="num">{subs.length}</span> subscriptions, <span className="num">{state.charges.length}</span> payments and <span className="num">{state.usage.length}</span> usage records are stored.
          </p>
          <div className="flex gap-2">
            <Button onClick={exportData}>
              <Download size={14} className="mr-1.5 inline" aria-hidden="true" />
              Export my data
            </Button>
            <button
              onClick={() => {
                if (window.confirm(state.demo ? 'Empty the demo data? Your own data is not affected.' : 'Erase every subscription, payment, usage record and link stored by Subster on this machine? This cannot be undone.')) void act('reset', () => mutate('/api/reset'), () => (state.demo ? 'Demo data emptied.' : 'All data erased.'));
              }}
              className="flex items-center gap-1.5 rounded-xl border border-bad/30 px-3 py-2 text-[13px] font-medium text-bad hover:bg-bad-soft"
            >
              <Trash2 size={14} aria-hidden="true" />
              {state.demo ? 'Empty the demo' : 'Erase all my data'}
            </button>
          </div>
        </div>
      </Group>
    </div>
  );
}

function Health({ href, icon: Icon, name, ok, status, detail }: { href: string; icon: typeof Landmark; name: string; ok: boolean; status: string; detail: string }) {
  return (
    <a href={href} className="panel block px-3.5 py-3 transition-colors hover:bg-white/[0.05]">
      <span className="flex items-center justify-between text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <Icon size={14} strokeWidth={1.75} aria-hidden="true" /> {name}
        </span>
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-good' : 'bg-warn'}`} aria-hidden="true" />
      </span>
      <span className="mt-1.5 block truncate text-[14px] font-semibold">{status}</span>
      <span className="num block truncate text-[11px] text-faint">{detail}</span>
    </a>
  );
}

function Group({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4" aria-label={title}>
      <div className="flex flex-wrap items-baseline gap-x-3 border-b border-white/[0.06] pb-2">
        <h2 className="text-[13px] font-medium uppercase tracking-[0.14em] text-faint">{title}</h2>
        <p className="text-[12px] text-faint">{note}</p>
      </div>
      {children}
    </section>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="mt-3 space-y-1.5 text-[13px]">
      {items.map((item, i) => (
        <li key={item} className="flex gap-2.5">
          <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-semibold">{i + 1}</span>
          <span className="leading-relaxed">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function SiteList({ label, empty, items }: { label: string; empty: string; items: { sub: { id: string; name: string; providerId?: string; category: Subscription['category']; color: string }; text: string }[] }) {
  return (
    <div className="mt-4 border-t border-white/[0.06] pt-3">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{label}</h3>
      {items.length === 0 ? (
        <p className="mt-1.5 text-[12px] text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map(({ sub, text }) => (
            <li key={sub.id} className="flex items-center gap-2 text-[12px]">
              <AppLogo providerId={sub.providerId} category={sub.category} color={sub.color} size={20} />
              <span className="font-medium">{sub.name}</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-faint">{text}</span>
              <Check size={12} className="ml-auto shrink-0 text-faint" aria-hidden="true" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Card({ id, icon: Icon, title, badge, live, children }: { id?: string; icon: typeof Landmark; title: string; badge?: string; live?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} className="panel scroll-mt-6 p-5">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-[15px] font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.07]">
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
          </span>
          {title}
        </h2>
        {badge && (
          <span className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-muted">
            {live !== undefined && <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-good' : 'bg-warn'}`} aria-hidden="true" />}
            {badge}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function Option({ title, subtitle, ready, missing, children }: { title: string; subtitle: string; ready: boolean; missing: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
      <h3 className="text-[14px] font-semibold">{title}</h3>
      <p className="mb-2 text-[12px] text-faint">{subtitle}</p>
      {ready ? children : <p className="text-[12px] leading-relaxed text-warn">{missing}</p>}
    </div>
  );
}

function Button({ children, onClick, busy, primary }: { children: React.ReactNode; onClick: () => void; busy?: boolean; primary?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} className={`rounded-xl px-3 py-2 text-[13px] font-medium transition-opacity disabled:opacity-50 ${primary ? 'bg-accent font-semibold text-canvas hover:opacity-90' : 'border border-white/10 hover:bg-white/[0.07]'}`}>
      {busy ? 'Working' : children}
    </button>
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
