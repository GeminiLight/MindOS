import yaml from 'js-yaml';
import type { BlockCache, EmbedCache, FrontmatterLinkCache, HeadingCache, LinkCache, ListItemCache, Pos, SectionCache, TagCache } from './types';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/;
const TAG_RE = /(^|\s)(#([\p{L}\p{N}_/-]+))/gu;
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;
const WIKI_REFERENCE_RE = /(!)?\[\[([^\]]+)\]\]/g;
const MARKDOWN_REFERENCE_RE = /(!)?\[([^\]]*)\]\((?!https?:\/\/|mailto:|obsidian:)([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
const BLOCK_ID_RE = /\s\^([A-Za-z0-9_-]+)\s*$/;
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([^\]])\]\s+)?(.+)$/;

type Positioner = (startOffset: number, endOffset: number) => Pos;

interface LineInfo {
  line: number;
  text: string;
  start: number;
  end: number;
}

interface ParsedReferences {
  links: LinkCache[];
  embeds: EmbedCache[];
}

interface IgnoredRange {
  start: number;
  end: number;
}

function parseFrontmatter(content: string): Record<string, unknown> | undefined {
  const match = content.match(FRONTMATTER_RE);
  if (!match?.[1]) {
    return undefined;
  }

  try {
    const parsed = yaml.load(match[1]);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function createPositioner(content: string): Positioner {
  const lineStarts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') {
      lineStarts.push(index + 1);
    }
  }

  const toLoc = (offset: number) => {
    const boundedOffset = Math.max(0, Math.min(offset, content.length));
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const start = lineStarts[middle] ?? 0;
      const nextStart = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;
      if (boundedOffset < start) {
        high = middle - 1;
      } else if (boundedOffset >= nextStart) {
        low = middle + 1;
      } else {
        return {
          line: middle,
          col: boundedOffset - start,
          offset: boundedOffset,
        };
      }
    }
    const fallbackLine = Math.max(0, lineStarts.length - 1);
    return {
      line: fallbackLine,
      col: boundedOffset - (lineStarts[fallbackLine] ?? 0),
      offset: boundedOffset,
    };
  };

  return (startOffset, endOffset) => ({
    start: toLoc(startOffset),
    end: toLoc(endOffset),
  });
}

function splitLines(content: string): LineInfo[] {
  const rawLines = content.split('\n');
  const lines: LineInfo[] = [];
  let offset = 0;
  for (let line = 0; line < rawLines.length; line += 1) {
    const raw = rawLines[line] ?? '';
    const text = raw.replace(/\r$/, '');
    lines.push({
      line,
      text,
      start: offset,
      end: offset + text.length,
    });
    offset += raw.length + (line < rawLines.length - 1 ? 1 : 0);
  }
  return lines;
}

