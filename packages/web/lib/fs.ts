import fs from 'fs';
import path from 'path';
import { MindOSError, ErrorCodes } from '@/lib/errors';
import { resolveExistingSafe } from './core/security';
import {
  readFile as coreReadFile,
  writeFile as coreWriteFile,
  createFile as coreCreateFile,
  deleteFile as coreDeleteFile,
  deleteDirectory as coreDeleteDirectory,
  convertToSpace as coreConvertToSpace,
  renameFile as coreRenameFile,
  renameSpaceDirectory as coreRenameSpaceDirectory,
  moveFile as coreMoveFile,
} from './core/fs-ops';
import {
  readLines as coreReadLines,
  insertLines as coreInsertLines,
  updateLines as coreUpdateLines,
  appendToFile as coreAppendToFile,
  insertAfterHeading as coreInsertAfterHeading,
  updateSection as coreUpdateSection,
} from './core/lines';
import { appendCsvRow as coreAppendCsvRow } from './core/csv';
import { findBacklinks as coreFindBacklinks } from './core/backlinks';
import { isGitRepo as coreIsGitRepo, gitLog as coreGitLog, gitShowFile as coreGitShowFile } from './core/git';
import { LinkIndex } from './core/link-index';
import { summarizeTopLevelSpaces } from './core/list-spaces';
import {
  appendContentChange as coreAppendContentChange,
  listContentChanges as coreListContentChanges,
  markContentChangesSeen as coreMarkContentChangesSeen,
  getContentChangeSummary as coreGetContentChangeSummary,
} from './core/content-changes';
import type { MindSpaceSummary } from './core/list-spaces';
import type { ContentChangeEvent, ContentChangeInput, ContentChangeSummary } from './core/content-changes';
import { FileNode, SpacePreview } from './core/types';
import type { SearchPrewarmResponse } from './types';
import { effectiveMindRoot } from './mind-root';
import { notifyTreeVersionChanged } from './server-events-bridge';
import { getWebTreeCache } from './core/mind-root-cache';
import { invalidateSearchIndex, removeSearchIndexPath, updateSearchIndexFile } from './core/search';
import { extractPdfText } from './core/pdf-text';
import { telemetry } from './telemetry';
import { ensureDefaultMindSystemUpgrade } from './mind-system-upgrade';
import { isDefaultMindSystemScaffoldFile } from './mind-system-scaffold';
import {
  collectFileStatsFromMindRoot,
  type MindRootTreeCache,
  type MindosRuntimeFileStat,
  type TreeCacheFlushResult,
  type TreeCachePathChange,
} from '@geminilight/mindos/server';

/**
 * Web facade over the core mind-root tree cache (`@geminilight/mindos/server`).
 *
 * The cache (file stats, monotonic version, recursive watcher with batched
 * per-path updates) lives in the core package and is shared with the search
 * index. This module only derives what the Web UI needs from the cached file
 * list — the `FileNode` tree with Space metadata, the scaffold-filtered file
 * list, recent files — and keeps the shape/content version counters that the
 * routes, the `/api/events` stream and the tests rely on. Deriving is pure
 * in-memory work; no `readdirSync` happens here.
 */

// ─── Root helpers ─────────────────────────────────────────────────────────────

/** Resolved MIND_ROOT — respects settings file override, then env var, then default */
export function getMindRoot(): string {
  return effectiveMindRoot();
}

function treeCache(): MindRootTreeCache {
  return getWebTreeCache(getMindRoot());
}

// ─── Derived state ────────────────────────────────────────────────────────────

interface DerivedTreeState {
  root: string;
  /** Core tree version the derivation is based on. */
  coreVersion: number;
  /** Sorted path list joined with newlines: identical → tree shape unchanged. */
  pathsKey: string;
  tree: FileNode[];
  allFiles: string[];
  recentFiles: Array<{ path: string; mtime: number }>;
}

let _derived: DerivedTreeState | null = null;
let _treeVersion = 0;
let _contentVersion = 0;
/** Set by explicit invalidations that already bumped the counters (see `invalidateCache`). */
let _countersBumpedForNextDerive = false;
let _subscription: { root: string; unsubscribe: () => void } | null = null;

/**
 * Every tree-shape change goes through here so the `/api/events` stream can
 * push the new version instead of clients polling `/api/tree-version`.
 */
