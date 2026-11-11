import { createFileRoute } from '@tanstack/react-router';
import { body, fail, handle, json, type RouteContext } from '@/server/http';
import { postSandboxTransaction } from '@/server/services/bank';
import { buildState } from '@/server/services/state';

// Plaid sandbox only: has Plaid post a transaction to its test institution, then syncs it back.
async function POST({ request }: RouteContext) {
  const { description, amount } = await body<{ description: string; amount: number }>(request);
  if (!description?.trim() || !(Number(amount) > 0 && Number(amount) < 100_000)) return fail(400, 'description and a positive amount are required');
  const result = await postSandboxTransaction(description.trim().slice(0, 120), Number(amount));
  return json({ result, state: buildState() });
}

export const Route = createFileRoute('/api/bank/sandbox-transaction')({
  server: { handlers: { POST: handle('bank.sandbox-transaction', POST, { needs: 'connect' }) } },
});
