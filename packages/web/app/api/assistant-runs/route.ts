export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import type { LocalAttachment, Message } from '@/lib/types';
import { getMindRoot } from '@/lib/fs';
import { buildAssistantAgentTurnRequestBody } from '@/lib/assistant-runner';
import { DREAMING_ASSISTANT_ID, buildDreamingAssistantRunPrompt } from '@/lib/dreaming-assistant';
import { isRegisteredAssistantRun } from '@/lib/assistant-runtime-registry';
import { getDefaultAssistantPrompt } from '@/lib/mind-system-assistants';
import { handleRouteErrorSimple } from '@/lib/errors';
import { runAgentTurnRequestBody } from '../agent/_lib/turn-runner';
import type { AgentTurnRequestBody } from '../agent/_lib/turn-request';
import {
  createMindosActiveAssistantPrompt,
  createMindosActiveAssistantPromptFromMarkdown,
  type MindosActiveAssistantPrompt,
} from '@geminilight/mindos/agent';

class AssistantRunError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AssistantRunError';
  }
}

const SAFE_ASSISTANT_ID = /^[a-z0-9][a-z0-9-]*$/;

type AssistantLibraryItem = {
  id: string;
  name: string;
  description?: string;
  source?: string;
  runtime?: string;
  model?: string;
  permissionMode?: string;
  preferredAgent?: string;
  skills?: string[];
  mcp?: string[];
  paths?: { prompt?: string; file?: string };
  prompt?: { content?: string };
};

type AssistantsServerModule = {
  listLocalAssistants?: (mindRoot: string) => AssistantLibraryItem[];
};

export async function POST(req: Request) {
  const body = await readJsonBody(req);

  try {
    const record = objectBody(body);
    const assistantId = normalizeAssistantId(record.assistantId);
    if (!assistantId) {
      throw new AssistantRunError(400, 'INVALID_ASSISTANT_ID', 'Invalid assistant id.');
    }
    const { body: agentTurnBody, activeAssistant } = await createAssistantAgentTurnBody(record, assistantId);
    return runAgentTurnRequestBody(agentTurnBody, {
      headers: req.headers,
      signal: req.signal,
      request: req,
      activeAssistant,
    });
  } catch (error) {
    if (error instanceof AssistantRunError) {
      return NextResponse.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return handleRouteErrorSimple(error);
  }
}

async function createAssistantAgentTurnBody(
  body: Record<string, unknown>,
  assistantId: string,
): Promise<{ body: AgentTurnRequestBody; activeAssistant: MindosActiveAssistantPrompt }> {
  const messages = resolveAssistantMessages(body, assistantId);
  if (messages.length === 0) {
    throw new AssistantRunError(400, 'INVALID_MESSAGES', 'Assistant Runs require at least one message.');
  }
  const activeAssistant = await resolveActiveAssistantPrompt(assistantId);

  const agentTurnBody = buildAssistantAgentTurnRequestBody({
    assistantId,
    messages,
    agentMode: normalizeAgentMode(body.agentMode),
    permissionMode: normalizeAssistantPermissionMode(body.permissionMode, assistantId),
    uploadedFiles: normalizeUploadedFiles(body.uploadedFiles),
    maxSteps: normalizePositiveInteger(body.maxSteps) ?? defaultAssistantMaxSteps(assistantId),
    providerOverride: normalizeOptionalString(body.providerOverride),
    modelOverride: normalizeOptionalString(body.modelOverride),
    runtimeOptions: normalizeAssistantRuntimeOptions(body.runtimeOptions),
  }) as AgentTurnRequestBody;

  return {
    body: copyAgentTurnContextFields(agentTurnBody, body),
    activeAssistant,
  };
}

function copyAgentTurnContextFields(
  agentTurnBody: AgentTurnRequestBody,
  body: Record<string, unknown>,
): AgentTurnRequestBody {
  const contextFields = [
    'currentFile',
    'attachedFiles',
    'selectedAcpAgent',
    'selectedRuntime',
    'runtimeBinding',
    'workDir',
    'contextSelection',
    'agentOptions',
    'chatSessionId',
  ] as const satisfies ReadonlyArray<keyof AgentTurnRequestBody>;
  const target = agentTurnBody as Record<string, unknown>;
  for (const field of contextFields) {
    if (body[field] !== undefined) target[field] = body[field];
  }
  return agentTurnBody;
}

function resolveAssistantMessages(
  body: Record<string, unknown>,
  assistantId: string,
): Message[] {
  const messages = normalizeMessages(body.messages);
  if (messages.length > 0) return messages;
  if (assistantId === DREAMING_ASSISTANT_ID) {
    return [{
      role: 'user',
      content: buildDreamingAssistantRunPrompt({
        space: normalizeSpace(readContextSpace(body)),
        dryRun: body.dryRun === true,
      }),
    }];
  }
  return [];
}

function defaultAssistantMaxSteps(assistantId: string): number | undefined {
  return assistantId === DREAMING_ASSISTANT_ID ? 16 : undefined;
}

function normalizeAssistantRuntimeOptions(
  value: unknown,
): Record<string, unknown> | undefined {
  const runtimeOptions = objectBodyOrUndefined(value);
  const unknownField = runtimeOptions ? firstUnknownField(runtimeOptions, ASSISTANT_RUNTIME_OPTION_FIELDS, 'runtimeOptions') : null;
  if (unknownField) {
    throw new AssistantRunError(
      400,
      'INVALID_RUNTIME_OPTIONS',
      unknownField,
    );
  }
  return runtimeOptions;
}

function firstUnknownField(record: Record<string, unknown>, allowed: ReadonlySet<string>, prefix?: string): string | null {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return `Unknown field: ${prefix ? `${prefix}.` : ''}${key}`;
  }
  return null;
}

