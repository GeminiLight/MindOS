// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PROMPT_HISTORY_LIMIT,
  createPromptHistoryNavigator,
  loadPromptHistory,
  recordPromptHistoryEntry,
  shouldRecallPromptHistory,
} from '@/lib/agent/prompt-history';

/**
 * Recalling the last prompt with the up arrow is muscle memory from every
 * terminal agent; MindOS had no equivalent
 * (spec-acp-first-agent-integration Phase 3).
 */

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('prompt history storage', () => {
  it('returns the most recent prompt first', () => {
    recordPromptHistoryEntry('first');
    recordPromptHistoryEntry('second');

    expect(loadPromptHistory()).toEqual(['second', 'first']);
  });

  it('ignores blank submissions, which are not prompts', () => {
    recordPromptHistoryEntry('   ');
    recordPromptHistoryEntry('');

    expect(loadPromptHistory()).toEqual([]);
  });

  it('moves a repeated prompt to the front instead of storing it twice', () => {
    recordPromptHistoryEntry('a');
    recordPromptHistoryEntry('b');
    recordPromptHistoryEntry('a');

    expect(loadPromptHistory()).toEqual(['a', 'b']);
  });

  it('keeps the history bounded so storage cannot grow without limit', () => {
    for (let index = 0; index <= PROMPT_HISTORY_LIMIT + 10; index += 1) {
      recordPromptHistoryEntry(`prompt ${index}`);
    }

    expect(loadPromptHistory()).toHaveLength(PROMPT_HISTORY_LIMIT);
    expect(loadPromptHistory()[0]).toBe(`prompt ${PROMPT_HISTORY_LIMIT + 10}`);
  });

  it('survives a corrupted or hand-edited store rather than throwing', () => {
    localStorage.setItem('mindos-prompt-history.v1', '{not json');
    expect(loadPromptHistory()).toEqual([]);

    localStorage.setItem('mindos-prompt-history.v1', '{"nope":1}');
    expect(loadPromptHistory()).toEqual([]);

    localStorage.setItem('mindos-prompt-history.v1', '[1,2,"ok"]');
    expect(loadPromptHistory()).toEqual(['ok']);
  });

  it('keeps multi-line and unicode prompts intact', () => {
    recordPromptHistoryEntry('写一个\n测试 ✅');

    expect(loadPromptHistory()).toEqual(['写一个\n测试 ✅']);
  });
});

describe('prompt history navigation', () => {
  it('recalls the previous prompts in order, oldest last', () => {
    const navigator = createPromptHistoryNavigator(['newest', 'older', 'oldest']);

    expect(navigator.previous()).toBe('newest');
    expect(navigator.previous()).toBe('older');
    expect(navigator.previous()).toBe('oldest');
  });

  it('stops at the oldest prompt instead of wrapping around', () => {
    const navigator = createPromptHistoryNavigator(['only']);

    expect(navigator.previous()).toBe('only');
    expect(navigator.previous()).toBe('only');
  });

  it('walks back toward the draft and returns it at the end', () => {
    const navigator = createPromptHistoryNavigator(['newest', 'older'], 'my draft');
    navigator.previous();
    navigator.previous();

    expect(navigator.next()).toBe('newest');
    expect(navigator.next()).toBe('my draft');
  });

  it('stays on the draft when going forward past it', () => {
    const navigator = createPromptHistoryNavigator(['newest'], 'draft');

    expect(navigator.next()).toBe('draft');
  });

  it('reports no recall for an empty history, so the key keeps its normal meaning', () => {
    const navigator = createPromptHistoryNavigator([]);

    expect(navigator.previous()).toBeNull();
    expect(navigator.next()).toBeNull();
  });

  it('treats a missing draft as empty rather than undefined text', () => {
    const navigator = createPromptHistoryNavigator(['a']);
    navigator.previous();

    expect(navigator.next()).toBe('');
  });
});

describe('arrow keys versus caret movement', () => {
  const at = (selectionStart: number, selectionEnd = selectionStart) => ({ selectionStart, selectionEnd });

  it('recalls on ArrowUp only from the very start of the composer', () => {
    expect(shouldRecallPromptHistory({ key: 'ArrowUp', ...at(0), navigating: false })).toBe(true);
    expect(shouldRecallPromptHistory({ key: 'ArrowUp', ...at(5), navigating: false })).toBe(false);
  });

  it('leaves ArrowUp alone while text is selected, so Shift+Up still extends it', () => {
    expect(shouldRecallPromptHistory({ key: 'ArrowUp', ...at(0, 4), navigating: false })).toBe(false);
  });

  it('ignores ArrowDown until a walk has started', () => {
    expect(shouldRecallPromptHistory({ key: 'ArrowDown', ...at(0), navigating: false })).toBe(false);
  });

  it('lets ArrowDown walk forward right after a recall, when the caret sits at 0', () => {
    expect(shouldRecallPromptHistory({ key: 'ArrowDown', ...at(0), navigating: true })).toBe(true);
  });

  it('keeps both arrows navigating once the walk is underway', () => {
    expect(shouldRecallPromptHistory({ key: 'ArrowUp', ...at(12), navigating: true })).toBe(true);
    expect(shouldRecallPromptHistory({ key: 'ArrowDown', ...at(12), navigating: true })).toBe(true);
  });
});
