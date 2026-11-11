import { createFileRoute } from '@tanstack/react-router';
import type { Currency } from '@/domain/types';
import { body, fail, handle, json, type RouteContext } from '@/server/http';
import { log } from '@/server/logger';
import { buildState } from '@/server/services/state';
import { db, save } from '@/server/store';

const CURRENCIES: Currency[] = ['USD', 'INR', 'EUR', 'GBP'];

async function POST({ request }: RouteContext) {
  const { currency, dailyAudit } = await body<{ currency: Currency; dailyAudit: boolean }>(request);
  if (currency === undefined && dailyAudit === undefined) return fail(400, 'Nothing to change');
  if (currency !== undefined) {
    if (!CURRENCIES.includes(currency)) return fail(400, 'currency must be USD, INR, EUR or GBP');
    db().settings.currency = currency;
    log.info('settings', `Currency set to ${currency}`);
  }
  if (dailyAudit !== undefined) {
    db().settings.dailyAudit = Boolean(dailyAudit);
    log.info('settings', `Daily audit ${dailyAudit ? 'on' : 'off'}`);
  }
  save('settings changed');
  return json(buildState());
}

export const Route = createFileRoute('/api/settings')({
  server: { handlers: { POST: handle('settings', POST) } },
});
