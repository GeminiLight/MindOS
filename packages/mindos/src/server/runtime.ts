import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readMindosIgnoreFile, writeMindosIgnoreFile } from './search-ignore.js';
import { getMindosSearchIndex, type MindosSearchHit, type MindosSearchRefreshHints } from './search/index.js';

export {
  MINDOS_ALLOWED_FILE_EXTENSIONS,
  MINDOS_IGNORED_DIRS,
  collectAllFilesFromMindRoot,
  collectFileStatsFromMindRoot,
  getRecentlyModifiedFromMindRoot,
  getTreeVersionFromMindRoot,
  listDirectoriesFromMindRoot,
  listMindSpacesFromMindRoot,
  readLinesFromMindRoot,
  readTextFileFromMindRoot,
  type MindosRuntimeFileStat,
} from './mind-root-files.js';

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

export type MindosRuntimeSearchResult = MindosSearchHit;

export type MindosRuntimeSearchOptions = {
  limit?: number;
  scope?: string;
  file_type?: 'md' | 'csv' | 'all';
  modified_after?: string;
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
  // config.json holds the mind root, API keys and the auth token. A crash in
  // the middle of a plain writeFileSync leaves a truncated file, after which
  // getDefaultMindRoot silently falls back to ~/MindOS/mind. temp + rename
  // keeps the previous config intact until the new one is fully on disk.
  const temp = `${settingsPath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
    renameSync(temp, settingsPath);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
  settingsReadCache.delete(settingsPath);
}

export type MindosRuntimeSearchHints = MindosSearchRefreshHints;

/**
 * Search a mind root through the shared per-root index (`server/search`).
 * Callers that hold a tree cache pass its version as a hint so warm queries
 * skip the stat walk entirely.
 */
export async function searchMindRoot(
  mindRoot: string,
  query: string,
  options: MindosRuntimeSearchOptions = {},
  hints: MindosRuntimeSearchHints = {},
): Promise<MindosRuntimeSearchResult[]> {
  if (!query.trim()) return [];
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  return getMindosSearchIndex(mindRoot).search(query, { ...options, limit }, hints);
}

export function prewarmRuntimeSearch(
  mindRoot: string,
  hints: MindosRuntimeSearchHints = {},
): { cacheState: 'hit' | 'built'; documentCount: number } {
  const index = getMindosSearchIndex(mindRoot);
  const { cacheState } = index.refresh(hints);
  return { cacheState, documentCount: index.getFileCount() };
}

// Every request reads config.json at least twice (auth token + web password)
// and skill listing reads it again. Parse once per on-disk version; a stat is
// far cheaper than read + JSON.parse and still observes external edits.
const settingsReadCache = new Map<string, { key: string; value: MindosRuntimeSettings }>();

function safeReadSettings(options: MindosRuntimeOptions): MindosRuntimeSettings {
  if (options.readSettings) {
    try {
      return options.readSettings();
    } catch {
      return {};
    }
  }
  const home = options.homeDir ?? homedir();
  const settingsPath = join(home, '.mindos', 'config.json');
  let key: string;
  try {
    const stat = statSync(settingsPath);
    key = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  } catch {
    settingsReadCache.delete(settingsPath);
    return {};
  }
  // Callers historically received a fresh object per read and some mutate it
  // in place before writing; hand out a clone so the cache stays pristine.
  const cached = settingsReadCache.get(settingsPath);
  if (cached && cached.key === key) return structuredClone(cached.value);
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as MindosRuntimeSettings;
    const value = parsed && typeof parsed === 'object' ? parsed : {};
    settingsReadCache.set(settingsPath, { key, value });
    return structuredClone(value);
  } catch {
    settingsReadCache.delete(settingsPath);
    return {};
  }
}

export {
  readMindosIgnoreFile,
  writeMindosIgnoreFile,
};
