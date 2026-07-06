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
  transcriptSource:
    | 'kimi-code'
    | 'gemini-cli'
    | 'opencode'
    | 'claude-code'
    | 'qwen-code'
    | 'codebuddy-code'
    | 'openclaw';
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
const MAX_DISCOVERED_TRANSCRIPTS = 500;
const KIMI_PROJECT_PREFIX = 'wd_';
const VISIBLE_TEXT_PART_TYPES = new Set(['text', 'output_text', 'markdown']);
const CODEBUDDY_SKIPPED_DIRS = new Set(['blobs', 'subagents', 'tool-results']);
const OPENCLAW_STATE_DIRS = ['.openclaw', '.kimi_openclaw', '.clawdbot'];

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

function textFromVisibleContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.flatMap(textFromVisiblePart).join('\n').trim();
  if (isRecord(value)) return textFromVisiblePart(value).join('\n').trim();
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

function jsonlFileNameFromSessionId(sessionId?: string): string | null {
  const trimmed = sessionId?.trim();
  if (!trimmed) return null;
  if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) return null;
  return `${trimmed}.jsonl`;
}

function sanitizedProjectDirNameFromCwd(cwd: string): string {
  return resolve(cwd.trim()).replace(/[^A-Za-z0-9_-]/g, '-');
}

function kimiProjectDirMatches(projectDirName: string, cwd?: string): boolean {
  const base = projectBaseFromCwd(cwd);
  if (!base) return true;
  return projectDirName.startsWith(`${KIMI_PROJECT_PREFIX}${base}_`)
    || projectDirName.startsWith(`${KIMI_PROJECT_PREFIX}.${base}_`)
    || projectDirName.includes(`_${base}_`);
}

function qwenProjectDirMatches(projectDirName: string, cwd?: string): boolean {
  const base = projectBaseFromCwd(cwd);
  if (!base) return true;
  const sanitized = cwd?.trim() ? sanitizedProjectDirNameFromCwd(cwd).toLowerCase() : '';
  const normalizedName = projectDirName.toLowerCase();
  return normalizedName === base.toLowerCase()
    || normalizedName.includes(base.toLowerCase())
    || Boolean(sanitized && normalizedName === sanitized);
}

function sameResolvedPath(a: string, b: string): boolean {
  try {
    return resolve(a.trim()) === resolve(b.trim());
  } catch {
    return a.trim() === b.trim();
  }
}

function shouldSkipForRequestedCwd(input: {
  requestedCwd?: string;
  transcriptCwd?: string;
  sessionId?: string;
}): boolean {
  const requested = input.requestedCwd?.trim();
  if (!requested) return false;
  const transcriptCwd = input.transcriptCwd?.trim();
  if (!transcriptCwd) return !input.sessionId?.trim();
  return !sameResolvedPath(transcriptCwd, requested);
}

