import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  ObsidianRuntimeCapabilityLedgerEntry,
  ObsidianRuntimeCapabilityLedgerPhase,
} from './compatibility-preview';
import type {
  ObsidianCapabilitySupport,
  ObsidianCapabilitySurface,
} from './capability-matrix';
import { resolveCanonicalPluginRuntimeCapabilityLedgerPath } from './plugin-paths';

export const OBSIDIAN_RUNTIME_CAPABILITY_LEDGER_SCHEMA_VERSION = 1;
export const DEFAULT_OBSIDIAN_RUNTIME_CAPABILITY_LEDGER_MAX_ENTRIES = 500;
export const DEFAULT_OBSIDIAN_RUNTIME_CAPABILITY_LEDGER_READ_LIMIT = 200;

export interface PersistentObsidianRuntimeCapabilityLedgerEntry extends ObsidianRuntimeCapabilityLedgerEntry {
  schemaVersion: typeof OBSIDIAN_RUNTIME_CAPABILITY_LEDGER_SCHEMA_VERSION;
  recordedAt: string;
  pluginId: string;
  sessionId: string;
}

export interface ObsidianRuntimeCapabilityLedgerHistory {
  total: number;
  entries: PersistentObsidianRuntimeCapabilityLedgerEntry[];
  summary: Record<ObsidianRuntimeCapabilityLedgerPhase, number>;
  latestBlocked: PersistentObsidianRuntimeCapabilityLedgerEntry[];
  updatedAt?: string;
  skippedCorruptLines: number;
}

export interface ObsidianRuntimeCapabilityLedgerStoreOptions {
  now?: () => Date;
  sessionId?: string;
  maxEntriesPerPlugin?: number;
  defaultReadLimit?: number;
}

const RUNTIME_PHASES: ObsidianRuntimeCapabilityLedgerPhase[] = ['predicted', 'registered', 'called', 'blocked'];
const CAPABILITY_SURFACES: ObsidianCapabilitySurface[] = [
  'commands',
  'settings',
  'entries',
  'views',
  'document',
  'styles',
  'editor',
  'secret',
  'vault',
  'metadata',
  'workspace',
  'network',
  'core',
  'unsupported',
];
const CAPABILITY_SUPPORTS: ObsidianCapabilitySupport[] = [
  'full',
  'limited',
  'snapshot-only',
  'catalog-only',
  'request-only',
  'unsupported',
];

function emptyPhaseSummary(): Record<ObsidianRuntimeCapabilityLedgerPhase, number> {
  return {
    predicted: 0,
    registered: 0,
    called: 0,
    blocked: 0,
  };
}

export class ObsidianRuntimeCapabilityLedgerStore {
  private readonly sessionId: string;
  private readonly maxEntriesPerPlugin: number;
  private readonly defaultReadLimit: number;
  private readonly now: () => Date;

  constructor(
    private readonly mindRoot: string,
    options: ObsidianRuntimeCapabilityLedgerStoreOptions = {},
  ) {
    this.sessionId = options.sessionId ?? randomUUID();
    this.maxEntriesPerPlugin = Math.max(1, options.maxEntriesPerPlugin ?? DEFAULT_OBSIDIAN_RUNTIME_CAPABILITY_LEDGER_MAX_ENTRIES);
    this.defaultReadLimit = Math.max(1, options.defaultReadLimit ?? DEFAULT_OBSIDIAN_RUNTIME_CAPABILITY_LEDGER_READ_LIMIT);
    this.now = options.now ?? (() => new Date());
  }

