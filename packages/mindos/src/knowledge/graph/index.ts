/**
 * @mindos/graph - Link indexing and backlinks for knowledge graphs
 *
 * Provides bidirectional link indexing for:
 * - Forward links (source → targets)
 * - Backward links (target → sources)
 * - Wiki-link and markdown-link extraction
 * - Incremental updates
 */

import * as path from 'path';
import { Result, ok, err } from '../../foundation/shared/index.js';
import { AppError, createError } from '../../foundation/errors/index.js';
import { IFileSystem } from '../storage/index.js';

export interface LinkEdge {
  source: string;
  target: string;
}

export interface LinkIndexStats {
  fileCount: number;
  linkCount: number;
  builtForRoot: string | null;
}

/**
 * In-memory bidirectional link index for the knowledge graph.
 */
export class LinkIndex {
  private forwardLinks = new Map<string, Set<string>>();  // source → targets
  private backwardLinks = new Map<string, Set<string>>(); // target → sources
  private builtForRoot: string | null = null;
  private fileSet = new Set<string>();
  private basenameMap = new Map<string, string[]>();
  private fileSystem: IFileSystem;

  constructor(fileSystem: IFileSystem) {
    this.fileSystem = fileSystem;
  }

  /**
   * Full rebuild: read all .md files and extract links.
   */
  async rebuild(rootPath: string): Promise<Result<void>> {
    try {
      // Get all markdown files recursively
      const allFiles = await this.getAllMarkdownFiles(rootPath);

      const fileSet = new Set(allFiles);
      const basenameMap = this.buildBasenameMap(allFiles);

      const forward = new Map<string, Set<string>>();
      const backward = new Map<string, Set<string>>();

      // Extract links from each file
      for (const filePath of allFiles) {
        const contentResult = await this.fileSystem.readFile(filePath);
        if (!contentResult.ok) continue;

        const targets = this.extractLinks(
          contentResult.value,
          filePath,
          fileSet,
          basenameMap
        );

        const targetSet = new Set<string>();
        for (const t of targets) {
          if (t !== filePath) targetSet.add(t); // skip self-links
        }
        forward.set(filePath, targetSet);

        // Build backward links
        for (const t of targetSet) {
          let sources = backward.get(t);
          if (!sources) {
            sources = new Set();
            backward.set(t, sources);
          }
          sources.add(filePath);
        }
      }

      this.forwardLinks = forward;
      this.backwardLinks = backward;
      this.builtForRoot = rootPath;
      this.fileSet = fileSet;
      this.basenameMap = basenameMap;

      return ok(undefined);
    } catch (error) {
      return err(
        createError(
          'INTERNAL_ERROR',
          'Failed to rebuild link index',
          { context: { rootPath }, cause: error as Error }
        )
      );
    }
  }

  /**
   * Recursively get all markdown files in a directory.
   */
  private async getAllMarkdownFiles(dirPath: string): Promise<string[]> {
    const result: string[] = [];
    const queue: string[] = [dirPath];

    while (queue.length > 0) {
      const currentPath = queue.shift()!;
      const entriesResult = await this.fileSystem.readdir(currentPath);

      if (!entriesResult.ok) continue;

      for (const entry of entriesResult.value) {
        if (entry.isDirectory) {
          queue.push(entry.path);
        } else if (entry.isFile && entry.name.endsWith('.md')) {
          result.push(entry.path);
        }
      }
    }

    return result;
  }

  /**
   * Clear the index.
   */
  invalidate(): void {
    this.forwardLinks.clear();
    this.backwardLinks.clear();
    this.builtForRoot = null;
    this.fileSet.clear();
    this.basenameMap.clear();
  }

  /**
   * Check if index is built for the given root.
   */
  isBuiltFor(rootPath: string): boolean {
    return this.builtForRoot === rootPath;
  }

  /**
   * Check if index is built.
   */
  isBuilt(): boolean {
    return this.builtForRoot !== null;
  }

  /**
   * Get all files that sourcePath links to.
   */
  getForwardLinks(sourcePath: string): string[] {
    return Array.from(this.forwardLinks.get(sourcePath) ?? []);
  }

  /**
   * Get all files that link to targetPath.
   */
  getBacklinks(targetPath: string): string[] {
    return Array.from(this.backwardLinks.get(targetPath) ?? []);
  }

  /**
   * Get all edges as [source, target] pairs.
   */
  getAllEdges(): LinkEdge[] {
    const edges: LinkEdge[] = [];
    for (const [source, targets] of this.forwardLinks.entries()) {
      for (const target of targets) {
        edges.push({ source, target });
      }
    }
    return edges;
  }

  /**
   * Get index statistics.
   */
  getStats(): LinkIndexStats {
    let linkCount = 0;
    for (const targets of this.forwardLinks.values()) {
      linkCount += targets.size;
    }
    return {
      fileCount: this.fileSet.size,
      linkCount,
      builtForRoot: this.builtForRoot,
    };
  }

