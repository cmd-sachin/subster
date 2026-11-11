// How each subscription is connected, worked out without the user doing anything.
//
// Signals come from four places: the browser extension (the site is open right now; a signed-in
// session exists there), the Android companion (the app was used), a provider account linked by
// OAuth, and the billing source (a PayPal agreement read back from PayPal, or a payment seen in
// the bank feed). A background monitor re-verifies the two things that can silently stop working:
// PayPal agreements and OAuth links.
//
// What this cannot do: sign in to a provider for the user, or see inside a provider that has no
// API. For those, "signed in" means the user's own browser holds a session, as reported by the
// extension.

import { diffDays, shortDate, today } from '@/domain/dates';
import type { AuthStatus, ConnectionSignal, Db, ServiceConnection, SubStatus, Subscription } from '@/domain/types';
import { getSubscriptionStatus, paypalMode } from '@/server/integrations/paypal';
import { log } from '@/server/logger';
import { db, save, uid } from '@/server/store';
import { verifySpotifyLink } from './accounts';
import { ingestUsage, sitesOf } from './usage';

/** A site counts as in use for this long after its last heartbeat. */
const ACTIVE_FOR_MS = 100_000;
const MONITOR_EVERY_MS = 10 * 60 * 1000;
const AUTH_VALUES: AuthStatus[] = ['signed_in', 'likely', 'signed_out', 'unknown'];

export interface PresenceReport {
  site?: string;
  active?: boolean;
  auth?: AuthStatus;
  sessionExpiresAt?: string;
  /** Today's total for the site so far, so usage is current without waiting for the next sync. */
  date?: string;
  minutes?: number;
}

/** A report from the browser extension: what is open now, and where a signed-in session exists. */
export function recordPresence(reports: PresenceReport[]) {
  const data = db();
  const presence = (data.presence ??= {});
  const now = new Date();
  data.extensionSeenAt = now.toISOString();
  let changed = 0;

  for (const report of reports) {
    const sub = data.subscriptions.find((s) => s.id === report.site && s.status !== 'cancelled' && sitesOf(s).length > 0);
    if (!sub) continue;
    const entry = (presence[sub.id] ??= {});

    if (report.active === true) {
      entry.lastSeenAt = now.toISOString();
      entry.activeUntil = new Date(now.getTime() + ACTIVE_FOR_MS).toISOString();
      changed++;
    } else if (report.active === false && entry.activeUntil && entry.activeUntil > now.toISOString()) {
      entry.activeUntil = now.toISOString();
      changed++;
    }

    if (report.auth && AUTH_VALUES.includes(report.auth)) {
      if (entry.auth && entry.auth !== report.auth) {
        const lost = report.auth === 'signed_out';
        log[lost ? 'warn' : 'info']('connections', `${sub.name}: browser session is now ${report.auth.replace('_', ' ')}`, { was: entry.auth });
        if (lost) data.notes.push({ id: uid('note'), subId: sub.id, date: today(), kind: 'review', label: `Signed out of ${sub.name} in your browser` });
      }
      entry.auth = report.auth;
      entry.authCheckedAt = now.toISOString();
      const expires = Date.parse(report.sessionExpiresAt ?? '');
      entry.sessionExpiresAt = report.auth !== 'signed_out' && !Number.isNaN(expires) ? new Date(expires).toISOString() : undefined;
      changed++;
    }
    if (report.date && report.minutes !== undefined) changed += ingestUsage([{ site: sub.id, date: report.date, minutes: report.minutes }], 'web').accepted;
  }
  save('presence');
  return changed;
}

const day = (stamp: string) => stamp.slice(0, 10);

