import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { listServerNamesFromFile, readAgentConfigFile } from './config-read.js';
import { classifyMcpServerEntryTransport } from './entry.js';
import {
  assertSafeMcpServerName,
  readMcpServerEntryFromText,
  removeMcpServerEntryFromFile,
  writeMcpServerEntryToFile,
} from './formats.js';
import {
  agentConfigPathNeedsProjectRoot,
  configPathCandidates,
  entryLocation,
  expandHome,
  primaryConfigPath,
  writableConfigPath,
  resolveAgentConfigPath,
} from './paths.js';
import { detectAgentPresence } from './presence.js';
import { resolveAgentConfigProbes, type ResolvedAgentConfigProbes } from './probes.js';
import { customAgentToConfigDef, MINDOS_SELF_AGENT_KEY } from './registry.js';
import {
  listInstalledSkillNames,
  resolveAgentHiddenRoot,
  resolveSkillWorkspaceProfile,
  type ListInstalledSkillNamesOptions,
} from './skill-workspace.js';
import type {
  AgentConfigDef,
  AgentConfigProbes,
  AgentConfigScope,
  CustomAgentConfigDef,
  McpServerEntryLocation,
  SkillAgentRegistration,
  SkillWorkspaceProfile,
} from './types.js';

/** The agent has no config file for the requested scope. */
export class AgentConfigScopeError extends Error {
  readonly status = 400;

  constructor(agentName: string, scope: AgentConfigScope) {
    super(`${agentName} does not support ${scope} scope`);
    this.name = 'AgentConfigScopeError';
  }
}

export type AgentConfigReadableFile = {
  scope: AgentConfigScope;
  /** The registry spelling (`~/.claude.json`, `.mcp.json`), what results report back. */
  configPath: string;
  absPath: string;
  text: string;
};

export type AgentServerRead = {
  entry: Record<string, unknown>;
  scope: AgentConfigScope;
  configPath: string;
  absPath: string;
  transport: 'stdio' | 'http' | 'unknown';
  url?: string;
};

export type AgentServerList = {
  servers: string[];
  /** `<scope>:<configPath>` for every file that configured at least one server. */
  sources: string[];
};

export type AgentServerWriteOptions = {
  /** Replace an existing entry of the same name; default true. `false` leaves the file alone and reports `written: false`. */
  overwrite?: boolean;
};

export type AgentServerWriteResult = {
  configPath: string;
  absPath: string;
  /** Whether an entry of that name was already configured before the write. */
  existed: boolean;
  /** The file text before the write, or null when the file did not exist (what a rollback restores). */
  previousText: string | null;
  written: boolean;
  /** Non-fatal notices (JSONC files with recoverable syntax issues). */
  warnings: string[];
};

export type AgentServerRemoveResult = {
  /** Registry spellings of every file that was rewritten. */
  updatedPaths: string[];
  warnings: string[];
  /** `<configPath>: <error>` for files that exist but could not be edited. */
  errors: string[];
  /** False when no config file for the scope exists at all. */
  existedAnywhere: boolean;
};

export type AgentServerReadOptions = {
  scope?: AgentConfigScope;
  /** Propagate parse errors instead of skipping the unparsable file. */
  strict?: boolean;
};

/**
 * One agent's config surface: where its files are, how to read / write the
 * MCP servers map, whether the agent is present, and where its skills go.
 * Built-in and custom agents share this shape; the only difference is the
 * presence rule (custom agents count as present when any declared directory
 * exists, because the user pointed MindOS at it explicitly).
 */
export type AgentConfigAdapter = {
  key: string;
  def: AgentConfigDef;
  registration: SkillAgentRegistration | undefined;
  isCustom: boolean;
  /** The `mindos` row itself: never an install or skill-link target. */
  isSelf: boolean;
  hasScope(scope: AgentConfigScope): boolean;
  /** Config spellings for `scope`, primary first; writes reuse the first existing candidate. */
  configPaths(scope: AgentConfigScope): string[];
  /** True when `scope` has a relative config path and no project root is known. */
  needsProjectRoot(scope: AgentConfigScope): boolean;
  resolveConfigPath(configPath: string, scope: AgentConfigScope): string;
  location(scope: AgentConfigScope): McpServerEntryLocation;
  /** Every readable config file, global first; relative project paths are skipped without a project root. */
  readableConfigs(scopes?: AgentConfigScope[]): AgentConfigReadableFile[];
  detectPresence(): boolean;
  listServers(): AgentServerList;
  readServer(serverName: string, options?: AgentServerReadOptions): AgentServerRead | null;
  writeServer(serverName: string, entry: Record<string, unknown>, scope: AgentConfigScope, options?: AgentServerWriteOptions): AgentServerWriteResult;
  removeServer(serverName: string, scope: AgentConfigScope): AgentServerRemoveResult;
  hiddenRoot(): string;
  skillWorkspace(): SkillWorkspaceProfile;
  installedSkills(options?: ListInstalledSkillNamesOptions): string[];
};

