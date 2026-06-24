import type {
  AgentRuntimeCompatibilityAssessment,
  AgentRuntimeCompatibilityOwner,
  AgentRuntimeCompatibilityRequirementStatus,
  AgentRuntimeDescriptor,
  AgentRuntimeKind,
  AgentRuntimeRemoteMode,
  AgentRuntimeStatus,
  AgentRuntimeUnattendedSupport,
} from '../../agent/runtime/registry.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';

export type AgentRuntimeAutomationProjectionStatus =
  | 'ready'
  | 'remote-only'
  | 'limited'
  | 'blocked'
  | 'unknown';

export type AgentRuntimeAutomationReadinessStatus =
  | 'ready'
  | 'limited'
  | 'blocked'
  | 'unknown';

export type AgentRuntimeAutomationProjectionReason = {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
};

export type AgentRuntimeAutomationProjection = {
  schemaVersion: 1;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeStatus: AgentRuntimeStatus;
  status: AgentRuntimeAutomationProjectionStatus;
  remoteControl: {
    status: AgentRuntimeAutomationReadinessStatus;
    supported: boolean;
    mode: AgentRuntimeRemoteMode;
    summary: string;
    blockers?: string[];
  };
  unattendedAutomation: {
    status: AgentRuntimeAutomationReadinessStatus;
    supported: boolean;
    support: AgentRuntimeUnattendedSupport;
    summary: string;
    blockers?: string[];
  };
  productPrerequisites: AgentRuntimeAutomationProjectionReason[];
  reasons: AgentRuntimeAutomationProjectionReason[];
  blockers?: string[];
};

export type AgentRuntimeAutomationProjectionsPayload = {
  schemaVersion: 1;
  projections: AgentRuntimeAutomationProjection[];
};

export type AgentRuntimeAutomationProjectionServices = {
  listRuntimes(): AgentRuntimeDescriptor[] | Promise<AgentRuntimeDescriptor[]>;
};

