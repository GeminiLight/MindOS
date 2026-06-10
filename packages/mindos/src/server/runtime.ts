import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, type Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { resolveExistingSafe, resolveSafe } from '../foundation/security/index.js';

export const MINDOS_ALLOWED_FILE_EXTENSIONS = new Set([
  '.md', '.csv', '.json', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac',
  '.mp4', '.webm', '.mov', '.mkv',
]);

export const MINDOS_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'app',
  '.next',
  '.DS_Store',
  '.media',
  'mcp',
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
  agentRuntimeEnv?: import('../agent-runtime/runtime-env.js').AgentRuntimeEnvironmentSettings;
  disabledSkills?: string[];
  skillPaths?: {
    enableAgentsDir?: boolean;
    custom?: string[];
  };
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
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !MINDOS_IGNORED_DIRS.has(entry.name))
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

  if (settings.skillPaths?.enableAgentsDir !== false) {
    roots.push({
      path: join(home, '.agents', 'skills'),
      source: 'user',
      origin: 'agents-global',
      editable: true,
    });
  }

  const customSkillPaths = Array.isArray(settings.skillPaths?.custom) ? settings.skillPaths.custom : [];
  for (const custom of customSkillPaths) {
    if (typeof custom !== 'string') continue;
    const trimmed = expandMindosSkillPath(custom, home);
    if (!trimmed) continue;
    roots.push({
      path: trimmed,
      source: 'user',
      origin: 'custom',
      editable: true,
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
  options: { limit?: number } = {},
): Promise<MindosRuntimeSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const textExtensions = new Set(['.md', '.csv', '.json']);
  const results: MindosRuntimeSearchResult[] = [];

  for (const filePath of collectAllFilesFromMindRoot(mindRoot)) {
    if (!textExtensions.has(extname(filePath).toLowerCase())) continue;
    let content = '';
    try {
      content = readTextFileFromMindRoot(mindRoot, filePath);
    } catch {
      continue;
    }
    const lower = content.toLowerCase();
    const index = lower.indexOf(q);
    if (index < 0) continue;
    const start = Math.max(0, index - 80);
    const end = Math.min(content.length, index + q.length + 160);
    const occurrences = lower.split(q).length - 1;
    const extensionBoost = extname(filePath).toLowerCase() === '.md' ? 0.1 : 0;
    results.push({
      path: filePath,
      snippet: content.slice(start, end),
      score: occurrences + extensionBoost,
    });
  }

  return results
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
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
  const includeDirectories = options.includeDirectories === true;
  const includeFiles = options.includeFiles !== false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && MINDOS_IGNORED_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).split('\\').join('/');
    if (entry.isDirectory()) {
      if (includeDirectories) visit(abs, rel, entry);
      walkMindRoot(root, abs, visit, options);
      continue;
    }
    if (includeFiles && entry.isFile()) visit(abs, rel, entry);
  }
}

function collectFileStatsFromMindRoot(mindRoot: string): Array<{ path: string; mtime: number }> {
  const root = resolve(mindRoot);
  if (!existsSync(root)) return [];
  const files: Array<{ path: string; mtime: number }> = [];
  walkMindRoot(root, root, (abs, rel) => {
    if (!MINDOS_ALLOWED_FILE_EXTENSIONS.has(extname(abs).toLowerCase())) return;
    try {
      files.push({ path: rel, mtime: statSync(abs).mtimeMs });
    } catch {
      // Ignore files removed between directory traversal and stat.
    }
  });
  return files;
}
