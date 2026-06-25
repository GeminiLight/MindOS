import {
  isMindosPermissionMode,
  type MindosPermissionMode,
} from '../../agent/permission/index.js';
import type {
  AgentRuntimeCompatibilityAssessment,
  AgentRuntimeCompatibilityOwner,
  AgentRuntimeCompatibilityRequirement,
  AgentRuntimeCompatibilityRequirementStatus,
  AgentRuntimeCompatibilityScenario,
  AgentRuntimeDescriptor,
  AgentRuntimeKind,
  AgentRuntimeStatus,
} from '../../agent/runtime/registry.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import {
  buildAgentRuntimeArtifactProjectionsPayload,
  type AgentRuntimeArtifactProjection,
} from './runtime-artifact-projections.js';
import {
  buildAgentRuntimeAutomationProjectionsPayload,
  type AgentRuntimeAutomationProjection,
} from './runtime-automation-projections.js';
import {
  buildAgentRuntimeAdapterProjectionsPayload,
  type AgentRuntimeAdapterProjection,
} from './runtime-adapter-projections.js';
import {
  buildAgentRuntimePermissionProjectionsPayload,
  type AgentRuntimePermissionProjection,
} from './runtime-permission-projections.js';
import {
  buildAgentRuntimeMcpProjectionsPayload,
  type AgentRuntimeMcpProjection,
  type AgentRuntimeMcpProjectionServices,
} from './mcp-runtime-projections.js';

export type AgentRuntimeReadinessStatus =
  | 'ready'
  | 'usable'
  | 'limited'
  | 'blocked'
  | 'unknown';

export type AgentRuntimeReadinessSource =
  | 'compatibility-profile'
  | 'adapter-projection'
  | 'permission-projection'
  | 'mcp-projection'
  | 'artifact-projection'
  | 'automation-projection';

export type AgentRuntimeReadinessGapCategory =
  | 'mindos-product'
  | 'runtime-native'
  | 'adapter-contract'
  | 'deployment'
  | 'user-setup'
  | 'shared';

export type AgentRuntimeReadinessGapSeverity =
  | 'info'
  | 'warning'
  | 'blocking';

export type AgentRuntimeReadinessRequirement = {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
};

export type AgentRuntimeReadinessUseCaseId =
  | AgentRuntimeCompatibilityScenario
  | 'adapter-contract';

export type AgentRuntimeReadinessUseCase = {
  id: AgentRuntimeReadinessUseCaseId;
  label: string;
  status: AgentRuntimeReadinessStatus;
  source: AgentRuntimeReadinessSource;
  sourceStatus: string;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
  requirements: AgentRuntimeReadinessRequirement[];
  blockers?: string[];
  details?: Record<string, unknown>;
};

export type AgentRuntimeReadinessRecommendation = {
  useCase: AgentRuntimeCompatibilityScenario;
  confidence: 'strong' | 'conditional';
  summary: string;
};

export type AgentRuntimeReadinessGap = {
  id: string;
  category: AgentRuntimeReadinessGapCategory;
  severity: AgentRuntimeReadinessGapSeverity;
  summary: string;
  useCases: AgentRuntimeReadinessUseCaseId[];
};

export type AgentRuntimeReadinessProjection = {
  schemaVersion: 1;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeStatus: AgentRuntimeStatus;
  overallStatus: AgentRuntimeReadinessStatus;
  summary: string;
  recommendations: AgentRuntimeReadinessRecommendation[];
  useCases: AgentRuntimeReadinessUseCase[];
  gaps: AgentRuntimeReadinessGap[];
  blockers?: string[];
};

export type AgentRuntimeReadinessPayload = {
  schemaVersion: 1;
  requestedPermissionMode: MindosPermissionMode;
  projections: AgentRuntimeReadinessProjection[];
};

export type AgentRuntimeReadinessServices = AgentRuntimeMcpProjectionServices;

type RuntimeProjectionContext = {
  adapterByRuntime: Map<string, AgentRuntimeAdapterProjection>;
  permissionByRuntime: Map<string, AgentRuntimePermissionProjection>;
  mcpByRuntime: Map<string, AgentRuntimeMcpProjection>;
  artifactByRuntime: Map<string, AgentRuntimeArtifactProjection>;
  automationByRuntime: Map<string, AgentRuntimeAutomationProjection>;
};

