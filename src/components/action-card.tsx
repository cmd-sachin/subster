// One proposal, with the controls to decide it. Used by the inbox and inside the agent's chat, so
// an approval looks and behaves the same wherever it is given. It always reads the live action,
// so a card in the chat moves on by itself when the decision is made anywhere else.

import { Check, ExternalLink, X } from 'lucide-react';
import { useState } from 'react';
import { diffDays, money, today } from '@/domain/dates';
import type { AgentAction } from '@/domain/types';
import { AppLogo } from './app-logo';
import { useApp } from './app-state';

const VERB: Record<AgentAction['type'], string> = { cancel: 'Cancel', pause: 'Pause', resume: 'Resume', downgrade: 'Downgrade', retry_payment: 'Fix payment', subscribe: 'Subscribe' };

const PRIMARY = 'rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on hover:opacity-90 disabled:opacity-50';
const QUIET = 'rounded-full border border-white/10 px-3.5 py-1.5 text-[13px] hover:bg-white/[0.07] disabled:opacity-50';

interface Props {
  action: AgentAction;
  /** Shorter layout for the chat: the agent's reply already gave the reasoning. */
  compact?: boolean;
  onApproved?: (id: string) => void;
}

export function ActionCard({ action: a, compact, onApproved }: Props) {
  const { state, mutate } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = state?.portfolio.insights.find((i) => i.sub.id === a.subId)?.sub;
  const daysLeft = diffDays(a.deadline, today());

  async function decide(decision: 'approve' | 'reject' | 'done') {
    setBusy(true);
    setError(null);
    const res = await mutate(`/api/actions/${a.id}`, { decision });
    if (!res.ok) setError(res.error ?? 'That did not go through. Please try again.');
    else if (decision === 'approve') onApproved?.(a.id);
    setBusy(false);
  }

  const head = (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="flex min-w-0 items-center gap-2.5">
        <AppLogo providerId={sub?.providerId ?? a.providerId} category={sub?.category ?? 'Other'} color={sub?.color ?? '#0473fd'} size={28} />
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold leading-snug">{a.title}</h3>
          {compact && a.plan && <p className="num text-[12px] text-muted">{money(a.plan.price, 'USD')} per {a.plan.cycle.replace('ly', '')} through PayPal</p>}
        </div>
      </div>
      {a.savingsMonthly > 0 && <span className="num text-[13px] font-semibold text-good">saves {money(a.savingsMonthly)}/mo</span>}
    </div>
  );

  let body: React.ReactNode;
  if (a.status === 'pending') {
    body = (
      <>
        {!compact && <p className="mt-1.5 text-[13px] leading-relaxed">{a.reason}</p>}
        {!compact && a.evidence.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {a.evidence.slice(0, 1).map((e) => (
              <li key={e} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[12px] text-muted">
                {e}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => decide('approve')} disabled={busy} className={PRIMARY}>
            {busy ? 'Working' : a.channel === 'paypal_api' ? `${VERB[a.type]} with PayPal` : a.type === 'cancel' ? 'Yes, cancel' : VERB[a.type]}
          </button>
          <button onClick={() => decide('reject')} disabled={busy} className={QUIET}>
            {a.type === 'subscribe' ? 'Not now' : 'Keep'}
          </button>
          <span className={`num ml-auto text-[12px] ${a.type !== 'subscribe' && daysLeft <= 2 ? 'font-medium text-bad' : 'text-muted'}`}>
            {a.type === 'subscribe' ? 'Nothing is charged yet' : daysLeft < 0 ? 'Charge date has passed' : daysLeft === 0 ? 'Decide today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
          </span>
        </div>
      </>
    );
  } else if (a.status === 'guided' && a.type === 'subscribe') {
    body = (
      <>
        <p className="mt-1.5 text-[13px] leading-relaxed">Confirm it at PayPal to start. Nothing is charged before that.</p>
        {state?.integrations.paypal === 'sandbox' && (
          <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-[12px] leading-relaxed text-warn">
            PayPal is in test mode here, so its page only accepts a sandbox buyer account (developer.paypal.com, Testing Tools, Sandbox Accounts). A real PayPal login is turned away with &quot;Some of your info isn&apos;t correct&quot;.
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap gap-2">
          <a href={a.approveUrl} className={PRIMARY}>
            Continue to PayPal <ExternalLink size={13} className="ml-1 inline" aria-hidden="true" />
          </a>
          <button onClick={() => decide('reject')} disabled={busy} className={QUIET}>
            Never mind
          </button>
        </div>
      </>
    );
  } else if (a.status === 'guided') {
    body = (
      <>
        <p className="mt-1.5 text-[13px] leading-relaxed">One step left: finish on {sub?.name ?? 'the provider'}&apos;s page, then confirm here.</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <a href={sub?.cancelUrl} target="_blank" rel="noreferrer" className={PRIMARY}>
            Open {sub?.name ?? 'account'} page <ExternalLink size={13} className="ml-1 inline" aria-hidden="true" />
          </a>
          <button onClick={() => decide('done')} disabled={busy} className={QUIET}>
            I&apos;ve done it
          </button>
        </div>
      </>
    );
  } else {
    const done = a.status === 'executed';
    const failed = a.status === 'failed';
    body = (
      <p className={`mt-2 flex items-center gap-1.5 text-[13px] ${done ? 'text-good' : failed ? 'text-bad' : 'text-muted'}`}>
        {done ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
        {done
          ? a.channel === 'paypal_api'
            ? 'Done and confirmed with PayPal'
            : 'Done'
          : failed
            ? 'This could not be completed'
            : a.type === 'subscribe'
              ? 'Not started'
              : 'Kept as it is'}
      </p>
    );
  }

  return (
    <div>
      {head}
      {body}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
