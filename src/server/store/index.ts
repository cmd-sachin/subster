// Persistence. The rest of the server only sees `db()`, `save()` and `reset()`; where the document
// lives is the adapter's business. The file adapter keeps one JSON document per account on disk,
// which is right for a single node. A Postgres adapter implements the same two methods.

import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '@/domain/types';
import { DATA_DIR } from '../data-dir';
import { publishTo } from '../events';
import { requestContext } from '../logger';
import { emptyDb, SCHEMA_VERSION } from './seed';

interface StoreAdapter {
  load(): Db | null;
  persist(data: Db): void;
}

function fileAdapter(file: string): StoreAdapter {
  return {
    load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as Db;
      } catch {
        return null;
      }
    },
    persist(data) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Write-then-rename so a crash mid-write cannot leave a truncated document.
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    },
  };
}

/** Used when there is no account in play: single-user mode, and scripts. */
export const LOCAL_USER = 'local';
const DATA = DATA_DIR;

/** Whose data the current request, or background job, is working on. */
export const currentUserId = () => requestContext.getStore()?.userId ?? LOCAL_USER;
export const userDir = (userId: string) => (userId === LOCAL_USER ? DATA : path.join(DATA, 'users', userId));
const adapterFor = (userId: string, file = 'db.json') => fileAdapter(path.join(userDir(userId), file));

/** Runs `fn` as a given account, outside a request: background monitors and webhooks use this. */
export const runAs = <T>(userId: string, fn: () => T): T => requestContext.run({ requestId: 'background', userId }, fn);

// Survives hot reloads in dev, where modules are re-evaluated.
const cache = globalThis as unknown as { __substerDbs?: Map<string, Db> };
const loaded = (cache.__substerDbs ??= new Map<string, Db>());

export function db(): Db {
  const userId = currentUserId();
  const held = loaded.get(userId);
  if (held) return held;
  const stored = adapterFor(userId).load();
  // A document from an older schema is replaced rather than migrated.
  const data = stored && stored.version === SCHEMA_VERSION ? stored : emptyDb();
  // An earlier version kept whole fetched pages here, which made the file enormous.
  for (const key of Object.keys(data.liveCache ?? {})) if (key.startsWith('page:')) delete data.liveCache![key];
  loaded.set(userId, data);
  if (data !== stored) adapterFor(userId).persist(data);
  return data;
}

/** Persists the current document and tells that person's open dashboards that something changed. */
export function save(reason = 'update') {
  const userId = currentUserId();
  const data = loaded.get(userId);
  if (!data) return;
  adapterFor(userId).persist(data);
  publishTo(userId, reason);
}

const replace = (data: Db, reason: string) => {
  loaded.set(currentUserId(), data);
  save(reason);
  return data;
};

export function reset(): Db {
  // Erasing during a demo empties the demo; the user's own data stays set aside until the demo is closed.
  const demo = db().demo === true;
  return replace({ ...emptyDb(), ...(demo && { demo }) }, 'reset');
}

// Demo data never mixes with the user's own: their document is set aside in a second file while
// the demo is open and put back, untouched, when it is closed.

/** Swaps in a fresh demo document, filled by `fill`. The user's own document is set aside first. */
export function openDemo(fill: (data: Db) => void): Db {
  if (!db().demo) adapterFor(currentUserId(), 'db.real.json').persist(db());
  const data: Db = { ...emptyDb(), demo: true };
  // In place before it is filled: the filler reads the current document as it goes.
  loaded.set(currentUserId(), data);
  fill(data);
  return replace(data, 'demo opened');
}

/** Puts the user's own document back. Does nothing when no demo is open. */
export function closeDemo(): Db {
  if (!db().demo) return db();
  const userId = currentUserId();
  const real = adapterFor(userId, 'db.real.json').load();
  const data = replace(real && real.version === SCHEMA_VERSION && !real.demo ? real : emptyDb(), 'demo closed');
  fs.rmSync(path.join(userDir(userId), 'db.real.json'), { force: true });
  return data;
}

/** Forgets an account's data, in memory and on disk. */
export function eraseUserData(userId: string) {
  if (userId === LOCAL_USER) return;
  loaded.delete(userId);
  fs.rmSync(userDir(userId), { recursive: true, force: true });
}

/** Hands the data kept before accounts existed to the first account, so nothing is lost. */
export function adoptLocalData(userId: string) {
  for (const file of ['db.json', 'db.real.json']) {
    const from = path.join(DATA, file);
    if (!fs.existsSync(from) || fs.existsSync(path.join(userDir(userId), file))) continue;
    fs.mkdirSync(userDir(userId), { recursive: true });
    fs.renameSync(from, path.join(userDir(userId), file));
  }
  loaded.delete(LOCAL_USER);
  loaded.delete(userId);
}

export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
