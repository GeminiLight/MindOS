import type { AgentRunRecord, AgentRunStatus } from './run-ledger';

export type ReducibleAgentRunStatus = Extract<AgentRunStatus, 'completed' | 'failed' | 'canceled' | 'timed_out'>;

export interface ReducibleAgentRun {
  id: string;
  runtimeId: string;
  displayName: string;
  status: AgentRunStatus;
  outputSummary?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ReducedAgentRunItem {
  id: string;
  runtimeId: string;
  displayName: string;
  status: ReducibleAgentRunStatus;
  summary?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentResultReduction {
  total: number;
  completed: number;
  failed: number;
  canceled: number;
  timedOut: number;
  pending: number;
  finalStatus: ReducibleAgentRunStatus;
  completedRuns: ReducedAgentRunItem[];
  failedRuns: ReducedAgentRunItem[];
  canceledRuns: ReducedAgentRunItem[];
  timedOutRuns: ReducedAgentRunItem[];
}

const TERMINAL_STATUSES = new Set<AgentRunStatus>(['completed', 'failed', 'canceled', 'timed_out']);

function toTerminalStatus(status: AgentRunStatus): ReducibleAgentRunStatus | null {
  return TERMINAL_STATUSES.has(status) ? status as ReducibleAgentRunStatus : null;
}

function toReducedItem(run: ReducibleAgentRun): ReducedAgentRunItem | null {
  const status = toTerminalStatus(run.status);
  if (!status) return null;
  return {
    id: run.id,
    runtimeId: run.runtimeId,
    displayName: run.displayName,
    status,
    ...(run.outputSummary ? { summary: run.outputSummary } : {}),
    ...(run.error ? { error: run.error } : {}),
    ...(run.metadata ? { metadata: run.metadata } : {}),
  };
}

export function reduceAgentRunResults(runs: ReadonlyArray<ReducibleAgentRun | AgentRunRecord>): AgentResultReduction {
  const completedRuns: ReducedAgentRunItem[] = [];
  const failedRuns: ReducedAgentRunItem[] = [];
  const canceledRuns: ReducedAgentRunItem[] = [];
  const timedOutRuns: ReducedAgentRunItem[] = [];
  let pending = 0;

  for (const run of runs) {
    const item = toReducedItem(run);
    if (!item) {
      pending += 1;
      continue;
    }
    if (item.status === 'completed') completedRuns.push(item);
    else if (item.status === 'failed') failedRuns.push(item);
    else if (item.status === 'canceled') canceledRuns.push(item);
    else if (item.status === 'timed_out') timedOutRuns.push(item);
  }

  const failed = failedRuns.length;
  const timedOut = timedOutRuns.length;
  const canceled = canceledRuns.length;
  const finalStatus: ReducibleAgentRunStatus = failed > 0
    ? 'failed'
    : timedOut > 0
      ? 'timed_out'
      : canceled > 0 || pending > 0
        ? 'canceled'
        : 'completed';

  return {
    total: runs.length,
    completed: completedRuns.length,
    failed,
    canceled,
    timedOut,
    pending,
    finalStatus,
    completedRuns,
    failedRuns,
    canceledRuns,
    timedOutRuns,
  };
}

function itemLabel(item: ReducedAgentRunItem): string {
  return item.displayName || item.runtimeId || item.id;
}

function compactText(value: string | undefined): string {
  if (!value) return '';
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > 240 ? `${oneLine.slice(0, 240)}...` : oneLine;
}

export function formatAgentResultReduction(reduction: AgentResultReduction): string {
  const lines = [
    `Agent runs: ${reduction.completed} completed, ${reduction.failed} failed, ${reduction.canceled} canceled, ${reduction.timedOut} timed out.`,
  ];

  if (reduction.completedRuns.length > 0) {
    lines.push('Completed:');
    for (const item of reduction.completedRuns) {
      const summary = compactText(item.summary);
      lines.push(`- ${itemLabel(item)}${summary ? `: ${summary}` : ''}`);
    }
  }

  const issueRuns = [
    ...reduction.failedRuns,
    ...reduction.canceledRuns,
    ...reduction.timedOutRuns,
  ];
  if (issueRuns.length > 0) {
    lines.push('Issues:');
    for (const item of issueRuns) {
      const detail = compactText(item.error || item.summary);
      lines.push(`- ${itemLabel(item)} (${item.status})${detail ? `: ${detail}` : ''}`);
    }
  }

  if (reduction.pending > 0) {
    lines.push(`Pending or non-terminal runs: ${reduction.pending}.`);
  }

  return lines.join('\n');
}
