// Sunk from packages/web/lib/agent/subagent-orchestrator.ts (Wave 4,
// spec-agent-core-consolidation).
//
// Dependency-aware subagent fan-out: validates a task plan (unique ids,
// known dependencies, no cycles), runs independent tasks concurrently,
// cancels dependents whose dependencies did not complete, and records every
// child plus the parent orchestration run in the agent run ledger. The
// executor that actually runs one task stays caller-provided — the
// orchestrator owns scheduling, timeouts, cancellation, and ledger state.

import {
  completeAgentRun,
  failAgentRun,
  type AgentRunPermissionMode,
  type AgentRunRecord,
  type AgentRunStatus,
  startAgentRun,
} from './run-ledger.js';
import {
  formatAgentResultReduction,
  reduceAgentRunResults,
  type AgentResultReduction,
  type ReducibleAgentRunStatus,
} from './result-reducer.js';
import { runWithAgentRunContext } from './agent-run-context.js';

export interface SubagentSubtaskPlan {
  id: string;
  agent: string;
  task: string;
  dependencies?: string[];
  dependsOn?: string[];
  cwd?: string;
  permissionMode?: AgentRunPermissionMode;
  timeoutMs?: number;
  contextBudget?: number;
  metadata?: Record<string, unknown>;
}

export interface SubagentOrchestrationPlan {
  id?: string;
  displayName?: string;
  rootRunId?: string;
  parentRunId?: string;
  chatSessionId?: string;
  cwd?: string;
  permissionMode?: AgentRunPermissionMode;
  timeoutMs?: number;
  contextBudget?: number;
  tasks: SubagentSubtaskPlan[];
}

export interface SubagentTaskExecutorResult {
  status?: ReducibleAgentRunStatus;
  outputSummary?: string;
  error?: unknown;
  metadata?: Record<string, unknown>;
}

export interface SubagentTaskExecutorContext {
  signal: AbortSignal;
  dependencyResults: ReadonlyMap<string, SubagentTaskExecutionResult>;
  run: AgentRunRecord;
}

export type SubagentTaskExecutor = (
  task: SubagentSubtaskPlan,
  context: SubagentTaskExecutorContext,
) => Promise<SubagentTaskExecutorResult | string | void> | SubagentTaskExecutorResult | string | void;

export interface SubagentTaskExecutionResult {
  taskId: string;
  agent: string;
  run: AgentRunRecord;
  status: ReducibleAgentRunStatus;
  outputSummary?: string;
  error?: string;
}

export interface SubagentOrchestrationResult {
  parentRun: AgentRunRecord;
  status: ReducibleAgentRunStatus;
  tasks: SubagentTaskExecutionResult[];
  reduction: AgentResultReduction;
  summary: string;
}

const DEFAULT_SUBAGENT_TIMEOUT_MS = 120_000;
const DEFAULT_CONTEXT_BUDGET = 12_000;

class SubagentPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubagentPlanValidationError';
  }
}

