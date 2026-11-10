import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { resolveCandidate } from '@/server/services/discovery';
import { buildState } from '@/server/services/state';
import { save } from '@/server/store';

// The user confirms or dismisses a recurring merchant the catalog does not recognise.
async function POST({ request }: RouteContext) {
  const { key, decision } = (await request.json().catch(() => ({}))) as { key?: string; decision?: 'track' | 'ignore' };
  if (!key || (decision !== 'track' && decision !== 'ignore')) return Response.json({ error: 'key and decision are required' }, { status: 400 });
  resolveCandidate(key, decision);
  save('candidate resolved');
  return Response.json(buildState());
}

export const Route = createFileRoute('/api/bank/candidates')({
  server: {
    handlers: {
      POST: handle('bank.candidates', POST),
    },
  },
});
