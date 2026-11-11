// Agent runs. Two engines share the same tools and produce the same kind of trace:
//  - "gemini": a tool-calling loop on the Gemini API. The model decides what to inspect and propose.
//  - "rules":  a deterministic workflow used when no Gemini key is configured, so the
//              product still works end to end. It follows the rules engine's recommendations.
// Neither engine can execute a money-affecting change: they can only call propose_action.

import { createPartFromFunctionResponse, type Content } from '@google/genai';
import { CATALOG } from '@/domain/catalog';
import { describeLlmError, generate, llmAvailable, textOf } from '@/server/llm';
import { log } from '@/server/logger';
import { addDays, money, today } from '@/domain/dates';
import { analyze } from '@/domain/intelligence';
import { db, save, uid } from '@/server/store';
import type { ActionType, AgentRun, RunStep, StreamEvent } from '@/domain/types';
import { runTool, TOOL_DEFS } from './tools';

const MAX_TURNS = 14;

export const agentEngine = (): 'gemini' | 'rules' => (llmAvailable() ? 'gemini' : 'rules');

const SYSTEM = `You are Subster, a subscription agent working for one person. Your job is to make sure every recurring payment earns its place: find subscriptions that cost more than the use they get, catch charges before they happen, and put concrete, well-evidenced actions in the user's approval inbox.

How you work:
- Every number you state comes from a tool result. Start with list_subscriptions; call get_subscription_detail before proposing anything for a subscription.
- You act through propose_action. You cannot cancel or pause anything yourself: the user approves each proposal, and only then is it executed (through the PayPal API for PayPal-managed agreements, or by guiding the user to the merchant's page otherwise). The one exception is a subscription whose policy is "auto", where the user has pre-approved reversible pauses.
- Never propose changes to a subscription whose policy is "locked".
- Respect earlier decisions. A subscription marked user_declined was offered that change and the user said no; leave it alone and do not argue the point again. It is cleared automatically when the price or their usage changes.
- Usage is time measured on the devices named in usage_coverage: "phone" is foreground time in the Android app, "web" is time on the service's site in the user's browser. For a video service whose coverage does not include "tv", TV viewing is invisible to you, so say that in the reason and prefer the reversible option. If the evidence is too thin to act on, use schedule_review instead of proposing.
- Prefer the least drastic action that fixes the problem: downgrade when a cheaper plan fits the usage, pause when heavy use dropped recently, cancel when something is unused or duplicated, or a trial is about to convert unused.
- Deadlines matter. Deal first with whatever charges soonest.
- Leave subscriptions that are good value alone, and don't propose something that already has an open proposal.

When you finish, write a short plain-text summary for the user: what you found, what is now waiting in their inbox with the total monthly saving, and anything you deliberately left alone. No markdown headings or tables. The user's amounts are in the currency reported by list_subscriptions; plan prices from search_services say whether they came from the official site or from the built-in US list prices.

Starting subscriptions: when the user asks to subscribe to or sign up for an app, use search_services to find it and its plans, then propose_subscription. If they did not name a plan and the app has several, ask which one before proposing. A proposal buys nothing: the user approves it in the inbox and confirms the agreement at PayPal.`;

type Emit = (event: StreamEvent) => void;

interface RunOptions {
  trigger: AgentRun['trigger'];
  triggerDetail?: string;
  /** The task for this run: a sweep instruction, a webhook description, or the user's chat message. */
  task: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  /** Forces the deterministic rules engine even when a model is configured (used by tests). */
  engine?: 'rules';
  /** Subscription ids an event-triggered run should confine itself to. */
  focus?: string[];
}

