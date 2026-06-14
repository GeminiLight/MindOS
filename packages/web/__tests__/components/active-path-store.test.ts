import { describe, expect, it } from 'vitest';
import { createActivePathStore } from '@/components/file-tree/active-path';

describe('ActivePathStore notification scope', () => {
  it('notifies only file listeners and active-path listeners whose boolean can change', () => {
    const store = createActivePathStore('S/f0.md');
    const calls = new Map<string, number>();
    const bump = (key: string) => () => calls.set(key, (calls.get(key) ?? 0) + 1);

    store.subscribeFile('S/f0.md', bump('file:S/f0.md'));
    store.subscribeFile('S/f1.md', bump('file:S/f1.md'));
    store.subscribeFile('T/g.md', bump('file:T/g.md'));
    for (let index = 0; index < 200; index += 1) {
      store.subscribeFile(`S/irrelevant-${index}.md`, bump(`irrelevant:${index}`));
    }
    store.subscribeActivePath('S', bump('active:S'));
    store.subscribeActivePath('T', bump('active:T'));

    store.set('S/f1.md');

    expect(calls.get('file:S/f0.md')).toBe(1);
    expect(calls.get('file:S/f1.md')).toBe(1);
    expect(calls.get('active:S') ?? 0).toBe(0);
    expect(calls.get('active:T') ?? 0).toBe(0);
    for (let index = 0; index < 200; index += 1) {
      expect(calls.get(`irrelevant:${index}`) ?? 0).toBe(0);
    }

    store.set('T/g.md');

    expect(calls.get('file:S/f1.md')).toBe(2);
    expect(calls.get('file:T/g.md')).toBe(1);
    expect(calls.get('active:S')).toBe(1);
    expect(calls.get('active:T')).toBe(1);
  });
});
