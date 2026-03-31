export const dynamic = 'force-dynamic';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
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
import { bridgeA2aToAcp } from '@/lib/acp/bridge';
import type { A2AMessage } from '@/lib/a2a/types';
import type { Message as FrontendMessage } from '@/lib/types';

// ---------------------------------------------------------------------------
// MindOS SSE format — 6 event types (front-back contract)
// ---------------------------------------------------------------------------

type MindOSSSEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; toolCallId: string; output: string; isError: boolean }
  | { type: 'done'; usage?: { input: number; output: number } }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Type Guards for AgentEvent variants (safe event handling)
// ---------------------------------------------------------------------------

function isTextDeltaEvent(e: AgentEvent): boolean {
  return e.type === 'message_update' && (e as any).assistantMessageEvent?.type === 'text_delta';
}

function getTextDelta(e: AgentEvent): string {
  return (e as any).assistantMessageEvent?.delta ?? '';
}

function isThinkingDeltaEvent(e: AgentEvent): boolean {
  return e.type === 'message_update' && (e as any).assistantMessageEvent?.type === 'thinking_delta';
}

function getThinkingDelta(e: AgentEvent): string {
  return (e as any).assistantMessageEvent?.delta ?? '';
}

function isToolExecutionStartEvent(e: AgentEvent): boolean {
  return e.type === 'tool_execution_start';
}

function getToolExecutionStart(e: AgentEvent): { toolCallId: string; toolName: string; args: unknown } {
  const evt = e as any;
  return {
    toolCallId: evt.toolCallId ?? '',
    toolName: evt.toolName ?? 'unknown',
    args: evt.args ?? {},
  };
}

function isToolExecutionEndEvent(e: AgentEvent): boolean {
  return e.type === 'tool_execution_end';
}

function getToolExecutionEnd(e: AgentEvent): { toolCallId: string; output: string; isError: boolean } {
  const evt = e as any;
  const outputText = evt.result?.content
    ?.filter((p: any) => p.type === 'text')
    .map((p: any) => p.text)
    .join('') ?? '';
  return {
    toolCallId: evt.toolCallId ?? '',
    output: outputText,
    isError: !!evt.isError,
  };
}

function isTurnEndEvent(e: AgentEvent): boolean {
  return e.type === 'turn_end';
}

