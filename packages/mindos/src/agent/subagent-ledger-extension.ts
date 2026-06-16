// Sunk from packages/web/lib/agent/subagent-ledger-extension.ts (Wave 4,
// spec-agent-core-consolidation).
//
// Wraps the upstream pi-subagents `subagent` tool so every invocation is
// recorded in the agent run ledger: child runs, progress events, async
// (detached) completions, cancellation links, and MindOS-orchestrated
// dependency plans (delegated to subagent-orchestrator). Loading the
// upstream extension itself is host-install specific (the web host resolves
// `pi-subagents` from its node_modules via jiti), so hosts inject a loader
// into createMindosSubagentLedgerExtension() and keep a real extension entry
// file — the pi DefaultResourceLoader loads extensions by file path.
//
// Cross-module-graph state (the early-async-completion buffer and the event
// unsubscribe handle) lives behind Symbol.for keys in global-state.ts: the
// loader imports the host entry in its own module graph, so module-level
// state here would fork between copies.

import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  appendAgentRunEvent,
  completeAgentRun,
  failAgentRun,
  listAgentRuns,
  startAgentRun,
  updateAgentRun,
} from './run-ledger.js';
import {
  getAgentRunContextForResource,
  getCurrentAgentRunContext,
  runWithAgentRunContext,
  type AgentRunContext,
} from './agent-run-context.js';
import {
  abortErrorFromSignal,
  isAbortLikeError,
  linkAbortSignalToAgentRun,
  registerAgentRunCancelHandler,
} from './run-cancellation.js';
import { createMindosAgentPermissionPolicyFromContext } from './tool/permission-policy.js';
import {
  executeSubagentOrchestrationPlan,
  type SubagentOrchestrationPlan,
  type SubagentSubtaskPlan,
} from './subagent-orchestrator.js';
import {
  getProcessGlobal,
  SUBAGENT_EARLY_ASYNC_COMPLETIONS_KEY,
  SUBAGENT_LEDGER_EVENT_UNSUBSCRIBE_KEY,
} from './global-state.js';

export type ToolWithRuntimeContext = ToolDefinition & {
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: Record<string, any>,
  ) => Promise<any> | any;
};

export type RegisterSubagentExtension = (pi: ExtensionAPI) => void | Promise<void>;

export interface MindosSubagentLedgerExtensionHost {
  /**
   * Resolve and import the upstream pi-subagents extension factory. Host
   * install layout specific (the web host jiti-imports
   * node_modules/pi-subagents/src/extension/index.ts).
   */
  loadUpstreamSubagentExtension(): Promise<RegisterSubagentExtension>;

  /**
   * Optional host hook used around real child-subagent execution. Hosts can
   * use this to provide runtime-only auth/model config to the child pi process
   * without changing the global pi config directory.
   */
  withSubagentChildRuntime?<T>(
    input: SubagentChildRuntimeInput,
    run: () => Promise<T>,
  ): Promise<T>;
}

export interface SubagentChildRuntimeInput {
  toolCallId: string;
  params: unknown;
  ctx?: Record<string, any>;
}

export interface SubagentLedgerToolOptions {
  withSubagentChildRuntime?: MindosSubagentLedgerExtensionHost['withSubagentChildRuntime'];
}

const SUBAGENT_ASYNC_COMPLETE_EVENT = 'subagent:async-complete';

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function outputSummary(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
            return (item as { text: string }).text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
      if (text.trim()) return text;
    }
  }
  return safeStringify(result);
}

function hasAsyncStartDetails(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const details = (result as { details?: unknown; isError?: unknown }).details;
  if (!details || typeof details !== 'object') return false;
  const record = details as Record<string, unknown>;
  return typeof record.asyncId === 'string' && Boolean(record.asyncId);
}

function resultIsError(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && (result as { isError?: unknown }).isError);
}

function appendSubagentProgressEvent(runId: string, update: unknown): void {
  const summary = outputSummary(update).trim();
  const error = resultIsError(update);
  if (!summary && !error) return;

  try {
    appendAgentRunEvent(runId, error ? {
      type: 'error',
      category: 'error',
      title: 'Subagent error',
      message: summary || 'Subagent progress update reported an error.',
      data: {
        kind: 'error',
        message: summary || 'Subagent progress update reported an error.',
      },
      metadata: resultMetadata(update),
    } : {
      type: 'text',
      category: 'text',
      title: 'Subagent update',
      message: summary,
      data: {
        kind: 'text',
        text: summary,
        channel: 'assistant',
      },
      metadata: resultMetadata(update),
    });
  } catch {
    // Timeline forwarding is best-effort and must not affect upstream subagent execution.
  }
}

