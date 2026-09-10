import { homedir } from 'os';
import { join, resolve } from 'path';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import {
  createAgentConfigAdapter,
  createAgentConfigAdapters,
  expandHome,
  listMcpServerNamesFromText,
  type AgentConfigAdapter,
  type AgentConfigDef,
  type AgentConfigProbes,
  type AgentServerRead,
  type CustomAgentConfigDef,
  type SkillAgentRegistration,
  type SkillInstallMode,
  type SkillWorkspaceProfile,
} from '../../agent/config/index.js';
import type { AgentConfigPathServices } from './mcp-install.js';
import type { MindosSkillLinkAgent } from './skill-links.js';

export type MindosMcpAgentRegistryDef = AgentConfigDef;

export type MindosCustomMcpAgentDef = CustomAgentConfigDef;

export type MindosMcpAgentInstallStatus = {
  installed: boolean;
  scope?: string;
  transport?: string;
  configPath?: string;
  url?: string;
};

export type MindosMcpAgentSkillProfile = SkillWorkspaceProfile;

export type MindosMcpAgentRuntimeSignals = {
  hiddenRootPath: string;
  hiddenRootPresent: boolean;
  conversationSignal: boolean;
  usageSignal: boolean;
  lastActivityAt?: string;
};

export type MindosMcpAgentConfiguredServers = {
  servers: string[];
  sources: string[];
};

export type MindosMcpAgentInstalledSkills = {
  skills: string[];
  sourcePath: string;
};

export type MindosMcpAgentSkillCapabilities = {
  mode: SkillInstallMode;
  workspacePath: string;
  visibility: 'global' | 'agent' | 'manual';
  nativeSkillScope: 'none' | 'global' | 'native-private';
  canLinkMindosSkills: boolean;
  canReceiveLinkedSkills: boolean;
  canExportNativeSkills: boolean;
  linkStrategy: 'symlink' | 'copy' | 'manual' | 'unsupported';
};

export type MindosMcpMindosSkills = {
  names: string[];
  sourcePath: string;
  workspacePath: string;
};

export type MindosMcpAgentProfile = {
  key: string;
  name: string;
  present: boolean;
  installed: boolean;
  scope?: string;
  transport?: string;
  configPath?: string;
  url?: string;
  hasProjectScope: boolean;
  hasGlobalScope: boolean;
  preferredTransport: 'stdio' | 'http';
  format: 'json' | 'toml' | 'yaml';
  configKey: string;
  globalNestedKey?: string;
  entryStyle?: 'standard' | 'kilo';
  globalPath: string;
  projectPath?: string | null;
  skillMode: SkillInstallMode;
  skillAgentName?: string;
  skillWorkspacePath: string;
  hiddenRootPath: string;
  hiddenRootPresent: boolean;
  runtimeConversationSignal: boolean;
  runtimeUsageSignal: boolean;
  runtimeLastActivityAt?: string;
  configuredMcpServers: string[];
  configuredMcpServerCount: number;
  configuredMcpSources: string[];
  installedSkillNames: string[];
  installedSkillCount: number;
  installedSkillSourcePath: string;
  skillCapabilities: MindosMcpAgentSkillCapabilities;
  isCustom: boolean;
  customBaseDir?: string;
};

export type MindosMcpAgentsServices = {
  agents: Record<string, MindosMcpAgentRegistryDef>;
  builtInAgents?: Record<string, MindosMcpAgentRegistryDef>;
  customAgents?: MindosCustomMcpAgentDef[];
  readSettings?(): unknown;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  mindRoot?: string;
  projectRoot?: string;
  now?(): Date;
  pathExists?(path: string): boolean;
  readTextFile?(path: string): string;
  listSkillNames?(path: string): string[];
  commandExists?(command: string): boolean;
  detectInstalled?(agentKey: string): MindosMcpAgentInstallStatus;
  detectAgentPresence?(agentKey: string): boolean;
  detectAgentRuntimeSignals?(agentKey: string): MindosMcpAgentRuntimeSignals;
  detectAgentConfiguredMcpServers?(agentKey: string): MindosMcpAgentConfiguredServers;
  detectAgentInstalledSkills?(agentKey: string): MindosMcpAgentInstalledSkills;
  resolveSkillWorkspaceProfile?(agentKey: string): MindosMcpAgentSkillProfile;
  scanCustomAgentSkills?(custom: MindosCustomMcpAgentDef): MindosMcpAgentInstalledSkills;
  /** MindOS's own skill listing; may resolve asynchronously when the host loads its skill toolkit lazily. */
  loadMindosSkills?(): MindosMcpMindosSkills | Promise<MindosMcpMindosSkills>;
  skillAgentRegistry?: Record<string, SkillAgentRegistration>;
  fetchHead?(url: string, options: { signal: AbortSignal }): Promise<{ status: number }>;
};

