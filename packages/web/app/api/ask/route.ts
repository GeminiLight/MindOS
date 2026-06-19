export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import path from 'path';
import { randomUUID } from 'crypto';
import { getFileContent, getMindRoot, collectAllFiles } from '@/lib/fs';
import { validateFileSize } from '@/lib/api-file-size-validation';
import { truncate } from '@/lib/agent/tools';
import type {
  AgentRuntimeIdentity,
  AskModeApi,
  RuntimeSessionBinding,
  NativeRuntimeOptions,
  NativeRuntimePermissionMode,
  NativeRuntimeEffort,
  SessionContextSelection,
  SessionWorkDir,
} from '@/lib/types';
import { readSettings, readBaseUrlCompat, writeBaseUrlCompat } from '@/lib/settings';
import { checkNativeRuntimeHealth, detectLocalAcpAgents, resolveCommandPath, resolveCommandPathCandidates } from '@/lib/acp/detect-local';
import { findUserOverride } from '@/lib/acp/agent-descriptors';
import { en as i18nEn, zh as i18nZh } from '@/lib/i18n';
import { MindOSError, apiError, ErrorCodes } from '@/lib/errors';
import { performActiveRecall } from '@/lib/agent/active-recall';
import { metrics } from '@/lib/metrics';
import { resolveAskCompatMode } from '@/lib/agent/ask-compat';
import { createSession, promptStream, cancelPrompt, closeSession } from '@/lib/acp/session';
import { getProjectRoot } from '@/lib/project-root';
import type { Message as FrontendMessage } from '@/lib/types';
import {
  MINDOS_SSE_HEADERS,
  encodeMindosSseEvent,
  type MindOSSSEvent,
  createMindosUploadedFileParts,
  dirnameOfMindosPath,
  expandMindosAskAttachedFiles,
  loadMindosAskFileContext,
  normalizeMindosAskStepLimit,
  resolveMindosAgentTimeoutMs,
  runMindosAcpAskSession,
  runMindosNonStreamingFallback,
  runMindosPiAgentAskSession,
} from '@geminilight/mindos/session';
import {
  appendMindosRuntimeAttachmentPathContext,
  buildAgentRuntimeEnv,
  createMindosRuntimeImageAttachments,
  createMindosRuntimeUploadedFileAttachments,
  materializeMindosRuntimeAttachments,
  resolveAgentRuntimeEnvOverlay,
  runMindosAgentRuntimeAskSession,
  type MindosAgentRuntimeSelection,
} from '@geminilight/mindos/agent/runtime';
import {
  handleAgentRuntimesGet,
  type AgentRuntimeDescriptor,
  type AgentRuntimesServices,
} from '@geminilight/mindos/server';
import {
  appendSseEventToAgentRun,
  buildMindosContextPrompt,
  buildMindosSystemPrompt,
  normalizeMindosSelectedSkills,
  type MindosAskInitializationContext,
} from '@geminilight/mindos/agent';
import { renderMindosPiSelectedSkillPrompt } from '@geminilight/mindos/agent/mindos-pi';
import {
  resolveSkillFile,
  resolveSkillReference,
} from '@/lib/agent/skill-resolver';
import { askUserQuestionViaBridge, runWithAskUserQuestionBridge } from '@geminilight/mindos/agent/bridges/user-question-bridge';
import {
  requestRuntimePermissionViaBridge,
  runWithRuntimePermissionBridge,
} from '@geminilight/mindos/agent/bridges/runtime-permission-bridge';
import { compactRuntimeDisplayReason } from '@/lib/agent/runtime-error-display';
import {
  createClaudePermissionPromptConfig,
  resolveRuntimePermissionBaseUrl,
} from '@/lib/agent/claude-permission-prompt';
import {
  completeAgentRun,
  failAgentRun,
  listAgentRuns,
  startAgentRun,
  updateAgentRun,
  type AgentRunRecord,
} from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  getCachedAvailableNativeRuntimeDescriptor,
  rememberAvailableNativeRuntimeDescriptor,
} from '@/lib/agent/native-runtime-descriptor-cache';
import { createMindosAgentPermissionPolicy } from '@geminilight/mindos/agent/tool/permission-policy';
import {
  runWithAgentRunContext,
  setAgentRunContextForResource,
} from '@geminilight/mindos/agent/agent-run-context';
import { toMindosUiAskMessages } from '@/lib/agent/to-agent-messages';
import { isAbortLikeError } from '@geminilight/mindos/agent/ledger/run-cancellation';
import {
  readPersistedAskSession,
  resolveSessionContext,
  SessionContextResolutionError,
} from '@/lib/session-context-server';

const NATIVE_ASK_HEALTH_GATE_TIMEOUT_MS = 3000;

function agentRunErrorStatus(error: unknown, signal?: AbortSignal): 'failed' | 'canceled' | 'timed_out' {
  if (signal?.aborted || isAbortLikeError(error)) return 'canceled';
  return (error as any)?.code === 'TIMEOUT' ? 'timed_out' : 'failed';
}

function sendAgentRunContext(
  send: (event: MindOSSSEvent) => void,
  run: AgentRunRecord,
): void {
  send({
    type: 'agent_run_context',
    rootRunId: run.rootRunId ?? run.id,
    ...(run.chatSessionId ? { chatSessionId: run.chatSessionId } : {}),
    startedAt: run.startedAt,
  } as unknown as MindOSSSEvent);
}

function formatMindosPiExtensionLoadStatus(errors: Array<{ path: string; error: string }> | undefined): string | null {
  if (!errors?.length) return null;
  const names = [...new Set(errors.map((entry) => path.basename(entry.path || 'extension')).filter(Boolean))].slice(0, 5);
  const hasWebAccessError = errors.some((entry) => entry.path.includes('pi-web-access'));
  const suffix = hasWebAccessError
    ? ' pi-web-access is unavailable or incomplete, so web_search/fetch_content may be unavailable.'
    : ' Some extension tools may be unavailable.';
  return `MindOS detected ${errors.length} extension issue${errors.length === 1 ? '' : 's'}${names.length ? ` (${names.join(', ')})` : ''}.${suffix}`;
}

