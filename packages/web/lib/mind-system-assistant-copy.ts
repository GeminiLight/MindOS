import type { MindSystemSpaceAssistant } from './mind-system-assistants';

export interface MindSystemAssistantCopy {
  id: string;
  name: string;
  desc: string;
}

export interface MindSystemAssistantAvatar {
  text: string;
  className: string;
}

const ASSISTANT_AVATAR_TONES = [
  'border-[var(--amber)]/35 bg-[var(--amber-subtle)] text-[var(--amber)]',
  'border-[var(--success)]/25 bg-[var(--success)]/10 text-[var(--success)]',
  'border-[var(--error)]/20 bg-[var(--error)]/10 text-[var(--error)]',
  'border-border bg-muted text-foreground/75',
] as const;

export function resolveMindSystemAssistantCopy(
  assistant: Pick<MindSystemSpaceAssistant, 'id' | 'name' | 'desc'>,
  copies: readonly MindSystemAssistantCopy[],
): MindSystemAssistantCopy {
  const fallback = copies.find(copy => copy.id === assistant.id) ?? {
    id: assistant.id,
    name: assistant.id,
    desc: '',
  };
  return {
    id: assistant.id,
    name: typeof assistant.name === 'string' && assistant.name.trim() ? assistant.name.trim() : fallback.name,
    desc: typeof assistant.desc === 'string' ? assistant.desc : fallback.desc,
  };
}

export function resolveMindSystemAssistantCopies(
  assistants: Array<Pick<MindSystemSpaceAssistant, 'id' | 'name' | 'desc'>>,
  copies: readonly MindSystemAssistantCopy[],
): MindSystemAssistantCopy[] {
  return assistants.map(assistant => resolveMindSystemAssistantCopy(assistant, copies));
}

export function getMindSystemAssistantAvatar(name: string, assistantId: string): MindSystemAssistantAvatar {
  const text = Array.from(name.trim() || assistantId.trim() || '?')[0]?.toLocaleUpperCase() ?? '?';
  return {
    text,
    className: ASSISTANT_AVATAR_TONES[stableHash(assistantId || name) % ASSISTANT_AVATAR_TONES.length],
  };
}

function stableHash(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}
