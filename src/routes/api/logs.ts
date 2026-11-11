import { createFileRoute } from '@tanstack/react-router';
import type { LogLevel } from '@/domain/types';
import { handle, json, type RouteContext } from '@/server/http';
import { logFilePath, readLogs } from '@/server/logger';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

// Recent application logs, newest first. The Logs page loads these, then follows the live stream.
function GET({ request }: RouteContext) {
  const query = new URL(request.url).searchParams;
  const level = query.get('level') as LogLevel | null;
  return json({
    file: logFilePath(),
    entries: readLogs({
      level: level && LEVELS.includes(level) ? level : undefined,
      scope: query.get('scope') || undefined,
      search: query.get('q') || undefined,
      limit: Math.min(Number(query.get('limit')) || 300, 1000),
    }),
  });
}

export const Route = createFileRoute('/api/logs')({
  server: { handlers: { GET: handle('logs', GET, { quiet: true, access: 'admin' }) } },
});
