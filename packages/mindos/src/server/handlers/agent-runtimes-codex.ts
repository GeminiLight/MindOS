import { createHash } from 'node:crypto';
import {
  createCodexAppServerClient,
  createCodexAppServerStdioTransport,
  type CodexAppServerClient,
  type CodexModelListResult,
  type CodexThreadForkInput,
  type CodexThreadListInput,
  type CodexThreadListResult,
  type CodexThreadReadResult,
  type CodexThreadForkResult,
} from '../../agent/runtime/codex-app-server.js';
import { deleteProcessGlobal, getProcessGlobal } from '../../agent/global-state.js';
import { compactRuntimeFailureMessage } from '../../agent/runtime/runtime-errors.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import {
  getNativeRuntimeDetection,
  type AgentRuntimeDetectionServices,
  type AgentRuntimesServices,
  type NativeRuntimeHealthResult,
} from './agent-runtimes.js';

export type CodexThreadManagerServices = {
  /** Host-owned client: one per request, the host controls its lifecycle. */
  createCodexClient?(): CodexAppServerClient | Promise<CodexAppServerClient>;
  /** Factory behind the product client pool (tests inject a fake); defaults to the stdio app-server transport. */
  createPooledCodexClient?(input: { command: string; env?: NodeJS.ProcessEnv }): CodexAppServerClient;
  resolveRuntimeCommand?(command: string): Promise<string | null>;
  resolveRuntimeCommandCandidates?: AgentRuntimesServices['resolveRuntimeCommandCandidates'];
  readSettings?: AgentRuntimesServices['readSettings'];
  checkCodexRuntimeHealth?(binaryPath: string, env?: NodeJS.ProcessEnv): Promise<NativeRuntimeHealthResult>;
  /** Shares the detection-cache bucket with the runtime routes (see `RuntimeDetectionServices`). */
  detectionIdentity?: string;
  now?(): number;
};

export type CodexThreadListPayload = CodexThreadListResult;
export type CodexThreadReadPayload = CodexThreadReadResult;
export type CodexThreadForkPayload = CodexThreadForkResult;
export type CodexModelListPayload = CodexModelListResult;

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const MAX_THREAD_LIST_LIMIT = 100;

