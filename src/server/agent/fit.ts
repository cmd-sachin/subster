// The fit check: "is this subscription right for me, at this price?"
//
// It is a small agent of its own. The user answers a few questions about how they use the
// service; the agent then decides what to look up (their usage and cost, where the films and
// series they named can be watched and what renting them costs, the official price pages of
// alternatives, the catalog), and finishes with a verdict and a recommendation. If the
// recommendation is to cancel or downgrade it can put that in the inbox, where it waits for the
// user like any other proposal.
//
// Numbers the user sees come from tool results, not from the model's prose: title offers and
// prices are stored as read, and an alternative's price is marked "live", "catalog" or "model"
// according to whether a tool actually returned it.

import { createPartFromFunctionResponse, type Content } from '@google/genai';
import { CATEGORY_LABEL, providerById } from '@/domain/catalog';
import { cycleShort, money, today } from '@/domain/dates';
import { analyze } from '@/domain/intelligence';
import type { Category, FitAlternative, FitCheck, FitQuestion, FitTitle, Insight, RunStep, StreamEvent } from '@/domain/types';
import { describeLlmError, generate, llmAvailable, textOf } from '@/server/llm';
import { log } from '@/server/logger';
import { livePricing, PRICING_PAGES, titleAvailability } from '@/server/services/live';
import { db, save, uid } from '@/server/store';
import { runTool, TOOL_DEFS, type ToolDef } from './tools';

const MAX_TURNS = 10;
const VIDEO: Category[] = ['Streaming'];

// ---- Questions -----------------------------------------------------------------------------

/** The questions for one subscription, worded with the user's own plan, price and usage. */
export function fitQuestions(insight: Insight, all: Insight[]): FitQuestion[] {
  const { sub } = insight;
  const paying = `${money(sub.price)} per ${cycleShort(sub.cycle)}`;
  const used = insight.verdict === 'unmeasured' || insight.verdict === 'essential' ? '' : ` and used it ${insight.hours30} hours in the last 30 days`;
  const others = all.filter((i) => i.sub.id !== sub.id && i.sub.category === sub.category && i.sub.status !== 'cancelled').map((i) => i.sub.name);

  if (VIDEO.includes(sub.category)) {
    return [
      { id: 'titles', kind: 'titles', label: `You pay ${paying} for ${sub.name}${used}. Which films or series are you keeping it for, or want to watch next?`, hint: 'One per line, up to six. These are checked against what is actually available.' },
      { id: 'hours', kind: 'choice', label: 'In a normal week, how much do you expect to watch on it?', options: ['Under 2 hours', '2 to 5 hours', '5 to 10 hours', 'More than 10 hours'] },
      { id: 'needs', kind: 'multi', label: 'Which of these do you actually need?', options: ['4K quality', 'Several screens at once', 'Downloads for offline', 'Regional language content', 'Live sport', 'Kids profiles'] },
      { id: 'rent', kind: 'choice', label: 'If a title could be rented once for less than a month of the subscription, would that work for you?', options: ['Yes, I mostly want specific titles', 'Sometimes', 'No, I like browsing a library'] },
    ];
  }
  if (sub.category === 'Storage') {
    return [
      { id: 'used_gb', kind: 'number', label: `You pay ${paying} for ${sub.name} (${sub.plan}). Roughly how many GB are you using right now?`, hint: 'Your account page shows this. A rough figure is fine.' },
      { id: 'contents', kind: 'multi', label: 'What takes up the space?', options: ['Photos and videos', 'Phone backups', 'Documents', 'Work or project files', 'Email'] },
      { id: 'devices', kind: 'multi', label: 'Which devices need to reach it?', options: ['Android phone', 'iPhone or iPad', 'Windows PC', 'Mac'] },
      { id: 'sharing', kind: 'choice', label: 'Do you share the storage with family?', options: ['No, just me', 'Yes, with family members'] },
      { id: 'growth', kind: 'choice', label: 'How fast is it filling up?', options: ['Barely changes', 'A few GB a month', 'Fast, I shoot a lot of video'] },
    ];
  }
  if (sub.category === 'AI') {
    return [
      { id: 'tasks', kind: 'multi', label: `You pay ${paying} for ${sub.name}${used}. What do you use it for?`, options: ['Writing and editing', 'Coding', 'Research with sources', 'Images or video', 'Data and spreadsheets', 'Everyday questions'] },
      { id: 'limits', kind: 'choice', label: 'How often do you run into its usage limits?', options: ['Never', 'A few times a month', 'Most weeks', 'Almost daily'] },
      { id: 'quality', kind: 'choice', label: 'What matters more for your work?', options: ['The most capable model, even if slower', 'Fast answers that are good enough', 'Not sure'] },
      { id: 'free_ok', kind: 'choice', label: 'Have you tried doing the same work on a free tier?', options: ['Yes, it was not enough', 'Yes, it was mostly fine', 'No'] },
      ...(others.length > 0 ? [{ id: 'overlap', kind: 'text' as const, label: `You also pay for ${others.join(' and ')}. What does ${sub.name} do for you that ${others.length === 1 ? 'it does' : 'they do'} not?` }] : []),
    ];
  }
  return [
    { id: 'purpose', kind: 'text', label: `You pay ${paying} for ${sub.name}${used}. What do you mainly use it for?` },
    { id: 'must_have', kind: 'text', label: 'Is there a feature you could not do without?', hint: 'Leave empty if nothing comes to mind.' },
    { id: 'frequency', kind: 'choice', label: 'How often do you really need it?', options: ['Daily', 'Weekly', 'A few times a month', 'Rarely'] },
    { id: 'open', kind: 'choice', label: 'Would you switch to something cheaper that does the same job?', options: ['Yes', 'Only if it is clearly as good', 'No'] },
  ];
}

