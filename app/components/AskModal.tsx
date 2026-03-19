'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Sparkles, Send, AtSign, Paperclip, StopCircle, RotateCcw, History } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import type { Message } from '@/lib/types';
import { useAskSession } from '@/hooks/useAskSession';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useMention } from '@/hooks/useMention';
import MessageList from '@/components/ask/MessageList';
import MentionPopover from '@/components/ask/MentionPopover';
import SessionHistory from '@/components/ask/SessionHistory';
import FileChip from '@/components/ask/FileChip';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';

interface AskModalProps {
  open: boolean;
  onClose: () => void;
  currentFile?: string;
  initialMessage?: string;
  onFirstMessage?: () => void;
}

export default function AskModal({ open, onClose, currentFile, initialMessage, onFirstMessage }: AskModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const firstMessageFired = useRef(false);
  const { t } = useLocale();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<'connecting' | 'thinking' | 'streaming'>('connecting');
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const session = useAskSession(currentFile);
  const upload = useFileUpload();
  const mention = useMention();

  // Focus and reset on open
  useEffect(() => {
    let cancelled = false;
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      void (async () => {
        if (cancelled) return;
        await session.initSessions();
      })();
      setInput(initialMessage || '');
      firstMessageFired.current = false;
      setAttachedFiles(currentFile ? [currentFile] : []);
      upload.clearAttachments();
      mention.resetMention();
      setShowHistory(false);
    } else {
      abortRef.current?.abort();
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentFile]);

  // Persist session on message changes
  useEffect(() => {
    if (!open || !session.activeSessionId) return;
    session.persistSession(session.messages, session.activeSessionId);
    return () => session.clearPersistTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session.messages, session.activeSessionId]);

  // Esc to close (or dismiss mention)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mention.mentionQuery !== null) { mention.resetMention(); return; }
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, mention]);

  const handleInputChange = useCallback((val: string) => {
    setInput(val);
    mention.updateMentionFromInput(val);
  }, [mention]);

  const selectMention = useCallback((filePath: string) => {
    const atIdx = input.lastIndexOf('@');
    setInput(input.slice(0, atIdx));
    mention.resetMention();
    if (!attachedFiles.includes(filePath)) {
      setAttachedFiles(prev => [...prev, filePath]);
    }
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [input, attachedFiles, mention]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mention.mentionQuery === null) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mention.navigateMention('down');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mention.navigateMention('up');
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (mention.mentionResults.length > 0) {
        e.preventDefault();
        selectMention(mention.mentionResults[mention.mentionIndex]);
      }
    }
  }, [mention, selectMention]);

  const handleStop = useCallback(() => { abortRef.current?.abort(); }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (mention.mentionQuery !== null) return;
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { role: 'user', content: text };
    const requestMessages = [...session.messages, userMsg];
    session.setMessages([...requestMessages, { role: 'assistant', content: '' }]);
    setInput('');
    // Notify guide card on first user message (ref prevents duplicate fires during re-render)
    if (onFirstMessage && !firstMessageFired.current) {
      firstMessageFired.current = true;
      onFirstMessage();
    }
    setAttachedFiles(currentFile ? [currentFile] : []);
    setIsLoading(true);
    setLoadingPhase('connecting');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: requestMessages,
          currentFile,
          attachedFiles,
          uploadedFiles: upload.localAttachments,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errorMsg = `Request failed (${res.status})`;
        try {
          const errBody = await res.json();
          if (errBody.error) errorMsg = errBody.error;
        } catch {}
        throw new Error(errorMsg);
      }

      if (!res.body) throw new Error('No response body');

      setLoadingPhase('thinking');

      const finalMessage = await consumeUIMessageStream(
        res.body,
        (msg) => {
          setLoadingPhase('streaming');
          session.setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = msg;
            return updated;
          });
        },
        controller.signal,
      );

      if (!finalMessage.content.trim() && (!finalMessage.parts || finalMessage.parts.length === 0)) {
        session.setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: `__error__${t.ask.errorNoResponse}` };
          return updated;
        });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        session.setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            const last = updated[lastIdx];
            const hasContent = last.content.trim() || (last.parts && last.parts.length > 0);
            if (!hasContent) {
              updated[lastIdx] = { role: 'assistant', content: `__error__${t.ask.stopped}` };
            }
          }
          return updated;
        });
      } else {
        const errMsg = err instanceof Error ? err.message : 'Something went wrong';
        session.setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            const last = updated[lastIdx];
            const hasContent = last.content.trim() || (last.parts && last.parts.length > 0);
            if (!hasContent) {
              updated[lastIdx] = { role: 'assistant', content: `__error__${errMsg}` };
              return updated;
            }
          }
          return [...updated, { role: 'assistant', content: `__error__${errMsg}` }];
        });
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [input, session, isLoading, currentFile, attachedFiles, upload.localAttachments, mention.mentionQuery, t.ask.errorNoResponse, t.ask.stopped]);

  const handleResetSession = useCallback(() => {
    if (isLoading) return;
    session.resetSession();
    setInput('');
    setAttachedFiles(currentFile ? [currentFile] : []);
    upload.clearAttachments();
    mention.resetMention();
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [isLoading, currentFile, session, upload, mention]);

  const handleLoadSession = useCallback((id: string) => {
    session.loadSession(id);
    setShowHistory(false);
    setInput('');
    setAttachedFiles(currentFile ? [currentFile] : []);
    upload.clearAttachments();
    mention.resetMention();
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [session, currentFile, upload, mention]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-start justify-center md:pt-[10vh] modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.ask.title}
        className="w-full md:max-w-2xl md:mx-4 bg-card border-t md:border border-border rounded-t-2xl md:rounded-xl shadow-2xl flex flex-col h-[92vh] md:h-auto md:max-h-[75vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          {/* Mobile drag indicator */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-muted-foreground/20 md:hidden" />
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles size={15} style={{ color: 'var(--amber)' }} />
            <span className="font-display">{t.ask.title}</span>
            {currentFile && (
              <span className="text-xs text-muted-foreground font-normal truncate max-w-[200px]">
                — {currentFile.split('/').pop()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setShowHistory(v => !v)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Session history">
              <History size={14} />
            </button>
            <button type="button" onClick={handleResetSession} disabled={isLoading} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title="New session">
              <RotateCcw size={14} />
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <X size={15} />
            </button>
          </div>
        </div>

        {showHistory && (
          <SessionHistory
            sessions={session.sessions}
            activeSessionId={session.activeSessionId}
            onLoad={handleLoadSession}
            onDelete={session.deleteSession}
          />
        )}

        {/* Messages */}
        <MessageList
          messages={session.messages}
          isLoading={isLoading}
          loadingPhase={loadingPhase}
          emptyPrompt={t.ask.emptyPrompt}
          suggestions={t.ask.suggestions}
          onSuggestionClick={setInput}
          labels={{ connecting: t.ask.connecting, thinking: t.ask.thinking, generating: t.ask.generating }}
        />

        {/* Input area */}
        <div className="border-t border-border shrink-0">
          {/* Attached file chips */}
          {attachedFiles.length > 0 && (
            <div className="px-4 pt-2.5 pb-1">
              <div className="text-xs text-muted-foreground/70 mb-1.5">Knowledge Base Context</div>
              <div className="flex flex-wrap gap-1.5">
                {attachedFiles.map(f => (
                  <FileChip key={f} path={f} onRemove={() => setAttachedFiles(prev => prev.filter(x => x !== f))} />
                ))}
              </div>
            </div>
          )}

          {upload.localAttachments.length > 0 && (
            <div className="px-4 pb-1">
              <div className="text-xs text-muted-foreground/70 mb-1.5">Uploaded Files</div>
              <div className="flex flex-wrap gap-1.5">
                {upload.localAttachments.map((f, idx) => (
                  <FileChip key={`${f.name}-${idx}`} path={f.name} variant="upload" onRemove={() => upload.removeAttachment(idx)} />
                ))}
              </div>
            </div>
          )}

          {upload.uploadError && (
            <div className="px-4 pb-1 text-xs text-error">{upload.uploadError}</div>
          )}

          {/* @-mention dropdown */}
          {mention.mentionQuery !== null && mention.mentionResults.length > 0 && (
            <MentionPopover
              results={mention.mentionResults}
              selectedIndex={mention.mentionIndex}
              onSelect={selectMention}
            />
          )}

          <form onSubmit={handleSubmit} className="flex items-center gap-2 px-3 py-3">
            <button type="button" onClick={() => upload.uploadInputRef.current?.click()} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0" title="Attach local file">
              <Paperclip size={15} />
            </button>

            <input
              ref={upload.uploadInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".txt,.md,.markdown,.csv,.json,.yaml,.yml,.xml,.html,.htm,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf"
              onChange={async (e) => {
                const inputEl = e.currentTarget;
                await upload.pickFiles(inputEl.files);
                inputEl.value = '';
              }}
            />

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
              title="@ mention file"
            >
              <AtSign size={15} />
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
              <button type="button" onClick={handleStop} className="p-1.5 rounded-md transition-colors shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted" title={t.ask.stopTitle}>
                <StopCircle size={15} />
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} className="p-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0" style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}>
                <Send size={14} />
              </button>
            )}
          </form>
        </div>

        {/* Footer hint — desktop only */}
        <div className="hidden md:flex px-4 pb-2 items-center gap-3 text-xs text-muted-foreground/50 shrink-0">
          <span><kbd className="font-mono">↵</kbd> {t.ask.send}</span>
          <span><kbd className="font-mono">@</kbd> {t.ask.attachFile}</span>
          <span><kbd className="font-mono">ESC</kbd> {t.search.close}</span>
        </div>
      </div>
    </div>
  );
}
