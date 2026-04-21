'use client';

import { useRef, useEffect, memo, useState, useCallback, useMemo } from 'react';
import { Sparkles, Loader2, AlertCircle, Wrench, WifiOff, Zap, Copy, Check, ArrowDown, FolderInput, Search, PenLine, Lightbulb, FileText, Paperclip, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ImagePart } from '@/lib/types';
import { stripThinkingTags } from '@/hooks/useAiOrganize';
import { copyToClipboard } from '@/lib/clipboard';
import ToolCallBlock from './ToolCallBlock';
import ThinkingBlock from './ThinkingBlock';
import { SaveMessageButton } from './SaveSessionInline';
import UserMessageActions from './UserMessageActions';

const SKILL_PREFIX_RE = /^Use the skill ([^:]+):\s*/;

function CopyMessageButton({ text, label }: { text: string; label?: string }) {
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
      className="p-1 rounded-md bg-card border border-border/60 shadow-sm text-muted-foreground hover:text-foreground transition-colors"
      title={label ?? 'Copy'}
    >
      {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
    </button>
  );
}

function UserMessageContent({ content, skillName, images, attachedFiles, uploadedFileNames }: { content: string; skillName?: string; images?: ImagePart[]; attachedFiles?: string[]; uploadedFileNames?: string[] }) {
  const resolved = skillName ?? content.match(SKILL_PREFIX_RE)?.[1];
  const prefixMatch = content.match(SKILL_PREFIX_RE);
  const rest = prefixMatch ? content.slice(prefixMatch[0].length) : content;

  // Deduplicate: uploaded files already shown shouldn't repeat as attached
  const uploadedSet = new Set(uploadedFileNames ?? []);
  const dedupedAttached = attachedFiles?.filter(fp => !uploadedSet.has(fp.split('/').pop() ?? fp));
  const hasContext = (dedupedAttached && dedupedAttached.length > 0)
    || (uploadedFileNames && uploadedFileNames.length > 0);

  return (
    <>
      {/* Images */}
      {images && images.length > 0 && (
        <div className={`flex flex-wrap gap-1.5${content ? ' mb-2' : ''}`}>
          {images.map((img, idx) => (
            img.data ? (
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
}

function AssistantAgentBadge({ agentName }: { agentName?: string }) {
  if (!agentName) return null;
  return (
    <div className="mb-2 inline-flex items-center gap-1 rounded-full border border-[var(--amber)]/15 bg-[var(--amber)]/8 px-2 py-0.5 text-[10px] font-medium tracking-wide text-[var(--amber)]">
      <Bot size={10} className="shrink-0" />
      <span>{agentName}</span>
    </div>
  );
}

function AssistantMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
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
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 bg-[var(--amber)] ml-0.5 align-middle animate-pulse rounded-full" />
      )}
    </div>
  );
}

function AssistantMessageWithParts({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
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
}

function StepCounter({ parts }: { parts: Message['parts'] }) {
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
}

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
                  className="group/sug flex items-center gap-3 text-left text-[13px] px-3.5 py-3 rounded-xl border border-border/40 bg-transparent text-muted-foreground hover:text-foreground hover:border-[var(--amber)]/30 hover:bg-[var(--amber)]/5 transition-all leading-snug"
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
        <div key={i} className={`flex gap-3 animate-[fadeSlideUp_0.22s_ease_both] ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          {m.role === 'assistant' && (
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-[var(--amber)]/8"
            >
              <Sparkles size={13} className="text-[var(--amber)]" />
            </div>
          )}
          {m.role === 'user' ? (
            <div
              className="group relative max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-br-lg text-sm leading-relaxed whitespace-pre-wrap bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm shadow-[var(--amber)]/10"
            >
              <UserMessageContent content={m.content} skillName={m.skillName} images={m.images} attachedFiles={m.attachedFiles} uploadedFileNames={m.uploadedFileNames} />
              <UserMessageActions
                content={m.content}
                isLastUserMessage={i === lastUserMessageIndex}
                isLoading={isLoading}
                onEdit={onEditMessage ? () => onEditMessage(i) : undefined}
                onResend={onResendMessage ? () => onResendMessage(i) : undefined}
                labels={{
                  copy: labels.copyMessage ?? 'Copy',
                  edit: labels.editMessage ?? 'Edit',
                  regenerate: labels.regenerateMessage ?? 'Regenerate',
                }}
              />
            </div>
          ) : m.content.startsWith('__error__') ? (
            <div className="max-w-[85%] px-3.5 py-3 rounded-2xl rounded-bl-md border border-error/30 bg-error/10 text-sm shadow-sm">
              <AssistantAgentBadge agentName={m.agentName} />
              <div className="flex items-start gap-2.5 text-error">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span className="leading-relaxed font-medium">{m.content.slice(9)}</span>
              </div>
            </div>
          ) : (
            <div className="group relative max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-lg bg-card border border-border/30 shadow-sm text-foreground text-sm">
              <AssistantAgentBadge agentName={m.agentName} />
              {(m.parts && m.parts.length > 0) || stripThinkingTags(m.content) ? (
                <>
                  <AssistantMessageWithParts message={m} isStreaming={isLoading && i === messages.length - 1} />
                  {isLoading && i === messages.length - 1 && (
                    <StepCounter parts={m.parts} />
                  )}
                  {!(isLoading && i === messages.length - 1) && stripThinkingTags(m.content) && (
                    <div className="absolute -bottom-1 right-1 z-10 flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <SaveMessageButton text={m.content} />
                      <CopyMessageButton text={stripThinkingTags(m.content)} label={labels.copyMessage} />
                    </div>
                  )}
                </>
              ) : isLoading && i === messages.length - 1 ? (
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
          className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 p-2 rounded-full border border-border/60 bg-card shadow-md text-muted-foreground hover:text-foreground hover:bg-muted transition-all hover:shadow-lg"
          title="Scroll to bottom"
        >
          <ArrowDown size={14} />
        </button>
      )}
    </div>
  );
});
