import type {
  AgentRuntimeAdapterCommandDiscovery,
  AgentRuntimeAdapterConfigurationOwner,
  AgentRuntimeAdapterConnectionKind,
  AgentRuntimeAdapterHealthMode,
  AgentRuntimeAdapterOutputDiscovery,
  AgentRuntimeCompatibilityOwner,
  AgentRuntimeCompatibilityRequirementStatus,
  AgentRuntimeDescriptor,
  AgentRuntimeHarnessCapabilities,
  AgentRuntimeKind,
  AgentRuntimeOwner,
  AgentRuntimeResolvedCommandSource,
  AgentRuntimeStatus,
} from '../../agent/runtime/registry.js';
import type {
  AcpAdapterConnectionType,
  AcpHandshakeHealthResult,
  AcpMcpCapabilities,
  AcpPromptCapabilities,
  AcpSessionCapabilities,
} from '../../protocols/acp/index.js';
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
  handshake?: {
    status: AcpHandshakeHealthResult['status'] | 'unknown';
    stage?: AcpHandshakeHealthResult['stage'];
    checkedAt?: string;
    expiresAt?: string;
    cached?: boolean;
    message?: string;
    supportsLoadSession?: boolean;
    supportsListSessions?: boolean;
    supportsClose?: boolean;
    modeCount?: number;
    configOptionCount?: number;
    mcpServerCount?: number;
  };
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

export type AgentRuntimeAdapterOutputProjection = AdapterFacetBase & {
  discovery: AgentRuntimeAdapterOutputDiscovery;
  outputKinds: AgentRuntimeHarnessCapabilities['output'];
  reviewableOutputKinds: AgentRuntimeHarnessCapabilities['output'];
  supportsFileChanges: boolean;
  supportsArtifacts: boolean;
  supportsCheckpoints: boolean;
  supportsBranches: boolean;
  supportsPullRequests: boolean;
};

export type AgentRuntimeAdapterProtocolProjection = AdapterFacetBase & {
  declaredConnectionType?: AcpAdapterConnectionType;
  supportsStreaming: boolean | null;
  authRequired: boolean | null;
  modelCount: number;
  models: Array<{
    id: string;
    label?: string;
    description?: string;
  }>;
  promptCapabilities?: AcpPromptCapabilities;
  mcpCapabilities?: AcpMcpCapabilities;
  sessionCapabilities?: AcpSessionCapabilities & {
    loadSession?: boolean;
  };
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
  output: AgentRuntimeAdapterOutputProjection;
  protocol: AgentRuntimeAdapterProtocolProjection;
  reasons: AgentRuntimeAdapterProjectionReason[];
  blockers?: string[];
};

export type AgentRuntimeAdapterProjectionsPayload = {
  schemaVersion: 1;
  projections: AgentRuntimeAdapterProjection[];
};

export type AgentRuntimeAdapterProjectionServices = {
  listRuntimes(): AgentRuntimeDescriptor[] | Promise<AgentRuntimeDescriptor[]>;
  listAcpHandshakeHealth?(input: {
    runtimes: AgentRuntimeDescriptor[];
    probe: boolean;
    force: boolean;
  }): Promise<AcpHandshakeHealthResult[]> | AcpHandshakeHealthResult[];
};

export async function handleAgentRuntimeAdapterProjectionsGet(
  searchParams: URLSearchParams,
  services: AgentRuntimeAdapterProjectionServices,
): Promise<MindosServerResponse<AgentRuntimeAdapterProjectionsPayload | { error: string }>> {
  try {
    const runtimes = await services.listRuntimes();
    const acpHandshakeHealth = await services.listAcpHandshakeHealth?.({
      runtimes,
      probe: searchParams.get('handshake') === '1',
      force: searchParams.get('force') === '1',
    }) ?? [];
    const payload = buildAgentRuntimeAdapterProjectionsPayload({ runtimes, acpHandshakeHealth });
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
  acpHandshakeHealth?: AcpHandshakeHealthResult[];
}): AgentRuntimeAdapterProjectionsPayload {
  const handshakeByRuntime = byAcpHandshake(input.acpHandshakeHealth ?? []);
  return {
    schemaVersion: 1,
    projections: input.runtimes.map((runtime) => buildRuntimeAdapterProjection(runtime, handshakeByRuntime.get(runtimeKey(runtime)))),
  };
}

