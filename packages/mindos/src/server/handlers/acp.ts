import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  detectLocalAcpAgents as defaultDetectLocalAcpAgents,
  fetchAcpRegistry as defaultFetchAcpRegistry,
  findAcpAgent as defaultFindAcpAgent,
  createSession as defaultCreateSession,
  loadSession as defaultLoadSession,
  listSessions as defaultListSessions,
  closeSession as defaultCloseSession,
  prompt as defaultPrompt,
  cancelPrompt as defaultCancelPrompt,
  setMode as defaultSetMode,
  setConfigOption as defaultSetConfigOption,
  getSession as defaultGetSession,
  getActiveSessions as defaultGetActiveSessions,
  type AcpAgentOverride,
} from '../../protocols/acp/index.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';

export type AcpSettings = {
  acpAgents?: Record<string, AcpAgentOverride>;
};

export type AcpConfigServices = {
  readSettings(): AcpSettings;
  writeSettings(settings: AcpSettings): void;
};

export type AcpDetectServices = {
  readSettings?(): AcpSettings;
  detectLocalAcpAgents?(options?: { overrides?: Record<string, AcpAgentOverride> }): Promise<{
    installed: unknown[];
    notInstalled: unknown[];
  }>;
  now?(): number;
};

export type AcpInstallServices = {
  installPackage?(agentId: string, packageName: string): Promise<{
    status: 'installing';
    agentId: string;
    packageName: string;
  }>;
};

export type AcpRegistryServices = {
  fetchAcpRegistry?(): Promise<unknown | null>;
  findAcpAgent?(agentId: string): Promise<unknown | null>;
};

export type AcpSessionServices = {
  createSession?(agentId: string, options?: { env?: Record<string, string>; cwd?: string }): Promise<unknown>;
  loadSession?(agentId: string, sessionId: string, options?: { env?: Record<string, string>; cwd?: string }): Promise<unknown>;
  listSessions?(sessionId: string, options?: { cursor?: string; cwd?: string }): Promise<unknown>;
  closeSession?(sessionId: string): Promise<unknown>;
  prompt?(sessionId: string, text: string): Promise<unknown>;
  cancelPrompt?(sessionId: string): Promise<unknown>;
  setMode?(sessionId: string, modeId: string): Promise<unknown>;
  setConfigOption?(sessionId: string, configId: string, value: string): Promise<unknown>;
  getSession?(sessionId: string): unknown | null;
  getActiveSessions?(): unknown[];
};

export type AcpServices =
  & Partial<AcpConfigServices>
  & AcpDetectServices
  & AcpInstallServices
  & AcpRegistryServices
  & AcpSessionServices;

const DETECT_CACHE_TTL_MS = 30 * 60 * 1000;
let detectCache: { data: { installed: unknown[]; notInstalled: unknown[] }; ts: number } | null = null;

function isUnsafeObjectKey(key: string): boolean {
  return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

function isValidAcpAgentId(agentId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(agentId) && !isUnsafeObjectKey(agentId);
}

function readAcpAgentId(body: unknown, key = 'agentId'): string | null {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isValidAcpAgentId(trimmed) ? trimmed : null;
}

function isValidEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !isUnsafeObjectKey(key);
}

export type MindosNpmInvocation = {
  command: string;
  args: string[];
};

export type MindosNpmInvocationOptions = {
  platform?: NodeJS.Platform;
  nodeExecPath?: string;
  env?: NodeJS.ProcessEnv;
  pathExists?: (path: string) => boolean;
};

export function handleAcpConfigGet(
  services: AcpConfigServices,
): MindosServerResponse<{ agents: Record<string, AcpAgentOverride> }> {
  const settings = services.readSettings();
  return json({ agents: sanitizeAcpAgentOverrides(settings.acpAgents) ?? {} });
}

export function handleAcpConfigPost(
  body: unknown,
  services: AcpConfigServices,
): MindosServerResponse<{ ok: true; agents: Record<string, AcpAgentOverride> } | { error: string }> {
  const payload = body && typeof body === 'object' ? body as { agentId?: unknown; config?: unknown } : {};
  const agentId = readAcpAgentId(payload);
  if (!agentId) {
    return json({ error: 'agentId is required' }, { status: 400 });
  }

  const settings = services.readSettings();
  const existing = { ...(sanitizeAcpAgentOverrides(settings.acpAgents) ?? {}) };
  const sanitized = sanitizeAcpAgentOverride(payload.config);
  if (sanitized) {
    existing[agentId] = sanitized;
  }

  services.writeSettings({ ...settings, acpAgents: existing });
  return json({ ok: true, agents: existing });
}

