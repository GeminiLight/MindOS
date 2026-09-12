import { readMcpInitializeResult } from './mcp-verification.js';
import { isAbsolute } from 'node:path';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import type { MindosServerEventEmitter } from '../events/bus.js';
import {
  AgentConfigProjectRootError,
  AgentConfigScopeError,
  agentConfigPathNeedsProjectRoot,
  assertSafeMcpServerName,
  buildMindosMcpServerEntry,
  convertMcpServerEntry,
  createAgentConfigAdapters,
  DEFAULT_MINDOS_MCP_PORT,
  installAgentConnection,
  resolveAgentConfigPath,
  type AgentConfigAdapter,
  type AgentConfigAdapterRegistry,
  type AgentConfigLocationDef,
  type AgentConfigPathServices,
  type AgentConfigScope,
  type SkillAgentRegistration,
  type SkillWorkspaceProfile,
} from '../../agent/config/index.js';

export { AgentConfigProjectRootError, agentConfigPathNeedsProjectRoot, resolveAgentConfigPath, type AgentConfigPathServices };

export type MindosMcpAgentDef = AgentConfigLocationDef;
export type MindosSkillAgentRegistration = SkillAgentRegistration;
export type MindosSkillWorkspaceProfile = SkillWorkspaceProfile;

export type MindosMcpInstallItem = {
  key: string;
  scope: AgentConfigScope;
  transport?: 'stdio' | 'http' | 'auto';
};

export type MindosMcpInstallRequest = {
  agents?: MindosMcpInstallItem[];
  transport?: 'stdio' | 'http' | 'auto';
  url?: string;
  token?: string;
  /** Absolute directory that relative project-scoped config paths resolve against; overrides the service default. */
  projectRoot?: string;
};

export type MindosMcpUninstallRequest = {
  agents?: Array<{
    key: string;
    scope: AgentConfigScope;
    serverName?: string;
  }>;
  projectRoot?: string;
};

export type MindosMcpServerCopyTarget = {
  key: string;
  scope?: AgentConfigScope;
  overwrite?: boolean;
};

export type MindosMcpServerCopyRequest = {
  serverName?: string;
  sourceAgentKey?: string;
  sourceScope?: AgentConfigScope;
  targets?: MindosMcpServerCopyTarget[];
  projectRoot?: string;
};

export type MindosMcpInstallResult = {
  agent: string;
  status: string;
  path?: string;
  message?: string;
  transport?: string;
  verified?: boolean;
  verifyError?: string;
  /** Non-fatal notices, e.g. a JSONC file had syntax issues but was still edited in place. */
  warnings?: string[];
};

export type MindosMcpInstallServices = {
  agents: Record<string, MindosMcpAgentDef>;
  homeDir?: string;
  /** Default base for relative project-scoped config paths (the mind root in the product server). */
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  requireAgentPresence?: boolean;
  detectAgentPresence?: (agent: string) => boolean;
  readSettings?: () => { mcpPort?: number; disabledSkills?: string[] };
  fetcher?: typeof fetch;
  /** Receives `mcp.changed` when at least one agent config was written. */
  events?: MindosServerEventEmitter;
};

export type MindosMcpServerCopyServices = MindosMcpInstallServices;

export type MindosMcpUninstallServices = {
  agents: Record<string, MindosMcpAgentDef>;
  homeDir?: string;
  projectRoot?: string;
  /** Receives `mcp.changed` when at least one agent config was written. */
  events?: MindosServerEventEmitter;
};

/** Emit `mcp.changed` once when any per-agent result succeeded. */
function notifyMcpChanged(services: { events?: MindosServerEventEmitter }, results: MindosMcpInstallResult[]): void {
  if (results.some((result) => result.status === 'ok')) services.events?.emit({ type: 'mcp.changed' });
}

function withWarnings(result: MindosMcpInstallResult, warnings: string[]): MindosMcpInstallResult {
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}

