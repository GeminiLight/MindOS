import { readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExternalRuntimeSessionListOptions, ExternalRuntimeSessionRecord, RuntimeSessionTranscriptAdapter } from '../types.js';
import { projectBaseFromCwd, readJsonFile, readJsonl } from '../file-system.js';
import { firstStringFromRecords, isRecord, parseKimiWireMessages, parseVisibleMessagesFromRecords, sortAndLimit, timestampField, toExternalRecord } from '../normalizer.js';

function legacyProjectMatches(name: string, cwd?: string): boolean {
  const base = projectBaseFromCwd(cwd);
  return !!base && (name.startsWith(`wd_${base}_`) || name.startsWith(`wd_.${base}_`));
}

export async function listKimiSessions(options: ExternalRuntimeSessionListOptions): Promise<ExternalRuntimeSessionRecord[]> {
  const home = options.homeDir ?? homedir();
  const roots = options.homeDir ? [join(home, '.kimi-code'), join(home, '.kimi')]
    : [...new Set([process.env.KIMI_CODE_HOME || join(home, '.kimi-code'), process.env.KIMI_SHARE_DIR || join(home, '.kimi')])];
  const records = new Map<string, ExternalRuntimeSessionRecord>();
  for (const root of roots) {
    const metadata = await readJsonFile(join(root, 'kimi.json'));
    const workDirs = new Map<string, string>();
    for (const item of Array.isArray(metadata?.work_dirs) ? metadata.work_dirs : []) {
      // Remote KAOS paths must never become a local continuation directory.
      if (!isRecord(item) || typeof item.path !== 'string' || (item.kaos && item.kaos !== 'local')) continue;
      workDirs.set(createHash('md5').update(item.path).digest('hex'), item.path);
    }
    const sessionsRoot = join(root, 'sessions');
    const projects = await readdir(sessionsRoot, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const projectPath = join(sessionsRoot, project.name);
      const sessions = await readdir(projectPath, { withFileTypes: true });
      for (const session of sessions) {
        if (!session.isDirectory() || (options.sessionId && options.sessionId !== session.name)) continue;
        const path = join(projectPath, session.name);
        const state = await readJsonFile(join(path, 'state.json'));
        const cwd = (state ? firstStringFromRecords([state], ['workDir', 'work_dir', 'cwd', 'workingDirectory']) : undefined) ?? workDirs.get(project.name);
        if (options.cwd && (cwd ? resolve(cwd) !== resolve(options.cwd) : !legacyProjectMatches(project.name, options.cwd))) continue;
        const wirePath = join(path, 'agents', 'main', 'wire.jsonl');
        let messages = parseKimiWireMessages(await readJsonl(wirePath, options.metadataOnly));
        if (!messages.length) messages = parseVisibleMessagesFromRecords(await readJsonl(join(path, 'context.jsonl'), options.metadataOnly));
        if (!state && !messages.length) continue;
        const info = await stat(join(path, 'context.jsonl')).catch(() => stat(wirePath)).catch(() => stat(join(path, 'state.json')));
        records.set(session.name, toExternalRecord({
          id: session.name, title: typeof state?.title === 'string' ? state.title : messages.find(m => m.role === 'user')?.content.slice(0, 80) ?? session.name,
          preview: typeof state?.lastPrompt === 'string' ? state.lastPrompt : undefined,
          cwd, createdAt: timestampField(state?.createdAt) ?? info.birthtimeMs, updatedAt: timestampField(state?.updatedAt) ?? info.mtimeMs,
          messages, metadataOnly: options.metadataOnly, transcriptSource: 'kimi-code',
        }));
      }
    }
  }
  return sortAndLimit([...records.values()], options.limit, options);
}

export const KIMI_SESSION_TRANSCRIPT_ADAPTER: RuntimeSessionTranscriptAdapter = {
  id: 'kimi-code', aliases: ['kimi', 'kimi-cli', 'kimi-code'], transcriptSource: 'kimi-code', status: 'supported', durable: true,
  summary: 'Reads Kimi session directories under ~/.kimi and ~/.kimi-code, including configured data roots.', listSessions: listKimiSessions,
};
