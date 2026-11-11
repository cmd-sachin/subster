// The assistant. A calm welcome with one message box when nothing is open, a conversation once
// there is one, and every past conversation one click away. Conversations live on the server.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, Download, History, Pencil, Search, MessageCircleQuestion, PiggyBank, Plus, ScanSearch, SquarePen, Trash2, WalletCards, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionCard } from '@/components/action-card';
import { AppLogo } from '@/components/app-logo';
import { useApp } from '@/components/app-state';
import { Composer, SESSIONS_KEY, Thread, useChat } from '@/components/chat';
import { Loader } from '@/components/loader';
import { greeting } from '@/components/welcome';
import { diffDays, money, today } from '@/domain/dates';
import type { AppState, ChatSessionSummary } from '@/domain/types';

export const Route = createFileRoute('/chat')({
  validateSearch: (search: Record<string, unknown>): { s?: string; q?: string } => ({
    ...(typeof search.s === 'string' && search.s && { s: search.s }),
    ...(typeof search.q === 'string' && search.q && { q: search.q }),
  }),
  component: ChatPage,
});

const MODES = [
  {
    id: 'ask',
    label: 'Ask',
    icon: MessageCircleQuestion,
    placeholder: 'Ask about your subscriptions, charges or savings',
  },
  {
    id: 'audit',
    label: 'Audit',
    icon: ScanSearch,
    placeholder: 'Press send to check everything, or say what to focus on',
  },
  {
    id: 'subscribe',
    label: 'Subscribe',
    icon: Plus,
    placeholder: 'Which service? For example Spotify Premium',
  },
] as const;
type ModeId = (typeof MODES)[number]['id'];

