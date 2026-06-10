import {
  detectLocalAcpAgents as defaultDetectLocalAcpAgents,
  resolveCommandPath,
  type AcpAgentOverride,
} from '../../protocols/acp/index.js';
import {
  readCodexConfigText,
  resolveCodexProviderEnvironment,
  type CodexShellEnvValueReader,
} from '../../agent-runtime/codex-env.js';
import {
  CLAUDE_CODE_SDK_BINARY_SENTINEL,
  resolveClaudeCodeSdkNativeBinaryPath,
  type ClaudeCodeSdkNativeBinaryResolution,
} from '../../agent-runtime/claude-code-sdk.js';
import type { AgentRuntimeEnvironmentSettings } from '../../agent-runtime/runtime-env.js';
import { spawn } from 'node:child_process';
import { errorResponse, json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export type AgentRuntimeKind = 'mindos' | 'acp' | 'codex' | 'claude';
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

export type AgentRuntimeAdapter =
  | 'mindos'
  | 'codex-app-server'
  | 'claude-cli'
  | 'claude-sdk'
  | 'acp';

export type AgentRuntimeOwner = 'mindos' | 'external';

export type AgentRuntimeDescriptor = {
  id: string;
  name: string;
  kind: AgentRuntimeKind;
  adapter: AgentRuntimeAdapter;
  modelOwner: AgentRuntimeOwner;
  authOwner: AgentRuntimeOwner;
  permissionOwner: AgentRuntimeOwner;
  sessionOwner: AgentRuntimeOwner;
  status: AgentRuntimeStatus;
  capabilities: AgentRuntimeCapabilities;
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
  resolvedCommand?: RuntimeResolvedCommand;
  status?: Exclude<AgentRuntimeStatus, 'missing'>;
  reason?: string;
  diagnosticHints?: string[];
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
};

export type NativeRuntimeHealthInput = {
  runtime: 'codex' | 'claude';
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

type RuntimeResolvedCommand = NonNullable<AgentRuntimeDescriptor['resolvedCommand']>;
type NativeRuntimeId = 'codex' | 'claude';

const mindosCapabilities: AgentRuntimeCapabilities = {
  ownsModelSelection: true,
  supportsResume: true,
  supportsFreshSession: true,
  supportsListSessions: true,
  supportsAttachExisting: false,
  supportsFork: false,
  supportsArchive: false,
  supportsInterrupt: true,
  supportsModelList: true,
  supportsApprovals: false,
  supportsUserInput: true,
  supportsToolEvents: true,
  supportsRuntimeStatus: true,
  supportsDiffs: false,
  supportsCheckpoints: false,
  supportsBackgroundRuns: false,
  supportsMcpConfig: true,
};

const nativeBaseCapabilities: AgentRuntimeCapabilities = {
  ownsModelSelection: true,
  supportsResume: true,
  supportsFreshSession: true,
  supportsListSessions: false,
  supportsAttachExisting: false,
  supportsFork: false,
  supportsArchive: false,
  supportsInterrupt: true,
  supportsModelList: false,
  supportsApprovals: true,
  supportsUserInput: true,
  supportsToolEvents: true,
  supportsRuntimeStatus: true,
  supportsDiffs: false,
  supportsCheckpoints: false,
  supportsBackgroundRuns: false,
  supportsMcpConfig: true,
};

const codexCapabilities: AgentRuntimeCapabilities = {
  ...nativeBaseCapabilities,
  supportsListSessions: true,
  supportsAttachExisting: true,
  supportsFork: true,
  supportsArchive: true,
};

const claudeCapabilities: AgentRuntimeCapabilities = {
  ...nativeBaseCapabilities,
};

const acpCapabilities: AgentRuntimeCapabilities = {
  ownsModelSelection: true,
  supportsResume: false,
  supportsFreshSession: false,
  supportsListSessions: false,
  supportsAttachExisting: false,
  supportsFork: false,
  supportsArchive: false,
  supportsInterrupt: true,
  supportsModelList: false,
  supportsApprovals: false,
  supportsUserInput: false,
  supportsToolEvents: true,
  supportsRuntimeStatus: false,
  supportsDiffs: false,
  supportsCheckpoints: false,
  supportsBackgroundRuns: false,
  supportsMcpConfig: false,
};

const RUNTIME_DETECTION_TIMEOUT_MS = 5000;
const NATIVE_HEALTH_TIMEOUT_MS = 20000;
const CLAUDE_SDK_BINARY_PATH = CLAUDE_CODE_SDK_BINARY_SENTINEL;
const CLAUDE_CLI_PATH_GRACE_MS = 0;
const nativeRuntimeDefinitions: Array<{
  id: 'codex-acp' | 'claude';
  name: string;
  runtime: 'codex' | 'claude';
  command: string;
  installCmd: string;
}> = [
  { id: 'codex-acp', name: 'Codex', runtime: 'codex', command: 'codex', installCmd: 'npm install -g @openai/codex' },
  { id: 'claude', name: 'Claude Code', runtime: 'claude', command: 'claude', installCmd: 'npm install -g @anthropic-ai/claude-code' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function classifyRuntimeFailure(message: string): NativeRuntimeHealthResult {
  const normalized = message.trim() || 'Runtime failed to start.';
  if (/\b(login|log in|signin|sign in|auth|authentication|unauthori[sz]ed|credential|api key|token)\b/i.test(normalized)) {
    return { status: 'signed-out', reason: normalized };
  }
  if (/missing environment variable/i.test(normalized)) {
    return { status: 'signed-out', reason: normalized };
  }
  return { status: 'error', reason: normalized };
}

function isResolvedCommandSource(value: unknown): value is RuntimeResolvedCommand['source'] {
  return value === 'user-override' || value === 'descriptor' || value === 'registry';
}

function isInstalledRuntimeStatus(value: unknown): value is Exclude<AgentRuntimeStatus, 'missing'> {
  return value === 'available' || value === 'signed-out' || value === 'error';
}

function isMissingRuntimeStatus(value: unknown): value is Extract<AgentRuntimeStatus, 'missing' | 'error'> {
  return value === 'missing' || value === 'error';
}

function normalizeResolvedCommand(value: unknown): RuntimeResolvedCommand | null {
  if (!isRecord(value)) return null;
  if (typeof value.cmd !== 'string' || !Array.isArray(value.args) || !value.args.every((arg) => typeof arg === 'string')) return null;
  if (!isResolvedCommandSource(value.source)) return null;
  return {
    cmd: value.cmd,
    args: value.args,
    source: value.source,
  };
}

function normalizeDiagnosticHints(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const hints = value
    .filter((hint): hint is string => typeof hint === 'string' && hint.trim().length > 0)
    .map((hint) => hint.trim());
  return hints.length > 0 ? Array.from(new Set(hints)) : undefined;
}

function normalizeInstalled(value: unknown): DetectedRuntimeAgent | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.binaryPath !== 'string') return null;
  const resolved = normalizeResolvedCommand(value.resolvedCommand);
  const diagnosticHints = normalizeDiagnosticHints(value.diagnosticHints);
  return {
    id: value.id,
    name: value.name,
    binaryPath: value.binaryPath,
    ...(resolved ? { resolvedCommand: resolved } : {}),
    ...(isInstalledRuntimeStatus(value.status) ? { status: value.status } : {}),
    ...(typeof value.reason === 'string' && value.reason.trim() ? { reason: value.reason } : {}),
    ...(diagnosticHints ? { diagnosticHints } : {}),
  };
}

function normalizeMissing(value: unknown): MissingRuntimeAgent | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.installCmd !== 'string') return null;
  const diagnosticHints = normalizeDiagnosticHints(value.diagnosticHints);
  return {
    id: value.id,
    name: value.name,
    installCmd: value.installCmd,
    ...(typeof value.packageName === 'string' ? { packageName: value.packageName } : {}),
    ...(isMissingRuntimeStatus(value.status) ? { status: value.status } : {}),
    ...(typeof value.reason === 'string' && value.reason.trim() ? { reason: value.reason } : {}),
    ...(diagnosticHints ? { diagnosticHints } : {}),
  };
}

