export const dynamic = 'force-dynamic';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { isTransientError } from '@/lib/agent/retry';
import { retryDelay, sleep } from '@/lib/agent/reconnect';
import { detectLoop } from '@/lib/agent/loop-detection';
import {
  type AgentSessionEvent as AgentEvent,
  AuthStorage,
  convertToLlm,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  type ToolDefinition,
  type Skill,
  SessionManager,
  SettingsManager,
  bashTool,
} from '@mariozechner/pi-coding-agent';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getFileContent, getMindRoot, collectAllFiles } from '@/lib/fs';
import { getModelConfig, hasImages } from '@/lib/agent/model';
import { isProviderId, type ProviderId, toPiProvider } from '@/lib/agent/providers';
import { getRequestScopedTools, getOrganizeTools, getChatTools, WRITE_TOOLS, truncate } from '@/lib/agent/tools';
import { isCustomProviderId, findCustomProvider } from '@/lib/custom-endpoints';
import { AGENT_SYSTEM_PROMPT, ORGANIZE_SYSTEM_PROMPT, CHAT_SYSTEM_PROMPT } from '@/lib/agent/prompt';
import { estimateStringTokens, getOllamaContextWindow } from '@/lib/agent/context';
import type { AskModeApi } from '@/lib/types';
import { toAgentMessages } from '@/lib/agent/to-agent-messages';
import { logAgentOp } from '@/lib/agent/log';
import { readSettings, readBaseUrlCompat, writeBaseUrlCompat } from '@/lib/settings';
import { en as i18nEn, zh as i18nZh } from '@/lib/i18n';
import { MindOSError, apiError, ErrorCodes } from '@/lib/errors';
import { metrics } from '@/lib/metrics';
import { assertNotProtected } from '@/lib/core';
import { scanExtensionPaths } from '@/lib/pi-integration/extensions';

// Ensure pi-mcp-adapter reads MindOS's MCP config (~/.mindos/mcp.json) instead of its
// default (~/.pi/agent/mcp.json). getConfigPathFromArgv() in the adapter checks process.argv
// at module-load time, so this must run before DefaultResourceLoader.reload().
if (!process.argv.includes('--mcp-config')) {
  process.argv.push('--mcp-config', path.join(os.homedir(), '.mindos', 'mcp.json'));
}
import { createSession, promptStream, closeSession } from '@/lib/acp/session';
import type { AcpSessionUpdate } from '@/lib/acp/types';
import type { Message as FrontendMessage } from '@/lib/types';
import {
  type MindOSSSEvent,
  type TurnEndEvent,
  type AgentEndEvent,
  isTextDeltaEvent, getTextDelta,
  isThinkingDeltaEvent, getThinkingDelta,
  isToolExecutionStartEvent, getToolExecutionStart,
  isToolExecutionEndEvent, getToolExecutionEnd,
  isTurnEndEvent, getTurnEndData,
  sanitizeToolArgs,
} from '@/lib/sse/events';
import {
  resolveSkillFile,
  resolveSkillReference,
} from '@/lib/agent/skill-resolver';
import { generateSkillsXml } from '@/lib/agent/skills-xml';
import { runNonStreamingFallback } from '@/lib/agent/non-streaming';

const MAX_DIR_FILES = 30;

// generateSkillsXml is in lib/agent/skills-xml.ts (not inline: Next.js route export constraints)

/**
 * Load attached and current files into context parts for the system prompt.
 * Returns the context parts array and a list of file paths that failed to load.
 * Deduplicates files and logs failures with the given mode label.
 */
function loadAttachedFileContext(
  attachedFiles: string[] | undefined,
  currentFile: string | undefined,
  mode: string,
): { contextParts: string[]; failedFiles: string[] } {
  const contextParts: string[] = [];
  const failedFiles: string[] = [];
  const seen = new Set<string>();

  if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
    for (const filePath of attachedFiles) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      try {
        const content = truncate(getFileContent(filePath));
        contextParts.push(`## Attached: ${filePath}\n\n${content}`);
      } catch (err) {
        console.warn(`[ask] ${mode}: failed to read attached file "${filePath}":`, err instanceof Error ? err.message : err);
        failedFiles.push(filePath);
      }
    }
  }

  if (currentFile && !seen.has(currentFile)) {
    seen.add(currentFile);
    try {
      const content = truncate(getFileContent(currentFile));
      contextParts.push(`## Current file: ${currentFile}\n\n${content}`);
    } catch (err) {
      console.warn(`[ask] ${mode}: failed to read currentFile "${currentFile}":`, err instanceof Error ? err.message : err);
      failedFiles.push(currentFile);
    }
  }

  return { contextParts, failedFiles };
}