function onUpdateWithLedger(runId: string, onUpdate: unknown): ((update: unknown) => unknown) {
  return (update: unknown) => {
    appendSubagentProgressEvent(runId, update);
    if (typeof onUpdate === 'function') {
      return (onUpdate as (value: unknown) => unknown)(update);
    }
    return undefined;
  };
}

function resultMetadata(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {};
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return {};
  const record = details as Record<string, unknown>;
  return {
    ...(typeof record.runId === 'string' ? { upstreamRunId: record.runId } : {}),
    ...(typeof record.asyncId === 'string' ? { asyncId: record.asyncId } : {}),
    ...(typeof record.asyncDir === 'string' ? { asyncDir: record.asyncDir } : {}),
    ...(typeof record.mode === 'string' ? { mode: record.mode } : {}),
  };
}

function textFromAsyncCompletePayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return safeStringify(payload);
  const record = payload as Record<string, unknown>;
  if (typeof record.summary === 'string') return record.summary;
  if (typeof record.resultPreview === 'string') return record.resultPreview;
  if (Array.isArray(record.results)) {
    const text = record.results
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const child = item as Record<string, unknown>;
        if (typeof child.summary === 'string') return child.summary;
        if (typeof child.output === 'string') return child.output;
        if (typeof child.text === 'string') return child.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (text.trim()) return text;
  }
  return safeStringify(payload);
}

function statusFromAsyncCompletePayload(payload: unknown): 'completed' | 'failed' | 'canceled' | 'timed_out' {
  if (!payload || typeof payload !== 'object') return 'completed';
  const record = payload as Record<string, unknown>;
  const state = record.state ?? record.status;
  if (state === 'failed' || state === 'error') return 'failed';
  if (state === 'timed-out' || state === 'timed_out') return 'timed_out';
  if (state === 'canceled' || state === 'cancelled') return 'canceled';
  if (Array.isArray(record.results) && record.results.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const status = (item as Record<string, unknown>).status;
    return status === 'failed' || status === 'timed-out' || status === 'timed_out';
  })) return 'failed';
  return 'completed';
}

function asyncIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ['id', 'asyncId', 'runId']) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  }
  return undefined;
}

export function finalizeSubagentAsyncRunFromEvent(payload: unknown): boolean {
  const asyncId = asyncIdFromPayload(payload);
  if (!asyncId) return false;
  const run = listAgentRuns({ kind: 'pi-subagent', limit: 500 })
    .find((candidate) => candidate.status === 'streaming' && candidate.metadata?.asyncId === asyncId);
  if (!run) {
    // A fast async run can complete before the tool wrapper has stored the
    // asyncId on the ledger record. Buffer the payload so the wrapper can
    // finalize the run as soon as it registers it.
    bufferEarlyAsyncCompletion(asyncId, payload);
    return false;
  }

  applyAsyncCompletion(run.id, asyncId, payload);
  return true;
}

function applyAsyncCompletion(runId: string, asyncId: string, payload: unknown): void {
  const status = statusFromAsyncCompletePayload(payload);
  const output = textFromAsyncCompletePayload(payload);
  const metadata = { asyncId, asyncComplete: true };
  if (status === 'completed') {
    completeAgentRun(runId, { outputSummary: output, metadata });
  } else {
    failAgentRun(runId, { status, error: output || `Subagent async run ${status}.`, metadata });
  }
}

const MAX_BUFFERED_ASYNC_COMPLETIONS = 100;

function getEarlyAsyncCompletions(): Map<string, unknown> {
  return getProcessGlobal(SUBAGENT_EARLY_ASYNC_COMPLETIONS_KEY, () => new Map<string, unknown>());
}

function bufferEarlyAsyncCompletion(asyncId: string, payload: unknown): void {
  const buffered = getEarlyAsyncCompletions();
  buffered.delete(asyncId);
  buffered.set(asyncId, payload);
  while (buffered.size > MAX_BUFFERED_ASYNC_COMPLETIONS) {
    const oldest = buffered.keys().next().value;
    if (oldest === undefined) break;
    buffered.delete(oldest);
  }
}

function takeEarlyAsyncCompletion(asyncId: string): { payload: unknown } | null {
  const buffered = getEarlyAsyncCompletions();
  if (!buffered.has(asyncId)) return null;
  const payload = buffered.get(asyncId);
  buffered.delete(asyncId);
  return { payload };
}

