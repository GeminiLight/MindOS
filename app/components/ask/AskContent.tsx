'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { Sparkles, Send, StopCircle, SquarePen, History, X, Maximize2, Minimize2, PanelRight, AppWindow, Plus } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import type { Message, ImagePart, AskMode } from '@/lib/types';
import ModeCapsule, { getPersistedMode } from '@/components/ask/ModeCapsule';
import { useAskSession } from '@/hooks/useAskSession';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useMention } from '@/hooks/useMention';
import { useSlashCommand } from '@/hooks/useSlashCommand';
import type { SlashItem } from '@/hooks/useSlashCommand';
import MessageList from '@/components/ask/MessageList';
import MentionPopover from '@/components/ask/MentionPopover';
import SlashCommandPopover from '@/components/ask/SlashCommandPopover';
import SessionHistory from '@/components/ask/SessionHistory';
import SessionTabBar from '@/components/ask/SessionTabBar';
import FileChip from '@/components/ask/FileChip';
import AgentSelectorCapsule from '@/components/ask/AgentSelectorCapsule';
import ProviderModelCapsule, { getPersistedProvider } from '@/components/ask/ProviderModelCapsule';
import type { ProviderId } from '@/lib/agent/providers';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';
import { isRetryableError, retryDelay, sleep } from '@/lib/agent/reconnect';
import { cn } from '@/lib/utils';
import { useAcpDetection } from '@/hooks/useAcpDetection';
import type { AcpAgentSelection } from '@/hooks/useAskModal';

/** Textarea auto-grows with content up to this many visible lines, then scrolls */
const TEXTAREA_MAX_VISIBLE_LINES = 8;

/** Per-element cached metrics to avoid getComputedStyle on every keystroke */
const _metricsCache = new WeakMap<HTMLTextAreaElement, { maxH: number }>();

/** Auto-size textarea height to fit content, capped at maxVisibleLines */
function syncTextareaToContent(el: HTMLTextAreaElement, maxVisibleLines: number): void {
  let cached = _metricsCache.get(el);
  if (!cached) {
    const style = getComputedStyle(el);
    const parsedLh = parseFloat(style.lineHeight);
    const parsedFs = parseFloat(style.fontSize);
    const fontSize = Number.isFinite(parsedFs) ? parsedFs : 14;
    const lineHeight = Number.isFinite(parsedLh) ? parsedLh : fontSize * 1.375;
    const pad =
      (Number.isFinite(parseFloat(style.paddingTop)) ? parseFloat(style.paddingTop) : 0) +
      (Number.isFinite(parseFloat(style.paddingBottom)) ? parseFloat(style.paddingBottom) : 0);
    const maxH = lineHeight * maxVisibleLines + pad;
    if (!Number.isFinite(maxH) || maxH <= 0) return;
    cached = { maxH };
    _metricsCache.set(el, cached);
  }
  const { maxH } = cached;
  el.style.height = 'auto';
  const contentH = el.scrollHeight;
  const next = Math.min(contentH, maxH);
  el.style.height = `${next}px`;
  el.style.overflowY = contentH > maxH ? 'auto' : 'hidden';
}