const USE_CASE_LABELS: Record<AgentRuntimeReadinessUseCaseId, string> = {
  'adapter-contract': 'Adapter contract',
  'interactive-turn': 'Interactive turn',
  'coding-workflow': 'Coding workflow',
  'session-continuity': 'Session continuity',
  'context-governance': 'Context governance',
  'permission-governance': 'Permission governance',
  'mcp-tooling': 'MCP tooling',
  'skill-execution': 'Skill execution',
  'artifact-governance': 'Artifact governance',
  'remote-control': 'Remote control',
  'unattended-automation': '24/7 automation',
  'team-coordination': 'Team coordination',
};

const BASE_COMPATIBILITY_USE_CASES: AgentRuntimeCompatibilityScenario[] = [
  'interactive-turn',
  'coding-workflow',
  'session-continuity',
  'context-governance',
  'skill-execution',
  'team-coordination',
];

export async function handleAgentRuntimeReadinessGet(
  searchParams: URLSearchParams,
  services: AgentRuntimeReadinessServices,
): Promise<MindosServerResponse<AgentRuntimeReadinessPayload | { error: string }>> {
  const permissionModeResult = parsePermissionMode(searchParams.get('permissionMode'));
  if ('error' in permissionModeResult) return json({ error: permissionModeResult.error }, { status: 400 });

  try {
    const [runtimes, mcpAgents] = await Promise.all([
      services.listRuntimes(),
      services.listMcpAgents(),
    ]);
    const payload = buildAgentRuntimeReadinessPayload({
      runtimes,
      mcpAgents,
      mindosMcpConfig: services.readMcpConfig?.(),
      permissionMode: permissionModeResult.permissionMode,
    });
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

export function buildAgentRuntimeReadinessPayload(input: {
  runtimes: AgentRuntimeDescriptor[];
  mcpAgents: Parameters<typeof buildAgentRuntimeMcpProjectionsPayload>[0]['mcpAgents'];
  mindosMcpConfig?: Parameters<typeof buildAgentRuntimeMcpProjectionsPayload>[0]['mindosMcpConfig'];
  permissionMode?: MindosPermissionMode;
}): AgentRuntimeReadinessPayload {
  const permissionMode = input.permissionMode ?? 'ask';
  const permissionPayload = buildAgentRuntimePermissionProjectionsPayload({
    runtimes: input.runtimes,
    permissionMode,
  });
  const mcpPayload = buildAgentRuntimeMcpProjectionsPayload({
    runtimes: input.runtimes,
    mcpAgents: input.mcpAgents,
    mindosMcpConfig: input.mindosMcpConfig,
  });
  const artifactPayload = buildAgentRuntimeArtifactProjectionsPayload({ runtimes: input.runtimes });
  const automationPayload = buildAgentRuntimeAutomationProjectionsPayload({ runtimes: input.runtimes });
  const adapterPayload = buildAgentRuntimeAdapterProjectionsPayload({ runtimes: input.runtimes });
  const context: RuntimeProjectionContext = {
    adapterByRuntime: byRuntime(adapterPayload.projections),
    permissionByRuntime: byRuntime(permissionPayload.projections),
    mcpByRuntime: byRuntime(mcpPayload.projections),
    artifactByRuntime: byRuntime(artifactPayload.projections),
    automationByRuntime: byRuntime(automationPayload.projections),
  };

  return {
    schemaVersion: 1,
    requestedPermissionMode: permissionMode,
    projections: input.runtimes.map((runtime) => buildRuntimeReadinessProjection(runtime, context)),
  };
}

function buildRuntimeReadinessProjection(
  runtime: AgentRuntimeDescriptor,
  context: RuntimeProjectionContext,
): AgentRuntimeReadinessProjection {
  const useCases = [
    adapterUseCase(runtime, context.adapterByRuntime.get(runtimeKey(runtime))),
    ...BASE_COMPATIBILITY_USE_CASES.map((scenario) => compatibilityUseCase(runtime, scenario)),
    permissionUseCase(runtime, context.permissionByRuntime.get(runtimeKey(runtime))),
    mcpUseCase(runtime, context.mcpByRuntime.get(runtimeKey(runtime))),
    artifactUseCase(runtime, context.artifactByRuntime.get(runtimeKey(runtime))),
    remoteUseCase(runtime, context.automationByRuntime.get(runtimeKey(runtime))),
    unattendedUseCase(runtime, context.automationByRuntime.get(runtimeKey(runtime))),
  ];
  const gaps = collectReadinessGaps(useCases);
  const blockers = uniqSorted(gaps
    .filter((gap) => gap.severity === 'blocking')
    .map((gap) => gap.id));
  return {
    schemaVersion: 1,
    runtimeId: runtimeKey(runtime),
    runtimeName: runtime.name,
    runtimeKind: runtime.kind,
    runtimeStatus: runtime.status,
    overallStatus: resolveOverallStatus(runtime, useCases),
    summary: runtime.compatibility.summary,
    recommendations: buildRecommendations(useCases),
    useCases,
    gaps,
    ...(blockers.length > 0 ? { blockers } : {}),
  };
}

function adapterUseCase(
  runtime: AgentRuntimeDescriptor,
  projection: AgentRuntimeAdapterProjection | undefined,
): AgentRuntimeReadinessUseCase {
  if (!projection) return missingProjectionUseCase(runtime, 'adapter-contract', 'adapter-projection');
  return runtimeGate(runtime, {
    id: 'adapter-contract',
    label: USE_CASE_LABELS['adapter-contract'],
    status: adapterStatusToReadiness(projection.status),
    source: 'adapter-projection',
    sourceStatus: projection.status,
    owner: 'shared',
    summary: adapterSummary(projection),
    requirements: projection.reasons.map(requirementFromReason),
    ...(projection.blockers?.length ? { blockers: uniqSorted(projection.blockers) } : {}),
    details: {
      connection: projection.connection,
      configuration: projection.configuration,
      health: projection.health,
      commands: projection.commands,
    },
  });
}

function compatibilityUseCase(
  runtime: AgentRuntimeDescriptor,
  scenario: AgentRuntimeCompatibilityScenario,
): AgentRuntimeReadinessUseCase {
  const assessment = runtime.compatibility.scenarios[scenario];
  return runtimeGate(runtime, {
    id: scenario,
    label: USE_CASE_LABELS[scenario],
    status: compatibilityLevelToStatus(assessment.level),
    source: 'compatibility-profile',
    sourceStatus: assessment.level,
    owner: assessment.owner,
    summary: assessment.summary,
    requirements: assessment.requirements.map(requirementFromCompatibility),
    ...(assessment.blockers?.length ? { blockers: uniqSorted(assessment.blockers) } : {}),
  });
}

function permissionUseCase(
  runtime: AgentRuntimeDescriptor,
  projection: AgentRuntimePermissionProjection | undefined,
): AgentRuntimeReadinessUseCase {
  if (!projection) return missingProjectionUseCase(runtime, 'permission-governance', 'permission-projection');
  return runtimeGate(runtime, {
    id: 'permission-governance',
    label: USE_CASE_LABELS['permission-governance'],
    status: permissionStatusToReadiness(projection.status),
    source: 'permission-projection',
    sourceStatus: projection.status,
    owner: projection.permissionOwner === 'mindos' ? 'mindos' : 'shared',
    summary: projection.interactiveApproval.summary,
    requirements: projection.reasons.map(requirementFromReason),
    ...(projection.blockers?.length ? { blockers: uniqSorted(projection.blockers) } : {}),
    details: {
      requestedPermissionMode: projection.requestedPermissionMode,
      harnessPermissionModel: projection.harnessPermissionModel,
      interactiveApproval: projection.interactiveApproval,
      unattendedApproval: projection.unattendedApproval,
    },
  });
}

function mcpUseCase(
  runtime: AgentRuntimeDescriptor,
  projection: AgentRuntimeMcpProjection | undefined,
): AgentRuntimeReadinessUseCase {
  if (!projection) return missingProjectionUseCase(runtime, 'mcp-tooling', 'mcp-projection');
  return runtimeGate(runtime, {
    id: 'mcp-tooling',
    label: USE_CASE_LABELS['mcp-tooling'],
    status: mcpStatusToReadiness(projection.status),
    source: 'mcp-projection',
    sourceStatus: projection.status,
    owner: 'shared',
    summary: mcpSummary(projection),
    requirements: projection.reasons.map(requirementFromReason),
    ...(projection.blockers?.length ? { blockers: uniqSorted(projection.blockers) } : {}),
    details: {
      configuredServerCount: projection.configuredServerCount,
      mindosConfigServerCount: projection.mindosConfigServerCount,
      projectedServerCount: projection.projectedServerCount,
      supportsNativeConfig: projection.supportsNativeConfig,
      supportsMindosProjection: projection.supportsMindosProjection,
    },
  });
}

function artifactUseCase(
  runtime: AgentRuntimeDescriptor,
  projection: AgentRuntimeArtifactProjection | undefined,
): AgentRuntimeReadinessUseCase {
  if (!projection) return missingProjectionUseCase(runtime, 'artifact-governance', 'artifact-projection');
  return runtimeGate(runtime, {
    id: 'artifact-governance',
    label: USE_CASE_LABELS['artifact-governance'],
    status: compatibilityLevelToStatus(projection.status),
    source: 'artifact-projection',
    sourceStatus: projection.status,
    owner: 'shared',
    summary: projection.nativeReview.summary,
    requirements: projection.reasons.map(requirementFromReason),
    ...(projection.blockers?.length ? { blockers: uniqSorted(projection.blockers) } : {}),
    details: {
      outputKinds: projection.outputKinds,
      reviewableOutputKinds: projection.reviewableOutputKinds,
      nativeHandoffTargets: projection.nativeHandoffTargets,
      artifactIndex: projection.artifactIndex,
      rollback: projection.rollback,
      branchPr: projection.branchPr,
    },
  });
}

function remoteUseCase(
  runtime: AgentRuntimeDescriptor,
  projection: AgentRuntimeAutomationProjection | undefined,
): AgentRuntimeReadinessUseCase {
  if (!projection) return missingProjectionUseCase(runtime, 'remote-control', 'automation-projection');
  return runtimeGate(runtime, {
    id: 'remote-control',
    label: USE_CASE_LABELS['remote-control'],
    status: compatibilityLevelToStatus(projection.remoteControl.status),
    source: 'automation-projection',
    sourceStatus: projection.remoteControl.status,
    owner: 'shared',
    summary: projection.remoteControl.summary,
    requirements: projection.reasons.map(requirementFromReason),
    ...(projection.remoteControl.blockers?.length ? { blockers: uniqSorted(projection.remoteControl.blockers) } : {}),
    details: {
      supported: projection.remoteControl.supported,
      mode: projection.remoteControl.mode,
    },
  });
}

function unattendedUseCase(
  runtime: AgentRuntimeDescriptor,
  projection: AgentRuntimeAutomationProjection | undefined,
): AgentRuntimeReadinessUseCase {
  if (!projection) return missingProjectionUseCase(runtime, 'unattended-automation', 'automation-projection');
  return runtimeGate(runtime, {
    id: 'unattended-automation',
    label: USE_CASE_LABELS['unattended-automation'],
    status: compatibilityLevelToStatus(projection.unattendedAutomation.status),
    source: 'automation-projection',
    sourceStatus: projection.unattendedAutomation.status,
    owner: 'shared',
    summary: projection.unattendedAutomation.summary,
    requirements: projection.reasons.map(requirementFromReason),
    ...(projection.unattendedAutomation.blockers?.length ? { blockers: uniqSorted(projection.unattendedAutomation.blockers) } : {}),
    details: {
      supported: projection.unattendedAutomation.supported,
      support: projection.unattendedAutomation.support,
      productPrerequisites: projection.productPrerequisites,
    },
  });
}

function runtimeGate(
  runtime: AgentRuntimeDescriptor,
  useCase: AgentRuntimeReadinessUseCase,
): AgentRuntimeReadinessUseCase {
  if (runtime.status === 'available') return useCase;
  return {
    ...useCase,
    status: 'blocked',
    summary: `${runtime.name} is not available, so ${useCase.label.toLowerCase()} readiness cannot be trusted.`,
    requirements: [
      {
        id: 'runtime-available',
        status: 'missing',
        owner: 'shared',
        summary: `${runtime.name} must be available before MindOS can use this runtime scenario.`,
      },
      ...useCase.requirements,
    ],
    blockers: ['runtime-available'],
  };
}

function missingProjectionUseCase(
  runtime: AgentRuntimeDescriptor,
  id: AgentRuntimeReadinessUseCaseId,
  source: Exclude<AgentRuntimeReadinessSource, 'compatibility-profile'>,
): AgentRuntimeReadinessUseCase {
  return runtimeGate(runtime, {
    id,
    label: USE_CASE_LABELS[id],
    status: 'unknown',
    source,
    sourceStatus: 'missing',
    owner: 'shared',
    summary: `MindOS could not build the ${USE_CASE_LABELS[id].toLowerCase()} projection for ${runtime.name}.`,
    requirements: [{
      id: `${source}-available`,
      status: 'missing',
      owner: 'mindos',
      summary: `The ${source} contract did not return a projection for this runtime.`,
    }],
    blockers: [`${source}-available`],
  });
}

function resolveOverallStatus(
  runtime: AgentRuntimeDescriptor,
  useCases: AgentRuntimeReadinessUseCase[],
): AgentRuntimeReadinessStatus {
  if (runtime.status !== 'available') return 'blocked';
  const byId = new Map(useCases.map((useCase) => [useCase.id, useCase]));
  const interactive = byId.get('interactive-turn')?.status;
  const context = byId.get('context-governance')?.status;
  const coding = byId.get('coding-workflow')?.status;
  const permission = byId.get('permission-governance')?.status;
  const adapter = byId.get('adapter-contract')?.status;
  if (adapter === 'blocked') return 'blocked';
  if (
    interactive === 'ready' &&
    readyEnough(permission) &&
    readyEnough(adapter) &&
    (coding === 'ready' || context === 'ready')
  ) {
    const coreStatuses = ['session-continuity', 'context-governance', 'permission-governance']
      .map((id) => byId.get(id as AgentRuntimeCompatibilityScenario)?.status);
    return coreStatuses.every((status) => status === 'ready') && coding === 'ready'
      ? 'ready'
      : 'usable';
  }
  if (useCases.some((useCase) => readyEnough(useCase.status))) return 'limited';
  if (useCases.some((useCase) => useCase.status === 'unknown')) return 'unknown';
  return 'blocked';
}

function buildRecommendations(
  useCases: AgentRuntimeReadinessUseCase[],
): AgentRuntimeReadinessRecommendation[] {
  const recommendations: AgentRuntimeReadinessRecommendation[] = [];
  for (const useCase of useCases) {
    if (!isCompatibilityScenario(useCase.id)) continue;
    if (useCase.status === 'ready' || useCase.status === 'usable') {
      recommendations.push({
        useCase: useCase.id,
        confidence: 'strong',
        summary: useCase.summary,
      });
      continue;
    }
    if (useCase.status === 'limited' && conditionalRecommendation(useCase.id)) {
      recommendations.push({
        useCase: useCase.id,
        confidence: 'conditional',
        summary: useCase.summary,
      });
    }
  }
  return recommendations;
}

function conditionalRecommendation(id: AgentRuntimeCompatibilityScenario): boolean {
  return id === 'mcp-tooling'
    || id === 'skill-execution'
    || id === 'artifact-governance'
    || id === 'remote-control';
}

function collectReadinessGaps(useCases: AgentRuntimeReadinessUseCase[]): AgentRuntimeReadinessGap[] {
  const gaps = new Map<string, AgentRuntimeReadinessGap>();
  for (const useCase of useCases) {
    for (const blocker of useCase.blockers ?? []) {
      const existing = gaps.get(blocker);
      const requirement = useCase.requirements.find((entry) => entry.id === blocker);
      const severity = useCase.status === 'blocked' ? 'blocking' : 'warning';
      if (existing) {
        existing.useCases = uniqSorted([...existing.useCases, useCase.id]) as AgentRuntimeReadinessUseCaseId[];
        if (severity === 'blocking') existing.severity = 'blocking';
        continue;
      }
      gaps.set(blocker, {
        id: blocker,
        category: classifyGapCategory(blocker),
        severity,
        summary: requirement?.summary ?? humanizeGap(blocker),
        useCases: [useCase.id],
      });
    }
  }
  return [...gaps.values()].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    return severityDelta || left.id.localeCompare(right.id);
  });
}

