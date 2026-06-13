import fs from 'fs';
import path from 'path';
import { MindOSError, ErrorCodes } from '@/lib/errors';
import {
  resolveExistingSafe,
  resolveSafe,
} from './core/security';
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
import {
  appendCsvRow as coreAppendCsvRow,
} from './core/csv';
import {
  findBacklinks as coreFindBacklinks,
} from './core/backlinks';
import {
  isGitRepo as coreIsGitRepo,
  gitLog as coreGitLog,
  gitShowFile as coreGitShowFile,
} from './core/git';
import {
  LinkIndex,
} from './core/link-index';
import {
  summarizeTopLevelSpaces,
} from './core/list-spaces';
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
import {
  notifySearchIndexInvalidated,
  notifySearchIndexFileChanged,
  notifySearchIndexPathRemoved,
} from './core/search-index-bridge';
import { extractPdfText } from './core/pdf-text';
import { telemetry } from './telemetry';
import { ensureDefaultMindSystemUpgrade } from './mind-system-upgrade';
import { isDefaultMindSystemScaffoldFile } from './mind-system-scaffold';

// ─── Root helpers ─────────────────────────────────────────────────────────────

/** Resolved MIND_ROOT — respects settings file override, then env var, then default */
export function getMindRoot(): string {
  return effectiveMindRoot();
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'app', '.next', '.DS_Store', '.media', 'mcp', '.mindos']);
const ALLOWED_EXTENSIONS = new Set([
  '.md', '.csv', '.json', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac',
  '.mp4', '.webm', '.mov', '.mkv',
]);
const SYSTEM_FILES = new Set(['INSTRUCTION.md', 'README.md', 'CONFIG.json', 'CHANGELOG.md']);

// ─── In-memory cache ──────────────────────────────────────────────────────────

interface FileTreeCache {
  tree: FileNode[];
  allFiles: string[];
  fileSignature: string;
  timestamp: number;
}

let _cache: FileTreeCache | null = null;
const CACHE_TTL_MS = 30_000; // 30 seconds (file watcher still invalidates immediately on changes)

let _treeVersion = 0;

// Core-search invalidation goes through `core/search-index-bridge` — a
// dependency-free module — so this file (imported by app/layout for the
// file tree) never pulls the core search/embedding stack into ordinary
// page renders. If `core/search` was never loaded, the hooks are absent
// and the notifications are dropped (the lazy build reads fresh state).

function invalidateSearchIndexLazy(): void {
  notifySearchIndexInvalidated();
}

function updateSearchIndexFileLazy(mindRoot: string, filePath: string): void {
  notifySearchIndexFileChanged(mindRoot, filePath);
}

function addSearchIndexFileLazy(mindRoot: string, filePath: string): void {
  // The index's updateFile handles both add and modify.
  notifySearchIndexFileChanged(mindRoot, filePath);
}

function removeSearchIndexFileLazy(filePath: string): void {
  notifySearchIndexPathRemoved(filePath);
}

function buildCache(root: string): FileTreeCache {
  const stop = telemetry.startTimer('tree.cache.build');
  ensureDefaultMindSystemUpgrade(root);
  const tree = buildFileTree(root);
  const allFiles: string[] = [];
  let directoryCount = 0;
  function collect(nodes: FileNode[]) {
    for (const n of nodes) {
      if (n.type === 'file') {
        if (!isDefaultMindSystemScaffoldFile(root, n.path)) allFiles.push(n.path);
      }
      else if (n.children) {
        directoryCount++;
        collect(n.children);
      }
    }
  }
  collect(tree);
  const fileSignature = buildFileSignature(root, allFiles);
  stop({ fileCount: allFiles.length, directoryCount });
  return { tree, allFiles, fileSignature, timestamp: Date.now() };
}

function buildFileSignature(root: string, allFiles: string[]): string {
  return allFiles.map((filePath) => {
    try {
      const stat = fs.statSync(path.join(root, filePath));
      return JSON.stringify([filePath, stat.size, stat.mtimeMs]);
    } catch {
      return JSON.stringify([filePath, 'missing']);
    }
  }).join('\n');
}

function refreshExpiredCache(): FileTreeCache {
  const next = buildCache(getMindRoot());
  if (_cache && _cache.fileSignature !== next.fileSignature) {
    _treeVersion++;
    _searchIndex = null;
    invalidateSearchIndexLazy();
    _linkIndex.invalidate();
  }
  _cache = next;
  return _cache;
}

