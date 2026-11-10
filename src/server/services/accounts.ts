// Linking the user's own account at a provider. SubSense never asks for a provider password.
// Where the provider has OAuth (Spotify), the user signs in on the provider's site and SubSense
// receives a scoped token: enough to confirm the plan and read recent listening as real usage.
// Where there is no API, the user signs in on the provider's own account page and tells us so.

import '../env';
import { providerById } from '@/domain/catalog';
import { iso } from '@/domain/dates';
import type { AccountConnection } from '@/domain/types';
import { HttpError } from '@/server/http';
import { log } from '@/server/logger';
import { db, save } from '@/server/store';

const SPOTIFY_SCOPES = 'user-read-private user-read-recently-played';

export const spotifyConfigured = () => Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
const redirectUri = (origin: string) => `${process.env.PUBLIC_URL?.replace(/\/$/, '') || origin}/api/accounts/spotify/callback`;

function upsert(connection: AccountConnection) {
  const data = db();
  data.accounts = [...data.accounts.filter((a) => a.providerId !== connection.providerId), connection];
  save('account linked');
}

/** The user signed in on the provider's own site; we record that, and nothing about the account. */
export function markSelfLinked(providerId: string) {
  const provider = providerById(providerId);
  if (!provider) throw new HttpError(404, 'Unknown app');
  upsert({ providerId, method: 'self', connectedAt: new Date().toISOString() });
  log.info('accounts', `${provider.name} marked as signed in by the user`);
}

export function unlinkAccount(providerId: string) {
  const data = db();
  data.accounts = data.accounts.filter((a) => a.providerId !== providerId);
  save('account unlinked');
  log.info('accounts', `Account unlinked`, { providerId });
}

// ---- Spotify (OAuth authorization code flow) ----------------------------------------------

/** Where to send the user to sign in to Spotify. `state` guards the callback against forgery. */
export function spotifyAuthorizeUrl(origin: string) {
  if (!spotifyConfigured()) throw new HttpError(503, 'Spotify sign-in needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.local.');
  const state = crypto.randomUUID();
  db().oauthState = state;
  save('oauth started');
  const params = new URLSearchParams({ response_type: 'code', client_id: process.env.SPOTIFY_CLIENT_ID!, scope: SPOTIFY_SCOPES, redirect_uri: redirectUri(origin), state });
  return `https://accounts.spotify.com/authorize?${params}`;
}

async function spotifyToken(body: Record<string, string>) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
}

export async function completeSpotify(origin: string, code: string, state: string) {
  const data = db();
  if (!state || data.oauthState !== state) throw new HttpError(400, 'This sign-in did not start from this app.');
  data.oauthState = undefined;
  const token = await spotifyToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(origin) });
  const me = await spotifyGet<{ display_name?: string; product?: string }>(token.access_token, '/v1/me');
  upsert({
    providerId: 'spotify',
    method: 'oauth',
    displayName: me.display_name,
    product: me.product,
    connectedAt: new Date().toISOString(),
    tokens: { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000 },
  });
  log.info('accounts', 'Spotify account linked', { product: me.product });
  await syncSpotifyUsage();
}

async function spotifyGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`https://api.spotify.com${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Spotify ${path} answered ${res.status}`);
  return (await res.json()) as T;
}

async function freshSpotifyToken(connection: AccountConnection) {
  const tokens = connection.tokens;
  if (!tokens) throw new HttpError(400, 'Spotify is not linked.');
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) throw new HttpError(401, 'The Spotify link has expired. Sign in again.');
  const next = await spotifyToken({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
  connection.tokens = { accessToken: next.access_token, refreshToken: next.refresh_token ?? tokens.refreshToken, expiresAt: Date.now() + next.expires_in * 1000 };
  return next.access_token;
}

/**
 * Reads the account's recently played tracks and records listening minutes per day against the
 * Spotify subscription. Spotify returns at most the last 50 plays, so this adds to what the
 * Android companion reports rather than replacing it: for each day the larger figure is kept.
 */
export async function syncSpotifyUsage() {
  const data = db();
  const connection = data.accounts.find((a) => a.providerId === 'spotify' && a.method === 'oauth');
  if (!connection) throw new HttpError(400, 'Spotify is not linked.');
  const accessToken = await freshSpotifyToken(connection);
  const me = await spotifyGet<{ product?: string }>(accessToken, '/v1/me');
  connection.product = me.product;

  const recent = await spotifyGet<{ items: { played_at: string; track: { duration_ms: number } }[] }>(accessToken, '/v1/me/player/recently-played?limit=50');
  const minutesByDay = new Map<string, number>();
  for (const item of recent.items) {
    const day = iso(new Date(item.played_at));
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + item.track.duration_ms / 60_000);
  }

  const sub = data.subscriptions.find((s) => s.providerId === 'spotify' && s.status !== 'cancelled');
  if (sub) {
    for (const [date, minutes] of minutesByDay) {
      const existing = data.usage.find((u) => u.subId === sub.id && u.date === date);
      if (existing) existing.minutes = Math.max(existing.minutes, Math.round(minutes));
      else data.usage.push({ subId: sub.id, date, minutes: Math.round(minutes), source: 'account' });
    }
    if (sub.coverage === 'none') sub.coverage = 'phone';
  }
  connection.lastSyncAt = new Date().toISOString();
  save('spotify synced');
  log.info('accounts', 'Spotify usage synced', { plays: recent.items.length, days: minutesByDay.size, product: me.product, tracked: Boolean(sub) });
  return { plays: recent.items.length, days: minutesByDay.size, tracked: Boolean(sub) };
}
