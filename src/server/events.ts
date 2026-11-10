// In-process event bus. Anything that changes state, and every log entry, is published here; the
// /api/events stream forwards it to every open dashboard, which is what makes bank and PayPal
// events show up live. One process only: behind several instances this becomes Redis pub/sub or
// Postgres LISTEN/NOTIFY with the same functions.

import type { LiveEvent, LogEntry } from '@/domain/types';

type Listener = (event: LiveEvent) => void;

const bus = globalThis as unknown as { __subsenseListeners?: Set<Listener> };
const listeners = (bus.__subsenseListeners ??= new Set<Listener>());

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: LiveEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      listeners.delete(listener);
    }
  }
}

export const publish = (reason: string) => emit({ type: 'state', reason, at: new Date().toISOString() });
export const publishLog = (entry: LogEntry) => emit({ type: 'log', entry });