function buildRuntimeAdapterProjection(
  runtime: AgentRuntimeDescriptor,
  handshake: AcpHandshakeHealthResult | undefined,
): AgentRuntimeAdapterProjection {
  const connection = buildConnectionProjection(runtime);
  const configuration = buildConfigurationProjection(runtime);
  const health = buildHealthProjection(runtime, handshake);
  const commands = buildCommandsProjection(runtime);
  const output = buildOutputProjection(runtime);
  const protocol = buildProtocolProjection(runtime);
  const facets = [connection, configuration, health, commands, output, protocol];
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
      output,
      protocol,
    }),
    connection,
    configuration,
    health,
    commands,
    output,
    protocol,
    reasons: [
      runtimeAvailableReason(runtime),
      ...facets.flatMap((facet) => facet.reasons),
    ],
    ...(blockers.length > 0 ? { blockers } : {}),
  };
}

function buildOutputProjection(runtime: AgentRuntimeDescriptor): AgentRuntimeAdapterOutputProjection {
  const contract = runtime.adapterContract.output;
  const hasReviewableOutput = contract.reviewableOutputKinds.length > 0;
  const missingOutputContract = contract.discovery === 'unknown' && !hasReviewableOutput;
  const blockers: string[] = [];

  if (runtime.status !== 'available') blockers.push('runtime-available');
  if (missingOutputContract) blockers.push('adapter-output-contract');

  const status = runtime.status !== 'available'
    ? 'blocked'
    : missingOutputContract
      ? 'unknown'
      : 'ready';

  return {
    status,
    discovery: contract.discovery,
    outputKinds: contract.outputKinds,
    reviewableOutputKinds: contract.reviewableOutputKinds,
    supportsFileChanges: contract.supportsFileChanges,
    supportsArtifacts: contract.supportsArtifacts,
    supportsCheckpoints: contract.supportsCheckpoints,
    supportsBranches: contract.supportsBranches,
    supportsPullRequests: contract.supportsPullRequests,
    summary: contract.summary,
    reasons: [
      reason(
        'adapter-output-contract',
        hasReviewableOutput ? 'satisfied' : missingOutputContract ? 'unknown' : 'not-applicable',
        outputOwner(contract.discovery),
        hasReviewableOutput
          ? `${runtime.name} declares reviewable output kinds: ${contract.reviewableOutputKinds.join(', ')}.`
          : missingOutputContract
            ? `${runtime.name} does not declare durable diff, artifact, checkpoint, branch, or PR output.`
            : `${runtime.name} declares text-only output; artifact governance will rely on other runtime capabilities.`,
      ),
    ],
    ...(blockers.length > 0 ? { blockers: uniqSorted(blockers) } : {}),
  };
}

