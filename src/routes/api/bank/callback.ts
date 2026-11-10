import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { log } from '@/server/logger';
import { completeAggregatorConsent, syncBank } from '@/server/services/bank';

// The Account Aggregator sends the user back here. `success` alone is not trusted: the consent is
// re-checked with the provider, and its id must be the one this app issued.
async function GET({ request }: RouteContext) {
  const url = new URL(request.url);
  let result = 'failed';
  try {
    if (url.searchParams.get('success') === 'true') {
      await completeAggregatorConsent(url.searchParams.get('id') ?? '');
      await syncBank({ source: 'INITIAL_SYNC' });
      result = 'linked';
    } else {
      result = 'declined';
      log.warn('bank', 'Account Aggregator consent was not approved', { code: url.searchParams.get('errorcode'), message: url.searchParams.get('errormsg') });
    }
  } catch (error) {
    log.error('bank', 'Account Aggregator callback failed', { error: error instanceof Error ? error.message : String(error) });
  }
  return Response.redirect(new URL(`/connect?bank=${result}`, url.origin), 302);
}

export const Route = createFileRoute('/api/bank/callback')({
  server: { handlers: { GET: handle('bank.callback', GET) } },
});
