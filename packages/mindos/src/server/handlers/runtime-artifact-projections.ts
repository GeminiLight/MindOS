import type {
  AgentRuntimeDescriptor,
  AgentRuntimeHarnessCapabilities,
  AgentRuntimeKind,
  AgentRuntimeStatus,
} from '../../agent/runtime/registry.js';
import {
  listAgentArtifacts,
  type AgentArtifactLedgerRecord,
} from '../../agent/ledger/artifact-ledger.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import {
  filterProjectionsByRuntime,
  reason,
  runtimeAvailableReason,
  runtimeKey,
  uniqSorted,
  type AgentRuntimeProjectionReason,
} from './runtime-projection-shared.js';

const ARTIFACT_AVAILABILITY_WORDING = {
  available: 'is available for artifact projection diagnostics.',
  unavailable: 'is not available, so artifact output readiness cannot be trusted.',
};

export type AgentRuntimeArtifactProjectionStatus =
  | 'ready'
  | 'limited'
  | 'blocked'
  | 'unknown';

export type AgentRuntimeArtifactOutputKind = AgentRuntimeHarnessCapabilities['output'][number];

export type AgentRuntimeArtifactHandoffTarget =
  | 'message'
  | 'diff'
  | 'checkpoint'
  | 'artifact'
  | 'branch'
  | 'pull-request';

export type AgentRuntimeArtifactProjectionReason = AgentRuntimeProjectionReason;

export type AgentRuntimeArtifactProjection = {
  schemaVersion: 1;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeStatus: AgentRuntimeStatus;
  status: AgentRuntimeArtifactProjectionStatus;
  outputKinds: AgentRuntimeArtifactOutputKind[];
  reviewableOutputKinds: AgentRuntimeArtifactOutputKind[];
  nativeHandoffTargets: AgentRuntimeArtifactHandoffTarget[];
  nativeReview: {
    supported: boolean;
    summary: string;
  };
  artifactIndex: {
    supported: boolean;
    status: 'ready' | 'missing' | 'unknown';
    owner: 'mindos';
    summary: string;
    recordCount: number;
    recentArtifacts: Array<{
      id: string;
      kind: AgentArtifactLedgerRecord['kind'];
      source: AgentArtifactLedgerRecord['source'];
      status: AgentArtifactLedgerRecord['status'];
      runId?: string;
      toolCallId?: string;
      toolName?: string;
      path?: string;
      line?: number;
      uri?: string;
      title?: string;
      summary?: string;
      mimeType?: string;
      size?: number;
      updatedAt: number;
    }>;
  };
  rollback: {
    supported: boolean;
    source: 'runtime-checkpoint' | 'none' | 'unknown';
    summary: string;
  };
  branchPr: {
    supported: boolean;
    summary: string;
  };
  reasons: AgentRuntimeArtifactProjectionReason[];
  blockers?: string[];
};

export type AgentRuntimeArtifactProjectionsPayload = {
  schemaVersion: 1;
  projections: AgentRuntimeArtifactProjection[];
};

export type AgentRuntimeArtifactProjectionServices = {
  listRuntimes(): AgentRuntimeDescriptor[] | Promise<AgentRuntimeDescriptor[]>;
  listArtifacts?(): AgentArtifactLedgerRecord[] | Promise<AgentArtifactLedgerRecord[]>;
};

