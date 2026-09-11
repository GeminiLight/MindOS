import type {
  BlockCache,
  CachedMetadata,
  HeadingCache,
  ListItemCache,
  Loc,
  Pos,
} from '../types';

export interface SubpathResult {
  start: Loc;
  end: Loc | null;
}

export interface HeadingSubpathResult extends SubpathResult {
  type: 'heading';
  current: HeadingCache;
  next?: HeadingCache;
}

export interface BlockSubpathResult extends SubpathResult {
  type: 'block';
  block: BlockCache;
  list?: ListItemCache;
}

export interface FootnoteCache {
  id: string;
  position: Pos;
}

export interface FootnoteSubpathResult extends SubpathResult {
  type: 'footnote';
  footnote: FootnoteCache;
}

export type ResolvedSubpath = HeadingSubpathResult | BlockSubpathResult | FootnoteSubpathResult;

/**
 * Resolve a link subpath (`#Heading`, `#^block-id`, `#[^footnote]`) against a
 * `CachedMetadata`, mirroring the official helper.
 *
 * Heading subpaths end at the start of the next heading (any level); the last
 * heading ends with null. Footnote subpaths return null for now because the
 * shared MindOS metadata parser does not index footnotes.
 */
export function resolveSubpath(cache: CachedMetadata, subpath: string): ResolvedSubpath | null {
  if (!cache || typeof subpath !== 'string') return null;
  let target = subpath;
  if (target.startsWith('#')) target = target.slice(1);

  if (target.startsWith('^')) {
    const blockId = target.slice(1);
    const block = blockId ? cache.blocks?.[blockId] : undefined;
    if (!block) return null;
    return {
      type: 'block',
      block,
      start: block.position.start,
      end: block.position.end,
    };
  }

  if (target.startsWith('[^')) {
    // Footnote caches are not produced by the shared parser yet.
    return null;
  }

  const headings = cache.headings ?? [];
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    if (current.heading !== target) continue;
    const next = headings[index + 1];
    return {
      type: 'heading',
      current,
      next,
      start: current.position.start,
      end: next ? next.position.start : null,
    };
  }
  return null;
}