export type CreateAgentConfigAdapterOptions = {
  isCustom?: boolean;
};

const ALL_SCOPES: AgentConfigScope[] = ['global', 'project'];

export function createAgentConfigAdapter(
  key: string,
  def: AgentConfigDef,
  registration: SkillAgentRegistration | undefined,
  probes: AgentConfigProbes = {},
  options: CreateAgentConfigAdapterOptions = {},
): AgentConfigAdapter {
  const resolved = resolveAgentConfigProbes(probes);
  const isCustom = options.isCustom === true;
  const pathServices = { homeDir: resolved.homeDir, projectRoot: resolved.projectRoot };

  function* candidateFiles(scopes: AgentConfigScope[]): Generator<{ scope: AgentConfigScope; configPath: string; absPath: string }> {
    for (const scope of scopes) {
      for (const configPath of configPathCandidates(def, scope)) {
        if (agentConfigPathNeedsProjectRoot(configPath, scope, resolved.homeDir) && !resolved.projectRoot) continue;
        let absPath: string;
        try {
          absPath = resolveAgentConfigPath(configPath, scope, pathServices);
        } catch {
          continue;
        }
        yield { scope, configPath, absPath };
      }
    }
  }

  const adapter: AgentConfigAdapter = {
    key,
    def,
    registration,
    isCustom,
    isSelf: key === MINDOS_SELF_AGENT_KEY,

    hasScope: (scope) => primaryConfigPath(def, scope) !== null,
    configPaths: (scope) => configPathCandidates(def, scope),
    needsProjectRoot: (scope) => !resolved.projectRoot
      && configPathCandidates(def, scope).some((configPath) => agentConfigPathNeedsProjectRoot(configPath, scope, resolved.homeDir)),
    resolveConfigPath: (configPath, scope) => resolveAgentConfigPath(configPath, scope, pathServices),
    location: (scope) => entryLocation(def, scope),

    readableConfigs(scopes = ALL_SCOPES) {
      const files: AgentConfigReadableFile[] = [];
      for (const candidate of candidateFiles(scopes)) {
        let text: string | null;
        try {
          text = readAgentConfigFile(candidate.absPath, resolved);
        } catch {
          continue;
        }
        if (text === null) continue;
        files.push({ ...candidate, text });
      }
      return files;
    },

    detectPresence() {
      if (isCustom) return detectCustomAgentPresence(def, resolved);
      return detectAgentPresence(key, def, resolved);
    },

    listServers() {
      const servers = new Set<string>();
      const sources: string[] = [];
      for (const candidate of candidateFiles(ALL_SCOPES)) {
        let names: string[];
        try {
          names = listServerNamesFromFile(candidate.absPath, entryLocation(def, candidate.scope), resolved);
        } catch {
          continue;
        }
        for (const name of names) servers.add(name);
        if (names.length > 0) sources.push(`${candidate.scope}:${candidate.configPath}`);
      }
      return { servers: [...servers].sort((a, b) => a.localeCompare(b)), sources };
    },

    readServer(serverName, options = {}) {
      assertSafeMcpServerName(serverName);
      for (const file of adapter.readableConfigs(options.scope ? [options.scope] : ['project', 'global'])) {
        let entry: Record<string, unknown> | null;
        try {
          entry = readMcpServerEntryFromText(file.text, entryLocation(def, file.scope), serverName);
        } catch (error) {
          if (options.strict) throw error;
          continue;
        }
        if (!entry) continue;
        return {
          entry,
          scope: file.scope,
          configPath: file.configPath,
          absPath: file.absPath,
          transport: classifyMcpServerEntryTransport(entry),
          ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
        };
      }
      return null;
    },

    writeServer(serverName, entry, scope, options = {}) {
      assertSafeMcpServerName(serverName);
      // Edit the existing scope file (including JSONC alternatives), so a new
      // preferred filename cannot accidentally shadow a user's active config.
      const configPath = writableConfigPath(def, scope, candidate => existsSync(resolveAgentConfigPath(candidate, scope, pathServices)));
      if (!configPath) throw new AgentConfigScopeError(def.name, scope);
      const absPath = resolveAgentConfigPath(configPath, scope, pathServices);
      const location = entryLocation(def, scope);
      // Writes always go to the real filesystem; the memo (if any) notices the new mtime.
      mkdirSync(dirname(absPath), { recursive: true });
      const previousText = existsSync(absPath) ? readFileSync(absPath, 'utf-8') : null;
      let existingEntry: Record<string, unknown> | null = null;
      if (previousText?.trim()) {
        try {
          existingEntry = readMcpServerEntryFromText(previousText, location, serverName);
        } catch {
          // Unparsable so far; the writer decides whether it is recoverable (warning) or fatal (throws).
        }
      }
      if (existingEntry && options.overwrite === false) {
        return { configPath, absPath, existed: true, previousText, written: false, warnings: [] };
      }
      const warnings = writeMcpServerEntryToFile(absPath, previousText ?? '', location, serverName, entry);
      return { configPath, absPath, existed: existingEntry !== null, previousText, written: true, warnings };
    },

    removeServer(serverName, scope) {
      assertSafeMcpServerName(serverName);
      const configPaths = configPathCandidates(def, scope);
      if (configPaths.length === 0) throw new AgentConfigScopeError(def.name, scope);
      const location = entryLocation(def, scope);
      const result: AgentServerRemoveResult = { updatedPaths: [], warnings: [], errors: [], existedAnywhere: false };
      for (const configPath of configPaths) {
        const absPath = resolveAgentConfigPath(configPath, scope, pathServices);
        if (!existsSync(absPath)) continue;
        result.existedAnywhere = true;
        try {
          const existing = readFileSync(absPath, 'utf-8');
          result.warnings.push(...removeMcpServerEntryFromFile(absPath, existing, location, serverName));
          result.updatedPaths.push(configPath);
        } catch (error) {
          result.errors.push(`${configPath}: ${String(error)}`);
        }
      }
      return result;
    },

    hiddenRoot: () => resolveAgentHiddenRoot(def, resolved),
    skillWorkspace: () => resolveSkillWorkspaceProfile(key, def, registration, resolved),
    installedSkills: (options) => listInstalledSkillNames(adapter.skillWorkspace().workspacePath, resolved, options),
  };
  return adapter;
}