export async function handleAgentRuntimeArtifactProjectionsGet(
  searchParams: URLSearchParams,
  services: AgentRuntimeArtifactProjectionServices,
): Promise<MindosServerResponse<AgentRuntimeArtifactProjectionsPayload | { error: string }>> {
  try {
    const [runtimes, artifacts] = await Promise.all([
      services.listRuntimes(),
      services.listArtifacts?.() ?? listAgentArtifacts(),
    ]);
    const payload = buildAgentRuntimeArtifactProjectionsPayload({ runtimes, artifacts });
    const projections = filterProjectionsByRuntime(payload.projections, searchParams.get('runtime'));
    return json(
      { ...payload, projections },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function buildAgentRuntimeArtifactProjectionsPayload(input: {
  runtimes: AgentRuntimeDescriptor[];
  artifacts?: AgentArtifactLedgerRecord[];
}): AgentRuntimeArtifactProjectionsPayload {
  const artifacts = input.artifacts ?? listAgentArtifacts();
  return {
    schemaVersion: 1,
    projections: input.runtimes.map((runtime) => buildRuntimeArtifactProjection(runtime, artifacts)),
  };
}

function buildRuntimeArtifactProjection(
  runtime: AgentRuntimeDescriptor,
  artifacts: AgentArtifactLedgerRecord[],
): AgentRuntimeArtifactProjection {
  const outputKinds = uniqSorted(runtime.harnessCapabilities?.output ?? []);
  const reviewableOutputKinds = outputKinds.filter(isReviewableOutputKind);
  const nativeHandoffTargets = outputKinds.map(outputKindToHandoffTarget);
  const runtimeArtifacts = artifactsForRuntime(runtime, artifacts);
  const hasDeclaredOutputContract = !!runtime.harnessCapabilities;
  const hasReviewableOutput = reviewableOutputKinds.length > 0;
  const blockers = new Set<string>();

  if (runtime.status !== 'available') blockers.add('runtime-available');
  if (!hasDeclaredOutputContract) blockers.add('runtime-output-contract');
  if (!hasReviewableOutput) {
    blockers.add(runtime.kind === 'acp' ? 'adapter-artifact-contract' : 'runtime-review-output');
  }

  const status = resolveArtifactProjectionStatus({
    runtime,
    hasDeclaredOutputContract,
    hasReviewableOutput,
  });

  return {
    schemaVersion: 1,
    runtimeId: runtimeKey(runtime),
    runtimeName: runtime.name,
    runtimeKind: runtime.kind,
    runtimeStatus: runtime.status,
    status,
    outputKinds,
    reviewableOutputKinds,
    nativeHandoffTargets: uniqSorted(nativeHandoffTargets),
    nativeReview: {
      supported: hasReviewableOutput,
      summary: hasReviewableOutput
        ? `${runtime.name} declares reviewable output kinds: ${reviewableOutputKinds.join(', ')}.`
        : `${runtime.name} does not declare durable diff, artifact, checkpoint, branch, or PR output yet.`,
    },
    // The artifact pointer ledger ships with MindOS, so the index is always present; the
    // `status` union keeps `missing` / `unknown` for API compatibility only.
    artifactIndex: {
      supported: true,
      status: 'ready',
      owner: 'mindos',
      summary: `MindOS has a unified artifact pointer ledger for this runtime (${runtimeArtifacts.length} record(s)).`,
      recordCount: runtimeArtifacts.length,
      recentArtifacts: runtimeArtifacts.slice(0, 10).map((record) => ({
        id: record.id,
        kind: record.kind,
        source: record.source,
        status: record.status,
        ...(record.runId ? { runId: record.runId } : {}),
        ...(record.toolCallId ? { toolCallId: record.toolCallId } : {}),
        ...(record.toolName ? { toolName: record.toolName } : {}),
        ...(record.path ? { path: record.path } : {}),
        ...(Number.isFinite(record.line) ? { line: record.line } : {}),
        ...(record.uri ? { uri: record.uri } : {}),
        ...(record.title ? { title: record.title } : {}),
        ...(record.summary ? { summary: record.summary } : {}),
        ...(record.mimeType ? { mimeType: record.mimeType } : {}),
        ...(Number.isFinite(record.size) ? { size: record.size } : {}),
        updatedAt: record.updatedAt,
      })),
    },
    rollback: {
      supported: outputKinds.includes('checkpoint'),
      source: outputKinds.includes('checkpoint') ? 'runtime-checkpoint' : hasDeclaredOutputContract ? 'none' : 'unknown',
      summary: outputKinds.includes('checkpoint')
        ? `${runtime.name} declares checkpoint output that can anchor rollback or compare flows.`
        : `${runtime.name} does not declare checkpoint output through the current runtime descriptor.`,
    },
    branchPr: {
      supported: outputKinds.includes('branch') || outputKinds.includes('pr'),
      summary: outputKinds.includes('branch') || outputKinds.includes('pr')
        ? `${runtime.name} declares branch or PR handoff output.`
        : `${runtime.name} does not declare branch or PR handoff output.`,
    },
    reasons: [
      runtimeAvailableReason(runtime, ARTIFACT_AVAILABILITY_WORDING),
      reason(
        'runtime-output-contract',
        hasReviewableOutput ? 'satisfied' : runtime.kind === 'acp' ? 'unknown' : 'missing',
        runtime.kind === 'mindos' ? 'mindos' : 'external',
        hasReviewableOutput
          ? `${runtime.name} exposes reviewable output kinds in its runtime descriptor.`
          : runtime.kind === 'acp'
            ? 'Generic ACP descriptors need adapter-specific artifact/diff/branch/PR declarations before MindOS can trust output governance.'
            : `${runtime.name} does not expose a reviewable output contract yet.`,
      ),
      reason(
        'artifact-projection-contract',
        'satisfied',
        'mindos',
        'MindOS exposes a read-only runtime artifact projection contract for diagnostics and UI routing.',
      ),
      reason(
        'artifact-index',
        'satisfied',
        'mindos',
        'MindOS can persist outputs in a unified cross-runtime artifact index.',
      ),
      reason(
        'checkpoint-rollback',
        outputKinds.includes('checkpoint') ? 'external' : 'missing',
        outputKinds.includes('checkpoint') ? 'external' : 'shared',
        outputKinds.includes('checkpoint')
          ? `${runtime.name} owns native checkpoint/rollback semantics.`
          : 'No checkpoint/rollback output is declared for this runtime.',
      ),
      reason(
        'branch-pr-handoff',
        outputKinds.includes('branch') || outputKinds.includes('pr') ? 'external' : 'missing',
        outputKinds.includes('branch') || outputKinds.includes('pr') ? 'external' : 'shared',
        outputKinds.includes('branch') || outputKinds.includes('pr')
          ? `${runtime.name} can hand work off as a branch or PR reference.`
          : 'No branch/PR output is declared for this runtime.',
      ),
    ],
    ...(blockers.size > 0 ? { blockers: uniqSorted([...blockers]) } : {}),
  };
}

function artifactsForRuntime(
  runtime: AgentRuntimeDescriptor,
  artifacts: AgentArtifactLedgerRecord[],
): AgentArtifactLedgerRecord[] {
  const ids = new Set(
    [runtime.runtimeId, runtime.id, runtime.sourceAgentId, runtime.canonicalAgentId, runtime.kind]
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
  );
  return artifacts
    .filter((artifact) => ids.has(artifact.runtimeId))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function resolveArtifactProjectionStatus(input: {
  runtime: AgentRuntimeDescriptor;
  hasDeclaredOutputContract: boolean;
  hasReviewableOutput: boolean;
}): AgentRuntimeArtifactProjectionStatus {
  if (input.runtime.status !== 'available') return 'blocked';
  if (!input.hasDeclaredOutputContract) return 'unknown';
  if (input.hasReviewableOutput) return 'ready';
  if (input.runtime.kind === 'acp') return 'unknown';
  return 'blocked';
}


function isReviewableOutputKind(kind: AgentRuntimeArtifactOutputKind): boolean {
  return kind === 'diff' || kind === 'checkpoint' || kind === 'artifact' || kind === 'branch' || kind === 'pr';
}

function outputKindToHandoffTarget(kind: AgentRuntimeArtifactOutputKind): AgentRuntimeArtifactHandoffTarget {
  switch (kind) {
    case 'diff':
      return 'diff';
    case 'checkpoint':
      return 'checkpoint';
    case 'artifact':
      return 'artifact';
    case 'branch':
      return 'branch';
    case 'pr':
      return 'pull-request';
    case 'text':
      return 'message';
  }
}
