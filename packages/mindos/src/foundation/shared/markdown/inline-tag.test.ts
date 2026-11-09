import { describe, expect, it } from 'vitest';
import { parseInlineTags } from './inline-tag.js';

const tags = (content: string) => parseInlineTags(content).map((t) => t.tag);

describe('parseInlineTags', () => {
  describe('normal paths', () => {
    it('finds a tag at the start of a line', () => {
      expect(tags('#project notes')).toEqual(['project']);
    });

    it('finds a tag after whitespace', () => {
      expect(tags('see #project here')).toEqual(['project']);
    });

    it('finds several tags', () => {
      expect(tags('#a and #b and #c')).toEqual(['a', 'b', 'c']);
    });

    it('supports nested tags with slashes', () => {
      expect(tags('#work/project/alpha')).toEqual(['work/project/alpha']);
    });

    it('supports hyphens and underscores', () => {
      expect(tags('#my-tag #my_tag')).toEqual(['my-tag', 'my_tag']);
    });

    it('supports unicode tags', () => {
      expect(tags('#中文标签 #日本語')).toEqual(['中文标签', '日本語']);
    });

    it('finds a tag directly after punctuation, including full-width', () => {
      // CJK prose abuts punctuation with no space; a "after whitespace" rule
      // would miss most real Chinese usage.
      expect(tags('标签：#project')).toEqual(['project']);
      expect(tags('（#tag）')).toEqual(['tag']);
      expect(tags('“#quoted”')).toEqual(['quoted']);
      expect(tags('(#paren) [#bracket] -#dash')).toEqual(['paren', 'bracket', 'dash']);
    });

    it('rejects a hash glued to a CJK word, same as C#', () => {
      // The rule is "not after a word character" in any script, so a hash with
      // no separator belongs to the preceding word.
      expect(tags('见#标签')).toEqual([]);
      expect(tags('C# F#')).toEqual([]);
    });

    it('reports the offsets of the whole tag including the hash', () => {
      const [found] = parseInlineTags('see #project here');
      expect(found).toMatchObject({ tag: 'project', index: 4, length: 8 });
      expect('see #project here'.slice(found!.index, found!.index + found!.length)).toBe('#project');
    });

    it('allows a tag containing digits as long as it is not all digits', () => {
      expect(tags('#q1 #2024plan #v2')).toEqual(['q1', '2024plan', 'v2']);
    });
  });

  describe('boundary cases', () => {
    it('ignores a purely numeric hash, as Obsidian does', () => {
      // `#1` is an issue reference or an ordinal in prose, not a tag.
      expect(tags('issue #1 and #2024 and #42')).toEqual([]);
    });

    it('ignores a markdown heading', () => {
      expect(tags('# Heading\n## Another')).toEqual([]);
    });

    it('ignores a hash with no following word characters', () => {
      expect(tags('# \n#\n#!')).toEqual([]);
    });

    it('ignores a hash glued to the end of a word', () => {
      expect(tags('C#, F# and item#3')).toEqual([]);
    });

    it('stops a tag at punctuation', () => {
      expect(tags('#project, #other. #third!')).toEqual(['project', 'other', 'third']);
    });

    it('handles an empty document', () => {
      expect(tags('')).toEqual([]);
      expect(tags('   \n\n ')).toEqual([]);
    });

    it('finds a tag at the very end with no trailing newline', () => {
      expect(tags('trailing #tag')).toEqual(['tag']);
    });

    it('does not treat a url fragment as a tag', () => {
      expect(tags('see https://example.com/page#section')).toEqual([]);
    });

    it('does not treat a wiki link subpath as a tag', () => {
      // `[[#Local]]` is a same-file link, and `[` is not a word character, so
      // the lookbehind alone would let it through.
      expect(tags('[[#Local Section]]')).toEqual([]);
      expect(tags('[[Note#Heading]]')).toEqual([]);
      expect(tags('![[Note#^block-id]]')).toEqual([]);
    });

    it('does not treat a markdown link fragment as a tag', () => {
      expect(tags('[label](#anchor)')).toEqual([]);
      expect(tags('[label](Target.md#^block-id)')).toEqual([]);
    });

    it('still finds a tag next to a wiki link', () => {
      expect(tags('[[Note#Heading]] #project')).toEqual(['project']);
    });
  });

  describe('error paths', () => {
    it('does not throw on odd input', () => {
      for (const odd of ['#'.repeat(500), '#\u0000bad', '###', '#/', '#-']) {
        expect(() => parseInlineTags(odd)).not.toThrow();
      }
    });

    it('ignores a tag made only of separators', () => {
      expect(tags('#/ #- #_')).toEqual([]);
    });

    it('tolerates a very long tag', () => {
      const long = 'a'.repeat(300);
      expect(tags(`#${long}`)).toEqual([long]);
    });
  });
});
