/**
 * Shared MCP agent definitions for CLI tools.
 *
 * ⚠️  KEEP IN SYNC WITH:
 *   - packages/web/lib/mcp-agents.ts     (TypeScript source of truth)
 *   - packages/mindos/bin/lib/toml.js    (TOML format support for agents with format: 'toml')
 *   - packages/web/app/api/mcp/install/route.ts (server-side install with TOML merge)
 *
 * Each agent entry includes presenceCli / presenceDirs for detecting
 * whether the agent is installed on the user's machine. To add a new
 * agent, add a single entry here — no separate table needed.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, normalize, resolve } from 'node:path';
import { expandHome } from './path-expand.js';
import { parseJsonc } from './jsonc.js';

function winAppData(...segments) {
  const appData = process.env.APPDATA || resolve(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return resolve(appData, ...segments);
}

function winLocalAppData(...segments) {
  const localAppData = process.env.LOCALAPPDATA || resolve(process.env.USERPROFILE || '', 'AppData', 'Local');
  return resolve(localAppData, ...segments);
}

const warpStableStateRoot = process.platform === 'darwin'
  ? '~/Library/Group Containers/2BBY89MBSN.dev.warp/Library/Application Support/dev.warp.Warp-Stable/'
  : process.platform === 'win32'
    ? winLocalAppData('warp', 'Warp', 'data')
    : '~/.local/state/warp-terminal/';

const warpPreviewStateRoot = process.platform === 'darwin'
  ? '~/Library/Group Containers/2BBY89MBSN.dev.warp/Library/Application Support/dev.warp.Warp-Preview/'
  : process.platform === 'win32'
    ? winLocalAppData('warp', 'WarpPreview', 'data')
    : '~/.local/state/warp-terminal-preview/';

const warpConfigRoot = process.platform === 'darwin'
  ? '~/.warp/'
  : process.platform === 'win32'
    ? winLocalAppData('warp', 'Warp', 'config')
    : '~/.config/warp-terminal/';

const warpDataRoot = process.platform === 'darwin'
  ? '~/.warp/'
  : process.platform === 'win32'
    ? winAppData('warp', 'Warp', 'data')
    : '~/.local/share/warp-terminal/';

export const MCP_AGENTS = {
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
    global: process.platform === 'darwin'
      ? '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'
      : process.platform === 'win32'
        ? winAppData('Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')
        : '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: [
      '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/',
      '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/',
      ...(process.platform === 'win32' ? [winAppData('Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev')] : []),
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
      warpStableStateRoot,
      warpPreviewStateRoot,
      warpConfigRoot,
      warpDataRoot,
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
    global: process.platform === 'darwin'
      ? '~/Library/Application Support/Trae CN/User/mcp.json'
      : process.platform === 'win32'
        ? winAppData('Trae CN', 'User', 'mcp.json')
        : '~/.config/Trae CN/User/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'trae-cli',
    presenceDirs: [
      '~/Library/Application Support/Trae CN/',
      '~/.config/Trae CN/',
      ...(process.platform === 'win32' ? [winAppData('Trae CN')] : []),
    ],
  },
  'roo': {
    name: 'Roo Code',
    project: '.roo/mcp.json',
    global: process.platform === 'darwin'
      ? '~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json'
      : process.platform === 'win32'
        ? winAppData('Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json')
        : '~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: [
      '~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/',
      '~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/',
      ...(process.platform === 'win32' ? [winAppData('Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline')] : []),
    ],
  },
  'github-copilot': {
    name: 'GitHub Copilot',
    project: '.vscode/mcp.json',
    global: process.platform === 'darwin'
      ? '~/Library/Application Support/Code/User/mcp.json'
      : process.platform === 'win32'
        ? winAppData('Code', 'User', 'mcp.json')
        : '~/.config/Code/User/mcp.json',
    key: 'servers',
    preferredTransport: 'stdio',
    presenceDirs: [
      '~/Library/Application Support/Code/',
      '~/.config/Code/',
      ...(process.platform === 'win32' ? [winAppData('Code')] : []),
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

/**
 * Skill-install registry keyed by MCP agent key.
 * Keep in sync with packages/web/lib/mcp-agents.ts.
 */
