import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type {
  ExternalRuntimeSessionListOptions,
  ExternalRuntimeSessionRecord,
  RuntimeSessionTranscriptAdapter,
} from '../types.js';
import { discoverJsonlFiles, readJsonl, shouldSkipForRequestedCwd } from '../file-system.js';
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

const CODEBUDDY_SKIPPED_DIRS = new Set(['blobs', 'subagents', 'tool-results']);

export async function listCodeBuddySessions(
  options: ExternalRuntimeSessionListOptions,
): Promise<ExternalRuntimeSessionRecord[]> {
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

export const CODEBUDDY_SESSION_TRANSCRIPT_ADAPTER: RuntimeSessionTranscriptAdapter = {
  id: 'codebuddy-code',
  aliases: ['codebuddy', 'codebuddy-code'],
  transcriptSource: 'codebuddy-code',
  status: 'supported',
  durable: true,
  summary: 'Reads CodeBuddy Code JSONL transcripts under ~/.codebuddy/projects.',
  listSessions: listCodeBuddySessions,
};
