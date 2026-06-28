import {
  compactRuntimeSessionPathLabel,
  getRuntimeSessionSummary,
  getSessionAgentRuntime,
  runtimeSessionCompactLabel,
  runtimeSessionTooltip,
  shortRuntimeSessionId,
  type RuntimeSessionSummary,
} from '@/lib/ask-agent';
import {
  runtimeSessionEntryMessageCount,
  runtimeSessionEntryNoun,
  runtimeSessionEntryPreview,
  runtimeSessionEntryStatus,
  runtimeSessionEntryTitle,
  runtimeSessionEntryUpdatedAtMs,
  runtimeSessionTimestampMs,
  type RuntimeSessionEntry,
} from '@/lib/runtime-session-entry';
import type { AgentRuntimeIdentity, ChatSession, Message } from '@/lib/types';

export type SessionListSource = 'chat-session' | 'runtime-session';
export type SessionListAgentKind = 'mindos' | 'codex' | 'claude' | 'acp';
export type SessionListAgentFilter = 'all' | 'mindos' | 'codex' | 'claude' | `acp:${string}`;

export interface SessionListEntryBase {
  source: SessionListSource;
  id: string;
  title: string;
  preview: string;
  runtime: AgentRuntimeIdentity | null;
  agentKind: SessionListAgentKind;
  runtimeLabel: string;
  compactRuntimePath: string | null;
  fullSessionId: string | null;
  compactSessionId: string | null;
  status: string | null;
  updatedAtMs: number | null;
  updatedAtLabel: string | null;
  messageCount: number | null;
  metadataTitle: string | undefined;
  searchText: string;
  hasListContent: boolean;
}

export interface ChatSessionListEntry extends SessionListEntryBase {
  source: 'chat-session';
  session: ChatSession;
  pinned: boolean;
  runtimeSummary: RuntimeSessionSummary;
}

export interface RuntimeSessionListEntry extends SessionListEntryBase {
  source: 'runtime-session';
  runtimeEntry: RuntimeSessionEntry;
  pinned: false;
  noun: string;
}

export type SessionListEntry = ChatSessionListEntry | RuntimeSessionListEntry;

type ChatSessionListEntryOptions = {
  title?: string;
  preview?: string;
  runtimeSummary?: RuntimeSessionSummary;
  emptyTitleFallback?: string;
};

type RuntimeSessionListEntryOptions = {
  titleMaxLength?: number;
  previewMaxLength?: number;
};

