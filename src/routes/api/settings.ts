import { createFileRoute } from '@tanstack/react-router';
import type { Currency } from '@/domain/types';
import { body, fail, handle, json, type RouteContext } from '@/server/http';
import { log } from '@/server/logger';
import { buildState } from '@/server/services/state';
import { db, save } from '@/server/store';

const CURRENCIES: Currency[] = ['USD', 'INR', 'EUR', 'GBP'];

async function POST({ request }: RouteContext) {
  const { currency } = await body<{ currency: Currency }>(request);
  if (!currency || !CURRENCIES.includes(currency)) return fail(400, 'currency must be USD, INR, EUR or GBP');
  db().settings.currency = currency;
  save('settings changed');
  log.info('settings', `Currency set to ${currency}`);
  return json(buildState());
}

export const Route = createFileRoute('/api/settings')({
  server: { handlers: { POST: handle('settings', POST) } },
});
