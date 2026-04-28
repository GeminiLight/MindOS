/**
 * Custom Agent registration: types, slugify, defaults inference, and persistence.
 *
 * CustomAgentDef is stored in config.json.customAgents[].
 * At runtime, toAgentDef() converts it into the standard AgentDef that all
 * downstream detection / snippet / UI code already understands.
 */

import fs from 'fs';
import path from 'path';
import { expandHome, MCP_AGENTS, parseJsonc } from './mcp-agents';
import type { AgentDef } from './mcp-agents';
import { readSettings, writeSettings } from './settings';

/* ─── Types ─── */

export interface CustomAgentDef {
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
  /** Skills directory path. Defaults to `baseDir + 'skills/'`. */
  skillDir?: string;
}

export interface DetectResult {
  exists: boolean;
  detectedConfig?: string;
  detectedFormat?: 'json' | 'toml';
  detectedConfigKey?: string;
  hasSkillsDir: boolean;
  detectedSkillDir?: string;
  skillCount?: number;
  skillNames?: string[];
  mcpServers?: string[];
  mcpParseError?: string;
  suggestedName?: string;
}

/* ─── Slugify ─── */

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');

  return slug || '';
}

/**
 * Generate a unique key from a name, avoiding collisions with built-in
 * and existing custom agents.
 */
export function generateUniqueKey(
  name: string,
  existingKeys: Set<string>,
): string {
  let base = slugify(name);

  if (!base) {
    let n = 1;
    while (existingKeys.has(`custom-${n}`)) n++;
    return `custom-${n}`;
  }

  if (!existingKeys.has(base)) return base;

  let n = 2;
  while (existingKeys.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/* ─── Defaults Inference ─── */

export function inferDefaults(name: string, baseDir: string): Omit<CustomAgentDef, 'key'> {
  const dir = baseDir.endsWith('/') ? baseDir : baseDir + '/';
  return {
    name,
    baseDir: dir,
    global: dir + 'mcp.json',
    project: null,
    configKey: 'mcpServers',
    format: 'json',
    preferredTransport: 'stdio',
    presenceDirs: [dir],
    skillDir: dir + 'skills/',
  };
}

/* ─── Auto-detection ─── */

export function detectBaseDir(baseDir: string): DetectResult {
  const expanded = expandHome(baseDir);

  if (!fs.existsSync(expanded)) {
    const dirName = path.basename(expanded.replace(/\/$/, ''));
    return {
      exists: false,
      hasSkillsDir: false,
      suggestedName: dirName.charAt(0).toUpperCase() + dirName.slice(1),
    };
  }

  const result: DetectResult = {
    exists: true,
    hasSkillsDir: false,
  };

  const dirName = path.basename(expanded.replace(/\/$/, ''));
  result.suggestedName = dirName.charAt(0).toUpperCase() + dirName.slice(1);

  // Check for skills/ subdirectory and scan contents
  const skillsPath = path.join(expanded, 'skills');
  if (fs.existsSync(skillsPath)) {
    result.hasSkillsDir = true;
    result.detectedSkillDir = baseDir.endsWith('/') ? baseDir + 'skills/' : baseDir + '/skills/';
    try {
      const skillEntries = fs.readdirSync(skillsPath, { withFileTypes: true });
      const skillNames = skillEntries
        .filter(e => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.'))
        .map(e => e.name)
        .sort((a, b) => a.localeCompare(b));
      result.skillCount = skillNames.length;
      result.skillNames = skillNames;
    } catch {
      result.skillCount = 0;
    }
  }

  // Scan top-level files (max 20)
  let entries: string[];
  try {
    entries = fs.readdirSync(expanded).slice(0, 20);
  } catch {
    return result;
  }

  // Try JSON files first
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(expanded, entry);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > 1_000_000) continue;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (raw && typeof raw === 'object') {
        if ('mcpServers' in raw) {
          result.detectedConfig = baseDir.endsWith('/') ? baseDir + entry : baseDir + '/' + entry;
          result.detectedFormat = 'json';
          result.detectedConfigKey = 'mcpServers';
          return result;
        }
        if ('servers' in raw) {
          result.detectedConfig = baseDir.endsWith('/') ? baseDir + entry : baseDir + '/' + entry;
          result.detectedFormat = 'json';
          result.detectedConfigKey = 'servers';
          return result;
        }
      }
    } catch { /* skip unparseable files */ }
  }

  // Try TOML files
  for (const entry of entries) {
    if (!entry.endsWith('.toml')) continue;
    const filePath = path.join(expanded, entry);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > 1_000_000) continue;
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n').slice(0, 50);
      for (const line of lines) {
        if (/^\s*\[mcp_servers/i.test(line) || /^\s*\[mcpServers/i.test(line)) {
          const lower = line.toLowerCase();
          const key = lower.includes('mcp_servers') ? 'mcp_servers' : 'mcpServers';
          result.detectedConfig = baseDir.endsWith('/') ? baseDir + entry : baseDir + '/' + entry;
          result.detectedFormat = 'toml';
          result.detectedConfigKey = key;
          return result;
        }
      }
    } catch { /* skip */ }
  }

  return result;
}

