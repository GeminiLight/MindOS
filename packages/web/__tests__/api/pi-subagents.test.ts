/**
 * Tests for built-in pi-subagents extension support.
 *
 * Verifies that MindOS correctly bundles and loads pi-subagents as a default
 * extension, providing the subagent control tool to the Agent.
 */

import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolveUpstreamSubagentEntry } from '@/lib/agent/subagent-extension-entry';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { resetAgentRunsForTest } from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  buildMindosPiChildRuntimeConfig,
  collectInheritedSubagentExtensionPaths,
  ensureMindosPiChildRuntimeDir,
  MINDOS_PI_CHILD_CLI_PATH_ENV,
  MINDOS_PI_CHILD_API_KEY_ENV,
  MINDOS_PI_CHILD_EXTENSION_PATHS_ENV,
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
      expect(pkg.dependencies['pi-subagents']).toMatch(/^\^?\d+\.\d+\.\d+$/);
    });

    it('pi-subagents is installed and declares a loadable extension entry', () => {
      // 0.87 ships a prebuilt bundle and names the entry in `pi.extensions`;
      // 0.6x shipped TypeScript source. Assert the contract, not the layout.
      const packageDir = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents');
      const manifest = JSON.parse(
        fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'),
      ) as { pi?: { extensions?: unknown } };
      const entry = resolveUpstreamSubagentEntry(packageDir, manifest);

      expect(fs.existsSync(entry)).toBe(true);
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

    it('derives extension exposure from PermissionPolicy tool scope and bounded MCP allowlist', async () => {
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-pi-subagents-home-'));
      tempHomeToClean = tempHome;
      const previousHome = process.env.HOME;
      process.env.HOME = tempHome;
      vi.resetModules();
      try {
        const { getMindosWebPiRuntimePaths } = await import('@/lib/agent/mindos-pi-runtime-host');
        const {
          createMindosAgentPermissionPolicy,
          createMindosKnowledgeWritePermissionPolicy,
        } = await import('@geminilight/mindos/agent/mindos-pi/permission');
        const base = {
          projectRoot: path.resolve(PROJECT_ROOT, '..', '..'),
          mindRoot: PROJECT_ROOT,
          serverSettings: {},
        };

        const readonlyPaths = getMindosWebPiRuntimePaths({
          ...base,
          permissionPolicy: createMindosAgentPermissionPolicy('read'),
        });
        const readonlyExtensionList = readonlyPaths.additionalExtensionPaths.join('\n');
        expect(readonlyExtensionList).toContain('kb-extension');
        expect(readonlyExtensionList).toContain('ask-user-question-bridge-extension');
        expect(readonlyExtensionList).toContain('pi-web-access');
        expect(readonlyExtensionList).not.toContain('pi-mcp-adapter');
        expect(readonlyExtensionList).toContain('subagent-ledger-extension');
        expect(readonlyExtensionList).not.toContain(path.join('lib', 'im', 'index.ts'));
        expect(readonlyExtensionList).not.toContain('schedule-prompt');

        const askPaths = getMindosWebPiRuntimePaths({
          ...base,
          permissionPolicy: createMindosAgentPermissionPolicy('ask'),
        });
        const askExtensionList = askPaths.additionalExtensionPaths.join('\n');
        expect(askExtensionList).toContain('kb-extension');
        expect(askExtensionList).toContain('ask-user-question-bridge-extension');
        expect(askExtensionList).toContain('pi-web-access');
        expect(askExtensionList).toContain('subagent-ledger-extension');
        expect(askExtensionList).not.toContain('pi-mcp-adapter');
        expect(askExtensionList).not.toContain(path.join('lib', 'im', 'index.ts'));
        expect(askExtensionList).not.toContain('schedule-prompt');

        const kbWritePaths = getMindosWebPiRuntimePaths({
          ...base,
          permissionPolicy: createMindosKnowledgeWritePermissionPolicy('ask'),
        });
        const kbWriteExtensionList = kbWritePaths.additionalExtensionPaths.join('\n');
        expect(kbWriteExtensionList).toContain('kb-extension');
        expect(kbWriteExtensionList).toContain('pi-web-access');
        expect(kbWriteExtensionList).not.toContain('pi-mcp-adapter');
        expect(kbWriteExtensionList).not.toContain('subagent-ledger-extension');
        expect(kbWriteExtensionList).not.toContain(path.join('lib', 'im', 'index.ts'));
        expect(kbWriteExtensionList).not.toContain('schedule-prompt');

        const autoPaths = getMindosWebPiRuntimePaths({
          ...base,
          permissionPolicy: createMindosAgentPermissionPolicy('auto'),
        });
        const autoExtensionList = autoPaths.additionalExtensionPaths.join('\n');
        expect(autoExtensionList).toContain('kb-extension');
        expect(autoExtensionList).toContain('pi-web-access');
        expect(autoExtensionList).not.toContain('pi-mcp-adapter');
        expect(autoExtensionList).not.toContain('mindos-mcp-adapter-extension');
        expect(autoExtensionList).toContain('subagent-ledger-extension');
        expect(autoExtensionList).toContain(path.join('lib', 'im', 'index.ts'));
        expect(autoExtensionList).toContain('schedule-prompt');

        fs.mkdirSync(path.join(tempHome, '.mindos'), { recursive: true });
        fs.writeFileSync(path.join(tempHome, '.mindos', 'mcp.json'), JSON.stringify({
          mcpServers: {
            github: {
              command: 'github-mcp',
              mindosAgent: ['search_code'],
            },
          },
        }), 'utf-8');
        const fullWithMcpPaths = getMindosWebPiRuntimePaths({
          ...base,
          permissionPolicy: createMindosAgentPermissionPolicy('full'),
        });
        const fullWithMcpExtensionList = fullWithMcpPaths.additionalExtensionPaths.join('\n');
        expect(fullWithMcpExtensionList).toContain('mindos-mcp-adapter-extension');
        expect(fullWithMcpExtensionList).not.toContain(path.join('node_modules', 'pi-mcp-adapter', 'index.ts'));
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
    it('the declared entry exports an extension factory', async () => {
      // Reads the module rather than its source text: 0.87 publishes a bundle,
      // so grepping for `pi.registerTool` only tested how upstream happened to
      // be written, and broke the moment they shipped compiled output.
      const packageDir = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents');
      const manifest = JSON.parse(
        fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'),
      ) as { pi?: { extensions?: unknown } };
      const entry = resolveUpstreamSubagentEntry(packageDir, manifest);

      const loaded = await import(pathToFileURL(entry).href) as { default?: unknown };
      expect(typeof loaded.default).toBe('function');
    });
  });

  describe('runtime extension loading (integration)', () => {
    it('DefaultResourceLoader loads pi-subagents and exposes subagent tools', async () => {
      // This test mirrors the actual loading path used by agent turns.
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
      expect(runtimeConfig!.env[MINDOS_PI_CHILD_CLI_PATH_ENV]).toBe(runtimeConfig!.piCliPath);
      expect(runtimeConfig!.env.PATH.split(path.delimiter)[0]).toBe(runtimeConfig!.binDir);
      expect(runtimeConfig!.binDir).toBe(path.join(runtimeConfig!.agentDir, 'bin'));
      expect(runtimeConfig!.piCliPath.replace(/\\/g, '/')).toContain('@earendil-works/pi-coding-agent');
      expect(runtimeConfig!.piCliPath).toContain(path.join('dist', 'cli.js'));
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

    it('inherits loaded parent extensions for child subagents while excluding subagents itself', () => {
      const kbExtensionPath = path.join(PROJECT_ROOT, 'lib', 'agent', 'kb-extension.ts');
      const askExtensionPath = path.join(PROJECT_ROOT, 'lib', 'agent', 'ask-user-question-bridge-extension.ts');
      const webAccessPath = path.join(PROJECT_ROOT, 'node_modules', 'pi-web-access', 'index.ts');
      const subagentWrapperPath = path.join(PROJECT_ROOT, 'lib', 'agent', 'subagent-ledger-extension.ts');
      const upstreamSubagentPath = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents', 'src', 'extension', 'index.ts');

      const inherited = collectInheritedSubagentExtensionPaths({
        toolCallId: 'inherit-test',
        params: { agent: 'researcher', task: 'check inherited tools' },
        ctx: {
          resourceLoader: {
            getExtensions: () => ({
              extensions: [
                { path: kbExtensionPath },
                { path: askExtensionPath },
                { path: subagentWrapperPath },
                { path: upstreamSubagentPath },
                { path: kbExtensionPath },
                { resolvedPath: webAccessPath },
                { path: '<factory:test>' },
              ],
            }),
          },
        },
      });

      expect(inherited).toEqual([
        path.normalize(kbExtensionPath),
        path.normalize(askExtensionPath),
        path.normalize(webAccessPath),
      ]);
    });

    it('serializes inherited child extensions and prepares a KB host bootstrap when needed', () => {
      const kbExtensionPath = path.join(PROJECT_ROOT, 'lib', 'agent', 'kb-extension.ts');
      const askExtensionPath = path.join(PROJECT_ROOT, 'lib', 'agent', 'ask-user-question-bridge-extension.ts');
      const subagentWrapperPath = path.join(PROJECT_ROOT, 'lib', 'agent', 'subagent-ledger-extension.ts');
      const runtimeConfig = buildMindosPiChildRuntimeConfig({
        provider: 'openai',
        modelName: 'step-3.7-flash-inherited-runtime',
        apiKey: 'sk-test-secret',
        baseUrl: 'https://gateway.example/v1',
        model: {
          id: 'step-3.7-flash-inherited-runtime',
          name: 'step-3.7-flash-inherited-runtime',
          provider: 'openai',
          api: 'openai-completions',
          baseUrl: 'https://gateway.example/v1',
        },
      }, [kbExtensionPath, askExtensionPath, subagentWrapperPath, kbExtensionPath]);

      expect(runtimeConfig).not.toBeNull();
      try {
        const expectedExtensions = [
          path.normalize(kbExtensionPath),
          path.normalize(askExtensionPath),
        ];
        expect(runtimeConfig!.inheritedExtensionPaths).toEqual(expectedExtensions);
        expect(runtimeConfig!.env[MINDOS_PI_CHILD_EXTENSION_PATHS_ENV]).toBe(JSON.stringify(expectedExtensions));
        expect(runtimeConfig!.bootstrapPath).toBe(path.join(runtimeConfig!.agentDir, 'mindos-pi-child-bootstrap.mjs'));

        ensureMindosPiChildRuntimeDir(runtimeConfig!);
        const bootstrapContent = fs.readFileSync(runtimeConfig!.bootstrapPath!, 'utf-8');
        expect(bootstrapContent).toContain('registerWebKbExtensionHost');
        expect(bootstrapContent).toContain('kb-extension-host.ts');
        expect(bootstrapContent).not.toContain('sk-test-secret');

        const bootstrapRun = spawnSync(process.execPath, [
          '--import',
          runtimeConfig!.bootstrapPath!,
          '--input-type=module',
          '-e',
          [
            "import { getMindosKbExtensionHost } from '@geminilight/mindos/agent/mindos-pi/extension/kb-extension';",
            "import { createMindosAgentPermissionPolicy } from '@geminilight/mindos/agent/mindos-pi/permission';",
            'const host = getMindosKbExtensionHost();',
            "if (!host) { console.error('missing host'); process.exit(2); }",
            "const tools = host.getToolsForPolicy(createMindosAgentPermissionPolicy('read'));",
            "if (!tools.some((tool) => tool.name === 'read_file')) { console.error('missing read_file'); process.exit(3); }",
            "console.log('ok');",
          ].join('\n'),
        ], {
          cwd: PROJECT_ROOT,
          encoding: 'utf-8',
        });
        expect(bootstrapRun.error).toBeUndefined();
        expect(`${bootstrapRun.stdout}\n${bootstrapRun.stderr}`).toContain('ok');
        expect(bootstrapRun.status).toBe(0);
      } finally {
        fs.rmSync(runtimeConfig!.agentDir, { recursive: true, force: true });
      }
    });

    it('injects inherited extensions into real subagent pi invocations without affecting normal pi commands', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-pi-shim-capture-'));
      const capturePath = path.join(tempDir, 'argv.json');
      const fakeCliPath = path.join(tempDir, 'fake-pi-cli.cjs');
      fs.writeFileSync(fakeCliPath, [
        '#!/usr/bin/env node',
        "const fs = require('fs');",
        `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ argv: process.argv.slice(2), execArgv: process.execArgv }, null, 2));`,
        "process.stdout.write('0.0.0\\n');",
        '',
      ].join('\n'), { mode: 0o700 });

      const runtimeConfig = buildMindosPiChildRuntimeConfig({
        provider: 'openai',
        modelName: 'step-3.7-flash-shim-inherit',
        apiKey: 'sk-test-secret',
        baseUrl: 'https://gateway.example/v1',
        model: {
          id: 'step-3.7-flash-shim-inherit',
          name: 'step-3.7-flash-shim-inherit',
          provider: 'openai',
          api: 'openai-completions',
          baseUrl: 'https://gateway.example/v1',
        },
      }, ['/tmp/parent-a.ts', '/tmp/parent-b.ts']);

      expect(runtimeConfig).not.toBeNull();
      runtimeConfig!.piCliPath = fakeCliPath;
      try {
        ensureMindosPiChildRuntimeDir(runtimeConfig!);

        const subagentRun = spawnSync('pi', ['--mode', 'json', '-p', '--extension', '/tmp/existing.ts', 'Task: hello'], {
          env: { ...process.env, ...runtimeConfig!.env, PI_SUBAGENT_CHILD: '1' },
          encoding: 'utf-8',
        });
        expect(subagentRun.error).toBeUndefined();
        expect(subagentRun.status).toBe(0);
        const subagentCapture = JSON.parse(fs.readFileSync(capturePath, 'utf-8'));
        expect(subagentCapture.argv).toEqual([
          '--mode',
          'json',
          '-p',
          '--extension',
          '/tmp/existing.ts',
          '--extension',
          path.normalize('/tmp/parent-a.ts'),
          '--extension',
          path.normalize('/tmp/parent-b.ts'),
          'Task: hello',
        ]);

        const versionRun = spawnSync('pi', ['--version'], {
          env: { ...process.env, ...runtimeConfig!.env },
          encoding: 'utf-8',
        });
        expect(versionRun.error).toBeUndefined();
        expect(versionRun.status).toBe(0);
        const versionCapture = JSON.parse(fs.readFileSync(capturePath, 'utf-8'));
        expect(versionCapture.argv).toEqual(['--version']);
      } finally {
        fs.rmSync(runtimeConfig!.agentDir, { recursive: true, force: true });
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('writes an executable pi shim into the child runtime PATH', () => {
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
        },
      });

      expect(runtimeConfig).not.toBeNull();
      try {
        ensureMindosPiChildRuntimeDir(runtimeConfig!);

        const piShim = path.join(runtimeConfig!.binDir, 'pi');
        const piCmdShim = path.join(runtimeConfig!.binDir, 'pi.cmd');
        const jsShim = path.join(runtimeConfig!.binDir, 'pi-shim.cjs');

        expect(fs.existsSync(path.join(runtimeConfig!.agentDir, 'models.json'))).toBe(true);
        expect(fs.existsSync(path.join(runtimeConfig!.agentDir, 'settings.json'))).toBe(true);
        expect(fs.existsSync(piShim)).toBe(true);
        expect(fs.existsSync(piCmdShim)).toBe(true);
        expect(fs.existsSync(jsShim)).toBe(true);
        expect(fs.readFileSync(piShim, 'utf-8')).toContain('pi-shim.cjs');
        expect(fs.readFileSync(jsShim, 'utf-8')).toContain(runtimeConfig!.piCliPath);
        expect(fs.statSync(piShim).mode & 0o111).not.toBe(0);

        const spawnResult = spawnSync('pi', ['--version'], {
          env: { ...process.env, ...runtimeConfig!.env },
          encoding: 'utf-8',
        });
        expect(spawnResult.error).toBeUndefined();
        expect(spawnResult.status).toBe(0);
        expect(`${spawnResult.stdout}\n${spawnResult.stderr}`.trim()).toMatch(/\d+\.\d+\.\d+/);
      } finally {
        fs.rmSync(runtimeConfig!.agentDir, { recursive: true, force: true });
      }
    });
  });
});
