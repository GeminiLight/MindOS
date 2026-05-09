export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import path from 'path';
import { getFileContent, getMindRoot, collectAllFiles } from '@/lib/fs';
import { validateFileSize } from '@/lib/api-file-size-validation';
import { truncate } from '@/lib/agent/tools';
import type { AskModeApi } from '@/lib/types';
import { readSettings, readBaseUrlCompat, writeBaseUrlCompat } from '@/lib/settings';
import { en as i18nEn, zh as i18nZh } from '@/lib/i18n';
import { MindOSError, apiError, ErrorCodes } from '@/lib/errors';
import { performActiveRecall } from '@/lib/agent/active-recall';
import { metrics } from '@/lib/metrics';
import '@/lib/pi-integration/mcp-config'; // Injects --mcp-config argv before extension load
import { createSession, promptStream, closeSession } from '@/lib/acp/session';
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
  normalizeMindosAskMode,
  normalizeMindosAskStepLimit,
  resolveMindosAgentTimeoutMs,
  runMindosAcpAskSession,
  runMindosNonStreamingFallback,
  runMindosPiAgentAskSession,
} from '@geminilight/mindos/session';
import {
  buildMindosAskSystemPrompt,
  type MindosAskInitializationContext,
} from '@geminilight/mindos/agent';
import {
  resolveSkillFile,
  resolveSkillReference,
} from '@/lib/agent/skill-resolver';
import {
  createMindosPiCodingAgentRuntime,
} from '@geminilight/mindos/session/pi-coding-agent';
import {
  createWebMindosPiRuntimeHostServices,
  getMindosWebPiRuntimePaths,
  getMindosWebRequestTools,
} from '@/lib/agent/mindos-pi-runtime-host';

// generateSkillsXml is in lib/agent/skills-xml.ts (not inline: Next.js route export constraints)

function loadAttachedFileContext(
  attachedFiles: string[] | undefined,
  currentFile: string | undefined,
  mode: string,
): { contextParts: string[]; failedFiles: string[] } {
  return loadMindosAskFileContext(attachedFiles, currentFile, mode, {
    readFile: getFileContent,
    truncate,
    validateFileSize,
    warn: (message: string, error?: unknown) => console.warn(message, error instanceof Error ? error.message : error),
  });
}

/** Expand attachedFiles entries: directory paths (trailing /) become individual file paths. */
function expandAttachedFiles(raw: string[]): string[] {
  return expandMindosAskAttachedFiles(raw, collectAllFiles) ?? raw;
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
    /** Per-request provider override from the chat panel capsule */
    providerOverride?: string;
    /** Per-request model override from the inline model picker */
    modelOverride?: string;
  };
  try {
    body = await req.json();
  } catch {
    return apiError(ErrorCodes.INVALID_REQUEST, 'Invalid JSON body', 400);
  }

  const { messages, currentFile, attachedFiles: rawAttached, uploadedFiles, selectedAcpAgent } = body;
  const attachedFiles = Array.isArray(rawAttached) ? expandAttachedFiles(rawAttached) : rawAttached;
  const askMode: AskModeApi = normalizeMindosAskMode(body.mode);

  // Diagnostic: log attached files so silent failures are visible
  if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
    console.log(`[ask] mode=${askMode} attachedFiles=${JSON.stringify(attachedFiles)} currentFile=${currentFile ?? 'none'}`);
  }

  // Read agent config from settings
  const serverSettings = readSettings();
  const agentConfig = serverSettings.agent ?? {};

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
    messages,
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
    const runtimePaths = getMindosWebPiRuntimePaths({ projectRoot, mindRoot, serverSettings });
    const runtime = await createMindosPiCodingAgentRuntime({
      mode: askMode,
      messages,
      systemPrompt,
      providerOverride: body.providerOverride,
      modelOverride: typeof body.modelOverride === 'string' ? body.modelOverride : undefined,
      projectRoot,
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

        let hasContent = false;
        // ── Route to ACP agent if selected, otherwise use MindOS agent ──
        const runAgent = async () => {
          if (selectedAcpAgent) {
            await runMindosAcpAskSession({
              agentId: selectedAcpAgent.id,
              cwd: getMindRoot(),
              prompt: lastUserContent,
              signal: req.signal,
              timeoutMs: resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS),
              hasContent: () => hasContent,
              onVisibleContent: () => { hasContent = true; },
              send,
              createSession,
              promptStream: async (sessionId, prompt, onUpdate) => {
                await promptStream(sessionId, prompt, onUpdate);
              },
              closeSession,
              errorMessage: (error) => ((error as any).code === 'TIMEOUT'
                ? t.agentTimeout
                : `ACP Agent Error: ${error.message}`),
            });
            safeClose();
          } else {
            // Route to MindOS agent (existing logic)

            // ── Proxy compatibility check ──
            // If this baseUrl is known to reject stream+tools, skip session.prompt() entirely
            // and go straight to the non-streaming fallback path.
            const compatCache = readBaseUrlCompat();
            const effectiveBaseUrlKey = baseUrl || 'default';
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
              send,
              signal: req.signal,
              maxSteps: stepLimit,
            });

            await runMindosPiAgentAskSession({
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
              compatMode: compatCache[effectiveBaseUrlKey],
              send,
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
            });
            metrics.recordRequest(Date.now() - requestStartTime);
            safeClose();
          }
        };

        runAgent().catch((err) => {
          metrics.recordRequest(Date.now() - requestStartTime);
          metrics.recordError();
          
          // Produce user-friendly error messages for known failure modes
          let userMessage: string;
          if (err instanceof Error && (err as any).code === 'TIMEOUT') {
            userMessage = t.agentTimeout;
          } else {
            userMessage = err instanceof Error ? err.message : String(err);
          }
          
          send({ type: 'error', message: userMessage });
          safeClose();
        });
      },
    });

    return new Response(stream, {
      headers: MINDOS_SSE_HEADERS,
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
