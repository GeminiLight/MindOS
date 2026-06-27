import { redactSensitiveObject, redactSensitiveText } from '../redaction.js';
import type {
  AgentRuntimeAdapterContract,
  AgentRuntimeDescriptor,
  AgentRuntimeKind,
  AgentRuntimeOwner,
  AgentRuntimeStatus,
} from './registry.js';

export type AgentRuntimeDiagnosticSource =
  | 'settings'
  | 'runtime-registry'
  | 'runtime-catalog'
  | 'native-health'
  | 'acp-detect'
  | 'acp-registry'
  | 'mcp-agents'
  | 'env-path'
  | 'user-override'
  | 'extension-manifest'
  | 'turn-runner'
  | 'runtime-bridge'
  | 'codex-app-server'
  | 'claude-bridge'
  | 'acp-session'
  | 'mindos-pi-session'
  | 'run-ledger';

export type AgentRuntimeDiagnosticSeverity = 'info' | 'warning' | 'error';

export type AgentRuntimeDiagnosticCheckStatus =
  | 'passed'
  | 'warning'
  | 'failed'
  | 'skipped'
  | 'unknown';

export type AgentRuntimeDiagnosticCheck = {
  id: string;
  label: string;
  status: AgentRuntimeDiagnosticCheckStatus;
  severity: AgentRuntimeDiagnosticSeverity;
  source: AgentRuntimeDiagnosticSource;
  summary: string;
  remediation?: string;
  details?: Record<string, unknown>;
};

export type AgentRuntimeDiagnostics = {
  schemaVersion: 1;
  checkedAt: string;
  status: AgentRuntimeStatus;
  sources: AgentRuntimeDiagnosticSource[];
  summary: string;
  reason?: string;
  hints: string[];
  selectedCommand?: {
    cmd: string;
    args: string[];
    source: 'user-override' | 'descriptor' | 'registry';
  };
  binaryPath?: string;
  checks: AgentRuntimeDiagnosticCheck[];
  stale?: boolean;
};

export type AgentRuntimeCatalogEntry = {
  schemaVersion: 1;
  id: string;
  runtimeId: string;
  name: string;
  kind: AgentRuntimeKind;
  category: NonNullable<AgentRuntimeDescriptor['category']>;
  status: AgentRuntimeStatus;
  adapter: AgentRuntimeDescriptor['adapter'];
  sourceAgentId?: string;
  canonicalAgentId?: string;
  aliases: string[];
  owners: {
    model: AgentRuntimeOwner;
    auth: AgentRuntimeOwner;
    permission: AgentRuntimeOwner;
    session: AgentRuntimeOwner;
  };
  capabilitySummary: {
    session: NonNullable<AgentRuntimeDescriptor['harnessCapabilities']>['session'] | 'unknown';
    commandDiscovery: AgentRuntimeAdapterContract['commands']['discovery'];
    modelSelection: AgentRuntimeAdapterContract['configuration']['modelSelection'];
    mcpConfig: {
      supportsDescriptorConfig: boolean;
      declaredCapabilities?: AgentRuntimeAdapterContract['protocol']['mcpCapabilities'];
    };
    output: NonNullable<AgentRuntimeDescriptor['harnessCapabilities']>['output'];
    eventStream: NonNullable<AgentRuntimeDescriptor['harnessCapabilities']>['eventStream'];
    remoteMode: AgentRuntimeDescriptor['lifecycle']['remote']['mode'];
    unattended: AgentRuntimeDescriptor['lifecycle']['remote']['unattended'];
    coordinationRole: AgentRuntimeDescriptor['lifecycle']['coordination']['role'];
  };
  install?: {
    command: string;
    packageName?: string;
  };
  mcpAgentKey?: string;
  binaryPath?: string;
  resolvedCommand?: AgentRuntimeDescriptor['resolvedCommand'];
  diagnostics: AgentRuntimeDiagnostics;
};

