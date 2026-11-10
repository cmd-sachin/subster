// Live plan monitoring. For a service, Gemini looks up the provider's OFFICIAL site with Google
// Search grounding and URL reading, and reports the plans currently sold in the user's region,
// in that region's currency. Results are cached with the time and the pages they came from; a
// background monitor re-checks the services the user subscribes to and records any change.
//
// Google Search grounding cannot be restricted to one domain, so the restriction is enforced
// afterwards: a result is only accepted if the grounding sources Gemini reports include a page on
// the provider's own domain. That proves the official site was read. It does not prove no other
// page influenced the answer, which is why every result shows its sources.
//
// This needs a Gemini API key. Without one nothing is fetched and the UI shows the built-in
// catalog prices, labelled as not live.

import { ApiError } from '@google/genai';
import { providerById, type Provider } from '@/domain/catalog';
import type { BillingCycle, Currency, LivePlan, LivePlans } from '@/domain/types';
import { HttpError } from '@/server/http';
import { describeLlmError, generate, llmAvailable, textOf } from '@/server/llm';
import { log } from '@/server/logger';
import { db, save } from '@/server/store';

const REGION: Record<Currency, string> = { INR: 'India', USD: 'the United States', EUR: 'Germany', GBP: 'the United Kingdom' };
const CURRENCIES: Currency[] = ['USD', 'INR', 'EUR', 'GBP'];
const CYCLES: BillingCycle[] = ['monthly', 'quarterly', 'yearly'];
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MONITOR_EVERY_MS = 6 * 60 * 60 * 1000;

export const planMonitorAvailable = () => llmAvailable();

/** The provider's registrable domain: where plan data has to come from. */
export function officialDomain(provider: Provider) {
  const labels = new URL(provider.manageUrl).hostname.split('.');
  const twoPartSuffix = /^(co|com|org|net)\.[a-z]{2}$/.test(labels.slice(-2).join('.'));
  return labels.slice(twoPartSuffix ? -3 : -2).join('.');
}

/** Providers whose pricing lives on a different official domain from their account pages. */
const EXTRA_OFFICIAL_DOMAINS: Record<string, string[]> = {
  claude: ['claude.com', 'anthropic.com'],
  'google-ai-gemini': ['gemini.google', 'google.com'],
  'chatgpt-plus': ['openai.com'],
  'prime-video': ['primevideo.com', 'amazon.in'],
  jiohotstar: ['jiohotstar.com'],
  'youtube-premium': ['google.com'],
  'microsoft-365': ['microsoft365.com'],
  'xbox-game-pass': ['xbox.com'],
};

/** Every domain that counts as the provider's own, account domain first. */
export const officialDomains = (provider: Provider) => [officialDomain(provider), ...(EXTRA_OFFICIAL_DOMAINS[provider.id] ?? [])];

const onDomain = (host: string, domains: string | string[]) => [domains].flat().some((domain) => host === domain || host.endsWith(`.${domain}`));

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function parsePlans(text: string, domain: string[]): { plans: LivePlan[]; sources: string[]; found: boolean } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return plan data.');
  const raw = JSON.parse(text.slice(start, end + 1)) as { found?: boolean; plans?: unknown[]; source_urls?: unknown[] };

  // Everything from the model is validated; anything malformed is dropped rather than shown.
  const plans: LivePlan[] = [];
  for (const item of (raw.plans ?? []).slice(0, 14)) {
    const p = item as Record<string, unknown>;
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 60) : '';
    const price = Number(p.price);
    const currency = String(p.currency ?? '').toUpperCase() as Currency;
    const cycle = String(p.cycle ?? '').toLowerCase() as BillingCycle;
    if (!name || !(price > 0 && price < 10_000_000) || !CURRENCIES.includes(currency) || !CYCLES.includes(cycle)) continue;
    plans.push({ name, price: Math.round(price * 100) / 100, currency, cycle, ...(typeof p.note === 'string' && p.note.trim() && { note: p.note.trim().slice(0, 140) }) });
  }
  const sources = (raw.source_urls ?? []).filter((u): u is string => typeof u === 'string' && onDomain(hostOf(u), domain)).slice(0, 4);
  return { plans, sources, found: raw.found !== false && plans.length > 0 };
}

