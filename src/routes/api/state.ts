import { createFileRoute } from '@tanstack/react-router';
import { handle } from '@/server/http';
import { buildState } from '@/server/services/state';

async function GET() {
  return Response.json(buildState());
}

export const Route = createFileRoute('/api/state')({
  server: {
    handlers: {
      GET: handle('state', GET, { quiet: true }),
    },
  },
});