/** Custom agents are present when any declared directory exists (the user registered that directory on purpose) or their CLI resolves. */
function detectCustomAgentPresence(def: AgentConfigDef, probes: ResolvedAgentConfigProbes): boolean {
  if (def.presenceDirs?.some((dir) => probes.pathExists(expandHome(dir, probes.homeDir)))) return true;
  return !!def.presenceCli && probes.commandExists(def.presenceCli);
}

export type AgentConfigAdapterRegistry = {
  get(key: string): AgentConfigAdapter | undefined;
  has(key: string): boolean;
  /** Every adapter in registry order. */
  list(): AgentConfigAdapter[];
  /** Adapters MindOS can be installed into (everything but the self row). */
  downstream(): AgentConfigAdapter[];
  keys(): string[];
};

export type CreateAgentConfigAdaptersInput = {
  /** Merged registry (built-ins plus custom agents already converted), keyed by agent key. */
  agents: Record<string, AgentConfigDef>;
  skillAgentRegistry?: Record<string, SkillAgentRegistration>;
  /** Custom agents present in `agents`; they get the custom presence rule and an `additional` skill mode. */
  customAgents?: CustomAgentConfigDef[];
  /** Built-in keys win over a custom agent that reuses one of them. */
  builtInAgents?: Record<string, AgentConfigDef>;
  probes?: AgentConfigProbes;
};

export function createAgentConfigAdapters(input: CreateAgentConfigAdaptersInput): AgentConfigAdapterRegistry {
  const customByKey = new Map((input.customAgents ?? []).map((custom) => [custom.key, custom]));
  const builtIn = input.builtInAgents ?? {};
  const adapters = new Map<string, AgentConfigAdapter>();

  for (const [key, def] of Object.entries(input.agents)) {
    const custom = customByKey.get(key);
    const isCustom = !!custom && !(key in builtIn);
    const registration = isCustom
      ? { mode: 'additional' as const, skillAgentName: key }
      : readRegistration(input.skillAgentRegistry, key);
    adapters.set(key, createAgentConfigAdapter(key, def, registration, input.probes, { isCustom }));
  }

  return {
    get: (key) => adapters.get(key),
    has: (key) => adapters.has(key),
    list: () => [...adapters.values()],
    downstream: () => [...adapters.values()].filter((adapter) => !adapter.isSelf),
    keys: () => [...adapters.keys()],
  };
}

/** Own-property lookup so a `__proto__` agent key can never read `Object.prototype`. */
function readRegistration(
  registry: Record<string, SkillAgentRegistration> | undefined,
  key: string,
): SkillAgentRegistration | undefined {
  if (!registry || !Object.prototype.hasOwnProperty.call(registry, key)) return undefined;
  return registry[key];
}

/** Merge built-in and custom definitions into one registry; built-ins win on key collision. */
export function mergeAgentConfigDefs(
  builtIn: Record<string, AgentConfigDef>,
  customAgents: CustomAgentConfigDef[] = [],
): Record<string, AgentConfigDef> {
  const merged: Record<string, AgentConfigDef> = { ...builtIn };
  for (const custom of customAgents) {
    if (custom.key in merged) continue;
    merged[custom.key] = customAgentToConfigDef(custom);
  }
  return merged;
}
