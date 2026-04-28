import path from 'path';
import { collectAllFiles } from './tree';
import { readFile } from './fs-ops';

/**
 * In-memory bidirectional link index for the knowledge graph.
 *
 * Maintains forward links (source → targets) and backward links (target → sources)
 * in a single pass. Used by:
 * - GET /api/graph — forward links for edge rendering
 * - findBacklinks() — backward links for reference discovery
 *
 * Lifecycle:
 * - `rebuild(mindRoot)` — full build from disk (called lazily on first access)
 * - `updateFile(mindRoot, filePath)` — incremental re-index after write
 * - `addFile(mindRoot, filePath)` — incremental add after create
 * - `removeFile(filePath)` — incremental remove after delete
 * - `invalidate()` — mark stale (next access triggers rebuild)
 */
export class LinkIndex {
  private forwardLinks = new Map<string, Set<string>>();  // source → targets
  private backwardLinks = new Map<string, Set<string>>(); // target → sources
  private builtForRoot: string | null = null;
  /** Cached file set and basename map for incremental link resolution. */
  private fileSet = new Set<string>();
  private basenameMap = new Map<string, string[]>();

  /** Full rebuild: read all .md files and extract links. */
  rebuild(mindRoot: string): void {
    const allFiles = collectAllFiles(mindRoot).filter(f => f.endsWith('.md'));
    const fileSet = new Set(allFiles);
    const basenameMap = buildBasenameMap(allFiles);

    const forward = new Map<string, Set<string>>();
    const backward = new Map<string, Set<string>>();

    for (const filePath of allFiles) {
      let content: string;
      try { content = readFile(mindRoot, filePath); } catch { continue; }

      const targets = extractLinks(content, filePath, fileSet, basenameMap);
      const targetSet = new Set<string>();
      for (const t of targets) {
        if (t !== filePath) targetSet.add(t); // skip self-links
      }
      forward.set(filePath, targetSet);

      for (const t of targetSet) {
        let sources = backward.get(t);
        if (!sources) { sources = new Set(); backward.set(t, sources); }
        sources.add(filePath);
      }
    }

    this.forwardLinks = forward;
    this.backwardLinks = backward;
    this.builtForRoot = mindRoot;
    this.fileSet = fileSet;
    this.basenameMap = basenameMap;
  }

  /** Clear the index. Next access triggers lazy rebuild. */
  invalidate(): void {
    this.forwardLinks.clear();
    this.backwardLinks.clear();
    this.builtForRoot = null;
    this.fileSet.clear();
    this.basenameMap.clear();
  }

  isBuiltFor(mindRoot: string): boolean {
    return this.builtForRoot === mindRoot;
  }

  isBuilt(): boolean {
    return this.builtForRoot !== null;
  }

  // ── Queries ────────────────────────────────────────────────────────

  /** Get all files that `sourcePath` links to. O(1). */
  getForwardLinks(sourcePath: string): string[] {
    return [...(this.forwardLinks.get(sourcePath) ?? [])];
  }

  /** Get all files that link to `targetPath`. O(1). */
  getBacklinks(targetPath: string): string[] {
    return [...(this.backwardLinks.get(targetPath) ?? [])];
  }

  /** Get all edges as [source, target] pairs. Used by Graph API. */
  getAllEdges(): Array<{ source: string; target: string }> {
    const edges: Array<{ source: string; target: string }> = [];
    for (const [source, targets] of this.forwardLinks) {
      for (const target of targets) {
        edges.push({ source, target });
      }
    }
    return edges;
  }

  // ── Incremental updates ──────────────────────────────────────────

  /** Remove a file's links from the index. */
  removeFile(filePath: string): void {
    // Remove forward links and corresponding backward entries
    const oldTargets = this.forwardLinks.get(filePath);
    if (oldTargets) {
      for (const t of oldTargets) {
        this.backwardLinks.get(t)?.delete(filePath);
      }
      this.forwardLinks.delete(filePath);
    }

    // Also remove as a target in backward links (file deleted)
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

  /** Add or re-index a single file. */
  updateFile(mindRoot: string, filePath: string): void {
    if (!this.builtForRoot) return;
    if (!filePath.endsWith('.md')) return;

    // Remove old links
    const oldTargets = this.forwardLinks.get(filePath);
    if (oldTargets) {
      for (const t of oldTargets) {
        this.backwardLinks.get(t)?.delete(filePath);
      }
    }

    // Re-extract links using cached fileSet/basenameMap
    let content: string;
    try { content = readFile(mindRoot, filePath); } catch { return; }

    // Ensure this file is in the resolution sets
    if (!this.fileSet.has(filePath)) {
      this.fileSet.add(filePath);
      const key = path.basename(filePath).toLowerCase();
      if (!this.basenameMap.has(key)) this.basenameMap.set(key, []);
      this.basenameMap.get(key)!.push(filePath);
    }

    const targets = extractLinks(content, filePath, this.fileSet, this.basenameMap);
    const targetSet = new Set<string>();
    for (const t of targets) {
      if (t !== filePath) targetSet.add(t);
    }
    this.forwardLinks.set(filePath, targetSet);

    for (const t of targetSet) {
      let sources = this.backwardLinks.get(t);
      if (!sources) { sources = new Set(); this.backwardLinks.set(t, sources); }
      sources.add(filePath);
    }
  }
}

// ── Link extraction (shared between graph + backlinks) ─────────────

function buildBasenameMap(allFiles: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const f of allFiles) {
    const key = path.basename(f).toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  return map;
}

/**
 * Extract wiki-links and markdown-links from file content.
 * Returns an array of resolved target file paths.
 */
export function extractLinks(
  content: string,
  sourcePath: string,
  fileSet: Set<string>,
  basenameMap: Map<string, string[]>,
): string[] {
  const targets: string[] = [];
  const sourceDir = path.dirname(sourcePath);

  // WikiLinks: [[target]] or [[target|alias]] or [[target#section]]
  const wikiRe = /\[\[([^\]|#]+)(?:[|#][^\]]*)?/g;
  let m: RegExpExecArray | null;
  while ((m = wikiRe.exec(content)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    if (fileSet.has(raw)) { targets.push(raw); continue; }
    const withMd = raw.endsWith('.md') ? raw : raw + '.md';
    if (fileSet.has(withMd)) { targets.push(withMd); continue; }
    const lower = path.basename(withMd).toLowerCase();
    const candidates = basenameMap.get(lower);
    if (candidates && candidates.length === 1) targets.push(candidates[0]);
  }

  // Markdown links: [text](relative/path.md)
  const mdLinkRe = /\[[^\]]+\]\(([^)]+\.md)(?:#[^)]*)?\)/g;
  while ((m = mdLinkRe.exec(content)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('http')) continue;
    const resolved = path.normalize(path.join(sourceDir, raw));
    if (fileSet.has(resolved)) targets.push(resolved);
  }

  return targets;
}
