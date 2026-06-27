import {
  detectLocalAcpAgents as defaultDetectLocalAcpAgents,
  findUserOverride,
  resolveCommandPath,
  resolveCommandPathCandidates,
} from '../../protocols/acp/index.js';
import {
  readCodexConfigText,
  resolveCodexProviderEnvironment,
  type CodexShellEnvValueReader,
} from '../../agent/runtime/codex-env.js';
import {
  buildAgentRuntimeEnv,
} from '../../agent/runtime/runtime-env.js';
import {
  type ClaudeCodeSdkModule,
} from '../../agent/runtime/claude-code-sdk.js';
import {
  compactRuntimeFailureMessage,
} from '../../agent/runtime/runtime-errors.js';
import {
  NATIVE_HEALTH_TIMEOUT_MS,
  RUNTIME_DETECTION_TIMEOUT_MS,
  applyNativeRuntimeHealth,
  buildAcpScopedPayload,
  buildAgentRuntimesPayload,
  nativeRuntimeDefinitions,
  type AgentRuntimeDescriptor,
  type AgentRuntimePayload,
  type AgentRuntimesPayload,
  type AgentRuntimesSettings,
  type AgentRuntimesServices,
  type DetectedRuntimeAgent,
  type MissingRuntimeAgent,
  type NativeRuntimeHealthInput,
  type NativeRuntimeHealthResult,
  type NativeRuntimeId,
} from '../../agent/runtime/registry.js';
import {
  attachRuntimeDiagnostics,
  buildSingleRuntimeCatalogPayload,
} from '../../agent/runtime/catalog.js';
import {
  classifyRuntimeFailure,
  isClaudeAgent,
  isCodexAgent,
  isNativeRuntimeId,
  normalizeInstalled,
  normalizeMissing,
} from '../../agent/runtime/detection.js';
import {
  nativeDescriptor,
} from '../../agent/runtime/descriptors.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { errorResponse, json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export {
  buildAgentRuntimesPayload,
};

export type {
  AgentRuntimeAdapter,
  AgentRuntimeAdapterCommandDiscovery,
  AgentRuntimeAdapterCommandSource,
  AgentRuntimeAdapterConfigurationOwner,
  AgentRuntimeAdapterConnectionKind,
  AgentRuntimeAdapterContract,
  AgentRuntimeAdapterDeclaredCommand,
  AgentRuntimeAdapterHealthMode,
  AgentRuntimeAdapterMetadata,
  AgentRuntimeBridge,
  AgentRuntimeCapabilities,
  AgentRuntimeCategory,
  AgentRuntimeCompatibilityAssessment,
  AgentRuntimeCompatibilityLevel,
  AgentRuntimeCompatibilityOwner,
  AgentRuntimeCompatibilityProfile,
  AgentRuntimeCompatibilityRequirement,
  AgentRuntimeCompatibilityRequirementStatus,
  AgentRuntimeCompatibilityScenario,
  AgentRuntimeCoordinationRole,
  AgentRuntimeDescriptor,
  AgentRuntimeHarnessCapabilities,
  AgentRuntimeKind,
  AgentRuntimeLifecycle,
  AgentRuntimeLifecycleSource,
  AgentRuntimeLifecycleStage,
  AgentRuntimeLifecycleStageDescriptor,
  AgentRuntimeLifecycleSupport,
  AgentRuntimeOwner,
  AgentRuntimePayload,
  AgentRuntimeRemoteMode,
  AgentRuntimeStatus,
  AgentRuntimeUnattendedSupport,
  AgentRuntimesPayload,
  AgentRuntimesServices,
  AgentRuntimesSettings,
  DetectedRuntimeAgent,
  MissingRuntimeAgent,
  NativeRuntimeHealthInput,
  NativeRuntimeHealthResult,
} from '../../agent/runtime/registry.js';

