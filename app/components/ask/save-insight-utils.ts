import { stripThinkingTags } from '@/hooks/useAiOrganize';

/**
 * Generate a default file path for saving an insight.
 * Format: Inbox/insight-YYYY-MM-DD.md
 * Appends a counter suffix if the path already exists.
 */
export function generateInsightPath(
  _content: string,
  date: Date = new Date(),
  existingPaths?: Set<string>,
): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const base = `Inbox/insight-${yyyy}-${mm}-${dd}`;

  if (!existingPaths) return `${base}.md`;

  let candidate = `${base}.md`;
  let counter = 2;
  while (existingPaths.has(candidate)) {
    candidate = `${base}-${counter}.md`;
    counter++;
  }
  return candidate;
}

/** Strip thinking tags and trim whitespace. Returns cleaned text for saving. */
export function cleanInsightContent(raw: string): string {
  return stripThinkingTags(raw).trim();
}

/** Wrap insight content with a metadata header for the saved file. */
export function formatInsightMarkdown(content: string, date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `> Saved from MindOS Ask · ${yyyy}-${mm}-${dd}\n\n${content}`;
}