// ---- Tools ---------------------------------------------------------------------------------

const OWN_TOOLS: ToolDef[] = [
  {
    name: 'check_titles',
    description:
      'Looks up, live, where films or series can be watched in the user\'s country: which subscriptions include them, and what renting or buying each one costs. Returns per title whether it is on the service being checked, every offer with its price, and the total cost of renting once every title the service lacks. A title with found=false could not be looked up: treat its availability as unknown.',
    input_schema: { type: 'object', properties: { titles: { type: 'array', items: { type: 'string' }, description: 'Up to six titles, spelled as the user gave them' } }, required: ['titles'], additionalProperties: false },
  },
  {
    name: 'read_official_prices',
    description: `Reads, live, the official price page of services and returns their current consumer plans with prices and what each plan gives. Only these catalog ids have a readable page: ${Object.keys(PRICING_PAGES).join(', ')}. Ids not in this list return nothing; use search_services for their catalog prices instead.`,
    input_schema: { type: 'object', properties: { app_ids: { type: 'array', items: { type: 'string' }, description: 'Catalog ids, including the service being checked if it is in the list' } }, required: ['app_ids'], additionalProperties: false },
  },
  {
    name: 'finish',
    description: 'Ends the check with the verdict. Call it exactly once, last.',
    input_schema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['worth_it', 'partly', 'not_worth_it', 'unclear'] },
        headline: { type: 'string', description: 'One short sentence the user reads first' },
        reasoning: { type: 'string', description: 'Three to five plain sentences: how the answers, the usage and what you looked up lead to the verdict. Say what you could not check.' },
        action: { type: 'string', enum: ['keep', 'downgrade', 'switch', 'rent_instead', 'cancel'] },
        recommendation: { type: 'string', description: 'What to do, in one or two sentences, with the numbers that justify it' },
        monthly_saving: { type: 'number', description: 'What the recommendation saves per month in the user\'s currency, 0 if nothing' },
        alternatives: {
          type: 'array',
          description: 'Up to four real alternatives worth considering, best first. Empty if keeping is right.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              app_id: { type: 'string', description: 'Catalog id when the alternative is in the catalog' },
              plan: { type: 'string' },
              price: { type: 'number', description: 'Exactly as a tool returned it. Omit if no tool gave a price.' },
              currency: { type: 'string' },
              cycle: { type: 'string', enum: ['monthly', 'quarterly', 'yearly', 'once'] },
              why: { type: 'string', description: 'Why it fits this user, tied to their answers' },
            },
            required: ['name', 'why'],
          },
        },
      },
      required: ['verdict', 'headline', 'reasoning', 'action', 'recommendation'],
      additionalProperties: false,
    },
  },
];

const SHARED = ['get_subscription_detail', 'search_services', 'propose_action'];
const TOOLS: ToolDef[] = [...TOOL_DEFS.filter((t) => SHARED.includes(t.name)), ...OWN_TOOLS];

