import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import {
  resolveSkillLinkAgents,
  type MindosMcpAgentRegistryDef,
  type MindosSkillAgentRegistration,
  type MindosSkillLinkAgent,
} from '@geminilight/mindos/server';
import { SKILL_AGENT_REGISTRY } from './mcp-agent-registry';
import type { SkillInstallMode as SkillInstallModeType } from './mcp-agent-registry';
import { loadCustomAgents } from './custom-agents';
export {
  SKILL_AGENT_REGISTRY,
  type SkillAgentRegistration,
  type SkillInstallMode,
} from './mcp-agent-registry';

/** Parse JSONC — strips single-line (//) and block comments before JSON.parse */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseJsonc(text: string): any {
  let stripped = text.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)/gm, (m, g) => g ? '' : m);
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!stripped.trim()) return {};
  return JSON.parse(stripped);
}

export function expandHome(p: string): string {
  return p.startsWith('~/') || p.startsWith('~\\') ? path.resolve(os.homedir(), p.slice(2)) : p;
}

function normalizeConfigRoot(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function windowsAppDataRoot(): string {
  return normalizeConfigRoot(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'));
}

function windowsLocalAppDataRoot(): string {
  return normalizeConfigRoot(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'));
}

function platformAppDataPath(options: { darwin: string; linux: string; win32: string }): string {
  if (process.platform === 'darwin') return options.darwin;
  if (process.platform === 'win32') return `${windowsAppDataRoot()}/${options.win32}`;
  return options.linux;
}

function platformLocalAppDataPath(options: { darwin: string; linux: string; win32: string }): string {
  if (process.platform === 'darwin') return options.darwin;
  if (process.platform === 'win32') return `${windowsLocalAppDataRoot()}/${options.win32}`;
  return options.linux;
}

const codeUserRoot = platformAppDataPath({
  darwin: '~/Library/Application Support/Code/User',
  linux: '~/.config/Code/User',
  win32: 'Code/User',
});

const codeRoot = platformAppDataPath({
  darwin: '~/Library/Application Support/Code',
  linux: '~/.config/Code',
  win32: 'Code',
});

const traeCnRoot = platformAppDataPath({
  darwin: '~/Library/Application Support/Trae CN',
  linux: '~/.config/Trae CN',
  win32: 'Trae CN',
});

const warpStableStateRoot = platformLocalAppDataPath({
  darwin: '~/Library/Group Containers/2BBY89MBSN.dev.warp/Library/Application Support/dev.warp.Warp-Stable',
  linux: '~/.local/state/warp-terminal',
  win32: 'warp/Warp/data',
});

const warpPreviewStateRoot = platformLocalAppDataPath({
  darwin: '~/Library/Group Containers/2BBY89MBSN.dev.warp/Library/Application Support/dev.warp.Warp-Preview',
  linux: '~/.local/state/warp-terminal-preview',
  win32: 'warp/WarpPreview/data',
});

const warpConfigRoot = platformLocalAppDataPath({
  darwin: '~/.warp',
  linux: '~/.config/warp-terminal',
  win32: 'warp/Warp/config',
});

const warpDataRoot = platformAppDataPath({
  darwin: '~/.warp',
  linux: '~/.local/share/warp-terminal',
  win32: 'warp/Warp/data',
});

export interface AgentDef {
  name: string;
  project: string | null;
  global: string;
  /** Additional config files to inspect for existing installs without writing to them. */
  projectReadAlso?: string[];
  globalReadAlso?: string[];
  key: string;
  preferredTransport: 'stdio' | 'http';
  /** Config file format: 'json' (default), 'toml', or 'yaml'. */
  format?: 'json' | 'toml' | 'yaml';
  /** For agents whose global config nests under a parent key (e.g. VS Code: mcp.servers). */
  globalNestedKey?: string;
  /** Agent-specific MCP entry shape. Defaults to the common Claude/Cursor style. */
  entryStyle?: 'standard' | 'kilo';
  /** Agent-specific skills workspace, when it differs from the config/presence root. */
  skillDir?: string;
  /** CLI binary name for presence detection (e.g. 'claude'). Optional. */
  presenceCli?: string;
  /** Data directories for presence detection. Any one existing → present. */
  presenceDirs?: string[];
}

export const MCP_AGENTS: Record<string, AgentDef> = {
  'mindos': {
    name: 'MindOS',
    project: null,
    global: '~/.mindos/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: ['~/.mindos/'],
  },
  'claude-code': {
    name: 'Claude Code',
    project: '.mcp.json',
    global: '~/.claude.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'claude',
    presenceDirs: ['~/.claude/'],
  },
  'cursor': {
    name: 'Cursor',
    project: '.cursor/mcp.json',
    global: '~/.cursor/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: ['~/.cursor/extensions/'],
  },
  'windsurf': {
    name: 'Windsurf',
    project: null,
    global: '~/.codeium/windsurf/mcp_config.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: ['~/.codeium/windsurf/'],
  },
  'cline': {
    name: 'Cline',
    project: null,
    global: `${codeUserRoot}/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`,
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: [
      `${codeUserRoot}/globalStorage/saoudrizwan.claude-dev/`,
    ],
  },
  'trae': {
    name: 'Trae',
    project: '.trae/mcp.json',
    global: '~/.trae/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: ['~/.trae/'],
  },
  'gemini-cli': {
    name: 'Gemini CLI',
    project: '.gemini/settings.json',
    global: '~/.gemini/settings.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'gemini',
    presenceDirs: ['~/.gemini/'],
  },
  'openclaw': {
    name: 'OpenClaw',
    project: null,
    global: '~/.openclaw/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'openclaw',
    presenceDirs: ['~/.openclaw/'],
  },
  'codebuddy': {
    name: 'CodeBuddy',
    project: null,
    global: '~/.codebuddy/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'codebuddy',
    presenceDirs: ['~/.codebuddy/'],
  },
  'kimi-cli': {
    name: 'Kimi Code',
    project: '.kimi/mcp.json',
    global: '~/.kimi/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'kimi',
    presenceDirs: ['~/.kimi/'],
  },
  'opencode': {
    name: 'OpenCode',
    project: null,
    global: '~/.config/opencode/config.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'opencode',
    presenceDirs: ['~/.config/opencode/'],
  },
  'kilo-code': {
    name: 'Kilo Code',
    project: '.kilo/kilo.jsonc',
    global: '~/.config/kilo/kilo.jsonc',
    projectReadAlso: [
      '.kilo/kilo.json',
      'kilo.jsonc',
      'kilo.json',
      '.kilocode/kilo.jsonc',
      '.kilocode/kilo.json',
      '.opencode/opencode.jsonc',
      '.opencode/opencode.json',
    ],
    globalReadAlso: [
      '~/.config/kilo/kilo.json',
      '~/.config/kilo/opencode.jsonc',
      '~/.config/kilo/opencode.json',
      '~/.config/kilo/config.json',
    ],
    key: 'mcp',
    preferredTransport: 'stdio',
    entryStyle: 'kilo',
    presenceCli: 'kilo',
    presenceDirs: ['~/.config/kilo/', '~/.kilo/', '~/.kilocode/'],
  },
  'warp': {
    name: 'Warp',
    project: '.warp/.mcp.json',
    global: '~/.warp/.mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: [
      '~/.warp/',
      `${warpStableStateRoot}/`,
      `${warpPreviewStateRoot}/`,
      `${warpConfigRoot}/`,
      `${warpDataRoot}/`,
    ],
  },
  'pi': {
    name: 'Pi',
    project: '.pi/settings.json',
    global: '~/.pi/agent/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'pi',
    presenceDirs: ['~/.pi/'],
  },
  'augment': {
    name: 'Augment',
    project: '.augment/settings.json',
    global: '~/.augment/settings.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'auggie',
    presenceDirs: ['~/.augment/'],
  },
  'qwen-code': {
    name: 'Qwen Code',
    project: '.qwen/settings.json',
    global: '~/.qwen/settings.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'qwen',
    presenceDirs: ['~/.qwen/'],
  },
  'qoder': {
    name: 'Qoder',
    project: null,
    global: '~/.qoder.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'qoder',
    presenceDirs: ['~/.qoder/', '~/.qoder.json'],
  },
  'trae-cn': {
    name: 'Trae CN',
    project: '.trae/mcp.json',
    global: `${traeCnRoot}/User/mcp.json`,
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'trae-cli',
    presenceDirs: [
      `${traeCnRoot}/`,
    ],
  },
  'roo': {
    name: 'Roo Code',
    project: '.roo/mcp.json',
    global: `${codeUserRoot}/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`,
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: [
      `${codeUserRoot}/globalStorage/rooveterinaryinc.roo-cline/`,
    ],
  },
  'github-copilot': {
    name: 'GitHub Copilot',
    project: '.vscode/mcp.json',
    global: `${codeUserRoot}/mcp.json`,
    key: 'servers',
    preferredTransport: 'stdio',
    presenceDirs: [
      `${codeRoot}/`,
    ],
    presenceCli: 'code',
  },
  'codex': {
    name: 'Codex',
    project: null,
    global: '~/.codex/config.toml',
    key: 'mcp_servers',
    format: 'toml',
    preferredTransport: 'stdio',
    presenceCli: 'codex',
    presenceDirs: ['~/.codex/'],
  },
  'antigravity': {
    name: 'Antigravity',
    project: '.antigravity/mcp_config.json',
    global: '~/.gemini/antigravity/mcp_config.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'agy',
    presenceDirs: ['~/.gemini/antigravity/'],
  },
  'qclaw': {
    name: 'QClaw',
    project: null,
    global: '~/.qclaw/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'qclaw',
    presenceDirs: ['~/.qclaw/'],
  },
  'workbuddy': {
    name: 'WorkBuddy',
    project: null,
    global: '~/.workbuddy/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'workbuddy',
    presenceDirs: ['~/.workbuddy/'],
  },
  'lingma': {
    name: 'Lingma',
    project: null,
    global: '~/.lingma/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: ['~/.lingma/'],
  },
  'copaw': {
    name: 'CoPaw',
    project: null,
    global: '~/.copaw/config.json',
    key: 'mcp',
    globalNestedKey: 'mcp.clients',
    preferredTransport: 'stdio',
    presenceCli: 'copaw',
    presenceDirs: ['~/.copaw/'],
  },
  'hermes': {
    name: 'Hermes',
    project: null,
    global: '~/.hermes/config.yaml',
    key: 'mcp_servers',
    format: 'yaml',
    preferredTransport: 'stdio',
    presenceCli: 'hermes',
    presenceDirs: ['~/.hermes/'],
  },
};

export interface SkillWorkspaceProfile {
  mode: SkillInstallModeType;
  skillAgentName?: string;
  workspacePath: string;
}

export interface AgentRuntimeSignals {
  hiddenRootPath: string;
  hiddenRootPresent: boolean;
  conversationSignal: boolean;
  usageSignal: boolean;
  lastActivityAt?: string;
}

export interface AgentConfiguredMcpServers {
  servers: string[];
  sources: string[];
}

export interface AgentInstalledSkills {
  skills: string[];
  sourcePath: string;
}

function resolveHiddenRootPath(agent: AgentDef): string {
  const dirs = agent.presenceDirs ?? [];
  for (const entry of dirs) {
    const abs = expandHome(entry);
    if (!fs.existsSync(abs)) continue;
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) return abs;
      if (stat.isFile()) return path.dirname(abs);
    } catch {
      continue;
    }
  }
  return path.dirname(expandHome(agent.global));
}

