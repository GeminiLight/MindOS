import { describe, expect, it } from 'vitest';
import { createMarkdownDraftQueue } from '@/components/editor/markdown-draft-queue';

describe('markdown draft persistence', () => {
  it('waits for an outstanding autosave before deleting a successfully saved draft', async () => {
    const values = new Map<string, string>();
    let finish!: () => void;
    const writing = new Promise<void>((resolve) => { finish = resolve; });
    const queue = createMarkdownDraftQueue({
      async setItem(key, value) { await writing; values.set(key, value); },
      async removeItem(key) { values.delete(key); },
    });
    const save = queue.setItem('root-a/note', 'draft');
    const clear = queue.removeItem('root-a/note');
    finish();
    await Promise.all([save, clear]);
    expect(values.has('root-a/note')).toBe(false);
  });

  it('keeps different draft identities independent and recovers after storage failure', async () => {
    const values = new Map<string, string>();
    let fail!: (error: Error) => void;
    const blocked = new Promise<void>((_, reject) => { fail = reject; });
    const queue = createMarkdownDraftQueue({
      async setItem(key, value) { if (key === 'a') await blocked; values.set(key, value); },
      async removeItem(key) { values.delete(key); },
    });
    const failedSave = expect(queue.setItem('a', 'draft')).rejects.toThrow('disk unavailable');
    await queue.setItem('b', 'other root');
    expect(values.get('b')).toBe('other root');
    fail(new Error('disk unavailable'));
    await failedSave;
    await expect(queue.removeItem('a')).resolves.toBeUndefined();
  });
});