const SYSTEM = `You are Subster's fit checker. One person wants to know whether one subscription is right for them at the price they pay. They have answered a few questions. Work it out and finish with a verdict.

How to work:
- You are given the subscription's measured detail and the catalog for its category up front. Each further tool call is slow and limited, so make only the ones the verdict needs, and make them in one turn when you can.
- For a video service: call check_titles with the titles the user named. Compare what the service actually carries with what they want, and compare a month of the subscription with renting the missing or wanted titles once. If they named nothing, judge on usage and say that no titles were checked.
- For cloud storage: compare the space they use with the plan they pay for, and call read_official_prices for their service and the realistic alternatives for their devices, then compare price per plan at the size they need.
- For an AI assistant: weigh their tasks, how often they hit limits and overlap with other AI subscriptions they pay for; call read_official_prices for the alternatives that have a readable page and search_services for the rest.
- For anything else: compare with the catalog alternatives you were given. Use search_services only to look outside this category.
- Every price you state must come from a tool result in this conversation. Never state a price, a catalogue fact or a product capability from memory as if it were checked. If something matters and you could not check it, say so plainly.
- Compare like with like: same currency, and note when a price is a US list price rather than the user's region.
- Judge capability claims about AI models cautiously: product line-ups change quickly and your own knowledge may be out of date. Prefer what the official pages returned.
- Be on the user's side, not the provider's and not against it. If the subscription is good value for them, say so and recommend keeping it.
- If your recommendation is to cancel or downgrade and the evidence is strong, also call propose_action so it waits in their inbox. Never propose for "keep", "switch" or "rent_instead".
- Then call finish. Plain language, no markdown, no em dashes.`;

type Emit = (event: StreamEvent) => void;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Whether a provider name on a listing means the service being checked ("Amazon Prime Video" for Prime Video). */
function sameService(listed: string, subName: string) {
  const a = norm(listed).replace(/^amazon /, '');
  const b = norm(subName).replace(/^amazon /, '').replace(/ (plus|premium)$/, '');
  const core = b.replace(/^jio/, '');
  return a.includes(b) || b.includes(a) || (core.length >= 5 && a.includes(core));
}

