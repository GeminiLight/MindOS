'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { Sparkles, Send, Paperclip, StopCircle, SquarePen, History, X, Zap, Maximize2, Minimize2, PanelRight, AppWindow } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import type { Message } from '@/lib/types';
import { useAskSession } from '@/hooks/useAskSession';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useMention } from '@/hooks/useMention';
import { useSlashCommand } from '@/hooks/useSlashCommand';
import type { SlashItem } from '@/hooks/useSlashCommand';
import MessageList from '@/components/ask/MessageList';
import MentionPopover from '@/components/ask/MentionPopover';
import SlashCommandPopover from '@/components/ask/SlashCommandPopover';
import SessionHistory from '@/components/ask/SessionHistory';
import FileChip from '@/components/ask/FileChip';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';
import { isRetryableError, retryDelay, sleep } from '@/lib/agent/reconnect';
import { cn } from '@/lib/utils';
import { useComposerVerticalResize } from '@/hooks/useComposerVerticalResize';

const PANEL_COMPOSER_STORAGE = 'mindos-agent-panel-composer-height';
const PANEL_COMPOSER_DEFAULT = 104;
const PANEL_COMPOSER_MIN = 84;
const PANEL_COMPOSER_MAX_ABS = 440;
const PANEL_COMPOSER_MAX_VIEW = 0.48;
const PANEL_COMPOSER_KEY_STEP = 24;
/** 输入框随内容增高，超过此行数后在框内滚动（与常见 IM 一致） */
const PANEL_TEXTAREA_MAX_VISIBLE_LINES = 8;

function syncTextareaToContent(el: HTMLTextAreaElement, maxVisibleLines: number, availableHeight?: number): void {
  const style = getComputedStyle(el);
  const parsedLh = parseFloat(style.lineHeight);
  const parsedFs = parseFloat(style.fontSize);
  const fontSize = Number.isFinite(parsedFs) ? parsedFs : 14;
  const lineHeight = Number.isFinite(parsedLh) ? parsedLh : fontSize * 1.375;
  const pad =
    (Number.isFinite(parseFloat(style.paddingTop)) ? parseFloat(style.paddingTop) : 0) +
    (Number.isFinite(parseFloat(style.paddingBottom)) ? parseFloat(style.paddingBottom) : 0);
  let maxH = lineHeight * maxVisibleLines + pad;
  if (availableHeight && Number.isFinite(availableHeight) && availableHeight > 0) {
    maxH = Math.min(maxH, availableHeight);
  }
  if (!Number.isFinite(maxH) || maxH <= 0) return;
  el.style.height = '0px';
  const next = Math.min(el.scrollHeight, maxH);
  el.style.height = `${Number.isFinite(next) ? next : maxH}px`;
}

function panelComposerMaxForViewport(): number {
  if (typeof window === 'undefined') return PANEL_COMPOSER_MAX_ABS;
  return Math.min(PANEL_COMPOSER_MAX_ABS, Math.floor(window.innerHeight * PANEL_COMPOSER_MAX_VIEW));
}

