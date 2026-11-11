// In-process event bus. A change to one person's data is published to that person's open
// dashboards; log entries go to administrators only. One process only: behind several instances
// this becomes Redis pub/sub or Postgres LISTEN/NOTIFY with the same functions.

import type { LiveEvent, LogEntry } from '@/domain/types';

interface Listener {
  userId: string;
  admin: boolean;
  send: (event: LiveEvent) => void;
}

const bus = globalThis as unknown as { __substerSubscribers?: Set<Listener> };
const listeners = (bus.__substerSubscribers ??= new Set<Listener>());

export function subscribe(userId: string, admin: boolean, send: Listener['send']) {
  const listener = { userId, admin, send };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: LiveEvent, to: (listener: Listener) => boolean) {
  for (const listener of listeners) {
    if (!to(listener)) continue;
    try {
      listener.send(event);
    } catch {
      listeners.delete(listener);
    }
  }
}

export const publishTo = (userId: string, reason: string) => emit({ type: 'state', reason, at: new Date().toISOString() }, (l) => l.userId === userId);
export const publishLog = (entry: LogEntry) => emit({ type: 'log', entry }, (l) => l.admin);
