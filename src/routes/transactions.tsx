import { createFileRoute, Link } from '@tanstack/react-router';
import { AlertTriangle, Check, Copy, Download, ExternalLink, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppLogo } from '@/components/app-logo';
import { useApp } from '@/components/app-state';
import { addDays, cycleShort, diffDays, money, shortDate, today } from '@/domain/dates';
import type { AppState, Charge, PaymentRail, RefundReason, RefundRequest, Subscription } from '@/domain/types';

export const Route = createFileRoute('/transactions')({ component: Transactions });

const RAIL_LABEL: Record<PaymentRail, string> = { paypal: 'PayPal', card: 'Card', bank: 'Bank account' };
const REFUND_LABEL: Record<RefundRequest['status'], string> = { drafted: 'Refund drafted', sent: 'Refund requested', refunded: 'Refunded', declined: 'Refund declined' };
const REASONS: [RefundReason, string][] = [
  ['unused_renewal', 'It renewed and I have not used it'],
  ['charged_after_cancel', 'I was charged after cancelling'],
  ['trial_converted', 'A free trial turned into a paid plan'],
  ['duplicate_charge', 'I was charged twice'],
  ['price_changed', 'The price changed without my agreement'],
  ['other', 'Another reason'],
];
const PERIODS = [
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['365', 'Last 12 months'],
  ['all', 'All time'],
] as const;
type StatusFilter = 'all' | 'paid' | 'failed' | 'refunded' | 'refund_open';
type Tab = 'payments' | 'upcoming' | 'bank' | 'paypal';

interface PayPalRow {
  id: string;
  date: string;
  amount: number;
  currency: string;
  status: string;
  subject: string;
}

