import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MindosMcpAgentRegistryDef } from './handlers/mcp-agents.js';

function normalizeConfigRoot(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function winAppDataRoot(): string {
  return normalizeConfigRoot(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'));
}

function platformAppDataPath(options: { darwin: string; linux: string; win32: string }): string {
  if (process.platform === 'darwin') return options.darwin;
  if (process.platform === 'win32') return `${winAppDataRoot()}/${options.win32}`;
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

export const DEFAULT_MCP_AGENTS: Record<string, MindosMcpAgentRegistryDef> = {
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
    presenceDirs: [`${codeUserRoot}/globalStorage/saoudrizwan.claude-dev/`],
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
    global: `${traeCnRoot}/User/mcp.json`,
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'trae-cli',
    presenceDirs: [`${traeCnRoot}/`],
  },
  'roo': {
    name: 'Roo Code',
    project: '.roo/mcp.json',
    global: `${codeUserRoot}/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`,
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: [`${codeUserRoot}/globalStorage/rooveterinaryinc.roo-cline/`],
  },
  'github-copilot': {
    name: 'GitHub Copilot',
    project: '.vscode/mcp.json',
    global: `${codeUserRoot}/mcp.json`,
    key: 'servers',
    preferredTransport: 'stdio',
    presenceDirs: [`${codeRoot}/`],
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

export function createDefaultMcpAgents(): Record<string, MindosMcpAgentRegistryDef> {
  return { ...DEFAULT_MCP_AGENTS };
}
