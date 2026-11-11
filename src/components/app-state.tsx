// Server state for the whole app, held in TanStack Query under one key. Pages read it with
// useApp(); anything that changes it either gets the new state back from the API (mutate) or is
// announced on the live event stream, which invalidates the query.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import type { AppState, LiveEvent } from '@/domain/types';

export const STATE_KEY = ['state'] as const;

async function fetchState(): Promise<AppState> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error(`State request failed (${res.status})`);
  return res.json();
}

export type MutateResult = { ok: boolean; error?: string; data?: unknown };

export function useApp() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: STATE_KEY, queryFn: fetchState });

  const refresh = useCallback(() => client.invalidateQueries({ queryKey: STATE_KEY }), [client]);

  /** Calls an endpoint that answers with the new AppState (bare, or under `state`) and stores it. */
  const mutate = useCallback(
    async (url: string, body?: unknown, method = 'POST'): Promise<MutateResult> => {
      try {
        const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: data.error ?? `Request failed (${res.status})` };
        const next = 'portfolio' in data ? data : data.state;
        if (next) client.setQueryData(STATE_KEY, next);
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [client],
  );

  return { state: query.data ?? null, error: query.error ? query.error.message : null, refresh, mutate };
}

/** Mounted once at the root: one event stream for the app. */
export function LiveUpdates() {
  const client = useQueryClient();
  useEffect(() => {
    const source = new EventSource('/api/events');
    let timer: ReturnType<typeof setTimeout> | undefined;
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveEvent;
      if (event.type !== 'state') return;
      clearTimeout(timer);
      // Several saves in a burst become one re-fetch.
      timer = setTimeout(() => void client.invalidateQueries({ queryKey: STATE_KEY }), 150);
    };
    // No stream on this server (it answered "no content"): look for changes every so often.
    let poll: ReturnType<typeof setInterval> | undefined;
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED || poll) return;
      poll = setInterval(() => document.visibilityState === 'visible' && void client.invalidateQueries({ queryKey: STATE_KEY }), 20_000);
    };
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      source.close();
    };
  }, [client]);
  return null;
}
