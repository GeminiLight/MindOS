import { describe, expect, it } from 'vitest';
import { buildConflictCopyPath } from '@/components/editor/markdown-editor-state';

describe('markdown editor state helpers', () => {
  it('builds timestamped markdown conflict copy paths', () => {
    expect(buildConflictCopyPath('Notes/today.md', 12345)).toBe('Notes/today-12345.md');
  });

  it('adds markdown extension when the original path has no markdown suffix', () => {
    expect(buildConflictCopyPath('Notes/today', 12345)).toBe('Notes/today-12345.md');
  });

  it('handles uppercase markdown suffixes', () => {
    expect(buildConflictCopyPath('Notes/today.MD', 12345)).toBe('Notes/today-12345.md');
  });
});
