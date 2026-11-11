// The pieces of a conversation with the agent: the hook that talks to the session API, the thread
// of turns, and the message box. The server keeps each conversation, so the hook only ever sends
// the new message and reads back what the server holds.

import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, CalendarClock, ChartNoAxesColumn, Check, ChevronDown, Copy, Mic, PiggyBank, Plus, RotateCcw, ScanSearch, ShieldCheck, Square, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatSession, RunStep, StreamEvent } from '@/domain/types';
import { ActionCard } from './action-card';
import { AppLogo } from './app-logo';
import { useApp } from './app-state';
import { ChatWidget } from './chat-widgets';
import { Markdown } from './markdown';

export const SESSIONS_KEY = ['chat-sessions'] as const;

const TOOL_LABEL: Record<string, string> = {
  list_subscriptions: 'Looking through your subscriptions',
  get_subscription_detail: 'Checking usage and payments',
  forecast_renewals: 'Checking upcoming charges',
  get_paypal_status: 'Asking PayPal',
  get_account_context: 'Checking what is connected',
  search_services: 'Searching services',
  propose_action: 'Preparing a proposal',
  propose_subscription: 'Preparing a subscription',
  schedule_review: 'Setting a reminder',
  show: 'Putting it together',
};

const ASKS = ['choices', 'checklist', 'confirm'];

export type Mode = 'sweep' | 'chat';
interface UserTurn {
  role: 'user';
  content: string;
  mode: Mode;
}
export interface AgentTurn {
  role: 'assistant';
  content: string;
  steps: RunStep[];
  error?: string;
  done: boolean;
  /** Set for replies loaded from the server, so they are not typed out again. */
  seen?: boolean;
}
export type Turn = UserTurn | AgentTurn;

/** What to offer next, from what the reply just did. No model call. */
export function followUps(turns: Turn[]): string[] {
  const turn = turns[turns.length - 1];
  if (turn?.role !== 'assistant' || !turn.done || turn.error) return [];
  if (turn.steps.some((s) => s.actionId || (s.widget && ASKS.includes(s.widget.type)))) return [];
  const asked = new Set(turns.filter((t) => t.role === 'user').map((t) => t.content));
  const tools = new Set(turn.steps.map((s) => s.tool));
  const ideas = [
    ...(tools.has('forecast_renewals') ? ['Which of these could I skip?'] : []),
    ...(tools.has('list_subscriptions') ? ['Turn the best saving into a proposal', 'Which one is the worst value?'] : []),
    ...(tools.has('search_services') ? ['Is there a cheaper alternative?'] : []),
    ...(tools.has('get_account_context') ? ['What do you never store?'] : []),
    'What can I cancel to save money?',
    'What renews this week?',
  ];
  return ideas.filter((idea) => !asked.has(idea)).slice(0, 3);
}

/**
 * One conversation. `sessionId` comes from the address; when there is none, the first message
 * starts a conversation and `onSession` is told its id.
 */
