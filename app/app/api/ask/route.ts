export const dynamic = 'force-dynamic';
import { Agent, type AgentEvent } from '@mariozechner/pi-agent-core';
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
// Helpers
// ---------------------------------------------------------------------------

function readKnowledgeFile(filePath: string): { ok: boolean; content: string; error?: string } {
  try {
    return { ok: true, content: truncate(getFileContent(filePath)) };
  } catch (err) {
    return { ok: false, content: '', error: err instanceof Error ? err.message : String(err) };
  }
}

function readAbsoluteFile(absPath: string): { ok: boolean; content: string; error?: string } {
  try {
    const raw = fs.readFileSync(absPath, 'utf-8');
    return { ok: true, content: truncate(raw) };
  } catch (err) {
    return { ok: false, content: '', error: err instanceof Error ? err.message : String(err) };
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
  const skillPath = path.resolve(process.cwd(), 'data/skills/mindos/SKILL.md');
  const skill = readAbsoluteFile(skillPath);

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

  // Only report failures
  const initFailures: string[] = [];
  if (!skill.ok) initFailures.push(`skill.mindos: failed (${skill.error})`);
  if (!bootstrap.instruction.ok) initFailures.push(`bootstrap.instruction: failed (${bootstrap.instruction.error})`);
  if (!bootstrap.index.ok) initFailures.push(`bootstrap.index: failed (${bootstrap.index.error})`);
  if (!bootstrap.config_json.ok) initFailures.push(`bootstrap.config_json: failed (${bootstrap.config_json.error})`);
  if (!bootstrap.config_md.ok) initFailures.push(`bootstrap.config_md: failed (${bootstrap.config_md.error})`);
  if (bootstrap.target_readme && !bootstrap.target_readme.ok) initFailures.push(`bootstrap.target_readme: failed (${bootstrap.target_readme.error})`);
  if (bootstrap.target_instruction && !bootstrap.target_instruction.ok) initFailures.push(`bootstrap.target_instruction: failed (${bootstrap.target_instruction.error})`);
  if (bootstrap.target_config_json && !bootstrap.target_config_json.ok) initFailures.push(`bootstrap.target_config_json: failed (${bootstrap.target_config_json.error})`);
  if (bootstrap.target_config_md && !bootstrap.target_config_md.ok) initFailures.push(`bootstrap.target_config_md: failed (${bootstrap.target_config_md.error})`);

  const initStatus = initFailures.length === 0
    ? `All initialization contexts loaded successfully. mind_root=${getMindRoot()}${targetDir ? `, target_dir=${targetDir}` : ''}`
    : `Initialization issues:\n${initFailures.join('\n')}\nmind_root=${getMindRoot()}${targetDir ? `, target_dir=${targetDir}` : ''}`;

  const initContextBlocks: string[] = [];
  if (skill.ok) initContextBlocks.push(`## mindos_skill_md\n\n${skill.content}`);
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
      getApiKey: async () => apiKey,
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
      beforeToolCall: async (context) => {
        const { toolName, args } = context;
        if (WRITE_TOOLS.has(toolName)) {
          const filePath = (args as any).path ?? (args as any).from_path;
          if (filePath) {
            try {
              assertNotProtected(filePath, 'modified by AI agent');
            } catch (e) {
              return {
                result: {
                  content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
                  details: {},
                },
              };
            }
          }
        }
        return undefined;
      },

      // Logging: record all tool executions
      afterToolCall: async (context) => {
        const ts = new Date().toISOString();
        const { toolName, args, result, isError } = context;
        const outputText = result?.content
          ?.filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('') ?? '';
        try {
          logAgentOp({
            ts,
            tool: toolName,
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
          if (event.type === 'message_update') {
            const e = (event as any).assistantMessageEvent;
            if (!e) return;
            if (e.type === 'text_delta') {
              send({ type: 'text_delta', delta: e.delta });
            } else if (e.type === 'thinking_delta') {
              send({ type: 'thinking_delta', delta: e.delta });
            }
          } else if (event.type === 'tool_execution_start') {
            const e = event as any;
            send({
              type: 'tool_start',
              toolCallId: e.toolCallId,
              toolName: e.toolName,
              args: e.args,
            });
          } else if (event.type === 'tool_execution_end') {
            const e = event as any;
            const outputText = e.result?.content
              ?.filter((p: any) => p.type === 'text')
              .map((p: any) => p.text)
              .join('') ?? '';
            send({
              type: 'tool_end',
              toolCallId: e.toolCallId,
              output: outputText,
              isError: !!e.isError,
            });
          } else if (event.type === 'turn_end') {
            stepCount++;

            // Track tool calls for loop detection
            const e = event as any;
            if (e.toolResults && Array.isArray(e.toolResults)) {
              for (const tr of e.toolResults) {
                stepHistory.push({ tool: tr.toolName, input: JSON.stringify(tr.content) });
              }
            }

            // Loop detection: same tool + same args 3 times in a row
            if (loopCooldown > 0) {
              loopCooldown--;
            } else if (stepHistory.length >= 3) {
              const last3 = stepHistory.slice(-3);
              if (last3.every(s => s.tool === last3[0].tool && s.input === last3[0].input)) {
                loopCooldown = 3;
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