/** Reads the provider's official site now and stores what it sells. */
export async function refreshPlans(providerId: string): Promise<LivePlans> {
  const provider = providerById(providerId);
  if (!provider) throw new HttpError(404, 'Unknown service');
  if (!planMonitorAvailable()) throw new HttpError(503, 'Live plan checks need GEMINI_API_KEY in .env.local. Until then the catalog prices are shown.');

  const data = db();
  const currency = data.settings.currency;
  const region = REGION[currency];
  const domains = officialDomains(provider);
  const domain = domains.join(' or ');
  const previous = data.livePlans[providerId];
  const started = performance.now();

  const prompt = `Find the subscription plans that ${provider.name} currently sells to individual consumers in ${region}, using only its official website (${domain}). Search those sites and read the official pricing or plans page.

Rules:
- Use only pages on ${domain}. Do not use news, blogs, comparison sites or your own memory for prices.
- Report the price actually charged in ${region}, in ${currency} if the official site prices it in ${currency} there. If the site only lists another currency for that region, report that currency as shown. Never convert between currencies yourself.
- List every current paid consumer plan (for example Plus, Pro, Max and Ultra are all included; free tiers are not). Skip business, team and enterprise plans.
- cycle is "monthly", "quarterly" (every 3 months, or about 84 days for prepaid plans) or "yearly". If a plan is offered both monthly and yearly, list each as its own entry.
- If you cannot confirm the plans from the official site, return found false and an empty plans list. Do not guess.

Reply with one JSON object and nothing else:
{"found": boolean, "plans": [{"name": string, "price": number, "currency": "INR"|"USD"|"EUR"|"GBP", "cycle": "monthly"|"quarterly"|"yearly", "note": string (optional, a few words)}], "source_urls": [string]}`;

  try {
    const response = await generate({
      contents: prompt,
      config: { tools: [{ googleSearch: {} }, { urlContext: {} }] },
    });

    const parsed = parsePlans(textOf(response), domains);
    if (!parsed.found) throw new Error(`Could not confirm current plans on ${domain}.`);

    // The pages Gemini says it grounded the answer on. At least one must be the provider's own.
    const grounding = (response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).map((chunk) => chunk.web).filter((web) => web !== undefined);
    const official = grounding.filter((web) => onDomain((web.domain ?? web.title ?? '').replace(/^www\./, ''), domains) || onDomain(hostOf(web.uri ?? ''), domains));
    if (official.length === 0 && parsed.sources.length === 0) {
      throw new Error(`The answer was not grounded on ${domain}, so it was discarded.`);
    }
    const sources = [...new Set([...parsed.sources, ...official.map((web) => web.uri).filter((uri): uri is string => Boolean(uri))])].slice(0, 4);

    const changes = previous?.status === 'ok' ? diffPlans(previous.plans, parsed.plans) : [];
    const result: LivePlans = {
      providerId,
      status: 'ok',
      plans: parsed.plans,
      region,
      sourceUrls: sources,
      checkedAt: new Date().toISOString(),
      ...(changes.length > 0 ? { changes, changedAt: new Date().toISOString() } : previous?.changes && { changes: previous.changes, changedAt: previous.changedAt }),
    };
    data.livePlans[providerId] = result;
    save('plans refreshed');
    const ms = Math.round(performance.now() - started);
    if (changes.length > 0) log.warn('plans', `${provider.name} changed its plans`, { changes, ms });
    else log.info('plans', `${provider.name}: ${parsed.plans.length} plans read from ${domain}`, { region, sources, groundedOn: grounding.length, ms });
    return result;
  } catch (error) {
    // Search grounding has its own quota, which on a free-tier key is often zero.
    const quota = error instanceof ApiError && error.status === 429;
    const message = quota ? 'Gemini refused the search (quota exceeded). Google Search grounding is usually not included in the free tier: enable billing on the key at aistudio.google.com, then try again.' : describeLlmError(error);
    // A failed check keeps the last good plans, marked with why the newest check failed.
    data.livePlans[providerId] = {
      ...(previous ?? { providerId, plans: [], region, sourceUrls: [] }),
      status: previous?.plans.length ? 'ok' : 'failed',
      error: message,
      checkedAt: previous?.checkedAt ?? new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
    };
    save('plan check failed');
    log.error('plans', `${provider.name}: plan check failed`, { domain, error: message, ms: Math.round(performance.now() - started) });
    throw new HttpError(502, message);
  }
}

function diffPlans(before: LivePlan[], after: LivePlan[]): string[] {
  const key = (p: LivePlan) => `${p.name.toLowerCase()}|${p.cycle}`;
  const old = new Map(before.map((p) => [key(p), p]));
  const changes: string[] = [];
  for (const plan of after) {
    const was = old.get(key(plan));
    if (!was) changes.push(`New plan: ${plan.name} at ${plan.currency} ${plan.price} ${plan.cycle}`);
    else if (was.price !== plan.price || was.currency !== plan.currency) changes.push(`${plan.name}: ${was.currency} ${was.price} to ${plan.currency} ${plan.price}`);
    old.delete(key(plan));
  }
  for (const gone of old.values()) changes.push(`No longer listed: ${gone.name}`);
  return changes;
}

/** Re-checks the services the user subscribes to whose plan data is older than a day. */
async function monitorOnce() {
  if (!planMonitorAvailable()) return;
  const data = db();
  const due = [...new Set(data.subscriptions.filter((s) => s.providerId && s.status !== 'cancelled').map((s) => s.providerId!))]
    .filter((id) => Date.now() - Date.parse(data.livePlans[id]?.lastAttemptAt ?? data.livePlans[id]?.checkedAt ?? '1970-01-01') > STALE_AFTER_MS)
    .slice(0, 8);
  if (due.length === 0) return;
  log.info('plans', `Monitor: checking ${due.length} subscribed service${due.length === 1 ? '' : 's'}`, { services: due });
  // One at a time: this is background work, and free-tier Gemini quotas are small.
  for (const id of due) await refreshPlans(id).catch(() => {});
}

const timers = globalThis as unknown as { __subsensePlanMonitor?: ReturnType<typeof setInterval> };

/** Starts the background monitor once per process. */
export function startPlanMonitor() {
  if (timers.__subsensePlanMonitor) return;
  timers.__subsensePlanMonitor = setInterval(() => void monitorOnce(), MONITOR_EVERY_MS);
  timers.__subsensePlanMonitor.unref?.();
  setTimeout(() => void monitorOnce(), 30_000).unref?.();
}
