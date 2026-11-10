import { setCurrency } from '@/domain/dates';
import { analyze } from '@/domain/intelligence';
import type { AppState } from '@/domain/types';
import { agentEngine } from '@/server/agent/run';
import { availableBanks, plaidIsSandbox } from '@/server/integrations/bank';
import { paypalMode } from '@/server/integrations/paypal';
import { db } from '@/server/store';
import { spotifyConfigured } from './accounts';
import { planMonitorAvailable, startPlanMonitor } from './plans';

/** Everything the UI needs in one payload. Credentials, tokens and cursors never leave the server. */
export function buildState(): AppState {
  const data = db();
  startPlanMonitor();
  // Amounts in generated text (issues, recommendations) are formatted in the user's currency.
  setCurrency(data.settings.currency);

  let link: AppState['integrations']['bank']['link'] = null;
  if (data.bank) {
    const { provider, institution, accountMask, linkedAt, lastSyncAt } = data.bank;
    link = { provider, institution, accountMask, linkedAt, lastSyncAt };
  }
  return {
    portfolio: analyze(data),
    settings: data.settings,
    accounts: data.accounts.map(({ providerId, method, displayName, product, connectedAt, lastSyncAt }) => ({ providerId, method, displayName, product, connectedAt, lastSyncAt })),
    livePlans: data.livePlans,
    actions: data.actions,
    runs: data.runs,
    notes: data.notes,
    charges: data.charges,
    usage: data.usage,
    integrations: {
      paypal: paypalMode(),
      agent: agentEngine(),
      agStudioLicense: process.env.AG_STUDIO_LICENSE || undefined,
      planMonitor: planMonitorAvailable(),
      spotify: spotifyConfigured(),
      webhookLog: data.webhookLog.slice(0, 20),
      bank: {
        available: availableBanks(),
        plaidSandbox: plaidIsSandbox(),
        link,
        recent: [...data.bankTransactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15),
        transactionCount: data.bankTransactions.length,
        candidates: data.candidates,
      },
    },
  };
}
