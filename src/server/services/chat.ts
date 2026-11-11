// Conversations with the agent. Each one is kept on the server with everything the agent showed
// (its steps, components and proposals), so a conversation can be reopened exactly as it was and
// the agent picks up with the context of what was already said.

import type { ChatSession, ChatSessionSummary, ChatTurn } from '@/domain/types';
import { db, save, uid } from '@/server/store';

const MAX_SESSIONS = 40;
const MAX_TURNS = 80;
/** How many earlier turns the agent is given as context. */
const CONTEXT_TURNS = 12;

const sessions = () => (db().chats ??= []);

const summary = (s: ChatSession): ChatSessionSummary => {
  const last = [...s.turns].reverse().find((t) => t.content);
  return { id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, messages: s.turns.length, preview: (last?.content ?? '').replace(/[*`#]/g, '').slice(0, 120) };
};

export const listSessions = (): ChatSessionSummary[] => [...sessions()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary);

export const getSession = (id: string) => sessions().find((s) => s.id === id);

export function createSession(title?: string): ChatSession {
  const now = new Date().toISOString();
  const session: ChatSession = { id: uid('chat'), title: title?.trim().slice(0, 80) || 'New conversation', createdAt: now, updatedAt: now, turns: [] };
  const all = sessions();
  all.unshift(session);
  // The oldest conversations make room for new ones.
  all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).splice(MAX_SESSIONS);
  save('chat');
  return session;
}

export function renameSession(id: string, title: string) {
  const session = getSession(id);
  if (!session || !title.trim()) return undefined;
  session.title = title.trim().slice(0, 80);
  save('chat');
  return session;
}

export function deleteSession(id: string) {
  const data = db();
  const before = sessions().length;
  data.chats = sessions().filter((s) => s.id !== id);
  if (data.chats.length !== before) save('chat');
  return data.chats.length !== before;
}

/** Takes back the last question and its reply, so asking again does not leave both in the record. */
export function dropLastExchange(id: string) {
  const session = getSession(id);
  if (!session) return;
  if (session.turns.at(-1)?.role === 'assistant') session.turns.pop();
  if (session.turns.at(-1)?.role === 'user') session.turns.pop();
}

export function appendTurns(id: string, turns: ChatTurn[]) {
  const session = getSession(id);
  if (!session) return;
  const first = session.turns.length === 0 && turns.find((t) => t.role === 'user');
  if (first && session.title === 'New conversation') session.title = first.content.replace(/\s+/g, ' ').slice(0, 60);
  session.turns.push(...turns);
  session.turns = session.turns.slice(-MAX_TURNS);
  session.updatedAt = new Date().toISOString();
  save('chat');
}

/**
 * The conversation so far, as the agent should remember it. A reply's text alone loses what was
 * shown with it, so components and proposals are written back in as a short note.
 */
export function contextOf(session: ChatSession): { role: 'user' | 'assistant'; content: string }[] {
  return session.turns.slice(-CONTEXT_TURNS).flatMap((turn): { role: 'user' | 'assistant'; content: string }[] => {
    if (turn.role === 'user') return [{ role: 'user' as const, content: turn.content }];
    const shown = turn.steps.flatMap((step) => {
      if (step.widget) {
        const w = step.widget;
        const rows = w.items.map((i) => [i.label, i.text].filter(Boolean).join(' ')).join('; ') || (w.rows ?? []).map((r) => r.join(' ')).join('; ');
        return [`[You showed a ${w.type}${w.title ? ` "${w.title}"` : ''}: ${rows.slice(0, 500)}]`];
      }
      if (step.actionId) return [`[You showed an approval card: ${step.title.slice(0, 160)}]`];
      return [];
    });
    const content = [turn.content, ...shown].filter(Boolean).join('\n');
    return content ? [{ role: 'assistant' as const, content }] : [];
  });
}