const ASSISTANT_RUNTIME_OPTION_FIELDS = new Set(['reasoningEffort', 'modelOverride']);

function normalizeAgentMode(value: unknown): AgentTurnRequestBody['agentMode'] {
  if (value === undefined) return undefined;
  if (value === 'default' || value === 'plan' || value === 'goal') return value;
  throw new AssistantRunError(400, 'INVALID_AGENT_MODE', 'agentMode must be default, plan, or goal.');
}

function normalizeAssistantPermissionMode(
  value: unknown,
  assistantId: string,
): AgentTurnRequestBody['permissionMode'] {
  if (value === undefined) return isRegisteredAssistantRun(assistantId) ? undefined : 'read';
  if (value === 'read' || value === 'ask' || value === 'auto' || value === 'full') return value;
  throw new AssistantRunError(400, 'INVALID_PERMISSION_MODE', 'permissionMode must be read, ask, auto, or full.');
}

async function resolveActiveAssistantPrompt(assistantId: string): Promise<MindosActiveAssistantPrompt> {
  const local = await readLocalAssistant(assistantId);
  if (local) {
    return createMindosActiveAssistantPrompt({
      id: local.id,
      name: local.name,
      description: local.description,
      source: local.source,
      runtime: local.runtime ?? local.preferredAgent,
      model: local.model,
      permissionMode: local.permissionMode,
      maxPermissionMode: local.permissionMode,
      promptPath: local.paths?.prompt ?? local.paths?.file,
      instructions: local.prompt?.content,
      skills: local.skills,
      mcp: local.mcp,
    });
  }

  if (isRegisteredAssistantRun(assistantId)) {
    return createMindosActiveAssistantPromptFromMarkdown({
      id: assistantId,
      markdown: getDefaultAssistantPrompt(assistantId),
      source: 'builtin-default',
      promptPath: `.mindos/assistants/${assistantId}.md`,
      maxPermissionMode: 'ask',
    });
  }

  return createMindosActiveAssistantPrompt({
    id: assistantId,
    source: 'request',
    permissionMode: 'read',
    maxPermissionMode: 'read',
  });
}

async function readLocalAssistant(assistantId: string): Promise<AssistantLibraryItem | undefined> {
  try {
    const mindRoot = getMindRoot();
    const mod = await import(
      /* webpackIgnore: true */
      '@geminilight/mindos/server'
    ) as AssistantsServerModule;
    const assistants = mod.listLocalAssistants?.(mindRoot) ?? [];
    return assistants.find((assistant) => assistant.id === assistantId);
  } catch {
    return undefined;
  }
}

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function objectBodyOrUndefined(value: unknown): Record<string, unknown> | undefined {
  const record = objectBody(value);
  return Object.keys(record).length > 0 ? record : undefined;
}

function normalizeAssistantId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return SAFE_ASSISTANT_ID.test(normalized) ? normalized : undefined;
}

function readContextSpace(record: Record<string, unknown>): unknown {
  const context = objectBody(record.context);
  return context.space ?? record.space;
}

function normalizeSpace(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');
  if (!normalized) return undefined;
  const segments = normalized.split('/');
  if (segments.some(segment => segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new AssistantRunError(400, 'INVALID_SPACE', 'Invalid assistant run space.');
  }
  return normalized;
}

function normalizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Message => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return typeof record.role === 'string' && typeof record.content === 'string';
  });
}

function normalizeUploadedFiles(value: unknown): LocalAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is LocalAttachment => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return typeof record.name === 'string' && typeof record.content === 'string';
  });
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
