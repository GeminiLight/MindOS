import type {
  AcpAdapterConnectionType,
  AcpMcpCapabilities,
  AcpPromptCapabilities,
} from './acp-types.js';
import type {
  AcpAgentAdapterMetadata,
  AcpAgentAdapterSessionCapabilities,
} from './adapter-metadata.js';
import type { AcpAgentOverride } from './agent-descriptor-table.js';
import {
  attachRuntimeDiagnostics,
  buildAgentRuntimeCatalogPayload,
  type AgentRuntimeCatalogPayload,
  type AgentRuntimeDiagnostics,
  type AgentRuntimeDiagnosticSource,
  type AgentRuntimeDiagnosticCheck,
  type AgentRuntimeDiagnosticCheckStatus,
  type AgentRuntimeDiagnosticSeverity,
  type AgentRuntimeCatalogEntry,
  type AgentRuntimeCatalogSummary,
} from './catalog.js';
import {
  acpRuntimeDescriptor,
  mindosRuntimeDescriptor,
  nativeDescriptor,
} from './descriptors.js';
import {
  classifyRuntimeFailure,
  normalizeInstalled,
  normalizeMissing,
} from './detection.js';
import {
  NATIVE_RUNTIME_DEFINITIONS,
  matchesNativeRuntime,
  nativeRuntimeIdForAgent,
} from './native-runtimes.js';
import type { AgentRuntimeEnvironmentSettings } from './runtime-env.js';

export type AgentRuntimeKind = 'mindos' | 'acp' | 'codex' | 'claude';
export type AgentRuntimeCategory = 'mindos' | 'native' | 'acp' | 'cloud';
export type NativeRuntimeId = 'codex' | 'claude';
export type AgentRuntimeStatus = 'available' | 'missing' | 'signed-out' | 'error';
export type AgentRuntimeAgentModeSupport = 'unsupported' | 'mindos-managed' | 'runtime-native';

export type AgentRuntimeAgentModeCapabilities = {
  plan: AgentRuntimeAgentModeSupport;
  goal: AgentRuntimeAgentModeSupport;
};

export type AgentRuntimeCapabilities = {
  agentModes: AgentRuntimeAgentModeCapabilities;
  ownsModelSelection: boolean;
  supportsResume: boolean;
  supportsFreshSession: boolean;
  supportsListSessions: boolean;
  supportsAttachExisting: boolean;
  supportsFork: boolean;
  supportsArchive: boolean;
  supportsInterrupt: boolean;
  supportsModelList: boolean;
  supportsApprovals: boolean;
  supportsUserInput: boolean;
  supportsToolEvents: boolean;
  supportsRuntimeStatus: boolean;
  supportsDiffs: boolean;
  supportsCheckpoints: boolean;
  supportsBackgroundRuns: boolean;
  supportsMcpConfig: boolean;
};

export type AgentRuntimeHarnessCapabilities = {
  session: 'none' | 'local-id' | 'native-thread' | 'cloud-task';
  eventStream: Array<'text' | 'tool-events' | 'thread-turn-item' | 'runtime-status' | 'permissions' | 'user-input'>;
  workspace: 'local-cwd' | 'local-worktree' | 'container' | 'cloud-vm';
  permissions: 'none' | 'mindos-only' | 'runtime-bridged';
  tools: Array<'shell' | 'file' | 'git' | 'browser' | 'mcp' | 'plugins' | 'skills'>;
  output: Array<'text' | 'diff' | 'checkpoint' | 'artifact' | 'branch' | 'pr'>;
};

export type AgentRuntimeAdapter =
  | 'mindos'
  | 'codex-app-server'
  | 'codex-sdk'
  | 'claude-cli'
  | 'claude-sdk'
  | 'acp';

export type AgentRuntimeOwner = 'mindos' | 'external';

export type AgentRuntimeLifecycleStage =
  | 'detect'
  | 'health'
  | 'configure'
  | 'launch'
  | 'session'
  | 'context'
  | 'execute'
  | 'interrupt'
  | 'archive'
  | 'remote'
  | 'coordinate';

export type AgentRuntimeLifecycleSupport = 'owned' | 'delegated' | 'unsupported' | 'unknown';

export type AgentRuntimeLifecycleSource =
  | 'settings'
  | 'runtime-registry'
  | 'runtime-catalog'
  | 'native-health'
  | 'acp-detect'
  | 'acp-registry'
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

export type AgentRuntimeLifecycleStageDescriptor = {
  support: AgentRuntimeLifecycleSupport;
  owner: AgentRuntimeOwner;
  summary: string;
  required?: boolean;
  sources?: AgentRuntimeLifecycleSource[];
  diagnosticHints?: string[];
};