function readDirectoryEntries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function detectSignalsFromName(name: string): { conversation: boolean; usage: boolean } {
  const lowered = name.toLowerCase();
  return {
    conversation: /(session|history|conversation|chat|transcript)/.test(lowered),
    usage: /(usage|token|cost|billing|metric|analytics)/.test(lowered),
  };
}

function readNestedRecord(obj: Record<string, unknown>, nestedPath: string): Record<string, unknown> | null {
  const parts = nestedPath.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.some(isUnsafeObjectKey)) return null;
  let current: unknown = obj;
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

function parseJsonServerNames(content: string, configKey: string, globalNestedKey?: string): string[] {
  try {
    const config = parseJsonc(content) as Record<string, unknown>;
    const section = globalNestedKey
      ? readNestedRecord(config, globalNestedKey)
      : readOwnRecord(config, configKey);
    if (!section) return [];
    return Object.keys(section);
  } catch {
    return [];
  }
}

function parseYamlServerNames(content: string, sectionKey: string): string[] {
  // Lightweight YAML parser: find top-level key matching sectionKey,
  // then collect all direct children (indent = base + 2 spaces).
  const lines = content.split('\n');
  let inSection = false;
  let baseIndent = -1;
  const names: string[] = [];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    // Top-level key
    if (indent === 0 && trimmed.startsWith(sectionKey + ':')) {
      inSection = true;
      baseIndent = -1;
      continue;
    }
    // Another top-level key ends the section
    if (indent === 0 && trimmed) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    // First child sets the base indent
    if (baseIndent < 0) {
      baseIndent = indent;
    }
    // Direct children at base indent level
    if (indent === baseIndent) {
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:/);
      if (match) names.push(match[1]);
    }
  }
  return names;
}

