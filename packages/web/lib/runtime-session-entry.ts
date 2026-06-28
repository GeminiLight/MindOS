import type { AgentRuntimeIdentity, Message, RuntimeSessionBinding } from '@/lib/types';

export interface RuntimeSessionEntry {
  id: string;
  runtime: AgentRuntimeIdentity;
  title?: string | null;
  preview?: string;
  cwd?: string;
  createdAt?: number | string;
  updatedAt?: number | string;
  status?: RuntimeSessionBinding['status'] | string | null;
  archived?: boolean;
  messageCount?: number;
  turnCount?: number;
  turns?: unknown[];
  raw?: unknown;
}

export type RuntimeSessionEntryWithTurns = RuntimeSessionEntry & {
  turns?: unknown[];
};

type ImportedRuntimeMessage = {
  role: Message['role'];
  content: string;
  timestamp?: number;
};

const WRAPPER_KEYS = ['payload', 'message', 'item'] as const;
const EARLY_MESSAGE_COLLECTION_KEYS = ['conversationItems', 'conversation_items'] as const;
const MESSAGE_COLLECTION_KEYS = [
  'messages',
  'items',
  'events',
  'responseItems',
  'response_items',
  'outputItems',
  'output_items',
  'inputMessages',
  'input_messages',
  'outputMessages',
  'output_messages',
  'turns',
] as const;
const INPUT_KEYS = ['input', 'inputs', 'prompt', 'userInput', 'userMessage', 'user'] as const;
const OUTPUT_KEYS = ['output', 'outputs', 'response', 'assistantOutput', 'assistantMessage', 'assistant'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRole(value: unknown): Message['role'] | null {
  if (value === 'user' || value === 'assistant') return value;
  return null;
}

function roleFromType(value: unknown): Message['role'] | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase().replace(/[-_\s]+/g, '');
  if (normalized === 'usermessage' || normalized === 'inputmessage') return 'user';
  if (normalized === 'assistantmessage' || normalized === 'outputmessage') return 'assistant';
  return null;
}

function roleFromRecord(record: Record<string, unknown>): Message['role'] | null {
  const direct = normalizeRole(record.role) ?? normalizeRole(record.author) ?? normalizeRole(record.sender) ?? normalizeRole(record.from);
  if (direct) return direct;

  for (const key of ['author', 'sender', 'from']) {
    const nested = record[key];
    if (isRecord(nested)) {
      const nestedRole = normalizeRole(nested.role) ?? roleFromType(nested.type);
      if (nestedRole) return nestedRole;
    }
  }

  return null;
}

export function runtimeSessionTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function numericRecordField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function stringRecordField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function nullableStringRecordField(record: Record<string, unknown>, keys: readonly string[]): string | null | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || value === null) return value;
  }
  return undefined;
}

function textScalar(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;
  for (const key of ['text', 'value', 'content', 'markdown']) {
    const nested = value[key];
    if (typeof nested === 'string') return nested;
  }
  return null;
}

function firstTimestamp(record: Record<string, unknown>): number | undefined {
  return runtimeSessionTimestampMs(record.timestamp)
    ?? runtimeSessionTimestampMs(record.createdAt)
    ?? runtimeSessionTimestampMs(record.updatedAt)
    ?? runtimeSessionTimestampMs(record.completedAt)
    ?? undefined;
}

function textFromPart(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!isRecord(value)) return [];

  const type = typeof value.type === 'string' ? value.type : '';
  if (
    type === 'input_text'
    || type === 'output_text'
    || type === 'input'
    || type === 'output'
    || type === 'text'
    || type === 'markdown'
    || type === 'reasoning'
    || type === ''
  ) {
    const direct = textScalar(value.text) ?? textScalar(value.content) ?? textScalar(value.value) ?? textScalar(value.markdown);
    if (direct) return [direct];
  }

  return [];
}

function textFromKnownContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.flatMap(textFromPart).join('\n').trim();
  }
  if (isRecord(value)) {
    return textFromPart(value).join('\n').trim();
  }
  return '';
}

function directMessageFromRecord(
  record: Record<string, unknown>,
  defaultRole?: Message['role'],
): ImportedRuntimeMessage | null {
  const role = roleFromRecord(record) ?? roleFromType(record.type) ?? defaultRole ?? null;
  if (!role) return null;

  const content = textFromKnownContent(record.content)
    || textFromKnownContent(record.text)
    || textFromKnownContent(record.value)
    || textFromKnownContent(record.markdown)
    || textFromKnownContent(record.output_text)
    || textFromKnownContent(record.input_text);
  if (!content) return null;

  return {
    role,
    content,
    timestamp: firstTimestamp(record),
  };
}

function extractTextMessage(
  role: Message['role'],
  value: unknown,
  timestamp?: number,
): ImportedRuntimeMessage | null {
  const content = textFromKnownContent(value);
  return content ? { role, content, timestamp } : null;
}

