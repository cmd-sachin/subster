// Application logging. Every entry is structured (level, scope, message, metadata), goes to
// three places, and carries the id of the request that caused it:
//   - the process console, one line per entry, for whoever runs the server;
//   - .data/logs/app.log as NDJSON, rotated at 5 MB, so logs survive restarts;
//   - an in-memory ring and the live event stream, read through /api/logs.
// Values under keys that look like credentials are redacted before anything is written.

import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry, LogLevel } from '@/domain/types';
import { DATA_DIR } from './data-dir';
import { publishLog } from './events';

const DIR = path.join(DATA_DIR, 'logs');
const FILE = path.join(DIR, 'app.log');
const MAX_BYTES = 5 * 1024 * 1024;
const RING_SIZE = 1500;
const SECRET_KEY = /token|secret|password|authorization|api[-_]?key|cookie|credential/i;

const memory = globalThis as unknown as { __substerLogs?: LogEntry[]; __substerLogSeq?: number };
const ring = (memory.__substerLogs ??= []);

/** Carries the current request id to every log call made while handling that request. */
export const requestContext = new AsyncLocalStorage<{ requestId: string; userId?: string }>();

function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return typeof value === 'string' && value.length > 2000 ? `${value.slice(0, 2000)}...` : value;
  if (depth > 4) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)]));
}

function persist(entry: LogEntry) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(FILE) && fs.statSync(FILE).size > MAX_BYTES) fs.renameSync(FILE, `${FILE}.1`);
    fs.appendFileSync(FILE, `${JSON.stringify(entry)}\n`);
  } catch {
    // Logging must never take the request down with it.
  }
}

function write(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>) {
  memory.__substerLogSeq = (memory.__substerLogSeq ?? 0) + 1;
  const entry: LogEntry = {
    id: `${Date.now().toString(36)}-${memory.__substerLogSeq}`,
    at: new Date().toISOString(),
    level,
    scope,
    message,
    requestId: requestContext.getStore()?.requestId,
    userId: requestContext.getStore()?.userId,
    ...(meta && Object.keys(meta).length > 0 && { meta: redact(meta) as Record<string, unknown> }),
  };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
  persist(entry);
  publishLog(entry);

  const line = `${entry.at} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${entry.meta ? ` ${JSON.stringify(entry.meta)}` : ''}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (scope: string, message: string, meta?: Record<string, unknown>) => write('debug', scope, message, meta),
  info: (scope: string, message: string, meta?: Record<string, unknown>) => write('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: Record<string, unknown>) => write('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: Record<string, unknown>) => write('error', scope, message, meta),
};

export interface LogQuery {
  level?: LogLevel;
  scope?: string;
  search?: string;
  limit?: number;
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Newest first. `level` is a minimum: "warn" returns warnings and errors. */
export function readLogs(query: LogQuery = {}): LogEntry[] {
  const needle = query.search?.toLowerCase();
  const out: LogEntry[] = [];
  for (let i = ring.length - 1; i >= 0 && out.length < (query.limit ?? 300); i--) {
    const entry = ring[i];
    if (query.level && RANK[entry.level] < RANK[query.level]) continue;
    if (query.scope && entry.scope !== query.scope && !entry.scope.startsWith(`${query.scope}.`)) continue;
    if (needle && !`${entry.message} ${entry.scope} ${JSON.stringify(entry.meta ?? '')}`.toLowerCase().includes(needle)) continue;
    out.push(entry);
  }
  return out;
}

export const logFilePath = () => FILE;