/** Adapters over the request's agent registry, resolving paths against the request's home and project root. */
function adaptersFor(agents: Record<string, MindosMcpAgentDef>, pathServices: AgentConfigPathServices): AgentConfigAdapterRegistry {
  return createAgentConfigAdapters({ agents, probes: { homeDir: pathServices.homeDir, projectRoot: pathServices.projectRoot } });
}

/**
 * Project root for one request: the request's own absolute `projectRoot`
 * wins, then the service default. A present-but-invalid request value is a
 * client error rather than something to silently fall back from.
 */
function resolveRequestProjectRoot(
  body: { projectRoot?: unknown },
  services: AgentConfigPathServices,
): { projectRoot?: string } | { error: string } {
  if (body.projectRoot === undefined || body.projectRoot === null) return { projectRoot: services.projectRoot };
  if (typeof body.projectRoot !== 'string' || !body.projectRoot.trim()) return { error: 'projectRoot must be a non-empty string' };
  if (!isAbsolute(body.projectRoot.trim())) return { error: 'projectRoot must be an absolute path' };
  return { projectRoot: body.projectRoot.trim() };
}

/** 400 body when any requested item needs a project root that nobody supplied; null otherwise. */
function missingProjectRootError(
  items: Array<{ key: string; scope: AgentConfigScope }>,
  registry: AgentConfigAdapterRegistry,
): string | null {
  for (const item of items) {
    const adapter = registry.get(item.key);
    if (!adapter || item.scope !== 'project') continue;
    if (adapter.needsProjectRoot('project')) {
      return `${adapter.def.name} project scope needs a project root; pass projectRoot or install into global scope.`;
    }
  }
  return null;
}

function unknownAgent(key: string): MindosMcpInstallResult {
  return { agent: key, status: 'error', message: `Unknown agent: ${key}` };
}

function notDetected(adapter: AgentConfigAdapter): MindosMcpInstallResult {
  return {
    agent: adapter.key,
    status: 'error',
    message: `${adapter.def.name} was not detected on this machine. Install the agent first, then refresh.`,
  };
}

function mcpPortFrom(services: MindosMcpInstallServices): number {
  return Number(services.env?.MINDOS_MCP_PORT) || services.readSettings?.().mcpPort || DEFAULT_MINDOS_MCP_PORT;
}

