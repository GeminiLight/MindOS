import type {
  AgentRuntimeCompatibilityOwner,
  AgentRuntimeCompatibilityRequirementStatus,
  AgentRuntimeDescriptor,
  AgentRuntimeKind,
  AgentRuntimeOwner,
  AgentRuntimeStatus,
} from '../../agent/runtime/registry.js';
import type {
  AcpAvailableCommand,
  AcpConfigOptionEntry,
  AcpPermissionEvent,
  AcpSessionMcpServerSummary,
  AcpSessionSnapshot,
  AcpToolCallFull,
} from '../../protocols/acp/index.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';

export type AgentRuntimeSessionProjectionStatus =
  | 'ready'
  | 'active'
  | 'idle'
  | 'limited'
  | 'blocked'
  | 'unknown';

export type AgentRuntimeSessionProjectionReason = {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
};

export type RuntimeSessionProjectionControl = {
  status: 'available' | 'unavailable';
  owner: AgentRuntimeOwner;
  source: 'session-observed' | 'adapter-declared' | 'runtime-native' | 'mindos-session' | 'unavailable';
  configId?: string;
  currentValue?: string;
  options: AcpConfigOptionEntry[];
  summary: string;
};

export type RuntimeSessionProjectionCommands = {
  status: 'available' | 'unavailable';
  source: 'session-observed' | 'adapter-declared' | 'runtime-native' | 'mindos-skills' | 'unavailable';
  commands: AcpAvailableCommand[];
  summary: string;
};

export type RuntimeSessionProjectionToolEvents = {
  status: 'available' | 'unavailable';
  calls: AcpToolCallFull[];
  summary: AcpSessionSnapshot['toolSummary'];
};

export type RuntimeSessionProjectionPermissionEvents = {
  status: 'available' | 'unavailable';
  events: AcpPermissionEvent[];
  pending: AcpPermissionEvent[];
  summary: string;
};

export type RuntimeSessionProjectionMcpServers = {
  status: 'available' | 'unavailable';
  servers: AcpSessionMcpServerSummary[];
  summary: string;
};

export type RuntimeSessionProjection = {
  schemaVersion: 1;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeStatus: AgentRuntimeStatus;
  sessionOwner: AgentRuntimeOwner;
  permissionOwner: AgentRuntimeOwner;
  status: AgentRuntimeSessionProjectionStatus;
  source: 'acp-session-snapshot' | 'runtime-descriptor' | 'none';
  session?: {
    kind: 'acp-session' | 'native-runtime-session' | 'mindos-pi-session';
    sessionId?: string;
    externalSessionId?: string;
    state?: string;
    cwd?: string;
    updatedAt?: string;
  };
  controls: {
    model: RuntimeSessionProjectionControl;
    mode: RuntimeSessionProjectionControl;
    thoughtLevel: RuntimeSessionProjectionControl;
  };
  slashCommands: RuntimeSessionProjectionCommands;
  toolEvents: RuntimeSessionProjectionToolEvents;
  permissionEvents: RuntimeSessionProjectionPermissionEvents;
  mcpServers: RuntimeSessionProjectionMcpServers;
  reasons: AgentRuntimeSessionProjectionReason[];
  blockers?: string[];
};

export type RuntimeSessionProjectionsPayload = {
  schemaVersion: 1;
  projections: RuntimeSessionProjection[];
};

export type RuntimeSessionProjectionServices = {
  listRuntimes(): AgentRuntimeDescriptor[] | Promise<AgentRuntimeDescriptor[]>;
  getAcpSessionSnapshots?(): AcpSessionSnapshot[] | Promise<AcpSessionSnapshot[]>;
};

