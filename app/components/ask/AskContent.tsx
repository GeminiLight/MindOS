'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Send, StopCircle, X, Plus, FileText, ImageIcon } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import type { AskMode } from '@/lib/types';
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
import AskHeader from '@/components/ask/AskHeader';
import FileChip from '@/components/ask/FileChip';
import AgentSelectorCapsule from '@/components/ask/AgentSelectorCapsule';
import ProviderModelCapsule, { getPersistedProvider } from '@/components/ask/ProviderModelCapsule';
import type { ProviderId } from '@/lib/agent/providers';
import { useAskChat } from '@/hooks/useAskChat';
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
  const { t } = useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [input, setInput] = useState('');
  const inputValueRef = useRef('');
  inputValueRef.current = input;
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

  const imageUploadRef = useRef(imageUpload);
  imageUploadRef.current = imageUpload;
  const mentionRef = useRef(mention);
  mentionRef.current = mention;
  const slashRef = useRef(slash);
  slashRef.current = slash;

  const resetInputState = useCallback(() => {
    setInput('');
    setSelectedSkill(null);
    setSelectedAcpAgent(null);
    setAttachedFiles(currentFile ? [currentFile] : []);
  }, [currentFile]);

  const chatRefs = useRef({ inputValueRef, mentionRef, slashRef, imageUploadRef, sessionRef, uploadRef, selectedSkillRef, selectedAcpAgentRef, attachedFilesRef });
  const chat = useAskChat({
    currentFile,
    chatMode,
    providerOverride,
    onFirstMessage,
    refs: chatRefs.current,
    errorLabels: { noResponse: t.ask.errorNoResponse, stopped: t.ask.stopped },
    resetInputState,
  });
  const { isLoading, loadingPhase, reconnectAttempt, reconnectMaxRef } = chat;
  const handleSubmit = chat.submit;
  const handleStop = chat.stop;

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
      chat.firstMessageFired.current = false;
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
      chat.abortRef.current?.abort();
    }
    prevVisibleRef.current = visible;
    prevFileRef.current = currentFile;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentFile]);

  // Persist session on message changes (skip if last msg is empty assistant placeholder during loading)
  useEffect(() => {
    if (!visible || !session.activeSessionId) return;
    const msgs = session.messages;
    if (chat.isLoading && msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      if (last.role === 'assistant' && !last.content.trim() && (!last.parts || last.parts.length === 0)) return;
    }
    session.persistSession(msgs, session.activeSessionId);
    return () => session.clearPersistTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, session.messages, session.activeSessionId, chat.isLoading]);

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
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !chat.isLoadingRef.current && (inputValueRef.current.trim() || imageUploadRef.current.images.length > 0)) {
        e.preventDefault();
        (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
      }
    },
    [],
  );

  const handleResetSession = useCallback(() => {
    if (chat.isLoadingRef.current) return;
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

  const toggleHistory = useCallback(() => setShowHistory(v => !v), []);
  const inputIconSize = 15;
  const messageLabels = useMemo(() => ({
    connecting: t.ask.connecting,
    thinking: t.ask.thinking,
    generating: t.ask.generating,
    reconnecting: reconnectAttempt > 0 ? t.ask.reconnecting(reconnectAttempt, reconnectMaxRef.current) : undefined,
  }), [t, reconnectAttempt]);

  return (
    <>
      <AskHeader
        isPanel={isPanel}
        showHistory={showHistory}
        onToggleHistory={toggleHistory}
        onReset={handleResetSession}
        isLoading={isLoading}
        maximized={maximized}
        onMaximize={onMaximize}
        askMode={askMode}
        onModeSwitch={onModeSwitch}
        onClose={onClose}
      />

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
        emptyHint={t.ask.emptyHint}
        suggestions={t.ask.suggestions}
        onSuggestionClick={setInput}
        labels={messageLabels}
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

      {/* Composer card — unified input area with rounded container */}
      <div className="shrink-0 px-3 pb-2 pt-1">
        <div
          className={cn(
            'rounded-xl border border-border/60 bg-card shadow-sm transition-shadow',
            isDragOver && 'ring-2 ring-[var(--amber)] bg-[var(--amber-dim)]',
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Unified context chip flow */}
          {(attachedFiles.length > 0 || upload.localAttachments.length > 0 || imageUpload.images.length > 0 || selectedSkill || selectedAcpAgent || upload.uploadError || imageUpload.imageError) && (
            <div className={cn('px-3 pt-2.5 pb-1', isPanel ? 'max-h-24 overflow-y-auto' : 'max-h-28 overflow-y-auto')}>
              <div className="flex flex-wrap gap-1.5">
                {attachedFiles.map(f => (
                  <FileChip key={f} path={f} variant="kb" onRemove={() => setAttachedFiles(prev => prev.filter(x => x !== f))} />
                ))}
                {upload.localAttachments.map((f, idx) => (
                  <FileChip key={`up-${f.name}-${idx}`} path={f.name} variant="upload" onRemove={() => upload.removeAttachment(idx)} />
                ))}
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
                {selectedSkill && (
                  <FileChip
                    path={selectedSkill.name}
                    variant="skill"
                    onRemove={() => { setSelectedSkill(null); inputRef.current?.focus(); }}
                  />
                )}
              </div>
              {(upload.uploadError || imageUpload.imageError) && (
                <div className="mt-1 text-xs text-error">{upload.uploadError || imageUpload.imageError}</div>
              )}
            </div>
          )}

          {/* Input form */}
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="flex items-end gap-1 px-1.5 py-1.5"
          >
            {/* + attach button with mini menu */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setShowAttachMenu(v => !v)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
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
                    <FileText size={12} className="shrink-0 text-muted-foreground" />
                    {t.ask.attachFileLabel}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
                    onClick={() => { setShowAttachMenu(false); imageInputRef.current?.click(); }}
                  >
                    <ImageIcon size={12} className="shrink-0 text-muted-foreground" />
                    {t.ask.attachImageLabel}
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
              <button type="button" onClick={handleStop} className="p-1.5 rounded-lg transition-colors shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/60" title={loadingPhase === 'reconnecting' ? t.ask.cancelReconnect : t.ask.stopTitle}>
                {loadingPhase === 'reconnecting' ? <X size={inputIconSize} /> : <StopCircle size={inputIconSize} />}
              </button>
            ) : (
              <button type="submit" disabled={!input.trim() && imageUpload.images.length === 0} className="p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0 bg-[var(--amber)] text-[var(--amber-foreground)]">
                <Send size={14} />
              </button>
            )}
          </form>

          {/* Mode + Agent + Provider selector row — inside card bottom */}
          <div className="flex items-center gap-1.5 px-3 pb-2 pt-0.5 border-t border-border/30">
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
            {/* Inline footer hints — right-aligned */}
            <div className="flex-1" />
            <div className={cn(
              'flex items-center gap-x-2 text-[10px] text-muted-foreground/40 shrink-0',
            )}>
              <span suppressHydrationWarning>
                <kbd className="font-mono">@</kbd> {t.ask.attachFile}
              </span>
              <span suppressHydrationWarning>
                <kbd className="font-mono">/</kbd> {t.ask.skillsHint}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
