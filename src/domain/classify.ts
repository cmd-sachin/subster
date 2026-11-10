// Category classification for a merchant or app name. Three tiers, cheapest first:
//   1. catalog: a known provider, so the category is a fact;
//   2. rules: keyword evidence in the name or statement text;
//   3. ai: Gemini, for names the first two cannot place (server/services/classifier.ts).
// The user can always override the result, and an override is never reclassified.

import { findProvider } from './catalog';
import type { Category, Classifier } from './types';

export interface Classification {
  category: Category;
  by: Classifier;
  /** 0 to 1. Rules that match a strong keyword score higher than a weak hint. */
  confidence: number;
}

const RULES: { category: Category; strong: RegExp; weak?: RegExp }[] = [
  { category: 'Broadband', strong: /broadband|fib(er|re)net|\bfib(er|re)\b|\bisp\b|internet service|wi-?fi plan/i },
  { category: 'Telecom', strong: /recharge|prepaid|postpaid|mobile plan|telecom|wireless|\bsim\b/i, weak: /mobile|cellular/i },
  { category: 'AI', strong: /\bgpt\b|\bllm\b|copilot|\bai\b.*(pro|plus|premium)|artificial intelligence/i, weak: /\bai\b/i },
  { category: 'Streaming', strong: /stream|\bott\b|\btv\b|video on demand|cinema|movies|flix/i, weak: /video|play|watch|entertainment/i },
  { category: 'Music', strong: /music|podcast|radio|\bfm\b|audio stream/i, weak: /audio|tunes/i },
  { category: 'Gaming', strong: /gaming|game pass|\bgames?\b|esports|arcade/i },
  { category: 'Storage', strong: /cloud storage|\bstorage\b|backup|\bdrive\b|\b\d+\s?(gb|tb)\b/i, weak: /cloud/i },
  { category: 'Wellness', strong: /\bgym\b|fitness|yoga|meditat|wellness|workout|pilates|health club/i, weak: /health|\bfit\b/i },
  { category: 'Learning', strong: /course|academy|learning|tutor|education|\bclass(es)?\b|university|audiobook/i, weak: /learn|study/i },
  { category: 'News', strong: /\bnews\b|newspaper|magazine|journal|\btimes\b|gazette|\bpost\b|herald|tribune/i, weak: /daily|weekly|digest/i },
  { category: 'Developer', strong: /hosting|\bdomains?\b|cloud platform|developer|\bapi\b|devops/i },
  { category: 'Membership', strong: /membership|loyalty|\bclub\b/i },
  { category: 'Productivity', strong: /software|\bsaas\b|\bvpn\b|antivirus|workspace|\boffice\b|password manager|design tool/i, weak: /\bpro\b|suite|\bapp\b|tools?/i },
];

export function classify(text: string): Classification {
  const provider = findProvider(text);
  if (provider) return { category: provider.category, by: 'catalog', confidence: 1 };
  for (const rule of RULES) if (rule.strong.test(text)) return { category: rule.category, by: 'rules', confidence: 0.8 };
  for (const rule of RULES) if (rule.weak?.test(text)) return { category: rule.category, by: 'rules', confidence: 0.45 };
  return { category: 'Other', by: 'rules', confidence: 0 };
}
