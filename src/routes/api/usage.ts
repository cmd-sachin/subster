import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { iso } from '@/domain/dates';
import { buildState } from '@/server/services/state';
import { db, save } from '@/server/store';

interface Body {
  /** Daily foreground totals as Android's UsageStatsManager reports them. */
  days?: { package?: string; date?: string; minutes?: number }[];
  source?: 'android' | 'manual';
}

// Ingest endpoint for the Android companion app. It sends per-app daily totals only: no titles,
// no content, no credentials. Packages that do not belong to a tracked subscription are dropped.
async function POST({ request }: RouteContext) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const data = db();
  let accepted = 0;
  let ignored = 0;

  for (const day of body.days ?? []) {
    const sub = data.subscriptions.find((s) => s.androidPackage && s.androidPackage === day.package);
    const time = Date.parse(day.date ?? '');
    const minutes = Math.round(Number(day.minutes));
    if (!sub || Number.isNaN(time) || !(minutes >= 0) || minutes > 1440) {
      ignored++;
      continue;
    }
    const date = iso(new Date(time));
    const existing = data.usage.find((u) => u.subId === sub.id && u.date === date);
    if (existing) existing.minutes = minutes;
    else data.usage.push({ subId: sub.id, date, minutes, source: body.source ?? 'android' });
    if (sub.coverage === 'none') sub.coverage = 'phone';
    accepted++;
  }
  save();
  return Response.json({ accepted, ignored, state: buildState() });
}

// The companion asks which apps to measure, so it never reads usage for anything else.
async function GET() {
  const packages = db()
    .subscriptions.filter((s) => s.androidPackage && s.status !== 'cancelled')
    .map((s) => ({ package: s.androidPackage, name: s.name }));
  return Response.json({ packages });
}

export const Route = createFileRoute('/api/usage')({
  server: {
    handlers: {
      POST: handle('usage', POST),
      GET: handle('usage', GET),
    },
  },
});
