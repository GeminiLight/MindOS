import {
  createMindosAgentPermissionPolicy,
  type MindosAgentPermissionPolicy,
} from '../../agent/mindos-pi/permission/policy.js';
import {
  isMindosPermissionMode,
  MINDOS_PERMISSION_MODES,
  type MindosPermissionMode,
} from '../../agent/permission/index.js';
import type {
  AgentRuntimeCompatibilityOwner,
  AgentRuntimeCompatibilityRequirementStatus,
  AgentRuntimeDescriptor,
  AgentRuntimeKind,
  AgentRuntimeOwner,
  AgentRuntimeStatus,
} from '../../agent/runtime/registry.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';

export type AgentRuntimePermissionProjectionStatus =
  | 'ready'
  | 'interactive-only'
  | 'limited'
  | 'blocked'
  | 'unknown';

export type AgentRuntimePermissionApprovalRoute =
  | 'mindos-policy'
  | 'runtime-permission-bridge'
  | 'external-runtime'
  | 'adapter-protocol'
  | 'none'
  | 'unknown';

export type AgentRuntimePermissionUnattendedStatus =
  | 'ready'
  | 'limited'
  | 'blocked'
  | 'unknown';

export type AgentRuntimePermissionProjectionReason = {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
};

export type AgentRuntimePermissionPolicyProjection = {
  permissionMode: MindosPermissionMode;
  runtimePermissionMode: MindosAgentPermissionPolicy['runtimePermissionMode'];
  acpPermissionMode: MindosAgentPermissionPolicy['acpPermissionMode'];
  kbRead: boolean;
  kbWrite: MindosAgentPermissionPolicy['toolScope']['kbWrite'];
  terminal: boolean;
  mcp: boolean;
  subagents: boolean;
  delegation: boolean;
  im: boolean;
  schedule: boolean;
  userExtensions: boolean;
  extensionScopes: string[];
};

export type AgentRuntimePermissionProjection = {
  schemaVersion: 1;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeStatus: AgentRuntimeStatus;
  permissionOwner: AgentRuntimeOwner;
  requestedPermissionMode: MindosPermissionMode;
  status: AgentRuntimePermissionProjectionStatus;
  harnessPermissionModel: 'mindos-only' | 'runtime-bridged' | 'none' | 'unknown';
  interactiveApproval: {
    supported: boolean;
    route: AgentRuntimePermissionApprovalRoute;
    scope: 'turn-policy' | 'in-process-run' | 'runtime-native' | 'adapter-specific' | 'none' | 'unknown';
    summary: string;
  };
  unattendedApproval: {
    status: AgentRuntimePermissionUnattendedStatus;
    supported: boolean;
    summary: string;
    blockers?: string[];
  };
  policy?: AgentRuntimePermissionPolicyProjection;
  policyModes?: AgentRuntimePermissionPolicyProjection[];
  reasons: AgentRuntimePermissionProjectionReason[];
  blockers?: string[];
};

export type AgentRuntimePermissionProjectionsPayload = {
  schemaVersion: 1;
  requestedPermissionMode: MindosPermissionMode;
  projections: AgentRuntimePermissionProjection[];
};

export type AgentRuntimePermissionProjectionServices = {
  listRuntimes(): AgentRuntimeDescriptor[] | Promise<AgentRuntimeDescriptor[]>;
};

