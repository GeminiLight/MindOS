'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Sparkles, Send, Loader2, Paperclip, FileText, Table, StopCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLocale } from '@/lib/LocaleContext';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AskModalProps {
  open: boolean;
  onClose: () => void;
  currentFile?: string;
}

function FileChip({ path, onRemove }: { path: string; onRemove: () => void }) {
  const name = path.split('/').pop() ?? path;
  const isCsv = name.endsWith('.csv');
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border border-border bg-muted text-foreground max-w-[200px]">
      {isCsv ? <Table size={11} className="text-emerald-400 shrink-0" /> : <FileText size={11} className="text-zinc-400 shrink-0" />}
      <span className="truncate" title={path}>{name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground ml-0.5 shrink-0"
      >
        <X size={10} />
      </button>
    </span>
  );
}

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
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
      {isStreaming && <span className="inline-block w-1.5 h-3.5 bg-amber-400 ml-0.5 align-middle animate-pulse rounded-sm" />}
    </div>
  );
}

export default function AskModal({ open, onClose, currentFile }: AskModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { t } = useLocale();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);

  // @-mention state
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Load file list once
  useEffect(() => {
    fetch('/api/files').then(r => r.json()).then(setAllFiles).catch(() => {});
  }, []);

  // Focus and reset on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setMessages([]);
      setInput('');
      setAttachedFiles([]);
      setMentionQuery(null);
    } else {
      // Abort any in-flight request when modal closes
      abortRef.current?.abort();
    }
  }, [open]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Esc to close (or dismiss mention)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mentionQuery !== null) { setMentionQuery(null); return; }
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, mentionQuery]);

  // Parse @-mention from input
  const handleInputChange = useCallback((val: string) => {
    setInput(val);
    const atIdx = val.lastIndexOf('@');
    if (atIdx === -1) { setMentionQuery(null); return; }
    const before = val[atIdx - 1];
    if (atIdx > 0 && before !== ' ') { setMentionQuery(null); return; }
    const query = val.slice(atIdx + 1).toLowerCase();
    setMentionQuery(query);
    setMentionResults(allFiles.filter(f => f.toLowerCase().includes(query)).slice(0, 8));
    setMentionIndex(0);
  }, [allFiles]);

  const selectMention = useCallback((filePath: string) => {
    const atIdx = input.lastIndexOf('@');
    setInput(input.slice(0, atIdx));
    setMentionQuery(null);
    if (!attachedFiles.includes(filePath)) {
      setAttachedFiles(prev => [...prev, filePath]);
    }
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [input, attachedFiles]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionQuery === null) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex(i => Math.min(i + 1, mentionResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (mentionResults.length > 0) {
        e.preventDefault();
        selectMention(mentionResults[mentionIndex]);
      }
    }
  }, [mentionQuery, mentionResults, mentionIndex, selectMention]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (mentionQuery !== null) return;
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setAttachedFiles([]);
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, currentFile, attachedFiles }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantContent += decoder.decode(value, { stream: true });
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
          return updated;
        });
      }

      // Empty stream usually means an API key or provider error was swallowed
      if (!assistantContent.trim()) {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: 'Error: No response from AI. Please check your API key and provider settings.',
          };
          return updated;
        });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Stopped by user — leave partial content as-is
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
        }]);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [input, messages, isLoading, currentFile, attachedFiles, mentionQuery]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.ask.title}
        className="w-full max-w-2xl mx-4 bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[75vh]"
      >

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles size={15} style={{ color: 'var(--amber)' }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{t.ask.title}</span>
            {currentFile && (
              <span className="text-xs text-muted-foreground font-normal truncate max-w-[200px]">
                — {currentFile.split('/').pop()}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
          {messages.length === 0 && (
            <div className="mt-6 space-y-3">
              <p className="text-center text-sm text-muted-foreground/60">
                {t.ask.emptyPrompt}
              </p>
              <div className="flex flex-col gap-2 px-2">
                {t.ask.suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setInput(s)}
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
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: 'var(--amber-dim)' }}>
                  <Sparkles size={12} style={{ color: 'var(--amber)' }} />
                </div>
              )}
              {m.role === 'user' ? (
                <div
                  className="max-w-[85%] px-3 py-2 rounded-xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ background: 'var(--amber)', color: '#131210' }}
                >
                  {m.content}
                </div>
              ) : (
                <div className="max-w-[85%] px-3 py-2 rounded-xl rounded-bl-sm bg-muted text-foreground text-sm">
                  {m.content
                    ? <AssistantMessage
                        content={m.content}
                        isStreaming={isLoading && i === messages.length - 1}
                      />
                    : isLoading && i === messages.length - 1
                      ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--amber)' }} />
                      : null
                  }
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border shrink-0">
          {/* Attached file chips */}
          {attachedFiles.length > 0 && (
            <div className="px-4 pt-2.5 pb-1 flex flex-wrap gap-1.5">
              {attachedFiles.map(f => (
                <FileChip
                  key={f}
                  path={f}
                  onRemove={() => setAttachedFiles(prev => prev.filter(x => x !== f))}
                />
              ))}
            </div>
          )}

          {/* @-mention dropdown */}
          {mentionQuery !== null && mentionResults.length > 0 && (
            <div className="mx-4 mb-1 border border-border rounded-lg bg-card shadow-lg overflow-hidden">
              {mentionResults.map((f, idx) => {
                const name = f.split('/').pop() ?? f;
                const isCsv = name.endsWith('.csv');
                return (
                  <button
                    key={f}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); selectMention(f); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${idx === mentionIndex ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    {isCsv
                      ? <Table size={13} className="text-emerald-400 shrink-0" />
                      : <FileText size={13} className="text-zinc-400 shrink-0" />
                    }
                    <span className="truncate flex-1">{name}</span>
                    <span className="text-[10px] text-muted-foreground/50 truncate max-w-[140px] shrink-0">{f.split('/').slice(0, -1).join('/')}</span>
                  </button>
                );
              })}
              <div className="px-3 py-1.5 border-t border-border flex gap-3 text-[10px] text-muted-foreground/50">
                <span>↑↓ navigate</span><span>↵ select</span><span>ESC dismiss</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex items-center gap-2 px-3 py-3">
            {/* Paperclip button */}
            <button
              type="button"
              onClick={() => {
                const el = inputRef.current;
                if (!el) return;
                const pos = el.selectionStart ?? input.length;
                const newVal = input.slice(0, pos) + '@' + input.slice(pos);
                handleInputChange(newVal);
                setTimeout(() => { el.focus(); el.setSelectionRange(pos + 1, pos + 1); }, 0);
              }}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              title="Attach file (@)"
            >
              <Paperclip size={15} />
            </button>

            <input
              ref={inputRef}
              value={input}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={t.ask.placeholder}
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
            />

            {isLoading ? (
              <button
                type="button"
                onClick={handleStop}
                className="p-1.5 rounded-md transition-colors shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                title={t.ask.stopTitle}
              >
                <StopCircle size={15} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="p-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
                style={{ background: 'var(--amber)', color: '#131210' }}
              >
                <Send size={14} />
              </button>
            )}
          </form>
        </div>

        {/* Footer hint */}
        <div className="px-4 pb-2 flex items-center gap-3 text-xs text-muted-foreground/50 shrink-0">
          <span><kbd className="font-mono">↵</kbd> {t.ask.send}</span>
          <span><kbd className="font-mono">@</kbd> {t.ask.attachFile}</span>
          <span><kbd className="font-mono">ESC</kbd> {t.search.close}</span>
        </div>
      </div>
    </div>
  );
}
