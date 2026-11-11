import { createFileRoute } from '@tanstack/react-router';
import { handle, type RouteContext } from '@/server/http';
import { runAgent, SWEEP_TASK } from '@/server/agent/run';
import { scheduledAudit } from '@/server/agent/schedule';
import { buildState } from '@/server/services/state';
import type { StreamEvent } from '@/domain/types';

interface Body {
  /** schedule: run the daily audit now, exactly as the timer would. */
  mode?: 'sweep' | 'chat' | 'schedule';
  /** 'rules' runs the deterministic engine instead of the model. */
  engine?: 'rules';
  message?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

// Streams the run as newline-delimited JSON so the UI can show each step as it happens.
async function POST({ request }: RouteContext) {
  const body = (await request.json().catch(() => ({}))) as Body;
  if (body.mode === 'schedule') {
    const run = await scheduledAudit(true);
    return Response.json({ ran: Boolean(run), summary: run?.summary, state: buildState() });
  }
  const chat = body.mode === 'chat';
  const message = (body.message ?? '').trim().slice(0, 2000);
  if (chat && !message) return Response.json({ error: 'message is required' }, { status: 400 });
  const history = (body.history ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
    .slice(-12);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      await runAgent({ ...(chat ? { trigger: 'chat' as const, triggerDetail: message, task: message, history } : { trigger: 'manual' as const, task: SWEEP_TASK }), ...(body.engine === 'rules' && { engine: 'rules' as const }) }, emit);
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}

export const Route = createFileRoute('/api/agent')({
  server: {
    handlers: {
      POST: handle('agent', POST),
    },
  },
});
