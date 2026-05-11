import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, isAbsolute, join, resolve } from 'path';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import type { MindosMcpAgentDef } from './mcp-install.js';

export type MindosMcpAgentRegistryDef = MindosMcpAgentDef & {
  presenceCli?: string;
  presenceDirs?: string[];
};

export type MindosCustomMcpAgentDef = {
  name: string;
  key: string;
  baseDir: string;
  global: string;
  project?: string | null;
  configKey: string;
  format: 'json' | 'toml';
  preferredTransport: 'stdio' | 'http';
  presenceDirs: string[];
  presenceCli?: string;
  globalNestedKey?: string;
  skillDir?: string;
};

export type MindosMcpAgentInstallStatus = {
  installed: boolean;
  scope?: string;
  transport?: string;
  configPath?: string;
  url?: string;
};

export type MindosMcpAgentSkillProfile = {
  mode: 'universal' | 'additional' | 'unsupported';
  skillAgentName?: string;
  workspacePath: string;
};

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
  globalPath: string;
  projectPath?: string | null;
  skillMode: 'universal' | 'additional' | 'unsupported';
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
  loadMindosSkills?(): MindosMcpMindosSkills;
  fetchHead?(url: string, options: { signal: AbortSignal }): Promise<{ status: number }>;
};

export type MindosMcpAgentsPayload = {
  agents: MindosMcpAgentProfile[];
};

export async function handleMcpAgentsGet(
  services: MindosMcpAgentsServices,
): Promise<MindosServerResponse<MindosMcpAgentsPayload | { error: string }>> {
  try {
    const env = services.env ?? process.env;
    const customDefs = services.customAgents ?? [];
    const customByKey = Object.fromEntries(customDefs.map((custom) => [custom.key, custom]));
    const customKeySet = new Set(customDefs.map((custom) => custom.key));
    const builtInAgents = services.builtInAgents ?? {};

    const agents = Object.entries(services.agents).map(([key, agent]) => {
      const isCustom = customKeySet.has(key) && !(key in builtInAgents);
      const customDef = customByKey[key];
      const present = isCustom
        ? detectCustomAgentPresence(agent, services)
        : (services.detectAgentPresence?.(key) ?? defaultDetectAgentPresence(agent, services));
      const status = isCustom
        ? detectCustomAgentInstalled(agent, services)
        : (services.detectInstalled?.(key) ?? defaultDetectAgentInstalled(agent, services));
      const skillProfile = isCustom && customDef
        ? resolveCustomSkillWorkspaceProfile(customDef, agent, services)
        : (services.resolveSkillWorkspaceProfile?.(key) ?? defaultSkillWorkspaceProfile(key, agent, services));
      const runtime = isCustom
        ? defaultCustomRuntimeSignals()
        : (services.detectAgentRuntimeSignals?.(key) ?? defaultRuntimeSignals(agent, services));
      const configuredMcp = isCustom && customDef
        ? detectCustomAgentConfiguredMcp(customDef, services)
        : (services.detectAgentConfiguredMcpServers?.(key) ?? defaultDetectAgentConfiguredMcp(agent, services));
      const installedSkills = isCustom && customDef
        ? (services.scanCustomAgentSkills?.(customDef) ?? defaultScanCustomAgentSkills(customDef, services))
        : (services.detectAgentInstalledSkills?.(key) ?? { skills: [], sourcePath: skillProfile.workspacePath });

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
        isCustom,
        customBaseDir: isCustom ? customDef?.baseDir : undefined,
      } satisfies MindosMcpAgentProfile;
    });

    const mindos = agents.find((agent) => agent.key === 'mindos');
    if (mindos) enrichMindosAgent(mindos, services, env);

    await verifyHttpAgentInstallations(agents, services);
    agents.sort(compareMcpAgents);

    return json({ agents });
  } catch (error) {
    return errorResponse(error);
  }
}

