// Live facts read from the web, without Google Search grounding (which this project's Gemini key
// has no quota for). Gemini's URL context tool fetches pages we name, and reports for each one
// whether the fetch worked.
//
// The model will happily answer from memory when a page fails to load, so nothing here trusts
// the text alone: a fact is kept only if it is tied to a URL whose retrieval succeeded. Anything
// else is dropped, and the caller is told the page could not be read.

import type { BillingCycle, Currency, LivePlan } from '@/domain/types';
import { generate, llmAvailable, textOf } from '@/server/llm';
import { log } from '@/server/logger';
import { db } from '@/server/store';
import { canScrapePrices, scrapePrices, scrapeTitle } from './scrape';

const CACHE_MS = 24 * 60 * 60 * 1000;

function cached<T>(id: string): T | undefined {
  const entry = db().liveCache?.[id];
  return entry && Date.now() - Date.parse(entry.at) < CACHE_MS ? (entry.value as T) : undefined;
}

/** Remembers a successful lookup. The caller's next save persists it. */
function remember(id: string, value: unknown) {
  const cache = (db().liveCache ??= {});
  cache[id] = { at: new Date().toISOString(), value };
  for (const [key, entry] of Object.entries(cache)) if (Date.now() - Date.parse(entry.at) > CACHE_MS) delete cache[key];
}

/** Direct page reading needs no model, so live lookups are always possible for the pages it covers. */
export const liveAvailable = () => true;

const key = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

/** Fetches the pages and returns the model's JSON answer with the set of pages that really loaded. */
async function readPages<T>(urls: string[], instruction: string): Promise<{ items: T[]; loaded: Set<string> }> {
  const started = performance.now();
  const response = await generate({
    contents: `${instruction}\n\nPages:\n${urls.join('\n')}\n\nUse only what these pages say. If a page did not load or does not contain the answer, say so for that page instead of answering from memory. Reply with one JSON array and nothing else.`,
    config: { tools: [{ urlContext: {} }] },
  });
  const meta = (response.candidates?.[0] as { urlContextMetadata?: { urlMetadata?: { retrievedUrl?: string; urlRetrievalStatus?: string }[] } } | undefined)?.urlContextMetadata?.urlMetadata ?? [];
  const loaded = new Set(meta.filter((m) => m.urlRetrievalStatus === 'URL_RETRIEVAL_STATUS_SUCCESS' && m.retrievedUrl).map((m) => key(m.retrievedUrl!)));
  const text = textOf(response);
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  let items: T[] = [];
  try {
    if (start >= 0 && end > start) items = JSON.parse(text.slice(start, end + 1)) as T[];
  } catch {
    // An unparseable answer is treated as no answer.
  }
  log.info('live', `Read ${loaded.size} of ${urls.length} pages`, {
    hosts: [...new Set(urls.map((u) => new URL(u).hostname))],
    // Kept so a lookup that reads nothing can be explained afterwards.
    statuses: meta.map((m) => `${(m.urlRetrievalStatus ?? '').replace('URL_RETRIEVAL_STATUS_', '')} ${m.retrievedUrl ?? ''}`).slice(0, 20),
    answered: items.length,
    ms: Math.round(performance.now() - started),
  });
  return { items: Array.isArray(items) ? items : [], loaded };
}

// ---- Where a film or series can be watched -------------------------------------------------

/** JustWatch lists, per country, who streams, rents and sells a title, with prices. */
const JUSTWATCH_COUNTRY: Record<Currency, string> = { INR: 'in', USD: 'us', GBP: 'uk', EUR: 'de' };
const slug = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export interface TitleOffer {
  provider: string;
  kind: 'stream' | 'rent' | 'buy';
  price?: number;
  currency?: string;
  quality?: string;
}

export interface TitleAvailability {
  title: string;
  /** False when no page for the title could be read: availability is then unknown, not "nowhere". */
  found: boolean;
  url?: string;
  offers: TitleOffer[];
}

interface RawTitle {
  url?: string;
  is_about_title?: boolean;
  title?: string;
  offers?: { provider?: string; kind?: string; price?: number | string | null; currency?: string | null; quality?: string | null }[];
}

