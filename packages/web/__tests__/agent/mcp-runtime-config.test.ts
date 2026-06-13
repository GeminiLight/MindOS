import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(PROJECT_ROOT, '..', '..');

let tempHome: string;
let previousHome: string | undefined;
let previousPiAgentDir: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-mcp-runtime-'));
  previousHome = process.env.HOME;
  previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.HOME = tempHome;
  delete process.env.PI_CODING_AGENT_DIR;
  vi.resetModules();
});

afterEach(() => {
  restoreEnv('HOME', previousHome);
  restoreEnv('PI_CODING_AGENT_DIR', previousPiAgentDir);
  fs.rmSync(tempHome, { recursive: true, force: true });
  vi.resetModules();
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

describe('MindOS Agent bounded MCP runtime config', () => {
  it('derives a runtime-only allowlist and strips imports from the user MCP config', async () => {
    const { createBoundedMindosAgentMcpConfig } = await import('@/lib/pi-integration/mcp-config');

    const bounded = createBoundedMindosAgentMcpConfig({
      imports: ['claude-code', 'codex'],
      settings: {
        toolPrefix: 'server',
        idleTimeout: 5,
        mindosAgent: {
          mcpServers: {
            github: ['search_code', 'get_issue'],
            linear: true,
            disabled: false,
          },
        },
      },
      mcpServers: {
        github: {
          command: 'github-mcp',
          env: { GITHUB_TOKEN: 'secret-token' },
          directTools: true,
        },
        linear: {
          url: 'https://mcp.linear.example/sse',
          mindosAgent: false,
        },
        localFiles: {
          command: 'filesystem-mcp',
        },
        crm: {
          url: 'https://crm.example/mcp',
          mindos: { agent: { enabled: true, tools: ['lookup_contact'] } },
        },
        disabled: {
          command: 'disabled-mcp',
        },
      },
    });

    expect(Object.keys(bounded.config.mcpServers)).toEqual(['github', 'linear', 'crm']);
    expect(bounded.config.imports).toBeUndefined();
    expect(bounded.config.mcpServers.github.directTools).toEqual(['search_code', 'get_issue']);
    expect(bounded.config.mcpServers.linear.directTools).toBe(true);
    expect(bounded.config.mcpServers.crm.directTools).toEqual(['lookup_contact']);
    expect(bounded.config.mcpServers.github.mindosAgent).toBeUndefined();
    expect(bounded.config.settings).toEqual({
      toolPrefix: 'server',
      idleTimeout: 5,
      disableProxyTool: true,
    });
    expect(bounded.serverPolicies).toEqual({
      github: ['search_code', 'get_issue'],
      linear: true,
      crm: ['lookup_contact'],
    });
  });

  it('writes a bounded runtime config and filtered metadata cache under the MindOS runtime directory', async () => {
    const sourceConfigPath = path.join(tempHome, '.mindos', 'mcp.json');
    writeJson(sourceConfigPath, {
      imports: ['claude-code'],
      settings: {
        mindosAgent: {
          mcpServers: {
            github: ['search_code'],
          },
        },
      },
      mcpServers: {
        github: {
          command: 'github-mcp',
        },
        linear: {
          command: 'linear-mcp',
          mindosAgent: true,
        },
      },
    });
    writeJson(path.join(tempHome, '.pi', 'agent', 'mcp-cache.json'), {
      version: 1,
      servers: {
        github: {
          configHash: 'hash-github',
          cachedAt: Date.now(),
          tools: [
            { name: 'search_code', description: 'Search code' },
            { name: 'delete_repo', description: 'Delete repository' },
          ],
          resources: [{ name: 'repo_secret', uri: 'secret://repo' }],
        },
        linear: {
          configHash: 'hash-linear',
          cachedAt: Date.now(),
          tools: [{ name: 'danger', description: 'Danger' }],
        },
      },
    });

    const { ensureMindosAgentMcpRuntimeConfig } = await import('@/lib/pi-integration/mcp-config');
    const runtimeConfig = ensureMindosAgentMcpRuntimeConfig();

    const runtimeConfigFile = JSON.parse(fs.readFileSync(runtimeConfig.configPath, 'utf-8'));
    expect(runtimeConfigFile.imports).toBeUndefined();
    expect(Object.keys(runtimeConfigFile.mcpServers)).toEqual(['github', 'linear']);
    expect(runtimeConfigFile.mcpServers.github.directTools).toEqual(['search_code']);
    expect(runtimeConfigFile.mcpServers.linear.directTools).toBe(true);

    const sandboxCachePath = path.join(runtimeConfig.sandboxHome, '.pi', 'agent', 'mcp-cache.json');
    const sandboxCache = JSON.parse(fs.readFileSync(sandboxCachePath, 'utf-8'));
    expect(Object.keys(sandboxCache.servers)).toEqual(['github', 'linear']);
    expect(sandboxCache.servers.github.tools).toEqual([{ name: 'search_code', description: 'Search code' }]);
    expect(sandboxCache.servers.github.resources).toEqual([]);
    expect(sandboxCache.servers.linear.tools).toEqual([{ name: 'danger', description: 'Danger' }]);
  });

  it('only loads the MindOS MCP wrapper in agent mode when at least one server is explicitly allowlisted', async () => {
    const { getMindosWebPiRuntimePaths } = await import('@/lib/agent/mindos-pi-runtime-host');
    const base = {
      projectRoot: REPO_ROOT,
      mindRoot: PROJECT_ROOT,
      serverSettings: {},
    };

    const withoutAllowlist = getMindosWebPiRuntimePaths({ ...base, mode: 'agent' });
    expect(withoutAllowlist.additionalExtensionPaths.join('\n')).not.toContain('pi-mcp-adapter');
    expect(withoutAllowlist.additionalExtensionPaths.join('\n')).not.toContain('mindos-mcp-adapter-extension');

    writeJson(path.join(tempHome, '.mindos', 'mcp.json'), {
      mcpServers: {
        github: {
          command: 'github-mcp',
          mindosAgent: ['search_code'],
        },
      },
    });

    const withAllowlist = getMindosWebPiRuntimePaths({ ...base, mode: 'agent' });
    const extensionList = withAllowlist.additionalExtensionPaths.join('\n');
    expect(extensionList).toContain('mindos-mcp-adapter-extension');
    expect(extensionList).not.toContain(path.join('node_modules', 'pi-mcp-adapter', 'index.ts'));

    const chatPaths = getMindosWebPiRuntimePaths({ ...base, mode: 'chat' });
    const organizePaths = getMindosWebPiRuntimePaths({ ...base, mode: 'organize' });
    expect(chatPaths.additionalExtensionPaths.join('\n')).not.toContain('mindos-mcp-adapter-extension');
    expect(organizePaths.additionalExtensionPaths.join('\n')).not.toContain('mindos-mcp-adapter-extension');
  });

  it('wraps the upstream proxy tool so tool-level MCP allowlists cannot be bypassed', async () => {
    writeJson(path.join(tempHome, '.mindos', 'mcp.json'), {
      mcpServers: {
        github: {
          command: 'github-mcp',
          mindosAgent: ['search_code'],
        },
      },
    });

    const loader = new DefaultResourceLoader({
      cwd: PROJECT_ROOT,
      agentDir: path.join(tempHome, '.pi-test'),
      settingsManager: SettingsManager.inMemory(),
      systemPrompt: '',
      appendSystemPrompt: [],
      additionalSkillPaths: [],
      additionalExtensionPaths: [path.join(PROJECT_ROOT, 'lib', 'agent', 'mindos-mcp-adapter-extension.ts')],
    });

    await loader.reload();
    const { extensions, errors } = loader.getExtensions();
    expect(errors).toEqual([]);
    const mcpExtension = extensions.find((extension) => extension.tools.has('mcp'));
    expect(mcpExtension).toBeDefined();
    const mcpTool = mcpExtension!.tools.get('mcp')!.definition as ToolDefinition & {
      execute: (toolCallId: string, params: unknown) => Promise<any>;
    };

    await expect(mcpTool.execute('tool-1', { tool: 'delete_repo', server: 'github' }))
      .resolves.toMatchObject({
        isError: true,
        details: { error: 'mcp_not_allowlisted' },
      });
    await expect(mcpTool.execute('tool-2', { tool: 'search_code' }))
      .resolves.toMatchObject({
        isError: true,
        details: { error: 'mcp_not_allowlisted' },
      });
    await expect(mcpTool.execute('tool-3', { search: 'repo' }))
      .resolves.toMatchObject({
        isError: true,
        details: { error: 'mcp_not_allowlisted' },
      });
  });
});