export async function handleAgentRuntimeAutomationProjectionsGet(
  searchParams: URLSearchParams,
  services: AgentRuntimeAutomationProjectionServices,
): Promise<MindosServerResponse<AgentRuntimeAutomationProjectionsPayload | { error: string }>> {
  try {
    const runtimes = await services.listRuntimes();
    const payload = buildAgentRuntimeAutomationProjectionsPayload({ runtimes });
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

export function buildAgentRuntimeAutomationProjectionsPayload(input: {
  runtimes: AgentRuntimeDescriptor[];
}): AgentRuntimeAutomationProjectionsPayload {
  return {
    schemaVersion: 1,
    projections: input.runtimes.map((runtime) => buildRuntimeAutomationProjection(runtime)),
  };
}

function buildRuntimeAutomationProjection(runtime: AgentRuntimeDescriptor): AgentRuntimeAutomationProjection {
  const remoteAssessment = runtime.compatibility.scenarios['remote-control'];
  const unattendedAssessment = runtime.compatibility.scenarios['unattended-automation'];
  const runtimeUnavailable = runtime.status !== 'available';
  const remoteStatus = runtimeUnavailable ? 'blocked' : levelToReadiness(remoteAssessment.level);
  const unattendedStatus = runtimeUnavailable ? 'blocked' : levelToReadiness(unattendedAssessment.level);
  const remoteSupported = !runtimeUnavailable && runtime.lifecycle.remote.supported;
  const unattendedSupported = unattendedStatus === 'ready';
  const productPrerequisites = buildProductPrerequisites(unattendedAssessment);
  const blockers = uniqSorted([
    ...(runtimeUnavailable ? ['runtime-available'] : []),
    ...(remoteAssessment.blockers ?? []),
    ...(unattendedAssessment.blockers ?? []),
  ]);

  return {
    schemaVersion: 1,
    runtimeId: runtime.runtimeId ?? runtime.id,
    runtimeName: runtime.name,
    runtimeKind: runtime.kind,
    runtimeStatus: runtime.status,
    status: resolveAutomationProjectionStatus({
      runtime,
      remoteSupported,
      remoteStatus,
      unattendedStatus,
    }),
    remoteControl: {
      status: remoteStatus,
      supported: remoteSupported,
      mode: runtime.lifecycle.remote.mode,
      summary: remoteAssessment.summary,
      ...(remoteAssessment.blockers?.length ? { blockers: uniqSorted(remoteAssessment.blockers) } : {}),
    },
    unattendedAutomation: {
      status: unattendedStatus,
      supported: unattendedSupported,
      support: runtime.lifecycle.remote.unattended,
      summary: unattendedAssessment.summary,
      ...(unattendedAssessment.blockers?.length ? { blockers: uniqSorted(unattendedAssessment.blockers) } : {}),
    },
    productPrerequisites,
    reasons: [
      runtimeAvailableReason(runtime),
      reason(
        'server-runnable',
        remoteSupported ? 'satisfied' : runtimeUnavailable ? 'unknown' : 'missing',
        runtime.kind === 'mindos' ? 'mindos' : 'external',
        remoteSupported
          ? `${runtime.name} can run on the MindOS server host according to its lifecycle descriptor.`
          : `${runtime.name} is not server-runnable through the current lifecycle descriptor.`,
      ),
      reason(
        'remote-control-surface',
        remoteStatus === 'ready' ? 'satisfied' : remoteStatus === 'limited' ? 'external' : remoteStatus === 'blocked' ? 'missing' : 'unknown',
        'shared',
        'Remote control also depends on an authenticated product surface, reachable runtime host, and reachable permission prompts.',
      ),
      reason(
        'unattended-automation',
        unattendedStatus === 'ready' ? 'satisfied' : unattendedStatus === 'limited' ? 'missing' : unattendedStatus === 'blocked' ? 'missing' : 'unknown',
        'shared',
        unattendedAssessment.summary,
      ),
      ...productPrerequisites,
    ],
    ...(blockers.length > 0 ? { blockers } : {}),
  };
}

function buildProductPrerequisites(
  unattendedAssessment: AgentRuntimeCompatibilityAssessment,
): AgentRuntimeAutomationProjectionReason[] {
  return [
    prerequisiteReason(unattendedAssessment, 'scheduler', 'A durable scheduler must create, retry, and recover background turns.'),
    prerequisiteReason(unattendedAssessment, 'approval-routing', 'Permission prompts need an unattended-safe approval route.'),
    prerequisiteReason(unattendedAssessment, 'wake-resume', 'MindOS must wake, resume, and reconcile missed triggers.'),
    prerequisiteReason(unattendedAssessment, 'failure-audit', 'Failed or partial background work needs a user-visible audit trail.'),
  ];
}

function prerequisiteReason(
  assessment: AgentRuntimeCompatibilityAssessment,
  id: string,
  fallbackSummary: string,
): AgentRuntimeAutomationProjectionReason {
  const requirement = assessment.requirements.find((entry) => entry.id === id);
  return reason(
    id,
    requirement?.status ?? 'unknown',
    requirement?.owner ?? 'shared',
    requirement?.summary ?? fallbackSummary,
  );
}

function resolveAutomationProjectionStatus(input: {
  runtime: AgentRuntimeDescriptor;
  remoteSupported: boolean;
  remoteStatus: AgentRuntimeAutomationReadinessStatus;
  unattendedStatus: AgentRuntimeAutomationReadinessStatus;
}): AgentRuntimeAutomationProjectionStatus {
  if (input.runtime.status !== 'available') return 'blocked';
  if (input.remoteStatus === 'ready' && input.unattendedStatus === 'ready') return 'ready';
  if (input.remoteSupported && (input.unattendedStatus === 'blocked' || input.unattendedStatus === 'unknown')) return 'remote-only';
  if (input.remoteSupported || input.unattendedStatus === 'limited') return 'limited';
  if (input.remoteStatus === 'blocked' && input.unattendedStatus === 'blocked') return 'blocked';
  return 'unknown';
}

function levelToReadiness(level: AgentRuntimeCompatibilityAssessment['level']): AgentRuntimeAutomationReadinessStatus {
  return level;
}

function runtimeAvailableReason(runtime: AgentRuntimeDescriptor): AgentRuntimeAutomationProjectionReason {
  return reason(
    'runtime-available',
    runtime.status === 'available' ? 'satisfied' : 'missing',
    runtime.status === 'available' ? 'mindos' : 'shared',
    runtime.status === 'available'
      ? `${runtime.name} is available for remote and automation diagnostics.`
      : `${runtime.name} is not available, so remote and 24/7 readiness cannot be trusted.`,
  );
}

function reason(
  id: string,
  status: AgentRuntimeCompatibilityRequirementStatus,
  owner: AgentRuntimeCompatibilityOwner,
  summary: string,
): AgentRuntimeAutomationProjectionReason {
  return { id, status, owner, summary };
}

function uniqSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
