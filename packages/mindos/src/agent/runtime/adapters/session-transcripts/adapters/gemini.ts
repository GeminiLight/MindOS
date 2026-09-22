import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExternalRuntimeSessionListOptions, ExternalRuntimeSessionRecord, RuntimeSessionTranscriptAdapter } from '../types.js';
import { readJsonFile, readJsonl } from '../file-system.js';
import { firstStringFromRecords, isRecord, parseGeminiMessagesFromRecords, sortAndLimit, timestampField, toExternalRecord } from '../normalizer.js';

export async function listGeminiSessions(options: ExternalRuntimeSessionListOptions): Promise<ExternalRuntimeSessionRecord[]> {
  const home = options.homeDir ?? process.env.GEMINI_CLI_HOME ?? homedir();
  const records = new Map<string, ExternalRuntimeSessionRecord>();
  for (const folder of ['tmp', 'history']) {
    const root = join(home, '.gemini', folder);
    const projects = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const projectPath = join(root, project.name);
      const declaredRoot = (await readFile(join(projectPath, '.project_root'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; })).trim();
      const hashMatches = options.cwd && createHash('sha256').update(resolve(options.cwd)).digest('hex') === project.name;
      const projectCwd = declaredRoot || (hashMatches ? options.cwd : undefined);
      if (options.cwd && projectCwd && resolve(projectCwd) !== resolve(options.cwd)) continue;
      const chats = join(projectPath, 'chats');
      const files = await readdir(chats, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      // Prefer the current JSONL when the CLI has migrated a legacy JSON snapshot.
      files.sort((a, b) => Number(a.name.endsWith('.jsonl')) - Number(b.name.endsWith('.jsonl')));
      for (const file of files) {
        if (!file.isFile() || !/\.jsonl?$/.test(file.name)) continue;
        const path = join(chats, file.name);
        const snapshot = file.name.endsWith('.json') ? await readJsonFile(path) : null;
        let rows = snapshot ? [snapshot] : await readJsonl(path, options.sessionId ? true : options.metadataOnly);
        let metadata: Record<string, unknown> = {};
        for (const row of rows) {
          if (row.sessionId) metadata = { ...metadata, ...row };
          if (isRecord(row.$set)) metadata = { ...metadata, ...row.$set };
        }
        const id = typeof metadata.sessionId === 'string' ? metadata.sessionId : file.name.replace(/\.jsonl?$/, '');
        if (options.sessionId && id !== options.sessionId) continue;
        const cwd = projectCwd ?? firstStringFromRecords(rows, ['cwd', 'projectRoot', 'workingDirectory']);
        if (options.cwd && (!cwd || resolve(cwd) !== resolve(options.cwd))) continue;
        if (options.sessionId && !snapshot) rows = await readJsonl(path);
        const info = await stat(path);
        const messages = parseGeminiMessagesFromRecords(rows);
        if (!rows.length) continue;
        records.set(id, toExternalRecord({
          id, title: typeof metadata.summary === 'string' ? metadata.summary : messages.find(m => m.role === 'user')?.content.slice(0, 80) ?? id,
          cwd, createdAt: timestampField(metadata.startTime) ?? info.birthtimeMs,
          updatedAt: options.metadataOnly ? info.mtimeMs : timestampField(metadata.lastUpdated) ?? info.mtimeMs,
          messages, metadataOnly: options.metadataOnly, transcriptSource: 'gemini-cli',
        }));
      }
    }
  }
  return sortAndLimit([...records.values()], options.limit, options);
}

export const GEMINI_SESSION_TRANSCRIPT_ADAPTER: RuntimeSessionTranscriptAdapter = {
  id: 'gemini-cli', aliases: ['gemini', 'gemini-cli'], transcriptSource: 'gemini-cli', status: 'supported', durable: true,
  summary: 'Reads Gemini CLI JSON and JSONL sessions, preserving their original project directory.', listSessions: listGeminiSessions,
};
