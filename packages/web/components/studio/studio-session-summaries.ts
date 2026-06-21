import { getMessages, hasMessages } from '@/lib/agent-run-store';
import type { ChatSession, Message } from '@/lib/types';
import type { StudioSessionSummary } from '@/lib/studio-projects';
import { getSessionAgentRuntime } from '@/lib/ask-agent';

export function getChatSessionMessages(session: ChatSession): Message[] {
  return hasMessages(session.id) ? getMessages(session.id) : session.messages;
}

export function getChatSessionTitle(session: ChatSession, fallback = 'Untitled Session'): string {
  if (session.title?.trim()) return session.title.trim();
  const firstUser = getChatSessionMessages(session).find((message) => message.role === 'user');
  const text = firstUser?.content.replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 56 ? `${text.slice(0, 56)}...` : text;
}

export function getChatSessionSummary(session: ChatSession): string {
  const messages = getChatSessionMessages(session);
  const last = [...messages].reverse().find((message) => message.content.trim());
  const text = last?.content.replace(/\s+/g, ' ').trim();
  if (!text) return 'Project-scoped chat session is ready for focused work.';
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}

export function formatChatSessionUpdated(updatedAt: number): string {
  const diff = Date.now() - updatedAt;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function getStudioStatusFromChatSession(
  session: ChatSession,
  activeSessionId: string | null,
): StudioSessionSummary['status'] {
  if (session.id === activeSessionId) return 'active';
  if (getChatSessionMessages(session).length === 0) return 'paused';
  return 'done';
}

export function summarizeChatSession(
  session: ChatSession,
  activeSessionId: string | null,
  fallbackTitle = 'Untitled Session',
): StudioSessionSummary {
  const runtime = getSessionAgentRuntime(session);
  return {
    id: session.id,
    href: `/chat/${encodeURIComponent(session.id)}`,
    agentId: runtime?.id ?? 'mindos',
    agentName: runtime?.name ?? 'MindOS',
    title: getChatSessionTitle(session, fallbackTitle),
    status: getStudioStatusFromChatSession(session, activeSessionId),
    updated: formatChatSessionUpdated(session.updatedAt),
    artifact: session.currentFile ?? 'Chat session',
    summary: getChatSessionSummary(session),
  };
}
