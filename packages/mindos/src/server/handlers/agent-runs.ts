import type {
  AgentArtifactLedgerRecord,
} from '../../agent/ledger/artifact-ledger.js';
import {
  listAgentArtifacts,
} from '../../agent/ledger/artifact-ledger.js';
import type {
  AgentEvent,
  AgentEventCategory,
  AgentEventType,
  AgentNodeKind,
  AgentRunRecord,
  AgentRunStatus,
} from '../../agent/ledger/run-ledger-types.js';
import {
  listAgentEvents,
  listAgentRuns,
} from '../../agent/ledger/run-ledger.js';
import {
  listContextAssets,
  type ContextAsset,
} from '../../knowledge/context-assets/index.js';
import {
  listRetrievalReceipts,
  type RetrievalReceipt,
} from '../../retrieval/receipt.js';
import {
  emptyStudioAutomationState,
  readStudioAutomationState,
} from '../automations/store.js';
import type {
  StudioAutomationApproval,
  StudioAutomationJob,
  StudioAutomationRunStatus,
} from '../automations/types.js';
import { json, type MindosServerResponse } from '../response.js';

const AGENT_KINDS = new Set<AgentNodeKind>(['mindos-main', 'mindos-headless', 'native-runtime', 'pi-subagent', 'acp', 'a2a']);
const RUN_STATUSES = new Set<AgentRunStatus>(['queued', 'running', 'streaming', 'completed', 'failed', 'canceled', 'timed_out']);
const EVENT_TYPES = new Set<AgentEventType>([
  'run_started', 'run_updated', 'run_completed', 'run_canceled', 'run_failed',
  'status', 'text', 'tool', 'tool_started', 'tool_updated', 'tool_completed',
  'file', 'file_changed', 'permission', 'permission_requested', 'permission_resolved',
  'user_question_started', 'user_question_resolved', 'plan_artifact', 'goal_evaluation',
  'runtime_status', 'error',
]);
const EVENT_CATEGORIES = new Set<AgentEventCategory>(['status', 'text', 'tool', 'file', 'permission', 'question', 'plan', 'goal', 'error']);

export type AgentRunObservatoryStatus = AgentRunStatus | 'waiting_approval' | 'interrupted';
export type AgentRunObservatoryCoverage = 'live' | 'summary-only';
export type PublicAgentRunRecord = Omit<AgentRunRecord, 'archive'> & {
  archive?: { sessionId?: string };
};
export type PublicAgentEvent = Omit<AgentEvent, 'record'> & {
  record: PublicAgentRunRecord;
};

export type AgentRunObservatoryTrace = {
  id: string;
  rootRunId: string;
  source: 'agent' | 'automation';
  automationId?: string;
  title: string;
  status: AgentRunObservatoryStatus;
  coverage: AgentRunObservatoryCoverage;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  inputSummary: string;
  outputSummary?: string;
  error?: string;
  permissionMode: AgentRunRecord['permissionMode'];
  runtimeIds: string[];
  model?: string;
  thinkingEffort?: string;
  nodes: PublicAgentRunRecord[];
  events: PublicAgentEvent[];
  artifacts: AgentArtifactLedgerRecord[];
  receipts: RetrievalReceipt[];
  contextAssets: ContextAsset[];
  approvals: StudioAutomationApproval[];
  sessions: Array<{ runtimeId: string; sessionId: string }>;
  counts: {
    nodes: number;
    events: number;
    tools: number;
    files: number;
    approvals: number;
    artifacts: number;
    receipts: number;
  };
};

export type AgentRunObservatory = {
  schemaVersion: 1;
  generatedAt: string;
  warnings: string[];
  traces: AgentRunObservatoryTrace[];
  summary: {
    totalTraces: number;
    agentTraces: number;
    automationTraces: number;
    active: number;
    waitingApproval: number;
    completed: number;
    failed: number;
  };
};

export type AgentRunsPayload = {
  runs: AgentRunRecord[];
  events: AgentEvent[];
  observatory: AgentRunObservatory;
};

export type AgentRunObservatoryInput = {
  runs: AgentRunRecord[];
  events: AgentEvent[];
  artifacts: AgentArtifactLedgerRecord[];
  receipts: RetrievalReceipt[];
  contextAssets: ContextAsset[];
  automations: StudioAutomationJob[];
  approvals: StudioAutomationApproval[];
  generatedAt?: Date;
  warnings?: string[];
};

export type AgentRunsHandlerServices = {
  mindRoot: string;
  now?(): Date;
};

