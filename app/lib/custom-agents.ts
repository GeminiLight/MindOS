/**
 * Custom Agent registration: types, slugify, defaults inference, and persistence.
 *
 * CustomAgentDef is stored in config.json.customAgents[].
 * At runtime, toAgentDef() converts it into the standard AgentDef that all
 * downstream detection / snippet / UI code already understands.
 */

import fs from 'fs';
import path from 'path';
import { expandHome, MCP_AGENTS } from './mcp-agents';
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
}

export interface DetectResult {
  exists: boolean;
  detectedConfig?: string;
  detectedFormat?: 'json' | 'toml';
  detectedConfigKey?: string;
  hasSkillsDir: boolean;
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

  // Check for skills/ subdirectory
  result.hasSkillsDir = fs.existsSync(path.join(expanded, 'skills'));

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
