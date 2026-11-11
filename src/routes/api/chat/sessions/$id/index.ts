import { createFileRoute } from '@tanstack/react-router';
import { body, fail, handle, json, type RouteContext } from '@/server/http';
import { deleteSession, getSession, renameSession } from '@/server/services/chat';

// One conversation: read it in full, rename it, or delete it.
async function GET({ params }: RouteContext) {
  const session = getSession(params.id);
  return session ? json(session) : fail(404, 'That conversation no longer exists.');
}

async function PATCH({ request, params }: RouteContext) {
  const { title } = await body<{ title: string }>(request);
  const session = renameSession(params.id, title ?? '');
  return session ? json(session) : fail(400, 'Give the conversation a name.');
}

async function DELETE({ params }: RouteContext) {
  return deleteSession(params.id) ? json({ deleted: true }) : fail(404, 'That conversation no longer exists.');
}

export const Route = createFileRoute('/api/chat/sessions/$id/')({
  server: { handlers: { GET: handle('chat', GET, { quiet: true }), PATCH: handle('chat', PATCH), DELETE: handle('chat', DELETE) } },
});
