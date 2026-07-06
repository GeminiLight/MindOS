import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

type ImportedRole = 'user' | 'assistant';

export type ImportedRuntimeSessionMessage = {
  role: ImportedRole;
  content: string;
  timestamp?: number;
};

export type ExternalRuntimeSessionRecord = {
  id: string;
  title?: string | null;
  preview?: string;
  cwd?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  status?: string;
  messageCount?: number;
  turnCount?: number;
  turns?: ImportedRuntimeSessionMessage[];
  source: 'native-transcript';
  transcriptSource: 'kimi-code' | 'gemini-cli' | 'opencode' | 'claude-code';
};

export type ExternalRuntimeSessionListOptions = {
  runtimeId: string;
  cwd?: string;
  sessionId?: string;
  limit?: number;
  homeDir?: string;
};

type MaybeRecord = Record<string, unknown>;

const execFileAsync = promisify(execFile);
const DEFAULT_LIMIT = 30;
const MAX_TEXT_LENGTH = 80_000;
const MAX_JSONL_LINES = 20_000;
const KIMI_PROJECT_PREFIX = 'wd_';

function isRecord(value: unknown): value is MaybeRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || !value) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function timestampField(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function truncateContent(value: string): string {
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}...` : value;
}

function textFromPart(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!isRecord(value)) return [];
  const text = value.text ?? value.content ?? value.value ?? value.markdown;
  return typeof text === 'string' ? [text] : [];
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.flatMap(textFromPart).join('\n').trim();
  if (isRecord(value)) return textFromPart(value).join('\n').trim();
  return '';
}

function pushMessage(
  messages: ImportedRuntimeSessionMessage[],
  role: ImportedRole,
  content: string,
  timestamp?: number,
): void {
  const normalized = truncateContent(content.trim());
  if (!normalized) return;
  const previous = messages[messages.length - 1];
  if (previous?.role === role && previous.content === normalized) return;
  messages.push({ role, content: normalized, ...(timestamp !== undefined ? { timestamp } : {}) });
}

async function readJsonFile(path: string): Promise<MaybeRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readJsonl(path: string): Promise<MaybeRecord[]> {
  try {
    const text = await readFile(path, 'utf8');
    const records: MaybeRecord[] = [];
    for (const line of text.split(/\r?\n/).slice(0, MAX_JSONL_LINES)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (isRecord(parsed)) records.push(parsed);
      } catch {
        // Ignore malformed tail lines from in-progress CLI writes.
      }
    }
    return records;
  } catch {
    return [];
  }
}

function projectBaseFromCwd(cwd?: string): string | null {
  if (!cwd?.trim()) return null;
  const base = basename(resolve(cwd.trim()));
  return base || null;
}

function claudeProjectDirNameFromCwd(cwd: string): string {
  return resolve(cwd.trim()).replace(/[^A-Za-z0-9_-]/g, '-');
}

function claudeSessionJsonlFileName(sessionId?: string): string | null {
  const trimmed = sessionId?.trim();
  if (!trimmed) return null;
  if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) return null;
  return `${trimmed}.jsonl`;
}

function kimiProjectDirMatches(projectDirName: string, cwd?: string): boolean {
  const base = projectBaseFromCwd(cwd);
  if (!base) return true;
  return projectDirName.startsWith(`${KIMI_PROJECT_PREFIX}${base}_`)
    || projectDirName.startsWith(`${KIMI_PROJECT_PREFIX}.${base}_`)
    || projectDirName.includes(`_${base}_`);
}

function roleFromGeminiType(type: unknown): ImportedRole | null {
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

export type OpenCodeTextRow = {
  session_id?: string;
  message_id?: string;
  message_time_created?: number;
  message_data?: string;
  part_time_created?: number;
  part_data?: string;
};

type OpenCodeSessionRow = {
  id: string;
  directory: string;
  title: string;
  time_created: number;
  time_updated: number;
};

type OpenCodeDbListOptions = {
  cwd?: string;
  sessionId?: string;
  limit?: number;
};

interface OpenCodeDbReader {
  listSessions(options: OpenCodeDbListOptions): Promise<OpenCodeSessionRow[]>;
  listTextRows(sessionId: string): Promise<OpenCodeTextRow[]>;
}

export function parseOpenCodeTextRows(rows: OpenCodeTextRow[]): ImportedRuntimeSessionMessage[] {
  const grouped = new Map<string, {
    role: ImportedRole;
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

export function parseClaudeMessagesFromRecords(records: MaybeRecord[]): ImportedRuntimeSessionMessage[] {
  const messages: ImportedRuntimeSessionMessage[] = [];
  for (const record of records) {
    if (record.isSidechain === true) continue;
    const message = isRecord(record.message) ? record.message : record;
    const role = message.role === 'user' || message.role === 'assistant'
      ? message.role
      : record.type === 'user' || record.type === 'assistant'
        ? record.type
        : null;
    if (!role) continue;
    pushMessage(messages, role, textFromClaudeContent(message.content), timestampMs(record.timestamp));
  }
  return messages;
}

function textFromClaudeContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return textFromContent(value);
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (!isRecord(item)) return [];
    if (item.type !== undefined && item.type !== 'text') return [];
    return textFromPart(item);
  }).join('\n').trim();
}

function firstStringField(records: MaybeRecord[], key: string): string | undefined {
  for (const record of records) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function newestTimestampField(records: MaybeRecord[], key: string): string | number | undefined {
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

function toExternalRecord(input: {
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

async function listKimiSessions(options: ExternalRuntimeSessionListOptions): Promise<ExternalRuntimeSessionRecord[]> {
  const root = join(options.homeDir ?? homedir(), '.kimi-code', 'sessions');
  if (!existsSync(root)) return [];
  const projectDirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const records: ExternalRuntimeSessionRecord[] = [];
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory() || !kimiProjectDirMatches(projectDir.name, options.cwd)) continue;
    const projectPath = join(root, projectDir.name);
    const sessionDirs = await readdir(projectPath, { withFileTypes: true }).catch(() => []);
    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) continue;
      if (options.sessionId && sessionDir.name !== options.sessionId) continue;
      const sessionPath = join(projectPath, sessionDir.name);
      const state = await readJsonFile(join(sessionPath, 'state.json'));
      const wirePath = join(sessionPath, 'agents', 'main', 'wire.jsonl');
      const messages = parseKimiWireMessages(await readJsonl(wirePath));
      if (messages.length === 0 && !state) continue;
      records.push(toExternalRecord({
        id: sessionDir.name,
        title: typeof state?.title === 'string' ? state.title : null,
        preview: typeof state?.lastPrompt === 'string' ? state.lastPrompt : undefined,
        cwd: options.cwd,
        createdAt: timestampField(state?.createdAt),
        updatedAt: timestampField(state?.updatedAt),
        messages,
        transcriptSource: 'kimi-code',
      }));
    }
  }
  return sortAndLimit(records, options.limit);
}

async function geminiProjectDirs(homeDir: string, cwd?: string): Promise<string[]> {
  const roots = [
    join(homeDir, '.gemini', 'tmp'),
    join(homeDir, '.gemini', 'history'),
  ];
  const base = projectBaseFromCwd(cwd);
  const result: string[] = [];
  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (base && entry.name !== base) continue;
      const projectPath = join(root, entry.name);
      const projectRoot = await readFile(join(projectPath, '.project_root'), 'utf8').catch(() => '');
      if (cwd?.trim() && projectRoot.trim() && resolve(projectRoot.trim()) !== resolve(cwd.trim())) continue;
      result.push(projectPath);
    }
  }
  return [...new Set(result)];
}

async function listGeminiSessions(options: ExternalRuntimeSessionListOptions): Promise<ExternalRuntimeSessionRecord[]> {
  const home = options.homeDir ?? homedir();
  const records: ExternalRuntimeSessionRecord[] = [];
  for (const projectPath of await geminiProjectDirs(home, options.cwd)) {
    const chatsDir = join(projectPath, 'chats');
    const chatFiles = await readdir(chatsDir, { withFileTypes: true }).catch(() => []);
    for (const file of chatFiles) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const recordsFromFile = await readJsonl(join(chatsDir, file.name));
      const metadata = recordsFromFile.find((record) => typeof record.sessionId === 'string');
      const sessionId = typeof metadata?.sessionId === 'string'
        ? metadata.sessionId
        : file.name.replace(/\.jsonl$/, '');
      if (options.sessionId && sessionId !== options.sessionId) continue;
      const fileStat = await stat(join(chatsDir, file.name)).catch(() => null);
      const messages = parseGeminiMessagesFromRecords(recordsFromFile);
      records.push(toExternalRecord({
        id: sessionId,
        title: messages[0]?.content ? messages[0].content.slice(0, 80) : sessionId,
        cwd: options.cwd,
        createdAt: timestampField(metadata?.startTime) ?? fileStat?.birthtimeMs,
        updatedAt: timestampField(metadata?.lastUpdated) ?? fileStat?.mtimeMs,
        messages,
        transcriptSource: 'gemini-cli',
      }));
    }
  }
  return sortAndLimit(records, options.limit);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runSqliteJson<T extends MaybeRecord>(
  dbPath: string,
  sql: string,
): Promise<T[]> {
  if (!existsSync(dbPath)) return [];
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', dbPath, sql], {
      maxBuffer: 10 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout || '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecord) as T[] : [];
  } catch {
    return [];
  }
}

function createOpenCodeSqliteCliReader(dbPath: string): OpenCodeDbReader {
  return {
    listSessions(options) {
      const where: string[] = [];
      if (options.cwd?.trim()) where.push(`directory = ${sqlString(resolve(options.cwd.trim()))}`);
      if (options.sessionId?.trim()) where.push(`id = ${sqlString(options.sessionId.trim())}`);
      return runSqliteJson<OpenCodeSessionRow>(
        dbPath,
        `select id, directory, title, time_created, time_updated from session${where.length ? ` where ${where.join(' and ')}` : ''} order by time_updated desc limit ${safeLimit(options.limit)};`,
      );
    },
    listTextRows(sessionId) {
      return runSqliteJson<OpenCodeTextRow>(
        dbPath,
        `select m.id as message_id, m.time_created as message_time_created, m.data as message_data, p.time_created as part_time_created, p.data as part_data from message m join part p on p.message_id = m.id where m.session_id = ${sqlString(sessionId)} order by m.time_created, p.time_created;`,
      );
    },
  };
}

function createOpenCodeDbReaders(dbPath: string): OpenCodeDbReader[] {
  return [
    createOpenCodeSqliteCliReader(dbPath),
  ];
}

async function listOpenCodeSessions(options: ExternalRuntimeSessionListOptions): Promise<ExternalRuntimeSessionRecord[]> {
  const home = options.homeDir ?? homedir();
  const dbPath = join(home, '.local', 'share', 'opencode', 'opencode.db');
  const [reader] = createOpenCodeDbReaders(dbPath);
  if (!reader) return [];
  const rows = await reader.listSessions(options);

  const records: ExternalRuntimeSessionRecord[] = [];
  for (const row of rows) {
    if (typeof row.id !== 'string') continue;
    const textRows = await reader.listTextRows(row.id);
    const messages = parseOpenCodeTextRows(textRows);
    records.push(toExternalRecord({
      id: row.id,
      title: typeof row.title === 'string' ? row.title : row.id,
      cwd: typeof row.directory === 'string' ? row.directory : options.cwd,
      createdAt: row.time_created,
      updatedAt: row.time_updated,
      messages,
      transcriptSource: 'opencode',
    }));
  }
  return sortAndLimit(records, options.limit);
}

async function listClaudeSessions(options: ExternalRuntimeSessionListOptions): Promise<ExternalRuntimeSessionRecord[]> {
  const home = options.homeDir ?? homedir();
  const root = join(home, '.claude', 'projects');
  if (!existsSync(root)) return [];
  const requestedFileName = claudeSessionJsonlFileName(options.sessionId);
  if (options.sessionId && !requestedFileName) return [];

  const projectDirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const expectedProjectDir = options.cwd?.trim() ? claudeProjectDirNameFromCwd(options.cwd) : null;
  const orderedProjectDirs = projectDirs
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => {
      if (!expectedProjectDir) return a.name.localeCompare(b.name);
      if (a.name === expectedProjectDir) return -1;
      if (b.name === expectedProjectDir) return 1;
      return a.name.localeCompare(b.name);
    });

  const records: ExternalRuntimeSessionRecord[] = [];
  for (const projectDir of orderedProjectDirs) {
    if (!options.sessionId && expectedProjectDir && projectDir.name !== expectedProjectDir) continue;
    const projectPath = join(root, projectDir.name);
    const files = requestedFileName
      ? existsSync(join(projectPath, requestedFileName))
        ? [{ name: requestedFileName, isFile: () => true }]
        : []
      : await readdir(projectPath, { withFileTypes: true }).catch(() => []);

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const filePath = join(projectPath, file.name);
      const recordsFromFile = await readJsonl(filePath);
      const fileSessionId = file.name.replace(/\.jsonl$/, '');
      const sessionId = firstStringField(recordsFromFile, 'sessionId')
        ?? firstStringField(recordsFromFile, 'session_id')
        ?? fileSessionId;
      if (options.sessionId && sessionId !== options.sessionId && fileSessionId !== options.sessionId) continue;

      const cwd = firstStringField(recordsFromFile, 'cwd') ?? options.cwd;
      if (!options.sessionId && options.cwd?.trim() && cwd && resolve(cwd) !== resolve(options.cwd.trim())) continue;

      const fileStat = await stat(filePath).catch(() => null);
      const messages = parseClaudeMessagesFromRecords(recordsFromFile);
      if (messages.length === 0 && recordsFromFile.length === 0) continue;
      const firstUserMessage = messages.find((message) => message.role === 'user');
      const userMessages = messages.filter((message) => message.role === 'user');
      const lastUserMessage = userMessages[userMessages.length - 1];
      const firstTimestamp = timestampField(recordsFromFile.find((record) => timestampField(record.timestamp))?.timestamp);

      records.push(toExternalRecord({
        id: sessionId,
        title: firstUserMessage?.content ? firstUserMessage.content.slice(0, 80) : sessionId,
        preview: lastUserMessage && lastUserMessage !== firstUserMessage ? lastUserMessage.content.slice(0, 120) : undefined,
        cwd,
        createdAt: firstTimestamp ?? fileStat?.birthtimeMs,
        updatedAt: newestTimestampField(recordsFromFile, 'timestamp') ?? fileStat?.mtimeMs,
        messages,
        transcriptSource: 'claude-code',
      }));
    }
  }
  return sortAndLimit(records, options.limit);
}

function sortAndLimit(
  records: ExternalRuntimeSessionRecord[],
  limit = DEFAULT_LIMIT,
): ExternalRuntimeSessionRecord[] {
  return records
    .slice()
    .sort((a, b) => (timestampMs(b.updatedAt) ?? 0) - (timestampMs(a.updatedAt) ?? 0))
    .slice(0, safeLimit(limit));
}

export async function listExternalRuntimeSessions(
  options: ExternalRuntimeSessionListOptions,
): Promise<ExternalRuntimeSessionRecord[]> {
  const runtimeId = options.runtimeId.trim().toLowerCase();
  if (runtimeId === 'kimi' || runtimeId === 'kimi-cli' || runtimeId === 'kimi-code') {
    return listKimiSessions(options);
  }
  if (runtimeId === 'gemini' || runtimeId === 'gemini-cli') {
    return listGeminiSessions(options);
  }
  if (runtimeId === 'opencode') {
    return listOpenCodeSessions(options);
  }
  if (runtimeId === 'claude' || runtimeId === 'claude-code') {
    return listClaudeSessions(options);
  }
  return [];
}
