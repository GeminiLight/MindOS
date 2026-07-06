import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type {
  ExternalRuntimeSessionListOptions,
  ExternalRuntimeSessionRecord,
  MaybeRecord,
  RuntimeSessionTranscriptAdapter,
} from '../types.js';
import { isRecord } from '../normalizer.js';
import {
  jsonlFileNameFromSessionId,
  pathInside,
  readJsonFile,
  readJsonl,
  shouldSkipForRequestedCwd,
} from '../file-system.js';
import {
  firstStringFromRecords,
  firstTimestampFromRecords,
  firstUserMessage,
  lastUserMessage,
  newestTimestampField,
  parseVisibleMessagesFromRecords,
  sessionHeaderRecord,
  sessionIdFromRecords,
  sortAndLimit,
  timestampField,
  toExternalRecord,
} from '../normalizer.js';

const OPENCLAW_STATE_DIRS = ['.openclaw', '.kimi_openclaw', '.clawdbot'];

type OpenClawSessionCandidate = {
  filePath: string;
  metadata?: MaybeRecord;
  agentId: string;
};

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

export async function listOpenClawSessions(
  options: ExternalRuntimeSessionListOptions,
): Promise<ExternalRuntimeSessionRecord[]> {
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

export const OPENCLAW_SESSION_TRANSCRIPT_ADAPTER: RuntimeSessionTranscriptAdapter = {
  id: 'openclaw',
  aliases: ['openclaw'],
  transcriptSource: 'openclaw',
  status: 'supported',
  durable: true,
  summary: 'Reads OpenClaw native session transcripts under ~/.openclaw, ~/.kimi_openclaw, and ~/.clawdbot.',
  listSessions: listOpenClawSessions,
};
