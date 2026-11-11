import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { spotifyAuthorizeUrl } from '@/server/services/accounts';

// Sends the user to Spotify's own sign-in page. Subster never sees the password.
function GET({ request }: RouteContext) {
  return Response.redirect(spotifyAuthorizeUrl(new URL(request.url).origin), 302);
}

export const Route = createFileRoute('/api/accounts/spotify/start')({
  server: { handlers: { GET: handle('accounts.spotify.start', GET, { needs: 'connect' }) } },
});