export async function runAgent(options: RunOptions, emit: Emit): Promise<AgentRun> {
  const engine = options.engine ?? agentEngine();
  const run: AgentRun = {
    id: uid('run'),
    trigger: options.trigger,
    triggerDetail: options.triggerDetail,
    engine,
    startedAt: new Date().toISOString(),
    steps: [],
  };
  const record = (step: Omit<RunStep, 'at'>) => {
    const full = { ...step, at: new Date().toISOString() };
    run.steps.push(full);
    emit({ type: 'step', step: full });
  };

  try {
    log.info('agent', `Run started (${options.trigger})`, { runId: run.id, engine, detail: options.triggerDetail });
    run.summary = engine === 'gemini' ? await geminiLoop(run, options, record, emit) : await rulesWorkflow(run, options, record, emit);
  } catch (error) {
    const message = describeLlmError(error);
    log.error('agent', 'Run stopped by an error', { runId: run.id, error: message });
    record({ kind: 'final', title: 'Run stopped', detail: message });
    run.summary = message;
    emit({ type: 'error', message });
  }

  run.finishedAt = new Date().toISOString();
  const data = db();
  log.info('agent', `Run finished (${options.trigger})`, { runId: run.id, engine, steps: run.steps.length, proposals: run.steps.filter((s) => s.kind === 'action').length, ms: Date.parse(run.finishedAt) - Date.parse(run.startedAt) });
  data.runs.unshift(run);
  data.runs = data.runs.slice(0, 12);
  save();
  emit({ type: 'done', runId: run.id, summary: run.summary ?? '' });
  return run;
}

// ---- Engine 1: Gemini ----------------------------------------------------------------------

async function geminiLoop(run: AgentRun, options: RunOptions, record: (s: Omit<RunStep, 'at'>) => void, emit: Emit) {
  const contents: Content[] = [
    ...(options.history ?? []).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: options.task }] },
  ];
  const functionDeclarations = TOOL_DEFS.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.input_schema }));
  let finalText = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await generate({
      contents,
      config: { systemInstruction: `${SYSTEM}\n\nToday is ${today()}.`, tools: [{ functionDeclarations }] },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content) throw new Error(`The model returned no answer${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}.`);
    // The model's turn goes back exactly as received: it carries the reasoning signatures the
    // API needs to continue after a tool call.
    contents.push(candidate.content);

    const text = textOf(response);
    const calls = response.functionCalls ?? [];
    if (calls.length === 0) {
      finalText = text;
      if (candidate.finishReason === 'MAX_TOKENS') finalText += '\n\n(The reply was cut off at the output limit.)';
      break;
    }
    if (text) record({ kind: 'thought', title: text });

    const results = [];
    for (const call of calls) {
      const name = call.name ?? '';
      const outcome = await runTool(name, (call.args ?? {}) as Record<string, unknown>, run.id);
      record({ kind: outcome.proposed ? 'action' : 'tool', tool: name, title: outcome.summary, detail: describeInput(call.args) });
      results.push(createPartFromFunctionResponse(call.id ?? name, name, outcome.isError ? { error: outcome.result } : { result: outcome.result }));
    }
    // All results for one model turn go back together in a single user turn.
    contents.push({ role: 'user', parts: results });
  }

  if (!finalText) finalText = 'I ran out of steps before finishing. What I proposed so far is in your inbox.';
  emit({ type: 'text', text: finalText });
  record({ kind: 'final', title: 'Summary', detail: finalText });
  return finalText;
}

const describeInput = (input: unknown) => {
  const entries = Object.entries((input ?? {}) as Record<string, unknown>).filter(([k]) => k !== 'evidence');
  return entries.length ? entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ') : undefined;
};

// ---- Engine 2: deterministic workflow -------------------------------------------------------

