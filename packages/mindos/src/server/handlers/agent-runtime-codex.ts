import {
  createCodexAppServerClient,
  createCodexAppServerStdioTransport,
  type CodexAppServerClient,
  type CodexThreadForkInput,
  type CodexThreadListInput,
  type CodexThreadListResult,
  type CodexThreadReadResult,
  type CodexThreadForkResult,
} from '../../agent/runtime/codex-app-server.js';
import { compactRuntimeFailureMessage } from '../../agent/runtime/runtime-errors.js';
import { resolveCommandPath } from '../../protocols/acp/index.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import {
  type AgentRuntimesServices,
  defaultCheckNativeRuntimeHealth,
  selectCodexRuntimeCandidate,
  type NativeRuntimeHealthResult,
} from './agent-runtimes.js';

export type CodexThreadManagerServices = {
  createCodexClient?(): CodexAppServerClient | Promise<CodexAppServerClient>;
  resolveRuntimeCommand?(command: string): Promise<string | null>;
  resolveRuntimeCommandCandidates?: AgentRuntimesServices['resolveRuntimeCommandCandidates'];
  readSettings?: AgentRuntimesServices['readSettings'];
  checkCodexRuntimeHealth?(binaryPath: string, env?: NodeJS.ProcessEnv): Promise<NativeRuntimeHealthResult>;
};

export type CodexThreadListPayload = CodexThreadListResult;
export type CodexThreadReadPayload = CodexThreadReadResult;
export type CodexThreadForkPayload = CodexThreadForkResult;

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const MAX_THREAD_LIST_LIMIT = 100;

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
  const runtime = await ensureCodexThreadRuntimeAvailable(services);
  const client = await (services.createCodexClient?.() ?? createCodexAppServerClient(createCodexAppServerStdioTransport({
    ...(runtime?.binaryPath ? { command: runtime.binaryPath } : {}),
    ...(runtime?.env ? { env: runtime.env } : {}),
  })));
  try {
    await client.initialize();
    return await run(client);
  } finally {
    await client.close?.();
  }
}

async function ensureCodexThreadRuntimeAvailable(
  services: CodexThreadManagerServices,
): Promise<{ binaryPath: string; env?: NodeJS.ProcessEnv } | undefined> {
  if (services.createCodexClient) return undefined;
  const resolveRuntimeCommand = services.resolveRuntimeCommand ?? resolveCommandPath;
  const selected = await selectCodexRuntimeCandidate({
    services: {
      readSettings: services.readSettings,
      resolveRuntimeCommand,
      resolveRuntimeCommandCandidates: services.resolveRuntimeCommandCandidates,
    },
    checkCandidate: (binaryPath, env) => services.checkCodexRuntimeHealth?.(binaryPath, env) ?? defaultCheckNativeRuntimeHealth({
      runtime: 'codex',
      agent: { id: 'codex-acp', name: 'Codex', binaryPath },
      ...(env ? { env } : {}),
    }),
  });
  if (!selected) {
    throw new CodexThreadRuntimeUnavailableError('Codex executable was not detected. Install Codex or start MindOS from an environment where the codex command is available.');
  }
  const { binaryPath, health } = selected;
  if (health.status !== 'available') {
    throw new CodexThreadRuntimeUnavailableError(`Codex is ${health.status === 'signed-out' ? 'signed out' : 'unavailable'}.${health.reason ? ` ${health.reason}` : ''}`);
  }
  return { binaryPath, ...(selected.env ? { env: selected.env } : {}) };
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
