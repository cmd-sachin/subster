// Tier 3 of classification: ask Gemini about names that neither the catalog nor the keyword
// rules could place. Runs only when a Gemini key is configured, never overrides a category the
// user set, and is skipped silently otherwise (the rules result stands).

import { CATEGORIES } from '@/domain/catalog';
import type { Category } from '@/domain/types';
import { describeLlmError, generate, llmAvailable, textOf } from '@/server/llm';
import { log } from '@/server/logger';
import { db } from '@/server/store';

/** Reclassifies subscriptions the rules left as "Other". Returns how many changed. */
export async function classifyUnknownWithAi(): Promise<number> {
  if (!llmAvailable()) return 0;
  const data = db();
  const unknown = data.subscriptions.filter((s) => s.classifiedBy === 'rules' && s.category === 'Other');
  if (unknown.length === 0) return 0;

  try {
    const response = await generate({
      contents: JSON.stringify(unknown.map((s) => s.name)),
      config: {
        systemInstruction: `You classify recurring payments into subscription categories. Categories: ${CATEGORIES.join(', ')}. "Productivity" means software and online tools. Use "Other" only when the name gives no real evidence. Reply with one JSON object mapping each given name to a category, and nothing else.`,
        responseMimeType: 'application/json',
      },
    });
    const text = textOf(response);
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, string>;
    let changed = 0;
    for (const sub of unknown) {
      const category = parsed[sub.name] as Category | undefined;
      if (!category || !CATEGORIES.includes(category) || category === 'Other') continue;
      sub.category = category;
      sub.classifiedBy = 'ai';
      changed++;
    }
    log.info('classification', `Gemini classified ${changed} of ${unknown.length} unknown subscriptions`, { result: parsed });
    return changed;
  } catch (error) {
    log.warn('classification', 'AI classification failed; keeping the rules result', { error: describeLlmError(error) });
    return 0;
  }
}
