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
const cache = globalThis as unknown as { __subsenseDb?: Db };

export function db(): Db {
  if (cache.__subsenseDb) return cache.__subsenseDb;
  const stored = adapter.load();
  // A document from an older schema is replaced rather than migrated.
  cache.__subsenseDb = stored && stored.version === SCHEMA_VERSION ? stored : emptyDb();
  if (cache.__subsenseDb !== stored) adapter.persist(cache.__subsenseDb);
  return cache.__subsenseDb;
}

/** Persists the current document and tells open dashboards that something changed. */
export function save(reason = 'update') {
  if (!cache.__subsenseDb) return;
  adapter.persist(cache.__subsenseDb);
  publish(reason);
}

export function reset(): Db {
  cache.__subsenseDb = emptyDb();
  save('reset');
  return cache.__subsenseDb;
}

export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
