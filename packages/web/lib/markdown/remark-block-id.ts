import type { Root } from 'mdast';

/**
 * Hide Obsidian block id markers and turn them into anchors.
 *
 * Obsidian lets a block carry an id by ending it with `^some-id`, which it uses
 * as the target of `[[note#^some-id]]`. The marker is bookkeeping, not prose —
 * Obsidian does not display it, but without this transform it renders as literal
 * `^some-id` text at the end of the paragraph.
 *
 * The id becomes `id="block-<id>"` on the block element so a wiki link with a
 * block subpath can scroll to it, and the visible marker is removed.
 */

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
};

/** Blocks that may carry an id in Obsidian. */
const ANCHORABLE = new Set(['paragraph', 'listItem', 'heading', 'blockquote', 'table']);

// A marker is `^id` at the very end, preceded by whitespace. Obsidian ids are
// alphanumerics, hyphens and underscores; anything else is ordinary text.
const MARKER_RE = /\s\^([A-Za-z0-9_-]+)$/;

/**
 * Strip a trailing block id from `node`'s last text descendant and return it.
 * Returns null when the block does not end in a marker.
 */
function takeTrailingId(node: MdNode): string | null {
  const children = node.children;
  if (!children || children.length === 0) return null;

  // Headings and paragraphs hold inline children directly; a listItem wraps them
  // in a paragraph, so descend through the last block child first.
  const last = children[children.length - 1]!;
  if (last.type === 'paragraph') return takeTrailingId(last);
  if (last.type !== 'text' || typeof last.value !== 'string') return null;

  const match = MARKER_RE.exec(last.value);
  if (!match) return null;

  const stripped = last.value.slice(0, match.index);
  if (stripped.length === 0) children.pop();
  else last.value = stripped;

  return match[1]!;
}

function walk(node: MdNode): void {
  for (const child of node.children ?? []) {
    if (child.type === 'code' || child.type === 'inlineCode' || child.type === 'html') continue;

    if (ANCHORABLE.has(child.type)) {
      const id = takeTrailingId(child);
      if (id) {
        const existing = (child.data?.hProperties ?? {}) as Record<string, unknown>;
        child.data = { ...child.data, hProperties: { ...existing, id: `block-${id}` } };
      }
    }
    walk(child);
  }
}

export default function remarkBlockId() {
  return (tree: Root): void => {
    walk(tree as unknown as MdNode);
  };
}
