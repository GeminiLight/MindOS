import { redactSensitiveText } from '../../agent/redaction.js';
import { isAcpCapabilitySupported, type AcpAgentCapabilities, type AcpSession } from './types.js';

export type AcpHandshakeHealthStatus = 'ready' | 'failed';

export type AcpHandshakeHealthStage =
  | 'initialize'
  | 'session-new'
  | 'session-load'
  | 'session-list';

export type AcpHandshakeSessionHealth = {
  sessionId?: string;
  externalSessionId?: string;
  supportsLoadSession: boolean;
  supportsListSessions: boolean;
  supportsClose: boolean;
  modeCount: number;
  configOptionCount: number;
  mcpServerCount: number;
  authMethodCount: number;
};

export type AcpHandshakeHealthResult = {
  schemaVersion: 1;
  agentId: string;
  status: AcpHandshakeHealthStatus;
  stage: AcpHandshakeHealthStage;
  checkedAt: string;
  expiresAt: string;
  durationMs?: number;
  cached?: boolean;
  message?: string;
  capabilities?: AcpAgentCapabilities;
  session?: AcpHandshakeSessionHealth;
};

export type AcpHandshakeHealthSessionServices = {
  createSession(agentId: string, options: { cwd: string; permissionMode?: 'readonly' | 'ask' | 'auto' | 'full' }): Promise<AcpSession>;
  closeSession(sessionId: string): Promise<void>;
};

export type CheckAcpHandshakeHealthOptions = AcpHandshakeHealthSessionServices & {
  cwd?: string;
  force?: boolean;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 12_000;
const cache = new Map<string, AcpHandshakeHealthResult>();

export function rememberAcpHandshakeHealth(input: {
  agentId: string;
  status: AcpHandshakeHealthStatus;
  stage: AcpHandshakeHealthStage;
  startedAt?: number;
  message?: string;
  capabilities?: AcpAgentCapabilities;
  session?: AcpSession;
  ttlMs?: number;
  now?: () => number;
}): AcpHandshakeHealthResult {
  const nowMs = input.now?.() ?? Date.now();
  const result: AcpHandshakeHealthResult = {
    schemaVersion: 1,
    agentId: input.agentId,
    status: input.status,
    stage: input.stage,
    checkedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    ...(input.startedAt !== undefined ? { durationMs: Math.max(0, nowMs - input.startedAt) } : {}),
    ...(input.message ? { message: redactSensitiveText(input.message).slice(0, 500) } : {}),
    ...(input.capabilities ? { capabilities: input.capabilities } : {}),
    ...(input.session ? { session: sessionHealth(input.session) } : {}),
  };
  cache.set(input.agentId, result);
  return result;
}

export function getCachedAcpHandshakeHealth(
  agentId: string,
  options?: { now?: () => number; includeExpired?: boolean },
): AcpHandshakeHealthResult | null {
  const result = cache.get(agentId);
  if (!result) return null;
  const nowMs = options?.now?.() ?? Date.now();
  if (!options?.includeExpired && Date.parse(result.expiresAt) <= nowMs) {
    cache.delete(agentId);
    return null;
  }
  return { ...result, cached: true };
}

export function listCachedAcpHandshakeHealth(
  agentIds?: string[],
  options?: { now?: () => number; includeExpired?: boolean },
): AcpHandshakeHealthResult[] {
  const ids = agentIds ?? [...cache.keys()];
  return ids
    .map((agentId) => getCachedAcpHandshakeHealth(agentId, options))
    .filter((result): result is AcpHandshakeHealthResult => Boolean(result));
}

export function resetAcpHandshakeHealthCacheForTest(): void {
  cache.clear();
}

export async function checkAcpHandshakeHealth(
  agentId: string,
  options: CheckAcpHandshakeHealthOptions,
): Promise<AcpHandshakeHealthResult> {
  const cached = options.force
    ? null
    : getCachedAcpHandshakeHealth(agentId, { now: options.now });
  if (cached) return cached;

  const startedAt = options.now?.() ?? Date.now();
  let session: AcpSession | undefined;
  const sessionPromise = options.createSession(agentId, {
    cwd: options.cwd ?? process.cwd(),
    permissionMode: 'readonly',
  });

  try {
    session = await withTimeout(
      sessionPromise,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      `ACP handshake timed out after ${(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s`,
    );
    return rememberAcpHandshakeHealth({
      agentId,
      status: 'ready',
      stage: 'session-new',
      startedAt,
      capabilities: session.agentCapabilities,
      session,
      ttlMs: options.ttlMs,
      now: options.now,
    });
  } catch (error) {
    sessionPromise
      .then((lateSession) => options.closeSession(lateSession.id).catch(() => {}))
      .catch(() => {});
    const cachedFailure = getCachedAcpHandshakeHealth(agentId, { now: options.now });
    if (cachedFailure?.status === 'failed') return cachedFailure;
    return rememberAcpHandshakeHealth({
      agentId,
      status: 'failed',
      stage: 'session-new',
      startedAt,
      message: error instanceof Error ? error.message : String(error),
      ttlMs: options.ttlMs,
      now: options.now,
    });
  } finally {
    if (session) await options.closeSession(session.id).catch(() => {});
  }
}

function sessionHealth(session: AcpSession): AcpHandshakeSessionHealth {
  return {
    sessionId: session.id,
    ...(session.agentSessionId ? { externalSessionId: session.agentSessionId } : {}),
    supportsLoadSession: session.agentCapabilities?.loadSession === true,
    supportsListSessions: isAcpCapabilitySupported(session.agentCapabilities?.sessionCapabilities?.list),
    supportsClose: isAcpCapabilitySupported(session.agentCapabilities?.sessionCapabilities?.close),
    modeCount: session.modes?.length ?? 0,
    configOptionCount: session.configOptions?.length ?? 0,
    mcpServerCount: session.mcpServers?.length ?? 0,
    authMethodCount: session.authMethods?.length ?? 0,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
