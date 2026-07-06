import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  ExternalRuntimeSessionListOptions,
  ExternalRuntimeSessionRecord,
  RuntimeSessionTranscriptAdapter,
} from '../types.js';
import { claudeProjectDirNameFromCwd, jsonlFileNameFromSessionId, readJsonl } from '../file-system.js';
import {
  firstStringField,
  newestTimestampField,
  parseClaudeMessagesFromRecords,
  sortAndLimit,
  timestampField,
  toExternalRecord,
} from '../normalizer.js';

export async function listClaudeSessions(
  options: ExternalRuntimeSessionListOptions,
): Promise<ExternalRuntimeSessionRecord[]> {
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

export const CLAUDE_SESSION_TRANSCRIPT_ADAPTER: RuntimeSessionTranscriptAdapter = {
  id: 'claude-code',
  aliases: ['claude', 'claude-code'],
  transcriptSource: 'claude-code',
  status: 'supported',
  durable: true,
  summary: 'Reads Claude Code project transcripts under ~/.claude/projects.',
  listSessions: listClaudeSessions,
};
