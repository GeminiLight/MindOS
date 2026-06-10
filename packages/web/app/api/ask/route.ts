export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import path from 'path';
import { randomUUID } from 'crypto';
import { getFileContent, getMindRoot, collectAllFiles } from '@/lib/fs';
import { validateFileSize } from '@/lib/api-file-size-validation';
import { truncate } from '@/lib/agent/tools';
import type { AgentRuntimeIdentity, AskModeApi, RuntimeSessionBinding } from '@/lib/types';
import { readSettings, readBaseUrlCompat, writeBaseUrlCompat } from '@/lib/settings';
import { checkNativeRuntimeHealth, detectLocalAcpAgents, resolveCommandPath } from '@/lib/acp/detect-local';
import { en as i18nEn, zh as i18nZh } from '@/lib/i18n';
import { MindOSError, apiError, ErrorCodes } from '@/lib/errors';
import { performActiveRecall } from '@/lib/agent/active-recall';
import { metrics } from '@/lib/metrics';
import { resolveAskCompatMode } from '@/lib/agent/ask-compat';
import '@/lib/pi-integration/mcp-config'; // Injects --mcp-config argv before extension load
import { createSession, promptStream, cancelPrompt, closeSession } from '@/lib/acp/session';
import { getProjectRoot } from '@/lib/project-root';
import type { Message as FrontendMessage } from '@/lib/types';
import {
  MINDOS_SSE_HEADERS,
  encodeMindosSseEvent,
  type MindOSSSEvent,
  buildMindosExternalRuntimePrompt,
  createMindosUploadedFileParts,
  dirnameOfMindosPath,
  expandMindosAskAttachedFiles,
  loadMindosAskFileContext,
  normalizeMindosAskMode,
  normalizeMindosAskStepLimit,
  resolveMindosAgentTimeoutMs,
  runMindosAcpAskSession,
  runMindosNonStreamingFallback,
  runMindosPiAgentAskSession,
} from '@geminilight/mindos/session';
import {
  runMindosAgentRuntimeAskSession,
  type MindosAgentRuntimeSelection,
} from '@geminilight/mindos/agent-runtime';
import {
  handleAgentRuntimesGet,
  type AgentRuntimesServices,
} from '@geminilight/mindos/server';
import {
  buildMindosAskSystemPrompt,
  type MindosAskInitializationContext,
} from '@geminilight/mindos/agent';
import {
  resolveSkillFile,
  resolveSkillReference,
} from '@/lib/agent/skill-resolver';
import { askUserQuestionViaBridge, runWithAskUserQuestionBridge } from '@/lib/agent/user-question-bridge';
import {
  requestRuntimePermissionViaBridge,
  runWithRuntimePermissionBridge,
} from '@/lib/agent/runtime-permission-bridge';
import {
  createClaudePermissionPromptConfig,
  resolveRuntimePermissionBaseUrl,
} from '@/lib/agent/claude-permission-prompt';
import {
  completeAgentRun,
  failAgentRun,
  startAgentRun,
  updateAgentRun,
  type AgentRunRecord,
} from '@/lib/agent/run-ledger';
import { createMindosAgentPermissionPolicy } from '@/lib/agent/permission-policy';
import { runWithAgentRunContext } from '@/lib/agent/agent-run-context';
import { toMindosUiAskMessages } from '@/lib/agent/to-agent-messages';

const NATIVE_ASK_HEALTH_GATE_TIMEOUT_MS = 3000;

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

function getLastUserContent(messages: FrontendMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'user' && typeof message.content === 'string') return message.content;
  }
  return '';
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

