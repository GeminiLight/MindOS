// ─── IM Message Format Utilities ──────────────────────────────────────────────
// Handles message truncation, format downgrade, and platform-specific conversion.

import { PLATFORM_LIMITS, type IMMessage } from './types';

/** Truncate message text to platform limit. */
export function truncateMessage(message: IMMessage): IMMessage {
  const limit = PLATFORM_LIMITS[message.platform].maxTextLength;
  if (message.text.length <= limit) return message;
  const suffix = '\n\n... (message truncated)';
  return { ...message, text: message.text.slice(0, limit - suffix.length) + suffix };
}

/** Downgrade format if the platform doesn't support it. */
export function downgradeFormat(message: IMMessage): IMMessage {
  const limits = PLATFORM_LIMITS[message.platform];
  if (message.format === 'markdown' && !limits.supportsMarkdown) {
    return { ...message, format: 'text', text: stripMarkdown(message.text) };
  }
  if (message.format === 'html' && !limits.supportsHtml) {
    return { ...message, format: 'text', text: stripHtml(message.text) };
  }
  return message;
}

/** Apply all pre-processing: downgrade → truncate. */
export function preprocessMessage(message: IMMessage): IMMessage {
  return truncateMessage(downgradeFormat(message));
}

/** Strip Markdown formatting, keeping plain text. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').replace(/```/g, ''))  // code blocks
    .replace(/\*\*(.*?)\*\*/g, '$1')       // **bold**
    .replace(/__(.*?)__/g, '$1')           // __bold__
    .replace(/\*(.*?)\*/g, '$1')           // *italic*
    .replace(/_(.*?)_/g, '$1')             // _italic_
    .replace(/~~(.*?)~~/g, '$1')           // ~~strikethrough~~
    .replace(/`(.*?)`/g, '$1')             // `inline code`
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')    // [text](url)
    .replace(/^#{1,6}\s+/gm, '')           // # heading
    .replace(/^>\s+/gm, '')               // > quote
    .replace(/^[-*+]\s+/gm, '- ');         // list items normalize to -
}

/** Strip HTML tags, keeping text content. */
export function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

// ─── Telegram MarkdownV2 ─────────────────────────────────────────────────────

const TELEGRAM_ESCAPE_CHARS = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

/** Escape special characters for Telegram MarkdownV2. */
export function escapeMarkdownV2(text: string): string {
  return text.replace(TELEGRAM_ESCAPE_CHARS, '\\$1');
}

/**
 * Convert standard Markdown to Telegram MarkdownV2.
 * Handles bold, italic, code, links. Headings degrade to bold.
 * This is a best-effort conversion — if Telegram rejects it,
 * the adapter should fallback to plain text.
 */
export function markdownToTelegramV2(text: string): string {
  // Preserve code blocks (don't escape inside them)
  const codeBlocks: string[] = [];
  let processed = text.replace(/```([\s\S]*?)```/g, (_m, code) => {
    codeBlocks.push(code);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // Preserve inline code
  const inlineCodes: string[] = [];
  processed = processed.replace(/`([^`]+)`/g, (_m, code) => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // Convert markdown formatting before escaping
  // Headings → bold
  processed = processed.replace(/^#{1,6}\s+(.+)$/gm, '**$1**');

  // Now escape special chars in remaining text
  processed = processed.replace(TELEGRAM_ESCAPE_CHARS, '\\$1');

  // Restore bold: \*\*text\*\* → *text*
  processed = processed.replace(/\\\*\\\*(.*?)\\\*\\\*/g, '*$1*');
  // Restore italic: \_text\_ → _text_
  processed = processed.replace(/\\_(.*?)\\_/g, '_$1_');
  // Restore links: \[text\]\(url\) → [text](url)
  processed = processed.replace(/\\\[(.*?)\\\]\\\((.*?)\\\)/g, '[$1]($2)');
  // Restore strikethrough: \~\~text\~\~ → ~text~
  processed = processed.replace(/\\~\\~(.*?)\\~\\~/g, '~$1~');

  // Restore code blocks
  processed = processed.replace(/\x00CB(\d+)\x00/g, (_m, idx) => {
    return '```\n' + codeBlocks[Number(idx)] + '\n```';
  });

  // Restore inline code
  processed = processed.replace(/\x00IC(\d+)\x00/g, (_m, idx) => {
    return '`' + inlineCodes[Number(idx)] + '`';
  });

  return processed;
}

/** Mask a string for logging: show first 3 + last 3 chars, middle replaced with ***. */
export function maskForLog(value: string): string {
  if (value.length <= 8) return '***';
  return value.slice(0, 3) + '***' + value.slice(-3);
}
