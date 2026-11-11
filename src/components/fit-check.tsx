// "Is it right for me?" for one subscription. It opens as a dialog that asks one question at a
// time, lets the model ask a follow-up or two when the answers leave something open, shows the
// agent working, and ends on the verdict. The finished check is stored on the server, so the
// service panel keeps a summary of it.

import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, Check, ExternalLink, HelpCircle, Minus, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

type Phase = 'loading' | 'asking' | 'thinking' | 'running' | 'verdict';

/** The summary in the service panel, and the door to the dialog. */
export function FitCheck({ sub, check }: { sub: Subscription; check?: FitCheckResult }) {
  const [open, setOpen] = useState<false | 'ask' | 'verdict'>(false);
  return (
    <div>
      {check ? (
        <div>
          <span className={`inline-block rounded-full px-2.5 py-1 text-[12px] font-semibold ${VERDICT[check.verdict].tone}`}>{VERDICT[check.verdict].label}</span>
          <p className="mt-2 text-[14px] font-semibold leading-snug">{check.headline}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{check.recommendation.text}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => setOpen('verdict')} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-on hover:opacity-90">
              See the full verdict
            </button>
            <button onClick={() => setOpen('ask')} className="rounded-lg border border-white/10 px-3 py-1.5 text-[13px] font-medium hover:bg-white/[0.07]">
              Check again
            </button>
            <span className="text-[12px] text-faint">Checked {since(check.createdAt)}</span>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-[13px] leading-relaxed text-muted">A few quick questions, then the agent checks whether {sub.name} suits how you actually use it, looks up what it can live, and compares it with the alternatives.</p>
          <button onClick={() => setOpen('ask')} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-on hover:opacity-90">
            <Sparkles size={14} aria-hidden="true" /> Is {sub.name} right for me?
          </button>
        </div>
      )}
      {open && <FitDialog sub={sub} check={check} start={open} onClose={() => setOpen(false)} />}
    </div>
  );
}

