import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getFileContent, getMindRoot } from '@/lib/fs';
import { getModel, knowledgeBaseTools, truncate, AGENT_SYSTEM_PROMPT } from '@/lib/agent';

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
    messages: ModelMessage[];
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

  const { messages, currentFile, attachedFiles, uploadedFiles, maxSteps } = body;
  const stepLimit = Number.isFinite(maxSteps) ? Math.min(30, Math.max(1, Number(maxSteps))) : 20;

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

  const initStatus = [
    `skill.mindos: ${skill.ok ? 'ok' : `failed (${skill.error})`} [${skillPath}]`,
    `bootstrap.instruction: ${bootstrap.instruction.ok ? 'ok' : `failed (${bootstrap.instruction.error})`}`,
    `bootstrap.index: ${bootstrap.index.ok ? 'ok' : `failed (${bootstrap.index.error})`}`,
    `bootstrap.config_json: ${bootstrap.config_json.ok ? 'ok' : `failed (${bootstrap.config_json.error})`}`,
    `bootstrap.config_md: ${bootstrap.config_md.ok ? 'ok' : `failed (${bootstrap.config_md.error})`}`,
    `bootstrap.target_dir: ${targetDir ?? '(none)'}`,
    `bootstrap.target_readme: ${bootstrap.target_readme ? (bootstrap.target_readme.ok ? 'ok' : `failed (${bootstrap.target_readme.error})`) : 'skipped'}`,
    `bootstrap.target_instruction: ${bootstrap.target_instruction ? (bootstrap.target_instruction.ok ? 'ok' : `failed (${bootstrap.target_instruction.error})`) : 'skipped'}`,
    `bootstrap.target_config_json: ${bootstrap.target_config_json ? (bootstrap.target_config_json.ok ? 'ok' : `failed (${bootstrap.target_config_json.error})`) : 'skipped'}`,
    `bootstrap.target_config_md: ${bootstrap.target_config_md ? (bootstrap.target_config_md.ok ? 'ok' : `failed (${bootstrap.target_config_md.error})`) : 'skipped'}`,
    `bootstrap.mind_root: ${getMindRoot()}`,
  ].join('\n');

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
    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools: knowledgeBaseTools,
      stopWhen: stepCountIs(stepLimit),
    });

    return result.toTextStreamResponse();
  } catch (err) {
    console.error('[ask] Failed to initialize model:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to initialize AI model' },
      { status: 500 },
    );
  }
}
