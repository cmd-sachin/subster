import { remote } from '@/server/vfs';
import { createFileRoute } from '@tanstack/react-router';
import { currentAccount, handle, type RouteContext } from '@/server/http';
import { LOCAL_USER } from '@/server/store';
import type { LiveEvent } from '@/domain/types';
import { subscribe } from '@/server/events';

// Server-sent events: one line per state change. Dashboards re-fetch state when they hear one,
// which is how a bank charge or a PayPal webhook appears on screen without a reload.
async function GET({ request }: RouteContext) {
  // A serverless host cannot hold a connection open or pass events between its copies. Answering
  // "no content" tells the browser to stop trying; the page then checks for changes on a timer.
  if (remote) return new Response(null, { status: 204 });
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: LiveEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      send({ type: 'hello', at: new Date().toISOString() });
      const account = currentAccount();
      const unsubscribe = subscribe(account?.id ?? LOCAL_USER, !account || account.role === 'admin', send);
      // Comment lines keep proxies from closing an idle connection.
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 25_000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive' } });
}

export const Route = createFileRoute('/api/events')({
  server: {
    handlers: {
      GET: handle('events', GET, { quiet: true }),
    },
  },
});
