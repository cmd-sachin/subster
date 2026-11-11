// "Is it right for me?" for one subscription: a few questions, then the fit-check agent's live
// trace and its verdict. The finished check is stored on the server, so it is still here on the
// next visit.

import { Link } from '@tanstack/react-router';
import { Check, ExternalLink, HelpCircle, Minus, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { money } from '@/domain/dates';
import type { Currency, FitAlternative, FitCheck as FitCheckResult, FitQuestion, RunStep, StreamEvent, Subscription } from '@/domain/types';
import { AppLogo } from './app-logo';
import { useApp } from './app-state';
import { since } from './connection';

const VERDICT: Record<FitCheckResult['verdict'], { label: string; tone: string }> = {
  worth_it: { label: 'Worth it for you', tone: 'bg-good-soft text-good' },
  partly: { label: 'Partly worth it', tone: 'bg-accent-soft text-accent' },
  not_worth_it: { label: 'Not worth it for you', tone: 'bg-bad-soft text-bad' },
  unclear: { label: 'Cannot tell yet', tone: 'bg-white/[0.07] text-muted' },
};
const ACTION: Record<FitCheckResult['recommendation']['action'], string> = { keep: 'Keep it', downgrade: 'Move to a cheaper plan', switch: 'Switch to an alternative', rent_instead: 'Rent what you want instead', cancel: 'Cancel it' };
const BASIS: Record<FitAlternative['basis'], string> = { live: 'price read live', catalog: 'catalog price', model: 'not checked' };
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];
const price = (amount: number, currency?: string) => (currency && CURRENCIES.includes(currency) ? money(amount, currency as Currency) : `${amount} ${currency ?? ''}`.trim());

