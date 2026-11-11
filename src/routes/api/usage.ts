import { createFileRoute } from '@tanstack/react-router';
import { providerById, sessionCookies } from '@/domain/catalog';
import { handle, type RouteContext } from '@/server/http';
import { log } from '@/server/logger';
import { buildState } from '@/server/services/state';
import { ingestUsage, sitesOf, type UsageReport } from '@/server/services/usage';
import { db, save } from '@/server/store';

interface Body {
  /**
   * Daily totals. The Android companion sends `package` (foreground minutes from
   * UsageStatsManager); the browser extension sends `site` (a subscription id from GET, minutes
   * on that service's domains).
   */
  days?: UsageReport[];
  source?: 'android' | 'web' | 'manual';
}

// Ingest endpoint for the Android companion and the browser extension. Both send daily totals
// only: no titles, page addresses, content or credentials.
async function POST({ request }: RouteContext) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const source = body.source === 'web' || body.source === 'manual' ? body.source : 'android';
  const { accepted, ignored } = ingestUsage(body.days ?? [], source);
  if (source === 'web') db().extensionSeenAt = new Date().toISOString();
  save();
  if (accepted > 0 || ignored > 0) log.info('usage', `${source} reported ${accepted} day total${accepted === 1 ? '' : 's'}`, { accepted, ignored });
  return Response.json({ accepted, ignored, state: buildState() });
}

// Each reporter asks what to measure, so it never records anything else: Android packages for
// the companion; for the browser extension, site domains and the name of the cookie that shows
// a signed-in session there.
async function GET() {
  const active = db().subscriptions.filter((s) => s.status !== 'cancelled');
  return Response.json({
    packages: active.filter((s) => s.androidPackage).map((s) => ({ package: s.androidPackage, name: s.name })),
    sites: active
      .map((s) => {
        // A subscription the catalog does not know has no site to watch.
        const provider = providerById(s.providerId ?? '');
        return { id: s.id, name: s.name, domains: sitesOf(s), sessionCookies: provider ? sessionCookies(provider) : [] };
      })
      .filter((s) => s.domains.length > 0),
  });
}

export const Route = createFileRoute('/api/usage')({
  server: {
    handlers: {
      POST: handle('usage', POST),
      GET: handle('usage', GET, { quiet: true }),
    },
  },
});
