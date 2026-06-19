import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti/static';
import {
  ensureMindosAgentMcpRuntimeConfig,
  type MindosAgentMcpRuntimeConfig,
} from '../pi-integration/mcp-config';
import { resolveBuiltinWebRuntimePackagePath } from './builtin-extension-runtime';

type RegisterMcpAdapterExtension = (pi: ExtensionAPI) => void | Promise<void>;

type MindosMcpExtensionApi = ExtensionAPI & {
  on(event: string, handler: (payload: unknown, ctx: Record<string, any>) => unknown): void;
  registerFlag(name: string, options: Record<string, unknown>): void;
};

type ToolWithRuntimeContext = ToolDefinition & {
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: Record<string, any>,
  ) => Promise<any> | any;
};

async function loadUpstreamMcpAdapter(): Promise<RegisterMcpAdapterExtension> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const webAppDir = path.resolve(currentDir, '..', '..');
  const upstreamPath = resolveBuiltinWebRuntimePackagePath(webAppDir, 'pi-mcp-adapter', 'index.ts');
  const upstreamRealPath = fs.realpathSync(upstreamPath);
  const jiti = createJiti(upstreamRealPath, {
    moduleCache: false,
    tryNative: false,
  });
  const register = await jiti.import(upstreamRealPath, { default: true });
  if (typeof register !== 'function') {
    throw new Error('pi-mcp-adapter did not export an extension factory.');
  }
  return register as RegisterMcpAdapterExtension;
}

async function withBoundedMcpAdapterEnvironment<T>(
  runtimeConfig: MindosAgentMcpRuntimeConfig,
  fn: () => Promise<T> | T,
): Promise<T> {
  await acquireMcpAdapterEnvironmentLock();
  fs.mkdirSync(runtimeConfig.sandboxHome, { recursive: true });
  fs.mkdirSync(runtimeConfig.sandboxCwd, { recursive: true });

  const previousHome = process.env.HOME;
  const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousArgv = [...process.argv];
  const previousCwd = process.cwd();

  try {
    process.env.HOME = runtimeConfig.sandboxHome;
    process.env.PI_CODING_AGENT_DIR = path.join(runtimeConfig.sandboxHome, '.pi', 'agent');
    setArgvFlag('--mcp-config', runtimeConfig.configPath);
    process.chdir(runtimeConfig.sandboxCwd);
    return await fn();
  } finally {
    try {
      process.argv.splice(0, process.argv.length, ...previousArgv);
      process.chdir(previousCwd);
      restoreEnvVar('HOME', previousHome);
      restoreEnvVar('PI_CODING_AGENT_DIR', previousPiAgentDir);
    } finally {
      releaseMcpAdapterEnvironmentLock();
    }
  }
}

const MCP_ADAPTER_ENVIRONMENT_LOCK_KEY = '__mindosMcpAdapterEnvironmentLock';
let releaseCurrentMcpAdapterEnvironmentLock: (() => void) | null = null;

async function acquireMcpAdapterEnvironmentLock(): Promise<void> {
  const globalStore = globalThis as unknown as Record<string, Promise<void> | undefined>;
  const previous = globalStore[MCP_ADAPTER_ENVIRONMENT_LOCK_KEY] ?? Promise.resolve();
  let releaseNext!: () => void;
  const next = new Promise<void>((resolve) => {
    releaseNext = resolve;
  });
  globalStore[MCP_ADAPTER_ENVIRONMENT_LOCK_KEY] = previous.catch(() => undefined).then(() => next);
  await previous.catch(() => undefined);
  releaseCurrentMcpAdapterEnvironmentLock = releaseNext;
}

function releaseMcpAdapterEnvironmentLock(): void {
  releaseCurrentMcpAdapterEnvironmentLock?.();
  releaseCurrentMcpAdapterEnvironmentLock = null;
}

function restoreEnvVar(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function setArgvFlag(flag: string, value: string): void {
  const existing = process.argv.indexOf(flag);
  if (existing >= 0) {
    process.argv[existing + 1] = value;
    return;
  }
  process.argv.push(flag, value);
}

function wrapMcpProxyTool(
  tool: ToolWithRuntimeContext,
  runtimeConfig: MindosAgentMcpRuntimeConfig,
): ToolWithRuntimeContext {
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const denial = validateMcpProxyParams(params, runtimeConfig.serverPolicies);
      if (denial) {
        return {
          content: [{ type: 'text' as const, text: denial }],
          isError: true,
          details: {
            mode: 'mindos_policy',
            error: 'mcp_not_allowlisted',
          },
        };
      }
      return await tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  };
}

