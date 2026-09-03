import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentArtifactLedgerRecord } from '../../agent/ledger/artifact-ledger.js';
import type { AgentEvent, AgentRunRecord } from '../../agent/ledger/run-ledger-types.js';
import type { AgentRunCapsuleProjection } from '../../agent/capsules/types.js';
import type { ContextAsset } from '../../knowledge/context-assets/index.js';
import type { RetrievalReceipt } from '../../retrieval/receipt.js';
import type {
  StudioAutomationApproval,
  StudioAutomationJob,
} from '../automations/types.js';
import { STUDIO_AUTOMATION_STATE_FILE } from '../automations/store.js';
import { buildAgentRunObservatory, handleAgentRunsGet } from './agent-runs.js';

const rootRun: AgentRunRecord = {
  id: 'run-root',
  rootRunId: 'run-root',
  chatSessionId: 'chat-1',
  agentKind: 'mindos-main',
  runtimeId: 'mindos',
  displayName: 'MindOS Agent',
  status: 'completed',
  permissionMode: 'ask',
  inputSummary: 'Research the release.',
  outputSummary: 'Release research completed.',
  startedAt: 1_000,
  completedAt: 2_000,
  durationMs: 1_000,
  archive: { sessionId: 'session-1', path: '/private/runtime/archive.jsonl' },
  metadata: {
    model: 'gpt-5.5',
    thinkingEffort: 'high',
    retrievalReceiptId: 'receipt-1',
    retrievalSelectedAssetIds: ['asset-1'],
  },
};

const childRun: AgentRunRecord = {
  id: 'run-child',
  rootRunId: 'run-root',
  parentRunId: 'run-root',
  chatSessionId: 'chat-1',
  agentKind: 'pi-subagent',
  runtimeId: 'reviewer',
  displayName: 'Reviewer',
  status: 'failed',
  permissionMode: 'read',
  inputSummary: 'Review it.',
  error: 'Review failed.',
  startedAt: 1_200,
  completedAt: 1_800,
  durationMs: 600,
};

const rootEvent: AgentEvent = {
  id: 'event-tool',
  runId: rootRun.id,
  type: 'tool_completed',
  category: 'tool',
  ts: 1_500,
  status: rootRun.status,
  record: rootRun,
  data: { kind: 'tool', name: 'search', status: 'completed', outputSummary: '3 matches' },
};

const debugEvent: AgentEvent = {
  ...rootEvent,
  id: 'event-debug',
  type: 'text',
  category: 'text',
  ts: 1_400,
  visibility: 'debug',
  data: { kind: 'text', text: 'hidden reasoning', channel: 'reasoning' },
};

const artifact: AgentArtifactLedgerRecord = {
  schemaVersion: 1,
  id: 'artifact-1',
  runtimeId: 'mindos',
  agentKind: 'mindos-main',
  source: 'runtime-output',
  kind: 'file',
  status: 'completed',
  createdAt: 1_600,
  updatedAt: 1_700,
  runId: rootRun.id,
  title: 'Release report',
  path: 'Reports/release.md',
};

const receipt: RetrievalReceipt = {
  schemaVersion: 1,
  id: 'receipt-1',
  queryHash: 'a'.repeat(64),
  queryPreview: 'release research',
  strategy: 'hybrid-heading-rerank-v1',
  outcome: 'selected',
  startedAt: new Date(1_050).toISOString(),
  completedAt: new Date(1_100).toISOString(),
  durationMs: 50,
  budget: { maxTokens: 1_000, maxFiles: 3, minScore: 1, timeoutMs: 2_000 },
  scope: { preferredPaths: [], excludePaths: [] },
  candidates: [{ assetId: 'asset-1', path: 'Notes/source.md', score: 4, selected: true, reason: 'matched' }],
  selections: [{ assetId: 'asset-1', path: 'Notes/source.md', score: 4, estimatedTokens: 40, truncated: false, reason: 'matched' }],
  totals: { candidateCount: 1, selectedCount: 1, usedTokens: 40 },
};

const contextAsset: ContextAsset = {
  id: 'asset-1',
  kind: 'knowledge',
  status: 'active',
  title: 'Source',
  path: 'Notes/source.md',
  contentHash: 'b'.repeat(64),
  version: 1,
  source: { kind: 'file', ref: 'file:Notes/source.md' },
  createdAt: new Date(900).toISOString(),
  updatedAt: new Date(900).toISOString(),
};

const capsule: AgentRunCapsuleProjection = {
  schemaVersion: 1,
  id: 'capsule-root',
  runId: rootRun.id,
  rootRunId: rootRun.id,
  chatSessionId: 'chat-1',
  source: 'interactive',
  status: 'completed',
  inputSummary: 'Research the release.',
  runtime: { kind: 'mindos', id: 'mindos', name: 'MindOS' },
  model: 'gpt-5.5',
  thinkingEffort: 'high',
  context: {
    attachedFileCount: 0,
    uploadedFileCount: 0,
    receiptIds: ['receipt-1'],
    assetIds: ['asset-1'],
  },
  recovery: {
    retry: { supported: true, mode: 'from-start' },
    fork: { supported: true, mode: 'new-session' },
    resume: { supported: true, sessionId: 'session-1' },
    rollback: { supported: false, reason: 'This run has no checkpoint artifact.' },
  },
  createdAt: new Date(1_000).toISOString(),
  updatedAt: new Date(2_000).toISOString(),
};

