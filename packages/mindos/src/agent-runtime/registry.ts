import type { AcpAgentOverride } from '../protocols/acp/index.js';
import {
  acpRuntimeDescriptor,
  mindosRuntimeDescriptor,
  nativeDescriptor,
} from './descriptors.js';
import {
  classifyRuntimeFailure,
  isClaudeAgent,
  isCodexAgent,
  normalizeInstalled,
  normalizeMissing,
} from './detection.js';
import type { AgentRuntimeEnvironmentSettings } from './runtime-env.js';

export type AgentRuntimeKind = 'mindos' | 'acp' | 'codex' | 'claude';
export type AgentRuntimeCategory = 'mindos' | 'native' | 'acp' | 'cloud';
export type NativeRuntimeId = 'codex' | 'claude';
export type AgentRuntimeStatus = 'available' | 'missing' | 'signed-out' | 'error';

export type AgentRuntimeCapabilities = {
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

export type AgentRuntimeBridge = {
  kind: 'codex-app-server' | 'claude-sdk' | 'claude-cli';
  label: string;
  fallback?: boolean;
  reason?: string;
};

export type AgentRuntimeOptionsDescriptor = {
  permissionModes: Array<'readonly' | 'agent' | 'workspace-write' | 'danger-full-access'>;
  effortModes: Array<'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
  modelInput: 'freeform' | 'external';
  defaultPermissionMode: 'readonly' | 'agent' | 'workspace-write' | 'danger-full-access';
  defaultEffortMode: 'auto';
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
  runtimeOptions?: AgentRuntimeOptionsDescriptor;
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
    source: 'user-override' | 'descriptor' | 'registry';
  };
  installCmd?: string;
  packageName?: string;
  availability?: {
    checkedAt: string;
    sources: Array<'acp-detect' | 'acp-registry' | 'mcp-agents' | 'native-health' | 'settings'>;
    reason?: string;
    diagnosticHints?: string[];
    stale?: boolean;
  };
};

export type DetectedRuntimeAgent = {
  id: string;
  name: string;
  binaryPath: string;
  resolvedCommand?: NonNullable<AgentRuntimeDescriptor['resolvedCommand']>;
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
};

export type AgentRuntimePayload = {
  runtime: AgentRuntimeDescriptor;
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
};

export type AgentRuntimesServices = {
  readSettings?(): AgentRuntimesSettings;
  detectLocalAcpAgents?(options?: { overrides?: Record<string, AcpAgentOverride> }): Promise<{
    installed: unknown[];
    notInstalled: unknown[];
  }>;
  checkNativeRuntimeHealth?(input: NativeRuntimeHealthInput): Promise<NativeRuntimeHealthResult>;
  resolveRuntimeCommand?(command: string): Promise<string | null>;
  now?(): number;
};

export const RUNTIME_DETECTION_TIMEOUT_MS = 5000;
export const NATIVE_HEALTH_TIMEOUT_MS = 20000;

export const nativeRuntimeDefinitions: Array<{
  id: 'codex-acp' | 'claude';
  name: string;
  runtime: NativeRuntimeId;
  command: string;
  installCmd: string;
}> = [
  { id: 'codex-acp', name: 'Codex', runtime: 'codex', command: 'codex', installCmd: 'npm install -g @openai/codex' },
  { id: 'claude', name: 'Claude Code', runtime: 'claude', command: 'claude', installCmd: 'npm install -g @anthropic-ai/claude-code' },
];

export function buildAgentRuntimesPayload(input: {
  installed: unknown[];
  notInstalled: unknown[];
  checkedAt: string;
}): AgentRuntimesPayload {
  const installed = input.installed.map(normalizeInstalled).filter((agent): agent is DetectedRuntimeAgent => !!agent);
  const notInstalled = input.notInstalled.map(normalizeMissing).filter((agent): agent is MissingRuntimeAgent => !!agent);
  const codexInstalled = installed.find(isCodexAgent);
  const claudeInstalled = installed.find(isClaudeAgent);
  const codexMissing = notInstalled.find(isCodexAgent);
  const claudeMissing = notInstalled.find(isClaudeAgent);

  const runtimes: AgentRuntimeDescriptor[] = [
    mindosRuntimeDescriptor(input.checkedAt),
    nativeDescriptor({
      id: 'codex',
      name: 'Codex',
      checkedAt: input.checkedAt,
      ...(codexInstalled ? { source: codexInstalled } : {}),
      ...(codexMissing ? { missing: codexMissing } : {}),
    }),
    nativeDescriptor({
      id: 'claude',
      name: 'Claude Code',
      checkedAt: input.checkedAt,
      ...(claudeInstalled ? { source: claudeInstalled } : {}),
      ...(claudeMissing ? { missing: claudeMissing } : {}),
    }),
    ...installed
      .filter((agent) => !isCodexAgent(agent) && !isClaudeAgent(agent))
      .map((agent): AgentRuntimeDescriptor => acpRuntimeDescriptor(agent, input.checkedAt)),
  ];

  return { runtimes, installed, notInstalled };
}

export function buildAcpScopedPayload(input: {
  installed: unknown[];
  notInstalled: unknown[];
  checkedAt: string;
}): AgentRuntimesPayload {
  const installed = input.installed
    .map(normalizeInstalled)
    .filter((agent): agent is DetectedRuntimeAgent => !!agent && !isCodexAgent(agent) && !isClaudeAgent(agent));
  const notInstalled = input.notInstalled
    .map(normalizeMissing)
    .filter((agent): agent is MissingRuntimeAgent => !!agent && !isCodexAgent(agent) && !isClaudeAgent(agent));
  const runtimes = installed.map((agent): AgentRuntimeDescriptor => acpRuntimeDescriptor(agent, input.checkedAt));

  return { runtimes, installed, notInstalled };
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
    const runtime = isCodexAgent(detected) ? 'codex' : isClaudeAgent(detected) ? 'claude' : null;
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
