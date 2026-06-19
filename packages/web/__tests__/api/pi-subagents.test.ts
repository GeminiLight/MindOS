/**
 * Tests for built-in pi-subagents extension support.
 *
 * Verifies that MindOS correctly bundles and loads pi-subagents as a default
 * extension, providing the subagent control tool to the Agent.
 */

import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { resetAgentRunsForTest } from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  buildMindosPiChildRuntimeConfig,
  MINDOS_PI_CHILD_API_KEY_ENV,
  PI_CODING_AGENT_DIR_ENV,
} from '../../lib/agent/subagent-ledger-extension';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
let tempHomeToClean: string | null = null;

afterEach(() => {
  if (tempHomeToClean) {
    fs.rmSync(tempHomeToClean, { recursive: true, force: true });
    tempHomeToClean = null;
  }
});

describe('pi-subagents built-in extension', () => {
  describe('dependency installation', () => {
    it('pi-subagents is listed in package.json dependencies', () => {
      const pkgPath = path.join(PROJECT_ROOT, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

      expect(pkg.dependencies).not.toHaveProperty('@mariozechner/pi-agent-core');
      expect(pkg.dependencies).not.toHaveProperty('@mariozechner/pi-ai');
      expect(pkg.dependencies).not.toHaveProperty('@mariozechner/pi-coding-agent');
      expect(pkg.dependencies).toHaveProperty('@earendil-works/pi-agent-core');
      expect(pkg.dependencies).toHaveProperty('@earendil-works/pi-ai');
      expect(pkg.dependencies).toHaveProperty('@earendil-works/pi-coding-agent');
      expect(pkg.dependencies).toHaveProperty('pi-subagents');
      expect(pkg.dependencies['pi-subagents']).toMatch(/^\^?0\.\d+\.\d+$/);
    });

    it('pi-subagents is installed in node_modules', () => {
      const indexPath = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents', 'src', 'extension', 'index.ts');
      expect(fs.existsSync(indexPath)).toBe(true);
    });

    it('pi-subagents has expected structure (agents directory)', () => {
      const agentsDir = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents', 'agents');
      expect(fs.existsSync(agentsDir)).toBe(true);

      // Should have builtin agents like scout.md, planner.md
      const agentFiles = fs.readdirSync(agentsDir);
      expect(agentFiles.some((f) => f.endsWith('.md'))).toBe(true);
    });
  });

  describe('extension path registration', () => {
    let runtimeAdapterContent: string;

    beforeAll(() => {
      const adapterPath = path.join(PROJECT_ROOT, 'lib', 'agent', 'mindos-pi-runtime-host.ts');
      runtimeAdapterContent = fs.readFileSync(adapterPath, 'utf-8');
    });

    it('runtime adapter loads the MindOS subagent ledger wrapper instead of upstream directly', () => {
      expect(runtimeAdapterContent).toContain("resolveMindosWebRuntimeSourcePath(webAppDir, 'lib', 'agent', 'subagent-ledger-extension.ts')");
      expect(runtimeAdapterContent).not.toContain("path.join(webAppDir, 'node_modules', 'pi-subagents', 'src', 'extension', 'index.ts')");
    });

    it('runtime adapter preserves the built-in schedule-prompt extension from the legacy app', () => {
      expect(runtimeAdapterContent).toContain('schedule-prompt');
      expect(runtimeAdapterContent).toContain("resolveMindosWebRuntimeSourcePath(webAppDir, 'lib', 'schedule-prompt', 'index.ts')");
    });

    it('runtime adapter loads the MindOS MCP wrapper instead of upstream pi-mcp-adapter directly', () => {
      expect(runtimeAdapterContent).toContain('mindos-mcp-adapter-extension.ts');
      expect(runtimeAdapterContent).toContain("resolveMindosWebRuntimeSourcePath(webAppDir, 'lib', 'agent', 'mindos-mcp-adapter-extension.ts')");
      expect(runtimeAdapterContent).not.toContain("path.join(webAppDir, 'node_modules', 'pi-mcp-adapter', 'index.ts')");
    });

    it('pi-subagents path is after user extensions (scanExtensionPaths)', () => {
      // User extensions should have priority, so scanExtensionPaths() comes first
      const scanIndex = runtimeAdapterContent.indexOf('scanExtensionPaths()');
      const subagentsIndex = runtimeAdapterContent.indexOf('subagent-ledger-extension');

      expect(scanIndex).toBeGreaterThan(-1);
      expect(subagentsIndex).toBeGreaterThan(scanIndex);
    });

    it('derives extension exposure from PermissionPolicy tool scope and bounded MCP allowlist for every ask mode', async () => {
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-pi-subagents-home-'));
      tempHomeToClean = tempHome;
      const previousHome = process.env.HOME;
      process.env.HOME = tempHome;
      vi.resetModules();
      try {
        const { getMindosWebPiRuntimePaths } = await import('@/lib/agent/mindos-pi-runtime-host');
        const { createMindosAgentPermissionPolicy } = await import('@geminilight/mindos/agent/tool/permission-policy');
        const base = {
          projectRoot: path.resolve(PROJECT_ROOT, '..', '..'),
          mindRoot: PROJECT_ROOT,
          serverSettings: {},
        };

        const readonlyPaths = getMindosWebPiRuntimePaths({
          ...base,
          mode: 'agent',
          permissionPolicy: createMindosAgentPermissionPolicy('readonly'),
        });
        const readonlyExtensionList = readonlyPaths.additionalExtensionPaths.join('\n');
        expect(readonlyExtensionList).toContain('kb-extension');
        expect(readonlyExtensionList).toContain('ask-user-question-bridge-extension');
        expect(readonlyExtensionList).toContain('pi-web-access');
        expect(readonlyExtensionList).not.toContain('pi-mcp-adapter');
        expect(readonlyExtensionList).not.toContain('subagent-ledger-extension');
        expect(readonlyExtensionList).not.toContain(path.join('lib', 'im', 'index.ts'));
        expect(readonlyExtensionList).not.toContain('schedule-prompt');

        const organizePaths = getMindosWebPiRuntimePaths({ ...base, mode: 'organize' });
        const organizeExtensionList = organizePaths.additionalExtensionPaths.join('\n');
        expect(organizeExtensionList).toContain('kb-extension');
        expect(organizeExtensionList).toContain('pi-web-access');
        expect(organizeExtensionList).not.toContain('pi-mcp-adapter');
        expect(organizeExtensionList).not.toContain('subagent-ledger-extension');
        expect(organizeExtensionList).not.toContain(path.join('lib', 'im', 'index.ts'));
        expect(organizeExtensionList).not.toContain('schedule-prompt');

        const agentPaths = getMindosWebPiRuntimePaths({ ...base, mode: 'agent' });
        const agentExtensionList = agentPaths.additionalExtensionPaths.join('\n');
        expect(agentExtensionList).toContain('kb-extension');
        expect(agentExtensionList).toContain('pi-web-access');
        expect(agentExtensionList).not.toContain('pi-mcp-adapter');
        expect(agentExtensionList).not.toContain('mindos-mcp-adapter-extension');
        expect(agentExtensionList).toContain('subagent-ledger-extension');
        expect(agentExtensionList).toContain(path.join('lib', 'im', 'index.ts'));
        expect(agentExtensionList).toContain('schedule-prompt');

        fs.mkdirSync(path.join(tempHome, '.mindos'), { recursive: true });
        fs.writeFileSync(path.join(tempHome, '.mindos', 'mcp.json'), JSON.stringify({
          mcpServers: {
            github: {
              command: 'github-mcp',
              mindosAgent: ['search_code'],
            },
          },
        }), 'utf-8');
        const agentWithMcpPaths = getMindosWebPiRuntimePaths({ ...base, mode: 'agent' });
        const agentWithMcpExtensionList = agentWithMcpPaths.additionalExtensionPaths.join('\n');
        expect(agentWithMcpExtensionList).toContain('mindos-mcp-adapter-extension');
        expect(agentWithMcpExtensionList).not.toContain(path.join('node_modules', 'pi-mcp-adapter', 'index.ts'));
      } finally {
        if (previousHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = previousHome;
        }
        vi.resetModules();
      }
    });
  });

  describe('extension exports', () => {
    it('pi-subagents index.ts is valid TypeScript with default export', async () => {
      const indexPath = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents', 'src', 'extension', 'index.ts');
      const content = fs.readFileSync(indexPath, 'utf-8');

      // Extension should have a default export function
      expect(content).toMatch(/export\s+default\s+function/);
    });

    it('pi-subagents registers subagent tool via pi.registerTool', async () => {
      const indexPath = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents', 'src', 'extension', 'index.ts');
      const content = fs.readFileSync(indexPath, 'utf-8');

      // Should call pi.registerTool with the subagent tool
      expect(content).toContain('pi.registerTool');
      // Should have tool definition for 'subagent'
      expect(content).toMatch(/name:\s*['"]subagent['"]/);
    });
  });

  describe('runtime extension loading (integration)', () => {
    it('DefaultResourceLoader loads pi-subagents and exposes subagent tools', async () => {
      // This test mirrors the actual loading path used by /api/ask
      const settingsManager = SettingsManager.inMemory();
      const piSubagentsPath = path.join(PROJECT_ROOT, 'lib', 'agent', 'subagent-ledger-extension.ts');

      const loader = new DefaultResourceLoader({
        cwd: PROJECT_ROOT,
        agentDir: path.join(PROJECT_ROOT, '.pi-test'),
        settingsManager,
        systemPrompt: '',
        appendSystemPrompt: [],
        additionalSkillPaths: [],
        additionalExtensionPaths: [piSubagentsPath],
      });

      await loader.reload();
      const { extensions, errors } = loader.getExtensions();

      expect(errors).toEqual([]);

      // The loader may attribute tools to the wrapped upstream extension; the
      // product contract is that loading the MindOS wrapper exposes subagent.
      const subagentsExt = extensions.find((ext) => ext.tools.has('subagent'));

      expect(subagentsExt).toBeDefined();

      // Verify tools are registered
      const toolNames = [...subagentsExt!.tools.keys()];
      expect(toolNames).toContain('subagent');
    });

    it('subagent tool is registered and available', async () => {
      const settingsManager = SettingsManager.inMemory();
      const piSubagentsPath = path.join(PROJECT_ROOT, 'lib', 'agent', 'subagent-ledger-extension.ts');

      const loader = new DefaultResourceLoader({
        cwd: PROJECT_ROOT,
        agentDir: path.join(PROJECT_ROOT, '.pi-test'),
        settingsManager,
        systemPrompt: '',
        appendSystemPrompt: [],
        additionalSkillPaths: [],
        additionalExtensionPaths: [piSubagentsPath],
      });

      await loader.reload();
      const { extensions, errors } = loader.getExtensions();

      expect(errors).toEqual([]);
      const subagentsExt = extensions.find((ext) => ext.tools.has('subagent'));

      expect(subagentsExt).toBeDefined();

      // Both tools should be registered in the tools Map
      const subagentTool = subagentsExt!.tools.get('subagent');

      expect(subagentTool).toBeDefined();

      // pi-subagents 0.28 folds status checks into subagent({ action: "status" }).
      expect(subagentsExt!.tools.size).toBeGreaterThanOrEqual(1);
    });

    it('executes action=list through the MindOS wrapper and exposes executable subagents', async () => {
      resetAgentRunsForTest();
      const settingsManager = SettingsManager.inMemory();
      const piSubagentsPath = path.join(PROJECT_ROOT, 'lib', 'agent', 'subagent-ledger-extension.ts');

      const loader = new DefaultResourceLoader({
        cwd: PROJECT_ROOT,
        agentDir: path.join(PROJECT_ROOT, '.pi-test'),
        settingsManager,
        systemPrompt: '',
        appendSystemPrompt: [],
        additionalSkillPaths: [],
        additionalExtensionPaths: [piSubagentsPath],
      });

      await loader.reload();
      const { extensions, errors } = loader.getExtensions();

      expect(errors).toEqual([]);
      const subagentsExt = extensions.find((ext) => ext.tools.has('subagent'));
      const subagentTool = subagentsExt?.tools.get('subagent')?.definition as {
        execute: (
          toolCallId: string,
          params: unknown,
          signal?: AbortSignal,
          onUpdate?: unknown,
          ctx?: unknown,
        ) => Promise<any>;
      } | undefined;

      expect(subagentTool).toBeDefined();

      const result = await subagentTool!.execute(
        'subagent-list-smoke',
        { action: 'list' },
        new AbortController().signal,
        undefined,
        {
          cwd: PROJECT_ROOT,
          hasUI: false,
          sessionManager: {
            getSessionFile: () => undefined,
            getSessionId: () => 'subagent-list-smoke-session',
          },
          ui: {
            setToolsExpanded: () => undefined,
            requestRender: () => undefined,
          },
        },
      );
      const text = result.content
        .filter((part: any) => part?.type === 'text')
        .map((part: any) => part.text)
        .join('\n');

      expect(result.isError).not.toBe(true);
      expect(text).toContain('Executable agents:');
      expect(text).toMatch(/- reviewer \(builtin/);
      expect(text).toMatch(/- researcher \(builtin/);
    });

    it('builds child pi runtime config from MindOS provider settings without writing raw keys to models.json', () => {
      const runtimeConfig = buildMindosPiChildRuntimeConfig({
        provider: 'openai',
        modelName: 'step-3.7-flash',
        apiKey: 'sk-test-secret',
        baseUrl: 'https://gateway.example/v1',
        model: {
          id: 'step-3.7-flash',
          name: 'step-3.7-flash',
          provider: 'openai',
          api: 'openai-completions',
          baseUrl: 'https://gateway.example/v1',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
          compat: { supportsDeveloperRole: false },
        },
      });

      expect(runtimeConfig).not.toBeNull();
      expect(runtimeConfig!.env[MINDOS_PI_CHILD_API_KEY_ENV]).toBe('sk-test-secret');
      expect(runtimeConfig!.env[PI_CODING_AGENT_DIR_ENV]).toContain('mindos-pi-child-runtime-');
      expect(runtimeConfig!.settingsJson).toEqual({
        defaultProvider: 'openai',
        defaultModel: 'step-3.7-flash',
      });
      expect(runtimeConfig!.modelsJson).toEqual({
        providers: {
          openai: {
            apiKey: `$${MINDOS_PI_CHILD_API_KEY_ENV}`,
            baseUrl: 'https://gateway.example/v1',
            api: 'openai-completions',
            models: [
              expect.objectContaining({
                id: 'step-3.7-flash',
                api: 'openai-completions',
                baseUrl: 'https://gateway.example/v1',
                compat: { supportsDeveloperRole: false },
              }),
            ],
          },
        },
      });
      expect(JSON.stringify(runtimeConfig!.modelsJson)).not.toContain('sk-test-secret');
    });
  });
});
