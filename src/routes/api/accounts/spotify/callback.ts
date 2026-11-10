import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { log } from '@/server/logger';
import { completeSpotify } from '@/server/services/accounts';

async function GET({ request }: RouteContext) {
  const url = new URL(request.url);
  let result = 'failed';
  try {
    const code = url.searchParams.get('code');
    if (code) {
      await completeSpotify(url.origin, code, url.searchParams.get('state') ?? '');
      result = 'linked';
    } else {
      result = 'declined';
    }
  } catch (error) {
    log.error('accounts', 'Spotify sign-in could not be completed', { error: error instanceof Error ? error.message : String(error) });
  }
  return Response.redirect(new URL(`/services?account=${result}`, url.origin), 302);
}

export const Route = createFileRoute('/api/accounts/spotify/callback')({
  server: { handlers: { GET: handle('accounts.spotify.callback', GET) } },
});