/** Monotonically increasing counter — bumped on every file mutation so the
 *  client can cheaply detect changes without rebuilding the full tree. */
export function peekTreeVersion(): number {
  return _treeVersion;
}

export function getTreeVersion(): number {
  if (!_cache) {
    // Cache was invalidated (by watcher or explicit invalidateCache) — rebuild.
    // _treeVersion was already bumped by the invalidator, no need to bump again.
    _cache = buildCache(getMindRoot());
  } else if (!isCacheValid()) {
    // Cache expired by TTL — rebuild and check if files actually changed.
    refreshExpiredCache();
  }
  // The tree-version endpoint can be the first cache touch in lightweight
  // clients. Keep watcher startup semantics aligned with getFileTree().
  if (!_watcher) startFileWatcher();
  return _treeVersion;
}

function isCacheValid(): boolean {
  return _cache !== null && (Date.now() - _cache.timestamp) < CACHE_TTL_MS;
}

/** Module-level link index singleton. Lazily built on first graph/backlink access. */
const _linkIndex = new LinkIndex();

/** Get the link index, ensuring it's built for the current mindRoot. */
export function getLinkIndex(): LinkIndex {
  const root = getMindRoot();
  if (!_linkIndex.isBuiltFor(root)) {
    _linkIndex.rebuild(root);
  }
  return _linkIndex;
}

/** Invalidate cache — call after any write/create/delete/rename operation */
export function invalidateCache(): void {
  _cache = null;
  _searchIndex = null;
  _treeVersion++;
  invalidateSearchIndexLazy();
  _linkIndex.invalidate();
}

/**
 * Invalidate cache after a single file was modified (content write, line edit, append).
 * Tree cache is cleared (file list/mtime changed), but search index is updated
 * incrementally for just this file — O(tokens) instead of O(all-files).
 */
function invalidateCacheForFile(filePath: string): void {
  _cache = null;
  _searchIndex = null;
  _treeVersion++;
  updateSearchIndexFileLazy(getMindRoot(), filePath);
  if (_linkIndex.isBuilt()) _linkIndex.updateFile(getMindRoot(), filePath);
}

/**
 * Invalidate cache after a new file was created.
 * Tree cache is cleared, search index gets incremental addFile.
 */
function invalidateCacheForNewFile(filePath: string): void {
  _cache = null;
  _searchIndex = null;
  _treeVersion++;
  addSearchIndexFileLazy(getMindRoot(), filePath);
  if (_linkIndex.isBuilt()) _linkIndex.updateFile(getMindRoot(), filePath);
}

/**
 * Invalidate cache after a file was deleted.
 * Tree cache is cleared, search index gets incremental removeFile.
 */
function invalidateCacheForDeletedFile(filePath: string): void {
  _cache = null;
  _searchIndex = null;
  _treeVersion++;
  removeSearchIndexFileLazy(filePath);
  if (_linkIndex.isBuilt()) _linkIndex.removeFile(filePath);
}

function ensureCache(): FileTreeCache {
  if (isCacheValid()) return _cache!;
  if (_cache) {
    refreshExpiredCache();
  } else {
    _cache = buildCache(getMindRoot());
  }
  // Lazily start the file watcher on first cache build
  if (!_watcher) startFileWatcher();
  return _cache;
}

// ─── File System Watcher ──────────────────────────────────────────────────────
// Watches mindRoot for external changes (VSCode, Finder, git pull) and
// invalidates cache immediately instead of waiting for the TTL. Events are
// batched (500ms debounce) and applied incrementally to the search index;
// unknown paths or oversized batches fall back to full invalidation.

let _watcher: fs.FSWatcher | null = null;
let _watchDebounce: ReturnType<typeof setTimeout> | null = null;

/** Above this many distinct paths per batch, a full invalidation is cheaper. */
const WATCH_BATCH_LIMIT = 50;

let _watchPending: Set<string> | null = null;
let _watchPendingRoot: string | null = null;
let _watchOverflow = false;

function isIgnoredWatcherPath(relPath: string): boolean {
  for (const segment of relPath.split('/')) {
    if (IGNORED_DIRS.has(segment)) return true;
  }
  return false;
}

/**
 * Record a single watcher event (relative path inside mindRoot).
 * Pass `null`/`undefined` when the platform did not report a filename —
 * this forces a full invalidation on the next flush (never silently drop).
 * Exported for tests and for alternative watch backends.
 */
