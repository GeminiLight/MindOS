import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  getErrorStatus,
  getReadErrorMessage,
  resolveReaderErrorMessage,
  shouldShowFileNotFound,
} from '@/lib/view-target-state';

describe('view-target-state', () => {
  it('extracts status from API errors', () => {
    const error = new ApiError(401, 'Unauthorized');
    expect(getErrorStatus(error)).toBe(401);
  });

  it('uses readable error messages for non-404 failures', () => {
    expect(resolveReaderErrorMessage(new ApiError(500, 'Disk unavailable'))).toBe('Disk unavailable');
    expect(resolveReaderErrorMessage(new Error('Network request failed'))).toBe('Network request failed');
  });

  it('only shows File not found for actual 404 reads', () => {
    expect(shouldShowFileNotFound(new ApiError(404, 'Failed to read note.md'))).toBe(true);
    expect(resolveReaderErrorMessage(new ApiError(404, 'Failed to read note.md'))).toBe('File not found');
    expect(shouldShowFileNotFound(new ApiError(403, 'Access denied'))).toBe(false);
  });

  it('falls back for unreadable unknown errors', () => {
    expect(getReadErrorMessage(null)).toBe('Unable to open this item');
  });
});
