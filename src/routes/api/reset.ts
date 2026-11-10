import { createFileRoute } from '@tanstack/react-router';
import { handle } from '@/server/http';
import { buildState } from '@/server/services/state';
import { reset } from '@/server/store';

async function POST() {
  reset();
  return Response.json(buildState());
}

export const Route = createFileRoute('/api/reset')({
  server: {
    handlers: {
      POST: handle('reset', POST),
    },
  },
});
