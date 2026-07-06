import { CLAUDE_SESSION_TRANSCRIPT_ADAPTER } from './adapters/claude.js';
import { CODEBUDDY_SESSION_TRANSCRIPT_ADAPTER } from './adapters/codebuddy-code.js';
import { GEMINI_SESSION_TRANSCRIPT_ADAPTER } from './adapters/gemini.js';
import { KIMI_SESSION_TRANSCRIPT_ADAPTER } from './adapters/kimi.js';
import { OPENCODE_SESSION_TRANSCRIPT_ADAPTER } from './adapters/opencode.js';
import { OPENCLAW_SESSION_TRANSCRIPT_ADAPTER } from './adapters/openclaw.js';
import { QWEN_SESSION_TRANSCRIPT_ADAPTER } from './adapters/qwen-code.js';
import {
  CURSOR_SESSION_TRANSCRIPT_ADAPTER,
  HERMES_SESSION_TRANSCRIPT_ADAPTER,
} from './adapters/unverified.js';
import type {
  ExternalRuntimeSessionListOptions,
  ExternalRuntimeSessionRecord,
  RuntimeSessionTranscriptAdapter,
  RuntimeSessionTranscriptRuntimeIdentity,
  RuntimeSessionTranscriptTarget,
} from './types.js';

export const RUNTIME_SESSION_TRANSCRIPT_ADAPTERS: readonly RuntimeSessionTranscriptAdapter[] = [
  KIMI_SESSION_TRANSCRIPT_ADAPTER,
  GEMINI_SESSION_TRANSCRIPT_ADAPTER,
  OPENCODE_SESSION_TRANSCRIPT_ADAPTER,
  CLAUDE_SESSION_TRANSCRIPT_ADAPTER,
  QWEN_SESSION_TRANSCRIPT_ADAPTER,
  CODEBUDDY_SESSION_TRANSCRIPT_ADAPTER,
  OPENCLAW_SESSION_TRANSCRIPT_ADAPTER,
  CURSOR_SESSION_TRANSCRIPT_ADAPTER,
  HERMES_SESSION_TRANSCRIPT_ADAPTER,
];

type RuntimeSessionTranscriptTargetDefinition = {
  adapterId: string;
  cli: string;
  runtime: RuntimeSessionTranscriptRuntimeIdentity;
};

const RUNTIME_SESSION_TRANSCRIPT_TARGETS: readonly RuntimeSessionTranscriptTargetDefinition[] = [
  { adapterId: 'kimi-code', cli: 'kimi', runtime: { id: 'kimi', name: 'Kimi', kind: 'acp' } },
  { adapterId: 'gemini-cli', cli: 'gemini', runtime: { id: 'gemini', name: 'Gemini', kind: 'acp' } },
  { adapterId: 'opencode', cli: 'opencode', runtime: { id: 'opencode', name: 'OpenCode', kind: 'acp' } },
  { adapterId: 'claude-code', cli: 'claude', runtime: { id: 'claude', name: 'Claude Code', kind: 'claude' } },
  { adapterId: 'qwen-code', cli: 'qwen-code', runtime: { id: 'qwen-code', name: 'Qwen Code', kind: 'acp' } },
  { adapterId: 'codebuddy-code', cli: 'codebuddy', runtime: { id: 'codebuddy', name: 'CodeBuddy', kind: 'acp' } },
  { adapterId: 'openclaw', cli: 'openclaw', runtime: { id: 'openclaw', name: 'OpenClaw', kind: 'acp' } },
  { adapterId: 'cursor', cli: 'cursor', runtime: { id: 'cursor', name: 'Cursor', kind: 'acp' } },
  { adapterId: 'hermes', cli: 'hermes', runtime: { id: 'hermes', name: 'Hermes', kind: 'acp' } },
];

export function normalizeRuntimeSessionTranscriptId(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function buildAdapterAliasMap(): Map<string, RuntimeSessionTranscriptAdapter> {
  const map = new Map<string, RuntimeSessionTranscriptAdapter>();
  for (const adapter of RUNTIME_SESSION_TRANSCRIPT_ADAPTERS) {
    map.set(normalizeRuntimeSessionTranscriptId(adapter.id), adapter);
    map.set(normalizeRuntimeSessionTranscriptId(adapter.transcriptSource), adapter);
    for (const alias of adapter.aliases) {
      map.set(normalizeRuntimeSessionTranscriptId(alias), adapter);
    }
  }
  return map;
}

const adapterByAlias = buildAdapterAliasMap();

export function listRuntimeSessionTranscriptAdapters(): RuntimeSessionTranscriptAdapter[] {
  return [...RUNTIME_SESSION_TRANSCRIPT_ADAPTERS];
}

export function getRuntimeSessionTranscriptAdapter(
  runtimeId: string,
): RuntimeSessionTranscriptAdapter | null {
  return adapterByAlias.get(normalizeRuntimeSessionTranscriptId(runtimeId)) ?? null;
}

export function resolveRuntimeSessionTranscriptTarget(
  cli: string,
): RuntimeSessionTranscriptTarget | null {
  const adapter = getRuntimeSessionTranscriptAdapter(cli);
  if (!adapter) return null;
  const target = RUNTIME_SESSION_TRANSCRIPT_TARGETS.find((item) => item.adapterId === adapter.id);
  if (!target) return null;
  return {
    cli: target.cli,
    runtime: target.runtime,
    adapter,
  };
}

export async function listRuntimeSessionTranscripts(
  options: ExternalRuntimeSessionListOptions,
): Promise<ExternalRuntimeSessionRecord[]> {
  const adapter = getRuntimeSessionTranscriptAdapter(options.runtimeId);
  if (!adapter) return [];
  if (adapter.status !== 'supported') return [];
  return adapter.listSessions(options);
}