function parseTomlServerNames(content: string, sectionKey: string): string[] {
  const names = new Set<string>();
  const lines = content.split('\n');
  let inRootSection = false;
  const sectionPrefix = `${sectionKey}.`;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const section = trimmed.slice(1, -1).trim();
      inRootSection = section === sectionKey;
      if (section.startsWith(sectionPrefix)) {
        const name = section.slice(sectionPrefix.length).split('.')[0]?.trim();
        if (name) names.add(name);
      }
      continue;
    }
    if (!inRootSection) continue;
    const kv = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*/);
    if (!kv) continue;
    const name = kv[1]?.trim();
    if (name) names.add(name);
  }
  return [...names];
}

function sameNormalizedPath(a: string, b: string): boolean {
  return path.normalize(a) === path.normalize(b);
}

function configPathCandidates(agent: AgentDef, scopeType: 'global' | 'project'): string[] {
  const primary = scopeType === 'global' ? agent.global : agent.project;
  const readAlso = scopeType === 'global' ? agent.globalReadAlso : agent.projectReadAlso;
  return [primary, ...(readAlso ?? [])].filter((entry): entry is string => !!entry);
}

function configFileLooksMindosManagedOnly(filePath: string, agent: AgentDef): boolean {
  const managedGlobalPaths = configPathCandidates(agent, 'global').map((candidate) => expandHome(candidate));
  if (!managedGlobalPaths.some((globalPath) => sameNormalizedPath(filePath, globalPath))) return false;

  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return false;
  }

  const trimmed = content.trim();
  if (!trimmed) return true;

  try {
    if (agent.format === 'toml') {
      const names = parseTomlServerNames(content, agent.key);
      return names.length === 0 || names.every(name => name === 'mindos');
    }
    if (agent.format === 'yaml') {
      const names = parseYamlServerNames(content, agent.key);
      return names.length === 0 || names.every(name => name === 'mindos');
    }

    const parsed = parseJsonc(content) as Record<string, unknown>;
    const section = agent.globalNestedKey
      ? readNestedRecord(parsed, agent.globalNestedKey)
      : readOwnRecord(parsed, agent.key);
    if (!section) return Object.keys(parsed).length === 0;
    const serverNames = Object.keys(section);
    if (!serverNames.every(name => name === 'mindos')) return false;

    if (!agent.globalNestedKey) {
      const topKeys = Object.keys(parsed);
      return topKeys.length === 0 || (topKeys.length === 1 && topKeys[0] === agent.key);
    }

    let cursor: Record<string, unknown> | null = parsed;
    const parts = agent.globalNestedKey.split('.').filter(Boolean);
    for (const part of parts) {
      if (!cursor || Object.keys(cursor).some(key => key !== part)) return false;
      cursor = cursor[part] && typeof cursor[part] === 'object'
        ? cursor[part] as Record<string, unknown>
        : null;
    }
    return true;
  } catch {
    return false;
  }
}

