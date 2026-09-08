/** Filesystem-backed metadata adapter; parsing is shared with the browser host. */
import fs from 'fs';
import { Events } from '../events';
import type { ObsidianRuntimeHost } from '../runtime';
import type { CachedMetadata, IMetadataCache, TAbstractFile, TFile, IVault } from '../types';
import { resolveExistingSafe } from '@/lib/core/security';
import { normalizeObsidianTag, parseFrontMatterTagValues } from './tags';
import { parseMarkdownMetadata, stripSubpath } from '../markdown-metadata';

function readMarkdownFile(mindRoot: string, file: TFile): string | null {
  try { return fs.readFileSync(resolveExistingSafe(mindRoot, file.path), 'utf-8'); }
  catch { return null; }
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

    const body = parseMarkdownMetadata(content);
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

    const cache = parseMarkdownMetadata(content);
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
