import { createFileRoute } from '@tanstack/react-router';
import { analyze } from '@/domain/intelligence';
import type { StreamEvent } from '@/domain/types';
import { fitQuestions, runFitCheck } from '@/server/agent/fit';
import { fail, handle, json, type RouteContext } from '@/server/http';
import { db } from '@/server/store';

// GET: the questions for one subscription, worded with its plan, price and measured usage.
async function GET({ request }: RouteContext) {
  const subId = new URL(request.url).searchParams.get('subId') ?? '';
  const insights = analyze(db()).insights;
  const insight = insights.find((i) => i.sub.id === subId);
  if (!insight) return fail(404, 'Unknown subscription');
  return json({ questions: fitQuestions(insight, insights) });
}

// POST: runs the fit check and streams each step as newline-delimited JSON. The finished check
// is stored on the subscription and arrives with the next state.
async function POST({ request }: RouteContext) {
  const body = (await request.json().catch(() => ({}))) as { subId?: string; answers?: Record<string, unknown> };
  if (!db().subscriptions.some((s) => s.id === body.subId && s.status !== 'cancelled')) return fail(404, 'Unknown subscription');
  const answers = Object.fromEntries(
    Object.entries(body.answers ?? {})
      .slice(0, 12)
      .map(([id, value]) => [id.slice(0, 40), String(value ?? '').slice(0, 600)]),
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await runFitCheck(body.subId!, answers, emit);
      } catch (error) {
        emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}

export const Route = createFileRoute('/api/fit')({
  server: { handlers: { GET: handle('fit.questions', GET, { quiet: true }), POST: handle('fit', POST) } },
});
