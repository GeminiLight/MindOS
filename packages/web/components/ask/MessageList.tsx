'use client';

import { useRef, useEffect, memo, useState, useCallback, useMemo, type CSSProperties, type ReactNode } from 'react';
import { Loader2, AlertCircle, Wrench, WifiOff, Zap, Copy, Check, ArrowDown, FolderInput, Search, PenLine, Lightbulb, FileText, Paperclip, Bot, Sparkles } from 'lucide-react';
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

function MessageActionDock({ children }: { children: ReactNode }) {
  return (
    <div className="absolute right-3 top-full z-40 -mt-2 flex items-center gap-0.5 rounded-lg border border-border/50 bg-background/95 p-0.5 shadow-sm backdrop-blur-sm opacity-100 transition-[opacity,transform] duration-100 pointer-events-auto md:pointer-events-none md:opacity-0 md:translate-y-0.5 md:group-hover/message:pointer-events-auto md:group-hover/message:opacity-100 md:group-hover/message:translate-y-0 md:focus-within:pointer-events-auto md:focus-within:opacity-100 md:focus-within:translate-y-0">
      {children}
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

// Native runtimes (codex / claude) speak as the assistant itself — repeating
// their identity per message reads as noise, so badge and side mark are both
// suppressed for them. Every other attributed agent (acp / a2a / subagents /
// kind-less attributions) keeps the badge.
function shouldShowAssistantAgentBadge(agentKind?: Message['agentKind'] | string): boolean {
  return shouldShowAssistantSideMark(agentKind);
}

function shouldShowAssistantSideMark(agentKind?: Message['agentKind'] | string): boolean {
  return agentKind !== 'codex' && agentKind !== 'claude';
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
  if (!cleaned && !isStreaming) return null;
  return (
    <div className="prose prose-sm prose-panel dark:prose-invert max-w-none text-foreground
      prose-p:my-2 prose-p:leading-relaxed
      prose-headings:font-semibold prose-headings:my-3
      prose-h1:text-base prose-h2:text-[15px] prose-h3:text-sm
      prose-ul:my-1.5 prose-li:my-0.5
      prose-ol:my-1.5
      prose-code:text-[0.8em] prose-code:bg-muted/80 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none prose-code:font-mono
      prose-pre:bg-muted/60 prose-pre:text-foreground prose-pre:text-xs prose-pre:rounded-lg
      prose-blockquote:border-l-[var(--amber)] prose-blockquote:text-muted-foreground prose-blockquote:not-italic
      prose-a:text-[var(--amber)] prose-a:no-underline hover:prose-a:underline
      prose-strong:text-foreground prose-strong:font-semibold
      prose-table:text-xs prose-th:py-1.5 prose-td:py-1
    ">
      <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS}>{cleaned}</ReactMarkdown>
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
    || normalized === 'Claude Code is compacting context.'
    || normalized === 'Claude Code is contacting Claude.';
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
  const imageSrc = runtime === 'codex'
    ? '/agent-icons/openai.svg'
    : runtime === 'claude'
      ? '/agent-icons/claude.svg'
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

const RuntimeStatusBlock = memo(function RuntimeStatusBlock({ part, active }: { part: RuntimeStatusPart; active: boolean }) {
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
        <div className="[overflow-wrap:anywhere]">{part.message}</div>
      </div>
    </div>
  );
});

const AssistantMessageWithParts = memo(function AssistantMessageWithParts({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
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

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  loadingPhase: 'connecting' | 'thinking' | 'streaming' | 'reconnecting';
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
  loadingPhase,
  lastUserMessageIndex,
  onEditMessage,
  onResendMessage,
  labels,
}: {
  message: Message;
  index: number;
  messageCount: number;
  isLoading: boolean;
  loadingPhase: MessageListProps['loadingPhase'];
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

  return (
    <div style={MESSAGE_ROW_STYLE} className={`group/message flex gap-3 animate-[fadeSlideUp_0.22s_ease_both] ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      {message.role === 'assistant' && shouldShowAssistantSideMark(message.agentKind) && (
        <div className="mt-0.5 shrink-0">
          <RuntimeMark runtime={message.agentKind ?? 'mindos'} label={message.agentName} />
        </div>
      )}
      {message.role === 'user' ? (
        <div
          className="group relative max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-br-lg text-sm leading-relaxed whitespace-pre-wrap bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm shadow-[var(--amber)]/10"
        >
          <UserMessageContent content={message.content} skillName={message.skillName} images={message.images} attachedFiles={message.attachedFiles} uploadedFileNames={message.uploadedFileNames} />
          <MessageActionDock>
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
          </MessageActionDock>
        </div>
      ) : message.content.startsWith('__error__') ? (
        <div className="max-w-[85%] px-3.5 py-3 rounded-2xl rounded-bl-md border border-error/30 bg-error/10 text-sm shadow-sm">
          <AssistantAgentBadge agentName={message.agentName} agentKind={message.agentKind} />
          <div className="flex items-start gap-2.5 text-error">
            <AlertCircle size={15} className="shrink-0 mt-0.5" />
            <span className="leading-relaxed font-medium">{message.content.slice(9)}</span>
          </div>
        </div>
      ) : (
        <div className="group relative max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-lg bg-card border border-border/30 shadow-sm text-foreground text-sm">
          <AssistantAgentBadge agentName={message.agentName} agentKind={message.agentKind} />
          {(message.parts && message.parts.length > 0) || cleanedAssistantContent ? (
            <>
              <AssistantMessageWithParts message={message} isStreaming={isStreamingLast} />
              {isStreamingLast && (
                <StepCounter parts={message.parts} />
              )}
              {!isStreamingLast && cleanedAssistantContent && (
                <MessageActionDock>
                  <SaveMessageButton text={message.content} variant="dock" />
                  <CopyMessageButton text={cleanedAssistantContent} label={labels.copyMessage} variant="dock" />
                </MessageActionDock>
              )}
            </>
          ) : isStreamingLast ? (
            <div className="flex items-center gap-2.5 py-1">
              {loadingPhase === 'reconnecting' ? (
                <WifiOff size={14} className="text-[var(--amber)] animate-pulse" />
              ) : (
                <Loader2 size={14} className="animate-spin text-[var(--amber)]" />
              )}
              <span className="text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                {loadingPhase === 'reconnecting'
                  ? (labels.reconnecting ?? 'Reconnecting...')
                  : loadingPhase === 'connecting'
                    ? labels.connecting
                    : loadingPhase === 'thinking'
                      ? labels.thinking
                      : labels.generating}
                <span className="inline-flex gap-0.5">
                  <span className="w-1 h-1 rounded-full bg-[var(--amber)] animate-bounce [animation-delay:0ms]"></span>
                  <span className="w-1 h-1 rounded-full bg-[var(--amber)] animate-bounce [animation-delay:150ms]"></span>
                  <span className="w-1 h-1 rounded-full bg-[var(--amber)] animate-bounce [animation-delay:300ms]"></span>
                </span>
                </span>
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});

export default memo(function MessageList({
  messages,
  isLoading,
  loadingPhase,
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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
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
    <div ref={scrollContainerRef} role="log" aria-live="polite" className="relative flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 space-y-5 min-h-0">
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
          loadingPhase={loadingPhase}
          lastUserMessageIndex={lastUserMessageIndex}
          onEditMessage={onEditMessage}
          onResendMessage={onResendMessage}
          labels={labels}
        />
      ))}
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
