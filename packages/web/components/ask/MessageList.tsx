'use client';

import { useRef, useEffect, memo, useState, useCallback, useMemo, useDeferredValue, type CSSProperties, type ReactNode } from 'react';
import { Loader2, AlertCircle, Wrench, Zap, Copy, Check, ArrowDown, FolderInput, Search, PenLine, Lightbulb, FileText, Paperclip, Bot, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ImagePart, RuntimeStatusPart } from '@/lib/types';
import { stripThinkingTags } from '@/hooks/useAiOrganize';
import { copyToClipboard } from '@/lib/clipboard';
import ToolCallBlock from './ToolCallBlock';
import ThinkingBlock from './ThinkingBlock';
import { SaveMessageButton } from './SaveSessionInline';
import UserMessageActions from './UserMessageActions';
import AgentRunTimeline from './AgentRunTimeline';
import { agentIconFile } from '@/lib/agent-icons';

const SKILL_PREFIX_RE = /^Use the skill ([^:]+):\s*/;
const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
const MESSAGE_ROW_STYLE: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: '0 96px',
};

function CopyMessageButton({ text, label, variant = 'default' }: { text: string; label?: string; variant?: 'default' | 'dock' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    copyToClipboard(text).then(ok => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label ?? 'Copy'}
      className={variant === 'dock'
        ? 'hit-target-box inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-bg:transparent] [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-sm)]'
        : 'inline-flex h-7 w-7 items-center justify-center rounded-md bg-card border border-border/60 shadow-sm text-muted-foreground transition-colors duration-75 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation'}
      title={label ?? 'Copy'}
    >
      {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
    </button>
  );
}

function formatMessageTimestamp(timestamp: number | undefined): { label: string; title: string; dateTime: string } | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return {
    label: date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    title: date.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
    dateTime: date.toISOString(),
  };
}