export function handleWatcherEvent(filename: string | Buffer | null | undefined): void {
  if (filename == null) {
    _watchOverflow = true;
    scheduleWatcherFlush();
    return;
  }
  const rel = String(filename).split(path.sep).join('/');
  if (isIgnoredWatcherPath(rel)) return;

  let root: string;
  try { root = getMindRoot(); } catch { _watchOverflow = true; scheduleWatcherFlush(); return; }
  // Root changed mid-batch (e.g. settings switch) → stale rel paths.
  if (_watchPendingRoot !== null && _watchPendingRoot !== root) _watchOverflow = true;
  _watchPendingRoot = root;

  if (!_watchPending) _watchPending = new Set();
  _watchPending.add(rel);
  if (_watchPending.size > WATCH_BATCH_LIMIT) _watchOverflow = true;
  scheduleWatcherFlush();
}

function scheduleWatcherFlush(): void {
  if (_watchDebounce) clearTimeout(_watchDebounce);
  _watchDebounce = setTimeout(flushWatcherChanges, 500);
}

/**
 * Apply the batched watcher events: invalidate the tree cache and update
 * the search/link indexes incrementally per path. Exported for tests;
 * called automatically 500ms after the last event.
 */
export function flushWatcherChanges(): void {
  if (_watchDebounce) { clearTimeout(_watchDebounce); _watchDebounce = null; }
  const pending = _watchPending;
  const pendingRoot = _watchPendingRoot;
  const overflow = _watchOverflow;
  _watchPending = null;
  _watchPendingRoot = null;
  _watchOverflow = false;

  if (!pending && !overflow) return; // nothing relevant happened

  let root: string;
  try { root = getMindRoot(); } catch { return; }

  if (overflow || !pending || pendingRoot !== root) {
    invalidateCache();
    return;
  }

  // Tree cache is always stale after any event; search/link indexes are
  // updated per file below.
  _cache = null;
  _searchIndex = null;
  _treeVersion++;

  for (const rel of pending) {
    let stat: fs.Stats | null = null;
    try { stat = fs.statSync(path.join(root, rel)); } catch { stat = null; }

    if (stat?.isDirectory()) {
      // Directory event: contents unknown (rename/move of a subtree) —
      // a full invalidation is the only safe answer.
      invalidateCache();
      return;
    }
    if (stat) {
      updateSearchIndexFileLazy(root, rel);
      if (_linkIndex.isBuilt()) _linkIndex.updateFile(root, rel);
    } else {
      removeSearchIndexFileLazy(rel);
      if (_linkIndex.isBuilt()) _linkIndex.removeFile(rel);
    }
  }
}

/**
 * Start watching mindRoot for file changes. Idempotent — safe to call multiple times.
 * Uses Node.js built-in fs.watch (recursive) with 500ms debounce to batch rapid changes.
 * NOTE: { recursive: true } is supported on macOS and Windows only. On Linux, only
 * top-level changes are detected. For full Linux support, chokidar would be needed.
 */
export function startFileWatcher(): void {
  if (_watcher) return; // already watching
  let root: string;
  try { root = getMindRoot(); } catch { return; }

  try {
    _watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      handleWatcherEvent(filename ?? null);
    });
    _watcher.on('error', () => {
      // Watcher failed (e.g. too many open files) — degrade gracefully to TTL cache
      stopFileWatcher();
    });
  } catch {
    // fs.watch not supported on this platform — degrade gracefully
    _watcher = null;
  }
}

/** Stop the file watcher. Safe to call even if not watching. */
export function stopFileWatcher(): void {
  if (_watchDebounce) { clearTimeout(_watchDebounce); _watchDebounce = null; }
  _watchPending = null;
  _watchPendingRoot = null;
  _watchOverflow = false;
  if (_watcher) { _watcher.close(); _watcher = null; }
}

// ─── Internal builders ────────────────────────────────────────────────────────

const SPACE_PREVIEW_MAX_LINES = 3;

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