async function verifyHttpConnection(
  mcpUrl: string,
  token: string | undefined,
  fetcher: typeof fetch = fetch,
  configuredHeaders: Record<string, string> = {},
): Promise<{ verified: boolean; verifyError?: string }> {
  try {
    // Streamable HTTP requires the initialize handshake first: a bare
    // tools/list is rejected with 400 by spec-compliant servers (including
    // our own) when it carries no session id. Accept must advertise both
    // JSON and SSE so servers may answer either way.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...configuredHeaders,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetcher(mcpUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'mindos-install-verify', version: '1' },
          },
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const verified = await readMcpInitializeResult(res);
        return verified ? { verified: true } : { verified: false, verifyError: 'The endpoint did not return a valid MCP initialize response.' };
      }
      return { verified: false, verifyError: `HTTP ${res.status}` };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return { verified: false, verifyError: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleMcpInstallPost(
  body: MindosMcpInstallRequest,
  services: MindosMcpInstallServices,
): Promise<MindosServerResponse<{ results: MindosMcpInstallResult[] } | { error: string }>> {
  try {
    const root = resolveRequestProjectRoot(body, services);
    if ('error' in root) return json({ error: root.error }, { status: 400 });
    const registry = adaptersFor(services.agents, { homeDir: services.homeDir, projectRoot: root.projectRoot });
    const missingRoot = missingProjectRootError(body.agents ?? [], registry);
    if (missingRoot) return json({ error: missingRoot }, { status: 400 });

    const results: MindosMcpInstallResult[] = [];
    const globalTransport = body.transport ?? 'auto';

    for (const item of body.agents ?? []) {
      const { key, scope } = item;
      const adapter = registry.get(key);
      if (!adapter) {
        results.push(unknownAgent(key));
        continue;
      }

      const effectiveTransport = item.transport && item.transport !== 'auto'
        ? item.transport
        : globalTransport !== 'auto'
          ? globalTransport
          : adapter.def.preferredTransport;
      if (!adapter.hasScope(scope)) {
        results.push({ agent: key, status: 'error', message: new AgentConfigScopeError(adapter.def.name, scope).message });
        continue;
      }
      if (services.requireAgentPresence && !services.detectAgentPresence?.(key)) {
        results.push(notDetected(adapter));
        continue;
      }

      const entry = buildMindosMcpServerEntry(adapter.def, effectiveTransport, {
        url: body.url,
        token: body.token,
        fallbackPort: mcpPortFrom(services),
      });
      const outcome = installAgentConnection({ adapter, scope, entry });
      if (!outcome.ok || !outcome.config) {
        results.push({ agent: key, status: 'error', message: outcome.message ?? 'Install failed' });
        continue;
      }

      const result = withWarnings(
        { agent: key, status: 'ok', path: outcome.config.configPath, transport: effectiveTransport },
        outcome.warnings,
      );
      if (effectiveTransport === 'http') {
        const verification = await verifyHttpConnection(String(entry.url), body.token, services.fetcher);
        result.verified = verification.verified;
        if (verification.verifyError) result.verifyError = verification.verifyError;
      }
      results.push(result);
    }

    notifyMcpChanged(services, results);
    return json({ results });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMcpServerCopyPost(
  body: MindosMcpServerCopyRequest,
  services: MindosMcpServerCopyServices,
): Promise<MindosServerResponse<{ results: MindosMcpInstallResult[] } | { error: string }>> {
  try {
    const serverName = body.serverName?.trim();
    if (!serverName) return json({ error: 'serverName required' }, { status: 400 });
    assertSafeMcpServerName(serverName);

    const targets = body.targets ?? [];
    if (targets.length === 0) return json({ error: 'targets required' }, { status: 400 });

    const root = resolveRequestProjectRoot(body, services);
    if ('error' in root) return json({ error: root.error }, { status: 400 });
    const registry = adaptersFor(services.agents, { homeDir: services.homeDir, projectRoot: root.projectRoot });
    const missingRoot = missingProjectRootError(
      targets.map((target) => ({ key: target.key, scope: target.scope ?? 'global' })),
      registry,
    );
    if (missingRoot) return json({ error: missingRoot }, { status: 400 });

    if (serverName === 'mindos') {
      return handleMcpInstallPost({
        agents: targets.map((target) => ({
          key: target.key,
          scope: target.scope ?? 'global',
          transport: 'auto',
        })),
        transport: 'auto',
        ...(root.projectRoot ? { projectRoot: root.projectRoot } : {}),
      }, services);
    }

    const sourceKey = body.sourceAgentKey?.trim();
    if (!sourceKey) return json({ error: 'sourceAgentKey required for non-MindOS MCP servers' }, { status: 400 });
    const sourceAdapter = registry.get(sourceKey);
    if (!sourceAdapter) return json({ error: `Unknown source agent: ${sourceKey}` }, { status: 404 });

    const source = sourceAdapter.readServer(serverName, { scope: body.sourceScope, strict: true });
    if (!source) {
      return json({ error: `MCP server "${serverName}" was not found in ${sourceAdapter.def.name}` }, { status: 404 });
    }

    const results: MindosMcpInstallResult[] = [];
    for (const target of targets) {
      const targetAdapter = registry.get(target.key);
      if (!targetAdapter) {
        results.push(unknownAgent(target.key));
        continue;
      }
      if (services.requireAgentPresence && !services.detectAgentPresence?.(target.key)) {
        results.push(notDetected(targetAdapter));
        continue;
      }

      const scope = target.scope ?? 'global';
      try {
        if (!targetAdapter.hasScope(scope)) {
          results.push({ agent: target.key, status: 'error', message: new AgentConfigScopeError(targetAdapter.def.name, scope).message });
          continue;
        }
        const write = targetAdapter.writeServer(serverName, convertMcpServerEntry(source.entry, sourceAdapter.def, targetAdapter.def), scope, { overwrite: target.overwrite === true });
        if (!write.written) {
          results.push({ agent: target.key, status: 'ok', path: write.configPath, message: 'Already configured' });
          continue;
        }
        results.push(withWarnings({ agent: target.key, status: 'ok', path: write.configPath }, write.warnings));
      } catch (error) {
        results.push({ agent: target.key, status: 'error', message: String(error) });
      }
    }

    notifyMcpChanged(services, results);
    return json({ results });
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleMcpUninstallPost(
  body: MindosMcpUninstallRequest,
  services: MindosMcpUninstallServices,
): MindosServerResponse<{ results: MindosMcpInstallResult[] } | { error: string }> {
  try {
    const root = resolveRequestProjectRoot(body, services);
    if ('error' in root) return json({ error: root.error }, { status: 400 });
    const registry = adaptersFor(services.agents, { homeDir: services.homeDir, projectRoot: root.projectRoot });
    const missingRoot = missingProjectRootError(body.agents ?? [], registry);
    if (missingRoot) return json({ error: missingRoot }, { status: 400 });

    const results: MindosMcpInstallResult[] = [];

    for (const item of body.agents ?? []) {
      const { key, scope } = item;
      const serverName = item.serverName?.trim() || 'mindos';
      assertSafeMcpServerName(serverName);
      const adapter = registry.get(key);
      if (!adapter) {
        results.push(unknownAgent(key));
        continue;
      }

      try {
        const removal = adapter.removeServer(serverName, scope);
        if (!removal.existedAnywhere) {
          results.push({ agent: key, status: 'ok', message: 'Config file does not exist' });
        } else if (removal.errors.length > 0) {
          results.push({ agent: key, status: 'error', message: removal.errors.join('; ') });
        } else {
          results.push(withWarnings(
            { agent: key, status: 'ok', path: removal.updatedPaths[0] ?? adapter.configPaths(scope)[0] },
            removal.warnings,
          ));
        }
      } catch (error) {
        results.push({ agent: key, status: 'error', message: error instanceof AgentConfigScopeError ? error.message : String(error) });
      }
    }

    notifyMcpChanged(services, results);
    return json({ results });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Verify the saved connection without rewriting or launching the external Agent. */
export async function handleMcpVerifyPost(
  body: { key?: string; scope?: AgentConfigScope; projectRoot?: string },
  services: MindosMcpInstallServices,
): Promise<MindosServerResponse> {
  if (!body || typeof body.key !== 'string' || !['global', 'project'].includes(body.scope ?? 'global')) return json({ error: 'Invalid agent or scope' }, { status: 400 });
  const root = resolveRequestProjectRoot(body, services);
  if ('error' in root) return json(root, { status: 400 });
  try {
    const adapter = adaptersFor(services.agents, { homeDir: services.homeDir, ...root }).get(body.key);
    if (!adapter) return json({ error: 'Unknown agent' }, { status: 404 });
    const saved = adapter.readServer('mindos', { scope: body.scope ?? 'global', strict: true });
    if (!saved) return json({ error: 'No MindOS configuration in this scope. Save it first.' }, { status: 404 });
    if (saved.transport !== 'http' || !saved.url) return json({ transport: saved.transport, verified: false, verifyError: 'Open the Agent and check its MCP tools to verify this stdio connection.' });
    const headers = saved.entry.http_headers ?? saved.entry.headers ?? {};
    if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.values(headers).some(v => typeof v !== 'string')) return json({ error: 'Invalid MCP headers' }, { status: 400 });
    if (/\$\{|\{env:/.test(JSON.stringify(headers)) || saved.entry.bearer_token_env_var || saved.entry.env_http_headers || saved.entry.oauth) {
      return json({ verified: false, verifyError: 'Verify authentication in the Agent; this connection uses Agent-owned credentials.' });
    }
    return json({ transport: 'http', ...await verifyHttpConnection(saved.url, undefined, services.fetcher, headers as Record<string, string>) });
  } catch {
    return json({ error: 'Could not read the saved MCP configuration. Check the file syntax and permissions.' }, { status: 400 });
  }
}