function isCodexAgent(agent: Pick<DetectedRuntimeAgent | MissingRuntimeAgent, 'id' | 'name'>): boolean {
  const name = agent.name.toLowerCase();
  return agent.id === 'codex' || agent.id === 'codex-acp' || name === 'codex' || name.includes('codex');
}

function isClaudeAgent(agent: Pick<DetectedRuntimeAgent | MissingRuntimeAgent, 'id' | 'name'>): boolean {
  const name = agent.name.toLowerCase();
  return agent.id === 'claude' || agent.id === 'claude-code' || name.includes('claude');
}

function nativeDescriptor(input: {
  id: 'codex' | 'claude';
  name: string;
  checkedAt: string;
  source?: DetectedRuntimeAgent;
  missing?: MissingRuntimeAgent;
}): AgentRuntimeDescriptor {
  const status = input.source ? input.source.status ?? 'available' : input.missing?.status ?? 'missing';
  const reason = input.source?.reason ?? input.missing?.reason;
  const diagnosticHints = Array.from(new Set([
    ...(input.source?.diagnosticHints ?? input.missing?.diagnosticHints ?? []),
    ...nativeRuntimeDiagnosticHints({
      id: input.id,
      name: input.name,
      status,
      reason,
      binaryPath: input.source?.binaryPath,
      installCmd: input.missing?.installCmd,
    }),
  ]));

  return {
    id: input.id,
    name: input.name,
    kind: input.id,
    adapter: input.id === 'codex' ? 'codex-app-server' : 'claude-sdk',
    modelOwner: 'external',
    authOwner: 'external',
    permissionOwner: 'external',
    sessionOwner: 'external',
    status,
    capabilities: input.id === 'codex' ? codexCapabilities : claudeCapabilities,
    description: input.id === 'codex'
      ? 'Local Codex app-server runtime. Model, approval, and thread behavior are owned by Codex.'
      : 'Local Claude Code runtime. Model, permission, and session behavior are owned by Claude Code.',
    aliases: input.id === 'codex' ? ['codex-acp'] : ['claude-code', 'claude'],
    ...(input.id === 'codex' ? { mcpAgentKey: 'codex' } : { mcpAgentKey: 'claude-code' }),
    ...(input.source ? {
      sourceAgentId: input.source.id,
      canonicalAgentId: input.source.id,
      binaryPath: input.source.binaryPath,
      ...(input.source.resolvedCommand ? { resolvedCommand: input.source.resolvedCommand } : {}),
    } : {}),
    ...(!input.source && input.missing ? {
      sourceAgentId: input.missing.id,
      canonicalAgentId: input.missing.id,
      installCmd: input.missing.installCmd,
      ...(input.missing.packageName ? { packageName: input.missing.packageName } : {}),
    } : {}),
    availability: {
      checkedAt: input.checkedAt,
      sources: ['native-health'],
      ...(reason
        ? { reason }
        : !input.source
          ? { reason: `${input.name} executable was not detected.` }
          : {}),
      ...(diagnosticHints.length > 0 ? { diagnosticHints } : {}),
    },
  };
}