export type AgentRuntimeCatalogSummary = {
  total: number;
  available: number;
  missing: number;
  signedOut: number;
  error: number;
  categories: Record<NonNullable<AgentRuntimeDescriptor['category']>, number>;
};

export type AgentRuntimeCatalogPayload = {
  schemaVersion: 1;
  generatedAt: string;
  summary: AgentRuntimeCatalogSummary;
  entries: AgentRuntimeCatalogEntry[];
};

export function attachRuntimeDiagnostics(runtimes: AgentRuntimeDescriptor[]): AgentRuntimeDescriptor[] {
  return runtimes.map((runtime) => ({
    ...runtime,
    diagnostics: runtime.diagnostics ?? buildAgentRuntimeDiagnostics(runtime),
  }));
}

export function buildSingleRuntimeCatalogPayload(input: {
  runtime: AgentRuntimeDescriptor;
  generatedAt?: string;
}): AgentRuntimeCatalogPayload {
  const runtime = {
    ...input.runtime,
    diagnostics: input.runtime.diagnostics ?? buildAgentRuntimeDiagnostics(input.runtime),
  };
  return buildAgentRuntimeCatalogPayload({
    runtimes: [runtime],
    generatedAt: input.generatedAt ?? runtime.diagnostics.checkedAt,
  });
}

export function buildAgentRuntimeCatalogPayload(input: {
  runtimes: AgentRuntimeDescriptor[];
  generatedAt: string;
}): AgentRuntimeCatalogPayload {
  const runtimes = attachRuntimeDiagnostics(input.runtimes);
  const entries = runtimes.map(buildAgentRuntimeCatalogEntry);
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    summary: summarizeCatalog(entries),
    entries,
  };
}

export function buildAgentRuntimeDiagnostics(runtime: AgentRuntimeDescriptor): AgentRuntimeDiagnostics {
  const availability = runtime.availability;
  const sources = uniqSources([
    ...(availability?.sources ?? []),
    'runtime-catalog',
    ...lifecycleSources(runtime),
  ]);
  const checkedAt = availability?.checkedAt ?? new Date(0).toISOString();
  const reason = availability?.reason ? redact(availability.reason) : undefined;
  const hints = uniqStrings((availability?.diagnosticHints ?? []).map(redact).filter(Boolean));
  const checks = [
    availabilityCheck(runtime, reason),
    commandResolutionCheck(runtime),
    adapterHealthCheck(runtime),
    adapterProtocolCheck(runtime),
    commandDiscoveryCheck(runtime),
    sessionOwnershipCheck(runtime),
    mcpCapabilityCheck(runtime),
  ];

  return {
    schemaVersion: 1,
    checkedAt,
    status: runtime.status,
    sources,
    summary: diagnosticSummary(runtime),
    ...(reason ? { reason } : {}),
    hints,
    ...(runtime.resolvedCommand ? { selectedCommand: safeCommand(runtime.resolvedCommand) } : {}),
    ...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
    checks,
    ...(availability?.stale ? { stale: true } : {}),
  };
}