export function detectCustomAgentConfiguredMcp(
  customDef: MindosCustomMcpAgentDef,
  services: Pick<MindosMcpAgentsServices, 'homeDir' | 'pathExists' | 'readTextFile'> = {},
): MindosMcpAgentConfiguredServers {
  const globalPath = expandHome(customDef.global, services.homeDir);
  const pathExists = services.pathExists ?? existsSync;
  if (!pathExists(globalPath)) return { servers: [], sources: [] };

  try {
    const readTextFile = services.readTextFile ?? readFileSyncUtf8;
    const content = readTextFile(globalPath);
    const servers = customDef.format === 'toml'
      ? parseTomlForServers(content, customDef.configKey)
      : parseJsonForServers(content, customDef.configKey);
    return {
      servers,
      sources: servers.length > 0 ? [`local:${globalPath}`] : [],
    };
  } catch {
    return { servers: [], sources: [] };
  }
}

export function parseJsonForServers(content: string, key: string): string[] {
  try {
    const config = parseJsonc(content);
    const servers = readOwnRecord(config, key);
    if (servers) {
      return Object.keys(servers).sort();
    }
  } catch {
    return [];
  }
  return [];
}

export function parseTomlForServers(content: string, sectionKey: string): string[] {
  const names = new Set<string>();
  const sectionPrefix = `${sectionKey}.`;
  let inRootSection = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const section = trimmed.slice(1, -1).trim();
      inRootSection = section === sectionKey;
      if (section.startsWith(sectionPrefix)) {
        const name = section.slice(sectionPrefix.length).split('.')[0];
        if (name) names.add(name);
      }
      continue;
    }
    if (inRootSection) {
      const key = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=/)?.[1];
      if (key) names.add(key);
    }
  }
  return [...names].sort();
}

export function parseYamlForServers(content: string, sectionKey: string): string[] {
  const names = new Set<string>();
  let inSection = false;
  let baseIndent = -1;
  for (const line of content.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (indent === 0 && trimmed === `${sectionKey}:`) {
      inSection = true;
      baseIndent = -1;
      continue;
    }
    if (indent === 0 && trimmed) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    if (baseIndent < 0) baseIndent = indent;
    if (indent !== baseIndent) continue;
    const name = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:/)?.[1];
    if (name) names.add(name);
  }
  return [...names].sort();
}

function enrichMindosAgent(
  agent: MindosMcpAgentProfile,
  services: MindosMcpAgentsServices,
  env: NodeJS.ProcessEnv,
): void {
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
    const skills = services.loadMindosSkills?.();
    if (skills) {
      agent.installedSkillNames = skills.names;
      agent.installedSkillCount = skills.names.length;
      agent.installedSkillSourcePath = skills.sourcePath;
      agent.skillMode = 'universal';
      agent.skillWorkspacePath = skills.workspacePath;
    }
  } catch {
    // Skill discovery should never make agent discovery fail.
  }

  const home = getHomeDir(services);
  const mindRoot = services.mindRoot ?? join(home, '.mindos');
  const mcpConfigPath = join(home, '.mindos', 'mcp.json');
  try {
    const pathExists = services.pathExists ?? existsSync;
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
  if (agent.installed) return 0;
  if (agent.present) return 1;
  return 2;
}

function detectCustomAgentPresence(
  agent: MindosMcpAgentRegistryDef,
  services: MindosMcpAgentsServices,
): boolean {
  const pathExists = services.pathExists ?? existsSync;
  let present = agent.presenceDirs?.some((dir) => pathExists(expandHome(dir, services.homeDir))) ?? false;
  if (agent.presenceCli && (services.commandExists ?? defaultCommandExists)(agent.presenceCli)) {
    present = true;
  }
  return present;
}