/** Where each title can be streamed, rented or bought in the user's country, read from JustWatch. */
export async function titleAvailability(titles: string[], currency: Currency): Promise<TitleAvailability[]> {
  const wanted = [...new Set(titles.map((t) => t.trim()).filter(Boolean))].slice(0, 6);
  if (wanted.length === 0) return [];
  const country = JUSTWATCH_COUNTRY[currency];
  const cacheId = (title: string) => `title:${country}:${slug(title)}`;
  const known = new Map(wanted.map((title) => [title, cached<TitleAvailability>(cacheId(title))] as const).filter((entry): entry is [string, TitleAvailability] => entry[1] !== undefined));
  // Read each title's page directly. The model is asked only about titles that could not be read that way.
  for (const title of wanted.filter((t) => !known.has(t))) {
    const direct = await scrapeTitle(title, currency);
    if (!direct) continue;
    const result: TitleAvailability = { title: direct.title, found: true, url: direct.url, offers: direct.offers };
    remember(cacheId(title), result);
    known.set(title, result);
  }
  const missing = wanted.filter((title) => !known.has(title));
  if (missing.length === 0 || !llmAvailable()) return wanted.map((title) => known.get(title) ?? { title, found: false, offers: [] });
  // The address of a title's page is its name; whether it is a film or a series is not known in advance, so both are tried.
  const candidates = missing.flatMap((title) => ['movie', 'tv-show'].map((type) => ({ title, url: `https://www.justwatch.com/${country}/${type}/${slug(title)}` })));
  // The model is only a second attempt: if it is unavailable, what was read directly still stands.
  const { items, loaded } = await (async () => {
    try {
      return await readPages<RawTitle>(
    candidates.map((c) => c.url),
    `Each page below may be the JustWatch page for one of these titles: ${missing.map((t) => `"${t}"`).join(', ')}. For every page that loaded, return {"url": the page address, "is_about_title": true only if the page is about that film or series, "title": the title as the page names it, "offers": [{"provider": string, "kind": "stream" | "rent" | "buy", "price": number or null, "currency": ISO code or null, "quality": "SD" | "HD" | "4K" or null}]}. "stream" means included in a subscription; for those the price is the subscription's monthly price if shown. List each provider once per kind, at its cheapest price.`,
  );
    } catch (error) {
      log.warn('live', 'Model lookup of titles failed', { error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
      return { items: [] as RawTitle[], loaded: new Set<string>() };
    }
  })();


  return wanted.map((title) => {
    if (known.has(title)) return known.get(title)!;
    const pages = candidates.filter((c) => c.title === title);
    const hit = items.find((item) => item.url && item.is_about_title && loaded.has(key(item.url)) && pages.some((p) => key(p.url) === key(item.url!)));
    if (!hit) return { title, found: false, offers: [] };
    const offers: TitleOffer[] = [];
    for (const offer of hit.offers ?? []) {
      const kind = offer.kind === 'stream' || offer.kind === 'rent' || offer.kind === 'buy' ? offer.kind : null;
      const provider = String(offer.provider ?? '').trim().slice(0, 60);
      const price = Number(offer.price);
      if (!kind || !provider) continue;
      offers.push({ provider, kind, ...(price > 0 && price < 1_000_000 && { price, currency: String(offer.currency ?? currency).toUpperCase().slice(0, 3) }), ...(offer.quality && { quality: String(offer.quality).slice(0, 4) }) });
    }
    const result: TitleAvailability = { title: String(hit.title ?? title).slice(0, 120), found: true, url: hit.url, offers: offers.slice(0, 24) };
    remember(cacheId(title), result);
    return result;
  });
}

// ---- Official price pages ------------------------------------------------------------------

/**
 * The public page where a provider lists its consumer plans. Only pages that were seen to load
 * through the URL reader are listed; a provider that is not here has no live price reading.
 */
export const PRICING_PAGES: Record<string, string> = {
  'google-one': 'https://one.google.com/about/plans',
  'icloud-plus': 'https://support.apple.com/en-in/108047',
  dropbox: 'https://www.dropbox.com/plans',
  onedrive: 'https://www.microsoft.com/en-in/microsoft-365/onedrive/compare-onedrive-plans',
  pcloud: 'https://www.pcloud.com/cloud-storage-pricing-plans.html',
  mega: 'https://mega.io/pricing',
  claude: 'https://claude.com/pricing',
  'perplexity-pro': 'https://www.perplexity.ai/pro',
  'google-ai-gemini': 'https://gemini.google/subscriptions/',
};

export interface LivePricing {
  providerId: string;
  url: string;
  plans: (LivePlan & { features?: string })[];
}

interface RawPricing {
  url?: string;
  plans?: { name?: string; price?: number | string; currency?: string; cycle?: string; features?: string }[];
}

const CURRENCIES: Currency[] = ['USD', 'INR', 'EUR', 'GBP'];
const CYCLES: BillingCycle[] = ['monthly', 'quarterly', 'yearly'];
const REGION_NAME: Record<Currency, string> = { INR: 'India', USD: 'the United States', EUR: 'Germany', GBP: 'the United Kingdom' };

/** Reads the official price page of each provider that has one. Providers whose page did not load are left out. */
export async function livePricing(providerIds: string[], currency: Currency): Promise<LivePricing[]> {
  const all = [...new Set(providerIds)].filter((id) => PRICING_PAGES[id] || canScrapePrices(id, currency)).slice(0, 10);
  const priceId = (id: string) => `prices:${currency}:${id}`;
  const results: LivePricing[] = all.map((id) => cached<LivePricing>(priceId(id))).filter((hit): hit is LivePricing => hit !== undefined);
  // Price pages with a parser are read directly. The model reads only the pages that have none.
  for (const id of all.filter((id) => !results.some((r) => r.providerId === id) && canScrapePrices(id, currency))) {
    const direct = await scrapePrices(id, currency);
    if (!direct) continue;
    const result: LivePricing = { providerId: id, url: direct.url, plans: direct.plans };
    remember(priceId(id), result);
    results.push(result);
  }
  const pages = all.filter((id) => !results.some((r) => r.providerId === id) && PRICING_PAGES[id]).map((id) => ({ id, url: PRICING_PAGES[id] }));
  if (pages.length === 0 || !llmAvailable()) return results;
  const { items, loaded } = await (async () => {
    try {
      return await readPages<RawPricing>(
    pages.map((p) => p.url),
    `For every page that loaded, list the paid plans it sells to individual consumers as {"url": the page address, "plans": [{"name": string, "price": number, "currency": "INR" | "USD" | "EUR" | "GBP", "cycle": "monthly" | "quarterly" | "yearly", "features": the main thing the plan gives in a few words, such as the storage size or usage limits}]}. Prefer the price for ${REGION_NAME[currency]} in ${currency} when the page shows it; otherwise report the currency the page shows. Never convert currencies. Skip free, business and enterprise plans.`,
  );
    } catch (error) {
      log.warn('live', 'Model reading of price pages failed', { error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
      return { items: [] as RawPricing[], loaded: new Set<string>() };
    }
  })();

  for (const page of pages) {
    const hit = items.find((item) => item.url && key(item.url) === key(page.url));
    // A redirect changes the address, so a loaded page on the same site also counts.
    const reallyLoaded = loaded.has(key(page.url)) || [...loaded].some((l) => l.split('/')[0] === key(page.url).split('/')[0]);
    if (!hit || !reallyLoaded) continue;
    const plans: LivePricing['plans'] = [];
    for (const plan of hit.plans ?? []) {
      const name = String(plan.name ?? '').trim().slice(0, 60);
      const price = Number(plan.price);
      const planCurrency = String(plan.currency ?? '').toUpperCase() as Currency;
      const cycle = String(plan.cycle ?? 'monthly').toLowerCase() as BillingCycle;
      if (!name || !(price > 0 && price < 10_000_000) || !CURRENCIES.includes(planCurrency) || !CYCLES.includes(cycle)) continue;
      plans.push({ name, price: Math.round(price * 100) / 100, currency: planCurrency, cycle, ...(plan.features && { features: String(plan.features).slice(0, 120) }) });
    }
    if (plans.length === 0) continue;
    const result: LivePricing = { providerId: page.id, url: page.url, plans: plans.slice(0, 12) };
    remember(priceId(page.id), result);
    results.push(result);
  }
  return results;
}
