import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => {
  class HoistedApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  return {
    getFileContent: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    ApiError: HoistedApiError,
  };
});

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }),
  },
}));

vi.mock('@/lib/api-client', () => ({
  mindosClient: {
    getFileContent: apiMocks.getFileContent,
    saveFile: apiMocks.saveFile,
    createFile: apiMocks.createFile,
  },
  ApiError: apiMocks.ApiError,
}));

import {
  QuickCaptureReadError,
  appendCaptureToContent,
  buildInboxPath,
  clearQuickCaptureDraft,
  formatCaptureContent,
  isValidCapture,
  loadPendingCaptures,
  loadQuickCaptureDraft,
  queueQuickCapture,
  removePendingCaptures,
  retryPendingCaptures,
  saveQuickCaptureDraft,
  saveQuickCapture,
} from '@/lib/quick-capture';

describe('quick-capture', () => {
  const date = new Date('2026-04-11T09:30:00');

  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
  });

  it('builds inbox path for a specific date', () => {
    expect(buildInboxPath('inbox', date)).toBe('inbox/2026-04-11.md');
  });

  it('formats capture content with timestamp', () => {
    expect(formatCaptureContent('remember this', date)).toBe('[09:30] remember this');
  });

  it('rejects empty capture text', () => {
    expect(isValidCapture('')).toBe(false);
    expect(isValidCapture('   \n')).toBe(false);
  });

  it('accepts non-empty capture text', () => {
    expect(isValidCapture('hello')).toBe(true);
  });

  it('creates inbox header when file is empty', () => {
    const result = appendCaptureToContent('', 'first note', date);
    expect(result).toContain('# Inbox - Saturday, April 11, 2026');
    expect(result).toContain('[09:30] first note');
  });

  it('appends capture to existing content without overwriting', () => {
    const existing = '# Inbox - Saturday, April 11, 2026\n\n[09:00] existing note\n';
    const result = appendCaptureToContent(existing, 'new note', date);
    expect(result).toContain('[09:00] existing note');
    expect(result).toContain('[09:30] new note');
  });

  it('keeps existing content unchanged for whitespace-only capture', () => {
    const existing = '# Inbox\n\n[09:00] existing note\n';
    expect(appendCaptureToContent(existing, '   \n', date)).toBe(existing);
  });

  it('creates a new inbox file when none exists', async () => {
    apiMocks.getFileContent.mockRejectedValueOnce(new apiMocks.ApiError(404, 'Not found'));
    apiMocks.createFile.mockResolvedValueOnce({ ok: true, mtime: 123 });

    const result = await saveQuickCapture('first note', { pathDate: date, contentDate: date });

    expect(result.inboxPath).toBe('inbox/2026-04-11.md');
    expect(apiMocks.createFile).toHaveBeenCalledWith(
      'inbox/2026-04-11.md',
      '# Inbox - Saturday, April 11, 2026\n\n[09:30] first note\n',
    );
  });

  it('appends to an existing inbox file', async () => {
    apiMocks.getFileContent.mockResolvedValueOnce({ content: '# Inbox - Saturday, April 11, 2026\n\n[09:00] existing\n', mtime: 10 });
    apiMocks.saveFile.mockResolvedValueOnce({ ok: true, mtime: 123 });

    await saveQuickCapture('next note', { pathDate: date, contentDate: date });

    expect(apiMocks.saveFile).toHaveBeenCalledWith(
      'inbox/2026-04-11.md',
      '# Inbox - Saturday, April 11, 2026\n\n[09:00] existing\n[09:30] next note\n',
      10, { expectedRevision: undefined, expectedVaultId: undefined },
    );
  });

  it('throws a read error when existing inbox cannot be loaded', async () => {
    apiMocks.getFileContent.mockRejectedValueOnce(new apiMocks.ApiError(500, 'Server error'));

    await expect(saveQuickCapture('note', { pathDate: date })).rejects.toBeInstanceOf(QuickCaptureReadError);
    expect(apiMocks.saveFile).not.toHaveBeenCalled();
  });

  it('throws when save fails', async () => {
    apiMocks.getFileContent.mockRejectedValueOnce(new apiMocks.ApiError(404, 'Not found'));
    apiMocks.createFile.mockResolvedValueOnce({ ok: false, error: 'disk full' });

    await expect(saveQuickCapture('note', { pathDate: date })).rejects.toThrow('disk full');
  });

  it('throws when capture text is empty', async () => {
    await expect(saveQuickCapture('   ', { pathDate: date })).rejects.toThrow('Capture text cannot be empty');
  });

  it('persists and clears local capture draft text', async () => {
    await saveQuickCaptureDraft('draft text');

    await expect(loadQuickCaptureDraft()).resolves.toBe('draft text');

    await clearQuickCaptureDraft();

    await expect(loadQuickCaptureDraft()).resolves.toBe('');
  });

  it('clears draft storage when the draft is empty', async () => {
    await saveQuickCaptureDraft('draft text');
    await saveQuickCaptureDraft('   ');

    await expect(loadQuickCaptureDraft()).resolves.toBe('');
  });

  it('queues a failed quick capture for later sync', async () => {
    const pending = await queueQuickCapture('offline note', {
      pathDate: date,
      contentDate: date,
    });

    expect(pending).toMatchObject({
      text: 'offline note',
      inboxPath: 'inbox/2026-04-11.md',
      basePath: 'inbox',
      pathDateISO: date.toISOString(),
      contentDateISO: date.toISOString(),
    });
    expect(pending.id).toMatch(/^capture-/);
    await expect(loadPendingCaptures()).resolves.toEqual([pending]);
  });

  it('removes pending captures by id', async () => {
    const first = await queueQuickCapture('first', { pathDate: date, contentDate: date });
    const second = await queueQuickCapture('second', { pathDate: date, contentDate: date });

    await expect(removePendingCaptures([first.id])).resolves.toEqual([second]);
    await expect(loadPendingCaptures()).resolves.toEqual([second]);
  });

  it('retries pending captures and clears the queue on success', async () => {
    const pending = await queueQuickCapture('retry me', { pathDate: date, contentDate: date });
    apiMocks.getFileContent.mockRejectedValueOnce(new apiMocks.ApiError(404, 'Not found'));
    apiMocks.createFile.mockResolvedValueOnce({ ok: true, mtime: 123 });

    await expect(retryPendingCaptures()).resolves.toEqual({
      saved: [pending],
      remaining: [],
    });
    await expect(loadPendingCaptures()).resolves.toEqual([]);
  });

  it('keeps unsynced captures after the first retry failure', async () => {
    const first = await queueQuickCapture('first', { pathDate: date, contentDate: date });
    const second = await queueQuickCapture('second', { pathDate: date, contentDate: date });
    apiMocks.getFileContent.mockRejectedValueOnce(new apiMocks.ApiError(500, 'Server down'));

    const result = await retryPendingCaptures();

    expect(result.saved).toEqual([]);
    expect(result.remaining).toEqual([first, second]);
    expect(result.failed).toEqual(first);
    expect(result.error).toBeInstanceOf(QuickCaptureReadError);
    await expect(loadPendingCaptures()).resolves.toEqual([first, second]);
  });
});

