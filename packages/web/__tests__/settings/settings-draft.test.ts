import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSettingsDraftStore } from '@/components/settings/settings-draft';
import type { SettingsData } from '@/components/settings/types';

const settings = (name: string): SettingsData => ({ ai: { activeProvider: name, providers: [] }, mindRoot: '/tmp/test-mind' });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('coalesces edits and does not leave a redundant save timer behind', async () => {
  const save = vi.fn().mockResolvedValue({});
  const store = createSettingsDraftStore(save);
  store.acceptLoaded(settings('initial'));
  store.update(settings('first'), 'ai'); store.update(settings('latest'), 'knowledge');
  await vi.advanceTimersByTimeAsync(800);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].ai.activeProvider).toBe('latest');
  expect(store.getSnapshot()).toMatchObject({ pending: false, status: 'saved', tab: 'knowledge' });
  expect(vi.getTimerCount()).toBe(0);
});

it('rejects stale reads even after the newer edit has finished saving', async () => {
  const store = createSettingsDraftStore(async () => ({}));
  store.acceptLoaded(settings('initial'));
  const oldReadRevision = store.getSnapshot().revision;
  store.update(settings('edited'), 'ai'); await store.flush();
  store.acceptLoaded(settings('stale'), oldReadRevision);
  expect(store.getSnapshot().data?.ai.activeProvider).toBe('edited');
});

it('serializes saves and does not surface the failure of an obsolete payload', async () => {
  let rejectOld!: (reason: Error) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; })).mockResolvedValue({});
  const store = createSettingsDraftStore(save);
  store.update(settings('first'), 'ai');
  const first = store.flush(); expect(store.flush()).toBe(first);
  await Promise.resolve();
  store.update(settings('latest'), 'ai'); rejectOld(new Error('old failure'));
  await expect(first).resolves.toBe(true);
  expect(save.mock.calls.map(([data]) => data.ai.activeProvider)).toEqual(['first', 'latest']);
  expect(store.getSnapshot()).toMatchObject({ pending: false, status: 'saved', hasFailed: false });
  await vi.advanceTimersByTimeAsync(1000);
  expect(save).toHaveBeenCalledTimes(2);
});

it('retains failed edits without a view and waits for explicit retry instead of looping', async () => {
  const save = vi.fn().mockRejectedValue(new Error('offline'));
  const store = createSettingsDraftStore(save);
  const unsubscribe = store.subscribe(() => {});
  store.update(settings('retained'), 'ai'); unsubscribe();
  await expect(store.flush()).resolves.toBe(false);
  await vi.advanceTimersByTimeAsync(10000);
  expect(save).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot()).toMatchObject({ pending: true, status: 'error', hasFailed: true });
  expect(store.getSnapshot().data?.ai.activeProvider).toBe('retained');
  save.mockResolvedValue({}); await expect(store.flush()).resolves.toBe(true);
  expect(store.getSnapshot().pending).toBe(false);
});