function presencePathHasAgentSignal(candidatePath: string, agent: AgentDef): boolean {
  if (!fs.existsSync(candidatePath)) return false;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(candidatePath);
  } catch {
    return true;
  }

  if (stat.isFile()) return !configFileLooksMindosManagedOnly(candidatePath, agent);
  if (!stat.isDirectory()) return true;

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(candidatePath, { withFileTypes: true });
  } catch {
    return true;
  }

  if (entries.length === 0) return false;

  const ignoredEntryNames = new Set(['.DS_Store', 'skills']);
  for (const entry of entries) {
    if (ignoredEntryNames.has(entry.name)) continue;
    const entryPath = path.join(candidatePath, entry.name);
    if (entry.isFile() && configFileLooksMindosManagedOnly(entryPath, agent)) continue;
    return true;
  }

  return false;
}

export function resolveSkillWorkspaceProfile(agentKey: string): SkillWorkspaceProfile {
  const registration = SKILL_AGENT_REGISTRY[agentKey] ?? { mode: 'unsupported' as const };
  if (registration.mode === 'universal') {
    return { mode: registration.mode, workspacePath: expandHome('~/.agents/skills') };
  }
  const agent = MCP_AGENTS[agentKey];
  const workspacePath = agent?.skillDir
    ? expandHome(agent.skillDir)
    : path.join(agent ? resolveHiddenRootPath(agent) : expandHome('~/.agents'), 'skills');
  return {
    mode: registration.mode,
    skillAgentName: registration.skillAgentName,
    workspacePath,
  };
}