function buildProtocolProjection(runtime: AgentRuntimeDescriptor): AgentRuntimeAdapterProtocolProjection {
  const contract = runtime.adapterContract.protocol;
  const blockers: string[] = [];
  const declaredConnectionType = contract.declaredConnectionType;
  const unsupportedDeclaredConnection = declaredConnectionType === 'http' || declaredConnectionType === 'sse';
  const streamingUnknown = contract.supportsStreaming === null;
  const streamingUnsupported = contract.supportsStreaming === false;
  const authUnknown = contract.authRequired === null;

  if (runtime.status !== 'available') blockers.push('runtime-available');
  if (unsupportedDeclaredConnection) blockers.push('adapter-protocol-connection');
  if (streamingUnknown || streamingUnsupported) blockers.push('adapter-protocol-streaming');
  if (authUnknown) blockers.push('adapter-protocol-auth');

  const status = runtime.status !== 'available'
    ? 'blocked'
    : unsupportedDeclaredConnection || streamingUnknown || streamingUnsupported || authUnknown
      ? 'limited'
      : 'ready';

  return {
    status,
    ...(declaredConnectionType ? { declaredConnectionType } : {}),
    supportsStreaming: contract.supportsStreaming,
    authRequired: contract.authRequired,
    modelCount: contract.modelCount,
    models: contract.models.map((model) => ({
      id: model.id,
      ...(model.label ? { label: model.label } : {}),
      ...(model.description ? { description: model.description } : {}),
    })),
    ...(contract.promptCapabilities ? { promptCapabilities: contract.promptCapabilities } : {}),
    ...(contract.mcpCapabilities ? { mcpCapabilities: contract.mcpCapabilities } : {}),
    ...(contract.sessionCapabilities ? { sessionCapabilities: contract.sessionCapabilities } : {}),
    summary: contract.summary,
    reasons: [
      reason(
        'adapter-protocol-connection',
        unsupportedDeclaredConnection ? 'missing' : 'satisfied',
        unsupportedDeclaredConnection ? 'shared' : protocolOwner(runtime),
        protocolConnectionSummary(runtime, declaredConnectionType),
      ),
      reason(
        'adapter-protocol-streaming',
        contract.supportsStreaming === null ? 'unknown' : contract.supportsStreaming ? 'satisfied' : 'missing',
        protocolOwner(runtime),
        protocolStreamingSummary(runtime.name, contract.supportsStreaming),
      ),
      reason(
        'adapter-protocol-auth',
        contract.authRequired === null ? 'unknown' : 'satisfied',
        protocolOwner(runtime),
        contract.authRequired === null
          ? `${runtime.name} does not declare whether adapter authentication is required.`
          : `${runtime.name} declares adapter authentication as ${contract.authRequired ? 'required' : 'not required'}.`,
      ),
      reason(
        'adapter-protocol-models',
        contract.modelCount > 0 ? 'satisfied' : 'not-applicable',
        protocolOwner(runtime),
        contract.modelCount > 0
          ? `${runtime.name} declares ${contract.modelCount} adapter model option(s).`
          : `${runtime.name} does not declare static adapter model options.`,
      ),
      reason(
        'adapter-protocol-prompt-capabilities',
        contract.promptCapabilities ? 'satisfied' : 'not-applicable',
        protocolOwner(runtime),
        contract.promptCapabilities
          ? `${runtime.name} declares prompt input capability flags.`
          : `${runtime.name} does not declare prompt input capability flags.`,
      ),
      reason(
        'adapter-protocol-mcp-capabilities',
        contract.mcpCapabilities ? 'satisfied' : 'not-applicable',
        protocolOwner(runtime),
        contract.mcpCapabilities
          ? `${runtime.name} declares MCP transport capability flags.`
          : `${runtime.name} does not declare MCP transport capability flags.`,
      ),
      reason(
        'adapter-protocol-session-capabilities',
        contract.sessionCapabilities ? 'satisfied' : 'not-applicable',
        protocolOwner(runtime),
        contract.sessionCapabilities
          ? `${runtime.name} declares session lifecycle capability flags.`
          : `${runtime.name} does not declare session lifecycle capability flags.`,
      ),
    ],
    ...(blockers.length > 0 ? { blockers: uniqSorted(blockers) } : {}),
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

function buildHealthProjection(
  runtime: AgentRuntimeDescriptor,
  handshake: AcpHandshakeHealthResult | undefined,
): AgentRuntimeAdapterHealthProjection {
  const contract = runtime.adapterContract.health;
  const blockers: string[] = [];
  const handshakeFailed = runtime.kind === 'acp' && handshake?.status === 'failed';
  const handshakeReady = runtime.kind === 'acp' && handshake?.status === 'ready';
  if (runtime.status !== 'available') blockers.push('runtime-available');
  if (handshakeFailed) blockers.push('acp-handshake');
  if (!handshakeReady && (contract.mode === 'unknown' || contract.mode === 'unsupported')) blockers.push('adapter-health-contract');
  const status = runtime.status !== 'available'
    ? 'blocked'
    : handshakeFailed
      ? 'blocked'
      : handshakeReady
        ? 'ready'
        : contract.mode === 'unsupported' ? 'blocked' : contract.mode === 'unknown' ? 'unknown' : 'ready';

  return {
    status,
    mode: contract.mode,
    owner: contract.owner,
    hasCommand: !!contract.command,
    ...(contract.timeoutMs !== undefined ? { timeoutMs: contract.timeoutMs } : {}),
    ...(runtime.kind === 'acp' ? { handshake: handshakeProjection(handshake) } : {}),
    summary: handshake
      ? acpHandshakeSummary(runtime.name, handshake)
      : contract.summary,
    reasons: [
      reason(
        'adapter-health-contract',
        handshakeReady ? 'satisfied' : healthModeStatus(contract.mode),
        contract.owner,
        handshakeReady
          ? `${runtime.name} has a cached successful ACP initialize and session handshake.`
          : contract.mode === 'unknown'
          ? `${runtime.name} does not declare adapter-specific health semantics yet.`
          : contract.mode === 'unsupported'
            ? `${runtime.name} declares that adapter health checks are unsupported.`
            : `${runtime.name} health is covered by ${contract.mode}.`,
      ),
      ...(runtime.kind === 'acp' ? [reason(
        'acp-handshake',
        !handshake ? 'unknown' : handshake.status === 'ready' ? 'satisfied' : 'missing',
        'shared',
        !handshake
          ? `${runtime.name} has not completed an ACP initialize/session handshake in this MindOS process yet.`
          : handshake.status === 'ready'
            ? `${runtime.name} completed ACP handshake stage ${handshake.stage}.`
            : `${runtime.name} failed ACP handshake stage ${handshake.stage}${handshake.message ? `: ${handshake.message}` : '.'}`,
      )] : []),
    ],
    ...(blockers.length > 0 ? { blockers: uniqSorted(blockers) } : {}),
  };
}

function handshakeProjection(handshake: AcpHandshakeHealthResult | undefined): NonNullable<AgentRuntimeAdapterHealthProjection['handshake']> {
  if (!handshake) return { status: 'unknown' };
  return {
    status: handshake.status,
    stage: handshake.stage,
    checkedAt: handshake.checkedAt,
    expiresAt: handshake.expiresAt,
    ...(handshake.cached !== undefined ? { cached: handshake.cached } : {}),
    ...(handshake.message ? { message: handshake.message } : {}),
    ...(handshake.session ? {
      supportsLoadSession: handshake.session.supportsLoadSession,
      supportsListSessions: handshake.session.supportsListSessions,
      supportsClose: handshake.session.supportsClose,
      modeCount: handshake.session.modeCount,
      configOptionCount: handshake.session.configOptionCount,
      mcpServerCount: handshake.session.mcpServerCount,
    } : {}),
  };
}

function acpHandshakeSummary(runtimeName: string, handshake: AcpHandshakeHealthResult): string {
  if (handshake.status === 'ready') {
    return `${runtimeName} completed a cached ACP ${handshake.stage} handshake.`;
  }
  return `${runtimeName} failed a cached ACP ${handshake.stage} handshake.`;
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
    output: AdapterFacetBase;
    protocol: AdapterFacetBase;
  },
): AgentRuntimeAdapterProjectionStatus {
  if (runtime.status !== 'available') return 'blocked';
  if (facets.connection.status === 'blocked' || facets.configuration.status === 'blocked' || facets.health.status === 'blocked') {
    return 'blocked';
  }
  if (facets.connection.status === 'unknown' || facets.configuration.status === 'unknown') return 'unknown';
  if (
    facets.health.status !== 'ready'
    || facets.commands.status !== 'ready'
    || facets.output.status !== 'ready'
    || facets.protocol.status !== 'ready'
  ) {
    return 'limited';
  }
  return 'ready';
}

function outputOwner(discovery: AgentRuntimeAdapterOutputDiscovery): AgentRuntimeCompatibilityOwner {
  if (discovery === 'mindos-default') return 'mindos';
  if (discovery === 'runtime-native' || discovery === 'adapter-declared') return 'external';
  return 'shared';
}

function protocolOwner(runtime: AgentRuntimeDescriptor): AgentRuntimeCompatibilityOwner {
  return runtime.kind === 'mindos' ? 'mindos' : 'external';
}

function protocolConnectionSummary(
  runtime: AgentRuntimeDescriptor,
  declaredConnectionType: AcpAdapterConnectionType | undefined,
): string {
  if (!declaredConnectionType) {
    return `${runtime.name} does not declare an adapter connection type, so MindOS uses the ${runtime.adapterContract.connection.kind} adapter contract.`;
  }
  if (declaredConnectionType === 'stdio') {
    return `${runtime.name} declares a stdio ACP adapter connection.`;
  }
  if (declaredConnectionType === 'cli') {
    return `${runtime.name} declares a local CLI ACP adapter connection, which MindOS treats as a stdio-launched adapter.`;
  }
  return `${runtime.name} declares a ${declaredConnectionType} ACP adapter connection, but MindOS currently launches generic ACP adapters over stdio.`;
}

function protocolStreamingSummary(runtimeName: string, supportsStreaming: boolean | null): string {
  if (supportsStreaming === true) {
    return `${runtimeName} declares streaming support for prompt responses.`;
  }
  if (supportsStreaming === false) {
    return `${runtimeName} declares that streaming prompt responses are unsupported.`;
  }
  return `${runtimeName} does not declare streaming support yet.`;
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

function byAcpHandshake(results: AcpHandshakeHealthResult[]): Map<string, AcpHandshakeHealthResult> {
  return new Map(results.map((result) => [result.agentId, result]));
}

function uniqSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}