export type MindosMcpAgentsPayload = {
  agents: MindosMcpAgentProfile[];
};

export type MindosAgentConfigDetectionServices = AgentConfigPathServices & {
  pathExists?(path: string): boolean;
  readTextFile?(path: string): string;
};

/** Filesystem probes for the adapter layer taken from the host services (so hosts and tests stay in control of I/O). */
function probesFrom(
  services: Pick<MindosMcpAgentsServices, 'homeDir' | 'projectRoot' | 'pathExists' | 'readTextFile' | 'commandExists'>,
): AgentConfigProbes {
  return {
    homeDir: services.homeDir,
    projectRoot: services.projectRoot,
    pathExists: services.pathExists,
    readTextFile: services.readTextFile,
    commandExists: services.commandExists,
  };
}

function adaptersFrom(services: MindosMcpAgentsServices) {
  return createAgentConfigAdapters({
    agents: services.agents,
    skillAgentRegistry: services.skillAgentRegistry,
    customAgents: services.customAgents,
    builtInAgents: services.builtInAgents,
    probes: probesFrom(services),
  });
}

/** Install status as the profile reports it; built-ins report the registry spelling of the config path, custom agents the absolute file. */
function installStatusFrom(read: AgentServerRead | null, options: { absolute?: boolean } = {}): MindosMcpAgentInstallStatus {
  if (!read) return { installed: false };
  return {
    installed: true,
    scope: read.scope,
    transport: read.transport,
    configPath: options.absolute ? read.absPath : read.configPath,
    ...(read.url ? { url: read.url } : {}),
  };
}

export async function handleMcpAgentsGet(
  services: MindosMcpAgentsServices,
): Promise<MindosServerResponse<MindosMcpAgentsPayload | { error: string }>> {
  try {
    const env = services.env ?? process.env;
    const customByKey = new Map((services.customAgents ?? []).map((custom) => [custom.key, custom]));
    const registry = adaptersFrom(services);

    const agents = registry.list().map((adapter) => {
      const { key, def: agent, isCustom } = adapter;
      const customDef = isCustom ? customByKey.get(key) : undefined;
      const present = isCustom
        ? adapter.detectPresence()
        : (services.detectAgentPresence?.(key) ?? adapter.detectPresence());
      const status = isCustom
        ? installStatusFrom(readServerSafe(adapter, 'mindos', 'global'), { absolute: true })
        : (services.detectInstalled?.(key) ?? installStatusFrom(readServerSafe(adapter, 'mindos')));
      const skillProfile = isCustom
        ? adapter.skillWorkspace()
        : (services.resolveSkillWorkspaceProfile?.(key) ?? adapter.skillWorkspace());
      const runtime = isCustom
        ? defaultCustomRuntimeSignals()
        : (services.detectAgentRuntimeSignals?.(key) ?? defaultRuntimeSignals(adapter, services));
      const configuredMcp = isCustom && customDef
        ? detectCustomAgentConfiguredMcp(customDef, services)
        : (services.detectAgentConfiguredMcpServers?.(key) ?? adapter.listServers());
      const installedSkills = isCustom && customDef
        ? (services.scanCustomAgentSkills?.(customDef) ?? scanAdapterSkills(adapter, services))
        : (services.detectAgentInstalledSkills?.(key) ?? scanAdapterSkills(adapter, services));

      return {
        key,
        name: agent.name,
        present,
        installed: status.installed,
        scope: status.scope,
        transport: status.transport,
        configPath: status.configPath,
        url: status.url,
        hasProjectScope: !!agent.project,
        hasGlobalScope: !!agent.global,
        preferredTransport: agent.preferredTransport,
        format: agent.format ?? 'json',
        configKey: agent.key,
        globalNestedKey: agent.globalNestedKey,
        entryStyle: agent.entryStyle,
        globalPath: agent.global,
        projectPath: agent.project,
        skillMode: skillProfile.mode,
        skillAgentName: skillProfile.skillAgentName,
        skillWorkspacePath: skillProfile.workspacePath,
        hiddenRootPath: runtime.hiddenRootPath,
        hiddenRootPresent: runtime.hiddenRootPresent,
        runtimeConversationSignal: runtime.conversationSignal,
        runtimeUsageSignal: runtime.usageSignal,
        runtimeLastActivityAt: runtime.lastActivityAt,
        configuredMcpServers: configuredMcp.servers,
        configuredMcpServerCount: configuredMcp.servers.length,
        configuredMcpSources: configuredMcp.sources,
        installedSkillNames: installedSkills.skills,
        installedSkillCount: installedSkills.skills.length,
        installedSkillSourcePath: installedSkills.sourcePath,
        skillCapabilities: buildSkillCapabilities(key, skillProfile, installedSkills.skills.length),
        isCustom,
        customBaseDir: isCustom ? customDef?.baseDir : undefined,
      } satisfies MindosMcpAgentProfile;
    });

    const mindos = agents.find((agent) => agent.key === 'mindos');
    if (mindos) await enrichMindosAgent(mindos, services, env);

    await verifyHttpAgentInstallations(agents, services);
    agents.sort(compareMcpAgents);

    return json({ agents });
  } catch (error) {
    return errorResponse(error);
  }
}

