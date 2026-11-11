// The starting document. Subster ships with no data: everything in it comes from the user's own
// bank, statements, PayPal account, linked apps or manual entries.

import type { Db } from '@/domain/types';

/** Bump when the stored document's shape changes; older documents are replaced. */
export const SCHEMA_VERSION = 4;

export function emptyDb(): Db {
  return {
    version: SCHEMA_VERSION,
    seededAt: new Date().toISOString(),
    subscriptions: [],
    charges: [],
    usage: [],
    actions: [],
    notes: [],
    runs: [],
    webhookLog: [],
    bank: null,
    bankTransactions: [],
    candidates: [],
    ignoredMerchants: [],
    settings: { currency: 'USD' },
    accounts: [],
    livePlans: {},
  };
}
