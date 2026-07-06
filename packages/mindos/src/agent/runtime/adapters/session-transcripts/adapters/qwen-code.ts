import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type {
  ExternalRuntimeSessionListOptions,
  ExternalRuntimeSessionRecord,
  RuntimeSessionTranscriptAdapter,
} from '../types.js';
import {
  directJsonlFiles,
  projectBaseFromCwd,
  readJsonl,
  sanitizedProjectDirNameFromCwd,
  shouldSkipForRequestedCwd,
} from '../file-system.js';
import {
  firstStringFromRecords,
  firstTimestampFromRecords,
  firstUserMessage,
  lastUserMessage,
  newestTimestampField,
  parseVisibleMessagesFromRecords,
  sessionIdFromRecords,
  sortAndLimit,
  toExternalRecord,
} from '../normalizer.js';

function qwenProjectDirMatches(projectDirName: string, cwd?: string): boolean {
  const base = projectBaseFromCwd(cwd);
  if (!base) return true;
  const sanitized = cwd?.trim() ? sanitizedProjectDirNameFromCwd(cwd).toLowerCase() : '';
  const normalizedName = projectDirName.toLowerCase();
  return normalizedName === base.toLowerCase()
    || normalizedName.includes(base.toLowerCase())
    || Boolean(sanitized && normalizedName === sanitized);
}

export async function listQwenSessions(
  options: ExternalRuntimeSessionListOptions,
): Promise<ExternalRuntimeSessionRecord[]> {
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

export const QWEN_SESSION_TRANSCRIPT_ADAPTER: RuntimeSessionTranscriptAdapter = {
  id: 'qwen-code',
  aliases: ['qwen', 'qwen-code', 'qwen-cli'],
  transcriptSource: 'qwen-code',
  status: 'supported',
  durable: true,
  summary: 'Reads Qwen Code chat transcripts under ~/.qwen/projects/*/chats.',
  listSessions: listQwenSessions,
};
