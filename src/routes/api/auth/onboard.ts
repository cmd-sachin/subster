import { createFileRoute } from '@tanstack/react-router';
import type { Currency } from '@/domain/types';
import { markOnboarded, newDeviceKey } from '@/server/auth';
import { body, currentAccount, fail, handle, json, type RouteContext } from '@/server/http';
import { log } from '@/server/logger';
import { fillDemo } from '@/server/store/demo';
import { db, openDemo, save } from '@/server/store';

// Finishes the welcome steps: remembers the name and currency, then opens the sample data so the
// first thing a new person sees is a working product. Their own (empty) data waits underneath.
async function POST({ request }: RouteContext) {
  const account = currentAccount();
  if (!account) return fail(400, 'There are no accounts in single-user mode.');
  const input = await body<{ name: string; currency: Currency; demo: boolean }>(request);
  if (input.currency && ['INR', 'USD', 'EUR', 'GBP'].includes(input.currency)) {
    db().settings.currency = input.currency;
    save('currency');
  }
  if (input.demo !== false && !db().demo) {
    // The sample data keeps its own currency; the choice above applies to the person's own data.
    openDemo(fillDemo);
  }
  markOnboarded(account.id, input.name);
  log.info('auth', 'Onboarding finished', { demo: input.demo !== false });
  return json({ ok: true });
}

// A new key for the browser extension and the phone app; the old one stops working.
function PUT() {
  const account = currentAccount();
  return account ? json({ deviceKey: newDeviceKey(account.id) }) : fail(400, 'There are no accounts in single-user mode.');
}

export const Route = createFileRoute('/api/auth/onboard')({
  server: { handlers: { POST: handle('auth.onboard', POST), PUT: handle('auth.device-key', PUT) } },
});