function nativeRuntimeDiagnosticHints(input: {
  id: 'codex' | 'claude';
  name: string;
  status: AgentRuntimeStatus;
  reason?: string;
  binaryPath?: string;
  installCmd?: string;
}): string[] {
  if (input.status === 'available') return [];
  const command = input.id === 'codex' ? 'codex' : 'claude';
  const hints: string[] = [];

  if (input.status === 'missing') {
    hints.push(`MindOS checked command "${command}" on the server PATH.`);
    hints.push(input.installCmd
      ? `Install it or add it to the PATH used to start MindOS: ${input.installCmd}`
      : `Install ${input.name} or add it to the PATH used to start MindOS.`);
    return hints;
  }

  if (input.binaryPath) {
    hints.push(`MindOS detected ${input.name} at ${input.binaryPath}.`);
  }

  if (input.status === 'signed-out') {
    hints.push(input.id === 'codex'
      ? 'Run "codex login status" from the same environment that starts MindOS.'
      : 'Run Claude Code once from the same environment that starts MindOS.');
  } else {
    hints.push(input.id === 'codex'
      ? 'Run "codex app-server --help" from the MindOS server environment.'
      : 'Run "claude --version" from the MindOS server environment.');
  }

  if (input.reason && /(environment variable|cannot see|env)/i.test(input.reason)) {
    hints.push('Restart MindOS after exporting the required environment variable so the server process inherits it.');
  }

  return hints;
}

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
    {
      id: 'mindos',
      name: 'MindOS',
      kind: 'mindos',
      adapter: 'mindos',
      modelOwner: 'mindos',
      authOwner: 'mindos',
      permissionOwner: 'mindos',
      sessionOwner: 'mindos',
      status: 'available',
      capabilities: mindosCapabilities,
      description: 'MindOS internal agent using the selected provider and model.',
      availability: { checkedAt: input.checkedAt, sources: ['settings'] },
    },
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
      .map((agent): AgentRuntimeDescriptor => ({
        id: agent.id,
        name: agent.name,
        kind: 'acp',
        adapter: 'acp',
        modelOwner: 'external',
        authOwner: 'external',
        permissionOwner: 'external',
        sessionOwner: 'external',
        status: agent.status ?? 'available',
        capabilities: acpCapabilities,
        description: 'ACP agent selected as the Chat Panel runtime.',
        sourceAgentId: agent.id,
        canonicalAgentId: agent.id,
        binaryPath: agent.binaryPath,
        ...(agent.resolvedCommand ? { resolvedCommand: agent.resolvedCommand } : {}),
        availability: {
          checkedAt: input.checkedAt,
          sources: agent.status && agent.status !== 'available' ? ['acp-detect', 'native-health'] : ['acp-detect'],
          ...(agent.reason ? { reason: agent.reason } : {}),
        },
      })),
  ];

  return { runtimes, installed, notInstalled };
}

