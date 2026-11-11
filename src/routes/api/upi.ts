import { createFileRoute } from '@tanstack/react-router';
import { UPI_PATTERN } from '@/domain/upi';
import { body, fail, handle, json, type RouteContext } from '@/server/http';
import { buildState } from '@/server/services/state';
import { db, save, uid } from '@/server/store';

// Links or removes a UPI ID. The ID is stored on this device only and is never sent anywhere.
async function POST({ request }: RouteContext) {
  const { vpa } = await body<{ vpa: string }>(request);
  const value = (vpa ?? '').trim().toLowerCase();
  if (!UPI_PATTERN.test(value)) return fail(400, 'That does not look like a UPI ID. It should look like name@bank.');
  const data = db();
  const ids = (data.upiIds ??= []);
  if (ids.some((i) => i.vpa === value)) return fail(400, 'That UPI ID is already linked.');
  if (ids.length >= 8) return fail(400, 'You can link up to eight UPI IDs.');
  ids.push({ id: uid('upi'), vpa: value, addedAt: new Date().toISOString() });
  save('upi linked');
  return json(buildState());
}

async function DELETE({ request }: RouteContext) {
  const { id } = await body<{ id: string }>(request);
  const data = db();
  data.upiIds = (data.upiIds ?? []).filter((i) => i.id !== id);
  save('upi removed');
  return json(buildState());
}

export const Route = createFileRoute('/api/upi')({
  server: { handlers: { POST: handle('upi', POST, { needs: 'connect' }), DELETE: handle('upi', DELETE) } },
});