async function assertNativeRuntimeAvailable(runtime: MindosAgentRuntimeSelection): Promise<string | null> {
  const services: AgentRuntimesServices = {
    readSettings: readSettings as AgentRuntimesServices['readSettings'],
    detectLocalAcpAgents: detectLocalAcpAgents as AgentRuntimesServices['detectLocalAcpAgents'],
    resolveRuntimeCommand: resolveCommandPath as AgentRuntimesServices['resolveRuntimeCommand'],
    checkNativeRuntimeHealth: checkNativeRuntimeHealth as AgentRuntimesServices['checkNativeRuntimeHealth'],
  };
  const res = await Promise.race([
    handleAgentRuntimesGet(new URLSearchParams(`runtime=${runtime.kind}&force=1`), services),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), NATIVE_ASK_HEALTH_GATE_TIMEOUT_MS)),
  ]);
  if (!res) return null;
  const body = res.body;
  if (res.status !== 200 || !body || !('runtime' in body)) {
    return `Unable to verify ${runtime.name} before starting the turn.`;
  }
  const descriptor = body.runtime;
  if (descriptor.kind !== runtime.kind || descriptor.id !== runtime.id) {
    return `${runtime.name} is not available.`;
  }
  if (descriptor.status === 'available') return null;
  const statusText = descriptor.status === 'signed-out'
    ? 'signed out'
    : descriptor.status === 'missing'
      ? 'not installed'
      : 'unavailable';
  return `${descriptor.name} is ${statusText}.${descriptor.availability?.reason ? ` ${descriptor.availability.reason}` : ''}`;
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
    uploadedFiles?: Array<{ name: string; content: string }>;
    maxSteps?: number;
    /** Ask mode: 'chat' = read-only tools; 'agent' = full tools; 'organize' = lean import mode */
    mode?: AskModeApi;
    /** ACP agent selection: if present, route to ACP instead of MindOS */
    selectedAcpAgent?: { id: string; name: string } | null;
    /** Unified runtime selection. ACP values mirror selectedAcpAgent for compatibility. */
    selectedRuntime?: (AgentRuntimeIdentity & { externalSessionId?: string }) | null;
    /** Typed external runtime binding for native Codex/Claude resume. */
    runtimeBinding?: RuntimeSessionBinding | null;
    /** Per-request provider override from the chat panel capsule */
    providerOverride?: string;
    /** Per-request model override from the inline model picker */
    modelOverride?: string;
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
  const askMode: AskModeApi = normalizeMindosAskMode(body.mode);
  const permissionPolicy = createMindosAgentPermissionPolicy(askMode);
  const chatSessionId = typeof body.chatSessionId === 'string' && body.chatSessionId.trim()
    ? body.chatSessionId.trim()
    : undefined;

  // Diagnostic: log attached files so silent failures are visible
  if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
    console.log(`[ask] mode=${askMode} attachedFiles=${JSON.stringify(attachedFiles)} currentFile=${currentFile ?? 'none'}`);
  }

  // Read agent config from settings
  const serverSettings = readSettings();
  const agentConfig = serverSettings.agent ?? {};
  if (selectedNativeRuntime) {
    const unavailableReason = await assertNativeRuntimeAvailable(selectedNativeRuntime);
    if (unavailableReason) {
      return apiError(ErrorCodes.INVALID_REQUEST, unavailableReason, 409);
    }
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

  if (selectedNativeRuntime || selectedAcpAgent) {
    const mindRoot = getMindRoot();
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
    const externalPrompt = buildMindosExternalRuntimePrompt({
      prompt: lastUserContent,
      mode: askMode,
      fileContext,
      uploadedParts,
      recalledKnowledge,
    });

    return createAskSseResponse((send) => runWithAgentRunContext({ chatSessionId }, async () => {
      if (selectedNativeRuntime) {
        const runtimeRunId = randomUUID();
        let outputSummary = '';
        const nativeRun = startAgentRun({
          agentKind: 'native-runtime',
          runtimeId: selectedNativeRuntime.id,
          displayName: selectedNativeRuntime.name,
          cwd: mindRoot,
          permissionMode: permissionPolicy.runtimePermissionMode,
          inputSummary: externalPrompt,
          metadata: {
            runtimeKind: selectedNativeRuntime.kind,
            source: 'selected-native-runtime',
          },
        });
        const sendWithLedger = (event: MindOSSSEvent) => {
          if (event.type === 'text_delta') outputSummary += event.delta;
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
              runtime: selectedNativeRuntime,
              cwd: mindRoot,
              prompt: externalPrompt,
              permissionMode: permissionPolicy.runtimePermissionMode,
              signal: req.signal,
              send: sendWithLedger,
              services: {
                ...(selectedNativeRuntime.kind === 'claude' ? {
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
              error: result.error,
              outputSummary,
              metadata: {
                runtimeKind: selectedNativeRuntime.kind,
                ...(result.externalSessionId ? { externalSessionId: result.externalSessionId } : {}),
              },
            });
            return;
          }
          completeAgentRun(nativeRun.id, {
            outputSummary,
            metadata: {
              runtimeKind: selectedNativeRuntime.kind,
              ...(result.externalSessionId ? { externalSessionId: result.externalSessionId } : {}),
            },
          });
        } catch (error) {
          failAgentRun(nativeRun.id, { error, outputSummary });
          throw error;
        }
        return;
      }

      if (selectedAcpAgent) {
        let hasContent = false;
        let outputSummary = '';
        const acpRun = startAgentRun({
          agentKind: 'acp',
          runtimeId: selectedAcpAgent.id,
          displayName: selectedAcpAgent.name,
          cwd: mindRoot,
          permissionMode: permissionPolicy.acpPermissionMode,
          inputSummary: externalPrompt,
          metadata: {
            source: 'selected-acp-runtime',
            phase: 'create_session',
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
            cwd: mindRoot,
            prompt: externalPrompt,
            signal: req.signal,
            createSession: async (agentId, options) => {
              const session = await createSession(agentId, {
                ...options,
                permissionMode: permissionPolicy.acpPermissionMode,
              });
              updateAgentRun(acpRun.id, {
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
              status: (error as any)?.code === 'TIMEOUT' ? 'timed_out' : 'failed',
              error,
              outputSummary,
            });
            throw error;
          });
        if (acpResult.error) {
          failAgentRun(acpRun.id, {
            status: (acpResult.error as any).code === 'TIMEOUT' ? 'timed_out' : 'failed',
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
    const projectRoot = getProjectRoot();
    const mindRoot = getMindRoot();
    
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

  const systemPromptBase = await buildMindosAskSystemPrompt({
    mode: askMode,
    mindRoot: getMindRoot(),
    currentFile,
    attachedFiles,
    uploadedParts,
    messages: mindosUiMessages,
    agentInitialization,
    activeRecall: agentConfig.activeRecall,
  }, {
    readKnowledgeFile,
    loadFileContext: loadAttachedFileContext,
    recallKnowledge: (query, options) => performActiveRecall(getMindRoot(), query, options),
    warn: (message, error) => console.warn(message, error),
  });
  let systemPrompt = systemPromptBase;

  // Log system prompt size for diagnosing context truncation issues (e.g. Ollama)
  console.log(`[ask] mode=${askMode} systemPrompt=${systemPrompt.length} chars (~${Math.ceil(systemPrompt.length / 4)} tokens)`);

  try {
    const projectRoot = getProjectRoot();
    const mindRoot = getMindRoot();
    const {
      createWebMindosPiRuntimeHostServices,
      getMindosWebPiRuntimePaths,
      getMindosWebRequestTools,
    } = await import('@/lib/agent/mindos-pi-runtime-host');
    const runtimePaths = getMindosWebPiRuntimePaths({ projectRoot, mindRoot, serverSettings, mode: askMode });
    const { createMindosPiCodingAgentRuntime } = await import('@geminilight/mindos/session/pi-coding-agent');
    const runtime = await createMindosPiCodingAgentRuntime({
      mode: askMode,
      messages: mindosUiMessages,
      systemPrompt,
      providerOverride: body.providerOverride,
      modelOverride: typeof body.modelOverride === 'string' ? body.modelOverride : undefined,
      projectRoot,
      agentDir: runtimePaths.agentDir,
      mindRoot,
      agentConfig: {
        enableThinking,
        thinkingBudget,
        contextStrategy,
      },
      serverSettings,
      requestTools: getMindosWebRequestTools(askMode),
      additionalSkillPaths: runtimePaths.additionalSkillPaths,
      additionalExtensionPaths: runtimePaths.additionalExtensionPaths,
      hostServices: createWebMindosPiRuntimeHostServices(serverSettings),
    });
    systemPrompt = runtime.systemPrompt;
    const {
      session,
      llmHistoryMessages,
      lastUserContent,
      lastUserImages,
      requestTools,
      apiKey,
      modelName,
      provider,
      baseUrl,
    } = runtime;

    // ── SSE Stream ──
    return createAskSseResponse(async (send) => {
      let outputSummary = '';
      const mainRun = startAgentRun({
        agentKind: 'mindos-main',
        runtimeId: 'mindos',
        displayName: 'MindOS Agent',
        chatSessionId,
        cwd: mindRoot,
        permissionMode: permissionPolicy.permissionMode,
        inputSummary: typeof lastUserContent === 'string' ? lastUserContent : JSON.stringify(lastUserContent),
      });
      sendAgentRunContext(send, mainRun);
      const sendWithLedger = (event: MindOSSSEvent) => {
        if (event.type === 'text_delta') outputSummary += event.delta;
        send(event);
      };
      try {
        await runWithAgentRunContext({
          chatSessionId,
          rootRunId: mainRun.rootRunId ?? mainRun.id,
          parentRunId: mainRun.id,
        }, async () => {
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
            userContent: typeof lastUserContent === 'string' ? lastUserContent : JSON.stringify(lastUserContent),
            tools: requestTools,
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
            prompt: lastUserContent,
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
        completeAgentRun(mainRun.id, { outputSummary });
      } catch (error) {
        failAgentRun(mainRun.id, {
          status: (error as any)?.code === 'TIMEOUT' ? 'timed_out' : 'failed',
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