function pathInside(parent: string, child: string): boolean {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
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

function roleFromVisibleRecord(record: MaybeRecord, message: MaybeRecord): ImportedRole | null {
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

function firstStringFromRecords(records: MaybeRecord[], keys: string[]): string | undefined {
  for (const key of keys) {
    const value = firstStringField(records, key);
    if (value) return value;
  }
  return undefined;
}

function firstTimestampFromRecords(records: MaybeRecord[], keys: string[]): string | number | undefined {
  for (const key of keys) {
    const record = records.find((item) => timestampField(item[key]) !== undefined);
    const value = record ? timestampField(record[key]) : undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}

function sessionHeaderRecord(records: MaybeRecord[]): MaybeRecord | undefined {
  return records.find((record) => record.type === 'session' || record.type === 'session_start');
}

function sessionIdFromRecords(records: MaybeRecord[], fallback: string): string {
  const header = sessionHeaderRecord(records);
  const headerId = isRecord(header) && typeof header.id === 'string' ? header.id.trim() : '';
  return firstStringFromRecords(records, ['sessionId', 'session_id', 'conversationId', 'conversation_id'])
    ?? (headerId || fallback);
}

function firstUserMessage(messages: ImportedRuntimeSessionMessage[]): ImportedRuntimeSessionMessage | undefined {
  return messages.find((message) => message.role === 'user');
}

function lastUserMessage(messages: ImportedRuntimeSessionMessage[]): ImportedRuntimeSessionMessage | undefined {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages[userMessages.length - 1];
}

async function directJsonlFiles(dir: string, sessionId?: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  if (sessionId?.trim()) {
    const fileName = jsonlFileNameFromSessionId(sessionId);
    if (!fileName) return [];
    const filePath = join(dir, fileName);
    return existsSync(filePath) ? [filePath] : [];
  }
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => join(dir, entry.name));
}

async function discoverJsonlFiles(input: {
  root: string;
  sessionId?: string;
  maxDepth: number;
  skipDir?: (name: string) => boolean;
}): Promise<string[]> {
  if (!existsSync(input.root)) return [];
  const result: string[] = [];
  const wantedName = input.sessionId?.trim() ? jsonlFileNameFromSessionId(input.sessionId) : null;
  if (input.sessionId?.trim() && !wantedName) return [];

  async function visit(dir: string, depth: number): Promise<void> {
    if (result.length >= MAX_DISCOVERED_TRANSCRIPTS) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (result.length >= MAX_DISCOVERED_TRANSCRIPTS) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= input.maxDepth || input.skipDir?.(entry.name)) continue;
        await visit(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      if (wantedName && entry.name !== wantedName) continue;
      result.push(path);
    }
  }

  await visit(input.root, 0);
  return result;
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
  const requestedFileName = jsonlFileNameFromSessionId(options.sessionId);
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

async function listQwenSessions(options: ExternalRuntimeSessionListOptions): Promise<ExternalRuntimeSessionRecord[]> {
  const home = options.homeDir ?? homedir();
  const root = join(home, '.qwen', 'projects');
  if (!existsSync(root)) return [];

  const projectDirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const records: ExternalRuntimeSessionRecord[] = [];
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;
    if (!options.sessionId && options.cwd?.trim() && !qwenProjectDirMatches(projectDir.name, options.cwd)) continue;
    const chatsDir = join(root, projectDir.name, 'chats');
    const files = await directJsonlFiles(chatsDir, options.sessionId);
    for (const filePath of files) {
      const recordsFromFile = await readJsonl(filePath);
      const fallbackSessionId = basename(filePath).replace(/\.jsonl$/, '');
      const sessionId = sessionIdFromRecords(recordsFromFile, fallbackSessionId);
      if (options.sessionId && sessionId !== options.sessionId && fallbackSessionId !== options.sessionId) continue;

      const cwd = firstStringFromRecords(recordsFromFile, [
        'cwd',
        'projectRoot',
        'project_root',
        'workingDirectory',
        'working_directory',
      ]) ?? options.cwd;
      if (shouldSkipForRequestedCwd({
        requestedCwd: options.cwd,
        transcriptCwd: cwd,
        sessionId: options.sessionId,
      })) {
        continue;
      }

      const fileStat = await stat(filePath).catch(() => null);
      const messages = parseVisibleMessagesFromRecords(recordsFromFile);
      if (messages.length === 0 && recordsFromFile.length === 0) continue;
      const firstUser = firstUserMessage(messages);
      const lastUser = lastUserMessage(messages);
      const title = firstStringFromRecords(recordsFromFile, ['customTitle', 'title', 'prompt'])
        ?? (firstUser?.content ? firstUser.content.slice(0, 80) : sessionId);

      records.push(toExternalRecord({
        id: sessionId,
        title,
        preview: lastUser && lastUser !== firstUser ? lastUser.content.slice(0, 120) : undefined,
        cwd,
        createdAt: firstTimestampFromRecords(recordsFromFile, ['startTime', 'createdAt', 'created_at', 'timestamp'])
          ?? fileStat?.birthtimeMs,
        updatedAt: newestTimestampField(recordsFromFile, 'mtime')
          ?? newestTimestampField(recordsFromFile, 'updatedAt')
          ?? newestTimestampField(recordsFromFile, 'timestamp')
          ?? fileStat?.mtimeMs,
        messages,
        transcriptSource: 'qwen-code',
      }));
    }
  }
  return sortAndLimit(records, options.limit);
}

async function listCodeBuddySessions(options: ExternalRuntimeSessionListOptions): Promise<ExternalRuntimeSessionRecord[]> {
  const home = options.homeDir ?? homedir();
  const root = join(home, '.codebuddy', 'projects');
  if (!existsSync(root)) return [];

  const files = await discoverJsonlFiles({
    root,
    sessionId: options.sessionId,
    maxDepth: 4,
    skipDir: (name) => CODEBUDDY_SKIPPED_DIRS.has(name),
  });

  const records: ExternalRuntimeSessionRecord[] = [];
  for (const filePath of files) {
    const recordsFromFile = await readJsonl(filePath);
    const fallbackSessionId = basename(filePath).replace(/\.jsonl$/, '');
    const sessionId = sessionIdFromRecords(recordsFromFile, fallbackSessionId);
    if (options.sessionId && sessionId !== options.sessionId && fallbackSessionId !== options.sessionId) continue;

    const cwd = firstStringFromRecords(recordsFromFile, [
      'cwd',
      'projectRoot',
      'project_root',
      'workingDirectory',
      'working_directory',
    ]) ?? options.cwd;
    if (shouldSkipForRequestedCwd({
      requestedCwd: options.cwd,
      transcriptCwd: cwd,
      sessionId: options.sessionId,
    })) {
      continue;
    }

    const fileStat = await stat(filePath).catch(() => null);
    const messages = parseVisibleMessagesFromRecords(recordsFromFile);
    if (messages.length === 0 && recordsFromFile.length === 0) continue;
    const firstUser = firstUserMessage(messages);
    const lastUser = lastUserMessage(messages);
    const title = firstStringFromRecords(recordsFromFile, ['customTitle', 'title', 'prompt'])
      ?? (firstUser?.content ? firstUser.content.slice(0, 80) : sessionId);

    records.push(toExternalRecord({
      id: sessionId,
      title,
      preview: lastUser && lastUser !== firstUser ? lastUser.content.slice(0, 120) : undefined,
      cwd,
      createdAt: firstTimestampFromRecords(recordsFromFile, ['startTime', 'createdAt', 'created_at', 'timestamp'])
        ?? fileStat?.birthtimeMs,
      updatedAt: newestTimestampField(recordsFromFile, 'updatedAt')
        ?? newestTimestampField(recordsFromFile, 'updated_at')
        ?? newestTimestampField(recordsFromFile, 'timestamp')
        ?? fileStat?.mtimeMs,
      messages,
      transcriptSource: 'codebuddy-code',
    }));
  }

  return sortAndLimit(records, options.limit);
}

function openClawTranscriptPathFromMetadata(
  sessionsDir: string,
  metadata: MaybeRecord,
  sessionId?: string,
): string | null {
  const rawPath = typeof metadata.sessionFile === 'string'
    ? metadata.sessionFile
    : typeof metadata.filePath === 'string'
      ? metadata.filePath
      : typeof metadata.transcriptPath === 'string'
        ? metadata.transcriptPath
        : undefined;
  if (rawPath?.trim()) {
    const resolved = resolve(sessionsDir, rawPath.trim());
    if (pathInside(sessionsDir, resolved) && existsSync(resolved)) return resolved;
  }

  const id = typeof metadata.sessionId === 'string'
    ? metadata.sessionId
    : typeof metadata.id === 'string'
      ? metadata.id
      : sessionId;
  if (!id?.trim()) return null;
  const fileName = jsonlFileNameFromSessionId(id);
  if (!fileName) return null;
  const fallback = join(sessionsDir, fileName);
  return existsSync(fallback) ? fallback : null;
}

function isPrimaryOpenClawTranscriptFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.jsonl')
    && !lower.endsWith('.trajectory.jsonl')
    && !lower.includes('.checkpoint.')
    && !lower.includes('.reset.')
    && !lower.includes('.deleted.')
    && !lower.includes('.bak.');
}

