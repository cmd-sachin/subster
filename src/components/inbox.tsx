
// The approval inbox. Proposals wait here; approving is the only way one becomes a real change.

import { ChevronDown, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { diffDays, money, shortDate, today } from '@/domain/dates';
import type { AgentAction } from '@/domain/types';
import { AppLogo } from './app-logo';
import { useApp } from './app-state';

const VERB: Record<AgentAction['type'], string> = { cancel: 'Cancel', pause: 'Pause', resume: 'Resume', downgrade: 'Downgrade', retry_payment: 'Fix payment', subscribe: 'Subscribe' };

export function Inbox() {
  const { state, mutate } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (!state) return null;

  // Soonest deadline first.
  const pending = state.actions.filter((a) => a.status === 'pending').sort((a, b) => a.deadline.localeCompare(b.deadline));
  const guided = state.actions.filter((a) => a.status === 'guided');
  const history = state.actions.filter((a) => !['pending', 'guided'].includes(a.status)).slice(0, 6);
  const subOf = (a: AgentAction) => state.portfolio.insights.find((i) => i.sub.id === a.subId)?.sub;
  const waiting = pending.reduce((t, a) => t + a.savingsMonthly, 0);

  async function decide(id: string, decision: 'approve' | 'reject' | 'done') {
    setBusy(id);
    setError(null);
    const res = await mutate(`/api/actions/${id}`, { decision });
    if (!res.ok) setError(res.error ?? 'Something went wrong');
    else if (decision === 'approve') setOpen(id);
    setBusy(null);
  }

  return (
    <section className="panel" aria-label="Approval inbox">
      <header className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-[14px] font-semibold">
          Needs your decision {pending.length > 0 && <span className="num ml-1 text-muted">{pending.length}</span>}
        </h2>
        {waiting > 0 && <span className="num text-[12px] text-muted">{money(waiting)}/month if you approve all</span>}
      </header>

      {error && (
        <p role="alert" className="border-b border-white/[0.06] bg-bad-soft px-4 py-2 text-[13px] text-bad">
          {error}
        </p>
      )}

      {pending.length === 0 && guided.length === 0 && (
        <p className="px-4 py-6 text-[13px] text-muted">Nothing is waiting. Run an audit and the agent will bring anything worth acting on here.</p>
      )}

      <ul>
        {pending.map((a) => {
          const sub = subOf(a);
          const daysLeft = diffDays(a.deadline, today());
          return (
            <li key={a.id} className="rise border-b border-white/[0.06] px-4 py-3.5 last:border-b-0">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="flex items-center gap-2.5">
                  <AppLogo providerId={sub?.providerId ?? a.providerId} category={sub?.category ?? 'Other'} color={sub?.color ?? '#1558c9'} size={28} />
                  <h3 className="text-[14px] font-semibold">{a.title}</h3>
                </div>
                {a.savingsMonthly > 0 && <span className="num text-[13px] font-semibold text-good">saves {money(a.savingsMonthly)}/mo</span>}
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed">{a.reason}</p>
              {a.evidence.length > 0 && (
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {a.evidence.map((e) => (
                    <li key={e} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[12px] text-muted">
                      {e}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => decide(a.id, 'approve')}
                  disabled={busy === a.id}
                  className="rounded-xl bg-accent px-3 py-1.5 text-[13px] font-semibold text-canvas hover:opacity-90 disabled:opacity-50"
                >
                  {busy === a.id ? 'Working' : a.channel === 'paypal_api' ? `Approve: ${VERB[a.type].toLowerCase()} via PayPal` : `Approve: show me how`}
                </button>
                <button onClick={() => decide(a.id, 'reject')} disabled={busy === a.id} className="rounded-xl border border-white/10 px-3 py-1.5 text-[13px] hover:bg-white/[0.07] disabled:opacity-50">
                  {a.type === 'subscribe' ? 'Not now' : 'Keep as is'}
                </button>
                <span className={`num ml-auto text-[12px] ${daysLeft <= 2 ? 'font-medium text-bad' : 'text-muted'}`}>
                  {a.type === 'subscribe' ? 'Nothing is charged until you confirm at PayPal' : daysLeft < 0 ? 'Charge date has passed' : daysLeft === 0 ? 'Decide today to avoid the charge' : `Decide by ${shortDate(a.deadline)} (${daysLeft}d)`}
                </span>
              </div>
            </li>
          );
        })}

        {guided.map((a) => {
          const sub = subOf(a);
          if (a.type === 'subscribe') {
            return (
              <li key={a.id} className="border-b border-white/[0.06] bg-accent-soft/60 px-4 py-3.5 last:border-b-0">
                <h3 className="text-[14px] font-semibold">{a.title}: confirm at PayPal</h3>
                <p className="mt-1 text-[13px] leading-relaxed">The agreement is created and waiting for you. PayPal asks you to approve it yourself; nothing is charged before that.</p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <a href={a.approveUrl} className="rounded-xl bg-accent px-3 py-1.5 text-[13px] font-semibold text-canvas hover:opacity-90">
                    Continue to PayPal <ExternalLink size={13} className="ml-1 inline" aria-hidden="true" />
                  </a>
                  <button onClick={() => decide(a.id, 'reject')} disabled={busy === a.id} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[13px] hover:bg-white/[0.07] disabled:opacity-50">
                    Never mind
                  </button>
                </div>
              </li>
            );
          }
          return (
            <li key={a.id} className="border-b border-white/[0.06] bg-warn-soft/40 px-4 py-3.5 last:border-b-0">
              <h3 className="text-[14px] font-semibold">{a.title}: one step left for you</h3>
              <p className="mt-1 text-[13px] leading-relaxed">
                {sub && !sub.paypalSubscriptionId ? `${sub.name} is not billed through PayPal, so PayPal cannot act on it.` : 'This one cannot be done for you through PayPal.'} Finish on the
                official page, then confirm here.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <a href={sub?.cancelUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-accent px-3 py-1.5 text-[13px] font-semibold text-canvas hover:opacity-90">
                  Open {sub?.name} account page <ExternalLink size={13} className="ml-1 inline" aria-hidden="true" />
                </a>
                <button onClick={() => decide(a.id, 'done')} disabled={busy === a.id} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[13px] hover:bg-white/[0.07] disabled:opacity-50">
                  I&apos;ve done it
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {history.length > 0 && (
        <div className="border-t border-white/[0.06]">
          <h3 className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-faint">Audit trail</h3>
          <ul className="pb-2">
            {history.map((a) => (
              <li key={a.id} className="px-4">
                <button onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id} className="flex w-full items-center justify-between gap-3 py-1.5 text-left text-[13px]">
                  <span className="flex items-center gap-2">
                    <StatusDot status={a.status} />
                    {a.title}
                    {a.approvedBy === 'policy' && <span className="rounded bg-info-soft px-1.5 text-[11px] text-info">standing permission</span>}
                  </span>
                  <span className="text-[12px] text-faint">
                    {a.status} <ChevronDown size={13} className={`ml-1 inline transition-transform ${open === a.id ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </span>
                </button>
                {open === a.id && (
                  <ol className="mb-2 ml-1.5 space-y-1 border-l border-white/10 pl-4 text-[12px]">
                    {a.steps.map((s, i) => (
                      <li key={i} className={s.ok ? 'text-muted' : 'text-bad'}>
                        <span className="num text-faint">{new Date(s.at).toLocaleTimeString()}</span> {s.label}
                        {s.detail && <span className="block text-faint">{s.detail}</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function StatusDot({ status }: { status: AgentAction['status'] }) {
  const color = status === 'executed' ? 'bg-good' : status === 'failed' ? 'bg-bad' : 'bg-faint';
  return <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />;
}
