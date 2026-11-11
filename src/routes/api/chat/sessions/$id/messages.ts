import { flush } from '@/server/vfs';
import { createFileRoute } from '@tanstack/react-router';
import { body, fail, handle, type RouteContext } from '@/server/http';
import { runAgent, SWEEP_TASK } from '@/server/agent/run';
import { appendTurns, contextOf, dropLastExchange, getSession } from '@/server/services/chat';
import type { RunStep, StreamEvent } from '@/domain/types';

// Sends a message in a conversation. The reply streams back as newline-delimited JSON, one event a
// line, and both turns are kept with the conversation when it finishes. The agent is given the
// conversation so far from the server's own record, so the caller sends only the new message.
async function POST({ request, params }: RouteContext) {
  const session = getSession(params.id);
  if (!session) return fail(404, 'That conversation no longer exists.');
  const input = await body<{ message: string; mode: 'chat' | 'sweep'; replaceLast: boolean }>(request);
  const mode = input.mode === 'sweep' ? 'sweep' : 'chat';
  const message = (input.message ?? '').trim().slice(0, 2000) || (mode === 'sweep' ? 'Run an audit' : '');
  if (!message) return fail(400, 'Write a message first.');

  // Asking again replaces the last exchange instead of adding a second copy of it.
  if (input.replaceLast) dropLastExchange(session.id);
  const history = contextOf(session);
  const asked = new Date().toISOString();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const steps: RunStep[] = [];
      let text = '';
      let error: string | undefined;
      const emit = (event: StreamEvent) => {
        if (event.type === 'step' && event.step.kind !== 'final') steps.push(event.step);
        if (event.type === 'text') text = event.text;
        if (event.type === 'error') error = event.message;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The reader went away. The run still finishes and is kept with the conversation.
        }
      };
      await runAgent(mode === 'sweep' ? { trigger: 'manual', task: SWEEP_TASK } : { trigger: 'chat', triggerDetail: message, task: message, history }, emit);
      appendTurns(session.id, [
        { role: 'user', content: message, mode, at: asked },
        { role: 'assistant', content: text, steps, error, at: new Date().toISOString() },
      ]);
      try {
        await flush().catch(() => {});
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}

export const Route = createFileRoute('/api/chat/sessions/$id/messages')({
  server: { handlers: { POST: handle('chat', POST, { needs: 'assistant' }) } },
});
