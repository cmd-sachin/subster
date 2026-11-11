// Reading providers' public pages directly, with no language model in between.
//
// Two things are read this way:
//   - official price pages, to keep each service's plans current and notice price changes;
//   - JustWatch title pages, to see who streams, rents or sells a film or series, and for how much.
//
// Rules this module keeps to. It identifies itself honestly and never pretends to be a browser.
// It obeys robots.txt. It asks a host at most once every few seconds and keeps every page for a
// day. It only reads pages anyone can open without signing in. If a site refuses or changes its
// layout, the answer is "could not be read", never a guess: a parser returns only what it found
// next to a plan's own name, in the currency that page is expected to show.

import type { BillingCycle, Currency } from '@/domain/types';
import { log } from '@/server/logger';

const USER_AGENT = 'SubsterPriceCheck/0.1 (personal subscription price monitor)';
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 4_000_000;
const HOST_GAP_MS = 2_500;
const KEEP_MS = 24 * 60 * 60 * 1000;

const memory = globalThis as unknown as { __substerScrape?: { lastHit: Record<string, number>; robots: Record<string, { at: number; rules: { allow: boolean; pattern: string }[] }>; pages?: Map<string, { at: number; html: string }> } };
const state = (memory.__substerScrape ??= { lastHit: {}, robots: {} });
// Fetched pages are kept in memory only, and only a few: a page is about a megabyte, far too big
// for the data file. What is worth keeping across restarts is the parsed result, which is small.
const pages = (state.pages ??= new Map<string, { at: number; html: string }>());
const MAX_PAGES = 12;

async function get(url: string, language: string): Promise<string | null> {
  const host = new URL(url).hostname;
  const wait = (state.lastHit[host] ?? 0) + HOST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  state.lastHit[host] = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain', 'Accept-Language': language }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = await res.text();
    return body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
  } catch {
    return null;
  }
}

type RobotsRule = { allow: boolean; pattern: string };

/** Pure: the rules a robots.txt gives a general client (the "*" group, or one that names this client). */
export function robotsRules(text: string): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: (typeof groups)[number] | undefined;
  let lastWasAgent = false;
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0].trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group of rules.
      if (!lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current!.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      if (value) current.rules.push({ allow: field === 'allow', pattern: value });
      lastWasAgent = false;
    }
  }
  const own = groups.filter((g) => g.agents.some((a) => a.includes('substerpricecheck')));
  return (own.length > 0 ? own : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
}

