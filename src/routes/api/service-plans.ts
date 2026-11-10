import { createFileRoute } from '@tanstack/react-router';
import { body, fail, handle, json, type RouteContext } from '@/server/http';
import { refreshPlans } from '@/server/services/plans';
import { buildState } from '@/server/services/state';

// Reads a service's official site now and returns the plans it sells in the user's region.
async function POST({ request }: RouteContext) {
  const { providerId } = await body<{ providerId: string }>(request);
  if (!providerId) return fail(400, 'providerId is required');
  await refreshPlans(providerId);
  return json(buildState());
}

export const Route = createFileRoute('/api/service-plans')({
  server: { handlers: { POST: handle('service-plans', POST) } },
});