function classifyGapCategory(id: string): AgentRuntimeReadinessGapCategory {
  if (id === 'runtime-available' || id.includes('runtime-detected') || id.includes('runtime-authenticated')) return 'user-setup';
  if (id.startsWith('adapter-')) return 'adapter-contract';
  if (
    id === 'scheduler'
    || id === 'wake-resume'
    || id === 'failure-audit'
    || id === 'artifact-index'
    || id === 'durable-approval-queue'
    || id === 'approval-timeout-recovery'
    || id === 'skill-runtime-routing'
    || id === 'mailbox'
    || id === 'task-board'
  ) return 'mindos-product';
  if (id.includes('server-host') || id.includes('remote-auth') || id.includes('permission-reachability')) return 'deployment';
  if (id.includes('native') || id.startsWith('runtime-') || id === 'list-attach-archive') return 'runtime-native';
  return 'shared';
}

function severityRank(severity: AgentRuntimeReadinessGapSeverity): number {
  if (severity === 'blocking') return 2;
  if (severity === 'warning') return 1;
  return 0;
}

function readyEnough(status: AgentRuntimeReadinessStatus | undefined): boolean {
  return status === 'ready' || status === 'usable' || status === 'limited';
}

function compatibilityLevelToStatus(level: AgentRuntimeCompatibilityAssessment['level']): AgentRuntimeReadinessStatus {
  return level;
}