function getTurnEndData(e: AgentEvent): { toolResults: Array<{ toolName: string; content: unknown }> } {
  return {
    toolResults: ((e as any).toolResults as any[]) ?? [],
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

function readAbsoluteFile(absPath: string): { ok: boolean; content: string; truncated: boolean; error?: string } {
  try {
    const raw = fs.readFileSync(absPath, 'utf-8');
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
  if (toolName === 'batch_create_files' && Array.isArray((args as any).files)) {
    (args as any).files.forEach((f: any) => { if (f.path) pathsToCheck.push(f.path); });
  } else {
    const singlePath = (args as any).path ?? (args as any).from_path;
    if (typeof singlePath === 'string') pathsToCheck.push(singlePath);
  }
  return pathsToCheck;
}

function toPiCustomToolDefinitions(tools: AgentTool<any>[]): ToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters as any,
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
      index: readKnowledgeFile('README.md'),
      config_json: readKnowledgeFile('CONFIG.json'),
      config_md: readKnowledgeFile('CONFIG.md'),
      target_readme: targetDir ? readKnowledgeFile(`${targetDir}/README.md`) : null,
      target_instruction: targetDir ? readKnowledgeFile(`${targetDir}/INSTRUCTION.md`) : null,
      target_config_json: targetDir ? readKnowledgeFile(`${targetDir}/CONFIG.json`) : null,
      target_config_md: targetDir ? readKnowledgeFile(`${targetDir}/CONFIG.md`) : null,
    };

    // Only report failures + truncation warnings
    const initFailures: string[] = [];
    const truncationWarnings: string[] = [];
    if (!skill.ok) initFailures.push(`skill.mindos: failed (${skill.error})`);
    if (skill.ok && skill.truncated) truncationWarnings.push('skill.mindos was truncated');
    if (userSkillRules.ok && userSkillRules.truncated) truncationWarnings.push('user-skill-rules.md was truncated');
    if (!bootstrap.instruction.ok) initFailures.push(`bootstrap.instruction: failed (${bootstrap.instruction.error})`);
    if (bootstrap.instruction.ok && bootstrap.instruction.truncated) truncationWarnings.push('bootstrap.instruction was truncated');
    if (!bootstrap.index.ok) initFailures.push(`bootstrap.index: failed (${bootstrap.index.error})`);
    if (bootstrap.index.ok && bootstrap.index.truncated) truncationWarnings.push('bootstrap.index was truncated');
    if (!bootstrap.config_json.ok) initFailures.push(`bootstrap.config_json: failed (${bootstrap.config_json.error})`);
    if (bootstrap.config_json.ok && bootstrap.config_json.truncated) truncationWarnings.push('bootstrap.config_json was truncated');
    if (!bootstrap.config_md.ok) initFailures.push(`bootstrap.config_md: failed (${bootstrap.config_md.error})`);
    if (bootstrap.config_md.ok && bootstrap.config_md.truncated) truncationWarnings.push('bootstrap.config_md was truncated');
    if (bootstrap.target_readme && !bootstrap.target_readme.ok) initFailures.push(`bootstrap.target_readme: failed (${bootstrap.target_readme.error})`);
    if (bootstrap.target_readme?.ok && bootstrap.target_readme.truncated) truncationWarnings.push('bootstrap.target_readme was truncated');
    if (bootstrap.target_instruction && !bootstrap.target_instruction.ok) initFailures.push(`bootstrap.target_instruction: failed (${bootstrap.target_instruction.error})`);
    if (bootstrap.target_instruction?.ok && bootstrap.target_instruction.truncated) truncationWarnings.push('bootstrap.target_instruction was truncated');
    if (bootstrap.target_config_json && !bootstrap.target_config_json.ok) initFailures.push(`bootstrap.target_config_json: failed (${bootstrap.target_config_json.error})`);
    if (bootstrap.target_config_json?.ok && bootstrap.target_config_json.truncated) truncationWarnings.push('bootstrap.target_config_json was truncated');
    if (bootstrap.target_config_md && !bootstrap.target_config_md.ok) initFailures.push(`bootstrap.target_config_md: failed (${bootstrap.target_config_md.error})`);
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
    if (bootstrap.index.ok) initContextBlocks.push(`## bootstrap_index\n\n${bootstrap.index.content}`);
    if (bootstrap.config_json.ok) initContextBlocks.push(`## bootstrap_config_json\n\n${bootstrap.config_json.content}`);
    if (bootstrap.config_md.ok) initContextBlocks.push(`## bootstrap_config_md\n\n${bootstrap.config_md.content}`);
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
    promptParts.push(`---\n\nInitialization status (auto-loaded at request start):\n\n${initStatus}`);

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
    // Extract images for prompt options (pi-ai ImageContent format)
    const lastUserImages = lastMsg?.role === 'user' && lastMsg.images?.length
      ? lastMsg.images.map(img => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType }))
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
        function send(event: MindOSSSEvent) {
          try {
            controller.enqueue(encoder.encode(`data:${JSON.stringify(event)}\n\n`));
          } catch (err) {
            if (err instanceof TypeError) {
              console.error('[ask] SSE send failed (serialization):', (err as Error).message, 'event type:', (event as { type?: string }).type);
            }
          }
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
            const turnUsage = (event as any).usage;
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

            // Loop detection: same tool + same args 3 times in a row.
            // Only trigger if we have 3+ history entries (prevent false positives on first turn).
            const LOOP_DETECTION_THRESHOLD = 3;
            if (loopCooldown > 0) {
              loopCooldown--;
            } else if (stepHistory.length >= LOOP_DETECTION_THRESHOLD) {
              const lastN = stepHistory.slice(-LOOP_DETECTION_THRESHOLD);
              if (lastN.every(s => s.tool === lastN[0].tool && s.input === lastN[0].input)) {
                loopCooldown = 3;
                // TODO (metrics): Track loop detection rate — metrics.increment('agent.loop_detected', { model: modelName })
                void session.steer('[SYSTEM WARNING] You have called the same tool with identical arguments 3 times in a row. This appears to be a loop. Try a completely different approach or ask the user for clarification.');
              }
            }

            // Step limit enforcement
            if (stepCount >= stepLimit) {
              void session.abort();
            }

            console.log(`[ask] Step ${stepCount}/${stepLimit}`);
          } else if (event.type === 'agent_end') {
            // Capture model errors from the last assistant message.
            // pi-coding-agent resolves prompt() without throwing after retries;
            // the error is only visible in agent_end event messages.
            const msgs = (event as any).messages;
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
            // Route to ACP agent
            try {
              // Convert string message to A2AMessage format
              const acpMessage: A2AMessage = {
                role: 'ROLE_USER',
                parts: [{ text: lastUserContent }],
              };
              const acpResult = await bridgeA2aToAcp(acpMessage, selectedAcpAgent.id);
              hasContent = true;
              // Extract text from A2A task result
              if (acpResult.status?.message?.parts) {
                for (const part of acpResult.status.message.parts) {
                  if (part.text) {
                    send({ type: 'text_delta', delta: part.text });
                  }
                }
              }
              send({ type: 'done' });
            } catch (acpErr) {
              const errMsg = acpErr instanceof Error ? acpErr.message : String(acpErr);
              send({ type: 'error', message: `ACP Agent Error: ${errMsg}` });
            }
            controller.close();
          } else {
            // Route to MindOS agent (existing logic)
            await session.prompt(lastUserContent, lastUserImages ? { images: lastUserImages } : undefined);
            metrics.recordRequest(Date.now() - requestStartTime);
            if (!hasContent && lastModelError) {
              send({ type: 'error', message: lastModelError });
            } else {
              send({ type: 'done' });
            }
            controller.close();
          }
        };

        runAgent().catch((err) => {
          metrics.recordRequest(Date.now() - requestStartTime);
          metrics.recordError();
          send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
          controller.close();
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

