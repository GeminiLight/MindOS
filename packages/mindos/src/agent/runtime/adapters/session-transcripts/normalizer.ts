import type {
  ExternalRuntimeSessionRecord,
  ImportedRuntimeSessionMessage,
  ImportedRuntimeSessionRole,
  MaybeRecord,
} from './types.js';

export const DEFAULT_RUNTIME_SESSION_TRANSCRIPT_LIMIT = 30;
export const MAX_RUNTIME_SESSION_TEXT_LENGTH = 80_000;
export const VISIBLE_TEXT_PART_TYPES = new Set(['text', 'output_text', 'markdown']);

export type OpenCodeTextRow = {
  session_id?: string;
  message_id?: string;
  message_time_created?: number;
  message_data?: string;
  part_time_created?: number;
  part_data?: string;
};

export function isRecord(value: unknown): value is MaybeRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function safeLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || !value) return DEFAULT_RUNTIME_SESSION_TRANSCRIPT_LIMIT;
  return Math.max(1, Math.min(100, Math.floor(value)));
}

export function timestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function timestampField(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

export function truncateContent(value: string): string {
  return value.length > MAX_RUNTIME_SESSION_TEXT_LENGTH
    ? `${value.slice(0, MAX_RUNTIME_SESSION_TEXT_LENGTH)}...`
    : value;
}

function textFromPart(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!isRecord(value)) return [];
  const text = value.text ?? value.content ?? value.value ?? value.markdown;
  return typeof text === 'string' ? [text] : [];
}

export function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.flatMap(textFromPart).join('\n').trim();
  if (isRecord(value)) return textFromPart(value).join('\n').trim();
  return '';
}

function textFromVisiblePart(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!isRecord(value)) return [];
  const partType = typeof value.type === 'string' ? value.type : undefined;
  if (partType && !VISIBLE_TEXT_PART_TYPES.has(partType)) return [];

  const directText = [value.text, value.value, value.markdown]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  if (directText.length > 0) return directText;

  if (value.content !== undefined && value.content !== null) {
    const nested = textFromVisibleContent(value.content);
    return nested ? [nested] : [];
  }
  return [];
}

export function textFromVisibleContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.flatMap(textFromVisiblePart).join('\n').trim();
  if (isRecord(value)) return textFromVisiblePart(value).join('\n').trim();
  return '';
}

export function pushMessage(
  messages: ImportedRuntimeSessionMessage[],
  role: ImportedRuntimeSessionRole,
  content: string,
  timestamp?: number,
): void {
  const normalized = truncateContent(content.trim());
  if (!normalized) return;
  const previous = messages[messages.length - 1];
  if (previous?.role === role && previous.content === normalized) return;
  messages.push({ role, content: normalized, ...(timestamp !== undefined ? { timestamp } : {}) });
}

function roleFromGeminiType(type: unknown): ImportedRuntimeSessionRole | null {
  if (type === 'user') return 'user';
  if (type === 'assistant' || type === 'model' || type === 'gemini') return 'assistant';
  return null;
}

export function parseGeminiMessagesFromRecords(records: MaybeRecord[]): ImportedRuntimeSessionMessage[] {
  let latestMessages: unknown[] = [];
  for (const record of records) {
    const direct = Array.isArray(record.messages) ? record.messages : undefined;
    const nestedSet = isRecord(record.$set) && Array.isArray(record.$set.messages)
      ? record.$set.messages
      : undefined;
    if (direct) latestMessages = direct;
    if (nestedSet) latestMessages = nestedSet;
  }

  const messages: ImportedRuntimeSessionMessage[] = [];
  for (const item of latestMessages) {
    if (!isRecord(item)) continue;
    const role = roleFromGeminiType(item.type) ?? roleFromGeminiType(item.role);
    if (!role) continue;
    pushMessage(messages, role, textFromContent(item.content ?? item.text), timestampMs(item.timestamp));
  }
  return messages;
}

type KimiPendingAssistant = {
  turnId: string;
  chunks: string[];
  timestamp?: number;
};