async function rulesWorkflow(run: AgentRun, options: RunOptions, record: (s: Omit<RunStep, 'at'>) => void, emit: Emit) {
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const outcome = await runTool(name, input, run.id);
    record({ kind: outcome.proposed ? 'action' : 'tool', tool: name, title: outcome.summary, detail: describeInput(input) });
    return outcome;
  };

  if (options.trigger === 'chat') {
    const answer = await answerFromFacts(options.task, call);
    emit({ type: 'text', text: answer });
    record({ kind: 'final', title: 'Answer', detail: answer });
    return answer;
  }

  await call('list_subscriptions');
  await call('forecast_renewals', { days: 14 });

  const portfolio = analyze(db());
  const actionable = portfolio.insights
    .filter((i) => !['keep', 'review'].includes(i.recommendation.action) && i.sub.policy !== 'locked')
    .filter((i) => !options.focus || options.focus.includes(i.sub.id))
    .sort((a, b) => a.daysToRenewal - b.daysToRenewal);

  let proposed = 0;
  let saving = 0;
  const reviews: string[] = [];
  for (const i of actionable) {
    await call('get_subscription_detail', { subscription_id: i.sub.id });
    const tvCaveat = i.sub.category === 'Streaming' && i.sub.coverage !== 'phone+tv' ? ' TV viewing is not measured, so it is not counted.' : '';

    // Thin evidence on a cancel: put it on the timeline instead of the inbox.
    if (i.recommendation.confidence !== 'high' && i.recommendation.action === 'cancel' && i.hoursPrev30 > 0 && i.daysToRenewal > 10) {
      await call('schedule_review', { subscription_id: i.sub.id, date: addDays(i.sub.nextRenewal, -3), note: `Still unused? ${i.recommendation.reason}` });
      reviews.push(i.sub.name);
      continue;
    }
    const outcome = await call('propose_action', {
      subscription_id: i.sub.id,
      type: i.recommendation.action as ActionType,
      reason: i.recommendation.reason + tvCaveat,
      evidence: i.issues.map((x) => x.message),
    });
    if (outcome.proposed) {
      proposed++;
      saving += i.recommendation.savingsMonthly;
    }
  }

  const unmeasured = portfolio.insights.filter((i) => i.verdict === 'unmeasured').map((i) => i.sub.name);
  const kept = portfolio.insights.filter((i) => i.recommendation.action === 'keep' && i.sub.status === 'active').map((i) => i.sub.name);
  const pending = db().actions.filter((a) => a.status === 'pending');
  if (options.focus) {
    // Event-triggered run: report on the event, not the whole portfolio.
    const summary = [
      options.triggerDetail ?? '',
      proposed
        ? `I put ${proposed} proposal${proposed === 1 ? '' : 's'} in your inbox worth ${money(Math.round(saving * 100) / 100)}/month. Nothing changes until you approve.`
        : 'Nothing to propose from this yet. New subscriptions need usage data before I can judge their value.',
      reviews.length ? `Scheduled a review for ${reviews.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    emit({ type: 'text', text: summary });
    record({ kind: 'final', title: 'Summary', detail: summary });
    return summary;
  }

  const parts = [
    `You pay ${money(portfolio.monthlySpend)}/month across ${portfolio.activeCount} subscriptions; ${money(portfolio.wastedMonthly)} of that goes to ones you barely use.`,
    proposed
      ? `I put ${proposed} new proposal${proposed === 1 ? '' : 's'} in your inbox worth ${money(Math.round(saving * 100) / 100)}/month. Nothing changes until you approve.`
      : pending.length
        ? `Nothing new to propose. ${pending.length} earlier proposal${pending.length === 1 ? ' is' : 's are'} still waiting for you.`
        : 'Nothing needs your attention right now.',
    reviews.length ? `Scheduled a review for ${reviews.join(', ')} before renewal instead of proposing a cancel.` : '',
    kept.length ? `Left alone as good value: ${kept.join(', ')}.` : '',
    unmeasured.length ? `Could not measure: ${unmeasured.join(', ')} (no usage signal).` : '',
  ].filter(Boolean);
  const summary = parts.join(' ');
  emit({ type: 'text', text: summary });
  record({ kind: 'final', title: 'Summary', detail: summary });
  return summary;
}

/** Keyword-routed answers for chat when no LLM is configured. Honest about being limited. */
async function answerFromFacts(question: string, call: (name: string, input?: Record<string, unknown>) => Promise<{ result: unknown }>) {
  const q = question.toLowerCase();
  const portfolio = analyze(db());
  const note = '';

  // "subscribe to spotify duo", "sign up for netflix", "start chatgpt plus"
  if (/\b(subscribe|sign ?up|start|get|buy)\b/.test(q)) {
    const app = CATALOG.filter((a) => q.includes(a.name.toLowerCase()) || q.includes(a.name.toLowerCase().split(' ')[0])).sort((a, b) => b.name.length - a.name.length)[0];
    if (app) {
      await call('search_services', { query: app.name });
      const usdPlans = app.plans.filter((p) => p.currency === 'USD');
      if (usdPlans.length === 0) return `${app.name} cannot be started from here because I have no confirmed plan list for it. Subscribe on its site (${app.manageUrl}) and I will pick up the payment from your bank feed or statement.${note}`;
      const plan = [...usdPlans].sort((a, b) => b.name.length - a.name.length).find((p) => q.includes(p.name.toLowerCase()));
      if (!plan && usdPlans.length > 1) {
        return `${app.name} has ${usdPlans.length} plans: ${usdPlans.map((p) => `${p.name} at ${money(p.price, 'USD')}`).join(', ')}. Which one do you want? Say for example "subscribe to ${app.name} ${usdPlans[0].name}".${note}`;
      }
      const chosen = plan ?? usdPlans[0];
      const outcome = (await call('propose_subscription', { app_id: app.id, plan: chosen.name, reason: `You asked to subscribe to ${app.name} ${chosen.name}.` })) as { result: { error?: string } };
      if (outcome.result.error) return `${outcome.result.error}${note}`;
      return `I put "Subscribe to ${app.name} ${chosen.name}" in your inbox at ${money(chosen.price, 'USD')}. Nothing is charged yet: approve it there and confirm the agreement at PayPal.${note}`;
    }
  }

  // "cancel netflix", "pause spotify", "resume netflix"
  const verb = q.match(/\b(cancel|pause|resume|stop)\b/)?.[1];
  const target = verb && portfolio.insights.find((i) => q.includes(i.sub.name.toLowerCase()) || q.includes(i.sub.name.toLowerCase().split(' ')[0]));
  if (verb && target) {
    await call('get_subscription_detail', { subscription_id: target.sub.id });
    const type = verb === 'stop' ? 'cancel' : verb;
    const outcome = (await call('propose_action', { subscription_id: target.sub.id, type, reason: `You asked to ${type} ${target.sub.name}.` })) as { result: { error?: string; channel?: string } };
    if (outcome.result.error) return `${outcome.result.error}${note}`;
    return `I put "${type} ${target.sub.name}" in your inbox. ${outcome.result.channel === 'paypal_api' ? 'Approving it runs the change through PayPal and verifies it.' : 'It is not billed through PayPal, so approving it takes you to the official page to finish.'}${note}`;
  }

  if (/next|upcoming|renew|forecast|will i (pay|spend)/.test(q)) {
    await call('forecast_renewals', { days: 30 });
    const lines = portfolio.upcoming.map((u) => `${u.date}: ${u.name} ${money(u.amount)}${u.kind === 'trial_conversion' ? ' (trial converts)' : ''}`);
    return `In the next 30 days you will be charged ${money(portfolio.next30Total)} across ${portfolio.upcoming.length} payments.\n${lines.join('\n')}${note}`;
  }
  if (/price|increase|went up|raised/.test(q)) {
    await call('list_subscriptions');
    const raised = portfolio.insights.filter((i) => i.previousPrice !== undefined);
    return (raised.length ? raised.map((i) => `${i.sub.name} went from ${money(i.previousPrice ?? 0)} to ${money(i.sub.price)}.`).join(' ') : 'No price increases in the charge history I have.') + note;
  }
  if (/save|cancel|cut|waste|unused|worth/.test(q)) {
    await call('list_subscriptions');
    const cuts = portfolio.insights.filter((i) => i.recommendation.savingsMonthly > 0).sort((a, b) => b.recommendation.savingsMonthly - a.recommendation.savingsMonthly);
    const lines = cuts.map((i) => `${i.recommendation.action} ${i.sub.name}: saves ${money(i.recommendation.savingsMonthly)}/month. ${i.recommendation.reason}`);
    return `You could save about ${money(portfolio.potentialSavingsMonthly)}/month (${money(Math.round(portfolio.potentialSavingsMonthly * 12))}/year):\n${lines.join('\n')}\n\nRun a sweep to turn these into proposals you can approve.${note}`;
  }
  await call('list_subscriptions');
  const worst = [...portfolio.insights].filter((i) => i.costPerHour !== null).sort((a, b) => (b.costPerHour ?? 0) - (a.costPerHour ?? 0))[0];
  return `You spend ${money(portfolio.monthlySpend)}/month (${money(portfolio.yearlySpend)}/year) on ${portfolio.activeCount} subscriptions and used them for ${portfolio.hours30} hours in the last 30 days. ${money(portfolio.wastedMonthly)}/month goes to subscriptions you barely use.${worst ? ` The most expensive per hour is ${worst.sub.name} at ${money(worst.costPerHour ?? 0)}/hour.` : ''}${note}`;
}

export const SWEEP_TASK =
  'Run a full audit of my subscriptions now. Check what is charging soon, find anything unused, declining, duplicated, overpriced or failing, and put proposals in my inbox for whatever is worth acting on.';

export const webhookTask = (eventType: string, subName: string, detail: string) =>
  `PayPal just sent a webhook: ${eventType} for ${subName}. ${detail} Look at that subscription and decide whether anything should be proposed or scheduled because of it. Stay focused on this event.`;