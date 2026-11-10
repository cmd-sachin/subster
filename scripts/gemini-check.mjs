// Quick check of the Gemini key and model from .env.local / .env. Prints no secrets.
//   node scripts/gemini-check.mjs
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { GoogleGenAI } from '@google/genai';

for (const file of ['.env.local', '.env']) {
  try {
    for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) if (value && !process.env[key]) process.env[key] = value;
  } catch {
    // optional file
  }
}

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
if (!apiKey) {
  console.log('No GEMINI_API_KEY found.');
  process.exit(1);
}
console.log(`key length ${apiKey.length} | model ${model}`);
const ai = new GoogleGenAI({ apiKey });

async function attempt(label, request) {
  const started = Date.now();
  try {
    const response = await ai.models.generateContent({ ...request, config: { ...request.config, abortSignal: AbortSignal.timeout(45_000) } });
    const calls = response.functionCalls?.map((c) => c.name).join(', ');
    console.log(`${label}: OK in ${Date.now() - started} ms | ${calls ? `function calls: ${calls}` : `text: ${(response.text ?? '').trim().slice(0, 80)}`}`);
  } catch (error) {
    console.log(`${label}: FAILED in ${Date.now() - started} ms | status ${error.status ?? 'n/a'} | ${String(error.message ?? error).slice(0, 300)}`);
  }
}

await attempt('plain text', { model, contents: 'Reply with the single word: ready' });
await attempt('function calling', {
  model,
  contents: 'List my subscriptions.',
  config: { tools: [{ functionDeclarations: [{ name: 'list_subscriptions', description: 'Lists the user subscriptions.', parametersJsonSchema: { type: 'object', properties: {}, additionalProperties: false } }] }] },
});