function buildAgentRuntimeCatalogEntry(runtime: AgentRuntimeDescriptor): AgentRuntimeCatalogEntry {
  const diagnostics = runtime.diagnostics ?? buildAgentRuntimeDiagnostics(runtime);
  return {
    schemaVersion: 1,
    id: runtime.id,
    runtimeId: runtime.runtimeId ?? runtime.id,
    name: runtime.name,
    kind: runtime.kind,
    category: runtime.category ?? categoryForKind(runtime.kind),
    status: runtime.status,
    adapter: runtime.adapter,
    ...(runtime.sourceAgentId ? { sourceAgentId: runtime.sourceAgentId } : {}),
    ...(runtime.canonicalAgentId ? { canonicalAgentId: runtime.canonicalAgentId } : {}),
    aliases: runtime.aliases ?? [],
    owners: {
      model: runtime.modelOwner,
      auth: runtime.authOwner,
      permission: runtime.permissionOwner,
      session: runtime.sessionOwner,
    },
    capabilitySummary: {
      session: runtime.harnessCapabilities?.session ?? 'unknown',
      commandDiscovery: runtime.adapterContract.commands.discovery,
      modelSelection: runtime.adapterContract.configuration.modelSelection,
      mcpConfig: {
        supportsDescriptorConfig: runtime.capabilities.supportsMcpConfig,
        ...(runtime.adapterContract.protocol.mcpCapabilities
          ? { declaredCapabilities: runtime.adapterContract.protocol.mcpCapabilities }
          : {}),
      },
      output: runtime.harnessCapabilities?.output ?? [],
      eventStream: runtime.harnessCapabilities?.eventStream ?? [],
      remoteMode: runtime.lifecycle.remote.mode,
      unattended: runtime.lifecycle.remote.unattended,
      coordinationRole: runtime.lifecycle.coordination.role,
    },
    ...(runtime.installCmd ? {
      install: {
        command: redact(runtime.installCmd),
        ...(runtime.packageName ? { packageName: runtime.packageName } : {}),
      },
    } : {}),
    ...(runtime.mcpAgentKey ? { mcpAgentKey: runtime.mcpAgentKey } : {}),
    ...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
    ...(runtime.resolvedCommand ? { resolvedCommand: safeCommand(runtime.resolvedCommand) } : {}),
    diagnostics,
  };
}

function summarizeCatalog(entries: AgentRuntimeCatalogEntry[]): AgentRuntimeCatalogSummary {
  const categories: AgentRuntimeCatalogSummary['categories'] = {
    mindos: 0,
    native: 0,
    acp: 0,
    cloud: 0,
  };
  for (const entry of entries) categories[entry.category] += 1;
  return {
    total: entries.length,
    available: entries.filter((entry) => entry.status === 'available').length,
    missing: entries.filter((entry) => entry.status === 'missing').length,
    signedOut: entries.filter((entry) => entry.status === 'signed-out').length,
    error: entries.filter((entry) => entry.status === 'error').length,
    categories,
  };
}

function availabilityCheck(
  runtime: AgentRuntimeDescriptor,
  reason: string | undefined,
): AgentRuntimeDiagnosticCheck {
  if (runtime.status === 'available') {
    return check('availability', 'Availability', 'passed', 'info', availabilitySource(runtime), `${runtime.name} is available.`);
  }
  const remediation = runtime.installCmd
    ? `Install the runtime or expose it on the MindOS server PATH: ${runtime.installCmd}`
    : 'Resolve the runtime setup issue and refresh runtime detection.';
  return check(
    'availability',
    'Availability',
    runtime.status === 'signed-out' ? 'warning' : 'failed',
    runtime.status === 'signed-out' ? 'warning' : 'error',
    availabilitySource(runtime),
    reason ?? `${runtime.name} is not available.`,
    remediation,
  );
}

function commandResolutionCheck(runtime: AgentRuntimeDescriptor): AgentRuntimeDiagnosticCheck {
  if (runtime.kind === 'mindos') {
    return check(
      'command-resolution',
      'Command resolution',
      'skipped',
      'info',
      'settings',
      'MindOS is an internal runtime and does not need an external command.',
    );
  }
  if (runtime.resolvedCommand || runtime.binaryPath) {
    return check(
      'command-resolution',
      'Command resolution',
      'passed',
      'info',
      runtime.resolvedCommand?.source === 'user-override' ? 'user-override' : availabilitySource(runtime),
      `${runtime.name} has a resolved launch command.`,
      undefined,
      {
        ...(runtime.resolvedCommand ? { command: runtime.resolvedCommand.cmd, source: runtime.resolvedCommand.source } : {}),
        ...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
      },
    );
  }
  return check(
    'command-resolution',
    'Command resolution',
    'failed',
    'error',
    availabilitySource(runtime),
    `${runtime.name} does not have a resolved launch command.`,
    runtime.installCmd ? `Install with ${runtime.installCmd} or configure an explicit command.` : 'Configure an explicit command or install the runtime.',
  );
}

