// The one module that talks to the language model: Google's Gemini API through @google/genai.
// Everything else (agent loop, classifier, plan monitor, Studio assistant) goes through here, so
// the provider and model are decided in one place.
//
// Keys: GEMINI_API_KEYS (several, comma-separated) or GEMINI_API_KEY. Model: GEMINI_MODEL, default below.

import './env';
import { ApiError, GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import { log } from './logger';

const DEFAULT_MODEL = 'gemini-3.8-flash';
/** Tried in order when the chosen model is overloaded, rate limited or too slow. Stable models. */
const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'];
const ATTEMPT_TIMEOUT_MS = 45_000;

/**
 * The keys to use, in order. GEMINI_API_KEYS takes several, separated by commas, for a team whose
 * members each have their own free key; GEMINI_API_KEY (or GOOGLE_API_KEY) is the single-key form.
 * Daily allowances are counted per Google project, so keys from the same project do not add up.
 */
const apiKeys = () => [...new Set([...(process.env.GEMINI_API_KEYS ?? '').split(','), process.env.GEMINI_API_KEY ?? '', process.env.GOOGLE_API_KEY ?? ''].map((k) => k.trim()).filter(Boolean))];

export const llmAvailable = () => apiKeys().length > 0;
export const llmModel = () => process.env.GEMINI_MODEL || DEFAULT_MODEL;

const clients = new Map<string, GoogleGenAI>();

function gemini(key: string) {
  let client = clients.get(key);
  if (!client) {
    // The SDK's own retries (five by default) are off: an overloaded model is handled below by
    // moving to the next model or key, which answers in seconds instead of hanging for minutes.
    client = new GoogleGenAI({ apiKey: key, httpOptions: { retryOptions: { attempts: 1 } } });
    clients.set(key, client);
  }
  return client;
}

/** A message a user can act on, from whatever the SDK threw. */
export function describeLlmError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 400 && /api key/i.test(error.message)) return 'The Gemini API key was rejected. Check GEMINI_API_KEY in .env.local.';
    if (error.status === 401 || error.status === 403) return 'The Gemini API key was rejected. Check GEMINI_API_KEY in .env.local.';
    if (error.status === 404) return `The Gemini model "${llmModel()}" is not available to this key. Set GEMINI_MODEL in .env.local.`;
    if (error.status === 429 && /PerDay/i.test(error.message)) return 'Gemini\'s free daily allowance is used up on every key and model (about 20 requests a day each). It resets within a day. Adding another key to GEMINI_API_KEYS in .env.local gives more.';
    if (error.status === 429) return 'The Gemini API is rate limiting requests (free-tier quotas are low). Try again in a moment.';
    if (error.status === 503) return 'Gemini is overloaded right now on every model that was tried. Try again in a moment.';
    return `Gemini API error ${error.status}: ${error.message.slice(0, 300)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The visible text of a response: text parts that are not the model's private reasoning. */
export function textOf(response: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }) {
  return (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join('')
    .trim();
}

type GenerateRequest = Omit<GenerateContentParameters, 'model'>;

/** Whether an error means "this model cannot answer right now" rather than "this request is wrong". */
function isTransient(error: unknown) {
  if (error instanceof ApiError) return error.status === 429 || error.status >= 500;
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError' || /aborted|timed? ?out|fetch failed/i.test(error.message));
}

// The free tier allows about 20 requests a day per model, per key. Requests are counted, and a
// key and model that report their daily allowance used up are skipped until the time they say it
// resets, instead of being asked (and refused) on every call.
const FREE_TIER_DAILY = 20;
const meter = globalThis as unknown as { __substerLlm?: { day: string; sent: Record<string, number>; exhaustedUntil: Record<string, number> } };
function usage() {
  // Google's daily quotas reset at midnight Pacific time.
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  if (meter.__substerLlm?.day !== day) meter.__substerLlm = { day, sent: {}, exhaustedUntil: meter.__substerLlm?.exhaustedUntil ?? {} };
  return meter.__substerLlm;
}
const slot = (keyIndex: number, model: string) => `${keyIndex}:${model}`;

/** Today's request counts and what is left, for the Connections page. No key material is included. */
export function llmUsage() {
  const state = usage();
  const keys = apiKeys();
  const models = [...new Set([llmModel(), ...FALLBACK_MODELS])];
  const slots = keys.flatMap((_key, index) => models.map((model) => slot(index, model)));
  const resets = slots.map((id) => state.exhaustedUntil[id] ?? 0);
  return {
    keys: keys.length,
    models: models.length,
    sentToday: slots.reduce((total, id) => total + (state.sent[id] ?? 0), 0),
    dailyAllowance: slots.length * FREE_TIER_DAILY,
    exhausted: slots.filter((id) => (state.exhaustedUntil[id] ?? 0) > Date.now()).length,
    slots: slots.length,
    /** When the first exhausted key and model becomes usable again, if everything is used up. */
    availableAgainAt: slots.length > 0 && resets.every((at) => at > Date.now()) ? new Date(Math.min(...resets)).toISOString() : undefined,
  };
}

/**
 * One model call with a time limit, falling back across models and keys. Newer Gemini models are
 * regularly "experiencing high demand" (503), and free keys run out for the day (429); rather
 * than fail or hang, the same request goes to the next model, then the next key. Errors that are
 * the request's own fault are thrown straight away.
 */
export async function generate(request: GenerateRequest): Promise<GenerateContentResponse> {
  const models = [...new Set([llmModel(), ...FALLBACK_MODELS])];
  const keys = apiKeys();
  const state = usage();
  let lastError: unknown;
  for (const [keyIndex, key] of keys.entries()) {
    for (const model of models) {
      const id = slot(keyIndex, model);
      if ((state.exhaustedUntil[id] ?? 0) > Date.now()) {
        lastError ??= new ApiError({ status: 429, message: 'GenerateRequestsPerDay: daily allowance used up' });
        continue;
      }
      state.sent[id] = (state.sent[id] ?? 0) + 1;
      const started = performance.now();
      const timeout = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
      const caller = request.config?.abortSignal;
      try {
        const response = await gemini(key).models.generateContent({ ...request, model, config: { ...request.config, abortSignal: caller ? AbortSignal.any([caller, timeout]) : timeout } });
        if (keyIndex > 0 || model !== models[0]) log.info('llm', `Answered by ${model}${keys.length > 1 ? ` on key ${keyIndex + 1} of ${keys.length}` : ''}`, { ms: Math.round(performance.now() - started) });
        return response;
      } catch (error) {
        lastError = error;
        if (error instanceof ApiError && error.status === 429 && /PerDay/i.test(error.message)) {
          const seconds = Number(/retryDelay"?:\s*"?(\d+)/.exec(error.message)?.[1] ?? 3600);
          state.exhaustedUntil[id] = Date.now() + seconds * 1000;
        }
        // A rejected key is that key's problem: the next one may be fine.
        const badKey = error instanceof ApiError && (error.status === 401 || error.status === 403 || (error.status === 400 && /api key/i.test(error.message)));
        if (caller?.aborted || !(isTransient(error) || (badKey && keyIndex < keys.length - 1))) throw error;
        log.warn('llm', `${model} unavailable${keys.length > 1 ? ` on key ${keyIndex + 1}` : ''}, trying the next`, { status: error instanceof ApiError ? error.status : 'timeout', ms: Math.round(performance.now() - started) });
        if (badKey) break;
      }
    }
  }
  throw lastError;
}
