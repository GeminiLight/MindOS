import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import {
  detectAgentConfiguredMcpServersFromConfigs,
  detectAgentInstalledFromConfigs,
  detectConfigFormat,
  getNestedPath,
  listMcpServerNamesFromText,
  readOwnRecord,
  resolveSkillLinkAgents,
  type MindosMcpAgentRegistryDef,
  type MindosSkillAgentRegistration,
  type MindosSkillLinkAgent,
} from '@geminilight/mindos/server';
import { effectiveMindRoot } from '@geminilight/mindos/foundation';
import { SKILL_AGENT_REGISTRY } from './mcp-agent-registry';
import type { SkillInstallMode as SkillInstallModeType } from './mcp-agent-registry';
import { loadCustomAgents } from './custom-agents';
export {
  SKILL_AGENT_REGISTRY,
  type SkillAgentRegistration,
  type SkillInstallMode,
} from './mcp-agent-registry';

// JSONC parsing and `~` expansion live in the core package (spec-core-consolidation);
// re-exported here because `custom-agents.ts`, the API routes and tests import them from this module.
import { expandHome, parseJsonc } from '@geminilight/mindos/foundation';
export { expandHome, parseJsonc };

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
    const location = {
      format: detectConfigFormat(agent.format),
      sectionKey: agent.key,
      nestedPath: agent.globalNestedKey,
    };
    const names = listMcpServerNamesFromText(content, location);
    if (!names.every(name => name === 'mindos')) return false;
    if (location.format !== 'json') return true;

    const parsed = parseJsonc(content) as Record<string, unknown>;
    const section = agent.globalNestedKey
      ? getNestedPath(parsed, agent.globalNestedKey)
      : readOwnRecord(parsed, agent.key);
    if (!section) return Object.keys(parsed).length === 0;

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

/**
 * Detection services for the core config readers, routed through THIS
 * module's fs so behavior stays injectable in Web tests. Relative
 * project-scoped configs resolve against the mind root (the same base the
 * install handlers write to), never against the Web server's cwd.
 */
function detectionServices(options?: { projectRoot?: string }) {
  return {
    projectRoot: options?.projectRoot ?? safeMindRoot(),
    pathExists: (p: string) => fs.existsSync(p),
    readTextFile: (p: string) => fs.readFileSync(p, 'utf-8'),
  };
}

function safeMindRoot(): string | undefined {
  try {
    return effectiveMindRoot() || undefined;
  } catch {
    return undefined;
  }
}

export function detectAgentConfiguredMcpServers(agentKey: string, options?: { projectRoot?: string }): AgentConfiguredMcpServers {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return { servers: [], sources: [] };
  return detectAgentConfiguredMcpServersFromConfigs(agent as MindosMcpAgentRegistryDef, detectionServices(options));
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

/**
 * Whether MindOS is configured for `agentKey`, read through the shared
 * per-format config readers so a Codex-native `[mcp_servers.mindos]` table
 * with only `command` counts the same way it does in the product server.
 */
export function detectInstalled(
  agentKey: string,
  options?: { projectRoot?: string },
): { installed: boolean; scope?: string; transport?: string; configPath?: string; url?: string } {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return { installed: false };
  return detectAgentInstalledFromConfigs(agent as MindosMcpAgentRegistryDef, detectionServices(options));
}


/* ── Agent Presence Detection ──────────────────────────────────────────── */

// `GET /api/mcp/agents` used to spawn one synchronous `which` per registry
// entry (~20 processes) on every request; presence rarely changes, so a short
// memo bounds the cost while still noticing a fresh install within seconds.
const PRESENCE_CACHE_TTL_MS = 15_000;
const presenceCache = new Map<string, { at: number; value: boolean }>();

/** Test hook: forget memoised presence results. */
export function resetAgentPresenceCache(): void {
  presenceCache.clear();
}

export function detectAgentPresence(agentKey: string): boolean {
  const cached = presenceCache.get(agentKey);
  if (cached && Date.now() - cached.at < PRESENCE_CACHE_TTL_MS) return cached.value;
  const value = detectAgentPresenceUncached(agentKey);
  presenceCache.set(agentKey, { at: Date.now(), value });
  return value;
}

function detectAgentPresenceUncached(agentKey: string): boolean {
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
