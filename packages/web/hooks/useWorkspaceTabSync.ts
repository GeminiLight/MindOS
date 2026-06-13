'use client';

/**
 * useWorkspaceTabSync — route → workspace-tabs synchronization
 * (wiki/specs/spec-titlebar-row.md, Phase 2).
 *
 * Mounted exactly once inside TitlebarTabStrip. Responsibilities:
 *   1. Bind the tab store to the current mind root and trigger the initial
 *      session list fetch (refreshSessions has no selection side-effects).
 *   2. Watch the pathname: /view/<path> opens a doc tab, /chat/<id> opens a
 *      chat tab (dedup lives in the store). A null return from openTab means
 *      the 50-tab cap was hit → limit toast, once per attempted key.
 *   3. Mirror session titles into chat tabs (renameByKey no-ops on same title).
 *   4. Reconcile chat tabs against the server session list — but only after
 *      getSessionsLoaded(), so the pre-fetch empty list never mass-closes tabs.
 *
 * Activation is derived from the route (the route is the source of truth);
 * place routes (/, /capture, /echo, ...) yield no active tab.
 */

import { useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import {
  initWorkspaceTabs,
  openTab,
  readDomRootId,
  reconcileChatTabs,
  renameByKey,
  tabId,
  useWorkspaceTabs,
  type WorkspaceTab,
  type WorkspaceTabKind,
} from '@/lib/workspace-tabs';
import { getSessionsLoaded, refreshSessions, useSessions } from '@/lib/ask-session-store';
import { useRunSummary } from '@/lib/ask-run-store';
import type { ChatSession } from '@/lib/types';
import { sessionTitle } from '@/hooks/useAskSession';
import { toast } from '@/lib/toast';
import { useLocale } from '@/lib/stores/locale-store';

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // Malformed escape sequence — keep the raw segment rather than crash.
    return segment;
  }
}

/**
 * Derive the would-be active tab from a pathname.
 * `/view/<segments>` → doc (key = decoded path), `/chat/<id>` (id !== 'new')
 * → chat. Everything else (place routes) → null: tabs render dimmed, none
 * selected.
 */
export function parseActiveTab(pathname: string | null | undefined): { kind: WorkspaceTabKind; key: string } | null {
  if (!pathname) return null;
  if (pathname.startsWith('/view/')) {
    const rest = pathname.slice('/view/'.length);
    if (!rest) return null;
    const key = rest.split('/').map(safeDecode).join('/');
    return key ? { kind: 'doc', key } : null;
  }
  const chat = /^\/chat\/([^/]+)$/.exec(pathname);
  if (chat) {
    const id = safeDecode(chat[1]);
    if (!id || id === 'new') return null;
    return { kind: 'chat', key: id };
  }
  return null;
}

/** Route href for a tab — encoding mirrors parseActiveTab's decoding. */
export function tabHref(tab: Pick<WorkspaceTab, 'kind' | 'key'>): string {
  if (tab.kind === 'doc') {
    return `/view/${tab.key.split('/').map(encodeURIComponent).join('/')}`;
  }
  return `/chat/${encodeURIComponent(tab.key)}`;
}

/** Tab label for a session — a not-yet-titled empty chat reads "New chat",
 * not sessionTitle's "(empty session)" placeholder. */
function chatTabTitle(session: ChatSession, labels: { newChat: string }): string {
  if (!session.title && !session.messages.some((m) => m.role === 'user')) {
    return labels.newChat;
  }
  return sessionTitle(session);
}

export interface WorkspaceTabSyncState {
  tabs: WorkspaceTab[];
  /** Tab id derived from the route, or null on place routes (dim state). */
  activeTabId: string | null;
  running: ReadonlySet<string>;
  unread: ReadonlySet<string>;
}

export function useWorkspaceTabSync(): WorkspaceTabSyncState {
  const pathname = usePathname();
  const tabs = useWorkspaceTabs();
  const sessions = useSessions();
  const { running, unread } = useRunSummary();
  const { t } = useLocale();

  // Refs keep the route-watcher effect keyed on pathname only: a sessions or
  // locale update must not re-run openTab (the title-sync effect owns renames).
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const tRef = useRef(t);
  tRef.current = t;
  const limitToastKeyRef = useRef<string | null>(null);

  // 1. Bind store to the mind root + initial fetch (no selection side-effects).
  useEffect(() => {
    initWorkspaceTabs(readDomRootId());
    void refreshSessions();
  }, []);

  // 2. Route watcher: navigating to a doc/chat opens (or focuses) its tab.
  useEffect(() => {
    const active = parseActiveTab(pathname);
    if (!active) return;
    const title = active.kind === 'doc'
      ? (active.key.split('/').pop() || active.key)
      : (() => {
        const session = sessionsRef.current.find((s) => s.id === active.key);
        return session ? chatTabTitle(session, tRef.current.workspaceTabs) : tRef.current.workspaceTabs.chatTab;
      })();
    const opened = openTab(active.kind, active.key, title);
    if (opened) {
      limitToastKeyRef.current = null;
      return;
    }
    // 50-tab cap: toast once per attempted key, not on every re-render.
    const attemptKey = tabId(active.kind, active.key);
    if (limitToastKeyRef.current !== attemptKey) {
      limitToastKeyRef.current = attemptKey;
      toast.error(tRef.current.workspaceTabs.tabLimitReached);
    }
  }, [pathname]);

  // 3+4. Title sync and reconcile follow the session list. Reconcile also
  // re-runs when the running set changes so a tab kept alive only by its run
  // closes once that run ends (if the session stayed evicted).
  useEffect(() => {
    for (const session of sessions) {
      renameByKey('chat', session.id, chatTabTitle(session, tRef.current.workspaceTabs));
    }
    if (getSessionsLoaded()) {
      reconcileChatTabs(new Set(sessions.map((s) => s.id)), running);
    }
  }, [sessions, running]);

  const activeTabId = useMemo(() => {
    const active = parseActiveTab(pathname);
    return active ? tabId(active.kind, active.key) : null;
  }, [pathname]);

  return { tabs, activeTabId, running, unread };
}
