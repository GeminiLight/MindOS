'use client';

export const TASK_DRAFT_EVENT = 'mindos:task-draft';
const prefix = 'mindos:task-draft:';
const memory = new Map<string, string>();
const valid = (id: string) => Boolean(id.trim()) && id.length <= 200;
export function offerTaskDraft(sessionId: string, text: string): boolean {
  if (typeof window === 'undefined' || !valid(sessionId) || !text.trim() || text.length > 24000) return false;
  let existing = memory.get(sessionId);
  try { existing = sessionStorage.getItem(prefix + sessionId) ?? existing; } catch { /* memory fallback */ }
  if (existing && existing !== text) return false;
  memory.set(sessionId, text);
  try { sessionStorage.setItem(prefix + sessionId, text); } catch { /* navigation in this window still works */ }
  window.dispatchEvent(new CustomEvent(TASK_DRAFT_EVENT, { detail: { sessionId } }));
  return true;
}
export function takeTaskDraft(sessionId: string): string | null {
  if (!valid(sessionId)) return null;
  let text = memory.get(sessionId) ?? null;
  try { text = sessionStorage.getItem(prefix + sessionId) ?? text; sessionStorage.removeItem(prefix + sessionId); } catch { /* memory fallback */ }
  memory.delete(sessionId);
  return text && text.length <= 24000 ? text : null;
}
