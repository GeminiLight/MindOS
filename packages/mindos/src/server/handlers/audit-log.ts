import { existsSync, readFileSync, rmSync } from 'node:fs';
import { posix } from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { redactSensitiveObject, redactSensitiveText } from '../../session/redaction.js';
import type { AgentAuditEvent, AgentAuditInput } from '../../knowledge/audit/index.js';
import {
  appendJsonlEvents,
  ensureJsonlStore,
  readJsonlEvents,
  writeJsonlMeta,
  type JsonlCompactionConfig,
} from './jsonl-log.js';

/**
 * Append-only agent audit log backed by the shared JSONL store.
 *
 * On-disk format is shared with `packages/web/lib/core/agent-audit-log.ts`:
 * `.mindos/agent-audit-log.json` holds one normalized event per line
 * (oldest-first) and `.mindos/agent-audit-log.meta.json` tracks migration and
 * legacy import counters. Events are redacted/summarized at write time and
 * defensively re-normalized at read time.
 */

const LOG_FILE = '.mindos/agent-audit-log.json';
const META_FILE = '.mindos/agent-audit-log.meta.json';
const LEGACY_MD_FILE = 'Agent-Audit.md';
const LEGACY_JSONL_FILE = '.agent-log.json';
const MAX_EVENTS = 1000;
const MAX_MESSAGE_CHARS = 2000;
const COMPACTION: JsonlCompactionConfig = {
  maxEvents: MAX_EVENTS,
  maxBytes: 2_000_000,
  targetBytes: 1_000_000,
};

function logPath(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, posix.join('.mindos', 'agent-audit-log.json'));
}

function metaPath(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, posix.join('.mindos', 'agent-audit-log.meta.json'));
}

function nowIso(): string {
  return new Date().toISOString();
}

function validIso(ts: string | undefined): string {
  if (!ts) return nowIso();
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : nowIso();
}

function normalizeMessage(message: string | undefined): string | undefined {
  if (typeof message !== 'string') return undefined;
  const redacted = redactSensitiveText(message);
  return redacted.length <= MAX_MESSAGE_CHARS ? redacted : redacted.slice(0, MAX_MESSAGE_CHARS);
}

function eventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildEvent(input: AgentAuditInput): AgentAuditEvent {
  const result = input.result === 'error' ? 'error' : 'ok';
  const params = summarizeAuditParams(input.params && typeof input.params === 'object' ? input.params : {});
  return {
    id: eventId(),
    ts: validIso(input.ts),
    tool: typeof input.tool === 'string' && input.tool.trim() ? input.tool.trim() : 'unknown-tool',
    params,
    result,
    actionSummary: normalizeMessage(input.actionSummary) ?? buildActionSummary(input.tool, params, result, input.message),
    message: normalizeMessage(input.message),
    durationMs: typeof input.durationMs === 'number' ? input.durationMs : undefined,
    agentName: typeof input.agentName === 'string' && input.agentName.trim() ? input.agentName.trim() : undefined,
    ...(input.debugCapture === 'redacted_raw'
      ? {
          rawDebug: redactSensitiveObject({
            params: input.params && typeof input.params === 'object' ? input.params : {},
            ...(typeof input.message === 'string' ? { message: input.message } : {}),
          }) as Record<string, unknown>,
        }
      : {}),
    op: 'append',
  };
}

/**
 * Appends a batch of audit events in a single file append (one line per
 * event). This replaces the previous whole-file rewrite per entry, which made
 * batched `.agent-log.json` appends O(N^2).
 */
export function appendAgentAuditEvents(mindRoot: string, inputs: AgentAuditInput[]): AgentAuditEvent[] {
  const file = logPath(mindRoot);
  const metaFile = metaPath(mindRoot);
  importLegacySources(mindRoot);
  const events = inputs.map(buildEvent);
  appendJsonlEvents(file, metaFile, events, COMPACTION);
  return events;
}

/** Lists audit events newest-first, normalized for the API boundary. */
export function listAgentAuditEventsFromLog(mindRoot: string, limit = 100): AgentAuditEvent[] {
  try {
    importLegacySources(mindRoot);
    const { events } = readJsonlEvents(logPath(mindRoot), metaPath(mindRoot));
    const safeLimit = Math.max(1, Math.min(limit, MAX_EVENTS));
    return events
      .slice(0, MAX_EVENTS)
      .map(normalizePersistedEvent)
      .filter((event): event is AgentAuditEvent => Boolean(event))
      .slice(0, safeLimit);
  } catch {
    return [];
  }
}

/** Parses raw `.agent-log.json`-style JSONL content leniently into audit inputs. */
export function parseAgentAuditJsonLines(raw: string): AgentAuditInput[] {
  const entries: AgentAuditInput[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      entries.push({
        ts: typeof parsed.ts === 'string' ? parsed.ts : nowIso(),
        tool: typeof parsed.tool === 'string' && parsed.tool.trim() ? parsed.tool : 'unknown-tool',
        params: parsed.params && typeof parsed.params === 'object' ? parsed.params as Record<string, unknown> : {},
        result: parsed.result === 'error' ? 'error' : 'ok',
        message: typeof parsed.message === 'string' ? parsed.message : undefined,
        durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
        agentName: typeof parsed.agentName === 'string' ? parsed.agentName : undefined,
      });
    } catch {
      // Ignore malformed lines.
    }
  }
  return entries;
}

interface LegacyAgentOp {
  ts?: string;
  tool?: string;
  params?: Record<string, unknown>;
  result?: 'ok' | 'error';
  message?: string;
  durationMs?: number;
  agentName?: string;
}