/* ─── AgentDef Conversion ─── */

/**
 * Convert a CustomAgentDef into the standard AgentDef that all downstream
 * code (detectInstalled, generateSnippet, etc.) expects.
 *
 * Note: AgentDef.key is the *config key* (e.g. "mcpServers"), not the agent identifier.
 * The agent identifier is the key in the MCP_AGENTS record, which comes from CustomAgentDef.key.
 */
export function toAgentDef(custom: CustomAgentDef): AgentDef {
  return {
    name: custom.name,
    project: custom.project ?? null,
    global: custom.global,
    key: custom.configKey,
    preferredTransport: custom.preferredTransport,
    format: custom.format,
    globalNestedKey: custom.globalNestedKey,
    presenceCli: custom.presenceCli,
    presenceDirs: custom.presenceDirs,
  };
}

/* ─── Persistence ─── */

export function loadCustomAgents(): CustomAgentDef[] {
  try {
    const settings = readSettings();
    const raw = settings.customAgents;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is CustomAgentDef => {
        if (item == null || typeof item !== 'object') return false;
        const obj = item as unknown as Record<string, unknown>;
        return typeof obj.name === 'string' && typeof obj.key === 'string' && typeof obj.baseDir === 'string';
      },
    );
  } catch {
    console.warn('[custom-agents] Failed to parse, using empty list');
    return [];
  }
}

export function saveCustomAgents(agents: CustomAgentDef[]): void {
  const settings = readSettings();
  settings.customAgents = agents;
  writeSettings(settings);
}

/* ─── Merged Registry ─── */

/**
 * Returns all agents (built-in + custom) as a Record<agentId, AgentDef>.
 * Built-in agents take priority on key collision.
 */
export function getAllAgents(): Record<string, AgentDef> {
  const result: Record<string, AgentDef> = { ...MCP_AGENTS };
  const customs = loadCustomAgents();

  for (const custom of customs) {
    if (custom.key in result) continue; // built-in priority
    result[custom.key] = toAgentDef(custom);
  }

  return result;
}

/* ─── Skill Scanning ─── */

/**
 * Scan skills installed in a custom agent's skill directory.
 * Returns the same shape as detectAgentInstalledSkills.
 */