function compactStringEnv(env: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  const compact: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') compact[key] = value;
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function omitEnvKeys(
  env: Record<string, string>,
  reserved: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!(key in reserved)) next[key] = value;
  }
  return next;
}

// generateSkillsXml is in lib/agent/skills-xml.ts (not inline: Next.js route export constraints)

function loadAttachedFileContext(
  attachedFiles: string[] | undefined,
  currentFile: string | undefined,
  mode: string,
): { contextParts: string[]; failedFiles: string[] } {
  return loadMindosAskFileContext(attachedFiles, currentFile, mode, {
    readFile: getFileContent,
    truncate,
    validateFileSize: (filePath, cumulativeSize) => validateFileSize(path.join(getMindRoot(), filePath), cumulativeSize),
    warn: (message: string, error?: unknown) => console.warn(message, error instanceof Error ? error.message : error),
  });
}

/** Expand attachedFiles entries: directory paths (trailing /) become individual file paths. */
function expandAttachedFiles(raw: string[]): string[] {
  return expandMindosAskAttachedFiles(raw, collectAllFiles) ?? raw;
}

function acpAgentFromRuntime(runtime: unknown): { id: string; name: string } | null {
  if (!runtime || typeof runtime !== 'object') return null;
  const record = runtime as Partial<AgentRuntimeIdentity>;
  if (record.kind !== 'acp' || typeof record.id !== 'string' || typeof record.name !== 'string') return null;
  return { id: record.id, name: record.name };
}

function acpAgentFromLegacySelection(agent: unknown): { id: string; name: string } | null {
  if (!agent || typeof agent !== 'object') return null;
  const record = agent as { id?: unknown; name?: unknown };
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return null;
  return { id: record.id, name: record.name };
}

function nativeAgentRuntimeFromSelection(runtime: unknown, binding?: unknown): MindosAgentRuntimeSelection | null {
  if (!runtime || typeof runtime !== 'object') return null;
  const record = runtime as Partial<AgentRuntimeIdentity> & { externalSessionId?: unknown };
  if (record.kind !== 'codex' && record.kind !== 'claude') return null;
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return null;
  const bindingResume = runtimeBindingResumeState(record, binding);
  const hasTypedBinding = !!binding && typeof binding === 'object';
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    ...(bindingResume.externalSessionId ? { externalSessionId: bindingResume.externalSessionId } : {}),
    ...(!hasTypedBinding && !bindingResume.matched && typeof record.externalSessionId === 'string' ? { externalSessionId: record.externalSessionId } : {}),
  };
}

function isMindosRuntimeSelection(runtime: unknown): boolean {
  if (!runtime || typeof runtime !== 'object') return false;
  const record = runtime as Partial<AgentRuntimeIdentity>;
  return record.kind === 'mindos';
}

function normalizeNativeRuntimeOptions(value: unknown): NativeRuntimeOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const permissionMode = record.permissionMode === 'readonly' || record.permissionMode === 'agent'
    ? record.permissionMode as NativeRuntimePermissionMode
    : undefined;
  const reasoningEffort = record.reasoningEffort === 'low'
    || record.reasoningEffort === 'medium'
    || record.reasoningEffort === 'high'
    || record.reasoningEffort === 'xhigh'
    ? record.reasoningEffort as NativeRuntimeEffort
    : undefined;
  const modelOverride = typeof record.modelOverride === 'string' && record.modelOverride.trim()
    ? record.modelOverride.trim()
    : undefined;
  return {
    ...(permissionMode ? { permissionMode } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(modelOverride ? { modelOverride } : {}),
  };
}

function effectiveNativePermissionMode(
  askMode: AskModeApi,
  fallback: NativeRuntimePermissionMode,
  runtimeOptions: NativeRuntimeOptions,
): NativeRuntimePermissionMode {
  if (askMode === 'organize') return 'readonly';
  return runtimeOptions.permissionMode ?? fallback;
}

function normalizeAskModeApiInput(value: unknown): AskModeApi | null {
  if (value === undefined || value === null) return 'agent';
  return value === 'agent' || value === 'organize' ? value : null;
}

function permissionPolicyModeForRequest(
  askMode: AskModeApi,
  runtimeOptions: NativeRuntimeOptions,
): 'readonly' | 'organize' | 'agent' {
  if (askMode === 'organize') return 'organize';
  return runtimeOptions.permissionMode === 'readonly' ? 'readonly' : 'agent';
}

function getLastUserContent(messages: FrontendMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'user' && typeof message.content === 'string') return message.content;
  }
  return '';
}

function getLastUserSkillName(messages: FrontendMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as FrontendMessage & { skillName?: unknown } | undefined;
    if (message?.role !== 'user') continue;
    return typeof message.skillName === 'string' && message.skillName.trim()
      ? message.skillName.trim()
      : undefined;
  }
  return undefined;
}

function getLastUserImages(messages: FrontendMessage[]): unknown[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    return Array.isArray(message.images) ? message.images : [];
  }
  return [];
}

function runtimeBindingResumeState(
  runtime: Partial<AgentRuntimeIdentity>,
  binding: unknown,
): { matched: boolean; externalSessionId: string | null } {
  if (!binding || typeof binding !== 'object') return { matched: false, externalSessionId: null };
  const record = binding as Partial<RuntimeSessionBinding>;
  if (record.runtime !== runtime.kind || record.runtimeId !== runtime.id) return { matched: false, externalSessionId: null };
  if (runtime.kind === 'codex' && record.kind !== 'codex-thread') return { matched: false, externalSessionId: null };
  if (runtime.kind === 'claude' && record.kind !== 'claude-session') return { matched: false, externalSessionId: null };
  if (record.status && record.status !== 'active') return { matched: true, externalSessionId: null };
  return {
    matched: true,
    externalSessionId: typeof record.externalSessionId === 'string' && record.externalSessionId.trim()
      ? record.externalSessionId
      : null,
  };
}