function ChatPage() {
  const { s: sessionId, q } = Route.useSearch();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { state } = useApp();
  const [mode, setMode] = useState<ModeId>('ask');
  const [history, setHistory] = useState(false);

  const open = useCallback((id?: string) => void navigate({ to: '/chat', search: id ? { s: id } : {} }), [navigate]);
  const onSession = useCallback((id: string) => void navigate({ to: '/chat', search: { s: id }, replace: true }), [navigate]);
  const { turns, busy, loading, missing, send, retry, stop } = useChat(sessionId, onSession);
  const [find, setFind] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const audit = () => void send('sweep', 'Run an audit');

  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: async () =>
      (
        (await (await fetch('/api/chat/sessions')).json()) as {
          sessions: ChatSessionSummary[];
        }
      ).sessions,
  });

  const list = sessions.data ?? [];
  const found = list.filter((x) => !find.trim() || `${x.title} ${x.preview}`.toLowerCase().includes(find.trim().toLowerCase()));

  // A question handed over from another page is asked once, then taken out of the address.
  const handed = useRef(false);
  useEffect(() => {
    if (!q || handed.current) return;
    handed.current = true;
    void navigate({ to: '/chat', search: {}, replace: true });
    void send('chat', q);
  }, [q, navigate, send]);

  async function remove(id: string) {
    await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
    void client.invalidateQueries({ queryKey: SESSIONS_KEY });
    if (id === sessionId) open();
  }

  async function rename(id: string, title: string) {
    setRenaming(null);
    if (!title.trim()) return;
    await fetch(`/api/chat/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    void client.invalidateQueries({ queryKey: SESSIONS_KEY });
  }

  /** Saves the open conversation as a Markdown file. */
  function exportChat() {
    const title = list.find((x) => x.id === sessionId)?.title ?? 'Conversation';
    const text = [`# ${title}`, ...turns.map((t) => (t.role === 'user' ? `**You:** ${t.content}` : `**Subster:** ${t.content || t.error || ''}`))].join('\n\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    link.download = `${
      title
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'conversation'
    }.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function submit(text: string) {
    if (mode === 'audit') return void send('sweep', text || 'Run an audit');
    if (mode === 'subscribe') return void send('chat', /^(subscribe|sign|start)/i.test(text) ? text : `Subscribe to ${text}`);
    void send('chat', text);
  }

  if (!state) return <Loader label="Opening the assistant" />;
  const fresh = turns.length === 0 && !loading;
  const current = list.find((x) => x.id === sessionId);

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-1 md:px-8">
          <p className="min-w-0 truncate text-[13px] text-muted">{fresh ? '' : (current?.title ?? 'Conversation')}</p>
          <div className="flex items-center gap-1.5">
            {!fresh && !busy && (
              <button onClick={exportChat} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[13px] hover:border-white/25">
                <Download size={14} aria-hidden="true" /> Save
              </button>
            )}
            {!fresh && (
              <button onClick={() => open()} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[13px] hover:border-white/25">
                <SquarePen size={14} aria-hidden="true" /> New
              </button>
            )}
            <button onClick={() => setHistory(!history)} aria-expanded={history} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[13px] hover:border-white/25">
              <History size={14} aria-hidden="true" /> History
              {list.length > 0 && <span className="num text-faint">{list.length}</span>}
            </button>
          </div>
        </div>

        {loading ? (
          <Loader label="Opening the conversation" />
        ) : fresh ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="flex w-full flex-col px-5 pb-10 md:px-8">
              <div className="mx-auto w-full max-w-[860px] pt-[6vh] text-center">
                <h1 className="text-[34px] font-medium tracking-[-0.035em]">{missing ? 'That conversation is gone' : `${greeting()}. What shall we look at?`}</h1>
                <div className="mt-5 flex justify-center gap-1.5" role="tablist" aria-label="What to do">
                  {MODES.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={mode === id}
                      onClick={() => setMode(id)}
                      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${mode === id ? 'border-white/60 bg-black text-ink shadow-sm' : 'border-transparent bg-black/50 text-muted hover:text-ink'}`}
                    >
                      <Icon size={14} aria-hidden="true" /> {label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 text-left">
                  <Composer large autoFocus onSend={submit} onAudit={audit} onStop={stop} busy={busy} placeholder={MODES.find((m) => m.id === mode)!.placeholder} allowEmpty={mode === 'audit'} />
                </div>
              </div>
              <Glance state={state} onAsk={(text) => void send('chat', text)} />
            </div>
          </div>
        ) : (
          <>
            <Thread turns={turns} busy={busy} onSend={(text) => void send('chat', text)} onRetry={retry} />
            <div className="w-full shrink-0 px-5 pb-5 md:px-8">
              <Composer onSend={(text) => void send('chat', text)} onAudit={audit} onStop={stop} busy={busy} autoFocus />
            </div>
          </>
        )}
      </div>

      {history && (
        <aside className="panel absolute inset-y-2 right-2 z-30 flex w-[min(340px,calc(100%-16px))] flex-col overflow-hidden" style={{ background: 'rgba(255,255,255,0.94)' }} aria-label="Conversations">
          <header className="flex items-center justify-between px-4 pb-2 pt-4">
            <h2 className="text-[15px] font-semibold">Conversations</h2>
            <button onClick={() => setHistory(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-white/[0.06] hover:text-ink">
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <div className="px-3 pb-2">
            <button
              onClick={() => {
                open();
                setHistory(false);
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-full bg-accent py-2 text-[13px] font-semibold text-on"
            >
              <SquarePen size={14} aria-hidden="true" /> New conversation
            </button>
          </div>
          {list.length > 3 && (
            <label className="mx-3 mb-2 flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 focus-within:border-accent">
              <Search size={14} className="text-faint" aria-hidden="true" />
              <span className="sr-only">Find a conversation</span>
              <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a conversation" style={{ outline: 'none' }} className="min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-faint" />
            </label>
          )}
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 pb-3">
            {found.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">{list.length === 0 ? 'Nothing here yet.' : 'No conversation matches.'}</li>}
            {found.map((item) => (
              <li key={item.id} className="group relative">
                {renaming === item.id ? (
                  <input
                    autoFocus
                    defaultValue={item.title}
                    aria-label="Conversation name"
                    onBlur={(e) => void rename(item.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    className="w-full rounded-2xl border border-accent bg-black px-3 py-2.5 text-[13px] font-medium"
                    style={{ outline: 'none' }}
                  />
                ) : (
                  <>
                    <button
                      onClick={() => {
                        open(item.id);
                        setHistory(false);
                      }}
                      aria-current={item.id === sessionId ? 'true' : undefined}
                      className={`w-full rounded-2xl px-3 py-2.5 pr-[68px] text-left transition-colors ${item.id === sessionId ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
                    >
                      <span className="block truncate text-[13px] font-medium">{item.title}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-faint">
                        {when(item.updatedAt)}
                        {item.preview ? ` · ${item.preview}` : ''}
                      </span>
                    </button>
                    <button
                      onClick={() => remove(item.id)}
                      aria-label={`Delete ${item.title}`}
                      title="Delete"
                      className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-faint opacity-0 transition-opacity hover:bg-bad-soft hover:text-bad focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => setRenaming(item.id)}
                      aria-label={`Rename ${item.title}`}
                      title="Rename"
                      className="absolute right-9 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-faint opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}

function when(iso: string) {
  const days = diffDays(today(), iso.slice(0, 10));
  if (days <= 0)
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  if (days === 1) return 'Yesterday';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

/** What is worth knowing before a word is typed: the next charge, what is waiting, two numbers. */
function Glance({ state, onAsk }: { state: AppState; onAsk: (text: string) => void }) {
  const { portfolio } = state;
  const next = portfolio.upcoming[0];
  const sub = next && portfolio.insights.find((i) => i.sub.id === next.subId);
  const days = next ? diffDays(next.date, today()) : 0;
  const pending = state.actions.filter((a) => a.status === 'pending').sort((a, b) => a.deadline.localeCompare(b.deadline));
  const perYear = Math.round(portfolio.potentialSavingsMonthly * 12);
  if (portfolio.insights.length === 0) return null;

  return (
    <div className="mt-12 grid gap-4 lg:grid-cols-12">
      {next && sub && (
        <section className="brand-blue relative flex min-h-[250px] flex-col overflow-hidden rounded-[28px] p-6 text-on lg:col-span-5" aria-label="Charging next">
          <img src="/logo-mark.png" alt="" aria-hidden="true" className="pointer-events-none absolute -bottom-10 -right-8 h-56 w-56 rotate-6 opacity-[0.14]" />
          <div className="flex items-center justify-between">
            <p className="text-[14px] text-on/80">Charging next</p>
            <Link to="/timeline" className="rounded-full bg-on/20 px-3 py-1 text-[12px] font-medium backdrop-blur">
              View all
            </Link>
          </div>
          <p className="mt-4 max-w-[15ch] text-[30px] font-medium leading-[1.08] tracking-[-0.03em]">
            {sub.sub.name} {next.kind === 'trial_conversion' ? 'trial converts' : 'renews'} {days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
            <AppLogo providerId={sub.sub.providerId} category={sub.sub.category} color={sub.sub.color} size={30} />
            <span className="num rounded-full border border-on/40 px-3 py-1 text-[12px]">{money(next.amount)}</span>
            <span className="rounded-full border border-on/40 px-3 py-1 text-[12px]">{sub.hours30}h used in 30 days</span>
            <button
              onClick={() => onAsk(`Is ${sub.sub.name} worth keeping? It charges ${money(next.amount)} on ${next.date}.`)}
              className="ml-auto flex items-center gap-1 rounded-full bg-on px-3.5 py-1.5 text-[13px] font-semibold text-[#0035c5]"
            >
              Ask <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      <section className="panel flex flex-col p-5 lg:col-span-4" aria-label="Needs your decision">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-medium">Needs your decision</h2>
          <Link to="/" className="rounded-full bg-black px-3 py-1 text-[12px] font-medium shadow-sm">
            View all
          </Link>
        </div>
        {pending.length === 0 ? (
          <div className="flex flex-1 flex-col justify-end pt-6">
            <p className="text-[24px] font-medium leading-tight tracking-[-0.02em]">Nothing is waiting for you</p>
            <button onClick={() => onAsk('What can I cancel to save money?')} className="mt-3 w-fit text-[13px] text-muted underline decoration-white/20 underline-offset-4 hover:text-ink">
              Look for savings
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {pending.slice(0, 2).map((action) => (
              <ActionCard key={action.id} action={action} compact />
            ))}
            {pending.length > 2 && <p className="text-[12px] text-faint">and {pending.length - 2} more</p>}
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-1">
        <Stat icon={PiggyBank} label="You could keep a year" value={money(perYear)} />
        <Stat icon={WalletCards} label="Active subscriptions" value={String(portfolio.activeCount)} hint={`${money(portfolio.monthlySpend)} a month`} />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint }: { icon: typeof PiggyBank; label: string; value: string; hint?: string }) {
  return (
    <section className="panel flex min-h-[117px] flex-col justify-between p-5">
      <h2 className="text-[14px] text-muted">{label}</h2>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent text-on">
          <Icon size={18} aria-hidden="true" />
        </span>
        <span className="text-right">
          <span className="num block text-[30px] font-medium leading-none tracking-[-0.03em]">{value}</span>
          {hint && <span className="num mt-1 block text-[12px] text-faint">{hint}</span>}
        </span>
      </div>
    </section>
  );
}
