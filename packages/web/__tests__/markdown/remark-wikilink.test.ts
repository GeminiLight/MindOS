import { describe, expect, it } from 'vitest';
import type { Root } from 'mdast';
import remarkWikiLink from '@/lib/markdown/remark-wikilink';

type AnyNode = { type: string; value?: string; url?: string; alt?: string; children?: AnyNode[]; data?: Record<string, unknown> };

/** Minimal mdast builders — enough to exercise the transformer without a parser. */
const text = (value: string): AnyNode => ({ type: 'text', value });
const para = (...children: AnyNode[]): AnyNode => ({ type: 'paragraph', children });
const root = (...children: AnyNode[]): Root => ({ type: 'root', children } as unknown as Root);

function run(tree: Root): AnyNode {
  remarkWikiLink()(tree);
  return tree as unknown as AnyNode;
}

function firstParagraph(tree: AnyNode): AnyNode[] {
  return tree.children?.[0]?.children ?? [];
}

describe('remarkWikiLink', () => {
  describe('normal paths', () => {
    it('turns a bare wiki link into a relative markdown link', () => {
      const out = firstParagraph(run(root(para(text('see [[Target]] here')))));
      expect(out.map((n) => n.type)).toEqual(['text', 'link', 'text']);
      expect(out[1]).toMatchObject({ url: 'Target.md' });
      expect(out[1]?.children?.[0]).toMatchObject({ type: 'text', value: 'Target' });
      expect(out[0]).toMatchObject({ value: 'see ' });
      expect(out[2]).toMatchObject({ value: ' here' });
    });

    it('uses the alias as link text but keeps the target in the url', () => {
      const out = firstParagraph(run(root(para(text('[[Target|Display]]')))));
      expect(out[0]).toMatchObject({ url: 'Target.md' });
      expect(out[0]?.children?.[0]).toMatchObject({ value: 'Display' });
    });

    it('keeps an existing .md extension instead of doubling it', () => {
      const out = firstParagraph(run(root(para(text('[[Target.md]]')))));
      expect(out[0]).toMatchObject({ url: 'Target.md' });
    });

    it('appends a heading subpath as a url fragment', () => {
      const out = firstParagraph(run(root(para(text('[[Target#Some Heading]]')))));
      expect(out[0]).toMatchObject({ url: 'Target.md#Some Heading' });
      expect(out[0]?.children?.[0]).toMatchObject({ value: 'Target > Some Heading' });
    });

    it('links a block reference to the anchor remark-block-id emits', () => {
      const out = firstParagraph(run(root(para(text('[[Target#^abc123]]')))));
      expect(out[0]).toMatchObject({ url: 'Target.md#block-abc123' });
      expect(out[0]?.data?.hProperties).toMatchObject({ 'data-wikilink-block': 'abc123' });
    });

    it('treats a bare subpath as an in-page anchor', () => {
      const out = firstParagraph(run(root(para(text('[[#Some Heading]]')))));
      expect(out[0]).toMatchObject({ type: 'link', url: '#Some Heading' });
    });

    it('turns an image embed into an image node', () => {
      const out = firstParagraph(run(root(para(text('![[diagram.png]]')))));
      expect(out[0]).toMatchObject({ type: 'image', url: 'diagram.png', alt: 'diagram.png' });
    });

    it('uses the alias as alt text for an image embed', () => {
      const out = firstParagraph(run(root(para(text('![[diagram.png|A diagram]]')))));
      expect(out[0]).toMatchObject({ type: 'image', alt: 'A diagram' });
    });

    it('marks every produced link with a data attribute', () => {
      const out = firstParagraph(run(root(para(text('[[Target]]')))));
      expect(out[0]?.data?.hProperties).toMatchObject({ 'data-wikilink': 'Target' });
    });

    it('handles several links in one text node', () => {
      const out = firstParagraph(run(root(para(text('[[One]] x [[Two]]')))));
      expect(out.map((n) => n.type)).toEqual(['link', 'text', 'link']);
      expect(out.map((n) => n.url).filter(Boolean)).toEqual(['One.md', 'Two.md']);
    });

    it('recurses into nested containers', () => {
      const tree = run(root({ type: 'blockquote', children: [para(text('[[Target]]'))] }));
      const inner = tree.children?.[0]?.children?.[0]?.children ?? [];
      expect(inner[0]).toMatchObject({ type: 'link', url: 'Target.md' });
    });
  });

  describe('boundary cases', () => {
    it('leaves text without wiki links untouched', () => {
      const node = text('plain text');
      const out = firstParagraph(run(root(para(node))));
      expect(out).toEqual([{ type: 'text', value: 'plain text' }]);
    });

    it('does not descend into code or inlineCode nodes', () => {
      const tree = run(root(
        { type: 'code', value: '[[Target]]' },
        para({ type: 'inlineCode', value: '[[Target]]' }),
      ));
      expect(tree.children?.[0]).toMatchObject({ type: 'code', value: '[[Target]]' });
      expect(firstParagraph({ children: [tree.children![1]!] })[0]).toMatchObject({
        type: 'inlineCode',
        value: '[[Target]]',
      });
    });

    it('ignores a backslash-escaped link', () => {
      const out = firstParagraph(run(root(para(text('\\[[Target]]')))));
      expect(out.map((n) => n.type)).toEqual(['text']);
    });

    it('drops no surrounding whitespace when a link spans the whole node', () => {
      const out = firstParagraph(run(root(para(text('[[Target]]')))));
      expect(out).toHaveLength(1);
    });

    it('keeps unicode and emoji targets verbatim', () => {
      const out = firstParagraph(run(root(para(text('[[中文笔记]] ![[图 🎉.png]]')))));
      expect(out[0]).toMatchObject({ url: '中文笔记.md' });
      expect(out[2]).toMatchObject({ type: 'image', url: '图 🎉.png' });
    });

    it('lifts a standalone non-image embed into a block note embed', () => {
      const out = run(root(para(text('![[Other Note]]'))));
      const node = out.children![0]!;
      expect(node.type).toBe('wikiNoteEmbed');
      expect(node.data?.hName).toBe('div');
      expect(node.data?.hProperties).toMatchObject({ 'data-wikilink-note-embed': 'Other Note' });
    });

    it('keeps an inline non-image embed as a link', () => {
      const out = firstParagraph(run(root(para(text('see ![[Other Note]] here')))));
      expect(out.map((n) => n.type)).toEqual(['text', 'link', 'text']);
      expect(out[1]?.data?.hProperties).toMatchObject({ 'data-wikilink-embed': 'true' });
    });

    it('carries the subpath on a lifted embed', () => {
      const out = run(root(para(text('![[Other#Section]]'))));
      expect(out.children![0]!.data?.hProperties).toMatchObject({
        'data-wikilink-subpath': 'heading:Section',
      });
    });

    it('recognises common image extensions case-insensitively', () => {
      const out = firstParagraph(run(root(para(text('![[A.PNG]] ![[b.svg]] ![[c.webp]]')))));
      expect(out.filter((n) => n.type === 'image')).toHaveLength(3);
    });
  });

  describe('error paths', () => {
    it('leaves an unterminated link as plain text', () => {
      const out = firstParagraph(run(root(para(text('[[Target')))));
      expect(out).toEqual([{ type: 'text', value: '[[Target' }]);
    });

    it('leaves an empty link as plain text', () => {
      const out = firstParagraph(run(root(para(text('[[]]')))));
      expect(out).toEqual([{ type: 'text', value: '[[]]' }]);
    });

    it('tolerates a node with no children', () => {
      expect(() => run(root({ type: 'paragraph' }))).not.toThrow();
    });

    it('tolerates an empty tree', () => {
      expect(() => run(root())).not.toThrow();
    });
  });
});