function buildAcpScopedPayload(input: {
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
  const runtimes = installed.map((agent): AgentRuntimeDescriptor => ({
    id: agent.id,
    name: agent.name,
    kind: 'acp',
    adapter: 'acp',
    modelOwner: 'external',
    authOwner: 'external',
    permissionOwner: 'external',
    sessionOwner: 'external',
    status: agent.status ?? 'available',
    capabilities: acpCapabilities,
    description: 'ACP agent selected as the Chat Panel runtime.',
    sourceAgentId: agent.id,
    canonicalAgentId: agent.id,
    binaryPath: agent.binaryPath,
    ...(agent.resolvedCommand ? { resolvedCommand: agent.resolvedCommand } : {}),
    availability: {
      checkedAt: input.checkedAt,
      sources: agent.status && agent.status !== 'available' ? ['acp-detect', 'native-health'] : ['acp-detect'],
      ...(agent.reason ? { reason: agent.reason } : {}),
    },
  }));

  return { runtimes, installed, notInstalled };
}

async function checkProcessVersion(command: string, args: string[], timeoutMs: number): Promise<NativeRuntimeHealthResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let done = false;

    const finish = (result: NativeRuntimeHealthResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!child.killed) child.kill();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ status: 'error', reason: `${command} health check timed out after ${timeoutMs}ms.` });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => finish(classifyRuntimeFailure(error.message)));
    child.once('exit', (code) => {
      if (code === 0) {
        finish({ status: 'available' });
        return;
      }
      finish(classifyRuntimeFailure((stderr || stdout || `${command} exited with code ${code ?? 'unknown'}`).trim()));
    });
  });
}

async function checkCodexCliRuntime(command: string, timeoutMs: number): Promise<NativeRuntimeHealthResult> {
  const appServerHelp = await checkProcessVersion(command, ['app-server', '--help'], timeoutMs);
  if (appServerHelp.status !== 'available') return appServerHelp;

  const providerEnvironment = checkCodexProviderEnvironment();
  if (providerEnvironment.status !== 'available') return providerEnvironment;

  const loginStatus = await checkProcessVersion(command, ['login', 'status'], timeoutMs);
  return mergeCodexProviderAndLoginHealth(providerEnvironment, loginStatus);
}

export function mergeCodexProviderAndLoginHealth(
  providerEnvironment: NativeRuntimeHealthResult,
  loginStatus: NativeRuntimeHealthResult,
): NativeRuntimeHealthResult {
  if (providerEnvironment.status !== 'available') return providerEnvironment;
  if (loginStatus.status === 'available') return providerEnvironment;

  const hints = [
    ...(providerEnvironment.diagnosticHints ?? []),
    'Codex app-server is available. If this Codex profile uses account login, run "codex login status" from the same environment that starts MindOS.',
    ...(loginStatus.reason ? [`codex login status returned: ${loginStatus.reason}`] : []),
  ];
  return {
    status: 'available',
    diagnosticHints: hints,
  };
}

