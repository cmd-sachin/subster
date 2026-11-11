// Where the app's documents are kept. On a server with a disk they are files in the data folder.
// On a serverless host, where no disk lasts and every copy of the app has its own memory, they are
// kept in a Redis database that all copies share (Upstash, over its REST interface, so no driver
// is needed). The rest of the server reads and writes by name and does not know which it is.
//
// The database is slow to reach compared with a file, so it is not touched mid-request: the
// documents a request needs are fetched before its handler runs, the handler works on them in
// memory as it always did, and whatever it changed is written back when it finishes.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './data-dir';

const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

/** True when documents live in the shared database, not on this machine's disk. */
export const remote = Boolean(URL_ && TOKEN);
const PREFIX = 'subster:';

interface Held {
  /** Documents fetched so far. `null` means it was looked for and does not exist. */
  files: Map<string, string | null>;
  /** Names changed since the last write-back. */
  dirty: Set<string>;
}
const cache = globalThis as unknown as { __substerVfs?: Held };
const held = (cache.__substerVfs ??= { files: new Map(), dirty: new Set() });

async function redis(commands: (string | number)[][]): Promise<{ result?: unknown; error?: string }[]> {
  const res = await fetch(`${URL_}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands) });
  if (!res.ok) throw new Error(`The database answered ${res.status}`);
  return (await res.json()) as { result?: unknown; error?: string }[];
}

export function read(name: string): string | null {
  if (!remote) {
    try {
      return fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
    } catch {
      return null;
    }
  }
  // Reading something that was never fetched would look like "does not exist", and the caller
  // would then start it afresh and overwrite the real thing. Refuse instead.
  if (!held.files.has(name)) throw new Error(`"${name}" was not loaded for this request`);
  return held.files.get(name) ?? null;
}

export function write(name: string, text: string) {
  if (!remote) {
    const file = path.join(DATA_DIR, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Write-then-rename so a crash mid-write cannot leave a truncated document.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
    return;
  }
  held.files.set(name, text);
  held.dirty.add(name);
}

export function remove(name: string) {
  if (!remote) return fs.rmSync(path.join(DATA_DIR, name), { force: true });
  held.files.set(name, null);
  held.dirty.add(name);
}

/** Fetches documents from the database, fresh, so this copy of the app sees what the others wrote. */
export async function hydrate(names: string[]): Promise<string[]> {
  if (!remote) return [];
  // Something changed here and not yet written back is newer than what the database holds.
  const wanted = [...new Set(names)].filter((name) => !held.dirty.has(name));
  if (wanted.length === 0) return [];
  const answers = await redis(wanted.map((name) => ['GET', PREFIX + name]));
  // Named back only when the content differs, so parsed copies are dropped only when stale.
  const changed: string[] = [];
  wanted.forEach((name, i) => {
    const text = typeof answers[i]?.result === 'string' ? (answers[i].result as string) : null;
    if (!held.files.has(name) || held.files.get(name) !== text) changed.push(name);
    held.files.set(name, text);
  });
  return changed;
}

/** Writes back everything changed since the last call. */
export async function flush() {
  if (!remote || held.dirty.size === 0) return;
  const names = [...held.dirty];
  held.dirty.clear();
  try {
    await redis(names.map((name) => (held.files.get(name) == null ? ['DEL', PREFIX + name] : ['SET', PREFIX + name, held.files.get(name) as string])));
  } catch (error) {
    // Keep them marked, so the next request tries again.
    names.forEach((name) => held.dirty.add(name));
    throw error;
  }
}
