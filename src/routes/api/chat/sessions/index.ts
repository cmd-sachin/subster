import { createFileRoute } from '@tanstack/react-router';
import { body, handle, json, type RouteContext } from '@/server/http';
import { createSession, listSessions } from '@/server/services/chat';

// GET lists the conversations, newest first. POST starts a new one.
async function GET() {
  return json({ sessions: listSessions() });
}

async function POST({ request }: RouteContext) {
  const { title } = await body<{ title: string }>(request);
  return json(createSession(title), 201);
}

export const Route = createFileRoute('/api/chat/sessions/')({
  server: { handlers: { GET: handle('chat', GET, { quiet: true }), POST: handle('chat', POST) } },
});