function Transactions() {
  const { state, mutate } = useApp();
  const [tab, setTab] = useState<Tab>('payments');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>('90');
  const [openId, setOpenId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const subs = useMemo(() => new Map((state?.portfolio.insights ?? []).map((i) => [i.sub.id, i.sub])), [state]);
  if (!state) return <p className="p-8 text-muted">Loading transactions</p>;

  const now = today();
  const refundOf = (chargeId: string) => state.refunds.find((r) => r.chargeId === chargeId);
  const openRefunds = state.refunds.filter((r) => r.status === 'drafted' || r.status === 'sent');
  const charges = [...state.charges].sort((a, b) => b.date.localeCompare(a.date));
  const since = period === 'all' ? '' : addDays(now, -Number(period));
  const needle = query.trim().toLowerCase();
  const visible = charges.filter((c) => {
    const sub = subs.get(c.subId);
    const refund = refundOf(c.id);
    if (c.date < since) return false;
    if (status === 'refund_open' ? !(refund && (refund.status === 'drafted' || refund.status === 'sent')) : status !== 'all' && c.status !== status) return false;
    return !needle || `${sub?.name ?? ''} ${sub?.plan ?? ''} ${RAIL_LABEL[c.rail]} ${c.amount}`.toLowerCase().includes(needle);
  });

  const last30 = charges.filter((c) => c.date > addDays(now, -30));
  const paid30 = last30.filter((c) => c.status === 'paid').reduce((t, c) => t + c.amount, 0);
  // A failed payment matters while it is the latest one for a subscription that is still running.
  const failing = [...subs.values()]
    .filter((s) => s.status !== 'cancelled')
    .map((s) => charges.find((c) => c.subId === s.id))
    .filter((c): c is Charge => c?.status === 'failed');
  const refundedTotal = charges.filter((c) => c.status === 'refunded').reduce((t, c) => t + c.amount, 0);
  const open = openId ? charges.find((c) => c.id === openId) : undefined;

  function exportCsv() {
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['Date', 'Subscription', 'Plan', 'Paid with', 'Amount', 'Currency', 'Status', 'Refund request']];
    for (const c of visible) rows.push([c.date, subs.get(c.subId)?.name ?? '', subs.get(c.subId)?.plan ?? '', RAIL_LABEL[c.rail], String(c.amount), state!.settings.currency, c.status, refundOf(c.id)?.status ?? '']);
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `subster-payments-${now}.csv` });
    link.click();
    URL.revokeObjectURL(url);
  }

  const tabs: [Tab, string, number?][] = [
    ['payments', 'Payments', charges.length],
    ['upcoming', 'Upcoming', state.portfolio.upcoming.length],
    ['bank', 'Bank feed', state.integrations.bank.transactionCount],
    ...(state.integrations.paypal !== 'off' ? ([['paypal', 'PayPal ledger']] as [Tab, string][]) : []),
  ];

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 px-4 py-6 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Payments, refunds and cancellations</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">Transactions</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} disabled={visible.length === 0} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[13px] font-medium hover:bg-white/[0.07] disabled:opacity-40">
            <Download size={14} aria-hidden="true" /> Export CSV
          </button>
          <button onClick={() => setRecording(true)} disabled={subs.size === 0} className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40">
            <Plus size={15} strokeWidth={2.5} aria-hidden="true" /> Record a payment
          </button>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Paid, last 30 days" value={money(Math.round(paid30 * 100) / 100)} detail={`${last30.filter((c) => c.status === 'paid').length} payments`} />
        <Tile label="Due, next 30 days" value={money(Math.round(state.portfolio.next30Total * 100) / 100)} detail={`${state.portfolio.upcoming.length} charges coming`} />
        <Tile label="Failed payments" value={String(failing.length)} detail={failing.length ? 'Fix or cancel below' : 'Nothing is failing'} tone={failing.length ? 'bad' : undefined} />
        <Tile label="Refunds" value={String(openRefunds.length)} detail={`in progress${refundedTotal > 0 ? ` · ${money(refundedTotal)} received` : ''}`} tone={openRefunds.length ? 'warn' : undefined} />
      </dl>

      {(failing.length > 0 || openRefunds.length > 0) && (
        <section className="panel" aria-label="Needs attention">
          <h2 className="border-b border-white/[0.06] px-4 py-3 text-[14px] font-semibold">Needs attention</h2>
          <ul>
            {failing.map((c) => (
              <Attention key={c.id} sub={subs.get(c.subId)} tone="bad" title={`Payment of ${money(c.amount)} failed on ${shortDate(c.date)}`} detail="The provider may stop the service. Update the payment method, or cancel if you no longer want it." cta="Get help" onOpen={() => setOpenId(c.id)} />
            ))}
            {openRefunds.map((r) => (
              <Attention
                key={r.id}
                sub={subs.get(r.subId)}
                tone="warn"
                title={`${REFUND_LABEL[r.status]}: ${money(r.amount)}`}
                detail={r.status === 'drafted' ? 'The request is written but not sent yet.' : `Sent ${diffDays(now, r.updatedAt.slice(0, 10))} days ago. Record the answer when it arrives.`}
                cta={r.status === 'drafted' ? 'Send it' : 'Update'}
                onOpen={() => setOpenId(r.chargeId)}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2.5">
          <div className="flex gap-1" role="tablist" aria-label="Transaction views">
            {tabs.map(([id, label, count]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${tab === id ? 'bg-white/[0.08] text-ink' : 'text-muted hover:text-ink'}`}>
                {label}
                {count !== undefined && <span className="num ml-1.5 text-faint">{count}</span>}
              </button>
            ))}
          </div>
          {tab === 'payments' && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative">
                <span className="sr-only">Search payments</span>
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="w-40 rounded-lg border border-white/10 bg-black/30 py-1.5 pl-8 pr-2 text-[13px] placeholder:text-faint" />
              </label>
              <Select label="Status" value={status} onChange={(v) => setStatus(v as StatusFilter)} options={[['all', 'Any status'], ['paid', 'Paid'], ['failed', 'Failed'], ['refunded', 'Refunded'], ['refund_open', 'Refund in progress']]} />
              <Select label="Period" value={period} onChange={(v) => setPeriod(v as typeof period)} options={PERIODS} />
            </div>
          )}
        </div>

        {tab === 'payments' && (
          <PaymentsTable charges={visible} total={charges.length} subs={subs} refundOf={refundOf} onOpen={setOpenId} />
        )}
        {tab === 'upcoming' && <Upcoming state={state} subs={subs} mutate={mutate} />}
        {tab === 'bank' && <BankFeed state={state} subs={subs} />}
        {tab === 'paypal' && <PayPalLedger />}
      </section>

      {open && <Help charge={open} sub={subs.get(open.subId)} refund={refundOf(open.id)} state={state} onClose={() => setOpenId(null)} />}
      {recording && <Record subs={[...subs.values()]} currency={state.settings.currency} onClose={() => setRecording(false)} />}
    </div>
  );
}

function Tile({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className="panel px-4 py-3.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={`num mt-1 text-[24px] font-semibold tracking-tight ${tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : ''}`}>{value}</dd>
      <dd className="num text-[12px] text-faint">{detail}</dd>
    </div>
  );
}

function Attention({ sub, tone, title, detail, cta, onOpen }: { sub?: Subscription; tone: 'bad' | 'warn'; title: string; detail: string; cta: string; onOpen: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0">
      <AlertTriangle size={16} className={tone === 'bad' ? 'text-bad' : 'text-warn'} aria-hidden="true" />
      <AppLogo providerId={sub?.providerId} category={sub?.category ?? 'Other'} color={sub?.color ?? '#0473fd'} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">
          {sub?.name}: {title}
        </span>
        <span className="block text-[12px] text-muted">{detail}</span>
      </span>
      <button onClick={onOpen} className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-medium hover:bg-white/[0.07]">
        {cta}
      </button>
    </li>
  );
}

function Select<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: string) => void; options: readonly (readonly [string, string])[] }) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[13px]">
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusPill({ charge, refund }: { charge: Charge; refund?: RefundRequest }) {
  const openRefund = refund && (refund.status === 'drafted' || refund.status === 'sent' || refund.status === 'declined');
  const [text, look] = openRefund
    ? [REFUND_LABEL[refund.status], refund.status === 'declined' ? 'bg-white/[0.06] text-muted' : 'bg-warn-soft text-warn']
    : charge.status === 'paid'
      ? ['Paid', 'bg-white/[0.06] text-muted']
      : charge.status === 'failed'
        ? ['Failed', 'bg-bad-soft text-bad']
        : ['Refunded', 'bg-accent-soft text-accent'];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${look}`}>{text}</span>;
}

function PaymentsTable({ charges, total, subs, refundOf, onOpen }: { charges: Charge[]; total: number; subs: Map<string, Subscription>; refundOf: (id: string) => RefundRequest | undefined; onOpen: (id: string) => void }) {
  if (total === 0) {
    return (
      <p className="px-4 py-8 text-[13px] leading-relaxed text-muted">
        No payments yet. They appear when your bank or PayPal reports one, or you can record one yourself.{' '}
        <Link to="/connect" className="text-accent underline-offset-2 hover:underline">
          Connect a source
        </Link>
        .
      </p>
    );
  }
  if (charges.length === 0) return <p className="px-4 py-8 text-[13px] text-muted">No payments match these filters.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="text-[11px] uppercase tracking-wide text-faint">
          <tr>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-2 py-2 font-medium">Subscription</th>
            <th className="px-2 py-2 font-medium">Paid with</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 text-right font-medium">Amount</th>
            <th className="px-4 py-2">
              <span className="sr-only">Help</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {charges.slice(0, 200).map((c) => {
            const sub = subs.get(c.subId);
            return (
              <tr key={c.id} className="border-t border-white/[0.05] hover:bg-white/[0.03]">
                <td className="num whitespace-nowrap px-4 py-2.5 text-muted">{shortDate(c.date)}</td>
                <td className="px-2 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <AppLogo providerId={sub?.providerId} category={sub?.category ?? 'Other'} color={sub?.color ?? '#0473fd'} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{sub?.name ?? 'Removed subscription'}</span>
                      <span className="block truncate text-[12px] text-faint">{sub?.plan}</span>
                    </span>
                  </span>
                </td>
                <td className="px-2 py-2.5 text-muted">{RAIL_LABEL[c.rail]}</td>
                <td className="px-2 py-2.5">
                  <StatusPill charge={c} refund={refundOf(c.id)} />
                </td>
                <td className={`num px-2 py-2.5 text-right font-medium ${c.status === 'failed' ? 'text-faint line-through' : ''}`}>{money(c.amount)}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => onOpen(c.id)} className="rounded-lg border border-white/10 px-2.5 py-1 text-[12px] font-medium hover:bg-white/[0.07]">
                    Help
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {charges.length > 200 && <p className="px-4 py-2 text-[12px] text-faint">Showing the latest 200 of {charges.length}. Narrow the period or export to see the rest.</p>}
    </div>
  );
}

function Upcoming({ state, subs, mutate }: { state: AppState; subs: Map<string, Subscription>; mutate: ReturnType<typeof useApp>['mutate'] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  if (state.portfolio.upcoming.length === 0) return <p className="px-4 py-8 text-[13px] text-muted">No charges are due in the next 30 days.</p>;

  async function act(subId: string, action: 'cancel' | 'pause', name: string) {
    setBusy(subId);
    const res = await mutate('/api/transactions', { intent: 'act', subId, action });
    setNotice(res.ok ? { ok: true, text: `${action === 'cancel' ? 'Cancellation' : 'Pause'} started for ${name}. If a step is left for you, it is in the Command center inbox.` } : { ok: false, text: res.error ?? 'Something went wrong' });
    setBusy(null);
  }

  return (
    <>
      {notice && (
        <p role="status" className={`border-b border-white/[0.06] px-4 py-2 text-[13px] ${notice.ok ? 'bg-accent-soft' : 'bg-bad-soft text-bad'}`}>
          {notice.text}
        </p>
      )}
      <ul>
        {state.portfolio.upcoming.map((u) => {
          const sub = subs.get(u.subId);
          const days = diffDays(u.date, today());
          return (
            <li key={`${u.subId}-${u.date}`} className="flex flex-wrap items-center gap-3 border-b border-white/[0.05] px-4 py-3 last:border-b-0">
              <AppLogo providerId={sub?.providerId} category={sub?.category ?? 'Other'} color={sub?.color ?? '#0473fd'} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{u.name}</span>
                <span className="num block text-[12px] text-muted">
                  {u.kind === 'trial_conversion' ? 'Free trial starts charging' : 'Renews'} {shortDate(u.date)}, {days <= 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}
                </span>
              </span>
              <span className="num text-[14px] font-semibold">{money(u.amount)}</span>
              <span className="flex gap-2">
                <button onClick={() => act(u.subId, 'pause', u.name)} disabled={busy !== null || sub?.status === 'trial'} className="rounded-lg border border-white/10 px-2.5 py-1 text-[12px] font-medium hover:bg-white/[0.07] disabled:opacity-40">
                  Pause
                </button>
                <button onClick={() => act(u.subId, 'cancel', u.name)} disabled={busy !== null} className="rounded-lg border border-bad/30 px-2.5 py-1 text-[12px] font-medium text-bad hover:bg-bad-soft disabled:opacity-40">
                  {busy === u.subId ? 'Working' : 'Cancel before this charge'}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function BankFeed({ state, subs }: { state: AppState; subs: Map<string, Subscription> }) {
  if (state.bankTransactions.length === 0) {
    return (
      <p className="px-4 py-8 text-[13px] leading-relaxed text-muted">
        Nothing imported from a bank yet.{' '}
        <Link to="/connect" className="text-accent underline-offset-2 hover:underline">
          Link your bank
        </Link>{' '}
        and every payment it reports is listed here, with the ones that belong to a subscription marked.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-white/[0.05] text-[13px]">
      {state.bankTransactions.slice(0, 200).map((t) => (
        <li key={t.id} className="flex items-center gap-3 px-4 py-2">
          <span className="num w-16 shrink-0 text-faint">{shortDate(t.date)}</span>
          <span className="min-w-0 flex-1 truncate">{t.description}</span>
          {t.subId && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">{subs.get(t.subId)?.name ?? 'subscription'}</span>}
          <span className="num w-24 text-right">{money(t.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

function PayPalLedger() {
  const [rows, setRows] = useState<PayPalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/paypal/transactions')
      .then(async (res) => ({ ok: res.ok, data: (await res.json()) as { transactions?: PayPalRow[]; error?: string } }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        setRows(data.transactions ?? []);
        if (!ok) setError(data.error ?? 'PayPal did not answer.');
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="px-4 py-8 text-[13px] text-bad">Could not read the PayPal ledger: {error}</p>;
  if (rows === null) return <p className="px-4 py-8 text-[13px] text-muted">Asking PayPal for the last 30 days</p>;
  if (rows.length === 0) return <p className="px-4 py-8 text-[13px] text-muted">PayPal reports no transactions on this account in the last 30 days.</p>;
  return (
    <ul className="divide-y divide-white/[0.05] text-[13px]">
      {rows.map((t) => (
        <li key={t.id} className="flex items-center gap-3 px-4 py-2">
          <span className="num w-16 shrink-0 text-faint">{shortDate(t.date.slice(0, 10))}</span>
          <span className="min-w-0 flex-1 truncate">{t.subject || 'No description'}</span>
          <span className="font-mono text-[11px] text-faint">{t.id}</span>
          <span className="num w-28 text-right">
            {t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {t.currency}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The side panel for one payment: what it was, and what can be done about it. */
function Help({ charge, sub, refund, state, onClose }: { charge: Charge; sub?: Subscription; refund?: RefundRequest; state: AppState; onClose: () => void }) {
  const { mutate } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [reason, setReason] = useState<RefundReason>('unused_renewal');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    setNotice(null);
    const res = await mutate('/api/transactions', body);
    setNotice({ ok: res.ok, text: res.ok ? done : (res.error ?? 'Something went wrong') });
    setBusy(null);
    return res.ok;
  }

  const insight = state.portfolio.insights.find((i) => i.sub.id === charge.subId);
  // A cancel, pause or payment fix that was approved and now needs the user on the provider's site.
  const guided = state.actions.find((a) => a.subId === charge.subId && a.status === 'guided' && a.type !== 'subscribe');
  const lastAction = state.actions.find((a) => a.subId === charge.subId && (a.status === 'executed' || a.status === 'failed'));
  const live = sub && sub.status !== 'cancelled';
  const age = diffDays(today(), charge.date);
  const refundOpen = refund && (refund.status === 'drafted' || refund.status === 'sent');
  const manual = !charge.paypalTransactionId;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Payment help" onClick={(e) => e.stopPropagation()} className="rise flex h-full w-full max-w-[480px] flex-col overflow-y-auto border-l border-white/10 bg-[#060916]">
        <header className="flex items-start gap-3.5 border-b border-white/[0.06] p-5">
          <AppLogo providerId={sub?.providerId} category={sub?.category ?? 'Other'} color={sub?.color ?? '#0473fd'} size={48} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold tracking-tight">{sub?.name ?? 'Payment'}</h2>
            <p className="num text-[13px] text-muted">
              {money(charge.amount)} on {shortDate(charge.date)} · {RAIL_LABEL[charge.rail]}
            </p>
          </div>
          <StatusPill charge={charge} refund={refund} />
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

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            <Fact label="Plan" value={sub ? `${sub.plan}, ${money(sub.price)} per ${cycleShort(sub.cycle)}` : 'n/a'} />
            <Fact label="Subscription" value={sub ? sub.status.replace('_', ' ') : 'removed'} />
            <Fact label="Charged" value={age === 0 ? 'Today' : `${age} day${age === 1 ? '' : 's'} ago`} />
            <Fact label="Next charge" value={live && insight ? `${shortDate(sub.nextRenewal)} (${insight.daysToRenewal}d)` : 'None'} />
            {charge.paypalTransactionId && <Fact label="PayPal transaction" value={charge.paypalTransactionId} />}
            {insight && insight.verdict !== 'unmeasured' && insight.verdict !== 'essential' && <Fact label="Used, last 30 days" value={`${insight.hours30} hours`} />}
          </dl>

          {charge.status === 'failed' && sub && (
            <Block title="This payment failed">
              <p className="text-[13px] leading-relaxed text-muted">
                Nothing was taken. {sub.name} will usually retry, and may stop the service if it keeps failing. Update the card or bank mandate on its account page, or cancel if you no longer
                want it.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={sub.cancelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-canvas hover:opacity-90">
                  Update payment at {sub.name} <ExternalLink size={13} aria-hidden="true" />
                </a>
                <Quiet busy={busy === 'paid'} onClick={() => run('paid', { intent: 'mark', chargeId: charge.id, status: 'paid' }, 'Marked as paid.')}>
                  It went through, mark as paid
                </Quiet>
              </div>
            </Block>
          )}

          {charge.status !== 'failed' && (
            <Block title="Refund">
              {!refund || refund.status === 'declined' ? (
                charge.status === 'refunded' ? (
                  <p className="text-[13px] text-muted">This payment was refunded.</p>
                ) : (
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run('refund', { intent: 'refund', chargeId: charge.id, reason, note }, 'Refund request written. Send it using the steps below.');
                    }}
                  >
                    <p className="text-[13px] leading-relaxed text-muted">
                      {refund?.status === 'declined' ? 'The last request was declined. You can write a new one. ' : ''}
                      Only {charge.rail === 'paypal' ? 'the seller, through PayPal,' : sub?.name} can refund this, and it is their decision. Subster writes the request from your records and
                      keeps track of the answer.
                    </p>
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-faint">Why are you asking?</span>
                      <select value={reason} onChange={(e) => setReason(e.target.value as RefundReason)} className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[13px]">
                        {REASONS.map(([id, text]) => (
                          <option key={id} value={id}>
                            {text}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-faint">Anything to add (optional)</span>
                      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={600} className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[13px]" />
                    </label>
                    <button type="submit" disabled={busy !== null} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-canvas hover:opacity-90 disabled:opacity-50">
                      {busy === 'refund' ? 'Writing' : 'Write the refund request'}
                    </button>
                  </form>
                )
              ) : (
                <div className="space-y-3">
                  <ol className="flex gap-1.5 text-[11px] font-medium" aria-label="Refund progress">
                    {(['drafted', 'sent', 'refunded'] as const).map((s, i) => {
                      const reached = ['drafted', 'sent', 'refunded'].indexOf(refund.status) >= i;
                      return (
                        <li key={s} className={`flex-1 rounded-md px-2 py-1.5 text-center ${reached ? 'bg-accent-soft text-accent' : 'bg-white/[0.04] text-faint'}`}>
                          {['Written', 'Sent', 'Refund received'][i]}
                        </li>
                      );
                    })}
                  </ol>
                  {refund.evidence.length > 0 && (
                    <ul className="space-y-1 text-[12px] text-muted">
                      {refund.evidence.map((fact) => (
                        <li key={fact} className="flex gap-1.5">
                          <Check size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" /> {fact}
                        </li>
                      ))}
                    </ul>
                  )}
                  {refundOpen && (
                    <>
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.07] bg-black/30 p-3 font-sans text-[12px] leading-relaxed">{refund.message}</pre>
                      <div className="flex flex-wrap gap-2">
                        <Quiet
                          onClick={() =>
                            void navigator.clipboard.writeText(refund.message).then(() => {
                              setCopied(true);
                              setTimeout(() => setCopied(false), 1500);
                            })
                          }
                        >
                          <Copy size={12} className="mr-1 inline" aria-hidden="true" />
                          {copied ? 'Copied' : 'Copy the request'}
                        </Quiet>
                        <a href={refund.contactUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-medium hover:bg-white/[0.07]">
                          {refund.via === 'paypal' ? 'Open PayPal Resolution Centre' : `Open ${sub?.name ?? 'the provider'}'s account page`} <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      </div>
                      <p className="text-[12px] leading-relaxed text-faint">
                        {refund.via === 'paypal'
                          ? 'Find this payment in the Resolution Centre, choose to report a problem and paste the request.'
                          : `Paste the request into ${sub?.name ?? 'the provider'}'s support or billing help form. If they refuse and you believe the charge was wrong, your ${charge.rail === 'card' ? 'card issuer' : 'bank'} can open a dispute.`}
                      </p>
                      <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
                        {refund.status === 'drafted' && (
                          <button onClick={() => run('sent', { intent: 'refund_status', refundId: refund.id, status: 'sent' }, 'Noted as sent.')} disabled={busy !== null} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-canvas hover:opacity-90 disabled:opacity-50">
                            I have sent it
                          </button>
                        )}
                        {refund.status === 'sent' && (
                          <>
                            <button onClick={() => run('got', { intent: 'refund_status', refundId: refund.id, status: 'refunded' }, 'Recorded. This payment now shows as refunded.')} disabled={busy !== null} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-canvas hover:opacity-90 disabled:opacity-50">
                              The refund arrived
                            </button>
                            <Quiet busy={busy === 'declined'} onClick={() => run('declined', { intent: 'refund_status', refundId: refund.id, status: 'declined' }, 'Recorded as declined.')}>
                              It was declined
                            </Quiet>
                          </>
                        )}
                        <Quiet busy={busy === 'withdraw'} onClick={() => run('withdraw', { intent: 'refund_status', refundId: refund.id, status: 'withdrawn' }, 'Refund request removed.')}>
                          Withdraw
                        </Quiet>
                      </div>
                    </>
                  )}
                  {refund.status === 'refunded' && <p className="text-[13px] text-good">You recorded this refund as received on {shortDate(refund.updatedAt.slice(0, 10))}.</p>}
                </div>
              )}
            </Block>
          )}

          {sub && (
            <Block title="The subscription">
              {guided ? (
                <div className="space-y-2.5">
                  <p className="text-[13px] leading-relaxed">
                    <span className="font-medium">{guided.title}:</span> one step is left for you. {sub.paypalSubscriptionId ? 'PayPal could not do this one for you.' : `${sub.name} is not billed through PayPal, so it has to be done on its own site.`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <a href={sub.cancelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-canvas hover:opacity-90">
                      Open {sub.name} account page <ExternalLink size={13} aria-hidden="true" />
                    </a>
                    <Quiet
                      busy={busy === 'done'}
                      onClick={async () => {
                        setBusy('done');
                        const res = await mutate(`/api/actions/${guided.id}`, { decision: 'done' });
                        setNotice({ ok: res.ok, text: res.ok ? 'Recorded as done.' : (res.error ?? 'Something went wrong') });
                        setBusy(null);
                      }}
                    >
                      I have done it
                    </Quiet>
                  </div>
                </div>
              ) : !live ? (
                <p className="text-[13px] text-muted">This subscription is cancelled. No further charges are expected.</p>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-[13px] leading-relaxed text-muted">
                    {sub.paypalSubscriptionId && state.integrations.paypal !== 'off'
                      ? 'This agreement is managed by PayPal, so cancelling or pausing happens here and is verified with PayPal.'
                      : `${sub.name} is not billed through PayPal, so you finish on its own account page and confirm here.`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {sub.status === 'paused' ? (
                      <Quiet busy={busy === 'resume'} onClick={() => run('resume', { intent: 'act', subId: sub.id, action: 'resume' }, 'Resume started.')}>
                        Resume
                      </Quiet>
                    ) : (
                      sub.status !== 'trial' && (
                        <Quiet busy={busy === 'pause'} onClick={() => run('pause', { intent: 'act', subId: sub.id, action: 'pause' }, 'Pause started.')}>
                          Pause
                        </Quiet>
                      )
                    )}
                    <button onClick={() => run('cancel', { intent: 'act', subId: sub.id, action: 'cancel' }, 'Cancellation started.')} disabled={busy !== null} className="rounded-lg border border-bad/30 px-3 py-1.5 text-[12px] font-medium text-bad hover:bg-bad-soft disabled:opacity-50">
                      {busy === 'cancel' ? 'Working' : 'Cancel subscription'}
                    </button>
                  </div>
                  {lastAction && (
                    <p className={`text-[12px] ${lastAction.status === 'failed' ? 'text-bad' : 'text-faint'}`}>
                      Last change: {lastAction.title}, {lastAction.status}. {lastAction.steps.at(-1)?.label}
                    </p>
                  )}
                </div>
              )}
            </Block>
          )}

          <Block title="Do not recognise this payment?">
            <p className="text-[13px] leading-relaxed text-muted">
              {charge.rail === 'paypal'
                ? 'Report it in PayPal\'s Resolution Centre as an unauthorised transaction. PayPal investigates and can reverse it.'
                : `Contact your ${charge.rail === 'card' ? 'card issuer' : 'bank'} straight away and ask them to dispute it and block further payments to this merchant.`}
            </p>
          </Block>

          {manual && (
            <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
              {charge.status === 'paid' && !refundOpen && (
                <Quiet busy={busy === 'failed'} onClick={() => run('failed', { intent: 'mark', chargeId: charge.id, status: 'failed' }, 'Marked as failed.')}>
                  This payment actually failed
                </Quiet>
              )}
              <Quiet
                busy={busy === 'remove'}
                onClick={async () => {
                  if (window.confirm('Remove this payment from your history?') && (await run('remove', { intent: 'remove', chargeId: charge.id }, 'Removed.'))) onClose();
                }}
              >
                Remove from history
              </Quiet>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Record({ subs, currency, onClose }: { subs: Subscription[]; currency: string; onClose: () => void }) {
  const { mutate } = useApp();
  const [subId, setSubId] = useState(subs[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState(String(subs[0]?.price ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Record a payment"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const res = await mutate('/api/transactions', { intent: 'record', subId, date, amount: Number(amount) });
          setBusy(false);
          if (res.ok) onClose();
          else setError(res.error ?? 'Something went wrong');
        }}
        className="rise w-full max-w-[400px] space-y-4 rounded-2xl border border-white/10 bg-[#060916] p-5"
      >
        <h2 className="text-[16px] font-semibold">Record a payment</h2>
        <p className="text-[13px] leading-relaxed text-muted">For a charge your bank or PayPal did not report. It joins the history like any other payment.</p>
        {error && (
          <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
            {error}
          </p>
        )}
        <label className="block">
          <span className="mb-1 block text-[11px] text-faint">Subscription</span>
          <select
            value={subId}
            onChange={(e) => {
              setSubId(e.target.value);
              setAmount(String(subs.find((s) => s.id === e.target.value)?.price ?? ''));
            }}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[13px]"
          >
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] text-faint">Date</span>
            <input type="date" required value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[13px]" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-faint">Amount ({currency})</span>
            <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[13px]" />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-3 py-2 text-[13px] hover:bg-white/[0.07]">
            Close
          </button>
          <button type="submit" disabled={busy} className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-canvas hover:opacity-90 disabled:opacity-50">
            {busy ? 'Saving' : 'Record payment'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{title}</h3>
      {children}
    </section>
  );
}

function Quiet({ children, onClick, busy }: { children: React.ReactNode; onClick: () => void; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-medium hover:bg-white/[0.07] disabled:opacity-50">
      {busy ? 'Working' : children}
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