export type AgentRuntimeRemoteMode = 'local-only' | 'server-runnable' | 'external-runtime' | 'cloud-task' | 'unknown';

export type AgentRuntimeUnattendedSupport = 'supported' | 'limited' | 'unsupported' | 'unknown';

export type AgentRuntimeCoordinationRole = 'primary' | 'external-worker' | 'subagent-capable' | 'unknown';

export type AgentRuntimeLifecycle = {
  schemaVersion: 1;
  stages: Record<AgentRuntimeLifecycleStage, AgentRuntimeLifecycleStageDescriptor>;
  remote: {
    supported: boolean;
    mode: AgentRuntimeRemoteMode;
    unattended: AgentRuntimeUnattendedSupport;
    summary: string;
  };
  coordination: {
    role: AgentRuntimeCoordinationRole;
    supportsSharedContext: boolean;
    supportsMailbox: boolean;
    supportsTaskBoard: boolean;
    summary: string;
  };
};

export type AgentRuntimeCompatibilityLevel = 'ready' | 'limited' | 'blocked' | 'unknown';

export type AgentRuntimeCompatibilityOwner = AgentRuntimeOwner | 'shared';

export type AgentRuntimeCompatibilityScenario =
  | 'interactive-turn'
  | 'coding-workflow'
  | 'session-continuity'
  | 'context-governance'
  | 'permission-governance'
  | 'mcp-tooling'
  | 'skill-execution'
  | 'artifact-governance'
  | 'remote-control'
  | 'unattended-automation'
  | 'team-coordination';

export type AgentRuntimeCompatibilityRequirementStatus =
  | 'satisfied'
  | 'external'
  | 'missing'
  | 'unknown'
  | 'not-applicable';

export type AgentRuntimeCompatibilityRequirement = {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
};

export type AgentRuntimeCompatibilityAssessment = {
  level: AgentRuntimeCompatibilityLevel;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
  requirements: AgentRuntimeCompatibilityRequirement[];
  blockers?: string[];
};

export type AgentRuntimeCompatibilityProfile = {
  schemaVersion: 1;
  scenarios: Record<AgentRuntimeCompatibilityScenario, AgentRuntimeCompatibilityAssessment>;
  summary: string;
};

export type AgentRuntimeBridge = {
  kind: 'codex-app-server' | 'claude-sdk' | 'claude-cli';
  label: string;
  fallback?: boolean;
  reason?: string;
};

export type AgentRuntimeAdapterConnectionKind =
  | 'internal'
  | 'stdio'
  | 'app-server'
  | 'sdk'
  | 'cli'
  | 'unknown';

export type AgentRuntimeAdapterConfigurationOwner =
  | 'mindos-session'
  | 'mindos-settings'
  | 'runtime-native'
  | 'adapter-declared'
  | 'unsupported'
  | 'unknown';

export type AgentRuntimeAdapterHealthMode =
  | 'mindos-native'
  | 'runtime-native'
  | 'adapter-declared'
  | 'unsupported'
  | 'unknown';

export type AgentRuntimeAdapterCommandDiscovery =
  | 'mindos-skills'
  | 'runtime-event'
  | 'adapter-declared'
  | 'unsupported'
  | 'unknown';

export type AgentRuntimeAdapterOutputDiscovery =
  | 'mindos-default'
  | 'runtime-native'
  | 'adapter-declared'
  | 'unknown';

export type AgentRuntimeAdapterCommandSource =
  | 'mindos'
  | 'runtime-native'
  | 'adapter-declared';

export type AgentRuntimeResolvedCommandSource = 'user-override' | 'descriptor' | 'registry';

export type AgentRuntimeAdapterDeclaredCommand = {
  name: string;
  description?: string;
  source: AgentRuntimeAdapterCommandSource;
};

/** Adapter metadata as sanitised by `adapter-metadata.ts`; kept under its runtime-layer name for client shells. */
export type AgentRuntimeAdapterMetadata = AcpAgentAdapterMetadata;

