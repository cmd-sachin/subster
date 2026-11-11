// Components the agent can show under a reply: bars, headline numbers, subscription rows, a
// table, and three that ask the user something (pick one, tick several, confirm). The asking ones
// answer by sending a message on the user's behalf, so the conversation carries on from there.

import { Check } from 'lucide-react';
import { useState } from 'react';
import { money } from '@/domain/dates';
import type { Widget, WidgetItem } from '@/domain/types';
import { AppLogo } from './app-logo';
import { useApp } from './app-state';

const TONE = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad' } as const;
const TONE_TEXT = { good: 'text-good', warn: 'text-warn', bad: 'text-bad' } as const;
const PRIMARY = 'rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on transition-opacity hover:opacity-90 disabled:opacity-40';
const QUIET = 'rounded-full border border-white/10 px-3.5 py-1.5 text-[13px] transition-colors hover:bg-white/[0.07] disabled:opacity-40';

interface Props {
  widget: Widget;
  /** Only the newest reply can still be answered; older ones are shown as they were left. */
  active: boolean;
  onSend: (message: string) => void;
}

export function ChatWidget({ widget, active, onSend }: Props) {
  return (
    <div className="rise rounded-[20px] border border-white/10 bg-white/[0.04] px-3.5 py-3">
      {widget.title && widget.type !== 'confirm' && <h3 className="mb-2.5 text-[13px] font-semibold">{widget.title}</h3>}
      <Body widget={widget} active={active} onSend={onSend} />
      {widget.note && widget.type !== 'confirm' && <p className="mt-2.5 text-[12px] text-muted">{widget.note}</p>}
    </div>
  );
}

function Body({ widget, active, onSend }: Props) {
  switch (widget.type) {
    case 'progress':
      return <Bars items={widget.items} />;
    case 'stats':
      return <Stats items={widget.items} />;
    case 'subscriptions':
      return <Subscriptions items={widget.items} />;
    case 'table':
      return <Table columns={widget.columns ?? []} rows={widget.rows ?? []} />;
    case 'choices':
      return <Choices items={widget.items} active={active} onSend={onSend} />;
    case 'checklist':
      return <Checklist widget={widget} active={active} onSend={onSend} />;
    case 'confirm':
      return <Confirm widget={widget} active={active} onSend={onSend} />;
  }
}

