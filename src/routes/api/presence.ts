import { createFileRoute } from '@tanstack/react-router';
import { body, handle, json, type RouteContext } from '@/server/http';
import { recordPresence, verifyConnections, type PresenceReport } from '@/server/services/connections';
import { buildState } from '@/server/services/state';

// POST: the browser extension's live channel. It calls the moment a tracked site is opened or
// left, once a minute while one stays open, and whenever a sign-in check finishes. Open
// dashboards are told through the event stream, so they update within a second or two.
async function POST({ request }: RouteContext) {
  const { sites } = await body<{ sites: PresenceReport[] }>(request);
  return json({ updated: recordPresence(Array.isArray(sites) ? sites.slice(0, 200) : []) });
}

// PUT: verify every connection with its provider now, instead of waiting for the monitor.
async function PUT() {
  const changes = await verifyConnections();
  return json({ changes, state: buildState() });
}

export const Route = createFileRoute('/api/presence')({
  server: { handlers: { POST: handle('presence', POST, { quiet: true, access: 'device' }), PUT: handle('presence.verify', PUT) } },
});
