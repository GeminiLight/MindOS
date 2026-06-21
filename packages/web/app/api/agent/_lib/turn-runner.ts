import path from 'path';
import { randomUUID } from 'crypto';
import { getMindRoot } from '@/lib/fs';
import type { AgentPermissionMode } from '@/lib/types';
import { readSettings, readBaseUrlCompat, writeBaseUrlCompat } from '@/lib/settings';
import { resolveAssistantPermissionMode } from '@/lib/assistant-runtime-registry';
import { findUserOverride } from '@/lib/acp/agent-descriptors';
import { en as i18nEn, zh as i18nZh } from '@/lib/i18n';
import { MindOSError, apiError, ErrorCodes } from '@/lib/errors';
import { metrics } from '@/lib/metrics';
import { resolveAgentTurnCompatMode } from '@/lib/agent/agent-turn-compat';
import { createSession, promptStream, cancelPrompt, closeSession } from '@/lib/acp/session';
import { getProjectRoot } from '@/lib/project-root';
import {
  type MindOSSSEvent,
  createMindosUploadedFileParts,
  normalizeMindosAgentStepLimit,
  resolveMindosAgentTimeoutMs,
  runMindosAcpAgentTurn,
  runMindosNonStreamingFallback,
} from '@geminilight/mindos/agent/turn';
import { runMindosPiAgentTurnSession } from '@geminilight/mindos/agent/mindos-pi';
import {
  appendMindosRuntimeAttachmentPathContext,
  buildAgentRuntimeEnv,
  createMindosRuntimeImageAttachments,
  createMindosRuntimeUploadedFileAttachments,
  materializeMindosRuntimeAttachments,
  resolveAgentRuntimeEnvOverlay,
  runMindosNativeAgentTurn,
} from '@geminilight/mindos/agent/runtime';
import {
  appendSseEventToAgentRun,
  buildMindosContextPrompt,
  buildMindosSystemPrompt,
  createMindosSessionContextSignature,
  normalizeMindosSelectedSkills,
  type MindosAgentInitializationContext,
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
} from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  createMindosAgentPermissionPolicy,
  type MindosPermissionMode,
} from '@geminilight/mindos/agent/mindos-pi/permission';
import {
  runWithAgentRunContext,
  setAgentRunContextForResource,
} from '@geminilight/mindos/agent/agent-run-context';
import { toMindosUiAgentMessages } from '@/lib/agent/to-agent-messages';
import {
  readPersistedAgentSession,
  resolveSessionContext,
  SessionContextResolutionError,
} from '@/lib/session-context-server';
import {
  agentRunErrorStatus,
  compactStringEnv,
  createAgentTurnSseResponse,
  formatMindosPiExtensionLoadStatus,
  omitEnvKeys,
  sendAgentRunContext,
} from './turn-sse';
import {
  getLastUserContent,
  getLastUserImages,
  getLastUserSkillName,
  normalizeAgentMode,
  normalizeAgentPermissionMode,
  normalizeAgentSessionTurnBody,
  normalizeAssistantId,
  normalizeMindosAgentOptions,
  normalizeNativeRuntimeOptions,
  validateAgentMode,
  validateAgentPermissionMode,
  validateNativeRuntimeOptions,
  type AgentSessionTurnRouteContext,
  type AgentTurnRequestBody,
  type AgentTurnRequestContext,
} from './turn-request';
import {
  acpAgentFromLegacySelection,
  acpAgentFromRuntime,
  isMindosRuntimeSelection,
  nativeAgentRuntimeFromSelection,
  resolveAvailableNativeRuntime,
} from './runtime-selection';
import {
  dirnameOf,
  expandAttachedFiles,
  loadAttachedFileContext,
  readKnowledgeFile,
  recallMindosTurnKnowledge,
  sessionContextRunMetadata,
  shouldInjectSessionContext,
} from './turn-context';

// generateSkillsXml is in lib/agent/skills-xml.ts (not inline: Next.js route export constraints)

