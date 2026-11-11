// Persistence. The rest of the server only sees `db()`, `save()` and `reset()`; where the document
// lives is the adapter's business: one JSON document per account, kept as a file on a server with
// a disk and in a shared database on a serverless host (see ../vfs).

import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '@/domain/types';
import { DATA_DIR } from '../data-dir';
import * as vfs from '../vfs';
import { publishTo } from '../events';
import { requestContext } from '../logger';
import { emptyDb, SCHEMA_VERSION } from './seed';

interface StoreAdapter {
  load(): Db | null;
  persist(data: Db): void;
}

/** One JSON document, kept wherever the deployment keeps documents: a file, or the shared database. */
function documentAdapter(name: string): StoreAdapter {
  return {
    load() {
      const text = vfs.read(name);
      if (text === null) return null;
      try {
        return JSON.parse(text) as Db;
      } catch {
        return null;
      }
    },
    persist(data) {
      vfs.write(name, JSON.stringify(data));
    },
  };
}

/** Used when there is no account in play: single-user mode, and scripts. */
export const LOCAL_USER = 'local';
const DATA = DATA_DIR;

/** Whose data the current request, or background job, is working on. */
export const currentUserId = () => requestContext.getStore()?.userId ?? LOCAL_USER;
export const userDir = (userId: string) => (userId === LOCAL_USER ? DATA : path.join(DATA, 'users', userId));
/** The name a document goes by: at the top for the single local user, under the account otherwise. */
export const documentName = (userId: string, file = 'db.json') => (userId === LOCAL_USER ? file : `users/${userId}/${file}`);
const adapterFor = (userId: string, file = 'db.json') => documentAdapter(documentName(userId, file));

/** The documents that hold an account's data, to fetch before working on it. */
export const documentsOf = (userId: string) => [documentName(userId), documentName(userId, 'db.real.json')];
/** Drops the parsed copy, so the next read sees what was just fetched. */
export const forget = (userId: string) => void loaded.delete(userId);

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
  vfs.remove(documentName(userId, 'db.real.json'));
  return data;
}

/** Forgets an account's data, in memory and on disk. */
export function eraseUserData(userId: string) {
  if (userId === LOCAL_USER) return;
  loaded.delete(userId);
  for (const name of documentsOf(userId)) vfs.remove(name);
  if (!vfs.remote) fs.rmSync(userDir(userId), { recursive: true, force: true });
}

/** Hands the data kept before accounts existed to the first account, so nothing is lost. */
export function adoptLocalData(userId: string) {
  // Only a server with a disk can have data from before accounts existed.
  if (vfs.remote) return;
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