export async function handleCodexModelsGet(
  services: CodexThreadManagerServices = {},
): Promise<MindosServerResponse<CodexModelListPayload | { error: string }>> {
  try {
    return json(await withCodexClient(services, (client) => client.listModels({
      includeHidden: true,
      limit: 100,
    })), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return codexThreadErrorResponse(error);
  }
}

export async function handleCodexThreadsGet(
  searchParams: URLSearchParams,
  services: CodexThreadManagerServices = {},
): Promise<MindosServerResponse<CodexThreadListPayload | { error: string }>> {
  try {
    const parsed = parseThreadListParams(searchParams);
    if ('error' in parsed) return badRequest(parsed.error);
    return json(await withCodexClient(services, (client) => client.listThreads(parsed)), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return codexThreadErrorResponse(error);
  }
}

export async function handleCodexThreadGet(
  threadId: string,
  searchParams: URLSearchParams,
  services: CodexThreadManagerServices = {},
): Promise<MindosServerResponse<CodexThreadReadPayload | { error: string }>> {
  try {
    const normalizedThreadId = normalizeThreadId(threadId);
    if (!normalizedThreadId) return badRequest('Missing Codex thread id.');
    return json(await withCodexClient(services, (client) => client.readThread({
      threadId: normalizedThreadId,
      includeTurns: parseBoolean(searchParams.get('includeTurns')) ?? false,
    })), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return codexThreadErrorResponse(error);
  }
}

export async function handleCodexThreadForkPost(
  threadId: string,
  body: unknown,
  services: CodexThreadManagerServices = {},
): Promise<MindosServerResponse<CodexThreadForkPayload | { error: string }>> {
  try {
    const normalizedThreadId = normalizeThreadId(threadId);
    if (!normalizedThreadId) return badRequest('Missing Codex thread id.');
    const input = normalizeForkInput(normalizedThreadId, body);
    return json(await withCodexClient(services, (client) => client.forkThread(input)), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return codexThreadErrorResponse(error);
  }
}

export async function handleCodexThreadArchivePost(
  threadId: string,
  services: CodexThreadManagerServices = {},
): Promise<MindosServerResponse<{ ok: true } | { error: string }>> {
  try {
    const normalizedThreadId = normalizeThreadId(threadId);
    if (!normalizedThreadId) return badRequest('Missing Codex thread id.');
    await withCodexClient(services, (client) => client.archiveThread({ threadId: normalizedThreadId }));
    return json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return codexThreadErrorResponse(error);
  }
}

export async function handleCodexThreadUnarchivePost(
  threadId: string,
  services: CodexThreadManagerServices = {},
): Promise<MindosServerResponse<CodexThreadReadPayload | { error: string }>> {
  try {
    const normalizedThreadId = normalizeThreadId(threadId);
    if (!normalizedThreadId) return badRequest('Missing Codex thread id.');
    return json(await withCodexClient(services, (client) => client.unarchiveThread({ threadId: normalizedThreadId })), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return codexThreadErrorResponse(error);
  }
}

class CodexThreadRuntimeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexThreadRuntimeUnavailableError';
  }
}

function codexThreadErrorResponse(error: unknown): MindosServerResponse<{ error: string }> {
  const status = error instanceof CodexThreadRuntimeUnavailableError ? 409 : 500;
  const message = error instanceof Error ? error.message : String(error);
  const compactError = new Error(compactRuntimeFailureMessage(message, {
    runtime: 'codex',
    fallback: 'Codex app-server error',
  }));
  if (error instanceof Error) compactError.name = error.name;
  return errorResponse(compactError, status);
}

async function withCodexClient<T>(
  services: CodexThreadManagerServices,
  run: (client: CodexAppServerClient) => Promise<T>,
): Promise<T> {
  if (services.createCodexClient) {
    const client = await services.createCodexClient();
    try {
      await client.initialize();
      return await run(client);
    } finally {
      await client.close?.();
    }
  }

  const runtime = await ensureCodexThreadRuntimeAvailable(services);
  const entry = await acquirePooledCodexClient({
    command: runtime.binaryPath,
    env: runtime.env,
    factory: services.createPooledCodexClient ?? createDefaultPooledCodexClient,
  });
  let failed = false;
  try {
    return await run(entry.client);
  } catch (error) {
    // A rejected request may mean the app-server died; a fresh process on the next request is cheaper than a stuck one.
    failed = true;
    throw error;
  } finally {
    releasePooledCodexClient(entry, { failed });
  }
}

/** Health-check wrappers are memoised per host function so consecutive requests share one detection-cache bucket. */
const healthCheckAdapters = new WeakMap<NonNullable<CodexThreadManagerServices['checkCodexRuntimeHealth']>, AgentRuntimesServices['checkNativeRuntimeHealth']>();

function detectionServicesFor(services: CodexThreadManagerServices): AgentRuntimeDetectionServices {
  let checkNativeRuntimeHealth: AgentRuntimesServices['checkNativeRuntimeHealth'];
  if (services.checkCodexRuntimeHealth) {
    const hostCheck = services.checkCodexRuntimeHealth;
    checkNativeRuntimeHealth = healthCheckAdapters.get(hostCheck);
    if (!checkNativeRuntimeHealth) {
      checkNativeRuntimeHealth = ({ agent, env }) => hostCheck(agent.binaryPath, env);
      healthCheckAdapters.set(hostCheck, checkNativeRuntimeHealth);
    }
  }
  return {
    readSettings: services.readSettings,
    resolveRuntimeCommand: services.resolveRuntimeCommand,
    resolveRuntimeCommandCandidates: services.resolveRuntimeCommandCandidates,
    checkNativeRuntimeHealth,
    detectionIdentity: services.detectionIdentity,
    now: services.now,
  };
}

/** The cached Codex detection (shared with the runtime picker and projections) decides whether a thread route may start an app-server. */
async function ensureCodexThreadRuntimeAvailable(
  services: CodexThreadManagerServices,
): Promise<{ binaryPath: string; env?: NodeJS.ProcessEnv }> {
  const entry = await getNativeRuntimeDetection('codex', detectionServicesFor(services));
  const agent = entry.value.agent;
  if (!('binaryPath' in agent)) {
    throw new CodexThreadRuntimeUnavailableError('Codex executable was not detected. Install Codex or start MindOS from an environment where the codex command is available.');
  }
  if (agent.status !== 'available') {
    throw new CodexThreadRuntimeUnavailableError(`Codex is ${agent.status === 'signed-out' ? 'signed out' : 'unavailable'}.${agent.reason ? ` ${agent.reason}` : ''}`);
  }
  return { binaryPath: agent.binaryPath, ...(entry.value.env ? { env: entry.value.env } : {}) };
}

// ── App-server client pool ────────────────────────────────────────────────────
// Thread and model routes used to spawn a fresh `codex app-server` per HTTP
// request. One initialized client per (command, env hash) now serves them and
// closes after an idle period; the turn lane in agent/runtime/run.ts keeps its
// own per-turn process and is not routed through here.

export const CODEX_APP_SERVER_CLIENT_IDLE_TTL_MS = 60_000;

type PooledCodexClient = {
  key: string;
  client: CodexAppServerClient;
  ready: Promise<void>;
  inUse: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
};

type CodexClientPoolState = {
  clients: Map<string, PooledCodexClient>;
  exitHookInstalled: boolean;
};

const CODEX_CLIENT_POOL_KEY = Symbol.for('mindos.codexAppServerClientPool');

function poolState(): CodexClientPoolState {
  return getProcessGlobal<CodexClientPoolState>(CODEX_CLIENT_POOL_KEY, () => ({ clients: new Map(), exitHookInstalled: false }));
}

function pooledClientKey(command: string, env: NodeJS.ProcessEnv | undefined): string {
  const digest = createHash('sha256');
  const entries = Object.entries(env ?? {}).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b));
  digest.update(JSON.stringify(entries));
  return `${command}|${digest.digest('hex').slice(0, 16)}`;
}

function createDefaultPooledCodexClient(input: { command: string; env?: NodeJS.ProcessEnv }): CodexAppServerClient {
  return createCodexAppServerClient(createCodexAppServerStdioTransport({
    command: input.command,
    ...(input.env ? { env: input.env } : {}),
  }));
}

async function acquirePooledCodexClient(input: {
  command: string;
  env?: NodeJS.ProcessEnv;
  factory: (input: { command: string; env?: NodeJS.ProcessEnv }) => CodexAppServerClient;
}): Promise<PooledCodexClient> {
  const state = poolState();
  if (!state.exitHookInstalled) {
    state.exitHookInstalled = true;
    process.once('exit', closePooledCodexAppServerClients);
  }
  const key = pooledClientKey(input.command, input.env);
  let entry = state.clients.get(key);
  if (!entry || entry.closed) {
    const client = input.factory({ command: input.command, env: input.env });
    const created: PooledCodexClient = { key, client, ready: Promise.resolve(), inUse: 0, idleTimer: null, closed: false };
    created.ready = Promise.resolve()
      .then(() => client.initialize())
      .catch((error) => {
        dropPooledCodexClient(created);
        throw error;
      });
    state.clients.set(key, created);
    entry = created;
  }
  clearIdleTimer(entry);
  entry.inUse += 1;
  try {
    await entry.ready;
  } catch (error) {
    entry.inUse -= 1;
    throw error;
  }
  return entry;
}

function releasePooledCodexClient(entry: PooledCodexClient, options: { failed: boolean }): void {
  entry.inUse = Math.max(0, entry.inUse - 1);
  if (options.failed) {
    dropPooledCodexClient(entry);
    return;
  }
  if (entry.inUse === 0 && !entry.closed) {
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null;
      if (entry.inUse === 0) dropPooledCodexClient(entry);
    }, CODEX_APP_SERVER_CLIENT_IDLE_TTL_MS);
    // An idle app-server must not keep the host process alive.
    (entry.idleTimer as { unref?: () => void }).unref?.();
  }
}