export function detectAgentConfiguredMcpServers(agentKey: string): AgentConfiguredMcpServers {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return { servers: [], sources: [] };
  const serverSet = new Set<string>();
  const sources: string[] = [];
  for (const scopeType of ['global', 'project'] as const) {
    for (const cfgPath of configPathCandidates(agent, scopeType)) {
      const absPath = expandHome(cfgPath);
      if (!fs.existsSync(absPath)) continue;
      try {
        const content = fs.readFileSync(absPath, 'utf-8');
        const nestedPath = scopeType === 'global' ? agent.globalNestedKey : undefined;
        const names =
          agent.format === 'toml'
            ? parseTomlServerNames(content, agent.key)
            : agent.format === 'yaml'
              ? parseYamlServerNames(content, agent.key)
              : parseJsonServerNames(content, agent.key, nestedPath);
        for (const name of names) serverSet.add(name);
        sources.push(`${scopeType}:${cfgPath}`);
      } catch {
        continue;
      }
    }
  }
  return {
    servers: [...serverSet].sort((a, b) => a.localeCompare(b)),
    sources,
  };
}

export function detectAgentInstalledSkills(agentKey: string): AgentInstalledSkills {
  const profile = resolveSkillWorkspaceProfile(agentKey);
  const sourcePath = profile.workspacePath;
  if (!fs.existsSync(sourcePath)) return { skills: [], sourcePath };
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(sourcePath, { withFileTypes: true });
  } catch {
    return { skills: [], sourcePath };
  }
  const skills = entries
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  return { skills, sourcePath };
}

export function detectAgentRuntimeSignals(agentKey: string): AgentRuntimeSignals {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) {
    return {
      hiddenRootPath: '',
      hiddenRootPresent: false,
      conversationSignal: false,
      usageSignal: false,
    };
  }
  const hiddenRootPath = resolveHiddenRootPath(agent);
  if (!fs.existsSync(hiddenRootPath)) {
    return {
      hiddenRootPath,
      hiddenRootPresent: false,
      conversationSignal: false,
      usageSignal: false,
    };
  }

  const maxDepth = 3;
  const maxEntries = 300;
  let scanned = 0;
  let conversationSignal = false;
  let usageSignal = false;
  let latestMtime = 0;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: hiddenRootPath, depth: 0 }];

  while (queue.length > 0 && scanned < maxEntries) {
    const current = queue.shift();
    if (!current) break;
    const entries = readDirectoryEntries(current.dir);
    for (const entry of entries) {
      if (scanned >= maxEntries) break;
      scanned += 1;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(current.dir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
        const signals = detectSignalsFromName(entry.name);
        if (signals.conversation) conversationSignal = true;
        if (signals.usage) usageSignal = true;
        if (entry.isDirectory() && current.depth < maxDepth) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        }
      } catch {
        continue;
      }
    }
  }

  return {
    hiddenRootPath,
    hiddenRootPresent: true,
    conversationSignal,
    usageSignal,
    lastActivityAt: latestMtime > 0 ? new Date(latestMtime).toISOString() : undefined,
  };
}

