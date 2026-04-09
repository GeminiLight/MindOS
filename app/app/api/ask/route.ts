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
  bashTool,
} from '@mariozechner/pi-coding-agent';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
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
import { createSession, promptStream, closeSession } from '@/lib/acp/session';
import type { AcpSessionUpdate } from '@/lib/acp/types';
import type { Message as FrontendMessage } from '@/lib/types';

const MAX_DIR_FILES = 30;

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
 * Resolve skill file from multiple fallback locations.
 * Tries in order: app/data/skills → skills → {mindRoot}/.skills → ~/.mindos/skills
 * Returns { path, result } where result is the file content or error.
 */
/**
 * Candidate skill directories, ordered by priority.
 * Used for SKILL.md resolution AND reference file fallback.
 */
function skillDirCandidates(skillName: string, projectRoot: string, mindRoot: string): string[] {
  return [
    path.join(projectRoot, 'app', 'data', 'skills', skillName),
    path.join(projectRoot, 'skills', skillName),
    path.join(mindRoot, '.skills', skillName),
    path.join(process.env.HOME || '/root', '.mindos', 'skills', skillName),
  ];
}

function resolveSkillFile(
  skillName: string,
  projectRoot: string,
  mindRoot: string,
): { path: string; result: ReturnType<typeof readAbsoluteFile> } {
  const dirs = skillDirCandidates(skillName, projectRoot, mindRoot);
  const locations = dirs.map(d => path.join(d, 'SKILL.md'));

  for (const absPath of locations) {
    const result = readAbsoluteFile(absPath);
    if (result.ok) {
      return { path: absPath, result };
    }
  }

  return {
    path: locations[locations.length - 1],
    result: {
      ok: false,
      content: '',
      truncated: false,
      error: `Skill not found: tried ${locations.length} locations`,
    },
  };
}

/**
 * Resolve a skill reference file (e.g. references/write-supplement.md) with
 * multi-location fallback. First tries relative to the found SKILL.md, then
 * falls back to all other candidate directories. This handles the case where
 * SKILL.md is found in one location but its references/ dir is in another
 * (e.g. stale Desktop build, Core Hot Update with partial content).
 */
function resolveSkillReference(
  relPath: string,
  skillInfo: { path: string },
  skillName: string,
  projectRoot: string,
  mindRoot: string,
): ReturnType<typeof readAbsoluteFile> {
  const primaryDir = path.dirname(skillInfo.path);
  const primaryPath = path.join(primaryDir, relPath);
  const primaryResult = readAbsoluteFile(primaryPath);
  if (primaryResult.ok) return primaryResult;

  for (const dir of skillDirCandidates(skillName, projectRoot, mindRoot)) {
    if (dir === primaryDir) continue;
    const result = readAbsoluteFile(path.join(dir, relPath));
    if (result.ok) return result;
  }

  return primaryResult;
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
          agentName: 'MindOS',
        });
      } catch {
        // logging must never kill the stream
      }

      return result;
    },
  }));
}

// ---------------------------------------------------------------------------
// Non-streaming fallback for proxies that don't support stream + tools
// ---------------------------------------------------------------------------

/**
 * Reassemble SSE chunks (from proxies that ignore stream:false) into a
 * single OpenAI-style chat completion response.
 *
 * SSE format:  data: {"choices":[{"delta":{"content":"He"}}]}
 * Output:      {"choices":[{"message":{"role":"assistant","content":"Hello!"},"finish_reason":"stop"}]}
 */
function reassembleSSE(sseText: string): any {
  const lines = sseText.split('\n');
  let content = '';
  let role = 'assistant';
  let finishReason = 'stop';
  const toolCalls: Map<number, { id: string; type: string; function: { name: string; arguments: string } }> = new Map();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') break;

    let chunk: any;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue; // skip unparseable lines
    }

    const delta = chunk?.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.role) role = delta.role;
    if (delta.content) content += delta.content;
    if (chunk.choices[0].finish_reason) finishReason = chunk.choices[0].finish_reason;

    // Accumulate tool calls (they arrive in incremental deltas)
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = toolCalls.get(idx);
        if (!existing) {
          toolCalls.set(idx, {
            id: tc.id ?? '',
            type: tc.type ?? 'function',
            function: {
              name: tc.function?.name ?? '',
              arguments: tc.function?.arguments ?? '',
            },
          });
        } else {
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function.name += tc.function.name;
          if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
        }
      }
    }
  }

  const message: any = { role, content: content || null };
  if (toolCalls.size > 0) {
    message.tool_calls = Array.from(toolCalls.values());
  }

  return {
    choices: [{ message, finish_reason: finishReason }],
  };
}

/**
 * Convert pi-ai format messages to OpenAI API format.
 * pi-ai messages have nested structures; OpenAI format is flatter with tool_calls array.
 */
