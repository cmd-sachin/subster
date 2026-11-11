// Persistence. The rest of the server only sees `db()`, `save()` and `reset()`; where the document
// lives is the adapter's business. The file adapter keeps one JSON document on disk, which is
// right for a single-node demo. A Postgres adapter implements the same two methods.

import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '@/domain/types';
import { publish } from '../events';
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

const adapter = fileAdapter(path.join(process.cwd(), '.data', 'db.json'));

// Survives hot reloads in dev, where modules are re-evaluated.
const cache = globalThis as unknown as { __substerDb?: Db };

export function db(): Db {
  if (cache.__substerDb) return cache.__substerDb;
  const stored = adapter.load();
  // A document from an older schema is replaced rather than migrated.
  cache.__substerDb = stored && stored.version === SCHEMA_VERSION ? stored : emptyDb();
  // An earlier version kept whole fetched pages here, which made the file enormous.
  for (const key of Object.keys(cache.__substerDb.liveCache ?? {})) if (key.startsWith('page:')) delete cache.__substerDb.liveCache![key];
  if (cache.__substerDb !== stored) adapter.persist(cache.__substerDb);
  return cache.__substerDb;
}

/** Persists the current document and tells open dashboards that something changed. */
export function save(reason = 'update') {
  if (!cache.__substerDb) return;
  adapter.persist(cache.__substerDb);
  publish(reason);
}

export function reset(): Db {
  // Erasing during a demo empties the demo; the user's own data stays set aside until the demo is closed.
  const demo = cache.__substerDb?.demo === true;
  cache.__substerDb = { ...emptyDb(), ...(demo && { demo }) };
  save('reset');
  return cache.__substerDb;
}

// Demo data never mixes with the user's own: their document is set aside in a second file while
// the demo is open and put back, untouched, when it is closed.
const realAdapter = fileAdapter(path.join(process.cwd(), '.data', 'db.real.json'));

/** Swaps in a fresh demo document, filled by `fill`. The user's own document is set aside first. */
export function openDemo(fill: (data: Db) => void): Db {
  if (!db().demo) realAdapter.persist(db());
  cache.__substerDb = { ...emptyDb(), demo: true };
  fill(cache.__substerDb);
  save('demo opened');
  return cache.__substerDb;
}

/** Puts the user's own document back. Does nothing when no demo is open. */
export function closeDemo(): Db {
  if (!db().demo) return db();
  const real = realAdapter.load();
  cache.__substerDb = real && real.version === SCHEMA_VERSION && !real.demo ? real : emptyDb();
  save('demo closed');
  fs.rmSync(path.join(process.cwd(), '.data', 'db.real.json'), { force: true });
  return cache.__substerDb;
}

export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
