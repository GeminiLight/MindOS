import fs from 'fs';
import path from 'path';
import Fuse, { FuseResultMatch } from 'fuse.js';
import { MindOSError, ErrorCodes } from '@/lib/errors';
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
  readLines as coreReadLines,
  insertLines as coreInsertLines,
  updateLines as coreUpdateLines,
  appendToFile as coreAppendToFile,
  insertAfterHeading as coreInsertAfterHeading,
  updateSection as coreUpdateSection,
  appendCsvRow as coreAppendCsvRow,
  findBacklinks as coreFindBacklinks,
  isGitRepo as coreIsGitRepo,
  gitLog as coreGitLog,
  gitShowFile as coreGitShowFile,
  invalidateSearchIndex,
  updateSearchIndexFile,
  addSearchIndexFile,
  removeSearchIndexFile,
  LinkIndex,
  summarizeTopLevelSpaces,
  appendContentChange as coreAppendContentChange,
  listContentChanges as coreListContentChanges,
  markContentChangesSeen as coreMarkContentChangesSeen,
  getContentChangeSummary as coreGetContentChangeSummary,
} from './core';
import type { MindSpaceSummary } from './core';
import type { ContentChangeEvent, ContentChangeInput, ContentChangeSummary } from './core';
import { FileNode, SpacePreview } from './core/types';
import { SearchMatch } from './types';
import { effectiveSopRoot } from './settings';

// ─── Root helpers ─────────────────────────────────────────────────────────────

/** Resolved MIND_ROOT — respects settings file override, then env var, then default */
export function getMindRoot(): string {
  return effectiveSopRoot();
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'app', '.next', '.DS_Store']);
const ALLOWED_EXTENSIONS = new Set(['.md', '.csv', '.json']);
const SYSTEM_FILES = new Set(['INSTRUCTION.md', 'README.md', 'CONFIG.json', 'CHANGELOG.md', 'TODO.md']);

// ─── In-memory cache ──────────────────────────────────────────────────────────

interface FileTreeCache {
  tree: FileNode[];
  allFiles: string[];
  timestamp: number;
}

let _cache: FileTreeCache | null = null;
const CACHE_TTL_MS = 5_000; // 5 seconds

let _treeVersion = 0;

function buildCache(root: string): FileTreeCache {
  const tree = buildFileTree(root);
  const allFiles: string[] = [];
  function collect(nodes: FileNode[]) {
    for (const n of nodes) {
      if (n.type === 'file') allFiles.push(n.path);
      else if (n.children) collect(n.children);
    }
  }
  collect(tree);
  return { tree, allFiles, timestamp: Date.now() };
}

function sameFileList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((p, i) => p === sb[i]);
}

/** Monotonically increasing counter — bumped on every file mutation so the
 *  client can cheaply detect changes without rebuilding the full tree. */
export function getTreeVersion(): number {
  if (_cache && !isCacheValid()) {
    const next = buildCache(getMindRoot());
    const changed = !sameFileList(_cache.allFiles, next.allFiles);
    _cache = next;
    _searchIndex = null;
    if (changed) _treeVersion++;
  }
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
  invalidateSearchIndex();
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
  updateSearchIndexFile(getMindRoot(), filePath);
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
  addSearchIndexFile(getMindRoot(), filePath);
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
  removeSearchIndexFile(filePath);
  if (_linkIndex.isBuilt()) _linkIndex.removeFile(filePath);
}

function ensureCache(): FileTreeCache {
  if (isCacheValid()) return _cache!;
  const root = getMindRoot();
  _cache = buildCache(root);
  // Lazily start the file watcher on first cache build
  if (!_watcher) startFileWatcher();
  return _cache;
}

// ─── File System Watcher ──────────────────────────────────────────────────────
// Watches mindRoot for external changes (VSCode, Finder, git pull) and
// invalidates cache immediately instead of waiting for the 5s TTL.

let _watcher: fs.FSWatcher | null = null;
let _watchDebounce: ReturnType<typeof setTimeout> | null = null;

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
      if (!filename) return;
      // Ignore .git internals, node_modules, .next
      if (filename.startsWith('.git') || filename.includes('node_modules') || filename.includes('.next')) return;
      // Debounce: batch rapid file changes into one cache invalidation
      if (_watchDebounce) clearTimeout(_watchDebounce);
      _watchDebounce = setTimeout(() => {
        _cache = null; // Invalidate tree cache — next read will rebuild
        _watchDebounce = null;
      }, 500);
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
  if (_watcher) { _watcher.close(); _watcher = null; }
}

// ─── Internal builders ────────────────────────────────────────────────────────

const SPACE_PREVIEW_MAX_LINES = 3;

function extractBodyLines(filePath: string, maxLines: number): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const bodyLines: string[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      bodyLines.push(trimmed);
      if (bodyLines.length >= maxLines) break;
    }
    return bodyLines;
  } catch { return []; }
}

