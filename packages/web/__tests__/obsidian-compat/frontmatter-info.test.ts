import { describe, expect, it } from 'vitest';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';

describe('getFrontMatterInfo plugin export', () => {
  it('returns frontmatter offsets and a body offset usable by capture commands', () => {
    const { getFrontMatterInfo } = createObsidianModule();
    const text = '---\ntitle: x\n---\nBody';
    const info = getFrontMatterInfo(text);
    expect(info).toEqual({ exists: true, frontmatter: 'title: x', from: 4, to: 12, contentStart: 17 });
    expect(text.slice(info.from, info.to)).toBe(info.frontmatter);
    expect(text.slice(info.contentStart)).toBe('Body');
    expect(text.slice(0, info.contentStart) + 'Captured\n' + text.slice(info.contentStart))
      .toBe('---\ntitle: x\n---\nCaptured\nBody');
  });

  it.each(['', 'Body', '---\nunclosed', 'text\n---\na: b\n---\n', '---\na: b\n---not-a-fence\nBody'])
    ('does not strip body content without a complete leading frontmatter block: %j', text => {
      expect(createObsidianModule().getFrontMatterInfo(text)).toEqual({
        exists: false, frontmatter: '', from: 0, to: 0, contentStart: 0,
      });
    });

  it.each(['---\n---\n', '---\r\n---', '\uFEFF---\r\ntitle: 中😀\r\n---\r\n'])
    ('supports empty blocks, EOF fences, BOM and CRLF without reserializing: %j', text => {
      const info = createObsidianModule().getFrontMatterInfo(text);
      expect(info.exists).toBe(true);
      expect(info.contentStart).toBe(text.length);
      expect(info.frontmatter).toBe(text.slice(info.from, info.to));
    });

  it('locates malformed YAML without interpreting or dropping its raw contents', () => {
    const info = createObsidianModule().getFrontMatterInfo('---\ntitle: [unfinished\n---\nBody');
    expect(info.frontmatter).toBe('title: [unfinished');
    expect(info.exists).toBe(true);
  });
});