function adapterHealthCheck(runtime: AgentRuntimeDescriptor): AgentRuntimeDiagnosticCheck {
  const health = runtime.adapterContract.health;
  if (health.mode === 'unsupported') {
    return check('adapter-health', 'Adapter health', 'skipped', 'info', 'runtime-catalog', health.summary);
  }
  if (health.mode === 'unknown') {
    return check(
      'adapter-health',
      'Adapter health',
      runtime.status === 'available' ? 'unknown' : 'failed',
      runtime.status === 'available' ? 'warning' : 'error',
      health.owner === 'mindos' ? 'native-health' : availabilitySource(runtime),
      health.summary,
      'Add adapter health metadata or expose a runtime-native health check.',
    );
  }
  return check(
    'adapter-health',
    'Adapter health',
    runtime.status === 'available' ? 'passed' : 'failed',
    runtime.status === 'available' ? 'info' : 'error',
    health.mode === 'mindos-native' ? 'native-health' : 'runtime-catalog',
    health.summary,
    runtime.status === 'available' ? undefined : 'Fix runtime availability before trusting adapter health.',
    {
      mode: health.mode,
      owner: health.owner,
      ...(health.timeoutMs ? { timeoutMs: health.timeoutMs } : {}),
    },
  );
}

function adapterProtocolCheck(runtime: AgentRuntimeDescriptor): AgentRuntimeDiagnosticCheck {
  const protocol = runtime.adapterContract.protocol;
  const streamingUnknown = protocol.supportsStreaming === null;
  const streamingUnsupported = protocol.supportsStreaming === false;
  const authUnknown = protocol.authRequired === null;
  if (streamingUnknown || streamingUnsupported || authUnknown) {
    return check(
      'adapter-protocol',
      'Protocol contract',
      'warning',
      'warning',
      'runtime-catalog',
      protocol.summary,
      'Declare streaming/auth/protocol capabilities in the adapter contract or extension manifest.',
      {
        supportsStreaming: protocol.supportsStreaming,
        authRequired: protocol.authRequired,
        modelCount: protocol.modelCount,
      },
    );
  }
  return check(
    'adapter-protocol',
    'Protocol contract',
    'passed',
    'info',
    'runtime-catalog',
    protocol.summary,
    undefined,
    {
      supportsStreaming: protocol.supportsStreaming,
      authRequired: protocol.authRequired,
      modelCount: protocol.modelCount,
    },
  );
}

function commandDiscoveryCheck(runtime: AgentRuntimeDescriptor): AgentRuntimeDiagnosticCheck {
  const commands = runtime.adapterContract.commands;
  if (commands.discovery === 'unknown') {
    return check(
      'command-discovery',
      'Command discovery',
      'unknown',
      'warning',
      'runtime-catalog',
      commands.summary,
      'Surface runtime commands from a live session event or extension manifest declaration.',
    );
  }
  if (commands.discovery === 'unsupported') {
    return check('command-discovery', 'Command discovery', 'skipped', 'info', 'runtime-catalog', commands.summary);
  }
  return check(
    'command-discovery',
    'Command discovery',
    'passed',
    'info',
    commands.discovery === 'runtime-event' ? 'acp-session' : 'runtime-catalog',
    commands.summary,
    undefined,
    { commandCount: commands.commands.length, discovery: commands.discovery },
  );
}

function sessionOwnershipCheck(runtime: AgentRuntimeDescriptor): AgentRuntimeDiagnosticCheck {
  const sessionStage = runtime.lifecycle.stages.session;
  return check(
    'session-ownership',
    'Session ownership',
    sessionStage.support === 'unknown' ? 'unknown' : 'passed',
    sessionStage.support === 'unknown' ? 'warning' : 'info',
    sessionStage.sources?.[0] ?? 'runtime-catalog',
    sessionStage.summary,
    sessionStage.support === 'unknown' ? 'Declare session lifecycle ownership for this runtime.' : undefined,
    {
      owner: sessionStage.owner,
      support: sessionStage.support,
      harnessSession: runtime.harnessCapabilities?.session ?? 'unknown',
    },
  );
}

