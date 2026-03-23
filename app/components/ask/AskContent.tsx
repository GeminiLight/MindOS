'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Sparkles, Send, AtSign, Paperclip, StopCircle, RotateCcw, History, X, Maximize2, Minimize2, PanelRight, AppWindow } from 'lucide-react';
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

interface AskContentProps {
  /** Controls visibility — 'open' for modal, 'active' for panel */
  visible: boolean;
  currentFile?: string;
  initialMessage?: string;
  onFirstMessage?: () => void;
  /** 'modal' renders close button + ESC handler; 'panel' renders compact header */
  variant: 'modal' | 'panel';
  /** Required for modal variant — called on close button / ESC / backdrop click */
  onClose?: () => void;
  maximized?: boolean;
  onMaximize?: () => void;
  /** Current Ask display mode */
  askMode?: 'panel' | 'popup';
  /** Switch between panel ↔ popup */
  onModeSwitch?: () => void;
}

export default function AskContent({ visible, currentFile, initialMessage, onFirstMessage, variant, onClose, maximized, onMaximize, askMode, onModeSwitch }: AskContentProps) {
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

  // Focus and init session when becoming visible (edge-triggered for panel, level-triggered for modal)
  const prevVisibleRef = useRef(false);
  useEffect(() => {
    const justOpened = variant === 'panel'
      ? (visible && !prevVisibleRef.current)  // panel: edge detection
      : visible;                               // modal: level detection (reset every open)

    if (justOpened) {
      setTimeout(() => inputRef.current?.focus(), 50);
      void session.initSessions();
      setInput(initialMessage || '');
      firstMessageFired.current = false;
      setAttachedFiles(currentFile ? [currentFile] : []);
      upload.clearAttachments();
      mention.resetMention();
      setShowHistory(false);
    } else if (!visible && variant === 'modal') {
      // Modal: abort streaming on close
      abortRef.current?.abort();
    }
    prevVisibleRef.current = visible;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentFile]);

  // Persist session on message changes
  useEffect(() => {
    if (!visible || !session.activeSessionId) return;
    session.persistSession(session.messages, session.activeSessionId);
    return () => session.clearPersistTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, session.messages, session.activeSessionId]);

  // Esc to close — modal only
  useEffect(() => {
    if (variant !== 'modal' || !visible || !onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mention.mentionQuery !== null) { mention.resetMention(); return; }
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [variant, visible, onClose, mention]);

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
  }, [input, session, isLoading, currentFile, attachedFiles, upload.localAttachments, mention.mentionQuery, t.ask.errorNoResponse, t.ask.stopped, onFirstMessage]);

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

  const isPanel = variant === 'panel';
  const iconSize = isPanel ? 13 : 14;
  const inputIconSize = isPanel ? 14 : 15;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        {!isPanel && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-muted-foreground/20 md:hidden" />
        )}
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles size={isPanel ? 14 : 15} style={{ color: 'var(--amber)' }} />
          <span className={isPanel ? 'font-display text-xs uppercase tracking-wider text-muted-foreground' : 'font-display'}>
            {isPanel ? 'MindOS Agent' : t.ask.title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setShowHistory(v => !v)} aria-pressed={showHistory} className={`p-1 rounded transition-colors ${showHistory ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="Session history">
            <History size={iconSize} />
          </button>
          <button type="button" onClick={handleResetSession} disabled={isLoading} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title="New session">
            <RotateCcw size={iconSize} />
          </button>
          {isPanel && onMaximize && (
            <button type="button" onClick={onMaximize} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={maximized ? 'Restore panel' : 'Maximize panel'}>
              {maximized ? <Minimize2 size={iconSize} /> : <Maximize2 size={iconSize} />}
            </button>
          )}
          {onModeSwitch && (
            <button type="button" onClick={onModeSwitch} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={askMode === 'popup' ? 'Dock to side panel' : 'Open as popup'}>
              {askMode === 'popup' ? <PanelRight size={iconSize} /> : <AppWindow size={iconSize} />}
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
              <X size={isPanel ? iconSize : 15} />
            </button>
          )}
        </div>
      </div>

      {showHistory && (
        <SessionHistory
          sessions={session.sessions}
          activeSessionId={session.activeSessionId}
          onLoad={handleLoadSession}
          onDelete={session.deleteSession}
          onClearAll={session.clearAllSessions}
          labels={{
            title: t.ask.sessionHistory ?? 'Session History',
            clearAll: t.ask.clearAll ?? 'Clear all',
            confirmClear: t.ask.confirmClear ?? 'Confirm clear?',
            noSessions: t.ask.noSessions ?? 'No saved sessions.',
          }}
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
        {attachedFiles.length > 0 && (
          <div className={isPanel ? 'px-3 pt-2 pb-1' : 'px-4 pt-2.5 pb-1'}>
            <div className={`text-muted-foreground/70 mb-1 ${isPanel ? 'text-[10px]' : 'text-xs'}`}>
              {isPanel ? 'Context' : 'Knowledge Base Context'}
            </div>
            <div className={`flex flex-wrap ${isPanel ? 'gap-1' : 'gap-1.5'}`}>
              {attachedFiles.map(f => (
                <FileChip key={f} path={f} onRemove={() => setAttachedFiles(prev => prev.filter(x => x !== f))} />
              ))}
            </div>
          </div>
        )}

        {upload.localAttachments.length > 0 && (
          <div className={isPanel ? 'px-3 pb-1' : 'px-4 pb-1'}>
            <div className={`text-muted-foreground/70 mb-1 ${isPanel ? 'text-[10px]' : 'text-xs'}`}>
              {isPanel ? 'Uploaded' : 'Uploaded Files'}
            </div>
            <div className={`flex flex-wrap ${isPanel ? 'gap-1' : 'gap-1.5'}`}>
              {upload.localAttachments.map((f, idx) => (
                <FileChip key={`${f.name}-${idx}`} path={f.name} variant="upload" onRemove={() => upload.removeAttachment(idx)} />
              ))}
            </div>
          </div>
        )}

        {upload.uploadError && (
          <div className={`${isPanel ? 'px-3' : 'px-4'} pb-1 text-xs text-error`}>{upload.uploadError}</div>
        )}

        {mention.mentionQuery !== null && mention.mentionResults.length > 0 && (
          <MentionPopover
            results={mention.mentionResults}
            selectedIndex={mention.mentionIndex}
            onSelect={selectMention}
          />
        )}

        <form onSubmit={handleSubmit} className={`flex items-center ${isPanel ? 'gap-1.5 px-2 py-2.5' : 'gap-2 px-3 py-3'}`}>
          <button type="button" onClick={() => upload.uploadInputRef.current?.click()} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0" title="Attach local file">
            <Paperclip size={inputIconSize} />
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
            <AtSign size={inputIconSize} />
          </button>

          <input
            ref={inputRef}
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t.ask.placeholder}
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50 min-w-0"
          />

          {isLoading ? (
            <button type="button" onClick={handleStop} className="p-1.5 rounded-md transition-colors shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted" title={t.ask.stopTitle}>
              <StopCircle size={inputIconSize} />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() || mention.mentionQuery !== null} className="p-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0 bg-[var(--amber)] text-[var(--amber-foreground)]">
              <Send size={isPanel ? 13 : 14} />
            </button>
          )}
        </form>
      </div>

      {/* Footer hints */}
      <div className={`${isPanel ? 'px-3 pb-1.5' : 'hidden md:flex px-4 pb-2'} flex items-center gap-${isPanel ? '2' : '3'} text-${isPanel ? '[10px]' : 'xs'} text-muted-foreground/${isPanel ? '40' : '50'} shrink-0`}>
        <span><kbd className="font-mono">↵</kbd> {t.ask.send}</span>
        <span><kbd className="font-mono">@</kbd> {t.ask.attachFile}</span>
        {!isPanel && <span><kbd className="font-mono">ESC</kbd> {t.search.close}</span>}
      </div>
    </>
  );
}
