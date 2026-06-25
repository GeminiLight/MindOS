import type {
  AgentRuntimeAdapterCommandDiscovery,
  AgentRuntimeAdapterConfigurationOwner,
  AgentRuntimeAdapterConnectionKind,
  AgentRuntimeAdapterHealthMode,
  AgentRuntimeCompatibilityOwner,
  AgentRuntimeCompatibilityRequirementStatus,
  AgentRuntimeDescriptor,
  AgentRuntimeKind,
  AgentRuntimeOwner,
  AgentRuntimeResolvedCommandSource,
  AgentRuntimeStatus,
} from '../../agent/runtime/registry.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';

export type AgentRuntimeAdapterProjectionStatus =
  | 'ready'
  | 'limited'
  | 'blocked'
  | 'unknown';

export type AgentRuntimeAdapterFacetStatus =
  | 'ready'
  | 'limited'
  | 'blocked'
  | 'unknown';

export type AgentRuntimeAdapterProjectionReason = {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
};

type AdapterFacetBase = {
  status: AgentRuntimeAdapterFacetStatus;
  summary: string;
  reasons: AgentRuntimeAdapterProjectionReason[];
  blockers?: string[];
};

export type AgentRuntimeAdapterConnectionProjection = AdapterFacetBase & {
  kind: AgentRuntimeAdapterConnectionKind;
  owner: AgentRuntimeOwner;
  hasCommand: boolean;
  commandSource?: AgentRuntimeResolvedCommandSource;
};

export type AgentRuntimeAdapterConfigurationProjection = AdapterFacetBase & {
  modelSelection: AgentRuntimeAdapterConfigurationOwner;
  credentials: AgentRuntimeAdapterConfigurationOwner;
  settings: AgentRuntimeAdapterConfigurationOwner;
};

export type AgentRuntimeAdapterHealthProjection = AdapterFacetBase & {
  mode: AgentRuntimeAdapterHealthMode;
  owner: AgentRuntimeOwner;
  hasCommand: boolean;
  timeoutMs?: number;
};

export type AgentRuntimeAdapterCommandsProjection = AdapterFacetBase & {
  discovery: AgentRuntimeAdapterCommandDiscovery;
  commandCount: number;
  commandNames: string[];
  commands: Array<{
    name: string;
    description?: string;
    source: 'mindos' | 'runtime-native' | 'adapter-declared';
  }>;
};

export type AgentRuntimeAdapterProjection = {
  schemaVersion: 1;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeStatus: AgentRuntimeStatus;
  status: AgentRuntimeAdapterProjectionStatus;
  connection: AgentRuntimeAdapterConnectionProjection;
  configuration: AgentRuntimeAdapterConfigurationProjection;
  health: AgentRuntimeAdapterHealthProjection;
  commands: AgentRuntimeAdapterCommandsProjection;
  reasons: AgentRuntimeAdapterProjectionReason[];
  blockers?: string[];
};

export type AgentRuntimeAdapterProjectionsPayload = {
  schemaVersion: 1;
  projections: AgentRuntimeAdapterProjection[];
};

export type AgentRuntimeAdapterProjectionServices = {
  listRuntimes(): AgentRuntimeDescriptor[] | Promise<AgentRuntimeDescriptor[]>;
};

