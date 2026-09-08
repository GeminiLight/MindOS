import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveInboxFiles,
  fetchInboxFiles,
  InboxClientError,
  saveInboxFiles,
} from '@/lib/inbox-client';

describe('inbox-client', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws a normalized error message from failed Inbox GET responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'MIND_ROOT is not configured' }),
    })));

    await expect(fetchInboxFiles('Load failed')).rejects.toMatchObject({
      name: 'InboxClientError',
      message: 'MIND_ROOT is not configured',
      status: 400,
    } satisfies Partial<InboxClientError>);
  });

  it.each(['headers', 'body'])('stops waiting for stalled queue %s and aborts the read', async stage => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init?.signal;
      return stage === 'headers'
        ? new Promise(() => {})
        : Promise.resolve({ ok: true, json: () => new Promise(() => {}) });
    }));
    const result = fetchInboxFiles('Queue unavailable. Retry.').catch(error => error);
    await vi.advanceTimersByTimeAsync(15000);
    expect(signal?.aborted).toBe(true);
    expect(await result).toMatchObject({ name: 'InboxClientError', message: 'Queue unavailable. Retry.' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not misrepresent an unreadable queue response as an empty queue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } })));
    await expect(fetchInboxFiles('Could not read queue')).rejects.toThrow('Could not read queue');
  });

  it('clears its timeout after a successful empty queue read', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ files: [] }) })));
    await expect(fetchInboxFiles('Load failed')).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('normalizes save results without treating skipped files as saved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        saved: [{ original: 'ok.md', path: 'Inbox/ok.md' }],
        skipped: [{ name: 'bad.exe', reason: 'unsupported format' }],
      }),
    })));

    await expect(saveInboxFiles([{ name: 'ok.md', content: 'ok' }], 'Save failed'))
      .resolves.toEqual({
        saved: [{ original: 'ok.md', path: 'Inbox/ok.md' }],
        skipped: [{ name: 'bad.exe', reason: 'unsupported format' }],
      });
  });

  it('normalizes archive results so UI can distinguish notFound from archived', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        archived: [{ original: 'ok.md', archivedPath: '.mindos/archive/ok.md' }],
        notFound: ['ghost.md'],
      }),
    })));

    await expect(archiveInboxFiles(['ok.md', 'ghost.md'], 'Remove failed'))
      .resolves.toEqual({
        archived: [{ original: 'ok.md', archivedPath: '.mindos/archive/ok.md' }],
        notFound: ['ghost.md'],
      });
  });
});
