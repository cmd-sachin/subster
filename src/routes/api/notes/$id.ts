import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { diffDays, today } from '@/domain/dates';
import { buildState } from '@/server/services/state';
import { db, save, uid } from '@/server/store';

// Reviews on the timeline: a reminder the user (or the agent) pins to a day for one subscription.
// POST /api/notes/new creates one, POST /api/notes/<id> moves it, DELETE removes it.
async function POST({ request, params }: RouteContext) {
  const { id } = params;
  const { date, subId } = (await request.json().catch(() => ({}))) as { date?: string; subId?: string };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || diffDays(date, today()) < 0) return Response.json({ error: 'Pick today or a later day.' }, { status: 400 });
  const data = db();
  if (id === 'new') {
    const sub = data.subscriptions.find((s) => s.id === subId);
    if (!sub) return Response.json({ error: 'Not found' }, { status: 404 });
    data.notes.push({ id: uid('note'), subId: sub.id, date, kind: 'review', label: `Review ${sub.name}` });
  } else {
    const note = data.notes.find((n) => n.id === id && n.kind === 'review');
    if (!note) return Response.json({ error: 'Not found' }, { status: 404 });
    note.date = date;
  }
  save();
  return Response.json(buildState());
}

async function DELETE({ params }: RouteContext) {
  const data = db();
  data.notes = data.notes.filter((n) => !(n.id === params.id && n.kind === 'review'));
  save();
  return Response.json(buildState());
}

export const Route = createFileRoute('/api/notes/$id')({
  server: {
    handlers: {
      POST: handle('notes', POST),
      DELETE: handle('notes', DELETE),
    },
  },
});