  append(entry: ObsidianRuntimeCapabilityLedgerEntry): PersistentObsidianRuntimeCapabilityLedgerEntry | null {
    if (!entry.pluginId) return null;

    const persisted: PersistentObsidianRuntimeCapabilityLedgerEntry = {
      ...entry,
      schemaVersion: OBSIDIAN_RUNTIME_CAPABILITY_LEDGER_SCHEMA_VERSION,
      pluginId: entry.pluginId,
      recordedAt: this.now().toISOString(),
      sessionId: this.sessionId,
      evidence: redactRuntimeCapabilityEvidence(entry.evidence),
    };
    const filePath = resolveCanonicalPluginRuntimeCapabilityLedgerPath(this.mindRoot, persisted.pluginId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(persisted)}\n`, 'utf-8');
    this.trim(filePath);
    return persisted;
  }

  read(pluginId: string, limit = this.defaultReadLimit): ObsidianRuntimeCapabilityLedgerHistory {
    const filePath = resolveCanonicalPluginRuntimeCapabilityLedgerPath(this.mindRoot, pluginId);
    const summary = emptyPhaseSummary();
    const validEntries: PersistentObsidianRuntimeCapabilityLedgerEntry[] = [];
    let skippedCorruptLines = 0;

    if (!fs.existsSync(filePath)) {
      return {
        total: 0,
        entries: [],
        summary,
        latestBlocked: [],
        skippedCorruptLines: 0,
      };
    }

    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const entry = parsePersistentEntry(line, pluginId);
      if (!entry) {
        skippedCorruptLines += 1;
        continue;
      }
      validEntries.push(entry);
      summary[entry.phase] += 1;
    }

    const entries = validEntries.slice(-Math.max(1, limit));
    const latestBlocked = validEntries
      .filter((entry) => entry.phase === 'blocked')
      .slice(-5)
      .reverse();
    const updatedAt = validEntries.at(-1)?.recordedAt;

    return {
      total: validEntries.length,
      entries,
      summary,
      latestBlocked,
      ...(updatedAt ? { updatedAt } : {}),
      skippedCorruptLines,
    };
  }

  private trim(filePath: string): void {
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
    if (lines.length <= this.maxEntriesPerPlugin) return;
    fs.writeFileSync(filePath, `${lines.slice(-this.maxEntriesPerPlugin).join('\n')}\n`, 'utf-8');
  }
}

export function redactRuntimeCapabilityEvidence(evidence: string): string {
  const withoutBearer = evidence.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
  const withoutAssignments = withoutBearer.replace(
    /\b(authorization|cookie|token|api[-_ ]?key|apikey|secret|password)\s*[:=]\s*[^,;\s]+/gi,
    (_match, key: string) => `${key}=[redacted]`,
  );
  return withoutAssignments
    .replace(/https?:\/\/[^\s"'<>]+/gi, redactUrl)
    .slice(0, 1000);
}

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.search) {
      url.search = '?redacted';
    }
    if (url.hash) {
      url.hash = '#redacted';
    }
    return url.toString();
  } catch {
    return rawUrl.replace(/[?#].*$/, '?redacted');
  }
}

function parsePersistentEntry(
  line: string,
  expectedPluginId: string,
): PersistentObsidianRuntimeCapabilityLedgerEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== OBSIDIAN_RUNTIME_CAPABILITY_LEDGER_SCHEMA_VERSION) return null;
  if (record.pluginId !== expectedPluginId) return null;
  if (typeof record.capability !== 'string' || !record.capability) return null;
  if (typeof record.evidence !== 'string') return null;
  if (typeof record.recordedAt !== 'string') return null;
  if (typeof record.sessionId !== 'string') return null;
  if (!isPhase(record.phase)) return null;
  if (!isSurface(record.surface)) return null;
  if (!isSupport(record.support)) return null;
  if (record.source !== 'runtime-ledger') return null;

  return {
    schemaVersion: OBSIDIAN_RUNTIME_CAPABILITY_LEDGER_SCHEMA_VERSION,
    pluginId: expectedPluginId,
    capability: record.capability,
    surface: record.surface,
    support: record.support,
    phase: record.phase,
    source: 'runtime-ledger',
    evidence: record.evidence,
    recordedAt: record.recordedAt,
    sessionId: record.sessionId,
  };
}

function isPhase(value: unknown): value is ObsidianRuntimeCapabilityLedgerPhase {
  return typeof value === 'string' && RUNTIME_PHASES.includes(value as ObsidianRuntimeCapabilityLedgerPhase);
}

function isSurface(value: unknown): value is ObsidianCapabilitySurface {
  return typeof value === 'string' && CAPABILITY_SURFACES.includes(value as ObsidianCapabilitySurface);
}

function isSupport(value: unknown): value is ObsidianCapabilitySupport {
  return typeof value === 'string' && CAPABILITY_SUPPORTS.includes(value as ObsidianCapabilitySupport);
}