function detectCustomAgentInstalled(
  agent: MindosMcpAgentRegistryDef,
  services: MindosMcpAgentsServices,
): MindosMcpAgentInstallStatus {
  const globalPath = expandHome(agent.global, services.homeDir);
  const pathExists = services.pathExists ?? existsSync;
  if (!pathExists(globalPath)) return { installed: false };

  try {
    const readTextFile = services.readTextFile ?? readFileSyncUtf8;
    const parsed = JSON.parse(readTextFile(globalPath));
    const configObj = agent.globalNestedKey
      ? readNestedRecord(parsed, agent.globalNestedKey) ?? {}
      : parsed;
    const servers = readOwnRecord(configObj, agent.key) ?? {};
    if (servers && typeof servers === 'object' && 'mindos' in servers) {
      return { installed: true, scope: 'global', configPath: globalPath };
    }
  } catch {
    // Invalid custom config is treated as not installed.
  }

  return { installed: false };
}

function defaultDetectAgentInstalled(
  agent: MindosMcpAgentRegistryDef,
  services: MindosMcpAgentsServices,
): MindosMcpAgentInstallStatus {
  for (const [scopeType, cfgPath] of [['global', agent.global], ['project', agent.project]] as Array<['global' | 'project', string | null | undefined]>) {
    if (!cfgPath) continue;
    const absPath = resolveAgentConfigPath(cfgPath, scopeType, services);
    const pathExists = services.pathExists ?? existsSync;
    if (!pathExists(absPath)) continue;

    try {
      const readTextFile = services.readTextFile ?? readFileSyncUtf8;
      const content = readTextFile(absPath);
      const entry = readMindosMcpEntry(content, agent, scopeType);
      if (!entry) continue;
      const transport = entry.type === 'stdio' || entry.command ? 'stdio' : entry.url ? 'http' : 'unknown';
      return { installed: true, scope: scopeType, transport, configPath: cfgPath, url: entry.url };
    } catch {
      continue;
    }
  }

  return { installed: false };
}

function defaultDetectAgentConfiguredMcp(
  agent: MindosMcpAgentRegistryDef,
  services: MindosMcpAgentsServices,
): MindosMcpAgentConfiguredServers {
  const servers = new Set<string>();
  const sources: string[] = [];
  for (const [scopeType, cfgPath] of [['global', agent.global], ['project', agent.project]] as Array<['global' | 'project', string | null | undefined]>) {
    if (!cfgPath) continue;
    const absPath = resolveAgentConfigPath(cfgPath, scopeType, services);
    const pathExists = services.pathExists ?? existsSync;
    if (!pathExists(absPath)) continue;

    try {
      const readTextFile = services.readTextFile ?? readFileSyncUtf8;
      const content = readTextFile(absPath);
      const names = readMcpServerNames(content, agent, scopeType);
      for (const name of names) servers.add(name);
      if (names.length > 0) sources.push(`${scopeType}:${cfgPath}`);
    } catch {
      continue;
    }
  }

  return {
    servers: [...servers].sort((a, b) => a.localeCompare(b)),
    sources,
  };
}

function readMcpServerNames(
  content: string,
  agent: MindosMcpAgentRegistryDef,
  scopeType: 'global' | 'project',
): string[] {
  if (agent.format === 'toml') return parseTomlForServers(content, agent.key);
  if (agent.format === 'yaml') return parseYamlForServers(content, agent.key);
  const config = parseJsonc(content);
  const container = scopeType === 'global' && agent.globalNestedKey
    ? readNestedRecord(config, agent.globalNestedKey)
    : readOwnRecord(config, agent.key);
  return Object.keys(container ?? {}).sort((a, b) => a.localeCompare(b));
}

function readMindosMcpEntry(
  content: string,
  agent: MindosMcpAgentRegistryDef,
  scopeType: 'global' | 'project',
): { type?: string; command?: string; url?: string } | null {
  if (agent.format === 'toml') return parseTomlMcpEntry(content, agent.key, 'mindos');
  if (agent.format === 'yaml') return parseYamlMcpEntry(content, agent.key, 'mindos');
  const config = parseJsonc(content);
  const container = scopeType === 'global' && agent.globalNestedKey
    ? readNestedRecord(config, agent.globalNestedKey)
    : readOwnRecord(config, agent.key);
  const entry = readOwnRecord(container, 'mindos');
  if (!entry) return null;
  return {
    type: typeof entry.type === 'string' ? entry.type : undefined,
    command: typeof entry.command === 'string' ? entry.command : undefined,
    url: typeof entry.url === 'string' ? entry.url : undefined,
  };
}