function permissionModeForRequest(
  assistantId: string | undefined,
  requestPermissionMode: AgentPermissionMode | undefined,
): MindosPermissionMode {
  if (requestPermissionMode) return requestPermissionMode;
  return resolveAssistantPermissionMode(
    assistantId,
    'ask',
  );
}

// skillDirCandidates, resolveSkillFile, resolveSkillReference, readAbsoluteFile
// → @/lib/agent/skill-resolver

// toPiCustomToolDefinitions adapter removed — KB tools now registered via kb-extension.ts

// reassembleSSE, piMessagesToOpenAI, runNonStreamingFallback
// → @/lib/agent/non-streaming

// ---------------------------------------------------------------------------
// POST /api/agent/sessions/:sessionId/turns
// ---------------------------------------------------------------------------

function resolveRuntimePermissionBaseUrlForAgentTurnContext(context: AgentTurnRequestContext): string {
  if (context.request) return resolveRuntimePermissionBaseUrl(context.request);
  if (process.env.MINDOS_INTERNAL_URL || process.env.MINDOS_URL || process.env.MINDOS_WEB_PORT) {
    return resolveRuntimePermissionBaseUrl(new Request('http://127.0.0.1/'));
  }
  throw new Error('Agent turn runner request context must include the original request for Claude Code permission callbacks.');
}

export async function handleAgentTurnRouteRequest(req: Request) {
  let body: AgentTurnRequestBody;
  try {
    body = await req.json() as AgentTurnRequestBody;
  } catch {
    return apiError(ErrorCodes.INVALID_REQUEST, 'Invalid JSON body', 400);
  }

  return runAgentTurnRequestBody(body, {
    headers: req.headers,
    signal: req.signal,
    request: req,
  });
}