export function checkCodexProviderEnvironment(input: {
  env?: NodeJS.ProcessEnv;
  configText?: string;
  configPath?: string;
  readShellEnvValue?: CodexShellEnvValueReader;
} = {}): NativeRuntimeHealthResult {
  const env = input.env ?? process.env;
  const resolution = resolveCodexProviderEnvironment({
    env,
    configText: input.configText,
    configPath: input.configPath,
    readShellEnvValue: input.readShellEnvValue,
  });
  if (!resolution.envKey) return { status: 'available' };

  if (resolution.value) {
    return {
      status: 'available',
      ...(resolution.source === 'login-shell'
        ? { diagnosticHints: [`Codex provider environment key ${resolution.envKey} was found through MindOS runtime environment fallback and will be injected only into Codex app-server.`] }
        : {}),
    };
  }
  const configText = input.configText ?? readCodexConfigText(input.configPath, env);
  const provider = configText ? extractTomlStringValue(configText, 'model_provider') : undefined;

  return {
    status: 'signed-out',
    reason: provider
      ? `Codex model provider "${provider}" requires ${resolution.envKey}, but MindOS cannot see that environment variable in the app process, OS user environment, or login shell. Export ${resolution.envKey} in your shell profile or OS user environment before starting MindOS, or switch Codex to a provider that does not require it.`
      : `Codex requires ${resolution.envKey}, but MindOS cannot see that environment variable in the app process, OS user environment, or login shell.`,
  };
}

function extractTomlStringValue(text: string, key: string): string | undefined {
  const escapedKey = escapeRegExp(key);
  const match = text.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*"([^"]*)"\\s*$`, 'm'));
  return match?.[1]?.trim() || undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function defaultCheckNativeRuntimeHealth(input: NativeRuntimeHealthInput): Promise<NativeRuntimeHealthResult> {
  const timeoutMs = input.timeoutMs ?? NATIVE_HEALTH_TIMEOUT_MS;
  if (input.runtime === 'codex') {
    return checkCodexCliRuntime(input.agent.binaryPath, timeoutMs);
  }
  return checkClaudeRuntimeHealth({ binaryPath: input.agent.binaryPath, timeoutMs });
}

