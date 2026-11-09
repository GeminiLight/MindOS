import { describe, expect, it } from 'vitest';
import { buildWikiLinkBasenameMap, resolveWikiLinkTarget } from './resolve-wiki-link.js';

const files = (...paths: string[]) => new Set(paths);
const resolve = (target: string, ...paths: string[]) => {
  const set = files(...paths);
  return resolveWikiLinkTarget(target, set, buildWikiLinkBasenameMap(set));
};

describe('resolveWikiLinkTarget', () => {
  describe('normal paths', () => {
    it('matches an exact path', () => {
      expect(resolve('Notes/A.md', 'Notes/A.md')).toBe('Notes/A.md');
    });

    it('appends .md when the target omits the extension', () => {
      expect(resolve('Notes/A', 'Notes/A.md')).toBe('Notes/A.md');
    });

    it('matches a unique basename from anywhere in the vault', () => {
      expect(resolve('A', 'Deep/Nested/A.md')).toBe('Deep/Nested/A.md');
    });

    it('prefers an exact path over a basename match', () => {
      expect(resolve('A.md', 'A.md', 'Other/A.md')).toBe('A.md');
    });

    it('resolves a non-markdown attachment by exact path', () => {
      expect(resolve('assets/pic.png', 'assets/pic.png')).toBe('assets/pic.png');
    });

    it('resolves an attachment by bare filename without forcing .md', () => {
      expect(resolve('pic.png', 'assets/pic.png')).toBe('assets/pic.png');
      expect(resolve('diagram.svg', 'a/b/diagram.svg')).toBe('a/b/diagram.svg');
    });

    it('prefers an exact path over a basename match across both forms', () => {
      // `Note` exists verbatim as a folder-less file *and* as Deep/Note.md;
      // the exact hit must win.
      expect(resolve('Note.md', 'Note.md', 'Deep/Note.md')).toBe('Note.md');
    });
  });

  describe('boundary cases', () => {
    it('returns null for an empty target', () => {
      expect(resolve('', 'A.md')).toBeNull();
    });

    it('returns null when the vault is empty', () => {
      expect(resolve('A')).toBeNull();
    });

    it('returns null for an ambiguous basename', () => {
      expect(resolve('A', 'One/A.md', 'Two/A.md')).toBeNull();
    });

    it('matches basenames case-insensitively', () => {
      expect(resolve('a', 'Notes/A.md')).toBe('Notes/A.md');
      expect(resolve('NOTES/a', 'Notes/A.md')).toBe('Notes/A.md');
    });

    it('keeps unicode and spaces verbatim', () => {
      expect(resolve('中文笔记', '笔记/中文笔记.md')).toBe('笔记/中文笔记.md');
      expect(resolve('My Note', 'My Note.md')).toBe('My Note.md');
    });

    it('does not treat a folder as a resolvable target', () => {
      expect(resolve('Notes', 'Notes/A.md')).toBeNull();
    });

    it('handles a target that already ends in .md inside a nested path', () => {
      expect(resolve('Deep/A.md', 'Deep/A.md')).toBe('Deep/A.md');
    });
  });

  describe('error paths', () => {
    it('returns null for a target that matches nothing', () => {
      expect(resolve('Missing', 'A.md', 'B.md')).toBeNull();
    });

    it('ignores leading and trailing whitespace', () => {
      expect(resolve('  A  ', 'A.md')).toBe('A.md');
    });

    it('does not throw on odd targets', () => {
      for (const odd of ['../../etc/passwd', '///', '.', '..', '#', '|']) {
        expect(() => resolve(odd, 'A.md')).not.toThrow();
      }
    });
  });
});

describe('buildWikiLinkBasenameMap', () => {
  it('groups paths by lowercased basename', () => {
    const map = buildWikiLinkBasenameMap(files('One/A.md', 'Two/a.md', 'B.md'));
    expect(map.get('a.md')).toEqual(['One/A.md', 'Two/a.md']);
    expect(map.get('b.md')).toEqual(['B.md']);
  });

  it('returns an empty map for an empty vault', () => {
    expect(buildWikiLinkBasenameMap(new Set()).size).toBe(0);
  });
});
