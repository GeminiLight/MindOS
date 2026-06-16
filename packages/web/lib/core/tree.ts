import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import type { FileNode } from './types';
import { isDefaultMindSystemScaffoldFile } from '../mind-system-scaffold';

/** Normalize path separators to forward slash (POSIX) for cross-platform consistency.
 *  All relative paths stored in FileNode.path use '/' regardless of OS. */
function toPosix(p: string): string {
  // On Unix path.sep is already '/', this is a no-op.
  // On Windows, replace all backslashes. Using replace is safer than split/join
  // in case the path contains mixed separators.
  return process.platform === 'win32' ? p.replace(/\\/g, '/') : p;
}

export const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  'app',
  '.next',
  '.DS_Store',
  '.cache',
  '.cc-branch',
  '.claude',
  '.cursor',
  '.idea',
  '.mypy_cache',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.pnpm-store',
  '.pytest_cache',
  '.ruff_cache',
  '.svelte-kit',
  '.turbo',
  '.venv',
  '.vite',
  '.vscode',
  '.windsurf',
  '.yarn',
  'mcp',
  '.media',
  '.mindos',
  '.obsidian',
  '.plugins',
  'build',
  'coverage',
  'dist',
  'env',
  'out',
  'target',
  'venv',
  'vendor',
]);
const DEFAULT_ALLOWED_EXTENSIONS = new Set([
  '.md', '.csv', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac',
  '.mp4', '.webm', '.mov', '.mkv',
]);
const SYSTEM_FILES = new Set(['INSTRUCTION.md', 'README.md', 'CONFIG.json', 'CHANGELOG.md']);
export const MINDOS_IGNORE_FILE = '.mindosignore';

export interface TreeOptions {
  ignoredDirs?: Set<string>;
  allowedExtensions?: Set<string>;
  ignoredPaths?: string[];
}

export type SearchIgnoredPathMatcher = (relativePath: string, isDirectory?: boolean) => boolean;

function normalizePosixPath(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function normalizeSearchIgnoredPath(input: string): string | null {
  let value = normalizePosixPath(input.trim());
  if (!value || value.startsWith('#')) return null;
  // Negation is intentionally unsupported for the first MindOS ignore format.
  // Treating it as a literal path would surprise users more than skipping it.
  if (value.startsWith('!')) return null;
  value = value.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!value || value === '.' || value === '..') return null;
  if (value.split('/').includes('..')) return null;
  return value;
}