function collectIgnoredMarkdownRanges(content: string): IgnoredRange[] {
  const ranges: IgnoredRange[] = [];
  const frontmatter = content.match(FRONTMATTER_RE);
  if (frontmatter) {
    ranges.push({ start: 0, end: frontmatter[0].length });
  }

  let inFence = false;
  let fenceStart = 0;
  for (const line of splitLines(content)) {
    if (frontmatter && line.start < frontmatter[0].length) {
      continue;
    }
    if (!line.text.trim().match(/^(```|~~~)/)) {
      continue;
    }
    if (inFence) {
      ranges.push({ start: fenceStart, end: line.end });
      inFence = false;
    } else {
      inFence = true;
      fenceStart = line.start;
    }
  }
  if (inFence) {
    ranges.push({ start: fenceStart, end: content.length });
  }

  const inlineCodeRe = /`[^`\n]+`/g;
  for (const match of content.matchAll(inlineCodeRe)) {
    ranges.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + (match[0]?.length ?? 0),
    });
  }
  return ranges.sort((a, b) => a.start - b.start);
}

function maskRanges(content: string, ranges: IgnoredRange[]): string {
  if (!ranges.length) return content;
  const chars = content.split('');
  for (const range of ranges) {
    for (let index = range.start; index < range.end && index < chars.length; index += 1) {
      if (chars[index] !== '\n' && chars[index] !== '\r') {
        chars[index] = ' ';
      }
    }
  }
  return chars.join('');
}

function parseTags(content: string, position: Positioner): TagCache[] {
  const tags = new Map<string, TagCache>();
  for (const match of content.matchAll(TAG_RE)) {
    const index = match.index ?? 0;
    const tagOffset = index + (match[1]?.length ?? 0);
    if (match[2]) {
      tags.set(match[2], {
        tag: match[2],
        position: position(tagOffset, tagOffset + match[2].length),
      });
    }
  }
  return Array.from(tags.values());
}

function parseHeadings(content: string, position: Positioner): HeadingCache[] {
  return Array.from(content.matchAll(HEADING_RE)).map((match) => ({
    heading: match[2]?.trim() ?? '',
    level: match[1]?.length ?? 1,
    position: position(match.index ?? 0, (match.index ?? 0) + (match[0]?.length ?? 0)),
  }));
}

function normalizeReferenceLink(link: string): string {
  return link.trim().replace(/\.md(?=$|#)/i, '');
}

export function stripSubpath(link: string): string {
  return link.split('#')[0]?.trim() ?? link.trim();
}

function parseWikiReferenceBody(body: string): { link: string; displayText?: string } | null {
  const [rawLink = '', rawDisplayText] = body.split('|');
  const link = normalizeReferenceLink(rawLink);
  if (!link) return null;
  const displayText = rawDisplayText?.trim();
  return displayText ? { link, displayText } : { link };
}

function parseReferences(content: string, position: Positioner): ParsedReferences {
  const links: LinkCache[] = [];
  const embeds: EmbedCache[] = [];

  for (const match of content.matchAll(WIKI_REFERENCE_RE)) {
    const original = match[0];
    const parsed = parseWikiReferenceBody(match[2] ?? '');
    if (parsed && original) {
      const reference = {
        ...parsed,
        original,
        position: position(match.index ?? 0, (match.index ?? 0) + original.length),
      };
      if (match[1]) {
        embeds.push(reference);
      } else {
        links.push(reference);
      }
    }
  }

  for (const match of content.matchAll(MARKDOWN_REFERENCE_RE)) {
    const original = match[0];
    const link = normalizeReferenceLink(match[3] ?? '');
    if (link && original) {
      const displayText = match[2]?.trim() || undefined;
      const reference = {
        link,
        original,
        ...(displayText ? { displayText } : {}),
        position: position(match.index ?? 0, (match.index ?? 0) + original.length),
      };
      if (match[1]) {
        embeds.push(reference);
      } else {
        links.push(reference);
      }
    }
  }

  return { links, embeds };
}

function parseMarkdownBody(content: string, position: Positioner): ParsedReferences & {
  tags: TagCache[];
  headings: HeadingCache[];
  listItems: ListItemCache[];
  blocks: Record<string, BlockCache> | undefined;
} {
  const masked = maskRanges(content, collectIgnoredMarkdownRanges(content));
  const references = parseReferences(masked, position);
  return {
    ...references,
    tags: parseTags(masked, position),
    headings: parseHeadings(masked, position),
    listItems: parseListItems(masked, position),
    blocks: parseBlocks(masked, position),
  };
}

function parseFrontmatterPosition(content: string, position: Positioner): Pos | undefined {
  const match = content.match(FRONTMATTER_RE);
  return match ? position(0, match[0].length) : undefined;
}

function parseFrontmatterLinks(content: string): FrontmatterLinkCache[] | undefined {
  const match = content.match(FRONTMATTER_RE);
  if (!match?.[1]) return undefined;
  const links: FrontmatterLinkCache[] = [];
  let currentKey = '';
  const rawFrontmatter = match[1];
  for (const line of rawFrontmatter.split(/\r?\n/)) {
    const keyMatch = line.match(/^\s*([A-Za-z0-9_.-]+):/);
    if (keyMatch?.[1]) {
      currentKey = keyMatch[1];
    }
    if (!currentKey) continue;
    const references = parseReferences(line, createPositioner(line));
    for (const reference of [...references.links, ...references.embeds]) {
      links.push({
        key: currentKey,
        link: reference.link,
        original: reference.original,
        ...(reference.displayText ? { displayText: reference.displayText } : {}),
      });
    }
  }
  return links.length ? links : undefined;
}

function lineSectionType(line: string, inFence: boolean): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (inFence) return 'code';
  if (/^#{1,6}\s+/.test(trimmed)) return 'heading';
  if (/^>\s*\[![^\]]+\]/.test(trimmed)) return 'callout';
  if (/^>/.test(trimmed)) return 'blockquote';
  if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) return 'list';
  if (/^(\|.+\|)$/.test(trimmed)) return 'table';
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return 'thematicBreak';
  if (/^<[^>]+>/.test(trimmed)) return 'html';
  return 'paragraph';
}

function parseSections(content: string, position: Positioner): SectionCache[] {
  const sections: SectionCache[] = [];
  const frontmatter = content.match(FRONTMATTER_RE);
  if (frontmatter) {
    sections.push({
      type: 'yaml',
      position: position(0, frontmatter[0].length),
    });
  }

  let inFence = false;
  for (const line of splitLines(content)) {
    if (frontmatter && line.start < frontmatter[0].length) {
      continue;
    }
    const trimmed = line.text.trim();
    const fenceMatch = trimmed.match(/^(```|~~~)/);
    const type = lineSectionType(line.text, inFence);
    if (type) {
      const blockId = line.text.match(BLOCK_ID_RE)?.[1];
      sections.push({
        type,
        ...(blockId ? { id: blockId } : {}),
        position: position(line.start, line.end),
      });
    }
    if (fenceMatch) {
      inFence = !inFence;
    }
  }
  return sections;
}

function parseListItems(content: string, position: Positioner): ListItemCache[] {
  const items: ListItemCache[] = [];
  const stack: Array<{ indent: number; line: number }> = [];
  for (const line of splitLines(content)) {
    const match = line.text.match(LIST_ITEM_RE);
    if (!match) continue;
    const indent = match[1]?.length ?? 0;
    while (stack.length && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    const parent = stack.length ? stack[stack.length - 1]!.line : -line.line;
    const blockId = line.text.match(BLOCK_ID_RE)?.[1];
    const task = match[3];
    items.push({
      parent,
      ...(blockId ? { id: blockId } : {}),
      ...(task !== undefined ? { task } : {}),
      position: position(line.start, line.end),
    });
    stack.push({ indent, line: line.line });
  }
  return items;
}

function parseBlocks(content: string, position: Positioner): Record<string, BlockCache> | undefined {
  const blocks: Record<string, BlockCache> = {};
  for (const line of splitLines(content)) {
    const blockId = line.text.match(BLOCK_ID_RE)?.[1];
    if (blockId) {
      blocks[blockId] = {
        id: blockId,
        position: position(line.start, line.end),
      };
    }
  }
  return Object.keys(blocks).length ? blocks : undefined;
}

/** Shared pure parser: the server and isolated browser must not diverge. */
export function parseMarkdownMetadata(content: string) {
  const position = createPositioner(content);
  const body = parseMarkdownBody(content, position);
  return {
    frontmatter: parseFrontmatter(content),
    frontmatterPosition: parseFrontmatterPosition(content, position),
    frontmatterLinks: parseFrontmatterLinks(content),
    ...body,
    sections: parseSections(content, position),
  };
}
