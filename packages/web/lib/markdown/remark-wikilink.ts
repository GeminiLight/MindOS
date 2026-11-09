import type { Root } from 'mdast';
import { parseWikiLinksInLine } from '@geminilight/mindos/foundation/markdown';

/**
 * Render Obsidian `[[wiki links]]` in the reading view.
 *
 * The transform emits plain mdast `link` / `image` nodes rather than custom node
 * types, so the existing `a` / `img` components in `MarkdownView` keep handling
 * navigation (`resolveMarkdownInternalHref`) and asset paths (`resolveImagePath`)
 * with no extra wiring.
 *
 * Parsing is shared with the link index via `parseWikiLinksInLine`, so what the
 * reader sees as a link and what the graph counts as an edge cannot drift apart.
 * Code blocks need no special handling here: remark has already split them into
 * `code` / `inlineCode` nodes, which this transform skips.
 */

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  title?: string | null;
  children?: MdNode[];
  data?: Record<string, unknown>;
};

/** Node types whose text content is literal and must never become a link. */
const OPAQUE_NODES = new Set(['code', 'inlineCode', 'math', 'inlineMath', 'html', 'yaml', 'toml']);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico']);

function isImageTarget(target: string): boolean {
  const extension = target.split('.').pop()?.toLowerCase();
  return extension !== undefined && IMAGE_EXTENSIONS.has(extension);
}

/** Obsidian links omit the `.md` extension; the href resolver expects it. */
function toMarkdownPath(target: string): string {
  return /\.md$/i.test(target) ? target : `${target}.md`;
}

function buildNode(link: ReturnType<typeof parseWikiLinksInLine>[number]): MdNode {
  const { target, alias, subpath, isEmbed } = link;

  if (isEmbed && target && isImageTarget(target)) {
    return { type: 'image', url: target, alt: alias ?? target };
  }

  // A link with only a subpath points inside the current document.
  if (!target && subpath) {
    return {
      type: 'link',
      url: `#${subpath.value}`,
      children: [{ type: 'text', value: alias ?? subpath.value }],
      data: { hProperties: { 'data-wikilink': '' } },
    };
  }

  // `remark-block-id` anchors each block that carries an `^id` as
  // `id="block-<id>"`, so a block subpath can target it like a heading does.
  const isBlockRef = subpath?.type === 'block';
  const fragment = subpath ? `#${isBlockRef ? `block-${subpath.value}` : subpath.value}` : '';
  const label = alias ?? (subpath && !isBlockRef ? `${target} > ${subpath.value}` : target);

  const hProperties: Record<string, string> = { 'data-wikilink': target };
  if (isBlockRef && subpath) hProperties['data-wikilink-block'] = subpath.value;
  if (isEmbed) hProperties['data-wikilink-embed'] = 'true';
  // Carried so a lifted note embed can ask for just one section.
  if (subpath) hProperties['data-wikilink-subpath'] = `${subpath.type}:${subpath.value}`;

  return {
    type: 'link',
    url: `${toMarkdownPath(target)}${fragment}`,
    children: [{ type: 'text', value: label }],
    data: { hProperties },
  };
}

/** Split one text node into text/link/image nodes. Returns null when unchanged. */
function splitTextNode(node: MdNode): MdNode[] | null {
  const value = node.value ?? '';
  if (!value.includes('[[')) return null;

  const links = parseWikiLinksInLine(value);
  if (links.length === 0) return null;

  const out: MdNode[] = [];
  let cursor = 0;

  for (const link of links) {
    if (link.index > cursor) {
      out.push({ type: 'text', value: value.slice(cursor, link.index) });
    }
    out.push(buildNode(link));
    cursor = link.index + link.length;
  }

  if (cursor < value.length) out.push({ type: 'text', value: value.slice(cursor) });
  return out;
}

/**
 * A note embed that is the only thing in its paragraph becomes a block, so the
 * reading view can render transcluded content there. An embed mixed into a
 * sentence stays inline (a block element inside `<p>` is invalid nesting).
 */
function liftNoteEmbed(paragraph: MdNode): MdNode | null {
  if (paragraph.type !== 'paragraph') return null;
  const children = paragraph.children ?? [];
  if (children.length !== 1) return null;

  const only = children[0]!;
  const props = only.data?.hProperties as Record<string, string> | undefined;
  if (only.type !== 'link' || props?.['data-wikilink-embed'] !== 'true') return null;

  return {
    type: 'wikiNoteEmbed',
    data: {
      hName: 'div',
      hProperties: {
        'data-wikilink-note-embed': props['data-wikilink'] ?? '',
        ...(props['data-wikilink-subpath'] ? { 'data-wikilink-subpath': props['data-wikilink-subpath'] } : {}),
      },
    },
    children: only.children,
  };
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
    // Do not rewrite the label of an existing link into another link.
    if (child.type !== 'link' && child.type !== 'linkReference') transformChildren(child);

    const lifted = liftNoteEmbed(child);
    if (lifted) {
      next.push(lifted);
      changed = true;
      continue;
    }
    next.push(child);
  }

  if (changed) parent.children = next;
}

export default function remarkWikiLink() {
  return (tree: Root): void => {
    transformChildren(tree as unknown as MdNode);
  };
}