function buildSpacePreview(dirAbsPath: string) {
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

function buildFileTree(dirPath: string, rootOverride?: string): FileNode[] {
  const root = rootOverride ?? getMindRoot();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(root, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const children = buildFileTree(fullPath, root);
      if (children.length > 0) {
        const hasInstruction = children.some(c => c.type === 'file' && c.name === 'INSTRUCTION.md');
        const node: FileNode = { name: entry.name, path: relativePath, type: 'directory', children };
        if (hasInstruction) {
          node.isSpace = true;
          node.spacePreview = buildSpacePreview(fullPath);
        }
        nodes.push(node);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        nodes.push({ name: entry.name, path: relativePath, type: 'file', extension: ext });
      }
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

/** Exposed for testing only — builds a file tree from an arbitrary root path. */
export function buildFileTreeForTest(rootPath: string): FileNode[] {
  return buildFileTree(rootPath, rootPath);
}

function buildAllFiles(dirPath: string): string[] {
  const root = getMindRoot();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      files.push(...buildAllFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        const relativePath = path.relative(root, fullPath);
        if (!isDefaultMindSystemScaffoldFile(root, relativePath)) files.push(relativePath);
      }
    }
  }
  return files;
}

// ─── Public API: Tree & cache (app-specific) ─────────────────────────────────

/** Returns the cached file tree for the knowledge base. */
export function getFileTree(): FileNode[] {
  return ensureCache().tree;
}

/** Top-level Mind Spaces (same cached tree as home Spaces grid). */
export function listMindSpaces(): MindSpaceSummary[] {
  return summarizeTopLevelSpaces(getMindRoot(), ensureCache().tree);
}

/** Appends a structured change event to the change log. */
export function appendContentChange(input: ContentChangeInput): ContentChangeEvent {
  return coreAppendContentChange(getMindRoot(), input);
}

/**
 * Lists content change events with optional filtering.
 * @param options.path   Filter by file path (prefix match)
 * @param options.limit  Max events to return (default: unlimited)
 * @param options.source Filter by source: 'user' | 'agent' | 'system'
 * @param options.op     Filter by operation type (e.g. 'create', 'update', 'delete')
 * @param options.q      Free-text search within change descriptions
 */
export function listContentChanges(options: {
  path?: string;
  limit?: number;
  source?: 'user' | 'agent' | 'system';
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
  return ensureCache().allFiles;
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

/** Returns the immediate children (files + subdirs) of a directory. */
export function getDirEntries(dirPath: string): FileNode[] {
  const root = getMindRoot();
  const rootResolved = path.resolve(root);
  let resolved: string;
  try {
    resolved = resolveExistingSafe(rootResolved, dirPath);
  } catch {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(resolved, entry.name);
    const relativePath = path.relative(rootResolved, fullPath);
    if (entry.isDirectory()) {
      const children = buildFileTree(fullPath);
      if (children.length > 0) {
        nodes.push({ name: entry.name, path: relativePath, type: 'directory', children });
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        let mtime: number | undefined;
        try { mtime = fs.statSync(fullPath).mtimeMs; } catch { /* ignore */ }
        nodes.push({ name: entry.name, path: relativePath, type: 'file', extension: ext, mtime });
      }
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

/**
 * Returns the N most recently modified files.
 * @param limit Max files to return (default: 10)
 */
export function getRecentlyModified(limit = 10): Array<{ path: string; mtime: number }> {
  const root = getMindRoot();
  const allFiles = collectAllFiles();
  const withMtime = allFiles.map((filePath) => {
    try {
      const abs = resolveExistingSafe(root, filePath);
      const stat = fs.statSync(abs);
      return { path: filePath, mtime: stat.mtimeMs };
    } catch {
      return null;
    }
  }).filter(Boolean) as Array<{ path: string; mtime: number }>;

  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.slice(0, limit);
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
  invalidateCacheForNewFile(filePath);
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
// hybrid search in `lib/core/`. The old in-process Fuse.js index here had no
// query callers anymore (dead code) and was removed; what remains is the
// prewarm bookkeeping used by `/api/search/prewarm` to keep the tree cache
// warm and report a document count.

interface UiSearchPrewarmState {
  documentCount: number;
  timestamp: number;
  treeVersion: number;
}

let _searchIndex: UiSearchPrewarmState | null = null;

function getValidSearchIndex(): UiSearchPrewarmState | null {
  ensureCache();
  return _searchIndex !== null && _searchIndex.treeVersion === _treeVersion
    ? _searchIndex
    : null;
}

/** Warm the file-tree cache and report the searchable document count. */
export function prewarmSearchIndex(): SearchPrewarmResponse {
  const cached = getValidSearchIndex();
  if (cached) {
    telemetry.track('search.ui.prewarm', { cacheState: 'hit', documentCount: cached.documentCount });
    return { warmed: true, cacheState: 'hit', documentCount: cached.documentCount };
  }

  const stop = telemetry.startTimer('search.ui.index.build');
  const documentCount = collectAllFiles().length;
  _searchIndex = { documentCount, timestamp: Date.now(), treeVersion: _treeVersion };
  stop({ fileCount: documentCount, documentCount });
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