export function buildAgentRunObservatory(input: AgentRunObservatoryInput): AgentRunObservatory {
  const traces = [
    ...buildAgentTraces(input),
    ...buildAutomationTraces(input),
  ].sort((left, right) => right.startedAt - left.startedAt || left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    warnings: input.warnings ?? [],
    traces,
    summary: {
      totalTraces: traces.length,
      agentTraces: traces.filter((trace) => trace.source === 'agent').length,
      automationTraces: traces.filter((trace) => trace.source === 'automation').length,
      active: traces.filter((trace) => trace.status === 'queued' || trace.status === 'running' || trace.status === 'streaming').length,
      waitingApproval: traces.filter((trace) => trace.status === 'waiting_approval').length,
      completed: traces.filter((trace) => trace.status === 'completed').length,
      failed: traces.filter((trace) => isFailureStatus(trace.status)).length,
    },
  };
}

export function handleAgentRunsGet(
  searchParams: URLSearchParams,
  services: AgentRunsHandlerServices,
): MindosServerResponse<AgentRunsPayload> {
  const limit = parseLimit(searchParams.get('limit'));
  const runId = boundedText(searchParams.get('runId'), 160);
  const rootRunId = boundedText(searchParams.get('rootRunId'), 160);
  const chatSessionId = boundedText(searchParams.get('chatSessionId'), 160);
  const startedAfter = parseOptionalNumber(searchParams.get('startedAfter'));
  const runs = listAgentRuns({
    ...(runId ? { runId } : {}),
    ...(rootRunId ? { rootRunId } : {}),
    ...(optionalEnum(searchParams.get('kind'), AGENT_KINDS) ? { kind: optionalEnum(searchParams.get('kind'), AGENT_KINDS) } : {}),
    ...(optionalEnum(searchParams.get('status'), RUN_STATUSES) ? { status: optionalEnum(searchParams.get('status'), RUN_STATUSES) } : {}),
    ...(boundedText(searchParams.get('parentRunId'), 160) ? { parentRunId: boundedText(searchParams.get('parentRunId'), 160) } : {}),
    ...(chatSessionId ? { chatSessionId } : {}),
    ...(rootRunId || startedAfter === undefined ? {} : { startedAfter }),
    limit,
  });
  const includeEvents = searchParams.get('includeEvents') === '1' || searchParams.get('includeEvents') === 'true';
  const events = includeEvents ? listAgentEvents({
    ...(runId ? { runId } : {}),
    ...(rootRunId ? { rootRunId } : {}),
    ...(chatSessionId ? { chatSessionId } : {}),
    ...(optionalEnum(searchParams.get('eventType'), EVENT_TYPES) ? { type: optionalEnum(searchParams.get('eventType'), EVENT_TYPES) } : {}),
    ...(optionalEnum(searchParams.get('eventCategory'), EVENT_CATEGORIES) ? { category: optionalEnum(searchParams.get('eventCategory'), EVENT_CATEGORIES) } : {}),
    ...(rootRunId || startedAfter === undefined ? {} : { startedAfter }),
    limit,
  }) : [];
  const warnings: string[] = [];
  const state = safeAttachment(
    () => readStudioAutomationState(services.mindRoot),
    emptyStudioAutomationState(),
    warnings,
    'Automation history is temporarily unavailable.',
  );
  const artifacts = safeAttachment(
    () => listAgentArtifacts({ limit: Math.max(limit * 4, 100) }),
    [],
    warnings,
    'Agent artifacts are temporarily unavailable.',
  );
  const receipts = safeAttachment(
    () => listRetrievalReceipts(services.mindRoot, { limit: Math.max(limit * 2, 100) }),
    [],
    warnings,
    'Retrieval receipts are temporarily unavailable.',
  );
  const contextAssets = safeAttachment(
    () => listContextAssets(services.mindRoot, { limit: Math.max(limit * 4, 200) }),
    [],
    warnings,
    'Context assets are temporarily unavailable.',
  );
  const observatory = buildAgentRunObservatory({
    runs,
    events,
    artifacts,
    receipts,
    contextAssets,
    automations: state.automations,
    approvals: state.approvals,
    generatedAt: services.now?.() ?? new Date(),
    warnings,
  });
  return json({ runs, events, observatory }, { headers: { 'Cache-Control': 'no-store' } });
}

function safeAttachment<T>(
  read: () => T,
  fallback: T,
  warnings: string[],
  warning: string,
): T {
  try {
    return read();
  } catch {
    warnings.push(warning);
    return fallback;
  }
}

