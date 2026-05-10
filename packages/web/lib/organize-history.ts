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
const VALID_ACTIONS = new Set(['create', 'update', 'unknown']);
const VALID_STATUSES = new Set(['completed', 'partial', 'undone']);
const VALID_SOURCES = new Set(['upload', 'drag-drop', 'inbox-organize', 'import-modal', 'plugin', 'web-clipper', 'conversation']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHistoryFile(value: unknown): value is OrganizeHistoryFile {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.ok === 'boolean' &&
    typeof value.action === 'string' &&
    VALID_ACTIONS.has(value.action) &&
    (value.undone === undefined || typeof value.undone === 'boolean')
  );
}

function isHistoryEntry(value: unknown): value is OrganizeHistoryEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Number.isFinite(value.timestamp) &&
    Array.isArray(value.sourceFiles) &&
    value.sourceFiles.every((file) => typeof file === 'string') &&
    Array.isArray(value.files) &&
    value.files.every(isHistoryFile) &&
    typeof value.status === 'string' &&
    VALID_STATUSES.has(value.status) &&
    (value.source === undefined || (typeof value.source === 'string' && VALID_SOURCES.has(value.source))) &&
    (value.durationMs === undefined || Number.isFinite(value.durationMs))
  );
}

export function normalizeHistoryEntries(value: unknown): OrganizeHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isHistoryEntry).slice(0, MAX_ENTRIES);
}

export function loadHistory(): OrganizeHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalizeHistoryEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveHistory(entries: OrganizeHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeHistoryEntries(entries)));
  } catch { /* quota exceeded — ignore */ }
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
