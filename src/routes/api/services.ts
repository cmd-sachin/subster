import { createFileRoute } from '@tanstack/react-router';
import { providerById } from '@/domain/catalog';
import type { BillingCycle } from '@/domain/types';
import { body, fail, handle, json, type RouteContext, requirePermission } from '@/server/http';

const CYCLES: BillingCycle[] = ['monthly', 'quarterly', 'yearly'];
import { proposeSubscription } from '@/server/services/actions';
import { buildState } from '@/server/services/state';
import { createSubscription } from '@/server/services/subscriptions';
import { db, save } from '@/server/store';

interface Body {
  /** track: "I already pay for this". subscribe: start a new one through PayPal (goes to the inbox). */
  intent: 'track' | 'subscribe';
  providerId: string;
  plan: string;
  price: number;
  cycle: BillingCycle;
  lastChargedOn: string;
}

async function POST({ request }: RouteContext) {
  const input = await body<Body>(request);
  const provider = providerById(input.providerId ?? '');
  if (!provider) return fail(404, 'Unknown service');

  if (input.intent === 'subscribe') {
    requirePermission('paypal');
    const proposal = proposeSubscription({ providerId: provider.id, planName: input.plan, reason: `You chose ${provider.name}${input.plan ? ` ${input.plan}` : ''} in the services directory.` });
    if (!proposal.ok) return fail(409, proposal.error);
    return json(buildState());
  }

  if (db().subscriptions.some((s) => s.providerId === provider.id && s.status !== 'cancelled')) return fail(409, `${provider.name} is already tracked.`);
  const plan = provider.plans.find((p) => p.name === input.plan) ?? provider.plans[0] ?? { name: (input.plan ?? '').trim().slice(0, 60) || 'Standard', cycle: 'monthly' as const };
  const price = Number(input.price);
  if (!(price > 0 && price < 1_000_000)) return fail(400, 'Enter what you actually pay.');
  if (input.lastChargedOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.lastChargedOn)) return fail(400, 'lastChargedOn must be a date');
  createSubscription({ name: provider.name, providerId: provider.id, plan: plan.name, price, cycle: input.cycle && CYCLES.includes(input.cycle) ? input.cycle : plan.cycle, rail: 'card', source: 'manual', lastChargedOn: input.lastChargedOn || undefined });
  save('subscription added');
  return json(buildState());
}

export const Route = createFileRoute('/api/services')({
  server: { handlers: { POST: handle('services', POST) } },
});
