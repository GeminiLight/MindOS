import { describe, expect, it } from 'vitest';
import { buildConflictCopyPath, buildMarkdownDraftKey } from '@/components/editor/markdown-editor-state';

describe('markdown editor state helpers', () => {
  it('isolates identical file paths by server and knowledge root', () => {
    const key = buildMarkdownDraftKey('https://one.test/', 'root-a', '笔记/notes.md');
    expect(key).toBe(buildMarkdownDraftKey('https://one.test', 'root-a', '笔记/notes.md'));
    expect(key).not.toBe(buildMarkdownDraftKey('https://two.test', 'root-a', '笔记/notes.md'));
    expect(key).not.toBe(buildMarkdownDraftKey('https://one.test', 'root-b', '笔记/notes.md'));
    expect(() => buildMarkdownDraftKey('', 'root-a', 'notes.md')).toThrow();
    expect(() => buildMarkdownDraftKey('https://one.test', '', 'notes.md')).toThrow();
  });
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