export type AgentRuntimeAdapterContract = {
  schemaVersion: 1;
  connection: {
    kind: AgentRuntimeAdapterConnectionKind;
    owner: AgentRuntimeOwner;
    summary: string;
    command?: string;
    commandSource?: AgentRuntimeResolvedCommandSource;
  };
  configuration: {
    modelSelection: AgentRuntimeAdapterConfigurationOwner;
    credentials: AgentRuntimeAdapterConfigurationOwner;
    settings: AgentRuntimeAdapterConfigurationOwner;
    summary: string;
  };
  health: {
    mode: AgentRuntimeAdapterHealthMode;
    owner: AgentRuntimeOwner;
    summary: string;
    command?: string;
    timeoutMs?: number;
  };
  commands: {
    discovery: AgentRuntimeAdapterCommandDiscovery;
    commands: AgentRuntimeAdapterDeclaredCommand[];
    summary: string;
  };
  output: {
    discovery: AgentRuntimeAdapterOutputDiscovery;
    outputKinds: AgentRuntimeHarnessCapabilities['output'];
    reviewableOutputKinds: AgentRuntimeHarnessCapabilities['output'];
    supportsFileChanges: boolean;
    supportsArtifacts: boolean;
    supportsCheckpoints: boolean;
    supportsBranches: boolean;
    supportsPullRequests: boolean;
    summary: string;
  };
  protocol: {
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
    sessionCapabilities?: AcpAgentAdapterSessionCapabilities;
    summary: string;
  };
};

export type AgentRuntimeDescriptor = {
  id: string;
  name: string;
  kind: AgentRuntimeKind;
  category?: AgentRuntimeCategory;
  runtimeId?: string;
  adapter: AgentRuntimeAdapter;
  modelOwner: AgentRuntimeOwner;
  authOwner: AgentRuntimeOwner;
  permissionOwner: AgentRuntimeOwner;
  sessionOwner: AgentRuntimeOwner;
  status: AgentRuntimeStatus;
  capabilities: AgentRuntimeCapabilities;
  harnessCapabilities?: AgentRuntimeHarnessCapabilities;
  lifecycle: AgentRuntimeLifecycle;
  compatibility: AgentRuntimeCompatibilityProfile;
  adapterContract: AgentRuntimeAdapterContract;
  runtimeBridge?: AgentRuntimeBridge;
  description?: string;
  sourceAgentId?: string;
  canonicalAgentId?: string;
  mcpAgentKey?: string;
  aliases?: string[];
  binaryPath?: string;
  resolvedCommand?: {
    cmd: string;
    args: string[];
    source: AgentRuntimeResolvedCommandSource;
  };
  installCmd?: string;
  packageName?: string;
  availability?: {
    checkedAt: string;
    sources: AgentRuntimeDiagnosticSource[];
    reason?: string;
    diagnosticHints?: string[];
    stale?: boolean;
  };
  diagnostics?: AgentRuntimeDiagnostics;
};

export type DetectedRuntimeAgent = {
  id: string;
  name: string;
  binaryPath: string;
  resolvedCommand?: NonNullable<AgentRuntimeDescriptor['resolvedCommand']>;
  adapterMetadata?: AgentRuntimeAdapterMetadata;
  status?: Exclude<AgentRuntimeStatus, 'missing'>;
  reason?: string;
  diagnosticHints?: string[];
  runtimeBridge?: AgentRuntimeBridge;
};

export type MissingRuntimeAgent = {
  id: string;
  name: string;
  installCmd: string;
  packageName?: string;
  status?: Extract<AgentRuntimeStatus, 'missing' | 'error'>;
  reason?: string;
  diagnosticHints?: string[];
};

export type AgentRuntimesPayload = {
  runtimes: AgentRuntimeDescriptor[];
  installed: DetectedRuntimeAgent[];
  notInstalled: MissingRuntimeAgent[];
  catalog: AgentRuntimeCatalogPayload;
};

export type AgentRuntimePayload = {
  runtime: AgentRuntimeDescriptor;
  catalog: AgentRuntimeCatalogPayload;
};

export type {
  AgentRuntimeCatalogEntry,
  AgentRuntimeCatalogPayload,
  AgentRuntimeCatalogSummary,
  AgentRuntimeDiagnosticCheck,
  AgentRuntimeDiagnosticCheckStatus,
  AgentRuntimeDiagnosticSeverity,
  AgentRuntimeDiagnostics,
  AgentRuntimeDiagnosticSource,
};

export type AgentRuntimesSettings = {
  acpAgents?: Record<string, AcpAgentOverride>;
  agentRuntimeEnv?: AgentRuntimeEnvironmentSettings;
};

export type NativeRuntimeHealthResult = {
  status: Exclude<AgentRuntimeStatus, 'missing'>;
  reason?: string;
  diagnosticHints?: string[];
  runtimeBridge?: AgentRuntimeBridge;
};