/** Expand attachedFiles entries: directory paths (trailing /) become individual file paths. */
function expandAttachedFiles(raw: string[]): string[] {
  const result: string[] = [];
  const allFiles = collectAllFiles();
  for (const entry of raw) {
    if (entry.endsWith('/')) {
      const prefix = entry;
      let count = 0;
      for (const f of allFiles) {
        if (f.startsWith(prefix) && ++count <= MAX_DIR_FILES) result.push(f);
      }
    } else {
      result.push(entry);
    }
  }
  return result;
}

/** Safe JSON parse — returns {} on invalid input */
function safeParseJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// SSE types, type guards, sanitizeToolArgs → @/lib/sse/events

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
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

function textToolResult(text: string): AgentToolResult<Record<string, never>> {
  return { content: [{ type: 'text', text }], details: {} };
}

function getProtectedPaths(toolName: string, args: Record<string, unknown>): string[] {
  const pathsToCheck: string[] = [];
  if (toolName === 'batch_create_files' && Array.isArray(args.files)) {
    (args.files as Array<{ path?: string }>).forEach((f) => { if (f.path) pathsToCheck.push(f.path); });
  } else {
    const singlePath = (args.path ?? args.from_path) as string | undefined;
    if (typeof singlePath === 'string') pathsToCheck.push(singlePath);
  }
  return pathsToCheck;
}