function extractMessagesFromCollection(
  value: unknown,
  defaultRole?: Message['role'],
): ImportedRuntimeMessage[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractMessagesFromValue(item, defaultRole));
  }
  return extractMessagesFromValue(value, defaultRole);
}

function extractMessagesFromValue(
  value: unknown,
  defaultRole?: Message['role'],
): ImportedRuntimeMessage[] {
  if (!isRecord(value)) {
    const direct = defaultRole ? extractTextMessage(defaultRole, value) : null;
    return direct ? [direct] : [];
  }

  for (const key of WRAPPER_KEYS) {
    const wrapped = value[key];
    if (isRecord(wrapped)) {
      const messages = extractMessagesFromValue(wrapped, defaultRole);
      if (messages.length > 0) return messages;
    }
  }

  const direct = directMessageFromRecord(value, defaultRole);
  if (direct) return [direct];

  const timestamp = firstTimestamp(value);
  const messages: ImportedRuntimeMessage[] = [];

  for (const key of EARLY_MESSAGE_COLLECTION_KEYS) {
    const collection = value[key];
    if (collection === undefined || collection === null) continue;
    messages.push(...extractMessagesFromCollection(collection, defaultRole));
  }

  for (const key of INPUT_KEYS) {
    const input = value[key];
    if (input === undefined || input === null) continue;
    const inputMessages = extractMessagesFromCollection(input, 'user');
    if (inputMessages.length > 0) {
      messages.push(...inputMessages.map((message) => ({
        ...message,
        timestamp: message.timestamp ?? timestamp,
      })));
      continue;
    }
    const textMessage = extractTextMessage('user', input, timestamp);
    if (textMessage) messages.push(textMessage);
  }

  for (const key of OUTPUT_KEYS) {
    const output = value[key];
    if (output === undefined || output === null) continue;
    const outputMessages = extractMessagesFromCollection(output, 'assistant');
    if (outputMessages.length > 0) {
      messages.push(...outputMessages.map((message) => ({
        ...message,
        timestamp: message.timestamp ?? timestamp,
      })));
      continue;
    }
    const textMessage = extractTextMessage('assistant', output, timestamp);
    if (textMessage) messages.push(textMessage);
  }

  for (const key of MESSAGE_COLLECTION_KEYS) {
    const collection = value[key];
    if (collection === undefined || collection === null) continue;
    messages.push(...extractMessagesFromCollection(collection, defaultRole));
  }

  return messages;
}

function dedupeAdjacent(messages: ImportedRuntimeMessage[]): ImportedRuntimeMessage[] {
  const result: ImportedRuntimeMessage[] = [];
  for (const message of messages) {
    const content = message.content.replace(/\s+$/g, '');
    if (!content.trim()) continue;
    const previous = result[result.length - 1];
    if (previous && previous.role === message.role && previous.content === content) continue;
    result.push({ ...message, content });
  }
  return result;
}

function runtimeSessionMessagesFromTurns(turns: unknown[]): ImportedRuntimeMessage[] {
  return dedupeAdjacent(turns.flatMap((turn) => extractMessagesFromValue(turn)));
}

