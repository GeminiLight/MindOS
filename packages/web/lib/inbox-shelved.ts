export const INBOX_SHELVED_STORAGE_KEY = 'mindos-inbox-shelved-paths';
export const INBOX_SHELVED_UPDATED_EVENT = 'mindos:inbox-shelved-updated';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function normalizeShelvedInboxPaths(paths: readonly string[], validPaths?: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const path of paths) {
    if (typeof path !== 'string') continue;
    const value = path.trim();
    if (!value || seen.has(value)) continue;
    if (validPaths && !validPaths.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

export function readShelvedInboxPaths(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(INBOX_SHELVED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeShelvedInboxPaths(parsed) : [];
  } catch {
    return [];
  }
}

export function writeShelvedInboxPaths(paths: readonly string[]): string[] {
  const next = normalizeShelvedInboxPaths(paths);
  if (!isBrowser()) return next;
  try {
    window.localStorage.setItem(INBOX_SHELVED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage can be unavailable in private or constrained contexts.
  }
  window.dispatchEvent(new CustomEvent(INBOX_SHELVED_UPDATED_EVENT, { detail: next }));
  return next;
}

export function addShelvedInboxPaths(current: readonly string[], paths: readonly string[]): string[] {
  return writeShelvedInboxPaths([...current, ...paths]);
}

export function removeShelvedInboxPaths(current: readonly string[], paths: readonly string[]): string[] {
  const removed = new Set(paths);
  return writeShelvedInboxPaths(current.filter(path => !removed.has(path)));
}