export const SKILL_AGENT_REGISTRY = {
  'claude-code': { mode: 'additional', skillAgentName: 'claude-code' },
  'cursor': { mode: 'universal' },
  'windsurf': { mode: 'additional', skillAgentName: 'windsurf' },
  'cline': { mode: 'universal' },
  'trae': { mode: 'additional', skillAgentName: 'trae' },
  'gemini-cli': { mode: 'universal' },
  'openclaw': { mode: 'additional', skillAgentName: 'openclaw' },
  'codebuddy': { mode: 'additional', skillAgentName: 'codebuddy' },
  'kimi-cli': { mode: 'universal' },
  'opencode': { mode: 'universal' },
  'pi': { mode: 'additional', skillAgentName: 'pi' },
  'augment': { mode: 'additional', skillAgentName: 'augment' },
  'qwen-code': { mode: 'additional', skillAgentName: 'qwen-code' },
  'qoder': { mode: 'additional', skillAgentName: 'qoder' },
  'trae-cn': { mode: 'additional', skillAgentName: 'trae-cn' },
  'roo': { mode: 'additional', skillAgentName: 'roo' },
  'github-copilot': { mode: 'universal' },
  'codex': { mode: 'universal' },
  'kilo-code': { mode: 'universal' },
  'warp': { mode: 'universal' },
  'antigravity': { mode: 'additional', skillAgentName: 'antigravity' },
  'qclaw': { mode: 'unsupported' },
  'workbuddy': { mode: 'unsupported' },
  'lingma': { mode: 'unsupported' },
  'copaw': { mode: 'unsupported' },
  'hermes': { mode: 'unsupported' },
};

function readNestedRecord(obj, nestedPath) {
  let current = obj;
  for (const part of nestedPath.split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return null;
    current = current[part];
  }
  return current && typeof current === 'object' ? current : null;
}

function readOwnRecord(obj, key) {
  if (!obj || typeof obj !== 'object' || !Object.prototype.hasOwnProperty.call(obj, key)) return null;
  const value = obj[key];
  return value && typeof value === 'object' ? value : null;
}

function parseYamlServerNames(content, sectionKey) {
  const names = [];
  let inSection = false;
  let baseIndent = -1;
  for (const line of content.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (indent === 0 && trimmed.startsWith(sectionKey + ':')) {
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
    if (indent === baseIndent) {
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:/);
      if (match) names.push(match[1]);
    }
  }
  return names;
}

function parseTomlServerNames(content, sectionKey) {
  const names = new Set();
  const sectionPrefix = `${sectionKey}.`;
  let inRootSection = false;
  for (const line of content.split('\n')) {
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
    const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=/);
    if (match) names.add(match[1]);
  }
  return [...names];
}

function configPathCandidates(agent, scope) {
  const primary = scope === 'global' ? agent.global : agent.project;
  const readAlso = scope === 'global' ? agent.globalReadAlso : agent.projectReadAlso;
  return [primary, ...(readAlso ?? [])].filter(Boolean);
}

function configFileLooksMindosManagedOnly(filePath, agent) {
  const managedGlobalPaths = configPathCandidates(agent, 'global').map(candidate => normalize(expandHome(candidate)));
  if (!managedGlobalPaths.includes(normalize(filePath))) return false;

  let content = '';
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return false;
  }
  if (!content.trim()) return true;

  try {
    if (agent.format === 'toml') {
      const names = parseTomlServerNames(content, agent.key);
      return names.length === 0 || names.every(name => name === 'mindos');
    }
    if (agent.format === 'yaml') {
      const names = parseYamlServerNames(content, agent.key);
      return names.length === 0 || names.every(name => name === 'mindos');
    }

    const parsed = parseJsonc(content);
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

    let cursor = parsed;
    for (const part of agent.globalNestedKey.split('.').filter(Boolean)) {
      if (!cursor || Object.keys(cursor).some(key => key !== part)) return false;
      cursor = cursor[part] && typeof cursor[part] === 'object' ? cursor[part] : null;
    }
    return true;
  } catch {
    return false;
  }
}

function presencePathHasAgentSignal(candidatePath, agent) {
  if (!existsSync(candidatePath)) return false;
  let stat;
  try {
    stat = statSync(candidatePath);
  } catch {
    return true;
  }
  if (stat.isFile()) return !configFileLooksMindosManagedOnly(candidatePath, agent);
  if (!stat.isDirectory()) return true;

  let entries = [];
  try {
    entries = readdirSync(candidatePath, { withFileTypes: true });
  } catch {
    return true;
  }
  if (entries.length === 0) return false;

  const ignored = new Set(['.DS_Store', 'skills']);
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const entryPath = join(candidatePath, entry.name);
    if (entry.isFile() && configFileLooksMindosManagedOnly(entryPath, agent)) continue;
    return true;
  }
  return false;
}

export function detectAgentPresence(agentKey) {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return false;
  if (agent.presenceCli) {
    try {
      execFileSync(process.platform === 'win32' ? 'where' : 'which', [agent.presenceCli], { stdio: 'pipe' });
      return true;
    } catch { /* not found */ }
  }
  if (agent.presenceDirs?.some(d => {
    // Paths from winAppData() are already absolute; expandHome only handles ~/
    try { return presencePathHasAgentSignal(d.startsWith('~') ? expandHome(d) : d, agent); } catch { return false; }
  })) return true;
  return false;
}
