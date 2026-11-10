import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { diffDays, today } from '@/domain/dates';
import { buildState } from '@/server/services/state';
import { db, save } from '@/server/store';

// Dragging a review on the timeline reschedules it.
async function POST({ request, params }: RouteContext) {
  const { id } = params;
  const { date } = (await request.json().catch(() => ({}))) as { date?: string };
  const note = db().notes.find((n) => n.id === id && n.kind === 'review');
  if (!note) return Response.json({ error: 'Not found' }, { status: 404 });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || diffDays(date, today()) < 0) return Response.json({ error: 'date must be today or later' }, { status: 400 });
  note.date = date;
  save();
  return Response.json(buildState());
}

export const Route = createFileRoute('/api/notes/$id')({
  server: {
    handlers: {
      POST: handle('notes', POST),
    },
  },
});
