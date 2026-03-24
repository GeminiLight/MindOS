import type { EchoSegment } from '@/lib/echo-segments';

export function buildEchoInsightUserPrompt(opts: {
  locale: 'en' | 'zh';
  segment: EchoSegment;
  segmentTitle: string;
  factsHeading: string;
  emptyTitle: string;
  emptyBody: string;
  continuedDrafts: string;
  continuedTodos: string;
  subEmptyHint: string;
  dailyLineLabel: string;
  dailyLine: string;
  growthIntentLabel: string;
  growthIntent: string;
}): string {
  const lang = opts.locale === 'zh' ? 'Chinese' : 'English';
  const lines: string[] = [
    `Echo section: ${opts.segmentTitle}`,
    `${opts.factsHeading}: ${opts.emptyTitle}`,
    opts.emptyBody,
  ];

  if (opts.segment === 'continued') {
    lines.push(`${opts.continuedDrafts} — ${opts.subEmptyHint}`, `${opts.continuedTodos} — ${opts.subEmptyHint}`);
  }
  if (opts.segment === 'daily' && opts.dailyLine.trim()) {
    lines.push(`${opts.dailyLineLabel}: ${opts.dailyLine.trim()}`);
  }
  if (opts.segment === 'growth' && opts.growthIntent.trim()) {
    lines.push(`${opts.growthIntentLabel}: ${opts.growthIntent.trim()}`);
  }

  const context = lines.join('\n\n');

  return `You are a reflective assistant inside MindOS Echo (a personal, local-first notes companion). The user is viewing one Echo section. Below is exactly what they see on screen right now—it may be an empty-state placeholder until indexing fills the list.

--- Visible context ---
${context}
---

Write a short insight in ${lang} as Markdown (under 220 words). Tone: warm, restrained, "quiet notebook"—not a hype coach. If the context is only generic empty copy, acknowledge that briefly and offer 2–3 reflection prompts instead of inventing files or facts. Do not claim you read their whole library. Prefer answering from this context; avoid unnecessary tool use.`;
}