function subagentDisplayName(params: unknown): string {
  if (!params || typeof params !== 'object') return 'Subagent';
  const input = params as Record<string, unknown>;
  if (typeof input.action === 'string' && input.action) return `Subagent ${input.action}`;
  if (typeof input.agent === 'string' && input.agent) return input.agent;
  if (Array.isArray(input.tasks)) return `Parallel subagents (${input.tasks.length})`;
  if (Array.isArray(input.chain)) return `Subagent chain (${input.chain.length})`;
  return 'Subagent';
}

function subagentRuntimeId(params: unknown): string {
  if (!params || typeof params !== 'object') return 'subagent';
  const input = params as Record<string, unknown>;
  if (typeof input.agent === 'string' && input.agent) return input.agent;
  if (typeof input.action === 'string' && input.action) return `subagent:${input.action}`;
  if (Array.isArray(input.tasks)) return 'subagent:parallel';
  if (Array.isArray(input.chain)) return 'subagent:chain';
  return 'subagent';
}

function subagentCwd(params: unknown, ctx?: Record<string, any>): string | undefined {
  if (params && typeof params === 'object') {
    const input = params as Record<string, unknown>;
    if (typeof input.cwd === 'string' && input.cwd.trim()) return input.cwd;
  }
  return typeof ctx?.cwd === 'string' && ctx.cwd.trim() ? ctx.cwd : undefined;
}

function subagentPermissionMode(ctx?: Record<string, any>) {
  return createMindosAgentPermissionPolicyFromContext(ctx, 'agent').permissionMode;
}

function sessionManagerFromToolContext(ctx?: Record<string, any>): unknown {
  if (!ctx || typeof ctx !== 'object') return undefined;
  try {
    return ctx.sessionManager;
  } catch {
    return undefined;
  }
}

function inheritedAgentRunContext(ctx?: Record<string, any>): AgentRunContext | undefined {
  return getCurrentAgentRunContext() ?? getAgentRunContextForResource(sessionManagerFromToolContext(ctx));
}