it('keeps a corrupted queue intact instead of overwriting it with a new note', async () => {
  const { workspaceKey } = await import('@/lib/workspace-storage');
  const key = workspaceKey('mindos_quick_capture_pending_queue');
  storage.set(key, 'corrupted but recoverable bytes');
  await expect(queueQuickCapture('new note')).rejects.toThrow();
  expect(storage.get(key)).toBe('corrupted but recoverable bytes');
});
it('reuses the pending capture id after an acknowledged write is retried', async () => {
  storage.clear();
  const pending = await queueQuickCapture('exactly once');
  apiMocks.getFileContent.mockResolvedValue({ content: `# Inbox\nexactly once\n<!-- mindos-capture:${pending.id} -->\n`, mtime: 2 });
  apiMocks.saveFile.mockClear(); apiMocks.createFile.mockClear();
  const result = await retryPendingCaptures();
  expect(result.remaining).toEqual([]); expect(apiMocks.saveFile).not.toHaveBeenCalled(); expect(apiMocks.createFile).not.toHaveBeenCalled();
});
it('rereads the inbox after a version conflict and preserves the other device edit', async () => {
  storage.clear(); apiMocks.saveFile.mockReset(); apiMocks.getFileContent.mockReset();
  await queueQuickCapture('from phone');
  apiMocks.getFileContent.mockResolvedValueOnce({ content: '# Inbox\n', mtime: 1 }).mockResolvedValueOnce({ content: '# Inbox\nfrom desktop\n', mtime: 2 });
  apiMocks.saveFile.mockResolvedValueOnce({ ok: false, error: 'conflict' }).mockResolvedValueOnce({ ok: true, mtime: 3 });
  expect((await retryPendingCaptures()).remaining).toEqual([]);
  expect(apiMocks.saveFile.mock.calls[1][1]).toContain('from desktop');
  expect(apiMocks.saveFile.mock.calls[1][1]).toContain('from phone');
  expect(apiMocks.saveFile.mock.calls[1][2]).toBe(2);
});
it('retains the original entry timestamp when syncing in a different timezone', async () => {
  storage.clear(); apiMocks.getFileContent.mockReset(); apiMocks.saveFile.mockReset();
  const captured = await queueQuickCapture('travel note', { pathDate: new Date(2026, 8, 12, 23, 58), contentDate: new Date(2026, 8, 12, 23, 58) });
  const time = vi.spyOn(Date.prototype, 'getHours').mockReturnValue(9);
  apiMocks.getFileContent.mockResolvedValue({ content: '# Inbox\n', mtime: 1 }); apiMocks.saveFile.mockResolvedValue({ ok: true, mtime: 2 });
  try { await retryPendingCaptures(); expect(apiMocks.saveFile.mock.calls[0][0]).toBe(captured.inboxPath); expect(apiMocks.saveFile.mock.calls[0][1]).toContain('[23:58] travel note'); }
  finally { time.mockRestore() }
});
it('keeps another workspace outbox isolated while switching servers', async () => {
  storage.clear(); const { setWorkspaceIdentity, getWorkspaceIdentity } = await import('@/lib/workspace-storage');
  setWorkspaceIdentity('https://one.test', 'a'); const original = getWorkspaceIdentity(); await queueQuickCapture('private draft');
  setWorkspaceIdentity('https://two.test', 'b');
  expect(await loadPendingCaptures()).toEqual([]); expect(await loadPendingCaptures(original)).toHaveLength(1);
  setWorkspaceIdentity('');
});
