import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronRight, Pause, Play, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { onLiveLog } from '@/components/app-state';
import type { LogEntry, LogLevel } from '@/domain/types';

export const Route = createFileRoute('/logs')({ component: Logs });

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const TONE: Record<LogLevel, string> = { debug: 'text-faint', info: 'text-info', warn: 'text-warn', error: 'text-bad' };
const MAX = 800;

function Logs() {
  const [level, setLevel] = useState<LogLevel>('info');
  const [scope, setScope] = useState('');
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(true);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  // History comes from the server once; after that the event stream appends new entries.
  const history = useQuery({
    queryKey: ['logs'],
    queryFn: async () => (await fetch('/api/logs?level=debug&limit=600')).json() as Promise<{ file: string; entries: LogEntry[] }>,
    staleTime: Infinity,
  });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeding the live buffer from the fetched history
    if (history.data) setEntries(history.data.entries);
  }, [history.data]);
  useEffect(() => {
    if (!live) return;
    return onLiveLog(({ entry }) => setEntries((current) => (current.some((e) => e.id === entry.id) ? current : [entry, ...current].slice(0, MAX))));
  }, [live]);

  const scopes = useMemo(() => [...new Set(entries.map((e) => e.scope))].sort(), [entries]);
  const needle = search.trim().toLowerCase();
  const shown = entries.filter(
    (e) => RANK[e.level] >= RANK[level] && (!scope || e.scope === scope) && (!needle || `${e.message} ${e.scope} ${e.requestId ?? ''} ${JSON.stringify(e.meta ?? '')}`.toLowerCase().includes(needle)),
  );
  const counts = { warn: entries.filter((e) => e.level === 'warn').length, error: entries.filter((e) => e.level === 'error').length };

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pb-4 pt-7 md:px-8">
        <h1 className="text-[26px] font-semibold tracking-tight">Application logs</h1>
        <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-muted">
          Everything the server does, as it happens: requests, agent runs and tool calls, PayPal and bank calls, discovery and classification. Credentials are redacted before anything
          is written.{history.data && <span className="text-faint"> Also on disk at {history.data.file}</span>}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-white/[0.05] p-1" role="group" aria-label="Minimum level">
            {LEVELS.map((l) => (
              <button key={l} onClick={() => setLevel(l)} aria-pressed={level === l} className={`rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize ${level === l ? 'bg-white/[0.1] text-ink' : 'text-muted hover:text-ink'}`}>
                {l}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="log-scope">
            Scope
          </label>
          <select id="log-scope" value={scope} onChange={(e) => setScope(e.target.value)} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px]">
            <option value="">All scopes</option>
            {scopes.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
            <label className="sr-only" htmlFor="log-search">
              Search logs
            </label>
            <input id="log-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search messages, request ids, metadata" className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-[12px] placeholder:text-faint" />
          </div>
          <button onClick={() => setLive(!live)} className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-[12px] font-medium hover:bg-white/[0.07]">
            {live ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
            {live ? 'Pause live tail' : 'Resume live tail'}
          </button>
          <span className="num text-[12px] text-muted">
            {shown.length} shown · <span className="text-warn">{counts.warn} warnings</span> · <span className="text-bad">{counts.error} errors</span>
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto border-t border-white/[0.06] font-mono text-[12px]" role="log" aria-live={live ? 'polite' : 'off'}>
        {shown.length === 0 ? (
          <p className="p-8 font-sans text-[13px] text-muted">{entries.length === 0 ? 'No log entries yet. Use the app and they will appear here.' : 'Nothing matches these filters.'}</p>
        ) : (
          <ul>
            {shown.map((e) => (
              <li key={e.id} className="border-b border-white/[0.04]">
                <button onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id} className="flex w-full items-baseline gap-3 px-4 py-1.5 text-left hover:bg-white/[0.03] md:px-8">
                  <ChevronRight size={12} className={`shrink-0 self-center text-faint transition-transform ${open === e.id ? 'rotate-90' : ''} ${e.meta ? '' : 'invisible'}`} aria-hidden="true" />
                  <span className="num shrink-0 text-faint">{new Date(e.at).toLocaleTimeString([], { hour12: false })}</span>
                  <span className={`w-11 shrink-0 font-semibold uppercase ${TONE[e.level]}`}>{e.level}</span>
                  <span className="w-28 shrink-0 truncate text-muted">{e.scope}</span>
                  <span className="min-w-0 flex-1 break-words text-ink">{e.message}</span>
                  {typeof e.meta?.ms === 'number' && <span className="num shrink-0 text-faint">{e.meta.ms} ms</span>}
                  {e.requestId && <span className="hidden shrink-0 text-faint lg:inline">{e.requestId}</span>}
                </button>
                {open === e.id && e.meta && <pre className="overflow-x-auto bg-black/30 px-4 py-2 pl-12 text-[11px] leading-relaxed text-muted md:pl-16">{JSON.stringify(e.meta, null, 2)}</pre>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