/** `readServer` for detection: an unparsable config counts as "not installed", never as a failed request. */
function readServerSafe(adapter: AgentConfigAdapter, serverName: string, scope?: 'global' | 'project'): AgentServerRead | null {
  try {
    return adapter.readServer(serverName, scope ? { scope } : {});
  } catch {
    return null;
  }
}

function scanAdapterSkills(adapter: AgentConfigAdapter, services: Pick<MindosMcpAgentsServices, 'listSkillNames'>): MindosMcpAgentInstalledSkills {
  const sourcePath = adapter.skillWorkspace().workspacePath;
  return { skills: services.listSkillNames?.(sourcePath) ?? adapter.installedSkills(), sourcePath };
}

/**
 * Resolve the downstream agents eligible for the skill matrix: present on
 * this machine, skill-capable (universal/additional — unsupported agents are
 * excluded), with their absolute skill directory. MindOS itself is excluded;
 * the matrix prepends it as the self column.
 */
export function resolveSkillLinkAgents(
  services: Pick<
    MindosMcpAgentsServices,
    'agents' | 'skillAgentRegistry' | 'homeDir' | 'pathExists' | 'readTextFile' | 'commandExists' | 'detectAgentPresence' | 'resolveSkillWorkspaceProfile'
  >,
): MindosSkillLinkAgent[] {
  const registry = createAgentConfigAdapters({
    agents: services.agents,
    skillAgentRegistry: services.skillAgentRegistry,
    probes: probesFrom(services),
  });
  const pathExists = services.pathExists ?? ((path: string) => adapterPathExists(path));
  const linkAgents: MindosSkillLinkAgent[] = [];
  for (const adapter of registry.downstream()) {
    const mode = adapter.registration?.mode ?? 'unsupported';
    if (mode === 'unsupported') continue;
    const present = services.detectAgentPresence?.(adapter.key) ?? adapter.detectPresence();
    if (!present) continue;
    const profile = services.resolveSkillWorkspaceProfile?.(adapter.key) ?? adapter.skillWorkspace();
    if (!profile.workspacePath.trim()) continue;
    // Universal agents share the pool as workspace, but may also ship skills
    // in their own home (e.g. Codex's ~/.codex/skills) — track that dir so the
    // matrix sees natively-owned skills and never shadows them with pool links.
    let nativeSkillDir: string | undefined;
    if (mode === 'universal') {
      const ownDir = join(adapter.hiddenRoot(), 'skills');
      // Only meaningful when the directory actually exists — a phantom path
      // would just add noise to every cell computation.
      if (resolve(ownDir) !== resolve(profile.workspacePath) && pathExists(ownDir)) nativeSkillDir = ownDir;
    }
    linkAgents.push({ key: adapter.key, name: adapter.def.name, mode, skillDir: profile.workspacePath, nativeSkillDir });
  }
  return linkAgents;
}

