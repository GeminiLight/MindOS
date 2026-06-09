'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Send, StopCircle, X, Plus, FileText, ImageIcon } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import type { AgentRuntimeDescriptor, AgentRuntimeIdentity, AskMode, Message } from '@/lib/types';
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
import SessionHistoryPanel from '@/components/ask/SessionHistoryPanel';
import AskHeader from '@/components/ask/AskHeader';
import FileChip from '@/components/ask/FileChip';
import ProviderModelCapsule, { getPersistedProviderModel } from '@/components/ask/ProviderModelCapsule';
import type { ProviderId } from '@/lib/agent/providers';
import { useAskChat } from '@/hooks/useAskChat';
import {
  filterSessionsByRuntimeLane,
  getMatchingRuntimeSessionBinding,
  getMessageAgentRuntime,
  getSessionAgentRuntime,
  isSessionInRuntimeLane,
  toAgentRuntime,
} from '@/lib/ask-agent';
import { cn } from '@/lib/utils';
import { useAcpDetection } from '@/hooks/useAcpDetection';
import { useNativeRuntimeDetection } from '@/hooks/useNativeRuntimeDetection';
import type { AcpAgentSelection } from '@/hooks/useAskModal';

/** Textarea auto-grows with content up to this many visible lines, then scrolls */
const TEXTAREA_MAX_VISIBLE_LINES = 8;

/** Per-element cached metrics to avoid getComputedStyle on every keystroke */
const _metricsCache = new WeakMap<HTMLTextAreaElement, { maxH: number }>();

function runtimeStatusLabel(status: AgentRuntimeDescriptor['status']): string {
  if (status === 'signed-out') return 'signed out';
  if (status === 'error') return 'unavailable';
  if (status === 'missing') return 'not installed';
  return 'available';
}

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
  /** Runtime pre-selected by an opener; supersedes initialAcpAgent when present. */
  initialAgentRuntime?: AgentRuntimeIdentity | null;
  onFirstMessage?: () => void;
  /** 'modal' renders close button + ESC handler; 'panel' renders compact header; 'home' renders embedded on homepage */
  variant: 'modal' | 'panel' | 'home';
  /** Required for modal variant — called on close button / ESC / backdrop click */
  onClose?: () => void;
  maximized?: boolean;
  onMaximize?: () => void;
  /** Current Ask display mode */
  askMode?: 'panel' | 'popup';
  /** Switch between panel ↔ popup */
  onModeSwitch?: () => void;
  /** Navigate from fullscreen to right-side panel mode */
  onDockToPanel?: () => void;
}

