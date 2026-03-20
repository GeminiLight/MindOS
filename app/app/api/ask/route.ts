export const dynamic = 'force-dynamic';
import { Agent, type AgentEvent, type BeforeToolCallContext, type BeforeToolCallResult, type AfterToolCallContext, type AfterToolCallResult } from '@mariozechner/pi-agent-core';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getFileContent, getMindRoot } from '@/lib/fs';
import { getModelConfig } from '@/lib/agent/model';
import { knowledgeBaseTools, WRITE_TOOLS, truncate } from '@/lib/agent/tools';
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt';
import { toAgentMessages } from '@/lib/agent/to-agent-messages';
import {
  estimateTokens, estimateStringTokens, getContextLimit,
  createTransformContext,
} from '@/lib/agent/context';
import { logAgentOp } from '@/lib/agent/log';
import { loadSkillRules } from '@/lib/agent/skill-rules';
import { readSettings } from '@/lib/settings';
import { assertNotProtected } from '@/lib/core';
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
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { messages, currentFile, attachedFiles, uploadedFiles } = body;

  // Read agent config from settings
  const serverSettings = readSettings();
  const agentConfig = serverSettings.agent ?? {};
  const stepLimit = Number.isFinite(body.maxSteps)
    ? Math.min(30, Math.max(1, Number(body.maxSteps)))
    : Math.min(30, Math.max(1, agentConfig.maxSteps ?? 20));
  const enableThinking = agentConfig.enableThinking ?? false;
  const thinkingBudget = agentConfig.thinkingBudget ?? 5000;
  const contextStrategy = agentConfig.contextStrategy ?? 'auto';

  // Auto-load skill + bootstrap context for each request.
  // 1. SKILL.md — static trigger + protocol (always loaded)
  // 2. skill-rules.md — user's knowledge base operating rules (if exists)
  // 3. user-rules.md — user's personalized rules (if exists)
  const isZh = serverSettings.disabledSkills?.includes('mindos') ?? false;
  const skillDirName = isZh ? 'mindos-zh' : 'mindos';
  const skillPath = path.resolve(process.cwd(), `data/skills/${skillDirName}/SKILL.md`);
  const skill = readAbsoluteFile(skillPath);

  // Progressive skill loading: read skill-rules + user-rules from knowledge base
  const mindRoot = getMindRoot();
  const { skillRules, userRules } = loadSkillRules(mindRoot, skillDirName);

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
  if (skillRules.ok && skillRules.truncated) truncationWarnings.push('skill-rules.md was truncated');
  if (userRules.ok && userRules.truncated) truncationWarnings.push('user-rules.md was truncated');
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
  // Progressive skill loading: inject skill-rules and user-rules after SKILL.md
  if (skillRules.ok && !skillRules.empty) {
    initContextBlocks.push(`## skill_rules\n\nOperating rules loaded from knowledge base (.agents/skills/${skillDirName}/skill-rules.md):\n\n${skillRules.content}`);
  }
  if (userRules.ok && !userRules.empty) {
    initContextBlocks.push(`## user_rules\n\nUser personalization rules (.agents/skills/${skillDirName}/user-rules.md):\n\n${userRules.content}`);
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

  // Uploaded files
  const uploadedParts: string[] = [];
  if (Array.isArray(uploadedFiles) && uploadedFiles.length > 0) {
    for (const f of uploadedFiles.slice(0, 8)) {
      if (!f || typeof f.name !== 'string' || typeof f.content !== 'string') continue;
      uploadedParts.push(`### ${f.name}\n\n${truncate(f.content)}`);
    }
  }

  const promptParts: string[] = [AGENT_SYSTEM_PROMPT];
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

  const systemPrompt = promptParts.join('\n\n');

  try {
    const { model, modelName, apiKey, provider } = getModelConfig();

    // Convert frontend messages to AgentMessage[]
    const agentMessages = toAgentMessages(messages);

    // Extract the last user message for agent.prompt()
    const lastUserContent = messages.length > 0 && messages[messages.length - 1].role === 'user'
      ? messages[messages.length - 1].content
      : '';

    // History = all messages except the last user message (agent.prompt adds it)
    const historyMessages = agentMessages.slice(0, -1);

    // Capture API key for this request — safe since each POST creates a new Agent instance.
    // Even though JS closures are lexically scoped, being explicit guards against future refactors.
    const requestApiKey = apiKey;

    // ── Loop detection state ──
    const stepHistory: Array<{ tool: string; input: string }> = [];
    let stepCount = 0;
    let loopCooldown = 0;

    // ── Create Agent (per-request lifecycle) ──
    const agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        thinkingLevel: (enableThinking && provider === 'anthropic') ? 'medium' : 'off',
        tools: knowledgeBaseTools,
        messages: historyMessages,
      },
      getApiKey: async () => requestApiKey,
      toolExecution: 'parallel',

      // Context management: truncate → compact → prune
      transformContext: createTransformContext(
        systemPrompt,
        modelName,
        () => model,
        apiKey,
        contextStrategy,
      ),

      // Write-protection: block writes to protected files
      beforeToolCall: async (context: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
        const { toolCall, args } = context;
        // toolCall is an object with type "toolCall" and contains the tool name and ID
        const toolName = (toolCall as any).toolName ?? (toolCall as any).name;
        if (toolName && WRITE_TOOLS.has(toolName)) {
          const filePath = (args as any).path ?? (args as any).from_path;
          if (filePath) {
            try {
              assertNotProtected(filePath, 'modified by AI agent');
            } catch (e) {
              const errorMsg = e instanceof Error ? e.message : String(e);
              return {
                block: true,
                reason: `Write-protection error: ${errorMsg}`,
              };
            }
          }
        }
        return undefined;
      },

      // Logging: record all tool executions
      afterToolCall: async (context: AfterToolCallContext): Promise<AfterToolCallResult | undefined> => {
        const ts = new Date().toISOString();
        const { toolCall, args, result, isError } = context;
        const toolName = (toolCall as any).toolName ?? (toolCall as any).name;
        const outputText = result?.content
          ?.filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('') ?? '';
        try {
          logAgentOp({
            ts,
            tool: toolName ?? 'unknown',
            params: args as Record<string, unknown>,
            result: isError ? 'error' : 'ok',
            message: outputText.slice(0, 200),
          });
        } catch { /* logging must never kill the stream */ }
        return undefined;
      },

      ...(enableThinking && provider === 'anthropic' ? {
        thinkingBudgets: { medium: thinkingBudget },
      } : {}),
    });

    // ── SSE Stream ──
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        function send(event: MindOSSSEvent) {
          try {
            controller.enqueue(encoder.encode(`data:${JSON.stringify(event)}\n\n`));
          } catch { /* controller may be closed */ }
        }

        agent.subscribe((event: AgentEvent) => {
          if (isTextDeltaEvent(event)) {
            send({ type: 'text_delta', delta: getTextDelta(event) });
          } else if (isThinkingDeltaEvent(event)) {
            send({ type: 'thinking_delta', delta: getThinkingDelta(event) });
          } else if (isToolExecutionStartEvent(event)) {
            const { toolCallId, toolName, args } = getToolExecutionStart(event);
            send({
              type: 'tool_start',
              toolCallId,
              toolName,
              args,
            });
          } else if (isToolExecutionEndEvent(event)) {
            const { toolCallId, output, isError } = getToolExecutionEnd(event);
            send({
              type: 'tool_end',
              toolCallId,
              output,
              isError,
            });
          } else if (isTurnEndEvent(event)) {
            stepCount++;

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
                agent.steer({
                  role: 'user',
                  content: '[SYSTEM WARNING] You have called the same tool with identical arguments 3 times in a row. This appears to be a loop. Try a completely different approach or ask the user for clarification.',
                  timestamp: Date.now(),
                } as any);
              }
            }

            // Step limit enforcement
            if (stepCount >= stepLimit) {
              agent.abort();
            }

            console.log(`[ask] Step ${stepCount}/${stepLimit}`);
          }
        });

        agent.prompt(lastUserContent).then(() => {
          send({ type: 'done' });
          controller.close();
        }).catch((err) => {
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to initialize AI model' },
      { status: 500 },
    );
  }
}
