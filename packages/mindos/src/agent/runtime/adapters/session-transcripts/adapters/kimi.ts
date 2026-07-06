import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  ExternalRuntimeSessionListOptions,
  ExternalRuntimeSessionRecord,
  RuntimeSessionTranscriptAdapter,
} from '../types.js';
import { projectBaseFromCwd, readJsonFile, readJsonl } from '../file-system.js';
import { parseKimiWireMessages, sortAndLimit, timestampField, toExternalRecord } from '../normalizer.js';

const KIMI_PROJECT_PREFIX = 'wd_';

function kimiProjectDirMatches(projectDirName: string, cwd?: string): boolean {
  const base = projectBaseFromCwd(cwd);
  if (!base) return true;
  return projectDirName.startsWith(`${KIMI_PROJECT_PREFIX}${base}_`)
    || projectDirName.startsWith(`${KIMI_PROJECT_PREFIX}.${base}_`)
    || projectDirName.includes(`_${base}_`);
}

export async function listKimiSessions(
  options: ExternalRuntimeSessionListOptions,
): Promise<ExternalRuntimeSessionRecord[]> {
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

export const KIMI_SESSION_TRANSCRIPT_ADAPTER: RuntimeSessionTranscriptAdapter = {
  id: 'kimi-code',
  aliases: ['kimi', 'kimi-cli', 'kimi-code'],
  transcriptSource: 'kimi-code',
  status: 'supported',
  durable: true,
  summary: 'Reads Kimi Code native session folders under ~/.kimi-code/sessions.',
  listSessions: listKimiSessions,
};