function connectionFor(data: Db, sub: Subscription, now: string): ServiceConnection {
  const signals: ConnectionSignal[] = [];
  const presence = data.presence?.[sub.id];
  const usage = data.usage.filter((u) => u.subId === sub.id);
  const lastUse = (source: 'web' | 'android') => usage.filter((u) => u.source === source && u.minutes > 0).reduce<string | undefined>((latest, u) => (!latest || u.date > latest ? u.date : latest), undefined);
  const reports = (source: 'web' | 'android') => usage.some((u) => u.source === source);
  const activeNow = Boolean(presence?.activeUntil && presence.activeUntil > now);

  if (sitesOf(sub).length > 0) {
    const last = presence?.lastSeenAt ? day(presence.lastSeenAt) : lastUse('web');
    if (activeNow) signals.push({ kind: 'browser', ok: true, label: 'Open in your browser right now', at: presence!.lastSeenAt });
    else if (last) signals.push({ kind: 'browser', ok: true, label: `Last used in your browser on ${shortDate(last)}`, at: last });
    else if (reports('web') || presence) signals.push({ kind: 'browser', ok: true, label: 'Watched by the browser extension, not opened yet' });
    else signals.push({ kind: 'browser', ok: false, label: data.extensionSeenAt ? 'The browser extension has not picked this up yet' : 'Browser extension not installed' });
  }
  if (sub.androidPackage) {
    const last = lastUse('android');
    if (last) signals.push({ kind: 'phone', ok: true, label: `Last used on your phone on ${shortDate(last)}`, at: last });
    else if (reports('android')) signals.push({ kind: 'phone', ok: true, label: 'Watched by the Android companion, not opened yet' });
    else signals.push({ kind: 'phone', ok: false, label: 'Android companion not reporting' });
  }

  const account = data.accounts.find((a) => a.providerId === sub.providerId);
  if (account?.method === 'oauth') {
    signals.push({
      kind: 'account',
      ok: !account.needsReauth,
      label: account.needsReauth ? 'The account link stopped working. Sign in again.' : `Account linked${account.displayName ? ` as ${account.displayName}` : ''}${account.product ? `, ${account.product} plan` : ''}`,
      at: account.checkedAt ?? account.lastSyncAt ?? account.connectedAt,
    });
  }

  const check = data.billingChecks?.[sub.id];
  if (sub.paypalSubscriptionId) {
    signals.push(
      check
        ? { kind: 'billing', ok: check.ok, label: check.error ? `PayPal could not be read: ${check.error}` : `PayPal agreement is ${check.status.toLowerCase()}`, at: check.checkedAt }
        : { kind: 'billing', ok: paypalMode() !== 'off', label: paypalMode() === 'off' ? 'PayPal is not connected, so this agreement cannot be read' : 'PayPal agreement, not verified yet' },
    );
  } else {
    const seen = data.bankTransactions.filter((t) => t.subId === sub.id).reduce<string | undefined>((latest, t) => (!latest || t.date > latest ? t.date : latest), undefined);
    if (seen) signals.push({ kind: 'billing', ok: true, label: `Payment seen in your bank feed on ${shortDate(seen)}`, at: seen });
  }

  const auth: ServiceConnection['auth'] =
    account?.method === 'oauth'
      ? { status: account.needsReauth ? 'signed_out' : 'signed_in', via: 'oauth', checkedAt: account.checkedAt ?? account.connectedAt }
      : presence?.auth
        ? { status: presence.auth, via: 'browser', checkedAt: presence.authCheckedAt, expiresAt: presence.sessionExpiresAt }
        : { status: 'unknown', via: 'none' };

  // Signed out in the browser is only a problem if the phone is not being used either.
  const usedOnPhone = signals.some((s) => s.kind === 'phone' && s.at !== undefined && diffDays(today(), s.at) <= 14);
  const signedOut = auth.status === 'signed_out' && !(auth.via === 'browser' && usedOnPhone);
  const problem = signedOut ? 'Signed out' : signals.find((s) => !s.ok && (s.kind === 'account' || (s.kind === 'billing' && Boolean(check))))?.label;
  const reporting = signals.some((s) => s.ok && s.kind !== 'billing') || auth.status === 'signed_in' || auth.status === 'likely';
  const state: ServiceConnection['state'] = activeNow ? 'live' : problem ? 'attention' : reporting ? 'connected' : 'waiting';
  const headline = activeNow ? 'In use now' : problem ? (signedOut ? (auth.via === 'browser' ? 'Signed out in browser' : 'Sign in again') : 'Needs attention') : auth.status === 'signed_in' ? 'Signed in' : reporting ? 'Connected' : 'Not connected';
  return { subId: sub.id, state, headline, activeUntil: presence?.activeUntil, auth, signals };
}

export function buildConnections(data: Db): Record<string, ServiceConnection> {
  const now = new Date().toISOString();
  return Object.fromEntries(data.subscriptions.filter((s) => s.status !== 'cancelled').map((s) => [s.id, connectionFor(data, s, now)]));
}

// ---- Monitor -------------------------------------------------------------------------------

const PAYPAL_TO_STATUS: Record<string, SubStatus | undefined> = { ACTIVE: 'active', SUSPENDED: 'paused', CANCELLED: 'cancelled', EXPIRED: 'cancelled' };
const monitorState = globalThis as unknown as { __substerConnectionMonitor?: ReturnType<typeof setInterval>; __substerConnectionsCheckedAt?: string; __substerConnectionsRunning?: boolean };

export const connectionsCheckedAt = () => monitorState.__substerConnectionsCheckedAt;

/** Re-verifies PayPal agreements and OAuth links with their providers. Returns what changed. */
export async function verifyConnections(): Promise<string[]> {
  if (monitorState.__substerConnectionsRunning) return [];
  monitorState.__substerConnectionsRunning = true;
  const data = db();
  const changes: string[] = [];
  try {
    if (paypalMode() !== 'off') {
      const checks = (data.billingChecks ??= {});
      for (const sub of data.subscriptions.filter((s) => s.paypalSubscriptionId && s.status !== 'cancelled')) {
        try {
          const status = await getSubscriptionStatus(sub.paypalSubscriptionId!);
          const mapped = PAYPAL_TO_STATUS[status];
          checks[sub.id] = { status, ok: mapped !== undefined, checkedAt: new Date().toISOString() };
          // PayPal is the source of truth for an agreement it manages. A trial is our own label for an active agreement.
          if (mapped && mapped !== sub.status && !(mapped === 'active' && sub.status === 'trial')) {
            changes.push(`${sub.name}: PayPal reports the agreement is ${status.toLowerCase()}, was ${sub.status}`);
            data.notes.push({ id: uid('note'), subId: sub.id, date: today(), kind: 'webhook', label: `PayPal reports ${sub.name} is ${status.toLowerCase()}` });
            sub.status = mapped;
          }
        } catch (error) {
          checks[sub.id] = { status: checks[sub.id]?.status ?? 'UNKNOWN', ok: false, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message.slice(0, 200) : String(error) };
        }
      }
    }
    const spotify = await verifySpotifyLink();
    if (spotify) changes.push(spotify);
  } finally {
    monitorState.__substerConnectionsRunning = false;
    monitorState.__substerConnectionsCheckedAt = new Date().toISOString();
  }
  if (changes.length > 0) log.warn('connections', 'Connection check found changes', { changes });
  else log.debug('connections', 'Connection check: nothing changed');
  save('connections verified');
  return changes;
}

/** Starts the background monitor once per process. */
export function startConnectionMonitor() {
  if (monitorState.__substerConnectionMonitor) return;
  monitorState.__substerConnectionMonitor = setInterval(() => void verifyConnections().catch(() => {}), MONITOR_EVERY_MS);
  monitorState.__substerConnectionMonitor.unref?.();
  setTimeout(() => void verifyConnections().catch(() => {}), 20_000).unref?.();
}
