import type { AgentMode, AgentPermissionMode, LocalAttachment, Message } from './types';
import { getAssistantMarkdownPath } from './mind-system-assistant-paths';

export interface AssistantPromptLoadOptions {
  assistantId: string;
  fallbackPrompt: string;
  fetcher?: typeof fetch;
}

export interface AssistantRunPromptOptions {
  assistantPrompt?: string;
  runTitle: string;
  intro?: string;
  itemsLabel?: string;
  items?: string[];
  rules?: string[];
}

export interface AssistantAgentTurnRequestOptions {
  assistantId?: string | null;
  messages: Message[];
  agentMode?: AgentMode;
  permissionMode?: AgentPermissionMode;
  uploadedFiles?: LocalAttachment[];
  maxSteps?: number;
  providerOverride?: string | null;
  modelOverride?: string | null;
  runtimeOptions?: Record<string, unknown>;
}

export async function loadAssistantMarkdownPrompt({
  assistantId,
  fallbackPrompt,
  fetcher,
}: AssistantPromptLoadOptions): Promise<string> {
  try {
    const read = fetcher ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    if (!read) return fallbackPrompt;
    const promptPath = getAssistantMarkdownPath(assistantId);
    const res = await read(`/api/file?path=${encodeURIComponent(promptPath)}&op=read_file`);
    if (!res.ok) return fallbackPrompt;
    const data = await res.json() as { content?: unknown };
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    return content.length > 0 ? content : fallbackPrompt;
  } catch {
    return fallbackPrompt;
  }
}

export function buildAssistantRunPrompt({
  assistantPrompt,
  runTitle,
  intro,
  itemsLabel,
  items = [],
  rules = [],
}: AssistantRunPromptOptions): string {
  const basePrompt = assistantPrompt?.trim();
  const lines: string[] = basePrompt
    ? [
      basePrompt,
      '',
      '---',
      '',
      `# ${runTitle}`,
      '',
    ]
    : [
      `# ${runTitle}`,
      '',
    ];

  if (intro?.trim()) {
    lines.push(intro.trim(), '');
  }

  if (itemsLabel) {
    lines.push(`${itemsLabel}:`);
    if (items.length > 0) {
      for (const item of items) lines.push(`- ${item}`);
    } else {
      lines.push('- none');
    }
    lines.push('');
  }

  if (rules.length > 0) {
    lines.push('Run rules:', '');
    for (const rule of rules) lines.push(`- ${rule}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function buildAssistantAgentTurnRequestBody({
  assistantId,
  messages,
  agentMode,
  permissionMode,
  uploadedFiles,
  maxSteps,
  providerOverride,
  modelOverride,
  runtimeOptions,
}: AssistantAgentTurnRequestOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    messages,
  };
  if (agentMode) body.agentMode = agentMode;
  if (permissionMode) body.permissionMode = permissionMode;
  if (uploadedFiles) body.uploadedFiles = uploadedFiles;
  if (typeof maxSteps === 'number') body.maxSteps = maxSteps;
  if (providerOverride) body.providerOverride = providerOverride;
  if (modelOverride) body.modelOverride = modelOverride;
  if (assistantId) body.assistantId = assistantId;
  if (runtimeOptions) body.runtimeOptions = runtimeOptions;
  return body;
}