/* ── MindOS MCP Install Detection ──────────────────────────────────────── */

export function detectInstalled(agentKey: string): { installed: boolean; scope?: string; transport?: string; configPath?: string; url?: string } {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return { installed: false };

  for (const scopeType of ['global', 'project'] as const) {
    for (const cfgPath of configPathCandidates(agent, scopeType)) {
      const absPath = expandHome(cfgPath);
      if (!fs.existsSync(absPath)) continue;
      try {
        const content = fs.readFileSync(absPath, 'utf-8');
        // Handle TOML format (e.g., codex)
        if (agent.format === 'toml') {
          const result = parseTomlMcpEntry(content, agent.key, 'mindos');
          if (result.found && result.entry) {
            const entry = result.entry;
            const transport = entry.type === 'stdio' ? 'stdio' : entry.url ? 'http' : 'unknown';
            return { installed: true, scope: scopeType, transport, configPath: cfgPath, url: entry.url };
          }
        } else if (agent.format === 'yaml') {
          const result = parseYamlMcpEntry(content, agent.key, 'mindos');
          if (result.found && result.entry) {
            const entry = result.entry;
            const transport = entry.command ? 'stdio' : entry.url ? 'http' : 'unknown';
            return { installed: true, scope: scopeType, transport, configPath: cfgPath, url: entry.url };
          }
        } else {
          // JSON format (default)
          const config = parseJsonc(content);
          const servers = scopeType === 'global' && agent.globalNestedKey
            ? readNestedRecord(config as Record<string, unknown>, agent.globalNestedKey)
            : readOwnRecord(config, agent.key) ?? undefined;
          if (servers?.mindos) {
            const entry = servers.mindos as Record<string, unknown>;
            const transport = isLocalMcpEntry(entry) ? 'stdio' : entry.url ? 'http' : 'unknown';
            return { installed: true, scope: scopeType, transport, configPath: cfgPath, url: entry.url as string | undefined };
          }
        }
      } catch { /* ignore parse errors */ }
    }
  }

  return { installed: false };
}

function isLocalMcpEntry(entry: Record<string, unknown>): boolean {
  return entry.type === 'stdio'
    || entry.type === 'local'
    || typeof entry.command === 'string'
    || Array.isArray(entry.command);
}

// Parse YAML to find MCP server entry without external library
function parseYamlMcpEntry(content: string, sectionKey: string, serverName: string): { found: boolean; entry?: { command?: string; url?: string } } {
  const lines = content.split('\n');
  let inSection = false;
  let inServer = false;
  let baseIndent = -1;
  let serverIndent = -1;
  const entry: { command?: string; url?: string } = {};

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    // Top-level key
    if (indent === 0 && trimmed.startsWith(sectionKey + ':')) {
      inSection = true;
      baseIndent = -1;
      continue;
    }
    // Another top-level key ends the section
    if (indent === 0 && trimmed) {
      if (inServer) return { found: true, entry };
      inSection = false;
      continue;
    }
    if (!inSection) continue;

    // First child sets the base indent
    if (baseIndent < 0) baseIndent = indent;

    // Server name at base indent
    if (indent === baseIndent) {
      if (inServer) return { found: true, entry };
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:/);
      if (match && match[1] === serverName) {
        inServer = true;
        serverIndent = -1;
      }
      continue;
    }

    if (!inServer) continue;
    if (serverIndent < 0) serverIndent = indent;
    if (indent === serverIndent) {
      const kv = trimmed.match(/^(command|url)\s*:\s*["']?([^"'\n]+)["']?\s*$/);
      if (kv) {
        if (kv[1] === 'command') entry.command = kv[2].trim();
        if (kv[1] === 'url') entry.url = kv[2].trim();
      }
    }
  }

  if (inServer) return { found: true, entry };
  return { found: false };
}

