export const dynamic = 'force-dynamic';
import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getFileContent, getMindRoot } from '@/lib/fs';
import { getModel, knowledgeBaseTools, truncate, AGENT_SYSTEM_PROMPT, estimateTokens, estimateStringTokens, getContextLimit, needsCompact, truncateToolOutputs, compactMessages, hardPrune } from '@/lib/agent';
import { effectiveAiConfig, readSettings } from '@/lib/settings';
import type { Message as FrontendMessage, ToolCallPart as FrontendToolCallPart } from '@/lib/types';

/**
 * Convert frontend Message[] (with parts containing tool calls + results)
 * into AI SDK ModelMessage[] that streamText expects.
 *
 * Frontend format:
 *   { role: 'assistant', content: '...', parts: [TextPart, ToolCallPart(with output/state)] }
 *
 * AI SDK format:
 *   { role: 'assistant', content: [TextPart, ToolCallPart(no output)] }
 *   { role: 'tool', content: [ToolResultPart] }  // one per completed tool call
 */
function convertToModelMessages(messages: FrontendMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
      continue;
    }

    // Skip error placeholder messages from frontend
    if (msg.content.startsWith('__error__')) continue;

    // Assistant message
    if (!msg.parts || msg.parts.length === 0) {
      // Plain text assistant message — no tool calls
      if (msg.content) {
        result.push({ role: 'assistant', content: msg.content });
      }
      continue;
    }

    // Build assistant message content array (text parts + tool call parts)
    const assistantContent: Array<
      { type: 'text'; text: string } |
      { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
    > = [];
    const completedToolCalls: FrontendToolCallPart[] = [];

    for (const part of msg.parts) {
      if (part.type === 'text') {
        if (part.text) {
          assistantContent.push({ type: 'text', text: part.text });
        }
      } else if (part.type === 'tool-call') {
        assistantContent.push({
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input ?? {},
        });
        // Always emit a tool result for every tool call. Orphaned tool calls
        // (running/pending from interrupted streams) get an empty result;
        // without one the API rejects the request.
        completedToolCalls.push(part);
      }
      // 'reasoning' parts are display-only; not sent back to model
    }

    if (assistantContent.length > 0) {
      result.push({ role: 'assistant', content: assistantContent });
    }

    // Add tool result messages for completed tool calls
    if (completedToolCalls.length > 0) {
      result.push({
        role: 'tool',
        content: completedToolCalls.map(tc => ({
          type: 'tool-result' as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: { type: 'text' as const, value: tc.output ?? '' },
        })),
      });
    }
  }

  return result;
}

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
  // NOTE: readSettings() is also called inside getModel() → effectiveAiConfig().
  // Acceptable duplication — both are sync fs reads with identical results.
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

  // Only report failures — when everything loads fine, a single summary line suffices.
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
    for (const filePath of attachedFiles) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      try {
        const content = truncate(getFileContent(filePath));
        contextParts.push(`## Attached: ${filePath}\n\n${content}`);
      } catch {}
    }
  }

  if (currentFile && !seen.has(currentFile)) {
    seen.add(currentFile);
    try {
      const content = truncate(getFileContent(currentFile));
      contextParts.push(`## Current file: ${currentFile}\n\n${content}`);
    } catch {}
  }

  // Uploaded files go into a SEPARATE top-level section so the Agent
  // treats them with high priority and never tries to look them up via tools.
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
    const model = getModel();
    const cfg = effectiveAiConfig();
    const modelName = cfg.provider === 'openai' ? cfg.openaiModel : cfg.anthropicModel;
    let modelMessages = convertToModelMessages(messages);

    // Phase 3: Context management pipeline
    // 1. Truncate tool outputs in historical messages
    modelMessages = truncateToolOutputs(modelMessages);

    const preTokens = estimateTokens(modelMessages);
    const sysTokens = estimateStringTokens(systemPrompt);
    const ctxLimit = getContextLimit(modelName);
    console.log(`[ask] Context: ~${preTokens + sysTokens} tokens (messages=${preTokens}, system=${sysTokens}), limit=${ctxLimit}`);

    // 2. Compact if >70% context limit (skip if user disabled)
    if (contextStrategy === 'auto' && needsCompact(modelMessages, systemPrompt, modelName)) {
      console.log('[ask] Context >70% limit, compacting...');
      const result = await compactMessages(modelMessages, model);
      modelMessages = result.messages;
      if (result.compacted) {
        const postTokens = estimateTokens(modelMessages);
        console.log(`[ask] After compact: ~${postTokens + sysTokens} tokens`);
      } else {
        console.log('[ask] Compact skipped (too few messages), hard prune will handle overflow if needed');
      }
    }

    // 3. Hard prune if still >90% context limit
    modelMessages = hardPrune(modelMessages, systemPrompt, modelName);

    // Phase 2: Step monitoring + loop detection
    const stepHistory: Array<{ tool: string; input: string }> = [];
    let loopDetected = false;
    let loopCooldown = 0; // skip detection for N steps after warning

    const result = streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      tools: knowledgeBaseTools,
      stopWhen: stepCountIs(stepLimit),
      ...(enableThinking && cfg.provider === 'anthropic' ? {
        providerOptions: {
          anthropic: {
            thinking: { type: 'enabled', budgetTokens: thinkingBudget },
          },
        },
      } : {}),

      onStepFinish: ({ toolCalls, usage }) => {
        if (toolCalls) {
          for (const tc of toolCalls) {
            stepHistory.push({ tool: tc.toolName, input: JSON.stringify(tc.input) });
          }
        }
        // Loop detection: same tool + same args 3 times in a row
        // Skip detection during cooldown to avoid repeated warnings
        if (loopCooldown > 0) {
          loopCooldown--;
        } else if (stepHistory.length >= 3) {
          const last3 = stepHistory.slice(-3);
          if (last3.every(s => s.tool === last3[0].tool && s.input === last3[0].input)) {
            loopDetected = true;
          }
        }
        console.log(`[ask] Step ${stepHistory.length}/${stepLimit}, tokens=${usage?.totalTokens ?? '?'}`);
      },

      prepareStep: ({ messages: stepMessages }) => {
        if (loopDetected) {
          loopDetected = false;
          loopCooldown = 3; // suppress re-detection for 3 steps
          return {
            messages: [
              ...stepMessages,
              {
                role: 'user' as const,
                content: '[SYSTEM WARNING] You have called the same tool with identical arguments 3 times in a row. This appears to be a loop. Try a completely different approach or ask the user for clarification.',
              },
            ],
          };
        }
        return {}; // no modification
      },

      onError: ({ error }) => {
        console.error('[ask] Stream error:', error);
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error('[ask] Failed to initialize model:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to initialize AI model' },
      { status: 500 },
    );
  }
}