function FitDialog({ sub, check, start, onClose }: { sub: Subscription; check?: FitCheckResult; start: 'ask' | 'verdict'; onClose: () => void }) {
  const { refresh, state } = useApp();
  const [phase, setPhase] = useState<Phase>(start === 'verdict' && check ? 'verdict' : 'loading');
  const [questions, setQuestions] = useState<FitQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [askedFollowUps, setAskedFollowUps] = useState(false);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const latest = state?.fitChecks[sub.id] ?? check;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The dialog sits on top of the service panel; Escape closes only the dialog.
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    dialog.current?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    if (phase !== 'loading') return;
    let cancelled = false;
    fetch(`/api/fit?subId=${encodeURIComponent(sub.id)}`)
      .then(async (res) => ({ ok: res.ok, data: (await res.json().catch(() => ({}))) as { questions?: FitQuestion[]; error?: string } }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok || !data.questions) return setError(data.error ?? 'Could not load the questions');
        setQuestions(data.questions);
        setPhase('asking');
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [phase, sub.id]);

  const question = questions[index];
  const value = question ? (answers[question.id] ?? '') : '';
  const chosen = value.split(question?.kind === 'titles' ? '\n' : ', ').filter(Boolean);
  const set = (text: string) => question && setAnswers((current) => ({ ...current, [question.id]: text }));
  const toggle = (option: string, limit = 99) => {
    const next = chosen.includes(option) ? chosen.filter((o) => o !== option) : chosen.length < limit ? [...chosen, option] : chosen;
    set(next.join(question?.kind === 'titles' ? '\n' : ', '));
  };

  async function run(all: FitQuestion[]) {
    setPhase('running');
    setSteps([]);
    setError(null);
    try {
      const followUps = all.filter((q) => q.id.startsWith('ai')).map((q) => ({ label: q.label, answer: answers[q.id] ?? '' }));
      const base = Object.fromEntries(Object.entries(answers).filter(([id]) => !id.startsWith('ai')));
      const res = await fetch('/api/fit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subId: sub.id, answers: base, followUps }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? 'The check could not start');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === 'step') setSteps((current) => [...current, event.step]);
          if (event.type === 'error') setError(event.message);
        }
      }
      await refresh();
      setPhase('verdict');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('asking');
    }
  }

  async function next() {
    setDraft('');
    if (index < questions.length - 1) return setIndex(index + 1);
    // The standard questions are done: let the model ask what it still needs, once.
    if (!askedFollowUps) {
      setAskedFollowUps(true);
      setPhase('thinking');
      const base = Object.fromEntries(Object.entries(answers).filter(([id]) => !id.startsWith('ai')));
      const more = await fetch('/api/fit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subId: sub.id, answers: base, step: 'followups' }) })
        .then((res) => res.json() as Promise<{ questions?: FitQuestion[] }>)
        .then((data) => data.questions ?? [])
        .catch(() => []);
      if (more.length > 0) {
        setQuestions([...questions, ...more]);
        setIndex(index + 1);
        return setPhase('asking');
      }
    }
    await run(questions);
  }

  const addTitle = () => {
    const title = draft.trim();
    if (title && !chosen.includes(title) && chosen.length < 6) set([...chosen, title].join('\n'));
    setDraft('');
  };

  const total = Math.max(questions.length, 1);
  const progress = phase === 'verdict' ? 1 : phase === 'running' || phase === 'thinking' ? 0.92 : (index + (value ? 0.6 : 0.15)) / (total + 1);
  const followUp = question?.id.startsWith('ai');

  // Rendered on the page itself: inside the service panel, the panel's own animation would clip it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`Is ${sub.name} right for you?`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{ outline: 'none' }}
        className="rise flex max-h-[min(720px,92vh)] w-full max-w-[560px] flex-col overflow-hidden rounded-[26px] border border-white/10 bg-surface shadow-2xl"
      >
        <header className="brand-blue relative px-6 pb-5 pt-5 text-on">
          <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full bg-black/20 p-1.5 hover:bg-black/35">
            <X size={16} />
          </button>
          <div className="flex items-center gap-3">
            <AppLogo providerId={sub.providerId} category={sub.category} color={sub.color} size={44} />
            <div>
              <p className="text-[11px] font-semibold text-on/75">Fit check</p>
              <h2 className="text-[19px] font-semibold tracking-tight">Is {sub.name} right for you?</h2>
            </div>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-on/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="h-full rounded-full bg-sun transition-[width] duration-500" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </header>

        <div className="min-h-[300px] flex-1 overflow-y-auto px-6 py-6">
          {error && (
            <p role="alert" className="mb-4 rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad">
              {error}
            </p>
          )}

          {phase === 'loading' && !error && <p className="text-[14px] text-muted">Getting your questions ready</p>}

          {phase === 'asking' && question && (
            <div key={question.id} className="rise">
              <p className="text-[12px] font-medium text-faint">
                {followUp ? (
                  <span className="inline-flex items-center gap-1.5 text-accent">
                    <Sparkles size={13} aria-hidden="true" /> One more thing, based on your answers
                  </span>
                ) : (
                  `Question ${index + 1} of ${questions.filter((q) => !q.id.startsWith('ai')).length}`
                )}
              </p>
              <h3 className="mt-1.5 text-[19px] font-semibold leading-snug tracking-[-0.01em]">{question.label}</h3>
              {question.hint && <p className="mt-1.5 text-[13px] text-muted">{question.hint}</p>}

              {question.kind === 'titles' && (
                <div className="mt-4">
                  {chosen.length > 0 && (
                    <ul className="mb-3 flex flex-wrap gap-2" aria-label="Your picks">
                      {chosen.map((title) => (
                        <li key={title}>
                          <button onClick={() => toggle(title)} className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-on" aria-label={`Remove ${title}`}>
                            {title} <X size={13} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addTitle();
                    }}
                  >
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a film or series name" aria-label="Add a title" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-[14px] placeholder:text-faint" />
                    <button type="submit" disabled={!draft.trim() || chosen.length >= 6} className="flex items-center gap-1 rounded-xl border border-white/10 px-3 text-[13px] font-medium hover:bg-white/[0.07] disabled:opacity-40">
                      <Plus size={14} aria-hidden="true" /> Add
                    </button>
                  </form>
                  {question.suggestions && question.suggestions.length > 0 && (
                    <>
                      <p className="mb-2 mt-4 text-[12px] text-faint">Popular on {sub.name} right now. Tap any you care about.</p>
                      <ul className="flex flex-wrap gap-2">
                        {question.suggestions
                          .filter((title) => !chosen.includes(title))
                          .slice(0, 16)
                          .map((title) => (
                            <li key={title}>
                              <button onClick={() => toggle(title, 6)} disabled={chosen.length >= 6} className="rounded-full border border-white/10 px-3 py-1.5 text-[13px] text-muted hover:border-accent hover:text-ink disabled:opacity-40">
                                {title}
                              </button>
                            </li>
                          ))}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {(question.kind === 'choice' || question.kind === 'multi') && (
                <div className="mt-4 grid gap-2" role={question.kind === 'choice' ? 'radiogroup' : 'group'}>
                  {question.options?.map((option) => {
                    const on = question.kind === 'choice' ? value === option : chosen.includes(option);
                    return (
                      <button
                        key={option}
                        role={question.kind === 'choice' ? 'radio' : 'checkbox'}
                        aria-checked={on}
                        onClick={() => (question.kind === 'choice' ? set(on ? '' : option) : toggle(option))}
                        className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-[14px] font-medium transition-colors ${on ? 'border-accent bg-accent-soft text-ink' : 'border-white/10 hover:border-white/25 hover:bg-white/[0.04]'}`}
                      >
                        {option}
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center ${question.kind === 'choice' ? 'rounded-full' : 'rounded-md'} border ${on ? 'border-accent bg-accent text-on' : 'border-white/25'}`}>{on && <Check size={13} strokeWidth={3} aria-hidden="true" />}</span>
                      </button>
                    );
                  })}
                  {question.kind === 'multi' && <p className="text-[12px] text-faint">Pick as many as apply.</p>}
                </div>
              )}

              {question.kind === 'text' && <textarea value={value} onChange={(e) => set(e.target.value)} rows={3} aria-label={question.label} placeholder="In your own words" className="mt-4 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-[14px] placeholder:text-faint" />}
              {question.kind === 'number' && (
                <div className="mt-4 flex items-center gap-2">
                  <input value={value} onChange={(e) => set(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" aria-label={question.label} className="num w-36 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-[18px] font-semibold" />
                  <span className="text-[14px] text-muted">GB</span>
                </div>
              )}
            </div>
          )}

          {phase === 'thinking' && (
            <div className="flex items-center gap-3 text-[14px]">
              <Sparkles size={18} className="animate-pulse text-accent" aria-hidden="true" /> Reading your answers to see if anything is still unclear
            </div>
          )}

          {phase === 'running' && (
            <div>
              <p className="flex items-center gap-2 text-[15px] font-semibold">
                <Sparkles size={16} className="animate-pulse text-accent" aria-hidden="true" /> Checking {sub.name} for you
              </p>
              <ol className="mt-3 space-y-2 border-l border-white/10 pl-4 text-[13px]" aria-live="polite">
                {steps.map((step, i) => (
                  <li key={i} className={`rise ${step.kind === 'thought' ? 'text-faint' : 'text-muted'}`}>
                    {step.title}
                  </li>
                ))}
                <li className="text-faint">Working. Live lookups can take up to a minute.</li>
              </ol>
            </div>
          )}

          {phase === 'verdict' && latest && <FitResult sub={sub} check={latest} />}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-white/[0.07] px-6 py-4">
          {phase === 'asking' ? (
            <>
              <button onClick={() => (index > 0 ? setIndex(index - 1) : onClose())} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-medium text-muted hover:bg-white/[0.06] hover:text-ink">
                <ArrowLeft size={14} aria-hidden="true" /> {index > 0 ? 'Back' : 'Not now'}
              </button>
              <div className="flex items-center gap-2">
                {!value && (
                  <button onClick={next} className="rounded-xl px-3 py-2 text-[13px] font-medium text-muted hover:bg-white/[0.06] hover:text-ink">
                    Skip
                  </button>
                )}
                <button onClick={next} disabled={!value} className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-on hover:opacity-90 disabled:opacity-40">
                  {index < questions.length - 1 || !askedFollowUps ? 'Continue' : 'Get my verdict'} <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </>
          ) : phase === 'verdict' ? (
            <>
              <button
                onClick={() => {
                  setIndex(0);
                  setAskedFollowUps(false);
                  setAnswers(Object.fromEntries(Object.entries(latest?.answers ?? {}).filter(([id]) => !id.startsWith('ai'))));
                  setPhase('loading');
                }}
                className="rounded-xl px-3 py-2 text-[13px] font-medium text-muted hover:bg-white/[0.06] hover:text-ink"
              >
                Answer again
              </button>
              <button onClick={onClose} className="rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-on hover:opacity-90">
                Done
              </button>
            </>
          ) : (
            <span className="text-[12px] text-faint">{phase === 'running' ? 'You can close this. The verdict is saved when it is ready.' : ''}</span>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function FitResult({ sub, check }: { sub: Subscription; check: FitCheckResult }) {
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
          <h4 className="text-[11px] font-medium text-faint">What you want to watch</h4>
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
          <h4 className="text-[11px] font-medium text-faint">Alternatives</h4>
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
        <h4 className="text-[11px] font-medium text-faint">What this rests on</h4>
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

      <p className="text-[12px] text-faint">
        Checked {since(check.createdAt)} by {check.engine === 'gemini' ? 'the agent' : 'the built-in rules'}
      </p>
    </div>
  );
}
