'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Plus, FileText, ImageIcon } from 'lucide-react';
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
import AskComposerInput from '@/components/ask/AskComposerInput';
import ProviderModelCapsule, { getPersistedProviderModel } from '@/components/ask/ProviderModelCapsule';
import type { ProviderId } from '@/lib/agent/providers';
import { useAskChat } from '@/hooks/useAskChat';
import { useAgentRunTimeline } from '@/hooks/useAgentRunTimeline';
import {
  filterSessionsByRuntimeLane,
  compactAgentRuntimeIdentity,
  getMatchingRuntimeSessionBinding,
  getMessageAgentRuntime,
  getSessionAgentRuntime,
  isSessionInRuntimeLane,
  toAgentRuntime,
} from '@/lib/ask-agent';
import {
  loadLastSelectedAgentRuntime,
  persistLastSelectedAgentRuntime,
} from '@/lib/ask-runtime-preference';
import { refreshSessions } from '@/lib/ask-session-store';
import { cn } from '@/lib/utils';
import { useNativeRuntimeDetection } from '@/hooks/useNativeRuntimeDetection';
import type { AcpAgentSelection } from '@/hooks/useAskModal';
import { compactRuntimeDisplayReason } from '@/lib/agent/runtime-error-display';
import type { CodexThreadListResponse, CodexThreadSummary, RuntimeSessionBinding } from '@/lib/types';

/** Stable empty array — a fresh [] literal per render would bust MessageList's memo */
const EMPTY_SUGGESTIONS: ReadonlyArray<{ label: string; prompt: string }> = [];

function runtimeStatusLabel(status: AgentRuntimeDescriptor['status']): string {
  if (status === 'signed-out') return 'signed out';
  if (status === 'error') return 'unavailable';
  if (status === 'missing') return 'not installed';
  return 'available';
}

type SelectedAgentRuntime = AgentRuntimeIdentity & { binaryPath?: string };

