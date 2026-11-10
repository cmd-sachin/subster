import { createFileRoute } from '@tanstack/react-router';
import { body, fail, handle, json, type RouteContext } from '@/server/http';
import { markSelfLinked, syncSpotifyUsage, unlinkAccount } from '@/server/services/accounts';
import { buildState } from '@/server/services/state';

// For providers without an API: the user signs in on the provider's own site, then confirms here.
// `sync` refreshes usage from an OAuth-linked account. No provider password is ever sent to SubSense.
async function POST({ request }: RouteContext) {
  const { providerId, action } = await body<{ providerId: string; action: 'confirm' | 'unlink' | 'sync' }>(request);
  if (!providerId) return fail(400, 'providerId is required');
  if (action === 'unlink') unlinkAccount(providerId);
  else if (action === 'sync' && providerId === 'spotify') await syncSpotifyUsage();
  else markSelfLinked(providerId);
  return json(buildState());
}

export const Route = createFileRoute('/api/accounts/link')({
  server: { handlers: { POST: handle('accounts.link', POST) } },
});