interface AskContentProps {
  /** Controls visibility — 'open' for modal, 'active' for panel */
  visible: boolean;
  currentFile?: string;
  initialMessage?: string;
  /** ACP agent pre-selected via "Use" button from A2A tab */
  initialAcpAgent?: AcpAgentSelection | null;
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

export default function AskContent({ visible, currentFile, initialMessage, initialAcpAgent, onFirstMessage, variant, onClose, maximized, onMaximize, askMode, onModeSwitch }: AskContentProps) {
  const isPanel = variant === 'panel';

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const firstMessageFired = useRef(false);
  const { t } = useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [input, setInput] = useState('');
  const inputValueRef = useRef('');
  inputValueRef.current = input;
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<'connecting' | 'thinking' | 'streaming' | 'reconnecting'>('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectMaxRef = useRef(3);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const attachedFilesRef = useRef(attachedFiles);
  attachedFilesRef.current = attachedFiles;
  const [showHistory, setShowHistory] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const [selectedSkill, setSelectedSkill] = useState<SlashItem | null>(null);
  const selectedSkillRef = useRef(selectedSkill);
  selectedSkillRef.current = selectedSkill;
  const [selectedAcpAgent, setSelectedAcpAgent] = useState<AcpAgentSelection | null>(null);
  const selectedAcpAgentRef = useRef(selectedAcpAgent);
  selectedAcpAgentRef.current = selectedAcpAgent;
  const [chatMode, setChatMode] = useState<AskMode>('agent');
  const [providerOverride, setProviderOverride] = useState<ProviderId | null>(null);

  useEffect(() => {
    setChatMode(getPersistedMode());
    setProviderOverride(getPersistedProvider());
  }, []);

  const session = useAskSession(currentFile);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const upload = useFileUpload();
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const imageUpload = useImageUpload();
  const mention = useMention();
  const slash = useSlashCommand();
  const acpDetection = useAcpDetection();

  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent).detail?.files;
      if (Array.isArray(files) && files.length > 0) {
        uploadRef.current.injectFiles(files);
      }
    };
    window.addEventListener('mindos:inject-ask-files', handler);
    return () => window.removeEventListener('mindos:inject-ask-files', handler);
  }, []);

  // Focus and init session when becoming visible (edge-triggered for panel, level-triggered for modal)
  const prevVisibleRef = useRef(false);
  const prevFileRef = useRef(currentFile);
  useEffect(() => {
    const justOpened = variant === 'panel'
      ? (visible && !prevVisibleRef.current)  // panel: edge detection
      : visible;                               // modal: level detection (reset every open)

    // Detect file change while panel is already open
    const fileChanged = visible && prevVisibleRef.current && currentFile !== prevFileRef.current;

    if (justOpened) {
      setTimeout(() => inputRef.current?.focus(), 50);
      void session.initSessions();
      setInput(initialMessage || '');
      firstMessageFired.current = false;
      setAttachedFiles(currentFile ? [currentFile] : []);
    upload.clearAttachments();
    imageUpload.clearImages();
    mention.resetMention();
    slash.resetSlash();
    setSelectedSkill(null);
    setSelectedAcpAgent(initialAcpAgent ?? null);
    setShowHistory(false);
    } else if (fileChanged) {
      // Update attached file context to match new file (don't reset session/messages)
      setAttachedFiles(currentFile ? [currentFile] : []);
    } else if (!visible && variant === 'modal') {
      // Modal: abort streaming on close
      abortRef.current?.abort();
    }
    prevVisibleRef.current = visible;
    prevFileRef.current = currentFile;
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

  // Esc to close modal or exit focus mode
  useEffect(() => {
    if (!visible) return;
    const isModal = variant === 'modal';
    const isFocused = variant === 'panel' && maximized;
    if (!isModal && !isFocused) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mentionRef.current.mentionQuery !== null) { mentionRef.current.resetMention(); return; }
        if (slashRef.current.slashQuery !== null) { slashRef.current.resetSlash(); return; }
        if (isFocused && onMaximize) { onMaximize(); return; }
        if (isModal && onClose) { onClose(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [variant, visible, onClose, maximized, onMaximize]);

  // Close attach menu on any outside click
  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = () => setShowAttachMenu(false);
    // Delay to avoid closing immediately from the click that opened it
    const id = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => { clearTimeout(id); document.removeEventListener('click', handler); };
  }, [showAttachMenu]);

  const formRef = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    if (!visible) return;
    const el = inputRef.current;
    if (!el || !(el instanceof HTMLTextAreaElement)) return;
    syncTextareaToContent(el, TEXTAREA_MAX_VISIBLE_LINES);
  }, [input, isLoading, visible]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handler = () => _metricsCache.delete(el);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const mentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mentionRef = useRef(mention);
  mentionRef.current = mention;
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const handleInputChange = useCallback((val: string, cursorPos?: number) => {
    setInput(val);
    const pos = cursorPos ?? val.length;
    if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
    if (slashTimerRef.current) clearTimeout(slashTimerRef.current);
    mentionTimerRef.current = setTimeout(() => mentionRef.current.updateMentionFromInput(val, pos), 80);
    slashTimerRef.current = setTimeout(() => slashRef.current.updateSlashFromInput(val, pos), 80);
  }, []);

  useEffect(() => {
    return () => {
      if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
      if (slashTimerRef.current) clearTimeout(slashTimerRef.current);
    };
  }, []);

  const selectMention = useCallback((filePath: string) => {
    const el = inputRef.current;
    const val = inputValueRef.current;
    const cursorPos = el?.selectionStart ?? val.length;
    const before = val.slice(0, cursorPos);
    const atIdx = before.lastIndexOf('@');
    const newVal = val.slice(0, atIdx) + val.slice(cursorPos);
    setInput(newVal);
    mentionRef.current.resetMention();
    if (!attachedFilesRef.current.includes(filePath)) {
      setAttachedFiles(prev => [...prev, filePath]);
    }
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(atIdx, atIdx);
    }, 0);
  }, []);

  const selectSlashCommand = useCallback((item: SlashItem) => {
    const el = inputRef.current;
    const val = inputValueRef.current;
    const cursorPos = el?.selectionStart ?? val.length;
    const before = val.slice(0, cursorPos);
    const slashIdx = before.lastIndexOf('/');
    const newVal = val.slice(0, slashIdx) + val.slice(cursorPos);
    setInput(newVal);
    setSelectedSkill(item);
    slashRef.current.resetSlash();
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(slashIdx, slashIdx);
    }, 0);
  }, []);

  const imageUploadRef = useRef(imageUpload);
  imageUploadRef.current = imageUpload;
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const selectMentionRef = useRef(selectMention);
  selectMentionRef.current = selectMention;
  const selectSlashRef = useRef(selectSlashCommand);
  selectSlashRef.current = selectSlashCommand;

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const m = mentionRef.current;
      const s = slashRef.current;
      if (m.mentionQuery !== null) {
        if (e.key === 'Escape') {
          e.preventDefault();
          m.resetMention();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          m.navigateMention('down');
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          m.navigateMention('up');
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          if (e.key === 'Enter' && (e.shiftKey || e.nativeEvent.isComposing)) return;
          if (m.mentionResults.length > 0) {
            e.preventDefault();
            selectMentionRef.current(m.mentionResults[m.mentionIndex]);
          }
        }
        return;
      }
      if (s.slashQuery !== null) {
        if (e.key === 'Escape') {
          e.preventDefault();
          s.resetSlash();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          s.navigateSlash('down');
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          s.navigateSlash('up');
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          if (e.key === 'Enter' && (e.shiftKey || e.nativeEvent.isComposing)) return;
          if (s.slashResults.length > 0) {
            e.preventDefault();
            selectSlashRef.current(s.slashResults[s.slashIndex]);
          }
        }
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isLoadingRef.current && (inputValueRef.current.trim() || imageUploadRef.current.images.length > 0)) {
        e.preventDefault();
        (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
      }
    },
    [],
  );

  const handleStop = useCallback(() => { abortRef.current?.abort(); }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const m = mentionRef.current;
    const s = slashRef.current;
    const img = imageUploadRef.current;
    const sess = sessionRef.current;
    const upl = uploadRef.current;
    if (m.mentionQuery !== null || s.slashQuery !== null) return;
    const text = inputValueRef.current.trim();
    if ((!text && img.images.length === 0) || isLoadingRef.current) return;

    const skill = selectedSkillRef.current;
    const acpAgent = selectedAcpAgentRef.current;
    const pendingImages = img.images.length > 0 ? [...img.images] : undefined;
    const userMsg: Message = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
      ...(skill && { skillName: skill.name }),
      ...(pendingImages && { images: pendingImages }),
    };
    img.clearImages();
    const requestMessages = [...sess.messages, userMsg];
    sess.setMessages([...requestMessages, { role: 'assistant', content: '', timestamp: Date.now() }]);
    setInput('');
    setSelectedSkill(null);
    setSelectedAcpAgent(null);
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
      attachedFiles: attachedFilesRef.current,
      uploadedFiles: upl.localAttachments.map(f => ({
        name: f.name,
        content: f.content.length > 20_000
          ? f.content.slice(0, 20_000) + '\n\n[...truncated to first ~20000 chars]'
          : f.content,
      })),
      selectedAcpAgent: acpAgent,
      mode: chatMode,
      providerOverride: providerOverride ?? undefined,
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
          sessionRef.current.setMessages(prev => {
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
          sessionRef.current.setMessages(prev => {
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
            sessionRef.current.setMessages(prev => {
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
        sessionRef.current.setMessages(prev => {
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
        sessionRef.current.setMessages(prev => {
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
  }, [currentFile, chatMode, providerOverride, t.ask.errorNoResponse, t.ask.stopped, onFirstMessage]);

  const handleResetSession = useCallback(() => {
    if (isLoadingRef.current) return;
    sessionRef.current.resetSession();
    setInput('');
    setAttachedFiles(currentFile ? [currentFile] : []);
    uploadRef.current.clearAttachments();
    imageUploadRef.current.clearImages();
    mentionRef.current.resetMention();
    slashRef.current.resetSlash();
    setSelectedSkill(null);
    setSelectedAcpAgent(null);
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [currentFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Accept mindos file paths and image drops
    if (e.dataTransfer.types.includes('text/mindos-path') || e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const filePath = e.dataTransfer.getData('text/mindos-path');
    if (filePath && !attachedFilesRef.current.includes(filePath)) {
      setAttachedFiles(prev => [...prev, filePath]);
      return;
    }
    await imageUploadRef.current.handleDrop(e);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const hasImageItem = Array.from(items).some(
      item => item.kind === 'file' && item.type.startsWith('image/')
    );
    if (hasImageItem) {
      e.preventDefault();
      void imageUploadRef.current.handlePaste(e);
    }
  }, []);

  const handleLoadSession = useCallback((id: string) => {
    sessionRef.current.loadSession(id);
    setShowHistory(false);
    setInput('');
    setAttachedFiles(currentFile ? [currentFile] : []);
    uploadRef.current.clearAttachments();
    imageUploadRef.current.clearImages();
    mentionRef.current.resetMention();
    slashRef.current.resetSlash();
    setSelectedSkill(null);
    setSelectedAcpAgent(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [currentFile]);

  const iconSize = isPanel ? 13 : 14;
  const inputIconSize = 15;

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
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={(e) => { e.stopPropagation(); setShowHistory(v => !v); }} aria-pressed={showHistory} className={`p-2 rounded transition-colors ${showHistory ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title={t.hints.sessionHistory}>
            <History size={iconSize} />
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); handleResetSession(); }} disabled={isLoading} className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title={t.hints.newSession}>
            <SquarePen size={iconSize} />
          </button>
          {isPanel && onMaximize && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onMaximize(); }} className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={maximized ? t.hints.restorePanel : t.hints.maximizePanel}>
              {maximized ? <Minimize2 size={iconSize} /> : <Maximize2 size={iconSize} />}
            </button>
          )}
          {onModeSwitch && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onModeSwitch(); }} className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={askMode === 'popup' ? t.hints.dockToSide : t.hints.openAsPopup}>
              {askMode === 'popup' ? <PanelRight size={iconSize} /> : <AppWindow size={iconSize} />}
            </button>
          )}
          {onClose && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={t.hints.closePanel} aria-label="Close">
              <X size={isPanel ? iconSize : 15} />
            </button>
          )}
        </div>
      </div>

      {/* Session tabs — panel variant only */}
      {isPanel && session.sessions.length > 0 && (
        <SessionTabBar
          sessions={session.sessions}
          activeSessionId={session.activeSessionId}
          onLoad={handleLoadSession}
          onDelete={session.deleteSession}
          onNew={handleResetSession}
        />
      )}

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
        <div className="shrink-0 px-3 pb-1">
          <MentionPopover
            results={mention.mentionResults}
            selectedIndex={mention.mentionIndex}
            query={mention.mentionQuery ?? undefined}
            onSelect={selectMention}
          />
        </div>
      )}

      {slash.slashQuery !== null && slash.slashResults.length > 0 && (
        <div className="shrink-0 px-3 pb-1">
          <SlashCommandPopover
            results={slash.slashResults}
            selectedIndex={slash.slashIndex}
            query={slash.slashQuery ?? undefined}
            onSelect={selectSlashCommand}
          />
        </div>
      )}

      {/* Input area — auto-height composer, no manual resize */}
      <div
        className={cn(
          'shrink-0 border-t border-border',
          isDragOver && 'ring-2 ring-[var(--amber)] ring-inset bg-[var(--amber-dim)]',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >

        {/* Unified context chip flow */}
        {(attachedFiles.length > 0 || upload.localAttachments.length > 0 || imageUpload.images.length > 0 || selectedSkill || selectedAcpAgent || upload.uploadError || imageUpload.imageError) && (
          <div className={cn('shrink-0 px-3 pt-2 pb-1', isPanel ? 'max-h-24 overflow-y-auto' : 'max-h-28 overflow-y-auto')}>
            <div className="flex flex-wrap gap-1.5">
              {/* KB files (@ attached) */}
              {attachedFiles.map(f => (
                <FileChip key={f} path={f} variant="kb" onRemove={() => setAttachedFiles(prev => prev.filter(x => x !== f))} />
              ))}
              {/* Uploaded files */}
              {upload.localAttachments.map((f, idx) => (
                <FileChip key={`up-${f.name}-${idx}`} path={f.name} variant="upload" onRemove={() => upload.removeAttachment(idx)} />
              ))}
              {/* Images (name chip + hover preview) */}
              {imageUpload.images.map((img, idx) => (
                <FileChip
                  key={`img-${idx}`}
                  path={`Image ${idx + 1}`}
                  variant="image"
                  imageData={img.data}
                  imageMime={img.mimeType}
                  onRemove={() => imageUpload.removeImage(idx)}
                />
              ))}
              {/* Skill */}
              {selectedSkill && (
                <FileChip
                  path={selectedSkill.name}
                  variant="skill"
                  onRemove={() => { setSelectedSkill(null); inputRef.current?.focus(); }}
                />
              )}
              {/* Agent — selection now shown via AgentSelectorCapsule, not as a chip */}
            </div>
            {/* Errors (merged) */}
            {(upload.uploadError || imageUpload.imageError) && (
              <div className="mt-1 text-xs text-error">{upload.uploadError || imageUpload.imageError}</div>
            )}
          </div>
        )}

        {/* Mode + Agent + Provider selector row */}
        <div className="flex items-center gap-1.5 px-3 pt-1 pb-0.5">
          <ModeCapsule mode={chatMode} onChange={setChatMode} disabled={isLoading} />
          {mounted && acpDetection.installedAgents.length > 0 && (
            <AgentSelectorCapsule
              selectedAgent={selectedAcpAgent}
              onSelect={setSelectedAcpAgent}
              installedAgents={acpDetection.installedAgents}
              loading={acpDetection.loading}
            />
          )}
          {mounted && (
            <ProviderModelCapsule
              value={providerOverride}
              onChange={setProviderOverride}
              disabled={isLoading}
            />
          )}
        </div>

        {/* Input form */}
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="flex items-end gap-1.5 px-3 py-2"
        >
          {/* + attach button with mini menu */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowAttachMenu(v => !v)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={t.hints.attachFile}
            >
              <Plus size={inputIconSize} />
            </button>
            {showAttachMenu && (
              <div className="absolute bottom-full left-0 mb-1 py-1 rounded-lg border border-border bg-card shadow-lg z-50 min-w-[140px]">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
                  onClick={() => { setShowAttachMenu(false); upload.uploadInputRef.current?.click(); }}
                >
                  File
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
                  onClick={() => { setShowAttachMenu(false); imageInputRef.current?.click(); }}
                >
                  Image
                </button>
              </div>
            )}
          </div>

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
          <input
            ref={imageInputRef}
            type="file"
            className="hidden"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={async (e) => {
              const inputEl = e.currentTarget;
              await imageUpload.handleFileSelect(inputEl.files);
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
            onPaste={handlePaste}
            placeholder={t.ask.placeholder}
            rows={1}
            className="min-w-0 flex-1 resize-none overflow-y-hidden bg-transparent py-1.5 text-sm leading-snug text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-0"
          />

          {isLoading ? (
            <button type="button" onClick={handleStop} className="p-1.5 rounded-md transition-colors shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted" title={loadingPhase === 'reconnecting' ? t.ask.cancelReconnect : t.ask.stopTitle}>
              {loadingPhase === 'reconnecting' ? <X size={inputIconSize} /> : <StopCircle size={inputIconSize} />}
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() && imageUpload.images.length === 0} className="p-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0 bg-[var(--amber)] text-[var(--amber-foreground)]">
              <Send size={14} />
            </button>
          )}
        </form>
      </div>

      {/* Footer hints — panel: compact 3 items; modal: full set */}
      <div
        className={cn(
          'flex shrink-0 items-center flex-wrap px-3 pb-1.5',
          isPanel
            ? 'gap-x-3 gap-y-1 text-[10px] text-muted-foreground/40'
            : 'gap-x-3 gap-y-1 text-[10px] md:text-xs text-muted-foreground/50',
        )}
      >
        <span suppressHydrationWarning>
          <kbd className="font-mono">↵</kbd> {t.ask.send}
        </span>
        {!isPanel && (
          <span suppressHydrationWarning>
            <kbd className="font-mono">⇧</kbd>
            <kbd className="font-mono ml-0.5">↵</kbd> {t.ask.newlineHint}
          </span>
        )}
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
          <span className="text-[10px] text-[var(--amber)]/80">
            {t.ask.draftingHint}
          </span>
        )}
      </div>
    </>
  );
}
