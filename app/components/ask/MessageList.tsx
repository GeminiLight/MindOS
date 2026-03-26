'use client';

import { useRef, useEffect } from 'react';
import { Sparkles, Loader2, AlertCircle, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '@/lib/types';
import ToolCallBlock from './ToolCallBlock';
import ThinkingBlock from './ThinkingBlock';

function AssistantMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return (
    <div className="prose prose-sm prose-panel dark:prose-invert max-w-none text-foreground
      prose-p:my-1 prose-p:leading-relaxed
      prose-headings:font-semibold prose-headings:my-2 prose-headings:text-[13px]
      prose-ul:my-1 prose-li:my-0.5
      prose-ol:my-1
      prose-code:text-[0.8em] prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-muted prose-pre:text-foreground prose-pre:text-xs
      prose-blockquote:border-l-amber-400 prose-blockquote:text-muted-foreground
      prose-a:text-amber-500 prose-a:no-underline hover:prose-a:underline
      prose-strong:text-foreground prose-strong:font-semibold
      prose-table:text-xs prose-th:py-1 prose-td:py-1
    ">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 bg-amber-400 ml-0.5 align-middle animate-pulse rounded-sm" />
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
        <div className="flex items-center gap-2 py-1 mt-1">
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
    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground/70">
      <Wrench size={10} />
      <span>Step {toolCalls.length}{toolLabel ? ` — ${toolLabel}` : ''}</span>
    </div>
  );
}

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  loadingPhase: 'connecting' | 'thinking' | 'streaming';
  emptyPrompt: string;
  suggestions: readonly string[];
  onSuggestionClick: (text: string) => void;
  labels: {
    connecting: string;
    thinking: string;
    generating: string;
  };
}

export default function MessageList({
  messages,
  isLoading,
  loadingPhase,
  emptyPrompt,
  suggestions,
  onSuggestionClick,
  labels,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
      {messages.length === 0 && (
        <div className="mt-6 space-y-3">
          <p className="text-center text-sm text-muted-foreground/60">{emptyPrompt}</p>
          <div className="flex flex-col gap-2 px-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSuggestionClick(s)}
                className="text-left text-xs px-3 py-2 rounded-lg border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {messages.map((m, i) => (
        <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          {m.role === 'assistant' && (
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-[var(--amber-dim)]"
            >
              <Sparkles size={12} className="text-[var(--amber)]" />
            </div>
          )}
          {m.role === 'user' ? (
            <div
              className="max-w-[85%] px-3 py-2 rounded-xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap bg-[var(--amber)] text-[var(--amber-foreground)]"
            >
              {m.content}
            </div>
          ) : m.content.startsWith('__error__') ? (
            <div className="max-w-[85%] px-3 py-2.5 rounded-xl rounded-bl-sm border border-error/20 bg-error/8 text-sm">
              <div className="flex items-start gap-2 text-error">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span className="leading-relaxed">{m.content.slice(9)}</span>
              </div>
            </div>
          ) : (
            <div className="max-w-[85%] px-3 py-2 rounded-xl rounded-bl-sm bg-muted text-foreground text-sm">
              {(m.parts && m.parts.length > 0) || m.content ? (
                <>
                  <AssistantMessageWithParts message={m} isStreaming={isLoading && i === messages.length - 1} />
                  {isLoading && i === messages.length - 1 && (
                    <StepCounter parts={m.parts} />
                  )}
                </>
              ) : isLoading && i === messages.length - 1 ? (
                <div className="flex items-center gap-2 py-1">
                  <Loader2 size={14} className="animate-spin text-[var(--amber)]" />
                  <span className="text-xs text-muted-foreground animate-pulse">
                    {loadingPhase === 'connecting'
                      ? labels.connecting
                      : loadingPhase === 'thinking'
                        ? labels.thinking
                        : labels.generating}
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
