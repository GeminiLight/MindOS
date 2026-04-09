import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import type { FileNode } from './types';

const DEFAULT_IGNORED_DIRS = new Set(['.git', 'node_modules', 'app', '.next', '.DS_Store', 'mcp', '.media']);
const DEFAULT_ALLOWED_EXTENSIONS = new Set([
  '.md', '.csv', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac',
  '.mp4', '.webm', '.mov', '.mkv',
]);
const SYSTEM_FILES = new Set(['INSTRUCTION.md', 'README.md', 'CONFIG.json', 'CHANGELOG.md']);

export interface TreeOptions {
  ignoredDirs?: Set<string>;
  allowedExtensions?: Set<string>;
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
  const root = path.resolve(mindRoot);
  const dir = dirPath ?? root;
  const ignoredDirs = opts.ignoredDirs ?? DEFAULT_IGNORED_DIRS;
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
    const relativePath = path.relative(root, fullPath);

    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      const children = getFileTree(mindRoot, fullPath, opts);
      if (children.length > 0) {
        nodes.push({ name: entry.name, path: relativePath, type: 'directory', children });
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (allowedExtensions.has(ext)) {
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
  const root = path.resolve(mindRoot);
  const dir = dirPath ?? root;
  const ignoredDirs = opts.ignoredDirs ?? DEFAULT_IGNORED_DIRS;
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
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      files.push(...collectAllFiles(mindRoot, fullPath, opts));
    } else if (entry.isFile()) {
      if (dir === root && SYSTEM_FILES.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (allowedExtensions.has(ext)) {
        files.push(path.relative(root, fullPath));
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
      if (depth >= maxDepth) {
        lines.push(`${indent}${dir.name}/ (${total} files)`);
      } else {
        lines.push(`${indent}${dir.name}/ (${total} files)`);
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
  const root = path.resolve(mindRoot);
  const dir = dirPath ?? root;
  const ignoredDirs = opts.ignoredDirs ?? DEFAULT_IGNORED_DIRS;
  const allowedExtensions = opts.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;

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
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      subdirPromises.push(collectAllFilesAsync(mindRoot, fullPath, opts));
    } else if (entry.isFile()) {
      if (dir === root && SYSTEM_FILES.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (allowedExtensions.has(ext)) {
        files.push(path.relative(root, fullPath));
      }
    }
  }
  const subdirResults = await Promise.all(subdirPromises);
  for (const subFiles of subdirResults) {
    files.push(...subFiles);
  }
  return files;
}
