/**
 * Shared MCP agent definitions for CLI tools.
 * Mirrors app/lib/mcp-agents.ts — keep in sync manually.
 *
 * Each agent entry includes presenceCli / presenceDirs for detecting
 * whether the agent is installed on the user's machine. To add a new
 * agent, add a single entry here — no separate table needed.
 */

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expandHome } from './path-expand.js';

function winAppData(...segments) {
  const appData = process.env.APPDATA || resolve(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return resolve(appData, ...segments);
}

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
};

/**
 * Skill-install registry keyed by MCP agent key.
 * Keep in sync with app/lib/mcp-agents.ts.
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
  'iflow-cli': { mode: 'additional', skillAgentName: 'iflow-cli' },
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
};

export function detectAgentPresence(agentKey) {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return false;
  if (agent.presenceCli) {
    try {
      execSync(
        process.platform === 'win32' ? `where ${agent.presenceCli}` : `which ${agent.presenceCli}`,
        { stdio: 'pipe' },
      );
      return true;
    } catch { /* not found */ }
  }
  if (agent.presenceDirs?.some(d => {
    // Paths from winAppData() are already absolute; expandHome only handles ~/
    try { return existsSync(d.startsWith('~') ? expandHome(d) : d); } catch { return false; }
  })) return true;
  return false;
}
