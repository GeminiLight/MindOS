'use client';

// ---------------------------------------------------------------------------
// Organize History — localStorage persistence for past AI organize operations
// ---------------------------------------------------------------------------

export interface OrganizeHistoryFile {
  action: 'create' | 'update' | 'unknown';
  path: string;
  ok: boolean;
  /** Undone by user (deleted for create / restored for update) */
  undone?: boolean;
}

export type OrganizeSource = 'upload' | 'drag-drop' | 'inbox-organize' | 'import-modal' | 'plugin' | 'web-clipper' | 'conversation';

export interface OrganizeHistoryEntry {
  id: string;
  /** Unix ms */
  timestamp: number;
  /** Original uploaded file names */
  sourceFiles: string[];
  files: OrganizeHistoryFile[];
  status: 'completed' | 'partial' | 'undone';
  /** How the files were ingested */
  source?: OrganizeSource;
  /** Processing time in milliseconds */
  durationMs?: number;
}

const STORAGE_KEY = 'mindos:organize-history';
const MAX_ENTRIES = 50;

export function loadHistory(): OrganizeHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OrganizeHistoryEntry[];
  } catch {
    return [];
  }
}

export function saveHistory(entries: OrganizeHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch { /* quota exceeded — silently drop oldest */ }
}

export function appendEntry(entry: OrganizeHistoryEntry): OrganizeHistoryEntry[] {
  const all = loadHistory();
  all.unshift(entry);
  const trimmed = all.slice(0, MAX_ENTRIES);
  saveHistory(trimmed);
  return trimmed;
}

export function updateEntry(id: string, patch: Partial<OrganizeHistoryEntry>): OrganizeHistoryEntry[] {
  const all = loadHistory();
  const idx = all.findIndex(e => e.id === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...patch };
    saveHistory(all);
  }
  return all;
}

export function clearHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

let _idCounter = 0;
export function generateEntryId(): string {
  return `org-${Date.now()}-${++_idCounter}`;
}