function flushKimiAssistant(messages: ImportedRuntimeSessionMessage[], pending: KimiPendingAssistant | null): null {
  if (!pending) return null;
  pushMessage(messages, 'assistant', pending.chunks.join(''), pending.timestamp);
  return null;
}

export function parseKimiWireMessages(records: MaybeRecord[]): ImportedRuntimeSessionMessage[] {
  const messages: ImportedRuntimeSessionMessage[] = [];
  let pendingAssistant: KimiPendingAssistant | null = null;

  for (const record of records) {
    if (record.type === 'context.append_message' && isRecord(record.message)) {
      const role = record.message.role === 'user' || record.message.role === 'assistant'
        ? record.message.role
        : null;
      const content = textFromContent(record.message.content ?? record.message.text);
      if (role && content) {
        pendingAssistant = flushKimiAssistant(messages, pendingAssistant);
        pushMessage(messages, role, content, timestampMs(record.time));
      }
      continue;
    }

    if (record.type !== 'context.append_loop_event' || !isRecord(record.event)) continue;
    const event = record.event;
    if (event.type !== 'content.part' || !isRecord(event.part)) continue;
    if (event.part.type !== 'text' || typeof event.part.text !== 'string') continue;

    const turnId = typeof event.turnId === 'string' ? event.turnId : '';
    if (!pendingAssistant || pendingAssistant.turnId !== turnId) {
      pendingAssistant = flushKimiAssistant(messages, pendingAssistant);
      pendingAssistant = {
        turnId,
        chunks: [],
        timestamp: timestampMs(record.time),
      };
    }
    pendingAssistant.chunks.push(event.part.text);
  }

  flushKimiAssistant(messages, pendingAssistant);
  return messages;
}

export function parseOpenCodeTextRows(rows: OpenCodeTextRow[]): ImportedRuntimeSessionMessage[] {
  const grouped = new Map<string, {
    role: ImportedRuntimeSessionRole;
    timestamp?: number;
    chunks: string[];
  }>();
  const order: string[] = [];

  for (const row of rows) {
    if (!row.message_id || !row.message_data || !row.part_data) continue;
    let messageData: MaybeRecord;
    let partData: MaybeRecord;
    try {
      const parsedMessage = JSON.parse(row.message_data);
      const parsedPart = JSON.parse(row.part_data);
      if (!isRecord(parsedMessage) || !isRecord(parsedPart)) continue;
      messageData = parsedMessage;
      partData = parsedPart;
    } catch {
      continue;
    }
    const role = messageData.role === 'user' || messageData.role === 'assistant'
      ? messageData.role
      : null;
    if (!role || partData.type !== 'text') continue;
    const text = typeof partData.text === 'string' ? partData.text : '';
    if (!text.trim()) continue;
    if (!grouped.has(row.message_id)) {
      order.push(row.message_id);
      grouped.set(row.message_id, {
        role,
        timestamp: timestampMs(row.message_time_created),
        chunks: [],
      });
    }
    grouped.get(row.message_id)?.chunks.push(text);
  }

  const messages: ImportedRuntimeSessionMessage[] = [];
  for (const key of order) {
    const message = grouped.get(key);
    if (!message) continue;
    pushMessage(messages, message.role, message.chunks.join('\n'), message.timestamp);
  }
  return messages;
}

function roleFromVisibleRecord(record: MaybeRecord, message: MaybeRecord): ImportedRuntimeSessionRole | null {
  const candidates = [
    message.role,
    record.role,
    message.author,
    record.author,
    message.sender,
    record.sender,
    message.type,
    record.type,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.toLowerCase().replace(/[-_\s]+/g, '');
    if (normalized === 'user' || normalized === 'human' || normalized === 'usermessage') return 'user';
    if (
      normalized === 'assistant'
      || normalized === 'model'
      || normalized === 'agent'
      || normalized === 'assistantmessage'
      || normalized === 'aimessage'
    ) {
      return 'assistant';
    }
  }
  return null;
}

