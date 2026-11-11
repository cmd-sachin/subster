import crypto from 'node:crypto';
import { createFileRoute } from '@tanstack/react-router';
import { scheduledAudit } from '@/server/agent/schedule';
import { fail, handle, json, type RouteContext } from '@/server/http';
import { log } from '@/server/logger';
import { verifyConnections } from '@/server/services/connections';
import { monitorOnce } from '@/server/services/plans';
import { eachUser } from '@/server/users';

// The background work, run on request. A server that stays running does this on its own timers;
// a serverless host has none, so its scheduler calls this once a day (see vercel.json). The caller
// must present CRON_SECRET, which Vercel sends with its scheduled calls.
async function GET({ request }: RouteContext) {
  const secret = process.env.CRON_SECRET ?? '';
  const given = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return fail(401, 'Not allowed.');

  let accounts = 0;
  await eachUser(async () => {
    accounts++;
    await verifyConnections();
    await scheduledAudit();
    await monitorOnce();
  });
  log.info('jobs', 'Scheduled work finished', { accounts });
  return json({ ok: true, accounts });
}

export const Route = createFileRoute('/api/cron')({
  server: { handlers: { GET: handle('cron', GET, { access: 'public' }) } },
});
