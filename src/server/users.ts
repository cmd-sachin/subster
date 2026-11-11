// Working across accounts, for the jobs that are not anyone's request: the background monitors
// look after every active account in turn, and a webhook is handed to whoever it belongs to.

import type { Db } from '@/domain/types';
import { activeUserIds } from './auth';
import { log } from './logger';
import { db, documentsOf, forget, runAs } from './store';
import * as vfs from './vfs';

/**
 * Makes sure these accounts' data is in memory and current. A no-op on a server with a disk; on a
 * serverless host it fetches their documents from the shared database.
 */
export async function loadUsers(userIds: string[]) {
  if (!vfs.remote) return;
  const changed = new Set(await vfs.hydrate(userIds.flatMap(documentsOf)));
  for (const userId of userIds) if (documentsOf(userId).some((name) => changed.has(name))) forget(userId);
}

/** Runs a job once for each active account, one after another, as that account. */
export async function eachUser(job: () => unknown) {
  for (const userId of activeUserIds()) {
    try {
      await loadUsers([userId]);
      await runAs(userId, job);
      await vfs.flush();
    } catch (error) {
      log.warn('jobs', 'A background job failed for one account', { userId, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** The account whose data matches, if any. */
export async function findUser(matches: (data: Db) => boolean) {
  const ids = activeUserIds();
  await loadUsers(ids);
  return ids.find((userId) => runAs(userId, () => matches(db())));
}