function mcpCapabilityCheck(runtime: AgentRuntimeDescriptor): AgentRuntimeDiagnosticCheck {
  const mcpCapabilities = runtime.adapterContract.protocol.mcpCapabilities;
  const supportsMcp = runtime.capabilities.supportsMcpConfig || !!mcpCapabilities;
  if (!supportsMcp) {
    return check(
      'mcp-capability',
      'MCP capability',
      runtime.kind === 'acp' ? 'unknown' : 'skipped',
      runtime.kind === 'acp' ? 'warning' : 'info',
      'runtime-catalog',
      `${runtime.name} has not declared session MCP inheritance capabilities.`,
      runtime.kind === 'acp' ? 'Declare MCP transport support or keep MCP managed by the native runtime.' : undefined,
    );
  }
  return check(
    'mcp-capability',
    'MCP capability',
    'passed',
    'info',
    'runtime-catalog',
    `${runtime.name} can participate in MCP configuration projection diagnostics.`,
    undefined,
    {
      supportsDescriptorConfig: runtime.capabilities.supportsMcpConfig,
      ...(mcpCapabilities ? { mcpCapabilities } : {}),
    },
  );
}

function diagnosticSummary(runtime: AgentRuntimeDescriptor): string {
  if (runtime.status === 'available') {
    return `${runtime.name} is cataloged as an available ${runtime.kind} runtime.`;
  }
  if (runtime.status === 'signed-out') {
    return `${runtime.name} was detected but needs runtime-native authentication or configuration.`;
  }
  if (runtime.status === 'missing') {
    return `${runtime.name} is cataloged but not installed or not visible to MindOS.`;
  }
  return `${runtime.name} is cataloged with a runtime error.`;
}

function availabilitySource(runtime: AgentRuntimeDescriptor): AgentRuntimeDiagnosticSource {
  return runtime.availability?.sources[0] ?? (runtime.kind === 'mindos' ? 'settings' : 'runtime-registry');
}

function lifecycleSources(runtime: AgentRuntimeDescriptor): AgentRuntimeDiagnosticSource[] {
  return Object.values(runtime.lifecycle.stages).flatMap((stage) => stage.sources ?? []);
}

function check(
  id: string,
  label: string,
  status: AgentRuntimeDiagnosticCheckStatus,
  severity: AgentRuntimeDiagnosticSeverity,
  source: AgentRuntimeDiagnosticSource,
  summary: string,
  remediation?: string,
  details?: Record<string, unknown>,
): AgentRuntimeDiagnosticCheck {
  return {
    id,
    label,
    status,
    severity,
    source,
    summary: redact(summary),
    ...(remediation ? { remediation: redact(remediation) } : {}),
    ...(details ? { details: redactDetails(details) } : {}),
  };
}

function categoryForKind(kind: AgentRuntimeKind): NonNullable<AgentRuntimeDescriptor['category']> {
  if (kind === 'mindos') return 'mindos';
  if (kind === 'codex' || kind === 'claude') return 'native';
  return 'acp';
}

function uniqSources(values: AgentRuntimeDiagnosticSource[]): AgentRuntimeDiagnosticSource[] {
  return [...new Set(values)].sort();
}

function uniqStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function redact(value: string): string {
  return redactSensitiveText(value);
}

function redactDetails(details: Record<string, unknown>): Record<string, unknown> {
  return redactSensitiveObject(details) as Record<string, unknown>;
}

function safeCommand<T extends { cmd: string; args: string[]; source: string }>(command: T): T {
  return redactSensitiveObject(command);
}