export async function handleAgentRuntimeAdapterProjectionsGet(
  searchParams: URLSearchParams,
  services: AgentRuntimeAdapterProjectionServices,
): Promise<MindosServerResponse<AgentRuntimeAdapterProjectionsPayload | { error: string }>> {
  try {
    const runtimes = await services.listRuntimes();
    const payload = buildAgentRuntimeAdapterProjectionsPayload({ runtimes });
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

export function buildAgentRuntimeAdapterProjectionsPayload(input: {
  runtimes: AgentRuntimeDescriptor[];
}): AgentRuntimeAdapterProjectionsPayload {
  return {
    schemaVersion: 1,
    projections: input.runtimes.map((runtime) => buildRuntimeAdapterProjection(runtime)),
  };
}

function buildRuntimeAdapterProjection(runtime: AgentRuntimeDescriptor): AgentRuntimeAdapterProjection {
  const connection = buildConnectionProjection(runtime);
  const configuration = buildConfigurationProjection(runtime);
  const health = buildHealthProjection(runtime);
  const commands = buildCommandsProjection(runtime);
  const facets = [connection, configuration, health, commands];
  const blockers = uniqSorted(facets.flatMap((facet) => facet.blockers ?? []));

  return {
    schemaVersion: 1,
    runtimeId: runtimeKey(runtime),
    runtimeName: runtime.name,
    runtimeKind: runtime.kind,
    runtimeStatus: runtime.status,
    status: resolveAdapterProjectionStatus(runtime, {
      connection,
      configuration,
      health,
      commands,
    }),
    connection,
    configuration,
    health,
    commands,
    reasons: [
      runtimeAvailableReason(runtime),
      ...facets.flatMap((facet) => facet.reasons),
    ],
    ...(blockers.length > 0 ? { blockers } : {}),
  };
}

function buildConnectionProjection(runtime: AgentRuntimeDescriptor): AgentRuntimeAdapterConnectionProjection {
  const contract = runtime.adapterContract.connection;
  const blockers: string[] = [];
  const known = contract.kind !== 'unknown';
  if (runtime.status !== 'available') blockers.push('runtime-available');
  if (!known) blockers.push('adapter-connection-contract');
  const status = runtime.status !== 'available'
    ? 'blocked'
    : known ? 'ready' : 'unknown';

  return {
    status,
    kind: contract.kind,
    owner: contract.owner,
    hasCommand: !!contract.command,
    ...(contract.commandSource ? { commandSource: contract.commandSource } : {}),
    summary: contract.summary,
    reasons: [
      reason(
        'adapter-connection-contract',
        known ? 'satisfied' : 'unknown',
        contract.owner,
        known
          ? `${runtime.name} declares a ${contract.kind} adapter connection surface.`
          : `${runtime.name} does not declare a known adapter connection surface.`,
      ),
    ],
    ...(blockers.length > 0 ? { blockers: uniqSorted(blockers) } : {}),
  };
}

function buildConfigurationProjection(runtime: AgentRuntimeDescriptor): AgentRuntimeAdapterConfigurationProjection {
  const contract = runtime.adapterContract.configuration;
  const fields = [
    { id: 'adapter-model-selection', value: contract.modelSelection, label: 'model selection' },
    { id: 'adapter-credentials', value: contract.credentials, label: 'credentials' },
    { id: 'adapter-settings', value: contract.settings, label: 'settings' },
  ];
  const blockers: string[] = [];
  if (runtime.status !== 'available') blockers.push('runtime-available');
  for (const field of fields) {
    if (field.value === 'unknown') blockers.push(field.id);
    if (field.value === 'unsupported') blockers.push(field.id);
  }
  const hasUnsupported = fields.some((field) => field.value === 'unsupported');
  const hasUnknown = fields.some((field) => field.value === 'unknown');
  const status = runtime.status !== 'available'
    ? 'blocked'
    : hasUnsupported ? 'blocked' : hasUnknown ? 'unknown' : 'ready';

  return {
    status,
    modelSelection: contract.modelSelection,
    credentials: contract.credentials,
    settings: contract.settings,
    summary: contract.summary,
    reasons: fields.map((field) => reason(
      field.id,
      configurationOwnerStatus(field.value),
      configurationOwner(field.value),
      `${runtime.name} ${field.label} ownership is ${field.value}.`,
    )),
    ...(blockers.length > 0 ? { blockers: uniqSorted(blockers) } : {}),
  };
}

function buildHealthProjection(runtime: AgentRuntimeDescriptor): AgentRuntimeAdapterHealthProjection {
  const contract = runtime.adapterContract.health;
  const blockers: string[] = [];
  if (runtime.status !== 'available') blockers.push('runtime-available');
  if (contract.mode === 'unknown' || contract.mode === 'unsupported') blockers.push('adapter-health-contract');
  const status = runtime.status !== 'available'
    ? 'blocked'
    : contract.mode === 'unsupported' ? 'blocked' : contract.mode === 'unknown' ? 'unknown' : 'ready';

  return {
    status,
    mode: contract.mode,
    owner: contract.owner,
    hasCommand: !!contract.command,
    ...(contract.timeoutMs !== undefined ? { timeoutMs: contract.timeoutMs } : {}),
    summary: contract.summary,
    reasons: [
      reason(
        'adapter-health-contract',
        healthModeStatus(contract.mode),
        contract.owner,
        contract.mode === 'unknown'
          ? `${runtime.name} does not declare adapter-specific health semantics yet.`
          : contract.mode === 'unsupported'
            ? `${runtime.name} declares that adapter health checks are unsupported.`
            : `${runtime.name} health is covered by ${contract.mode}.`,
      ),
    ],
    ...(blockers.length > 0 ? { blockers: uniqSorted(blockers) } : {}),
  };
}

function buildCommandsProjection(runtime: AgentRuntimeDescriptor): AgentRuntimeAdapterCommandsProjection {
  const contract = runtime.adapterContract.commands;
  const commandNames = uniqSorted(contract.commands.map((command) => command.name));
  const blockers: string[] = [];
  if (runtime.status !== 'available') blockers.push('runtime-available');
  if (contract.discovery === 'unknown' || contract.discovery === 'unsupported') blockers.push('adapter-command-discovery');
  const status = runtime.status !== 'available'
    ? 'blocked'
    : contract.discovery === 'unknown'
      ? 'unknown'
      : contract.discovery === 'unsupported'
        ? 'limited'
        : 'ready';

  return {
    status,
    discovery: contract.discovery,
    commandCount: commandNames.length,
    commandNames,
    commands: contract.commands.map((command) => ({
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
      source: command.source,
    })),
    summary: contract.summary,
    reasons: [
      reason(
        'adapter-command-discovery',
        commandDiscoveryStatus(contract.discovery),
        commandDiscoveryOwner(contract.discovery),
        commandDiscoverySummary(runtime.name, contract.discovery, commandNames.length),
      ),
    ],
    ...(blockers.length > 0 ? { blockers: uniqSorted(blockers) } : {}),
  };
}

function resolveAdapterProjectionStatus(
  runtime: AgentRuntimeDescriptor,
  facets: {
    connection: AdapterFacetBase;
    configuration: AdapterFacetBase;
    health: AdapterFacetBase;
    commands: AdapterFacetBase;
  },
): AgentRuntimeAdapterProjectionStatus {
  if (runtime.status !== 'available') return 'blocked';
  if (facets.connection.status === 'blocked' || facets.configuration.status === 'blocked' || facets.health.status === 'blocked') {
    return 'blocked';
  }
  if (facets.connection.status === 'unknown' || facets.configuration.status === 'unknown') return 'unknown';
  if (facets.health.status !== 'ready' || facets.commands.status !== 'ready') return 'limited';
  return 'ready';
}

function configurationOwnerStatus(owner: AgentRuntimeAdapterConfigurationOwner): AgentRuntimeCompatibilityRequirementStatus {
  if (owner === 'unknown') return 'unknown';
  if (owner === 'unsupported') return 'missing';
  return 'satisfied';
}

function configurationOwner(owner: AgentRuntimeAdapterConfigurationOwner): AgentRuntimeCompatibilityOwner {
  if (owner === 'mindos-session' || owner === 'mindos-settings') return 'mindos';
  if (owner === 'runtime-native' || owner === 'adapter-declared') return 'external';
  return 'shared';
}

function healthModeStatus(mode: AgentRuntimeAdapterHealthMode): AgentRuntimeCompatibilityRequirementStatus {
  if (mode === 'unknown') return 'unknown';
  if (mode === 'unsupported') return 'missing';
  return 'satisfied';
}

function commandDiscoveryStatus(discovery: AgentRuntimeAdapterCommandDiscovery): AgentRuntimeCompatibilityRequirementStatus {
  if (discovery === 'unknown') return 'unknown';
  if (discovery === 'unsupported') return 'missing';
  return 'satisfied';
}

function commandDiscoveryOwner(discovery: AgentRuntimeAdapterCommandDiscovery): AgentRuntimeCompatibilityOwner {
  if (discovery === 'mindos-skills') return 'mindos';
  if (discovery === 'runtime-event' || discovery === 'adapter-declared') return 'external';
  return 'shared';
}

function commandDiscoverySummary(
  runtimeName: string,
  discovery: AgentRuntimeAdapterCommandDiscovery,
  commandCount: number,
): string {
  if (discovery === 'mindos-skills') {
    return `${runtimeName} commands are assembled from enabled MindOS skills.`;
  }
  if (discovery === 'runtime-event') {
    return `${runtimeName} delegates command discovery to runtime-native events.`;
  }
  if (discovery === 'adapter-declared') {
    return `${runtimeName} declares ${commandCount} static adapter command(s).`;
  }
  if (discovery === 'unsupported') {
    return `${runtimeName} declares command discovery as unsupported.`;
  }
  return `${runtimeName} does not declare a command discovery contract yet.`;
}

function runtimeAvailableReason(runtime: AgentRuntimeDescriptor): AgentRuntimeAdapterProjectionReason {
  return reason(
    'runtime-available',
    runtime.status === 'available' ? 'satisfied' : 'missing',
    runtime.status === 'available' ? 'mindos' : 'shared',
    runtime.status === 'available'
      ? `${runtime.name} is available for adapter contract diagnostics.`
      : `${runtime.name} is not available, so adapter contract readiness cannot be trusted.`,
  );
}

function reason(
  id: string,
  status: AgentRuntimeCompatibilityRequirementStatus,
  owner: AgentRuntimeCompatibilityOwner,
  summary: string,
): AgentRuntimeAdapterProjectionReason {
  return { id, status, owner, summary };
}

function runtimeKey(runtime: AgentRuntimeDescriptor): string {
  return runtime.runtimeId ?? runtime.id;
}

function uniqSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}