function clearIdleTimer(entry: PooledCodexClient): void {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}

function dropPooledCodexClient(entry: PooledCodexClient): void {
  if (entry.closed) return;
  entry.closed = true;
  clearIdleTimer(entry);
  const state = poolState();
  if (state.clients.get(entry.key) === entry) state.clients.delete(entry.key);
  try {
    void Promise.resolve(entry.client.close?.()).catch(() => {});
  } catch {
    // Closing is best-effort; the entry is already out of the pool.
  }
}

/** Closes every pooled app-server (server shutdown, tests). */
export function closePooledCodexAppServerClients(): void {
  for (const entry of [...poolState().clients.values()]) dropPooledCodexClient(entry);
}

export function resetCodexAppServerClientPoolForTest(): void {
  closePooledCodexAppServerClients();
  deleteProcessGlobal(CODEX_CLIENT_POOL_KEY);
}

function parseThreadListParams(searchParams: URLSearchParams): CodexThreadListInput | { error: string } {
  const limit = parseLimit(searchParams.get('limit'));
  if (limit instanceof Error) return { error: limit.message };

  const archived = parseBoolean(searchParams.get('archived'));
  const useStateDbOnly = parseBoolean(searchParams.get('useStateDbOnly'));
  const cwd = parseRepeatedOrCommaList(searchParams, 'cwd');
  const modelProviders = parseRepeatedOrCommaList(searchParams, 'modelProvider');
  const sourceKinds = parseRepeatedOrCommaList(searchParams, 'sourceKind');

  return pruneUndefined({
    cursor: nonEmpty(searchParams.get('cursor')),
    limit,
    sortKey: nonEmpty(searchParams.get('sortKey')),
    sortDirection: nonEmpty(searchParams.get('sortDirection')),
    modelProviders: modelProviders.length > 0 ? modelProviders : undefined,
    sourceKinds: sourceKinds.length > 0 ? sourceKinds : undefined,
    archived,
    cwd: cwd.length === 0 ? undefined : cwd.length === 1 ? cwd[0] : cwd,
    useStateDbOnly,
    searchTerm: nonEmpty(searchParams.get('searchTerm')),
  });
}

