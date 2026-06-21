'use client';

/**
 * Thin subscription layer over agent-session-store + agent-run-store
 * (wiki/specs/spec-chat-session-concurrency.md, PR3 展开设计 v3).
 *
 * Session metadata, the createSession factory, and the active-session fact all
 * live in component-independent stores shared by every ChatContent instance
 * (home / right panel / future /chat route). This hook only subscribes, sorts
 * for display, and threads the caller's `currentFile` into store calls. The
 * return shape is unchanged — ChatContent needs no edits.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type {
  AgentIdentity,
  AgentRuntimeIdentity,
  Message,
  ChatSession,
  RuntimeSessionBinding,
  SessionContextSelection,
  SessionWorkDir,
} from '@/lib/types';
import { setMessages as storeSetMessages, useSessionMessages } from '@/lib/agent-run-store';
import {
  attachRuntimeSession as storeAttachRuntimeSession,
  clearSessions as storeClearSessions,
  deleteSession as storeDeleteSession,
  getActiveSessionId,
  initSessions as storeInitSessions,
  loadSession as storeLoadSession,
  noteCurrentFile,
  renameSession as storeRenameSession,
  resetSession as storeResetSession,
  setSessionContextSelection as storeSetSessionContextSelection,
  setSessionAgentRuntimeBinding as storeSetSessionAgentRuntimeBinding,
  setSessionDefaultAcpAgent as storeSetSessionDefaultAcpAgent,
  setSessionWorkDir as storeSetSessionWorkDir,
  togglePinSession as storeTogglePinSession,
  useActiveSessionId,
  useSessions,
} from '@/lib/agent-session-store';

export function sessionTitle(s: ChatSession): string {
  if (s.title) return s.title;
  const firstUser = s.messages.find((m) => m.role === 'user');
  if (!firstUser) return '(empty session)';
  const line = firstUser.content.replace(/\s+/g, ' ').trim();
  if (!line && firstUser.images && firstUser.images.length > 0) {
    return `[${firstUser.images.length} image${firstUser.images.length > 1 ? 's' : ''}]`;
  }
  return line.length > 42 ? `${line.slice(0, 42)}...` : line || '(empty session)';
}

export function useAskSession(currentFile?: string, projectId?: string) {
  const sessions = useSessions();
  const activeSessionId = useActiveSessionId();
  const messages = useSessionMessages(activeSessionId);

  // Replaces the old metaResolver currentFile overlay: keep the active
  // session's anchor file up to date in the shared metadata.
  useEffect(() => {
    if (activeSessionId) noteCurrentFile(activeSessionId, currentFile);
  }, [activeSessionId, currentFile]);

  const setMessages = useCallback((next: React.SetStateAction<Message[]>) => {
    const id = getActiveSessionId();
    if (id) storeSetMessages(id, next as Message[] | ((prev: Message[]) => Message[]));
  }, []);

  const initSessions = useCallback(
    (runtime?: AgentRuntimeIdentity | null) => storeInitSessions({ currentFile, projectId, runtime }),
    [currentFile, projectId],
  );

  const resetSession = useCallback(
    (runtime?: AgentRuntimeIdentity | null) => storeResetSession({ currentFile, projectId, runtime }),
    [currentFile, projectId],
  );

  const loadSession = useCallback((id: string) => storeLoadSession(id), []);

  const deleteSession = useCallback(
    (id: string, runtime?: AgentRuntimeIdentity | null) => storeDeleteSession(id, { currentFile, projectId, runtime }),
    [currentFile, projectId],
  );

  const renameSession = useCallback((id: string, newTitle: string) => storeRenameSession(id, newTitle), []);

  const togglePinSession = useCallback((id: string) => storeTogglePinSession(id), []);

  const setSessionDefaultAcpAgent = useCallback(
    (agent: AgentIdentity | null) => storeSetSessionDefaultAcpAgent(agent, currentFile),
    [currentFile],
  );

  const setSessionAgentRuntimeBinding = useCallback((
    runtime: AgentRuntimeIdentity,
    binding?: { externalSessionId?: string; cwd?: string; status?: RuntimeSessionBinding['status']; updatedAt?: number },
  ) => storeSetSessionAgentRuntimeBinding(runtime, binding), []);

  const setSessionWorkDir = useCallback((workDir: SessionWorkDir) => {
    const id = getActiveSessionId();
    return id ? storeSetSessionWorkDir(id, workDir) : false;
  }, []);

  const setSessionContextSelection = useCallback((selection: SessionContextSelection) => {
    const id = getActiveSessionId();
    return id ? storeSetSessionContextSelection(id, selection) : false;
  }, []);

  const attachRuntimeSession = useCallback((
    runtime: AgentRuntimeIdentity,
    binding: {
      externalSessionId: string;
      cwd?: string;
      status?: RuntimeSessionBinding['status'];
      updatedAt?: number | string;
    },
    metadata?: { title?: string },
  ): boolean => storeAttachRuntimeSession(runtime, binding, metadata, currentFile, projectId), [currentFile, projectId]);

  const clearSessions = useCallback(
    (ids?: string[], runtime?: AgentRuntimeIdentity | null) => storeClearSessions(ids, { currentFile, projectId, runtime }),
    [currentFile, projectId],
  );

  const clearAllSessions = useCallback(() => {
    storeClearSessions(undefined, { currentFile, projectId, runtime: null });
  }, [currentFile, projectId]);

  /** Sessions sorted: pinned first, then by updatedAt desc */
  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  }), [sessions]);

  /** Active session metadata with live messages from the run store overlaid. */
  const activeSession = useMemo(() => {
    const meta = sessions.find((session) => session.id === activeSessionId) ?? null;
    if (!meta) return null;
    return meta.messages === messages ? meta : { ...meta, messages };
  }, [activeSessionId, sessions, messages]);

  return {
    messages,
    setMessages,
    sessions: sortedSessions,
    activeSession,
    activeSessionId,
    initSessions,
    resetSession,
    loadSession,
    deleteSession,
    renameSession,
    togglePinSession,
    setSessionDefaultAcpAgent,
    setSessionAgentRuntimeBinding,
    setSessionWorkDir,
    setSessionContextSelection,
    attachRuntimeSession,
    clearSessions,
    clearAllSessions,
  };
}