export async function handleAgentRuntimePermissionProjectionsGet(
  searchParams: URLSearchParams,
  services: AgentRuntimePermissionProjectionServices,
): Promise<MindosServerResponse<AgentRuntimePermissionProjectionsPayload | { error: string }>> {
  const permissionModeResult = parsePermissionMode(searchParams.get('permissionMode'));
  if ('error' in permissionModeResult) return json({ error: permissionModeResult.error }, { status: 400 });

  try {
    const runtimes = await services.listRuntimes();
    const payload = buildAgentRuntimePermissionProjectionsPayload({
      runtimes,
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

export function buildAgentRuntimePermissionProjectionsPayload(input: {
  runtimes: AgentRuntimeDescriptor[];
  permissionMode?: MindosPermissionMode;
}): AgentRuntimePermissionProjectionsPayload {
  const requestedPermissionMode = input.permissionMode ?? 'ask';
  return {
    schemaVersion: 1,
    requestedPermissionMode,
    projections: input.runtimes.map((runtime) => buildRuntimePermissionProjection(runtime, requestedPermissionMode)),
  };
}

function buildRuntimePermissionProjection(
  runtime: AgentRuntimeDescriptor,
  requestedPermissionMode: MindosPermissionMode,
): AgentRuntimePermissionProjection {
  if (runtime.kind === 'mindos') return buildMindosPermissionProjection(runtime, requestedPermissionMode);
  if (runtime.kind === 'codex' || runtime.kind === 'claude') {
    return buildNativePermissionProjection(runtime, requestedPermissionMode);
  }
  return buildAcpPermissionProjection(runtime, requestedPermissionMode);
}

function buildMindosPermissionProjection(
  runtime: AgentRuntimeDescriptor,
  requestedPermissionMode: MindosPermissionMode,
): AgentRuntimePermissionProjection {
  const policy = createMindosAgentPermissionPolicy(requestedPermissionMode);
  const policyProjection = projectMindosPolicy(policy);
  const reasons: AgentRuntimePermissionProjectionReason[] = [
    runtimeAvailableReason(runtime),
    reason('permission-owner', 'satisfied', 'mindos', 'MindOS owns permission policy inside the Pi runtime lane.'),
    reason('turn-policy', 'satisfied', 'mindos', 'The selected read/ask/auto/full mode maps to a deterministic Pi tool policy.'),
  ];
  const blockers: string[] = [];
  const unattended = mindosUnattendedApproval(requestedPermissionMode, policyProjection);
  if (unattended.blockers) blockers.push(...unattended.blockers);
  if (runtime.status !== 'available') blockers.push('runtime-available');

  return {
    schemaVersion: 1,
    runtimeId: runtime.runtimeId ?? runtime.id,
    runtimeName: runtime.name,
    runtimeKind: runtime.kind,
    runtimeStatus: runtime.status,
    permissionOwner: runtime.permissionOwner,
    requestedPermissionMode,
    status: runtime.status === 'available' ? 'ready' : 'blocked',
    harnessPermissionModel: 'mindos-only',
    interactiveApproval: {
      supported: true,
      route: 'mindos-policy',
      scope: 'turn-policy',
      summary: 'MindOS applies a deterministic per-turn policy before Pi tools and extensions are registered.',
    },
    unattendedApproval: unattended,
    policy: policyProjection,
    policyModes: MINDOS_PERMISSION_MODES.map((mode) => projectMindosPolicy(createMindosAgentPermissionPolicy(mode))),
    reasons,
    ...(blockers.length > 0 ? { blockers: uniqSorted(blockers) } : {}),
  };
}

function buildNativePermissionProjection(
  runtime: AgentRuntimeDescriptor,
  requestedPermissionMode: MindosPermissionMode,
): AgentRuntimePermissionProjection {
  const hasPermissionStream = runtime.harnessCapabilities?.eventStream.includes('permissions') === true;
  const supportsApprovals = runtime.capabilities.supportsApprovals && hasPermissionStream;
  const blockers: string[] = [];
  if (runtime.status !== 'available') blockers.push('runtime-available');
  if (!supportsApprovals) blockers.push('runtime-approval-contract');
  blockers.push('durable-approval-queue', 'approval-timeout-recovery');
  const status: AgentRuntimePermissionProjectionStatus = runtime.status !== 'available'
    ? 'blocked'
    : supportsApprovals ? 'interactive-only' : 'unknown';

  return {
    schemaVersion: 1,
    runtimeId: runtime.runtimeId ?? runtime.id,
    runtimeName: runtime.name,
    runtimeKind: runtime.kind,
    runtimeStatus: runtime.status,
    permissionOwner: runtime.permissionOwner,
    requestedPermissionMode,
    status,
    harnessPermissionModel: runtime.harnessCapabilities?.permissions ?? 'unknown',
    interactiveApproval: {
      supported: supportsApprovals,
      route: supportsApprovals ? 'runtime-permission-bridge' : 'external-runtime',
      scope: supportsApprovals ? 'in-process-run' : 'runtime-native',
      summary: supportsApprovals
        ? 'MindOS can surface native runtime permission prompts while the run is active, using the runtime permission bridge.'
        : 'MindOS does not have a declared interactive permission bridge for this runtime.',
    },
    unattendedApproval: {
      status: runtime.status === 'available' && supportsApprovals ? 'limited' : 'unknown',
      supported: false,
      summary: 'Native runtime approvals are currently interactive and in-process; unattended work needs a durable approval queue and timeout recovery.',
      blockers: ['durable-approval-queue', 'approval-timeout-recovery'],
    },
    reasons: [
      runtimeAvailableReason(runtime),
      reason(
        'runtime-approval-contract',
        supportsApprovals ? 'satisfied' : 'unknown',
        'external',
        supportsApprovals
          ? `${runtime.name} declares permission events that MindOS can bridge into the product stream.`
          : `${runtime.name} has not declared a bridgeable permission event stream.`,
      ),
      reason('mindos-permission-bridge', supportsApprovals ? 'satisfied' : 'unknown', 'mindos', 'MindOS routes supported native permission requests through an in-process run bridge.'),
      reason('durable-approval-queue', 'missing', 'mindos', 'Approvals are not persisted in a durable queue for headless or resumed runs yet.'),
    ],
    blockers: uniqSorted(blockers),
  };
}

function buildAcpPermissionProjection(
  runtime: AgentRuntimeDescriptor,
  requestedPermissionMode: MindosPermissionMode,
): AgentRuntimePermissionProjection {
  const blockers = runtime.status === 'available'
    ? ['adapter-approval-contract']
    : ['runtime-available', 'adapter-approval-contract'];
  return {
    schemaVersion: 1,
    runtimeId: runtime.runtimeId ?? runtime.id,
    runtimeName: runtime.name,
    runtimeKind: runtime.kind,
    runtimeStatus: runtime.status,
    permissionOwner: runtime.permissionOwner,
    requestedPermissionMode,
    status: runtime.status === 'available' ? 'unknown' : 'blocked',
    harnessPermissionModel: runtime.harnessCapabilities?.permissions ?? 'unknown',
    interactiveApproval: {
      supported: false,
      route: 'unknown',
      scope: 'adapter-specific',
      summary: 'Generic ACP descriptors do not expose a shared approval prompt contract yet.',
    },
    unattendedApproval: {
      status: 'unknown',
      supported: false,
      summary: 'ACP unattended approval readiness depends on adapter-specific permission semantics.',
      blockers: ['adapter-approval-contract'],
    },
    reasons: [
      runtimeAvailableReason(runtime),
      reason('adapter-approval-contract', 'unknown', 'external', 'ACP adapters need to declare approval behavior before MindOS can route or preauthorize actions safely.'),
    ],
    blockers,
  };
}

function mindosUnattendedApproval(
  mode: MindosPermissionMode,
  policy: AgentRuntimePermissionPolicyProjection,
): AgentRuntimePermissionProjection['unattendedApproval'] {
  if (mode === 'read') {
    return {
      status: 'ready',
      supported: true,
      summary: 'Read mode has no write, terminal, MCP, IM, schedule, or user-extension scopes, so permission does not require live approval.',
    };
  }
  if (mode === 'ask') {
    return {
      status: 'limited',
      supported: false,
      summary: 'Ask mode is safe for interactive work, but unattended use needs a durable approval queue before user decisions can survive background execution.',
      blockers: ['durable-approval-queue'],
    };
  }
  const highRisk = [
    ...(policy.terminal ? ['terminal'] : []),
    ...(policy.mcp ? ['mcp'] : []),
    ...(policy.userExtensions ? ['user-extensions'] : []),
    ...(policy.im ? ['im'] : []),
    ...(policy.schedule ? ['schedule'] : []),
    ...(policy.delegation ? ['delegation'] : []),
  ];
  return {
    status: 'limited',
    supported: false,
    summary: `${mode} mode preauthorizes product actions without live prompts; unattended use needs scenario-specific allowlists and audit before it is trustworthy.`,
    blockers: uniqSorted(['unattended-policy-review', ...highRisk.map((item) => `high-risk:${item}`)]),
  };
}

function projectMindosPolicy(policy: MindosAgentPermissionPolicy): AgentRuntimePermissionPolicyProjection {
  return {
    permissionMode: policy.permissionMode,
    runtimePermissionMode: policy.runtimePermissionMode,
    acpPermissionMode: policy.acpPermissionMode,
    kbRead: policy.toolScope.kbRead,
    kbWrite: policy.toolScope.kbWrite,
    terminal: policy.toolScope.terminal,
    mcp: policy.toolScope.mcp,
    subagents: policy.toolScope.subagents,
    delegation: policy.toolScope.acpDelegation || policy.toolScope.a2aDelegation,
    im: policy.toolScope.im,
    schedule: policy.toolScope.schedule,
    userExtensions: policy.toolScope.userExtensions,
    extensionScopes: [...policy.extensionScopes],
  };
}

function runtimeAvailableReason(runtime: AgentRuntimeDescriptor): AgentRuntimePermissionProjectionReason {
  return reason(
    'runtime-available',
    runtime.status === 'available' ? 'satisfied' : 'missing',
    runtime.status === 'available' ? 'mindos' : 'shared',
    runtime.status === 'available'
      ? `${runtime.name} is available for permission projection diagnostics.`
      : `${runtime.name} is not available, so permission readiness cannot be trusted.`,
  );
}

function reason(
  id: string,
  status: AgentRuntimeCompatibilityRequirementStatus,
  owner: AgentRuntimeCompatibilityOwner,
  summary: string,
): AgentRuntimePermissionProjectionReason {
  return { id, status, owner, summary };
}

function parsePermissionMode(value: string | null):
  | { permissionMode: MindosPermissionMode }
  | { error: string } {
  if (!value) return { permissionMode: 'ask' };
  if (isMindosPermissionMode(value)) return { permissionMode: value };
  return { error: `Unsupported permissionMode: ${value}` };
}

function uniqSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}
