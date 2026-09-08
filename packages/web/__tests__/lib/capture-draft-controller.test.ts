// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCaptureDraftController } from '@/lib/capture-draft-controller';
import type { CaptureDraftRecord, CaptureDraftStorage } from '@/lib/capture-draft-storage';

afterEach(() => { vi.useRealTimers(); });
function storage() {
  const records = new Map<string, CaptureDraftRecord>();
  const backend: CaptureDraftStorage = {
    read: async scope => records.get(scope) ?? null,
    write: async (scope, revision, value) => {
      if ((records.get(scope)?.revision ?? null) !== revision) throw new Error('conflict');
      const next = { schema: 1 as const, revision: crypto.randomUUID(), value };
      records.set(scope, next);
      return next.revision;
    },
  };
  return { records, backend };
}

describe('capture draft persistence lifecycle', () => {
  it('restores text, notes, links, and binary attachments from a new controller', async () => {
    const { backend } = storage();
    const one = createCaptureDraftController('vault-a', backend);
    await one.hydrate();
    const file = new File(['Unicode 内容'], '资料 🌱.md', { type: 'text/markdown', lastModified: 12 });
    one.setDraftText('写到一半');
    one.setPendingFiles([file]);
    one.setPendingUrls(['https://example.com']);
    one.setStagedNotes([{ id: 'one', content: '已分段', wordCount: 3, createdAt: '2026-09-08' }]);
    await one.flush();
    const two = createCaptureDraftController('vault-a', backend);
    await two.hydrate();
    expect(two.getSnapshot().value).toEqual(one.getSnapshot().value);
    expect(two.getSnapshot().status).toBe('saved');
    one.clear(); await one.flush();
    const three = createCaptureDraftController('vault-a', backend);
    await three.hydrate();
    expect(three.getSnapshot().value.pendingFiles).toEqual([]);
    expect(three.getSnapshot().value.draftText).toBe('');
  });

  it('serializes writes and does not mark newer input saved by an older completion', async () => {
    vi.useFakeTimers();
    const { backend } = storage();
    let resolve!: () => void;
    const original = backend.write;
    backend.write = vi.fn(async (...args) => {
      if (args[2].draftText === 'first') await new Promise<void>(done => { resolve = done; });
      return original(...args);
    });
    const controller = createCaptureDraftController('a', backend);
    await controller.hydrate();
    controller.setDraftText('first');
    const pending = controller.flush();
    controller.setDraftText('latest');
    expect(controller.getSnapshot().status).toBe('saving');
    resolve(); await pending;
    expect(backend.write).toHaveBeenCalledTimes(2);
    expect((await backend.read('a'))?.value.draftText).toBe('latest');
    expect(controller.getSnapshot().status).toBe('saved');
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.write).toHaveBeenCalledTimes(2);
  });

  it('preserves edits and warns before refresh when storage is unavailable, then allows retry', async () => {
    const { backend } = storage();
    const original = backend.write;
    backend.write = vi.fn().mockRejectedValue(new DOMException('quota', 'QuotaExceededError'));
    const controller = createCaptureDraftController('a', backend);
    await controller.hydrate();
    controller.setDraftText('Do not lose me');
    await controller.flush();
    expect(controller.getSnapshot().status).toBe('unavailable');
    expect(controller.getSnapshot().value.draftText).toBe('Do not lose me');
    const leaving = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(leaving)).toBe(false);
    backend.write = original;
    await controller.flush();
    expect(controller.getSnapshot().status).toBe('saved');
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
  });

  it.each(['最新的草稿 🌱', ''])('persists a late edit %j arriving between save completion and cleanup', async latest => {
    vi.useFakeTimers();
    const { backend } = storage();
    const write = vi.spyOn(backend, 'write');
    const controller = createCaptureDraftController('late-edit', backend);
    await controller.hydrate();
    let updated = false;
    const unsubscribe = controller.subscribe(() => {
      if (controller.getSnapshot().status === 'saved' && !updated) {
        updated = true;
        queueMicrotask(() => controller.setDraftText(latest));
      }
    });
    try {
      controller.setDraftText('Original draft');
      await controller.flush();
      await vi.advanceTimersByTimeAsync(300);
      expect((await backend.read('late-edit'))?.value.draftText).toBe(latest);
      expect(controller.getSnapshot().status).toBe('saved');
      expect(write).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      unsubscribe();
      controller.clear();
      await controller.flush();
    }
  });

  it('does not turn a failed draft save into an automatic retry loop', async () => {
    vi.useFakeTimers();
    const { backend } = storage();
    const original = backend.write;
    const write = vi.spyOn(backend, 'write').mockRejectedValue(new Error('Storage unavailable'));
    const controller = createCaptureDraftController('failed-save', backend);
    await controller.hydrate();
    try {
      controller.setDraftText('Keep until retry');
      await controller.flush();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(write).toHaveBeenCalledTimes(1);
      expect(controller.getSnapshot()).toMatchObject({ status: 'unavailable', value: { draftText: 'Keep until retry' } });
    } finally {
      write.mockImplementation(original);
      controller.clear();
      await controller.flush();
    }
  });

  it('does not overwrite a newer draft written by a different window', async () => {
    const { backend } = storage();
    const first = createCaptureDraftController('a', backend);
    const second = createCaptureDraftController('a', backend);
    await Promise.all([first.hydrate(), second.hydrate()]);
    first.setDraftText('Window A'); await first.flush();
    second.setDraftText('Window B'); await second.flush();
    expect((await backend.read('a'))?.value.draftText).toBe('Window A');
    expect(second.getSnapshot().value.draftText).toBe('Window B');
    expect(second.getSnapshot().status).toBe('unavailable');
    // Clear the volatile copy to remove this test's unload protection.
    second.clear(); await second.flush();
  });
});