function timestampFromVisibleRecord(record: MaybeRecord, message: MaybeRecord): number | undefined {
  return timestampMs(record.timestamp)
    ?? timestampMs(message.timestamp)
    ?? timestampMs(record.createdAt)
    ?? timestampMs(message.createdAt)
    ?? timestampMs(record.created_at)
    ?? timestampMs(message.created_at)
    ?? timestampMs(record.time)
    ?? timestampMs(message.time);
}

export function parseVisibleMessagesFromRecords(records: MaybeRecord[]): ImportedRuntimeSessionMessage[] {
  const messages: ImportedRuntimeSessionMessage[] = [];
  for (const record of records) {
    if (record.isSidechain === true) continue;
    const message = isRecord(record.message) ? record.message : record;
    const role = roleFromVisibleRecord(record, message);
    if (!role) continue;
    pushMessage(
      messages,
      role,
      textFromVisibleContent(message.content ?? record.content ?? message.text ?? record.text),
      timestampFromVisibleRecord(record, message),
    );
  }
  return messages;
}

export function parseClaudeMessagesFromRecords(records: MaybeRecord[]): ImportedRuntimeSessionMessage[] {
  return parseVisibleMessagesFromRecords(records);
}

export function firstStringField(records: MaybeRecord[], key: string): string | undefined {
  for (const record of records) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function newestTimestampField(records: MaybeRecord[], key: string): string | number | undefined {
  let bestValue: string | number | undefined;
  let bestMs = -Infinity;
  for (const record of records) {
    const value = timestampField(record[key]);
    const ms = timestampMs(value);
    if (value !== undefined && ms !== undefined && ms >= bestMs) {
      bestValue = value;
      bestMs = ms;
    }
  }
  return bestValue;
}

export function firstStringFromRecords(records: MaybeRecord[], keys: string[]): string | undefined {
  for (const key of keys) {
    const value = firstStringField(records, key);
    if (value) return value;
  }
  return undefined;
}

export function firstTimestampFromRecords(records: MaybeRecord[], keys: string[]): string | number | undefined {
  for (const key of keys) {
    const record = records.find((item) => timestampField(item[key]) !== undefined);
    const value = record ? timestampField(record[key]) : undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}

export function sessionHeaderRecord(records: MaybeRecord[]): MaybeRecord | undefined {
  return records.find((record) => record.type === 'session' || record.type === 'session_start');
}

export function sessionIdFromRecords(records: MaybeRecord[], fallback: string): string {
  const header = sessionHeaderRecord(records);
  const headerId = isRecord(header) && typeof header.id === 'string' ? header.id.trim() : '';
  return firstStringFromRecords(records, ['sessionId', 'session_id', 'conversationId', 'conversation_id'])
    ?? (headerId || fallback);
}

export function firstUserMessage(
  messages: ImportedRuntimeSessionMessage[],
): ImportedRuntimeSessionMessage | undefined {
  return messages.find((message) => message.role === 'user');
}

export function lastUserMessage(
  messages: ImportedRuntimeSessionMessage[],
): ImportedRuntimeSessionMessage | undefined {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages[userMessages.length - 1];
}

export function toExternalRecord(input: {
  id: string;
  title?: string | null;
  preview?: string;
  cwd?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  messages: ImportedRuntimeSessionMessage[];
  transcriptSource: ExternalRuntimeSessionRecord['transcriptSource'];
}): ExternalRuntimeSessionRecord {
  return {
    id: input.id,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.preview ? { preview: input.preview } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
    ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {}),
    messageCount: input.messages.length,
    ...(input.messages.some((message) => message.role === 'user')
      ? { turnCount: input.messages.filter((message) => message.role === 'user').length }
      : {}),
    turns: input.messages,
    source: 'native-transcript',
    transcriptSource: input.transcriptSource,
  };
}

export function sortAndLimit(
  records: ExternalRuntimeSessionRecord[],
  limit = DEFAULT_RUNTIME_SESSION_TRANSCRIPT_LIMIT,
): ExternalRuntimeSessionRecord[] {
  return records
    .slice()
    .sort((a, b) => (timestampMs(b.updatedAt) ?? 0) - (timestampMs(a.updatedAt) ?? 0))
    .slice(0, safeLimit(limit));
}