function bumpTreeVersion(): void {
  _treeVersion++;
  notifyTreeVersionChanged(_treeVersion);
}

function markContentChanged(): void {
  _contentVersion++;
  _uiSearch = null;
}

/**
 * Follow the core cache for the current root: watcher batches flushed by the
 * core (external edits) re-derive here so counters, the link index and the
 * SSE stream see them without waiting for the next read.
 */
function ensureSubscribed(root: string, cache: MindRootTreeCache): void {
  if (_subscription?.root === root) return;
  _subscription?.unsubscribe();
  const unsubscribe = cache.subscribe(() => {
    // Only react once someone has read the tree for this root; idle processes
    // (and tests that never touch the tree) must not start deriving on timers.
    if (_derived?.root !== root) return;
    _countersBumpedForNextDerive = false;
    try { ensureDerived(); } catch { /* the next read retries */ }
  });
  _subscription = { root, unsubscribe };
}

function ensureDerived(): DerivedTreeState {
  const root = getMindRoot();
  const cache = getWebTreeCache(root);
  ensureSubscribed(root, cache);
  if (_derived && _derived.root !== root) {
    // Mind root switched (settings): derived state and indexes belong to the old root.
    _derived = null;
    _uiSearch = null;
    _linkIndex.invalidate();
  }
  let coreVersion = cache.getTreeVersion();
  if (_derived && _derived.coreVersion === coreVersion) return _derived;

  const stop = telemetry.startTimer('tree.cache.build');
  const upgrade = ensureDefaultMindSystemUpgrade(root);
  if (upgrade.createdPaths.length > 0 || upgrade.updatedPaths.length > 0) {
    cache.invalidate();
    coreVersion = cache.getTreeVersion();
  }
  const stats = cache.collectFileStats();
  const files = stats.map((entry) => entry.path).sort((a, b) => a.localeCompare(b));
  const pathsKey = files.join('\n');
  const previous = _derived;
  const next: DerivedTreeState = {
    root,
    coreVersion,
    pathsKey,
    tree: deriveFileTree(root, stats, _spacePreviews),
    allFiles: files.filter((filePath) => !isDefaultMindSystemScaffoldFile(root, filePath)),
    recentFiles: [],
  };
  next.recentFiles = stats
    .filter((entry) => next.allFiles.includes(entry.path) || !isDefaultMindSystemScaffoldFile(root, entry.path))
    .map((entry) => ({ path: entry.path, mtime: entry.mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  _derived = next;
  pruneSpacePreviews(_spacePreviews, next.tree);
  stop({ fileCount: next.allFiles.length, directoryCount: countDirectories(next.tree) });

  if (previous && previous.root === root) {
    if (_countersBumpedForNextDerive) {
      // The invalidator already chose the correct counters for this change.
      _countersBumpedForNextDerive = false;
    } else {
      if (previous.pathsKey !== pathsKey) bumpTreeVersion();
      markContentChanged();
      _linkIndex.invalidate();
    }
  } else {
    _countersBumpedForNextDerive = false;
  }
  return _derived;
}

function countDirectories(nodes: FileNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type !== 'directory') continue;
    count += 1 + countDirectories(node.children ?? []);
  }
  return count;
}

/** Monotonically increasing tree-shape counter for sidebar/shell refreshes. */
export function peekTreeVersion(): number {
  return _treeVersion;
}

/** Monotonically increasing content counter for link/search snapshots. */
export function peekContentVersion(): number {
  return _contentVersion;
}

export function getTreeVersion(): number {
  ensureDerived();
  return _treeVersion;
}

export function getContentVersion(): number {
  ensureDerived();
  return _contentVersion;
}

/** Module-level link index singleton. Lazily built on first graph/backlink access. */
const _linkIndex = new LinkIndex();

/** Get the link index, ensuring it's built for the current mindRoot. */
export function getLinkIndex(): LinkIndex {
  ensureDerived();
  const root = getMindRoot();
  if (!_linkIndex.isBuiltFor(root)) {
    _linkIndex.rebuild(root);
  }
  return _linkIndex;
}

// ─── Invalidation ─────────────────────────────────────────────────────────────

/**
 * Invalidate after a structural operation (rename / move / delete directory /
 * trash …): the core cache rescans on the next read, both counters bump now,
 * and the search / link indexes re-check their inputs incrementally.
 */
export function invalidateCache(): void {
  let cache: MindRootTreeCache | null = null;
  try { cache = treeCache(); } catch { cache = null; }
  cache?.invalidate();
  bumpTreeVersion();
  markContentChanged();
  _countersBumpedForNextDerive = _derived !== null;
  invalidateSearchIndex();
  _linkIndex.invalidate();
}

/**
 * Invalidate after a single file was written (content write, line edit,
 * append, create). The core cache re-stats just this path; the derived tree
 * is recomputed in memory only when the version moved; the search and link
 * indexes are updated for this one file.
 */
function invalidateCacheForFile(filePath: string): void {
  const root = getMindRoot();
  const cache = getWebTreeCache(root);
  const contentBefore = _contentVersion;
  const change = cache.refreshPath(filePath);
  applyPathChangeToCounters(change);
  // Same-size writes within one mtime tick still changed the content.
  if (_contentVersion === contentBefore) markContentChanged();
  updateSearchIndexFile(root, filePath);
  if (_linkIndex.isBuilt()) _linkIndex.updateFile(root, filePath);
}

/** Invalidate after a file was deleted. */
function invalidateCacheForDeletedFile(filePath: string): void {
  const root = getMindRoot();
  const cache = getWebTreeCache(root);
  const change = cache.refreshPath(filePath);
  applyPathChangeToCounters(change);
  removeSearchIndexPath(filePath);
  if (_linkIndex.isBuilt()) _linkIndex.removeFile(filePath);
}

/**
 * Reflect a per-path cache change in the Web counters. Once the tree has been
 * derived, re-deriving (pure in-memory) computes the exact shape/content diff;
 * before that, classify from the change itself so `peek*Version()` still moves.
 */
function applyPathChangeToCounters(change: TreeCachePathChange): void {
  if (_derived) {
    _countersBumpedForNextDerive = false;
    syncDerived();
    return;
  }
  if (change === 'unchanged') return;
  if (change !== 'changed') bumpTreeVersion();
  markContentChanged();
}

/** Re-derive now when the tree was already read once; otherwise stay lazy. */
function syncDerived(): void {
  if (!_derived) return;
  try { ensureDerived(); } catch { /* the next read retries */ }
}

// ─── Watcher entry points ─────────────────────────────────────────────────────
// The recursive `fs.watch` lives in the core tree cache. These wrappers exist
// for `/api/file` (which writes through the product handler) and for tests;
// they apply a batch immediately and update the search / link indexes per path.

/**
 * Record a single watcher event (relative path inside mindRoot). Pass
 * `null`/`undefined` when the platform did not report a filename — this forces
 * a full rescan on the next flush (never silently drop).
 */
export function handleWatcherEvent(filename: string | Buffer | null | undefined): void {
  let cache: MindRootTreeCache;
  try { cache = treeCache(); } catch { return; }
  cache.handleWatcherEvent(filename);
}

/**
 * Apply the batched watcher events now: the core cache patches its stats per
 * path (or rescans for directory events / overflow) and the search / link
 * indexes are updated incrementally. Also runs automatically 500ms after the
 * last event inside the core cache.
 */
export function flushWatcherChanges(): void {
  let root: string;
  try { root = getMindRoot(); } catch { return; }
  const cache = getWebTreeCache(root);
  const result: TreeCacheFlushResult = cache.flushWatcherChanges();
  if (result.kind === 'none') return;
  if (result.kind === 'full') {
    invalidateCache();
    return;
  }
  for (const { path: rel, change } of result.changed) {
    if (change === 'removed') {
      removeSearchIndexPath(rel);
      if (_linkIndex.isBuilt()) _linkIndex.removeFile(rel);
    } else {
      updateSearchIndexFile(root, rel);
      if (_linkIndex.isBuilt()) _linkIndex.updateFile(root, rel);
    }
  }
  if (_derived) {
    // Watcher-detected changes always count, even right after an explicit invalidation.
    _countersBumpedForNextDerive = false;
    syncDerived();
    return;
  }
  if (result.changed.some(({ change }) => change !== 'changed')) bumpTreeVersion();
  markContentChanged();
}

/** Start watching mindRoot for external changes. Idempotent. */
export function startFileWatcher(): void {
  try { treeCache().startWatcher(); } catch { /* mindRoot not configured yet */ }
}

/** Stop the watcher; reads fall back to the TTL until `startFileWatcher()`. */
export function stopFileWatcher(): void {
  try { treeCache().stopWatcher(); } catch { /* nothing to stop */ }
}

// ─── Tree derivation ──────────────────────────────────────────────────────────

const ALLOWED_EXTENSIONS = new Set([
  '.md', '.csv', '.json', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac',
  '.mp4', '.webm', '.mov', '.mkv',
]);

const SPACE_PREVIEW_MAX_LINES = 3;

type SpacePreviewCache = Map<string, { key: string; preview: SpacePreview }>;

/** Preview text per Space directory, keyed by the INSTRUCTION/README mtimes. */
const _spacePreviews: SpacePreviewCache = new Map();

function readPreviewSource(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function extractBodyLines(content: string | null, maxLines: number): string[] {
  if (content === null) return [];
  const bodyLines: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    bodyLines.push(trimmed);
    if (bodyLines.length >= maxLines) break;
  }
  return bodyLines;
}

const TEMPLATE_MARKERS = [
  'Define local execution rules for this directory.',
  '(your files here)',
  '(Describe the purpose and usage of this space.)',
  '(Add usage guidelines for this space.)',
];

function isTemplateContent(content: string | null): boolean {
  if (content === null) return false;
  return TEMPLATE_MARKERS.some(m => content.includes(m));
}

function buildSpacePreview(dirAbsPath: string): SpacePreview {
  const instructionPath = path.join(dirAbsPath, 'INSTRUCTION.md');
  const readmePath = path.join(dirAbsPath, 'README.md');
  const instructionContent = readPreviewSource(instructionPath);
  const readmeContent = readPreviewSource(readmePath);
  const readmeTemplate = isTemplateContent(readmeContent);

  // Parse lastCompiled from README footer comment
  let lastCompiled: string | undefined;
  if (readmeContent) {
    const match = readmeContent.match(/<!-- mindos:compiled (\S+) files:\d+ -->/);
    if (match) lastCompiled = match[1];
  }

  return {
    instructionLines: extractBodyLines(instructionContent, SPACE_PREVIEW_MAX_LINES),
    readmeLines: extractBodyLines(readmeContent, SPACE_PREVIEW_MAX_LINES),
    isTemplate: isTemplateContent(instructionContent) && readmeTemplate,
    readmeIsTemplate: readmeTemplate,
    lastCompiled,
  };
}

type DirBuilder = {
  name: string;
  path: string;
  dirs: Map<string, DirBuilder>;
  files: FileNode[];
  fileStats: Map<string, MindosRuntimeFileStat>;
};

/**
 * Build the UI tree from cached file stats. Directories exist only through
 * their files (empty directories never show, matching the old readdir walk);
 * a directory holding `INSTRUCTION.md` is a Space and gets its preview, which
 * is re-read only when INSTRUCTION.md / README.md changed on disk.
 */
function deriveFileTree(root: string, stats: MindosRuntimeFileStat[], previews: SpacePreviewCache): FileNode[] {
  const top: DirBuilder = { name: '', path: '', dirs: new Map(), files: [], fileStats: new Map() };
  for (const stat of stats) {
    const segments = stat.path.split('/');
    const fileName = segments.pop();
    if (!fileName) continue;
    const ext = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;
    let dir = top;
    let relPath = '';
    for (const segment of segments) {
      relPath = relPath ? `${relPath}/${segment}` : segment;
      let child = dir.dirs.get(segment);
      if (!child) {
        child = { name: segment, path: relPath, dirs: new Map(), files: [], fileStats: new Map() };
        dir.dirs.set(segment, child);
      }
      dir = child;
    }
    dir.files.push({ name: fileName, path: stat.path, type: 'file', extension: ext });
    dir.fileStats.set(fileName, stat);
  }
  return finishDirectory(root, top, previews);
}

function finishDirectory(root: string, dir: DirBuilder, previews: SpacePreviewCache): FileNode[] {
  const nodes: FileNode[] = [];
  for (const child of dir.dirs.values()) {
    const children = finishDirectory(root, child, previews);
    if (children.length === 0) continue;
    const node: FileNode = { name: child.name, path: child.path, type: 'directory', children };
    if (child.fileStats.has('INSTRUCTION.md')) {
      node.isSpace = true;
      node.spacePreview = spacePreviewFor(root, child, previews);
    }
    nodes.push(node);
  }
  nodes.push(...dir.files);
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

function spacePreviewFor(root: string, dir: DirBuilder, previews: SpacePreviewCache): SpacePreview {
  const instruction = dir.fileStats.get('INSTRUCTION.md');
  const readme = dir.fileStats.get('README.md');
  const key = `${instruction?.mtime ?? 'none'}:${instruction?.size ?? 0}:${readme?.mtime ?? 'none'}:${readme?.size ?? 0}`;
  const cached = previews.get(dir.path);
  if (cached && cached.key === key) return cached.preview;
  const preview = buildSpacePreview(path.join(root, dir.path));
  previews.set(dir.path, { key, preview });
  return preview;
}

/** Drop preview entries for directories that are no longer Spaces. */
function pruneSpacePreviews(previews: SpacePreviewCache, tree: FileNode[]): void {
  const live = new Set<string>();
  const walk = (nodes: FileNode[]) => {
    for (const node of nodes) {
      if (node.type !== 'directory') continue;
      if (node.isSpace) live.add(node.path);
      walk(node.children ?? []);
    }
  };
  walk(tree);
  for (const dirPath of [...previews.keys()]) {
    if (!live.has(dirPath)) previews.delete(dirPath);
  }
}

/** Exposed for testing only — builds a file tree from an arbitrary root path. */
export function buildFileTreeForTest(rootPath: string): FileNode[] {
  const root = path.resolve(rootPath);
  return deriveFileTree(root, collectFileStatsFromMindRoot(root), new Map());
}

// ─── Public API: Tree & cache (app-specific) ─────────────────────────────────

/** Returns the cached file tree for the knowledge base. */
export function getFileTree(): FileNode[] {
  return ensureDerived().tree;
}

/** Top-level Mind Spaces (same cached tree as home Spaces grid). */
export function listMindSpaces(): MindSpaceSummary[] {
  return summarizeTopLevelSpaces(getMindRoot(), ensureDerived().tree);
}

/** Appends a structured change event to the change log. */
export function appendContentChange(input: ContentChangeInput): ContentChangeEvent {
  return coreAppendContentChange(getMindRoot(), input);
}

/**
 * Lists content change events with optional filtering.
 * @param options.path   Filter by file path (prefix match)
 * @param options.space  Filter by top-level space
 * @param options.limit  Max events to return (default: unlimited)
 * @param options.source Filter by source: 'user' | 'agent' | 'system'
 * @param options.agent  Filter by concrete agent name when available
 * @param options.op     Filter by operation type (e.g. 'create', 'update', 'delete')
 * @param options.q      Free-text search within change descriptions
 */
export function listContentChanges(options: {
  path?: string;
  space?: string;
  limit?: number;
  source?: 'user' | 'agent' | 'system';
  agent?: string;
  op?: string;
  q?: string;
} = {}): ContentChangeEvent[] {
  return coreListContentChanges(getMindRoot(), options);
}

/** Marks all unseen content changes as seen. */
export function markContentChangesSeen(): void {
  coreMarkContentChangesSeen(getMindRoot());
}

/** Returns a summary of content changes (total, unseen count, latest timestamp). */
export function getContentChangeSummary(): ContentChangeSummary {
  return coreGetContentChangeSummary(getMindRoot());
}

/** Returns space preview (INSTRUCTION + README excerpts) for a directory, or null if not a space. */
export function getSpacePreview(dirPath: string): SpacePreview | null {
  const root = getMindRoot();
  let abs: string;
  try {
    abs = resolveExistingSafe(root, dirPath);
  } catch {
    return null;
  }
  const instructionPath = path.join(abs, 'INSTRUCTION.md');
  if (!fs.existsSync(instructionPath)) return null;
  return buildSpacePreview(abs);
}

/** Returns cached list of all file paths (relative to MIND_ROOT). */
export function collectAllFiles(): string[] {
  return ensureDerived().allFiles;
}

/** Returns whether a relative path is a directory within MIND_ROOT. */
export function isDirectory(filePath: string): boolean {
  try {
    const resolved = resolveExistingSafe(getMindRoot(), filePath);
    return fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

function findDirectoryNode(nodes: FileNode[], dirPath: string): FileNode[] | null {
  if (!dirPath || dirPath === '.') return nodes;
  for (const node of nodes) {
    if (node.type !== 'directory') continue;
    if (node.path === dirPath) return node.children ?? [];
    if (dirPath.startsWith(`${node.path}/`)) return findDirectoryNode(node.children ?? [], dirPath);
  }
  return null;
}

/** Returns the immediate children (files + subdirs) of a directory. */
export function getDirEntries(dirPath: string): FileNode[] {
  const root = getMindRoot();
  let resolved: string;
  try {
    resolved = resolveExistingSafe(path.resolve(root), dirPath);
  } catch {
    return [];
  }
  const rel = path.relative(path.resolve(root), resolved).split(path.sep).join('/');
  const children = findDirectoryNode(ensureDerived().tree, rel);
  if (!children) return [];
  const cache = treeCache();
  return children.map((node) => {
    if (node.type === 'directory') {
      return { name: node.name, path: node.path, type: 'directory', children: node.children };
    }
    const mtime = cache.getFileStat(node.path)?.mtime;
    return mtime === undefined ? { ...node } : { ...node, mtime };
  });
}

/**
 * Returns the N most recently modified files.
 * @param limit Max files to return (default: 10)
 */
export function getRecentlyModified(limit = 10): Array<{ path: string; mtime: number }> {
  return ensureDerived().recentFiles.slice(0, limit);
}

// ─── Public API: File operations (delegated to @mindos/core) ─────────────────

/** Reads the content of a file given a relative path from MIND_ROOT.
 *  PDF files are automatically extracted to text via pdfjs-dist. */
export function getFileContent(filePath: string): string {
  const root = getMindRoot();
  if (path.extname(filePath).toLowerCase() === '.pdf') {
    const resolved = resolveExistingSafe(root, filePath);
    if (!fs.existsSync(resolved)) {
      throw new MindOSError(
        ErrorCodes.FILE_NOT_FOUND,
        `File not found: ${filePath}`,
        { filePath },
      );
    }
    const text = extractPdfText(resolved);
    if (!text) {
      throw new MindOSError(
        ErrorCodes.INTERNAL_ERROR,
        `Could not extract text from PDF: ${filePath}`,
        { filePath },
      );
    }
    return text;
  }
  return coreReadFile(root, filePath);
}

/** Atomically writes content to a file given a relative path from MIND_ROOT. */
export function saveFileContent(filePath: string, content: string): void {
  coreWriteFile(getMindRoot(), filePath, content);
  invalidateCacheForFile(filePath);
}

/** Creates a new file at the given relative path. Creates parent dirs as needed. */
export function createFile(filePath: string, initialContent = ''): void {
  coreCreateFile(getMindRoot(), filePath, initialContent);
  invalidateCacheForFile(filePath);
}

/**
 * Deletes a file and moves it to the trash.
 * @returns Trash metadata for undo support
 */
export function deleteFile(filePath: string): void {
  coreDeleteFile(getMindRoot(), filePath);
  invalidateCacheForDeletedFile(filePath);
}

/** Renames a file. newName must be a plain filename (no path separators). */
export function renameFile(oldPath: string, newName: string): string {
  const result = coreRenameFile(getMindRoot(), oldPath, newName);
  invalidateCache();
  return result;
}

/** Renames a Space directory under MIND_ROOT. newName must be a single path segment. */
export function renameSpace(spacePath: string, newName: string): string {
  const result = coreRenameSpaceDirectory(getMindRoot(), spacePath, newName);
  invalidateCache();
  return result;
}

/** Recursively deletes a directory under MIND_ROOT. */
export function deleteDirectory(dirPath: string): void {
  coreDeleteDirectory(getMindRoot(), dirPath);
  invalidateCache();
}

/** Converts a regular folder into a Space by adding INSTRUCTION.md + README.md. */
export function convertToSpace(dirPath: string): void {
  coreConvertToSpace(getMindRoot(), dirPath);
  invalidateCache();
}

// ─── Public API: Line-level operations (delegated to @mindos/core) ───────────

/**
 * Reads all lines of a file as an array of strings.
 * @param filePath Relative path from MIND_ROOT
 */
export function readLines(filePath: string): string[] {
  return coreReadLines(getMindRoot(), filePath);
}

/**
 * Inserts lines after the given index (0-based).
 * @param filePath   Relative path from MIND_ROOT
 * @param afterIndex Insert after this line index (-1 = prepend)
 * @param lines      Lines to insert
 */
export function insertLines(filePath: string, afterIndex: number, lines: string[]): void {
  coreInsertLines(getMindRoot(), filePath, afterIndex, lines);
  invalidateCacheForFile(filePath);
}

/**
 * Replaces lines in the range [startIndex, endIndex] (inclusive, 0-based).
 * @param filePath   Relative path from MIND_ROOT
 * @param startIndex First line to replace
 * @param endIndex   Last line to replace
 * @param newLines   Replacement lines
 */
export function updateLines(filePath: string, startIndex: number, endIndex: number, newLines: string[]): void {
  coreUpdateLines(getMindRoot(), filePath, startIndex, endIndex, newLines);
  invalidateCacheForFile(filePath);
}

/**
 * Deletes lines in the range [startIndex, endIndex] (inclusive, 0-based).
 * @throws {MindOSError} If indices are out of range
 */
export function deleteLines(filePath: string, startIndex: number, endIndex: number): void {
  const existing = readLines(filePath);
  if (startIndex < 0 || endIndex < 0) throw new MindOSError(ErrorCodes.INVALID_RANGE, 'Invalid line index: indices must be >= 0', { startIndex, endIndex });
  if (startIndex > endIndex) throw new MindOSError(ErrorCodes.INVALID_RANGE, `Invalid range: start (${startIndex}) > end (${endIndex})`, { startIndex, endIndex });
  if (startIndex >= existing.length) throw new MindOSError(ErrorCodes.INVALID_RANGE, `Invalid line index: start (${startIndex}) >= total lines (${existing.length})`, { startIndex, totalLines: existing.length });
  existing.splice(startIndex, endIndex - startIndex + 1);
  saveFileContent(filePath, existing.join('\n'));
}

// ─── Public API: High-level semantic operations (delegated to @mindos/core) ──

/** Appends content to the end of a file with a leading newline separator. */
export function appendToFile(filePath: string, content: string): void {
  coreAppendToFile(getMindRoot(), filePath, content);
  invalidateCacheForFile(filePath);
}

/** Inserts content after the first occurrence of a markdown heading. */
export function insertAfterHeading(filePath: string, heading: string, content: string): void {
  coreInsertAfterHeading(getMindRoot(), filePath, heading, content);
  invalidateCacheForFile(filePath);
}

/** Replaces the content of a markdown section (heading to next heading of same or higher level). */
export function updateSection(filePath: string, heading: string, newContent: string): void {
  coreUpdateSection(getMindRoot(), filePath, heading, newContent);
  invalidateCacheForFile(filePath);
}

// ─── Search prewarm (app-level) ───────────────────────────────────────────────
//
// The browser ⌘K overlay queries `/api/search`, which uses the core BM25 /
// hybrid search in `lib/core/`. What remains here is the prewarm bookkeeping
// used by `/api/search/prewarm` to keep the tree cache warm and report a
// document count; it is keyed on the core tree version, so any file change
// (shape or content) reports `built` once and `hit` afterwards.

interface UiSearchPrewarmState {
  documentCount: number;
  coreVersion: number;
}

let _uiSearch: UiSearchPrewarmState | null = null;

/** Warm the file-tree cache and report the searchable document count. */
export function prewarmSearchIndex(): SearchPrewarmResponse {
  const derived = ensureDerived();
  if (_uiSearch && _uiSearch.coreVersion === derived.coreVersion) {
    telemetry.track('search.ui.prewarm', { cacheState: 'hit', documentCount: _uiSearch.documentCount });
    return { warmed: true, cacheState: 'hit', documentCount: _uiSearch.documentCount };
  }

  const documentCount = derived.allFiles.length;
  _uiSearch = { documentCount, coreVersion: derived.coreVersion };
  telemetry.track('search.ui.prewarm', { cacheState: 'built', documentCount });
  return { warmed: true, cacheState: 'built', documentCount };
}

// ─── Public API: CSV (delegated to @mindos/core) ────────────────────────────

/**
 * Appends a row to a CSV file.
 * @returns Object with the new total row count
 */
export function appendCsvRow(filePath: string, row: string[]): { newRowCount: number } {
  const result = coreAppendCsvRow(getMindRoot(), filePath, row);
  invalidateCacheForFile(filePath);
  return result;
}

// ─── Public API: Move file (delegated to @mindos/core) ──────────────────────

/**
 * Moves a file from one path to another, updating internal wikilinks.
 * @returns The new path and list of files whose links were updated
 */
export function moveFile(fromPath: string, toPath: string): { newPath: string; affectedFiles: string[] } {
  const result = coreMoveFile(getMindRoot(), fromPath, toPath, coreFindBacklinks);
  invalidateCache();
  return result;
}

// ─── Public API: Git operations (delegated to @mindos/core) ─────────────────

/** Returns whether the knowledge base root is a git repository. */
export function isGitRepo(): boolean {
  return coreIsGitRepo(getMindRoot());
}

/**
 * Returns git log entries for a file.
 * @param filePath Relative path from MIND_ROOT
 * @param limit    Max entries (default: 10)
 */
export function gitLog(filePath: string, limit = 10): Array<{ hash: string; date: string; message: string; author: string }> {
  return coreGitLog(getMindRoot(), filePath, limit);
}

/**
 * Shows file content at a specific git commit.
 * @param filePath Relative path from MIND_ROOT
 * @param commit   Git commit hash or ref
 */
export function gitShowFile(filePath: string, commit: string): string {
  return coreGitShowFile(getMindRoot(), filePath, commit);
}

// ─── Public API: Backlinks (delegated to @mindos/core) ──────────────────────

import type { BacklinkEntry } from './core/types';
export type { BacklinkEntry } from './core/types';
export type { MindSpaceSummary } from './core';
export type { ContentChangeEvent, ContentChangeInput, ContentChangeSummary, ContentChangeSource } from './core';

// ─── Public API: Trash (delegated to @mindos/core/trash) ────────────────────

import {
  moveToTrash as coreMoveToTrash,
  restoreFromTrash as coreRestoreFromTrash,
  restoreAsCopy as coreRestoreAsCopy,
  permanentlyDelete as corePermanentlyDelete,
  listTrash as coreListTrash,
  emptyTrash as coreEmptyTrash,
  purgeExpired as corePurgeExpired,
} from './core/trash';
export type { TrashMeta } from './core/trash';

/** Moves a file to the .mindos/.trash/ directory for later recovery. */
export function moveToTrashFile(filePath: string) {
  const result = coreMoveToTrash(getMindRoot(), filePath);
  invalidateCache();
  return result;
}

/**
 * Restores a file from trash to its original path.
 * @param trashId   The trash entry ID
 * @param overwrite If true, overwrite existing file at original path
 */
export function restoreFromTrash(trashId: string, overwrite = false) {
  const result = coreRestoreFromTrash(getMindRoot(), trashId, overwrite);
  invalidateCache();
  return result;
}

/** Restores a file from trash as a copy (appends suffix to avoid conflict). */
export function restoreAsCopy(trashId: string) {
  const result = coreRestoreAsCopy(getMindRoot(), trashId);
  invalidateCache();
  return result;
}

/** Permanently deletes a file from trash (no recovery possible). */
export function permanentlyDeleteFromTrash(trashId: string) {
  corePermanentlyDelete(getMindRoot(), trashId);
}

/** Lists all items currently in the trash. */
export function listTrash() {
  return coreListTrash(getMindRoot());
}

/** Permanently deletes all items in the trash. */
export function emptyTrashAll() {
  return coreEmptyTrash(getMindRoot());
}

/** Removes trash items older than 30 days. Called automatically on listTrash. */
export function purgeExpiredTrash() {
  return corePurgeExpired(getMindRoot());
}

/**
 * Finds all files that link to the given target path via wikilinks.
 * Uses the pre-built LinkIndex for O(1) source lookup.
 */
export function findBacklinks(targetPath: string): BacklinkEntry[] {
  const mindRoot = getMindRoot();
  // Use LinkIndex for O(1) source lookup, then only scan matching files
  const linkIndex = getLinkIndex();
  const linkingSources = linkIndex.getBacklinks(targetPath);
  return coreFindBacklinks(mindRoot, targetPath, linkingSources);
}