function adapterPathExists(path: string): boolean {
  // Lazy import keeps `fs` out of the module graph for hosts that inject their own probes.
  return existsSyncRef(path);
}

import { existsSync as existsSyncRef } from 'fs';

/** MCP servers configured in a custom agent's global config; the absolute file is the source, prefixed `local:`. */
export function detectCustomAgentConfiguredMcp(
  customDef: MindosCustomMcpAgentDef,
  services: Pick<MindosMcpAgentsServices, 'homeDir' | 'pathExists' | 'readTextFile'> = {},
): MindosMcpAgentConfiguredServers {
  const globalPath = expandHome(customDef.global, services.homeDir);
  const pathExists = services.pathExists ?? existsSyncRef;
  if (!pathExists(globalPath)) return { servers: [], sources: [] };

  try {
    const readTextFile = services.readTextFile ?? ((path: string) => readFileSyncUtf8(path));
    const adapter = createAgentConfigAdapter(customDef.key, {
      name: customDef.name,
      project: null,
      global: customDef.global,
      key: customDef.configKey,
      preferredTransport: customDef.preferredTransport,
      format: customDef.format,
      globalNestedKey: customDef.globalNestedKey,
    }, undefined, { homeDir: services.homeDir }, { isCustom: true });
    const servers = listMcpServerNamesFromText(readTextFile(globalPath), adapter.location('global'));
    return {
      servers,
      sources: servers.length > 0 ? [`local:${globalPath}`] : [],
    };
  } catch {
    return { servers: [], sources: [] };
  }
}

/** Whether the MindOS entry of `agent` is configured, and where; the product default behind `services.detectInstalled`. */
export function detectAgentInstalledFromConfigs(
  agent: MindosMcpAgentRegistryDef,
  services: MindosAgentConfigDetectionServices,
): MindosMcpAgentInstallStatus {
  const adapter = createAgentConfigAdapter('', agent, undefined, services);
  return installStatusFrom(readServerSafe(adapter, 'mindos'));
}

/** Every MCP server configured for `agent` across its readable configs; the product default behind `services.detectAgentConfiguredMcpServers`. */
export function detectAgentConfiguredMcpServersFromConfigs(
  agent: MindosMcpAgentRegistryDef,
  services: MindosAgentConfigDetectionServices,
): MindosMcpAgentConfiguredServers {
  return createAgentConfigAdapter('', agent, undefined, services).listServers();
}

async function enrichMindosAgent(
  agent: MindosMcpAgentProfile,
  services: MindosMcpAgentsServices,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  agent.present = true;
  agent.installed = true;
  agent.scope = 'builtin';

  try {
    const port = Number(env.MINDOS_MCP_PORT) || readSettingsNumber(services.readSettings?.(), 'mcpPort') || 8781;
    agent.transport = `http :${port}`;
  } catch {
    agent.transport = 'http :8781';
  }

  try {
    const skills = await services.loadMindosSkills?.();
    if (skills) {
      agent.installedSkillNames = skills.names;
      agent.installedSkillCount = skills.names.length;
      agent.installedSkillSourcePath = skills.sourcePath;
      agent.skillMode = 'universal';
      agent.skillWorkspacePath = skills.workspacePath;
      agent.skillCapabilities = buildSkillCapabilities('mindos', {
        mode: 'universal',
        workspacePath: skills.workspacePath,
      }, skills.names.length);
    }
  } catch {
    // Skill discovery should never make agent discovery fail.
  }

  const home = services.homeDir ?? homedir();
  const mindRoot = services.mindRoot ?? join(home, '.mindos');
  const mcpConfigPath = join(home, '.mindos', 'mcp.json');
  try {
    const pathExists = services.pathExists ?? existsSyncRef;
    if (pathExists(mcpConfigPath)) {
      const readTextFile = services.readTextFile ?? readFileSyncUtf8;
      const raw = JSON.parse(readTextFile(mcpConfigPath));
      const servers = Object.keys(raw.mcpServers ?? {});
      agent.configuredMcpServers = servers;
      agent.configuredMcpServerCount = servers.length;
      agent.configuredMcpSources = servers.length > 0 ? [`local:${mcpConfigPath}`] : [];
    }
  } catch {
    // Ignore invalid local MCP config while preserving the built-in MindOS row.
  }

  agent.runtimeConversationSignal = true;
  agent.runtimeLastActivityAt = (services.now ?? (() => new Date()))().toISOString();
  agent.hiddenRootPath = mindRoot;
  agent.hiddenRootPresent = true;
}

