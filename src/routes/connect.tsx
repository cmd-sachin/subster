import { createFileRoute } from '@tanstack/react-router';
import { Activity, Banknote, FileUp, Landmark, RefreshCw, Settings2, Smartphone, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp, type MutateResult } from '@/components/app-state';
import { CATEGORY_LABEL } from '@/domain/catalog';
import { money, shortDate } from '@/domain/dates';
import type { Currency } from '@/domain/types';

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

function Connections() {
  const { state, mutate } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [mobile, setMobile] = useState('');
  const [testText, setTestText] = useState('');
  const [testAmount, setTestAmount] = useState('');
  if (!state) return <p className="p-8 text-muted">Loading connections</p>;

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
    <div className="mx-auto max-w-[1100px] space-y-5 px-4 py-7 md:px-8">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">Connections</h1>
        <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-muted">
          SubSense holds only your own data. Streaming, telecom and software companies do not expose billing APIs, so it follows the money: your bank account, your statements and your
          PayPal agreements.
        </p>
      </header>

      {(notice || returned) && (
        <p role="status" className={`rise rounded-xl px-4 py-3 text-[13px] leading-relaxed ${(notice ? notice.ok : returned === 'linked') ? 'bg-accent-soft text-ink' : 'bg-bad-soft text-bad'}`}>
          {notice?.text ?? (returned === 'linked' ? 'Your bank account is linked and synced.' : returned === 'declined' ? 'The consent request was not approved, so nothing was linked.' : 'The bank link could not be completed. See Logs for the reason.')}
        </p>
      )}

      <Card icon={Landmark} title="Bank account" badge={bank.link ? 'Linked' : 'Not linked'} live={Boolean(bank.link)}>
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
              <p className="text-[13px] leading-relaxed text-muted">You sign in to your bank inside Plaid's own window. SubSense receives read-only transaction access and never sees your banking password.</p>
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

        {bank.recent.length > 0 && (
          <div className="mt-5">
            <h3 className="text-[12px] font-medium uppercase tracking-[0.12em] text-faint">
              Latest payments <span className="num normal-case tracking-normal">({bank.transactionCount} imported in total)</span>
            </h3>
            <ul className="mt-2 divide-y divide-white/[0.05] text-[13px]">
              {bank.recent.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="num w-16 shrink-0 text-faint">{shortDate(t.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{t.description}</span>
                  {t.subId && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">subscription</span>}
                  <span className="num w-24 text-right">{money(t.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card icon={FileUp} title="Bank or card statement" badge="Works with any bank">
        <p className="text-[13px] leading-relaxed text-muted">
          Download your statement from net banking as CSV (or delimited text) and upload it. HDFC, ICICI, SBI, Axis, Kotak and US or European layouts are recognised, including separate
          withdrawal and deposit columns. Only payments leaving the account are read, and uploading the same file twice changes nothing. Six months or more gives the best detection. In
          HDFC NetBanking, open the account statement, pick the period and download it in the "Delimited" format (not PDF or Excel).
        </p>
        <label className="mt-3 inline-block cursor-pointer rounded-xl bg-accent px-3.5 py-2 text-[13px] font-semibold text-canvas hover:opacity-90">
          {busy === 'csv' ? 'Reading' : 'Upload a statement'}
          <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" className="sr-only" onChange={(e) => uploadStatement(e.target.files?.[0])} />
        </label>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card icon={Banknote} title="PayPal" badge={paypal === 'off' ? 'Not connected' : paypal === 'live' ? 'Live' : 'Sandbox'} live={paypal !== 'off'}>
          <p className="text-[13px] leading-relaxed text-muted">
            {paypal === 'off'
              ? 'Add PAYPAL_CLIENT_ID and PAYPAL_SECRET to .env.local to let SubSense start, pause and cancel PayPal agreements you approve. Until then those actions are handed to you with a link.'
              : `Connected to PayPal ${paypal === 'live' ? 'production' : 'sandbox'}. Approved subscribe, pause, cancel and resume actions call the Subscriptions API and are verified by reading the agreement back. Webhooks are accepted at /api/paypal/webhook and must verify against PAYPAL_WEBHOOK_ID.`}
          </p>
        </Card>

        <Card icon={Smartphone} title="Usage: Android companion" badge={state.usage.length > 0 ? `${state.usage.length} day totals` : 'No usage yet'} live={state.usage.length > 0}>
          <p className="text-[13px] leading-relaxed text-muted">
            Install the companion app from the android folder, grant usage access and point it at this server. It reports daily screen time for your subscription apps only: no titles,
            content or passwords. Without it, value scores stay "not measured".
          </p>
        </Card>
      </div>

      <Card icon={Settings2} title="Your currency">
        <p className="text-[13px] leading-relaxed text-muted">The currency your own payments are in. Amounts are shown as they were charged and are never converted. It is set from your first statement when that names one.</p>
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

      <Card icon={Activity} title="Bank and PayPal events" badge={`${webhookLog.length}`}>
        {webhookLog.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing yet. Bank syncs and PayPal webhooks are recorded here as they are handled. The Logs page has the full detail.</p>
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

      <div className="flex justify-end">
        <button
          onClick={() => {
            if (window.confirm('Erase every subscription, payment, usage record and link stored by SubSense on this machine? This cannot be undone.')) void act('reset', () => mutate('/api/reset'), () => 'All data erased.');
          }}
          className="flex items-center gap-1.5 rounded-xl border border-bad/30 px-3 py-2 text-[13px] font-medium text-bad hover:bg-bad-soft"
        >
          <Trash2 size={14} aria-hidden="true" />
          Erase all my data
        </button>
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, badge, live, children }: { icon: typeof Landmark; title: string; badge?: string; live?: boolean; children: React.ReactNode }) {
  return (
    <section className="panel p-5">
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
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
