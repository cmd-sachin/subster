import { flush } from '@/server/vfs';
import { createFileRoute } from '@tanstack/react-router';
import { analyze } from '@/domain/intelligence';
import type { StreamEvent } from '@/domain/types';
import { followUpQuestions, fitQuestions, runFitCheck } from '@/server/agent/fit';
import { popularOn } from '@/server/services/scrape';
import { fail, handle, json, type RouteContext } from '@/server/http';
import { db } from '@/server/store';

// GET: the questions for one subscription, worded with its plan, price and measured usage.
async function GET({ request }: RouteContext) {
  const subId = new URL(request.url).searchParams.get('subId') ?? '';
  const insights = analyze(db()).insights;
  const insight = insights.find((i) => i.sub.id === subId);
  if (!insight) return fail(404, 'Unknown subscription');
  const questions = fitQuestions(insight, insights);
  // For a video service the titles question comes with what is popular on it now, to pick from.
  const titles = questions.find((q) => q.kind === 'titles');
  if (titles && insight.sub.providerId) titles.suggestions = await popularOn(insight.sub.providerId, db().settings.currency).catch(() => []);
  return json({ questions });
}

// POST: runs the fit check and streams each step as newline-delimited JSON. The finished check
// is stored on the subscription and arrives with the next state.
async function POST({ request }: RouteContext) {
  const body = (await request.json().catch(() => ({}))) as { subId?: string; answers?: Record<string, unknown>; step?: 'followups'; followUps?: { label?: unknown; answer?: unknown }[] };
  if (!db().subscriptions.some((s) => s.id === body.subId && s.status !== 'cancelled')) return fail(404, 'Unknown subscription');
  const answers = Object.fromEntries(
    Object.entries(body.answers ?? {})
      .slice(0, 12)
      .map(([id, value]) => [id.slice(0, 40), String(value ?? '').slice(0, 600)]),
  );

  // After the standard questions the dialog asks whether the model wants to know anything more.
  if (body.step === 'followups') return json({ questions: await followUpQuestions(body.subId!, answers) });
  const followUps = (Array.isArray(body.followUps) ? body.followUps : []).slice(0, 2).map((f) => ({ label: String(f.label ?? '').slice(0, 240), answer: String(f.answer ?? '').slice(0, 600) }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await runFitCheck(body.subId!, answers, emit, followUps);
      } catch (error) {
        emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      await flush().catch(() => {});
        controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}

export const Route = createFileRoute('/api/fit')({
  server: { handlers: { GET: handle('fit.questions', GET, { quiet: true }), POST: handle('fit', POST, { needs: 'assistant' }) } },
});