export async function runFitCheck(subId: string, answers: Record<string, string>, emit: Emit): Promise<FitCheck> {
  const data = db();
  const portfolio = analyze(data);
  const insight = portfolio.insights.find((i) => i.sub.id === subId);
  if (!insight) throw new Error('Unknown subscription');
  const { sub } = insight;
  const currency = data.settings.currency;
  const runId = uid('fit');
  const steps: RunStep[] = [];
  const record = (step: Omit<RunStep, 'at'>) => {
    const full = { ...step, at: new Date().toISOString() };
    steps.push(full);
    emit({ type: 'step', step: full });
  };

  const check: FitCheck = {
    subId,
    createdAt: new Date().toISOString(),
    engine: llmAvailable() ? 'gemini' : 'rules',
    answers,
    verdict: 'unclear',
    headline: '',
    reasoning: '',
    recommendation: { action: 'keep', text: '' },
    titles: [],
    alternatives: [],
    sources: [],
    basis: [],
    steps,
  };
  // Prices tools returned in this run, so an alternative's price can be traced to its origin.
  const seen = { live: new Set<string>(), catalog: new Set<string>() };
  const priceKey = (id: string | undefined, price: number | undefined) => `${id ?? ''}|${price ?? ''}`;

  async function callOwn(name: string, input: Record<string, unknown>): Promise<{ result: unknown; summary: string }> {
    if (name === 'check_titles') {
      const titles = (Array.isArray(input.titles) ? input.titles : []).map(String);
      const found = await titleAvailability(titles, currency);
      check.titles = found.map((t): FitTitle => ({ ...t, onService: t.offers.some((o) => o.kind === 'stream' && sameService(o.provider, sub.name)) }));
      for (const t of check.titles) if (t.url) check.sources.push({ label: `JustWatch: ${t.title}`, url: t.url });
      // What renting, once, every title the service does not carry would cost.
      const missing = check.titles.filter((t) => t.found && !t.onService);
      const rents = missing.map((t) => Math.min(...t.offers.filter((o) => o.kind === 'rent' && o.price && o.currency === currency).map((o) => o.price!)));
      check.rentTotal = rents.length > 0 && rents.every(Number.isFinite) ? Math.round(rents.reduce((a, b) => a + b, 0) * 100) / 100 : undefined;
      const known = check.titles.filter((t) => t.found);
      check.basis.push(known.length > 0 ? `Availability and rental prices for ${known.length} title${known.length === 1 ? '' : 's'} read live from JustWatch on ${today()}.` : 'None of the titles could be looked up, so availability is unknown.');
      const unread = check.titles.filter((t) => !t.found).map((t) => t.title);
      if (known.length > 0 && unread.length > 0) check.basis.push(`Could not look up: ${unread.join(', ')}.`);
      return {
        result: { service_checked: sub.name, currency, titles: check.titles.map((t) => ({ title: t.title, found: t.found, on_this_service: t.found ? t.onService : 'unknown', offers: t.offers })), rent_missing_titles_once_total: check.rentTotal ?? 'not all missing titles can be rented', subscription_monthly_cost: insight!.monthlyCost },
        summary: known.length > 0 ? `Looked up ${known.length} of ${titles.length} titles: ${check.titles.filter((t) => t.onService).length} on ${sub.name}` : 'Could not look up the titles',
      };
    }
    if (name === 'read_official_prices') {
      const ids = (Array.isArray(input.app_ids) ? input.app_ids : []).map(String);
      const pages = await livePricing(ids, currency);
      for (const page of pages) {
        const provider = providerById(page.providerId);
        check.sources.push({ label: `${provider?.name ?? page.providerId} prices`, url: page.url });
        for (const plan of page.plans) seen.live.add(priceKey(page.providerId, plan.price));
      }
      const unread = ids.filter((id) => !pages.some((p) => p.providerId === id));
      if (pages.length > 0) check.basis.push(`Prices for ${pages.map((p) => providerById(p.providerId)?.name ?? p.providerId).join(', ')} read live from their official pages on ${today()}.`);
      return {
        result: { read: pages.map((p) => ({ app_id: p.providerId, name: providerById(p.providerId)?.name, source: p.url, plans: p.plans })), could_not_read: unread },
        summary: pages.length > 0 ? `Read official prices for ${pages.map((p) => providerById(p.providerId)?.name ?? p.providerId).join(', ')}` : 'No official price page could be read',
      };
    }
    throw new Error(`Unknown tool ${name}`);
  }

  function finish(input: Record<string, unknown>) {
    const verdicts = ['worth_it', 'partly', 'not_worth_it', 'unclear'] as const;
    const actions = ['keep', 'downgrade', 'switch', 'rent_instead', 'cancel'] as const;
    check.verdict = verdicts.find((v) => v === input.verdict) ?? 'unclear';
    check.headline = String(input.headline ?? '').slice(0, 200);
    check.reasoning = String(input.reasoning ?? '').slice(0, 1500);
    const saving = Number(input.monthly_saving);
    check.recommendation = { action: actions.find((a) => a === input.action) ?? 'keep', text: String(input.recommendation ?? '').slice(0, 500), ...(saving > 0 && saving <= insight!.monthlyCost * 1.01 && { monthlySaving: Math.round(saving * 100) / 100 }) };
    check.alternatives = (Array.isArray(input.alternatives) ? input.alternatives : []).slice(0, 4).map((raw): FitAlternative => {
      const alt = raw as Record<string, unknown>;
      const providerId = typeof alt.app_id === 'string' && providerById(alt.app_id) ? alt.app_id : undefined;
      const price = Number(alt.price) > 0 ? Number(alt.price) : undefined;
      const basis = price === undefined ? 'model' : seen.live.has(priceKey(providerId, price)) ? 'live' : seen.catalog.has(priceKey(providerId, price)) ? 'catalog' : 'model';
      return { name: String(alt.name ?? '').slice(0, 80), providerId, plan: alt.plan ? String(alt.plan).slice(0, 60) : undefined, price, currency: price !== undefined ? String(alt.currency ?? currency).toUpperCase().slice(0, 3) : undefined, cycle: alt.cycle ? String(alt.cycle) : undefined, why: String(alt.why ?? '').slice(0, 300), basis };
    });
    if (check.alternatives.some((a) => a.basis === 'model')) check.basis.push('Alternatives marked "not checked" are the model\'s own suggestion; their price or details were not read from a source in this check.');
  }

  try {
    log.info('fit', `Fit check started for ${sub.name}`, { runId, engine: check.engine, answers: Object.keys(answers).length });
    if (check.engine === 'rules') rulesVerdict(check, insight, portfolio.insights);
    else {
      const answered = Object.entries(answers).filter(([, v]) => v.trim());
      const questions = fitQuestions(insight, portfolio.insights);
      const task = `Check this subscription: ${sub.name} (id "${sub.id}", category ${CATEGORY_LABEL[sub.category]}), plan ${sub.plan}, ${money(sub.price)} per ${cycleShort(sub.cycle)}. The user's currency is ${currency}.\n\nTheir answers:\n${answered.length > 0 ? answered.map(([id, value]) => `- ${questions.find((q) => q.id === id)?.label ?? id}\n  ${value.replace(/\n+/g, '; ')}`).join('\n') : '(they skipped the questions)'}`;
      // What every check needs is fetched before the model starts, so its own turns go on what only it can decide.
      const detail = await runTool('get_subscription_detail', { subscription_id: sub.id }, runId);
      record({ kind: 'tool', tool: 'get_subscription_detail', title: detail.summary });
      const market = await runTool('search_services', { category: sub.category }, runId);
      record({ kind: 'tool', tool: 'search_services', title: market.summary });
      const apps = ((market.result as { apps?: { id: string; name: string; plans: { name: string; price: number; currency: string; cycle: string }[]; plans_source: string; subscribed: boolean }[] }).apps ?? []).filter((app) => app.plans.length > 0);
      for (const app of apps) for (const plan of app.plans) seen.catalog.add(priceKey(app.id, plan.price));
      // The lookups this kind of service always needs are done here too. They cost one model request
      // each, and doing them up front saves the model a turn to ask for them.
      const titles = VIDEO.includes(sub.category) ? (answers.titles ?? '').split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean).slice(0, 6) : [];
      const rivals = sub.category === 'Storage' || sub.category === 'AI' ? Object.keys(PRICING_PAGES).filter((id) => providerById(id)?.category === sub.category) : [];
      const lookups: [string, Record<string, unknown>][] = [...(titles.length > 0 ? [['check_titles', { titles }] as [string, Record<string, unknown>]] : []), ...(rivals.length > 0 ? [['read_official_prices', { app_ids: rivals }] as [string, Record<string, unknown>]] : [])];
      let looked = '';
      for (const [name, input] of lookups) {
        record({ kind: 'tool', tool: name, title: name === 'check_titles' ? 'Looking up where your titles can be watched' : 'Reading official price pages' });
        try {
          const outcome = await callOwn(name, input);
          record({ kind: 'tool', tool: name, title: outcome.summary });
          looked += `\n\nAlready looked up for you with ${name} (do not call it again for the same input):\n${JSON.stringify(outcome.result)}`;
        } catch (error) {
          const message = describeLlmError(error);
          record({ kind: 'tool', tool: name, title: `${name} failed`, detail: message });
          looked += `\n\n${name} was tried and failed (${message}). Treat what it would have returned as unknown.`;
          check.basis.push(name === 'check_titles' ? 'The titles could not be looked up, so availability is unknown.' : 'The official price pages could not be read.');
        }
      }
      const briefing = `${task}\n\nSubscription detail (measured):\n${JSON.stringify(detail.result)}${looked}\n\nCatalog for this category (prices are list prices, see plans_source):\n${JSON.stringify(apps.map(({ id, name, plans, plans_source, subscribed }) => ({ id, name, plans, plans_source, subscribed })))}`;
      const contents: Content[] = [{ role: 'user', parts: [{ text: briefing }] }];
      const functionDeclarations = TOOLS.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.input_schema }));
      let done = false;

      for (let turn = 0; turn < MAX_TURNS && !done; turn++) {
        const response = await generate({ contents, config: { systemInstruction: `${SYSTEM}\n\nToday is ${today()}.`, tools: [{ functionDeclarations }] } });
        const candidate = response.candidates?.[0];
        if (!candidate?.content) throw new Error('The model returned no answer.');
        contents.push(candidate.content);
        const text = textOf(response);
        const calls = response.functionCalls ?? [];
        if (calls.length === 0) {
          // It answered in prose instead of calling finish: ask once more for the structured verdict.
          contents.push({ role: 'user', parts: [{ text: 'Call finish now with your verdict.' }] });
          continue;
        }
        if (text) record({ kind: 'thought', title: text.slice(0, 400) });

        const results = [];
        for (const call of calls) {
          const name = call.name ?? '';
          const input = (call.args ?? {}) as Record<string, unknown>;
          if (name === 'finish') {
            finish(input);
            done = true;
            results.push(createPartFromFunctionResponse(call.id ?? name, name, { result: 'recorded' }));
            continue;
          }
          try {
            if (SHARED.includes(name)) {
              // The check is about one subscription: it may only propose changes to that one.
              if (name === 'propose_action' && input.subscription_id !== sub.id) throw new Error('This check can only propose changes to the subscription being checked.');
              const outcome = await runTool(name, input, runId);
              if (name === 'search_services') for (const app of (outcome.result as { apps?: { id: string; plans: { price: number }[] }[] }).apps ?? []) for (const plan of app.plans) seen.catalog.add(priceKey(app.id, plan.price));
              record({ kind: outcome.proposed ? 'action' : 'tool', tool: name, title: outcome.summary });
              results.push(createPartFromFunctionResponse(call.id ?? name, name, outcome.isError ? { error: outcome.result } : { result: outcome.result }));
            } else {
              record({ kind: 'tool', tool: name, title: name === 'check_titles' ? 'Looking up where your titles can be watched' : 'Reading official price pages' });
              const outcome = await callOwn(name, input);
              record({ kind: 'tool', tool: name, title: outcome.summary });
              results.push(createPartFromFunctionResponse(call.id ?? name, name, { result: outcome.result }));
            }
          } catch (error) {
            const message = describeLlmError(error);
            record({ kind: 'tool', tool: name, title: `${name} failed`, detail: message });
            results.push(createPartFromFunctionResponse(call.id ?? name, name, { error: message }));
          }
        }
        contents.push({ role: 'user', parts: results });
      }
      if (!done) throw new Error('The check ran out of steps before reaching a verdict.');
    }
  } catch (error) {
    const message = describeLlmError(error);
    log.error('fit', `Fit check failed for ${sub.name}`, { runId, error: message });
    // A failed model run still leaves the user with the measured facts.
    rulesVerdict(check, insight, portfolio.insights);
    check.basis.unshift(`The agent could not finish (${message}), so this verdict uses your measured usage only.`);
  }

  if (insight.verdict !== 'unmeasured' && insight.verdict !== 'essential') check.basis.push(`Usage: ${insight.hours30} hours in the last 30 days, measured on your ${sub.coverage === 'phone' ? 'phone' : sub.coverage === 'web' ? 'browser' : 'phone and browser'}.`);
  else check.basis.push('No usage is measured for this subscription, so the verdict rests on your answers.');
  check.sources = check.sources.filter((s, i, all) => all.findIndex((o) => o.url === s.url) === i).slice(0, 10);
  record({ kind: 'final', title: check.headline });
  (db().fitChecks ??= {})[subId] = check;
  save('fit check');
  log.info('fit', `Fit check finished for ${sub.name}`, { runId, verdict: check.verdict, action: check.recommendation.action, titles: check.titles.length, alternatives: check.alternatives.length });
  emit({ type: 'done', runId, summary: check.headline });
  return check;
}

