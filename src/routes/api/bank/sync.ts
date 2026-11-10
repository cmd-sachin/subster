import { createFileRoute } from '@tanstack/react-router';
import { handle, json } from '@/server/http';
import { syncBank } from '@/server/services/bank';
import { buildState } from '@/server/services/state';

async function POST() {
  const result = await syncBank({ source: 'MANUAL_SYNC' });
  return json({ result, state: buildState() });
}

export const Route = createFileRoute('/api/bank/sync')({
  server: { handlers: { POST: handle('bank.sync', POST) } },
});
