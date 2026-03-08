import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileNode, SearchResult } from './types';

export const MIND_ROOT = process.env.MIND_ROOT || '/data/home/geminitwang/code/my-mind';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'app', '.next', '.DS_Store']);
const ALLOWED_EXTENSIONS = new Set(['.md', '.csv']);

/**
 * Recursively reads a directory and returns a tree of FileNode.
 * Only includes .md and .csv files; ignores system directories.
 */
export function getFileTree(dirPath: string = MIND_ROOT): FileNode[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(MIND_ROOT, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const children = getFileTree(fullPath);
      // Only include directories that contain relevant files
      if (children.length > 0) {
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children,
        });
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
          extension: ext,
        });
      }
    }
  }

  // Sort: directories first, then files, both alphabetically
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

/**
 * Reads the content of a file given a relative path from MIND_ROOT.
 */
export function getFileContent(filePath: string): string {
  const absolutePath = path.join(MIND_ROOT, filePath);
  // Security: ensure the resolved path is within MIND_ROOT
  const resolved = path.resolve(absolutePath);
  const root = path.resolve(MIND_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Access denied: path outside MIND_ROOT');
  }
  return fs.readFileSync(resolved, 'utf-8');
}

/**
 * Atomically writes content to a file given a relative path from MIND_ROOT.
 */
export function saveFileContent(filePath: string, content: string): void {
  const absolutePath = path.join(MIND_ROOT, filePath);
  const resolved = path.resolve(absolutePath);
  const root = path.resolve(MIND_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Access denied: path outside MIND_ROOT');
  }

  // Atomic write: write to a temp file first, then rename
  const dir = path.dirname(resolved);
  const tmpFile = path.join(dir, `.tmp-${Date.now()}-${path.basename(resolved)}`);
  try {
    fs.writeFileSync(tmpFile, content, 'utf-8');
    fs.renameSync(tmpFile, resolved);
  } catch (err) {
    // Clean up temp file if something goes wrong
    try { fs.unlinkSync(tmpFile); } catch {}
    throw err;
  }
}

/**
 * Creates a new file at the given relative path from MIND_ROOT.
 * Creates parent directories as needed.
 */
export function createFile(filePath: string, initialContent = ''): void {
  const absolutePath = path.join(MIND_ROOT, filePath);
  const resolved = path.resolve(absolutePath);
  const root = path.resolve(MIND_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Access denied: path outside MIND_ROOT');
  }
  if (fs.existsSync(resolved)) {
    throw new Error('File already exists');
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, initialContent, 'utf-8');
}

/**
 * Returns whether a relative path is a directory within MIND_ROOT.
 */
