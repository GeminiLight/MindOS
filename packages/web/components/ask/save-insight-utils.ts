import { stripThinkingTags } from '@/hooks/useAiOrganize';
import type { Message } from '@/lib/types';

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

// ─── Session-level save utilities ────────────────────────────────────────────

export type SessionSaveFormat = 'full' | 'ai-only' | 'summary';

/** Generate a default file path for saving a session. */
export function generateSessionPath(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `Inbox/session-${yyyy}-${mm}-${dd}.md`;
}

/**
 * Format all messages in a session as Markdown.
 *
 * - `full`: User + Assistant messages with role headers and separators
 * - `ai-only`: Only assistant messages, concatenated with separators
 */
export function formatSessionContent(
  messages: Message[],
  format: SessionSaveFormat,
  date: Date = new Date(),
): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const header = `> Saved session from MindOS Ask · ${yyyy}-${mm}-${dd}`;

  if (format === 'full') {
    const parts = messages.map((m) => {
      const cleaned = stripThinkingTags(m.content).trim();
      if (!cleaned) return null;
      const roleLabel = m.role === 'user' ? '**User**' : '**Assistant**';
      return `### ${roleLabel}\n\n${cleaned}`;
    }).filter(Boolean);
    return `${header}\n\n${parts.join('\n\n---\n\n')}`;
  }

  if (format === 'ai-only') {
    const parts = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => stripThinkingTags(m.content).trim())
      .filter(Boolean);
    return `${header}\n\n${parts.join('\n\n---\n\n')}`;
  }

  // 'summary' format — caller should pass pre-generated summary as a single-message array
  // or handle summary generation externally. Fallback to full format.
  return formatSessionContent(messages, 'full', date);
}

/** Count messages and estimate character count for preview label. */
export function sessionPreviewStats(messages: Message[], format: SessionSaveFormat): { msgCount: number; charCount: number } {
  const relevant = format === 'ai-only'
    ? messages.filter((m) => m.role === 'assistant')
    : messages;
  const chars = relevant.reduce((acc, m) => acc + stripThinkingTags(m.content).trim().length, 0);
  return { msgCount: relevant.length, charCount: chars };
}