function createAskSseResponse(
  runAgent: (send: (event: MindOSSSEvent) => void) => Promise<void>,
  fallbackErrorMessage: (error: unknown) => string = (error) => (
    error instanceof Error && error.message
      ? error.message
      : 'MindOS ask stream failed unexpectedly.'
  ),
): Response {
  const encoder = new TextEncoder();
  const requestStartTime = Date.now();
  const stream = new ReadableStream({
    start(controller) {
      let streamClosed = false;
      function send(event: MindOSSSEvent) {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(encodeMindosSseEvent(event)));
        } catch {
          streamClosed = true;
        }
      }
      function safeClose() {
        if (streamClosed) return;
        streamClosed = true;
        try { controller.close(); } catch { /* already closed */ }
      }

      runAgent(send).then(() => {
        metrics.recordRequest(Date.now() - requestStartTime);
        safeClose();
      }).catch((err) => {
        metrics.recordRequest(Date.now() - requestStartTime);
        metrics.recordError();
        send({ type: 'error', message: fallbackErrorMessage(err) });
        safeClose();
      });
    },
  });

  return new Response(stream, {
    headers: MINDOS_SSE_HEADERS,
  });
}

function runtimeSelectionWithBinaryPath(
  runtime: MindosAgentRuntimeSelection,
  binaryPath?: string,
): MindosAgentRuntimeSelection {
  return {
    id: runtime.id,
    name: runtime.name,
    kind: runtime.kind,
    ...(binaryPath ? { binaryPath } : {}),
    ...(runtime.externalSessionId ? { externalSessionId: runtime.externalSessionId } : {}),
  };
}

function isNativeRuntimeBinaryPath(binaryPath: string | undefined): binaryPath is string {
  return typeof binaryPath === 'string' && binaryPath.trim().length > 0 && !binaryPath.startsWith('sdk:');
}

function runtimeSelectionWithVerifiedBinaryPath(
  runtime: MindosAgentRuntimeSelection,
  descriptor?: AgentRuntimeDescriptor,
): MindosAgentRuntimeSelection | null {
  const binaryPath = descriptor?.binaryPath;
  if (!isNativeRuntimeBinaryPath(binaryPath)) return null;
  return runtimeSelectionWithBinaryPath(runtime, binaryPath);
}

async function resolveAvailableNativeRuntime(
  runtime: MindosAgentRuntimeSelection,
): Promise<{ runtime: MindosAgentRuntimeSelection; unavailableReason: null } | { runtime: null; unavailableReason: string }> {
  const services: AgentRuntimesServices = {
    readSettings: readSettings as AgentRuntimesServices['readSettings'],
    detectLocalAcpAgents: detectLocalAcpAgents as AgentRuntimesServices['detectLocalAcpAgents'],
    resolveRuntimeCommand: resolveCommandPath as AgentRuntimesServices['resolveRuntimeCommand'],
    resolveRuntimeCommandCandidates: resolveCommandPathCandidates as AgentRuntimesServices['resolveRuntimeCommandCandidates'],
    checkNativeRuntimeHealth: checkNativeRuntimeHealth as AgentRuntimesServices['checkNativeRuntimeHealth'],
  };
  const res = await Promise.race([
    handleAgentRuntimesGet(new URLSearchParams(`runtime=${runtime.kind}&force=1`), services),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), NATIVE_ASK_HEALTH_GATE_TIMEOUT_MS)),
  ]);
  if (!res) {
    const cachedDescriptor = getCachedAvailableNativeRuntimeDescriptor(runtime.kind, runtime.id);
    const cachedRuntime = runtimeSelectionWithVerifiedBinaryPath(runtime, cachedDescriptor ?? undefined);
    if (cachedRuntime) {
      return {
        runtime: cachedRuntime,
        unavailableReason: null,
      };
    }
    return {
      runtime: null,
      unavailableReason: `${runtime.name} is still being verified. Please retry in a moment.`,
    };
  }
  const body = res.body;
  if (res.status !== 200 || !body || !('runtime' in body)) {
    return {
      runtime: null,
      unavailableReason: `Unable to verify ${runtime.name} before starting the turn.`,
    };
  }
  const descriptor = body.runtime;
  if (descriptor.kind !== runtime.kind || descriptor.id !== runtime.id) {
    return {
      runtime: null,
      unavailableReason: `${runtime.name} is not available.`,
    };
  }
  if (descriptor.status === 'available') {
    rememberAvailableNativeRuntimeDescriptor(descriptor);
    const verifiedRuntime = runtimeSelectionWithVerifiedBinaryPath(runtime, descriptor);
    if (!verifiedRuntime) {
      return {
        runtime: null,
        unavailableReason: `${descriptor.name} is unavailable. MindOS could not resolve a local executable path.`,
      };
    }
    return {
      runtime: verifiedRuntime,
      unavailableReason: null,
    };
  }
  const statusText = descriptor.status === 'signed-out'
    ? 'signed out'
    : descriptor.status === 'missing'
      ? 'not installed'
      : 'unavailable';
  const compactReason = descriptor.availability?.reason
    ? compactRuntimeDisplayReason(descriptor.availability.reason, { runtime: descriptor.kind === 'codex' || descriptor.kind === 'claude' ? descriptor.kind : undefined })
    : '';
  return {
    runtime: null,
    unavailableReason: `${descriptor.name} is ${statusText}.${compactReason ? ` ${compactReason}` : ''}`,
  };
}

// SSE event contract and pi-agent event guards → @geminilight/mindos/session

