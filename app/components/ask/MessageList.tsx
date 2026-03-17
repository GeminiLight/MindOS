'use client';

import { useRef, useEffect } from 'react';
import { Sparkles, Loader2, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '@/lib/types';

function AssistantMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-foreground
      prose-p:my-1 prose-p:leading-relaxed
      prose-headings:font-semibold prose-headings:my-2
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
              className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: 'var(--amber-dim)' }}
            >
              <Sparkles size={12} style={{ color: 'var(--amber)' }} />
            </div>
          )}
          {m.role === 'user' ? (
            <div
              className="max-w-[85%] px-3 py-2 rounded-xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap"
              style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
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
              {m.content ? (
                <AssistantMessage content={m.content} isStreaming={isLoading && i === messages.length - 1} />
              ) : isLoading && i === messages.length - 1 ? (
                <div className="flex items-center gap-2 py-1">
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--amber)' }} />
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