function permissionStatusToReadiness(status: AgentRuntimePermissionProjection['status']): AgentRuntimeReadinessStatus {
  if (status === 'ready') return 'ready';
  if (status === 'interactive-only') return 'usable';
  return status;
}

function mcpStatusToReadiness(status: AgentRuntimeMcpProjection['status']): AgentRuntimeReadinessStatus {
  if (status === 'ready') return 'ready';
  if (status === 'projectable') return 'limited';
  return status;
}

function adapterStatusToReadiness(status: AgentRuntimeAdapterProjection['status']): AgentRuntimeReadinessStatus {
  return status;
}

function adapterSummary(projection: AgentRuntimeAdapterProjection): string {
  if (projection.status === 'ready') {
    return `${projection.runtimeName} adapter contract is ready across connection, configuration, health, and commands.`;
  }
  if (projection.status === 'limited') {
    return `${projection.runtimeName} adapter contract is usable, but some adapter diagnostics remain limited or undeclared.`;
  }
  if (projection.status === 'blocked') {
    return `${projection.runtimeName} adapter contract is blocked.`;
  }
  return `${projection.runtimeName} adapter contract readiness is unknown.`;
}

function mcpSummary(projection: AgentRuntimeMcpProjection): string {
  if (projection.status === 'ready') {
    return `${projection.runtimeName} has ${projection.projectedServerCount} MCP server(s) available through its current runtime surface.`;
  }
  if (projection.status === 'projectable') {
    return `${projection.runtimeName} can receive MCP configuration, but an explicit projection or native config update is still needed.`;
  }
  return `${projection.runtimeName} MCP readiness is ${projection.status}.`;
}

