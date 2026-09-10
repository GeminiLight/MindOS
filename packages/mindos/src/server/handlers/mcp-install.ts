import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import type { MindosServerEventEmitter } from '../events/bus.js';
import { expandHome } from '../../foundation/shared/utils/path.js';
import {
  assertSafeMcpServerName,
  detectConfigFormat,
  readMcpServerEntryFromText,
  removeMcpServerEntryFromFile,
  writeMcpServerEntryToFile,
  type McpServerEntryLocation,
} from './mcp-config-formats.js';

export type MindosMcpAgentDef = {
  name: string;
  project: string | null;
  global: string;
  projectReadAlso?: string[];
  globalReadAlso?: string[];
  key: string;
  preferredTransport: 'stdio' | 'http';
  format?: 'json' | 'toml' | 'yaml';
  globalNestedKey?: string;
  entryStyle?: 'standard' | 'kilo';
};

export type MindosSkillAgentRegistration = {
  mode: 'universal' | 'additional' | 'unsupported';
  skillAgentName?: string;
};

export type MindosSkillWorkspaceProfile = {
  mode: 'universal' | 'additional' | 'unsupported';
  skillAgentName?: string;
  workspacePath: string;
};

export type MindosMcpInstallItem = {
  key: string;
  scope: 'project' | 'global';
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
    scope: 'project' | 'global';
    serverName?: string;
  }>;
  projectRoot?: string;
};

export type MindosMcpServerCopyTarget = {
  key: string;
  scope?: 'project' | 'global';
  overwrite?: boolean;
};

export type MindosMcpServerCopyRequest = {
  serverName?: string;
  sourceAgentKey?: string;
  sourceScope?: 'project' | 'global';
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

function configPathCandidates(agent: MindosMcpAgentDef, scope: 'global' | 'project'): string[] {
  const primary = scope === 'global' ? agent.global : agent.project;
  const readAlso = scope === 'global' ? agent.globalReadAlso : agent.projectReadAlso;
  return [primary, ...(readAlso ?? [])].filter((entry): entry is string => !!entry);
}

/** A relative project-scoped config path was asked for without any project root to anchor it. */
export class AgentConfigProjectRootError extends Error {
  readonly status = 400;

  constructor(configPath: string) {
    super(`Project-scoped agent config "${configPath}" needs a project root; pass projectRoot or install into global scope.`);
    this.name = 'AgentConfigProjectRootError';
  }
}

export type AgentConfigPathServices = {
  homeDir?: string;
  projectRoot?: string;
};

/**
 * Absolute location of one agent config path. Global paths only expand `~`.
 * Relative project paths (`.mcp.json`, `.cursor/mcp.json`) resolve against
 * the explicit project root and never against `process.cwd()`: the Web
 * server's cwd is its runtime directory, not anything the user calls a project.
 */
export function resolveAgentConfigPath(
  configPath: string,
  scope: 'project' | 'global',
  services: AgentConfigPathServices,
): string {
  const expanded = expandHome(configPath, services.homeDir);
  if (scope !== 'project' || isAbsolute(expanded)) return expanded;
  const root = services.projectRoot?.trim();
  if (!root || !isAbsolute(root)) throw new AgentConfigProjectRootError(configPath);
  return resolve(root, expanded);
}

/** True when `configPath` at `scope` cannot be resolved without a project root. */
export function agentConfigPathNeedsProjectRoot(configPath: string, scope: 'project' | 'global', homeDir?: string): boolean {
  return scope === 'project' && !isAbsolute(expandHome(configPath, homeDir));
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
  items: Array<{ key: string; scope: 'project' | 'global' }>,
  agents: Record<string, MindosMcpAgentDef>,
  services: AgentConfigPathServices,
): string | null {
  if (services.projectRoot && isAbsolute(services.projectRoot)) return null;
  for (const item of items) {
    const agent = agents[item.key];
    if (!agent || item.scope !== 'project') continue;
    const needsRoot = configPathCandidates(agent, 'project')
      .some((configPath) => agentConfigPathNeedsProjectRoot(configPath, 'project', services.homeDir));
    if (needsRoot) return `${agent.name} project scope needs a project root; pass projectRoot or install into global scope.`;
  }
  return null;
}

/**
 * Where `agent` keeps its servers map for `scope`. Only the global config of
 * CoPaw-style agents nests the map under a dotted path (`mcp.clients`).
 */
function entryLocation(agent: MindosMcpAgentDef, scope: 'project' | 'global'): McpServerEntryLocation {
  return {
    format: detectConfigFormat(agent.format),
    sectionKey: agent.key,
    nestedPath: scope === 'global' ? agent.globalNestedKey : undefined,
  };
}

function buildEntry(
  transport: 'stdio' | 'http',
  agent: MindosMcpAgentDef,
  services: MindosMcpInstallServices,
  url?: string,
  token?: string,
): Record<string, unknown> {
  if (agent.entryStyle === 'kilo') {
    if (transport === 'stdio') {
      return {
        type: 'local',
        command: ['mindos', 'mcp'],
        environment: { MCP_TRANSPORT: 'stdio' },
        enabled: true,
      };
    }
    const fallbackPort = Number(services.env?.MINDOS_MCP_PORT) || services.readSettings?.().mcpPort || 8781;
    const entry: Record<string, unknown> = {
      type: 'remote',
      // 127.0.0.1 (not localhost): the MCP server binds an IPv4 socket and some
      // Windows HTTP stacks resolve localhost to ::1 first without fallback
      url: url || `http://127.0.0.1:${fallbackPort}/mcp`,
      enabled: true,
    };
    if (token) entry.headers = { Authorization: `Bearer ${token}` };
    return entry;
  }

  if (transport === 'stdio') {
    return { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } };
  }
  const fallbackPort = Number(services.env?.MINDOS_MCP_PORT) || services.readSettings?.().mcpPort || 8781;
  // 127.0.0.1 (not localhost) — see remote-entry comment above
  const entry: Record<string, unknown> = { url: url || `http://127.0.0.1:${fallbackPort}/mcp` };
  if (token) entry.headers = { Authorization: `Bearer ${token}` };
  return entry;
}