export default function AskContent({ visible, currentFile, initialMessage, initialAcpAgent, initialAgentRuntime, onFirstMessage, variant, onClose, maximized, onMaximize, askMode, onModeSwitch, onDockToPanel }: AskContentProps) {
  const isPanel = variant === 'panel';
  const isHome = variant === 'home';

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [input, setInput] = useState('');
  const inputValueRef = useRef(input);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const attachedFilesRef = useRef(attachedFiles);
  const [showHistory, setShowHistory] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const [attachMenuPos, setAttachMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [dropError, setDropError] = useState('');

  const [selectedSkill, setSelectedSkill] = useState<SlashItem | null>(null);
  const selectedSkillRef = useRef(selectedSkill);
  const [selectedAgentRuntime, setSelectedAgentRuntime] = useState<AgentRuntimeIdentity | null>(null);
  const selectedAgentRuntimeRef = useRef(selectedAgentRuntime);
  const pendingOpenAgentRef = useRef<AgentRuntimeIdentity | null>(null);
  const [chatMode, setChatMode] = useState<AskMode>('agent');
  const [providerOverride, setProviderOverride] = useState<ProviderId | `p_${string}` | null>(null);
  const [modelOverride, setModelOverride] = useState<string | null>(null);

  const updateSelectedAgentRuntime = useCallback((runtime: AgentRuntimeIdentity | null) => {
    selectedAgentRuntimeRef.current = runtime;
    setSelectedAgentRuntime(runtime);
  }, []);

  useEffect(() => {
    setChatMode(getPersistedMode());
    const persisted = getPersistedProviderModel();
    setProviderOverride(persisted.provider);
    setModelOverride(persisted.model);
  }, []);

  const session = useAskSession(currentFile);
  const sessionRef = useRef(session);
  const uploadLabels = useMemo(() => ({ unsupportedType: t.fileImport?.unsupported }), [t]);
  const {
    localAttachments,
    uploadError,
    uploadInputRef,
    pickFiles,
    removeAttachment,
    clearAttachments,
    injectFiles,
  } = useFileUpload(uploadLabels);
  const uploadRuntime = useMemo(() => ({
    localAttachments,
    pickFiles,
    clearAttachments,
    injectFiles,
  }), [clearAttachments, injectFiles, localAttachments, pickFiles]);
  const uploadRef = useRef(uploadRuntime);
  const {
    images,
    imageError,
    handlePaste: handleImagePaste,
    handleDrop: handleImageDrop,
    handleFileSelect,
    removeImage,
    clearImages,
  } = useImageUpload();
  const imageUploadRuntime = useMemo(() => ({
    images,
    clearImages,
    handleDrop: handleImageDrop,
    handlePaste: handleImagePaste,
  }), [clearImages, handleImageDrop, handleImagePaste, images]);
  const mention = useMention();
  const slash = useSlashCommand();
  const acpDetection = useAcpDetection();
  const nativeDetection = useNativeRuntimeDetection();
  const nativeRuntimes = useMemo<Array<AgentRuntimeIdentity & Partial<Pick<AgentRuntimeDescriptor, 'status' | 'availability' | 'installCmd' | 'packageName'>>>>(() => {
    return nativeDetection.runtimes
      .filter((runtime) => runtime.kind === 'codex' || runtime.kind === 'claude')
      .map((runtime) => ({
        id: runtime.id,
        name: runtime.name,
        kind: runtime.kind,
        status: runtime.status,
        availability: runtime.availability,
        ...(runtime.installCmd ? { installCmd: runtime.installCmd } : {}),
        ...(runtime.packageName ? { packageName: runtime.packageName } : {}),
      }));
  }, [nativeDetection.runtimes]);
  const isMindosRuntime = !selectedAgentRuntime || selectedAgentRuntime.kind === 'mindos';
  const selectedRuntimeUnavailable = useMemo(() => {
    if (!selectedAgentRuntime || selectedAgentRuntime.kind === 'mindos') return null;
    const nativeKind = selectedAgentRuntime.kind;
    if (nativeKind !== 'codex' && nativeKind !== 'claude') return null;
    const descriptor = nativeDetection.runtimes.find((runtime) => (
      runtime.kind === nativeKind && runtime.id === selectedAgentRuntime.id
    ));
    if (!descriptor) {
      if (nativeDetection.loadingByKind[nativeKind]) return null;
      return {
        status: 'missing' as const,
        reason: 'Local runtime was not detected.',
      };
    }
    if (descriptor.status === 'available') return null;
    return {
      status: descriptor.status,
      reason: descriptor.availability?.reason,
    };
  }, [nativeDetection.loadingByKind, nativeDetection.runtimes, selectedAgentRuntime]);
  const activeRuntimeSessionBinding = useMemo(
    () => getMatchingRuntimeSessionBinding(session.activeSession, selectedAgentRuntime),
    [
      selectedAgentRuntime,
      session.activeSession?.externalAgentBinding,
      session.activeSession?.runtimeSessionBinding,
    ],
  );
  const runtimeScopedSessions = useMemo(() => {
    return filterSessionsByRuntimeLane(session.sessions, selectedAgentRuntime);
  }, [selectedAgentRuntime, session.sessions]);
  const runtimeScopedActiveSessionId = useMemo(
    () => runtimeScopedSessions.some((item) => item.id === session.activeSessionId)
      ? session.activeSessionId
      : null,
    [runtimeScopedSessions, session.activeSessionId],
  );

  const imageUploadRef = useRef(imageUploadRuntime);
  const mentionRef = useRef(mention);
  const slashRef = useRef(slash);
  useLayoutEffect(() => {
    inputValueRef.current = input;
    attachedFilesRef.current = attachedFiles;
    selectedSkillRef.current = selectedSkill;
    selectedAgentRuntimeRef.current = selectedAgentRuntime;
    sessionRef.current = session;
    uploadRef.current = uploadRuntime;
    imageUploadRef.current = imageUploadRuntime;
    mentionRef.current = mention;
    slashRef.current = slash;
  }, [attachedFiles, imageUploadRuntime, input, mention, selectedAgentRuntime, selectedSkill, session, slash, uploadRuntime]);

  const resetInputState = useCallback(() => {
    setInput('');
    setSelectedSkill(null);
    setAttachedFiles(currentFile ? [currentFile] : []);
    uploadRef.current.clearAttachments();
  }, [currentFile]);


  const handleRestoreInput = useCallback((userMessage: Message) => {
    setInput(userMessage.content);
    if (userMessage.images && userMessage.images.length > 0) {
      imageUploadRef.current.clearImages();
    }
    if (userMessage.attachedFiles) setAttachedFiles(userMessage.attachedFiles);
    if (userMessage.skillName) {
      slashRef.current.resetSlash();
    }
    updateSelectedAgentRuntime(getMessageAgentRuntime(userMessage));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [updateSelectedAgentRuntime]);

  const chatRefs = useMemo(() => ({
    inputValueRef,
    mentionRef,
    slashRef,
    imageUploadRef,
    sessionRef,
    uploadRef,
    selectedSkillRef,
    selectedAgentRuntimeRef,
    attachedFilesRef,
  }), []);
  const chat = useAskChat({
    currentFile,
    chatMode,
    providerOverride,
    modelOverride,
    onFirstMessage,
    refs: chatRefs,
    errorLabels: { noResponse: t.ask.errorNoResponse, stopped: t.ask.stopped },
    resetInputState,
    onRestoreInput: handleRestoreInput,
  });
  const { isLoading, loadingPhase, reconnectAttempt, reconnectMax } = chat;
  const handleSubmit = chat.submit;
  const handleStop = chat.stop;

  const clearTransientComposerState = useCallback(() => {
    setInput('');
    setAttachedFiles(currentFile ? [currentFile] : []);
    uploadRef.current.clearAttachments();
    imageUploadRef.current.clearImages();
    mentionRef.current.resetMention();
    slashRef.current.resetSlash();
    setSelectedSkill(null);
    pendingOpenAgentRef.current = null;
    setShowHistory(false);
    chat.firstMessageFired.current = false;
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [chat.firstMessageFired, currentFile]);

  const bindActiveSessionToRuntime = useCallback((agent: AgentRuntimeIdentity | null) => {
    if (!agent || agent.kind === 'mindos') {
      sessionRef.current.setSessionDefaultAcpAgent(null);
      return;
    }
    if (agent.kind === 'acp') {
      sessionRef.current.setSessionDefaultAcpAgent({ id: agent.id, name: agent.name });
      return;
    }
    sessionRef.current.setSessionAgentRuntimeBinding(agent);
  }, []);

  const handleSelectAgentRuntime = useCallback((agent: AgentRuntimeIdentity | null) => {
    if (chat.isLoadingRef.current) return;
    updateSelectedAgentRuntime(agent);

    const currentSession = sessionRef.current.activeSession;
    const currentIsEmpty = !currentSession || currentSession.messages.length === 0;
    const currentAlreadyInLane = currentSession ? isSessionInRuntimeLane(currentSession, agent) : false;

    if (currentAlreadyInLane) {
      if (currentIsEmpty) bindActiveSessionToRuntime(agent);
      return;
    }

    const target = sessionRef.current.sessions.find((item) => isSessionInRuntimeLane(item, agent));
    if (target) {
      sessionRef.current.loadSession(target.id);
      clearTransientComposerState();
      return;
    }

    if (currentIsEmpty) {
      bindActiveSessionToRuntime(agent);
      return;
    }

    sessionRef.current.resetSession(agent);
    clearTransientComposerState();
  }, [bindActiveSessionToRuntime, chat.isLoadingRef, clearTransientComposerState, updateSelectedAgentRuntime]);

  const hasLoadingAttachments = localAttachments.some((f) => f.status === 'loading');
  const runtimeUnavailableMessage = selectedAgentRuntime && selectedRuntimeUnavailable
    ? `${selectedAgentRuntime.name} is ${runtimeStatusLabel(selectedRuntimeUnavailable.status)}.${selectedRuntimeUnavailable.reason ? ` ${selectedRuntimeUnavailable.reason}` : ''}`
    : '';
  const composerStatusMessage = uploadError || imageError || dropError || runtimeUnavailableMessage;

  const handleSubmitWithRuntimeGuard = useCallback((event: React.FormEvent) => {
    if (selectedRuntimeUnavailable) {
      event.preventDefault();
      return;
    }
    void handleSubmit(event);
  }, [handleSubmit, selectedRuntimeUnavailable]);

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

  // Position the attach menu popover above the button (using Portal to avoid clipping)
  useEffect(() => {
    if (!showAttachMenu || !attachButtonRef.current) {
      setAttachMenuPos(null);
      return;
    }
    const rect = attachButtonRef.current.getBoundingClientRect();
    setAttachMenuPos({
      top: rect.top - 8,  // 8px above button
      left: rect.left,
    });
  }, [showAttachMenu]);

  // Close attach menu when clicking outside the button + menu portal.
  useEffect(() => {
    if (!showAttachMenu) return;
    const handlePointerDownOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (attachButtonRef.current?.contains(target)) return;
      if (attachMenuRef.current?.contains(target)) return;
      setShowAttachMenu(false);
    };
    document.addEventListener('mousedown', handlePointerDownOutside);
    return () => document.removeEventListener('mousedown', handlePointerDownOutside);
  }, [showAttachMenu]);

  // Home suggestion chip click — inject text into input
  useEffect(() => {
    if (!isHome) return;
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail?.text;
      if (typeof text === 'string') {
        setInput(text);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('mindos:home-suggestion', handler);
    return () => window.removeEventListener('mindos:home-suggestion', handler);
  }, [isHome]);

  // Focus and init session when becoming visible (edge-triggered for panel, level-triggered for modal)
  const prevVisibleRef = useRef(false);
  const prevFileRef = useRef(currentFile);
  useEffect(() => {
    const justOpened = variant === 'panel' || variant === 'home'
      ? (visible && !prevVisibleRef.current)  // panel/home: edge detection
      : visible;                               // modal: level detection (reset every open)

    // Detect file change while panel is already open
    const fileChanged = visible && prevVisibleRef.current && currentFile !== prevFileRef.current;

    if (justOpened) {
      const openerRuntime = initialAgentRuntime ?? toAgentRuntime(initialAcpAgent);
      pendingOpenAgentRef.current = openerRuntime;
      setTimeout(() => inputRef.current?.focus(), 50);
      void session.initSessions();
      setInput(initialMessage || '');
      chat.firstMessageFired.current = false;
      setAttachedFiles(currentFile ? [currentFile] : []);
      clearAttachments();
      clearImages();
      mention.resetMention();
      slash.resetSlash();
      setSelectedSkill(null);
      updateSelectedAgentRuntime(openerRuntime);
      setShowHistory(false);
    } else if (fileChanged) {
      // Update attached file context to match new file (don't reset session/messages)
      setAttachedFiles(currentFile ? [currentFile] : []);
    } else if (!visible && variant === 'modal') {
      // Modal: abort streaming on close
      chat.abortRef.current?.abort();
    }
    // Home variant: auto-focus on mount
    if (variant === 'home' && visible && !prevVisibleRef.current) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
    prevVisibleRef.current = visible;
    prevFileRef.current = currentFile;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentFile]);

  useEffect(() => {
    if (!visible || !session.activeSessionId) return;

    const openerRuntime = pendingOpenAgentRef.current;
    const sessionRuntime = getSessionAgentRuntime(session.activeSession);
    const currentRuntime = selectedAgentRuntimeRef.current;
    const keepNativeRuntime =
      currentRuntime?.kind === 'codex' || currentRuntime?.kind === 'claude'
        ? currentRuntime
        : null;
    const restoredRuntime = sessionRuntime ?? openerRuntime ?? keepNativeRuntime;

    updateSelectedAgentRuntime(restoredRuntime);

    if (openerRuntime && !getSessionAgentRuntime(session.activeSession) && session.activeSession?.messages.length === 0) {
      bindActiveSessionToRuntime(openerRuntime);
    }

    pendingOpenAgentRef.current = null;
  }, [
    visible,
    session.activeSessionId,
    session.activeSession?.defaultAcpAgent,
    session.activeSession?.defaultAgentRuntime,
    session.activeSession?.messages.length,
    bindActiveSessionToRuntime,
    updateSelectedAgentRuntime,
  ]);

  // Persist session on message changes (skip if last msg is empty assistant placeholder during loading)
  const clearPersistTimerRef = useRef(session.clearPersistTimer);
  useLayoutEffect(() => {
    clearPersistTimerRef.current = session.clearPersistTimer;
  }, [session.clearPersistTimer]);
  useEffect(() => {
    if (!visible || !session.activeSessionId) return;
    const msgs = session.messages;
    if (chat.isLoading && msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      if (last.role === 'assistant' && !last.content.trim() && (!last.parts || last.parts.length === 0)) return;
    }
    session.persistSession(msgs, session.activeSessionId);
    return () => clearPersistTimerRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, session.messages, session.activeSessionId, chat.isLoading]);

  // Esc to close modal or exit focus mode (skip for home variant)
  useEffect(() => {
    if (!visible || variant === 'home') return;
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

  const formRef = useRef<HTMLFormElement>(null);
  // When set to true, auto-submit on next render after input state update
  const pendingAutoSubmitRef = useRef(false);

  useLayoutEffect(() => {
    if (!visible) return;
    const el = inputRef.current;
    if (!el || !(el instanceof HTMLTextAreaElement)) return;
    syncTextareaToContent(el, TEXTAREA_MAX_VISIBLE_LINES);
    // Auto-submit after resend pre-fills input
    if (pendingAutoSubmitRef.current && input.trim()) {
      pendingAutoSubmitRef.current = false;
      formRef.current?.requestSubmit();
    }
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
  const isMountedRef = useRef(true);

  const handleInputChange = useCallback((val: string, cursorPos?: number) => {
    setInput(val);
    const pos = cursorPos ?? val.length;
    if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
    if (slashTimerRef.current) clearTimeout(slashTimerRef.current);
    mentionTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      mentionRef.current.updateMentionFromInput(val, pos);
    }, 80);
    slashTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      slashRef.current.updateSlashFromInput(val, pos);
    }, 80);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
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
  const selectSlashRef = useRef(selectSlashCommand);
  useLayoutEffect(() => {
    selectMentionRef.current = selectMention;
    selectSlashRef.current = selectSlashCommand;
  }, [selectMention, selectSlashCommand]);

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
    const runtime = selectedAgentRuntimeRef.current;
    sessionRef.current.resetSession(runtime);
    updateSelectedAgentRuntime(runtime);
    clearTransientComposerState();
  }, [clearTransientComposerState, updateSelectedAgentRuntime]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Accept mindos file paths and image drops
    if (e.dataTransfer.types.includes('text/mindos-path') || e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDropError(''); // Clear any previous drop errors
    const filePath = e.dataTransfer.getData('text/mindos-path');
    if (filePath) {
      const pathType = e.dataTransfer.getData('text/mindos-type');
      const key = pathType === 'directory' ? filePath.replace(/\/?$/, '/') : filePath;
      if (!attachedFilesRef.current.includes(key)) {
        setAttachedFiles(prev => [...prev, key]);
      }
      return;
    }
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const hasImages = Array.from(files).some(f => f.type.startsWith('image/'));
      const nonImageFiles = Array.from(files).filter(f => !f.type.startsWith('image/'));
      // Process files with proper error handling and user feedback
      void (async () => {
        try {
          if (hasImages) await imageUploadRef.current.handleDrop(e);
          if (nonImageFiles.length > 0) {
            const dt = new DataTransfer();
            nonImageFiles.forEach(f => dt.items.add(f));
            await uploadRef.current.pickFiles(dt.files);
          }
        } catch (err) {
          // Surface unexpected errors to the user via composerStatusMessage
          const errorMsg = err instanceof Error ? err.message : 'Failed to process dropped files';
          setDropError(errorMsg);
          console.error('[AskContent] Drop file processing failed:', err);
        }
      })();
    }
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
    if (chat.isLoadingRef.current) return; // Don't switch sessions during streaming
    const targetSession = session.sessions.find((item) => item.id === id) ?? null;
    sessionRef.current.loadSession(id);
    setShowHistory(false);
    setInput('');
    setAttachedFiles(currentFile ? [currentFile] : []);
    uploadRef.current.clearAttachments();
    imageUploadRef.current.clearImages();
    mentionRef.current.resetMention();
    slashRef.current.resetSlash();
    setSelectedSkill(null);
    updateSelectedAgentRuntime(getSessionAgentRuntime(targetSession));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [chat.isLoadingRef, currentFile, session.sessions, updateSelectedAgentRuntime]);

  const handleDeleteSession = useCallback((id: string) => {
    if (chat.isLoadingRef.current) return;
    const runtime = selectedAgentRuntimeRef.current;
    sessionRef.current.deleteSession(id, runtime);
    if (sessionRef.current.activeSessionId === id) {
      updateSelectedAgentRuntime(runtime);
      clearTransientComposerState();
    }
  }, [chat.isLoadingRef, clearTransientComposerState, updateSelectedAgentRuntime]);

  const handleClearRuntimeHistory = useCallback(() => {
    if (chat.isLoadingRef.current) return;
    const runtime = selectedAgentRuntimeRef.current;
    const ids = sessionRef.current.sessions
      .filter((item) => isSessionInRuntimeLane(item, runtime))
      .map((item) => item.id);
    sessionRef.current.clearSessions(ids, runtime);
    updateSelectedAgentRuntime(runtime);
    clearTransientComposerState();
  }, [chat.isLoadingRef, clearTransientComposerState, updateSelectedAgentRuntime]);

  const toggleHistory = useCallback(() => setShowHistory(v => !v), []);
  const inputIconSize = 15;
  const messageLabels = useMemo(() => ({
    connecting: t.ask.connecting,
    thinking: t.ask.thinking,
    generating: t.ask.generating,
    reconnecting: reconnectAttempt > 0 ? t.ask.reconnecting(reconnectAttempt, reconnectMax) : undefined,
    copyMessage: t.ask.copyMessage,
    editMessage: t.ask.editMessage,
    regenerateMessage: t.ask.regenerateMessage,
  }), [t, reconnectAttempt, reconnectMax]);

  /** Edit: pre-fill composer with the user message content, truncate history after it */
  const handleEditMessage = useCallback((index: number) => {
    const currentSession = sessionRef.current;
    const msg = currentSession.messages[index];
    if (!msg || msg.role !== 'user') return;
    // Truncate: keep messages up to (not including) the edited message
    currentSession.setMessages(currentSession.messages.slice(0, index));
    setInput(msg.content);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  /** Resend / Regenerate: truncate after user message, auto-submit same content */
  const handleResendMessage = useCallback((index: number) => {
    const currentSession = sessionRef.current;
    const msg = currentSession.messages[index];
    if (!msg || msg.role !== 'user') return;
    // Truncate: keep messages up to (not including) the user message
    currentSession.setMessages(currentSession.messages.slice(0, index));
    setInput(msg.content);
    pendingAutoSubmitRef.current = true;
  }, []);

  const handleProviderChange = useCallback((p: ProviderId | `p_${string}` | null) => {
    setProviderOverride(p);
    setModelOverride(null);
  }, []);

  return (
    <div className="flex min-h-0 w-full flex-col h-full">
      {/* Header — home variant shows session switcher + new/history/fullscreen buttons */}
      <AskHeader
        isPanel={isPanel || isHome}
        showHistory={showHistory}
        onToggleHistory={toggleHistory}
        onReset={handleResetSession}
        isLoading={isLoading}
        maximized={maximized}
        onMaximize={isHome ? onMaximize : onMaximize}
        askMode={isHome ? undefined : askMode}
        onModeSwitch={isHome ? undefined : onModeSwitch}
        onClose={isHome ? undefined : onClose}
        onDockToPanel={maximized ? onDockToPanel : undefined}
        sessions={runtimeScopedSessions}
        activeSessionId={runtimeScopedActiveSessionId}
        onLoadSession={handleLoadSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={session.renameSession}
        onTogglePinSession={session.togglePinSession}
        messages={session.messages}
        selectedAgentRuntime={selectedAgentRuntime}
        onSelectAgentRuntime={handleSelectAgentRuntime}
        runtimeSessionBinding={activeRuntimeSessionBinding}
        nativeRuntimes={nativeRuntimes}
        notInstalledAgents={[]}
        agentLoading={false}
        agentLoadingByKind={nativeDetection.loadingByKind}
      />

      {showHistory && (
        <SessionHistoryPanel
          sessions={runtimeScopedSessions}
          activeSessionId={runtimeScopedActiveSessionId}
          onLoad={handleLoadSession}
          onDelete={handleDeleteSession}
          onRename={session.renameSession}
          onTogglePin={session.togglePinSession}
          onClearAll={handleClearRuntimeHistory}
          onClose={() => setShowHistory(false)}
          onNewChat={handleResetSession}
        />
      )}

      {!showHistory && (
        <>
      {/* Messages — home variant hides empty state unless maximized (suggestions rendered externally in normal mode) */}
      <div className="flex-1 min-h-0 flex flex-col">
        {!isHome && (
          <MessageList
            messages={session.messages}
            isLoading={isLoading}
            loadingPhase={loadingPhase}
            emptyPrompt={t.ask.emptyPrompt}
            emptyHint={t.ask.emptyHint}
            suggestions={t.ask.suggestions}
            onSuggestionClick={setInput}
            onEditMessage={handleEditMessage}
            onResendMessage={handleResendMessage}
            labels={messageLabels}
          />
        )}
        {isHome && (session.messages.length > 0 || maximized) && (
          <MessageList
            messages={session.messages}
            isLoading={isLoading}
            loadingPhase={loadingPhase}
            emptyPrompt={t.ask.emptyPrompt}
            emptyHint={t.ask.emptyHint}
            suggestions={maximized && session.messages.length === 0 ? t.ask.suggestions : []}
            onSuggestionClick={setInput}
            onEditMessage={handleEditMessage}
            onResendMessage={handleResendMessage}
            labels={messageLabels}
          />
        )}
      </div>

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

      {/* Composer card — unified input area */}
      <div className={cn('relative z-10 shrink-0', isHome ? 'px-2 pb-2 pt-0.5' : 'px-3 pb-2.5 pt-1')}>
        <div
          className={cn(
            'relative rounded-xl bg-muted/40 border border-transparent transition-all focus-within:bg-muted/60',
            isDragOver && 'ring-2 ring-[var(--amber)] border-[var(--amber)]/40 bg-[var(--amber)]/5 shadow-[0_0_12px_rgba(200,135,58,0.15)]',
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Unified context chip flow */}
          {(attachedFiles.length > 0 || localAttachments.length > 0 || images.length > 0 || selectedSkill || composerStatusMessage) && (
            <div className={cn('px-3 pt-2.5 pb-2 border-b border-border/30', isPanel ? 'max-h-24 overflow-y-auto' : 'max-h-28 overflow-y-auto')}>
              <div className="flex flex-wrap gap-1.5">
                {attachedFiles.map(f => (
                  <FileChip key={f} path={f} variant="kb" onRemove={() => setAttachedFiles(prev => prev.filter(x => x !== f))} />
                ))}
                {localAttachments.map((f, idx) => (
                  <FileChip key={`up-${f.name}-${idx}`} path={f.name} variant="upload" status={f.status} error={f.error} truncatedInfo={f.truncatedInfo} onRemove={() => removeAttachment(idx)} />
                ))}
                {images.map((img, idx) => (
                  <FileChip
                    key={`img-${idx}`}
                    path={img.fileName || `Image ${idx + 1}`}
                    variant="image"
                    imageData={img.data}
                    imageMime={img.mimeType}
                    onRemove={() => removeImage(idx)}
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
              {composerStatusMessage && (
                <div className="mt-1 text-xs text-error">
                  {composerStatusMessage}
                </div>
              )}
            </div>
          )}

          {/* Input form */}
          <form
            ref={formRef}
            onSubmit={handleSubmitWithRuntimeGuard}
            className={cn('relative z-10 flex items-end gap-1.5', isHome ? 'px-2 py-1.5' : 'px-3 py-2')}
          >
            {/* + attach button with mini menu */}
            <div className="relative shrink-0">
              <button
                ref={attachButtonRef}
                type="button"
                onClick={() => setShowAttachMenu(v => !v)}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                title={t.hints.attachFile}
              >
                <Plus size={inputIconSize} />
              </button>
            </div>

            {/* Attach menu rendered as Portal to avoid clipping by overflow-hidden parent */}
            {mounted && showAttachMenu && attachMenuPos && createPortal(
              <div
                ref={attachMenuRef}
                className="fixed z-[60] pointer-events-auto py-1 rounded-xl border border-border/60 bg-card shadow-lg min-w-[150px] animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
                style={{
                  top: `${attachMenuPos.top}px`,
                  left: `${attachMenuPos.left}px`,
                  transform: 'translateY(-100%)',  // Position above the button
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-xs hover:bg-muted transition-colors text-left rounded-lg"
                  onClick={() => { uploadInputRef.current?.click(); setShowAttachMenu(false); }}
                >
                  <FileText size={12} className="shrink-0 text-muted-foreground" />
                  {t.ask.attachFileLabel}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-xs hover:bg-muted transition-colors text-left rounded-lg"
                  onClick={() => { imageInputRef.current?.click(); setShowAttachMenu(false); }}
                >
                  <ImageIcon size={12} className="shrink-0 text-muted-foreground" />
                  {t.ask.attachImageLabel}
                </button>
              </div>,
              document.body
            )}

            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".txt,.md,.markdown,.csv,.json,.yaml,.yml,.xml,.html,.htm,.pdf,.doc,.docx,.docm,text/plain,text/markdown,text/csv,application/json,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-word.document.macroEnabled.12"
              onChange={async (e) => {
                const inputEl = e.currentTarget;
                await pickFiles(inputEl.files);
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
                await handleFileSelect(inputEl.files);
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
              suppressHydrationWarning
              className={cn('min-w-0 flex-1 resize-none overflow-y-hidden bg-transparent py-2 leading-relaxed text-foreground placeholder:text-muted-foreground/50 outline-none focus-visible:ring-0', isHome ? 'text-xs' : 'text-sm')}
            />

            {isLoading ? (
              <button type="button" onClick={handleStop} className="p-2 rounded-xl transition-colors shrink-0 text-foreground bg-muted hover:bg-muted/80" title={loadingPhase === 'reconnecting' ? t.ask.cancelReconnect : t.ask.stopTitle}>
                {loadingPhase === 'reconnecting' ? <X size={inputIconSize} /> : <StopCircle size={inputIconSize} />}
              </button>
            ) : (
              <button type="submit" title={hasLoadingAttachments ? (t.ask.uploadsProcessing ?? 'Wait for uploaded files to finish processing before sending.') : runtimeUnavailableMessage || t.ask.send} disabled={hasLoadingAttachments || !!selectedRuntimeUnavailable || (!input.trim() && images.length === 0)} className="p-2 rounded-xl disabled:opacity-20 disabled:scale-95 disabled:cursor-not-allowed transition-all duration-150 shrink-0 bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm shadow-[var(--amber)]/15 hover:shadow-md hover:shadow-[var(--amber)]/20 active:scale-95">
                <Send size={14} />
              </button>
            )}
          </form>

          {/* Mode + provider selector row + keyboard hint */}
          <div className={cn('relative z-20 flex items-center justify-between border-t border-border/10', isPanel ? 'px-2 pb-1.5 pt-1 gap-1' : 'px-3 pb-2 pt-1.5')}>
            <div className={cn('flex items-center flex-wrap', isPanel ? 'gap-1' : 'gap-2')}>
              <ModeCapsule mode={chatMode} onChange={setChatMode} disabled={isLoading} />
            {mounted && isMindosRuntime && (
              <ProviderModelCapsule
                providerValue={providerOverride}
                onProviderChange={handleProviderChange}
                modelValue={modelOverride}
                onModelChange={setModelOverride}
                disabled={isLoading}
              />
            )}
            </div>
            {/* Keyboard hint — hidden in panel (too narrow) and home (compact) */}
            {!isPanel && !isHome && (
              <span className="hidden md:inline text-2xs text-muted-foreground/40 select-none shrink-0">
                <kbd className="font-mono">Enter</kbd> {t.ask.send} · <kbd className="font-mono">Shift+Enter</kbd> {t.ask.newlineHint}
              </span>
            )}
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
