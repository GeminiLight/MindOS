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
  SessionManager,
  SettingsManager,
} from '@mariozechner/pi-coding-agent';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getFileContent, getMindRoot } from '@/lib/fs';
import { getModelConfig, hasImages } from '@/lib/agent/model';
import { getRequestScopedTools, getOrganizeTools, WRITE_TOOLS, truncate } from '@/lib/agent/tools';
import { AGENT_SYSTEM_PROMPT, ORGANIZE_SYSTEM_PROMPT } from '@/lib/agent/prompt';
import { toAgentMessages } from '@/lib/agent/to-agent-messages';
import { logAgentOp } from '@/lib/agent/log';
import { readSettings } from '@/lib/settings';
import { MindOSError, apiError, ErrorCodes } from '@/lib/errors';
import { metrics } from '@/lib/metrics';
import { assertNotProtected } from '@/lib/core';
import { scanExtensionPaths } from '@/lib/pi-integration/extensions';
import { createSession, promptStream, closeSession } from '@/lib/acp/session';
import type { AcpSessionUpdate } from '@/lib/acp/types';
import type { Message as FrontendMessage } from '@/lib/types';

/** Safe JSON parse — returns {} on invalid input */
function safeParseJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// ---------------------------------------------------------------------------
// MindOS SSE format — 6 event types (front-back contract)
// ---------------------------------------------------------------------------

type MindOSSSEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; toolCallId: string; output: string; isError: boolean }
  | { type: 'done'; usage?: { input: number; output: number } }
  | { type: 'error'; message: string }
  | { type: 'status'; message: string };

// ---------------------------------------------------------------------------
// Type Guards for AgentEvent variants (safe event handling)
// AgentEvent from pi-coding-agent is a union; these interfaces describe the
// actual shapes that arrive at runtime for each event.type.
// ---------------------------------------------------------------------------

/** Fields present on message_update events (text_delta / thinking_delta). */
type MessageUpdateEvent = AgentEvent & {
  type: 'message_update';
  assistantMessageEvent?: { type: string; delta?: string };
};

/** Fields present on tool_execution_start events. */
type ToolExecStartEvent = AgentEvent & {
  type: 'tool_execution_start';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
};

/** Fields present on tool_execution_end events. */
type ToolExecEndEvent = AgentEvent & {
  type: 'tool_execution_end';
  toolCallId?: string;
  result?: { content?: Array<{ type: string; text?: string }> };
  isError?: boolean;
};

/** Fields present on turn_end events. */
type TurnEndEvent = AgentEvent & {
  type: 'turn_end';
  toolResults?: Array<{ toolName: string; content: unknown }>;
  usage?: { inputTokens: number; outputTokens?: number };
};

/** Fields present on agent_end events. */
type AgentEndEvent = AgentEvent & {
  type: 'agent_end';
  messages?: Array<{ role: string; content?: Array<{ type: string; text?: string }> }>;
};

function isTextDeltaEvent(e: AgentEvent): e is MessageUpdateEvent {
  return e.type === 'message_update' && (e as MessageUpdateEvent).assistantMessageEvent?.type === 'text_delta';
}

function getTextDelta(e: AgentEvent): string {
  return (e as MessageUpdateEvent).assistantMessageEvent?.delta ?? '';
}

function isThinkingDeltaEvent(e: AgentEvent): e is MessageUpdateEvent {
  return e.type === 'message_update' && (e as MessageUpdateEvent).assistantMessageEvent?.type === 'thinking_delta';
}

function getThinkingDelta(e: AgentEvent): string {
  return (e as MessageUpdateEvent).assistantMessageEvent?.delta ?? '';
}

function isToolExecutionStartEvent(e: AgentEvent): e is ToolExecStartEvent {
  return e.type === 'tool_execution_start';
}

function getToolExecutionStart(e: AgentEvent): { toolCallId: string; toolName: string; args: unknown } {
  const evt = e as ToolExecStartEvent;
  return {
    toolCallId: evt.toolCallId ?? '',
    toolName: evt.toolName ?? 'unknown',
    args: evt.args ?? {},
  };
}

function isToolExecutionEndEvent(e: AgentEvent): e is ToolExecEndEvent {
  return e.type === 'tool_execution_end';
}

function getToolExecutionEnd(e: AgentEvent): { toolCallId: string; output: string; isError: boolean } {
  const evt = e as ToolExecEndEvent;
  const outputText = evt.result?.content
    ?.filter((p: { type: string; text?: string }) => p.type === 'text')
    .map((p: { type: string; text?: string }) => p.text ?? '')
    .join('') ?? '';
  return {
    toolCallId: evt.toolCallId ?? '',
    output: outputText,
    isError: !!evt.isError,
  };
}