function parseTomlMcpEntry(
  content: string,
  sectionKey: string,
  serverName: string,
): { type?: string; url?: string } | null {
  const targetSection = `[${sectionKey}.${serverName}]`;
  const rootSection = `[${sectionKey}]`;
  let inTargetSection = false;
  let inRootSection = false;
  let foundInline = false;
  let entry: { type?: string; url?: string } = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if ((inTargetSection || foundInline) && (entry.type || entry.url)) return entry;
      inTargetSection = trimmed === targetSection;
      inRootSection = trimmed === rootSection;
      foundInline = false;
      entry = {};
      continue;
    }

    const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2];
    if (!key || !rawValue) continue;
    const value = rawValue.replace(/^["'](.+)["']$/, '$1');
    if (inTargetSection) {
      if (key === 'type') entry.type = value;
      if (key === 'url') entry.url = value;
    } else if (inRootSection && key === serverName) {
      entry.type = rawValue.match(/type\s*=\s*["']([^"']+)["']/)?.[1];
      entry.url = rawValue.match(/url\s*=\s*["']([^"']+)["']/)?.[1];
      foundInline = true;
    }
  }

  return (inTargetSection || foundInline) && (entry.type || entry.url) ? entry : null;
}

function parseYamlMcpEntry(
  content: string,
  sectionKey: string,
  serverName: string,
): { command?: string; url?: string } | null {
  let inSection = false;
  let inServer = false;
  let baseIndent = -1;
  let serverIndent = -1;
  const entry: { command?: string; url?: string } = {};

  for (const line of content.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (indent === 0 && trimmed === `${sectionKey}:`) {
      inSection = true;
      inServer = false;
      baseIndent = -1;
      serverIndent = -1;
      continue;
    }
    if (indent === 0 && trimmed) {
      if (inServer) return Object.keys(entry).length > 0 ? entry : {};
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    if (baseIndent < 0) baseIndent = indent;
    if (indent === baseIndent) {
      if (inServer) return Object.keys(entry).length > 0 ? entry : {};
      inServer = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:/)?.[1] === serverName;
      serverIndent = -1;
      continue;
    }
    if (!inServer) continue;
    if (serverIndent < 0) serverIndent = indent;
    if (indent !== serverIndent) continue;
    const match = trimmed.match(/^(command|url)\s*:\s*["']?([^"'\n]+)["']?\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (!key || !value) continue;
    if (key === 'command') entry.command = value.trim();
    if (key === 'url') entry.url = value.trim();
  }

  return inServer ? entry : null;
}

function resolveCustomSkillWorkspaceProfile(
  custom: MindosCustomMcpAgentDef,
  agent: MindosMcpAgentRegistryDef,
  services: MindosMcpAgentsServices,
): MindosMcpAgentSkillProfile {
  const defaultSkillDir = custom.baseDir.endsWith('/') ? `${custom.baseDir}skills/` : `${custom.baseDir}/skills/`;
  return {
    mode: 'additional',
    skillAgentName: custom.key,
    workspacePath: expandHome(custom.skillDir || agent.presenceDirs?.[0] && `${agent.presenceDirs[0]}skills/` || defaultSkillDir, services.homeDir),
  };
}

function defaultScanCustomAgentSkills(
  custom: MindosCustomMcpAgentDef,
  services: MindosMcpAgentsServices,
): MindosMcpAgentInstalledSkills {
  const skillDir = custom.skillDir || (custom.baseDir.endsWith('/') ? `${custom.baseDir}skills/` : `${custom.baseDir}/skills/`);
  const sourcePath = expandHome(skillDir, services.homeDir);
  const skills = services.listSkillNames?.(sourcePath) ?? defaultListSkillNames(sourcePath);
  return { skills, sourcePath };
}

function defaultDetectAgentPresence(
  agent: MindosMcpAgentRegistryDef,
  services: MindosMcpAgentsServices,
): boolean {
  const pathExists = services.pathExists ?? existsSync;
  const dirPresent = agent.presenceDirs?.some((entry) => pathExists(expandHome(entry, services.homeDir))) ?? false;
  if (dirPresent) return true;
  return agent.presenceCli ? (services.commandExists ?? defaultCommandExists)(agent.presenceCli) : false;
}

function defaultSkillWorkspaceProfile(
  agentKey: string,
  agent: MindosMcpAgentRegistryDef,
  services: MindosMcpAgentsServices,
): MindosMcpAgentSkillProfile {
  const hiddenRoot = resolveHiddenRootPath(agent, services);
  return {
    mode: agentKey === 'mindos' ? 'universal' : 'unsupported',
    workspacePath: join(hiddenRoot, 'skills'),
  };
}

function defaultRuntimeSignals(
  agent: MindosMcpAgentRegistryDef,
  services: MindosMcpAgentsServices,
): MindosMcpAgentRuntimeSignals {
  const hiddenRootPath = resolveHiddenRootPath(agent, services);
  return {
    hiddenRootPath,
    hiddenRootPresent: (services.pathExists ?? existsSync)(hiddenRootPath),
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

function resolveHiddenRootPath(agent: MindosMcpAgentRegistryDef, services: MindosMcpAgentsServices): string {
  const pathExists = services.pathExists ?? existsSync;
  for (const entry of agent.presenceDirs ?? []) {
    const abs = expandHome(entry, services.homeDir);
    if (pathExists(abs)) return abs;
  }
  return dirname(expandHome(agent.global, services.homeDir));
}

function readNestedRecord(obj: unknown, nestedPath: string): Record<string, unknown> | null {
  const parts = nestedPath.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.some(isUnsafeObjectKey)) return null;
  let current = obj;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== 'object') return null;
  return current as Record<string, unknown>;
}

function readOwnRecord(obj: unknown, key: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object' || isUnsafeObjectKey(key)) return null;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
  const value = (obj as Record<string, unknown>)[key];
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function isUnsafeObjectKey(key: string): boolean {
  return key === '__proto__' || key === 'prototype' || key === 'constructor';
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

function parseJsonc(text: string): Record<string, unknown> {
  let stripped = text.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)/gm, (match, comment) => comment ? '' : match);
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!stripped.trim()) return {};
  return JSON.parse(stripped) as Record<string, unknown>;
}