function piMessagesToOpenAI(piMessages: any[]): any[] {
  return piMessages.map(msg => {
    const role = msg.role;

    // Skip system role (will be added separately)
    if (role === 'system') return null;

    // Pass through user messages (simple string content)
    if (role === 'user') {
      return {
        role: 'user',
        content: typeof msg.content === 'string' ? msg.content : msg.content,
      };
    }

    // Assistant messages: flatten content array into text + tool_calls
    if (role === 'assistant') {
      const content = msg.content;
      let textContent = '';
      const toolCalls: any[] = [];

      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'text' && part.text) {
            textContent += part.text;
          } else if (part.type === 'toolCall') {
            toolCalls.push({
              id: part.id ?? `call_${Date.now()}`,
              type: 'function',
              function: {
                name: part.name ?? 'unknown',
                arguments: JSON.stringify(part.arguments ?? {}),
              },
            });
          }
        }
      }

      const result: any = { role: 'assistant' };
      // Always include content (even if empty) for tool-call-only messages
      // OpenAI API may handle this differently, but it's safer to include empty string
      result.content = textContent || '';
      if (toolCalls.length > 0) result.tool_calls = toolCalls;
      return result;
    }

    // Tool result messages
    if (role === 'toolResult') {
      const contentText = Array.isArray(msg.content)
        ? msg.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text ?? '')
            .join('\n')
        : String(msg.content ?? '');

      return {
        role: 'tool',
        tool_call_id: msg.toolCallId ?? 'unknown',
        content: contentText,
      };
    }

    return null;
  }).filter(Boolean);
}

/**
 * Mini agent loop using non-streaming OpenAI-compatible API.
 * Used when a proxy silently breaks stream+tools by returning plain text.
 * Emits SSE events identical to the streaming path so the frontend is unaffected.
 */
async function runNonStreamingFallback(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  historyMessages: any[];
  userContent: string;
  tools: AgentTool<any>[];
  send: (event: MindOSSSEvent) => void;
  signal: AbortSignal;
  maxSteps: number;
}): Promise<void> {
  const { baseUrl, apiKey, model, systemPrompt, historyMessages, userContent, tools, send, signal, maxSteps } = opts;

  const openaiTools = tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: (t as any).parameters ?? { type: 'object', properties: {} },
    },
  }));

  // Convert pi-ai format messages to OpenAI format
  const openaiMessages = piMessagesToOpenAI(historyMessages);

  const messages: { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }[] = [
    { role: 'system', content: systemPrompt },
    ...openaiMessages,
    { role: 'user', content: userContent },
  ];

  const toolMap = new Map(tools.map(t => [t.name, t]));
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  let step = 0;

  while (step < maxSteps) {
    if (signal.aborted) throw new Error('Request aborted');
    step++;

    // Use stream:true and parse SSE ourselves.
    // Many proxies ignore stream:false (returning SSE with empty choices or broken JSON).
    // Using stream:true is the most universally compatible approach.
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
        stream: true,
      }),
      signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Non-streaming API error ${resp.status}: ${errText.slice(0, 200)}`);
    }

    // Read the full response body (SSE or JSON)
    const rawText = await resp.text();
    const trimmed = rawText.trimStart();

    let data: any;
    if (trimmed.startsWith('data:')) {
      // Response is SSE — reassemble chunks into a single OpenAI response
      data = reassembleSSE(trimmed);
    } else {
      // Some endpoints might still return plain JSON even with stream:true
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(`API returned invalid response: ${rawText.slice(0, 200)}`);
      }
    }

    const choice = data?.choices?.[0];
    if (!choice) throw new Error('Empty response from API');

    // reassembleSSE always produces .message; standard JSON may use .message or .delta
    const msg = choice.message ?? choice.delta ?? {};
    const finishReason: string = choice.finish_reason ?? 'stop';

    // Emit text content in chunks to simulate streaming appearance
    if (msg.content) {
      const text: string = typeof msg.content === 'string' ? msg.content : '';
      if (text) {
        const chunkSize = 40;
        for (let i = 0; i < text.length; i += chunkSize) {
          send({ type: 'text_delta', delta: text.slice(i, i + chunkSize) });
          await new Promise(r => setTimeout(r, 8));
        }
      }
    }

    // No tool calls or naturally stopped → done
    if (finishReason === 'stop' || !msg.tool_calls?.length) break;

    // Execute each tool call
    const toolResultMessages: { role: string; tool_call_id: string; content: string }[] = [];
    for (const tc of msg.tool_calls) {
      const toolName = tc.function?.name ?? '';
      const toolCallId = tc.id ?? `call_${Date.now()}`;
      let parsedArgs: Record<string, unknown> = {};
      try { parsedArgs = JSON.parse(tc.function?.arguments ?? '{}'); } catch { /* ignore */ }

      const tool = toolMap.get(toolName);
      send({ type: 'tool_start', toolCallId, toolName, args: parsedArgs });

      let resultText = '';
      let isError = false;
      if (tool) {
        try {
          const result = await tool.execute(toolCallId, parsedArgs, signal);
          resultText = result.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
        } catch (err) {
          resultText = err instanceof Error ? err.message : String(err);
          isError = true;
        }
      } else {
        resultText = `Tool "${toolName}" not found`;
        isError = true;
      }

      send({ type: 'tool_end', toolCallId, output: resultText, isError });
      toolResultMessages.push({ role: 'tool', tool_call_id: toolCallId, content: resultText });
    }

    // Append assistant turn + tool results for next iteration
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
    messages.push(...toolResultMessages);
  }
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
      : await getRequestScopedTools();
    const customTools = toPiCustomToolDefinitions(requestTools);

    const authStorage = AuthStorage.create();
    authStorage.setRuntimeApiKey(toPiProvider(provider), requestApiKey);
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

