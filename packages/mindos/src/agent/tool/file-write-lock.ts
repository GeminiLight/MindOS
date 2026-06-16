import path from 'node:path';
import { getCurrentAgentRunContext } from '../agent-run-context.js';
import { AGENT_FILE_WRITE_LOCKS_KEY, getProcessGlobal } from '../global-state.js';

export class AgentFileWriteConflictError extends Error {
  readonly code = 'AGENT_FILE_WRITE_CONFLICT';
  readonly filePath: string;
  readonly operation: string;
  readonly activeOwner: string;
  readonly requestedOwner: string;

  constructor(input: {
    filePath: string;
    operation: string;
    activeOwner: string;
    requestedOwner: string;
  }) {
    super(
      `Write conflict on ${input.filePath}: ${input.operation} is already in progress by ${input.activeOwner}. Retry after reading the latest file content.`,
    );
    this.name = 'AgentFileWriteConflictError';
    this.filePath = input.filePath;
    this.operation = input.operation;
    this.activeOwner = input.activeOwner;
    this.requestedOwner = input.requestedOwner;
  }
}

interface ActiveFileWriteLock {
  owner: string;
  operation: string;
  acquiredAt: number;
  /** Re-entrant hold count: the same owner may nest sections on one file. */
  depth: number;
}

export interface AgentFileWriteLockInput {
  filePath: string;
  operation: string;
  owner?: string;
}

/**
 * Process-level lock registry, shared across module copies via global-state
 * (see AGENT_FILE_WRITE_LOCKS_KEY there for why). The lock does NOT
 * coordinate across processes.
 */
function getLocks(): Map<string, ActiveFileWriteLock> {
  return getProcessGlobal(AGENT_FILE_WRITE_LOCKS_KEY, () => new Map<string, ActiveFileWriteLock>());
}

function normalizeFilePath(filePath: string): string {
  const trimmed = filePath.trim().replace(/\\/g, '/');
  const normalized = path.posix.normalize(trimmed).replace(/^\/+/, '');
  return normalized === '.' ? '' : normalized;
}

function defaultOwner(): string {
  const context = getCurrentAgentRunContext();
  return context?.parentRunId ?? context?.rootRunId ?? 'agent-run:unknown';
}

function lockKey(filePath: string): string {
  return normalizeFilePath(filePath).toLowerCase();
}

export async function withAgentFileWriteLock<T>(
  input: AgentFileWriteLockInput,
  fn: () => Promise<T> | T,
): Promise<T> {
  const normalizedPath = normalizeFilePath(input.filePath);
  const key = lockKey(input.filePath);
  const owner = input.owner ?? defaultOwner();
  const locks = getLocks();
  const active = locks.get(key);

  if (active && active.owner !== owner) {
    throw new AgentFileWriteConflictError({
      filePath: normalizedPath || input.filePath,
      operation: input.operation,
      activeOwner: active.owner,
      requestedOwner: owner,
    });
  }

  if (active) {
    active.depth += 1;
  } else {
    locks.set(key, { owner, operation: input.operation, acquiredAt: Date.now(), depth: 1 });
  }
  try {
    return await fn();
  } finally {
    const current = locks.get(key);
    if (current?.owner === owner) {
      current.depth -= 1;
      if (current.depth <= 0) {
        locks.delete(key);
      }
    }
  }
}

export async function withAgentFileWriteLocks<T>(
  inputs: AgentFileWriteLockInput[],
  fn: () => Promise<T> | T,
): Promise<T> {
  const ordered = [...inputs]
    .map((input) => ({ ...input, filePath: normalizeFilePath(input.filePath) || input.filePath }))
    .sort((a, b) => lockKey(a.filePath).localeCompare(lockKey(b.filePath)));

  let run = fn;
  for (const input of ordered.reverse()) {
    const next = run;
    run = () => withAgentFileWriteLock(input, next);
  }
  return run();
}

export function resetAgentFileWriteLocksForTest(): void {
  getLocks().clear();
}