type OpenClawSessionCandidate = {
  filePath: string;
  metadata?: MaybeRecord;
  agentId: string;
};

async function openClawSessionCandidates(
  sessionsDir: string,
  agentId: string,
  options: ExternalRuntimeSessionListOptions,
): Promise<OpenClawSessionCandidate[]> {
  const candidates: OpenClawSessionCandidate[] = [];
  const seen = new Set<string>();
  const index = await readJsonFile(join(sessionsDir, 'sessions.json'));

  if (index) {
    for (const value of Object.values(index)) {
      if (!isRecord(value)) continue;
      const metadataSessionId = typeof value.sessionId === 'string'
        ? value.sessionId
        : typeof value.id === 'string'
          ? value.id
          : undefined;
      if (options.sessionId && metadataSessionId && metadataSessionId !== options.sessionId) continue;
      const filePath = openClawTranscriptPathFromMetadata(sessionsDir, value, options.sessionId);
      if (!filePath || seen.has(filePath)) continue;
      seen.add(filePath);
      candidates.push({ filePath, metadata: value, agentId });
    }
  }

  const files = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  for (const file of files) {
    if (!file.isFile() || !isPrimaryOpenClawTranscriptFile(file.name)) continue;
    const fallbackSessionId = file.name.replace(/\.jsonl$/, '');
    if (options.sessionId && fallbackSessionId !== options.sessionId) continue;
    const filePath = join(sessionsDir, file.name);
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    candidates.push({ filePath, agentId });
  }

  return candidates;
}

