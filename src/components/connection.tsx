// How one subscription is connected, as worked out on the server from the browser extension, the
// Android companion, linked accounts and the billing source. Nothing here is entered by the user.

import { Banknote, Globe, KeyRound, Smartphone } from 'lucide-react';
import { diffDays, today } from '@/domain/dates';
import type { ConnectionSignal, ServiceConnection } from '@/domain/types';

const DOT: Record<ServiceConnection['state'], string> = { live: 'bg-accent animate-pulse', connected: 'bg-good', attention: 'bg-bad', waiting: 'bg-faint' };
const TEXT: Record<ServiceConnection['state'], string> = { live: 'text-accent', connected: 'text-good', attention: 'text-bad', waiting: 'text-faint' };
const ICON: Record<ConnectionSignal['kind'], typeof Globe> = { browser: Globe, phone: Smartphone, account: KeyRound, billing: Banknote };

/** "just now", "5 min ago", "3 days ago". */
export function since(stamp?: string) {
  if (!stamp) return '';
  if (stamp.length === 10) {
    const days = diffDays(today(), stamp);
    return days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  }
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(stamp)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

export function ConnectionBadge({ connection }: { connection: ServiceConnection }) {
  return (
    <span className={`flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium ${TEXT[connection.state]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[connection.state]}`} aria-hidden="true" />
      {connection.headline}
    </span>
  );
}

function authLine({ auth }: ServiceConnection) {
  if (auth.via === 'none') return null;
  const where = auth.via === 'oauth' ? 'through the linked account' : 'your browser';
  const expires = auth.expiresAt ? diffDays(auth.expiresAt.slice(0, 10), today()) : null;
  const texts = auth.via === 'oauth'
    ? { signed_in: `Signed in ${where}`, likely: `Signed in ${where}`, signed_out: 'The linked account no longer works', unknown: 'Sign-in could not be read' }
    : { signed_in: `Session found in ${where}: signed in`, likely: `A session exists in ${where}, sign-in not confirmed`, signed_out: `No session in ${where}: signed out there`, unknown: 'Sign-in could not be read' };
  const text = texts[auth.status];
  return `${text}${auth.status !== 'signed_out' && expires !== null ? `, session ${expires <= 0 ? 'expires today' : `lasts ${expires} more day${expires === 1 ? '' : 's'}`}` : ''}${auth.checkedAt ? ` · checked ${since(auth.checkedAt)}` : ''}`;
}

export function ConnectionPanel({ connection }: { connection: ServiceConnection }) {
  const auth = authLine(connection);
  return (
    <div>
      <p className="flex items-center justify-between gap-3">
        <span className={`flex items-center gap-2 text-[14px] font-semibold ${TEXT[connection.state]}`}>
          <span className={`h-2 w-2 rounded-full ${DOT[connection.state]}`} aria-hidden="true" />
          {connection.headline}
        </span>
      </p>
      {auth && <p className={`mt-1.5 text-[13px] ${connection.auth.status === 'signed_out' ? 'text-bad' : ''}`}>{auth}</p>}
      <ul className="mt-2.5 space-y-1.5">
        {connection.signals.map((signal) => {
          const Icon = ICON[signal.kind];
          return (
            <li key={signal.kind} className={`flex items-start gap-2 text-[13px] ${signal.ok ? '' : 'text-muted'}`}>
              <Icon size={14} strokeWidth={1.75} className={`mt-0.5 shrink-0 ${signal.ok ? 'text-good' : 'text-faint'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">{signal.label}</span>
              {signal.at && signal.at.length > 10 && <span className="num shrink-0 text-[11px] text-faint">{since(signal.at)}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