// Parse TOML to find MCP server entry without external library
function parseTomlMcpEntry(content: string, sectionKey: string, serverName: string): { found: boolean; entry?: { type?: string; url?: string } } {
  const lines = content.split('\n');
  const targetSection = `[${sectionKey}.${serverName}]`;
  const genericSection = `[${sectionKey}]`;

  let inTargetSection = false;
  let inGenericSection = false;
  let foundInGeneric = false;
  let entry: { type?: string; url?: string } = {};

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for section headers
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      // Save previous section result if we were in the target
      if (inTargetSection && (entry.type || entry.url)) {
        return { found: true, entry };
      }
      if (foundInGeneric && (entry.type || entry.url)) {
        return { found: true, entry };
      }

      inTargetSection = trimmed === targetSection;
      inGenericSection = trimmed === genericSection;
      foundInGeneric = false;
      entry = {};
      continue;
    }

    // Parse key-value pairs
    const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (match) {
      const [, key, rawValue] = match;
      // Remove quotes from value
      const value = rawValue.replace(/^["'](.+)["']$/, '$1');

      if (inTargetSection) {
        if (key === 'type') entry.type = value;
        if (key === 'url') entry.url = value;
      } else if (inGenericSection && key === serverName) {
        // Check if it's a table reference like mindos = { type = "stdio" }
        const tableMatch = rawValue.match(/\{\s*type\s*=\s*["']([^"']+)["'].*?\}/);
        if (tableMatch) {
          entry.type = tableMatch[1];
        }
        const urlMatch = rawValue.match(/url\s*=\s*["']([^"']+)["']/);
        if (urlMatch) {
          entry.url = urlMatch[1];
        }
        foundInGeneric = true;
      }
    }
  }

  // Check at end of file
  if (inTargetSection && (entry.type || entry.url)) {
    return { found: true, entry };
  }
  if (foundInGeneric && (entry.type || entry.url)) {
    return { found: true, entry };
  }

  return { found: false };
}

/* ── Agent Presence Detection ──────────────────────────────────────────── */

export function detectAgentPresence(agentKey: string): boolean {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return false;
  // 1. CLI check
  if (agent.presenceCli) {
    try {
      execFileSync(process.platform === 'win32' ? 'where' : 'which', [agent.presenceCli], { stdio: 'pipe' });
      return true;
    } catch { /* not found */ }
  }
  // 2. Dir check
  if (agent.presenceDirs?.some(d => presencePathHasAgentSignal(expandHome(d), agent))) return true;
  return false;
}

/* ── Skill Link Agents (skill × agent matrix) ──────────────────────────── */

/**
 * Downstream agents eligible for skill linking: present on this machine and
 * skill-capable (universal/additional). Unsupported-mode agents, agents not
 * detected on this machine, and MindOS itself are excluded. Custom agents are
 * appended with their configured skill directory (additional mode).
 */
export function listSkillLinkAgents(): MindosSkillLinkAgent[] {
  const linkAgents = resolveSkillLinkAgents({
    agents: MCP_AGENTS as unknown as Record<string, MindosMcpAgentRegistryDef>,
    skillAgentRegistry: SKILL_AGENT_REGISTRY as unknown as Record<string, MindosSkillAgentRegistration>,
    detectAgentPresence,
    resolveSkillWorkspaceProfile,
    // Route fs probing through THIS module's fs so behavior is injectable in
    // tests (the package's own fs import is not affected by web-side spies).
    pathExists: (p: string) => fs.existsSync(p),
  });

  const seenKeys = new Set(linkAgents.map((agent) => agent.key));
  for (const custom of loadCustomAgents()) {
    if (custom.key === 'mindos' || custom.key in MCP_AGENTS || seenKeys.has(custom.key)) continue;
    const presenceCandidates = [...(custom.presenceDirs ?? []), custom.baseDir].filter(Boolean);
    if (!presenceCandidates.some((dir) => fs.existsSync(expandHome(dir)))) continue;
    seenKeys.add(custom.key);
    linkAgents.push({
      key: custom.key,
      name: custom.name,
      mode: 'additional',
      // Same skill-dir resolution as getTrustedNativeSkillRoots in app/api/skills/route.ts.
      skillDir: expandHome(custom.skillDir || path.join(custom.baseDir, 'skills')),
    });
  }

  return linkAgents;
}