export function normalizeRuntimeSessionEntry(
  value: unknown,
  runtime: AgentRuntimeIdentity,
): RuntimeSessionEntry | null {
  if (!isRecord(value)) return null;
  const id = stringRecordField(value, ['id', 'sessionId', 'session_id', 'threadId', 'thread_id', 'externalSessionId']);
  if (!id?.trim()) return null;

  const turns = Array.isArray(value.turns)
    ? value.turns
    : Array.isArray(value.messages)
      ? value.messages
      : undefined;
  const inferredMessageCount = turns && turns.length > 0
    ? runtimeSessionMessagesFromTurns(turns).length
    : undefined;
  const messageCount = numericRecordField(value, 'messageCount')
    ?? numericRecordField(value, 'messagesCount')
    ?? numericRecordField(value, 'message_count')
    ?? inferredMessageCount;
  const turnCount = numericRecordField(value, 'turnCount')
    ?? numericRecordField(value, 'turnsCount')
    ?? numericRecordField(value, 'turn_count');
  const archived = typeof value.archived === 'boolean' ? value.archived : undefined;
  const statusValue = value.status;
  const status = typeof statusValue === 'string' || statusValue === null
    ? statusValue
    : archived
      ? 'archived'
      : undefined;

  return {
    id: id.trim(),
    runtime,
    ...(nullableStringRecordField(value, ['title', 'name', 'summary']) !== undefined
      ? { title: nullableStringRecordField(value, ['title', 'name', 'summary']) }
      : {}),
    ...(stringRecordField(value, ['preview', 'description', 'subtitle']) ? { preview: stringRecordField(value, ['preview', 'description', 'subtitle']) } : {}),
    ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
    ...(typeof value.createdAt === 'number' || typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'number' || typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(archived !== undefined ? { archived } : {}),
    ...(typeof messageCount === 'number' ? { messageCount } : {}),
    ...(typeof turnCount === 'number' ? { turnCount } : {}),
    ...(turns ? { turns } : {}),
    raw: value,
  };
}

export function shortRuntimeEntryId(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function runtimeSessionEntryNoun(entry: Pick<RuntimeSessionEntry, 'runtime'>): string {
  if (entry.runtime.kind === 'codex') return 'Codex thread';
  if (entry.runtime.kind === 'claude') return 'Claude Code session';
  if (entry.runtime.kind === 'acp') return `${entry.runtime.name || 'ACP'} session`;
  return 'runtime session';
}

export function runtimeSessionEntryTitle(entry: RuntimeSessionEntry, maxLength = 56): string {
  const title = entry.title?.trim() || entry.preview?.trim();
  if (title) return truncate(title, maxLength);
  return `${runtimeSessionEntryNoun(entry)} ${shortRuntimeEntryId(entry.id)}`;
}

export function runtimeSessionEntryPreview(entry: RuntimeSessionEntry, maxLength = 72): string {
  const preview = entry.preview?.trim();
  if (!preview || preview === entry.title?.trim()) return '';
  return truncate(preview, maxLength);
}

export function runtimeSessionEntryStatus(entry: RuntimeSessionEntry): string | null {
  if (entry.archived) return 'archived';
  return typeof entry.status === 'string' && entry.status.trim() ? entry.status : null;
}

export function runtimeSessionEntryBindingStatus(entry: RuntimeSessionEntry): RuntimeSessionBinding['status'] {
  const status = runtimeSessionEntryStatus(entry);
  if (
    status === 'active'
    || status === 'missing'
    || status === 'signed-out'
    || status === 'archived'
    || status === 'failed'
  ) {
    return status;
  }
  return 'active';
}

export function runtimeSessionEntryUpdatedAt(entry: Pick<RuntimeSessionEntry, 'updatedAt' | 'createdAt'>): number | string | undefined {
  return entry.updatedAt ?? entry.createdAt;
}

export function runtimeSessionEntryUpdatedAtMs(entry: Pick<RuntimeSessionEntry, 'updatedAt' | 'createdAt'>): number | null {
  return runtimeSessionTimestampMs(runtimeSessionEntryUpdatedAt(entry));
}

export function runtimeSessionEntryMessageCount(entry: RuntimeSessionEntryWithTurns): number | null {
  if (typeof entry.messageCount === 'number' && Number.isFinite(entry.messageCount) && entry.messageCount >= 0) {
    return Math.floor(entry.messageCount);
  }
  const turns = Array.isArray(entry.turns) ? entry.turns : [];
  if (turns.length > 0) {
    return runtimeSessionMessagesFromTurns(turns).length;
  }
  if (typeof entry.turnCount === 'number' && Number.isFinite(entry.turnCount) && entry.turnCount >= 0) {
    return Math.floor(entry.turnCount) * 2;
  }
  return null;
}

export function runtimeSessionEntryTurnsToMessages(
  entry: RuntimeSessionEntryWithTurns,
  runtime: AgentRuntimeIdentity = entry.runtime,
): Message[] {
  const turns = Array.isArray(entry.turns) ? entry.turns : [];
  if (turns.length === 0) return [];

  const fallbackTimestamp = runtimeSessionTimestampMs(entry.updatedAt) ?? runtimeSessionTimestampMs(entry.createdAt) ?? undefined;
  return runtimeSessionMessagesFromTurns(turns).map((message) => ({
    role: message.role,
    content: message.content,
    timestamp: message.timestamp ?? fallbackTimestamp,
    agentId: runtime.id,
    agentName: runtime.name,
    agentKind: runtime.kind,
  }));
}

export function runtimeSessionEntrySearchText(entry: RuntimeSessionEntry): string {
  return [
    entry.id,
    entry.runtime.name,
    entry.runtime.id,
    entry.runtime.kind,
    entry.title,
    entry.preview,
    entry.cwd,
    runtimeSessionEntryStatus(entry),
    runtimeSessionEntryMessageCount(entry),
  ].map((value) => {
    if (value === null || value === undefined) return '';
    return String(value).trim().toLowerCase();
  }).filter(Boolean).join('\n');
}

export function runtimeSessionEntryAttachBinding(entry: RuntimeSessionEntry): {
  externalSessionId: string;
  cwd?: string;
  status?: RuntimeSessionBinding['status'];
  updatedAt?: number | string;
} {
  return {
    externalSessionId: entry.id,
    ...(entry.cwd ? { cwd: entry.cwd } : {}),
    status: runtimeSessionEntryBindingStatus(entry),
    ...(runtimeSessionEntryUpdatedAt(entry) !== undefined ? { updatedAt: runtimeSessionEntryUpdatedAt(entry) } : {}),
  };
}

export function runtimeSessionEntryMatchesRuntime(
  entry: RuntimeSessionEntry,
  runtime: AgentRuntimeIdentity | null | undefined,
): boolean {
  return Boolean(runtime && entry.runtime.kind === runtime.kind && entry.runtime.id === runtime.id);
}
