import { createFileRoute } from '@tanstack/react-router';
import { providerById, webDomains } from '@/domain/catalog';
import { iso } from '@/domain/dates';
import type { Coverage, Subscription } from '@/domain/types';
import { handle, type RouteContext } from '@/server/http';
import { log } from '@/server/logger';
import { buildState } from '@/server/services/state';
import { db, save } from '@/server/store';

interface Body {
  /**
   * Daily totals. The Android companion sends `package` (foreground minutes from
   * UsageStatsManager); the browser extension sends `site` (a subscription id from GET, minutes
   * on that service's domains).
   */
  days?: { package?: string; site?: string; date?: string; minutes?: number }[];
  source?: 'android' | 'web' | 'manual';
}

/** What a subscription's coverage becomes once a device has reported for it. */
const WITH_DEVICE: Record<'android' | 'web', Partial<Record<Coverage, Coverage>>> = {
  android: { none: 'phone', web: 'phone+web' },
  web: { none: 'web', phone: 'phone+web' },
};

function sitesOf(sub: Subscription) {
  const provider = providerById(sub.providerId ?? '');
  return provider ? webDomains(provider) : [];
}

// Ingest endpoint for the Android companion and the browser extension. Both send daily totals
// only: no titles, page addresses, content or credentials. Anything that does not belong to a
// tracked subscription is dropped. Each device overwrites its own total for a day, and the
// devices' totals add up.
async function POST({ request }: RouteContext) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const data = db();
  const source = body.source === 'web' || body.source === 'manual' ? body.source : 'android';
  let accepted = 0;
  let ignored = 0;

  for (const day of body.days ?? []) {
    const sub =
      source === 'web'
        ? data.subscriptions.find((s) => s.id === day.site && s.status !== 'cancelled' && sitesOf(s).length > 0)
        : data.subscriptions.find((s) => s.androidPackage && s.androidPackage === day.package);
    const time = Date.parse(day.date ?? '');
    const minutes = Math.round(Number(day.minutes));
    if (!sub || Number.isNaN(time) || !(minutes >= 0) || minutes > 1440) {
      ignored++;
      continue;
    }
    const date = iso(new Date(time));
    const existing = data.usage.find((u) => u.subId === sub.id && u.date === date && u.source === source);
    if (existing) existing.minutes = minutes;
    else data.usage.push({ subId: sub.id, date, minutes, source });
    if (source !== 'manual') sub.coverage = WITH_DEVICE[source][sub.coverage] ?? sub.coverage;
    accepted++;
  }
  save();
  if (accepted > 0 || ignored > 0) log.info('usage', `${source} reported ${accepted} day total${accepted === 1 ? '' : 's'}`, { accepted, ignored });
  return Response.json({ accepted, ignored, state: buildState() });
}

// Each reporter asks what to measure, so it never records anything else: Android packages for
// the companion, site domains for the browser extension.
async function GET() {
  const active = db().subscriptions.filter((s) => s.status !== 'cancelled');
  return Response.json({
    packages: active.filter((s) => s.androidPackage).map((s) => ({ package: s.androidPackage, name: s.name })),
    sites: active.map((s) => ({ id: s.id, name: s.name, domains: sitesOf(s) })).filter((s) => s.domains.length > 0),
  });
}

export const Route = createFileRoute('/api/usage')({
  server: {
    handlers: {
      POST: handle('usage', POST),
      GET: handle('usage', GET),
    },
  },
});