export function handleAcpConfigDelete(
  body: unknown,
  services: AcpConfigServices,
): MindosServerResponse<{ ok: true; agents: Record<string, AcpAgentOverride> } | { error: string }> {
  const payload = body && typeof body === 'object' ? body as { agentId?: unknown } : {};
  const agentId = readAcpAgentId(payload);
  if (!agentId) {
    return json({ error: 'agentId is required' }, { status: 400 });
  }

  const settings = services.readSettings();
  const existing = { ...(sanitizeAcpAgentOverrides(settings.acpAgents) ?? {}) };
  delete existing[agentId];
  const next = Object.keys(existing).length > 0
    ? { ...settings, acpAgents: existing }
    : { ...settings, acpAgents: undefined };
  services.writeSettings(next);
  return json({ ok: true, agents: next.acpAgents ?? {} });
}

export async function handleAcpDetectGet(
  searchParams: URLSearchParams,
  services: AcpDetectServices = {},
): Promise<MindosServerResponse<{ installed: unknown[]; notInstalled: unknown[] } | { error: string }>> {
  try {
    const force = searchParams.get('force') === '1';
    const now = services.now?.() ?? Date.now();
    if (!force && detectCache && now - detectCache.ts < DETECT_CACHE_TTL_MS) {
      return json(detectCache.data);
    }

    const detectLocalAcpAgents = services.detectLocalAcpAgents ?? defaultDetectLocalAcpAgents;
    const data = await detectLocalAcpAgents({ overrides: readAcpAgentOverrides(services) });
    detectCache = { data, ts: now };
    return json(data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleAcpInstallPost(
  body: unknown,
  services: AcpInstallServices = {},
): Promise<MindosServerResponse<{ status: 'installing'; agentId: string; packageName: string } | { error: string }>> {
  try {
    const payload = body && typeof body === 'object' ? body as { agentId?: unknown; packageName?: unknown } : {};
    const agentId = readAcpAgentId(payload);
    if (!agentId || !payload.packageName || typeof payload.packageName !== 'string') {
      return json({ error: 'agentId and packageName are required' }, { status: 400 });
    }
    if (!isValidNpmPackageName(payload.packageName)) {
      return json({ error: 'Invalid package name' }, { status: 400 });
    }

    const installPackage = services.installPackage ?? defaultInstallPackage;
    return json(await installPackage(agentId, payload.packageName));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleAcpRegistryGet(
  searchParams: URLSearchParams,
  services: AcpRegistryServices = {},
): Promise<MindosServerResponse<{ registry: unknown } | { agent: unknown } | { error: string; agent?: null; registry?: null }>> {
  try {
    const agentId = searchParams.get('agent');
    if (agentId) {
      if (!isValidAcpAgentId(agentId.trim())) return json({ error: 'Invalid agent id', agent: null }, { status: 400 });
      const findAcpAgent = services.findAcpAgent ?? defaultFindAcpAgent;
      const agent = await findAcpAgent(agentId.trim());
      if (!agent) return json({ error: 'Agent not found', agent: null }, { status: 404 });
      return json({ agent });
    }

    const fetchAcpRegistry = services.fetchAcpRegistry ?? defaultFetchAcpRegistry;
    const registry = await fetchAcpRegistry();
    if (!registry) return json({ error: 'Failed to fetch registry', registry: null }, { status: 502 });
    return json({ registry });
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleAcpSessionGet(
  services: AcpSessionServices = {},
): MindosServerResponse<{ sessions: unknown[] } | { error: string }> {
  try {
    return json({ sessions: (services.getActiveSessions ?? defaultGetActiveSessions)() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleAcpSessionPost(
  body: unknown,
  services: AcpSessionServices = {},
): Promise<MindosServerResponse<Record<string, unknown> | { error: string }>> {
  try {
    const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const action = typeof payload.action === 'string' ? payload.action : 'create';

    switch (action) {
      case 'create':
        return await handleAcpSessionCreate(payload, services);
      case 'load':
        return await handleAcpSessionLoad(payload, services);
      case 'prompt':
        return await handleAcpSessionPrompt(payload, services);
      case 'cancel':
        return await handleAcpSessionCancel(payload, services);
      case 'set_mode':
        return await handleAcpSessionSetMode(payload, services);
      case 'set_config':
        return await handleAcpSessionSetConfig(payload, services);
      case 'list_sessions':
        return await handleAcpSessionList(payload, services);
      default:
        return json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return acpSessionErrorResponse(error);
  }
}

export async function handleAcpSessionDelete(
  body: unknown,
  services: AcpSessionServices = {},
): Promise<MindosServerResponse<{ ok: true } | { error: string }>> {
  try {
    const sessionId = readString(body, 'sessionId');
    if (!sessionId) return json({ error: 'sessionId is required' }, { status: 400 });

    const getSession = services.getSession ?? defaultGetSession;
    if (!getSession(sessionId)) return json({ error: 'Session not found' }, { status: 404 });

    await (services.closeSession ?? defaultCloseSession)(sessionId);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

function sanitizeAcpAgentOverride(input: unknown): AcpAgentOverride | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const config = input as AcpAgentOverride;
  const sanitized: AcpAgentOverride = {};

  if (typeof config.command === 'string' && config.command.trim()) {
    sanitized.command = config.command.trim();
  }
  if (Array.isArray(config.args)) {
    sanitized.args = config.args.filter((arg): arg is string => typeof arg === 'string');
  }
  if (config.env && typeof config.env === 'object' && !Array.isArray(config.env)) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.env)) {
      if (typeof value === 'string' && isValidEnvKey(key)) env[key] = value;
    }
    if (Object.keys(env).length > 0) sanitized.env = env;
  }
  if (typeof config.enabled === 'boolean') {
    sanitized.enabled = config.enabled;
  }

  return sanitized;
}

function sanitizeAcpAgentOverrides(input: unknown): Record<string, AcpAgentOverride> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const result: Record<string, AcpAgentOverride> = {};
  for (const [agentId, config] of Object.entries(input)) {
    if (!isValidAcpAgentId(agentId)) continue;
    const sanitized = sanitizeAcpAgentOverride(config);
    if (sanitized) result[agentId] = sanitized;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function readAcpAgentOverrides(services: AcpDetectServices): Record<string, AcpAgentOverride> | undefined {
  try {
    const settings = services.readSettings?.();
    return sanitizeAcpAgentOverrides(settings?.acpAgents);
  } catch {
    return undefined;
  }
}

function isValidNpmPackageName(packageName: string): boolean {
  const value = packageName.trim();
  if (value.length === 0 || value.length > 214 || value.includes('\\')) return false;
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(value);
}

async function defaultInstallPackage(agentId: string, packageName: string) {
  const invocation = resolveNpmInvocation(['install', '-g', packageName]);
  const child = execFile(invocation.command, invocation.args, { timeout: 120_000 });
  child.unref();
  return { status: 'installing' as const, agentId, packageName };
}

export function resolveNpmInvocation(
  args: string[],
  options: MindosNpmInvocationOptions = {},
): MindosNpmInvocation {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return { command: 'npm', args };

  const env = options.env ?? process.env;
  const nodeExecPath = options.nodeExecPath ?? process.execPath;
  const pathExists = options.pathExists ?? existsSync;
  const npmCliPath = findNpmCliPath(nodeExecPath, env, pathExists);
  if (!npmCliPath) {
    throw new Error('Unable to locate npm-cli.js for shell-free ACP package installation on Windows');
  }
  return { command: nodeExecPath, args: [npmCliPath, ...args] };
}

function findNpmCliPath(
  nodeExecPath: string,
  env: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean,
): string | null {
  const candidates = new Set<string>();
  if (env.npm_execpath) {
    if (env.npm_execpath.endsWith('npm-cli.js')) {
      candidates.add(env.npm_execpath);
    } else {
      candidates.add(join(dirname(env.npm_execpath), 'npm-cli.js'));
    }
  }

  const nodeDir = dirname(nodeExecPath);
  candidates.add(join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  candidates.add(resolve(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));

  for (const candidate of candidates) {
    if (pathExists(candidate)) return candidate;
  }
  return null;
}

async function handleAcpSessionCreate(payload: Record<string, unknown>, services: AcpSessionServices) {
  const agentId = readAcpAgentId(payload);
  if (!agentId) return json({ error: 'agentId is required' }, { status: 400 });

  const options = {
    env: readStringRecord(payload.env),
    cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined,
  };
  const createSession = services.createSession ?? defaultCreateSession;
  const session = await createSession(agentId, options);
  const promptText = typeof payload.prompt === 'string' ? payload.prompt : undefined;
  if (!promptText) return json({ session });

  const prompt = services.prompt ?? defaultPrompt;
  const closeSession = services.closeSession ?? defaultCloseSession;
  try {
    const response = await prompt(readSessionId(session), promptText);
    await closeSession(readSessionId(session)).catch(() => {});
    return json({ session, response });
  } catch (error) {
    await closeSession(readSessionId(session)).catch(() => {});
    return errorResponse(error);
  }
}

async function handleAcpSessionLoad(payload: Record<string, unknown>, services: AcpSessionServices) {
  const agentId = readAcpAgentId(payload);
  const sessionId = readString(payload, 'sessionId');
  if (!agentId) return json({ error: 'agentId is required' }, { status: 400 });
  if (!sessionId) return json({ error: 'sessionId is required' }, { status: 400 });

  const session = await (services.loadSession ?? defaultLoadSession)(agentId, sessionId, {
    env: readStringRecord(payload.env),
    cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined,
  });
  return json({ session });
}

async function handleAcpSessionPrompt(payload: Record<string, unknown>, services: AcpSessionServices) {
  const sessionId = readString(payload, 'sessionId');
  const text = readString(payload, 'text');
  if (!sessionId) return json({ error: 'sessionId is required' }, { status: 400 });
  if (!text) return json({ error: 'text is required' }, { status: 400 });

  const response = await (services.prompt ?? defaultPrompt)(sessionId, text);
  return json({ response });
}

async function handleAcpSessionCancel(payload: Record<string, unknown>, services: AcpSessionServices) {
  const sessionId = readString(payload, 'sessionId');
  if (!sessionId) return json({ error: 'sessionId is required' }, { status: 400 });
  await (services.cancelPrompt ?? defaultCancelPrompt)(sessionId);
  return json({ ok: true });
}

async function handleAcpSessionSetMode(payload: Record<string, unknown>, services: AcpSessionServices) {
  const sessionId = readString(payload, 'sessionId');
  const modeId = readString(payload, 'modeId');
  if (!sessionId || !modeId) return json({ error: 'sessionId and modeId are required' }, { status: 400 });
  await (services.setMode ?? defaultSetMode)(sessionId, modeId);
  return json({ ok: true });
}

async function handleAcpSessionSetConfig(payload: Record<string, unknown>, services: AcpSessionServices) {
  const sessionId = readString(payload, 'sessionId');
  const configId = readString(payload, 'configId');
  if (!sessionId || !configId || payload.value === undefined) {
    return json({ error: 'sessionId, configId, and value are required' }, { status: 400 });
  }
  const configOptions = await (services.setConfigOption ?? defaultSetConfigOption)(sessionId, configId, String(payload.value));
  return json({ configOptions });
}

async function handleAcpSessionList(payload: Record<string, unknown>, services: AcpSessionServices) {
  const sessionId = readString(payload, 'sessionId');
  if (!sessionId) return json({ error: 'sessionId is required' }, { status: 400 });
  const result = await (services.listSessions ?? defaultListSessions)(sessionId, {
    cursor: typeof payload.cursor === 'string' ? payload.cursor : undefined,
    cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined,
  });
  return json(result as Record<string, unknown>);
}

function acpSessionErrorResponse(error: unknown): MindosServerResponse<{ error: string }> {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  const status = message.includes('not found') ? 404 : message.includes('not support') ? 501 : 500;
  return json({ error: message }, { status });
}

function readString(body: unknown, key: string): string | undefined {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' && value ? value : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && isValidEnvKey(key)) record[key] = entry;
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

function readSessionId(session: unknown): string {
  if (session && typeof session === 'object' && typeof (session as { id?: unknown }).id === 'string') {
    return (session as { id: string }).id;
  }
  throw new Error('ACP session response did not include an id');
}
