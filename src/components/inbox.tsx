
// The approval inbox. Proposals wait here; approving is the only way one becomes a real change.

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { money } from '@/domain/dates';
import type { AgentAction } from '@/domain/types';
import { ActionCard } from './action-card';
import { useApp } from './app-state';

export function Inbox() {
  const { state } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  if (!state) return null;

  // Soonest deadline first.
  const pending = state.actions.filter((a) => a.status === 'pending').sort((a, b) => a.deadline.localeCompare(b.deadline));
  const guided = state.actions.filter((a) => a.status === 'guided');
  const history = state.actions.filter((a) => !['pending', 'guided'].includes(a.status)).slice(0, 6);
  const waiting = pending.reduce((t, a) => t + a.savingsMonthly, 0);

  return (
    <section className="panel" aria-label="Approval inbox">
      <header className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-[14px] font-semibold">
          Needs your decision {pending.length > 0 && <span className="num ml-1 text-muted">{pending.length}</span>}
        </h2>
        {waiting > 0 && <span className="num text-[12px] text-muted">{money(waiting)}/month if you approve all</span>}
      </header>

      {pending.length === 0 && guided.length === 0 && (
        <p className="px-4 py-6 text-[13px] text-muted">Nothing needs you right now.</p>
      )}

      <ul>
        {pending.map((a) => (
          <li key={a.id} className="rise border-b border-white/[0.06] px-4 py-3.5 last:border-b-0">
            <ActionCard action={a} onApproved={setOpen} />
          </li>
        ))}
        {guided.map((a) => (
          <li key={a.id} className={`border-b border-white/[0.06] px-4 py-3.5 last:border-b-0 ${a.type === 'subscribe' ? 'bg-accent-soft/60' : 'bg-warn-soft/40'}`}>
            <ActionCard action={a} />
          </li>
        ))}
      </ul>

      {history.length > 0 && (
        <div className="border-t border-white/[0.06]">
          <h3 className="px-4 pb-1 pt-3 text-[11px] font-medium text-faint">Audit trail</h3>
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
