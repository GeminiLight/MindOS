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
    ApiError: HoistedApiError,
  };
});

vi.mock('@/lib/api-client', () => ({
  mindosClient: {
    getFileContent: apiMocks.getFileContent,
    saveFile: apiMocks.saveFile,
  },
  ApiError: apiMocks.ApiError,
}));

import {
  QuickCaptureReadError,
  appendCaptureToContent,
  buildInboxPath,
  formatCaptureContent,
  isValidCapture,
  saveQuickCapture,
} from '@/lib/quick-capture';

describe('quick-capture', () => {
  const date = new Date('2026-04-11T09:30:00');

  beforeEach(() => {
    vi.clearAllMocks();
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
    apiMocks.saveFile.mockResolvedValueOnce({ ok: true, mtime: 123 });

    const result = await saveQuickCapture('first note', { pathDate: date, contentDate: date });

    expect(result.inboxPath).toBe('inbox/2026-04-11.md');
    expect(apiMocks.saveFile).toHaveBeenCalledWith(
      'inbox/2026-04-11.md',
      '# Inbox - Saturday, April 11, 2026\n\n[09:30] first note\n',
    );
  });

  it('appends to an existing inbox file', async () => {
    apiMocks.getFileContent.mockResolvedValueOnce({ content: '# Inbox - Saturday, April 11, 2026\n\n[09:00] existing\n' });
    apiMocks.saveFile.mockResolvedValueOnce({ ok: true, mtime: 123 });

    await saveQuickCapture('next note', { pathDate: date, contentDate: date });

    expect(apiMocks.saveFile).toHaveBeenCalledWith(
      'inbox/2026-04-11.md',
      '# Inbox - Saturday, April 11, 2026\n\n[09:00] existing\n[09:30] next note\n',
    );
  });

  it('throws a read error when existing inbox cannot be loaded', async () => {
    apiMocks.getFileContent.mockRejectedValueOnce(new apiMocks.ApiError(500, 'Server error'));

    await expect(saveQuickCapture('note', { pathDate: date })).rejects.toBeInstanceOf(QuickCaptureReadError);
    expect(apiMocks.saveFile).not.toHaveBeenCalled();
  });

  it('throws when save fails', async () => {
    apiMocks.getFileContent.mockRejectedValueOnce(new apiMocks.ApiError(404, 'Not found'));
    apiMocks.saveFile.mockResolvedValueOnce({ ok: false, error: 'disk full' });

    await expect(saveQuickCapture('note', { pathDate: date })).rejects.toThrow('disk full');
  });

  it('throws when capture text is empty', async () => {
    await expect(saveQuickCapture('   ', { pathDate: date })).rejects.toThrow('Capture text cannot be empty');
  });
});
