import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { getFileContent } from '@/lib/fs';
import { getModel, knowledgeBaseTools, truncate, AGENT_SYSTEM_PROMPT } from '@/lib/agent';

export async function POST(req: NextRequest) {
  let body: { messages: ModelMessage[]; currentFile?: string; attachedFiles?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { messages, currentFile, attachedFiles } = body;

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

  const systemPrompt = contextParts.length > 0
    ? `${AGENT_SYSTEM_PROMPT}\n\n---\n\nThe user is currently viewing these files:\n\n${contextParts.join('\n\n---\n\n')}`
    : AGENT_SYSTEM_PROMPT;

  try {
    const model = getModel();
    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools: knowledgeBaseTools,
      stopWhen: stepCountIs(10),
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
