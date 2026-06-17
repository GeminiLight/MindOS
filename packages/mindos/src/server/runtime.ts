import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, type Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { resolveExistingSafe, resolveSafe } from '../foundation/security/index.js';
import {
  createMindosSearchIgnoreMatcher,
  readMindosIgnoreFile,
  writeMindosIgnoreFile,
  type MindosSearchIgnoreMatcher,
} from './search-ignore.js';

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

export type MindosRuntimeFileNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: MindosRuntimeFileNode[];
};

export type MindosRuntimeSettings = {
  mindRoot?: string;
  acpAgents?: Record<string, import('../protocols/acp/index.js').AcpAgentOverride>;
  agentRuntimeEnv?: import('../agent/runtime/runtime-env.js').AgentRuntimeEnvironmentSettings;
  disabledSkills?: string[];
  skillPaths?: {
    enableAgentsDir?: boolean;
    custom?: string[];
  };
  searchIgnoredPaths?: string[];
  installedSkillAgents?: Array<{ agent: string; skill: string; path: string }>;
  [key: string]: unknown;
};

export type MindosRuntimeSkillRoot = {
  path: string;
  source: 'builtin' | 'user';
  origin: 'app-builtin' | 'mindos-user' | 'mindos-global' | 'agents-global' | 'custom' | 'project-builtin';
  editable: boolean;
};

export function expandMindosSkillPath(input: string, home: string): string {
  const trimmed = input.trim();
  if (trimmed === '~') return home;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(home, trimmed.slice(2));
  }
  return trimmed;
}

export type MindosRuntimeSearchResult = {
  path: string;
  snippet: string;
  score: number;
};

export type MindosRuntimeSearchOptions = {
  limit?: number;
  scope?: string;
  file_type?: 'md' | 'csv' | 'all';
  modified_after?: string;
};

type MindosRuntimeFileStat = { path: string; mtime: number; size: number };

export type MindosRuntimeOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  readSettings?: () => MindosRuntimeSettings;
};