function findMcpServerEntry(
  agent: MindosMcpAgentDef,
  serverName: string,
  services: AgentConfigPathServices,
  sourceScope?: 'project' | 'global',
): { entry: Record<string, unknown>; path: string; scope: 'project' | 'global' } | null {
  const scopes = sourceScope ? [sourceScope] : (['global', 'project'] as const);
  for (const scope of scopes) {
    for (const configPath of configPathCandidates(agent, scope)) {
      // A lookup without a project root simply cannot see relative project configs.
      if (agentConfigPathNeedsProjectRoot(configPath, scope, services.homeDir) && !services.projectRoot) continue;
      const absPath = resolveAgentConfigPath(configPath, scope, services);
      if (!existsSync(absPath)) continue;
      const entry = readMcpServerEntryFromText(readFileSync(absPath, 'utf-8'), entryLocation(agent, scope), serverName);
      if (entry) return { entry, path: configPath, scope };
    }
  }
  return null;
}

function writeMcpServerEntry(
  agentKey: string,
  agent: MindosMcpAgentDef,
  scope: 'project' | 'global',
  serverName: string,
  entry: Record<string, unknown>,
  overwrite: boolean,
  services: AgentConfigPathServices,
): MindosMcpInstallResult {
  assertSafeMcpServerName(serverName);
  const configPath = scope === 'global' ? agent.global : agent.project;
  if (!configPath) {
    return { agent: agentKey, status: 'error', message: `${agent.name} does not support ${scope} scope` };
  }

  const absPath = resolveAgentConfigPath(configPath, scope, services);
  mkdirSync(dirname(absPath), { recursive: true });
  const existing = existsSync(absPath) ? readFileSync(absPath, 'utf-8') : '';
  const location = entryLocation(agent, scope);
  const existingEntry = existing.trim() ? readMcpServerEntryFromText(existing, location, serverName) : null;
  if (existingEntry && !overwrite) {
    return { agent: agentKey, status: 'ok', path: configPath, message: 'Already configured' };
  }

  const warnings = writeMcpServerEntryToFile(absPath, existing, location, serverName, entry);
  return withWarnings({ agent: agentKey, status: 'ok', path: configPath }, warnings);
}