export async function handleRuntimeSessionProjectionsGet(
  searchParams: URLSearchParams,
  services: RuntimeSessionProjectionServices,
): Promise<MindosServerResponse<RuntimeSessionProjectionsPayload | { error: string }>> {
  try {
    const [runtimes, acpSessions] = await Promise.all([
      services.listRuntimes(),
      services.getAcpSessionSnapshots?.() ?? [],
    ]);
    const payload = buildRuntimeSessionProjectionsPayload({ runtimes, acpSessions });
    const runtimeFilter = searchParams.get('runtime')?.trim();
    const sessionFilter = searchParams.get('sessionId')?.trim();
    const projections = payload.projections.filter((projection) => {
      if (runtimeFilter && projection.runtimeId !== runtimeFilter && projection.runtimeKind !== runtimeFilter) return false;
      if (sessionFilter && projection.session?.sessionId !== sessionFilter && projection.session?.externalSessionId !== sessionFilter) return false;
      return true;
    });
    return json({ ...payload, projections }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export function buildRuntimeSessionProjectionsPayload(input: {
  runtimes: AgentRuntimeDescriptor[];
  acpSessions?: AcpSessionSnapshot[];
}): RuntimeSessionProjectionsPayload {
  const acpSessions = input.acpSessions ?? [];
  return {
    schemaVersion: 1,
    projections: input.runtimes.map((runtime) => buildRuntimeSessionProjection(runtime, acpSessions)),
  };
}

function buildRuntimeSessionProjection(
  runtime: AgentRuntimeDescriptor,
  acpSessions: AcpSessionSnapshot[],
): RuntimeSessionProjection {
  const acpSession = runtime.kind === 'acp' ? latestAcpSessionForRuntime(runtime, acpSessions) : undefined;
  const blockers: string[] = [];
  if (runtime.status !== 'available') blockers.push('runtime-available');

  const controls = buildControls(runtime, acpSession);
  const slashCommands = buildSlashCommands(runtime, acpSession);
  const toolEvents = buildToolEvents(acpSession);
  const permissionEvents = buildPermissionEvents(runtime, acpSession);
  const mcpServers = buildMcpServers(runtime, acpSession);

  if (runtime.kind === 'acp' && !acpSession) blockers.push('runtime-session-snapshot');
  const status = resolveStatus(runtime, acpSession, blockers);
  return {
    schemaVersion: 1,
    runtimeId: runtimeKey(runtime),
    runtimeName: runtime.name,
    runtimeKind: runtime.kind,
    runtimeStatus: runtime.status,
    sessionOwner: runtime.sessionOwner,
    permissionOwner: runtime.permissionOwner,
    status,
    source: acpSession ? 'acp-session-snapshot' : runtime.status === 'available' ? 'runtime-descriptor' : 'none',
    ...(acpSession ? {
      session: {
        kind: 'acp-session' as const,
        sessionId: acpSession.sessionId,
        ...(acpSession.agentSessionId ? { externalSessionId: acpSession.agentSessionId } : {}),
        state: acpSession.state,
        ...(acpSession.cwd ? { cwd: acpSession.cwd } : {}),
        updatedAt: acpSession.lastActivityAt,
      },
    } : {}),
    controls,
    slashCommands,
    toolEvents,
    permissionEvents,
    mcpServers,
    reasons: [
      runtimeAvailableReason(runtime),
      sessionSnapshotReason(runtime, acpSession),
      controlReason(runtime, 'model', controls.model),
      controlReason(runtime, 'mode', controls.mode),
      controlReason(runtime, 'thought-level', controls.thoughtLevel),
      slashCommandsReason(runtime, slashCommands),
      toolEventsReason(runtime, toolEvents),
      permissionEventsReason(runtime, permissionEvents),
      mcpServersReason(runtime, mcpServers),
    ],
    ...(blockers.length > 0 ? { blockers: uniqSorted(blockers) } : {}),
  };
}

function buildControls(
  runtime: AgentRuntimeDescriptor,
  acpSession: AcpSessionSnapshot | undefined,
): RuntimeSessionProjection['controls'] {
  return {
    model: controlFromAcpSessionOrDescriptor(runtime, acpSession, 'model'),
    mode: controlFromAcpSessionOrDescriptor(runtime, acpSession, 'mode'),
    thoughtLevel: controlFromAcpSessionOrDescriptor(runtime, acpSession, 'thoughtLevel'),
  };
}

function controlFromAcpSessionOrDescriptor(
  runtime: AgentRuntimeDescriptor,
  acpSession: AcpSessionSnapshot | undefined,
  key: keyof AcpSessionSnapshot['controls'],
): RuntimeSessionProjectionControl {
  const sessionControl = acpSession?.controls[key];
  if (sessionControl?.status === 'available') {
    return {
      status: 'available',
      owner: 'external',
      source: 'session-observed',
      ...(sessionControl.configId ? { configId: sessionControl.configId } : {}),
      ...(sessionControl.currentValue ? { currentValue: sessionControl.currentValue } : {}),
      options: sessionControl.options,
      summary: `${runtime.name} reported ${controlLabel(key)} options for the active ACP session.`,
    };
  }

  if (key === 'model' && runtime.adapterContract.protocol.models.length > 0) {
    return {
      status: 'available',
      owner: 'external',
      source: 'adapter-declared',
      options: runtime.adapterContract.protocol.models.map((model) => ({
        id: model.id,
        label: model.label ?? model.id,
      })),
      summary: `${runtime.name} declares static ACP model options before a session is opened.`,
    };
  }

  if (runtime.kind === 'mindos' && key === 'model') {
    return {
      status: 'available',
      owner: 'mindos',
      source: 'mindos-session',
      options: [],
      summary: 'MindOS owns provider/model selection at the chat session layer.',
    };
  }

  if ((runtime.kind === 'codex' || runtime.kind === 'claude') && key === 'model') {
    return {
      status: 'available',
      owner: 'external',
      source: 'runtime-native',
      options: [],
      summary: `${runtime.name} owns model selection through its native runtime options.`,
    };
  }

  return {
    status: 'unavailable',
    owner: runtime.kind === 'mindos' ? 'mindos' : 'external',
    source: 'unavailable',
    options: [],
    summary: `${runtime.name} has not reported ${controlLabel(key)} controls for this session.`,
  };
}

function buildSlashCommands(
  runtime: AgentRuntimeDescriptor,
  acpSession: AcpSessionSnapshot | undefined,
): RuntimeSessionProjectionCommands {
  if (acpSession?.availableCommands.length) {
    return {
      status: 'available',
      source: 'session-observed',
      commands: acpSession.availableCommands,
      summary: `${runtime.name} reported ${acpSession.availableCommands.length} slash command(s) for the active session.`,
    };
  }
  if (runtime.adapterContract.commands.commands.length > 0) {
    return {
      status: 'available',
      source: runtime.adapterContract.commands.discovery === 'mindos-skills' ? 'mindos-skills' : 'adapter-declared',
      commands: runtime.adapterContract.commands.commands.map((command) => ({
        id: command.name,
        name: command.name,
        ...(command.description ? { description: command.description } : {}),
      })),
      summary: `${runtime.name} declares ${runtime.adapterContract.commands.commands.length} command(s) in its adapter contract.`,
    };
  }
  if (runtime.kind === 'mindos') {
    return {
      status: 'available',
      source: 'mindos-skills',
      commands: [],
      summary: 'MindOS slash commands come from enabled skills.',
    };
  }
  return {
    status: 'unavailable',
    source: 'unavailable',
    commands: [],
    summary: `${runtime.name} has not reported runtime slash commands.`,
  };
}

function buildToolEvents(acpSession: AcpSessionSnapshot | undefined): RuntimeSessionProjectionToolEvents {
  if (!acpSession) {
    return {
      status: 'unavailable',
      calls: [],
      summary: { total: 0, pending: 0, inProgress: 0, completed: 0, failed: 0 },
    };
  }
  return {
    status: 'available',
    calls: acpSession.toolCalls,
    summary: acpSession.toolSummary,
  };
}

function buildPermissionEvents(
  runtime: AgentRuntimeDescriptor,
  acpSession: AcpSessionSnapshot | undefined,
): RuntimeSessionProjectionPermissionEvents {
  if (acpSession) {
    return {
      status: 'available',
      events: acpSession.permissionEvents,
      pending: acpSession.pendingPermissions,
      summary: acpSession.permissionEvents.length > 0
        ? `${runtime.name} has ${acpSession.pendingPermissions.length} pending ACP permission request(s).`
        : `${runtime.name} has no observed ACP permission requests in this session.`,
    };
  }
  return {
    status: runtime.kind === 'acp' ? 'available' : 'unavailable',
    events: [],
    pending: [],
    summary: runtime.kind === 'acp'
      ? 'ACP permission requests are bridged through the MindOS ACP client when a session is active.'
      : `${runtime.name} has no ACP permission event stream.`,
  };
}

function buildMcpServers(
  runtime: AgentRuntimeDescriptor,
  acpSession: AcpSessionSnapshot | undefined,
): RuntimeSessionProjectionMcpServers {
  const servers = acpSession?.mcpServers ?? [];
  if (servers.length > 0) {
    return {
      status: 'available',
      servers,
      summary: `${runtime.name} inherited ${servers.length} MCP server(s) into the active ACP session.`,
    };
  }
  return {
    status: 'unavailable',
    servers: [],
    summary: `${runtime.name} has no inherited MCP servers in the current session snapshot.`,
  };
}

function latestAcpSessionForRuntime(
  runtime: AgentRuntimeDescriptor,
  sessions: AcpSessionSnapshot[],
): AcpSessionSnapshot | undefined {
  const runtimeIds = new Set(
    [runtime.id, runtime.runtimeId, runtime.sourceAgentId, runtime.canonicalAgentId]
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
  );
  return sessions
    .filter((session) => runtimeIds.has(session.agentId))
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))[0];
}

function resolveStatus(
  runtime: AgentRuntimeDescriptor,
  acpSession: AcpSessionSnapshot | undefined,
  blockers: string[],
): AgentRuntimeSessionProjectionStatus {
  if (runtime.status !== 'available') return 'blocked';
  if (acpSession?.state === 'active') return 'active';
  if (acpSession?.state === 'idle') return 'idle';
  if (blockers.length > 0) return runtime.kind === 'acp' ? 'limited' : 'ready';
  return 'ready';
}

function runtimeAvailableReason(runtime: AgentRuntimeDescriptor): AgentRuntimeSessionProjectionReason {
  return reason(
    'runtime-available',
    runtime.status === 'available' ? 'satisfied' : 'missing',
    runtime.status === 'available' ? 'mindos' : 'shared',
    runtime.status === 'available'
      ? `${runtime.name} is available for runtime session projection.`
      : `${runtime.name} is not available, so runtime session controls may be stale or absent.`,
  );
}

function sessionSnapshotReason(
  runtime: AgentRuntimeDescriptor,
  acpSession: AcpSessionSnapshot | undefined,
): AgentRuntimeSessionProjectionReason {
  if (runtime.kind !== 'acp') {
    return reason('runtime-session-snapshot', 'not-applicable', runtime.sessionOwner, `${runtime.name} does not use ACP session snapshots.`);
  }
  return reason(
    'runtime-session-snapshot',
    acpSession ? 'satisfied' : 'unknown',
    'mindos',
    acpSession
      ? `${runtime.name} has an active MindOS ACP session snapshot.`
      : `${runtime.name} has no active MindOS ACP session snapshot yet; descriptor-declared controls are still available.`,
  );
}

function controlReason(
  runtime: AgentRuntimeDescriptor,
  id: string,
  control: RuntimeSessionProjectionControl,
): AgentRuntimeSessionProjectionReason {
  return reason(
    `runtime-session-${id}`,
    control.status === 'available' ? 'satisfied' : 'unknown',
    control.owner,
    control.summary || `${runtime.name} ${controlLabel(id)} control status is ${control.status}.`,
  );
}

function slashCommandsReason(
  runtime: AgentRuntimeDescriptor,
  commands: RuntimeSessionProjectionCommands,
): AgentRuntimeSessionProjectionReason {
  return reason(
    'runtime-session-slash-commands',
    commands.status === 'available' ? 'satisfied' : 'unknown',
    runtime.kind === 'mindos' ? 'mindos' : 'external',
    commands.summary,
  );
}

function toolEventsReason(
  runtime: AgentRuntimeDescriptor,
  toolEvents: RuntimeSessionProjectionToolEvents,
): AgentRuntimeSessionProjectionReason {
  return reason(
    'runtime-session-tool-events',
    toolEvents.status === 'available' ? 'satisfied' : runtime.kind === 'acp' ? 'unknown' : 'not-applicable',
    runtime.kind === 'acp' ? 'mindos' : 'external',
    toolEvents.status === 'available'
      ? `${runtime.name} tool calls are projected from the active ACP session snapshot.`
      : `${runtime.name} has no active ACP tool event snapshot.`,
  );
}

function permissionEventsReason(
  runtime: AgentRuntimeDescriptor,
  permissionEvents: RuntimeSessionProjectionPermissionEvents,
): AgentRuntimeSessionProjectionReason {
  return reason(
    'runtime-session-permission-events',
    permissionEvents.status === 'available' ? 'satisfied' : runtime.kind === 'acp' ? 'unknown' : 'not-applicable',
    runtime.kind === 'acp' ? 'mindos' : 'external',
    permissionEvents.summary,
  );
}

function mcpServersReason(
  runtime: AgentRuntimeDescriptor,
  mcpServers: RuntimeSessionProjectionMcpServers,
): AgentRuntimeSessionProjectionReason {
  return reason(
    'mcp-session-inheritance',
    mcpServers.status === 'available'
      ? 'satisfied'
      : runtime.kind === 'acp' ? 'unknown' : 'not-applicable',
    runtime.kind === 'acp' ? 'mindos' : runtime.sessionOwner,
    mcpServers.summary,
  );
}

function reason(
  id: string,
  status: AgentRuntimeCompatibilityRequirementStatus,
  owner: AgentRuntimeCompatibilityOwner,
  summary: string,
): AgentRuntimeSessionProjectionReason {
  return { id, status, owner, summary };
}

function runtimeKey(runtime: AgentRuntimeDescriptor): string {
  return runtime.runtimeId ?? runtime.id;
}

function controlLabel(key: string): string {
  if (key === 'thoughtLevel' || key === 'thought-level') return 'thought level';
  return key;
}

function uniqSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}
