import { describe, expect, it } from 'vitest';
import type { Root } from 'mdast';
import remarkCallout from '@/lib/markdown/remark-callout';

type AnyNode = { type: string; value?: string; children?: AnyNode[]; data?: Record<string, any> };

const text = (value: string): AnyNode => ({ type: 'text', value });
const para = (...children: AnyNode[]): AnyNode => ({ type: 'paragraph', children });
const quote = (...children: AnyNode[]): AnyNode => ({ type: 'blockquote', children });
const root = (...children: AnyNode[]): Root => ({ type: 'root', children } as unknown as Root);

function run(tree: Root): AnyNode {
  remarkCallout()(tree);
  return tree as unknown as AnyNode;
}

const firstChild = (tree: AnyNode): AnyNode => tree.children![0]!;

describe('remarkCallout', () => {
  describe('normal paths', () => {
    it('marks a callout blockquote with its type', () => {
      const out = firstChild(run(root(quote(para(text('[!note] Title\nbody'))))));
      expect(out.data?.hProperties).toMatchObject({ 'data-callout': 'note' });
      expect(out.data?.hProperties?.className).toContain('callout');
    });

    it('lifts the title into its own node', () => {
      const out = firstChild(run(root(quote(para(text('[!warning] Be careful\nbody'))))));
      const title = out.children![0]!;
      expect(title.data?.hName).toBe('div');
      expect(title.data?.hProperties?.className).toContain('callout-title');
      expect(title.children![0]).toMatchObject({ value: 'Be careful' });
    });

    it('keeps the body after the title', () => {
      const out = firstChild(run(root(quote(para(text('[!note] Title\nbody text'))))));
      expect(out.children).toHaveLength(2);
      expect(out.children![1]!.children![0]).toMatchObject({ value: 'body text' });
    });

    it('lowercases the callout type', () => {
      const out = firstChild(run(root(quote(para(text('[!WARNING] t'))))));
      expect(out.data?.hProperties).toMatchObject({ 'data-callout': 'warning' });
    });

    it('falls back to the type as title when none is given', () => {
      const out = firstChild(run(root(quote(para(text('[!tip]\nbody'))))));
      expect(out.children![0]!.children![0]).toMatchObject({ value: 'tip' });
    });

    it('records the fold marker', () => {
      const collapsed = firstChild(run(root(quote(para(text('[!note]- Title'))))));
      expect(collapsed.data?.hProperties).toMatchObject({ 'data-callout-fold': '-' });
      const expanded = firstChild(run(root(quote(para(text('[!note]+ Title'))))));
      expect(expanded.data?.hProperties).toMatchObject({ 'data-callout-fold': '+' });
    });

    it('preserves inline nodes that follow the title text', () => {
      const out = firstChild(run(root(quote(para(
        text('[!note] Title\nsee '),
        { type: 'link', url: 'x.md', children: [text('x')] },
      )))));
      const body = out.children![1]!;
      expect(body.children!.map((n) => n.type)).toEqual(['text', 'link']);
    });

    it('handles callouts nested in a list', () => {
      const tree = run(root({
        type: 'list',
        children: [{ type: 'listItem', children: [quote(para(text('[!note] T')))] }],
      }));
      const nested = tree.children![0]!.children![0]!.children![0]!;
      expect(nested.data?.hProperties).toMatchObject({ 'data-callout': 'note' });
    });
  });

  describe('boundary cases', () => {
    it('leaves an ordinary blockquote untouched', () => {
      const out = firstChild(run(root(quote(para(text('just a quote'))))));
      expect(out.data).toBeUndefined();
      expect(out.children![0]!.type).toBe('paragraph');
    });

    it('drops an empty body paragraph', () => {
      const out = firstChild(run(root(quote(para(text('[!note] Title'))))));
      expect(out.children).toHaveLength(1);
      expect(out.children![0]!.data?.hProperties?.className).toContain('callout-title');
    });

    it('ignores a marker that is not at the start', () => {
      const out = firstChild(run(root(quote(para(text('text [!note] Title'))))));
      expect(out.data).toBeUndefined();
    });

    it('accepts a type containing a hyphen', () => {
      const out = firstChild(run(root(quote(para(text('[!my-type] T'))))));
      expect(out.data?.hProperties).toMatchObject({ 'data-callout': 'my-type' });
    });

    it('trims whitespace around the title', () => {
      const out = firstChild(run(root(quote(para(text('[!note]   Spaced   \nbody'))))));
      expect(out.children![0]!.children![0]).toMatchObject({ value: 'Spaced' });
    });

    it('omits the fold attribute when there is no marker', () => {
      const out = firstChild(run(root(quote(para(text('[!note] T'))))));
      expect(out.data?.hProperties?.['data-callout-fold']).toBeUndefined();
    });
  });

  describe('error paths', () => {
    it('ignores a blockquote whose first child is not a paragraph', () => {
      const out = firstChild(run(root(quote({ type: 'code', value: '[!note] x' }))));
      expect(out.data).toBeUndefined();
    });

    it('ignores an empty blockquote', () => {
      expect(() => run(root(quote()))).not.toThrow();
      expect(firstChild(run(root(quote()))).data).toBeUndefined();
    });

    it('ignores a paragraph whose first child is not text', () => {
      const out = firstChild(run(root(quote(para({ type: 'inlineCode', value: '[!note] x' })))));
      expect(out.data).toBeUndefined();
    });

    it('tolerates an empty tree', () => {
      expect(() => run(root())).not.toThrow();
    });
  });
});
