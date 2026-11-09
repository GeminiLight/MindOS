import type { Root } from 'mdast';

/**
 * Render Obsidian callouts (`> [!note] Title`) in the reading view.
 *
 * Obsidian writes callouts as ordinary blockquotes whose first line carries a
 * `[!type]` marker, so without this transform they degrade to plain quotes. The
 * transform only annotates the existing blockquote — type and fold state become
 * data attributes and the title is lifted into its own node — leaving the visual
 * treatment to CSS in `globals.css`.
 */

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
};

// `[!type]` optionally followed by a fold marker and a title, on the first line.
const CALLOUT_RE = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/;

function annotate(blockquote: MdNode): void {
  const [first, ...restChildren] = blockquote.children ?? [];
  if (first?.type !== 'paragraph') return;

  const [leading, ...restInline] = first.children ?? [];
  if (leading?.type !== 'text' || typeof leading.value !== 'string') return;

  const newlineIndex = leading.value.indexOf('\n');
  const firstLine = newlineIndex === -1 ? leading.value : leading.value.slice(0, newlineIndex);
  const remainder = newlineIndex === -1 ? '' : leading.value.slice(newlineIndex + 1);

  const match = CALLOUT_RE.exec(firstLine);
  if (!match) return;

  const [, rawType = '', fold = '', rawTitle = ''] = match;
  const type = rawType.toLowerCase();
  const title = rawTitle.trim() || type;

  const titleNode: MdNode = {
    type: 'paragraph',
    children: [{ type: 'text', value: title }],
    data: { hName: 'div', hProperties: { className: ['callout-title'] } },
  };

  // Whatever followed the title line stays as the callout body. Inline siblings
  // (links, emphasis, …) must be preserved even when the text remainder is empty.
  const bodyChildren: MdNode[] = [];
  if (remainder) bodyChildren.push({ type: 'text', value: remainder });
  bodyChildren.push(...restInline);

  const body: MdNode[] = bodyChildren.length > 0 ? [{ type: 'paragraph', children: bodyChildren }] : [];

  blockquote.children = [titleNode, ...body, ...restChildren];
  blockquote.data = {
    ...blockquote.data,
    hProperties: {
      className: ['callout'],
      'data-callout': type,
      ...(fold ? { 'data-callout-fold': fold } : {}),
    },
  };
}

function walk(node: MdNode): void {
  if (node.type === 'blockquote') annotate(node);
  for (const child of node.children ?? []) walk(child);
}

export default function remarkCallout() {
  return (tree: Root): void => {
    walk(tree as unknown as MdNode);
  };
}
