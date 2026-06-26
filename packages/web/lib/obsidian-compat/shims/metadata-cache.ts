/**
 * Obsidian Plugin Compatibility - MetadataCache Shim
 * Extracts frontmatter, tags, headings and links from markdown files.
 */

import fs from 'fs';
import yaml from 'js-yaml';
import { Events } from '../events';
import type { ObsidianRuntimeHost } from '../runtime';
import type {
  BlockCache,
  CachedMetadata,
  EmbedCache,
  FrontmatterLinkCache,
  HeadingCache,
  IMetadataCache,
  LinkCache,
  ListItemCache,
  Pos,
  SectionCache,
  TagCache,
  TAbstractFile,
  TFile,
  IVault,
} from '../types';
import { resolveExistingSafe } from '@/lib/core/security';
import { normalizeObsidianTag, parseFrontMatterTagValues } from './tags';

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

function readMarkdownFile(mindRoot: string, file: TFile): string | null {
  try {
    return fs.readFileSync(resolveExistingSafe(mindRoot, file.path), 'utf-8');
  } catch {
    return null;
  }
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

function stripSubpath(link: string): string {
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

export class MetadataCacheShim extends Events implements IMetadataCache {
  private resolvedLinksCache: Record<string, Record<string, number>> = {};
  private unresolvedLinksCache: Record<string, Record<string, number>> = {};
  private fileMetadataCache = new Map<string, CachedMetadata | null>();
  private globalIndexBuilt = false;
  private markdownFileSnapshot: TFile[] | null = null;

  constructor(
    private mindRoot: string,
    private vault: IVault,
    private readonly runtimeHost?: ObsidianRuntimeHost,
  ) {
    super();
    this.bindVaultEvents();
  }

  get resolvedLinks(): Record<string, Record<string, number>> {
    this.ensureGlobalIndex();
    return this.resolvedLinksCache;
  }

  get unresolvedLinks(): Record<string, Record<string, number>> {
    this.ensureGlobalIndex();
    return this.unresolvedLinksCache;
  }

  /**
   * Build global index of resolved and unresolved links across all files.
   * This populates resolvedLinks and unresolvedLinks properties.
   */
  buildGlobalIndex(): void {
    this.resolvedLinksCache = {};
    this.unresolvedLinksCache = {};

    this.markdownFileSnapshot = this.vault.getMarkdownFiles();
    try {
      for (const file of this.markdownFileSnapshot) {
        this.indexFileLinks(file);
      }
      this.globalIndexBuilt = true;
    } finally {
      this.markdownFileSnapshot = null;
    }
  }

  private ensureGlobalIndex(): void {
    if (!this.globalIndexBuilt) {
      this.buildGlobalIndex();
    }
  }

  /**
   * Index all links in a file (helper for buildGlobalIndex and updateFileIndex).
   * Parses content directly to count all link occurrences, not just unique links.
   */
  private indexFileLinks(file: TFile): void {
    const content = readMarkdownFile(this.mindRoot, file);
    if (!content) {
      return;
    }

    const sourcePath = file.path;
    const resolvedMap: Record<string, number> = {};
    const unresolvedMap: Record<string, number> = {};

    const body = parseMarkdownBody(content, createPositioner(content));
    for (const reference of [...body.links, ...body.embeds]) {
      const linkText = stripSubpath(reference.link);
      if (!linkText) continue;
      const destFile = this.getFirstLinkpathDest(linkText, sourcePath);
      if (destFile) {
        const destPath = destFile.path;
        resolvedMap[destPath] = (resolvedMap[destPath] ?? 0) + 1;
      } else {
        unresolvedMap[linkText] = (unresolvedMap[linkText] ?? 0) + 1;
      }
    }

    // Store results if non-empty
    if (Object.keys(resolvedMap).length > 0) {
      this.resolvedLinksCache[sourcePath] = resolvedMap;
    }
    if (Object.keys(unresolvedMap).length > 0) {
      this.unresolvedLinksCache[sourcePath] = unresolvedMap;
    }
  }

  /**
   * Update global index for a specific file.
   * Call this when a file is created, modified, or deleted.
   */
  updateFileIndex(file: TFile): void {
    if (!this.globalIndexBuilt) {
      return;
    }

    const sourcePath = file.path;

    // Remove old entries for this file
    delete this.resolvedLinksCache[sourcePath];
    delete this.unresolvedLinksCache[sourcePath];

    // Rebuild entries for this file
    this.markdownFileSnapshot = this.vault.getMarkdownFiles();
    try {
      this.indexFileLinks(file);
    } finally {
      this.markdownFileSnapshot = null;
    }
  }

  /**
   * Invalidate and rebuild the entire global index.
   * Call this when files are renamed or deleted, as it may affect link resolution.
   */
  invalidateGlobalIndex(): void {
    this.buildGlobalIndex();
  }

  private bindVaultEvents(): void {
    this.vault.on('create', (file: TAbstractFile) => {
      if (!isMarkdownFile(file)) return;
      this.invalidateIfBuilt();
      this.triggerChanged(file);
      this.triggerResolvedFile(file);
    });
    this.vault.on('modify', (file: TAbstractFile) => {
      if (!isMarkdownFile(file)) return;
      this.updateFileIndex(file);
      this.triggerChanged(file);
      this.triggerResolvedFile(file);
    });
    this.vault.on('delete', (file: TAbstractFile) => {
      if (!isMarkdownLikePath(file.path)) return;
      const prevCache = this.fileMetadataCache.get(file.path) ?? null;
      this.fileMetadataCache.delete(file.path);
      this.invalidateIfBuilt();
      this.trigger('deleted', file, prevCache);
      this.trigger('resolved');
    });
    this.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (!isMarkdownLikePath(file.path) && !isMarkdownLikePath(oldPath)) return;
      this.fileMetadataCache.delete(oldPath);
      this.invalidateIfBuilt();
      if (isMarkdownFile(file)) {
        this.triggerChanged(file);
        this.triggerResolvedFile(file);
      } else {
        this.trigger('resolved');
      }
    });
  }

  private invalidateIfBuilt(): void {
    if (this.globalIndexBuilt) {
      this.invalidateGlobalIndex();
    }
  }

  private triggerChanged(file: TFile): void {
    const content = readMarkdownFile(this.mindRoot, file) ?? '';
    this.trigger('changed', file, content, this.getFileCache(file));
  }

  private triggerResolvedFile(file: TFile): void {
    this.trigger('resolve', file);
    this.trigger('resolved');
  }

  getFileCache(file: TFile): CachedMetadata | null {
    this.recordCapability('MetadataCache.getFileCache', `Plugin read metadata for "${file.path}".`);
    const content = readMarkdownFile(this.mindRoot, file);
    if (content === null) {
      return null;
    }

    const position = createPositioner(content);
    const body = parseMarkdownBody(content, position);
    const cache = {
      frontmatter: parseFrontmatter(content),
      frontmatterPosition: parseFrontmatterPosition(content, position),
      frontmatterLinks: parseFrontmatterLinks(content),
      tags: body.tags,
      headings: body.headings,
      links: body.links,
      embeds: body.embeds,
      sections: parseSections(content, position),
      listItems: body.listItems,
      blocks: body.blocks,
    };
    this.fileMetadataCache.set(file.path, cache);
    return cache;
  }

  getCache(filePath: string): CachedMetadata | null {
    this.recordCapability('MetadataCache.getCache', `Plugin read metadata for "${filePath}".`);
    const file = this.vault.getFileByPath(filePath);
    return file ? this.getFileCache(file) : null;
  }

  getCachedFiles(): string[] {
    this.recordCapability('MetadataCache.getCachedFiles', 'Plugin listed cached Markdown files.');
    return this.vault.getMarkdownFiles().map((file) => file.path);
  }

  getTags(): Record<string, number> {
    this.recordCapability('MetadataCache.getTags', 'Plugin listed indexed tags.');
    const tags: Record<string, number> = {};
    const count = (value: unknown) => {
      const tag = normalizeObsidianTag(value);
      if (!tag) return;
      tags[tag] = (tags[tag] ?? 0) + 1;
    };

    for (const file of this.vault.getMarkdownFiles()) {
      const cache = this.getFileCache(file);
      for (const tag of parseFrontMatterTagValues(cache?.frontmatter) ?? []) {
        count(tag);
      }
      for (const tag of cache?.tags ?? []) {
        count(tag.tag);
      }
    }
    return tags;
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    void sourcePath;
    const normalized = linkpath.replace(/\.md$/, '');
    const markdownFiles = this.markdownFileSnapshot ?? this.vault.getMarkdownFiles();

    return (
      markdownFiles.find((file) => file.path.replace(/\.md$/, '') === normalized) ??
      markdownFiles.find((file) => file.basename === normalized) ??
      null
    );
  }

  fileToLinktext(file: TFile, sourcePath: string, omitMdExtension?: boolean): string {
    void sourcePath;
    if (omitMdExtension && file.extension === 'md') {
      return file.path.replace(/\.md$/, '');
    }
    return file.path;
  }

  private recordCapability(capability: string, evidence: string): void {
    this.runtimeHost?.recordRuntimeCapability(
      this.runtimeHost.getCurrentPluginId(),
      capability,
      'called',
      evidence,
    );
  }
}

function isMarkdownLikePath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.md');
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  const extension = (file as Partial<TFile>).extension;
  return typeof extension === 'string' && extension.toLowerCase() === 'md';
}
