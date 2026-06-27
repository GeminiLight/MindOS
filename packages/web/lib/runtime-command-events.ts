'use client';

import type { AgentRuntimeIdentity } from './types';

export const RUNTIME_COMMAND_INSERT_EVENT = 'mindos:runtime-command-insert';

export type RuntimeCommandInsertDetail = {
  text: string;
  commandName: string;
  runtime?: AgentRuntimeIdentity;
};

export function requestRuntimeCommandInsert(detail: RuntimeCommandInsertDetail): boolean {
  if (typeof window === 'undefined') return false;
  return window.dispatchEvent(new CustomEvent<RuntimeCommandInsertDetail>(
    RUNTIME_COMMAND_INSERT_EVENT,
    { detail },
  ));
}

export function normalizeRuntimeCommandInsertDetail(value: unknown): RuntimeCommandInsertDetail | null {
  if (!isRecord(value)) return null;
  const text = typeof value.text === 'string' ? value.text : '';
  const commandName = typeof value.commandName === 'string' ? value.commandName : '';
  if (!text.trim() || !commandName.trim()) return null;

  const runtime = normalizeRuntime(value.runtime);
  return {
    text,
    commandName,
    ...(runtime ? { runtime } : {}),
  };
}

function normalizeRuntime(value: unknown): AgentRuntimeIdentity | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const kind = typeof value.kind === 'string' ? value.kind.trim() : '';
  if (!id || !name) return null;
  if (kind !== 'mindos' && kind !== 'codex' && kind !== 'claude' && kind !== 'acp') return null;
  return { id, name, kind };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
