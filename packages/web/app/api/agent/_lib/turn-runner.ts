import path from 'path';
import { getMindRoot } from '@/lib/fs';
import type { AgentPermissionMode } from '@/lib/types';
import { readSettings } from '@/lib/settings';
import { resolveAssistantPermissionMode } from '@/lib/assistant-runtime-registry';
import { findUserOverride } from '@/lib/acp/agent-descriptors';
import { en as i18nEn, zh as i18nZh } from '@/lib/i18n';
import { apiError, ErrorCodes } from '@/lib/errors';
import { getProjectRoot } from '@/lib/project-root';
import {
  createMindosUploadedFileParts,
  normalizeMindosAgentStepLimit,
} from '@geminilight/mindos/agent/turn';
import {
  buildAgentRuntimeEnv,
  createMindosRuntimeImageAttachments,
  createMindosRuntimeUploadedFileAttachments,
  resolveAgentRuntimeEnvOverlay,
} from '@geminilight/mindos/agent/runtime';
import {
  buildMindosContextPrompt,
  buildMindosSystemPrompt,
  createMindosSessionContextSignature,
  normalizeMindosSelectedSkills,
  prependMindosActiveAssistantPrompt,
  type MindosAgentInitializationContext,
} from '@geminilight/mindos/agent';
import { renderMindosPiSelectedSkillPrompt } from '@geminilight/mindos/agent/mindos-pi';
import {
  resolveSkillFile,
  resolveSkillReference,
} from '@/lib/agent/skill-resolver';
import { listAgentRuns } from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  createMindosAgentPermissionPolicy,
  type MindosPermissionMode,
} from '@geminilight/mindos/agent/mindos-pi/permission';
import { toMindosUiAgentMessages } from '@/lib/agent/to-agent-messages';
import {
  readPersistedAgentSession,
  resolveSessionContext,
  SessionContextResolutionError,
} from '@/lib/session-context-server';
import { omitEnvKeys } from './turn-sse';
import {
  getLastUserContent,
  getLastUserImages,
  getLastUserSkillName,
  normalizeAcpRuntimeOptions,
  normalizeAgentMode,
  normalizeAgentPermissionMode,
  normalizeAgentSessionTurnBody,
  normalizeAssistantId,
  normalizeMindosAgentOptions,
  normalizeNativeRuntimeOptions,
  validateAgentTurnRequestContract,
  validateAgentMode,
  validateAgentPermissionMode,
  validateAcpRuntimeOptions,
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
  validateRuntimeBindingMatchesSelection,
} from './runtime-selection';
import { resolveRuntimeTurnLane } from './turn-runtime-lane';
import { enforceSelectedSkillRuntimeMatches } from './skill-runtime-enforcement';
import {
  dirnameOf,
  expandAttachedFiles,
  createMindosFileContextSignature,
  fileContextForPrompt,
  fileContextRunMetadata,
  loadAttachedFileContext,
  readKnowledgeFile,
  recallMindosTurnKnowledge,
  sessionContextRunMetadata,
  shouldInjectFileContext,
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
  const contractError = validateAgentTurnRequestContract(body);
  if (contractError) return contractError;
  const agentModeError = validateAgentMode(body.agentMode);
  if (agentModeError) return agentModeError;
  const permissionModeError = validateAgentPermissionMode(body.permissionMode);
  if (permissionModeError) return permissionModeError;
  const activeAssistant = requestContext.activeAssistant;
  const agentMode = normalizeAgentMode(body.agentMode) ?? 'default';
  const requestPermissionModeInput = normalizeAgentPermissionMode(body.permissionMode);
  const mindosUiMessages = toMindosUiAgentMessages(messages);
  const runtimeBindingError = validateRuntimeBindingMatchesSelection(body.selectedRuntime, body.runtimeBinding);
  if (runtimeBindingError) return apiError(ErrorCodes.INVALID_REQUEST, runtimeBindingError, 400);
  const selectedNativeRuntime = nativeAgentRuntimeFromSelection(body.selectedRuntime, body.runtimeBinding);
  const legacySelectedAcpAgent = acpAgentFromLegacySelection(body.selectedAcpAgent);
  const selectedAcpAgent = selectedNativeRuntime || body.selectedRuntime === null || isMindosRuntimeSelection(body.selectedRuntime)
    ? null
    : (acpAgentFromRuntime(body.selectedRuntime) ?? legacySelectedAcpAgent);
  const attachedFiles = Array.isArray(rawAttached) ? expandAttachedFiles(rawAttached) : rawAttached;
  const assistantId = normalizeAssistantId(body.assistantId);
  const nativeRuntimeOptionsError = validateNativeRuntimeOptions(body.runtimeOptions);
  if (nativeRuntimeOptionsError) return nativeRuntimeOptionsError;
  const acpRuntimeOptionsError = validateAcpRuntimeOptions(body.acpRuntimeOptions);
  if (acpRuntimeOptionsError) return acpRuntimeOptionsError;
  const nativeRuntimeOptions = normalizeNativeRuntimeOptions(body.runtimeOptions);
  const acpRuntimeOptions = normalizeAcpRuntimeOptions(body.acpRuntimeOptions);
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
  const requestExternalSessionId = body.runtimeBinding
    && (!body.runtimeBinding.status || body.runtimeBinding.status === 'active')
    && typeof body.runtimeBinding.externalSessionId === 'string'
    && body.runtimeBinding.externalSessionId.trim()
    ? body.runtimeBinding.externalSessionId.trim()
    : undefined;
  let sessionContext: ReturnType<typeof resolveSessionContext>;
  try {
    sessionContext = resolveSessionContext({
      requestedWorkDir: body.workDir,
      requestedSelection: body.contextSelection,
      mindRoot,
      projectRoot,
      priorSession,
      requestRuntimeBinding: body.runtimeBinding,
      requestExternalSessionId,
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
  const runtimeLane = resolveRuntimeTurnLane({
    verifiedNativeRuntime,
    selectedAcpAgent,
  });

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
  const skillRuntimeEnforcementError = await enforceSelectedSkillRuntimeMatches({
    selectedSkills,
    runtimeLane,
    selectedAcpAgent,
    mindRoot,
    projectRoot,
    serverSettings,
  });
  if (skillRuntimeEnforcementError) return skillRuntimeEnforcementError;
  const loadedFileContext = loadAttachedFileContext(attachedFiles, currentFile);
  const fileContextSignature = createMindosFileContextSignature(loadedFileContext);
  const includeFileContext = shouldInjectFileContext({
    chatSessionId,
    signature: fileContextSignature,
    priorRuns: recentSessionRuns,
  });
  const promptFileContext = fileContextForPrompt(loadedFileContext, includeFileContext);
  const fileContextMetadata = fileContextRunMetadata(fileContextSignature, includeFileContext, loadedFileContext);

  if (runtimeLane.kind !== 'mindos-pi') {
    const lastUserContent = getLastUserContent(messages);
    const recalledKnowledge = await recallMindosTurnKnowledge({
      mindRoot,
      lastUserContent,
      currentFile,
      attachedFiles,
      sessionSpaces: sessionContext.resolvedSelection.spaces,
      activeRecall: agentConfig.activeRecall,
    });
    const externalPromptBase = await buildMindosContextPrompt({
      prompt: lastUserContent,
      mindRoot,
      fileContext: promptFileContext,
      uploadedParts,
      recalledKnowledge,
      selectedSkills,
      includeSessionContext,
      sessionWorkDir: sessionContext.resolvedWorkDir,
      sessionContextSelection: sessionContext.resolvedSelection,
      sessionContextIssues: sessionContext.issues,
    });
    const externalPrompt = prependMindosActiveAssistantPrompt(externalPromptBase, activeAssistant);
    const sessionContextMetadata = sessionContextRunMetadata(sessionContextSignature, includeSessionContext);
    const externalTurnBase = {
      externalPrompt,
      chatSessionId,
      executionCwd,
      permissionPolicy,
      agentMode,
      sessionContextMetadata,
      fileContextMetadata,
      sessionWorkDir: sessionContext.resolvedWorkDir,
      sessionContextSelection: sessionContext.resolvedSelection,
      assistantId,
      runtimeAttachments,
      selectedSkills,
      requestSignal,
      t,
    };

    if (runtimeLane.kind === 'native') {
      return runtimeLane.runTurn({
        ...externalTurnBase,
        nativePermissionMode,
        nativeRuntimeOptions,
        nativeRuntimeEnv,
        requestContext,
      });
    }

    return runtimeLane.runTurn({
      ...externalTurnBase,
      acpRuntimeOptions,
      acpRuntimeEnvOverlay,
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
    activeAssistant,
    environment: {
      projectRoot,
      cwd: executionCwd,
    },
  });
  const commonTurnPrompt = await buildMindosContextPrompt({
    prompt: lastUserContent,
    mindRoot,
    fileContext: promptFileContext,
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

  const sessionContextMetadata = sessionContextRunMetadata(sessionContextSignature, includeSessionContext);
  return runtimeLane.runTurn({
    mindosUiMessages,
    systemPrompt,
    turnPrompt,
    providerOverride: body.providerOverride,
    modelOverride: typeof body.modelOverride === 'string' ? body.modelOverride : undefined,
    projectRoot,
    mindRoot,
    executionCwd,
    agentConfig: {
      enableThinking,
      thinkingBudget,
      contextStrategy,
    },
    serverSettings,
    permissionPolicy,
    chatSessionId,
    agentMode,
    sessionContextMetadata,
    fileContextMetadata,
    sessionWorkDirPath: sessionContext.resolvedWorkDir.path,
    sessionSpaces: sessionContext.resolvedSelection.spaces.map((space) => space.path),
    sessionAssistants: sessionContext.resolvedSelection.assistants.map((assistant) => assistant.id),
    assistantId,
    requestSignal,
    stepLimit,
    t,
  });
}