async function verifyHttpConnection(
  mcpUrl: string,
  token: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<{ verified: boolean; verifyError?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetcher(mcpUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        signal: controller.signal,
      });
      if (res.ok) return { verified: true };
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
    const pathServices: AgentConfigPathServices = { homeDir: services.homeDir, projectRoot: root.projectRoot };
    const missingRoot = missingProjectRootError(body.agents ?? [], services.agents, pathServices);
    if (missingRoot) return json({ error: missingRoot }, { status: 400 });

    const results: MindosMcpInstallResult[] = [];
    const globalTransport = body.transport ?? 'auto';

    for (const item of body.agents ?? []) {
      const { key, scope } = item;
      const agent = services.agents[key];
      if (!agent) {
        results.push({ agent: key, status: 'error', message: `Unknown agent: ${key}` });
        continue;
      }

      const effectiveTransport = item.transport && item.transport !== 'auto'
        ? item.transport
        : globalTransport !== 'auto'
          ? globalTransport
          : agent.preferredTransport;
      const configPath = scope === 'global' ? agent.global : agent.project;
      if (!configPath) {
        results.push({ agent: key, status: 'error', message: `${agent.name} does not support ${scope} scope` });
        continue;
      }

      if (services.requireAgentPresence && !services.detectAgentPresence?.(key)) {
        results.push({
          agent: key,
          status: 'error',
          message: `${agent.name} was not detected on this machine. Install the agent first, then refresh.`,
        });
        continue;
      }

      const absPath = resolveAgentConfigPath(configPath, scope, pathServices);
      const entry = buildEntry(effectiveTransport, agent, services, body.url, body.token);

      try {
        mkdirSync(dirname(absPath), { recursive: true });
        const existing = existsSync(absPath) ? readFileSync(absPath, 'utf-8') : '';
        const warnings = writeMcpServerEntryToFile(absPath, existing, entryLocation(agent, scope), 'mindos', entry);

        const result: MindosMcpInstallResult = withWarnings(
          { agent: key, status: 'ok', path: configPath, transport: effectiveTransport },
          warnings,
        );

        if (effectiveTransport === 'http') {
          const verification = await verifyHttpConnection(String(entry.url), body.token, services.fetcher);
          result.verified = verification.verified;
          if (verification.verifyError) result.verifyError = verification.verifyError;
        }

        results.push(result);
      } catch (error) {
        results.push({ agent: key, status: 'error', message: String(error) });
      }
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
    const pathServices: AgentConfigPathServices = { homeDir: services.homeDir, projectRoot: root.projectRoot };
    const missingRoot = missingProjectRootError(
      targets.map((target) => ({ key: target.key, scope: target.scope ?? 'global' })),
      services.agents,
      pathServices,
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
    const sourceAgent = services.agents[sourceKey];
    if (!sourceAgent) return json({ error: `Unknown source agent: ${sourceKey}` }, { status: 404 });

    const source = findMcpServerEntry(sourceAgent, serverName, pathServices, body.sourceScope);
    if (!source) {
      return json({ error: `MCP server "${serverName}" was not found in ${sourceAgent.name}` }, { status: 404 });
    }

    const results: MindosMcpInstallResult[] = [];
    for (const target of targets) {
      const targetAgent = services.agents[target.key];
      if (!targetAgent) {
        results.push({ agent: target.key, status: 'error', message: `Unknown agent: ${target.key}` });
        continue;
      }
      if (services.requireAgentPresence && !services.detectAgentPresence?.(target.key)) {
        results.push({
          agent: target.key,
          status: 'error',
          message: `${targetAgent.name} was not detected on this machine. Install the agent first, then refresh.`,
        });
        continue;
      }

      try {
        results.push(writeMcpServerEntry(
          target.key,
          targetAgent,
          target.scope ?? 'global',
          serverName,
          source.entry,
          target.overwrite === true,
          pathServices,
        ));
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
    const pathServices: AgentConfigPathServices = { homeDir: services.homeDir, projectRoot: root.projectRoot };
    const missingRoot = missingProjectRootError(body.agents ?? [], services.agents, pathServices);
    if (missingRoot) return json({ error: missingRoot }, { status: 400 });

    const results: MindosMcpInstallResult[] = [];

    for (const item of body.agents ?? []) {
      const { key, scope } = item;
      const serverName = item.serverName?.trim() || 'mindos';
      assertSafeMcpServerName(serverName);
      const agent = services.agents[key];
      if (!agent) {
        results.push({ agent: key, status: 'error', message: `Unknown agent: ${key}` });
        continue;
      }

      const configPaths = configPathCandidates(agent, scope);
      if (configPaths.length === 0) {
        results.push({ agent: key, status: 'error', message: `${agent.name} does not support ${scope} scope` });
        continue;
      }

      const existingPaths = configPaths.filter((configPath) => existsSync(resolveAgentConfigPath(configPath, scope, pathServices)));
      if (existingPaths.length === 0) {
        results.push({ agent: key, status: 'ok', message: 'Config file does not exist' });
        continue;
      }

      const location = entryLocation(agent, scope);
      const updatedPaths: string[] = [];
      const errors: string[] = [];
      const warnings: string[] = [];
      try {
        for (const configPath of existingPaths) {
          const absPath = resolveAgentConfigPath(configPath, scope, pathServices);
          try {
            const existing = readFileSync(absPath, 'utf-8');
            warnings.push(...removeMcpServerEntryFromFile(absPath, existing, location, serverName));
            updatedPaths.push(configPath);
          } catch (error) {
            errors.push(`${configPath}: ${String(error)}`);
          }
        }

        if (errors.length > 0) {
          results.push({ agent: key, status: 'error', message: errors.join('; ') });
        } else {
          results.push(withWarnings({ agent: key, status: 'ok', path: updatedPaths[0] ?? configPaths[0] }, warnings));
        }
      } catch (error) {
        results.push({ agent: key, status: 'error', message: String(error) });
      }
    }

    notifyMcpChanged(services, results);
    return json({ results });
  } catch (error) {
    return errorResponse(error);
  }
}
