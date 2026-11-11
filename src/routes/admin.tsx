// For administrators: who has an account, what each may do, and what the server has been doing.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { RefreshCw, Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Loader } from '@/components/loader';
import { notify } from '@/components/notifications';
import { useSession, type SessionUser } from '@/components/session';
import type { LogEntry, LogLevel } from '@/domain/types';

export const Route = createFileRoute('/admin')({ component: Admin });

type Person = SessionUser & { subscriptions: number; demo: boolean; paypalAgreements: number };
interface People {
  signups: boolean;
  guestDemo: boolean;
  users: Person[];
}
const USERS_KEY = ['admin-users'] as const;
const PERMISSIONS = [
  ['assistant', 'Assistant'],
  ['paypal', 'PayPal actions'],
  ['connect', 'Link accounts'],
] as const;

const ago = (iso?: string) => {
  if (!iso) return 'Never';
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return minutes < 2 ? 'Just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

function Admin() {
  const { me } = useSession();
  const [tab, setTab] = useState<'people' | 'logs'>('people');
  if (!me) return <Loader label="Loading" />;
  if (me.user?.role !== 'admin') return <p className="px-8 py-16 text-center text-[15px] text-muted">This page is for administrators.</p>;

  return (
    <div className="space-y-5 px-4 py-6 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="mt-0.5 text-[34px] font-semibold tracking-[-0.03em]">People and logs</h1>
        </div>
        <div className="flex rounded-full bg-black/70 p-1 shadow-sm" role="tablist">
          {(['people', 'logs'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-[13px] font-medium capitalize transition-colors ${tab === t ? 'bg-accent text-on' : 'text-muted hover:text-ink'}`}>
              {t}
            </button>
          ))}
        </div>
      </header>
      {!me.persistent && <p className="rounded-2xl bg-warn-soft px-4 py-3 text-[13px] text-warn">This server wipes its disk between restarts, so accounts and data here will not last. Run it somewhere with a persistent volume and set SUBSTER_DATA_DIR.</p>}
      {tab === 'people' ? <PeopleTab me={me.user} /> : <LogsTab />}
    </div>
  );
}

function PeopleTab({ me }: { me: SessionUser }) {
  const client = useQueryClient();
  const { data } = useQuery({ queryKey: USERS_KEY, queryFn: async () => (await (await fetch('/api/admin/users')).json()) as People });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [confirming, setConfirming] = useState<string | null>(null);

  async function call(url: string, body?: unknown, method = 'POST') {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) notify({ tone: 'bad', title: 'That was not saved', body: out.error });
    await client.invalidateQueries({ queryKey: USERS_KEY });
    return res.ok;
  }

  if (!data) return <Loader label="Loading people" />;
  const active = data.users.filter((u) => u.status === 'active' && !u.guest).length;

  return (
    <>
      <dl className="panel grid grid-cols-2 divide-x divide-white/[0.06] sm:grid-cols-4">
        {[
          ['Accounts', data.users.filter((u) => !u.guest).length],
          ['Active', active],
          ['Administrators', data.users.filter((u) => u.role === 'admin').length],
          ['PayPal agreements', data.users.reduce((t, u) => t + u.paypalAgreements, 0)],
        ].map(([label, value]) => (
          <div key={label} className="px-5 py-4">
            <dt className="text-[13px] text-muted">{label}</dt>
            <dd className="num mt-1 text-[26px] font-semibold tracking-[-0.03em]">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold">New accounts</h2>
          <p className="text-[13px] text-muted">{data.signups ? 'Anyone with the address can create an account.' : 'Closed. Only you can add people.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch on={data.signups} label="Open sign-ups" onChange={(on) => void call('/api/admin/users', { signups: on })} />
          <button onClick={() => setAdding(!adding)} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-on">
            <UserPlus size={15} aria-hidden="true" /> Add a person
          </button>
        </div>
        {adding && (
          <form
            className="grid w-full gap-2 border-t border-white/[0.06] pt-4 sm:grid-cols-[1fr_1fr_1fr_auto]"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await call('/api/admin/users', form)) {
                setForm({ name: '', email: '', password: '' });
                setAdding(false);
                notify({ tone: 'good', title: 'Account added', body: 'Share the temporary password with them privately.' });
              }
            }}
          >
            <input required placeholder="Name" aria-label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-full border border-white/10 bg-black px-4 py-2 text-[14px]" />
            <input required type="email" placeholder="Email" aria-label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-full border border-white/10 bg-black px-4 py-2 text-[14px]" />
            <input required type="password" minLength={8} placeholder="Temporary password" aria-label="Temporary password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-full border border-white/10 bg-black px-4 py-2 text-[14px]" />
            <button type="submit" className="rounded-full border border-accent px-4 py-2 text-[13px] font-medium text-accent hover:bg-accent-soft">
              Add
            </button>
          </form>
        )}
      </section>

      <section className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold">Demo without an account</h2>
          <p className="text-[13px] text-muted">{data.guestDemo ? 'The sign-in screen offers the demo. Guests see sample data only, last an hour, and are deleted when they leave.' : 'Off. People need an account to see anything.'}</p>
        </div>
        <Switch on={data.guestDemo} label="Offer the demo without an account" onChange={(on) => void call('/api/admin/users', { guestDemo: on })} />
      </section>

      <section className="panel overflow-hidden" aria-label="Accounts">
        <ul className="divide-y divide-white/[0.06]">
          {data.users.map((u) => {
            const self = u.id === me.id;
            return (
              <li key={u.id} className={`flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 ${u.status === 'suspended' ? 'opacity-60' : ''}`}>
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[14px] font-semibold ${u.role === 'admin' ? 'bg-accent text-on' : 'bg-accent-soft text-accent'}`}>{u.name.charAt(0).toUpperCase()}</span>
                <div className="min-w-[180px] flex-1">
                  <p className="flex items-center gap-2 text-[14px] font-semibold">
                    {u.name}
                    {self && <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] font-normal text-muted">You</span>}
                    {u.guest && <span className="rounded-full bg-sun-soft px-2 py-0.5 text-[11px] font-normal">Guest</span>}
                    {u.demo && !u.guest && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-normal text-warn">In demo</span>}
                    {u.status === 'suspended' && <span className="rounded-full bg-bad-soft px-2 py-0.5 text-[11px] font-normal text-bad">Suspended</span>}
                  </p>
                  <p className="text-[12px] text-muted">
                    {u.email} · {u.subscriptions} subscription{u.subscriptions === 1 ? '' : 's'} · seen {ago(u.lastSeenAt).toLowerCase()}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5" aria-label={`What ${u.name} may do`}>
                  {PERMISSIONS.map(([key, label]) => (
                    <button
                      key={key}
                      disabled={u.role === 'admin'}
                      aria-pressed={u.role === 'admin' || u.permissions[key]}
                      title={u.role === 'admin' ? 'Administrators can do everything' : undefined}
                      onClick={() => void call(`/api/admin/users/${u.id}`, { permissions: { [key]: !u.permissions[key] } })}
                      className={`rounded-full border px-3 py-1 text-[12px] transition-colors disabled:cursor-default ${u.role === 'admin' || u.permissions[key] ? 'border-accent/30 bg-accent-soft text-accent' : 'border-white/10 text-faint line-through'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <select
                    aria-label={`Role of ${u.name}`}
                    value={u.role}
                    onChange={(e) => void call(`/api/admin/users/${u.id}`, { role: e.target.value })}
                    className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-[13px]"
                  >
                    <option value="user">Member</option>
                    <option value="admin">Administrator</option>
                  </select>
                  {!self && (
                    <button onClick={() => void call(`/api/admin/users/${u.id}`, { status: u.status === 'active' ? 'suspended' : 'active' })} className="rounded-full border border-white/10 px-3 py-1.5 text-[13px] hover:border-white/25">
                      {u.status === 'active' ? 'Suspend' : 'Restore'}
                    </button>
                  )}
                  {!self &&
                    (confirming === u.id ? (
                      <button
                        onClick={async () => {
                          setConfirming(null);
                          if (await call(`/api/admin/users/${u.id}`, undefined, 'DELETE')) notify({ tone: 'good', title: 'Account deleted', body: `${u.name} and their data are gone.` });
                        }}
                        onBlur={() => setConfirming(null)}
                        className="rounded-full bg-bad px-3 py-1.5 text-[13px] font-medium text-on"
                      >
                        Delete for good
                      </button>
                    ) : (
                      <button onClick={() => setConfirming(u.id)} aria-label={`Delete ${u.name}`} title="Delete the account and its data" className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-bad-soft hover:text-bad">
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <p className="flex items-center gap-2 px-1 text-[12px] text-faint">
        <ShieldCheck size={14} aria-hidden="true" /> You can see who has an account and how much they hold, not their subscriptions or payments.
      </p>
    </>
  );
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-7 w-12 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-white/15'}`} style={{ padding: 0 }}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-on shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

const LEVEL: Record<LogLevel, string> = { debug: 'bg-white/[0.07] text-muted', info: 'bg-accent-soft text-accent', warn: 'bg-warn-soft text-warn', error: 'bg-bad-soft text-bad' };

function LogsTab() {
  const [level, setLevel] = useState<LogLevel | ''>('info');
  const [q, setQ] = useState('');
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['admin-logs', level, q],
    queryFn: async () => ((await (await fetch(`/api/logs?limit=300${level ? `&level=${level}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`)).json()) as { entries: LogEntry[] }).entries,
    refetchInterval: 5000,
  });

  return (
    <section className="panel overflow-hidden" aria-label="Server logs">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-full border border-white/10 bg-black px-3.5 py-2 focus-within:border-accent">
          <Search size={14} className="text-faint" aria-hidden="true" />
          <span className="sr-only">Search the logs</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" style={{ outline: 'none' }} className="min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-faint" />
        </label>
        <select aria-label="Least serious level to show" value={level} onChange={(e) => setLevel(e.target.value as LogLevel | '')} className="rounded-full border border-white/10 bg-black px-3.5 py-2 text-[13px]">
          <option value="">Everything</option>
          <option value="info">Info and above</option>
          <option value="warn">Warnings and errors</option>
          <option value="error">Errors only</option>
        </select>
        <button onClick={() => void refetch()} className="flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-2 text-[13px] hover:border-white/25">
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
        </button>
      </div>
      {!data ? (
        <Loader label="Reading the logs" />
      ) : data.length === 0 ? (
        <p className="px-5 py-12 text-center text-[14px] text-muted">Nothing matches.</p>
      ) : (
        <ol className="max-h-[68vh] divide-y divide-white/[0.05] overflow-auto">
          {data.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2 text-[13px]">
              <time className="num w-[70px] shrink-0 text-[12px] text-faint" dateTime={entry.at} title={new Date(entry.at).toLocaleString()}>
                {new Date(entry.at).toLocaleTimeString(undefined, { hour12: false })}
              </time>
              <span className={`w-[52px] shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-medium ${LEVEL[entry.level]}`}>{entry.level}</span>
              <span className="w-[72px] shrink-0 text-[12px] text-muted">{entry.scope}</span>
              <span className="min-w-0 flex-1">
                {entry.message}
                {entry.meta && <span className="num ml-2 break-all text-[12px] text-faint">{JSON.stringify(entry.meta)}</span>}
              </span>
              {entry.userId && <span className="num shrink-0 text-[11px] text-faint">{entry.userId.slice(0, 8)}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
