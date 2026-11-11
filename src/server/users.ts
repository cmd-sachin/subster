// Working across accounts, for the jobs that are not anyone's request: the background monitors
// look after every active account in turn, and a webhook is handed to whoever it belongs to.

import type { Db } from '@/domain/types';
import { activeUserIds } from './auth';
import { log } from './logger';
import { db, runAs } from './store';

/** Runs a job once for each active account, one after another, as that account. */
export async function eachUser(job: () => unknown) {
  for (const userId of activeUserIds()) {
    try {
      await runAs(userId, job);
    } catch (error) {
      log.warn('jobs', 'A background job failed for one account', { userId, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** The account whose data matches, if any. */
export const findUser = (matches: (data: Db) => boolean) => activeUserIds().find((userId) => runAs(userId, () => matches(db())));