/** Pure: whether those rules let the path be read. The longest matching rule decides; a tie goes to Allow. */
export function robotsAllow(rules: RobotsRule[], path: string): boolean {
  let best: RobotsRule | undefined;
  for (const rule of rules) {
    // "*" matches any run of characters and a trailing "$" anchors the end; everything else is literal.
    const source = rule.pattern.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\$$/, '$').replace(/\$(?!$)/g, '\\$');
    if (!new RegExp(`^${source}`).test(path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

/** Whether robots.txt lets this client read the page. A robots.txt that cannot be fetched counts as no rules. */
async function allowed(url: string): Promise<boolean> {
  const { hostname, origin, pathname, search } = new URL(url);
  let entry = state.robots[hostname];
  if (!entry?.rules || Date.now() - entry.at > KEEP_MS) entry = state.robots[hostname] = { at: Date.now(), rules: robotsRules((await get(`${origin}/robots.txt`, 'en')) ?? '') };
  return robotsAllow(entry.rules, pathname + search);
}

const LANGUAGE: Record<Currency, string> = { INR: 'en-IN,en;q=0.9', USD: 'en-US,en;q=0.9', GBP: 'en-GB,en;q=0.9', EUR: 'de-DE,en;q=0.8' };

/** A public page's HTML, from memory if read recently, otherwise fetched politely. Null when it may not or could not be read. */
async function page(url: string, currency: Currency): Promise<string | null> {
  const id = `${currency}:${url}`;
  const hit = pages.get(id);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.html;
  if (!(await allowed(url))) {
    log.info('scrape', 'Skipped: robots.txt disallows this page', { url });
    return null;
  }
  const started = performance.now();
  const html = await get(url, LANGUAGE[currency]);
  log[html ? 'info' : 'warn']('scrape', html ? 'Page read' : 'Page could not be read', { url, bytes: html?.length ?? 0, ms: Math.round(performance.now() - started) });
  if (html) {
    pages.set(id, { at: Date.now(), html });
    // Oldest out first.
    while (pages.size > MAX_PAGES) pages.delete(pages.keys().next().value!);
  }
  return html;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#8377': '₹', '#x20b9': '₹', '#163': '£', '#8364': '€', euro: '€', pound: '£' };
/** The text a reader would see, on one line. */
export function visibleText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?[a-z0-9]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/\s+/g, ' ');
}

// ---- Official price pages ------------------------------------------------------------------

const PRICE: Record<Currency, RegExp> = {
  INR: /(?:₹|\bRs\.?)\s*(\d[\d,]*(?:\.\d+)?)/,
  USD: /(?<![A-Z])\$\s*(\d[\d,]*(?:\.\d+)?)/,
  GBP: /£\s*(\d[\d,]*(?:\.\d+)?)/,
  EUR: /(?:€\s*(\d[\d.,]*)|(\d[\d.,]*)\s*€)/,
};

function amount(match: RegExpExecArray | null): number | null {
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return null;
  const value = Number(raw.replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return value > 0 && value < 10_000_000 ? value : null;
}

interface PlanRule {
  name: string;
  cycle?: BillingCycle;
  /** Where the plan is named on the page. Its price is the first amount, in the page's currency, soon after. */
  after: RegExp;
  /** How far after the name to look, in characters. */
  within?: number;
  /** A stricter price pattern, for a card that shows an introductory offer before the real price. Group 1 is the amount. */
  price?: RegExp;
  /** For a row of prices: which amount after the name is this plan's, counting from 0. */
  nth?: number;
  features?: string;
}

interface PriceSource {
  url: string;
  /** Search the page source instead of its visible text, for pages that draw their prices with script. */
  raw?: boolean;
  plans: PlanRule[];
}

const ICLOUD = (row: RegExp): PlanRule[] => [
  { name: '50 GB', after: row, nth: 0, features: '50 GB' },
  { name: '200 GB', after: row, nth: 1, features: '200 GB' },
  { name: '2 TB', after: row, nth: 2, features: '2 TB' },
  { name: '6 TB', after: row, nth: 3, features: '6 TB' },
  { name: '12 TB', after: row, nth: 4, features: '12 TB' },
];

/**
 * Where each provider publishes its consumer prices, by the user's currency, and how to find each
 * plan there. Every entry was written against the live page. A provider or region that is not
 * here is simply not read this way.
 */
const SOURCES: Record<string, Partial<Record<Currency, PriceSource>>> = {
  netflix: {
    INR: {
      url: 'https://help.netflix.com/en/node/24926/in',
      plans: [
        { name: 'Mobile', after: /Pricing \(Indian Rupee\)[^₹]*?Mobile\s*:/, within: 30 },
        { name: 'Basic', after: /\bBasic\s*:/, within: 30 },
        { name: 'Standard', after: /\bStandard\s*:/, within: 30 },
        { name: 'Premium 4K', after: /\bPremium\s*:/, within: 30 },
      ],
    },
  },
  spotify: {
    INR: {
      url: 'https://www.spotify.com/in-en/premium/',
      raw: true,
      plans: [
        // A card can lead with an introductory offer, so the price taken is the one quoted per month.
        { name: 'Premium Standard', after: /data-encore-id="type">Standard<\/h3>/, within: 400, price: /₹\s*(\d[\d,]*)\s*\/\s*month/ },
        { name: 'Premium Platinum', after: /data-encore-id="type">Platinum<\/h3>/, within: 400, price: /₹\s*(\d[\d,]*)\s*\/\s*month/ },
        { name: 'Premium Student', after: /data-encore-id="type">Student<\/h3>/, within: 400, price: /₹\s*(\d[\d,]*)\s*\/\s*month/ },
      ],
    },
  },
  'youtube-premium': {
    INR: {
      url: 'https://www.youtube.com/premium',
      raw: true,
      plans: [
        // "Individual" also appears under Premium Lite, so it is taken from the Premium section.
        { name: 'Individual', after: /\{"text":"Premium"\}\]\},"optionItems":\[\{"optionItemRenderer":\{"title":\{"runs":\[\{"text":"Individual"\}\]\},"subtitle"[\s\S]{0,200}?Then "\},\{"text":"/, within: 20 },
        { name: 'Family', after: /"title":\{"runs":\[\{"text":"Family"\}\]\},"subtitle"[\s\S]{0,200}?Then "\},\{"text":"/, within: 20 },
        { name: 'Student', after: /"title":\{"runs":\[\{"text":"Student"\}\]\},"subtitle"[\s\S]{0,200}?Then "\},\{"text":"/, within: 20 },
      ],
    },
  },
  'apple-music': {
    INR: {
      url: 'https://www.apple.com/in/apple-music/',
      plans: [
        { name: 'Student', after: /Student Plan at/, within: 20 },
        { name: 'Individual', after: /individual monthly subscription is just/, within: 20 },
        { name: 'Family', after: /Family Plan,[^₹]{0,120}is just/, within: 20 },
      ],
    },
  },
  'google-one': {
    INR: {
      url: 'https://one.google.com/about/plans',
      plans: [
        { name: 'Lite (30 GB)', after: /Lite \(30 GB\)/, within: 20, features: '30 GB' },
        { name: 'Basic (100 GB)', after: /Basic \(100 GB\)/, within: 20, features: '100 GB' },
      ],
    },
  },
  'google-ai-gemini': {
    INR: { url: 'https://one.google.com/about/plans', plans: [{ name: 'AI Pro', after: /Google AI Pro \(\d+ TB\)/, within: 20 }] },
  },
  'icloud-plus': {
    INR: { url: 'https://support.apple.com/en-in/108047', plans: ICLOUD(/India\S* \(INR\)/) },
    USD: { url: 'https://support.apple.com/en-us/108047', plans: ICLOUD(/United States\S* \(USD\)/) },
    GBP: { url: 'https://support.apple.com/en-gb/108047', plans: ICLOUD(/United Kingdom\S* \(GBP\)/) },
  },
  claude: {
    USD: {
      url: 'https://claude.com/pricing',
      plans: [
        { name: 'Pro', after: /\bPro For everyday work[^$]*\$\d+[^$]*\$\d+ billed up front\)\./, within: 12 },
        { name: 'Pro (annual)', cycle: 'yearly', after: /annual subscription discount \(/, within: 12 },
        { name: 'Max', after: /\bMax For all-day work/, within: 12 },
        { name: 'Ultra', after: /\bUltra For your longest tasks/, within: 12 },
      ],
    },
  },
  dropbox: {
    USD: { url: 'https://www.dropbox.com/plans', plans: [{ name: 'Plus', after: /professionals Plus Basic Extra/, within: 12, features: '2 TB' }] },
  },
};

export const scrapedProviders = () => Object.keys(SOURCES);
/** Whether the provider publishes a price page for this very region, rather than only a US one. */
export const hasRegionalPage = (providerId: string, currency: Currency) => Boolean(SOURCES[providerId]?.[currency]);
export const canScrapePrices = (providerId: string, currency: Currency) => Boolean(SOURCES[providerId]?.[currency] ?? SOURCES[providerId]?.USD);

export interface ScrapedPlan {
  name: string;
  price: number;
  currency: Currency;
  cycle: BillingCycle;
  features?: string;
}

/** Pure: the plans a page lists, by the rules above. Exported for tests. */
export function plansFromPage(html: string, source: PriceSource, currency: Currency): ScrapedPlan[] {
  const text = source.raw ? html.replace(/[\u200b-\u200d\u2060\ufeff]/g, '') : visibleText(html);
  const found: ScrapedPlan[] = [];
  for (const rule of source.plans) {
    const anchor = rule.after.exec(text);
    if (!anchor) continue;
    let window = text.slice(anchor.index + anchor[0].length, anchor.index + anchor[0].length + (rule.within ?? 80) + (rule.nth ?? 0) * 14);
    let price: number | null = null;
    for (let skip = rule.nth ?? 0; skip >= 0; skip--) {
      const match = (rule.price ?? PRICE[currency]).exec(window);
      price = amount(match);
      if (!match) break;
      window = window.slice(match.index + match[0].length);
    }
    if (price !== null) found.push({ name: rule.name, price, currency, cycle: rule.cycle ?? 'monthly', ...(rule.features && { features: rule.features }) });
  }
  return found;
}

/** The provider's current plans from its own price page, or null if it has none we can read. */
export async function scrapePrices(providerId: string, currency: Currency): Promise<{ url: string; plans: ScrapedPlan[] } | null> {
  // The user's own region if the provider publishes one we know; otherwise its US page, in dollars.
  const region = SOURCES[providerId]?.[currency] ? currency : 'USD';
  const source = SOURCES[providerId]?.[region];
  if (!source) return null;
  const html = await page(source.url, region);
  if (!html) return null;
  const plans = plansFromPage(html, source, region);
  if (plans.length === 0) {
    log.warn('scrape', 'Price page read but no plan was recognised: its layout may have changed', { providerId, url: source.url });
    return null;
  }
  return { url: source.url, plans };
}

// ---- JustWatch title pages -----------------------------------------------------------------

export interface ScrapedOffer {
  provider: string;
  kind: 'stream' | 'rent' | 'buy';
  price?: number;
  currency?: string;
  quality?: string;
}

const KIND: Record<string, ScrapedOffer['kind'] | undefined> = { FLATRATE: 'stream', FLATRATE_AND_BUY: 'stream', RENT: 'rent', BUY: 'buy' };

/**
 * Pure: the title and offers in a JustWatch title page. The page carries its data as one flat
 * list in which every object's values are positions in that same list; offers point at their
 * provider through a reference into a cache object.
 */
export function offersFromJustWatch(html: string): { title: string; offers: ScrapedOffer[] } | null {
  const data = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  const named = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!data) return null;
  let list: unknown[];
  let title = '';
  try {
    list = JSON.parse(data) as unknown[];
    const graph = named ? (JSON.parse(named) as { '@graph'?: { name?: string }[]; name?: string }) : undefined;
    title = graph?.['@graph']?.[0]?.name ?? graph?.name ?? '';
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;

  const at = (index: unknown) => (typeof index === 'number' && index >= 0 && index < list.length ? list[index] : undefined);
  const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
  // The cache that references point into: one object keyed by "Package:…", "Offer:…" and so on.
  const cache: Record<string, unknown> = {};
  for (const entry of list) if (isObject(entry) && Object.keys(entry).some((k) => /^(Package|Offer|Movie|Show):/.test(k))) Object.assign(cache, entry);
  const follow = (index: unknown): unknown => {
    const value = at(index);
    if (!isObject(value) || !('__ref' in value)) return value;
    const id = at(value.__ref);
    return typeof id === 'string' ? at(cache[id]) : undefined;
  };

  // Only the page's own title counts. The page also carries offers for similar and advertised
  // titles, which must not be mistaken for this one's.
  const main = list.find((entry): entry is Record<string, unknown> => isObject(entry) && ['Movie', 'Show'].includes(String(at(entry.__typename))) && Object.keys(entry).some((k) => k.startsWith('offers(')));
  if (!main) return null;

  const best = new Map<string, ScrapedOffer>();
  for (const [field, listIndex] of Object.entries(main)) {
    // "jwt" is JustWatch's own free channel, not a provider the user could subscribe to.
    if (!field.startsWith('offers(') || field.includes('"jwt"')) continue;
    const refs = at(listIndex);
    for (const ref of Array.isArray(refs) ? refs : []) {
      const entry = follow(ref);
      if (!isObject(entry)) continue;
      const kind = KIND[String(at(entry.monetizationType))];
      const pack = follow(entry.package);
      const provider = isObject(pack) ? at(pack.clearName) : undefined;
      if (!kind || typeof provider !== 'string' || !provider) continue;
      const value = at(entry.retailPriceValue);
      const price = typeof value === 'number' && value > 0 ? value : undefined;
      const currency = at(entry.currency);
      const quality = String(at(entry.presentationType) ?? '').replace(/^_/, '');
      const offer: ScrapedOffer = { provider, kind, ...(price !== undefined && { price, currency: typeof currency === 'string' ? currency : undefined }), ...(quality && { quality }) };
      // One line per provider and kind, at its cheapest.
      const key = `${provider}|${kind}`;
      const current = best.get(key);
      if (!current || (offer.price ?? Infinity) < (current.price ?? Infinity)) best.set(key, offer);
    }
  }
  return { title, offers: [...best.values()] };
}

const JUSTWATCH_COUNTRY: Record<Currency, string> = { INR: 'in', USD: 'us', GBP: 'uk', EUR: 'de' };
export const titleSlug = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const same = (a: string, b: string) => titleSlug(a) === titleSlug(b) || titleSlug(a).startsWith(titleSlug(b)) || titleSlug(b).startsWith(titleSlug(a));

/** JustWatch's name for a catalog provider's page, where it is not simply the catalog id. */
const JUSTWATCH_PROVIDER: Record<string, string> = { 'prime-video': 'amazon-prime-video', sonyliv: 'sony-liv', 'apple-tv-plus': 'apple-tv-plus', 'disney-plus': 'disney-plus', 'lionsgate-play': 'lionsgate-play', 'sun-nxt': 'sun-nxt' };
const titlePaths = ((memory as { __substerTitlePaths?: Record<string, string> }).__substerTitlePaths ??= {});

/** Pure: the titles a JustWatch listing page shows, with each one's own page. */
export function titlesFromListing(html: string): { title: string; path: string }[] {
  const data = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!data) return [];
  let list: unknown[];
  try {
    list = JSON.parse(data) as unknown[];
  } catch {
    return [];
  }
  const at = (index: unknown) => (typeof index === 'number' && index >= 0 && index < list.length ? list[index] : undefined);
  const seen = new Set<string>();
  const titles: { title: string; path: string }[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry) || !('fullPath' in entry) || !('title' in entry)) continue;
    const title = at((entry as Record<string, unknown>).title);
    const path = at((entry as Record<string, unknown>).fullPath);
    if (typeof title !== 'string' || typeof path !== 'string' || !/^\/[a-z]{2}\/(movie|tv-show)\//.test(path) || seen.has(path)) continue;
    seen.add(path);
    titles.push({ title, path });
  }
  return titles;
}

/** What is popular on a service in the user's country right now, for the user to pick from. Empty when it cannot be read. */
export async function popularOn(providerId: string, currency: Currency): Promise<string[]> {
  const url = `https://www.justwatch.com/${JUSTWATCH_COUNTRY[currency]}/provider/${JUSTWATCH_PROVIDER[providerId] ?? providerId}`;
  const html = await page(url, currency);
  const titles = html ? titlesFromListing(html) : [];
  // A picked title's page is then known exactly, instead of being guessed from its name.
  for (const { title, path } of titles) titlePaths[`${currency}:${titleSlug(title)}`] = path;
  return titles.slice(0, 24).map((t) => t.title);
}

/** Who streams, rents and sells one title in the user's country. Null when no page for it could be read. */
export async function scrapeTitle(title: string, currency: Currency): Promise<{ title: string; url: string; offers: ScrapedOffer[] } | null> {
  const country = JUSTWATCH_COUNTRY[currency];
  const known = titlePaths[`${currency}:${titleSlug(title)}`];
  // A title picked from a listing has a known page. Otherwise its address is its name, and whether
  // it is a film or a series is not known in advance.
  const candidates = known ? [`https://www.justwatch.com${known}`] : ['movie', 'tv-show'].map((type) => `https://www.justwatch.com/${country}/${type}/${titleSlug(title)}`);
  // A film and a series can share a name. Both pages are read and the one with more places to
  // watch it is taken, which is almost always the one people mean.
  let best: { title: string; url: string; offers: ScrapedOffer[] } | null = null;
  for (const url of candidates) {
    const html = await page(url, currency);
    const parsed = html ? offersFromJustWatch(html) : null;
    if (!parsed || !parsed.title || !same(parsed.title, title)) continue;
    if (!best || parsed.offers.length > best.offers.length) best = { title: parsed.title, url, offers: parsed.offers };
  }
  return best;
}