export type NativeRuntimeHealthInput = {
  runtime: NativeRuntimeId;
  agent: DetectedRuntimeAgent;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

export type AgentRuntimesServices = {
  readSettings?(): AgentRuntimesSettings;
  detectLocalAcpAgents?(options?: { overrides?: Record<string, AcpAgentOverride> }): Promise<{
    installed: unknown[];
    notInstalled: unknown[];
  }>;
  checkNativeRuntimeHealth?(input: NativeRuntimeHealthInput): Promise<NativeRuntimeHealthResult>;
  resolveRuntimeCommand?(command: string): Promise<string | null>;
  resolveRuntimeCommandCandidates?(command: string): Promise<string[]>;
  now?(): number;
};

export const RUNTIME_DETECTION_TIMEOUT_MS = 5000;
export const NATIVE_HEALTH_TIMEOUT_MS = 20000;

/**
 * Native runtime definitions are derived from the agent descriptor table; the
 * name is kept so the agent-runtimes handler can iterate them unchanged.
 */
export const nativeRuntimeDefinitions = NATIVE_RUNTIME_DEFINITIONS;
export type { NativeRuntimeDefinition } from './native-runtimes.js';

export function buildAgentRuntimesPayload(input: {
  installed: unknown[];
  notInstalled: unknown[];
  checkedAt: string;
}): AgentRuntimesPayload {
  const installed = input.installed.map(normalizeInstalled).filter((agent): agent is DetectedRuntimeAgent => !!agent);
  const notInstalled = input.notInstalled.map(normalizeMissing).filter((agent): agent is MissingRuntimeAgent => !!agent);

  const runtimes = attachRuntimeDiagnostics([
    mindosRuntimeDescriptor(input.checkedAt),
    ...NATIVE_RUNTIME_DEFINITIONS.map((definition): AgentRuntimeDescriptor => {
      const source = installed.find((agent) => matchesNativeRuntime(agent, definition));
      const missing = notInstalled.find((agent) => matchesNativeRuntime(agent, definition));
      return nativeDescriptor({
        id: definition.runtime,
        name: definition.name,
        checkedAt: input.checkedAt,
        ...(source ? { source } : {}),
        ...(missing ? { missing } : {}),
      });
    }),
    ...installed
      .filter((agent) => nativeRuntimeIdForAgent(agent) === null)
      .map((agent): AgentRuntimeDescriptor => acpRuntimeDescriptor(agent, input.checkedAt)),
  ]);

  return {
    runtimes,
    installed,
    notInstalled,
    catalog: buildAgentRuntimeCatalogPayload({ runtimes, generatedAt: input.checkedAt }),
  };
}

export function buildAcpScopedPayload(input: {
  installed: unknown[];
  notInstalled: unknown[];
  checkedAt: string;
}): AgentRuntimesPayload {
  const installed = input.installed
    .map(normalizeInstalled)
    .filter((agent): agent is DetectedRuntimeAgent => !!agent && nativeRuntimeIdForAgent(agent) === null);
  const notInstalled = input.notInstalled
    .map(normalizeMissing)
    .filter((agent): agent is MissingRuntimeAgent => !!agent && nativeRuntimeIdForAgent(agent) === null);
  const runtimes = attachRuntimeDiagnostics(
    installed.map((agent): AgentRuntimeDescriptor => acpRuntimeDescriptor(agent, input.checkedAt)),
  );

  return {
    runtimes,
    installed,
    notInstalled,
    catalog: buildAgentRuntimeCatalogPayload({ runtimes, generatedAt: input.checkedAt }),
  };
}

export async function applyNativeRuntimeHealth(
  installed: unknown[],
  services: AgentRuntimesServices,
  checkNativeRuntimeHealthFallback: (input: NativeRuntimeHealthInput) => Promise<NativeRuntimeHealthResult>,
): Promise<unknown[]> {
  const checkNativeRuntimeHealth = services.checkNativeRuntimeHealth ?? checkNativeRuntimeHealthFallback;
  const normalized = installed.map((agent) => ({ raw: agent, detected: normalizeInstalled(agent) }));
  const enriched = await Promise.all(normalized.map(async ({ raw, detected }) => {
    if (!detected) return raw;
    const runtime = nativeRuntimeIdForAgent(detected);
    if (!runtime) return raw;
    if (detected.status) return raw;
    try {
      const health = await checkNativeRuntimeHealth({
        runtime,
        agent: detected,
        timeoutMs: NATIVE_HEALTH_TIMEOUT_MS,
      });
      return {
        ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : detected),
        status: health.status,
        ...(health.reason ? { reason: health.reason } : {}),
        ...(health.diagnosticHints ? { diagnosticHints: health.diagnosticHints } : {}),
        ...(health.runtimeBridge ? { runtimeBridge: health.runtimeBridge } : {}),
      };
    } catch (error) {
      const result = classifyRuntimeFailure(error instanceof Error ? error.message : String(error), runtime);
      return {
        ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : detected),
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
      };
    }
  }));
  return enriched;
}
