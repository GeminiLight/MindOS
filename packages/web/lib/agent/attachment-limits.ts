import type { LocalAttachment } from '@/lib/types';

export const AI_ATTACHMENT_MAX_CHARS = 20_000;

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
