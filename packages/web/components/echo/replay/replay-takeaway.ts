import type { BranchStory } from '@geminilight/mindos/knowledge/branch-replay';

/** A personal note belongs to one version of one experience, never a new standard. */
export function restoreReplayTakeaway(story: BranchStory, raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const value = raw as { fingerprint?: unknown; text?: unknown };
  return value.fingerprint === story.fingerprint && typeof value.text === 'string' ? value.text.slice(0, 1200) : '';
}