export function FitCheck({ sub, check }: { sub: Subscription; check?: FitCheckResult }) {
  const { refresh } = useApp();
  const [questions, setQuestions] = useState<FitQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    const res = await fetch(`/api/fit?subId=${encodeURIComponent(sub.id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? 'Could not load the questions');
    setAnswers(check?.answers ?? {});
    setQuestions(data.questions);
  }

  async function run() {
    setRunning(true);
    setSteps([]);
    setError(null);
    try {
      const res = await fetch('/api/fit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subId: sub.id, answers }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? 'The check could not start');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === 'step') setSteps((current) => [...current, event.step]);
          if (event.type === 'error') setError(event.message);
        }
      }
      await refresh();
      setQuestions(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setRunning(false);
  }

  const set = (id: string, value: string) => setAnswers((current) => ({ ...current, [id]: value }));
  const toggle = (id: string, option: string) => {
    const chosen = (answers[id] ?? '').split(', ').filter(Boolean);
    set(id, (chosen.includes(option) ? chosen.filter((o) => o !== option) : [...chosen, option]).join(', '));
  };

  if (running) {
    return (
      <div>
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <Sparkles size={14} className="animate-pulse text-accent" aria-hidden="true" /> Checking {sub.name} against your answers
        </p>
        <ol className="mt-2.5 space-y-1.5 border-l border-white/10 pl-3.5 text-[12px]" aria-live="polite">
          {steps.map((step, i) => (
            <li key={i} className={step.kind === 'thought' ? 'text-faint' : 'text-muted'}>
              {step.title}
            </li>
          ))}
          <li className="text-faint">Working. Live lookups can take up to a minute.</li>
        </ol>
      </div>
    );
  }

  if (questions) {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {questions.map((q) => (
          <fieldset key={q.id}>
            <legend className="text-[13px] font-medium leading-snug">{q.label}</legend>
            {q.hint && <p className="mt-0.5 text-[12px] text-faint">{q.hint}</p>}
            {q.kind === 'titles' && <textarea value={answers[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} rows={4} placeholder={'Stranger Things\nInterstellar'} aria-label={q.label} className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[13px] placeholder:text-faint" />}
            {q.kind === 'text' && <input value={answers[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} aria-label={q.label} className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[13px]" />}
            {q.kind === 'number' && <input value={answers[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} inputMode="decimal" aria-label={q.label} className="num mt-2 w-32 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[13px]" />}
            {(q.kind === 'choice' || q.kind === 'multi') && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {q.options?.map((option) => {
                  const on = q.kind === 'choice' ? answers[q.id] === option : (answers[q.id] ?? '').split(', ').includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={on}
                      onClick={() => (q.kind === 'choice' ? set(q.id, on ? '' : option) : toggle(q.id, option))}
                      className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-white/10 text-muted hover:text-ink'}`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>
        ))}
        {error && (
          <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-canvas hover:opacity-90">
            Check it for me
          </button>
          <button type="button" onClick={() => setQuestions(null)} className="rounded-lg border border-white/10 px-3 py-1.5 text-[13px] hover:bg-white/[0.07]">
            Not now
          </button>
        </div>
      </form>
    );
  }

  if (!check) {
    return (
      <div>
        <p className="text-[13px] leading-relaxed text-muted">Answer a few questions and the agent checks whether {sub.name} suits how you actually use it, looks up live what it can, and compares it with the alternatives.</p>
        {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
        <button onClick={start} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-canvas hover:opacity-90">
          <Sparkles size={14} aria-hidden="true" /> Is {sub.name} right for me?
        </button>
      </div>
    );
  }

  const verdict = VERDICT[check.verdict];
  const known = check.titles.filter((t) => t.found);
  return (
    <div className="space-y-4">
      <div>
        <span className={`inline-block rounded-full px-2.5 py-1 text-[12px] font-semibold ${verdict.tone}`}>{verdict.label}</span>
        <p className="mt-2 text-[15px] font-semibold leading-snug">{check.headline}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{check.reasoning}</p>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
        <p className="flex items-baseline justify-between gap-3 text-[13px] font-semibold">
          {ACTION[check.recommendation.action]}
          {check.recommendation.monthlySaving !== undefined && <span className="num text-good">saves {money(check.recommendation.monthlySaving)}/mo</span>}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed">{check.recommendation.text}</p>
        {(check.recommendation.action === 'cancel' || check.recommendation.action === 'downgrade') && (
          <Link to="/savings" className="mt-2 inline-block text-[12px] text-accent underline-offset-2 hover:underline">
            Do it from Savings
          </Link>
        )}
      </div>

      {check.titles.length > 0 && (
        <div>
          <h4 className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">What you want to watch</h4>
          <ul className="mt-2 space-y-2">
            {check.titles.map((t) => {
              const elsewhere = t.offers.filter((o) => o.kind === 'stream').map((o) => o.provider);
              const rent = t.offers.filter((o) => o.kind === 'rent' && o.price).sort((a, b) => a.price! - b.price!)[0];
              const buy = t.offers.filter((o) => o.kind === 'buy' && o.price).sort((a, b) => a.price! - b.price!)[0];
              return (
                <li key={t.title} className="flex items-start gap-2 text-[13px]">
                  {!t.found ? <HelpCircle size={15} className="mt-0.5 shrink-0 text-faint" aria-label="Could not be looked up" /> : t.onService ? <Check size={15} className="mt-0.5 shrink-0 text-good" aria-label={`On ${sub.name}`} /> : <X size={15} className="mt-0.5 shrink-0 text-bad" aria-label={`Not on ${sub.name}`} />}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{t.title}</span>{' '}
                    <span className="text-muted">{!t.found ? 'could not be looked up' : t.onService ? `is on ${sub.name}` : `is not on ${sub.name}`}</span>
                    {t.found && (
                      <span className="num block text-[12px] text-faint">
                        {[elsewhere.length > 0 && `Included with ${[...new Set(elsewhere)].slice(0, 4).join(', ')}`, rent && `rent from ${price(rent.price!, rent.currency)} (${rent.provider})`, buy && `buy from ${price(buy.price!, buy.currency)} (${buy.provider})`].filter(Boolean).join(' · ') || 'No offers listed'}
                      </span>
                    )}
                  </span>
                  {t.url && (
                    <a href={t.url} target="_blank" rel="noreferrer" aria-label={`Source for ${t.title}`} className="mt-0.5 text-faint hover:text-ink">
                      <ExternalLink size={13} />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          {known.length > 0 && (
            <p className="num mt-2 text-[12px] text-muted">
              {known.filter((t) => t.onService).length} of {known.length} are on {sub.name}.{check.rentTotal !== undefined && ` Renting the rest once would cost ${money(check.rentTotal)}.`}
            </p>
          )}
        </div>
      )}

      {check.alternatives.length > 0 && (
        <div>
          <h4 className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Alternatives</h4>
          <ul className="mt-2 space-y-2">
            {check.alternatives.map((a) => (
              <li key={`${a.name}-${a.plan}`} className="flex items-start gap-2.5 rounded-xl border border-white/[0.07] px-3 py-2.5">
                {a.providerId ? <AppLogo providerId={a.providerId} category={sub.category} color={sub.color} size={28} /> : <Minus size={16} className="mt-1 shrink-0 text-faint" aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] font-medium">
                    <span>
                      {a.name}
                      {a.plan ? ` ${a.plan}` : ''}
                    </span>
                    {a.price !== undefined && (
                      <span className="num">
                        {price(a.price, a.currency)}
                        {a.cycle && a.cycle !== 'once' ? `/${a.cycle === 'monthly' ? 'mo' : a.cycle === 'yearly' ? 'yr' : 'qtr'}` : ''}
                      </span>
                    )}
                  </span>
                  <span className="block text-[12px] leading-relaxed text-muted">{a.why}</span>
                  <span className={`text-[11px] ${a.basis === 'live' ? 'text-good' : a.basis === 'model' ? 'text-warn' : 'text-faint'}`}>{BASIS[a.basis]}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">What this rests on</h4>
        <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed text-muted">
          {check.basis.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {check.sources.length > 0 && (
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
            {check.sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
                {s.label}
              </a>
            ))}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-faint">
          Checked {since(check.createdAt)} by {check.engine === 'gemini' ? 'the agent' : 'the built-in rules'}
        </span>
        <button onClick={start} className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-medium hover:bg-white/[0.07]">
          Check again
        </button>
      </div>
    </div>
  );
}
