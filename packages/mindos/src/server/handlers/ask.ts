import {
  MINDOS_SSE_HEADERS,
  type MindOSSSEvent,
} from '../../session/index.js';

export type MindosAskMessage = Record<string, unknown>;

export type MindosAgentRuntimeKind = 'mindos' | 'acp' | 'codex' | 'claude';

export type MindosSelectedRuntime = {
  id: string;
  name: string;
  kind: MindosAgentRuntimeKind;
  externalSessionId?: string;
};

export type MindosRuntimeSessionBinding = {
  kind: 'codex-thread' | 'claude-session' | 'acp-session';
  runtime: Exclude<MindosAgentRuntimeKind, 'mindos'>;
  runtimeId: string;
  externalSessionId?: string;
  cwd?: string;
  status?: 'active' | 'missing' | 'signed-out' | 'archived' | 'failed';
  updatedAt: number;
};

export type MindosAskStreamRequest = {
  messages: MindosAskMessage[];
  currentFile?: string;
  attachedFiles?: string[];
  uploadedFiles?: Array<{ name: string; content: string }>;
  maxSteps?: number;
  mode?: 'chat' | 'agent' | 'organize';
  selectedRuntime?: MindosSelectedRuntime | null;
  runtimeBinding?: MindosRuntimeSessionBinding | null;
  selectedAcpAgent?: { id: string; name: string } | null;
  providerOverride?: string;
  modelOverride?: string;
};

export type AskStreamHandlerServices = {
  askStream(input: MindosAskStreamRequest): AsyncIterable<MindOSSSEvent>;
};

export type AskStreamHandlerResult =
  | { ok: true; status: 200; headers: Record<string, string>; body: AsyncIterable<MindOSSSEvent> }
  | { ok: false; status: number; body: { error: string } };

export function handleAskStream(
  body: unknown,
  services: AskStreamHandlerServices,
): AskStreamHandlerResult {
  const parsed = parseAskStreamRequest(body);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    status: 200,
    headers: MINDOS_SSE_HEADERS,
    body: services.askStream(parsed.body),
  };
}

function parseAskStreamRequest(body: unknown):
  | { ok: true; body: MindosAskStreamRequest }
  | { ok: false; status: number; body: { error: string } } {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, body: { error: 'Invalid ask request body' } };
  }

  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.messages)) {
    return { ok: false, status: 400, body: { error: 'messages must be an array' } };
  }

  const mode = record.mode;
  if (mode !== undefined && mode !== 'chat' && mode !== 'agent' && mode !== 'organize') {
    return { ok: false, status: 400, body: { error: 'mode must be chat, agent, or organize' } };
  }

  const selectedRuntime = normalizeSelectedRuntime(record);
  const runtimeBinding = normalizeRuntimeSessionBinding(record.runtimeBinding);

  return {
    ok: true,
    body: {
      messages: record.messages.filter((message): message is MindosAskMessage => !!message && typeof message === 'object') as MindosAskMessage[],
      ...(typeof record.currentFile === 'string' ? { currentFile: record.currentFile } : {}),
      ...(Array.isArray(record.attachedFiles) ? { attachedFiles: record.attachedFiles.filter((item): item is string => typeof item === 'string') } : {}),
      ...(Array.isArray(record.uploadedFiles) ? { uploadedFiles: normalizeUploadedFiles(record.uploadedFiles) } : {}),
      ...(typeof record.maxSteps === 'number' && Number.isFinite(record.maxSteps) ? { maxSteps: record.maxSteps } : {}),
      ...(mode ? { mode } : {}),
      ...(selectedRuntime !== undefined ? { selectedRuntime } : {}),
      ...(runtimeBinding !== undefined ? { runtimeBinding } : {}),
      ...(isSelectedAcpAgent(record.selectedAcpAgent) ? { selectedAcpAgent: record.selectedAcpAgent } : {}),
      ...(typeof record.providerOverride === 'string' ? { providerOverride: record.providerOverride } : {}),
      ...(typeof record.modelOverride === 'string' ? { modelOverride: record.modelOverride } : {}),
    },
  };
}

function normalizeUploadedFiles(files: unknown[]): Array<{ name: string; content: string }> {
  return files
    .filter((file): file is Record<string, unknown> => !!file && typeof file === 'object')
    .filter((file) => typeof file.name === 'string' && typeof file.content === 'string')
    .map((file) => ({ name: file.name as string, content: file.content as string }));
}

function isSelectedAcpAgent(value: unknown): value is { id: string; name: string } | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.name === 'string';
}

function normalizeRuntimeSessionBinding(value: unknown): MindosRuntimeSessionBinding | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (!isRuntimeSessionKind(record.kind) || !isExternalRuntimeKind(record.runtime)) return undefined;
  if (typeof record.runtimeId !== 'string' || typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) return undefined;
  const binding: MindosRuntimeSessionBinding = {
    kind: record.kind,
    runtime: record.runtime,
    runtimeId: record.runtimeId,
    updatedAt: record.updatedAt,
  };
  if (typeof record.externalSessionId === 'string') binding.externalSessionId = record.externalSessionId;
  if (typeof record.cwd === 'string') binding.cwd = record.cwd;
  if (isRuntimeSessionStatus(record.status)) binding.status = record.status;
  return binding;
}

function isRuntimeSessionKind(value: unknown): value is MindosRuntimeSessionBinding['kind'] {
  return value === 'codex-thread' || value === 'claude-session' || value === 'acp-session';
}

function isExternalRuntimeKind(value: unknown): value is MindosRuntimeSessionBinding['runtime'] {
  return value === 'acp' || value === 'codex' || value === 'claude';
}

function isRuntimeSessionStatus(value: unknown): value is NonNullable<MindosRuntimeSessionBinding['status']> {
  return value === 'active' || value === 'missing' || value === 'signed-out' || value === 'archived' || value === 'failed';
}

function normalizeSelectedRuntime(record: Record<string, unknown>): MindosSelectedRuntime | null | undefined {
  if (record.selectedRuntime === null) return null;
  if (isSelectedRuntime(record.selectedRuntime)) {
    const runtime = record.selectedRuntime as Record<string, unknown>;
    return {
      id: runtime.id as string,
      name: runtime.name as string,
      kind: runtime.kind as MindosAgentRuntimeKind,
      ...(typeof runtime.externalSessionId === 'string' && runtime.externalSessionId
        ? { externalSessionId: runtime.externalSessionId }
        : {}),
    };
  }

  if (!isSelectedAcpAgent(record.selectedAcpAgent) || record.selectedAcpAgent === null) {
    return record.selectedAcpAgent === null ? null : undefined;
  }

  return {
    ...record.selectedAcpAgent,
    kind: 'acp',
  };
}

function isSelectedRuntime(value: unknown): value is MindosSelectedRuntime {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string'
    && typeof record.name === 'string'
    && isAgentRuntimeKind(record.kind)
  );
}

function isAgentRuntimeKind(value: unknown): value is MindosAgentRuntimeKind {
  return value === 'mindos' || value === 'acp' || value === 'codex' || value === 'claude';
}
