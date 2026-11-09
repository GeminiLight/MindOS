import { describe, expect, it } from 'vitest';
import type { Root } from 'mdast';
import remarkBlockId from '@/lib/markdown/remark-block-id';

type AnyNode = { type: string; value?: string; children?: AnyNode[]; data?: Record<string, any> };

const text = (value: string): AnyNode => ({ type: 'text', value });
const para = (...children: AnyNode[]): AnyNode => ({ type: 'paragraph', children });
const root = (...children: AnyNode[]): Root => ({ type: 'root', children } as unknown as Root);

function run(tree: Root): AnyNode {
  remarkBlockId()(tree);
  return tree as unknown as AnyNode;
}

const first = (tree: AnyNode): AnyNode => tree.children![0]!;

describe('remarkBlockId', () => {
  describe('normal paths', () => {
    it('hides the block id marker and anchors the block', () => {
      const out = first(run(root(para(text('A paragraph ^block-1')))));
      expect(out.children![0]).toMatchObject({ value: 'A paragraph' });
      expect(out.data?.hProperties).toMatchObject({ id: 'block-block-1' });
    });

    it('anchors a list item', () => {
      const tree = run(root({
        type: 'list',
        children: [{ type: 'listItem', children: [para(text('item ^bid'))] }],
      }));
      const item = tree.children![0]!.children![0]!;
      expect(item.data?.hProperties).toMatchObject({ id: 'block-bid' });
      expect(item.children![0]!.children![0]).toMatchObject({ value: 'item' });
    });

    it('anchors a heading', () => {
      const out = first(run(root({ type: 'heading', depth: 2, children: [text('Title ^hid')] } as AnyNode)));
      expect(out.data?.hProperties).toMatchObject({ id: 'block-hid' });
      expect(out.children![0]).toMatchObject({ value: 'Title' });
    });

    it('keeps ids that mix letters, digits and hyphens', () => {
      const out = first(run(root(para(text('x ^a1-b2')))));
      expect(out.data?.hProperties).toMatchObject({ id: 'block-a1-b2' });
    });

    it('preserves inline siblings before the marker', () => {
      const out = first(run(root(para(
        text('see '),
        { type: 'link', url: 'x.md', children: [text('x')] },
        text(' now ^tail'),
      ))));
      expect(out.data?.hProperties).toMatchObject({ id: 'block-tail' });
      expect(out.children!.map((n) => n.type)).toEqual(['text', 'link', 'text']);
      expect(out.children![2]).toMatchObject({ value: ' now' });
    });
  });

  describe('boundary cases', () => {
    it('leaves a paragraph without a marker untouched', () => {
      const out = first(run(root(para(text('no marker here')))));
      expect(out.data).toBeUndefined();
      expect(out.children![0]).toMatchObject({ value: 'no marker here' });
    });

    it('ignores a caret that is not at the end', () => {
      const out = first(run(root(para(text('a ^mid b')))));
      expect(out.data).toBeUndefined();
      expect(out.children![0]).toMatchObject({ value: 'a ^mid b' });
    });

    it('ignores a caret with no space before it', () => {
      const out = first(run(root(para(text('word^notamarker')))));
      expect(out.data).toBeUndefined();
    });

    it('ignores an empty id', () => {
      const out = first(run(root(para(text('text ^')))));
      expect(out.data).toBeUndefined();
    });

    it('does not touch code blocks or inline code', () => {
      const tree = run(root(
        { type: 'code', value: 'foo ^bid' },
        para({ type: 'inlineCode', value: 'foo ^bid' }),
      ));
      expect(tree.children![0]).toMatchObject({ type: 'code', value: 'foo ^bid' });
      expect(tree.children![1]!.data).toBeUndefined();
    });

    it('drops the text node entirely when the marker was all of it', () => {
      const out = first(run(root(para(
        { type: 'link', url: 'x.md', children: [text('x')] },
        text(' ^only'),
      ))));
      expect(out.data?.hProperties).toMatchObject({ id: 'block-only' });
      expect(out.children!.map((n) => n.type)).toEqual(['link']);
    });

    it('ignores ids with unsupported characters', () => {
      for (const bad of ['^id with space', '^id!', '^中文']) {
        const out = first(run(root(para(text(`x ${bad}`)))));
        expect(out.data, bad).toBeUndefined();
      }
    });
  });

  describe('error paths', () => {
    it('tolerates an empty tree and childless nodes', () => {
      expect(() => run(root())).not.toThrow();
      expect(() => run(root({ type: 'paragraph' }))).not.toThrow();
    });

    it('tolerates a node whose last child is not text', () => {
      const out = first(run(root(para({ type: 'link', url: 'x.md', children: [text('x')] }))));
      expect(out.data).toBeUndefined();
    });
  });
});
