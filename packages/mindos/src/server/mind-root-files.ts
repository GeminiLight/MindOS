import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { resolveExistingSafe } from '../foundation/security/index.js';
import { createMindosSearchIgnoreMatcher, type MindosSearchIgnoreMatcher } from './search-ignore.js';

/**
 * Mind-root file enumeration shared by the tree cache, the search index and
 * the runtime helpers. Kept free of caching so every consumer applies the same
 * extension allow-list and `.mindosignore` rules.
 */

export const MINDOS_ALLOWED_FILE_EXTENSIONS = new Set([
  '.md', '.csv', '.json', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac',
  '.mp4', '.webm', '.mov', '.mkv',
]);

export const MINDOS_IGNORED_DIRS = new Set([
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
  '.media',
  'mcp',
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

export type MindosRuntimeFileStat = { path: string; mtime: number; size: number };

export function collectAllFilesFromMindRoot(mindRoot: string): string[] {
  const root = resolve(mindRoot);
  if (!existsSync(root)) return [];
  const files: string[] = [];
  walkMindRoot(root, root, (abs, rel) => {
    if (MINDOS_ALLOWED_FILE_EXTENSIONS.has(extname(abs).toLowerCase())) files.push(rel);
  });
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

export function collectFileStatsFromMindRoot(mindRoot: string): MindosRuntimeFileStat[] {
  const root = resolve(mindRoot);
  if (!existsSync(root)) return [];
  const files: MindosRuntimeFileStat[] = [];
  walkMindRoot(root, root, (abs, rel) => {
    if (!MINDOS_ALLOWED_FILE_EXTENSIONS.has(extname(abs).toLowerCase())) return;
    try {
      const stat = statSync(abs);
      files.push({ path: rel, mtime: stat.mtimeMs, size: stat.size });
    } catch {
      // Ignore files removed between directory traversal and stat.
    }
  });
  return files;
}

export function getRecentlyModifiedFromMindRoot(mindRoot: string, limit = 10): Array<{ path: string; mtime: number }> {
  const boundedLimit = Math.max(1, Math.min(limit, 30));
  return collectFileStatsFromMindRoot(mindRoot)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, boundedLimit);
}

export function getTreeVersionFromMindRoot(mindRoot: string): number {
  let version = 0;
  for (const file of collectFileStatsFromMindRoot(mindRoot)) {
    version = Math.max(version, Math.floor(file.mtime));
  }
  return version;
}

export function readTextFileFromMindRoot(mindRoot: string, filePath: string): string {
  return readFileSync(resolveExistingSafe(mindRoot, filePath), 'utf-8');
}

export function readLinesFromMindRoot(mindRoot: string, filePath: string): string[] {
  return readTextFileFromMindRoot(mindRoot, filePath).split(/\r?\n/);
}

export function listMindSpacesFromMindRoot(mindRoot: string): string[] {
  const root = resolve(mindRoot);
  if (!existsSync(root)) return [];
  const isIgnored = createMindosSearchIgnoreMatcher(root, MINDOS_IGNORED_DIRS);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !isIgnored(entry.name) && isMindSpaceDirectory(root, entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function isMindSpaceDirectory(root: string, name: string): boolean {
  const instructionPath = join(root, name, 'INSTRUCTION.md');
  return existsSync(instructionPath) && statSync(instructionPath).isFile();
}

export function listDirectoriesFromMindRoot(mindRoot: string): string[] {
  const root = resolve(mindRoot);
  if (!existsSync(root)) return [];
  const dirs: string[] = [];
  walkMindRoot(root, root, (_abs, rel, dirent) => {
    if (dirent.isDirectory()) dirs.push(rel);
  }, { includeDirectories: true, includeFiles: false });
  return dirs.sort((a, b) => a.localeCompare(b));
}

function walkMindRoot(
  root: string,
  dir: string,
  visit: (absolutePath: string, relativePath: string, dirent: Dirent) => void,
  options: { includeDirectories?: boolean; includeFiles?: boolean } = {},
) {
  const isIgnored = createMindosSearchIgnoreMatcher(root, MINDOS_IGNORED_DIRS);
  walkMindRootWithMatcher(root, dir, visit, options, isIgnored);
}

function walkMindRootWithMatcher(
  root: string,
  dir: string,
  visit: (absolutePath: string, relativePath: string, dirent: Dirent) => void,
  options: { includeDirectories?: boolean; includeFiles?: boolean },
  isIgnored: MindosSearchIgnoreMatcher,
) {
  const includeDirectories = options.includeDirectories === true;
  const includeFiles = options.includeFiles !== false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).split('\\').join('/');
    if (isIgnored(rel)) continue;
    if (entry.isDirectory()) {
      if (includeDirectories) visit(abs, rel, entry);
      walkMindRootWithMatcher(root, abs, visit, options, isIgnored);
      continue;
    }
    if (includeFiles && entry.isFile()) visit(abs, rel, entry);
  }
}
