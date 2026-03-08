import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { NextRequest } from 'next/server';
import { searchFiles, getFileContent } from '@/lib/fs';
import { effectiveAiConfig } from '@/lib/settings';

// Max chars per file to avoid token overflow (~100k chars ≈ ~25k tokens)
const MAX_FILE_CHARS = 20_000;

function truncate(content: string): string {
  if (content.length <= MAX_FILE_CHARS) return content;
  return content.slice(0, MAX_FILE_CHARS) + `\n\n[...truncated — file is ${content.length} chars, showing first ${MAX_FILE_CHARS}]`;
}

function getModel() {
  const cfg = effectiveAiConfig();

  if (cfg.provider === 'openai') {
    const openai = createOpenAI({
      apiKey: cfg.openaiApiKey,
      baseURL: cfg.openaiBaseUrl || undefined,
    });
    return openai.chat(cfg.openaiModel);
  }

  const anthropic = createAnthropic({ apiKey: cfg.anthropicApiKey });
  return anthropic(cfg.anthropicModel);
}

export async function POST(req: NextRequest) {
  const { messages, currentFile, attachedFiles } = await req.json();
  const question = messages[messages.length - 1]?.content ?? '';

  // Gather context: explicitly attached files first, then current file, then search
  const contextParts: string[] = [];
  const seen = new Set<string>();
  const hasAttached = Array.isArray(attachedFiles) && attachedFiles.length > 0;

  // 1. Explicitly attached files (highest priority)
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

  // 2. Current file being viewed
  if (currentFile && !seen.has(currentFile)) {
    seen.add(currentFile);
    try {
      const content = truncate(getFileContent(currentFile));
      contextParts.push(`## Current file: ${currentFile}\n\n${content}`);
    } catch {}
  }

  // 3. Search-based context (only when no files are explicitly attached)
  if (!hasAttached && question) {
    const results = searchFiles(question).slice(0, 3);
    for (const r of results) {
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      try {
        const content = truncate(getFileContent(r.path));
        contextParts.push(`## ${r.path}\n\n${content}`);
      } catch {}
    }
  }

  const systemPrompt = contextParts.length > 0
    ? `You are a helpful assistant for a personal knowledge base (MindOS). Answer concisely and in Markdown format. Base your answer on the provided files. If the answer isn't in the files, say so clearly.\n\n${contextParts.join('\n\n---\n\n')}`
    : `You are a helpful assistant for a personal knowledge base (MindOS). Answer concisely and in Markdown format.`;

  const result = streamText({
    model: getModel(),
    system: systemPrompt,
    messages,
  });

  return result.toTextStreamResponse();
}