function normalizeDependencies(task: SubagentSubtaskPlan): string[] {
  const values = [
    ...(Array.isArray(task.dependencies) ? task.dependencies : []),
    ...(Array.isArray(task.dependsOn) ? task.dependsOn : []),
  ];
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function validateSubagentPlan(plan: SubagentOrchestrationPlan): void {
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    throw new SubagentPlanValidationError('Subagent orchestration plan must include at least one task.');
  }

  const ids = new Set<string>();
  for (const task of plan.tasks) {
    if (!task || typeof task.id !== 'string' || !task.id.trim()) {
      throw new SubagentPlanValidationError('Each subagent task must have a stable id.');
    }
    if (ids.has(task.id)) {
      throw new SubagentPlanValidationError(`Duplicate subagent task id: ${task.id}`);
    }
    ids.add(task.id);
    if (typeof task.agent !== 'string' || !task.agent.trim()) {
      throw new SubagentPlanValidationError(`Subagent task ${task.id} must specify an agent.`);
    }
    if (typeof task.task !== 'string' || !task.task.trim()) {
      throw new SubagentPlanValidationError(`Subagent task ${task.id} must include a task prompt.`);
    }
  }

  for (const task of plan.tasks) {
    for (const dependency of normalizeDependencies(task)) {
      if (!ids.has(dependency)) {
        throw new SubagentPlanValidationError(`Subagent task ${task.id} depends on unknown task ${dependency}.`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));

  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new SubagentPlanValidationError(`Subagent task dependency cycle includes ${id}.`);
    }
    visiting.add(id);
    for (const dependency of normalizeDependencies(byId.get(id)!)) {
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const task of plan.tasks) {
    visit(task.id);
  }
}

function inputSummaryForTask(task: SubagentSubtaskPlan): string {
  return JSON.stringify({
    taskId: task.id,
    agent: task.agent,
    task: task.task,
    dependencies: normalizeDependencies(task),
    ...(task.contextBudget ? { contextBudget: task.contextBudget } : {}),
  });
}

function normalizeExecutorResult(result: SubagentTaskExecutorResult | string | void): SubagentTaskExecutorResult {
  if (typeof result === 'string') return { outputSummary: result };
  if (!result) return {};
  return result;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isTerminalStatus(status: AgentRunStatus): status is ReducibleAgentRunStatus {
  return status === 'completed' || status === 'failed' || status === 'canceled' || status === 'timed_out';
}

async function runWithTimeout(
  task: SubagentSubtaskPlan,
  executor: SubagentTaskExecutor,
  dependencyResults: ReadonlyMap<string, SubagentTaskExecutionResult>,
  timeoutMs: number,
  outerSignal: AbortSignal | undefined,
  run: AgentRunRecord,
): Promise<{ type: 'completed'; value: SubagentTaskExecutorResult | string | void } | { type: 'failed'; error: unknown } | { type: 'canceled' } | { type: 'timed_out' }> {
  if (outerSignal?.aborted) return { type: 'canceled' };

  const controller = new AbortController();
  const abortFromOuter = () => controller.abort();
  outerSignal?.addEventListener('abort', abortFromOuter, { once: true });
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let cancelFromOuter: (() => void) | undefined;

  try {
    const execution = Promise.resolve()
      .then(() => executor(task, { signal: controller.signal, dependencyResults, run }))
      .then(
        (value) => ({ type: 'completed' as const, value }),
        (error) => ({ type: 'failed' as const, error }),
      );

    const timeout = new Promise<{ type: 'timed_out' }>((resolve) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        resolve({ type: 'timed_out' });
      }, timeoutMs);
    });

    const canceled = outerSignal
      ? new Promise<{ type: 'canceled' }>((resolve) => {
        cancelFromOuter = () => {
          controller.abort();
          resolve({ type: 'canceled' });
        };
        outerSignal.addEventListener('abort', cancelFromOuter, { once: true });
      })
      : undefined;

    return await Promise.race(canceled ? [execution, timeout, canceled] : [execution, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    outerSignal?.removeEventListener('abort', abortFromOuter);
    if (cancelFromOuter) outerSignal?.removeEventListener('abort', cancelFromOuter);
  }
}

function buildTaskRunInput(
  task: SubagentSubtaskPlan,
  plan: SubagentOrchestrationPlan,
  parentRun: AgentRunRecord,
): Parameters<typeof startAgentRun>[0] {
  const dependencies = normalizeDependencies(task);
  return {
    agentKind: 'pi-subagent',
    runtimeId: task.agent,
    displayName: task.agent,
    rootRunId: parentRun.rootRunId ?? parentRun.id,
    parentRunId: parentRun.id,
    ...(plan.chatSessionId ? { chatSessionId: plan.chatSessionId } : {}),
    ...(task.cwd || plan.cwd ? { cwd: task.cwd ?? plan.cwd } : {}),
    permissionMode: task.permissionMode ?? plan.permissionMode ?? 'agent',
    inputSummary: inputSummaryForTask(task),
    metadata: {
      source: 'mindos-subagent-orchestrator',
      orchestrationId: plan.id ?? parentRun.id,
      taskId: task.id,
      dependencies,
      contextBudget: positiveInt(task.contextBudget, positiveInt(plan.contextBudget, DEFAULT_CONTEXT_BUDGET)),
      timeoutMs: positiveInt(task.timeoutMs, positiveInt(plan.timeoutMs, DEFAULT_SUBAGENT_TIMEOUT_MS)),
      ...(task.metadata ?? {}),
    },
  };
}

async function executeOneTask(
  task: SubagentSubtaskPlan,
  plan: SubagentOrchestrationPlan,
  parentRun: AgentRunRecord,
  executor: SubagentTaskExecutor,
  dependencyResults: ReadonlyMap<string, SubagentTaskExecutionResult>,
  outerSignal?: AbortSignal,
): Promise<SubagentTaskExecutionResult> {
  const run = startAgentRun(buildTaskRunInput(task, plan, parentRun));
  const timeoutMs = positiveInt(task.timeoutMs, positiveInt(plan.timeoutMs, DEFAULT_SUBAGENT_TIMEOUT_MS));
  // From here on the child run exists in the ledger — any throw below must
  // still land it (and ultimately the parent) in a terminal state.
  try {
    const outcome = await runWithAgentRunContext({
      ...(run.chatSessionId ? { chatSessionId: run.chatSessionId } : {}),
      rootRunId: run.rootRunId ?? run.id,
      parentRunId: run.id,
    }, () => runWithTimeout(task, executor, dependencyResults, timeoutMs, outerSignal, run));

    if (outcome.type === 'timed_out') {
      const error = `Subagent task ${task.id} timed out after ${timeoutMs}ms.`;
      const failed = failAgentRun(run.id, { status: 'timed_out', error, metadata: { timeoutMs } }) ?? run;
      return { taskId: task.id, agent: task.agent, run: failed, status: 'timed_out', error };
    }

    if (outcome.type === 'canceled') {
      const error = `Subagent task ${task.id} was canceled.`;
      const canceled = failAgentRun(run.id, { status: 'canceled', error, metadata: { canceled: true } }) ?? run;
      return { taskId: task.id, agent: task.agent, run: canceled, status: 'canceled', error };
    }

    if (outcome.type === 'failed') {
      const error = errorMessage(outcome.error);
      const failed = failAgentRun(run.id, { error }) ?? run;
      return { taskId: task.id, agent: task.agent, run: failed, status: 'failed', error };
    }

    const normalized = normalizeExecutorResult(outcome.value);
    const status = normalized.status ?? 'completed';
    if (status !== 'completed') {
      const error = errorMessage(normalized.error ?? normalized.outputSummary ?? `Subagent task ${task.id} ended with ${status}.`);
      const failed = failAgentRun(run.id, {
        status,
        error,
        outputSummary: normalized.outputSummary,
        metadata: normalized.metadata,
      }) ?? run;
      return { taskId: task.id, agent: task.agent, run: failed, status, outputSummary: normalized.outputSummary, error };
    }

    const completed = completeAgentRun(run.id, {
      outputSummary: normalized.outputSummary,
      metadata: normalized.metadata,
    }) ?? run;
    return { taskId: task.id, agent: task.agent, run: completed, status: 'completed', outputSummary: completed.outputSummary };
  } catch (error) {
    const message = errorMessage(error);
    const failed = failAgentRun(run.id, { error: message }) ?? run;
    return { taskId: task.id, agent: task.agent, run: failed, status: 'failed', error: message };
  }
}

function markTaskCanceled(
  task: SubagentSubtaskPlan,
  plan: SubagentOrchestrationPlan,
  parentRun: AgentRunRecord,
  dependencyResults: ReadonlyMap<string, SubagentTaskExecutionResult>,
): SubagentTaskExecutionResult {
  const failedDependencies = normalizeDependencies(task)
    .map((dependencyId) => dependencyResults.get(dependencyId))
    .filter((result): result is SubagentTaskExecutionResult => result !== undefined && result.status !== 'completed')
    .map((result) => `${result.taskId}:${result.status}`);
  const error = `Subagent task ${task.id} was canceled because dependencies did not complete: ${failedDependencies.join(', ')}.`;
  const run = startAgentRun({
    ...buildTaskRunInput(task, plan, parentRun),
    status: 'queued',
  });
  const canceled = failAgentRun(run.id, {
    status: 'canceled',
    error,
    metadata: {
      canceledByDependency: true,
      failedDependencies,
    },
  }) ?? run;
  return { taskId: task.id, agent: task.agent, run: canceled, status: 'canceled', error };
}

export async function executeSubagentOrchestrationPlan(
  plan: SubagentOrchestrationPlan,
  executor: SubagentTaskExecutor,
  options: { signal?: AbortSignal } = {},
): Promise<SubagentOrchestrationResult> {
  validateSubagentPlan(plan);

  const parentRun = startAgentRun({
    id: plan.id,
    agentKind: 'pi-subagent',
    runtimeId: 'subagent:orchestration',
    displayName: plan.displayName ?? `Subagent orchestration (${plan.tasks.length})`,
    rootRunId: plan.rootRunId,
    parentRunId: plan.parentRunId,
    chatSessionId: plan.chatSessionId,
    cwd: plan.cwd,
    permissionMode: plan.permissionMode ?? 'agent',
    inputSummary: JSON.stringify({
      tasks: plan.tasks.map((task) => ({
        id: task.id,
        agent: task.agent,
        dependencies: normalizeDependencies(task),
      })),
    }),
    metadata: {
      source: 'mindos-subagent-orchestrator',
      taskCount: plan.tasks.length,
      contextBudget: positiveInt(plan.contextBudget, DEFAULT_CONTEXT_BUDGET),
      timeoutMs: positiveInt(plan.timeoutMs, DEFAULT_SUBAGENT_TIMEOUT_MS),
    },
  });

  const pending = new Set(plan.tasks.map((task) => task.id));
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const results = new Map<string, SubagentTaskExecutionResult>();
  const running = new Map<string, Promise<void>>();

  const launch = (task: SubagentSubtaskPlan) => {
    pending.delete(task.id);
    const promise = executeOneTask(task, plan, parentRun, executor, results, options.signal)
      .then((result) => {
        results.set(task.id, result);
      });
    running.set(task.id, promise.finally(() => {
      running.delete(task.id);
    }));
  };

  try {
    while (pending.size > 0 || running.size > 0) {
      let launched = false;
      for (const taskId of Array.from(pending)) {
        const task = byId.get(taskId)!;
        const dependencies = normalizeDependencies(task);
        const dependencyResults = dependencies.map((dependencyId) => results.get(dependencyId));
        if (dependencyResults.some((result) => result && result.status !== 'completed')) {
          pending.delete(taskId);
          results.set(taskId, markTaskCanceled(task, plan, parentRun, results));
          continue;
        }
        if (dependencyResults.every(Boolean)) {
          launch(task);
          launched = true;
        }
      }

      if (running.size === 0) {
        if (pending.size === 0) break;
        if (!launched) {
          throw new SubagentPlanValidationError('Subagent orchestration made no progress; check task dependencies.');
        }
      }

      if (running.size > 0) {
        await Promise.race(Array.from(running.values()));
      }
    }
  } catch (error) {
    // Backstop: a scheduler failure must never leave the parent run stuck
    // in 'running' — finalize it before surfacing the error.
    failAgentRun(parentRun.id, { error: errorMessage(error) });
    throw error;
  }

  const orderedResults = plan.tasks.map((task) => results.get(task.id)!).filter(Boolean);
  const reduction = reduceAgentRunResults(orderedResults.map((result) => result.run));
  const summary = formatAgentResultReduction(reduction);

  const finalParent = reduction.finalStatus === 'completed'
    ? completeAgentRun(parentRun.id, {
      outputSummary: summary,
      metadata: {
        completed: reduction.completed,
        failed: reduction.failed,
        canceled: reduction.canceled,
        timedOut: reduction.timedOut,
      },
    })
    : failAgentRun(parentRun.id, {
      status: reduction.finalStatus,
      error: summary,
      metadata: {
        completed: reduction.completed,
        failed: reduction.failed,
        canceled: reduction.canceled,
        timedOut: reduction.timedOut,
      },
    });

  return {
    parentRun: finalParent ?? parentRun,
    status: reduction.finalStatus,
    tasks: orderedResults,
    reduction,
    summary,
  };
}

export function isSubagentPlanValidationError(error: unknown): error is SubagentPlanValidationError {
  return error instanceof SubagentPlanValidationError;
}
