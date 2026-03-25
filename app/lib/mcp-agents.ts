import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

/** Parse JSONC — strips single-line (//) and block comments before JSON.parse */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJsonc(text: string): any {
  // Strip single-line comments (not inside strings)
  let stripped = text.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)/gm, (m, g) => g ? '' : m);
  // Strip block comments
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(stripped);
}

export function expandHome(p: string): string {
  return p.startsWith('~/') ? path.resolve(os.homedir(), p.slice(2)) : p;
}

export interface AgentDef {
  name: string;
  project: string | null;
  global: string;
  key: string;
  preferredTransport: 'stdio' | 'http';
  /** Config file format: 'json' (default) or 'toml'. */
  format?: 'json' | 'toml';
  /** For agents whose global config nests under a parent key (e.g. VS Code: mcp.servers). */
  globalNestedKey?: string;
  /** CLI binary name for presence detection (e.g. 'claude'). Optional. */
  presenceCli?: string;
  /** Data directories for presence detection. Any one existing → present. */
  presenceDirs?: string[];
}

export type SkillInstallMode = 'universal' | 'additional' | 'unsupported';
export interface SkillAgentRegistration {
  mode: SkillInstallMode;
  /** npx skills `-a` value for additional agents. */
  skillAgentName?: string;
}

export const MCP_AGENTS: Record<string, AgentDef> = {
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
    presenceDirs: ['~/.cursor/'],
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
    global: process.platform === 'darwin'
      ? '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'
      : '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: [
      '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/',
      '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/',
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
  'iflow-cli': {
    name: 'iFlow CLI',
    project: '.iflow/settings.json',
    global: '~/.iflow/settings.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'iflow',
    presenceDirs: ['~/.iflow/'],
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
    global: process.platform === 'darwin'
      ? '~/Library/Application Support/Trae CN/User/mcp.json'
      : '~/.config/Trae CN/User/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'trae-cli',
    presenceDirs: [
      '~/Library/Application Support/Trae CN/',
      '~/.config/Trae CN/',
    ],
  },
  'roo': {
    name: 'Roo Code',
    project: '.roo/mcp.json',
    global: process.platform === 'darwin'
      ? '~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json'
      : '~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: [
      '~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/',
      '~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/',
    ],
  },
  'vscode': {
    name: 'VS Code',
    project: '.vscode/mcp.json',
    global: process.platform === 'darwin'
      ? '~/Library/Application Support/Code/User/settings.json'
      : '~/.config/Code/User/settings.json',
    key: 'servers',
    globalNestedKey: 'mcp.servers',
    preferredTransport: 'stdio',
    presenceDirs: [
      '~/Library/Application Support/Code/',
      '~/.config/Code/',
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
};

/**
 * Skill-install registry keyed by MCP agent key.
 * Keep in sync with docs and bin/lib/mcp-agents.js.
 */
export const SKILL_AGENT_REGISTRY: Record<string, SkillAgentRegistration> = {
  'claude-code': { mode: 'additional', skillAgentName: 'claude-code' },
  'cursor': { mode: 'universal' },
  'windsurf': { mode: 'additional', skillAgentName: 'windsurf' },
  'cline': { mode: 'universal' },
  'trae': { mode: 'additional', skillAgentName: 'trae' },
  'gemini-cli': { mode: 'universal' },
  'openclaw': { mode: 'additional', skillAgentName: 'openclaw' },
  'codebuddy': { mode: 'additional', skillAgentName: 'codebuddy' },
  'iflow-cli': { mode: 'additional', skillAgentName: 'iflow-cli' },
  'kimi-cli': { mode: 'universal' },
  'opencode': { mode: 'universal' },
  'pi': { mode: 'additional', skillAgentName: 'pi' },
  'augment': { mode: 'additional', skillAgentName: 'augment' },
  'qwen-code': { mode: 'additional', skillAgentName: 'qwen-code' },
  'qoder': { mode: 'additional', skillAgentName: 'qoder' },
  'trae-cn': { mode: 'additional', skillAgentName: 'trae-cn' },
  'roo': { mode: 'additional', skillAgentName: 'roo' },
  'vscode': { mode: 'universal' },
  'codex': { mode: 'universal' },
};

export interface SkillWorkspaceProfile {
  mode: SkillInstallMode;
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

export function resolveSkillWorkspaceProfile(agentKey: string): SkillWorkspaceProfile {
  const registration = SKILL_AGENT_REGISTRY[agentKey] ?? { mode: 'unsupported' as const };
  if (registration.mode === 'universal') {
    return { mode: registration.mode, workspacePath: expandHome('~/.agents/skills') };
  }
  const agent = MCP_AGENTS[agentKey];
  const root = agent ? resolveHiddenRootPath(agent) : expandHome('~/.agents');
  const workspacePath = path.join(root, 'skills');
  return {
    mode: registration.mode,
    skillAgentName: registration.skillAgentName,
    workspacePath,
  };
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

export function detectInstalled(agentKey: string): { installed: boolean; scope?: string; transport?: string; configPath?: string } {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return { installed: false };

  for (const [scopeType, cfgPath] of [['global', agent.global], ['project', agent.project]] as [string, string | null][]) {
    if (!cfgPath) continue;
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
          return { installed: true, scope: scopeType, transport, configPath: cfgPath };
        }
      } else {
        // JSON format (default)
        const config = parseJsonc(content);
        const servers = config[agent.key];
        if (servers?.mindos) {
          const entry = servers.mindos;
          const transport = entry.type === 'stdio' ? 'stdio' : entry.url ? 'http' : 'unknown';
          return { installed: true, scope: scopeType, transport, configPath: cfgPath };
        }
      }
    } catch { /* ignore parse errors */ }
  }

  return { installed: false };
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
      execSync(
        process.platform === 'win32' ? `where ${agent.presenceCli}` : `which ${agent.presenceCli}`,
        { stdio: 'pipe' },
      );
      return true;
    } catch { /* not found */ }
  }
  // 2. Dir check
  if (agent.presenceDirs?.some(d => fs.existsSync(expandHome(d)))) return true;
  return false;
}