function MessageMetaRow({ timestamp, align, children }: { timestamp?: number; align: 'start' | 'end'; children?: ReactNode }) {
  const time = formatMessageTimestamp(timestamp);
  if (!time && !children) return null;
  const alignClass = align === 'end' ? 'right-1 justify-end' : 'left-1 justify-start';
  return (
    <div
      data-message-meta
      className={`pointer-events-none absolute top-full z-20 flex pt-1 opacity-0 transition-[opacity,transform] duration-100 focus-within:pointer-events-auto focus-within:translate-y-0 focus-within:opacity-100 md:translate-y-0.5 md:group-hover/message:pointer-events-auto md:group-hover/message:translate-y-0 md:group-hover/message:opacity-100 ${alignClass}`}
    >
      <div
        data-message-meta-card
        className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-border/40 bg-background/95 px-1.5 py-0.5 shadow-sm backdrop-blur-sm"
      >
        {time && (
          <time
            suppressHydrationWarning
            data-message-timestamp={time.dateTime}
            dateTime={time.dateTime}
            title={time.title}
            className="shrink-0 text-[11px] font-medium leading-none text-muted-foreground/70 tabular-nums"
          >
            {time.label}
          </time>
        )}
        {children && (
          <div data-message-actions className="flex items-center gap-0.5 text-muted-foreground">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

const UserMessageContent = memo(function UserMessageContent({ content, skillName, images, attachedFiles, uploadedFileNames }: { content: string; skillName?: string; images?: ImagePart[]; attachedFiles?: string[]; uploadedFileNames?: string[] }) {
  const { resolved, rest } = useMemo(() => {
    const prefixMatch = content.match(SKILL_PREFIX_RE);
    return {
      resolved: skillName ?? prefixMatch?.[1],
      rest: prefixMatch ? content.slice(prefixMatch[0].length) : content,
    };
  }, [content, skillName]);

  const dedupedAttached = useMemo(() => {
    if (!attachedFiles || attachedFiles.length === 0) return attachedFiles;
    if (!uploadedFileNames || uploadedFileNames.length === 0) return attachedFiles;
    const uploadedSet = new Set(uploadedFileNames);
    return attachedFiles.filter(fp => !uploadedSet.has(fp.split('/').pop() ?? fp));
  }, [attachedFiles, uploadedFileNames]);
  const hasContext = (dedupedAttached && dedupedAttached.length > 0)
    || (uploadedFileNames && uploadedFileNames.length > 0);

  return (
    <>
      {/* Images */}
      {images && images.length > 0 && (
        <div className={`flex flex-wrap gap-1.5${content ? ' mb-2' : ''}`}>
          {images.map((img, idx) => (
            img.data ? (
              // Data URL previews are local session images; next/image cannot optimize them.
              <img
                key={idx}
                src={`data:${img.mimeType};base64,${img.data}`}
                alt={`Image ${idx + 1}`}
                className="max-h-48 max-w-full rounded-md object-contain"
              />
            ) : (
              <div key={idx} className="h-12 px-3 rounded-md bg-muted flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>[Image {idx + 1}]</span>
              </div>
            )
          ))}
        </div>
      )}
      {/* Skill capsule + text */}
      {resolved && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-white/20 text-white/90 mr-1 align-middle">
          <Zap size={10} className="shrink-0" />
          {resolved}
        </span>
      )}
      {resolved ? rest : content}
      {/* File context chips */}
      {hasContext && (
        <div className="mt-2 pt-1.5 border-t border-white/15 flex flex-wrap gap-1 whitespace-normal" role="list" aria-label="Attached files">
          {dedupedAttached?.map(fp => (
            <span
              key={fp}
              role="listitem"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-white/80 min-w-0"
              title={fp}
            >
              <FileText size={9} className="shrink-0 opacity-70" />
              <span className="truncate max-w-[120px]">{fp.split('/').pop()}</span>
            </span>
          ))}
          {uploadedFileNames?.map(name => (
            <span
              key={name}
              role="listitem"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-white/80 min-w-0"
              title={name}
            >
              <Paperclip size={9} className="shrink-0 opacity-70" />
              <span className="truncate max-w-[120px]">{name}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
});

function shouldShowAssistantAgentBadge(agentKind?: Message['agentKind'] | string): boolean {
  return agentKind !== 'codex' && agentKind !== 'claude';
}

function shouldShowAssistantSideMark(agentKind?: Message['agentKind'] | string): boolean {
  return true;
}

const AssistantAgentBadge = memo(function AssistantAgentBadge({ agentName, agentKind }: { agentName?: string; agentKind?: Message['agentKind'] | string }) {
  if (!agentName || !shouldShowAssistantAgentBadge(agentKind)) return null;
  return (
    <div className="mb-2 inline-flex items-center gap-1 rounded-full border border-[var(--amber)]/15 bg-[var(--amber)]/8 px-2 py-0.5 text-[10px] font-medium tracking-wide text-[var(--amber)]">
      <Bot size={10} className="shrink-0" />
      <span>{agentName}</span>
    </div>
  );
});

const AssistantMessage = memo(function AssistantMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const cleaned = stripThinkingTags(content);
  const deferredCleaned = useDeferredValue(cleaned);
  const renderedContent = isStreaming ? deferredCleaned : cleaned;
  if (!renderedContent && !isStreaming) return null;
  return (
    <div className="prose prose-sm prose-panel dark:prose-invert max-w-full min-w-0 text-foreground [overflow-wrap:anywhere]
      prose-p:my-2 prose-p:leading-relaxed
      prose-headings:font-semibold prose-headings:my-3
      prose-h1:text-base prose-h2:text-[15px] prose-h3:text-sm
      prose-ul:my-1.5 prose-li:my-0.5
      prose-ol:my-1.5
      prose-li:[overflow-wrap:anywhere]
      prose-code:text-[0.8em] prose-code:bg-muted/80 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none prose-code:font-mono prose-code:break-words prose-code:[overflow-wrap:anywhere]
      prose-pre:bg-muted/60 prose-pre:text-foreground prose-pre:text-xs prose-pre:rounded-lg prose-pre:max-w-full prose-pre:overflow-x-auto
      prose-blockquote:border-l-[var(--amber)] prose-blockquote:text-muted-foreground prose-blockquote:not-italic
      prose-a:text-[var(--amber)] prose-a:no-underline prose-a:break-words hover:prose-a:underline
      prose-strong:text-foreground prose-strong:font-semibold
      prose-table:text-xs prose-th:py-1.5 prose-td:py-1
    ">
      <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS}>{renderedContent}</ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 bg-[var(--amber)] ml-0.5 align-middle animate-pulse rounded-full" />
      )}
    </div>
  );
});

function runtimeLabel(runtime: RuntimeStatusPart['runtime']): string {
  if (runtime === 'codex') return 'Codex';
  if (runtime === 'claude') return 'Claude Code';
  if (runtime === 'acp') return 'ACP';
  if (runtime === 'mindos') return 'MindOS';
  return 'Runtime';
}

function isRoutineRuntimeStatusPart(part: RuntimeStatusPart): boolean {
  if (part.runtime !== 'codex' && part.runtime !== 'claude') return false;
  const normalized = part.message.trim();
  return /^Starting (Claude Code|Codex) locally\.$/.test(normalized)
    || /^Resuming (Claude Code|Codex) locally\.$/.test(normalized)
    || /^(Claude Code|Codex) is connected and working in this chat\.$/.test(normalized)
    || normalized === 'Claude Code is contacting Claude.';
}

function isCompactingRuntimeStatusPart(part: RuntimeStatusPart): boolean {
  return part.runtime === 'claude' && part.message.trim() === 'Claude Code is compacting context.';
}

function RuntimeMark({
  runtime,
  label,
  active = false,
  small = false,
}: {
  runtime?: Message['agentKind'] | RuntimeStatusPart['runtime'];
  label?: string;
  active?: boolean;
  small?: boolean;
}) {
  const size = small ? 'h-5 w-5' : 'h-7 w-7';
  const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const title = label ?? (runtime ? runtimeLabel(runtime as RuntimeStatusPart['runtime']) : 'MindOS');
  const iconFile = agentIconFile(label) ?? agentIconFile(runtime);
  const imageSrc = iconFile
    ? `/agent-icons/${iconFile}`
    : runtime === 'mindos' || !runtime
      ? '/logo-square.svg'
      : null;

  return (
    <span
      title={title}
      aria-label={title}
      className={`${size} relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/40 bg-background shadow-sm`}
    >
      {imageSrc ? (
        <img src={imageSrc} alt="" aria-hidden="true" className={`${iconSize} object-contain`} />
      ) : (
        <Bot size={small ? 12 : 14} className="text-muted-foreground" />
      )}
      {active && (
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full border border-background bg-muted">
          <Loader2 size={7} className="animate-spin text-[var(--amber)]" />
        </span>
      )}
    </span>
  );
}

const RuntimeStatusBlock = memo(function RuntimeStatusBlock({ part, active, labels }: { part: RuntimeStatusPart; active: boolean; labels: MessageListProps['labels'] }) {
  const message = isCompactingRuntimeStatusPart(part)
    ? (labels.contextCompacting ?? part.message)
    : part.message;
  return (
    <div
      role="status"
      className="my-1.5 flex max-w-full items-start gap-2 rounded-md border border-border/40 bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground"
    >
      <RuntimeMark runtime={part.runtime} active={active} small />
      <div className="min-w-0 leading-relaxed">
        <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground/60">
          {runtimeLabel(part.runtime)}
        </div>
        <div className="[overflow-wrap:anywhere]">{message}</div>
      </div>
    </div>
  );
});

const AssistantMessageWithParts = memo(function AssistantMessageWithParts({ message, isStreaming, labels }: { message: Message; isStreaming: boolean; labels: MessageListProps['labels'] }) {
  const parts = message.parts;
  if (!parts || parts.length === 0) {
    // Fallback to plain text rendering
    return message.content ? (
      <AssistantMessage content={message.content} isStreaming={isStreaming} />
    ) : null;
  }

  // Check if the last part is a running tool call — show a spinner after it
  const lastPart = parts[parts.length - 1];
  const showTrailingSpinner = isStreaming && lastPart.type === 'tool-call' && (lastPart.state === 'running' || lastPart.state === 'pending');

  return (
    <div>
      {parts.map((part, idx) => {
        if (part.type === 'reasoning') {
          const isLastPart = isStreaming && idx === parts.length - 1;
          return <ThinkingBlock key={`reasoning-${idx}`} text={part.text} isStreaming={isLastPart} />;
        }
        if (part.type === 'text') {
          const isLastTextPart = isStreaming && idx === parts.length - 1;
          return part.text ? (
            <AssistantMessage key={idx} content={part.text} isStreaming={isLastTextPart} />
          ) : null;
        }
        if (part.type === 'tool-call') {
          return <ToolCallBlock key={part.toolCallId} part={part} />;
        }
        if (part.type === 'runtime-status') {
          if (isRoutineRuntimeStatusPart(part)) return null;
          return (
            <RuntimeStatusBlock
              key={`runtime-status-${idx}`}
              part={part}
              active={isStreaming && idx === parts.length - 1}
              labels={labels}
            />
          );
        }
        if (part.type === 'agent-run-timeline') {
          return <AgentRunTimeline key={`agent-run-timeline-${part.chatSessionId}-${part.startedAfter ?? 'all'}`} part={part} />;
        }
        return null;
      })}
      {showTrailingSpinner && (
        <div className="flex items-center gap-2 py-1.5 mt-1.5">
          <Loader2 size={12} className="animate-spin text-[var(--amber)]" />
          <span className="text-xs text-muted-foreground animate-pulse">Executing tool…</span>
        </div>
      )}
    </div>
  );
});

const StepCounter = memo(function StepCounter({ parts }: { parts: Message['parts'] }) {
  if (!parts) return null;
  const toolCalls = parts.filter(p => p.type === 'tool-call');
  if (toolCalls.length === 0) return null;
  const lastToolCall = toolCalls[toolCalls.length - 1];
  const toolLabel = lastToolCall.type === 'tool-call' ? lastToolCall.toolName : '';
  return (
    <div className="flex items-center gap-1.5 mt-2 pt-1.5 border-t border-border/15 text-xs text-muted-foreground/60">
      <Wrench size={10} />
      <span className="font-medium">Step {toolCalls.length}{toolLabel ? ` — ${toolLabel}` : ''}</span>
    </div>
  );
});

function runtimeDisplayName(message: Message): string {
  if (message.agentName?.trim()) return message.agentName.trim();
  const kind = message.agentKind;
  if (kind === 'codex') return 'Codex';
  if (kind === 'claude') return 'Claude Code';
  if (kind === 'acp') return 'ACP';
  return 'MindOS';
}

function latestRunAnchor(messages: Message[]): Message | undefined {
  return messages[messages.length - 1];
}

function useElapsedSeconds(startedAt: number | undefined, active: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active, startedAt]);
  if (!active || typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

const AssistantRunProgress = memo(function AssistantRunProgress({
  message,
  labels,
  active,
}: {
  message?: Message;
  labels: MessageListProps['labels'];
  active: boolean;
}) {
  const runtimeName = message?.role === 'assistant' ? runtimeDisplayName(message) : 'MindOS';
  const title = labels.runThinking?.(runtimeName) ?? 'Thinking with you';
  const elapsed = useElapsedSeconds(message?.timestamp, active);
  const showElapsed = elapsed !== null && elapsed >= 1;
  return (
    <div data-run-progress role="status" className="flex min-w-0 items-center gap-2 py-1 text-sm text-muted-foreground">
      <span className="min-w-0 truncate">{title}</span>
      {showElapsed && (
        <span suppressHydrationWarning className="shrink-0 text-[11px] font-normal text-muted-foreground/70">
          {labels.elapsedSeconds?.(elapsed) ?? `${elapsed}s`}
        </span>
      )}
      <Loader2 size={14} className="shrink-0 animate-spin text-[var(--amber)]" />
    </div>
  );
});

function RunProgressAgentMark({ message }: { message?: Message }) {
  const runtime = message?.role === 'assistant'
    ? message.agentKind ?? 'mindos'
    : 'mindos';
  const label = message?.role === 'assistant' ? runtimeDisplayName(message) : 'MindOS';
  return (
    <span data-run-progress-agent-logo={runtime} className="inline-flex shrink-0">
      <RuntimeMark runtime={runtime} label={label} />
    </span>
  );
}

const RunProgressFooter = memo(function RunProgressFooter({
  message,
  labels,
}: {
  message?: Message;
  labels: MessageListProps['labels'];
}) {
  const showAgentMark = !hasAssistantRenderableBody(message)
    && (message?.role !== 'assistant' || shouldShowAssistantSideMark(message.agentKind));
  const alignWithAssistantBubble = !showAgentMark
    && message?.role === 'assistant'
    && shouldShowAssistantSideMark(message.agentKind);
  return (
    <div data-run-progress-footer className={`group/message relative !mt-2 flex items-center justify-start animate-[fadeSlideUp_0.22s_ease_both] ${showAgentMark ? 'gap-3' : alignWithAssistantBubble ? 'ml-10' : ''}`}>
      {showAgentMark && (
        <div className="shrink-0">
          <RunProgressAgentMark message={message} />
        </div>
      )}
      <AssistantRunProgress message={message} labels={labels} active />
    </div>
  );
});

function hasVisiblePart(part: NonNullable<Message['parts']>[number]): boolean {
  if (part.type === 'text') return part.text.trim().length > 0;
  if (part.type === 'reasoning') return part.text.trim().length > 0;
  if (part.type === 'runtime-status') return !isRoutineRuntimeStatusPart(part);
  return true;
}

function hasAssistantRenderableBody(message: Message | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  return stripThinkingTags(message.content).trim().length > 0
    || Boolean(message.parts?.some(hasVisiblePart));
}

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  loadingPhase: 'connecting' | 'thinking' | 'streaming' | 'reconnecting';
  reconnectAttempt?: number;
  reconnectMax?: number;
  emptyPrompt: string;
  emptyHint?: string;
  suggestions: readonly { label: string; prompt: string }[];
  onSuggestionClick: (text: string) => void;
  onEditMessage?: (index: number) => void;
  onResendMessage?: (index: number) => void;
  labels: {
    connecting: string;
    thinking: string;
    generating: string;
    reconnecting?: string;
    runThinking?: (runtime: string) => string;
    awaitingFirstOutput?: string;
    toolRunningProgress?: (toolName: string) => string;
    permissionWaiting?: string;
    questionWaiting?: string;
    contextCompacting?: string;
    elapsedSeconds?: (seconds: number) => string;
    reconnectingDetail?: (attempt: number, max: number) => string;
    copyMessage?: string;
    editMessage?: string;
    regenerateMessage?: string;
  };
}

const MessageRow = memo(function MessageRow({
  message,
  index,
  messageCount,
  isLoading,
  lastUserMessageIndex,
  onEditMessage,
  onResendMessage,
  labels,
}: {
  message: Message;
  index: number;
  messageCount: number;
  isLoading: boolean;
  lastUserMessageIndex: number;
  onEditMessage?: (index: number) => void;
  onResendMessage?: (index: number) => void;
  labels: MessageListProps['labels'];
}) {
  const isLastMessage = index === messageCount - 1;
  const isStreamingLast = isLoading && isLastMessage;
  const cleanedAssistantContent = useMemo(
    () => message.role === 'assistant' ? stripThinkingTags(message.content) : '',
    [message.content, message.role],
  );
  const assistantHasRenderableBody = message.role === 'assistant' && (
    cleanedAssistantContent.trim().length > 0
    || Boolean(message.parts?.some(hasVisiblePart))
  );
  const isErrorMessage = message.role === 'assistant' && message.content.startsWith('__error__');
  const suppressEmptyCompletedPlaceholder = message.role === 'assistant'
    && !isErrorMessage
    && !assistantHasRenderableBody
    && !isStreamingLast;
  const suppressStreamingPlaceholder = message.role === 'assistant'
    && !isErrorMessage
    && !assistantHasRenderableBody
    && isStreamingLast;
  const hasFloatingDock = message.role === 'user'
    || (message.role === 'assistant' && !isStreamingLast && !isErrorMessage && cleanedAssistantContent.trim().length > 0);
  const userActions = (
    <UserMessageActions
      content={message.content}
      isLastUserMessage={index === lastUserMessageIndex}
      isLoading={isLoading}
      onEdit={onEditMessage ? () => onEditMessage(index) : undefined}
      onResend={onResendMessage ? () => onResendMessage(index) : undefined}
      labels={{
        copy: labels.copyMessage ?? 'Copy',
        edit: labels.editMessage ?? 'Edit',
        regenerate: labels.regenerateMessage ?? 'Regenerate',
      }}
    />
  );
  const assistantActions = !isStreamingLast && cleanedAssistantContent ? (
    <>
      <SaveMessageButton text={message.content} variant="dock" />
      <CopyMessageButton text={cleanedAssistantContent} label={labels.copyMessage} variant="dock" />
    </>
  ) : null;

  if (suppressEmptyCompletedPlaceholder || suppressStreamingPlaceholder) return null;

  return (
    <div style={hasFloatingDock ? undefined : MESSAGE_ROW_STYLE} className={`group/message relative flex w-full min-w-0 gap-3 animate-[fadeSlideUp_0.22s_ease_both] hover:z-30 focus-within:z-30 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      {message.role === 'assistant' && shouldShowAssistantSideMark(message.agentKind) && (
        <div className="mt-0.5 shrink-0">
          <RuntimeMark runtime={message.agentKind ?? 'mindos'} label={message.agentName} />
        </div>
      )}
      {message.role === 'user' ? (
        <div className="relative flex max-w-[85%] min-w-0 flex-col items-end">
          <div
            className="relative px-3.5 py-2.5 rounded-2xl rounded-br-lg text-sm leading-relaxed whitespace-pre-wrap bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm shadow-[var(--amber)]/10"
          >
            <UserMessageContent content={message.content} skillName={message.skillName} images={message.images} attachedFiles={message.attachedFiles} uploadedFileNames={message.uploadedFileNames} />
          </div>
          <MessageMetaRow timestamp={message.timestamp} align="end">
            {userActions}
          </MessageMetaRow>
        </div>
      ) : isErrorMessage ? (
        <div className="relative flex max-w-[calc(100%_-_2.5rem)] min-w-0 flex-col items-start">
          <div className="max-w-full min-w-0 px-3.5 py-3 rounded-2xl rounded-bl-md border border-error/30 bg-error/10 text-sm shadow-sm [overflow-wrap:anywhere]">
            <AssistantAgentBadge agentName={message.agentName} agentKind={message.agentKind} />
            <div className="flex items-start gap-2.5 text-error">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span className="leading-relaxed font-medium">{message.content.slice(9)}</span>
            </div>
          </div>
          <MessageMetaRow timestamp={message.timestamp} align="start" />
        </div>
      ) : (
        <div className="relative flex max-w-[calc(100%_-_2.5rem)] min-w-0 flex-col items-start">
          <div className="relative max-w-full min-w-0 px-3.5 py-2.5 rounded-2xl rounded-bl-lg bg-card border border-border/30 shadow-sm text-foreground text-sm">
            <AssistantAgentBadge agentName={message.agentName} agentKind={message.agentKind} />
            {assistantHasRenderableBody ? (
              <>
                <AssistantMessageWithParts message={message} isStreaming={isStreamingLast} labels={labels} />
                {isStreamingLast && (
                  <StepCounter parts={message.parts} />
                )}
              </>
            ) : null}
          </div>
          <MessageMetaRow timestamp={message.timestamp} align="start">
            {assistantActions}
          </MessageMetaRow>
        </div>
      )}
    </div>
  );
});

export default memo(function MessageList({
  messages,
  isLoading,
  emptyPrompt,
  emptyHint,
  suggestions,
  onSuggestionClick,
  onEditMessage,
  onResendMessage,
  labels,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollFrameKindRef = useRef<'raf' | 'timeout' | null>(null);
  const pendingScrollBehaviorRef = useRef<ScrollBehavior>('instant');
  // Track whether user has manually scrolled away from bottom during streaming.
  // When true, auto-scroll is suppressed so users can read earlier content.
  const userScrolledAwayRef = useRef(false);
  const prevMessageCountRef = useRef(messages.length);

  // Find the last user message index for edit/resend actions
  const lastUserMessageIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return i;
    }
    return -1;
  }, [messages]);
  const activeRunMessage = useMemo(() => latestRunAnchor(messages), [messages]);

  const performScrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    pendingScrollBehaviorRef.current = behavior;
    if (scrollFrameRef.current !== null) return;

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      scrollFrameKindRef.current = 'raf';
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        scrollFrameKindRef.current = null;
        performScrollToBottom(pendingScrollBehaviorRef.current);
      });
      return;
    }

    scrollFrameKindRef.current = 'timeout';
    scrollFrameRef.current = globalThis.setTimeout(() => {
      scrollFrameRef.current = null;
      scrollFrameKindRef.current = null;
      performScrollToBottom(pendingScrollBehaviorRef.current);
    }, 0) as unknown as number;
  }, [performScrollToBottom]);

  useEffect(() => () => {
    if (scrollFrameRef.current === null) return;
    if (scrollFrameKindRef.current === 'raf') {
      window.cancelAnimationFrame(scrollFrameRef.current);
    } else {
      globalThis.clearTimeout(scrollFrameRef.current);
    }
    scrollFrameRef.current = null;
    scrollFrameKindRef.current = null;
  }, []);

  // Auto-scroll: only when user hasn't scrolled away.
  // Reset userScrolledAway when a brand new message arrives (new user prompt),
  // so the view follows the new response naturally.
  useEffect(() => {
    const newCount = messages.length;
    const isNewMessage = newCount > prevMessageCountRef.current;
    prevMessageCountRef.current = newCount;

    if (isNewMessage) {
      // New message added (user sent or assistant started) — re-engage auto-scroll
      userScrolledAwayRef.current = false;
      scrollToBottom('instant');
      return;
    }

    // Streaming chunk update — only scroll if user is still at bottom
    if (!userScrolledAwayRef.current) {
      scrollToBottom('instant');
    }
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const { scrollTop, scrollHeight, clientHeight } = container;
        const distFromBottom = scrollHeight - scrollTop - clientHeight;
        setShowScrollDown(distFromBottom > 100);

        // If user scrolled near bottom, re-enable auto-scroll
        if (distFromBottom < 80) {
          userScrolledAwayRef.current = false;
        }
        ticking = false;
      });
    };

    // Detect manual scroll-up via wheel / touch / keyboard.
    // wheel fires BEFORE scroll position updates, so we check deltaY direction
    // instead of relying on isNearBottom() which reads the stale scrollTop.
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        // User is scrolling up
        userScrolledAwayRef.current = true;
      }
    };

    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? 0;
    };
    const handleTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0]?.clientY ?? 0;
      if (currentY > touchStartY) {
        // Finger moving down = scrolling up
        userScrolledAwayRef.current = true;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) {
        userScrolledAwayRef.current = true;
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('keydown', handleKeyDown);
    return () => {
      // Verify container still exists before removing listeners to prevent memory leaks
      if (!container) return;
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div ref={scrollContainerRef} role="log" aria-live="polite" className="relative flex-1 overflow-y-auto overflow-x-hidden px-4 pt-5 pb-10 space-y-5 min-h-0">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 min-h-[260px] px-6 pt-10 pb-4">
          {/* Brand anchor — refined presence */}
          <div className="relative w-12 h-12 rounded-2xl bg-[var(--amber)]/10 flex items-center justify-center mb-6">
            <div className="absolute inset-0 rounded-2xl bg-[var(--amber)]/5 scale-[1.4]" />
            <Sparkles size={22} className="text-[var(--amber)] relative z-10" />
          </div>
          <p className="text-center text-[15px] font-semibold text-foreground tracking-tight mb-2">{emptyPrompt}</p>
          {emptyHint && (
            <p className="text-center text-xs text-muted-foreground/80 mb-10 tracking-wide">{emptyHint}</p>
          )}
          {/* Suggestion chips — refined single column */}
          <div className="flex flex-col gap-2.5 max-w-[280px] w-full">
            {suggestions.map((s, i) => {
              const icons = [FolderInput, Search, PenLine, Lightbulb];
              const SugIcon = icons[i % icons.length];
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSuggestionClick(s.prompt)}
                  className="hit-target-box group/sug flex items-center gap-3 text-left text-[13px] px-3.5 py-3 border border-transparent text-muted-foreground hover:text-foreground transition-all leading-snug [--hit-target-bg:transparent] [--hit-target-hover-bg:color-mix(in_srgb,var(--amber)_5%,transparent)] [--hit-target-border-width:1px] [--hit-target-border:color-mix(in_srgb,var(--border)_40%,transparent)] [--hit-target-hover-border:color-mix(in_srgb,var(--amber)_30%,transparent)] [--hit-target-radius:var(--radius-xl)]"
                  aria-label={s.prompt}
                >
                  <span className="shrink-0 w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center group-hover/sug:bg-[var(--amber)]/10 transition-colors">
                    <SugIcon size={15} className="text-muted-foreground/70 group-hover/sug:text-[var(--amber)] transition-colors" />
                  </span>
                  <span className="flex-1">{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {messages.map((m, i) => (
        <MessageRow
          key={`${m.timestamp ?? i}:${m.role}:${i}`}
          message={m}
          index={i}
          messageCount={messages.length}
          isLoading={isLoading}
          lastUserMessageIndex={lastUserMessageIndex}
          onEditMessage={onEditMessage}
          onResendMessage={onResendMessage}
          labels={labels}
        />
      ))}
      {isLoading && (
        <RunProgressFooter message={activeRunMessage} labels={labels} />
      )}
      <div ref={endRef} />

      {/* Scroll-to-bottom FAB */}
      {showScrollDown && messages.length > 0 && (
        <button
          type="button"
          onClick={() => {
            userScrolledAwayRef.current = false;
            scrollToBottom();
          }}
          className="sticky bottom-2 left-1/2 z-10 inline-flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border/60 bg-card shadow-md text-muted-foreground transition-all duration-75 hover:text-foreground hover:bg-muted hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation"
          title="Scroll to bottom"
        >
          <ArrowDown size={14} />
        </button>
      )}
    </div>
  );
});
