'use client';

/**
 * workspace-tabs — module-level store for the titlebar workspace tab strip
 * (wiki/specs/spec-titlebar-row.md, Phase 2).
 *
 * Tabs are the durable working set: documents (kind 'doc', key = mind-root
 * relative path) and chat sessions (kind 'chat', key = session id). The store
 * is the single in-memory source of truth; localStorage is a per-root mirror
 * (`mindos.workspaceTabs.v1:<rootId>`) read once at init and written behind a
 * debounce — same single-reader strategy as useLeftPanel, no cross-tab sync.
 *
 * Activation is NOT stored here: the route is already the source of truth for
 * "where the user is", so the strip derives the active tab from usePathname.
 */

import { useSyncExternalStore } from 'react';

export type WorkspaceTabKind = 'doc' | 'chat';

export interface WorkspaceTab {
  /** Stable identity: `${kind}:${key}` — (kind, key) is unique by construction. */
  id: string;
  kind: WorkspaceTabKind;
  /** doc → mind-root relative path (decoded); chat → session id. */
  key: string;
  title: string;
  /** false means the doc is a replaceable preview tab; missing/true means kept. */
  pinned?: boolean;
}

export const MAX_TABS = 50;
const STORAGE_PREFIX = 'mindos.workspaceTabs.v1';
const PERSIST_DEBOUNCE_MS = 300;
const EMPTY_TABS: WorkspaceTab[] = [];

let tabs: WorkspaceTab[] = EMPTY_TABS;
let rootId: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

export function tabId(kind: WorkspaceTabKind, key: string): string {
  return `${kind}:${key}`;
}

function emit(next: WorkspaceTab[]) {
  tabs = next;
  schedulePersist();
  listeners.forEach((fn) => fn());
}

function storageKey(): string | null {
  return rootId ? `${STORAGE_PREFIX}:${rootId}` : null;
}

function isKept(tab: WorkspaceTab): boolean {
  return tab.pinned !== false;
}

function schedulePersist() {
  const key = storageKey();
  if (!key || typeof window === 'undefined') return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      localStorage.setItem(key, JSON.stringify(tabs.filter(isKept)));
    } catch {
      // quota / private mode — tabs simply don't survive reload
    }
  }, PERSIST_DEBOUNCE_MS);
}

/** Strict shape validation: a corrupt payload starts empty rather than throwing. */
function parseStoredTabs(raw: string | null): WorkspaceTab[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    const valid: WorkspaceTab[] = [];
    for (const item of data) {
      if (typeof item !== 'object' || item === null) continue;
      const { kind, key, title, pinned } = item as Record<string, unknown>;
      if (kind !== 'doc' && kind !== 'chat') continue;
      if (typeof key !== 'string' || key.length === 0) continue;
      if (typeof title !== 'string') continue;
      if (pinned === false) continue;
      const id = tabId(kind, key);
      if (seen.has(id)) continue;
      seen.add(id);
      valid.push({ id, kind, key, title });
      if (valid.length >= MAX_TABS) break;
    }
    return valid;
  } catch {
    return [];
  }
}

/** Root identity stamped on <html> by the server layout; per-root tab sets. */
export function readDomRootId(): string {
  if (typeof document === 'undefined') return 'default';
  return document.documentElement.getAttribute('data-mind-root-id') || 'default';
}

/**
 * Bind the store to a mind root and load that root's persisted tabs.
 * Idempotent for the same root; switching roots swaps the whole working set
 * (a key from another vault must never open a same-named file here).
 */
export function initWorkspaceTabs(nextRootId: string) {
  if (rootId === nextRootId) return;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  rootId = nextRootId;
  let raw: string | null = null;
  try {
    raw = typeof window === 'undefined' ? null : localStorage.getItem(`${STORAGE_PREFIX}:${nextRootId}`);
  } catch {
    raw = null;
  }
  tabs = parseStoredTabs(raw);
  listeners.forEach((fn) => fn());
}

export function getTabs(): WorkspaceTab[] {
  return tabs;
}

/**
 * Open (or focus) a tab. Dedup by (kind, key): an existing kept tab is
 * returned as-is, while opening an existing preview as kept upgrades it.
 * Doc previews are replaceable: opening a new preview reuses the existing
 * preview slot instead of polluting the working set. Returns null when the
 * 50-tab cap is hit and no preview slot can be reused.
 */
export function openTab(
  kind: WorkspaceTabKind,
  key: string,
  title: string,
  options: { pinned?: boolean } = {},
): WorkspaceTab | null {
  const id = tabId(kind, key);
  const existing = tabs.find((t) => t.id === id);
  const pinned = kind === 'chat' || options.pinned !== false;
  if (existing) {
    if (pinned && existing.pinned === false) {
      const next = tabs.map((tab) => (tab.id === id ? { id, kind, key, title } : tab));
      emit(next);
      return next.find((tab) => tab.id === id) ?? null;
    }
    return existing;
  }
  if (!pinned && kind === 'doc') {
    const previewIndex = tabs.findIndex((tab) => tab.kind === 'doc' && tab.pinned === false);
    const previewTab: WorkspaceTab = { id, kind, key, title, pinned: false };
    if (previewIndex >= 0) {
      const next = [...tabs];
      next[previewIndex] = previewTab;
      emit(next);
      return previewTab;
    }
  }
  if (tabs.length >= MAX_TABS) return null;
  const tab: WorkspaceTab = pinned ? { id, kind, key, title } : { id, kind, key, title, pinned: false };
  emit([...tabs, tab]);
  return tab;
}

export function keepTab(id: string): WorkspaceTab | null {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const tab = tabs[idx];
  if (tab.pinned !== false) return tab;
  const next = [...tabs];
  next[idx] = { id: tab.id, kind: tab.kind, key: tab.key, title: tab.title };
  emit(next);
  return next[idx];
}

export function closeTab(id: string) {
  if (!tabs.some((t) => t.id === id)) return;
  emit(tabs.filter((t) => t.id !== id));
}

export function closeByKey(kind: WorkspaceTabKind, key: string) {
  closeTab(tabId(kind, key));
}

export function renameByKey(kind: WorkspaceTabKind, key: string, title: string) {
  const id = tabId(kind, key);
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0 || tabs[idx].title === title) return;
  const next = [...tabs];
  next[idx] = { ...next[idx], title };
  emit(next);
}

export function moveTab(id: string, toIndex: number) {
  const fromIndex = tabs.findIndex((t) => t.id === id);
  if (fromIndex < 0) return;
  const clamped = Math.max(0, Math.min(tabs.length - 1, toIndex));
  if (clamped === fromIndex) return;
  const next = [...tabs];
  const [tab] = next.splice(fromIndex, 1);
  next.splice(clamped, 0, tab);
  emit(next);
}

/**
 * Server session list reconciliation: a chat tab whose session no longer
 * exists (and has no in-flight run) is a guaranteed dead link — the session
 * cannot come back, so the tab auto-closes. Deliberately asymmetric with doc
 * tabs (a missing file may reappear; an evicted session won't).
 */
export function reconcileChatTabs(liveSessionIds: ReadonlySet<string>, runningSessionIds: ReadonlySet<string>) {
  const next = tabs.filter((t) => (
    t.kind !== 'chat' || liveSessionIds.has(t.key) || runningSessionIds.has(t.key)
  ));
  if (next.length !== tabs.length) emit(next);
}

export function useWorkspaceTabs(): WorkspaceTab[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => tabs,
    () => EMPTY_TABS,
  );
}

export function resetWorkspaceTabsForTests() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  tabs = EMPTY_TABS;
  rootId = null;
  listeners.clear();
}
