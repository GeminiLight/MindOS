/**
 * Obsidian Plugin Compatibility - MetadataCache Shim
 * Extracts frontmatter, tags, headings and links from markdown files.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Events } from '../events';
import type { CachedMetadata, IMetadataCache, TFile, IVault } from '../types';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const TAG_RE = /(^|\s)(#([\p{L}\p{N}_/-]+))/gu;
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const MARKDOWN_LINK_RE = /\[[^\]]+\]\((?!https?:\/\/)([^)#]+)(?:#[^)]+)?\)/g;

function readMarkdownFile(mindRoot: string, file: TFile): string | null {
  try {
    return fs.readFileSync(path.join(mindRoot, file.path), 'utf-8');
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

function parseTags(content: string): Array<{ tag: string }> {
  const tags = new Set<string>();
  for (const match of content.matchAll(TAG_RE)) {
    if (match[2]) {
      tags.add(match[2]);
    }
  }
  return Array.from(tags).map((tag) => ({ tag }));
}

function parseHeadings(content: string): Array<{ heading: string; level: number }> {
  return Array.from(content.matchAll(HEADING_RE)).map((match) => ({
    heading: match[2]?.trim() ?? '',
    level: match[1]?.length ?? 1,
  }));
}

function parseLinks(content: string): Array<{ link: string; original: string }> {
  const links = new Map<string, { link: string; original: string }>();

  for (const match of content.matchAll(WIKILINK_RE)) {
    const link = match[1]?.trim();
    const original = match[0];
    if (link && original) {
      links.set(`${original}:${link}`, { link, original });
    }
  }

  for (const match of content.matchAll(MARKDOWN_LINK_RE)) {
    const link = match[1]?.trim();
    const original = match[0];
    if (link && original) {
      const normalized = link.replace(/\.md$/, '');
      links.set(`${original}:${normalized}`, { link: normalized, original });
    }
  }

  return Array.from(links.values());
}

export class MetadataCacheShim extends Events implements IMetadataCache {
  resolvedLinks: Record<string, Record<string, number>> = {};
  unresolvedLinks: Record<string, Record<string, number>> = {};

  constructor(
    private mindRoot: string,
    private vault: IVault,
  ) {
    super();
    this.buildGlobalIndex();
  }

  /**
   * Build global index of resolved and unresolved links across all files.
   * This populates resolvedLinks and unresolvedLinks properties.
   */
  buildGlobalIndex(): void {
    this.resolvedLinks = {};
    this.unresolvedLinks = {};

    const markdownFiles = this.vault.getMarkdownFiles();

    for (const file of markdownFiles) {
      this.indexFileLinks(file);
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

    // Parse wikilinks - count all occurrences
    for (const match of content.matchAll(WIKILINK_RE)) {
      const linkText = match[1]?.trim();
      if (!linkText) continue;

      const destFile = this.getFirstLinkpathDest(linkText, sourcePath);
      if (destFile) {
        const destPath = destFile.path;
        resolvedMap[destPath] = (resolvedMap[destPath] ?? 0) + 1;
      } else {
        unresolvedMap[linkText] = (unresolvedMap[linkText] ?? 0) + 1;
      }
    }

    // Parse markdown links - count all occurrences
    for (const match of content.matchAll(MARKDOWN_LINK_RE)) {
      const linkText = match[1]?.trim();
      if (!linkText) continue;

      const normalized = linkText.replace(/\.md$/, '');
      const destFile = this.getFirstLinkpathDest(normalized, sourcePath);
      if (destFile) {
        const destPath = destFile.path;
        resolvedMap[destPath] = (resolvedMap[destPath] ?? 0) + 1;
      } else {
        unresolvedMap[normalized] = (unresolvedMap[normalized] ?? 0) + 1;
      }
    }

    // Store results if non-empty
    if (Object.keys(resolvedMap).length > 0) {
      this.resolvedLinks[sourcePath] = resolvedMap;
    }
    if (Object.keys(unresolvedMap).length > 0) {
      this.unresolvedLinks[sourcePath] = unresolvedMap;
    }
  }

  /**
   * Update global index for a specific file.
   * Call this when a file is created, modified, or deleted.
   */
  updateFileIndex(file: TFile): void {
    const sourcePath = file.path;

    // Remove old entries for this file
    delete this.resolvedLinks[sourcePath];
    delete this.unresolvedLinks[sourcePath];

    // Rebuild entries for this file
    this.indexFileLinks(file);
  }

  /**
   * Invalidate and rebuild the entire global index.
   * Call this when files are renamed or deleted, as it may affect link resolution.
   */
  invalidateGlobalIndex(): void {
    this.buildGlobalIndex();
  }

  getFileCache(file: TFile): CachedMetadata | null {
    const content = readMarkdownFile(this.mindRoot, file);
    if (content === null) {
      return null;
    }

    return {
      frontmatter: parseFrontmatter(content),
      tags: parseTags(content),
      headings: parseHeadings(content),
      links: parseLinks(content),
    };
  }

  getCache(filePath: string): CachedMetadata | null {
    const file = this.vault.getFileByPath(filePath);
    return file ? this.getFileCache(file) : null;
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    void sourcePath;
    const normalized = linkpath.replace(/\.md$/, '');
    const markdownFiles = this.vault.getMarkdownFiles();

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
}