export function formatSessionListRelativeTime(value: number | string | Date | null | undefined): string | null {
  const timestamp = value instanceof Date ? value.getTime() : runtimeSessionTimestampMs(value);
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;

  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function pluralizeSessionListCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function chatSessionTitle(session: ChatSession): string {
  if (session.title) return session.title;
  const firstUser = session.messages.find((message) => message.role === 'user');
  if (!firstUser) return '(empty session)';
  const line = firstUser.content.replace(/\s+/g, ' ').trim();
  if (!line && firstUser.images && firstUser.images.length > 0) {
    return `[${firstUser.images.length} image${firstUser.images.length > 1 ? 's' : ''}]`;
  }
  return line.length > 42 ? `${line.slice(0, 42)}...` : line || '(empty session)';
}

export function chatSessionDisplayTitle(session: ChatSession, emptyTitleFallback?: string): string {
  const title = chatSessionTitle(session);
  return title === '(empty session)' && emptyTitleFallback ? emptyTitleFallback : title;
}

export function chatSessionPreview(session: ChatSession, maxLength = 60): string {
  const firstUser = session.messages.find((message) => message.role === 'user');
  if (!firstUser) return '';
  const text = firstUser.content.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function normalizeSessionListSearchText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLocaleLowerCase();
}

function messageSearchText(message: Message): string {
  return [
    message.content,
    message.skillName,
    ...(message.attachedFiles ?? []),
    ...(message.uploadedFileNames ?? []),
    message.agentId,
    message.agentName,
    message.agentKind,
  ].filter(Boolean).join(' ');
}

function normalizePreviewText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function shouldShowPreview(title: string, preview: string): boolean {
  return Boolean(preview && normalizePreviewText(title) !== normalizePreviewText(preview));
}

function runtimeLabelForChatSession(
  session: ChatSession,
  runtime: AgentRuntimeIdentity | null,
  summary: RuntimeSessionSummary,
): string {
  const compact = runtimeSessionCompactLabel(summary);
  if (compact) return compact;
  if (!runtime || runtime.kind === 'mindos') return 'MindOS';
  if (runtime.kind === 'codex') return 'Codex';
  if (runtime.kind === 'claude') return 'Claude';
  return runtime.name || session.defaultAcpAgent?.name || 'ACP';
}

export function sessionListAgentKind(runtime: AgentRuntimeIdentity | null | undefined): SessionListAgentKind {
  if (!runtime || runtime.kind === 'mindos') return 'mindos';
  if (runtime.kind === 'codex') return 'codex';
  if (runtime.kind === 'claude') return 'claude';
  return 'acp';
}

export function sessionListAgentFilterId(entry: Pick<SessionListEntryBase, 'agentKind' | 'runtime'>): Exclude<SessionListAgentFilter, 'all'> {
  if (entry.agentKind === 'acp') return `acp:${entry.runtime?.id ?? 'unknown'}`;
  return entry.agentKind;
}

function buildSearchText(parts: unknown[]): string {
  return parts.map(normalizeSessionListSearchText).filter(Boolean).join('\n');
}

export function chatSessionSearchText(session: ChatSession, entry?: Pick<ChatSessionListEntry, 'title' | 'preview' | 'runtime' | 'runtimeSummary' | 'messageCount'>): string {
  const runtime = entry?.runtime ?? getSessionAgentRuntime(session);
  const runtimeSummary = entry?.runtimeSummary ?? getRuntimeSessionSummary(session);
  return buildSearchText([
    entry?.title ?? chatSessionTitle(session),
    entry?.preview ?? chatSessionPreview(session),
    session.id,
    session.title,
    session.projectId,
    session.currentFile,
    session.workDir?.path,
    session.workDir?.label,
    runtime?.id,
    runtime?.name,
    runtime?.kind,
    session.defaultAcpAgent?.id,
    session.defaultAcpAgent?.name,
    runtimeSummary?.label,
    runtimeSummary?.runtimeLabel,
    runtimeSummary?.idLabel,
    runtimeSummary?.binding.externalSessionId,
    runtimeSummary?.cwd,
    runtimeSummary?.status,
    entry?.messageCount,
    ...(session.contextSelection?.spaces ?? []).flatMap((space) => [space.path, space.label, space.source]),
    ...(session.contextSelection?.assistants ?? []).flatMap((assistant) => [assistant.id, assistant.name, assistant.kind, assistant.source]),
    ...session.messages.map(messageSearchText),
  ]);
}

export function sessionListEntryMatchesSearch(entry: Pick<SessionListEntryBase, 'searchText'>, query: string): boolean {
  const terms = normalizeSessionListSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.every((term) => entry.searchText.includes(term));
}

export function buildChatSessionListEntry(
  session: ChatSession,
  options: ChatSessionListEntryOptions = {},
): ChatSessionListEntry {
  const runtime = getSessionAgentRuntime(session);
  const runtimeSummary = options.runtimeSummary ?? getRuntimeSessionSummary(session);
  const title = options.title ?? chatSessionDisplayTitle(session, options.emptyTitleFallback);
  const preview = options.preview ?? chatSessionPreview(session);
  const fullSessionId = runtimeSummary?.binding.externalSessionId?.trim() || session.id;
  const previewTooltip = shouldShowPreview(title, preview) ? preview : null;
  const metadataTitle = [
    runtimeSessionTooltip(runtimeSummary),
    fullSessionId ? `Session ID: ${fullSessionId}` : null,
    previewTooltip ? `Preview: ${previewTooltip}` : null,
  ].filter(Boolean).join(' · ') || undefined;

  const entry: ChatSessionListEntry = {
    source: 'chat-session',
    id: session.id,
    session,
    title,
    preview,
    runtime,
    agentKind: sessionListAgentKind(runtime),
    runtimeLabel: runtimeLabelForChatSession(session, runtime, runtimeSummary),
    compactRuntimePath: compactRuntimeSessionPathLabel(runtimeSummary?.cwd),
    fullSessionId,
    compactSessionId: fullSessionId ? shortRuntimeSessionId(fullSessionId) : null,
    status: runtimeSummary?.status ?? null,
    updatedAtMs: typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt) ? session.updatedAt : null,
    updatedAtLabel: formatSessionListRelativeTime(session.updatedAt),
    messageCount: session.messages.length,
    metadataTitle,
    searchText: '',
    hasListContent: session.messages.length > 0 || Boolean(runtimeSummary),
    pinned: Boolean(session.pinned),
    runtimeSummary,
  };

  return {
    ...entry,
    searchText: chatSessionSearchText(session, entry),
  };
}

export function buildRuntimeSessionListEntry(
  entry: RuntimeSessionEntry,
  options: RuntimeSessionListEntryOptions = {},
): RuntimeSessionListEntry {
  const messageCount = runtimeSessionEntryMessageCount(entry);
  const updatedAtMs = runtimeSessionEntryUpdatedAtMs(entry);
  const preview = runtimeSessionEntryPreview(entry, options.previewMaxLength ?? 72);
  const noun = runtimeSessionEntryNoun(entry);
  const status = runtimeSessionEntryStatus(entry);
  const metadataTitle = [
    entry.id,
    entry.cwd,
    typeof messageCount === 'number' ? `${messageCount} messages` : null,
    preview ? `Preview: ${preview}` : null,
  ].filter(Boolean).join(' · ') || undefined;

  return {
    source: 'runtime-session',
    id: entry.id,
    runtimeEntry: entry,
    title: runtimeSessionEntryTitle(entry, options.titleMaxLength ?? 56),
    preview,
    runtime: entry.runtime,
    agentKind: sessionListAgentKind(entry.runtime),
    runtimeLabel: entry.runtime.name,
    compactRuntimePath: compactRuntimeSessionPathLabel(entry.cwd),
    fullSessionId: entry.id,
    compactSessionId: shortRuntimeSessionId(entry.id),
    status,
    updatedAtMs,
    updatedAtLabel: formatSessionListRelativeTime(updatedAtMs),
    messageCount,
    metadataTitle,
    searchText: buildSearchText([
      entry.id,
      entry.runtime.name,
      entry.runtime.id,
      entry.runtime.kind,
      entry.title,
      entry.preview,
      entry.cwd,
      status,
      messageCount,
    ]),
    hasListContent: true,
    pinned: false,
    noun,
  };
}
