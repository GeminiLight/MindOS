import type { Root } from 'mdast';
import { parseInlineTags } from '@geminilight/mindos/foundation/markdown';

/**
 * Render Obsidian inline tags (`#tag`) as chips.
 *
 * Without this they are plain text in the reading view. Parsing is shared with
 * the link index via `parseInlineTags`, so the graph's tag list and what the
 * reader sees cannot disagree — including that `#1` is prose, not a tag.
 *
 * Emits a `link` node with `data-tag`; `MarkdownView` turns it into a chip that
 * opens search for that tag. Code and inline code are already separate mdast
 * node types, so they are skipped for free.
 */

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
};

const OPAQUE_NODES = new Set(['code', 'inlineCode', 'math', 'inlineMath', 'html', 'yaml', 'toml']);

/** Split one text node into text/tag nodes. Returns null when unchanged. */
function splitTextNode(node: MdNode): MdNode[] | null {
  const value = node.value ?? '';
  if (!value.includes('#')) return null;

  const found = parseInlineTags(value);
  if (found.length === 0) return null;

  const out: MdNode[] = [];
  let cursor = 0;

  for (const tag of found) {
    if (tag.index > cursor) out.push({ type: 'text', value: value.slice(cursor, tag.index) });
    out.push({
      type: 'link',
      // Tags have no vault path; the href is a marker the component replaces.
      url: '#',
      children: [{ type: 'text', value: `#${tag.tag}` }],
      data: { hProperties: { 'data-tag': tag.tag } },
    });
    cursor = tag.index + tag.length;
  }

  if (cursor < value.length) out.push({ type: 'text', value: value.slice(cursor) });
  return out;
}

function transformChildren(parent: MdNode): void {
  const children = parent.children;
  if (!children || children.length === 0) return;

  const next: MdNode[] = [];
  let changed = false;

  for (const child of children) {
    if (OPAQUE_NODES.has(child.type)) {
      next.push(child);
      continue;
    }
    if (child.type === 'text') {
      const split = splitTextNode(child);
      if (split) {
        next.push(...split);
        changed = true;
        continue;
      }
      next.push(child);
      continue;
    }
    // A tag inside a link label would nest an anchor in an anchor.
    if (child.type !== 'link' && child.type !== 'linkReference') transformChildren(child);
    next.push(child);
  }

  if (changed) parent.children = next;
}

export default function remarkInlineTag() {
  return (tree: Root): void => {
    transformChildren(tree as unknown as MdNode);
  };
}
