import {
  MINDOS_SSE_HEADERS,
  type MindOSSSEvent,
} from '../../session/index.js';

export type MindosAskMessage = Record<string, unknown>;

export type MindosAskStreamRequest = {
  messages: MindosAskMessage[];
  currentFile?: string;
  attachedFiles?: string[];
  uploadedFiles?: Array<{ name: string; content: string }>;
  maxSteps?: number;
  mode?: 'chat' | 'agent' | 'organize';
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

  return {
    ok: true,
    body: {
      messages: record.messages.filter((message): message is MindosAskMessage => !!message && typeof message === 'object') as MindosAskMessage[],
      ...(typeof record.currentFile === 'string' ? { currentFile: record.currentFile } : {}),
      ...(Array.isArray(record.attachedFiles) ? { attachedFiles: record.attachedFiles.filter((item): item is string => typeof item === 'string') } : {}),
      ...(Array.isArray(record.uploadedFiles) ? { uploadedFiles: normalizeUploadedFiles(record.uploadedFiles) } : {}),
      ...(typeof record.maxSteps === 'number' && Number.isFinite(record.maxSteps) ? { maxSteps: record.maxSteps } : {}),
      ...(mode ? { mode } : {}),
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