function parseLegacyMdBlocks(raw: string): LegacyAgentOp[] {
  const blocks: LegacyAgentOp[] = [];
  const re = /```agent-op\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    if (!match[1]) continue;
    try {
      blocks.push(JSON.parse(match[1].trim()) as LegacyAgentOp);
    } catch {
      // Ignore malformed blocks.
    }
  }
  return blocks;
}

function toImportedEvent(entry: LegacyAgentOp, op: AgentAuditEvent['op'], idx: number): AgentAuditEvent {
  const tool = typeof entry.tool === 'string' && entry.tool.trim() ? entry.tool.trim() : 'unknown-tool';
  const result = entry.result === 'error' ? 'error' : 'ok';
  const params = summarizeAuditParams(entry.params && typeof entry.params === 'object' ? entry.params : {});
  return {
    id: `legacy-${Date.now().toString(36)}-${idx.toString(36)}`,
    ts: validIso(entry.ts),
    tool,
    params,
    result,
    actionSummary: buildActionSummary(tool, params, result, entry.message),
    message: normalizeMessage(entry.message),
    durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : undefined,
    op,
  };
}

function importLegacySources(mindRoot: string): void {
  importLegacyFile(mindRoot, LEGACY_MD_FILE, 'mdImportedCount', 'legacy_agent_audit_md_import', parseLegacyMdBlocks);
  importLegacyFile(mindRoot, LEGACY_JSONL_FILE, 'jsonlImportedCount', 'legacy_agent_log_jsonl_import', (raw) => parseAgentAuditJsonLines(raw) as LegacyAgentOp[]);
}

function importLegacyFile(
  mindRoot: string,
  legacyFileName: string,
  counterKey: 'mdImportedCount' | 'jsonlImportedCount',
  op: AgentAuditEvent['op'],
  parse: (raw: string) => LegacyAgentOp[],
): void {
  try {
    const legacyPath = resolveExistingSafe(mindRoot, legacyFileName);
    if (!existsSync(legacyPath)) return;
    const entries = parse(readFileSync(legacyPath, 'utf-8'));
    if (entries.length === 0) return;

    const file = logPath(mindRoot);
    const metaFile = metaPath(mindRoot);
    const meta = ensureJsonlStore(file, metaFile, { persistIfMissing: true });
    const importedCount = typeof meta.legacy[counterKey] === 'number' ? meta.legacy[counterKey] as number : 0;
    if (entries.length > importedCount) {
      const imported = entries.slice(importedCount).map((entry, idx) => toImportedEvent(entry, op, idx));
      appendJsonlEvents(file, metaFile, imported, COMPACTION);
      meta.legacy = { ...meta.legacy, [counterKey]: entries.length, lastImportedAt: nowIso() };
      writeJsonlMeta(metaFile, meta);
    }
    rmSync(legacyPath, { force: true });
  } catch {
    // Legacy import is best-effort and must never break the main flow.
  }
}

function normalizePersistedEvent(value: unknown): AgentAuditEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Partial<AgentAuditEvent>;
  const tool = typeof source.tool === 'string' && source.tool.trim() ? source.tool.trim() : 'unknown-tool';
  const result = source.result === 'error' ? 'error' : 'ok';
  const params = summarizeAuditParams(source.params && typeof source.params === 'object' ? source.params : {});
  return {
    id: typeof source.id === 'string' && source.id ? source.id : eventId(),
    ts: validIso(source.ts),
    tool,
    params,
    result,
    actionSummary: normalizeMessage(source.actionSummary) ?? buildActionSummary(tool, params, result, source.message),
    message: normalizeMessage(source.message),
    durationMs: typeof source.durationMs === 'number' ? source.durationMs : undefined,
    agentName: typeof source.agentName === 'string' && source.agentName.trim() ? source.agentName.trim() : undefined,
    ...(source.rawDebug && typeof source.rawDebug === 'object'
      ? { rawDebug: redactSensitiveObject(source.rawDebug) as Record<string, unknown> }
      : {}),
    op: source.op,
  };
}

function summarizeAuditParams(params: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactSensitiveObject(params) as Record<string, unknown>;
  return summarizeValue(redacted, 0) as Record<string, unknown>;
}

function summarizeValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return summarizeString(value);
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (depth >= 5) return '[max-depth]';
  if (Array.isArray(value)) {
    if (value.length > 20) return `[${value.length} items]`;
    return value.map((item) => summarizeValue(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = shouldSummarizeAuditField(key, nested)
      ? `[${String(nested ?? '').length} chars]`
      : summarizeValue(nested, depth + 1);
  }
  return output;
}

function shouldSummarizeAuditField(key: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // Already-summarized placeholders must stay stable across re-normalization.
  if (/^\[\d+ (chars|items)\]$/.test(value)) return false;
  return /^(content|text|message|prompt|body|raw|input|output|response|diff)$/i.test(key);
}

function summarizeString(value: string): string {
  const redacted = redactSensitiveText(value);
  return redacted.length > MAX_MESSAGE_CHARS ? `[${redacted.length} chars]` : redacted;
}

function buildActionSummary(
  tool: string,
  params: Record<string, unknown>,
  result: 'ok' | 'error',
  message?: string,
): string {
  const target = firstString(params.path, params.filePath, params.filename, params.url, params.agent_id, params.agentId);
  const query = firstString(params.q, params.query);
  const suffix = target ? ` target=${target}` : query ? ` query=${query}` : '';
  const note = message ? ` ${normalizeMessage(message) ?? ''}` : '';
  return `${tool} ${result}${suffix}${note}`.trim();
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return summarizeString(value.trim());
  }
  return undefined;
}