function isTurnEndEvent(e: AgentEvent): e is TurnEndEvent {
  return e.type === 'turn_end';
}

function getTurnEndData(e: AgentEvent): { toolResults: Array<{ toolName: string; content: unknown }> } {
  return {
    toolResults: (e as TurnEndEvent).toolResults ?? [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip large fields (file content) from tool args before SSE serialization.
 * The client only needs path/name for progress display, not the full content.
 * This prevents JSON.stringify failures on oversized payloads.
 */
function sanitizeToolArgs(toolName: string, args: unknown): unknown {
  if (!args || typeof args !== 'object') return args;
  const a = args as Record<string, unknown>;

  if (toolName === 'batch_create_files' && Array.isArray(a.files)) {
    return {
      ...a,
      files: (a.files as Array<Record<string, unknown>>).map(f => ({
        path: f.path,
        ...(f.description ? { description: f.description } : {}),
      })),
    };
  }

  if (typeof a.content === 'string' && a.content.length > 200) {
    return { ...a, content: `[${a.content.length} chars]` };
  }
  if (typeof a.text === 'string' && a.text.length > 200) {
    return { ...a, text: `[${a.text.length} chars]` };
  }
  return args;
}

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

/**
 * In-memory cache for absolute file reads (SKILL.md, etc).
 * Keyed by absPath. Re-reads only when file mtime changes.
 * Avoids redundant disk IO on every agent request (~5-10ms saved per call).
 */
const _absFileCache = new Map<string, { mtimeMs: number; result: ReturnType<typeof readAbsoluteFile> }>();

function readAbsoluteFile(absPath: string): { ok: boolean; content: string; truncated: boolean; error?: string } {
  try {
    const stat = fs.statSync(absPath);
    const cached = _absFileCache.get(absPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.result;
    }

    const raw = fs.readFileSync(absPath, 'utf-8');
    let result: ReturnType<typeof readAbsoluteFile>;
    if (raw.length > 20_000) {
      result = { ok: true, content: truncate(raw), truncated: true, error: undefined };
    } else {
      result = { ok: true, content: raw, truncated: false };
    }
    _absFileCache.set(absPath, { mtimeMs: stat.mtimeMs, result });
    return result;
  } catch (err) {
    // File not found / unreadable — clear cache entry if any
    _absFileCache.delete(absPath);
    return {
      ok: false,
      content: '',
      truncated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

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
        });
      } catch {
        // logging must never kill the stream
      }

      return result;
    },
  }));
}

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
    /** 'organize' = lean prompt for file import organize; default = full prompt */
    mode?: 'organize' | 'default';
    /** ACP agent selection: if present, route to ACP instead of MindOS */
    selectedAcpAgent?: { id: string; name: string } | null;
  };
  try {
    body = await req.json();
  } catch {
    return apiError(ErrorCodes.INVALID_REQUEST, 'Invalid JSON body', 400);
  }

  const { messages, currentFile, attachedFiles, uploadedFiles, selectedAcpAgent } = body;
  const isOrganizeMode = body.mode === 'organize';

  // Read agent config from settings
  const serverSettings = readSettings();
  const agentConfig = serverSettings.agent ?? {};
  const stepLimit = Number.isFinite(body.maxSteps)
    ? Math.min(30, Math.max(1, Number(body.maxSteps)))
    : Math.min(30, Math.max(1, agentConfig.maxSteps ?? 20));
  const enableThinking = agentConfig.enableThinking ?? false;
  const thinkingBudget = agentConfig.thinkingBudget ?? 5000;
  const contextStrategy = agentConfig.contextStrategy ?? 'auto';

  // Uploaded files — shared by both modes
  const uploadedParts: string[] = [];
  if (Array.isArray(uploadedFiles) && uploadedFiles.length > 0) {
    for (const f of uploadedFiles.slice(0, 8)) {
      if (!f || typeof f.name !== 'string' || typeof f.content !== 'string') continue;
      uploadedParts.push(`### ${f.name}\n\n${truncate(f.content)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Build system prompt — lean path for organize mode, full path otherwise
  // ---------------------------------------------------------------------------
  let systemPrompt: string;

  if (isOrganizeMode) {
    // Organize mode: minimal prompt — only KB structure + uploaded files
    const promptParts: string[] = [ORGANIZE_SYSTEM_PROMPT];

    promptParts.push(`---\n\nmind_root=${getMindRoot()}`);

    // Only load root README.md for KB structure awareness (skip SKILL.md, configs, target dir, time, etc.)
    const bootstrapIndex = readKnowledgeFile('README.md');
    if (bootstrapIndex.ok) {
      promptParts.push(`---\n\n## Knowledge Base Structure\n\n${bootstrapIndex.content}`);
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
    // Full mode: original prompt assembly
    // Auto-load skill + bootstrap context for each request.
    const isZh = serverSettings.disabledSkills?.includes('mindos') ?? false;
    const skillDirName = isZh ? 'mindos-zh' : 'mindos';
    const appDir = process.env.MINDOS_PROJECT_ROOT
      ? path.join(process.env.MINDOS_PROJECT_ROOT, 'app')
      : process.cwd();
    const skillPath = path.join(appDir, `data/skills/${skillDirName}/SKILL.md`);
    const skill = readAbsoluteFile(skillPath);

    const userSkillRules = readKnowledgeFile('user-skill-rules.md');

    const targetDir = dirnameOf(currentFile);
    const bootstrap = {
      instruction: readKnowledgeFile('INSTRUCTION.md'),
      config_json: readKnowledgeFile('CONFIG.json'),
      // Lazy-loaded: only read if the file exists and has content.
      // README.md and CONFIG.md are often empty/boilerplate and waste tokens.
      index: null as ReturnType<typeof readKnowledgeFile> | null,
      config_md: null as ReturnType<typeof readKnowledgeFile> | null,
      target_readme: null as ReturnType<typeof readKnowledgeFile> | null,
      target_instruction: null as ReturnType<typeof readKnowledgeFile> | null,
      target_config_json: null as ReturnType<typeof readKnowledgeFile> | null,
      target_config_md: null as ReturnType<typeof readKnowledgeFile> | null,
    };

    // Only load secondary bootstrap files if they have meaningful content.
    // Files with ≤10 chars are typically empty or just a heading — not worth
    // injecting into the prompt (saves ~200-500 tokens per empty file).
    const MIN_USEFUL_CONTENT_LENGTH = 10;

    const indexResult = readKnowledgeFile('README.md');
    if (indexResult.ok && indexResult.content.trim().length > MIN_USEFUL_CONTENT_LENGTH) bootstrap.index = indexResult;

    const configMdResult = readKnowledgeFile('CONFIG.md');
    if (configMdResult.ok && configMdResult.content.trim().length > MIN_USEFUL_CONTENT_LENGTH) bootstrap.config_md = configMdResult;

    if (targetDir) {
      const tr = readKnowledgeFile(`${targetDir}/README.md`);
      if (tr.ok && tr.content.trim().length > MIN_USEFUL_CONTENT_LENGTH) bootstrap.target_readme = tr;
      const ti = readKnowledgeFile(`${targetDir}/INSTRUCTION.md`);
      if (ti.ok && ti.content.trim().length > MIN_USEFUL_CONTENT_LENGTH) bootstrap.target_instruction = ti;
      const tc = readKnowledgeFile(`${targetDir}/CONFIG.json`);
      if (tc.ok && tc.content.trim().length > MIN_USEFUL_CONTENT_LENGTH) bootstrap.target_config_json = tc;
      const tm = readKnowledgeFile(`${targetDir}/CONFIG.md`);
      if (tm.ok && tm.content.trim().length > MIN_USEFUL_CONTENT_LENGTH) bootstrap.target_config_md = tm;
    }

    // Only report failures + truncation warnings for loaded files
    const initFailures: string[] = [];
    const truncationWarnings: string[] = [];
    if (!skill.ok) initFailures.push(`skill.mindos: failed (${skill.error})`);
    if (skill.ok && skill.truncated) truncationWarnings.push('skill.mindos was truncated');
    if (userSkillRules.ok && userSkillRules.truncated) truncationWarnings.push('user-skill-rules.md was truncated');
    if (!bootstrap.instruction.ok) initFailures.push(`bootstrap.instruction: failed (${bootstrap.instruction.error})`);
    if (bootstrap.instruction.ok && bootstrap.instruction.truncated) truncationWarnings.push('bootstrap.instruction was truncated');
    if (bootstrap.index?.ok && bootstrap.index.truncated) truncationWarnings.push('bootstrap.index was truncated');
    if (!bootstrap.config_json.ok) initFailures.push(`bootstrap.config_json: failed (${bootstrap.config_json.error})`);
    if (bootstrap.config_json.ok && bootstrap.config_json.truncated) truncationWarnings.push('bootstrap.config_json was truncated');
    if (bootstrap.config_md?.ok && bootstrap.config_md.truncated) truncationWarnings.push('bootstrap.config_md was truncated');
    if (bootstrap.target_readme?.ok && bootstrap.target_readme.truncated) truncationWarnings.push('bootstrap.target_readme was truncated');
    if (bootstrap.target_instruction?.ok && bootstrap.target_instruction.truncated) truncationWarnings.push('bootstrap.target_instruction was truncated');
    if (bootstrap.target_config_json?.ok && bootstrap.target_config_json.truncated) truncationWarnings.push('bootstrap.target_config_json was truncated');
    if (bootstrap.target_config_md?.ok && bootstrap.target_config_md.truncated) truncationWarnings.push('bootstrap.target_config_md was truncated');

    const initStatus = initFailures.length === 0
      ? `All initialization contexts loaded successfully. mind_root=${getMindRoot()}${targetDir ? `, target_dir=${targetDir}` : ''}${truncationWarnings.length > 0 ? ` ⚠️ ${truncationWarnings.length} files truncated` : ''}`
      : `Initialization issues:\n${initFailures.join('\n')}\nmind_root=${getMindRoot()}${targetDir ? `, target_dir=${targetDir}` : ''}${truncationWarnings.length > 0 ? `\n⚠️ Warnings:\n${truncationWarnings.join('\n')}` : ''}`;

    const initContextBlocks: string[] = [];
    if (skill.ok) initContextBlocks.push(`## mindos_skill_md\n\n${skill.content}`);
    if (userSkillRules.ok && !userSkillRules.truncated && userSkillRules.content.trim()) {
      initContextBlocks.push(`## user_skill_rules\n\nUser personalization rules (user-skill-rules.md):\n\n${userSkillRules.content}`);
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
    if (bootstrap.config_md?.ok) initContextBlocks.push(`## bootstrap_config_md\n\n${bootstrap.config_md.content}`);
    if (bootstrap.target_readme?.ok) initContextBlocks.push(`## bootstrap_target_readme\n\n${bootstrap.target_readme.content}`);
    if (bootstrap.target_instruction?.ok) initContextBlocks.push(`## bootstrap_target_instruction\n\n${bootstrap.target_instruction.content}`);
    if (bootstrap.target_config_json?.ok) initContextBlocks.push(`## bootstrap_target_config_json\n\n${bootstrap.target_config_json.content}`);
    if (bootstrap.target_config_md?.ok) initContextBlocks.push(`## bootstrap_target_config_md\n\n${bootstrap.target_config_md.content}`);

    // Build initial context from attached/current files
    const contextParts: string[] = [];
    const seen = new Set<string>();
    const hasAttached = Array.isArray(attachedFiles) && attachedFiles.length > 0;

    if (hasAttached) {
      for (const filePath of attachedFiles!) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        try {
          const content = truncate(getFileContent(filePath));
          contextParts.push(`## Attached: ${filePath}\n\n${content}`);
        } catch { /* ignore missing files */ }
      }
    }

    if (currentFile && !seen.has(currentFile)) {
      seen.add(currentFile);
      try {
        const content = truncate(getFileContent(currentFile));
        contextParts.push(`## Current file: ${currentFile}\n\n${content}`);
      } catch { /* ignore */ }
    }

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

  try {
    const { model, modelName, apiKey, provider } = getModelConfig({ hasImages: hasImages(messages) });

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
    const requestTools = isOrganizeMode ? getOrganizeTools() : await getRequestScopedTools();
    const customTools = toPiCustomToolDefinitions(requestTools);

    const authStorage = AuthStorage.create();
    authStorage.setRuntimeApiKey(provider, requestApiKey);
    const modelRegistry = new ModelRegistry(authStorage);
    const settingsManager = SettingsManager.inMemory({
      enableSkillCommands: true,
      ...(enableThinking && provider === 'anthropic' ? { thinkingBudgets: { medium: thinkingBudget } } : {}),
      ...(contextStrategy === 'off' ? { compaction: { enabled: false } } : {}),
    });

    const resourceLoader = new DefaultResourceLoader({
      cwd: projectRoot,
      settingsManager,
      systemPromptOverride: () => systemPrompt,
      appendSystemPromptOverride: () => [],
      additionalSkillPaths: [
        path.join(projectRoot, 'app', 'data', 'skills'),
        path.join(projectRoot, 'skills'),
        path.join(getMindRoot(), '.skills'),
      ],
      additionalExtensionPaths: scanExtensionPaths(),
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: projectRoot,
      model,
      thinkingLevel: (enableThinking && provider === 'anthropic') ? 'medium' : 'off',
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
      tools: [],
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
            if (!hasContent && lastModelError) {
              send({ type: 'error', message: lastModelError });
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

