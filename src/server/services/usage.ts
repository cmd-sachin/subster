// Usage ingest, shared by the Android companion and the browser extension. Both send daily totals
// only. Each device overwrites its own total for a day, and the devices' totals add up.

import { providerById, webDomains } from '@/domain/catalog';
import { iso } from '@/domain/dates';
import type { Coverage, Subscription } from '@/domain/types';
import { db } from '@/server/store';

export interface UsageReport {
  package?: string;
  site?: string;
  date?: string;
  minutes?: number;
}

/** What a subscription's coverage becomes once a device has reported for it. */
const WITH_DEVICE: Record<'android' | 'web', Partial<Record<Coverage, Coverage>>> = {
  android: { none: 'phone', web: 'phone+web' },
  web: { none: 'web', phone: 'phone+web' },
};

/** The domains the browser extension measures for a subscription. */
export function sitesOf(sub: Subscription) {
  const provider = providerById(sub.providerId ?? '');
  return provider ? webDomains(provider) : [];
}

/** Records daily totals. Anything that does not belong to a tracked subscription is dropped. The caller saves. */
export function ingestUsage(days: UsageReport[], source: 'android' | 'web' | 'manual') {
  const data = db();
  let accepted = 0;
  let ignored = 0;
  for (const day of days) {
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
  return { accepted, ignored };
}