  /**
   * Remove a file's links from the index.
   */
  removeFile(filePath: string): void {
    // Remove forward links and corresponding backward entries
    const oldTargets = this.forwardLinks.get(filePath);
    if (oldTargets) {
      for (const t of oldTargets) {
        this.backwardLinks.get(t)?.delete(filePath);
      }
      this.forwardLinks.delete(filePath);
    }

    // Remove as a target in backward links
    const oldSources = this.backwardLinks.get(filePath);
    if (oldSources) {
      for (const s of oldSources) {
        this.forwardLinks.get(s)?.delete(filePath);
      }
      this.backwardLinks.delete(filePath);
    }

    // Remove from cached resolution sets
    this.fileSet.delete(filePath);
    const key = path.basename(filePath).toLowerCase();
    const candidates = this.basenameMap.get(key);
    if (candidates) {
      const idx = candidates.indexOf(filePath);
      if (idx >= 0) candidates.splice(idx, 1);
      if (candidates.length === 0) this.basenameMap.delete(key);
    }
  }

  /**
   * Add or re-index a single file.
   */
  async updateFile(filePath: string): Promise<Result<void>> {
    if (!this.builtForRoot) {
      return err(
        createError(
          'VALIDATION_ERROR',
          'Index not built',
          { context: { filePath } }
        )
      );
    }

    if (!filePath.endsWith('.md')) {
      return ok(undefined);
    }

    try {
      // Remove old links
      const oldTargets = this.forwardLinks.get(filePath);
      if (oldTargets) {
        for (const t of oldTargets) {
          this.backwardLinks.get(t)?.delete(filePath);
        }
      }

      // Re-extract links
      const contentResult = await this.fileSystem.readFile(filePath);
      if (!contentResult.ok) {
        return err(contentResult.error);
      }

      // Ensure file is in resolution sets
      if (!this.fileSet.has(filePath)) {
        this.fileSet.add(filePath);
        const key = path.basename(filePath).toLowerCase();
        if (!this.basenameMap.has(key)) {
          this.basenameMap.set(key, []);
        }
        this.basenameMap.get(key)!.push(filePath);
      }

      const targets = this.extractLinks(
        contentResult.value,
        filePath,
        this.fileSet,
        this.basenameMap
      );

      const targetSet = new Set<string>();
      for (const t of targets) {
        if (t !== filePath) targetSet.add(t);
      }
      this.forwardLinks.set(filePath, targetSet);

      // Update backward links
      for (const t of targetSet) {
        let sources = this.backwardLinks.get(t);
        if (!sources) {
          sources = new Set();
          this.backwardLinks.set(t, sources);
        }
        sources.add(filePath);
      }

      return ok(undefined);
    } catch (error) {
      return err(
        createError(
          'INTERNAL_ERROR',
          'Failed to update file in link index',
          { context: { filePath }, cause: error as Error }
        )
      );
    }
  }

  // Private methods

  private buildBasenameMap(allFiles: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const f of allFiles) {
      const key = path.basename(f).toLowerCase();
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(f);
    }
    return map;
  }

  private extractLinks(
    content: string,
    sourcePath: string,
    fileSet: Set<string>,
    basenameMap: Map<string, string[]>
  ): string[] {
    const targets: string[] = [];
    const sourceDir = path.dirname(sourcePath);

    // WikiLinks: [[target]] or [[target|alias]] or [[target#section]]
    const wikiRe = /\[\[([^\]|#]+)(?:[|#][^\]]*)?/g;
    let m: RegExpExecArray | null;
    while ((m = wikiRe.exec(content)) !== null) {
      const raw = m[1]?.trim();
      if (!raw) continue;

      // Try exact match
      if (fileSet.has(raw)) {
        targets.push(raw);
        continue;
      }

      // Try with .md extension
      const withMd = raw.endsWith('.md') ? raw : raw + '.md';
      if (fileSet.has(withMd)) {
        targets.push(withMd);
        continue;
      }

      // Try basename lookup
      const lower = path.basename(withMd).toLowerCase();
      const candidates = basenameMap.get(lower);
      if (candidates && candidates.length === 1 && candidates[0]) {
        targets.push(candidates[0]);
      }
    }

    // Markdown links: [text](relative/path.md)
    const mdLinkRe = /\[[^\]]+\]\(([^)]+\.md)(?:#[^)]*)?\)/g;
    while ((m = mdLinkRe.exec(content)) !== null) {
      const raw = m[1]?.trim();
      if (!raw || raw.startsWith('http')) continue;

      const resolved = path.normalize(path.join(sourceDir, raw));
      if (fileSet.has(resolved)) {
        targets.push(resolved);
      }
    }

    return targets;
  }
}

/**
 * Create a LinkIndex instance.
 */
export function createLinkIndex(fileSystem: IFileSystem): LinkIndex {
  return new LinkIndex(fileSystem);
}