async function listOpenClawSessions(options: ExternalRuntimeSessionListOptions): Promise<ExternalRuntimeSessionRecord[]> {
  const home = options.homeDir ?? homedir();
  const records: ExternalRuntimeSessionRecord[] = [];

  for (const stateDir of OPENCLAW_STATE_DIRS) {
    const agentsRoot = join(home, stateDir, 'agents');
    const agents = await readdir(agentsRoot, { withFileTypes: true }).catch(() => []);
    for (const agent of agents) {
      if (!agent.isDirectory()) continue;
      const sessionsDir = join(agentsRoot, agent.name, 'sessions');
      if (!existsSync(sessionsDir)) continue;
      const candidates = await openClawSessionCandidates(sessionsDir, agent.name, options);
      for (const candidate of candidates) {
        const recordsFromFile = await readJsonl(candidate.filePath);
        const fallbackSessionId = basename(candidate.filePath).replace(/\.jsonl$/, '');
        const metadataSessionId = typeof candidate.metadata?.sessionId === 'string'
          ? candidate.metadata.sessionId
          : typeof candidate.metadata?.id === 'string'
            ? candidate.metadata.id
            : undefined;
        const sessionId = metadataSessionId ?? sessionIdFromRecords(recordsFromFile, fallbackSessionId);
        if (options.sessionId && sessionId !== options.sessionId && fallbackSessionId !== options.sessionId) continue;

        const header = sessionHeaderRecord(recordsFromFile);
        const headerCwd = isRecord(header) && typeof header.cwd === 'string' ? header.cwd : undefined;
        const cwd = (typeof candidate.metadata?.cwd === 'string' ? candidate.metadata.cwd : undefined)
          ?? headerCwd
          ?? firstStringFromRecords(recordsFromFile, ['cwd', 'projectRoot', 'project_root'])
          ?? options.cwd;
        if (shouldSkipForRequestedCwd({
          requestedCwd: options.cwd,
          transcriptCwd: cwd,
          sessionId: options.sessionId,
        })) {
          continue;
        }

        const fileStat = await stat(candidate.filePath).catch(() => null);
        const messages = parseVisibleMessagesFromRecords(recordsFromFile);
        if (messages.length === 0 && recordsFromFile.length === 0 && !candidate.metadata) continue;
        const firstUser = firstUserMessage(messages);
        const lastUser = lastUserMessage(messages);
        const title = (typeof candidate.metadata?.title === 'string' ? candidate.metadata.title : undefined)
          ?? (firstUser?.content ? firstUser.content.slice(0, 80) : sessionId);

        records.push(toExternalRecord({
          id: sessionId,
          title,
          preview: lastUser && lastUser !== firstUser ? lastUser.content.slice(0, 120) : undefined,
          cwd,
          createdAt: timestampField(candidate.metadata?.createdAt)
            ?? timestampField(candidate.metadata?.startTime)
            ?? firstTimestampFromRecords(recordsFromFile, ['timestamp', 'createdAt', 'created_at'])
            ?? fileStat?.birthtimeMs,
          updatedAt: timestampField(candidate.metadata?.updatedAt)
            ?? timestampField(candidate.metadata?.mtime)
            ?? newestTimestampField(recordsFromFile, 'timestamp')
            ?? fileStat?.mtimeMs,
          messages,
          transcriptSource: 'openclaw',
        }));
      }
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
  if (runtimeId === 'qwen' || runtimeId === 'qwen-code') {
    return listQwenSessions(options);
  }
  if (runtimeId === 'codebuddy' || runtimeId === 'codebuddy-code') {
    return listCodeBuddySessions(options);
  }
  if (runtimeId === 'openclaw') {
    return listOpenClawSessions(options);
  }
  if (runtimeId === 'cursor' || runtimeId === 'hermes') {
    return [];
  }
  return [];
}
