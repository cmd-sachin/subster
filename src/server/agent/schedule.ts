// The agent's own schedule. Once a day, without being asked, it audits every subscription and
// puts anything worth acting on in the inbox. That is what turns it from something you consult
// into something that warns you: a trial about to convert or an unused renewal is caught before
// the charge, not after.
//
// The scheduled audit uses the built-in rules engine, not the model: it has to run every day
// whether or not the model's free daily allowance is left, and the rules already know every
// deadline. Audits you start yourself, and chat, still use the model.

import { eachUser } from '@/server/users';
import { log } from '@/server/logger';
import { db, save } from '@/server/store';
import { runAgent, SWEEP_TASK } from './run';

const CHECK_EVERY_MS = 30 * 60 * 1000;
const AUDIT_EVERY_MS = 20 * 60 * 60 * 1000;
const schedule = globalThis as unknown as { __substerAuditTimer?: ReturnType<typeof setInterval>; __substerAuditRunning?: boolean };

export async function scheduledAudit(force = false) {
  const data = db();
  if (schedule.__substerAuditRunning || data.settings.dailyAudit === false) return null;
  if (data.subscriptions.filter((s) => s.status !== 'cancelled').length === 0) return null;
  if (!force && Date.now() - Date.parse(data.lastScheduledAuditAt ?? '1970-01-01') < AUDIT_EVERY_MS) return null;

  schedule.__substerAuditRunning = true;
  try {
    const before = data.actions.filter((a) => a.status === 'pending').length;
    const run = await runAgent({ trigger: 'schedule', triggerDetail: 'daily audit', task: SWEEP_TASK, engine: 'rules' }, () => {});
    // Read again: a demo may have been opened or closed while the audit ran.
    const current = db();
    current.lastScheduledAuditAt = new Date().toISOString();
    save('scheduled audit');
    log.info('agent', 'Scheduled audit finished', { runId: run.id, newProposals: current.actions.filter((a) => a.status === 'pending').length - before });
    return run;
  } finally {
    schedule.__substerAuditRunning = false;
  }
}

/** Starts the schedule once per process. The first check waits a minute so start-up stays quick. */
export function startAuditSchedule() {
  if (schedule.__substerAuditTimer) return;
  schedule.__substerAuditTimer = setInterval(() => void eachUser(() => scheduledAudit()), CHECK_EVERY_MS);
  schedule.__substerAuditTimer.unref?.();
  setTimeout(() => void eachUser(() => scheduledAudit()), 60_000).unref?.();
}
