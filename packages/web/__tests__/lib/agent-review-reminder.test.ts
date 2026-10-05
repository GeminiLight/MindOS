import { describe, expect, it } from 'vitest';
import {
  agentReviewReminderStorageKey,
  readDismissedAgentReviewIds,
  writeDismissedAgentReviewIds,
} from '@/lib/agent-review-reminder';

describe('Agent review reminder dismissal', () => {
  function memoryStorage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
  }

  it('remembers event identities for one knowledge root without marking another root dismissed', () => {
    const storage = memoryStorage();
    expect(writeDismissedAgentReviewIds(['edit-1', '中文-ed it', 'edit-1'], 'root-a', storage)).toBe(true);
    expect(readDismissedAgentReviewIds('root-a', storage)).toEqual(new Set(['edit-1', '中文-ed it']));
    expect(readDismissedAgentReviewIds('root-b', storage)).toEqual(new Set());
    expect(agentReviewReminderStorageKey('root-a')).not.toBe(agentReviewReminderStorageKey('root-b'));
  });

  it('ignores malformed and excessive stored identities', () => {
    const storage = memoryStorage();
    storage.setItem(agentReviewReminderStorageKey('root'), '{broken');
    expect(readDismissedAgentReviewIds('root', storage)).toEqual(new Set());
    storage.setItem(agentReviewReminderStorageKey('root'), JSON.stringify(['first', '', null, ...Array.from({ length: 150 }, (_, i) => `id-${i}`)]));
    const ids = readDismissedAgentReviewIds('root', storage);
    expect(ids.has('first')).toBe(true);
    expect(ids.has('')).toBe(false);
    expect(ids.size).toBeLessThanOrEqual(120);
  });

  it('degrades safely when browser storage is unavailable', () => {
    const storage = {
      getItem: () => { throw new Error('Storage blocked'); },
      setItem: () => { throw new Error('Storage blocked'); },
    };
    expect(readDismissedAgentReviewIds('root', storage)).toEqual(new Set());
    expect(writeDismissedAgentReviewIds(['edit-1'], 'root', storage)).toBe(false);
  });
});