function buildSkillCapabilities(
  agentKey: string,
  skillProfile: MindosMcpAgentSkillProfile,
  installedSkillCount: number,
): MindosMcpAgentSkillCapabilities {
  const hasWorkspace = skillProfile.workspacePath.trim().length > 0;
  const isMindos = agentKey === 'mindos';
  const visibility = isMindos || skillProfile.mode === 'universal'
    ? 'global'
    : skillProfile.mode === 'unsupported'
      ? 'manual'
      : 'agent';
  const nativeSkillScope = installedSkillCount === 0
    ? 'none'
    : visibility === 'global'
      ? 'global'
      : 'native-private';
  const linkStrategy = !hasWorkspace
    ? 'unsupported'
    : skillProfile.mode === 'unsupported'
      ? 'copy'
      : 'symlink';

  return {
    mode: skillProfile.mode,
    workspacePath: skillProfile.workspacePath,
    visibility,
    nativeSkillScope,
    canLinkMindosSkills: hasWorkspace,
    canReceiveLinkedSkills: hasWorkspace,
    canExportNativeSkills: installedSkillCount > 0,
    linkStrategy,
  };
}

async function verifyHttpAgentInstallations(
  agents: MindosMcpAgentProfile[],
  services: MindosMcpAgentsServices,
): Promise<void> {
  const fetchHead = services.fetchHead ?? defaultFetchHead;
  await Promise.all(agents.map(async (agent) => {
    if (!agent.installed || !agent.url || !agent.transport?.startsWith('http')) return;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      try {
        const response = await fetchHead(agent.url, { signal: controller.signal });
        if (response.status >= 300 && response.status !== 405) {
          agent.installed = false;
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      agent.installed = false;
    }
  }));
}

function compareMcpAgents(a: MindosMcpAgentProfile, b: MindosMcpAgentProfile): number {
  if (a.key === 'mindos') return -1;
  if (b.key === 'mindos') return 1;
  return rankMcpAgent(a) - rankMcpAgent(b);
}

function rankMcpAgent(agent: MindosMcpAgentProfile): number {
  if (agent.present && agent.installed) return 0;
  if (agent.present) return 1;
  if (agent.installed) return 2;
  return 3;
}

function defaultRuntimeSignals(
  adapter: AgentConfigAdapter,
  services: Pick<MindosMcpAgentsServices, 'pathExists'>,
): MindosMcpAgentRuntimeSignals {
  const hiddenRootPath = adapter.hiddenRoot();
  return {
    hiddenRootPath,
    hiddenRootPresent: (services.pathExists ?? existsSyncRef)(hiddenRootPath),
    conversationSignal: false,
    usageSignal: false,
  };
}

function defaultCustomRuntimeSignals(): MindosMcpAgentRuntimeSignals {
  return {
    hiddenRootPath: '',
    hiddenRootPresent: false,
    conversationSignal: false,
    usageSignal: false,
  };
}

function readSettingsNumber(settings: unknown, key: string): number | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const value = (settings as Record<string, unknown>)[key];
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

import { readFileSync as readFileSyncRef } from 'fs';

function readFileSyncUtf8(path: string): string {
  return readFileSyncRef(path, 'utf-8');
}

async function defaultFetchHead(url: string, options: { signal: AbortSignal }): Promise<{ status: number }> {
  if (typeof fetch !== 'function') return { status: 200 };
  const response = await fetch(url, { method: 'HEAD', signal: options.signal });
  return { status: response.status };
}