function expandHome(path: string, homeDir?: string): string {
  if (!path.startsWith('~/') && !path.startsWith('~\\')) return path;
  return resolve(homeDir ?? homedir(), path.slice(2));
}

function resolveAgentConfigPath(
  configPath: string,
  scopeType: 'global' | 'project',
  services: Pick<MindosMcpAgentsServices, 'homeDir' | 'projectRoot'>,
): string {
  const expanded = expandHome(configPath, services.homeDir);
  if (scopeType !== 'project' || isAbsolute(expanded)) return expanded;
  return resolve(services.projectRoot ?? process.cwd(), expanded);
}

function getHomeDir(services: Pick<MindosMcpAgentsServices, 'homeDir'>): string {
  return services.homeDir ?? homedir();
}

function readFileSyncUtf8(path: string): string {
  return readFileSync(path, 'utf-8');
}

function defaultListSkillNames(sourcePath: string): string[] {
  if (!existsSync(sourcePath)) return [];
  try {
    return readdirSync(sourcePath, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function defaultCommandExists(command: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function defaultFetchHead(url: string, options: { signal: AbortSignal }): Promise<{ status: number }> {
  if (typeof fetch !== 'function') return { status: 200 };
  const response = await fetch(url, { method: 'HEAD', signal: options.signal });
  return { status: response.status };
}