function toPiCustomToolDefinitions(tools: AgentTool<any>[]): ToolDefinition<any, unknown>[] {
  return tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters as Record<string, unknown>,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const args = (params ?? {}) as Record<string, unknown>;

      if (WRITE_TOOLS.has(tool.name)) {
        for (const filePath of getProtectedPaths(tool.name, args)) {
          try {
            assertNotProtected(filePath, 'modified by AI agent');
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return textToolResult(`Write-protection error: ${errorMsg}. You CANNOT modify ${filePath} because it is system-protected. Please tell the user you don't have permission to do this.`);
          }
        }
      }

      const result = await tool.execute(toolCallId, params, signal, onUpdate as any);
      const outputText = result?.content
        ?.filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('') ?? '';

      try {
        logAgentOp({
          ts: new Date().toISOString(),
          tool: tool.name,
          params: args,
          result: outputText.startsWith('Error:') ? 'error' : 'ok',
          message: outputText.slice(0, 200),
          agentName: 'MindOS',
        });
      } catch {
        // logging must never kill the stream
      }

      return result;
    },
  }));
}

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
  const askMode: AskModeApi = body.mode === 'organize' ? 'organize'
    : body.mode === 'chat' ? 'chat'
    : 'agent';

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
  const defaultMaxSteps = askMode === 'chat' ? 8 : (agentConfig.maxSteps ?? 20);
  const stepLimit = Number.isFinite(body.maxSteps)
    ? Math.min(30, Math.max(1, Number(body.maxSteps)))
    : Math.min(30, Math.max(1, defaultMaxSteps));
  const enableThinking = agentConfig.enableThinking ?? false;
  const thinkingBudget = agentConfig.thinkingBudget ?? 5000;
  const contextStrategy = agentConfig.contextStrategy ?? 'auto';

  // Uploaded files — shared by all modes
  // These are already truncated client-side (80K limit), so only apply a generous
  // server-side cap to guard against malformed requests.
  const UPLOADED_FILE_MAX = 100_000;
  const uploadedParts: string[] = [];
  if (Array.isArray(uploadedFiles) && uploadedFiles.length > 0) {
    for (const f of uploadedFiles.slice(0, 8)) {
      if (!f || typeof f.name !== 'string' || typeof f.content !== 'string') continue;
      const content = f.content.length > UPLOADED_FILE_MAX
        ? f.content.slice(0, UPLOADED_FILE_MAX) + '\n\n[...truncated]'
        : f.content;
      uploadedParts.push(`### ${f.name}\n\n${content}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Build system prompt — three-way split by askMode
  // ---------------------------------------------------------------------------
  let systemPrompt: string;

  if (askMode === 'organize') {
    // Organize mode: minimal prompt — only KB structure + attached/uploaded files
    const promptParts: string[] = [ORGANIZE_SYSTEM_PROMPT];

    promptParts.push(`---\n\nmind_root=${getMindRoot()}`);

    // Only load root README.md for KB structure awareness (skip SKILL.md, configs, target dir, time, etc.)
    const bootstrapIndex = readKnowledgeFile('README.md');
    if (bootstrapIndex.ok) {
      promptParts.push(`---\n\n## Knowledge Base Structure\n\n${bootstrapIndex.content}`);
    }

    // Include attached KB files (@ mentions) — same pattern as chat/agent modes
    const { contextParts, failedFiles } = loadAttachedFileContext(attachedFiles, currentFile, 'organize');
    if (contextParts.length > 0) {
      promptParts.push(`---\n\nThe user is currently viewing these files:\n\n${contextParts.join('\n\n---\n\n')}`);
    }
    if (failedFiles.length > 0) {
      promptParts.push(`---\n\n⚠️ The following attached files could not be read: ${failedFiles.join(', ')}. Inform the user that these files were not loaded.`);
    }

    if (uploadedParts.length > 0) {
      promptParts.push(
        `---\n\n## ⚠️ USER-UPLOADED FILES\n\n` +
        `Their FULL CONTENT is below. Use this directly — do NOT call read tools on them.\n\n` +
        uploadedParts.join('\n\n---\n\n'),
      );
    }

    systemPrompt = promptParts.join('\n\n');
  } else if (askMode === 'chat') {
    // Chat mode: lean prompt with read-only KB access.
    // Skips: SKILL.md, bootstrap INSTRUCTION/CONFIG, write-supplement, target dir context.
    // Keeps: KB structure (README.md), time, current/attached files, uploaded files.
    const promptParts: string[] = [CHAT_SYSTEM_PROMPT];

    promptParts.push(`---\n\nmind_root=${getMindRoot()}`);

    const bootstrapIndex = readKnowledgeFile('README.md');
    if (bootstrapIndex.ok && bootstrapIndex.content.trim().length > 10) {
      promptParts.push(`---\n\n## Knowledge Base Structure\n\n${bootstrapIndex.content}`);
    }

    const now = new Date();
    promptParts.push(`---\n\n## Current Time Context\n- Current UTC Time: ${now.toISOString()}\n- System Local Time: ${new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long' }).format(now)}`);

    const { contextParts, failedFiles } = loadAttachedFileContext(attachedFiles, currentFile, 'chat');
    if (contextParts.length > 0) {
      promptParts.push(`---\n\nThe user is currently viewing these files:\n\n${contextParts.join('\n\n---\n\n')}`);
    }
    if (failedFiles.length > 0) {
      promptParts.push(`---\n\n⚠️ The following attached files could not be read: ${failedFiles.join(', ')}. Inform the user that these files were not loaded.`);
    }

    if (uploadedParts.length > 0) {
      promptParts.push(
        `---\n\n## ⚠️ USER-UPLOADED FILES\n\n` +
        `Their FULL CONTENT is below. Use this directly — do NOT call read tools on them.\n\n` +
        uploadedParts.join('\n\n---\n\n'),
      );
    }

    systemPrompt = promptParts.join('\n\n');
  } else {
    // Agent mode: full prompt assembly
    // Auto-load skill + bootstrap context for each request.
    const isZh = serverSettings.disabledSkills?.includes('mindos') ?? false;
    const skillDirName = isZh ? 'mindos-zh' : 'mindos';
    const projectRoot = process.env.MINDOS_PROJECT_ROOT || path.resolve(process.cwd(), '..');
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

    const initStatus = initFailures.length === 0
      ? `All initialization contexts loaded successfully. mind_root=${getMindRoot()}${targetDir ? `, target_dir=${targetDir}` : ''}${truncationWarnings.length > 0 ? ` ⚠️ ${truncationWarnings.length} files truncated` : ''}`
      : `Initialization issues:\n${initFailures.join('\n')}\nmind_root=${getMindRoot()}${targetDir ? `, target_dir=${targetDir}` : ''}${truncationWarnings.length > 0 ? `\n⚠️ Warnings:\n${truncationWarnings.join('\n')}` : ''}`;

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

    // Build initial context from attached/current files
    const { contextParts, failedFiles } = loadAttachedFileContext(attachedFiles, currentFile, 'agent');

    const now = new Date();
    const timeContext = `## Current Time Context
- Current UTC Time: ${now.toISOString()}
- System Local Time: ${new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long' }).format(now)}
- Unix Timestamp: ${Math.floor(now.getTime() / 1000)}

*Note: The times listed above represent "NOW". The user may have sent messages hours or days ago in this same conversation thread. Each user message in the history contains its own specific timestamp which you should refer to when understanding historical context.*`;

    const promptParts: string[] = [AGENT_SYSTEM_PROMPT];
    promptParts.push(`---\n\n${timeContext}`);
    // Only inject initStatus when there are failures or truncation warnings.
    // On the happy path (~99% of requests) this saves ~100 tokens.
    if (initFailures.length > 0 || truncationWarnings.length > 0) {
      promptParts.push(`---\n\nInitialization status (auto-loaded at request start):\n\n${initStatus}`);
    }

    if (initContextBlocks.length > 0) {
      promptParts.push(`---\n\nInitialization context:\n\n${initContextBlocks.join('\n\n---\n\n')}`);
    }

    if (contextParts.length > 0) {
      promptParts.push(`---\n\nThe user is currently viewing these files:\n\n${contextParts.join('\n\n---\n\n')}`);
    }
    if (failedFiles.length > 0) {
      promptParts.push(`---\n\n⚠️ The following attached files could not be read: ${failedFiles.join(', ')}. Inform the user that these files were not loaded.`);
    }

    if (uploadedParts.length > 0) {
      promptParts.push(
        `---\n\n## ⚠️ USER-UPLOADED FILES (ACTIVE ATTACHMENTS)\n\n` +
        `The user has uploaded the following file(s) in this conversation. ` +
        `Their FULL CONTENT is provided below. You MUST use this content directly when the user refers to these files. ` +
        `Do NOT use read_file or search tools to find them — they exist only here, not in the knowledge base.\n\n` +
        uploadedParts.join('\n\n---\n\n'),
      );
    }

    systemPrompt = promptParts.join('\n\n');
  }

  // Log system prompt size for diagnosing context truncation issues (e.g. Ollama)
  console.log(`[ask] mode=${askMode} systemPrompt=${systemPrompt.length} chars (~${Math.ceil(systemPrompt.length / 4)} tokens)`);

  try {
    let provOverride: ProviderId | undefined;
    let customProviderConfig: { apiKey: string; model: string; baseUrl: string } | undefined;

    // Handle custom provider (cp_*) or built-in provider override
    if (body.providerOverride) {
      if (isCustomProviderId(body.providerOverride)) {
        const settings = readSettings();
        const customProvider = findCustomProvider(settings.ai.providers ?? [], body.providerOverride);
        if (!customProvider) {
          return apiError(ErrorCodes.INVALID_REQUEST, 'Custom provider not found', 400);
        }
        provOverride = customProvider.protocol;
        customProviderConfig = {
          apiKey: customProvider.apiKey,
          model: customProvider.model,
          baseUrl: customProvider.baseUrl,
        };
      } else if (isProviderId(body.providerOverride)) {
        provOverride = body.providerOverride as ProviderId;
      }
    }

    // Per-request model override (from chat capsule model picker)
    const modelOverride = (body.modelOverride && typeof body.modelOverride === 'string')
      ? body.modelOverride.trim() : undefined;

    const { model, modelName, apiKey, provider, baseUrl } = getModelConfig({
      provider: provOverride,
      apiKey: customProviderConfig?.apiKey,
      model: modelOverride ?? customProviderConfig?.model,
      baseUrl: customProviderConfig?.baseUrl,
      hasImages: hasImages(messages),
    });

    // ── Ollama context window guard ──
    // Ollama silently truncates input that exceeds the model's actual context window.
    // Detect this and compact the system prompt to prevent attached files from being dropped.
    if (provider === 'ollama') {
      const ollamaBase = baseUrl || 'http://localhost:11434/v1';
      const actualCtx = await getOllamaContextWindow(ollamaBase, modelName);
      const promptTokens = estimateStringTokens(systemPrompt);
      // Reserve ~30% of context for conversation history + model output
      const maxPromptTokens = actualCtx ? Math.floor(actualCtx * 0.7) : undefined;

      if (actualCtx) {
        console.log(`[ask] Ollama model="${modelName}" context=${actualCtx} promptTokens=${promptTokens} maxPromptTokens=${maxPromptTokens}`);
      }

      if (maxPromptTokens && promptTokens > maxPromptTokens) {
        console.warn(`[ask] Ollama context overflow: prompt ${promptTokens} tokens > ${maxPromptTokens} max (${actualCtx} ctx). Compacting...`);
        // Compact by progressively stripping lower-priority sections from system prompt.
        // Priority order (keep first, strip last):
        //   1. Core system prompt (AGENT/CHAT/ORGANIZE base) — must keep
        //   2. Attached/current file content — user explicitly requested these
        //   3. KB structure (README.md) — important for navigation
        //   4. Time context — low priority
        //   5. SKILL.md + write-supplement — largest sections, can be stripped
        //   6. bootstrap INSTRUCTION/CONFIG — can be stripped for local models

        // Strategy: strip sections between "---" delimiters from the end,
        // but preserve sections containing "Attached:" or "Current file:" or "USER-UPLOADED"
        const sections = systemPrompt.split('\n\n---\n\n');
        const preserved: string[] = [];
        let currentTokens = 0;

        for (const section of sections) {
          const sectionTokens = estimateStringTokens(section);
          const isAttachment = section.includes('## Attached:') || section.includes('## Current file:') || section.includes('USER-UPLOADED');
          const isCore = preserved.length === 0; // first section = base system prompt

          if (isCore || isAttachment) {
            // Always keep core prompt and user attachments
            preserved.push(section);
            currentTokens += sectionTokens;
          } else if (currentTokens + sectionTokens <= maxPromptTokens) {
            preserved.push(section);
            currentTokens += sectionTokens;
          } else {
            console.log(`[ask] Ollama compact: stripping section (${sectionTokens} tokens): ${section.slice(0, 80)}...`);
          }
        }

        systemPrompt = preserved.join('\n\n---\n\n');
        console.log(`[ask] Ollama compacted: ${promptTokens} → ${estimateStringTokens(systemPrompt)} tokens`);
      }
    }

    // Convert frontend messages to AgentMessage[]
    const agentMessages = toAgentMessages(messages);

    // Extract the last user message for agent.prompt()
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    const lastUserContent = lastMsg?.role === 'user' ? lastMsg.content : '';
    // Extract images for prompt options (pi-ai ImageContent format, skip stripped)
    const lastUserImages = lastMsg?.role === 'user' && lastMsg.images?.length
      ? lastMsg.images.filter((img: any) => img.data).map((img: any) => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType }))
      : undefined;

    // History = all messages except the last user message (agent.prompt adds it)
    const historyMessages = agentMessages.slice(0, -1);

    // Capture API key for this request — safe since each POST creates a new Agent instance.
    const requestApiKey = apiKey;
    const projectRoot = process.env.MINDOS_PROJECT_ROOT || path.resolve(process.cwd(), '..');
    const requestTools = askMode === 'organize' ? getOrganizeTools()
      : askMode === 'chat' ? getChatTools()
      : getRequestScopedTools();
    const customTools = toPiCustomToolDefinitions(requestTools);

    const authStorage = AuthStorage.create();
    authStorage.setRuntimeApiKey(toPiProvider(provider), requestApiKey);
    const modelRegistry = new ModelRegistry(authStorage);
    const settingsManager = SettingsManager.inMemory({
      enableSkillCommands: true,
      ...(enableThinking && provider === 'anthropic' ? { thinkingBudgets: { medium: thinkingBudget } } : {}),
      ...(contextStrategy === 'off' ? { compaction: { enabled: false } } : {}),
    });

    const CORE_SKILL_NAMES = new Set(['mindos', 'mindos-zh', 'mindos-max', 'mindos-max-zh']);
    const resourceLoader = new DefaultResourceLoader({
      cwd: projectRoot,
      settingsManager,
      systemPromptOverride: () => systemPrompt,
      appendSystemPromptOverride: () => [],
      agentsFilesOverride: () => ({ agentsFiles: [] }),
      skillsOverride: (result) => ({
        ...result,
        skills: result.skills.filter((s) => !CORE_SKILL_NAMES.has(s.name)),
      }),
      additionalSkillPaths: [
        path.join(projectRoot, 'app', 'data', 'skills'),
        path.join(projectRoot, 'skills'),
        path.join(getMindRoot(), '.skills'),
        path.join(os.homedir(), '.mindos', 'skills'),
      ],
      additionalExtensionPaths: [
        ...scanExtensionPaths(),
        // pi-mcp-adapter: token-efficient MCP proxy tool (~200 tokens vs N*150 full tool defs)
        path.join(projectRoot, 'app', 'node_modules', 'pi-mcp-adapter', 'index.ts'),
        // IM extension: 8-platform IM integration (Telegram, Feishu, Discord, Slack, etc.)
        path.join(projectRoot, 'app', 'lib', 'im', 'index.ts'),
      ],
    });
    await resourceLoader.reload();

    // Inject third-party skill list into system prompt (agent mode only).
    // Core skills are already injected as full content; third-party skills
    // get a name+description summary so the LLM can discover and load them.
    // Must reload() again because the closure captured systemPrompt before mutation.
    if (askMode === 'agent') {
      const { skills: discoveredSkills } = resourceLoader.getSkills();
      const thirdPartySkills = discoveredSkills.filter(
        (s: Skill) => !s.disableModelInvocation
      );
      if (thirdPartySkills.length > 0) {
        systemPrompt += '\n\n---\n\n' + generateSkillsXml(thirdPartySkills);
        await resourceLoader.reload();
      }
    }

    const { session } = await createAgentSession({
      cwd: projectRoot,
      model,
      thinkingLevel: (enableThinking && provider === 'anthropic') ? 'medium' : 'off',
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
      tools: askMode === 'agent' ? [bashTool] : [],
      customTools,
    });

    const llmHistoryMessages = convertToLlm(historyMessages);
    await session.newSession({
      setup: async (sessionManager) => {
        for (const message of llmHistoryMessages) {
          sessionManager.appendMessage(message);
        }
      },
    });

    // ── Loop detection state ──
    const stepHistory: Array<{ tool: string; input: string }> = [];
    let stepCount = 0;
    let loopCooldown = 0;

    // ── SSE Stream ──
    const encoder = new TextEncoder();
    const requestStartTime = Date.now();
    const stream = new ReadableStream({
      start(controller) {
        let streamClosed = false;
        function send(event: MindOSSSEvent) {
          if (streamClosed) return;
          try {
            controller.enqueue(encoder.encode(`data:${JSON.stringify(event)}\n\n`));
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
        let lastModelError = '';
        const effectiveBaseUrlKey = baseUrl || 'default';

        session.subscribe((event: AgentEvent) => {
          if (isTextDeltaEvent(event)) {
            hasContent = true;
            send({ type: 'text_delta', delta: getTextDelta(event) });
          } else if (isThinkingDeltaEvent(event)) {
            hasContent = true;
            send({ type: 'thinking_delta', delta: getThinkingDelta(event) });
          } else if (isToolExecutionStartEvent(event)) {
            hasContent = true;
            const { toolCallId, toolName, args } = getToolExecutionStart(event);
            const safeArgs = sanitizeToolArgs(toolName, args);
            send({
              type: 'tool_start',
              toolCallId,
              toolName,
              args: safeArgs,
            });
          } else if (isToolExecutionEndEvent(event)) {
            const { toolCallId, output, isError } = getToolExecutionEnd(event);
            metrics.recordToolExecution();
            send({
              type: 'tool_end',
              toolCallId,
              output,
              isError,
            });
          } else if (isTurnEndEvent(event)) {
            stepCount++;

            // Record token usage if available from the turn
            const turnUsage = (event as TurnEndEvent).usage;
            if (turnUsage && typeof turnUsage.inputTokens === 'number') {
              metrics.recordTokens(turnUsage.inputTokens, turnUsage.outputTokens ?? 0);
            }

            // Track tool calls for loop detection (lock-free batch update).
            // Deterministic JSON.stringify ensures consistent input comparison.
            const { toolResults } = getTurnEndData(event);
            if (Array.isArray(toolResults) && toolResults.length > 0) {
              const newEntries = toolResults.map(tr => ({
                tool: tr.toolName ?? 'unknown',
                input: JSON.stringify(tr.content, null, 0), // Deterministic (no whitespace)
              }));
              stepHistory.push(...newEntries);
            }

            // Loop detection: (1) same tool+args 3x in a row, (2) repeating pattern cycle
            if (loopCooldown > 0) {
              loopCooldown--;
            } else if (detectLoop(stepHistory)) {
              loopCooldown = 3;
              void session.steer('[SYSTEM WARNING] You appear to be in a loop — repeating the same tool calls in a cycle. Try a completely different approach or ask the user for clarification.');
            }

            // Step limit enforcement
            if (stepCount >= stepLimit) {
              void session.abort();
            }

            // Step count logged in dev only to avoid polluting production output
            if (process.env.NODE_ENV === 'development') console.log(`[ask] Step ${stepCount}/${stepLimit}`);
          } else if (event.type === 'agent_end') {
            // Capture model errors from the last assistant message.
            // pi-coding-agent resolves prompt() without throwing after retries;
            // the error is only visible in agent_end event messages.
            const msgs = (event as AgentEndEvent).messages;
            if (Array.isArray(msgs)) {
              for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                if (m?.role === 'assistant' && m?.stopReason === 'error' && m?.errorMessage) {
                  lastModelError = m.errorMessage;
                  break;
                }
              }
            }
          }
        });

        // ── Route to ACP agent if selected, otherwise use MindOS agent ──
        const runAgent = async () => {
          if (selectedAcpAgent) {
            // Route to ACP agent with real-time streaming.
            // Retry with exponential backoff on transient failures, same as the MindOS path.
            // Only retry if no content has been streamed yet.
            const ACP_MAX_RETRIES = 3;
            let acpSessionId: string | undefined;
            let lastAcpError: Error | null = null;

            try {
              for (let attempt = 1; attempt <= ACP_MAX_RETRIES; attempt++) {
                // Close any previous session before retrying
                if (acpSessionId) {
                  await closeSession(acpSessionId).catch(() => {});
                  acpSessionId = undefined;
                }
                try {
                  const acpSession = await createSession(selectedAcpAgent.id, {
                    cwd: getMindRoot(),
                  });
                  acpSessionId = acpSession.id;

                  await promptStream(acpSessionId, lastUserContent, (update: AcpSessionUpdate) => {
                    switch (update.type) {
                      // Text chunks → standard text_delta
                      case 'agent_message_chunk':
                      case 'text':
                        if (update.text) {
                          hasContent = true;
                          send({ type: 'text_delta', delta: update.text });
                        }
                        break;

                      // Agent thinking → thinking_delta (reuses existing Anthropic thinking UI)
                      case 'agent_thought_chunk':
                        if (update.text) {
                          hasContent = true;
                          send({ type: 'thinking_delta', delta: update.text });
                        }
                        break;

                      // Tool calls → tool_start (reuses existing tool call UI)
                      case 'tool_call':
                        if (update.toolCall) {
                          hasContent = true;
                          send({
                            type: 'tool_start',
                            toolCallId: update.toolCall.toolCallId,
                            toolName: update.toolCall.title ?? update.toolCall.kind ?? 'tool',
                            args: safeParseJson(update.toolCall.rawInput),
                          });
                        }
                        break;

                      // Tool call updates → tool_end when completed/failed
                      case 'tool_call_update':
                        if (update.toolCall && (update.toolCall.status === 'completed' || update.toolCall.status === 'failed')) {
                          send({
                            type: 'tool_end',
                            toolCallId: update.toolCall.toolCallId,
                            output: update.toolCall.rawOutput ?? '',
                            isError: update.toolCall.status === 'failed',
                          });
                        }
                        break;

                      // Plan → emit as text with structured format
                      case 'plan':
                        if (update.plan?.entries) {
                          const planText = update.plan.entries
                            .map(e => {
                              const icon = e.status === 'completed' ? '\u2705' : e.status === 'in_progress' ? '\u26a1' : '\u23f3';
                              return `${icon} ${e.content}`;
                            })
                            .join('\n');
                          hasContent = true; // plan text is visible — prevents retry after partial output
                          send({ type: 'text_delta', delta: `\n\n${planText}\n\n` });
                        }
                        break;

                      // Error → stream error (suppress further output — promptStream may also throw)
                      case 'error':
                        if (!hasContent) {
                          // Only forward if nothing streamed yet; otherwise the error is already surfaced via content
                          send({ type: 'error', message: update.error ?? 'ACP agent error' });
                        }
                        break;
                    }
                  });

                  lastAcpError = null;
                  break; // success
                } catch (acpErr) {
                  lastAcpError = acpErr instanceof Error ? acpErr : new Error(String(acpErr));

                  // Close the failed session before sleeping (loop-top close handles subsequent attempts)
                  if (acpSessionId) {
                    await closeSession(acpSessionId).catch(() => {});
                    acpSessionId = undefined;
                  }

                  // Only retry if: (1) no content streamed yet, (2) retries remaining, (3) transient error
                  const canRetry = !hasContent && attempt < ACP_MAX_RETRIES && isTransientError(lastAcpError);
                  if (!canRetry) break;

                  const delayMs = retryDelay(attempt); // exponential: 2s, 4s, 8s…
                  send({ type: 'status', message: `Request failed, retrying (${attempt}/${ACP_MAX_RETRIES})...` });
                  await sleep(delayMs, req.signal); // abort early if client disconnects
                }
              }
            } finally {
              // Guarantee session cleanup regardless of how the loop exits (including AbortError from sleep)
              if (acpSessionId) {
                await closeSession(acpSessionId).catch(() => {});
              }
            }

            if (lastAcpError) {
              send({ type: 'error', message: `ACP Agent Error: ${lastAcpError.message}` });
            } else {
              send({ type: 'done' });
            }
            safeClose();
          } else {
            // Route to MindOS agent (existing logic)

            // ── Proxy compatibility check ──
            // If this baseUrl is known to reject stream+tools, skip session.prompt() entirely
            // and go straight to the non-streaming fallback path.
            const compatCache = readBaseUrlCompat();
            if (compatCache[effectiveBaseUrlKey] === 'non-streaming' && baseUrl && provider === 'openai') {
              send({ type: 'status', message: t.proxyCompatMode });
              try {
                await runNonStreamingFallback({
                  baseUrl,
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
                metrics.recordRequest(Date.now() - requestStartTime);
                send({ type: 'done' });
              } catch (fallbackErr) {
                metrics.recordRequest(Date.now() - requestStartTime);
                send({ type: 'error', message: t.proxyCompatFailed(fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)) });
              }
              safeClose();
              return;
            }

            // Retry with exponential backoff for transient failures (timeout, rate limit, 5xx).
            // Only retry if no content has been streamed yet — once the user sees partial
            // output, retrying would produce duplicate/garbled content.
            const MAX_RETRIES = 3;
            let lastPromptError: Error | null = null;

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
              try {
                await session.prompt(lastUserContent, lastUserImages ? { images: lastUserImages } : undefined);
                lastPromptError = null;
                break; // success
              } catch (err) {
                lastPromptError = err instanceof Error ? err : new Error(String(err));

                // Only retry if: (1) no content streamed yet, (2) retries remaining, (3) transient error
                // `attempt < MAX_RETRIES`: on attempt 3 (last), don't retry — let it throw.
                const canRetry = !hasContent && attempt < MAX_RETRIES && isTransientError(lastPromptError);
                if (!canRetry) break;

                const delayMs = retryDelay(attempt); // exponential: 2s, 4s, 8s…
                send({ type: 'status', message: `Request failed, retrying (${attempt}/${MAX_RETRIES})...` });
                await sleep(delayMs, req.signal); // abort early if client disconnects
              }
            }

            if (lastPromptError) throw lastPromptError;

            metrics.recordRequest(Date.now() - requestStartTime);
            if (!hasContent && (lastModelError || (baseUrl && provider === 'openai'))) {
              // No content received — either a model error or proxy compatibility issue.
              // For OpenAI-compatible endpoints with custom baseUrl, always try the fallback
              // even without an explicit error (some proxies silently return empty responses).
              if (baseUrl && provider === 'openai') {
                send({ type: 'status', message: lastModelError ? t.proxyCompatDetecting : t.proxyCompatMode });
                try {
                  await runNonStreamingFallback({
                    baseUrl,
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
                  // Success → cache this endpoint as non-streaming so future requests skip the probe
                  writeBaseUrlCompat(effectiveBaseUrlKey, 'non-streaming');
                  console.log(`[ask] Proxy compat detected: ${effectiveBaseUrlKey} → non-streaming (cached)`);
                  send({ type: 'done' });
                } catch (fallbackErr) {
                  send({ type: 'error', message: t.proxyCompatAlsoFailed(fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)) });
                }
              } else {
                send({ type: 'error', message: lastModelError });
              }
            } else {
              send({ type: 'done' });
            }
            safeClose();
          }
        };

        runAgent().catch((err) => {
          metrics.recordRequest(Date.now() - requestStartTime);
          metrics.recordError();
          send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
          safeClose();
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[ask] Failed to initialize model:', err);
    if (err instanceof MindOSError) {
      return apiError(err.code, err.message);
    }
    return apiError(ErrorCodes.MODEL_INIT_FAILED, err instanceof Error ? err.message : 'Failed to initialize AI model', 500);
  }
}

