import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectAgentConfiguredMcpServersFromConfigs,
  detectAgentInstalledFromConfigs,
  handleMcpAgentsGet,
  type MindosCustomMcpAgentDef,
  type MindosMcpAgentProfile,
  type MindosMcpAgentRegistryDef,
} from './mcp-agents.js';

const codex: MindosMcpAgentRegistryDef = {
  name: 'Codex',
  project: null,
  global: '~/.codex/config.toml',
  key: 'mcp_servers',
  format: 'toml',
  preferredTransport: 'stdio',
  presenceCli: 'codex',
  presenceDirs: ['~/.codex/'],
};

const claude: MindosMcpAgentRegistryDef = {
  name: 'Claude Code',
  project: '.mcp.json',
  global: '~/.claude.json',
  key: 'mcpServers',
  preferredTransport: 'stdio',
  presenceDirs: ['~/.claude/'],
};

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'mindos-mcp-agents-'));
}

async function profiles(services: Parameters<typeof handleMcpAgentsGet>[0]): Promise<MindosMcpAgentProfile[]> {
  const response = await handleMcpAgentsGet(services);
  expect(response.status).toBe(200);
  return (response.body as { agents: MindosMcpAgentProfile[] }).agents;
}

describe('MCP agent install detection through the shared config readers', () => {
  it('reports a Codex-native command-only table as installed over stdio', async () => {
    const home = tempHome();
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'config.toml'), 'model = "o3"\n\n[mcp_servers.mindos]\ncommand = "mindos"\nargs = ["mcp"]\n', 'utf-8');

    const [profile] = await profiles({ agents: { codex }, homeDir: home, commandExists: () => false });
    expect(profile).toMatchObject({
      key: 'codex',
      installed: true,
      scope: 'global',
      transport: 'stdio',
      configPath: '~/.codex/config.toml',
      configuredMcpServers: ['mindos'],
      configuredMcpSources: ['global:~/.codex/config.toml'],
    });
  });

  it('lists inline and table servers of a TOML config together', () => {
    const home = tempHome();
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'config.toml'), '[mcp_servers]\ninline = { command = "x" }\n\n[mcp_servers.mindos]\ncommand = "mindos"\n', 'utf-8');

    expect(detectAgentConfiguredMcpServersFromConfigs(codex, { homeDir: home })).toEqual({
      servers: ['inline', 'mindos'],
      sources: ['global:~/.codex/config.toml'],
    });
  });

  it('detects a TOML custom agent as installed instead of failing JSON.parse', async () => {
    const home = tempHome();
    mkdirSync(join(home, '.myagent'), { recursive: true });
    writeFileSync(join(home, '.myagent', 'config.toml'), '[mcp_servers.mindos]\nurl = "http://127.0.0.1:8781/mcp"\n', 'utf-8');
    const custom: MindosCustomMcpAgentDef = {
      name: 'My Agent',
      key: 'my-agent',
      baseDir: '~/.myagent/',
      global: '~/.myagent/config.toml',
      configKey: 'mcp_servers',
      format: 'toml',
      preferredTransport: 'stdio',
      presenceDirs: ['~/.myagent/'],
    };
    const registryDef: MindosMcpAgentRegistryDef = {
      name: custom.name,
      project: null,
      global: custom.global,
      key: custom.configKey,
      format: custom.format,
      preferredTransport: custom.preferredTransport,
      presenceDirs: custom.presenceDirs,
    };

    const [profile] = await profiles({
      agents: { 'my-agent': registryDef },
      builtInAgents: {},
      customAgents: [custom],
      homeDir: home,
      commandExists: () => false,
      fetchHead: async () => ({ status: 200 }),
    });
    expect(profile).toMatchObject({
      key: 'my-agent',
      isCustom: true,
      installed: true,
      scope: 'global',
      transport: 'http',
      url: 'http://127.0.0.1:8781/mcp',
      configuredMcpServers: ['mindos'],
    });
  });

  it('resolves relative project configs under services.projectRoot and skips them without a root', () => {
    const home = tempHome();
    const root = mkdtempSync(join(tmpdir(), 'mindos-mcp-agents-root-'));
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { mindos: { command: 'mindos' } } }), 'utf-8');

    expect(detectAgentInstalledFromConfigs(claude, { homeDir: home, projectRoot: root })).toMatchObject({
      installed: true,
      scope: 'project',
      transport: 'stdio',
      configPath: '.mcp.json',
    });
    expect(detectAgentInstalledFromConfigs(claude, { homeDir: home })).toEqual({ installed: false });
    expect(detectAgentConfiguredMcpServersFromConfigs(claude, { homeDir: home })).toEqual({ servers: [], sources: [] });
  });
});