function normalizeSelectedAgentRuntime(runtime: AgentRuntimeIdentity | null | undefined): SelectedAgentRuntime | null {
  if (!runtime) return null;
  const record = runtime as AgentRuntimeIdentity & { binaryPath?: unknown };
  return {
    id: runtime.id,
    name: runtime.name,
    kind: runtime.kind,
    ...(typeof record.binaryPath === 'string' && record.binaryPath.trim() ? { binaryPath: record.binaryPath } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCodexThread(value: unknown): CodexThreadSummary | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null;
  return {
    id: value.id,
    ...(typeof value.name === 'string' || value.name === null ? { name: value.name } : {}),
    ...(typeof value.preview === 'string' ? { preview: value.preview } : {}),
    ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
    ...(typeof value.createdAt === 'number' || typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'number' || typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    ...('status' in value ? { status: value.status } : {}),
    ...(typeof value.archived === 'boolean' ? { archived: value.archived } : {}),
  };
}

function codexThreadTitle(thread: CodexThreadSummary): string {
  const title = thread.name?.trim() || thread.preview?.trim();
  if (title) return title.length > 42 ? `${title.slice(0, 42)}...` : title;
  return `Codex thread ${thread.id.slice(0, 8)}`;
}

function codexThreadBindingStatus(thread: CodexThreadSummary): RuntimeSessionBinding['status'] {
  if (thread.archived) return 'archived';
  return typeof thread.status === 'string' && thread.status === 'archived' ? 'archived' : 'active';
}

function codexThreadUpdatedAt(thread: CodexThreadSummary): number | string | undefined {
  return thread.updatedAt ?? thread.createdAt;
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
  /** Route-driven session selection (/chat/[sessionId]): the route already
   * called loadSession, so init skips initSessions' selection phase (which
   * would clobber it) and only refreshes session metadata. */
  initialSessionId?: string;
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

export default function AskContent({ visible, currentFile, initialMessage, initialAcpAgent, initialAgentRuntime, initialSessionId, onFirstMessage, variant, onClose, maximized, onMaximize, askMode, onModeSwitch, onDockToPanel }: AskContentProps) {
  const isPanel = variant === 'panel';
  const isHome = variant === 'home';

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Composer input text lives in AskComposerInput (local state) so keystrokes
  // do not re-render this whole component. inputValueRef is the backing store
  // (read path); setComposerValue is the write path.
  const inputValueRef = useRef('');
  const composerSetterRef = useRef<((value: string) => void) | null>(null);
  const setComposerValue = useCallback((value: string) => {
    inputValueRef.current = value;
    composerSetterRef.current?.(value);
  }, []);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const attachedFilesRef = useRef(attachedFiles);
  const [showHistory, setShowHistory] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [codexThreads, setCodexThreads] = useState<CodexThreadSummary[]>([]);
  const [codexThreadsLoading, setCodexThreadsLoading] = useState(false);
  const [codexThreadsError, setCodexThreadsError] = useState<string | null>(null);
  const [codexThreadActionId, setCodexThreadActionId] = useState<string | null>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const [attachMenuPos, setAttachMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [dropError, setDropError] = useState('');
  const codexThreadsRequestSeqRef = useRef(0);

  const [selectedSkill, setSelectedSkill] = useState<SlashItem | null>(null);
  const selectedSkillRef = useRef(selectedSkill);
  const [selectedAgentRuntime, setSelectedAgentRuntime] = useState<SelectedAgentRuntime | null>(null);
  const selectedAgentRuntimeRef = useRef(selectedAgentRuntime);
  const pendingOpenAgentRef = useRef<SelectedAgentRuntime | null>(null);
  const [chatMode, setChatMode] = useState<AskMode>('agent');
  const [providerOverride, setProviderOverride] = useState<ProviderId | `p_${string}` | null>(null);
  const [modelOverride, setModelOverride] = useState<string | null>(null);

  const updateSelectedAgentRuntime = useCallback((runtime: AgentRuntimeIdentity | null) => {
    const normalized = normalizeSelectedAgentRuntime(runtime);
    selectedAgentRuntimeRef.current = normalized;
    setSelectedAgentRuntime(normalized);
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
  const nativeDetection = useNativeRuntimeDetection();
  const nativeRuntimes = useMemo<Array<AgentRuntimeIdentity & Partial<Pick<AgentRuntimeDescriptor, 'status' | 'availability' | 'installCmd' | 'packageName' | 'binaryPath' | 'runtimeBridge'>>>>(() => {
    return nativeDetection.runtimes
      .filter((runtime) => runtime.kind === 'codex' || runtime.kind === 'claude')
      .map((runtime) => ({
        id: runtime.id,
        name: runtime.name,
        kind: runtime.kind,
        status: runtime.status,
        availability: runtime.availability,
        ...(runtime.runtimeBridge ? { runtimeBridge: runtime.runtimeBridge } : {}),
        ...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
        ...(runtime.installCmd ? { installCmd: runtime.installCmd } : {}),
        ...(runtime.packageName ? { packageName: runtime.packageName } : {}),
      }));
  }, [nativeDetection.runtimes]);
  const isMindosRuntime = !selectedAgentRuntime || selectedAgentRuntime.kind === 'mindos';
  const selectedRuntimeChecking = useMemo(() => {
    if (!selectedAgentRuntime || selectedAgentRuntime.kind === 'mindos') return false;
    const nativeKind = selectedAgentRuntime.kind;
    if (nativeKind !== 'codex' && nativeKind !== 'claude') return false;
    return nativeDetection.loadingByKind[nativeKind] === true;
  }, [nativeDetection.loadingByKind, selectedAgentRuntime]);
  const selectedRuntimeUnavailable = useMemo(() => {
    if (!selectedAgentRuntime || selectedAgentRuntime.kind === 'mindos') return null;
    const nativeKind = selectedAgentRuntime.kind;
    if (nativeKind !== 'codex' && nativeKind !== 'claude') return null;
    const detectionError = nativeDetection.errorByKind[nativeKind];
    if (detectionError && !nativeDetection.loadingByKind[nativeKind]) {
      return {
        status: 'error' as const,
        reason: detectionError,
      };
    }
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
  }, [nativeDetection.errorByKind, nativeDetection.loadingByKind, nativeDetection.runtimes, selectedAgentRuntime]);
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
  const loadCodexThreads = useCallback(async () => {
    if (selectedAgentRuntimeRef.current?.kind !== 'codex') return;
    const seq = codexThreadsRequestSeqRef.current + 1;
    codexThreadsRequestSeqRef.current = seq;
    setCodexThreadsLoading(true);
    setCodexThreadsError(null);

    try {
      const res = await fetch('/api/agent-runtimes/codex/threads?limit=30&useStateDbOnly=1', {
        cache: 'no-store',
      });
      if (!res.ok) {
        let message = `Failed to load Codex threads (${res.status}).`;
        try {
          const body = await res.json() as { error?: string; message?: string };
          message = body.error || body.message || message;
        } catch {
          // keep status-derived message
        }
        throw new Error(message);
      }
      const body = await res.json() as Partial<CodexThreadListResponse>;
      const threads = Array.isArray(body.data)
        ? body.data.map(normalizeCodexThread).filter((thread): thread is CodexThreadSummary => Boolean(thread))
        : [];
      if (codexThreadsRequestSeqRef.current === seq) {
        setCodexThreads(threads);
      }
    } catch (error) {
      if (codexThreadsRequestSeqRef.current === seq) {
        const message = error instanceof Error && error.message
          ? error.message
          : 'Failed to load Codex threads.';
        setCodexThreadsError(message);
      }
    } finally {
      if (codexThreadsRequestSeqRef.current === seq) {
        setCodexThreadsLoading(false);
      }
    }
  }, []);

  const imageUploadRef = useRef(imageUploadRuntime);
  const mentionRef = useRef(mention);
  const slashRef = useRef(slash);
  useLayoutEffect(() => {
    attachedFilesRef.current = attachedFiles;
    selectedSkillRef.current = selectedSkill;
    selectedAgentRuntimeRef.current = selectedAgentRuntime;
    sessionRef.current = session;
    uploadRef.current = uploadRuntime;
    imageUploadRef.current = imageUploadRuntime;
    mentionRef.current = mention;
    slashRef.current = slash;
  }, [attachedFiles, imageUploadRuntime, mention, selectedAgentRuntime, selectedSkill, session, slash, uploadRuntime]);

  useEffect(() => {
    if (!visible || !showHistory) return;
    if (selectedAgentRuntime?.kind === 'codex') {
      void loadCodexThreads();
      return;
    }
    setCodexThreads([]);
    setCodexThreadsError(null);
    setCodexThreadsLoading(false);
    setCodexThreadActionId(null);
  }, [loadCodexThreads, selectedAgentRuntime?.kind, showHistory, visible]);

  const resetInputState = useCallback(() => {
    setComposerValue('');
    setSelectedSkill(null);
    setAttachedFiles(currentFile ? [currentFile] : []);
    uploadRef.current.clearAttachments();
  }, [currentFile]);


  const handleRestoreInput = useCallback((userMessage: Message) => {
    setComposerValue(userMessage.content);
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
    activeSessionId: session.activeSessionId,
    onFirstMessage,
    refs: chatRefs,
    errorLabels: { noResponse: t.ask.errorNoResponse, stopped: t.ask.stopped, concurrentLimit: t.ask.concurrentLimit },
    resetInputState,
    onRestoreInput: handleRestoreInput,
  });
  const { isLoading, loadingPhase, reconnectAttempt, reconnectMax } = chat;
  useAgentRunTimeline({
    chatSessionId: session.activeSessionId,
    rootRunId: chat.agentRunContext?.chatSessionId && chat.agentRunContext.chatSessionId !== session.activeSessionId
      ? undefined
      : chat.agentRunContext?.rootRunId,
    visible: visible && !showHistory,
    isLoading,
    messages: session.messages,
    setMessages: session.setMessages,
  });
  const handleSubmit = chat.submit;
  const handleStop = chat.stop;

  const clearTransientComposerState = useCallback(() => {
    setComposerValue('');
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
    sessionRef.current.setSessionAgentRuntimeBinding(compactAgentRuntimeIdentity(agent) ?? agent);
  }, []);

  const handleSelectAgentRuntime = useCallback((agent: AgentRuntimeIdentity | null) => {
    if (chat.isLoadingRef.current) return;
    updateSelectedAgentRuntime(agent);
    persistLastSelectedAgentRuntime(agent);

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
  const runtimeCheckingMessage = selectedAgentRuntime && selectedRuntimeChecking
    ? `Checking ${selectedAgentRuntime.name} status...`
    : '';
  const runtimeUnavailableMessage = selectedAgentRuntime && selectedRuntimeUnavailable
    ? `${selectedAgentRuntime.name} is ${runtimeStatusLabel(selectedRuntimeUnavailable.status)}.${selectedRuntimeUnavailable.reason ? ` ${compactRuntimeDisplayReason(selectedRuntimeUnavailable.reason, { runtime: selectedAgentRuntime.kind === 'codex' || selectedAgentRuntime.kind === 'claude' ? selectedAgentRuntime.kind : undefined })}` : ''}`
    : '';
  const composerStatusMessage = uploadError || imageError || dropError || runtimeCheckingMessage || runtimeUnavailableMessage;

  const handleSubmitWithRuntimeGuard = useCallback((event: React.FormEvent) => {
    if (selectedRuntimeChecking || selectedRuntimeUnavailable) {
      event.preventDefault();
      return;
    }
    void handleSubmit(event);
  }, [handleSubmit, selectedRuntimeChecking, selectedRuntimeUnavailable]);

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
        setComposerValue(text);
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
      const preferredRuntime = openerRuntime ?? loadLastSelectedAgentRuntime();
      pendingOpenAgentRef.current = preferredRuntime;
      if (openerRuntime) persistLastSelectedAgentRuntime(openerRuntime);
      setTimeout(() => inputRef.current?.focus(), 50);
      if (initialSessionId) {
        // Route owns selection — initSessions' selection phase would move the
        // active session away from the route's loadSession. Metadata only.
        void refreshSessions();
      } else {
        void session.initSessions(preferredRuntime ?? undefined);
      }
      setComposerValue(initialMessage || '');
      chat.firstMessageFired.current = false;
      setAttachedFiles(currentFile ? [currentFile] : []);
      clearAttachments();
      clearImages();
      mention.resetMention();
      slash.resetSlash();
      setSelectedSkill(null);
      updateSelectedAgentRuntime(preferredRuntime);
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
    const detectedRuntime = restoredRuntime?.kind === 'codex' || restoredRuntime?.kind === 'claude'
      ? nativeRuntimes.find((runtime) => runtime.kind === restoredRuntime.kind && runtime.id === restoredRuntime.id)
      : undefined;
    const hydratedRuntime = restoredRuntime && detectedRuntime?.binaryPath && !(restoredRuntime as AgentRuntimeIdentity & { binaryPath?: string }).binaryPath
      ? { ...restoredRuntime, binaryPath: detectedRuntime.binaryPath }
      : restoredRuntime;

    updateSelectedAgentRuntime(hydratedRuntime);

    if (openerRuntime && !getSessionAgentRuntime(session.activeSession) && session.activeSession?.messages.length === 0) {
      bindActiveSessionToRuntime(hydratedRuntime);
    }

    pendingOpenAgentRef.current = null;
  }, [
    visible,
    session.activeSessionId,
    session.activeSession?.defaultAcpAgent,
    session.activeSession?.defaultAgentRuntime,
    session.activeSession?.messages.length,
    bindActiveSessionToRuntime,
    nativeRuntimes,
    updateSelectedAgentRuntime,
  ]);

  // Persistence is handled by ask-run-store (every message write schedules a
  // debounced flush; the placeholder-skip rule lives in flushPersist).

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
  // When set to true, AskComposerInput auto-submits on its next render after
  // the input value updates (textarea sizing also lives there now).
  const pendingAutoSubmitRef = useRef(false);

  const mentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const handleInputChange = useCallback((val: string, cursorPos?: number) => {
    // Local input state already updated inside AskComposerInput.
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
    setComposerValue(newVal);
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
    setComposerValue(newVal);
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
    // Concurrency: a running active session keeps streaming in the background;
    // New Chat just switches to a fresh session.
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
    // Concurrency: switching away from a streaming session is allowed — its
    // run keeps writing to the store and the list shows a running indicator.
    const targetSession = session.sessions.find((item) => item.id === id) ?? null;
    sessionRef.current.loadSession(id);
    setShowHistory(false);
    setComposerValue('');
    setAttachedFiles(currentFile ? [currentFile] : []);
    uploadRef.current.clearAttachments();
    imageUploadRef.current.clearImages();
    mentionRef.current.resetMention();
    slashRef.current.resetSlash();
    setSelectedSkill(null);
    const targetRuntime = getSessionAgentRuntime(targetSession);
    updateSelectedAgentRuntime(targetRuntime);
    persistLastSelectedAgentRuntime(targetRuntime);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [chat.isLoadingRef, currentFile, session.sessions, updateSelectedAgentRuntime]);

  const handleDeleteSession = useCallback((id: string) => {
    // Deleting a running session is allowed: the store aborts its run and
    // clears timers/messages before the metadata goes (no zombie writes).
    const runtime = selectedAgentRuntimeRef.current;
    sessionRef.current.deleteSession(id, runtime);
    if (sessionRef.current.activeSessionId === id) {
      updateSelectedAgentRuntime(runtime);
      clearTransientComposerState();
    }
  }, [clearTransientComposerState, updateSelectedAgentRuntime]);

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

  const handleAttachCodexThread = useCallback((thread: CodexThreadSummary) => {
    if (chat.isLoadingRef.current) return;
    const runtime = selectedAgentRuntimeRef.current;
    if (!runtime || runtime.kind !== 'codex') return;
    const attached = sessionRef.current.attachRuntimeSession(compactAgentRuntimeIdentity(runtime) ?? runtime, {
      externalSessionId: thread.id,
      cwd: thread.cwd,
      status: codexThreadBindingStatus(thread),
      updatedAt: codexThreadUpdatedAt(thread),
    }, {
      title: codexThreadTitle(thread),
    });
    if (!attached) {
      // The matched local session has a live run — rebinding mid-run is refused.
      setCodexThreadsError(t.ask.sessionRunningRetry);
      return;
    }
    updateSelectedAgentRuntime(runtime);
    clearTransientComposerState();
  }, [chat.isLoadingRef, clearTransientComposerState, t.ask.sessionRunningRetry, updateSelectedAgentRuntime]);

  const handleForkCodexThread = useCallback(async (thread: CodexThreadSummary) => {
    if (chat.isLoadingRef.current || codexThreadActionId) return;
    const runtime = selectedAgentRuntimeRef.current;
    if (!runtime || runtime.kind !== 'codex') return;
    setCodexThreadActionId(thread.id);
    setCodexThreadsError(null);
    try {
      const res = await fetch(`/api/agent-runtimes/codex/threads/${encodeURIComponent(thread.id)}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thread.cwd ? { cwd: thread.cwd } : {}),
      });
      if (!res.ok) {
        let message = `Failed to fork Codex thread (${res.status}).`;
        try {
          const body = await res.json() as { error?: string; message?: string };
          message = body.error || body.message || message;
        } catch {
          // keep status-derived message
        }
        throw new Error(message);
      }
      const body = await res.json() as { thread?: unknown };
      const forked = normalizeCodexThread(body.thread);
      if (forked) {
        setCodexThreads((prev) => [forked, ...prev.filter((item) => item.id !== forked.id)]);
        sessionRef.current.attachRuntimeSession(compactAgentRuntimeIdentity(runtime) ?? runtime, {
          externalSessionId: forked.id,
          cwd: forked.cwd,
          status: codexThreadBindingStatus(forked),
          updatedAt: codexThreadUpdatedAt(forked),
        }, {
          title: codexThreadTitle(forked),
        });
        updateSelectedAgentRuntime(runtime);
        clearTransientComposerState();
      } else {
        await loadCodexThreads();
      }
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Failed to fork Codex thread.';
      setCodexThreadsError(message);
    } finally {
      setCodexThreadActionId(null);
    }
  }, [chat.isLoadingRef, clearTransientComposerState, codexThreadActionId, loadCodexThreads, updateSelectedAgentRuntime]);

  const handleArchiveCodexThread = useCallback(async (thread: CodexThreadSummary) => {
    if (chat.isLoadingRef.current || codexThreadActionId) return;
    const runtime = selectedAgentRuntimeRef.current;
    if (!runtime || runtime.kind !== 'codex') return;
    setCodexThreadActionId(thread.id);
    setCodexThreadsError(null);
    try {
      const res = await fetch(`/api/agent-runtimes/codex/threads/${encodeURIComponent(thread.id)}/archive`, {
        method: 'POST',
      });
      if (!res.ok) {
        let message = `Failed to archive Codex thread (${res.status}).`;
        try {
          const body = await res.json() as { error?: string; message?: string };
          message = body.error || body.message || message;
        } catch {
          // keep status-derived message
        }
        throw new Error(message);
      }

      setCodexThreads((prev) => prev.filter((item) => item.id !== thread.id));
      const activeBinding = getMatchingRuntimeSessionBinding(sessionRef.current.activeSession, runtime);
      if (activeBinding?.externalSessionId === thread.id) {
        sessionRef.current.setSessionAgentRuntimeBinding(compactAgentRuntimeIdentity(runtime) ?? runtime, {
          externalSessionId: thread.id,
          cwd: thread.cwd,
          status: 'archived',
          updatedAt: Date.now(),
        });
      }
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Failed to archive Codex thread.';
      setCodexThreadsError(message);
    } finally {
      setCodexThreadActionId(null);
    }
  }, [chat.isLoadingRef, codexThreadActionId]);

  const toggleHistory = useCallback(() => setShowHistory(v => !v), []);
  // Stable identity so the memoized SessionHistoryPanel skips chunk-driven re-renders.
  const closeHistory = useCallback(() => setShowHistory(false), []);
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
    setComposerValue(msg.content);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  /** Resend / Regenerate: truncate after user message, auto-submit same content */
  const handleResendMessage = useCallback((index: number) => {
    const currentSession = sessionRef.current;
    const msg = currentSession.messages[index];
    if (!msg || msg.role !== 'user') return;
    // Truncate: keep messages up to (not including) the user message
    currentSession.setMessages(currentSession.messages.slice(0, index));
    setComposerValue(msg.content);
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
        agentErrorByKind={nativeDetection.errorByKind}
        onRefreshNativeRuntimes={nativeDetection.refresh}
      />

      {showHistory && (
        <SessionHistoryPanel
          sessions={runtimeScopedSessions}
          activeSessionId={runtimeScopedActiveSessionId}
          selectedAgentRuntime={selectedAgentRuntime}
          codexThreads={codexThreads}
          codexThreadsLoading={codexThreadsLoading}
          codexThreadsError={codexThreadsError}
          codexThreadActionId={codexThreadActionId}
          onLoad={handleLoadSession}
          onDelete={handleDeleteSession}
          onRename={session.renameSession}
          onTogglePin={session.togglePinSession}
          onClearAll={handleClearRuntimeHistory}
          onClose={closeHistory}
          onNewChat={handleResetSession}
          onRefreshCodexThreads={loadCodexThreads}
          onAttachCodexThread={handleAttachCodexThread}
          onForkCodexThread={handleForkCodexThread}
          onArchiveCodexThread={handleArchiveCodexThread}
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
            onSuggestionClick={setComposerValue}
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
            suggestions={maximized && session.messages.length === 0 ? t.ask.suggestions : EMPTY_SUGGESTIONS}
            onSuggestionClick={setComposerValue}
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
                className="hit-target-box p-2 text-muted-foreground hover:text-foreground transition-colors [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_60%,transparent)] [--hit-target-radius:var(--radius-lg)]"
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
                  className="hit-target-box flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors text-left [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-lg)]"
                  onClick={() => { uploadInputRef.current?.click(); setShowAttachMenu(false); }}
                >
                  <FileText size={12} className="shrink-0 text-muted-foreground" />
                  {t.ask.attachFileLabel}
                </button>
                <button
                  type="button"
                  className="hit-target-box flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors text-left [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-lg)]"
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

            <AskComposerInput
              visible={visible}
              isHome={isHome}
              isLoading={isLoading}
              reconnecting={loadingPhase === 'reconnecting'}
              placeholder={t.ask.placeholder}
              sendTitle={hasLoadingAttachments ? (t.ask.uploadsProcessing ?? 'Wait for uploaded files to finish processing before sending.') : runtimeCheckingMessage || runtimeUnavailableMessage || t.ask.send}
              stopTitle={loadingPhase === 'reconnecting' ? t.ask.cancelReconnect : t.ask.stopTitle}
              sendDisabledExternal={hasLoadingAttachments || selectedRuntimeChecking || !!selectedRuntimeUnavailable}
              allowEmptySend={images.length > 0}
              iconSize={inputIconSize}
              inputRef={inputRef}
              formRef={formRef}
              valueRef={inputValueRef}
              setterRef={composerSetterRef}
              pendingAutoSubmitRef={pendingAutoSubmitRef}
              onValueChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onPaste={handlePaste}
              onStop={handleStop}
            />
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