export function scanCustomAgentSkills(custom: CustomAgentDef): { skills: string[]; sourcePath: string } {
  const skillDir = custom.skillDir || (custom.baseDir.endsWith('/') ? custom.baseDir + 'skills/' : custom.baseDir + '/skills/');
  const expanded = expandHome(skillDir);
  if (!fs.existsSync(expanded)) return { skills: [], sourcePath: expanded };
  try {
    const entries = fs.readdirSync(expanded, { withFileTypes: true });
    const skills = entries
      .filter(e => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
    return { skills, sourcePath: expanded };
  } catch {
    return { skills: [], sourcePath: expanded };
  }
}

/* ─── Enhanced Skill & MCP Detection ─── */

/**
 * Parse JSON config to extract MCP server names from a config key.
 */
function parseJsonMcpServers(content: string, key: string): string[] {
  try {
    const config = parseJsonc(content);
    const servers = config[key];
    if (servers && typeof servers === 'object') {
      return Object.keys(servers).sort();
    }
  } catch {
    return [];
  }
  return [];
}

/**
 * Parse TOML config to extract MCP server names from a section key.
 */
function parseTomlMcpServers(content: string, sectionKey: string): string[] {
  const names = new Set<string>();
  const lines = content.split('\n');
  const sectionPrefix = `${sectionKey}.`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const section = trimmed.slice(1, -1).trim();
      if (section.startsWith(sectionPrefix)) {
        const name = section.slice(sectionPrefix.length).split('.')[0];
        if (name) names.add(name);
      }
    }
  }

  return [...names].sort();
}

/**
 * Detect config format from file extension.
 */
function detectConfigFormat(configPath: string): 'json' | 'toml' {
  return configPath.toLowerCase().endsWith('.toml') ? 'toml' : 'json';
}

/**
 * Comprehensive profile detection for a custom agent.
 * Returns MCP servers, skills, and any parse errors.
 */
export function detectCustomAgentProfile(
  baseDir: string,
  configPath: string,
  configKey: string,
): {
  mcpServers: string[];
  skillNames: string[];
  skillDir: string;
  configFormat: 'json' | 'toml';
  parseError?: string;
} {
  const expanded = expandHome(baseDir);
  const configAbsPath = expandHome(configPath);

  const result = {
    mcpServers: [] as string[],
    skillNames: [] as string[],
    skillDir: '',
    configFormat: detectConfigFormat(configPath) as 'json' | 'toml',
    parseError: undefined as string | undefined,
  };

  // 1. Read MCP servers from config
  if (fs.existsSync(configAbsPath)) {
    try {
      const content = fs.readFileSync(configAbsPath, 'utf-8');
      result.mcpServers =
        result.configFormat === 'json'
          ? parseJsonMcpServers(content, configKey)
          : parseTomlMcpServers(content, configKey);
    } catch (err) {
      result.parseError = `Failed to parse MCP config: ${err instanceof Error ? err.message : 'Unknown error'}`;
    }
  }

  // 2. Scan Skill directory
  const skillDirPath = path.join(expanded, 'skills');
  if (fs.existsSync(skillDirPath)) {
    result.skillDir = baseDir.endsWith('/') ? baseDir + 'skills/' : baseDir + '/skills/';
    try {
      const entries = fs.readdirSync(skillDirPath, { withFileTypes: true });
      result.skillNames = entries
        .filter(e => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.'))
        .map(e => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      // Skill dir exists but not readable, continue
    }
  } else {
    result.skillDir = baseDir.endsWith('/') ? baseDir + 'skills/' : baseDir + '/skills/';
  }

  return result;
}

/* ─── Validation ─── */

export function validateCustomAgentInput(input: {
  name?: string;
  baseDir?: string;
  key?: string;
}, existingKeys: Set<string>, isEdit = false): string | null {
  if (!input.name || !input.name.trim()) {
    return 'Agent name is required';
  }

  if (!input.baseDir || !input.baseDir.trim()) {
    return 'Config directory is required';
  }

  const dir = input.baseDir.trim();
  if (!dir.startsWith('~/') && !dir.startsWith('/')) {
    if (process.platform === 'win32' && /^[A-Z]:\\/i.test(dir)) {
      // Windows absolute path — OK
    } else {
      return 'Must be an absolute path (e.g. ~/.qclaw/)';
    }
  }

  if (!isEdit) {
    const key = input.key || slugify(input.name.trim());
    if (!key) return 'Cannot generate a valid key from this name';
    if (key in MCP_AGENTS) {
      const builtIn = MCP_AGENTS[key];
      return `Conflicts with built-in agent "${builtIn.name}"`;
    }
    if (existingKeys.has(key)) {
      return `An agent with key "${key}" already exists`;
    }
  }

  return null;
}