export function useChat(sessionId: string | undefined, onSession: (id: string) => void) {
  const client = useQueryClient();
  const { refresh } = useApp();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  // The conversation this hook is already showing, so its own stream is never overwritten by a load.
  const showing = useRef<string | undefined>(undefined);
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    if (sessionId === showing.current) return;
    showing.current = sessionId;
    let cancelled = false;
    const load = async () => {
      setMissing(false);
      if (!sessionId) return setTurns([]);
      setLoading(true);
      try {
        const res = await fetch(`/api/chat/sessions/${sessionId}`);
        if (cancelled) return;
        if (!res.ok) {
          setTurns([]);
          setMissing(true);
          return;
        }
        const session = (await res.json()) as ChatSession;
        if (cancelled) return;
        setTurns(session.turns.map((t) => (t.role === 'user' ? { role: 'user', content: t.content, mode: t.mode } : { role: 'assistant', content: t.content, steps: t.steps, error: t.error, done: true, seen: true })));
      } catch {
        if (!cancelled) setMissing(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      // If this load was abandoned (the effect re-ran for the same conversation), let it start again.
      if (showing.current === sessionId) showing.current = '\0';
    };
  }, [sessionId]);

  /** Applies a change to the reply that is being written (always the last turn). */
  const patch = (change: (turn: AgentTurn) => AgentTurn) =>
    setTurns((all) => {
      const last = all[all.length - 1];
      return last?.role === 'assistant' ? [...all.slice(0, -1), change(last)] : all;
    });

  const send = useCallback(
    async (mode: Mode, message: string, earlier?: Turn[]) => {
      const control = new AbortController();
      running.current = control;
      if (busy) return;
      setBusy(true);
      setTurns((all) => [...(earlier ?? all), { role: 'user', content: message, mode }, { role: 'assistant', content: '', steps: [], done: false }]);
      try {
        let id = sessionId;
        if (!id) {
          const created = await fetch('/api/chat/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (!created.ok) throw new Error('unreachable');
          id = ((await created.json()) as ChatSession).id;
          showing.current = id;
          onSession(id);
        }
        const res = await fetch(`/api/chat/sessions/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, message, replaceLast: Boolean(earlier) }), signal: control.signal });
        if (!res.ok || !res.body) throw new Error('unreachable');

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
            if (event.type === 'step' && event.step.kind !== 'final') {
              patch((t) => ({ ...t, steps: [...t.steps, event.step] }));
              // A new proposal should be in the state before its card is drawn.
              if (event.step.actionId) void refresh();
            }
            if (event.type === 'text') patch((t) => ({ ...t, content: event.text }));
            if (event.type === 'error') patch((t) => ({ ...t, error: event.message }));
          }
        }
      } catch {
        if (control.signal.aborted) patch((t) => ({ ...t, content: t.content || 'Stopped.', seen: true }));
        else patch((t) => ({ ...t, error: 'I could not reach the agent just now.' }));
      } finally {
        patch((t) => ({ ...t, done: true }));
        setBusy(false);
        void client.invalidateQueries({ queryKey: SESSIONS_KEY });
        await refresh();
      }
    },
    [busy, sessionId, onSession, refresh, client],
  );

  const stop = () => running.current?.abort();

  /** Asks the last question again, replacing the reply it got. */
  const retry = () => {
    const question = turns[turns.length - 2];
    if (question?.role === 'user') void send(question.mode, question.content, turns.slice(0, -2));
  };

  return { turns, busy, loading, missing, send, retry, stop };
}

// ---- The thread -------------------------------------------------------------------------------

export function Thread({ turns, busy, onSend, onRetry }: { turns: Turn[]; busy: boolean; onSend: (message: string) => void; onRetry: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const toEnd = useCallback((smooth = true) => {
    if (pinned.current) end.current?.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
  }, []);
  useEffect(() => toEnd(), [turns, toEnd]);
  const next = busy ? [] : followUps(turns);

  return (
    <div
      className="min-h-0 flex-1 overflow-auto"
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      }}
    >
      <div className="w-full space-y-6 px-5 pb-6 pt-6 md:px-8">
        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <p key={i} className="rise ml-auto w-fit max-w-[80%] whitespace-pre-wrap rounded-[22px] rounded-br-md bg-accent px-4 py-2.5 text-[14px] leading-relaxed text-on">
              {turn.content}
            </p>
          ) : (
            <Reply key={i} turn={turn} active={i === turns.length - 1 && !busy} onRetry={onRetry} onSend={onSend} onGrow={toEnd} />
          ),
        )}
        {next.length > 0 && (
          <div className="rise flex flex-wrap gap-2 pl-10">
            {next.map((idea) => (
              <button key={idea} onClick={() => onSend(idea)} className="rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 text-[13px] text-muted transition-colors hover:border-white/30 hover:text-ink">
                {idea}
              </button>
            ))}
          </div>
        )}
        <div ref={end} />
      </div>
    </div>
  );
}

const calm = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Types a new reply out over about a second, word by word. */
function useTyped(text: string, animate: boolean, onGrow: () => void) {
  const [shown, setShown] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate || !text) return;
    const step = Math.max(3, Math.ceil(text.length / 60));
    const timer = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(timer);
          return n;
        }
        const end = text.indexOf(' ', n + step);
        return end === -1 ? text.length : end;
      });
      onGrow();
    }, 18);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, animate]);
  if (!animate || shown >= text.length) return { text, typing: false };
  let partial = text.slice(0, shown);
  // Close a bold run that is still being typed so its markers never show.
  if ((partial.match(/\*\*/g) ?? []).length % 2 === 1) partial += '**';
  return { text: partial, typing: true };
}

function Reply({ turn, active, onRetry, onSend, onGrow }: { turn: AgentTurn; active: boolean; onRetry: () => void; onSend: (message: string) => void; onGrow: () => void }) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { text, typing } = useTyped(turn.content, !turn.seen && !calm(), onGrow);
  // One of each kind, the latest: if the agent redrew a component, only its final version shows.
  const widgets = [...new Map(turn.steps.flatMap((s) => (s.widget ? [[ASKS.includes(s.widget.type) ? 'ask' : s.widget.type, s.widget] as const] : []))).values()].slice(-2);
  const working = !turn.done;
  const actionIds = [...new Set(turn.steps.map((s) => s.actionId).filter((id): id is string => Boolean(id)))];
  const cards = actionIds.map((id) => state?.actions.find((a) => a.id === id)).filter((a) => a !== undefined);
  const current = turn.steps[turn.steps.length - 1];
  const label = (step: RunStep) => (step.kind === 'thought' ? 'Thinking it through' : (TOOL_LABEL[step.tool ?? ''] ?? 'Checking'));

  async function copy() {
    try {
      await navigator.clipboard.writeText(turn.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available; nothing to do */
    }
  }

  return (
    <div className="rise group flex gap-3">
      <img src="/logo-mark.png" alt="" className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-black p-1 shadow-sm" />
      <div className="min-w-0 flex-1 space-y-3">
        {working ? (
          <p className="flex h-7 items-center gap-2.5 text-[14px] text-muted">
            <span className="typing" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {current ? label(current) : 'Thinking'}
          </p>
        ) : (
          turn.steps.length > 0 && (
            <div>
              <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-7 items-center gap-1.5 text-[12px] text-faint transition-colors hover:text-ink">
                <Check size={13} className="text-good" aria-hidden="true" />
                {turn.steps.length} step{turn.steps.length === 1 ? '' : 's'}
                <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {open && (
                <ol className="rise mt-1.5 space-y-2 border-l border-white/10 pl-3.5">
                  {turn.steps.map((step, i) => (
                    <li key={i} className="text-[12px] leading-snug">
                      <span className="text-muted">{label(step)}</span>
                      {step.kind !== 'thought' && <span className="block text-faint">{step.title}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )
        )}

        {text && <Markdown text={text} className="max-w-[100ch] text-[14px] text-ink" />}

        {!typing && turn.done && widgets.map((widget, i) => <ChatWidget key={i} widget={widget} active={active} onSend={onSend} />)}

        {!typing &&
          cards.map((action) => (
            <div key={action.id} className="rise panel px-4 py-3.5">
              <ActionCard action={action} compact />
            </div>
          ))}

        {turn.error && !turn.content && (
          <div role="alert" className="flex flex-wrap items-center gap-2.5 text-[14px] text-muted">
            <span>{turn.error}</span>
            {active && (
              <button onClick={onRetry} className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-[12px] text-ink hover:bg-white/[0.07]">
                <RotateCcw size={12} aria-hidden="true" />
                Try again
              </button>
            )}
          </div>
        )}

        {turn.done && !typing && turn.content && (
          <div className={`flex items-center gap-1 text-[12px] text-faint transition-opacity focus-within:opacity-100 group-hover:opacity-100 ${active ? '' : 'opacity-0'}`}>
            <button onClick={copy} className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-white/[0.06] hover:text-ink">
              {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {active && (
              <button onClick={onRetry} className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-white/[0.06] hover:text-ink">
                <RotateCcw size={12} aria-hidden="true" />
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- The message box --------------------------------------------------------------------------

interface ComposerProps {
  onSend: (message: string) => void;
  /** Runs a full audit. */
  onAudit: () => void;
  onStop?: () => void;
  busy?: boolean;
  placeholder?: string;
  /** The tall version used on the welcome screen. */
  large?: boolean;
  /** Lets an empty message through, for a mode where the message is optional. */
  allowEmpty?: boolean;
  autoFocus?: boolean;
}

const QUICK = [
  { icon: CalendarClock, label: 'Upcoming charges', hint: 'The next 30 days', send: 'What will I be charged in the next 30 days?' },
  { icon: PiggyBank, label: 'Find savings', hint: 'What you could cut', send: 'What can I cancel to save money?' },
  { icon: ChartNoAxesColumn, label: 'Worst value', hint: 'Ranked by real use', send: 'Show me my three worst value subscriptions' },
  { icon: ShieldCheck, label: 'What you know about me', hint: 'And what is never stored', send: 'What do you know about me, and what do you never store?' },
] as const;

// The browser's own dictation, where it has one.
interface Dictation {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
const dictationOf = () => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Dictation; webkitSpeechRecognition?: new () => Dictation };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export function Composer({ onSend, onAudit, onStop, busy, placeholder = 'Message Subster', large, allowEmpty, autoFocus }: ComposerProps) {
  const { state } = useApp();
  const [input, setInput] = useState('');
  const [menu, setMenu] = useState(false);
  /** The subscription this message is about, shown as a chip. */
  const [about, setAbout] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [canDictate, setCanDictate] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  const dictation = useRef<Dictation | null>(null);

  const subs = (state?.portfolio.insights ?? []).filter((i) => i.sub.status !== 'cancelled').map((i) => i.sub);
  const subject = subs.find((s) => s.id === about);
  // Typing a slash opens the same menu, filtered by what follows it.
  const slash = input.startsWith('/') ? input.slice(1).toLowerCase() : null;
  const open = menu || slash !== null;

  // The box grows with what is typed, up to a few lines.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    if (autoFocus) field.current?.focus();
    const ready = () => setCanDictate(Boolean(dictationOf()));
    ready();
    return () => dictation.current?.stop();
  }, [autoFocus]);

  const close = () => {
    setMenu(false);
    if (slash !== null) setInput('');
  };

  function submit(message = input) {
    const text = message.trim();
    if (busy) return;
    if (!text && !subject && !allowEmpty) return;
    setInput('');
    setMenu(false);
    setAbout(null);
    if (subject) onSend(text ? `About my ${subject.name} subscription: ${text}` : `Is my ${subject.name} subscription worth keeping?`);
    else if (!text && allowEmpty) onAudit();
    else onSend(text);
  }

  function dictate() {
    if (listening) return dictation.current?.stop();
    const Recognition = dictationOf();
    if (!Recognition) return;
    const rec = new Recognition();
    const before = input ? `${input.trimEnd()} ` : '';
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => setInput(before + Array.from(event.results, (r) => r[0].transcript).join(''));
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    dictation.current = rec;
    setListening(true);
    rec.start();
  }

  const round = `grid shrink-0 place-items-center rounded-full ${large ? 'h-10 w-10' : 'h-9 w-9'}`;
  const plusButton = (
    <button
      ref={plus}
      type="button"
      onClick={() => (open ? close() : setMenu(true))}
      aria-label="Add or choose"
      aria-expanded={open}
      title="Shortcuts, or type /"
      className={`${round} border transition-colors ${open ? 'border-accent bg-accent text-on' : 'border-white/10 text-muted hover:border-accent hover:text-accent'}`}
      style={{ padding: 0 }}
    >
      <Plus size={18} className={`transition-transform duration-200 ${open ? 'rotate-45' : ''}`} aria-hidden="true" />
    </button>
  );
  const micButton = canDictate && !busy && (
    <button type="button" onClick={dictate} aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Speak your message'} title={listening ? 'Stop listening' : 'Speak'} className={`${round} transition-colors ${listening ? 'mic-live bg-bad text-on' : 'text-muted hover:bg-white/[0.06] hover:text-ink'}`} style={{ padding: 0 }}>
      <Mic size={17} aria-hidden="true" />
    </button>
  );
  const sendButton = busy ? (
    <button type="button" onClick={onStop} aria-label="Stop" title="Stop" className={`${round} bg-ink text-on`} style={{ padding: 0 }}>
      <Square size={13} fill="currentColor" aria-hidden="true" />
    </button>
  ) : (
    <button type="submit" disabled={!input.trim() && !subject && !allowEmpty} aria-label="Send" className={`${round} bg-accent text-on transition-opacity disabled:opacity-25`} style={{ padding: 0 }}>
      <ArrowUp size={18} strokeWidth={2.25} aria-hidden="true" />
    </button>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={`panel relative transition-shadow focus-within:shadow-[0_1px_2px_rgba(10,40,110,0.05),0_18px_44px_-18px_rgba(4,90,220,0.35)] ${large ? 'rounded-[28px] p-4' : 'rounded-[26px] p-2.5'}`}
    >
      <label htmlFor="chat-input" className="sr-only">
        Message Subster
      </label>
      {subject && (
        <div className={`mb-2 flex ${large ? '' : 'pl-11'}`}>
          <span className="rise flex items-center gap-2 rounded-full bg-accent-soft py-1 pl-1 pr-1.5 text-[13px] font-medium text-accent">
            <AppLogo providerId={subject.providerId} category={subject.category} color={subject.color} size={22} />
            {subject.name}
            <button type="button" onClick={() => setAbout(null)} aria-label={`Remove ${subject.name}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-accent hover:text-on" style={{ padding: 0 }}>
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
      <div className={`flex gap-2 ${large ? 'items-start' : 'items-end'}`}>
        {!large && plusButton}
        <textarea
          id="chat-input"
          ref={field}
          rows={large ? 2 : 1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) return close();
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (slash === null) submit();
            }
          }}
          placeholder={busy ? 'Working on it' : listening ? 'Listening' : subject ? `Ask about ${subject.name}` : placeholder}
          style={{ outline: 'none' }}
          className={`m-0 block min-w-0 flex-1 resize-none border-0 bg-transparent leading-[24px] placeholder:text-faint ${large ? 'min-h-[52px] px-1.5 pt-1 text-[16px]' : 'min-h-9 px-1 py-[6px] text-[14px]'}`}
        />
        {!large && micButton}
        {!large && sendButton}
      </div>
      {large && (
        <div className="mt-2 flex items-center gap-2">
          {plusButton}
          <span className="text-[12px] text-faint">Type / for shortcuts</span>
          <span className="ml-auto flex items-center gap-2">
            {micButton}
            {sendButton}
          </span>
        </div>
      )}

      {open && (
        <ComposerMenu
          anchor={plus}
          below={Boolean(large)}
          filter={slash ?? ''}
          subs={subs}
          onClose={close}
          onAudit={() => {
            close();
            setInput('');
            onAudit();
          }}
          onPrompt={(text) => {
            setInput('');
            submit(text);
          }}
          onSubscribe={() => {
            setMenu(false);
            setInput('Subscribe to ');
            field.current?.focus();
          }}
          onAbout={(id) => {
            setMenu(false);
            if (slash !== null) setInput('');
            setAbout(id);
            field.current?.focus();
          }}
        />
      )}
    </form>
  );
}

interface MenuProps {
  anchor: React.RefObject<HTMLElement | null>;
  below: boolean;
  filter: string;
  subs: { id: string; name: string; providerId?: string; category: Parameters<typeof AppLogo>[0]['category']; color: string }[];
  onClose: () => void;
  onAudit: () => void;
  onPrompt: (text: string) => void;
  onSubscribe: () => void;
  onAbout: (id: string) => void;
}

/**
 * The plus menu. It is drawn on top of the whole page, anchored to the button, so nothing on the
 * page can cover it or clip it.
 */
function ComposerMenu({ anchor, below, filter, subs, onClose, onAudit, onPrompt, onSubscribe, onAbout }: MenuProps) {
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const left = Math.max(12, Math.min(r.left, window.innerWidth - 392));
      // Open towards whichever side has the room.
      const roomBelow = window.innerHeight - r.bottom - 20;
      const roomAbove = r.top - 20;
      if (below && roomBelow > 260) setBox({ left, top: r.bottom + 10, maxHeight: Math.min(520, roomBelow) });
      else if (roomAbove >= roomBelow) setBox({ left, bottom: window.innerHeight - r.top + 10, maxHeight: Math.min(520, roomAbove) });
      else setBox({ left, top: r.bottom + 10, maxHeight: Math.min(520, roomBelow) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, below]);

  const match = (text: string) => !filter || text.toLowerCase().includes(filter);
  const actions = [
    { icon: ScanSearch, label: 'Run a full audit', hint: 'Check everything, propose changes', run: onAudit },
    ...QUICK.map((q) => ({ icon: q.icon, label: q.label, hint: q.hint, run: () => onPrompt(q.send) })),
    { icon: Plus, label: 'Start a subscription', hint: 'Through PayPal, with your approval', run: onSubscribe },
  ].filter((a) => match(a.label));
  const shown = subs.filter((s) => match(s.name));
  if (!box || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <button className="fixed inset-0 z-[80] cursor-default" aria-label="Close" onClick={onClose} />
      <div
        role="menu"
        aria-label="Shortcuts"
        className="menu-pop fixed z-[81] flex w-[380px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[24px] border border-black bg-black shadow-[0_2px_6px_rgba(10,40,110,0.06),0_28px_60px_-20px_rgba(10,50,140,0.45)]"
        style={{ left: box.left, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight, transformOrigin: box.top !== undefined ? 'top left' : 'bottom left' }}
      >
        <div className="min-h-0 overflow-auto p-2">
          {actions.length > 0 && <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-faint">Do</p>}
          {actions.map(({ icon: Icon, label, hint, run }) => (
            <button key={label} type="button" role="menuitem" onClick={run} className="group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors hover:bg-accent-soft">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-on">
                <Icon size={16} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium leading-tight">{label}</span>
                <span className="block text-[12px] leading-tight text-muted">{hint}</span>
              </span>
            </button>
          ))}
          {shown.length > 0 && (
            <>
              <p className="px-2.5 pb-1.5 pt-3 text-[11px] font-medium text-faint">Ask about</p>
              <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
                {shown.map((sub) => (
                  <button key={sub.id} type="button" role="menuitem" onClick={() => onAbout(sub.id)} className="flex items-center gap-2 rounded-full border border-white/10 py-1 pl-1 pr-3 text-[13px] transition-colors hover:border-accent hover:bg-accent-soft">
                    <AppLogo providerId={sub.providerId} category={sub.category} color={sub.color} size={22} />
                    {sub.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {actions.length === 0 && shown.length === 0 && <p className="px-3 py-5 text-center text-[13px] text-muted">Nothing matches. Press Esc and just ask.</p>}
        </div>
      </div>
    </>,
    document.body,
  );
}