function agentRunContextStartFields(
  context: AgentRunContext | undefined,
): Pick<Parameters<typeof startAgentRun>[0], 'chatSessionId' | 'rootRunId' | 'parentRunId'> {
  return {
    ...(context?.chatSessionId ? { chatSessionId: context.chatSessionId } : {}),
    ...(context?.rootRunId ? { rootRunId: context.rootRunId } : {}),
    ...(context?.parentRunId ? { parentRunId: context.parentRunId } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function subtaskFromInput(item: unknown, index: number, fallbackCwd?: string): SubagentSubtaskPlan | null {
  if (!isRecord(item)) return null;
  const agent = typeof item.agent === 'string' ? item.agent.trim() : '';
  const task = typeof item.task === 'string' ? item.task.trim() : '';
  if (!agent || !task) return null;
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `task-${index + 1}`;
  const dependencies = [
    ...stringArray(item.dependencies),
    ...stringArray(item.dependsOn),
  ];
  const timeoutMs = positiveNumber(item.timeoutMs ?? item.maxRuntimeMs);
  const contextBudget = positiveNumber(item.contextBudget);
  return {
    id,
    agent,
    task,
    ...(dependencies.length > 0 ? { dependencies } : {}),
    ...(typeof item.cwd === 'string' && item.cwd.trim() ? { cwd: item.cwd } : fallbackCwd ? { cwd: fallbackCwd } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(contextBudget ? { contextBudget } : {}),
    metadata: {
      ...(typeof item.label === 'string' ? { label: item.label } : {}),
      ...(typeof item.phase === 'string' ? { phase: item.phase } : {}),
    },
  };
}

function chainSubtasksFromInput(items: unknown[], fallbackCwd?: string): SubagentSubtaskPlan[] | null {
  const subtasks: SubagentSubtaskPlan[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const subtask = subtaskFromInput(items[index], index, fallbackCwd);
    if (!subtask) return null;
    subtasks.push({
      ...subtask,
      ...(index > 0 ? { dependencies: [subtasks[index - 1]!.id] } : {}),
    });
  }
  return subtasks;
}

function hasExplicitDependencies(items: unknown[]): boolean {
  return items.some((item) => isRecord(item) && (
    stringArray(item.dependencies).length > 0 || stringArray(item.dependsOn).length > 0
  ));
}

function mindosOrchestrationPlanFromParams(params: unknown, ctx?: Record<string, any>): SubagentOrchestrationPlan | null {
  if (!isRecord(params)) return null;
  const fallbackCwd = subagentCwd(params, ctx);
  const runContext = inheritedAgentRunContext(ctx);
  const rawTasks = Array.isArray(params.subtasks)
    ? params.subtasks
    : Array.isArray(params.tasks)
      ? params.tasks
      : undefined;
  const rawChain = Array.isArray(params.chain) ? params.chain : undefined;
  const explicitMindosOrchestration = params.mindosOrchestration === true || params.orchestrator === 'mindos';

  if (!explicitMindosOrchestration && (!rawTasks || !hasExplicitDependencies(rawTasks))) {
    return null;
  }

  const tasks = rawTasks
    ? rawTasks.map((item, index) => subtaskFromInput(item, index, fallbackCwd))
    : rawChain
      ? chainSubtasksFromInput(rawChain, fallbackCwd)
      : null;
  if (!tasks || tasks.some((task) => !task)) return null;

  return {
    displayName: `Subagent orchestration (${tasks.length})`,
    ...agentRunContextStartFields(runContext),
    cwd: fallbackCwd,
    permissionMode: subagentPermissionMode(ctx),
    timeoutMs: positiveNumber(params.timeoutMs ?? params.maxRuntimeMs),
    contextBudget: positiveNumber(params.contextBudget),
    tasks: tasks as SubagentSubtaskPlan[],
  };
}

function subagentToolResultFromOrchestration(result: Awaited<ReturnType<typeof executeSubagentOrchestrationPlan>>) {
  return {
    content: [{ type: 'text', text: result.summary }],
    isError: result.status !== 'completed',
    details: {
      mode: 'mindos-orchestration',
      runId: result.parentRun.id,
      status: result.status,
      results: result.tasks.map((task) => ({
        id: task.taskId,
        agent: task.agent,
        status: task.status,
        output: task.outputSummary,
        error: task.error,
        runId: task.run.id,
      })),
    },
  };
}

function shouldUseSubagentChildRuntime(params: unknown): boolean {
  if (!params || typeof params !== 'object') return false;
  const input = params as Record<string, unknown>;
  return !(typeof input.action === 'string' && input.action.trim());
}

function runWithOptionalSubagentChildRuntime<T>(
  options: SubagentLedgerToolOptions | undefined,
  input: SubagentChildRuntimeInput,
  run: () => Promise<T>,
): Promise<T> {
  if (!shouldUseSubagentChildRuntime(input.params) || typeof options?.withSubagentChildRuntime !== 'function') {
    return run();
  }
  return options.withSubagentChildRuntime(input, run);
}

export function wrapSubagentToolForLedger(
  tool: ToolWithRuntimeContext,
  options?: SubagentLedgerToolOptions,
): ToolWithRuntimeContext {
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const orchestrationPlan = mindosOrchestrationPlanFromParams(params, ctx);
      if (orchestrationPlan) {
        const orchestrationResult = await executeSubagentOrchestrationPlan(orchestrationPlan, async (task, context) => {
          const childParams = {
            ...(isRecord(params) ? params : {}),
            agent: task.agent,
            task: task.task,
            cwd: task.cwd,
            async: false,
            tasks: undefined,
            subtasks: undefined,
            chain: undefined,
            mindosOrchestration: undefined,
            orchestrator: undefined,
            ...(task.timeoutMs ? { timeoutMs: task.timeoutMs } : {}),
          };
          const childToolCallId = `${toolCallId}:${task.id}`;
          const childResult = await runWithOptionalSubagentChildRuntime(
            options,
            { toolCallId: childToolCallId, params: childParams, ctx },
            () => tool.execute(
              childToolCallId,
              childParams,
              context.signal,
              onUpdateWithLedger(context.run.id, onUpdate),
              ctx,
            ),
          );
          const summary = outputSummary(childResult);
          if (resultIsError(childResult)) {
            return {
              status: 'failed',
              outputSummary: summary,
              error: summary || 'Subagent task failed.',
              metadata: resultMetadata(childResult),
            };
          }
          return {
            outputSummary: summary,
            metadata: resultMetadata(childResult),
          };
        }, { signal });
        return subagentToolResultFromOrchestration(orchestrationResult);
      }

      const run = startAgentRun({
        agentKind: 'pi-subagent',
        runtimeId: subagentRuntimeId(params),
        displayName: subagentDisplayName(params),
        ...agentRunContextStartFields(inheritedAgentRunContext(ctx)),
        cwd: subagentCwd(params, ctx),
        permissionMode: subagentPermissionMode(ctx),
        inputSummary: safeStringify(params),
        metadata: {
          toolCallId,
          source: 'pi-subagents',
        },
      });

      const upstreamAbort = new AbortController();
      const abortUpstream = (reason?: unknown) => {
        if (!upstreamAbort.signal.aborted) upstreamAbort.abort(reason);
      };
      const handleParentAbort = () => abortUpstream(abortErrorFromSignal(signal, 'Subagent run was canceled.'));
      if (signal?.aborted) handleParentAbort();
      signal?.addEventListener('abort', handleParentAbort, { once: true });

      const unregisterCancelHandler = registerAgentRunCancelHandler(run.id, ({ reason }) => {
        abortUpstream(reason ?? new Error('Subagent run was canceled.'));
      });
      const unlinkAbortLedger = linkAbortSignalToAgentRun(run.id, upstreamAbort.signal, {
        reason: 'Subagent run was canceled.',
        metadata: { aborted: true },
      });

      try {
        const result = await runWithAgentRunContext({
          ...(run.chatSessionId ? { chatSessionId: run.chatSessionId } : {}),
          rootRunId: run.rootRunId ?? run.id,
          parentRunId: run.id,
        }, () => runWithOptionalSubagentChildRuntime(
          options,
          { toolCallId, params, ctx },
          () => tool.execute(toolCallId, params, upstreamAbort.signal, onUpdateWithLedger(run.id, onUpdate), ctx),
        ));
        if (hasAsyncStartDetails(result) && !resultIsError(result)) {
          const metadata = resultMetadata(result);
          updateAgentRun(run.id, {
            status: 'streaming',
            outputSummary: outputSummary(result),
            metadata: {
              ...metadata,
              detached: true,
            },
          });
          // The completion event may have already arrived and been buffered.
          const asyncId = typeof metadata.asyncId === 'string' ? metadata.asyncId : undefined;
          const early = asyncId ? takeEarlyAsyncCompletion(asyncId) : null;
          if (asyncId && early) {
            applyAsyncCompletion(run.id, asyncId, early.payload);
          }
          return result;
        }
        if (resultIsError(result)) {
          failAgentRun(run.id, {
            error: outputSummary(result) || 'Subagent run failed.',
            metadata: resultMetadata(result),
          });
          return result;
        }
        completeAgentRun(run.id, {
          outputSummary: outputSummary(result),
          metadata: resultMetadata(result),
        });
        return result;
      } catch (error) {
        failAgentRun(run.id, {
          status: isAbortLikeError(error) || upstreamAbort.signal.aborted ? 'canceled' : 'failed',
          error: isAbortLikeError(error) ? 'Subagent run was canceled.' : error,
          metadata: upstreamAbort.signal.aborted ? { aborted: true } : undefined,
        });
        throw error;
      } finally {
        signal?.removeEventListener('abort', handleParentAbort);
        unlinkAbortLedger();
        unregisterCancelHandler();
      }
    },
  } as ToolWithRuntimeContext;
}

/**
 * Build the MindOS subagent ledger extension: subscribes to async
 * completions, loads the host-provided upstream pi-subagents extension, and
 * intercepts its `subagent` tool registration with the ledger wrapper.
 */
export function createMindosSubagentLedgerExtension(
  host: MindosSubagentLedgerExtensionHost,
): (pi: ExtensionAPI) => Promise<void> {
  return async function mindosSubagentLedgerExtension(pi: ExtensionAPI): Promise<void> {
    const events = pi.events as unknown as { on?: (event: string, handler: (payload: unknown) => void) => (() => void) | void };
    const unsubscribeSlot = getProcessGlobal<{ unsubscribe: (() => void) | null }>(
      SUBAGENT_LEDGER_EVENT_UNSUBSCRIBE_KEY,
      () => ({ unsubscribe: null }),
    );
    if (typeof unsubscribeSlot.unsubscribe === 'function') {
      try {
        unsubscribeSlot.unsubscribe();
      } catch {
        // Best-effort cleanup across extension reloads.
      }
      unsubscribeSlot.unsubscribe = null;
    }
    const unsubscribe = events.on?.(SUBAGENT_ASYNC_COMPLETE_EVENT, finalizeSubagentAsyncRunFromEvent);
    if (typeof unsubscribe === 'function') {
      unsubscribeSlot.unsubscribe = unsubscribe;
    }

    const proxyPi = {
      ...pi,
      registerTool(tool: ToolDefinition) {
        if (tool.name === 'subagent') {
          const options = typeof host.withSubagentChildRuntime === 'function'
            ? { withSubagentChildRuntime: host.withSubagentChildRuntime }
            : undefined;
          pi.registerTool(wrapSubagentToolForLedger(tool as ToolWithRuntimeContext, options) as ToolDefinition);
          return;
        }
        pi.registerTool(tool);
      },
    } as ExtensionAPI;

    const registerSubagentExtension = await host.loadUpstreamSubagentExtension();
    await registerSubagentExtension(proxyPi);
  };
}
