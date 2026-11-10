// The one module that talks to the language model: Google's Gemini API through @google/genai.
// Everything else (agent loop, classifier, plan monitor, Studio assistant) goes through here, so
// the provider and model are decided in one place.
//
// Key: GEMINI_API_KEY (or GOOGLE_API_KEY). Model: GEMINI_MODEL, default below.

import './env';
import { ApiError, GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import { log } from './logger';

const DEFAULT_MODEL = 'gemini-3.8-flash';
/** Tried in order when the chosen model is overloaded, rate limited or too slow. Stable models. */
const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'];
const ATTEMPT_TIMEOUT_MS = 45_000;

const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

export const llmAvailable = () => Boolean(apiKey());
export const llmModel = () => process.env.GEMINI_MODEL || DEFAULT_MODEL;

let client: GoogleGenAI | undefined;
let clientKey: string | undefined;

export function gemini() {
  // Rebuilt if the key changes, so editing .env.local does not need a restart.
  if (!client || clientKey !== apiKey()) {
    clientKey = apiKey();
    // The SDK's own retries (five by default) are off: an overloaded model is handled below by
    // moving to the next model, which answers in seconds instead of hanging for minutes.
    client = new GoogleGenAI({ apiKey: clientKey, httpOptions: { retryOptions: { attempts: 1 } } });
  }
  return client;
}

/** A message a user can act on, from whatever the SDK threw. */
export function describeLlmError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 400 && /api key/i.test(error.message)) return 'The Gemini API key was rejected. Check GEMINI_API_KEY in .env.local.';
    if (error.status === 401 || error.status === 403) return 'The Gemini API key was rejected. Check GEMINI_API_KEY in .env.local.';
    if (error.status === 404) return `The Gemini model "${llmModel()}" is not available to this key. Set GEMINI_MODEL in .env.local.`;
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

/**
 * One model call with a time limit and model fallback. Newer Gemini models are regularly
 * "experiencing high demand" (503); rather than fail or hang, the same request is sent to the
 * next model in the list. Errors that are the request's own fault are thrown straight away.
 */
export async function generate(request: GenerateRequest): Promise<GenerateContentResponse> {
  const models = [...new Set([llmModel(), ...FALLBACK_MODELS])];
  let lastError: unknown;
  for (const model of models) {
    const started = performance.now();
    const timeout = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
    const caller = request.config?.abortSignal;
    try {
      const response = await gemini().models.generateContent({ ...request, model, config: { ...request.config, abortSignal: caller ? AbortSignal.any([caller, timeout]) : timeout } });
      if (model !== models[0]) log.info('llm', `Answered by fallback model ${model}`, { ms: Math.round(performance.now() - started) });
      return response;
    } catch (error) {
      lastError = error;
      if (caller?.aborted || !isTransient(error)) throw error;
      log.warn('llm', `${model} unavailable, trying the next model`, { status: error instanceof ApiError ? error.status : 'timeout', ms: Math.round(performance.now() - started) });
    }
  }
  throw lastError;
}