export async function checkClaudeRuntimeHealth(input: {
  binaryPath: string;
  timeoutMs?: number;
  importSdk?: () => Promise<unknown>;
  resolveSdkNativeBinary?: () => ClaudeCodeSdkNativeBinaryResolution;
  checkCliVersion?: (binaryPath: string, timeoutMs: number) => Promise<NativeRuntimeHealthResult>;
}): Promise<NativeRuntimeHealthResult> {
  const timeoutMs = input.timeoutMs ?? NATIVE_HEALTH_TIMEOUT_MS;
  const binaryPath = input.binaryPath;
  const importSdk = input.importSdk ?? (() => import('@anthropic-ai/claude-agent-sdk'));
  const resolveSdkNativeBinary = input.resolveSdkNativeBinary ?? resolveClaudeCodeSdkNativeBinaryPath;
  const checkCliVersion = input.checkCliVersion ?? ((path, ms) => checkProcessVersion(path, ['--version'], ms));
  const hasNativeCliPath = !binaryPath.startsWith('sdk:');

  try {
    await withTimeout(
      importSdk(),
      timeoutMs,
      `Claude Agent SDK health check timed out after ${timeoutMs}ms.`,
    );
  } catch (error) {
    if (hasNativeCliPath) {
      const fallback = await checkCliVersion(binaryPath, timeoutMs);
      return {
        ...fallback,
        diagnosticHints: [
          ...(fallback.diagnosticHints ?? []),
          `Claude Agent SDK is unavailable; MindOS will use CLI fallback. ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
    throw error;
  }

  const sdkBinary = resolveSdkNativeBinary();
  if (sdkBinary.path) {
    return {
      status: 'available',
      diagnosticHints: [
        hasNativeCliPath
          ? `Claude Agent SDK native binary is available. Claude CLI was also detected at ${binaryPath}; MindOS can pass it to the SDK if needed.`
          : 'Claude Agent SDK native binary is available; a global claude command is optional.',
      ],
    };
  }

  if (hasNativeCliPath) {
    const fallback = await checkCliVersion(binaryPath, timeoutMs);
    return {
      ...fallback,
      diagnosticHints: [
        ...(fallback.diagnosticHints ?? []),
        `Claude Agent SDK is installed but its native binary is unavailable; MindOS will pass the detected Claude CLI path to the SDK and can fall back to CLI mode. ${sdkBinary.reason ?? ''}`.trim(),
      ],
    };
  }

  return {
    status: 'error',
    reason: sdkBinary.reason
      ?? `Claude Agent SDK native binary for ${sdkBinary.platformKey} was not found, and the global claude command was not detected.`,
    diagnosticHints: [
      'Install Claude Code globally or reinstall @anthropic-ai/claude-agent-sdk with optional dependencies enabled.',
    ],
  };
}

async function applyNativeRuntimeHealth(
  installed: unknown[],
  services: AgentRuntimesServices,
): Promise<unknown[]> {
  const checkNativeRuntimeHealth = services.checkNativeRuntimeHealth ?? defaultCheckNativeRuntimeHealth;
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
        ...(isRecord(raw) ? raw : detected),
        status: health.status,
        ...(health.reason ? { reason: health.reason } : {}),
        ...(health.diagnosticHints ? { diagnosticHints: health.diagnosticHints } : {}),
      };
    } catch (error) {
      const result = classifyRuntimeFailure(error instanceof Error ? error.message : String(error));
      return {
        ...(isRecord(raw) ? raw : detected),
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
      };
    }
  }));
  return enriched;
}

async function detectNativeRuntimeDefinition(
  candidate: typeof nativeRuntimeDefinitions[number],
  services: AgentRuntimesServices,
): Promise<DetectedRuntimeAgent | MissingRuntimeAgent> {
  const checkNativeRuntimeHealth = services.checkNativeRuntimeHealth ?? defaultCheckNativeRuntimeHealth;
  const resolveRuntimeCommand = services.resolveRuntimeCommand ?? resolveCommandPath;
  if (candidate.runtime === 'claude') {
    return detectClaudeNativeRuntimeDefinition(candidate, services);
  }
  const binaryPath = await resolveRuntimeCommand(candidate.command);
  if (!binaryPath) {
    return {
      id: candidate.id,
      name: candidate.name,
      installCmd: candidate.installCmd,
      packageName: candidate.installCmd.match(/npm install -g (.+)/)?.[1],
      status: 'missing',
      reason: `${candidate.name} executable was not detected.`,
    };
  }
  try {
    const health = await checkNativeRuntimeHealth({
      runtime: candidate.runtime,
      agent: { id: candidate.id, name: candidate.name, binaryPath },
      timeoutMs: NATIVE_HEALTH_TIMEOUT_MS,
    });
    return {
      id: candidate.id,
      name: candidate.name,
      binaryPath,
      resolvedCommand: { cmd: candidate.command, args: [], source: 'descriptor' },
      status: health.status,
      ...(health.reason ? { reason: health.reason } : {}),
      ...(health.diagnosticHints ? { diagnosticHints: health.diagnosticHints } : {}),
    };
  } catch (error) {
    const result = classifyRuntimeFailure(error instanceof Error ? error.message : String(error));
    return {
      id: candidate.id,
      name: candidate.name,
      binaryPath,
      resolvedCommand: { cmd: candidate.command, args: [], source: 'descriptor' },
      status: result.status,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  }
}

async function detectClaudeNativeRuntimeDefinition(
  candidate: typeof nativeRuntimeDefinitions[number],
  services: AgentRuntimesServices,
): Promise<DetectedRuntimeAgent | MissingRuntimeAgent> {
  const checkNativeRuntimeHealth = services.checkNativeRuntimeHealth ?? defaultCheckNativeRuntimeHealth;
  const resolveRuntimeCommand = services.resolveRuntimeCommand ?? resolveCommandPath;
  const cliPathPromise = resolveRuntimeCommand(candidate.command).catch(() => null);
  const quickCliPath = await Promise.race([
    cliPathPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), CLAUDE_CLI_PATH_GRACE_MS)),
  ]);
  const sdkHealthBinaryPath = quickCliPath ?? CLAUDE_SDK_BINARY_PATH;

  try {
    const health = await checkNativeRuntimeHealth({
      runtime: candidate.runtime,
      agent: { id: candidate.id, name: candidate.name, binaryPath: sdkHealthBinaryPath },
      timeoutMs: NATIVE_HEALTH_TIMEOUT_MS,
    });
    if (health.status !== 'available' && !quickCliPath) {
      const cliPath = await cliPathPromise;
      if (cliPath) {
        const fallbackHealth = await checkNativeRuntimeHealth({
          runtime: candidate.runtime,
          agent: { id: candidate.id, name: candidate.name, binaryPath: cliPath },
          timeoutMs: NATIVE_HEALTH_TIMEOUT_MS,
        });
        return {
          id: candidate.id,
          name: candidate.name,
          binaryPath: cliPath,
          resolvedCommand: { cmd: candidate.command, args: [], source: 'descriptor' },
          status: fallbackHealth.status,
          ...(fallbackHealth.reason ? { reason: fallbackHealth.reason } : {}),
          diagnosticHints: fallbackHealth.diagnosticHints?.length
            ? fallbackHealth.diagnosticHints
            : [`Claude Agent SDK native binary is unavailable; MindOS will use the detected Claude CLI at ${cliPath}. ${health.reason ?? ''}`.trim()],
        };
      }
    }
    return {
      id: candidate.id,
      name: candidate.name,
      binaryPath: sdkHealthBinaryPath,
      ...(quickCliPath ? { resolvedCommand: { cmd: candidate.command, args: [], source: 'descriptor' as const } } : {}),
      status: health.status,
      ...(health.reason ? { reason: health.reason } : {}),
      diagnosticHints: [
        ...(health.diagnosticHints ?? []),
        ...(quickCliPath
          ? [`Claude CLI was also detected at ${quickCliPath}; MindOS uses Claude Agent SDK first and falls back to CLI if needed.`]
          : []),
      ],
    };
  } catch (error) {
    const sdkFailure = classifyRuntimeFailure(error instanceof Error ? error.message : String(error));
    const cliPath = await cliPathPromise;
    if (!cliPath) {
      return {
        id: candidate.id,
        name: candidate.name,
        installCmd: candidate.installCmd,
        packageName: candidate.installCmd.match(/npm install -g (.+)/)?.[1],
        status: 'error',
        reason: `Claude Agent SDK is unavailable and the global claude command was not detected. ${sdkFailure.reason ?? ''}`.trim(),
      };
    }
    try {
      const health = await checkNativeRuntimeHealth({
        runtime: candidate.runtime,
        agent: { id: candidate.id, name: candidate.name, binaryPath: cliPath },
        timeoutMs: NATIVE_HEALTH_TIMEOUT_MS,
      });
      return {
        id: candidate.id,
        name: candidate.name,
        binaryPath: cliPath,
        resolvedCommand: { cmd: candidate.command, args: [], source: 'descriptor' },
        status: health.status,
        ...(health.reason ? { reason: health.reason } : {}),
        diagnosticHints: [
          ...(health.diagnosticHints ?? []),
          `Claude Agent SDK is unavailable; MindOS will use CLI fallback. ${sdkFailure.reason ?? ''}`.trim(),
        ],
      };
    } catch (cliError) {
      const cliFailure = classifyRuntimeFailure(cliError instanceof Error ? cliError.message : String(cliError));
      return {
        id: candidate.id,
        name: candidate.name,
        binaryPath: cliPath,
        resolvedCommand: { cmd: candidate.command, args: [], source: 'descriptor' },
        status: cliFailure.status,
        ...(cliFailure.reason ? { reason: cliFailure.reason } : {}),
        diagnosticHints: [
          `Claude Agent SDK is unavailable. ${sdkFailure.reason ?? ''}`.trim(),
        ],
      };
    }
  }
}

async function detectNativeRuntimes(
  services: AgentRuntimesServices,
): Promise<{ installed: DetectedRuntimeAgent[]; notInstalled: MissingRuntimeAgent[] }> {
  const results = await Promise.all(nativeRuntimeDefinitions.map((candidate) => detectNativeRuntimeDefinition(candidate, services)));

  return {
    installed: results.filter((agent): agent is DetectedRuntimeAgent => 'binaryPath' in agent),
    notInstalled: results.filter((agent): agent is MissingRuntimeAgent => 'installCmd' in agent),
  };
}

function isNativeRuntimeId(value: string | null): value is NativeRuntimeId {
  return value === 'codex' || value === 'claude';
}

async function detectSingleNativeRuntime(
  runtime: NativeRuntimeId,
  services: AgentRuntimesServices,
): Promise<AgentRuntimeDescriptor> {
  const candidate = nativeRuntimeDefinitions.find((definition) => definition.runtime === runtime);
  if (!candidate) throw new Error(`Unsupported native runtime: ${runtime}`);
  const result = await detectNativeRuntimeDefinition(candidate, services);
  const checkedAt = new Date(services.now?.() ?? Date.now()).toISOString();
  return nativeDescriptor({
    id: runtime,
    name: candidate.name,
    checkedAt,
    ...('binaryPath' in result ? { source: result } : { missing: result }),
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function handleAgentRuntimesGet(
  searchParams: URLSearchParams,
  services: AgentRuntimesServices = {},
): Promise<MindosServerResponse<AgentRuntimesPayload | AgentRuntimePayload | { error: string }>> {
  try {
    const scope = searchParams.get('scope');
    if (scope && scope !== 'acp') {
      return json({ error: `Unsupported scope: ${scope}` }, { status: 400 });
    }

    const runtime = searchParams.get('runtime');
    if (runtime) {
      if (!isNativeRuntimeId(runtime)) {
        return json({ error: `Unsupported runtime: ${runtime}` }, { status: 400 });
      }
      const descriptor = await detectSingleNativeRuntime(runtime, services);
      return json(
        { runtime: descriptor },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const detectLocalAcpAgents = services.detectLocalAcpAgents ?? defaultDetectLocalAcpAgents;
    if (scope === 'acp') {
      const acpDetection = await withTimeout(
        detectLocalAcpAgents({ overrides: services.readSettings?.().acpAgents }),
        RUNTIME_DETECTION_TIMEOUT_MS,
        `Agent runtime detection timed out after ${RUNTIME_DETECTION_TIMEOUT_MS}ms.`,
      );
      return json(buildAcpScopedPayload({
        installed: Array.isArray(acpDetection.installed) ? acpDetection.installed : [],
        notInstalled: Array.isArray(acpDetection.notInstalled) ? acpDetection.notInstalled : [],
        checkedAt: new Date(services.now?.() ?? Date.now()).toISOString(),
      }), { headers: searchParams.get('force') === '1' ? { 'Cache-Control': 'no-store' } : privateCacheHeaders(1800) });
    }

    const nativeDetectionPromise = detectNativeRuntimes(services);
    const acpDetectionPromise = (async (): Promise<{ installed: unknown[]; notInstalled: unknown[] }> => {
      try {
        return await withTimeout(
          detectLocalAcpAgents({ overrides: services.readSettings?.().acpAgents }),
          RUNTIME_DETECTION_TIMEOUT_MS,
          `Agent runtime detection timed out after ${RUNTIME_DETECTION_TIMEOUT_MS}ms.`,
        );
      } catch {
        return { installed: [], notInstalled: [] };
      }
    })();

    const [nativeDetection, acpDetection] = await Promise.all([nativeDetectionPromise, acpDetectionPromise]);
    const acpInstalled = Array.isArray(acpDetection.installed) ? acpDetection.installed : [];
    const acpNotInstalled = Array.isArray(acpDetection.notInstalled) ? acpDetection.notInstalled : [];
    const acpRuntimeInstalled = acpInstalled.filter((agent) => {
      const normalized = normalizeInstalled(agent);
      return !normalized || (!isCodexAgent(normalized) && !isClaudeAgent(normalized));
    });
    const acpRuntimeNotInstalled = acpNotInstalled.filter((agent) => {
      const normalized = normalizeMissing(agent);
      return !normalized || (!isCodexAgent(normalized) && !isClaudeAgent(normalized));
    });
    const installed = await applyNativeRuntimeHealth([...nativeDetection.installed, ...acpRuntimeInstalled], services);
    const payload = buildAgentRuntimesPayload({
      installed,
      notInstalled: [...nativeDetection.notInstalled, ...acpRuntimeNotInstalled],
      checkedAt: new Date(services.now?.() ?? Date.now()).toISOString(),
    });
    return json({
      ...payload,
      installed: acpInstalled.map(normalizeInstalled).filter((agent): agent is DetectedRuntimeAgent => !!agent),
      notInstalled: acpNotInstalled.map(normalizeMissing).filter((agent): agent is MissingRuntimeAgent => !!agent),
    }, { headers: searchParams.get('force') === '1' ? { 'Cache-Control': 'no-store' } : privateCacheHeaders(1800) });
  } catch (error) {
    return errorResponse(error);
  }
}