function buildAgentTraces(input: AgentRunObservatoryInput): AgentRunObservatoryTrace[] {
  const groups = new Map<string, AgentRunRecord[]>();
  for (const run of input.runs) {
    const rootId = run.rootRunId || run.id;
    const group = groups.get(rootId) ?? [];
    group.push(run);
    groups.set(rootId, group);
  }
  return [...groups.entries()].map(([rootId, group]) => {
    const sorted = [...group].sort((left, right) => {
      if (left.id === rootId) return -1;
      if (right.id === rootId) return 1;
      return left.startedAt - right.startedAt || left.id.localeCompare(right.id);
    });
    const root = sorted.find((run) => run.id === rootId) ?? sorted[0]!;
    const runIds = new Set(sorted.map((run) => run.id));
    const events = input.events
      .filter((event) => runIds.has(event.runId) && event.visibility !== 'debug')
      .sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id))
      .map(publicEvent);
    const artifacts = input.artifacts.filter((item) => item.runId && runIds.has(item.runId));
    const receiptIds = new Set<string>();
    const assetIds = new Set<string>();
    for (const run of sorted) {
      addString(receiptIds, run.metadata?.retrievalReceiptId);
      addStrings(assetIds, run.metadata?.retrievalSelectedAssetIds);
    }
    const receipts = input.receipts.filter((item) => receiptIds.has(item.id) || (item.metadata?.runId ? runIds.has(item.metadata.runId) : false));
    for (const item of receipts) for (const selection of item.selections) assetIds.add(selection.assetId);
    const contextAssets = input.contextAssets.filter((item) => assetIds.has(item.id));
    const sessions = sorted.flatMap((run) => run.archive?.sessionId
      ? [{ runtimeId: run.runtimeId, sessionId: run.archive.sessionId }]
      : []);
    const status = aggregateAgentStatus(sorted, events);
    const completedAt = maxDefined(sorted.map((run) => run.completedAt));
    const startedAt = Math.min(...sorted.map((run) => run.startedAt));
    return {
      id: rootId,
      rootRunId: rootId,
      source: 'agent',
      title: root.displayName,
      status,
      coverage: events.length > 0 ? 'live' : 'summary-only',
      startedAt,
      ...(completedAt !== undefined ? { completedAt, durationMs: Math.max(0, completedAt - startedAt) } : {}),
      inputSummary: root.inputSummary,
      ...(root.outputSummary ? { outputSummary: root.outputSummary } : {}),
      ...(firstError(sorted) ? { error: firstError(sorted) } : {}),
      permissionMode: root.permissionMode,
      runtimeIds: unique(sorted.map((run) => run.runtimeId)),
      ...(metadataString(root.metadata, ['model', 'modelName', 'modelOverride']) ? { model: metadataString(root.metadata, ['model', 'modelName', 'modelOverride']) } : {}),
      ...(metadataString(root.metadata, ['thinkingEffort', 'reasoningEffort']) ? { thinkingEffort: metadataString(root.metadata, ['thinkingEffort', 'reasoningEffort']) } : {}),
      nodes: sorted.map(publicRun),
      events,
      artifacts,
      receipts,
      contextAssets,
      approvals: [],
      sessions,
      counts: traceCounts(events, artifacts.length, receipts.length, sorted.length, 0),
    };
  });
}

function buildAutomationTraces(input: AgentRunObservatoryInput): AgentRunObservatoryTrace[] {
  const automationAssets = input.contextAssets.filter((item) => item.kind === 'automation-run');
  return input.automations.flatMap((job) => job.history.map((run) => {
    const approvals = input.approvals.filter((approval) => (
      approval.jobId === job.id
      && (approval.runId ? approval.runId === run.id : run.status === 'waiting_approval')
    ));
    const contextAssets = automationAssets.filter((asset) => asset.source.ref === `automation-run:${run.id}`);
    const status = approvals.some((approval) => approval.status === 'pending')
      ? 'waiting_approval'
      : normalizeAutomationStatus(run.status);
    const startedAt = parseIso(run.startedAt);
    const completedAt = run.finishedAt ? parseIso(run.finishedAt) : undefined;
    return {
      id: run.id,
      rootRunId: run.id,
      source: 'automation' as const,
      automationId: job.id,
      title: job.title,
      status,
      coverage: 'summary-only' as const,
      startedAt,
      ...(completedAt !== undefined ? { completedAt } : {}),
      ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
      inputSummary: job.prompt,
      ...(run.outputPreview ? { outputSummary: run.outputPreview } : {}),
      ...(run.error ? { error: run.error } : {}),
      permissionMode: job.permissionMode,
      runtimeIds: [job.runtime],
      model: job.model,
      thinkingEffort: job.effort,
      nodes: [automationNode(job, run.id, status, startedAt, completedAt, run.durationMs)],
      events: [],
      artifacts: [],
      receipts: [],
      contextAssets,
      approvals,
      sessions: [],
      counts: traceCounts([], contextAssets.length, 0, 1, approvals.length),
    };
  }));
}

