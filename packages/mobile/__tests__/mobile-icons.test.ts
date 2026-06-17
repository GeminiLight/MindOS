import { describe, expect, it } from 'vitest';
import { getFileNodeIcon } from '@/lib/mobile-icons';

describe('mobile-icons', () => {
  it('uses directory and Space-specific icons', () => {
    expect(getFileNodeIcon({ type: 'directory', extension: undefined, isSpace: true })).toBe('layers-outline');
    expect(getFileNodeIcon({ type: 'directory', extension: undefined, isSpace: false })).toBe('folder-outline');
  });

  it('uses specific file icons for structured and media files', () => {
    expect(getFileNodeIcon({ type: 'file', extension: '.csv' })).toBe('grid-outline');
    expect(getFileNodeIcon({ type: 'file', extension: '.tsv' })).toBe('grid-outline');
    expect(getFileNodeIcon({ type: 'file', extension: '.tsx' })).toBe('code-slash-outline');
    expect(getFileNodeIcon({ type: 'file', extension: '.png' })).toBe('image-outline');
  });

  it('falls back to a note icon for unknown file extensions', () => {
    expect(getFileNodeIcon({ type: 'file', extension: '.md' })).toBe('document-text-outline');
    expect(getFileNodeIcon({ type: 'file', extension: undefined })).toBe('document-text-outline');
  });
});
