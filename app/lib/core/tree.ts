import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import type { FileNode } from './types';

const DEFAULT_IGNORED_DIRS = new Set(['.git', 'node_modules', 'app', '.next', '.DS_Store', 'mcp']);
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