async function checkProcessVersion(
  command: string,
  args: string[],
  timeoutMs: number,
  runtime?: NativeRuntimeId,
  env?: NodeJS.ProcessEnv,
): Promise<NativeRuntimeHealthResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env ? { env } : {}),
    });
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
    child.once('error', (error) => finish(classifyRuntimeFailure(error.message, runtime)));
    child.once('exit', (code) => {
      if (code === 0) {
        finish({ status: 'available' });
        return;
      }
      finish(classifyRuntimeFailure((stderr || stdout || `${command} exited with code ${code ?? 'unknown'}`).trim(), runtime));
    });
  });
}

async function checkCodexCliRuntime(command: string, timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<NativeRuntimeHealthResult> {
  const appServerHelp = await checkProcessVersion(command, ['app-server', '--help'], timeoutMs, 'codex', env);
  if (appServerHelp.status !== 'available') return appServerHelp;

  const providerEnvironment = checkCodexProviderEnvironment({ env });
  if (providerEnvironment.status !== 'available') return providerEnvironment;

  const loginStatus = await checkProcessVersion(command, ['login', 'status'], timeoutMs, 'codex', env);
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

function addUniqueRuntimeCommandCandidate(
  candidates: string[],
  candidate: string | null | undefined,
  options: { requireExistingPath?: boolean } = {},
): void {
  const trimmed = candidate?.trim();
  if (!trimmed) return;
  if (options.requireExistingPath !== false) {
    try {
      if (!existsSync(trimmed)) return;
    } catch {
      return;
    }
  }
  if (!candidates.includes(trimmed)) candidates.push(trimmed);
}

function addCodexPlatformFallbackCandidates(candidates: string[]): void {
  if (process.platform === 'darwin') {
    addUniqueRuntimeCommandCandidate(candidates, '/Applications/Codex.app/Contents/Resources/codex');
  }
}

function addCommandCandidatesFromEnvPath(
  candidates: string[],
  command: string,
  env: NodeJS.ProcessEnv | undefined,
): void {
  const pathValue = env?.PATH ?? env?.Path ?? env?.path;
  if (!pathValue) return;
  const extensions = process.platform === 'win32'
    ? (env?.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of pathValue.split(delimiter)) {
    const trimmedDir = dir.trim();
    if (!trimmedDir) continue;
    for (const extension of extensions) {
      addUniqueRuntimeCommandCandidate(candidates, join(trimmedDir, `${command}${extension}`));
    }
  }
}

type CodexRuntimeCommandPlan = {
  candidates: string[];
  explicit: boolean;
  env?: NodeJS.ProcessEnv;
};

function resolveCodexRuntimeUserOverride(settings: AgentRuntimesSettings | undefined) {
  return findUserOverride('codex-acp', settings?.acpAgents)
    ?? findUserOverride('codex', settings?.acpAgents);
}

function buildCodexRuntimeEnv(
  settings: AgentRuntimesSettings | undefined,
  overrideEnv: Record<string, string> = {},
): NodeJS.ProcessEnv | undefined {
  if (!settings) return undefined;
  const hasOverrideEnv = Object.keys(overrideEnv).length > 0;
  const hasConfiguredRuntimeEnv = (settings.agentRuntimeEnv?.keys?.length ?? 0) > 0;
  if (!hasOverrideEnv && !hasConfiguredRuntimeEnv) return undefined;
  return buildAgentRuntimeEnv({
    settings: settings.agentRuntimeEnv,
    overrideEnv,
  }).env;
}

async function resolveCodexRuntimeCommandPlan(
  services: Pick<AgentRuntimesServices, 'readSettings' | 'resolveRuntimeCommand' | 'resolveRuntimeCommandCandidates'> = {},
): Promise<CodexRuntimeCommandPlan> {
  const candidates: string[] = [];
  const resolveRuntimeCommand = services.resolveRuntimeCommand ?? resolveCommandPath;
  const settings = services.readSettings?.();
  const override = resolveCodexRuntimeUserOverride(settings);
  const env = buildCodexRuntimeEnv(settings, override?.env);
  const includePlatformFallback = !services.resolveRuntimeCommand || Boolean(services.resolveRuntimeCommandCandidates);
  if (override?.command) {
    addUniqueRuntimeCommandCandidate(candidates, override.command, { requireExistingPath: false });
    return { candidates, explicit: true, env };
  }

  addCommandCandidatesFromEnvPath(candidates, 'codex', env);

  if (services.resolveRuntimeCommandCandidates) {
    for (const candidate of await services.resolveRuntimeCommandCandidates('codex')) {
      addUniqueRuntimeCommandCandidate(candidates, candidate, { requireExistingPath: false });
    }
    addUniqueRuntimeCommandCandidate(candidates, await resolveRuntimeCommand('codex'), { requireExistingPath: false });
  } else if (services.resolveRuntimeCommand) {
    addUniqueRuntimeCommandCandidate(candidates, await resolveRuntimeCommand('codex'), { requireExistingPath: false });
  } else {
    for (const candidate of await resolveCommandPathCandidates('codex')) {
      addUniqueRuntimeCommandCandidate(candidates, candidate, { requireExistingPath: false });
    }
    addUniqueRuntimeCommandCandidate(candidates, await resolveRuntimeCommand('codex'), { requireExistingPath: false });
  }
  if (includePlatformFallback) addCodexPlatformFallbackCandidates(candidates);
  return { candidates, explicit: false, env };
}

export async function resolveCodexRuntimeCommandCandidates(
  services: Pick<AgentRuntimesServices, 'readSettings' | 'resolveRuntimeCommand' | 'resolveRuntimeCommandCandidates'> = {},
): Promise<string[]> {
  return (await resolveCodexRuntimeCommandPlan(services)).candidates;
}

export async function selectCodexRuntimeCandidate(input: {
  services?: Pick<AgentRuntimesServices, 'readSettings' | 'resolveRuntimeCommand' | 'resolveRuntimeCommandCandidates'>;
  checkCandidate(binaryPath: string, env?: NodeJS.ProcessEnv): Promise<NativeRuntimeHealthResult>;
}): Promise<{ binaryPath: string; health: NativeRuntimeHealthResult; env?: NodeJS.ProcessEnv } | null> {
  const plan = await resolveCodexRuntimeCommandPlan(input.services);
  let firstFailure: { binaryPath: string; health: NativeRuntimeHealthResult } | null = null;

  for (const binaryPath of plan.candidates) {
    const health = await input.checkCandidate(binaryPath, plan.env);
    if (health.status === 'available') {
      if (!firstFailure) return { binaryPath, health, ...(plan.env ? { env: plan.env } : {}) };
      return {
        binaryPath,
        health: {
          ...health,
          diagnosticHints: [
            `MindOS skipped an unhealthy Codex candidate at ${firstFailure.binaryPath}: ${compactRuntimeFailureMessage(firstFailure.health.reason ?? 'Codex candidate failed.', { runtime: 'codex' })}`,
            ...(health.diagnosticHints ?? []),
          ],
        },
        ...(plan.env ? { env: plan.env } : {}),
      };
    }
    firstFailure ??= { binaryPath, health };
    if (plan.explicit || health.status !== 'error') break;
  }

  return firstFailure;
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
    return checkCodexCliRuntime(input.agent.binaryPath, timeoutMs, input.env);
  }
  return checkClaudeRuntimeHealth({ binaryPath: input.agent.binaryPath, timeoutMs });
}

export async function checkClaudeRuntimeHealth(input: {
  binaryPath: string;
  timeoutMs?: number;
  importSdk?: () => Promise<unknown>;
  checkCliVersion?: (binaryPath: string, timeoutMs: number) => Promise<NativeRuntimeHealthResult>;
}): Promise<NativeRuntimeHealthResult> {
  const timeoutMs = input.timeoutMs ?? NATIVE_HEALTH_TIMEOUT_MS;
  const binaryPath = input.binaryPath;
  const importSdk = input.importSdk ?? (() => import('@anthropic-ai/claude-agent-sdk'));
  const checkCliVersion = input.checkCliVersion ?? ((path, ms) => checkProcessVersion(path, ['--version'], ms, 'claude'));

  if (!binaryPath.trim() || binaryPath.startsWith('sdk:')) {
    return {
      status: 'error',
      reason: 'Claude Code requires a local claude executable on the MindOS server PATH. MindOS does not bundle the Claude Agent SDK native runtime.',
      diagnosticHints: [
        'Install Claude Code locally and restart MindOS so the server process can resolve the claude command.',
      ],
    };
  }

  const cliHealth = await checkCliVersion(binaryPath, timeoutMs);
  if (cliHealth.status !== 'available') return cliHealth;

  try {
    const sdk = await withTimeout(
      importSdk(),
      timeoutMs,
      `Claude Agent SDK health check timed out after ${timeoutMs}ms.`,
    ) as Partial<ClaudeCodeSdkModule>;
    if (typeof sdk.query === 'function') {
      return {
        status: 'available',
        runtimeBridge: {
          kind: 'claude-sdk',
          label: 'SDK bridge active',
        },
        diagnosticHints: [
          ...(cliHealth.diagnosticHints ?? []),
          `Claude Agent SDK bridge is available and will use the local Claude Code CLI at ${binaryPath}.`,
        ],
      };
    }
    return {
      status: 'available',
      runtimeBridge: {
        kind: 'claude-cli',
        label: 'CLI fallback active',
        fallback: true,
        reason: 'Claude Agent SDK bridge did not expose query().',
      },
      diagnosticHints: [
        ...(cliHealth.diagnosticHints ?? []),
        `Claude Code CLI is available at ${binaryPath}; Claude Agent SDK bridge did not expose query(), so MindOS will use CLI fallback.`,
      ],
    };
  } catch (error) {
    const reason = compactRuntimeFailureMessage(error instanceof Error ? error.message : String(error), {
      runtime: 'claude',
      fallback: 'Claude Agent SDK bridge is unavailable.',
    });
    return {
      status: 'available',
      runtimeBridge: {
        kind: 'claude-cli',
        label: 'CLI fallback active',
        fallback: true,
        reason,
      },
      diagnosticHints: [
        ...(cliHealth.diagnosticHints ?? []),
        `Claude Code CLI is available at ${binaryPath}; Claude Agent SDK bridge is unavailable, so MindOS will use CLI fallback. ${reason}`,
      ],
    };
  }
}

async function detectNativeRuntimeDefinition(
  candidate: typeof nativeRuntimeDefinitions[number],
  services: AgentRuntimesServices,
): Promise<DetectedRuntimeAgent | MissingRuntimeAgent> {
  const checkNativeRuntimeHealth = services.checkNativeRuntimeHealth ?? defaultCheckNativeRuntimeHealth;
  const resolveRuntimeCommand = services.resolveRuntimeCommand ?? resolveCommandPath;
  if (candidate.runtime === 'codex') {
    return detectCodexNativeRuntimeDefinition(candidate, services);
  }
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
      ...(health.runtimeBridge ? { runtimeBridge: health.runtimeBridge } : {}),
    };
  } catch (error) {
    const result = classifyRuntimeFailure(error instanceof Error ? error.message : String(error), candidate.runtime);
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

async function detectCodexNativeRuntimeDefinition(
  candidate: typeof nativeRuntimeDefinitions[number],
  services: AgentRuntimesServices,
): Promise<DetectedRuntimeAgent | MissingRuntimeAgent> {
  const checkNativeRuntimeHealth = services.checkNativeRuntimeHealth ?? defaultCheckNativeRuntimeHealth;
  const selected = await selectCodexRuntimeCandidate({
    services,
    checkCandidate: (binaryPath, env) => checkNativeRuntimeHealth({
      runtime: candidate.runtime,
      agent: { id: candidate.id, name: candidate.name, binaryPath },
      timeoutMs: NATIVE_HEALTH_TIMEOUT_MS,
      ...(env ? { env } : {}),
    }),
  });

  if (!selected) {
    return {
      id: candidate.id,
      name: candidate.name,
      installCmd: candidate.installCmd,
      packageName: candidate.installCmd.match(/npm install -g (.+)/)?.[1],
      status: 'missing',
      reason: `${candidate.name} executable was not detected.`,
    };
  }

  return {
    id: candidate.id,
    name: candidate.name,
    binaryPath: selected.binaryPath,
    resolvedCommand: { cmd: candidate.command, args: [], source: 'descriptor' },
    status: selected.health.status,
    ...(selected.health.reason ? { reason: selected.health.reason } : {}),
    ...(selected.health.diagnosticHints ? { diagnosticHints: selected.health.diagnosticHints } : {}),
    ...(selected.health.runtimeBridge ? { runtimeBridge: selected.health.runtimeBridge } : {}),
  };
}

async function detectClaudeNativeRuntimeDefinition(
  candidate: typeof nativeRuntimeDefinitions[number],
  services: AgentRuntimesServices,
): Promise<DetectedRuntimeAgent | MissingRuntimeAgent> {
  const checkNativeRuntimeHealth = services.checkNativeRuntimeHealth ?? defaultCheckNativeRuntimeHealth;
  const resolveRuntimeCommand = services.resolveRuntimeCommand ?? resolveCommandPath;
  const commandResolution = { failureReason: undefined as string | undefined };
  const binaryPath = await withTimeout(
    resolveRuntimeCommand(candidate.command),
    RUNTIME_DETECTION_TIMEOUT_MS,
    `Claude Code executable detection timed out after ${RUNTIME_DETECTION_TIMEOUT_MS}ms.`,
  ).catch((error) => {
    commandResolution.failureReason = error instanceof Error ? error.message : String(error);
    return null;
  });

  if (!binaryPath) {
    const timedOut = commandResolution.failureReason?.includes('timed out after');
    return {
      id: candidate.id,
      name: candidate.name,
      installCmd: candidate.installCmd,
      packageName: candidate.installCmd.match(/npm install -g (.+)/)?.[1],
      status: 'missing',
      reason: timedOut
        ? `${commandResolution.failureReason} MindOS does not bundle the Claude Agent SDK native runtime.`
        : 'Claude Code executable was not detected. MindOS does not bundle the Claude Agent SDK native runtime.',
      diagnosticHints: [
        'Install Claude Code locally or add claude to the PATH used to start MindOS.',
      ],
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
      ...(health.runtimeBridge ? { runtimeBridge: health.runtimeBridge } : {}),
    };
  } catch (error) {
    const result = classifyRuntimeFailure(error instanceof Error ? error.message : String(error), candidate.runtime);
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

async function detectNativeRuntimes(
  services: AgentRuntimesServices,
): Promise<{ installed: DetectedRuntimeAgent[]; notInstalled: MissingRuntimeAgent[] }> {
  const results = await Promise.all(nativeRuntimeDefinitions.map((candidate) => detectNativeRuntimeDefinition(candidate, services)));

  return {
    installed: results.filter((agent): agent is DetectedRuntimeAgent => 'binaryPath' in agent),
    notInstalled: results.filter((agent): agent is MissingRuntimeAgent => 'installCmd' in agent),
  };
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
      const rawDescriptor = await detectSingleNativeRuntime(runtime, services);
      const descriptor = attachRuntimeDiagnostics([rawDescriptor])[0];
      if (!descriptor) {
        return json({ error: `Runtime descriptor unavailable: ${runtime}` }, { status: 500 });
      }
      return json(
        { runtime: descriptor, catalog: buildSingleRuntimeCatalogPayload({ runtime: descriptor }) },
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
    const installed = await applyNativeRuntimeHealth(
      [...nativeDetection.installed, ...acpRuntimeInstalled],
      services,
      defaultCheckNativeRuntimeHealth,
    );
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