describe('Agent Run Observatory projection', () => {
  it('groups an agent tree and links only visible events, artifacts, receipts, context, and safe session metadata', () => {
    const result = buildAgentRunObservatory({
      runs: [childRun, rootRun],
      events: [rootEvent, debugEvent],
      artifacts: [artifact],
      receipts: [receipt],
      contextAssets: [contextAsset],
      automations: [],
      approvals: [],
      capsules: [capsule],
      generatedAt: new Date(3_000),
    });

    expect(result.summary).toMatchObject({
      totalTraces: 1,
      agentTraces: 1,
      automationTraces: 0,
      failed: 1,
      waitingApproval: 0,
    });
    expect(result.traces).toEqual([
      expect.objectContaining({
        id: 'run-root',
        source: 'agent',
        status: 'failed',
        coverage: 'live',
        runtimeIds: ['mindos', 'reviewer'],
        model: 'gpt-5.5',
        thinkingEffort: 'high',
        nodes: [
          expect.objectContaining({ id: rootRun.id, archive: { sessionId: 'session-1' } }),
          childRun,
        ],
        events: [expect.objectContaining({ id: rootEvent.id, type: 'tool_completed' })],
        artifacts: [artifact],
        receipts: [receipt],
        contextAssets: [contextAsset],
        sessions: [{ runtimeId: 'mindos', sessionId: 'session-1' }],
        capsule,
        counts: { nodes: 2, events: 1, tools: 1, files: 0, approvals: 0, artifacts: 1, receipts: 1 },
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('/private/runtime/archive.jsonl');
  });

  it('projects durable automation history and its pending approval as a waiting trace', () => {
    const automation = automationFixture();
    const approval: StudioAutomationApproval = {
      id: 'approval-1',
      jobId: automation.id,
      runId: 'automation-run-1',
      fingerprint: 'fingerprint',
      runtime: 'codex',
      status: 'pending',
      toolName: 'apply_patch',
      resource: 'Notes/plan.md',
      risk: { level: 'medium', summary: 'Changes a note.' },
      allowDecision: 'accept',
      denyDecision: 'decline',
      createdAt: new Date(5_500).toISOString(),
    };
    const automationAsset: ContextAsset = {
      ...contextAsset,
      id: 'asset-automation',
      kind: 'automation-run',
      title: 'Daily radar · waiting_approval',
      path: '.mindos/automations/runs/automation-run-1.md',
      source: { kind: 'automation-run', ref: 'automation-run:automation-run-1' },
      metadata: { automationId: automation.id },
    };

    const result = buildAgentRunObservatory({
      runs: [], events: [], artifacts: [], receipts: [],
      contextAssets: [automationAsset],
      automations: [automation], approvals: [approval],
      generatedAt: new Date(7_000),
    });

    expect(result.summary).toMatchObject({ totalTraces: 1, automationTraces: 1, waitingApproval: 1 });
    expect(result.traces[0]).toMatchObject({
      id: 'automation-run-1',
      source: 'automation',
      automationId: automation.id,
      title: 'Daily radar',
      status: 'waiting_approval',
      coverage: 'summary-only',
      runtimeIds: ['codex'],
      approvals: [expect.objectContaining({ id: 'approval-1', status: 'pending' })],
      contextAssets: [expect.objectContaining({ id: 'asset-automation' })],
      counts: { nodes: 1, events: 0, tools: 0, files: 0, approvals: 1, artifacts: 1, receipts: 0 },
    });
  });

  it('keeps orphan child runs as summary-only traces instead of dropping them', () => {
    const orphan = { ...childRun, rootRunId: 'missing-root' };
    const result = buildAgentRunObservatory({
      runs: [orphan], events: [], artifacts: [], receipts: [], contextAssets: [], automations: [], approvals: [],
      generatedAt: new Date(3_000),
    });

    expect(result.traces).toEqual([
      expect.objectContaining({
        id: 'missing-root',
        source: 'agent',
        title: 'Reviewer',
        status: 'failed',
        coverage: 'summary-only',
        nodes: [orphan],
      }),
    ]);
  });

  it('degrades a corrupt automation attachment without failing the run endpoint', () => {
    const mindRoot = mkdtempSync(join(tmpdir(), 'mindos-observatory-degraded-'));
    try {
      const statePath = join(mindRoot, STUDIO_AUTOMATION_STATE_FILE);
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(statePath, '{not-json', 'utf8');
      const response = handleAgentRunsGet(new URLSearchParams('includeEvents=1'), { mindRoot });
      expect(response).toMatchObject({
        status: 200,
        body: {
          observatory: {
            traces: [],
            warnings: ['Automation history is temporarily unavailable.'],
          },
        },
      });
    } finally {
      rmSync(mindRoot, { recursive: true, force: true });
    }
  });
});

function automationFixture(): StudioAutomationJob {
  return {
    id: 'studio-daily-radar',
    title: 'Daily radar',
    prompt: 'Build the daily radar.',
    scope: 'mind',
    schedule: 'manual',
    timezone: 'Asia/Shanghai',
    model: 'codex',
    effort: 'high',
    permissionMode: 'ask',
    status: 'active',
    retry: 'never',
    timeoutMs: 600_000,
    overlap: 'skip',
    runtime: 'codex',
    source: 'mindos-durable',
    controlPlaneScheduleId: 'studio-automation-daily-radar',
    createdAt: new Date(4_000).toISOString(),
    updatedAt: new Date(6_000).toISOString(),
    runCount: 1,
    lastStatus: 'waiting_approval',
    history: [{
      id: 'automation-run-1',
      status: 'waiting_approval',
      attempt: 1,
      occurrenceAt: new Date(4_500).toISOString(),
      startedAt: new Date(5_000).toISOString(),
      finishedAt: new Date(6_000).toISOString(),
      durationMs: 1_000,
      artifactPath: '.mindos/automations/runs/automation-run-1.md',
    }],
  };
}
