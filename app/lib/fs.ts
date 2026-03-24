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
  summarizeTopLevelSpaces,
} from './core';
import type { MindSpaceSummary } from './core';
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

// ─── In-memory cache ──────────────────────────────────────────────────────────

interface FileTreeCache {
  tree: FileNode[];
  allFiles: string[];
  timestamp: number;
}

let _cache: FileTreeCache | null = null;
const CACHE_TTL_MS = 5_000; // 5 seconds

function isCacheValid(): boolean {
  return _cache !== null && (Date.now() - _cache.timestamp) < CACHE_TTL_MS;
}

/** Invalidate cache — call after any write/create/delete/rename operation */
export function invalidateCache(): void {
  _cache = null;
  _searchIndex = null;
  invalidateSearchIndex();
}

function ensureCache(): FileTreeCache {
  if (isCacheValid()) return _cache!;
  const root = getMindRoot();
  const tree = buildFileTree(root);
  // Extract all file paths from the tree to avoid a second full traversal.
  const allFiles: string[] = [];
  function collect(nodes: FileNode[]) {
    for (const n of nodes) {
      if (n.type === 'file') allFiles.push(n.path);
      else if (n.children) collect(n.children);
    }
  }
  collect(tree);
  _cache = { tree, allFiles, timestamp: Date.now() };
  return _cache;
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
  invalidateCache();
}

/** Creates a new file at the given relative path. Creates parent dirs as needed. */
export function createFile(filePath: string, initialContent = ''): void {
  coreCreateFile(getMindRoot(), filePath, initialContent);
  invalidateCache();
}

export function deleteFile(filePath: string): void {
  coreDeleteFile(getMindRoot(), filePath);
  invalidateCache();
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

// ─── Public API: Line-level operations (delegated to @mindos/core) ───────────

export function readLines(filePath: string): string[] {
  return coreReadLines(getMindRoot(), filePath);
}

export function insertLines(filePath: string, afterIndex: number, lines: string[]): void {
  coreInsertLines(getMindRoot(), filePath, afterIndex, lines);
  invalidateCache();
}

export function updateLines(filePath: string, startIndex: number, endIndex: number, newLines: string[]): void {
  coreUpdateLines(getMindRoot(), filePath, startIndex, endIndex, newLines);
  invalidateCache();
}

export function deleteLines(filePath: string, startIndex: number, endIndex: number): void {
  const existing = readLines(filePath);
  if (startIndex < 0 || endIndex < 0) throw new MindOSError(ErrorCodes.INVALID_RANGE, 'Invalid line index: indices must be >= 0', { startIndex, endIndex });
  if (startIndex > endIndex) throw new MindOSError(ErrorCodes.INVALID_RANGE, `Invalid range: start (${startIndex}) > end (${endIndex})`, { startIndex, endIndex });
  if (startIndex >= existing.length) throw new MindOSError(ErrorCodes.INVALID_RANGE, `Invalid line index: start (${startIndex}) >= total lines (${existing.length})`, { startIndex, totalLines: existing.length });
  existing.splice(startIndex, endIndex - startIndex + 1);
  saveFileContent(filePath, existing.join('\n'));
}

// ─── Public API: High-level semantic operations (delegated to @mindos/core) ──

export function appendToFile(filePath: string, content: string): void {
  coreAppendToFile(getMindRoot(), filePath, content);
  invalidateCache();
}

export function insertAfterHeading(filePath: string, heading: string, content: string): void {
  coreInsertAfterHeading(getMindRoot(), filePath, heading, content);
  invalidateCache();
}

export function updateSection(filePath: string, heading: string, newContent: string): void {
  coreUpdateSection(getMindRoot(), filePath, heading, newContent);
  invalidateCache();
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

  const snippetStart = Math.max(0, bestStart - 60);
  const snippetEnd = Math.min(content.length, bestEnd + 61);

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

  let snippet = content.slice(start, end).replace(/\n/g, ' ').trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  return snippet;
}

// ─── Public API: CSV (delegated to @mindos/core) ────────────────────────────

export function appendCsvRow(filePath: string, row: string[]): { newRowCount: number } {
  const result = coreAppendCsvRow(getMindRoot(), filePath, row);
  invalidateCache();
  return result;
}

// ─── Public API: Move file (delegated to @mindos/core) ──────────────────────

export function moveFile(fromPath: string, toPath: string): { newPath: string; affectedFiles: string[] } {
  const result = coreMoveFile(getMindRoot(), fromPath, toPath, coreFindBacklinks);
  invalidateCache();
  return result;
}

// ─── Public API: Git operations (delegated to @mindos/core) ─────────────────

export function isGitRepo(): boolean {
  return coreIsGitRepo(getMindRoot());
}

export function gitLog(filePath: string, limit = 10): Array<{ hash: string; date: string; message: string; author: string }> {
  return coreGitLog(getMindRoot(), filePath, limit);
}

export function gitShowFile(filePath: string, commit: string): string {
  return coreGitShowFile(getMindRoot(), filePath, commit);
}

// ─── Public API: Backlinks (delegated to @mindos/core) ──────────────────────

import type { BacklinkEntry } from './core/types';
export type { BacklinkEntry } from './core/types';
export type { MindSpaceSummary } from './core';

export function findBacklinks(targetPath: string): BacklinkEntry[] {
  return coreFindBacklinks(getMindRoot(), targetPath);
}