function requirementFromCompatibility(requirement: AgentRuntimeCompatibilityRequirement): AgentRuntimeReadinessRequirement {
  return {
    id: requirement.id,
    status: requirement.status,
    owner: requirement.owner,
    summary: requirement.summary,
  };
}

function requirementFromReason(reason: {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
}): AgentRuntimeReadinessRequirement {
  return {
    id: reason.id,
    status: reason.status,
    owner: reason.owner,
    summary: reason.summary,
  };
}

function byRuntime<T extends { runtimeId: string }>(projections: T[]): Map<string, T> {
  return new Map(projections.map((projection) => [projection.runtimeId, projection]));
}

function runtimeKey(runtime: AgentRuntimeDescriptor): string {
  return runtime.runtimeId ?? runtime.id;
}

function isCompatibilityScenario(id: AgentRuntimeReadinessUseCaseId): id is AgentRuntimeCompatibilityScenario {
  return id !== 'adapter-contract';
}

function parsePermissionMode(value: string | null):
  | { permissionMode: MindosPermissionMode }
  | { error: string } {
  if (!value) return { permissionMode: 'ask' };
  if (isMindosPermissionMode(value)) return { permissionMode: value };
  return { error: `Unsupported permissionMode: ${value}` };
}

function humanizeGap(id: string): string {
  return id.replace(/-/g, ' ');
}

function uniqSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}
