import fs from 'fs';
import path from 'path';
import { FileNode, SearchResult } from './types';
import { effectiveSopRoot } from './settings';

/** Resolved MIND_ROOT — respects settings file override, then env var, then default */
export function getMindRoot(): string {
  return effectiveSopRoot();
}

/** Module-level export for backward compatibility (env-only, no settings override) */
export const MIND_ROOT = process.env.MIND_ROOT || '/data/home/geminitwang/code/my-mind';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'app', '.next', '.DS_Store']);
const ALLOWED_EXTENSIONS = new Set(['.md', '.csv']);

// ─── Security helpers ─────────────────────────────────────────────────────────

function assertWithinRoot(resolved: string, root: string): void {
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Access denied: path outside MIND_ROOT');
  }
}

function resolveSafe(filePath: string): { resolved: string; root: string } {
  const root = path.resolve(getMindRoot());
  const resolved = path.resolve(path.join(root, filePath));
  assertWithinRoot(resolved, root);
  return { resolved, root };
}

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
}

function ensureCache(): FileTreeCache {
  if (isCacheValid()) return _cache!;
  const root = getMindRoot();
  const tree = buildFileTree(root);
  const allFiles = buildAllFiles(root);
  _cache = { tree, allFiles, timestamp: Date.now() };
  return _cache;
}

// ─── Internal builders ────────────────────────────────────────────────────────

