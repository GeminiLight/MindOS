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
import type {
  MindosRuntimePermissionOption,
  MindosRuntimePermissionRequest,
  MindosRuntimePermissionResult,
  MindosRuntimePermissionRisk,
} from '../runtime/index.js';
import type { MindOSSSEvent } from '../session/index.js';
import { RUNTIME_PERMISSION_BRIDGE_KEY, getProcessGlobal } from '../global-state.js';
import {
  redactSensitiveObject,
  redactSensitiveText,
} from '../redaction.js';

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
  options: Map<string, MindosRuntimePermissionOption>;
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

export type RuntimePermissionApproval = {
  action: string;
  resource?: string;
  risk: MindosRuntimePermissionRisk;
  options: MindosRuntimePermissionOption[];
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringFromRecord(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const item = value[key];
    if (typeof item === 'string' && item.trim()) return redactSensitiveText(item.trim());
  }
  return undefined;
}

function auditString(value: unknown): string {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (value == null) return '';
  try {
    return redactSensitiveText(JSON.stringify(redactSensitiveObject(value)));
  } catch {
    return redactSensitiveText(String(value));
  }
}

function inferActionResource(request: MindosRuntimePermissionRequest): { action: string; resource?: string } {
  if (request.action) {
    return {
      action: request.action,
      ...(request.resource ? { resource: redactSensitiveText(request.resource) } : {}),
    };
  }

  const input = request.input;
  const record = isRecord(input) ? input : undefined;
  const command = record ? stringFromRecord(record, ['command', 'cmd', 'shellCommand', 'script']) : undefined;
  if (command || /bash|shell|terminal|command/i.test(request.toolName)) {
    return {
      action: 'command',
      ...(command ? { resource: command } : { resource: auditString(input).slice(0, 240) }),
    };
  }

  const filePath = record ? stringFromRecord(record, ['path', 'filePath', 'targetPath', 'filename']) : undefined;
  if (filePath || /file|edit|write|patch|delete/i.test(request.toolName)) {
    return {
      action: 'file-change',
      ...(filePath ? { resource: filePath } : { resource: auditString(input).slice(0, 240) }),
    };
  }

  return {
    action: 'tool-call',
    resource: request.toolName,
  };
}

function inferRisk(input: { action: string; resource?: string; toolName: string; input: unknown }): MindosRuntimePermissionRisk {
  const text = `${input.action} ${input.toolName} ${input.resource ?? ''} ${auditString(input.input)}`.toLowerCase();
  const reasons: string[] = [];
  if (/\b(rm|unlink|delete|del|remove)\b/.test(text) || /rm\s+-[^\s]*r/.test(text)) {
    reasons.push('Deletes or removes local files.');
  }
  if (/\b(sudo|chmod|chown|dd|mkfs|diskutil)\b/.test(text)) {
    reasons.push('Can modify system-level resources.');
  }
  if (/\b(git\s+push|git\s+reset|git\s+checkout|git\s+clean)\b/.test(text)) {
    reasons.push('Can change repository state.');
  }
  if (/\b(curl|wget)\b.*\|\s*(sh|bash)|\b(eval|exec)\b/.test(text)) {
    reasons.push('Can execute downloaded or dynamic code.');
  }
  if (reasons.length > 0) {
    return { level: 'high', summary: reasons[0] ?? 'High-risk runtime action.', reasons };
  }
  if (input.action === 'file-change' || /\b(write|edit|patch|move|rename)\b/.test(text)) {
    return {
      level: 'medium',
      summary: 'Can modify local workspace files.',
      reasons: ['Writes to the local workspace.'],
    };
  }
  if (input.action === 'command') {
    return {
      level: 'medium',
      summary: 'Runs a local shell command.',
      reasons: ['Executes in the current workspace.'],
    };
  }
  return {
    level: 'low',
    summary: 'Requests permission for a runtime tool call.',
  };
}

