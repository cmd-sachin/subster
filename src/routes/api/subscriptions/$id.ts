import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { createProposal, execute } from '@/server/services/actions';
import { buildState } from '@/server/services/state';
import { db, save } from '@/server/store';
import { CATEGORIES } from '@/domain/catalog';
import type { Category, Coverage, Policy } from '@/domain/types';
import { setCategory } from '@/server/services/subscriptions';

const POLICIES: Policy[] = ['ask', 'auto', 'locked'];
const COVERAGE: Coverage[] = ['phone', 'web', 'phone+web', 'phone+tv', 'none'];

// User-owned settings for one subscription: how much the agent may do, and what usage covers.
async function PATCH({ request, params }: RouteContext) {
  const { id } = params;
  const body = (await request.json().catch(() => ({}))) as { policy?: Policy; coverage?: Coverage; resume?: boolean; category?: Category; reconsider?: boolean };
  const sub = db().subscriptions.find((s) => s.id === id);
  if (!sub) return Response.json({ error: 'Not found' }, { status: 404 });

  if (body.policy && POLICIES.includes(body.policy)) sub.policy = body.policy;
  if (body.coverage && COVERAGE.includes(body.coverage)) sub.coverage = body.coverage;
  if (body.category && CATEGORIES.includes(body.category)) setCategory(sub.id, body.category);
  // "Ask me again": forget that the user turned suggestions for this subscription down.
  if (body.reconsider) db().declines = (db().declines ?? []).filter((d) => d.subId !== sub.id);
  save();

  // Resuming is the user's own instruction, so it is approved as it is created.
  if (body.resume && sub.status === 'paused') {
    const proposal = await createProposal({ subId: sub.id, type: 'resume', reason: 'You asked to resume this subscription.' });
    if (proposal.ok && proposal.action.status === 'pending') await execute(proposal.action.id, 'user', new URL(request.url).origin);
  }
  return Response.json(buildState());
}

export const Route = createFileRoute('/api/subscriptions/$id')({
  server: {
    handlers: {
      PATCH: handle('subscriptions', PATCH),
    },
  },
});