function Bar({ value, max, tone }: { value: number; max: number; tone?: WidgetItem['tone'] }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${tone ? TONE[tone] : 'bg-accent'}`} style={{ width: `${Math.max(pct, 2)}%` }} />
    </div>
  );
}

function Bars({ items }: { items: WidgetItem[] }) {
  const top = Math.max(1, ...items.map((i) => i.value ?? 0));
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">{item.label}</span>
            <span className={`num shrink-0 font-medium ${item.tone ? TONE_TEXT[item.tone] : ''}`}>{item.text ?? item.value}</span>
          </div>
          <Bar value={item.value ?? 0} max={item.max ?? top} tone={item.tone} />
          {item.detail && <p className="mt-1 text-[12px] text-faint">{item.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

function Stats({ items }: { items: WidgetItem[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {items.slice(0, 4).map((item, i) => (
        <div key={i}>
          <dt className="text-[12px] text-muted">{item.label}</dt>
          <dd className={`num mt-0.5 text-[20px] font-semibold tracking-[-0.02em] ${item.tone ? TONE_TEXT[item.tone] : ''}`}>{item.text ?? item.value}</dd>
          {item.detail && <dd className="text-[12px] text-faint">{item.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Subscriptions({ items }: { items: WidgetItem[] }) {
  const { state } = useApp();
  const rows = items.map((item) => ({ item, insight: state?.portfolio.insights.find((i) => i.sub.id === item.subscriptionId) })).filter((r) => r.insight);
  return (
    <ul className="space-y-3">
      {rows.map(({ item, insight }) => {
        const i = insight!;
        const score = i.valueScore;
        const tone = score === null || score === undefined ? undefined : score >= 60 ? 'good' : score >= 35 ? 'warn' : 'bad';
        return (
          <li key={i.sub.id} className="flex items-center gap-3">
            <AppLogo providerId={i.sub.providerId} category={i.sub.category} color={i.sub.color} size={30} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate font-medium">{i.sub.name}</span>
                <span className="num shrink-0">{money(i.monthlyCost)}/mo</span>
              </div>
              <div className="mt-1.5">
                <Bar value={score ?? 0} max={100} tone={tone} />
              </div>
              <p className="mt-1 text-[12px] text-faint">{item.detail ?? (score === null || score === undefined ? 'Not measured yet' : `${i.hours30}h in 30 days, value ${score} of 100`)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-left text-[12px]">
        <thead>
          <tr className="text-muted">
            {columns.map((c) => (
              <th key={c} className="px-1 pb-1.5 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-white/[0.06]">
              {columns.map((_, j) => (
                <td key={j} className={`px-1 py-1.5 ${j === 0 ? 'font-medium' : 'num text-muted'}`}>
                  {row[j] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Choices({ items, active, onSend }: { items: WidgetItem[]; active: boolean; onSend: (m: string) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const locked = !active || picked !== null;
  return (
    <div className="space-y-1.5" role="radiogroup">
      {items.map((item, i) => (
        <button
          key={i}
          role="radio"
          aria-checked={picked === i}
          disabled={locked}
          onClick={() => {
            setPicked(i);
            onSend(item.send ?? item.label);
          }}
          className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left text-[13px] transition-colors ${
            picked === i ? 'border-accent bg-accent-soft' : 'border-white/[0.08] enabled:hover:border-accent/60 enabled:hover:bg-accent-soft/40'
          } ${locked && picked !== i ? 'opacity-50' : ''}`}
        >
          <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${picked === i ? 'border-accent bg-accent' : 'border-white/25'}`} aria-hidden="true">
            {picked === i && <span className="h-1.5 w-1.5 rounded-full bg-on" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{item.label}</span>
            {item.detail && <span className="block text-[12px] text-muted">{item.detail}</span>}
          </span>
          {item.text && <span className="num shrink-0 text-muted">{item.text}</span>}
        </button>
      ))}
    </div>
  );
}

function Checklist({ widget, active, onSend }: Props) {
  const [checked, setChecked] = useState<boolean[]>(() => widget.items.map((i) => i.checked === true));
  const [sent, setSent] = useState(false);
  const locked = !active || sent;
  const count = checked.filter(Boolean).length;
  return (
    <div>
      <ul className="space-y-0.5">
        {widget.items.map((item, i) => (
          <li key={i}>
            <label className={`flex items-start gap-3 rounded-xl px-1.5 py-2 text-[13px] ${locked ? '' : 'cursor-pointer hover:bg-white/[0.04]'} ${locked && !checked[i] ? 'opacity-45' : ''}`}>
              <input type="checkbox" className="peer sr-only" checked={checked[i]} disabled={locked} onChange={() => setChecked((all) => all.map((v, j) => (j === i ? !v : v)))} />
              <span
                className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60 ${
                  checked[i] ? 'border-accent bg-accent text-on' : 'border-white/25'
                }`}
                aria-hidden="true"
              >
                {checked[i] && <Check size={12} strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium first-letter:uppercase">{item.label}</span>
                {item.detail && <span className="line-clamp-2 block text-[12px] text-muted">{item.detail}</span>}
              </span>
              {item.text && <span className="num shrink-0 font-medium text-good">{item.text}</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-center gap-3">
        <button
          disabled={locked || count === 0}
          onClick={() => {
            setSent(true);
            onSend(`${widget.prompt ?? 'Go ahead with'}: ${widget.items.filter((_, i) => checked[i]).map((i) => i.label).join(', ')}`);
          }}
          className={PRIMARY}
        >
          {sent ? 'Sent' : (widget.confirmLabel ?? 'Continue')}
        </button>
        <span className="num text-[12px] text-muted">
          {count} of {widget.items.length} selected
        </span>
      </div>
    </div>
  );
}

function Confirm({ widget, active, onSend }: Props) {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);
  const locked = !active || answer !== null;
  return (
    <div role="group" aria-label={widget.title}>
      <h3 className="text-[14px] font-semibold">{widget.title ?? 'Go ahead?'}</h3>
      {widget.note && <p className="mt-1 text-[13px] leading-relaxed text-muted">{widget.note}</p>}
      {answer ? (
        <p className={`mt-2.5 flex items-center gap-1.5 text-[13px] ${answer === 'yes' ? 'text-good' : 'text-muted'}`}>
          {answer === 'yes' && <Check size={14} aria-hidden="true" />}
          {answer === 'yes' ? 'Confirmed' : 'Left as it is'}
        </p>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            disabled={locked}
            onClick={() => {
              setAnswer('yes');
              onSend(widget.prompt ?? `Yes, ${widget.title ?? 'go ahead'}`);
            }}
            className={PRIMARY}
          >
            {widget.confirmLabel ?? 'Yes, go ahead'}
          </button>
          <button disabled={locked} onClick={() => setAnswer('no')} className={QUIET}>
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