export function normalizeSearchIgnoredPaths(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeSearchIgnoredPath(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function parseSearchIgnoredPathsContent(content: string): string[] {
  return normalizeSearchIgnoredPaths(content.split(/\r?\n/));
}

export function readMindosIgnoreFile(mindRoot: string): string[] {
  try {
    const content = fs.readFileSync(path.join(mindRoot, MINDOS_IGNORE_FILE), 'utf-8');
    return parseSearchIgnoredPathsContent(content);
  } catch {
    return [];
  }
}

export function writeMindosIgnoreFile(mindRoot: string, ignoredPaths: string[]): string[] {
  const normalized = normalizeSearchIgnoredPaths(ignoredPaths);
  const content = [
    '# MindOS search ignored paths',
    '# One directory name, relative path, or simple glob per line.',
    ...normalized,
    '',
  ].join('\n');
  fs.mkdirSync(mindRoot, { recursive: true });
  fs.writeFileSync(path.join(mindRoot, MINDOS_IGNORE_FILE), content, 'utf-8');
  return normalized;
}

function hasGlob(rule: string): boolean {
  return /[*?[]/.test(rule);
}

function escapeRegexChar(char: string): string {
  return /[\\^$+?.()|{}[\]]/.test(char) ? `\\${char}` : char;
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern.charAt(i);
    const next = pattern.charAt(i + 1);
    if (char === '*' && next === '*') {
      source += '.*';
      i += 1;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegexChar(char);
  }
  source += '$';
  return new RegExp(source);
}

function createPatternMatcher(rule: string): SearchIgnoredPathMatcher {
  if (hasGlob(rule)) {
    const regex = globToRegExp(rule);
    const basenameRegex = rule.includes('/') ? null : globToRegExp(rule);
    const deepPrefix = rule.endsWith('/**') ? rule.slice(0, -3) : '';
    return (relativePath) => {
      const normalized = normalizePosixPath(relativePath).replace(/^\/+/, '');
      if (deepPrefix && (normalized === deepPrefix || normalized.startsWith(`${deepPrefix}/`))) return true;
      if (regex.test(normalized)) return true;
      if (!basenameRegex) return false;
      const basename = normalized.split('/').pop() ?? normalized;
      return basenameRegex.test(basename);
    };
  }

  if (rule.includes('/')) {
    return (relativePath) => {
      const normalized = normalizePosixPath(relativePath).replace(/^\/+/, '').replace(/\/+$/, '');
      return normalized === rule || normalized.startsWith(`${rule}/`);
    };
  }

  return (relativePath) => {
    const normalized = normalizePosixPath(relativePath).replace(/^\/+/, '');
    return normalized.split('/').includes(rule);
  };
}

export function createSearchIgnoreMatcher(
  mindRoot: string,
  opts: Pick<TreeOptions, 'ignoredDirs' | 'ignoredPaths'> = {},
): SearchIgnoredPathMatcher {
  const ignoredDirs = opts.ignoredDirs ?? DEFAULT_IGNORED_DIRS;
  const customRules = normalizeSearchIgnoredPaths([
    ...readMindosIgnoreFile(mindRoot),
    ...(opts.ignoredPaths ?? []),
  ]);
  const customMatchers = customRules.map(createPatternMatcher);

  return (relativePath: string) => {
    const normalized = normalizePosixPath(relativePath).replace(/^\/+/, '').replace(/\/+$/, '');
    if (!normalized || normalized === '.') return false;
    if (normalized.split('/').some((segment) => ignoredDirs.has(segment))) return true;
    return customMatchers.some((matcher) => matcher(normalized));
  };
}

export function isIgnoredTreePath(
  filePath: string,
  ignoredDirs: Set<string> = DEFAULT_IGNORED_DIRS,
  ignoredPaths: string[] = [],
): boolean {
  const normalized = normalizePosixPath(filePath).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.') return false;
  if (normalized.split('/').some((segment) => ignoredDirs.has(segment))) return true;
  return normalizeSearchIgnoredPaths(ignoredPaths)
    .map(createPatternMatcher)
    .some((matcher) => matcher(normalized));
}

function isPathWithinRoot(resolved: string, root: string): boolean {
  const relative = path.relative(root, resolved);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function resolveStartDirectory(mindRoot: string, dirPath?: string): { root: string; dir: string } | null {
  const root = path.resolve(mindRoot);
  const dir = dirPath ? path.resolve(dirPath) : root;
  try {
    const rootReal = fs.realpathSync(root);
    const dirReal = fs.realpathSync(dir);
    if (!isPathWithinRoot(dirReal, rootReal)) return null;
  } catch {
    return null;
  }
  return { root, dir };
}

/**
 * Builds a recursive file tree from dirPath.
 * Only includes files with allowed extensions and non-ignored directories.
 */
export function getFileTree(
  mindRoot: string,
  dirPath?: string,
  opts: TreeOptions = {}
): FileNode[] {
  const start = resolveStartDirectory(mindRoot, dirPath);
  if (!start) return [];
  const { root, dir } = start;
  const allowedExtensions = opts.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;
  const isIgnored = createSearchIgnoreMatcher(root, opts);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = toPosix(path.relative(root, fullPath));

    if (entry.isDirectory()) {
      if (isIgnored(relativePath, true)) continue;
      const children = getFileTreeForResolvedRoot(root, fullPath, opts, isIgnored);
      if (children.length > 0) {
        nodes.push({ name: entry.name, path: relativePath, type: 'directory', children });
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (allowedExtensions.has(ext) && !isIgnored(relativePath, false)) {
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

function getFileTreeForResolvedRoot(
  root: string,
  dir: string,
  opts: TreeOptions,
  isIgnored: SearchIgnoredPathMatcher,
): FileNode[] {
  const allowedExtensions = opts.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = toPosix(path.relative(root, fullPath));

    if (entry.isDirectory()) {
      if (isIgnored(relativePath, true)) continue;
      const children = getFileTreeForResolvedRoot(root, fullPath, opts, isIgnored);
      if (children.length > 0) {
        nodes.push({ name: entry.name, path: relativePath, type: 'directory', children });
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (allowedExtensions.has(ext) && !isIgnored(relativePath, false)) {
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

/**
 * Collects all file paths (relative to mindRoot) with allowed extensions.
 */
export function collectAllFiles(
  mindRoot: string,
  dirPath?: string,
  opts: TreeOptions = {}
): string[] {
  const start = resolveStartDirectory(mindRoot, dirPath);
  if (!start) return [];
  const { root, dir } = start;
  const allowedExtensions = opts.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;
  const isIgnored = createSearchIgnoreMatcher(root, opts);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = toPosix(path.relative(root, fullPath));
    if (entry.isDirectory()) {
      if (isIgnored(relativePath, true)) continue;
      files.push(...collectAllFilesForResolvedRoot(root, fullPath, opts, isIgnored));
    } else if (entry.isFile()) {
      if (dir === root && SYSTEM_FILES.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (allowedExtensions.has(ext) && !isIgnored(relativePath, false)) {
        if (!isDefaultMindSystemScaffoldFile(root, relativePath)) files.push(relativePath);
      }
    }
  }
  return files;
}

function collectAllFilesForResolvedRoot(
  root: string,
  dir: string,
  opts: TreeOptions,
  isIgnored: SearchIgnoredPathMatcher,
): string[] {
  const allowedExtensions = opts.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = toPosix(path.relative(root, fullPath));
    if (entry.isDirectory()) {
      if (isIgnored(relativePath, true)) continue;
      files.push(...collectAllFilesForResolvedRoot(root, fullPath, opts, isIgnored));
    } else if (entry.isFile()) {
      if (dir === root && SYSTEM_FILES.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (allowedExtensions.has(ext) && !isIgnored(relativePath, false)) {
        if (!isDefaultMindSystemScaffoldFile(root, relativePath)) files.push(relativePath);
      }
    }
  }
  return files;
}

/**
 * Renders a file tree as an ASCII tree string.
 */
export function renderTree(nodes: FileNode[], indent = ''): string {
  const lines: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const prefix = indent + (isLast ? '└── ' : '├── ');
    const childIndent = indent + (isLast ? '    ' : '│   ');
    lines.push(prefix + node.name + (node.type === 'directory' ? '/' : ''));
    if (node.children?.length) {
      lines.push(renderTree(node.children, childIndent));
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// File index — compact directory listing for agent bootstrap context
// ---------------------------------------------------------------------------

export interface FileIndexOptions extends TreeOptions {
  /** Max depth to expand (0 = root only). Default 2. */
  maxDepth?: number;
  /** Max files to list per directory before truncating. Default 15. */
  maxFilesPerDir?: number;
}

/**
 * Builds a compact file index string for agent bootstrap context.
 *
 * Output format (Plan B):
 *   Projects/ (12 files)
 *     Products/
 *       roadmap.md
 *       pricing.md
 *     Engineering/ (7 files)
 *       ... (7 files)
 *   Journal/ (30 files)
 *     2026-04.md
 *     2026-03.md
 *     ... (28 more)
 *
 * Directories beyond maxDepth collapse to "DirName/ (N files)".
 * Directories with more files than maxFilesPerDir show the first batch + "... (N more)".
 */
export function buildFileIndex(
  mindRoot: string,
  opts: FileIndexOptions = {},
): string {
  const maxDepth = opts.maxDepth ?? 2;
  const maxFilesPerDir = opts.maxFilesPerDir ?? 15;
  const tree = getFileTree(mindRoot, undefined, opts);
  if (tree.length === 0) return '(empty knowledge base)';

  const lines: string[] = [];

  function countFiles(nodes: FileNode[]): number {
    let count = 0;
    for (const n of nodes) {
      if (n.type === 'file') count++;
      else if (n.children) count += countFiles(n.children);
    }
    return count;
  }

  function walk(nodes: FileNode[], depth: number) {
    const indent = '  '.repeat(depth);
    const files = nodes.filter(n => n.type === 'file');
    const dirs = nodes.filter(n => n.type === 'directory');

    for (const dir of dirs) {
      const total = countFiles(dir.children ?? []);
      const label = total === 1 ? '1 file' : `${total} files`;
      if (depth >= maxDepth) {
        lines.push(`${indent}${dir.name}/ (${label})`);
      } else {
        lines.push(`${indent}${dir.name}/ (${label})`);
        walk(dir.children ?? [], depth + 1);
      }
    }

    const shown = files.slice(0, maxFilesPerDir);
    for (const f of shown) {
      lines.push(`${indent}${f.name}`);
    }
    const remaining = files.length - shown.length;
    if (remaining > 0) {
      lines.push(`${indent}... (${remaining} more)`);
    }
  }

  walk(tree, 0);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Async variants — non-blocking for use in API routes / hot paths
// ---------------------------------------------------------------------------

/**
 * Async version of collectAllFiles. Uses fs.promises.readdir to avoid
 * blocking the event loop on large directories (1000+ files).
 */
export async function collectAllFilesAsync(
  mindRoot: string,
  dirPath?: string,
  opts: TreeOptions = {}
): Promise<string[]> {
  const start = resolveStartDirectory(mindRoot, dirPath);
  if (!start) return [];
  const { root, dir } = start;
  const allowedExtensions = opts.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;
  const isIgnored = createSearchIgnoreMatcher(root, opts);

  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  // Process subdirectories in parallel
  const subdirPromises: Promise<string[]>[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = toPosix(path.relative(root, fullPath));
    if (entry.isDirectory()) {
      if (isIgnored(relativePath, true)) continue;
      subdirPromises.push(collectAllFilesAsyncForResolvedRoot(root, fullPath, opts, isIgnored));
    } else if (entry.isFile()) {
      if (dir === root && SYSTEM_FILES.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (allowedExtensions.has(ext) && !isIgnored(relativePath, false)) {
        if (!isDefaultMindSystemScaffoldFile(root, relativePath)) files.push(relativePath);
      }
    }
  }
  const subdirResults = await Promise.all(subdirPromises);
  for (const subFiles of subdirResults) {
    files.push(...subFiles);
  }
  return files;
}

async function collectAllFilesAsyncForResolvedRoot(
  root: string,
  dir: string,
  opts: TreeOptions,
  isIgnored: SearchIgnoredPathMatcher,
): Promise<string[]> {
  const allowedExtensions = opts.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;

  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  const subdirPromises: Promise<string[]>[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = toPosix(path.relative(root, fullPath));
    if (entry.isDirectory()) {
      if (isIgnored(relativePath, true)) continue;
      subdirPromises.push(collectAllFilesAsyncForResolvedRoot(root, fullPath, opts, isIgnored));
    } else if (entry.isFile()) {
      if (dir === root && SYSTEM_FILES.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (allowedExtensions.has(ext) && !isIgnored(relativePath, false)) {
        if (!isDefaultMindSystemScaffoldFile(root, relativePath)) files.push(relativePath);
      }
    }
  }
  const subdirResults = await Promise.all(subdirPromises);
  for (const subFiles of subdirResults) files.push(...subFiles);
  return files;
}