export function getDefaultMindRoot(options: MindosRuntimeOptions = {}): string {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const settings = safeReadSettings(options);
  return settings.mindRoot || env.MIND_ROOT || join(home, 'MindOS', 'mind');
}

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
    .filter((entry) => entry.isDirectory() && !isIgnored(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
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

export function getSkillRootsFromRuntime(options: {
  mindRoot: string;
  runtimeRoot?: string;
  homeDir?: string;
  settings?: MindosRuntimeSettings;
}): MindosRuntimeSkillRoot[] {
  const home = options.homeDir ?? homedir();
  const runtimeRoot = options.runtimeRoot ? resolve(options.runtimeRoot) : process.cwd();
  const settings = options.settings ?? {};
  const roots: MindosRuntimeSkillRoot[] = [
    {
      path: join(runtimeRoot, 'packages', 'web', 'data', 'skills'),
      source: 'builtin',
      origin: 'app-builtin',
      editable: false,
    },
    {
      path: join(runtimeRoot, 'skills'),
      source: 'builtin',
      origin: 'project-builtin',
      editable: false,
    },
    {
      path: join(options.mindRoot, '.skills'),
      source: 'user',
      origin: 'mindos-user',
      editable: true,
    },
    {
      path: join(home, '.mindos', 'skills'),
      source: 'user',
      origin: 'mindos-global',
      editable: true,
    },
  ];

  // ~/.agents/skills and custom paths point at directories owned by external
  // agents (or the npx skills ecosystem). MindOS lists them read-only — they are
  // managed by their own agent, like builtins (edit/delete only works for the
  // MindOS-managed roots above anyway).
  if (settings.skillPaths?.enableAgentsDir !== false) {
    roots.push({
      path: join(home, '.agents', 'skills'),
      source: 'builtin',
      origin: 'agents-global',
      editable: false,
    });
  }

  const customSkillPaths = Array.isArray(settings.skillPaths?.custom) ? settings.skillPaths.custom : [];
  for (const custom of customSkillPaths) {
    if (typeof custom !== 'string') continue;
    const trimmed = expandMindosSkillPath(custom, home);
    if (!trimmed) continue;
    roots.push({
      path: trimmed,
      source: 'builtin',
      origin: 'custom',
      editable: false,
    });
  }

  return roots;
}

export function readRuntimeSettings(options: MindosRuntimeOptions): MindosRuntimeSettings {
  return safeReadSettings(options);
}

export function writeRuntimeSettings(settings: MindosRuntimeSettings, options: MindosRuntimeOptions = {}): void {
  const home = options.homeDir ?? homedir();
  const settingsPath = join(home, '.mindos', 'config.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
}

export async function searchMindRoot(
  mindRoot: string,
  query: string,
  options: MindosRuntimeSearchOptions = {},
): Promise<MindosRuntimeSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  if (limit <= 0) return [];
  return getRuntimeSearchIndex(mindRoot).search(q, { ...options, limit });
}

const RUNTIME_SEARCH_TEXT_EXTENSIONS = new Set(['.md', '.csv', '.json']);
const RUNTIME_SEARCH_MAX_CONTENT_LENGTH = 50_000;
const RUNTIME_CJK_CHAR_REGEX = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;
const runtimeSearchIndexes = new Map<string, RuntimeSearchIndex>();

function getRuntimeSearchIndex(mindRoot: string): RuntimeSearchIndex {
  const root = resolve(mindRoot);
  let index = runtimeSearchIndexes.get(root);
  if (!index) {
    index = new RuntimeSearchIndex(root);
    runtimeSearchIndexes.set(root, index);
  }
  return index;
}

function runtimeSearchSignature(stats: MindosRuntimeFileStat[]): string {
  return stats
    .map((entry) => `${entry.path}\0${entry.size}\0${entry.mtime}`)
    .sort()
    .join('\n');
}

function runtimeTokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z0-9_$@#]+/g);
  if (words) {
    for (const word of words) {
      if (word.length >= 2) tokens.add(word);
    }
  }
  let cjkRun = '';
  for (const ch of lower) {
    if (RUNTIME_CJK_CHAR_REGEX.test(ch)) {
      tokens.add(ch);
      cjkRun += ch;
      continue;
    }
    for (let i = 0; i + 1 < cjkRun.length; i += 1) tokens.add(cjkRun.slice(i, i + 2));
    cjkRun = '';
  }
  for (let i = 0; i + 1 < cjkRun.length; i += 1) tokens.add(cjkRun.slice(i, i + 2));
  return tokens;
}

function runtimeSearchTerms(query: string): string[] {
  const terms = new Set<string>();
  terms.add(query);
  for (const part of query.split(/\s+/)) {
    if (part) terms.add(part);
  }
  for (const token of runtimeTokenize(query)) terms.add(token);
  return [...terms];
}

function countSubstringOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function insertRuntimeSearchHit(
  results: MindosRuntimeSearchResult[],
  result: MindosRuntimeSearchResult,
  limit: number,
): void {
  if (results.length === limit) {
    const last = results[results.length - 1];
    if (last && (result.score < last.score || (result.score === last.score && result.path.localeCompare(last.path) >= 0))) {
      return;
    }
  }

  let insertAt = results.length;
  while (insertAt > 0) {
    const previous = results[insertAt - 1];
    if (!previous) break;
    if (previous.score > result.score) break;
    if (previous.score === result.score && previous.path.localeCompare(result.path) <= 0) break;
    insertAt -= 1;
  }
  results.splice(insertAt, 0, result);
  if (results.length > limit) results.length = limit;
}

class RuntimeSearchIndex {
  private signature = '';
  private docs = new Map<string, { content: string; lower: string; mtime: number }>();
  private inverted = new Map<string, Set<string>>();
  private files: string[] = [];

  constructor(private readonly mindRoot: string) {}

  search(query: string, options: MindosRuntimeSearchOptions & { limit: number }): MindosRuntimeSearchResult[] {
    this.ensureFresh();
    const terms = runtimeSearchTerms(query);
    const candidates = this.candidatesForQuery(query);
    const candidateFiles = candidates ?? this.files;
    const scope = options.scope ? (options.scope.endsWith('/') ? options.scope : `${options.scope}/`) : null;
    const fileType = options.file_type && options.file_type !== 'all' ? `.${options.file_type}` : null;
    const modifiedAfter = options.modified_after ? Date.parse(options.modified_after) : 0;
    const mtimeThreshold = Number.isFinite(modifiedAfter) ? modifiedAfter : 0;
    const results: MindosRuntimeSearchResult[] = [];

    for (const filePath of candidateFiles) {
      if (scope && filePath !== options.scope && !filePath.startsWith(scope)) continue;
      if (fileType && extname(filePath).toLowerCase() !== fileType) continue;
      const doc = this.docs.get(filePath);
      if (!doc) continue;
      if (mtimeThreshold > 0 && doc.mtime < mtimeThreshold) continue;

      let firstIndex = -1;
      let occurrences = 0;
      for (const term of terms) {
        const count = countSubstringOccurrences(doc.lower, term);
        if (count === 0) continue;
        occurrences += count;
        if (firstIndex === -1) firstIndex = doc.lower.indexOf(term);
      }
      if (occurrences === 0) continue;

      const start = Math.max(0, firstIndex - 80);
      const end = Math.min(doc.content.length, firstIndex + query.length + 160);
      const extensionBoost = extname(filePath).toLowerCase() === '.md' ? 0.1 : 0;
      insertRuntimeSearchHit(results, {
        path: filePath,
        snippet: doc.content.slice(start, end),
        score: occurrences + extensionBoost,
      }, options.limit);
    }

    return results;
  }

  private ensureFresh(): void {
    const stats = collectFileStatsFromMindRoot(this.mindRoot);
    const signature = runtimeSearchSignature(stats);
    if (signature === this.signature) return;

    this.signature = signature;
    this.docs.clear();
    this.inverted.clear();
    this.files = [];

    for (const stat of stats) {
      const ext = extname(stat.path).toLowerCase();
      if (!RUNTIME_SEARCH_TEXT_EXTENSIONS.has(ext)) continue;
      let content: string;
      try {
        content = readTextFileFromMindRoot(this.mindRoot, stat.path);
      } catch {
        continue;
      }
      if (content.length > RUNTIME_SEARCH_MAX_CONTENT_LENGTH) {
        content = content.slice(0, RUNTIME_SEARCH_MAX_CONTENT_LENGTH);
      }
      const lower = content.toLowerCase();
      this.docs.set(stat.path, { content, lower, mtime: stat.mtime });
      this.files.push(stat.path);

      for (const token of runtimeTokenize(`${stat.path}\n${content}`)) {
        let paths = this.inverted.get(token);
        if (!paths) {
          paths = new Set<string>();
          this.inverted.set(token, paths);
        }
        paths.add(stat.path);
      }
    }
    this.files.sort((a, b) => a.localeCompare(b));
  }

  private candidatesForQuery(query: string): string[] | null {
    const tokens = runtimeTokenize(query);
    if (tokens.size === 0) return null;
    const hits = new Set<string>();
    for (const token of tokens) {
      const paths = this.inverted.get(token);
      if (!paths) continue;
      for (const filePath of paths) hits.add(filePath);
    }
    return [...hits];
  }
}

function safeReadSettings(options: MindosRuntimeOptions): MindosRuntimeSettings {
  if (options.readSettings) {
    try {
      return options.readSettings();
    } catch {
      return {};
    }
  }
  try {
    const home = options.homeDir ?? homedir();
    const raw = readFileSync(join(home, '.mindos', 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as MindosRuntimeSettings;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    return {};
  }
  return {};
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

export {
  readMindosIgnoreFile,
  writeMindosIgnoreFile,
};

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
