import type { LocalAttachment } from '@/lib/types';
import {
  MINDOS_AGENT_ATTACHMENT_MAX_CHARS,
  MINDOS_AGENT_ATTACHMENT_MAX_FILE_BYTES,
  MINDOS_AGENT_ATTACHMENT_MAX_FILE_COUNT,
  MINDOS_AGENT_ATTACHMENT_MAX_TOTAL_BYTES,
} from '@geminilight/mindos/agent/turn';

/**
 * The per-turn attachment budget lives in core (`agent/turn`) so the Product
 * Server handler and the Next host enforce identical limits. This web module
 * re-exports those constants instead of declaring its own, keeping a single
 * source of truth. `AI_ATTACHMENT_MAX_CHARS` is the text-char cap the chat UI
 * gates on before submit; the byte/count caps are enforced server-side at
 * request normalisation (`validateMindosAgentTurnAttachmentBudget`).
 */
export const AI_ATTACHMENT_MAX_CHARS = MINDOS_AGENT_ATTACHMENT_MAX_CHARS;
export {
  MINDOS_AGENT_ATTACHMENT_MAX_CHARS,
  MINDOS_AGENT_ATTACHMENT_MAX_FILE_BYTES,
  MINDOS_AGENT_ATTACHMENT_MAX_FILE_COUNT,
  MINDOS_AGENT_ATTACHMENT_MAX_TOTAL_BYTES,
};

export interface OversizedAiAttachment {
  name: string;
  chars: number;
  maxChars: number;
}

export function getOversizedAiAttachments(
  files: LocalAttachment[],
  maxChars = AI_ATTACHMENT_MAX_CHARS,
): OversizedAiAttachment[] {
  return files
    .filter(file => file.content.length > maxChars)
    .map(file => ({ name: file.name, chars: file.content.length, maxChars }));
}

export function describeOversizedAiAttachments(files: OversizedAiAttachment[]): string {
  if (files.length === 0) return '';
  const limit = files[0]?.maxChars ?? AI_ATTACHMENT_MAX_CHARS;
  const shown = files
    .slice(0, 3)
    .map(file => `${file.name} (${file.chars.toLocaleString('en-US')} chars)`)
    .join(', ');
  const extra = files.length > 3 ? ` and ${files.length - 3} more` : '';
  return `AI attachments are too large to run safely. ${shown}${extra} exceed the ${limit.toLocaleString('en-US')} char limit. Split or shorten the files, then run again.`;
}
