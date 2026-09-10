import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentConfigDef, CustomAgentConfigDef, SkillAgentRegistration } from './types.js';

/**
 * Built-in agent registry: the single source for every downstream agent's
 * config location, presence probes and skill-install mode. The server
 * handlers import it directly; the CLI reads the same table through the
 * esbuild bundle `bin/lib/generated/agent-config.mjs`
 * (`scripts/build-cli-bundles.mjs`), so there is no hand-copied mirror to
 * keep in sync any more (`tests/agent-registry-contract.test.ts` pins it).
 */

function normalizeConfigRoot(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function winAppDataRoot(): string {
  return normalizeConfigRoot(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'));
}

function winLocalAppDataRoot(): string {
  return normalizeConfigRoot(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'));
}

function platformAppDataPath(options: { darwin: string; linux: string; win32: string }): string {
  if (process.platform === 'darwin') return options.darwin;
  if (process.platform === 'win32') return `${winAppDataRoot()}/${options.win32}`;
  return options.linux;
}

function platformLocalAppDataPath(options: { darwin: string; linux: string; win32: string }): string {
  if (process.platform === 'darwin') return options.darwin;
  if (process.platform === 'win32') return `${winLocalAppDataRoot()}/${options.win32}`;
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

export const DEFAULT_MCP_AGENTS: Record<string, AgentConfigDef> = {
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

export const DEFAULT_SKILL_AGENT_REGISTRY = {
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
  'kilo-code': { mode: 'universal' },
  'warp': { mode: 'universal' },
  'pi': { mode: 'additional', skillAgentName: 'pi' },
  'augment': { mode: 'additional', skillAgentName: 'augment' },
  'qwen-code': { mode: 'additional', skillAgentName: 'qwen-code' },
  'qoder': { mode: 'additional', skillAgentName: 'qoder' },
  'trae-cn': { mode: 'additional', skillAgentName: 'trae-cn' },
  'roo': { mode: 'additional', skillAgentName: 'roo' },
  'github-copilot': { mode: 'universal' },
  'codex': { mode: 'universal' },
  'antigravity': { mode: 'additional', skillAgentName: 'antigravity' },
  'qclaw': { mode: 'unsupported' },
  'workbuddy': { mode: 'unsupported' },
  'lingma': { mode: 'unsupported' },
  'copaw': { mode: 'unsupported' },
  'hermes': { mode: 'unsupported' },
} satisfies Record<string, SkillAgentRegistration>;

/** The MindOS self entry: rendered as a row in the UI, never a target of install / skill linking. */
export const MINDOS_SELF_AGENT_KEY = 'mindos';

export function createDefaultMcpAgents(): Record<string, AgentConfigDef> {
  return { ...DEFAULT_MCP_AGENTS };
}

export function createDefaultSkillAgentRegistry(): Record<string, SkillAgentRegistration> {
  return { ...DEFAULT_SKILL_AGENT_REGISTRY };
}

/** Built-in agents MindOS can be installed into (everything except the `mindos` self row); what the CLI iterates. */
export function listDownstreamAgentDefs(
  agents: Record<string, AgentConfigDef> = DEFAULT_MCP_AGENTS,
): Record<string, AgentConfigDef> {
  const downstream: Record<string, AgentConfigDef> = {};
  for (const [key, def] of Object.entries(agents)) {
    if (key !== MINDOS_SELF_AGENT_KEY) downstream[key] = def;
  }
  return downstream;
}

/**
 * A user-registered agent as a registry definition, so custom agents run
 * through exactly the same adapter as built-ins. `key` on the definition is
 * the servers-map key (`mcpServers`), not the agent identifier.
 */
export function customAgentToConfigDef(custom: CustomAgentConfigDef): AgentConfigDef {
  return {
    name: custom.name,
    project: custom.project ?? null,
    global: custom.global,
    key: custom.configKey,
    preferredTransport: custom.preferredTransport,
    format: custom.format,
    globalNestedKey: custom.globalNestedKey,
    entryStyle: custom.entryStyle,
    presenceCli: custom.presenceCli,
    presenceDirs: custom.presenceDirs,
    skillDir: custom.skillDir,
  };
}

/** Default skill directory of a custom agent: its explicit `skillDir`, else `<baseDir>/skills/`. */
export function customAgentSkillDir(custom: CustomAgentConfigDef): string {
  if (custom.skillDir) return custom.skillDir;
  return custom.baseDir.endsWith('/') || custom.baseDir.endsWith('\\')
    ? `${custom.baseDir}skills/`
    : `${custom.baseDir}/skills/`;
}