export function isDirectory(filePath: string): boolean {
  const absolutePath = path.join(MIND_ROOT, filePath);
  const resolved = path.resolve(absolutePath);
  const root = path.resolve(MIND_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return false;
  try {
    return fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Returns the immediate children (files + subdirs) of a directory,
 * filtered to allowed types. Returns a flat list of FileNode (no recursion).
 */
export function getDirEntries(dirPath: string): FileNode[] {
  const absolutePath = path.join(MIND_ROOT, dirPath);
  const resolved = path.resolve(absolutePath);
  const root = path.resolve(MIND_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Access denied: path outside MIND_ROOT');
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
    const relativePath = path.relative(MIND_ROOT, fullPath);
    if (entry.isDirectory()) {
      // Only include dirs that contain relevant files
      const children = getFileTree(fullPath);
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
  const absolutePath = path.join(MIND_ROOT, filePath);
  const resolved = path.resolve(absolutePath);
  const root = path.resolve(MIND_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Access denied: path outside MIND_ROOT');
  }
  fs.unlinkSync(resolved);
}

/**
 * Renames a file given relative paths from MIND_ROOT.
 */
export function renameFile(oldPath: string, newName: string): string {
  const oldAbsolute = path.join(MIND_ROOT, oldPath);
  const oldResolved = path.resolve(oldAbsolute);
  const root = path.resolve(MIND_ROOT);
  if (!oldResolved.startsWith(root + path.sep)) {
    throw new Error('Access denied: path outside MIND_ROOT');
  }
  const dir = path.dirname(oldResolved);
  const newResolved = path.join(dir, newName);
  if (!newResolved.startsWith(root + path.sep)) {
    throw new Error('Access denied: path outside MIND_ROOT');
  }
  if (fs.existsSync(newResolved)) {
    throw new Error('A file with that name already exists');
  }
  fs.renameSync(oldResolved, newResolved);
  return path.relative(MIND_ROOT, newResolved);
}


export function getRecentlyModified(limit = 10): Array<{ path: string; mtime: number }> {
  const allFiles = collectAllFiles();
  const withMtime = allFiles.map((filePath) => {
    try {
      const abs = path.join(MIND_ROOT, filePath);
      const stat = fs.statSync(abs);
      return { path: filePath, mtime: stat.mtimeMs };
    } catch {
      return null;
    }
  }).filter(Boolean) as Array<{ path: string; mtime: number }>;

  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.slice(0, limit);
}

/**
 * Recursively collects all .md and .csv file paths (relative to MIND_ROOT).
 */
export function collectAllFiles(dirPath: string = MIND_ROOT): string[] {
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
      files.push(...collectAllFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        files.push(path.relative(MIND_ROOT, fullPath));
      }
    }
  }
  return files;
}

/**
 * Full-text search across all files.
 * Returns matching files with snippet context.
 */
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

    // Extract a snippet around the match
    const snippetStart = Math.max(0, index - 60);
    const snippetEnd = Math.min(content.length, index + query.length + 60);
    let snippet = content.slice(snippetStart, snippetEnd).replace(/\n/g, ' ').trim();
    if (snippetStart > 0) snippet = '...' + snippet;
    if (snippetEnd < content.length) snippet = snippet + '...';

    // Simple relevance score: more occurrences = higher score
    const occurrences = (lowerContent.match(new RegExp(lowerQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    const score = occurrences / content.length;

    results.push({ path: filePath, snippet, score });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

// ─── Line-level operations ────────────────────────────────────────────────────

/**
 * Returns the file content split into lines (no trailing newline on last line).
 */
export function readLines(filePath: string): string[] {
  const content = getFileContent(filePath);
  return content.split('\n');
}

/**
 * Inserts `lines` after the given 0-based `afterIndex`.
 * Use afterIndex = -1 to prepend, afterIndex = lines.length - 1 to append.
 */
export function insertLines(filePath: string, afterIndex: number, lines: string[]): void {
  const existing = readLines(filePath);
  const insertAt = afterIndex < 0 ? 0 : afterIndex + 1;
  existing.splice(insertAt, 0, ...lines);
  saveFileContent(filePath, existing.join('\n'));
}

/**
 * Replaces lines from `startIndex` to `endIndex` (both inclusive, 0-based)
 * with `newLines`.
 */
export function updateLines(filePath: string, startIndex: number, endIndex: number, newLines: string[]): void {
  const existing = readLines(filePath);
  existing.splice(startIndex, endIndex - startIndex + 1, ...newLines);
  saveFileContent(filePath, existing.join('\n'));
}

/**
 * Deletes lines from `startIndex` to `endIndex` (both inclusive, 0-based).
 */
export function deleteLines(filePath: string, startIndex: number, endIndex: number): void {
  const existing = readLines(filePath);
  existing.splice(startIndex, endIndex - startIndex + 1);
  saveFileContent(filePath, existing.join('\n'));
}

// ─── High-level semantic operations ──────────────────────────────────────────

/**
 * Appends `content` to the end of a file, preceded by a blank line if the
 * file doesn't already end with one.
 */
export function appendToFile(filePath: string, content: string): void {
  const existing = getFileContent(filePath);
  const separator = existing.length > 0 && !existing.endsWith('\n\n') ? '\n' : '';
  saveFileContent(filePath, existing + separator + content);
}

/**
 * Inserts `content` immediately after the first line matching `heading`
 * (exact heading text, e.g. "## Introduction"). Throws if heading not found.
 */
export function insertAfterHeading(filePath: string, heading: string, content: string): void {
  const lines = readLines(filePath);
  // Match heading with optional leading #s — try exact match first, then text match
  const idx = lines.findIndex(l => {
    const trimmed = l.trim();
    return trimmed === heading || trimmed.replace(/^#+\s*/, '') === heading.replace(/^#+\s*/, '');
  });
  if (idx === -1) throw new Error(`Heading not found: "${heading}"`);
  // Find end of heading's existing content block (next same-level or higher heading)
  const headingLevel = (lines[idx].match(/^#+/) || [''])[0].length;
  let insertAt = idx + 1;
  // Skip blank lines immediately after heading
  while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
  insertLines(filePath, insertAt - 1, ['', content]);
}

/**
 * Replaces the content of a section identified by `heading` with `newContent`.
 * The section spans from the line after the heading to the line before the
 * next heading of equal or higher level (or end of file).
 */
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

  // Trim trailing blank lines from section
  while (sectionEnd > idx && lines[sectionEnd].trim() === '') sectionEnd--;

  updateLines(filePath, idx + 1, sectionEnd, ['', newContent]);
}
