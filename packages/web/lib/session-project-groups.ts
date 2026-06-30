import { compactRuntimeSessionPathLabel } from '@/lib/ask-agent';
import { getEffectiveSessionWorkDir } from '@/lib/session-context';
import type { ChatSessionListEntry } from '@/lib/session-list-entry';

export type SessionProjectGroupKind = 'project' | 'mind-root' | 'no-project';

export interface SessionProjectGroup {
  id: string;
  kind: SessionProjectGroupKind;
  title: string;
  pathLabel: string | null;
  updatedAtMs: number;
  hasPinned: boolean;
  entries: ChatSessionListEntry[];
}

function normalizeProjectPath(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized || trimmed;
}

function basename(value: string): string {
  return value.split(/[\\/]+/).filter(Boolean).pop() ?? value;
}

function projectTitle(label: string | null | undefined, path: string): string {
  const cleanLabel = label?.trim();
  if (cleanLabel && cleanLabel !== path) return cleanLabel;
  return basename(path);
}

function groupIdentity(entry: ChatSessionListEntry): Omit<SessionProjectGroup, 'entries' | 'updatedAtMs' | 'hasPinned'> {
  const workDir = getEffectiveSessionWorkDir(entry.session);
  const path = normalizeProjectPath(workDir.path);
  if (path) {
    return {
      id: `project:${path}`,
      kind: 'project',
      title: projectTitle(workDir.label, path),
      pathLabel: compactRuntimeSessionPathLabel(path) ?? path,
    };
  }

  if (workDir.source === 'mind-root') {
    return {
      id: 'mind-root',
      kind: 'mind-root',
      title: 'Mind',
      pathLabel: 'Mind root',
    };
  }

  return {
    id: `no-project:${workDir.source ?? 'unknown'}`,
    kind: 'no-project',
    title: workDir.label?.trim() || 'No Project',
    pathLabel: null,
  };
}

export function groupChatSessionEntriesByProject(entries: ChatSessionListEntry[]): SessionProjectGroup[] {
  const groups = new Map<string, SessionProjectGroup>();

  for (const entry of entries) {
    const identity = groupIdentity(entry);
    const current = groups.get(identity.id);
    if (current) {
      current.entries.push(entry);
      current.updatedAtMs = Math.max(current.updatedAtMs, entry.updatedAtMs ?? 0);
      current.hasPinned = current.hasPinned || entry.pinned;
      continue;
    }

    groups.set(identity.id, {
      ...identity,
      entries: [entry],
      updatedAtMs: entry.updatedAtMs ?? 0,
      hasPinned: entry.pinned,
    });
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.hasPinned && !b.hasPinned) return -1;
    if (!a.hasPinned && b.hasPinned) return 1;
    return b.updatedAtMs - a.updatedAtMs;
  });
}
