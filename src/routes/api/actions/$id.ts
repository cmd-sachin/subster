import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { confirmGuided, execute, reject } from '@/server/services/actions';
import { buildState } from '@/server/services/state';

// The only place a proposal turns into a real change: the user's explicit decision.
async function POST({ request, params }: RouteContext) {
  const { id } = params;
  const { decision } = (await request.json().catch(() => ({}))) as { decision?: string };
  try {
    if (decision === 'approve') await execute(id, 'user', new URL(request.url).origin);
    else if (decision === 'reject') reject(id);
    else if (decision === 'done') confirmGuided(id);
    else return Response.json({ error: 'decision must be approve, reject or done' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
  return Response.json(buildState());
}

export const Route = createFileRoute('/api/actions/$id')({
  server: {
    handlers: {
      POST: handle('actions', POST),
    },
  },
});
