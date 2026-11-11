import { createFileRoute } from '@tanstack/react-router';
import { body, handle, json, type RouteContext } from '@/server/http';
import { log } from '@/server/logger';
import { buildState } from '@/server/services/state';
import { closeDemo, openDemo } from '@/server/store';
import { fillDemo } from '@/server/store/demo';

// Opens or closes the built-in demo data. The user's own data is set aside while it is open and
// restored unchanged when it is closed.
async function POST({ request }: RouteContext) {
  const { open } = await body<{ open: boolean }>(request);
  if (open) {
    const data = openDemo(fillDemo);
    log.info('demo', 'Demo data opened', { subscriptions: data.subscriptions.length, charges: data.charges.length, usageDays: data.usage.length });
  } else {
    closeDemo();
    log.info('demo', 'Demo data closed, own data restored');
  }
  return json(buildState());
}

export const Route = createFileRoute('/api/demo')({
  server: { handlers: { POST: handle('demo', POST) } },
});