/** The verdict without a model: measured value and the catalog only. */
function rulesVerdict(check: FitCheck, insight: Insight, all: Insight[]) {
  const { sub, recommendation } = insight;
  const verdict = insight.verdict;
  check.engine = 'rules';
  check.verdict = verdict === 'great' ? 'worth_it' : verdict === 'fair' ? 'partly' : verdict === 'poor' || verdict === 'unused' ? 'not_worth_it' : 'unclear';
  check.headline =
    check.verdict === 'worth_it'
      ? `${sub.name} is earning its price.`
      : check.verdict === 'partly'
        ? `${sub.name} is fair value, not great.`
        : check.verdict === 'not_worth_it'
          ? `${sub.name} is not earning what you pay for it.`
          : `There is not enough usage data to judge ${sub.name}.`;
  check.reasoning = insight.costPerHour !== null ? `You pay ${money(insight.monthlyCost)} a month and used it ${insight.hours30} hours in the last 30 days, which is ${money(insight.costPerHour)} for each hour. ${recommendation.reason}` : recommendation.reason;
  const action = recommendation.action === 'cancel' ? 'cancel' : recommendation.action === 'downgrade' ? 'downgrade' : 'keep';
  check.recommendation = { action, text: recommendation.reason, ...(recommendation.savingsMonthly > 0 && { monthlySaving: recommendation.savingsMonthly }) };
  const rival = all.find((i) => i.sub.id !== sub.id && i.sub.category === sub.category && i.sub.status !== 'cancelled' && i.verdict === 'great');
  check.alternatives = rival ? [{ name: rival.sub.name, providerId: rival.sub.providerId, plan: rival.sub.plan, price: rival.sub.price, currency: db().settings.currency, cycle: rival.sub.cycle, why: `You already pay for it and used it ${rival.hours30} hours this month.`, basis: 'catalog' }] : [];
}