function readKnowledgeFile(filePath: string): { ok: boolean; content: string; truncated: boolean; error?: string } {
  try {
    const raw = getFileContent(filePath);
    if (raw.length > 20_000) {
      return {
        ok: true,
        content: truncate(raw),
        truncated: true,
        error: undefined,
      };
    }
    return { ok: true, content: raw, truncated: false };
  } catch (err) {
    return {
      ok: false,
      content: '',
      truncated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// skillDirCandidates, resolveSkillFile, resolveSkillReference, readAbsoluteFile
// → @/lib/agent/skill-resolver

function dirnameOf(filePath?: string): string | null {
  return dirnameOfMindosPath(filePath);
}

// toPiCustomToolDefinitions adapter removed — KB tools now registered via kb-extension.ts

// reassembleSSE, piMessagesToOpenAI, runNonStreamingFallback
// → @/lib/agent/non-streaming

// ---------------------------------------------------------------------------
// POST /api/ask
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let body: {
    messages: FrontendMessage[];
    currentFile?: string;
    attachedFiles?: string[];
    uploadedFiles?: Array<{
      name: string;
      content: string;
      mimeType?: string;
      size?: number;
      dataBase64?: string;
    }>;
    maxSteps?: number;
    /** Ask prompt mode. Tool permissions are controlled by runtimeOptions.permissionMode. */
    mode?: AskModeApi;
    /** ACP agent selection: if present, route to ACP instead of MindOS */
    selectedAcpAgent?: { id: string; name: string } | null;
    /** Unified runtime selection. ACP values mirror selectedAcpAgent for compatibility. */
    selectedRuntime?: (AgentRuntimeIdentity & { externalSessionId?: string }) | null;
    /** Typed external runtime binding for native Codex/Claude resume. */
    runtimeBinding?: RuntimeSessionBinding | null;
    /** Session-bound execution cwd. */
    workDir?: SessionWorkDir;
    /** Dynamic selected Spaces / Assistants for this turn. */
    contextSelection?: SessionContextSelection;
    /** Per-request provider override from the chat panel capsule */
    providerOverride?: string;
    /** Per-request model override from the inline model picker */
    modelOverride?: string;
    /** Per-request native runtime controls for Codex / Claude Code. */
    runtimeOptions?: NativeRuntimeOptions;
    /** MindOS Chat Panel session id for run ledger correlation. */
    chatSessionId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return apiError(ErrorCodes.INVALID_REQUEST, 'Invalid JSON body', 400);
  }

  const { messages, currentFile, attachedFiles: rawAttached, uploadedFiles } = body;
  const mindosUiMessages = toMindosUiAskMessages(messages);
  const selectedNativeRuntime = nativeAgentRuntimeFromSelection(body.selectedRuntime, body.runtimeBinding);
  const legacySelectedAcpAgent = acpAgentFromLegacySelection(body.selectedAcpAgent);
  const selectedAcpAgent = selectedNativeRuntime || body.selectedRuntime === null || isMindosRuntimeSelection(body.selectedRuntime)
    ? null
    : (acpAgentFromRuntime(body.selectedRuntime) ?? legacySelectedAcpAgent);
  const attachedFiles = Array.isArray(rawAttached) ? expandAttachedFiles(rawAttached) : rawAttached;
  const askMode = normalizeAskModeApiInput(body.mode);
  if (!askMode) {
    return apiError(ErrorCodes.INVALID_REQUEST, 'mode must be agent or organize', 400);
  }
  const nativeRuntimeOptions = normalizeNativeRuntimeOptions(body.runtimeOptions);
  const permissionPolicy = createMindosAgentPermissionPolicy(
    permissionPolicyModeForRequest(askMode, nativeRuntimeOptions),
  );
  const nativePermissionMode = effectiveNativePermissionMode(
    askMode,
    permissionPolicy.runtimePermissionMode,
    nativeRuntimeOptions,
  );
  const chatSessionId = typeof body.chatSessionId === 'string' && body.chatSessionId.trim()
    ? body.chatSessionId.trim()
    : undefined;
  const mindRoot = getMindRoot();
  const projectRoot = getProjectRoot();
  const priorSession = readPersistedAskSession(chatSessionId);
  const priorRuns = chatSessionId
    ? listAgentRuns({ chatSessionId, limit: 20 }).map((run) => ({
      cwd: run.cwd,
      archiveSessionId: run.archive?.sessionId,
      externalSessionId: typeof run.metadata?.externalSessionId === 'string'
        ? run.metadata.externalSessionId
        : undefined,
    }))
    : [];
  let sessionContext: ReturnType<typeof resolveSessionContext>;
  try {
    sessionContext = resolveSessionContext({
      requestedWorkDir: body.workDir,
      requestedSelection: body.contextSelection,
      mindRoot,
      projectRoot,
      priorSession,
      requestRuntimeBinding: body.runtimeBinding,
      requestExternalSessionId: selectedNativeRuntime?.externalSessionId,
      priorRuns,
      env: process.env,
    });
  } catch (error) {
    if (error instanceof SessionContextResolutionError) {
      return apiError(ErrorCodes.CONFLICT, error.message, 409, { issueCode: error.code });
    }
    throw error;
  }
  const executionCwd = sessionContext.resolvedWorkDir.path;

  // Diagnostic: log attached files so silent failures are visible
  if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
    console.log(`[ask] mode=${askMode} permission=${permissionPolicy.mode} attachedFiles=${JSON.stringify(attachedFiles)} currentFile=${currentFile ?? 'none'}`);
  }

  // Read agent config from settings
  const serverSettings = readSettings();
  const agentConfig = serverSettings.agent ?? {};
  const nativeRuntimeOverrideEnv = selectedNativeRuntime
    ? findUserOverride(
      selectedNativeRuntime.kind === 'codex' ? 'codex-acp' : 'claude',
      serverSettings.acpAgents,
    )?.env ?? {}
    : {};
  const nativeRuntimeEnv = selectedNativeRuntime
    ? buildAgentRuntimeEnv({
      settings: serverSettings.agentRuntimeEnv,
      overrideEnv: nativeRuntimeOverrideEnv,
    }).env
    : undefined;
  const acpOverrideEnv = selectedAcpAgent
    ? findUserOverride(selectedAcpAgent.id, serverSettings.acpAgents)?.env ?? {}
    : {};
  const acpRuntimeEnvOverlay = selectedAcpAgent
    ? omitEnvKeys(resolveAgentRuntimeEnvOverlay({ settings: serverSettings.agentRuntimeEnv }).overlay, acpOverrideEnv)
    : undefined;
  let verifiedNativeRuntime = selectedNativeRuntime;
  if (selectedNativeRuntime) {
    const { runtime, unavailableReason } = await resolveAvailableNativeRuntime(selectedNativeRuntime);
    if (unavailableReason) {
      return apiError(ErrorCodes.INVALID_REQUEST, unavailableReason, 409);
    }
    verifiedNativeRuntime = runtime;
  }

  // Detect locale from Accept-Language header for i18n status messages
  const acceptLang = req.headers.get('accept-language') ?? '';
  const t = acceptLang.startsWith('zh') ? i18nZh.ask : i18nEn.ask;
  const stepLimit = normalizeMindosAskStepLimit({
    mode: askMode,
    requestedMaxSteps: body.maxSteps,
    agentMaxSteps: agentConfig.maxSteps,
  });
  const enableThinking = agentConfig.enableThinking ?? false;
  const thinkingBudget = agentConfig.thinkingBudget ?? 5000;
  const contextStrategy = agentConfig.contextStrategy ?? 'auto';

  // Uploaded files — shared by all modes
  // These are already truncated client-side (80K limit), so only apply a generous
  // server-side cap to guard against malformed requests.
  const uploadedParts = createMindosUploadedFileParts(uploadedFiles);
  const runtimeAttachments = [
    ...createMindosRuntimeUploadedFileAttachments(uploadedFiles),
    ...createMindosRuntimeImageAttachments(getLastUserImages(messages)),
  ];
  const selectedSkills = normalizeMindosSelectedSkills(undefined, getLastUserSkillName(messages));

  if (verifiedNativeRuntime || selectedAcpAgent) {
    const lastUserContent = getLastUserContent(messages);
    const fileContext = loadAttachedFileContext(attachedFiles, currentFile, 'external');
    const excludePaths = [
      ...(currentFile ? [currentFile] : []),
      ...(Array.isArray(attachedFiles) ? attachedFiles : []),
    ];
    let recalledKnowledge: Array<{ path: string; content: string }> = [];
    const activeRecall = agentConfig.activeRecall ?? {};
    if (activeRecall.enabled !== false && lastUserContent.trim().length > 1) {
      recalledKnowledge = await performActiveRecall(mindRoot, lastUserContent, {
        maxTokens: activeRecall.maxTokens,
        maxFiles: activeRecall.maxFiles,
        minScore: activeRecall.minScore,
        excludePaths,
      });
    }
    const externalPrompt = await buildMindosContextPrompt({
      prompt: lastUserContent,
      mindRoot,
      fileContext,
      uploadedParts,
      recalledKnowledge,
      selectedSkills,
      sessionWorkDir: sessionContext.resolvedWorkDir,
      sessionContextSelection: sessionContext.resolvedSelection,
      sessionContextIssues: sessionContext.issues,
    });

    return createAskSseResponse((send) => runWithAgentRunContext({ chatSessionId }, async () => {
      const nativeRuntime = verifiedNativeRuntime;
      if (nativeRuntime) {
        const runtimeRunId = randomUUID();
        let outputSummary = '';
        const nativeRun = startAgentRun({
          agentKind: 'native-runtime',
          runtimeId: nativeRuntime.id,
          displayName: nativeRuntime.name,
          cwd: executionCwd,
          permissionMode: nativePermissionMode,
          inputSummary: externalPrompt,
          metadata: {
            runtimeKind: nativeRuntime.kind,
            source: 'selected-native-runtime',
            sessionWorkDir: sessionContext.resolvedWorkDir.path,
            sessionSpaces: sessionContext.resolvedSelection.spaces.map((space) => space.path),
            sessionAssistants: sessionContext.resolvedSelection.assistants.map((assistant) => assistant.id),
          },
        });
        const sendWithLedger = (event: MindOSSSEvent) => {
          if (event.type === 'text_delta') outputSummary += event.delta;
          appendSseEventToAgentRun(nativeRun.id, event);
          send(event);
        };
        sendAgentRunContext(send, nativeRun);
        try {
          const result = await runWithAgentRunContext({
            chatSessionId,
            rootRunId: nativeRun.rootRunId ?? nativeRun.id,
            parentRunId: nativeRun.id,
          }, () => (
            runWithRuntimePermissionBridge({
              runId: runtimeRunId,
              send: sendWithLedger,
            }, () => runWithAskUserQuestionBridge({
              runId: runtimeRunId,
              send: (event) => sendWithLedger(event as unknown as MindOSSSEvent),
            }, () => runMindosAgentRuntimeAskSession({
              runtime: nativeRuntime,
              cwd: executionCwd,
              prompt: externalPrompt,
              attachments: runtimeAttachments,
              selectedSkills,
              permissionMode: nativePermissionMode,
              ...(nativeRuntimeOptions.modelOverride ? { modelOverride: nativeRuntimeOptions.modelOverride } : {}),
              ...(nativeRuntimeOptions.reasoningEffort
                ? { reasoningEffort: nativeRuntimeOptions.reasoningEffort }
                : {}),
              timeoutMs: resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS),
              ...(nativeRuntimeEnv ? { runtimeEnv: nativeRuntimeEnv } : {}),
              signal: req.signal,
              send: sendWithLedger,
              services: {
                ...(nativeRuntime.kind === 'claude' ? {
                  createClaudePermissionPrompt: () => createClaudePermissionPromptConfig({
                    runId: runtimeRunId,
                    baseUrl: resolveRuntimePermissionBaseUrl(req),
                  }),
                } : {}),
                requestRuntimePermission: requestRuntimePermissionViaBridge,
                requestUserQuestion: (request, callOptions) => askUserQuestionViaBridge({
                  toolCallId: request.toolCallId,
                  params: { questions: request.questions },
                  signal: callOptions?.signal,
                }),
              },
            }))
          )));
          if (result.error) {
            failAgentRun(nativeRun.id, {
              status: agentRunErrorStatus(result.error, req.signal),
              error: result.error,
              outputSummary,
              ...(result.externalSessionId ? { archive: { sessionId: result.externalSessionId } } : {}),
              metadata: {
                runtimeKind: nativeRuntime.kind,
                ...(result.externalSessionId ? { externalSessionId: result.externalSessionId } : {}),
              },
            });
            return;
          }
          completeAgentRun(nativeRun.id, {
            outputSummary,
            ...(result.externalSessionId ? { archive: { sessionId: result.externalSessionId } } : {}),
            metadata: {
              runtimeKind: nativeRuntime.kind,
              ...(result.externalSessionId ? { externalSessionId: result.externalSessionId } : {}),
            },
          });
        } catch (error) {
          failAgentRun(nativeRun.id, {
            status: agentRunErrorStatus(error, req.signal),
            error,
            outputSummary,
          });
          throw error;
        }
        return;
      }

      if (selectedAcpAgent) {
        const materializedAttachments = await materializeMindosRuntimeAttachments(runtimeAttachments);
        const acpPrompt = appendMindosRuntimeAttachmentPathContext(
          externalPrompt,
          materializedAttachments.attachments,
          { includeImages: true },
        );
        let hasContent = false;
        let outputSummary = '';
        const acpRun = startAgentRun({
          agentKind: 'acp',
          runtimeId: selectedAcpAgent.id,
          displayName: selectedAcpAgent.name,
          cwd: executionCwd,
          permissionMode: permissionPolicy.acpPermissionMode,
          inputSummary: externalPrompt,
          metadata: {
            source: 'selected-acp-runtime',
            phase: 'create_session',
            sessionWorkDir: sessionContext.resolvedWorkDir.path,
            sessionSpaces: sessionContext.resolvedSelection.spaces.map((space) => space.path),
            sessionAssistants: sessionContext.resolvedSelection.assistants.map((assistant) => assistant.id),
          },
        });
        sendAgentRunContext(send, acpRun);
        const acpResult = await runWithAgentRunContext({
          chatSessionId,
          rootRunId: acpRun.rootRunId ?? acpRun.id,
          parentRunId: acpRun.id,
        }, () => (
          runMindosAcpAskSession({
            agentId: selectedAcpAgent.id,
            cwd: executionCwd,
            prompt: acpPrompt,
            signal: req.signal,
            createSession: async (agentId, options) => {
              const optionEnv = compactStringEnv((options as { env?: Record<string, string | undefined> } | undefined)?.env);
              const mergedEnv = compactStringEnv({ ...(acpRuntimeEnvOverlay ?? {}), ...(optionEnv ?? {}) });
              const session = await createSession(agentId, {
                ...options,
                ...(mergedEnv ? { env: mergedEnv } : {}),
                permissionMode: permissionPolicy.acpPermissionMode,
              });
              updateAgentRun(acpRun.id, {
                archive: { sessionId: session.id },
                metadata: {
                  phase: 'prompt',
                  sessionId: session.id,
                },
              });
              return session;
            },
            timeoutMs: resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS),
            hasContent: () => hasContent,
            onVisibleContent: () => { hasContent = true; },
            send: (event) => {
              if (event.type === 'text_delta') outputSummary += event.delta;
              appendSseEventToAgentRun(acpRun.id, event);
              send(event);
            },
            promptStream: async (sessionId, prompt, onUpdate) => {
              await promptStream(sessionId, prompt, onUpdate);
            },
            cancelPrompt,
            closeSession,
            errorMessage: (error) => ((error as any).code === 'TIMEOUT'
              ? t.agentTimeout
              : `ACP Agent Error: ${error.message}`),
          })
        ))
          .catch((error) => {
            failAgentRun(acpRun.id, {
              status: agentRunErrorStatus(error, req.signal),
              error,
              outputSummary,
            });
            throw error;
          })
          .finally(async () => {
            await materializedAttachments.cleanup();
          });
        if (acpResult.error) {
          failAgentRun(acpRun.id, {
            status: agentRunErrorStatus(acpResult.error, req.signal),
            error: acpResult.error,
            outputSummary,
          });
        } else {
          completeAgentRun(acpRun.id, { outputSummary });
        }
      }
    }), (err) => {
      if (err instanceof Error && (err as any).code === 'TIMEOUT') return t.agentTimeout;
      return err instanceof Error ? err.message : String(err);
    });
  }

  let agentInitialization: MindosAskInitializationContext | undefined;
  if (askMode === 'agent') {
    // Agent mode: full prompt assembly
    // Auto-load skill + bootstrap context for each request.
    const isZh = serverSettings.disabledSkills?.includes('mindos') ?? false;
    const skillDirName = isZh ? 'mindos-zh' : 'mindos';
    // Resolve skill file from multiple fallback locations (handles Core Update scenarios)
    const skillInfo = resolveSkillFile(skillDirName, projectRoot, mindRoot);
    const skill = skillInfo.result;
    
    const skillWrite = resolveSkillReference(
      path.join('references', 'write-supplement.md'),
      skillInfo, skillDirName, projectRoot, mindRoot,
    );

    console.log(
      `[ask] SKILL skill=${skill.ok} (${skillInfo.path}), write-supplement=${skillWrite.ok}`
    );

    const userSkillRules = readKnowledgeFile('.mindos/user-preferences.md');

    const targetDir = dirnameOf(currentFile);
    const bootstrap = {
      instruction: readKnowledgeFile('INSTRUCTION.md'),
      config_json: readKnowledgeFile('CONFIG.json'),
      // Lazy-loaded: only read if the file exists and has content.
      // README.md is often empty/boilerplate and wastes tokens.
      index: null as ReturnType<typeof readKnowledgeFile> | null,
      target_readme: null as ReturnType<typeof readKnowledgeFile> | null,
      target_instruction: null as ReturnType<typeof readKnowledgeFile> | null,
      target_config_json: null as ReturnType<typeof readKnowledgeFile> | null,
    };

    // Only load secondary bootstrap files if they have meaningful content.
    // Files with ≤10 chars are typically empty or just a heading — not worth
    // injecting into the prompt (saves ~200-500 tokens per empty file).
    const MIN_USEFUL_CONTENT_LENGTH = 10;

    const indexResult = readKnowledgeFile('README.md');
    if (indexResult.ok && indexResult.content.trim().length > MIN_USEFUL_CONTENT_LENGTH) bootstrap.index = indexResult;

    if (targetDir) {
      const tr = readKnowledgeFile(`${targetDir}/README.md`);
      if (tr.ok && tr.content.trim().length > MIN_USEFUL_CONTENT_LENGTH) bootstrap.target_readme = tr;
      const ti = readKnowledgeFile(`${targetDir}/INSTRUCTION.md`);
      if (ti.ok && ti.content.trim().length > MIN_USEFUL_CONTENT_LENGTH) bootstrap.target_instruction = ti;
      const tc = readKnowledgeFile(`${targetDir}/CONFIG.json`);
      if (tc.ok && tc.content.trim().length > MIN_USEFUL_CONTENT_LENGTH) bootstrap.target_config_json = tc;
    }

    const initFailures: string[] = [];
    const truncationWarnings: string[] = [];
    if (!skill.ok) initFailures.push(`skill.mindos: failed (${skill.error})`);
    if (skill.ok && skill.truncated) truncationWarnings.push('skill.mindos was truncated');
    if (!skillWrite.ok) initFailures.push(`skill.mindos-write-supplement: failed (${skillWrite.error})`);
    if (skillWrite.ok && skillWrite.truncated) truncationWarnings.push('skill.mindos-write-supplement was truncated');
    if (userSkillRules.ok && userSkillRules.truncated) truncationWarnings.push('.mindos/user-preferences.md was truncated');
    if (!bootstrap.instruction.ok) initFailures.push(`bootstrap.instruction: failed (${bootstrap.instruction.error})`);
    if (bootstrap.instruction.ok && bootstrap.instruction.truncated) truncationWarnings.push('bootstrap.instruction was truncated');
    if (bootstrap.index?.ok && bootstrap.index.truncated) truncationWarnings.push('bootstrap.index was truncated');
    if (!bootstrap.config_json.ok) initFailures.push(`bootstrap.config_json: failed (${bootstrap.config_json.error})`);
    if (bootstrap.config_json.ok && bootstrap.config_json.truncated) truncationWarnings.push('bootstrap.config_json was truncated');
    if (bootstrap.target_readme?.ok && bootstrap.target_readme.truncated) truncationWarnings.push('bootstrap.target_readme was truncated');
    if (bootstrap.target_instruction?.ok && bootstrap.target_instruction.truncated) truncationWarnings.push('bootstrap.target_instruction was truncated');
    if (bootstrap.target_config_json?.ok && bootstrap.target_config_json.truncated) truncationWarnings.push('bootstrap.target_config_json was truncated');

    const initContextBlocks: string[] = [];
    const skillParts: string[] = [];
    if (skill.ok) skillParts.push(skill.content);
    if (skillWrite.ok) skillParts.push(skillWrite.content);
    if (skillParts.length > 0) {
      initContextBlocks.push(`## mindos_skill_md\n\n${skillParts.join('\n\n---\n\n')}`);
    }
    if (userSkillRules.ok && !userSkillRules.truncated && userSkillRules.content.trim()) {
      initContextBlocks.push(`## user_skill_rules\n\nUser personalization preferences (.mindos/user-preferences.md):\n\n${userSkillRules.content}`);
    }
    if (bootstrap.instruction.ok) initContextBlocks.push(`## bootstrap_instruction\n\n${bootstrap.instruction.content}`);
    if (bootstrap.index?.ok) initContextBlocks.push(`## bootstrap_index\n\n${bootstrap.index.content}`);
    if (bootstrap.config_json.ok) {
      // Strip UI-only sections (uiSchema, keySpecs) — they are consumed exclusively
      // by the frontend renderer and add ~1,120 tokens of noise the agent never uses.
      let configContent = bootstrap.config_json.content;
      try {
        const parsed = JSON.parse(configContent);
        delete parsed.uiSchema;
        delete parsed.keySpecs;
        configContent = JSON.stringify(parsed, null, 2);
      } catch { /* keep original if parse fails */ }
      initContextBlocks.push(`## bootstrap_config_json\n\n${configContent}`);
    }
    if (bootstrap.target_readme?.ok) initContextBlocks.push(`## bootstrap_target_readme\n\n${bootstrap.target_readme.content}`);
    if (bootstrap.target_instruction?.ok) initContextBlocks.push(`## bootstrap_target_instruction\n\n${bootstrap.target_instruction.content}`);
    if (bootstrap.target_config_json?.ok) initContextBlocks.push(`## bootstrap_target_config_json\n\n${bootstrap.target_config_json.content}`);

    agentInitialization = {
      targetDir,
      initFailures,
      truncationWarnings,
      initContextBlocks,
    };
  }

  const lastUserContent = getLastUserContent(messages);
  const systemPromptBase = buildMindosSystemPrompt({
    mindRoot,
    environment: {
      projectRoot,
      cwd: executionCwd,
    },
  });
  const commonTurnPrompt = await buildMindosContextPrompt({
    prompt: lastUserContent,
    mindRoot,
    currentFile,
    attachedFiles,
    uploadedParts,
    messages: mindosUiMessages,
    agentInitialization,
    activeRecall: agentConfig.activeRecall,
    selectedSkills,
    sessionWorkDir: sessionContext.resolvedWorkDir,
    sessionContextSelection: sessionContext.resolvedSelection,
    sessionContextIssues: sessionContext.issues,
  }, {
    loadFileContext: loadAttachedFileContext,
    recallKnowledge: (query, options) => performActiveRecall(mindRoot, query, options),
    warn: (message, error) => console.warn(message, error),
  });
  const turnPrompt = renderMindosPiSelectedSkillPrompt(commonTurnPrompt, selectedSkills);
  let systemPrompt = systemPromptBase;

  // Log system prompt size for diagnosing context truncation issues (e.g. Ollama)
  console.log(`[ask] mode=${askMode} systemPrompt=${systemPrompt.length} chars (~${Math.ceil(systemPrompt.length / 4)} tokens)`);

  try {
    const {
      createWebMindosPiRuntimeHostServices,
      getMindosWebPiRuntimePaths,
    } = await import('@/lib/agent/mindos-pi-runtime-host');
    const runtimePaths = getMindosWebPiRuntimePaths({ projectRoot, mindRoot, serverSettings, mode: askMode, permissionPolicy });
    const { createMindosAgentRuntime } = await import('@geminilight/mindos/agent/runtime/adapters/mindos');
    const { runWithKbPermissionPolicy } = await import('@/lib/agent/kb-extension');
    // Scope the kb tool policy to this request: runtime creation reloads the
    // kb extension, and concurrent requests with different modes must not
    // race on the module-level policy.
    const runtime = await runWithKbPermissionPolicy(permissionPolicy, () => createMindosAgentRuntime({
      mode: askMode,
      messages: mindosUiMessages,
      systemPrompt,
      providerOverride: body.providerOverride,
      modelOverride: typeof body.modelOverride === 'string' ? body.modelOverride : undefined,
      projectRoot,
      agentDir: runtimePaths.agentDir,
      mindRoot,
      workDir: executionCwd,
      agentConfig: {
        enableThinking,
        thinkingBudget,
        contextStrategy,
      },
      serverSettings,
      additionalSkillPaths: runtimePaths.additionalSkillPaths,
      additionalExtensionPaths: runtimePaths.additionalExtensionPaths,
      allowProjectBash: permissionPolicy.toolScope.terminal,
      hostServices: createWebMindosPiRuntimeHostServices(serverSettings),
    }));
    systemPrompt = runtime.systemPrompt;
    const {
      session,
      agentRunContextResource,
      llmHistoryMessages,
      lastUserContent,
      lastUserImages,
      fallbackTools,
      apiKey,
      modelName,
      provider,
      baseUrl,
    } = runtime;
    const extensionLoadErrors = (runtime as { extensionLoadErrors?: Array<{ path: string; error: string }> }).extensionLoadErrors;
    const extensionLoadStatus = formatMindosPiExtensionLoadStatus(extensionLoadErrors);

    // ── SSE Stream ──
    return createAskSseResponse(async (send) => {
      let outputSummary = '';
      const mainRun = startAgentRun({
        agentKind: 'mindos-main',
        runtimeId: 'mindos',
        displayName: 'MindOS Agent',
        chatSessionId,
        cwd: executionCwd,
        permissionMode: permissionPolicy.permissionMode,
        inputSummary: typeof lastUserContent === 'string' ? lastUserContent : JSON.stringify(lastUserContent),
        metadata: {
          sessionWorkDir: sessionContext.resolvedWorkDir.path,
          sessionSpaces: sessionContext.resolvedSelection.spaces.map((space) => space.path),
          sessionAssistants: sessionContext.resolvedSelection.assistants.map((assistant) => assistant.id),
        },
      });
      sendAgentRunContext(send, mainRun);
      const sendWithLedger = (event: MindOSSSEvent) => {
        if (event.type === 'text_delta') outputSummary += event.delta;
        appendSseEventToAgentRun(mainRun.id, event);
        send(event);
      };
      if (extensionLoadStatus) {
        sendWithLedger({
          type: 'status',
          runtime: 'mindos',
          visible: true,
          message: extensionLoadStatus,
        });
      }
      try {
        const agentRunContext = {
          chatSessionId,
          rootRunId: mainRun.rootRunId ?? mainRun.id,
          parentRunId: mainRun.id,
        };
        const restoreAgentRunResourceContext = setAgentRunContextForResource(agentRunContextResource, agentRunContext);
        try {
          await runWithAgentRunContext(agentRunContext, async () => {
            // ── Proxy compatibility check ──
            // If this baseUrl is known to reject stream+tools, skip session.prompt() entirely
            // and go straight to the non-streaming fallback path.
            const compatCache = readBaseUrlCompat();
            const effectiveBaseUrlKey = baseUrl || 'default';
            const compatMode = resolveAskCompatMode({
              askMode,
              provider,
              baseUrl,
              cachedMode: compatCache[effectiveBaseUrlKey],
            });
            const proxyFallbackMessages = {
              proxyCompatMode: t.proxyCompatMode,
              proxyCompatDetecting: t.proxyCompatDetecting,
              proxyCompatFailed: t.proxyCompatFailed,
              proxyCompatAlsoFailed: t.proxyCompatAlsoFailed,
            };
            const runProxyFallback = () => runMindosNonStreamingFallback({
              baseUrl: baseUrl ?? '',
              apiKey,
              model: modelName,
              systemPrompt,
              historyMessages: llmHistoryMessages,
              userContent: turnPrompt,
              tools: fallbackTools,
              send: sendWithLedger,
              signal: req.signal,
              maxSteps: stepLimit,
            });

            const askRunId = randomUUID();
            await runWithAskUserQuestionBridge({
              runId: askRunId,
              send: (event) => sendWithLedger(event as unknown as MindOSSSEvent),
            }, () => runMindosPiAgentAskSession({
              session: {
                subscribe: (callback) => { session.subscribe(callback); },
                prompt: async (prompt, options) => { await session.prompt(prompt, options as any); },
                steer: (message) => session.steer(message),
                abort: () => session.abort(),
              },
              prompt: turnPrompt,
              promptOptions: lastUserImages ? { images: lastUserImages } : undefined,
              stepLimit,
              timeoutMs: resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS),
              signal: req.signal,
              provider,
              baseUrl,
              effectiveBaseUrlKey,
              compatMode,
              send: sendWithLedger,
              runFallback: runProxyFallback,
              proxyMessages: proxyFallbackMessages,
              onToolExecution: () => metrics.recordToolExecution(),
              onTokens: (input, output) => metrics.recordTokens(input, output),
              onStep: (step, maxSteps) => {
                if (process.env.NODE_ENV === 'development') console.log(`[ask] Step ${step}/${maxSteps}`);
              },
              writeCompat: (key, mode) => {
                writeBaseUrlCompat(key, mode);
                console.log(`[ask] Proxy compat detected: ${key} → ${mode} (cached)`);
              },
            }));
          });
        } finally {
          restoreAgentRunResourceContext();
        }
        completeAgentRun(mainRun.id, { outputSummary });
      } catch (error) {
        failAgentRun(mainRun.id, {
          status: agentRunErrorStatus(error, req.signal),
          error,
          outputSummary,
        });
        throw error;
      }
    }, (err) => {
      if (err instanceof Error && (err as any).code === 'TIMEOUT') return t.agentTimeout;
      return err instanceof Error ? err.message : String(err);
    });
  } catch (err) {
    console.error('[ask] Failed to initialize model:', err);
    if (err instanceof MindOSError) {
      return apiError(err.code, err.message);
    }
    if ((err as { code?: unknown })?.code === ErrorCodes.INVALID_REQUEST) {
      return apiError(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : 'Invalid ask request', 400);
    }
    return apiError(ErrorCodes.MODEL_INIT_FAILED, err instanceof Error ? err.message : 'Failed to initialize AI model', 500);
  }
}
