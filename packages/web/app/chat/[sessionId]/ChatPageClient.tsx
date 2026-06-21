'use client';

/**
 * ChatPageClient — client half of /chat/[sessionId] (spec-titlebar-row Phase 2).
 *
 * Resolution order for an id: alive in the session store metadata, OR alive in
 * the run store (in-memory messages / in-flight run survive server-list
 * eviction) → select it and render the full-page chat. Otherwise refresh the
 * server list once (direct URL loads land before any fetch) and re-check;
 * still missing → calm fallback page covering the deleted/evicted race window.
 *
 * 'new' is the creation flow: create via the shared store (no ChatContent
 * instance needed), then replace the URL with the real session id.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale } from '@/lib/stores/locale-store';
import ChatContent from '@/components/chat/ChatContent';
import {
  getActiveSessionId,
  getSessions,
  loadSession,
  renameSession,
  refreshSessions,
  resetSession,
  setActiveSessionId,
} from '@/lib/agent-session-store';
import { getRun, hasMessages } from '@/lib/agent-run-store';
import { closeByKey } from '@/lib/workspace-tabs';
import { encodePath } from '@/lib/utils';

function decodeSessionId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    // Malformed escape sequence — treat the raw segment as the id.
    return raw;
  }
}

/** A session with an in-flight run or in-memory messages is alive even if the
 * server list evicted it (30-session cap). */
function isSessionAlive(id: string): boolean {
  return getSessions().some((s) => s.id === id) || hasMessages(id) || !!getRun(id);
}

/** Prefer loadSession (clears unread, drops abandoned empties); fall back to a
 * bare active-id write when the session lives only in the run store. */
function selectSession(id: string) {
  if (getSessions().some((s) => s.id === id)) {
    loadSession(id);
  } else {
    setActiveSessionId(id);
  }
}

function getSessionProjectId(id: string): string | undefined {
  return getSessions().find((session) => session.id === id)?.projectId;
}

function getSessionDockTarget(id: string): string {
  const session = getSessions().find((item) => item.id === id);
  if (session?.projectId) return `/studio/${encodeURIComponent(session.projectId)}`;
  if (session?.currentFile) return `/view/${encodePath(session.currentFile)}`;
  return '/wiki';
}

type Status = 'resolving' | 'ready' | 'missing';

export default function ChatPageClient({ sessionId: rawSessionId }: { sessionId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const sessionId = decodeSessionId(rawSessionId);
  const isNew = sessionId === 'new';
  const projectId = searchParams.get('projectId')?.trim() || undefined;
  const initialTitle = searchParams.get('title')?.trim() || undefined;
  const handlingKey = isNew ? `${sessionId}:${projectId ?? ''}:${initialTitle ?? ''}` : sessionId;

  // Async resolution result, tagged with the id it was resolved for —
  // navigating /chat/A → /chat/B re-renders this same page component, so a
  // bare status state would leak across ids.
  const [resolved, setResolved] = useState<{ id: string; status: Status } | null>(null);
  // Strict mode runs effects twice and /chat/* navigations reuse the mount:
  // guard per session id, not per mount.
  const handledIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (handledIdRef.current === handlingKey) return;
    handledIdRef.current = handlingKey;

    if (isNew) {
      resetSession({ projectId });
      const id = getActiveSessionId();
      if (id && initialTitle) renameSession(id, initialTitle);
      if (id) router.replace(`/chat/${encodeURIComponent(id)}`);
      return;
    }

    if (isSessionAlive(sessionId)) {
      selectSession(sessionId);
      return;
    }

    // Direct URL load: the store may simply not have fetched yet. refresh
    // (single-flight, no selection side-effects) then re-check.
    void refreshSessions().then(() => {
      if (handledIdRef.current !== handlingKey) return; // superseded by navigation
      if (isSessionAlive(sessionId)) {
        selectSession(sessionId);
        setResolved({ id: sessionId, status: 'ready' });
      } else {
        setResolved({ id: sessionId, status: 'missing' });
      }
    });
  }, [sessionId, isNew, projectId, initialTitle, handlingKey, router]);

  // Synchronous fast path: in-app navigation hits the in-memory store before
  // the effect runs, so the chat mounts on the first paint without a loading
  // flash. The effect still performs the actual selection.
  const status: Status = resolved?.id === sessionId
    ? resolved.status
    : !isNew && isSessionAlive(sessionId) ? 'ready' : 'resolving';

  const handleDockToPanel = useCallback(() => {
    window.dispatchEvent(new Event('mindos:open-ask-panel'));
    router.push(getSessionDockTarget(sessionId));
  }, [router, sessionId]);

  if (status === 'missing') {
    return (
      <div className="flex h-[calc(100dvh-var(--app-titlebar-h))] items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-lg text-foreground mb-2">
            {t.workspaceTabs.sessionNotFoundTitle}
          </h1>
          <p className="text-sm text-muted-foreground/70 leading-relaxed mb-6">
            {t.workspaceTabs.sessionNotFoundHint}
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                closeByKey('chat', sessionId);
                router.push('/');
              }}
              className="rounded-md bg-[var(--amber)] text-[var(--amber-foreground)] px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t.workspaceTabs.closeThisTab}
            </button>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t.workspaceTabs.backToHome}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'resolving') {
    // Usually invisible: in-app navigation resolves synchronously above. Only
    // direct URL loads (awaiting refreshSessions) and /chat/new pass through.
    return <div className="h-[calc(100dvh-var(--app-titlebar-h))]" aria-busy="true" />;
  }

  /* Mirrors HomeContent's maximized composition so the full-page chat
   * looks/behaves like the home-page chat in fullscreen. */
  return (
    <div className="flex flex-col h-[calc(100dvh-var(--app-titlebar-h))]">
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ChatContent
          visible
          variant="home"
          maximized
          initialSessionId={sessionId}
          projectId={getSessionProjectId(sessionId)}
          onDockToPanel={handleDockToPanel}
        />
      </div>
    </div>
  );
}