function automationNode(
  job: StudioAutomationJob,
  runId: string,
  status: AgentRunObservatoryStatus,
  startedAt: number,
  completedAt?: number,
  durationMs?: number,
): PublicAgentRunRecord {
  return {
    id: runId,
    rootRunId: runId,
    agentKind: job.runtime === 'mindos-pi' ? 'mindos-headless' : 'native-runtime',
    runtimeId: job.runtime,
    displayName: job.title,
    status: observatoryStatusToRunStatus(status),
    permissionMode: job.permissionMode,
    inputSummary: job.prompt,
    startedAt,
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    metadata: { automationId: job.id, model: job.model, thinkingEffort: job.effort, observatoryStatus: status },
  };
}

function publicRun(run: AgentRunRecord): PublicAgentRunRecord {
  const { archive, ...safe } = run;
  return {
    ...safe,
    ...(archive?.sessionId ? { archive: { sessionId: archive.sessionId } } : {}),
  };
}

function publicEvent(event: AgentEvent): PublicAgentEvent {
  return { ...event, record: publicRun(event.record) };
}

function aggregateAgentStatus(runs: AgentRunRecord[], events: PublicAgentEvent[]): AgentRunObservatoryStatus {
  if (hasUnresolvedPermission(events)) return 'waiting_approval';
  if (runs.some((run) => run.status === 'streaming')) return 'streaming';
  if (runs.some((run) => run.status === 'running')) return 'running';
  if (runs.some((run) => run.status === 'queued')) return 'queued';
  if (runs.some((run) => run.status === 'failed')) return 'failed';
  if (runs.some((run) => run.status === 'timed_out')) return 'timed_out';
  if (runs.some((run) => run.status === 'canceled')) return 'canceled';
  return 'completed';
}

function hasUnresolvedPermission(events: PublicAgentEvent[]): boolean {
  const pending = new Set<string>();
  for (const event of events) {
    if (event.category !== 'permission') continue;
    const data = event.data?.kind === 'permission' ? event.data : undefined;
    const id = data?.requestId ?? event.toolCallId ?? event.id;
    if (data?.status === 'requested') pending.add(id);
    else if (data) pending.delete(id);
  }
  return pending.size > 0;
}

function traceCounts(
  events: PublicAgentEvent[],
  artifactCount: number,
  receiptCount: number,
  nodeCount: number,
  durableApprovalCount: number,
): AgentRunObservatoryTrace['counts'] {
  return {
    nodes: nodeCount,
    events: events.length,
    tools: events.filter((event) => event.category === 'tool').length,
    files: events.filter((event) => event.category === 'file').length,
    approvals: durableApprovalCount + events.filter((event) => event.type === 'permission_requested').length,
    artifacts: artifactCount,
    receipts: receiptCount,
  };
}

function observatoryStatusToRunStatus(status: AgentRunObservatoryStatus): AgentRunStatus {
  if (status === 'waiting_approval') return 'running';
  if (status === 'interrupted') return 'failed';
  return status;
}

function normalizeAutomationStatus(status: StudioAutomationRunStatus): AgentRunObservatoryStatus {
  if (status === 'success') return 'completed';
  if (status === 'error') return 'failed';
  return status;
}

function isFailureStatus(status: AgentRunObservatoryStatus): boolean {
  return status === 'failed' || status === 'timed_out' || status === 'interrupted';
}

function firstError(runs: AgentRunRecord[]): string | undefined {
  return runs.find((run) => run.error)?.error;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function addString(target: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value) target.add(value);
}

function addStrings(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) addString(target, item);
}

function metadataString(metadata: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return finite.length ? Math.max(...finite) : undefined;
}

function parseIso(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, parsed)) : 100;
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalEnum<T extends string>(value: string | null, allowed: Set<T>): T | undefined {
  return value && allowed.has(value as T) ? value as T : undefined;
}

function boundedText(value: string | null, max: number): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : undefined;
}