function buildSpacePreview(dirAbsPath: string) {
  return {
    instructionLines: extractBodyLines(path.join(dirAbsPath, 'INSTRUCTION.md'), SPACE_PREVIEW_MAX_LINES),
    readmeLines: extractBodyLines(path.join(dirAbsPath, 'README.md'), SPACE_PREVIEW_MAX_LINES),
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
      // Filter out system files at root level
      if (dirPath === root && SYSTEM_FILES.has(entry.name)) continue;
      
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
      // Filter out system files at root level
      if (dirPath === root && SYSTEM_FILES.has(entry.name)) continue;
      
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        files.push(path.relative(root, fullPath));
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
  const abs = path.join(root, dirPath);
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
    const root = path.resolve(getMindRoot());
    const resolved = path.resolve(path.join(root, filePath));
    return fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

/** Returns the immediate children (files + subdirs) of a directory. */
export function getDirEntries(dirPath: string): FileNode[] {
  const root = getMindRoot();
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(path.join(rootResolved, dirPath));

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
      const abs = path.join(root, filePath);
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

/** Reads the content of a file given a relative path from MIND_ROOT. */
export function getFileContent(filePath: string): string {
  return coreReadFile(getMindRoot(), filePath);
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

/** App-level search result (extends core SearchResult with Fuse.js match details) */
export interface AppSearchResult {
  path: string;
  snippet: string;
  score: number;
  matches?: SearchMatch[];
}

// ─── Search (app-specific: Fuse.js fuzzy search with CJK support) ────────────
//
// This is the frontend search used by the ⌘K overlay in the browser.
// It uses Fuse.js for fuzzy matching with CJK language support.
//
// NOTE: A separate literal search exists in `lib/core/search.ts`, used by
// the MCP server via the REST API. The two coexist intentionally:
// - App search (here): Fuse.js fuzzy match, best for interactive UI search
// - Core search (lib/core/search.ts): exact literal match with filters, best for MCP tools

const MAX_CONTENT_LENGTH = 50_000;

interface SearchIndex {
  fuse: InstanceType<typeof Fuse<SearchDocument>>;
  documents: SearchDocument[];
  timestamp: number;
}

interface SearchDocument {
  path: string;
  fileName: string;
  content: string;
}

let _searchIndex: SearchIndex | null = null;

function getSearchIndex(): SearchIndex {
  if (_searchIndex && isCacheValid()) return _searchIndex;

  const allFiles = collectAllFiles();
  const documents: SearchDocument[] = [];

  for (const filePath of allFiles) {
    let content: string;
    try {
      content = getFileContent(filePath);
    } catch {
      continue;
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.slice(0, MAX_CONTENT_LENGTH);
    }
    documents.push({
      path: filePath,
      fileName: path.basename(filePath),
      content,
    });
  }

  const fuse = new Fuse(documents, {
    keys: [
      { name: 'fileName', weight: 0.3 },
      { name: 'path', weight: 0.2 },
      { name: 'content', weight: 0.5 },
    ],
    includeScore: true,
    includeMatches: true,
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
    useExtendedSearch: true,
  });

  _searchIndex = { fuse, documents, timestamp: Date.now() };
  return _searchIndex;
}

/** Full-text search across all files using Fuse.js fuzzy matching. */
export function searchFiles(query: string): AppSearchResult[] {
  if (!query.trim()) return [];

  const { fuse } = getSearchIndex();

  const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(query);
  const searchQuery = hasCJK ? `'${query}` : query;

  const fuseResults = fuse.search(searchQuery, { limit: 20 });

  return fuseResults.map((r) => {
    const filePath = r.item.path;
    const content = r.item.content;
    const score = 1 - (r.score ?? 1);

    const snippet = generateSnippet(content, r.matches);

    const matches = r.matches?.map((m) => ({
      indices: m.indices as [number, number][],
      value: m.value ?? '',
      key: m.key ?? '',
    }));

    return { path: filePath, snippet, score, matches };
  });
}

/** Pick the best (longest) content match and build a context snippet around it. */
function generateSnippet(
  content: string,
  matches?: readonly FuseResultMatch[],
): string {
  const contentMatch = matches?.find((m) => m.key === 'content');
  if (!contentMatch || contentMatch.indices.length === 0) {
    const s = content.slice(0, 120).replace(/\n/g, ' ').trim();
    return content.length > 120 ? s + '...' : s;
  }

  let bestStart = 0, bestEnd = 0, bestLen = 0;
  for (const [ms, me] of contentMatch.indices) {
    const len = me - ms;
    if (len > bestLen) {
      bestStart = ms;
      bestEnd = me;
      bestLen = len;
    }
  }

  const snippetStart = Math.max(0, bestStart - 120);
  const snippetEnd = Math.min(content.length, bestEnd + 120);

  let start = snippetStart;
  if (start > 0) {
    const spaceIdx = content.indexOf(' ', start);
    if (spaceIdx !== -1 && spaceIdx < bestStart) start = spaceIdx + 1;
  }
  let end = snippetEnd;
  if (end < content.length) {
    const spaceIdx = content.lastIndexOf(' ', end);
    if (spaceIdx > bestEnd) end = spaceIdx;
  }

  let snippet = content.slice(start, end).trim();
  // Collapse multiple newlines into spaces but keep single newlines
  snippet = snippet.replace(/\n{2,}/g, ' ↵ ');
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  return snippet;
}

// ─── Public API: CSV (delegated to @mindos/core) ────────────────────────────

/**
 * Appends a row to a CSV file.
 * @returns Object with the new total row count
 */
export function appendCsvRow(filePath: string, row: string[]): { newRowCount: number } {
  const result = coreAppendCsvRow(getMindRoot(), filePath, row);
  invalidateCache();
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

