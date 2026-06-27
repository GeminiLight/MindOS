import type {
  AgentRuntimeCompatibilityOwner,
  AgentRuntimeCompatibilityRequirementStatus,
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

export type AgentRuntimeArtifactProjectionReason = {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
};

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
    const runtimeFilter = searchParams.get('runtime')?.trim();
    const projections = runtimeFilter
      ? payload.projections.filter((projection) => projection.runtimeId === runtimeFilter || projection.runtimeKind === runtimeFilter)
      : payload.projections;
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
  const artifactIndexReady = true;
  const hasDeclaredOutputContract = !!runtime.harnessCapabilities;
  const hasReviewableOutput = reviewableOutputKinds.length > 0;
  const blockers = new Set<string>();

  if (runtime.status !== 'available') blockers.add('runtime-available');
  if (!hasDeclaredOutputContract) blockers.add('runtime-output-contract');
  if (!artifactIndexReady) blockers.add('artifact-index');
  if (!hasReviewableOutput) {
    blockers.add(runtime.kind === 'acp' ? 'adapter-artifact-contract' : 'runtime-review-output');
  }

  const status = resolveArtifactProjectionStatus({
    runtime,
    artifactIndexReady,
    hasDeclaredOutputContract,
    hasReviewableOutput,
  });

  return {
    schemaVersion: 1,
    runtimeId: runtime.runtimeId ?? runtime.id,
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
    artifactIndex: {
      supported: artifactIndexReady,
      status: artifactIndexReady ? 'ready' : 'missing',
      owner: 'mindos',
      summary: artifactIndexReady
        ? `MindOS has a unified artifact pointer ledger for this runtime (${runtimeArtifacts.length} record(s)).`
        : 'MindOS still needs a cross-runtime artifact index before outputs can be durably reviewed and compared.',
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
      runtimeAvailableReason(runtime),
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
        artifactIndexReady ? 'satisfied' : 'missing',
        'mindos',
        artifactIndexReady
          ? 'MindOS can persist outputs in a unified cross-runtime artifact index.'
          : 'MindOS cannot yet persist cross-runtime outputs in a unified artifact index.',
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
  artifactIndexReady: boolean;
  hasDeclaredOutputContract: boolean;
  hasReviewableOutput: boolean;
}): AgentRuntimeArtifactProjectionStatus {
  if (input.runtime.status !== 'available') return 'blocked';
  if (!input.hasDeclaredOutputContract) return 'unknown';
  if (input.artifactIndexReady && input.hasReviewableOutput) return 'ready';
  if (input.hasReviewableOutput) return 'limited';
  if (input.runtime.kind === 'acp') return 'unknown';
  return 'blocked';
}

function runtimeAvailableReason(runtime: AgentRuntimeDescriptor): AgentRuntimeArtifactProjectionReason {
  return reason(
    'runtime-available',
    runtime.status === 'available' ? 'satisfied' : 'missing',
    runtime.status === 'available' ? 'mindos' : 'shared',
    runtime.status === 'available'
      ? `${runtime.name} is available for artifact projection diagnostics.`
      : `${runtime.name} is not available, so artifact output readiness cannot be trusted.`,
  );
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

function reason(
  id: string,
  status: AgentRuntimeCompatibilityRequirementStatus,
  owner: AgentRuntimeCompatibilityOwner,
  summary: string,
): AgentRuntimeArtifactProjectionReason {
  return { id, status, owner, summary };
}

function uniqSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}