function readStoredPanelComposerHeight(): number {
  if (typeof window === 'undefined') return PANEL_COMPOSER_DEFAULT;
  try {
    const s = localStorage.getItem(PANEL_COMPOSER_STORAGE);
    if (s) {
      const n = parseInt(s, 10);
      if (Number.isFinite(n) && n >= PANEL_COMPOSER_MIN && n <= PANEL_COMPOSER_MAX_ABS) return n;
    }
  } catch {
    /* ignore */
  }
  return PANEL_COMPOSER_DEFAULT;
}

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
  const isPanel = variant === 'panel';

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const firstMessageFired = useRef(false);
  const { t } = useLocale();

  const [panelComposerHeight, setPanelComposerHeight] = useState(PANEL_COMPOSER_DEFAULT);
  const panelComposerHRef = useRef(panelComposerHeight);
  panelComposerHRef.current = panelComposerHeight;

  useEffect(() => {
    const stored = readStoredPanelComposerHeight();
    if (stored !== PANEL_COMPOSER_DEFAULT) {
      setPanelComposerHeight(stored);
      panelComposerHRef.current = stored;
    }
  }, []);

  const getPanelComposerHeight = useCallback(() => panelComposerHRef.current, []);
  const persistPanelComposerHeight = useCallback((h: number) => {
    try {
      localStorage.setItem(PANEL_COMPOSER_STORAGE, String(h));
    } catch {
      /* ignore */
    }
  }, []);

  const onPanelComposerResizePointerDown = useComposerVerticalResize({
    minHeight: PANEL_COMPOSER_MIN,
    maxHeightAbs: PANEL_COMPOSER_MAX_ABS,
    maxHeightViewportRatio: PANEL_COMPOSER_MAX_VIEW,
    getHeight: getPanelComposerHeight,
    setHeight: setPanelComposerHeight,
    persist: persistPanelComposerHeight,
  });

  const [panelComposerViewportMax, setPanelComposerViewportMax] = useState(PANEL_COMPOSER_MAX_ABS);

  useEffect(() => {
    setPanelComposerViewportMax(panelComposerMaxForViewport());
  }, []);

  const applyPanelComposerClampAndPersist = useCallback(() => {
    const maxH = panelComposerMaxForViewport();
    setPanelComposerViewportMax(maxH);
    const h = panelComposerHRef.current;
    if (h > maxH) {
      setPanelComposerHeight(maxH);
      panelComposerHRef.current = maxH;
      persistPanelComposerHeight(maxH);
    }
  }, [persistPanelComposerHeight]);

  const handlePanelComposerSeparatorKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const maxH = panelComposerMaxForViewport();
      setPanelComposerViewportMax(maxH);
      const h = panelComposerHRef.current;
      let next = h;
      if (e.key === 'ArrowUp') next = h + PANEL_COMPOSER_KEY_STEP;
      else if (e.key === 'ArrowDown') next = h - PANEL_COMPOSER_KEY_STEP;
      else if (e.key === 'Home') next = PANEL_COMPOSER_MIN;
      else if (e.key === 'End') next = maxH;
      const clamped = Math.round(Math.max(PANEL_COMPOSER_MIN, Math.min(maxH, next)));
      setPanelComposerHeight(clamped);
      panelComposerHRef.current = clamped;
      persistPanelComposerHeight(clamped);
    },
    [persistPanelComposerHeight],
  );

  const resetPanelComposerHeight = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setPanelComposerHeight(PANEL_COMPOSER_DEFAULT);
      panelComposerHRef.current = PANEL_COMPOSER_DEFAULT;
      persistPanelComposerHeight(PANEL_COMPOSER_DEFAULT);
    },
    [persistPanelComposerHeight],
  );

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<'connecting' | 'thinking' | 'streaming' | 'reconnecting'>('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectMaxRef = useRef(3);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const [selectedSkill, setSelectedSkill] = useState<SlashItem | null>(null);

  const session = useAskSession(currentFile);
  const upload = useFileUpload();
  const mention = useMention();
  const slash = useSlashCommand();

  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent).detail?.files;
      if (Array.isArray(files) && files.length > 0) {
        upload.injectFiles(files);
      }
    };
    window.addEventListener('mindos:inject-ask-files', handler);
    return () => window.removeEventListener('mindos:inject-ask-files', handler);
  }, [upload]);

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
      slash.resetSlash();
      setSelectedSkill(null);
      setShowHistory(false);
    } else if (!visible && variant === 'modal') {
      // Modal: abort streaming on close
      abortRef.current?.abort();
    }
    prevVisibleRef.current = visible;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentFile]);

  // Persist session on message changes (skip if last msg is empty assistant placeholder during loading)
  useEffect(() => {
    if (!visible || !session.activeSessionId) return;
    const msgs = session.messages;
    if (isLoading && msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      if (last.role === 'assistant' && !last.content.trim() && (!last.parts || last.parts.length === 0)) return;
    }
    session.persistSession(msgs, session.activeSessionId);
    return () => session.clearPersistTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, session.messages, session.activeSessionId, isLoading]);

  // Esc to close — modal only
  useEffect(() => {
    if (variant !== 'modal' || !visible || !onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mention.mentionQuery !== null) { mention.resetMention(); return; }
        if (slash.slashQuery !== null) { slash.resetSlash(); return; }
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [variant, visible, onClose, mention, slash]);

  useEffect(() => {
    if (!isPanel) return;
    applyPanelComposerClampAndPersist();
    window.addEventListener('resize', applyPanelComposerClampAndPersist);
    return () => window.removeEventListener('resize', applyPanelComposerClampAndPersist);
  }, [isPanel, applyPanelComposerClampAndPersist]);

  const formRef = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    if (!visible) return;
    const el = inputRef.current;
    if (!el || !(el instanceof HTMLTextAreaElement)) return;
    const form = formRef.current;
    const maxLines = isPanel ? PANEL_TEXTAREA_MAX_VISIBLE_LINES : 6;
    const availableH = isPanel && form ? form.clientHeight - 40 : undefined;
    syncTextareaToContent(el, maxLines, availableH);
  }, [input, isPanel, isLoading, visible, panelComposerHeight]);

  const mentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleInputChange = useCallback((val: string, cursorPos?: number) => {
    setInput(val);
    const pos = cursorPos ?? val.length;
    if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
    if (slashTimerRef.current) clearTimeout(slashTimerRef.current);
    mentionTimerRef.current = setTimeout(() => mention.updateMentionFromInput(val, pos), 80);
    slashTimerRef.current = setTimeout(() => slash.updateSlashFromInput(val, pos), 80);
  }, [mention, slash]);

  useEffect(() => {
    return () => {
      if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
      if (slashTimerRef.current) clearTimeout(slashTimerRef.current);
    };
  }, []);

  const selectMention = useCallback((filePath: string) => {
    const el = inputRef.current;
    const cursorPos = el?.selectionStart ?? input.length;
    const before = input.slice(0, cursorPos);
    const atIdx = before.lastIndexOf('@');
    const newVal = input.slice(0, atIdx) + input.slice(cursorPos);
    setInput(newVal);
    mention.resetMention();
    if (!attachedFiles.includes(filePath)) {
      setAttachedFiles(prev => [...prev, filePath]);
    }
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(atIdx, atIdx);
    }, 0);
  }, [input, attachedFiles, mention]);

  const selectSlashCommand = useCallback((item: SlashItem) => {
    const el = inputRef.current;
    const cursorPos = el?.selectionStart ?? input.length;
    const before = input.slice(0, cursorPos);
    const slashIdx = before.lastIndexOf('/');
    const newVal = input.slice(0, slashIdx) + input.slice(cursorPos);
    setInput(newVal);
    setSelectedSkill(item);
    slash.resetSlash();
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(slashIdx, slashIdx);
    }, 0);
  }, [input, slash]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mention.mentionQuery !== null) {
        if (e.key === 'Escape') {
          e.preventDefault();
          mention.resetMention();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          mention.navigateMention('down');
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          mention.navigateMention('up');
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          if (e.key === 'Enter' && (e.shiftKey || e.nativeEvent.isComposing)) return;
          if (mention.mentionResults.length > 0) {
            e.preventDefault();
            selectMention(mention.mentionResults[mention.mentionIndex]);
          }
        }
        return;
      }
      if (slash.slashQuery !== null) {
        if (e.key === 'Escape') {
          e.preventDefault();
          slash.resetSlash();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          slash.navigateSlash('down');
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          slash.navigateSlash('up');
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          if (e.key === 'Enter' && (e.shiftKey || e.nativeEvent.isComposing)) return;
          if (slash.slashResults.length > 0) {
            e.preventDefault();
            selectSlashCommand(slash.slashResults[slash.slashIndex]);
          }
        }
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isLoading && input.trim()) {
        e.preventDefault();
        (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
      }
    },
    [mention, selectMention, slash, selectSlashCommand, isLoading, input],
  );

  const handleStop = useCallback(() => { abortRef.current?.abort(); }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (mention.mentionQuery !== null || slash.slashQuery !== null) return;
    const text = input.trim();
    if (!text || isLoading) return;

    const content = selectedSkill
      ? `Use the skill ${selectedSkill.name}: ${text}`
      : text;
    const userMsg: Message = {
      role: 'user',
      content,
      timestamp: Date.now(),
      ...(selectedSkill && { skillName: selectedSkill.name }),
    };
    const requestMessages = [...session.messages, userMsg];
    session.setMessages([...requestMessages, { role: 'assistant', content: '', timestamp: Date.now() }]);
    setInput('');
    setSelectedSkill(null);
    if (onFirstMessage && !firstMessageFired.current) {
      firstMessageFired.current = true;
      onFirstMessage();
    }
    setAttachedFiles(currentFile ? [currentFile] : []);
    setIsLoading(true);
    setLoadingPhase('connecting');
    setReconnectAttempt(0);

    const controller = new AbortController();
    abortRef.current = controller;

    let maxRetries = 3;
    try {
      const stored = localStorage.getItem('mindos-reconnect-retries');
      if (stored !== null) { const n = parseInt(stored, 10); if (Number.isFinite(n)) maxRetries = Math.max(0, Math.min(10, n)); }
    } catch { /* localStorage unavailable */ }
    reconnectMaxRef.current = maxRetries;

    const requestBody = JSON.stringify({
      messages: requestMessages,
      currentFile,
      attachedFiles,
      uploadedFiles: upload.localAttachments.map(f => ({
        name: f.name,
        content: f.content.length > 20_000
          ? f.content.slice(0, 20_000) + '\n\n[...truncated to first ~20000 chars]'
          : f.content,
      })),
    });

    const doFetch = async (): Promise<{ finalMessage: Message }> => {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal: controller.signal,
      });

      if (!res.ok) {
        let errorMsg = `Request failed (${res.status})`;
        try {
          const errBody = await res.json() as { error?: { message?: string } | string; message?: string };
          if (typeof errBody?.error === 'string' && errBody.error.trim()) {
            errorMsg = errBody.error;
          } else if (typeof errBody?.error === 'object' && typeof errBody.error?.message === 'string' && errBody.error.message.trim()) {
            errorMsg = errBody.error.message;
          } else if (typeof errBody?.message === 'string' && errBody.message.trim()) {
            errorMsg = errBody.message;
          }
        } catch (err) { console.warn("[AskContent] error body parse failed:", err); }
        const err = new Error(errorMsg);
        (err as Error & { httpStatus?: number }).httpStatus = res.status;
        throw err;
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
      return { finalMessage };
    };

    try {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (controller.signal.aborted) break;

        if (attempt > 0) {
          setReconnectAttempt(attempt);
          setLoadingPhase('reconnecting');
          session.setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: '', timestamp: Date.now() };
            return updated;
          });
          await sleep(retryDelay(attempt - 1), controller.signal);
          setLoadingPhase('connecting');
        }

        try {
          const { finalMessage } = await doFetch();
          if (!finalMessage.content.trim() && (!finalMessage.parts || finalMessage.parts.length === 0)) {
            session.setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: `__error__${t.ask.errorNoResponse}` };
              return updated;
            });
          }
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const httpStatus = (err as Error & { httpStatus?: number }).httpStatus;
          if (!isRetryableError(err, httpStatus) || attempt >= maxRetries) break;
        }
      }

      if (lastError) throw lastError;
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
      setReconnectAttempt(0);
      abortRef.current = null;
    }
  }, [input, session, isLoading, currentFile, attachedFiles, upload.localAttachments, mention.mentionQuery, slash.slashQuery, selectedSkill, t.ask.errorNoResponse, t.ask.stopped, onFirstMessage]);

  const handleResetSession = useCallback(() => {
    if (isLoading) return;
    session.resetSession();
    setInput('');
    setAttachedFiles(currentFile ? [currentFile] : []);
    upload.clearAttachments();
    mention.resetMention();
    slash.resetSlash();
    setSelectedSkill(null);
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [isLoading, currentFile, session, upload, mention, slash]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('text/mindos-path')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const filePath = e.dataTransfer.getData('text/mindos-path');
    if (filePath && !attachedFiles.includes(filePath)) {
      setAttachedFiles(prev => [...prev, filePath]);
    }
  }, [attachedFiles]);

  const handleLoadSession = useCallback((id: string) => {
    session.loadSession(id);
    setShowHistory(false);
    setInput('');
    setAttachedFiles(currentFile ? [currentFile] : []);
    upload.clearAttachments();
    mention.resetMention();
    slash.resetSlash();
    setSelectedSkill(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [session, currentFile, upload, mention, slash]);

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
          <Sparkles size={isPanel ? 14 : 15} className="text-[var(--amber)]" />
          <span className={isPanel ? 'font-display text-xs uppercase tracking-wider text-muted-foreground' : 'font-display'}>
            {isPanel ? 'MindOS Agent' : t.ask.title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setShowHistory(v => !v)} aria-pressed={showHistory} className={`p-1.5 rounded transition-colors ${showHistory ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title={t.hints.sessionHistory}>
            <History size={iconSize} />
          </button>
          <button type="button" onClick={handleResetSession} disabled={isLoading} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title={t.hints.newSession}>
            <SquarePen size={iconSize} />
          </button>
          {isPanel && onMaximize && (
            <button type="button" onClick={onMaximize} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={maximized ? t.hints.restorePanel : t.hints.maximizePanel}>
              {maximized ? <Minimize2 size={iconSize} /> : <Maximize2 size={iconSize} />}
            </button>
          )}
          {onModeSwitch && (
            <button type="button" onClick={onModeSwitch} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={askMode === 'popup' ? t.hints.dockToSide : t.hints.openAsPopup}>
              {askMode === 'popup' ? <PanelRight size={iconSize} /> : <AppWindow size={iconSize} />}
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={t.hints.closePanel} aria-label="Close">
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
        labels={{
          connecting: t.ask.connecting,
          thinking: t.ask.thinking,
          generating: t.ask.generating,
          reconnecting: reconnectAttempt > 0 ? t.ask.reconnecting(reconnectAttempt, reconnectMaxRef.current) : undefined,
        }}
      />

      {/* Popovers — flex children so they stay within overflow boundary (absolute positioning would be clipped by RightAskPanel's overflow-hidden) */}
      {mention.mentionQuery !== null && mention.mentionResults.length > 0 && (
        <div className="shrink-0 px-2 pb-1">
          <MentionPopover
            results={mention.mentionResults}
            selectedIndex={mention.mentionIndex}
            query={mention.mentionQuery ?? undefined}
            onSelect={selectMention}
          />
        </div>
      )}

      {slash.slashQuery !== null && slash.slashResults.length > 0 && (
        <div className="shrink-0 px-2 pb-1">
          <SlashCommandPopover
            results={slash.slashResults}
            selectedIndex={slash.slashIndex}
            query={slash.slashQuery ?? undefined}
            onSelect={selectSlashCommand}
          />
        </div>
      )}

      {/* Input area — panel: fixed-height shell + top drag handle (persisted); modal: simple block */}
      <div
        className={cn(
          'shrink-0 border-t border-border',
          isPanel && 'flex flex-col overflow-hidden bg-card',
          isDragOver && 'ring-2 ring-[var(--amber)] ring-inset bg-[var(--amber-dim)]',
        )}
        style={isPanel ? { height: panelComposerHeight } : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isPanel ? (
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-label={`${t.ask.panelComposerResize}. ${t.ask.panelComposerResetHint}. ${t.ask.panelComposerKeyboard}`}
            aria-valuemin={PANEL_COMPOSER_MIN}
            aria-valuemax={panelComposerViewportMax}
            aria-valuenow={panelComposerHeight}
            title={`${t.ask.panelComposerResize} · ${t.ask.panelComposerResetHint} · ${t.ask.panelComposerKeyboard}`}
            onPointerDown={onPanelComposerResizePointerDown}
            onKeyDown={handlePanelComposerSeparatorKeyDown}
            onDoubleClick={resetPanelComposerHeight}
            className="group flex h-3 shrink-0 cursor-ns-resize items-center justify-center border-b border-border/50 bg-muted/[0.06] transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <span
              className="pointer-events-none h-1 w-10 rounded-full bg-border transition-colors group-hover:bg-[var(--amber)]/45 group-active:bg-[var(--amber)]/60"
              aria-hidden
            />
          </div>
        ) : null}

        <div className={cn(isPanel && 'flex min-h-0 flex-1 flex-col overflow-y-auto')}>
          {attachedFiles.length > 0 && (
            <div className={cn('shrink-0', isPanel ? 'px-3 pt-2 pb-1' : 'px-4 pt-2.5 pb-1')}>
              <div className={`text-muted-foreground/70 mb-1 ${isPanel ? 'text-[10px]' : 'text-xs'}`}>
                {t.ask.attachFile}
              </div>
              <div className={`flex flex-wrap ${isPanel ? 'gap-1' : 'gap-1.5'}`}>
                {attachedFiles.map(f => (
                  <FileChip key={f} path={f} onRemove={() => setAttachedFiles(prev => prev.filter(x => x !== f))} />
                ))}
              </div>
            </div>
          )}

          {upload.localAttachments.length > 0 && (
            <div className={cn('shrink-0', isPanel ? 'px-3 pb-1' : 'px-4 pb-1')}>
              <div className={`text-muted-foreground/70 mb-1 ${isPanel ? 'text-[10px]' : 'text-xs'}`}>
                {t.ask.uploadedFiles}
              </div>
              <div className={`flex flex-wrap ${isPanel ? 'gap-1' : 'gap-1.5'}`}>
                {upload.localAttachments.map((f, idx) => (
                  <FileChip key={`${f.name}-${idx}`} path={f.name} variant="upload" onRemove={() => upload.removeAttachment(idx)} />
                ))}
              </div>
            </div>
          )}

          {selectedSkill && (
            <div className={cn('shrink-0', isPanel ? 'px-3 pt-1.5 pb-1' : 'px-4 pt-2 pb-1')}>
              <span className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md text-xs bg-[var(--amber)]/10 border border-[var(--amber)]/25 text-foreground">
                <Zap size={11} className="text-[var(--amber)] shrink-0" />
                <span className="font-medium">{selectedSkill.name}</span>
                <button
                  type="button"
                  onClick={() => { setSelectedSkill(null); inputRef.current?.focus(); }}
                  className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  aria-label={`Remove skill ${selectedSkill.name}`}
                >
                  <X size={10} />
                </button>
              </span>
            </div>
          )}

          {upload.uploadError && (
            <div className={cn('shrink-0 pb-1 text-xs text-error', isPanel ? 'px-3' : 'px-4')}>{upload.uploadError}</div>
          )}

          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className={cn(
              'flex',
              isPanel ? 'min-h-0 flex-1 items-end gap-1.5 px-2 py-2' : 'items-end gap-2 px-3 py-3',
            )}
          >
          <button type="button" onClick={() => upload.uploadInputRef.current?.click()} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0" title={t.hints.attachFile}>
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

          <textarea
            ref={(el) => {
              inputRef.current = el;
            }}
            value={input}
            onChange={e => handleInputChange(e.target.value, e.target.selectionStart ?? undefined)}
            onKeyDown={handleInputKeyDown}
            placeholder={t.ask.placeholder}
            rows={1}
            className={cn(
              'min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-sm leading-snug text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-0',
              isPanel ? 'py-2' : 'py-1.5',
            )}
          />

          {isLoading ? (
            <button type="button" onClick={handleStop} className="p-1.5 rounded-md transition-colors shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted" title={loadingPhase === 'reconnecting' ? t.ask.cancelReconnect : t.ask.stopTitle}>
              {loadingPhase === 'reconnecting' ? <X size={inputIconSize} /> : <StopCircle size={inputIconSize} />}
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() || mention.mentionQuery !== null || slash.slashQuery !== null} title={!input.trim() ? t.hints.typeMessage : mention.mentionQuery !== null || slash.slashQuery !== null ? t.hints.mentionInProgress : undefined} className="p-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0 bg-[var(--amber)] text-[var(--amber-foreground)]">
              <Send size={isPanel ? 13 : 14} />
            </button>
          )}
          </form>
        </div>
      </div>

      {/* Footer hints — use full class strings so Tailwind JIT includes utilities */}
      <div
        className={cn(
          'flex shrink-0 items-center',
          isPanel
            ? 'flex-wrap gap-x-2 gap-y-1 px-3 pb-1.5 text-[10px] text-muted-foreground/40'
            : 'flex-wrap gap-x-3 gap-y-1 px-4 pb-2 text-[10px] md:text-xs text-muted-foreground/50',
        )}
      >
        <span suppressHydrationWarning>
          <kbd className="font-mono">↵</kbd> {t.ask.send}
        </span>
        <span suppressHydrationWarning>
          <kbd className="font-mono">⇧</kbd>
          <kbd className="font-mono ml-0.5">↵</kbd> {t.ask.newlineHint}
        </span>
        <span suppressHydrationWarning>
          <kbd className="font-mono">@</kbd> {t.ask.attachFile}
        </span>
        <span suppressHydrationWarning>
          <kbd className="font-mono">/</kbd> {t.ask.skillsHint}
        </span>
        {!isPanel && (
          <span suppressHydrationWarning>
            <kbd className="font-mono">ESC</kbd> {t.search.close}
          </span>
        )}
        {isLoading && input.trim() && (
          <span className={isPanel ? 'text-[10px] text-[var(--amber)]/80' : 'text-xs text-[var(--amber)]/80'}>
            {t.ask.draftingHint}
          </span>
        )}
      </div>
    </>
  );
}
