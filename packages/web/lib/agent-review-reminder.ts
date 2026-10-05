const STORAGE_PREFIX = 'mindos:agent-review-reminder:dismissed:v1';
const MAX_STORED_IDS = 120;

type ReminderStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function agentReviewReminderStorageKey(mindRootId?: string): string {
  return `${STORAGE_PREFIX}:${mindRootId?.trim() || 'default'}`;
}

/** Dismissal hides the interruption; it never marks a change as reviewed. */
export function readDismissedAgentReviewIds(mindRootId?: string, storage?: ReminderStorage): ReadonlySet<string> {
  try {
    const raw = (storage ?? localStorage).getItem(agentReviewReminderStorageKey(mindRootId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.slice(0, MAX_STORED_IDS).filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

export function writeDismissedAgentReviewIds(ids: readonly string[], mindRootId?: string, storage?: ReminderStorage): boolean {
  try {
    (storage ?? localStorage).setItem(
      agentReviewReminderStorageKey(mindRootId),
      JSON.stringify(ids.filter(id => id.length > 0).slice(0, MAX_STORED_IDS)),
    );
    return true;
  } catch {
    return false;
  }
}
