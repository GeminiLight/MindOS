import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  ExternalRuntimeSessionListOptions,
  ExternalRuntimeSessionRecord,
  RuntimeSessionTranscriptAdapter,
} from '../types.js';
import { projectBaseFromCwd, readJsonl } from '../file-system.js';
import { parseGeminiMessagesFromRecords, sortAndLimit, timestampField, toExternalRecord } from '../normalizer.js';

async function geminiProjectDirs(homeDir: string, cwd?: string): Promise<string[]> {
  const roots = [
    join(homeDir, '.gemini', 'tmp'),
    join(homeDir, '.gemini', 'history'),
  ];
  const base = projectBaseFromCwd(cwd);
  const result: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
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

export async function listGeminiSessions(
  options: ExternalRuntimeSessionListOptions,
): Promise<ExternalRuntimeSessionRecord[]> {
  const home = options.homeDir ?? homedir();
  const records: ExternalRuntimeSessionRecord[] = [];
  for (const projectPath of await geminiProjectDirs(home, options.cwd)) {
    const chatsDir = join(projectPath, 'chats');
    const chatFiles = await readdir(chatsDir, { withFileTypes: true }).catch(() => []);
    for (const file of chatFiles) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const filePath = join(chatsDir, file.name);
      const recordsFromFile = await readJsonl(filePath);
      const metadata = recordsFromFile.find((record) => typeof record.sessionId === 'string');
      const sessionId = typeof metadata?.sessionId === 'string'
        ? metadata.sessionId
        : file.name.replace(/\.jsonl$/, '');
      if (options.sessionId && sessionId !== options.sessionId) continue;
      const fileStat = await stat(filePath).catch(() => null);
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

export const GEMINI_SESSION_TRANSCRIPT_ADAPTER: RuntimeSessionTranscriptAdapter = {
  id: 'gemini-cli',
  aliases: ['gemini', 'gemini-cli'],
  transcriptSource: 'gemini-cli',
  status: 'supported',
  durable: true,
  summary: 'Reads Gemini CLI chat snapshots under ~/.gemini/tmp and ~/.gemini/history.',
  listSessions: listGeminiSessions,
};
