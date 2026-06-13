/**
 * Native runtime (Codex / Claude Code) permission bridge. Sunk from
 * packages/web/lib/agent/runtime-permission-bridge.ts
 * (spec-agent-core-consolidation Wave 2).
 *
 * A runtime stream raises a permission request mid-run; a separate HTTP route
 * resolves it from the UI. Both sides must see one pending map, so the state
 * is shared across module copies via global-state. The bridge context is
 * carried by AsyncLocalStorage for in-stream callers and by a runId map for
 * out-of-band resolvers.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { MindosRuntimePermissionRequest, MindosRuntimePermissionResult } from '../agent-runtime.js';
import type { MindOSSSEvent } from '../session/index.js';
import { RUNTIME_PERMISSION_BRIDGE_KEY, getProcessGlobal } from './global-state.js';

export type RuntimePermissionBridgeContext = {
  runId: string;
  send: (event: MindOSSSEvent) => void;
  timeoutMs?: number;
};

type PendingRuntimePermission = {
  runId: string;
  requestId: string;
  runtime: 'codex' | 'claude';
  toolCallId: string;
  optionIds: Set<string>;
  send: (event: MindOSSSEvent) => void;
  resolve: (result: MindosRuntimePermissionResult) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type RuntimePermissionBridgeGlobalState = {
  context: AsyncLocalStorage<RuntimePermissionBridgeContext>;
  runs: Map<string, RuntimePermissionBridgeContext>;
  pending: Map<string, PendingRuntimePermission>;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function bridgeState(): RuntimePermissionBridgeGlobalState {
  return getProcessGlobal(RUNTIME_PERMISSION_BRIDGE_KEY, () => ({
    context: new AsyncLocalStorage<RuntimePermissionBridgeContext>(),
    runs: new Map<string, RuntimePermissionBridgeContext>(),
    pending: new Map<string, PendingRuntimePermission>(),
  }));
}

const state = bridgeState();

function pendingKey(runId: string, requestId: string): string {
  return `${runId}:${requestId}`;
}

export function runWithRuntimePermissionBridge<T>(
  context: RuntimePermissionBridgeContext,
  callback: () => Promise<T>,
): Promise<T> {
  state.runs.set(context.runId, context);
  return state.context.run(context, async () => {
    try {
      return await callback();
    } finally {
      cancelRuntimePermissionsForRun(context.runId);
      state.runs.delete(context.runId);
    }
  });
}

export async function requestRuntimePermissionViaBridge(
  request: MindosRuntimePermissionRequest,
  options: { signal?: AbortSignal } = {},
): Promise<MindosRuntimePermissionResult> {
  const context = state.context.getStore();
  if (!context) return { decision: 'cancel', cancelled: true };
  return enqueueRuntimePermission(context, request, options);
}

export async function requestRuntimePermissionForRun(
  runId: string,
  request: MindosRuntimePermissionRequest,
  options: { signal?: AbortSignal } = {},
): Promise<MindosRuntimePermissionResult> {
  const context = state.runs.get(runId);
  if (!context) return { decision: 'cancel', cancelled: true };
  return enqueueRuntimePermission(context, request, options);
}

function enqueueRuntimePermission(
  context: RuntimePermissionBridgeContext,
  request: MindosRuntimePermissionRequest,
  options: { signal?: AbortSignal } = {},
): Promise<MindosRuntimePermissionResult> {
  const requestId = `${request.runtime}-${request.toolCallId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const key = pendingKey(context.runId, requestId);

  return new Promise<MindosRuntimePermissionResult>((resolve) => {
    let abort: (() => void) | undefined;
    const finish = (result: MindosRuntimePermissionResult) => {
      const pending = state.pending.get(key);
      if (!pending) return;
      clearTimeout(pending.timeout);
      if (abort) options.signal?.removeEventListener('abort', abort);
      state.pending.delete(key);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      context.send({
        type: 'runtime_permission_resolved',
        runId: context.runId,
        requestId,
        runtime: request.runtime,
        toolCallId: request.toolCallId,
        decision: 'cancel',
        cancelled: true,
      });
      finish({ decision: 'cancel', cancelled: true });
    }, context.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    state.pending.set(key, {
      runId: context.runId,
      requestId,
      runtime: request.runtime,
      toolCallId: request.toolCallId,
      optionIds: new Set(request.options.map((option) => option.id)),
      send: context.send,
      resolve: finish,
      timeout,
    });

    abort = () => {
      context.send({
        type: 'runtime_permission_resolved',
        runId: context.runId,
        requestId,
        runtime: request.runtime,
        toolCallId: request.toolCallId,
        decision: 'cancel',
        cancelled: true,
      });
      finish({ decision: 'cancel', cancelled: true });
    };

    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });

    context.send({
      type: 'runtime_permission_request',
      runId: context.runId,
      requestId,
      runtime: request.runtime,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      input: request.input,
      options: request.options,
      ...(request.reason ? { reason: request.reason } : {}),
    });
  });
}

function cancelRuntimePermissionsForRun(runId: string): void {
  for (const pending of Array.from(state.pending.values())) {
    if (pending.runId !== runId) continue;
    pending.send({
      type: 'runtime_permission_resolved',
      runId,
      requestId: pending.requestId,
      runtime: pending.runtime,
      toolCallId: pending.toolCallId,
      decision: 'cancel',
      cancelled: true,
    });
    pending.resolve({ decision: 'cancel', cancelled: true });
  }
}

export function resolveRuntimePermission(input: {
  runId: string;
  requestId: string;
  decision: string;
}): { ok: true } | { ok: false; status: number; error: string } {
  const key = pendingKey(input.runId, input.requestId);
  const pending = state.pending.get(key);
  if (!pending) return { ok: false, status: 404, error: 'Permission request is no longer pending.' };
  const decision = input.decision || 'cancel';
  if (decision !== 'cancel' && !pending.optionIds.has(decision)) {
    return { ok: false, status: 400, error: 'Permission decision is not valid for this request.' };
  }
  const cancelled = decision === 'cancel';
  pending.send({
    type: 'runtime_permission_resolved',
    runId: input.runId,
    requestId: input.requestId,
    runtime: pending.runtime,
    toolCallId: pending.toolCallId,
    decision,
    cancelled,
  });
  pending.resolve({ decision, cancelled });
  return { ok: true };
}

export function getPendingRuntimePermissionCount(): number {
  return state.pending.size;
}