function buildFileTree(dirPath: string): FileNode[] {
  const root = getMindRoot();
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
      const children = buildFileTree(fullPath);
      if (children.length > 0) {
        nodes.push({ name: entry.name, path: relativePath, type: 'directory', children });
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

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns the cached file tree for the knowledge base. */
export function getFileTree(): FileNode[] {
  return ensureCache().tree;
}

/** Returns cached list of all file paths (relative to MIND_ROOT). */
export function collectAllFiles(): string[] {
  return ensureCache().allFiles;
}

/** Reads the content of a file given a relative path from MIND_ROOT. */
export function getFileContent(filePath: string): string {
  const { resolved } = resolveSafe(filePath);
  return fs.readFileSync(resolved, 'utf-8');
}

/** Atomically writes content to a file given a relative path from MIND_ROOT. */
export function saveFileContent(filePath: string, content: string): void {
  const { resolved } = resolveSafe(filePath);

  const dir = path.dirname(resolved);
  const tmpFile = path.join(dir, `.tmp-${Date.now()}-${path.basename(resolved)}`);
  try {
    fs.writeFileSync(tmpFile, content, 'utf-8');
    fs.renameSync(tmpFile, resolved);
  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch {}
    throw err;
  }
  invalidateCache();
}

/** Creates a new file at the given relative path. Creates parent dirs as needed. */
export function createFile(filePath: string, initialContent = ''): void {
  const { resolved } = resolveSafe(filePath);
  if (fs.existsSync(resolved)) {
    throw new Error('File already exists');
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, initialContent, 'utf-8');
  invalidateCache();
}

/** Returns whether a relative path is a directory within MIND_ROOT. */
export function isDirectory(filePath: string): boolean {
  try {
    const { resolved } = resolveSafe(filePath);
    return fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

/** Returns the immediate children (files + subdirs) of a directory. */
export function getDirEntries(dirPath: string): FileNode[] {
  const root = getMindRoot();
  const { resolved } = resolveSafe(dirPath);

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
    const relativePath = path.relative(root, fullPath);
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

export function deleteFile(filePath: string): void {
  const { resolved } = resolveSafe(filePath);
  fs.unlinkSync(resolved);
  invalidateCache();
}

/** Renames a file. newName must be a plain filename (no path separators). */
export function renameFile(oldPath: string, newName: string): string {
  // C2 fix: validate newName contains no path separators
  if (newName.includes('/') || newName.includes('\\')) {
    throw new Error('Invalid filename: must not contain path separators');
  }

  const root = path.resolve(getMindRoot());
  const oldResolved = path.resolve(path.join(root, oldPath));
  assertWithinRoot(oldResolved, root);

  const dir = path.dirname(oldResolved);
  const newResolved = path.join(dir, newName);
  assertWithinRoot(newResolved, root);

  if (fs.existsSync(newResolved)) {
    throw new Error('A file with that name already exists');
  }
  fs.renameSync(oldResolved, newResolved);
  invalidateCache();
  return path.relative(root, newResolved);
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

/** Full-text search across all files. Returns matching files with snippet context. */
export function searchFiles(query: string): SearchResult[] {
  if (!query.trim()) return [];

  const allFiles = collectAllFiles();
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  for (const filePath of allFiles) {
    let content: string;
    try {
      content = getFileContent(filePath);
    } catch {
      continue;
    }

    const lowerContent = content.toLowerCase();
    const index = lowerContent.indexOf(lowerQuery);
    if (index === -1) continue;

    const snippetStart = Math.max(0, index - 60);
    const snippetEnd = Math.min(content.length, index + query.length + 60);
    let snippet = content.slice(snippetStart, snippetEnd).replace(/\n/g, ' ').trim();
    if (snippetStart > 0) snippet = '...' + snippet;
    if (snippetEnd < content.length) snippet = snippet + '...';

    const occurrences = (lowerContent.match(new RegExp(lowerQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    const score = occurrences / content.length;

    results.push({ path: filePath, snippet, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

/** Finds files that reference the given filePath. */
export function getBacklinks(targetPath: string): SearchResult[] {
  const allFiles = collectAllFiles();
  const results: SearchResult[] = [];

  const fileName = path.basename(targetPath);
  const fileNameNoExt = path.basename(targetPath, path.extname(targetPath));
  const pathNoExt = targetPath.replace(/\.[^/.]+$/, "");

  const searchTerms = new Set([targetPath, fileName, fileNameNoExt, pathNoExt]);

  for (const filePath of allFiles) {
    if (filePath === targetPath) continue;

    let content: string;
    try {
      content = getFileContent(filePath);
    } catch {
      continue;
    }

    const lowerContent = content.toLowerCase();
    let found = false;
    let firstMatchIndex = -1;

    for (const term of searchTerms) {
      const lowerTerm = term.toLowerCase();
      const patterns = [
        `[[${lowerTerm}]]`,
        `[[${lowerTerm}|`,
        `(${lowerTerm})`,
        `(${lowerTerm}.md)`,
        `(${lowerTerm}.csv)`,
        `/${lowerTerm})`,
      ];

      for (const pattern of patterns) {
        const idx = lowerContent.indexOf(pattern.toLowerCase());
        if (idx !== -1) {
          found = true;
          firstMatchIndex = idx;
          break;
        }
      }
      if (found) break;
    }

    if (found) {
      const snippetStart = Math.max(0, firstMatchIndex - 60);
      const snippetEnd = Math.min(content.length, firstMatchIndex + 60);
      let snippet = content.slice(snippetStart, snippetEnd).replace(/\n/g, ' ').trim();
      if (snippetStart > 0) snippet = '...' + snippet;
      if (snippetEnd < content.length) snippet = snippet + '...';

      results.push({ path: filePath, snippet, score: 1 });
    }
  }

  return results;
}

// ─── Line-level operations ────────────────────────────────────────────────────

export function readLines(filePath: string): string[] {
  const content = getFileContent(filePath);
  return content.split('\n');
}

/** Validates line indices are within bounds */
function validateLineRange(totalLines: number, start: number, end: number): void {
  if (start < 0 || end < 0) throw new Error(`Invalid line index: indices must be >= 0`);
  if (start > end) throw new Error(`Invalid range: start (${start}) > end (${end})`);
  if (start >= totalLines) throw new Error(`Invalid line index: start (${start}) >= total lines (${totalLines})`);
}

export function insertLines(filePath: string, afterIndex: number, lines: string[]): void {
  const existing = readLines(filePath);
  if (afterIndex >= existing.length) throw new Error(`Invalid after_index: ${afterIndex} >= total lines (${existing.length})`);
  const insertAt = afterIndex < 0 ? 0 : afterIndex + 1;
  existing.splice(insertAt, 0, ...lines);
  saveFileContent(filePath, existing.join('\n'));
}

export function updateLines(filePath: string, startIndex: number, endIndex: number, newLines: string[]): void {
  const existing = readLines(filePath);
  validateLineRange(existing.length, startIndex, endIndex);
  existing.splice(startIndex, endIndex - startIndex + 1, ...newLines);
  saveFileContent(filePath, existing.join('\n'));
}

export function deleteLines(filePath: string, startIndex: number, endIndex: number): void {
  const existing = readLines(filePath);
  validateLineRange(existing.length, startIndex, endIndex);
  existing.splice(startIndex, endIndex - startIndex + 1);
  saveFileContent(filePath, existing.join('\n'));
}

// ─── High-level semantic operations ──────────────────────────────────────────

export function appendToFile(filePath: string, content: string): void {
  const existing = getFileContent(filePath);
  const separator = existing.length > 0 && !existing.endsWith('\n\n') ? '\n' : '';
  saveFileContent(filePath, existing + separator + content);
}

export function insertAfterHeading(filePath: string, heading: string, content: string): void {
  const lines = readLines(filePath);
  const idx = lines.findIndex(l => {
    const trimmed = l.trim();
    return trimmed === heading || trimmed.replace(/^#+\s*/, '') === heading.replace(/^#+\s*/, '');
  });
  if (idx === -1) throw new Error(`Heading not found: "${heading}"`);
  const headingLevel = (lines[idx].match(/^#+/) || [''])[0].length;
  let insertAt = idx + 1;
  while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
  insertLines(filePath, insertAt - 1, ['', content]);
}

export function updateSection(filePath: string, heading: string, newContent: string): void {
  const lines = readLines(filePath);
  const idx = lines.findIndex(l => {
    const trimmed = l.trim();
    return trimmed === heading || trimmed.replace(/^#+\s*/, '') === heading.replace(/^#+\s*/, '');
  });
  if (idx === -1) throw new Error(`Heading not found: "${heading}"`);

  const headingLevel = (lines[idx].match(/^#+/) || [''])[0].length;
  let sectionEnd = lines.length - 1;
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= headingLevel) {
      sectionEnd = i - 1;
      break;
    }
  }

  while (sectionEnd > idx && lines[sectionEnd].trim() === '') sectionEnd--;

  updateLines(filePath, idx + 1, sectionEnd, ['', newContent]);
}
