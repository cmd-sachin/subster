import { createFileRoute } from '@tanstack/react-router';
import { body, handle, json, type RouteContext } from '@/server/http';
import { linkPlaidSandbox, linkWithPlaid, syncBank, unlinkBank } from '@/server/services/bank';
import { buildState } from '@/server/services/state';

// Completes a Plaid Link session (public token from the browser) and runs the first sync.
// `sandbox: true` links Plaid's test institution instead, and only works on sandbox keys.
async function POST({ request }: RouteContext) {
  const input = await body<{ publicToken: string; institution: string; mask: string; sandbox: boolean }>(request);
  if (input.publicToken) await linkWithPlaid({ publicToken: input.publicToken, institution: input.institution, mask: input.mask });
  else await linkPlaidSandbox(new URL(request.url).origin);
  const result = await syncBank({ source: 'INITIAL_SYNC' });
  return json({ result, state: buildState() });
}

function DELETE() {
  unlinkBank();
  return json(buildState());
}

export const Route = createFileRoute('/api/bank/link')({
  server: { handlers: { POST: handle('bank.link', POST, { needs: 'connect' }), DELETE: handle('bank.unlink', DELETE) } },
});