function normalizeForkInput(threadId: string, body: unknown): CodexThreadForkInput {
  const record = isRecord(body) ? body : {};
  return pruneUndefined({
    threadId,
    model: optionalString(record.model),
    modelProvider: optionalString(record.modelProvider),
    serviceTier: optionalString(record.serviceTier),
    cwd: optionalString(record.cwd),
    approvalPolicy: optionalString(record.approvalPolicy),
    approvalsReviewer: record.approvalsReviewer,
    sandbox: record.sandbox,
    config: isRecord(record.config) ? record.config : undefined,
    baseInstructions: optionalString(record.baseInstructions),
    developerInstructions: optionalString(record.developerInstructions),
    ephemeral: typeof record.ephemeral === 'boolean' ? record.ephemeral : undefined,
    threadSource: record.threadSource,
  }) as CodexThreadForkInput;
}

function parseLimit(value: string | null): number | undefined | Error {
  const raw = nonEmpty(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_THREAD_LIST_LIMIT) {
    return new Error(`limit must be an integer between 1 and ${MAX_THREAD_LIST_LIMIT}.`);
  }
  return parsed;
}

function parseBoolean(value: string | null): boolean | undefined {
  const raw = nonEmpty(value)?.toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

function parseRepeatedOrCommaList(searchParams: URLSearchParams, key: string): string[] {
  return Array.from(new Set(searchParams
    .getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)));
}

function normalizeThreadId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('/')) return null;
  return trimmed;
}

function optionalString(value: unknown): string | null | undefined {
  return typeof value === 'string' ? value : undefined;
}

function nonEmpty(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function badRequest(message: string): MindosServerResponse<{ error: string }> {
  return json({ error: message }, { status: 400, headers: NO_STORE_HEADERS });
}