export function buildRuntimePermissionApproval(request: MindosRuntimePermissionRequest): RuntimePermissionApproval {
  const inferred = inferActionResource(request);
  return {
    action: inferred.action,
    ...(inferred.resource ? { resource: inferred.resource } : {}),
    risk: request.risk ?? inferRisk({
      action: inferred.action,
      resource: inferred.resource,
      toolName: request.toolName,
      input: request.input,
    }),
    options: request.options,
  };
}

function cancelResult(): MindosRuntimePermissionResult {
  return {
    decision: 'cancel',
    cancelled: true,
    decisionLabel: 'Cancelled',
    decisionIntent: 'cancel',
  };
}

function sendResolved(input: {
  pending: Pick<PendingRuntimePermission, 'runId' | 'requestId' | 'runtime' | 'toolCallId' | 'send'>;
  result: MindosRuntimePermissionResult;
}): void {
  input.pending.send({
    type: 'runtime_permission_resolved',
    runId: input.pending.runId,
    requestId: input.pending.requestId,
    runtime: input.pending.runtime,
    toolCallId: input.pending.toolCallId,
    decision: input.result.decision,
    cancelled: input.result.cancelled,
    ...(input.result.decisionLabel ? { decisionLabel: input.result.decisionLabel } : {}),
    ...(input.result.decisionIntent ? { decisionIntent: input.result.decisionIntent } : {}),
    ...(input.result.decisionScope ? { decisionScope: input.result.decisionScope } : {}),
  });
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
    const approval = buildRuntimePermissionApproval(request);
    const finish = (result: MindosRuntimePermissionResult) => {
      const pending = state.pending.get(key);
      if (!pending) return;
      clearTimeout(pending.timeout);
      if (abort) options.signal?.removeEventListener('abort', abort);
      state.pending.delete(key);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      const result = cancelResult();
      sendResolved({
        pending: {
          runId: context.runId,
          requestId,
          runtime: request.runtime,
          toolCallId: request.toolCallId,
          send: context.send,
        },
        result,
      });
      finish(result);
    }, context.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    state.pending.set(key, {
      runId: context.runId,
      requestId,
      runtime: request.runtime,
      toolCallId: request.toolCallId,
      options: new Map(request.options.map((option) => [option.id, option])),
      send: context.send,
      resolve: finish,
      timeout,
    });

    abort = () => {
      const result = cancelResult();
      sendResolved({
        pending: {
          runId: context.runId,
          requestId,
          runtime: request.runtime,
          toolCallId: request.toolCallId,
          send: context.send,
        },
        result,
      });
      finish(result);
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
      action: approval.action,
      ...(approval.resource ? { resource: approval.resource } : {}),
      risk: approval.risk,
    });
  });
}

function cancelRuntimePermissionsForRun(runId: string): void {
  for (const pending of Array.from(state.pending.values())) {
    if (pending.runId !== runId) continue;
    const result = cancelResult();
    sendResolved({ pending, result });
    pending.resolve(result);
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
  const selectedOption = pending.options.get(decision);
  if (decision !== 'cancel' && !selectedOption) {
    return { ok: false, status: 400, error: 'Permission decision is not valid for this request.' };
  }
  const cancelled = decision === 'cancel' || selectedOption?.intent === 'cancel';
  const result: MindosRuntimePermissionResult = {
    decision,
    cancelled,
    ...(selectedOption?.label ? { decisionLabel: selectedOption.label } : decision === 'cancel' ? { decisionLabel: 'Cancelled' } : {}),
    ...(selectedOption?.intent ? { decisionIntent: selectedOption.intent } : decision === 'cancel' ? { decisionIntent: 'cancel' as const } : {}),
    ...(selectedOption?.scope ? { decisionScope: selectedOption.scope } : {}),
  };
  sendResolved({ pending, result });
  pending.resolve(result);
  return { ok: true };
}

export function getPendingRuntimePermissionCount(): number {
  return state.pending.size;
}
