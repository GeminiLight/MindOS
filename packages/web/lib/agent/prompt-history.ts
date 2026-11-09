/**
 * Prompt history for the chat composer. Recalling the last prompt with the up
 * arrow is muscle memory from terminal agents, so history is shared across
 * sessions rather than scoped to one conversation.
 */

const STORAGE_KEY = 'mindos-prompt-history.v1';

/** Bounded so a long-running install cannot grow localStorage without limit. */
export const PROMPT_HISTORY_LIMIT = 50;

export function loadPromptHistory(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  } catch {
    // A corrupted or hand-edited store must not break the composer.
    return [];
  }
}

export function recordPromptHistoryEntry(prompt: string): void {
  if (typeof localStorage === 'undefined') return;
  const trimmed = prompt.trim();
  if (!trimmed) return;
  try {
    // Re-sending a prompt moves it to the front instead of duplicating it, so
    // the recent list stays useful.
    const next = [trimmed, ...loadPromptHistory().filter(entry => entry !== trimmed)]
      .slice(0, PROMPT_HISTORY_LIMIT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked — history is a convenience, never a blocker.
  }
}

/**
 * Whether an arrow key should recall history instead of moving the caret.
 *
 * Before a walk starts, ArrowUp only takes over at the very start of the text,
 * so editing a multi-line prompt still works. Once the walk is underway the
 * whole composer holds a recalled prompt, so both arrows navigate — including
 * ArrowDown right after a recall, when the caret sits at position 0.
 */
export function shouldRecallPromptHistory(input: {
  key: 'ArrowUp' | 'ArrowDown';
  selectionStart: number;
  selectionEnd: number;
  navigating: boolean;
}): boolean {
  if (input.navigating) return true;
  if (input.key !== 'ArrowUp') return false;
  return input.selectionStart === 0 && input.selectionEnd === 0;
}

export interface PromptHistoryNavigator {
  /** Older prompt, or null when there is no history to recall. */
  previous(): string | null;
  /** Newer prompt, ending at the draft the user was typing. */
  next(): string | null;
}

/**
 * Walks `history` (newest first) while remembering the draft, so going forward
 * past the newest entry restores what the user had typed.
 */
export function createPromptHistoryNavigator(
  history: readonly string[],
  draft = '',
): PromptHistoryNavigator {
  // -1 means "on the draft"; 0..n-1 index into history.
  let index = -1;

  return {
    previous() {
      if (history.length === 0) return null;
      index = Math.min(index + 1, history.length - 1);
      return history[index];
    },
    next() {
      if (history.length === 0) return null;
      index = Math.max(index - 1, -1);
      return index === -1 ? draft : history[index];
    },
  };
}
