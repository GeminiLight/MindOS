import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf-8')) as T;
}

function readText(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

describe('OpenCode architecture alignment', () => {
  it('documents the source/runtime/client boundary migration', () => {
    const specPath = 'wiki/specs/spec-opencode-architecture-alignment.md';
    expect(existsSync(resolve(root, specPath))).toBe(true);

    const spec = readText(specPath);
    for (const section of [
      '## 目标',
      '## 现状分析',
      '## 数据流 / 状态流',
      '## 方案',
      '## 影响范围',
      '## 边界 case 与风险',
      '## 验收标准',
    ]) {
      expect(spec).toContain(section);
    }

    expect(spec).toContain('@geminilight/mindos/client');
    expect(spec).toContain('@geminilight/mindos/server');
    expect(spec).toContain('platform runtime');
    expect(spec).toContain('serve');
  });

  it('keeps the product package as the runtime owner but exposes a narrow client SDK boundary', () => {
    const pkg = readJson<{
      exports?: Record<string, { types?: string; import?: string }>;
      files?: string[];
    }>('packages/mindos/package.json');

    expect(pkg.exports?.['./client']).toEqual({
      types: './dist/client.d.ts',
      import: './dist/client.js',
    });
    expect(pkg.exports?.['./server']).toEqual({
      types: './dist/server.d.ts',
      import: './dist/server.js',
    });
    expect(pkg.exports?.['./plugin']).toEqual({
      types: './dist/plugin.d.ts',
      import: './dist/plugin.js',
    });
    expect(pkg.exports?.['./tool']).toEqual({
      types: './dist/tool.d.ts',
      import: './dist/tool.js',
    });
    expect(pkg.exports?.['./session']).toEqual({
      types: './dist/session.d.ts',
      import: './dist/session.js',
    });
    expect(pkg.exports?.['./session/pi-coding-agent']).toEqual({
      types: './dist/session/pi-coding-agent-runtime.d.ts',
      import: './dist/session/pi-coding-agent-runtime.js',
    });
    expect(pkg.exports?.['./agent']).toEqual({
      types: './dist/agent.d.ts',
      import: './dist/agent.js',
    });
    expect(pkg.exports?.['./agent/mindos-pi']).toEqual({
      types: './dist/agent/mindos-pi/index.d.ts',
      import: './dist/agent/mindos-pi/index.js',
    });
    expect(pkg.exports?.['./agent/mindos-pi/extension']).toEqual({
      types: './dist/agent/mindos-pi/extension/index.d.ts',
      import: './dist/agent/mindos-pi/extension/index.js',
    });
    expect(pkg.exports?.['./agent/pi']).toEqual({
      types: './dist/agent/pi/index.d.ts',
      import: './dist/agent/pi/index.js',
    });
    expect(pkg.exports?.['./agent-runtime/adapters']).toEqual({
      types: './dist/agent-runtime/adapters/index.d.ts',
      import: './dist/agent-runtime/adapters/index.js',
    });
    expect(pkg.exports?.['./agent-runtime/adapters/*']).toEqual({
      types: './dist/agent-runtime/adapters/*.d.ts',
      import: './dist/agent-runtime/adapters/*.js',
    });
    expect(pkg.files).toContain('dist/');
  });

  it('provides an OpenCode-style client and server launcher API', () => {
    const source = readText('packages/mindos/src/client.ts');

    expect(source).toContain('createMindosClient');
    expect(source).toContain('createMindosServer');
    expect(source).toContain('askStream');
    expect(source).toContain('parseMindosSseLine');
    expect(source).toContain('/api/health');
    expect(source).toContain('/api/settings');
    expect(source).toContain('/api/mcp/status');
    expect(source).toContain('MINDOS_AUTH_TOKEN');
    expect(source).toContain('childProcess.spawn');
  });

  it('keeps serve as a CLI alias for server-oriented integrations', () => {
    const cli = readText('packages/mindos/bin/cli.js');
    const start = readText('packages/mindos/bin/commands/start.js');

    expect(start).toContain("aliases: ['serve']");
    expect(readText('packages/mindos/src/cli-runtime.js')).toContain("'serve': startCmd");
    expect(cli).toContain('runMindosCli');
    expect(cli).not.toContain("import * as agentCmd");
  });

  it('keeps CLI runtime in product source and platform runtime artifacts', () => {
    const runtime = readText('packages/mindos/src/cli-runtime.js');
    const builder = readText('scripts/build-platform-packages.mjs');

    expect(runtime).toContain('export async function runMindosCli');
    expect(runtime).toContain('../bin/commands/start.js');
    expect(runtime).toContain('createCommandRegistry');
    expect(builder).toContain('src/cli-runtime.js');
  });

  it('makes low-risk Web routes adapt the product server contract instead of owning it', () => {
    const healthRoute = readText('packages/web/app/api/health/route.ts');
    const filesRoute = readText('packages/web/app/api/files/route.ts');
    const rawRoute = readText('packages/web/app/api/file/raw/route.ts');
    const searchRoute = readText('packages/web/app/api/search/route.ts');
    const settingsRoute = readText('packages/web/app/api/settings/route.ts');
    const mcpStatusRoute = readText('packages/web/app/api/mcp/status/route.ts');
    const server = readText('packages/mindos/src/server/index.ts');

    expect(server).toContain('createMindosHealth');
    expect(server).toContain('getMindosServerContract');
    expect(server).toContain('handleRawFile');
    expect(server).toContain('handleSettingsGet');
    expect(server).toContain('handleMcpStatus');
    expect(healthRoute).toContain("from '@geminilight/mindos/server'");
    expect(filesRoute).toContain("from '@geminilight/mindos/server'");
    expect(rawRoute).toContain("from '@geminilight/mindos/server'");
    expect(searchRoute).toContain("from '@geminilight/mindos/server'");
    expect(settingsRoute).toContain("from '@geminilight/mindos/server'");
    expect(mcpStatusRoute).toContain("from '@geminilight/mindos/server'");
    expect(healthRoute).not.toContain('function readVersion');
    expect(healthRoute).not.toContain("service: 'mindos'");
  });

  it('exposes plugin, tool, session, and agent contracts from the product runtime', () => {
    const plugin = readText('packages/mindos/src/plugin.ts');
    const tool = readText('packages/mindos/src/tool.ts');
    const session = readText('packages/mindos/src/session.ts');
    const agent = readText('packages/mindos/src/agent.ts');
    const askRoute = readText('packages/web/app/api/ask/route.ts');
    const headlessAgent = readText('packages/web/lib/agent/headless.ts');
    const piRuntimeAdapter = readText('packages/mindos/src/agent/mindos-pi/runtime.ts');
    const piRuntimeCompatShim = readText('packages/mindos/src/agent/pi/runtime.ts');
    const piRuntimeCompat = readText('packages/mindos/src/session/pi-coding-agent-runtime.ts');
    const mindosRuntimeAdapter = readText('packages/mindos/src/agent-runtime/adapters/mindos.ts');
    const streamConsumer = readText('packages/web/lib/agent/stream-consumer.ts');
    const toAgentMessages = readText('packages/web/lib/agent/to-agent-messages.ts');

    expect(plugin).toContain("from './plugin/index.js'");
    expect(tool).toContain("from './tool/index.js'");
    expect(session).toContain("from './session/index.js'");
    expect(agent).toContain("from './agent/index.js'");

    expect(readText('packages/mindos/src/plugin/index.ts')).toContain('validateMindosPluginManifest');
    expect(readText('packages/mindos/src/tool/index.ts')).toContain('createMindosToolRegistry');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('MINDOS_SESSION_STREAM_SCHEMA');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('encodeMindosSseEvent');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('normalizeMindosAskMode');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('detectMindosAgentLoop');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('toMindosAgentMessages');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('runMindosAskWithRetry');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('mapMindosAcpUpdateToSseEvents');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('runMindosAcpAskSession');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('runMindosPiAgentAskSession');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('runMindosAskProxyFallback');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('createMindosAgentEventReducer');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('resolveMindosAgentTimeoutMs');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('runMindosNonStreamingFallback');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('buildMindosCompatEndpointCandidates');
    expect(readText('packages/mindos/src/session/index.ts')).toContain('createMindosPiAgentRuntime');
    expect(readText('packages/mindos/src/agent/index.ts')).toContain('defineMindosAgent');
    expect(readText('packages/mindos/src/agent/index.ts')).toContain('MINDOS_SYSTEM_PROMPT');
    expect(readText('packages/mindos/src/agent/index.ts')).toContain('MINDOS_AGENT_MANIFEST');
    expect(readText('packages/mindos/src/agent/index.ts')).toContain('buildMindosSystemPrompt');
    expect(readText('packages/mindos/src/agent/index.ts')).toContain('buildMindosContextPrompt');
    expect(readText('packages/mindos/src/agent/index.ts')).toContain('compactMindosPromptForTokenBudget');
    expect(readText('packages/mindos/src/agent/index.ts')).not.toContain("from './pi/index.js'");
    expect(readText('packages/mindos/src/agent/index.ts')).not.toContain("from './mindos-pi/index.js'");
    expect(existsSync(resolve(root, 'packages/mindos/src/agent/prompt/context-prompt.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'packages/mindos/src/agent/mindos-pi/runtime.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'packages/mindos/src/agent/mindos-pi/extension/extension-tools.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'packages/mindos/src/agent/mindos-pi/extension/kb-extension.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'packages/mindos/src/agent/pi/runtime.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'packages/mindos/src/agent/pi/extension-tools.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'packages/mindos/src/agent-runtime/adapters/mindos.ts'))).toBe(true);
    expect(readText('packages/mindos/src/agent/prompt/system-prompt.ts')).toContain('buildMindosSystemPrompt');
    expect(readText('packages/mindos/src/agent/prompt/system-prompt.ts')).not.toContain('buildMindosContextPrompt');
    expect(readText('packages/mindos/src/agent/prompt/context-prompt.ts')).toContain('buildMindosContextPrompt');
    expect(readText('packages/mindos/src/agent/prompt/context-prompt.ts')).toContain('compactMindosPromptForTokenBudget');
    expect(askRoute).toContain("from '@geminilight/mindos/session'");
    expect(askRoute).toContain('runMindosAcpAskSession');
    expect(askRoute).toContain('runMindosPiAgentAskSession');
    expect(askRoute).toContain('resolveMindosAgentTimeoutMs');
    expect(askRoute).toContain('runMindosNonStreamingFallback');
    expect(askRoute).not.toContain('const MAX_RETRIES = 3');
    expect(askRoute).not.toContain('const ACP_MAX_RETRIES = 3');
    expect(askRoute).not.toContain('runMindosAskWithRetry');
    expect(askRoute).not.toContain('lastModelError ? t.proxyCompatDetecting : t.proxyCompatMode');
    expect(askRoute).not.toContain('isTextDeltaEvent');
    expect(askRoute).not.toContain('mapMindosAcpUpdateToSseEvents');
    expect(askRoute).not.toContain('createMindosAgentEventReducer');
    expect(askRoute).not.toContain('runMindosAskProxyFallback');
    expect(askRoute).not.toContain("from '@/lib/agent/non-streaming'");
    expect(askRoute).not.toContain("from '@mariozechner/pi-coding-agent'");
    expect(askRoute).not.toContain('createAgentSession');
    expect(askRoute).not.toContain('DefaultResourceLoader');
    expect(askRoute).not.toContain('getModelConfig');
    expect(askRoute).not.toContain('setKbMode');
    expect(askRoute).not.toContain('getRequestScopedTools');
    expect(askRoute).toContain("from '@geminilight/mindos/agent'");
    expect(askRoute).toContain('buildMindosSystemPrompt');
    expect(askRoute).toContain('buildMindosContextPrompt');
    expect(askRoute).not.toContain("from '@geminilight/mindos/session/pi-coding-agent'");
    expect(askRoute).not.toContain("await import('@geminilight/mindos/session/pi-coding-agent')");
    expect(askRoute).toContain("await import('@geminilight/mindos/agent-runtime/adapters/mindos')");
    expect(askRoute).toContain('createMindosAgentRuntime');
    expect(askRoute).toContain('const externalPrompt = await buildMindosContextPrompt');
    expect(askRoute).toContain('const turnPrompt = await buildMindosContextPrompt');
    expect(askRoute).toContain('prompt: externalPrompt');
    expect(askRoute).toContain('prompt: turnPrompt');
    expect(askRoute.indexOf('if (selectedNativeRuntime || selectedAcpAgent)')).toBeLessThan(
      askRoute.indexOf("await import('@geminilight/mindos/agent-runtime/adapters/mindos')"),
    );
    // Native-only SDKs must load through the bundler-proof native import: a
    // static `import ... from` (or even a plain dynamic import) lets Next.js
    // inline a webpack copy of the SDK whose broken `import.meta` kills jiti
    // extension loading (no KB tools) and Claude SDK CLI resolution.
    const nativeImportHelper = readText('packages/mindos/src/foundation/native-import.ts');
    const claudeSdkAdapter = readText('packages/mindos/src/agent-runtime/claude-code-sdk.ts');
    expect(nativeImportHelper).toContain("new Function('specifier', 'return import(specifier)')");
    expect(piRuntimeAdapter).toContain('@earendil-works/pi-coding-agent');
    expect(piRuntimeAdapter).toContain("import { nativeImport } from '../../foundation/native-import.js'");
    expect(piRuntimeAdapter).not.toMatch(/^import\s*\{[^}]*\}\s*from '@earendil-works\/pi-coding-agent';/m);
    expect(piRuntimeAdapter).not.toContain("from '@mariozechner/pi-coding-agent'");
    expect(piRuntimeCompatShim).toContain("from '../mindos-pi/runtime.js'");
    expect(piRuntimeCompat).toContain("from '../agent/mindos-pi/runtime.js'");
    expect(claudeSdkAdapter).toContain("import { nativeImport } from '../foundation/native-import.js'");
    expect(claudeSdkAdapter).not.toContain("import('@anthropic-ai/claude-agent-sdk')");
    expect(claudeSdkAdapter).not.toMatch(/^const requireFromHere = createRequire/m);
    expect(piRuntimeAdapter).toContain('createMindosPiAgentRuntime');
    expect(piRuntimeAdapter).toContain('compactMindosPromptForTokenBudget');
    expect(mindosRuntimeAdapter).toContain('createMindosAgentRuntimeAdapter');
    expect(mindosRuntimeAdapter).toContain('createMindosAgentRuntime');
    expect(mindosRuntimeAdapter).toContain('createMindosPiCodingAgentRuntime');
    expect(mindosRuntimeAdapter).toContain("from '../../agent/mindos-pi/runtime.js'");
    expect(readText('packages/mindos/src/agent/tool/index.ts')).not.toContain('kb-extension');
    expect(readText('packages/mindos/src/agent/tool/kb-extension.ts')).toContain("from '../mindos-pi/extension/kb-extension.js'");
    expect(readText('packages/web/lib/agent/kb-extension.ts')).toContain('@geminilight/mindos/agent/mindos-pi/extension/kb-extension');
    expect(existsSync(resolve(root, 'packages/web/lib/agent/mindos-pi-runtime-adapter.ts'))).toBe(false);
    expect(headlessAgent).not.toContain("from '@mariozechner/pi-coding-agent'");
    expect(headlessAgent).not.toContain('createAgentSession');
    expect(headlessAgent).not.toContain('DefaultResourceLoader');
    expect(headlessAgent).toContain('createMindosAgentRuntime');
    expect(askRoute).not.toContain("from '@/lib/agent/prompt'");
    // Wave 4 (spec-agent-core-consolidation): the SSE parsing engine sank
    // into the core stream consumer; the web file is a thin adapter that
    // injects the browser files-changed emitter.
    expect(streamConsumer).toContain("from '@geminilight/mindos/agent/stream-consumer'");

    expect(readText('packages/web/lib/agent/prompt.ts')).toContain("from '@geminilight/mindos/agent'");
    expect(readText('packages/web/lib/agent/retry.ts')).toContain("from '@geminilight/mindos/session'");
    expect(readText('packages/web/lib/agent/reconnect.ts')).toContain("from '@geminilight/mindos/session'");
    expect(readText('packages/web/lib/agent/loop-detection.ts')).toContain("from '@geminilight/mindos/session'");
    expect(readText('packages/web/lib/agent/non-streaming.ts')).toContain("from '@geminilight/mindos/session'");
    expect(toAgentMessages).toContain("from '@geminilight/mindos/session'");
  });
});
