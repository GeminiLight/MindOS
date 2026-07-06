import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  ExternalRuntimeSessionListOptions,
  ExternalRuntimeSessionRecord,
  MaybeRecord,
  RuntimeSessionTranscriptAdapter,
} from '../types.js';
import {
  parseOpenCodeTextRows,
  safeLimit,
  sortAndLimit,
  toExternalRecord,
  type OpenCodeTextRow,
} from '../normalizer.js';

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

const execFileAsync = promisify(execFile);

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
    return Array.isArray(parsed) ? parsed.filter((item): item is T => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
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

export async function listOpenCodeSessions(
  options: ExternalRuntimeSessionListOptions,
): Promise<ExternalRuntimeSessionRecord[]> {
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

export const OPENCODE_SESSION_TRANSCRIPT_ADAPTER: RuntimeSessionTranscriptAdapter = {
  id: 'opencode',
  aliases: ['opencode', 'open-code', 'opencode-cli'],
  transcriptSource: 'opencode',
  status: 'supported',
  durable: true,
  summary: 'Reads OpenCode native sessions from ~/.local/share/opencode/opencode.db.',
  listSessions: listOpenCodeSessions,
};