function validateMcpProxyParams(
  params: unknown,
  policies: Record<string, true | string[]>,
): string | null {
  if (!params || typeof params !== 'object') return null;
  const record = params as Record<string, unknown>;
  const server = typeof record.server === 'string' ? record.server : undefined;
  const tool = typeof record.tool === 'string' ? record.tool : undefined;
  const connect = typeof record.connect === 'string' ? record.connect : undefined;
  const describe = typeof record.describe === 'string' ? record.describe : undefined;
  const search = typeof record.search === 'string' ? record.search : undefined;

  const targetServer = server ?? connect;
  if (targetServer && !policies[targetServer]) {
    return `MCP server "${targetServer}" is not allowlisted for MindOS Agent.`;
  }

  if (tool) {
    if (!server) {
      return `MCP proxy calls must include an allowlisted "server" when calling "${tool}" from MindOS Agent.`;
    }
    return validateToolAllowed(server, tool, policies);
  }

  if (describe) {
    if (!server) {
      return `MCP proxy describe calls must include an allowlisted "server" for "${describe}".`;
    }
    return validateToolAllowed(server, describe, policies);
  }

  if (search) {
    return allPoliciesAllowFullServer(policies)
      ? null
      : 'MCP proxy search is disabled when MindOS Agent has a tool-level MCP allowlist.';
  }

  if (connect) {
    return allPoliciesAllowFullServer(policies)
      ? null
      : 'MCP proxy connect is disabled when MindOS Agent has a tool-level MCP allowlist; call an allowlisted tool with an explicit server instead.';
  }

  if (server) {
    return policies[server] === true
      ? null
      : `MCP server "${server}" is tool-limited for MindOS Agent; listing all tools is disabled.`;
  }

  return null;
}

function validateToolAllowed(
  server: string,
  toolName: string,
  policies: Record<string, true | string[]>,
): string | null {
  const policy = policies[server];
  if (!policy) return `MCP server "${server}" is not allowlisted for MindOS Agent.`;
  if (policy === true) return null;
  if (policy.includes(toolName)) return null;
  return `MCP tool "${server}/${toolName}" is not allowlisted for MindOS Agent.`;
}

function allPoliciesAllowFullServer(policies: Record<string, true | string[]>): boolean {
  return Object.values(policies).every((policy) => policy === true);
}

function createPolicyAwareMcpPi(
  pi: ExtensionAPI,
  runtimeConfig: MindosAgentMcpRuntimeConfig,
): MindosMcpExtensionApi {
  const hostPi = pi as MindosMcpExtensionApi;
  return {
    ...hostPi,
    registerFlag(name: string, options: Record<string, unknown>) {
      if (name === 'mcp-config') {
        hostPi.registerFlag(name, { ...options, default: runtimeConfig.configPath });
        return;
      }
      hostPi.registerFlag(name, options);
    },
    on(event: any, handler: any) {
      if (event === 'session_start') {
        hostPi.on(event, (payload: unknown, ctx: Record<string, any>) => {
          const boundedCtx = {
            ...ctx,
            cwd: runtimeConfig.sandboxCwd,
          };
          return handler(payload, boundedCtx);
        });
        return;
      }
      hostPi.on(event, handler);
    },
    registerTool(tool: ToolDefinition) {
      if (tool.name === 'mcp') {
        pi.registerTool(wrapMcpProxyTool(tool as ToolWithRuntimeContext, runtimeConfig) as ToolDefinition);
        return;
      }
      pi.registerTool(tool);
    },
  } as MindosMcpExtensionApi;
}

export default async function mindosMcpAdapterExtension(pi: ExtensionAPI): Promise<void> {
  const runtimeConfig = ensureMindosAgentMcpRuntimeConfig();
  if (runtimeConfig.serverCount === 0) return;

  const policyAwarePi = createPolicyAwareMcpPi(pi, runtimeConfig);
  await withBoundedMcpAdapterEnvironment(runtimeConfig, async () => {
    const registerMcpAdapter = await loadUpstreamMcpAdapter();
    await registerMcpAdapter(policyAwarePi);
  });
}