export async function handleAgentSessionTurnRouteRequest(
  req: Request,
  context: AgentSessionTurnRouteContext = {},
) {
  const sessionId = await resolveAgentSessionRouteId(context);
  if (!sessionId) {
    return apiError(ErrorCodes.INVALID_REQUEST, 'sessionId is required', 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return apiError(ErrorCodes.INVALID_REQUEST, 'Invalid JSON body', 400);
  }

  const body = normalizeAgentSessionTurnBody(rawBody, sessionId);
  if (!body.ok) return apiError(ErrorCodes.INVALID_REQUEST, body.message, 400);

  return runAgentTurnRequestBody(body.body, {
    headers: req.headers,
    signal: req.signal,
    request: req,
  });
}

async function resolveAgentSessionRouteId(context: AgentSessionTurnRouteContext): Promise<string | undefined> {
  const params = await context.params;
  return typeof params?.sessionId === 'string' && params.sessionId.trim()
    ? params.sessionId.trim()
    : undefined;
}

export async function runAgentTurnRequestBody(
  body: AgentTurnRequestBody,
  requestContext: AgentTurnRequestContext = {},
) {
  const requestHeaders = requestContext.headers ?? new Headers();
  const requestSignal = requestContext.signal ?? new AbortController().signal;

  const { messages, currentFile, attachedFiles: rawAttached, uploadedFiles } = body;
  if (Object.prototype.hasOwnProperty.call(body as Record<string, unknown>, 'mode')) {
    return apiError(ErrorCodes.INVALID_REQUEST, 'mode is no longer supported', 400);
  }
  const agentModeError = validateAgentMode(body.agentMode);
  if (agentModeError) return agentModeError;
  const permissionModeError = validateAgentPermissionMode(body.permissionMode);
  if (permissionModeError) return permissionModeError;
  const agentMode = normalizeAgentMode(body.agentMode) ?? 'default';
  const requestPermissionModeInput = normalizeAgentPermissionMode(body.permissionMode);
  const mindosUiMessages = toMindosUiAgentMessages(messages);
  const selectedNativeRuntime = nativeAgentRuntimeFromSelection(body.selectedRuntime, body.runtimeBinding);
  const legacySelectedAcpAgent = acpAgentFromLegacySelection(body.selectedAcpAgent);
  const selectedAcpAgent = selectedNativeRuntime || body.selectedRuntime === null || isMindosRuntimeSelection(body.selectedRuntime)
    ? null
    : (acpAgentFromRuntime(body.selectedRuntime) ?? legacySelectedAcpAgent);
  const attachedFiles = Array.isArray(rawAttached) ? expandAttachedFiles(rawAttached) : rawAttached;
  const assistantId = normalizeAssistantId(body.assistantId);
  const nativeRuntimeOptionsError = validateNativeRuntimeOptions(body.runtimeOptions);
  if (nativeRuntimeOptionsError) return nativeRuntimeOptionsError;
  const nativeRuntimeOptions = normalizeNativeRuntimeOptions(body.runtimeOptions);
  const mindosAgentOptions = normalizeMindosAgentOptions(body.agentOptions);
  const requestPermissionMode = permissionModeForRequest(assistantId, requestPermissionModeInput);
  const permissionPolicy = createMindosAgentPermissionPolicy(requestPermissionMode);
  const nativePermissionMode = requestPermissionMode;
  const chatSessionId = typeof body.chatSessionId === 'string' && body.chatSessionId.trim()
    ? body.chatSessionId.trim()
    : undefined;
  const mindRoot = getMindRoot();
  const projectRoot = getProjectRoot();
  const priorSession = readPersistedAgentSession(chatSessionId);
  const recentSessionRuns = chatSessionId ? listAgentRuns({ chatSessionId, limit: 20 }) : [];
  const priorRuns = recentSessionRuns
    .map((run) => ({
      cwd: run.cwd,
      archiveSessionId: run.archive?.sessionId,
      externalSessionId: typeof run.metadata?.externalSessionId === 'string'
        ? run.metadata.externalSessionId
        : undefined,
    }));
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
  const sessionContextSignature = createMindosSessionContextSignature({
    sessionWorkDir: sessionContext.resolvedWorkDir,
    sessionContextSelection: sessionContext.resolvedSelection,
    sessionContextIssues: sessionContext.issues,
  });
  const includeSessionContext = shouldInjectSessionContext({
    chatSessionId,
    signature: sessionContextSignature,
    priorRuns: recentSessionRuns,
  });

  // Diagnostic: log attached files so silent failures are visible
  if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
    console.log(`[agent-turn] permission=${permissionPolicy.mode} attachedFiles=${JSON.stringify(attachedFiles)} currentFile=${currentFile ?? 'none'}`);
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
  const acceptLang = requestHeaders.get('accept-language') ?? '';
  const t = acceptLang.startsWith('zh') ? i18nZh.ask : i18nEn.ask;
  const stepLimit = normalizeMindosAgentStepLimit({
    requestedMaxSteps: body.maxSteps,
    agentMaxSteps: agentConfig.maxSteps,
  });
  const enableThinking = mindosAgentOptions.enableThinking ?? agentConfig.enableThinking ?? false;
  const thinkingBudget = mindosAgentOptions.thinkingBudget ?? agentConfig.thinkingBudget ?? 5000;
  const contextStrategy = agentConfig.contextStrategy ?? 'auto';

  // Uploaded files are already truncated client-side (80K limit), so only
  // apply a generous server-side cap to guard against malformed requests.
  const uploadedParts = createMindosUploadedFileParts(uploadedFiles);
  const runtimeAttachments = [
    ...createMindosRuntimeUploadedFileAttachments(uploadedFiles),
    ...createMindosRuntimeImageAttachments(getLastUserImages(messages)),
  ];
  const selectedSkills = normalizeMindosSelectedSkills(undefined, getLastUserSkillName(messages));

  if (verifiedNativeRuntime || selectedAcpAgent) {
    const lastUserContent = getLastUserContent(messages);
    const fileContext = loadAttachedFileContext(attachedFiles, currentFile);
    const recalledKnowledge = await recallMindosTurnKnowledge({
      mindRoot,
      lastUserContent,
      currentFile,
      attachedFiles,
      sessionSpaces: sessionContext.resolvedSelection.spaces,
      activeRecall: agentConfig.activeRecall,
    });
    const externalPrompt = await buildMindosContextPrompt({
      prompt: lastUserContent,
      mindRoot,
      fileContext,
      uploadedParts,
      recalledKnowledge,
      selectedSkills,
      includeSessionContext,
      sessionWorkDir: sessionContext.resolvedWorkDir,
      sessionContextSelection: sessionContext.resolvedSelection,
      sessionContextIssues: sessionContext.issues,
    });
    const sessionContextMetadata = sessionContextRunMetadata(sessionContextSignature, includeSessionContext);

    return createAgentTurnSseResponse((send) => runWithAgentRunContext({ chatSessionId }, async () => {
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
            agentMode,
            runtimeKind: nativeRuntime.kind,
            source: 'selected-native-runtime',
            permissionCompilation: {
              requested: nativePermissionMode,
              applied: permissionPolicy.runtimePermissionMode,
              target: nativeRuntime.kind,
            },
            ...sessionContextMetadata,
            sessionWorkDir: sessionContext.resolvedWorkDir.path,
            sessionSpaces: sessionContext.resolvedSelection.spaces.map((space) => space.path),
            sessionAssistants: sessionContext.resolvedSelection.assistants.map((assistant) => assistant.id),
            ...(assistantId ? { assistantId } : {}),
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
            }, () => runMindosNativeAgentTurn({
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
              signal: requestSignal,
              send: sendWithLedger,
              services: {
                ...(nativeRuntime.kind === 'claude' ? {
                  createClaudePermissionPrompt: () => createClaudePermissionPromptConfig({
                    runId: runtimeRunId,
                    baseUrl: resolveRuntimePermissionBaseUrlForAgentTurnContext(requestContext),
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
              status: agentRunErrorStatus(result.error, requestSignal),
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
              permissionCompilation: {
                requested: nativePermissionMode,
                applied: permissionPolicy.runtimePermissionMode,
                target: nativeRuntime.kind,
              },
              ...sessionContextMetadata,
              ...(result.externalSessionId ? { externalSessionId: result.externalSessionId } : {}),
            },
          });
        } catch (error) {
          failAgentRun(nativeRun.id, {
            status: agentRunErrorStatus(error, requestSignal),
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
          permissionMode: permissionPolicy.permissionMode,
          inputSummary: externalPrompt,
          metadata: {
            agentMode,
            source: 'selected-acp-runtime',
            phase: 'create_session',
            permissionCompilation: {
              requested: permissionPolicy.permissionMode,
              applied: permissionPolicy.acpPermissionMode,
              target: 'acp',
            },
            ...sessionContextMetadata,
            sessionWorkDir: sessionContext.resolvedWorkDir.path,
            sessionSpaces: sessionContext.resolvedSelection.spaces.map((space) => space.path),
            sessionAssistants: sessionContext.resolvedSelection.assistants.map((assistant) => assistant.id),
            ...(assistantId ? { assistantId } : {}),
          },
        });
        sendAgentRunContext(send, acpRun);
        const acpResult = await runWithAgentRunContext({
          chatSessionId,
          rootRunId: acpRun.rootRunId ?? acpRun.id,
          parentRunId: acpRun.id,
        }, () => (
          runMindosAcpAgentTurn({
            agentId: selectedAcpAgent.id,
            cwd: executionCwd,
            prompt: acpPrompt,
            signal: requestSignal,
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
              status: agentRunErrorStatus(error, requestSignal),
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
            status: agentRunErrorStatus(acpResult.error, requestSignal),
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

  let agentInitialization: MindosAgentInitializationContext | undefined;
  {
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
      `[agent-turn] SKILL skill=${skill.ok} (${skillInfo.path}), write-supplement=${skillWrite.ok}`
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
  const fileContext = loadAttachedFileContext(attachedFiles, currentFile);
  const recalledKnowledge = await recallMindosTurnKnowledge({
    mindRoot,
    lastUserContent,
    currentFile,
    attachedFiles,
    sessionSpaces: sessionContext.resolvedSelection.spaces,
    activeRecall: agentConfig.activeRecall,
  });
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
    fileContext,
    uploadedParts,
    recalledKnowledge,
    agentInitialization,
    selectedSkills,
    includeSessionContext,
    sessionWorkDir: sessionContext.resolvedWorkDir,
    sessionContextSelection: sessionContext.resolvedSelection,
    sessionContextIssues: sessionContext.issues,
  });
  const turnPrompt = renderMindosPiSelectedSkillPrompt(commonTurnPrompt, selectedSkills);
  let systemPrompt = systemPromptBase;

  // Log system prompt size for diagnosing context truncation issues (e.g. Ollama)
  console.log(`[agent-turn] systemPrompt=${systemPrompt.length} chars (~${Math.ceil(systemPrompt.length / 4)} tokens)`);

  try {
    const {
      createWebMindosPiRuntimeHostServices,
      getMindosWebPiRuntimePaths,
    } = await import('@/lib/agent/mindos-pi-runtime-host');
    const runtimePaths = getMindosWebPiRuntimePaths({ projectRoot, mindRoot, serverSettings, permissionPolicy });
    const { createMindosAgentRuntime } = await import('@geminilight/mindos/agent/runtime/adapters/mindos');
    const { runWithKbPermissionPolicy } = await import('@/lib/agent/kb-extension');
    // Scope the kb tool policy to this request: runtime creation reloads the
    // kb extension, and concurrent requests with different permissions must not
    // race on the module-level policy.
    const runtime = await runWithKbPermissionPolicy(permissionPolicy, () => createMindosAgentRuntime({
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
    const sessionContextMetadata = sessionContextRunMetadata(sessionContextSignature, includeSessionContext);

    // ── SSE Stream ──
    return createAgentTurnSseResponse(async (send) => {
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
          agentMode,
          sessionWorkDir: sessionContext.resolvedWorkDir.path,
          permissionCompilation: {
            requested: permissionPolicy.permissionMode,
            applied: permissionPolicy.runtimePermissionMode,
            target: 'mindos-pi',
          },
          ...sessionContextMetadata,
          sessionSpaces: sessionContext.resolvedSelection.spaces.map((space) => space.path),
          sessionAssistants: sessionContext.resolvedSelection.assistants.map((assistant) => assistant.id),
          ...(assistantId ? { assistantId } : {}),
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
            const compatMode = resolveAgentTurnCompatMode({
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
              signal: requestSignal,
              maxSteps: stepLimit,
            });

            const agentRunId = randomUUID();
            await runWithAskUserQuestionBridge({
              runId: agentRunId,
              send: (event) => sendWithLedger(event as unknown as MindOSSSEvent),
            }, () => runMindosPiAgentTurnSession({
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
              signal: requestSignal,
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
                if (process.env.NODE_ENV === 'development') console.log(`[agent-turn] Step ${step}/${maxSteps}`);
              },
              writeCompat: (key, mode) => {
                writeBaseUrlCompat(key, mode);
                console.log(`[agent-turn] Proxy compat detected: ${key} → ${mode} (cached)`);
              },
            }));
          });
        } finally {
          restoreAgentRunResourceContext();
        }
        completeAgentRun(mainRun.id, { outputSummary });
      } catch (error) {
        failAgentRun(mainRun.id, {
          status: agentRunErrorStatus(error, requestSignal),
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
    console.error('[agent-turn] Failed to initialize model:', err);
    if (err instanceof MindOSError) {
      return apiError(err.code, err.message);
    }
    if ((err as { code?: unknown })?.code === ErrorCodes.INVALID_REQUEST) {
      return apiError(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : 'Invalid ask request', 400);
    }
    return apiError(ErrorCodes.MODEL_INIT_FAILED, err instanceof Error ? err.message : 'Failed to initialize AI model', 500);
  }
}
