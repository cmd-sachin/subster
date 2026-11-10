
// The agent's working surface: start a sweep, ask a question, and watch every tool call it makes.

import { ScanSearch, SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AgentRun, RunStep, StreamEvent } from '@/domain/types';
import { useApp } from './app-state';

const STARTERS = ['What can I cancel to save money?', 'What will I be charged in the next 30 days?', 'Subscribe to Spotify Premium Individual'];

const TOOL_LABEL: Record<string, string> = {
  list_subscriptions: 'Scan portfolio',
  get_subscription_detail: 'Inspect',
  forecast_renewals: 'Forecast',
  get_paypal_status: 'PayPal status',
  propose_action: 'Propose',
  schedule_review: 'Schedule',
};

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export function AgentPanel() {
  const { state, refresh } = useApp();
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState<false | 'sweep' | 'chat'>(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const lastRun: AgentRun | undefined = state?.runs[0];
  const engine = state?.integrations.agent;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [steps, turns]);

  async function run(mode: 'sweep' | 'chat', message?: string) {
    if (busy) return;
    setBusy(mode);
    setError(null);
    setSteps([]);
    const history = turns.slice(-8);
    if (mode === 'chat' && message) setTurns((t) => [...t, { role: 'user', content: message }]);
    else setTurns([]);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, message, history }),
      });
      if (!res.ok || !res.body) throw new Error(`Agent request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === 'step' && event.step.kind !== 'final') setSteps((s) => [...s, event.step]);
          if (event.type === 'text') setTurns((t) => [...t, { role: 'assistant', content: event.text }]);
          if (event.type === 'error') setError(event.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message) return;
    setInput('');
    void run('chat', message);
  }

  const idle = !busy && steps.length === 0 && turns.length === 0;

  return (
    <section className="flex min-h-[420px] flex-col panel" aria-label="Agent">
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold">Agent</h2>
          <p className="text-[12px] text-muted">
            {engine === 'gemini' ? 'Gemini decides what to inspect and propose.' : 'Rules engine. Add a Gemini API key for full reasoning.'}
          </p>
        </div>
        <button
          onClick={() => run('sweep')}
          disabled={Boolean(busy)}
          className="shrink-0 rounded-xl bg-accent px-3.5 py-2 text-[13px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <ScanSearch size={15} className="mr-1.5 inline" aria-hidden="true" />
          {busy === 'sweep' ? 'Auditing' : 'Run audit'}
        </button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3" aria-live="polite">
        {idle && (
          <div className="space-y-3 text-[13px] text-muted">
            <p>
              Run an audit and the agent will read your payments and usage, then put anything worth acting on in your inbox. It cannot change a subscription
              without your approval.
            </p>
            {lastRun && (
              <div className="rounded-xl bg-white/[0.06] px-3 py-2.5">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">
                  Last run · {lastRun.trigger === 'webhook' ? `triggered by ${lastRun.triggerDetail}` : lastRun.trigger} · {new Date(lastRun.startedAt).toLocaleString()}
                </div>
                <p className="whitespace-pre-line text-ink">{lastRun.summary}</p>
              </div>
            )}
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <p key={i} className="rise ml-auto w-fit max-w-[85%] rounded-xl bg-white/[0.06] px-3 py-2 text-[13px]">
              {turn.content}
            </p>
          ) : null,
        )}

        {steps.length > 0 && (
          <ol className="space-y-1.5">
            {steps.map((step, i) => (
              <li key={i} className="rise flex gap-2.5 text-[13px]">
                <span
                  className={`mt-[3px] h-4 shrink-0 rounded px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-wide ${
                    step.kind === 'action' ? 'bg-accent text-canvas' : step.kind === 'thought' ? 'bg-info-soft text-info' : 'bg-white/[0.06] text-muted'
                  }`}
                >
                  {step.kind === 'thought' ? 'Thinks' : (TOOL_LABEL[step.tool ?? ''] ?? step.tool)}
                </span>
                <span className="min-w-0">
                  <span className={step.kind === 'action' ? 'font-medium' : ''}>{step.title}</span>
                </span>
              </li>
            ))}
          </ol>
        )}

        {busy && <p className="text-[12px] text-faint">Working</p>}

        {turns
          .filter((t) => t.role === 'assistant')
          .slice(-1)
          .map((turn, i) => (
            <p key={i} className="rise whitespace-pre-line rounded-xl border border-accent/25 bg-accent-soft/50 px-3 py-2.5 text-[13px] leading-relaxed">
              {turn.content}
            </p>
          ))}

        {error && (
          <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad">
            {error}
          </p>
        )}
      </div>

      <footer className="border-t border-white/[0.06] px-4 py-3">
        {idle && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button key={s} onClick={() => run('chat', s)} className="rounded-full border border-white/10 px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent">
                {s}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit} className="flex gap-2">
          <label htmlFor="agent-input" className="sr-only">
            Ask the agent
          </label>
          <input
            id="agent-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your subscriptions"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] placeholder:text-faint"
          />
          <button type="submit" disabled={Boolean(busy) || !input.trim()} className="rounded-xl border border-white/10 px-3 py-2 text-[13px] font-medium hover:bg-white/[0.07] disabled:opacity-40">
            <SendHorizontal size={15} aria-label="Ask" />
          </button>
        </form>
      </footer>
    </section>
  );
}
