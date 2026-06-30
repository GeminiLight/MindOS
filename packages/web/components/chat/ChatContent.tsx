'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownRight, FileText, ImageIcon, Plus, Trash2 } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import type { AcpRuntimeOptions, AgentPermissionMode, AgentRuntimeDescriptor, AgentRuntimeIdentity, ChatSession, Message, NativeRuntimeOptions } from '@/lib/types';
import ModeCapsule, {
  getPersistedPermissionMode,
} from '@/components/ask/ModeCapsule';
import { useAskSession } from '@/hooks/useAskSession';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useMention } from '@/hooks/useMention';
import { useSlashCommand } from '@/hooks/useSlashCommand';
import type { SkillSlashItem, SlashItem } from '@/hooks/useSlashCommand';
import MessageList from '@/components/ask/MessageList';
import MentionPopover from '@/components/ask/MentionPopover';
import SlashCommandPopover from '@/components/ask/SlashCommandPopover';
import SessionHistoryPanel from '@/components/ask/SessionHistoryPanel';
import AskHeader from '@/components/ask/AskHeader';
import FileChip from '@/components/ask/FileChip';
import AskComposerInput from '@/components/ask/AskComposerInput';
import ContextStatusButton from '@/components/ask/ContextStatusButton';
import SessionContextDock from '@/components/ask/SessionContextDock';
import ProviderModelCapsule, { getPersistedProviderModel } from '@/components/ask/ProviderModelCapsule';
import NativeRuntimeOptionsCapsule, { getPersistedNativeRuntimeOptions, persistNativeRuntimeOptions } from '@/components/ask/NativeRuntimeOptionsCapsule';
import AcpRuntimeOptionsCapsule, { getPersistedAcpRuntimeOptions, persistAcpRuntimeOptions } from '@/components/ask/AcpRuntimeOptionsCapsule';
import { useAgentChat } from '@/hooks/useAgentChat';
import { useAgentRunTimeline } from '@/hooks/useAgentRunTimeline';
import { useRuntimeSessionProjection } from '@/hooks/useRuntimeSessionProjection';
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
import {
  canEditSessionWorkDir,
  getActiveSessionId,
  refreshSessions,
  renameSession as renameStoredSession,
  resetSession as resetStoredSession,
} from '@/lib/agent-session-store';
import { cn } from '@/lib/utils';
import { useAcpDetection } from '@/hooks/useAcpDetection';
import { useNativeRuntimeDetection } from '@/hooks/useNativeRuntimeDetection';
import { useRuntimeReadiness } from '@/hooks/useRuntimeReadiness';
import type { AcpAgentSelection } from '@/hooks/useAskModal';
import { compactRuntimeDisplayReason } from '@/lib/agent/runtime-error-display';
import type { AskContextRequest } from '@/lib/ask-context-events';
import {
  getProviderModelFromSessionSelection,
  toSessionModelSelection,
  type ProviderSelection,
} from '@/lib/session-model-selection';
import { isAiConfiguredForAgentTurn, type SettingsJsonForAi } from '@/lib/settings-ai-client';
import { getEffectiveSessionWorkDir } from '@/lib/session-context';
import {
  ASK_PANEL_SESSION_ACTIVATE_EVENT,
  getAskPanelSessionActivationDetail,
  type AskPanelNewSessionDetail,
} from '@/lib/ask-panel-session-activation';
import {
  RUNTIME_COMMAND_INSERT_EVENT,
  normalizeRuntimeCommandInsertDetail,
} from '@/lib/runtime-command-events';
import {
  archiveRuntimeSession,
  forkRuntimeSession,
  getRuntimeSessionAdapterCapabilities,
  importBoundRuntimeSessionHistory,
  listRuntimeSessions,
  readRuntimeSessionHistory,
} from '@/lib/runtime-session-history';
import {
  runtimeSessionEntryAttachBinding,
  runtimeSessionEntryTitle,
  type RuntimeSessionEntry,
} from '@/lib/runtime-session-entry';

/** Stable empty array — a fresh [] literal per render would bust MessageList's memo */
const EMPTY_SUGGESTIONS: ReadonlyArray<{ label: string; prompt: string }> = [];

function runtimeStatusLabel(status: AgentRuntimeDescriptor['status']): string {
  if (status === 'signed-out') return 'signed out';
  if (status === 'error') return 'unavailable';
  if (status === 'missing') return 'not installed';
  return 'available';
}

type SelectedAgentRuntime = AgentRuntimeIdentity & { binaryPath?: string };

interface QueuedFollowUp {
  id: string;
  sessionId: string;
  content: string;
}

function createQueuedFollowUpId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `queued-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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

function runtimeSessionListCwd(session: ChatSession | null | undefined): string | undefined {
  const cwd = session ? getEffectiveSessionWorkDir(session).path?.trim() : undefined;
  return cwd || undefined;
}

interface ChatContentProps {
  /** Controls visibility — 'open' for modal, 'active' for panel */
  visible: boolean;
  currentFile?: string;
  initialMessage?: string;
  /** ACP agent pre-selected via "Use" button from A2A tab */
  initialAcpAgent?: AcpAgentSelection | null;
  /** Runtime pre-selected by an opener; supersedes initialAcpAgent when present. */
  initialAgentRuntime?: AgentRuntimeIdentity | null;
  /** Start a fresh MindOS chat session for this opener request. */
  initialNewSession?: boolean;
  /** Monotonic opener request id, used when the panel is already visible. */
  openRequestId?: number;
  /** Route-driven session selection (/chat/[sessionId]): the route already
   * called loadSession, so init skips initSessions' selection phase (which
   * would clobber it) and only refreshes session metadata. */
  initialSessionId?: string;
  /** Project lane for Studio-scoped work. */
  projectId?: string;
  contextRequest?: AskContextRequest | null;
  onFirstMessage?: () => void;
  /** 'modal' renders close button + ESC handler; 'panel' renders compact header; 'home' renders embedded on homepage */
  variant: 'modal' | 'panel' | 'home';
  /** Required for modal variant — called on close button / ESC / backdrop click */
  onClose?: () => void;
  maximized?: boolean;
  onMaximize?: () => void;
  /** Navigate from fullscreen to right-side panel mode */
  onDockToPanel?: () => void;
}

export default function ChatContent({ visible, currentFile, initialMessage, initialAcpAgent, initialAgentRuntime, initialNewSession, openRequestId, initialSessionId, projectId, contextRequest, onFirstMessage, variant, onClose, maximized, onMaximize, onDockToPanel }: ChatContentProps) {
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
  const [runtimeSessions, setRuntimeSessions] = useState<RuntimeSessionEntry[]>([]);
  const [runtimeSessionsLoading, setRuntimeSessionsLoading] = useState(false);
  const [runtimeSessionsError, setRuntimeSessionsError] = useState<string | null>(null);
  const [runtimeSessionActionId, setRuntimeSessionActionId] = useState<string | null>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const [attachMenuPos, setAttachMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [dropError, setDropError] = useState('');
  const [queuedFollowUps, setQueuedFollowUps] = useState<QueuedFollowUp[]>([]);
  const [queueDrainSignal, setQueueDrainSignal] = useState(0);
  const queuedFollowUpsRef = useRef<QueuedFollowUp[]>([]);
  const drainingQueuedFollowUpRef = useRef(false);
  const runtimeSessionsRequestSeqRef = useRef(0);

  const [selectedSkill, setSelectedSkill] = useState<SkillSlashItem | null>(null);
  const selectedSkillRef = useRef(selectedSkill);
  const [selectedAgentRuntime, setSelectedAgentRuntime] = useState<SelectedAgentRuntime | null>(null);
  const selectedAgentRuntimeRef = useRef(selectedAgentRuntime);
  const pendingOpenAgentRef = useRef<SelectedAgentRuntime | null>(null);
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>('ask');
  const [providerOverride, setProviderOverride] = useState<ProviderSelection>(null);
  const providerOverrideRef = useRef<ProviderSelection>(null);
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [nativeRuntimeOptions, setNativeRuntimeOptions] = useState<NativeRuntimeOptions>({});
  const [acpRuntimeOptions, setAcpRuntimeOptions] = useState<AcpRuntimeOptions>({});

  const updateSelectedAgentRuntime = useCallback((runtime: AgentRuntimeIdentity | null) => {
    const normalized = normalizeSelectedAgentRuntime(runtime);
    selectedAgentRuntimeRef.current = normalized;
    setSelectedAgentRuntime(normalized);
    if (normalized?.kind === 'codex' || normalized?.kind === 'claude') {
      setNativeRuntimeOptions(getPersistedNativeRuntimeOptions(normalized.kind));
    } else {
      setNativeRuntimeOptions({});
    }
    if (normalized?.kind === 'acp') {
      setAcpRuntimeOptions(getPersistedAcpRuntimeOptions(normalized.id));
    } else {
      setAcpRuntimeOptions({});
    }
  }, []);

  const session = useAskSession(currentFile, projectId);

  useEffect(() => {
    setPermissionMode(getPersistedPermissionMode());
  }, []);

  useEffect(() => {
    const fromSession = getProviderModelFromSessionSelection(session.activeSession?.modelSelection);
    const next = fromSession.provider || fromSession.model
      ? fromSession
      : getPersistedProviderModel();
    providerOverrideRef.current = next.provider;
    setProviderOverride(next.provider);
    setModelOverride(next.model);
  }, [
    session.activeSessionId,
    session.activeSession?.modelSelection?.providerOverride,
    session.activeSession?.modelSelection?.modelOverride,
    session.activeSession?.modelSelection?.updatedAt,
  ]);
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
  const isMindosRuntime = !selectedAgentRuntime || selectedAgentRuntime.kind === 'mindos';
  const isAcpRuntime = selectedAgentRuntime?.kind === 'acp';
  const selectedNativeRuntimeKind = selectedAgentRuntime?.kind === 'codex' || selectedAgentRuntime?.kind === 'claude'
    ? selectedAgentRuntime.kind
    : null;
  const isNativeRuntime = selectedNativeRuntimeKind !== null;
  const runtimeSessionProjection = useRuntimeSessionProjection({ visible, runtime: selectedAgentRuntime });
  const acpRuntimeCommands = useMemo(() => (
    isAcpRuntime
      ? runtimeSessionProjection.selectedProjection?.slashCommands.commands ?? []
      : []
  ), [isAcpRuntime, runtimeSessionProjection.selectedProjection?.slashCommands.commands]);
  const mention = useMention();
  const slash = useSlashCommand({ runtimeCommands: acpRuntimeCommands });
  const nativeDetection = useNativeRuntimeDetection();
  const acpDetection = useAcpDetection();
  const runtimeReadiness = useRuntimeReadiness({ visible, permissionMode });
  const nativeRuntimes = useMemo<Array<AgentRuntimeIdentity & Partial<Pick<AgentRuntimeDescriptor, 'status' | 'availability' | 'installCmd' | 'packageName' | 'binaryPath' | 'runtimeBridge'>>>>(() => {
    return (nativeDetection.runtimes ?? [])
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
  const acpRuntimes = useMemo<Array<AgentRuntimeIdentity & Partial<Pick<AgentRuntimeDescriptor, 'status' | 'availability' | 'description' | 'binaryPath' | 'resolvedCommand'>>>>(() => {
    const descriptors = (acpDetection.runtimes ?? [])
      .filter((runtime) => runtime.kind === 'acp')
      .map((runtime) => ({
        id: runtime.id,
        name: runtime.name,
        kind: runtime.kind,
        status: runtime.status,
        availability: runtime.availability,
        ...(runtime.description ? { description: runtime.description } : {}),
        ...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
        ...(runtime.resolvedCommand ? { resolvedCommand: runtime.resolvedCommand } : {}),
      }));
    const descriptorIds = new Set(descriptors.map((runtime) => runtime.id));
    const detectedOnly = (acpDetection.installedAgents ?? [])
      .filter((agent) => !descriptorIds.has(agent.id))
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        kind: 'acp' as const,
        status: agent.status ?? 'available',
        ...(agent.binaryPath ? { binaryPath: agent.binaryPath } : {}),
        ...(agent.reason ? {
          availability: {
            checkedAt: new Date().toISOString(),
            sources: ['acp-detect' as const],
            reason: agent.reason,
          },
        } : {}),
        ...(agent.resolvedCommand ? { resolvedCommand: agent.resolvedCommand } : {}),
      }));
    return [...descriptors, ...detectedOnly];
  }, [acpDetection.installedAgents, acpDetection.runtimes]);
  const selectedRuntimeChecking = useMemo(() => {
    if (!selectedAgentRuntime || selectedAgentRuntime.kind === 'mindos') return false;
    const nativeKind = selectedAgentRuntime.kind;
    if (nativeKind !== 'codex' && nativeKind !== 'claude') return false;
    return nativeDetection.loadingByKind?.[nativeKind] === true;
  }, [nativeDetection.loadingByKind, selectedAgentRuntime]);
  const selectedRuntimeUnavailable = useMemo(() => {
    if (!selectedAgentRuntime || selectedAgentRuntime.kind === 'mindos') return null;
    if (selectedAgentRuntime.kind === 'acp') {
      const descriptor = acpRuntimes.find((runtime) => runtime.kind === 'acp' && runtime.id === selectedAgentRuntime.id);
      if (!descriptor?.status || descriptor.status === 'available') return null;
      return {
        status: descriptor.status,
        reason: descriptor.availability?.reason ?? descriptor.description,
      };
    }
    const nativeKind = selectedAgentRuntime.kind;
    if (nativeKind !== 'codex' && nativeKind !== 'claude') return null;
    const detectionError = nativeDetection.errorByKind?.[nativeKind];
    if (detectionError && !nativeDetection.loadingByKind?.[nativeKind]) {
      return {
        status: 'error' as const,
        reason: detectionError,
      };
    }
    const descriptor = (nativeDetection.runtimes ?? []).find((runtime) => (
      runtime.kind === nativeKind && runtime.id === selectedAgentRuntime.id
    ));
    if (!descriptor) {
      if (nativeDetection.loadingByKind?.[nativeKind]) return null;
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
  }, [acpRuntimes, nativeDetection.errorByKind, nativeDetection.loadingByKind, nativeDetection.runtimes, selectedAgentRuntime]);
  const [aiConfigStatus, setAiConfigStatus] = useState<'unknown' | 'configured' | 'not-configured'>('unknown');

  useEffect(() => {
    if (!visible || !isMindosRuntime) {
      setAiConfigStatus('unknown');
      return;
    }

    let cancelled = false;
    const checkAiConfig = async () => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Settings load failed (${res.status})`);
        const data = await res.json() as SettingsJsonForAi;
        if (!cancelled) {
          setAiConfigStatus(isAiConfiguredForAgentTurn(data, providerOverride) ? 'configured' : 'not-configured');
        }
      } catch {
        if (!cancelled) setAiConfigStatus('unknown');
      }
    };

    void checkAiConfig();
    const onSettingsChange = () => void checkAiConfig();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkAiConfig();
    };
    window.addEventListener('mindos:settings-changed', onSettingsChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('mindos:settings-changed', onSettingsChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isMindosRuntime, providerOverride, visible]);

  const activeRuntimeSessionBinding = useMemo(
    () => getMatchingRuntimeSessionBinding(session.activeSession, selectedAgentRuntime),
    [
      selectedAgentRuntime,
      session.activeSession?.externalAgentBinding,
      session.activeSession?.runtimeSessionBinding,
    ],
  );
  const projectScopedSessions = useMemo(() => {
    if (!projectId) return session.sessions;
    return session.sessions.filter((item) => (item.projectId || undefined) === projectId);
  }, [projectId, session.sessions]);
  const runtimeScopedSessions = useMemo(() => {
    return filterSessionsByRuntimeLane(projectScopedSessions, selectedAgentRuntime);
  }, [projectScopedSessions, selectedAgentRuntime]);
  const runtimeScopedActiveSessionId = useMemo(
    () => runtimeScopedSessions.some((item) => item.id === session.activeSessionId)
      ? session.activeSessionId
      : null,
    [runtimeScopedSessions, session.activeSessionId],
  );
  const runtimeSessionCapabilities = useMemo(
    () => getRuntimeSessionAdapterCapabilities(selectedAgentRuntime),
    [selectedAgentRuntime?.id, selectedAgentRuntime?.kind, selectedAgentRuntime?.name],
  );
  const loadRuntimeSessions = useCallback(async () => {
    const runtime = selectedAgentRuntimeRef.current;
    const capabilities = getRuntimeSessionAdapterCapabilities(runtime);
    if (!runtime || !capabilities.supportsList) {
      setRuntimeSessions([]);
      setRuntimeSessionsError(null);
      setRuntimeSessionsLoading(false);
      setRuntimeSessionActionId(null);
      return;
    }

    const seq = runtimeSessionsRequestSeqRef.current + 1;
    runtimeSessionsRequestSeqRef.current = seq;
    setRuntimeSessionsLoading(true);
    setRuntimeSessionsError(null);

    try {
      const entries = await listRuntimeSessions(runtime, { cwd: runtimeSessionListCwd(sessionRef.current.activeSession) });
      if (runtimeSessionsRequestSeqRef.current === seq) {
        setRuntimeSessions(entries);
      }
    } catch (error) {
      if (runtimeSessionsRequestSeqRef.current === seq) {
        const message = error instanceof Error && error.message
          ? error.message
          : 'Failed to load runtime sessions.';
        setRuntimeSessionsError(message);
      }
    } finally {
      if (runtimeSessionsRequestSeqRef.current === seq) {
        setRuntimeSessionsLoading(false);
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

  useLayoutEffect(() => {
    queuedFollowUpsRef.current = queuedFollowUps;
  }, [queuedFollowUps]);

  useEffect(() => {
    if (!visible || !showHistory) return;
    if (runtimeSessionCapabilities.supportsList) {
      void loadRuntimeSessions();
      return;
    }
    setRuntimeSessions([]);
    setRuntimeSessionsError(null);
    setRuntimeSessionsLoading(false);
    setRuntimeSessionActionId(null);
  }, [loadRuntimeSessions, runtimeSessionCapabilities.supportsList, selectedAgentRuntime?.id, selectedAgentRuntime?.kind, showHistory, visible]);

  const resetInputState = useCallback(() => {
    setComposerValue('');
    setSelectedSkill(null);
    setAttachedFiles(currentFile ? [currentFile] : []);
    setDropError('');
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
  const chat = useAgentChat({
    currentFile,
    providerOverride,
    modelOverride,
    permissionMode,
    nativeRuntimeOptions,
    acpRuntimeOptions,
    activeSessionId: session.activeSessionId,
    onFirstMessage,
    refs: chatRefs,
    errorLabels: {
      noResponse: t.ask.errorNoResponse,
      stopped: t.ask.stopped,
      concurrentLimit: t.ask.concurrentLimit,
      tabLimitReached: t.workspaceTabs?.tabLimitReached ?? 'Tab limit reached (50). Close a tab to open another.',
    },
    resetInputState,
    onRestoreInput: handleRestoreInput,
    onTransientError: setDropError,
  });
  const { isLoading, loadingPhase, reconnectAttempt, reconnectMax, contextUsage } = chat;
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
  const handleQueuedTextSubmit = chat.submitTextOnly;
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

    const target = sessionRef.current.sessions.find((item) => (
      (!projectId || (item.projectId || undefined) === projectId)
      && isSessionInRuntimeLane(item, agent)
    ));
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
  }, [bindActiveSessionToRuntime, chat.isLoadingRef, clearTransientComposerState, projectId, updateSelectedAgentRuntime]);

  const hasLoadingAttachments = localAttachments.some((f) => f.status === 'loading');
  const runtimeCheckingMessage = selectedAgentRuntime && selectedRuntimeChecking
    ? `Checking ${selectedAgentRuntime.name} status...`
    : '';
  const runtimeUnavailableMessage = selectedAgentRuntime && selectedRuntimeUnavailable
    ? `${selectedAgentRuntime.name} is ${runtimeStatusLabel(selectedRuntimeUnavailable.status)}.${selectedRuntimeUnavailable.reason ? ` ${compactRuntimeDisplayReason(selectedRuntimeUnavailable.reason, { runtime: selectedAgentRuntime.kind === 'codex' || selectedAgentRuntime.kind === 'claude' ? selectedAgentRuntime.kind : undefined })}` : ''}`
    : '';
  const providerNotConfigured = isMindosRuntime && aiConfigStatus === 'not-configured';
  const providerNotConfiguredMessage = providerNotConfigured ? t.ask.providerNotConfigured : '';
  const composerStatusMessage = uploadError || imageError || dropError || runtimeCheckingMessage || runtimeUnavailableMessage || providerNotConfiguredMessage;
  const queueFollowUpTitle = t.ask.queueFollowUpTitle ?? 'Queue follow-up';
  const queuedFollowUpState = t.ask.queuedFollowUpState ?? 'Queued';
  const followUpPlaceholder = t.ask.followUpPlaceholder ?? 'Ask for follow-up changes';
  const queuedFollowUpTextOnly = t.ask.queuedFollowUpTextOnly ?? 'Finish the current run before sending files, images, or skills.';
  const removeQueuedFollowUp = t.ask.removeQueuedFollowUp ?? 'Remove queued follow-up';
  const activeQueuedFollowUps = useMemo(() => {
    const activeSessionId = session.activeSessionId;
    if (!activeSessionId) return [];
    return queuedFollowUps.filter((item) => item.sessionId === activeSessionId);
  }, [queuedFollowUps, session.activeSessionId]);

  const openAiSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent('mindos:open-settings', { detail: { tab: 'ai' } }));
  }, []);

  const enqueueFollowUp = useCallback(() => {
    const sessionId = sessionRef.current.activeSessionId ?? null;
    if (!sessionId) return false;
    const content = inputValueRef.current.trim();
    if (!content) return false;
    const uploads = uploadRef.current.localAttachments;
    if (uploads.some((file) => file.status === 'loading')) {
      setDropError(t.ask.uploadsProcessing ?? 'Wait for uploaded files to finish processing before sending.');
      return false;
    }
    const hasQueuedPayload = imageUploadRef.current.images.length > 0
      || uploads.length > 0
      || selectedSkillRef.current !== null
      || attachedFilesRef.current.some((file) => file !== currentFile);
    if (hasQueuedPayload) {
      setDropError(queuedFollowUpTextOnly);
      return false;
    }
    setQueuedFollowUps((prev) => ([
      ...prev,
      {
        id: createQueuedFollowUpId(),
        sessionId,
        content,
      },
    ]));
    setDropError('');
    setComposerValue('');
    mentionRef.current.resetMention();
    slashRef.current.resetSlash();
    setSelectedSkill(null);
    setTimeout(() => inputRef.current?.focus(), 0);
    return true;
  }, [currentFile, queuedFollowUpTextOnly, setComposerValue, t.ask.uploadsProcessing]);

  const handleSubmitWithRuntimeGuard = useCallback((event: React.FormEvent) => {
    if (selectedRuntimeChecking || selectedRuntimeUnavailable || providerNotConfigured) {
      event.preventDefault();
      return;
    }
    if (chat.isLoadingRef.current) {
      event.preventDefault();
      enqueueFollowUp();
      return;
    }
    void handleSubmit(event);
  }, [chat.isLoadingRef, enqueueFollowUp, handleSubmit, providerNotConfigured, selectedRuntimeChecking, selectedRuntimeUnavailable]);

  const removeQueuedFollowUpById = useCallback((id: string) => {
    setQueuedFollowUps((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const drainQueuedFollowUps = useCallback(() => {
    if (!visible || showHistory || isLoading || drainingQueuedFollowUpRef.current) return;
    if (selectedRuntimeChecking || selectedRuntimeUnavailable || providerNotConfigured) return;
    const sessionId = sessionRef.current.activeSessionId ?? null;
    if (!sessionId) return;
    const next = queuedFollowUpsRef.current.find((item) => item.sessionId === sessionId);
    if (!next) return;

    drainingQueuedFollowUpRef.current = true;
    setQueuedFollowUps((prev) => prev.filter((item) => item.id !== next.id));
    let startedTurn = false;
    void handleQueuedTextSubmit(next.content)
      .then((started) => {
        startedTurn = started;
        if (started) return;
        setQueuedFollowUps((prev) => (
          prev.some((item) => item.id === next.id) ? prev : [next, ...prev]
        ));
      })
      .finally(() => {
        drainingQueuedFollowUpRef.current = false;
        if (startedTurn) setQueueDrainSignal((value) => value + 1);
      });
  }, [handleQueuedTextSubmit, isLoading, providerNotConfigured, selectedRuntimeChecking, selectedRuntimeUnavailable, showHistory, visible]);

  useEffect(() => {
    drainQueuedFollowUps();
  }, [drainQueuedFollowUps, queueDrainSignal, queuedFollowUps, session.activeSessionId]);

  useEffect(() => {
    const handler = (event: Event) => {
      if (chat.isLoadingRef.current) return;
      const detail = normalizeRuntimeCommandInsertDetail((event as CustomEvent).detail);
      if (!detail) return;
      if (detail.runtime) {
        handleSelectAgentRuntime(detail.runtime);
      }
      slashRef.current.resetSlash();
      setSelectedSkill(null);
      setShowHistory(false);
      setComposerValue(detail.text);
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    window.addEventListener(RUNTIME_COMMAND_INSERT_EVENT, handler);
    return () => window.removeEventListener(RUNTIME_COMMAND_INSERT_EVENT, handler);
  }, [chat.isLoadingRef, handleSelectAgentRuntime, setComposerValue]);

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
  const prevOpenRequestIdRef = useRef(openRequestId);
  useEffect(() => {
    const justOpened = variant === 'panel' || variant === 'home'
      ? (visible && !prevVisibleRef.current)  // panel/home: edge detection
      : visible;                               // modal: level detection (reset every open)
    const requestChanged = visible && openRequestId !== undefined && openRequestId !== prevOpenRequestIdRef.current;

    // Detect file change while panel is already open
    const fileChanged = visible && prevVisibleRef.current && currentFile !== prevFileRef.current;

    if (justOpened || requestChanged) {
      const openerRuntime = initialAgentRuntime ?? toAgentRuntime(initialAcpAgent);
      const preferredRuntime = openerRuntime ?? loadLastSelectedAgentRuntime();
      pendingOpenAgentRef.current = preferredRuntime;
      if (openerRuntime) persistLastSelectedAgentRuntime(openerRuntime);
      setTimeout(() => inputRef.current?.focus(), 50);
      if (initialNewSession) {
        session.resetSession(preferredRuntime ?? undefined);
      } else if (initialSessionId) {
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
    prevOpenRequestIdRef.current = openRequestId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentFile, openRequestId]);

  useEffect(() => {
    if (!visible || !contextRequest) return;
    const path = contextRequest.path;
    setAttachedFiles(prev => prev.includes(path) ? prev : [...prev, path]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [contextRequest, visible]);

  useEffect(() => {
    if (!visible || !session.activeSessionId) return;

    const openerRuntime = pendingOpenAgentRef.current;
    const sessionRuntime = getSessionAgentRuntime(session.activeSession);
    const restoredRuntime = sessionRuntime ?? openerRuntime ?? null;
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

  // Persistence is handled by agent-run-store (every message write schedules a
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
    if (item.type === 'runtime-command') {
      const command = `/${item.name} `;
      const nextCursor = slashIdx + command.length;
      const newVal = val.slice(0, slashIdx) + command + val.slice(cursorPos);
      setComposerValue(newVal);
      setSelectedSkill(null);
      slashRef.current.resetSlash();
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextCursor, nextCursor);
      }, 0);
      return;
    }
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
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (inputValueRef.current.trim() || imageUploadRef.current.images.length > 0)) {
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

  const handleNewSessionActivation = useCallback((detail: AskPanelNewSessionDetail): boolean => {
    // Project-scoped launchers, like Studio seed sessions, need to create the
    // same lane that /chat/new?projectId=... would create without replacing the
    // already-open Ask surface with the full-page route.
    const runtime = selectedAgentRuntimeRef.current;
    const requestedProjectId = detail.projectId?.trim() || undefined;
    const requestedTitle = detail.title?.trim() || undefined;
    if (requestedProjectId || requestedTitle) {
      resetStoredSession({
        currentFile,
        projectId: requestedProjectId ?? projectId,
        runtime,
      });
      const id = getActiveSessionId();
      if (id && requestedTitle) renameStoredSession(id, requestedTitle);
    } else {
      sessionRef.current.resetSession(runtime);
    }
    updateSelectedAgentRuntime(runtime);
    clearTransientComposerState();
    return true;
  }, [clearTransientComposerState, currentFile, projectId, updateSelectedAgentRuntime]);

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
          console.error('[ChatContent] Drop file processing failed:', err);
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

  const importBoundRuntimeSessionHistoryIfNeeded = useCallback((targetSession: ChatSession, targetRuntime: AgentRuntimeIdentity | null) => {
    void (async () => {
      try {
        const result = await importBoundRuntimeSessionHistory(
          targetSession,
          targetRuntime,
          sessionRef.current.attachRuntimeSession,
        );
        if (result.status === 'refused') setDropError(t.ask.sessionRunningRetry);
      } catch (error) {
        const message = error instanceof Error && error.message
          ? error.message
          : 'Failed to load runtime session history.';
        setDropError(message);
      }
    })();
  }, [t.ask.sessionRunningRetry]);

  const handleLoadSession = useCallback((id: string): boolean => {
    // Concurrency: switching away from a streaming session is allowed — its
    // run keeps writing to the store and the list shows a running indicator.
    const targetSession = session.sessions.find((item) => item.id === id) ?? null;
    if (!targetSession) return false;
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
    importBoundRuntimeSessionHistoryIfNeeded(targetSession, targetRuntime);
    setTimeout(() => inputRef.current?.focus(), 0);
    return true;
  }, [chat.isLoadingRef, currentFile, importBoundRuntimeSessionHistoryIfNeeded, session.sessions, updateSelectedAgentRuntime]);

  useEffect(() => {
    if (!visible || maximized || (variant !== 'panel' && variant !== 'modal')) return;
    const handleAskPanelSessionActivation = (event: Event) => {
      if (event.defaultPrevented) return;
      const detail = getAskPanelSessionActivationDetail(event);
      if (!detail) return;
      if (detail.action === 'new') {
        if (handleNewSessionActivation(detail)) event.preventDefault();
        return;
      }
      if (handleLoadSession(detail.sessionId)) {
        event.preventDefault();
      }
    };
    window.addEventListener(ASK_PANEL_SESSION_ACTIVATE_EVENT, handleAskPanelSessionActivation);
    return () => window.removeEventListener(ASK_PANEL_SESSION_ACTIVATE_EVENT, handleAskPanelSessionActivation);
  }, [handleLoadSession, handleNewSessionActivation, maximized, variant, visible]);

  const handleDeleteSession = useCallback((id: string) => {
    // Deleting a running session is allowed: the store aborts its run and
    // clears timers/messages before the metadata goes (no zombie writes).
    const runtime = selectedAgentRuntimeRef.current;
    sessionRef.current.deleteSession(id, runtime);
    setQueuedFollowUps((prev) => prev.filter((item) => item.sessionId !== id));
    if (sessionRef.current.activeSessionId === id) {
      updateSelectedAgentRuntime(runtime);
      clearTransientComposerState();
    }
  }, [clearTransientComposerState, updateSelectedAgentRuntime]);

  const handleForkSession = useCallback((id: string) => {
    const targetSession = sessionRef.current.sessions.find((item) => item.id === id) ?? null;
    const forkedId = sessionRef.current.forkSession(id);
    if (!forkedId) return;
    const targetRuntime = getSessionAgentRuntime(targetSession);
    updateSelectedAgentRuntime(targetRuntime);
    persistLastSelectedAgentRuntime(targetRuntime);
    clearTransientComposerState();
  }, [clearTransientComposerState, updateSelectedAgentRuntime]);

  const handleClearRuntimeHistory = useCallback(() => {
    if (chat.isLoadingRef.current) return;
    const runtime = selectedAgentRuntimeRef.current;
    const ids = sessionRef.current.sessions
      .filter((item) => (
        (!projectId || (item.projectId || undefined) === projectId)
        && isSessionInRuntimeLane(item, runtime)
      ))
      .map((item) => item.id);
    sessionRef.current.clearSessions(ids, runtime);
    updateSelectedAgentRuntime(runtime);
    clearTransientComposerState();
  }, [chat.isLoadingRef, clearTransientComposerState, projectId, updateSelectedAgentRuntime]);

  const handleAttachRuntimeSession = useCallback(async (entry: RuntimeSessionEntry) => {
    if (chat.isLoadingRef.current || runtimeSessionActionId) return;
    const runtime = selectedAgentRuntimeRef.current;
    if (!runtime || runtime.kind !== entry.runtime.kind || runtime.id !== entry.runtime.id) return;

    setRuntimeSessionActionId(entry.id);
    setRuntimeSessionsError(null);
    try {
      const { entry: readEntry, messages: importedMessages } = await readRuntimeSessionHistory(entry);
      const attachRuntime = compactAgentRuntimeIdentity(readEntry.runtime) ?? readEntry.runtime;
      const attached = sessionRef.current.attachRuntimeSession(attachRuntime, runtimeSessionEntryAttachBinding(readEntry), {
        title: runtimeSessionEntryTitle(readEntry, 42),
        ...(importedMessages.length > 0 ? { messages: importedMessages } : {}),
      });
      if (!attached) {
        // The matched local session has a live run — rebinding mid-run is refused.
        setRuntimeSessionsError(t.ask.sessionRunningRetry);
        return;
      }

      setRuntimeSessions((prev) => [readEntry, ...prev.filter((item) => item.id !== readEntry.id)]);
      updateSelectedAgentRuntime(attachRuntime);
      clearTransientComposerState();
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Failed to load runtime session history.';
      setRuntimeSessionsError(message);
    } finally {
      setRuntimeSessionActionId(null);
    }
  }, [chat.isLoadingRef, clearTransientComposerState, runtimeSessionActionId, t.ask.sessionRunningRetry, updateSelectedAgentRuntime]);

  const handleForkRuntimeSession = useCallback(async (entry: RuntimeSessionEntry) => {
    if (chat.isLoadingRef.current || runtimeSessionActionId) return;
    const runtime = selectedAgentRuntimeRef.current;
    if (!runtime || runtime.kind !== entry.runtime.kind || runtime.id !== entry.runtime.id) return;
    setRuntimeSessionActionId(entry.id);
    setRuntimeSessionsError(null);
    try {
      const forked = await forkRuntimeSession(entry);
      setRuntimeSessions((prev) => [forked, ...prev.filter((item) => item.id !== forked.id)]);
      const attachRuntime = compactAgentRuntimeIdentity(forked.runtime) ?? forked.runtime;
      const attached = sessionRef.current.attachRuntimeSession(attachRuntime, runtimeSessionEntryAttachBinding(forked), {
        title: runtimeSessionEntryTitle(forked, 42),
      });
      if (!attached) {
        setRuntimeSessionsError(t.ask.sessionRunningRetry);
        return;
      }
      updateSelectedAgentRuntime(attachRuntime);
      clearTransientComposerState();
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Failed to fork runtime session.';
      setRuntimeSessionsError(message);
    } finally {
      setRuntimeSessionActionId(null);
    }
  }, [chat.isLoadingRef, clearTransientComposerState, runtimeSessionActionId, t.ask.sessionRunningRetry, updateSelectedAgentRuntime]);

  const handleArchiveRuntimeSession = useCallback(async (entry: RuntimeSessionEntry) => {
    if (chat.isLoadingRef.current || runtimeSessionActionId) return;
    const runtime = selectedAgentRuntimeRef.current;
    if (!runtime || runtime.kind !== entry.runtime.kind || runtime.id !== entry.runtime.id) return;
    setRuntimeSessionActionId(entry.id);
    setRuntimeSessionsError(null);
    try {
      await archiveRuntimeSession(entry);
      setRuntimeSessions((prev) => prev.filter((item) => item.id !== entry.id));
      const activeBinding = getMatchingRuntimeSessionBinding(sessionRef.current.activeSession, runtime);
      if (activeBinding?.externalSessionId === entry.id) {
        const binding = runtimeSessionEntryAttachBinding(entry);
        sessionRef.current.setSessionAgentRuntimeBinding(compactAgentRuntimeIdentity(runtime) ?? runtime, {
          externalSessionId: binding.externalSessionId,
          ...(binding.cwd ? { cwd: binding.cwd } : {}),
          status: 'archived',
          updatedAt: Date.now(),
        });
      }
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Failed to archive runtime session.';
      setRuntimeSessionsError(message);
    } finally {
      setRuntimeSessionActionId(null);
    }
  }, [chat.isLoadingRef, runtimeSessionActionId]);

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

  const commitSessionModelSelection = useCallback((provider: ProviderSelection, model: string | null) => {
    session.setSessionModelSelection(toSessionModelSelection(provider, model));
  }, [session.setSessionModelSelection]);

  const handleProviderChange = useCallback((p: ProviderSelection) => {
    providerOverrideRef.current = p;
    setProviderOverride(p);
    setModelOverride(null);
    commitSessionModelSelection(p, null);
  }, [commitSessionModelSelection]);

  const handleModelChange = useCallback((model: string | null) => {
    const provider = providerOverrideRef.current;
    setModelOverride(model);
    if (!model) return;
    commitSessionModelSelection(provider, model);
  }, [commitSessionModelSelection]);

  const handleNativeRuntimeOptionsChange = useCallback((next: NativeRuntimeOptions) => {
    setNativeRuntimeOptions(next);
    const runtime = selectedAgentRuntimeRef.current;
    if (runtime?.kind === 'codex' || runtime?.kind === 'claude') {
      persistNativeRuntimeOptions(runtime.kind, next);
    }
  }, []);
  const handleAcpRuntimeOptionsChange = useCallback((next: AcpRuntimeOptions) => {
    setAcpRuntimeOptions(next);
    const runtime = selectedAgentRuntimeRef.current;
    if (runtime?.kind === 'acp') {
      persistAcpRuntimeOptions(runtime.id, next);
    }
  }, []);
  const handleRefreshRuntimeState = useCallback(() => {
    nativeDetection.refresh();
    acpDetection.refresh();
    runtimeReadiness.refresh();
    void runtimeSessionProjection.refresh();
  }, [acpDetection.refresh, nativeDetection.refresh, runtimeReadiness.refresh, runtimeSessionProjection.refresh]);

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
        onClose={isHome ? undefined : onClose}
        onDockToPanel={maximized ? onDockToPanel : undefined}
        sessions={runtimeScopedSessions}
        activeSessionId={runtimeScopedActiveSessionId}
        onLoadSession={handleLoadSession}
        onDeleteSession={handleDeleteSession}
        onForkSession={handleForkSession}
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
        runtimeReadinessByRuntimeId={runtimeReadiness.readinessByRuntimeId}
        runtimeReadinessLoading={runtimeReadiness.loading}
        acpRuntimes={acpRuntimes}
        acpLoading={acpDetection.loading}
        acpError={acpDetection.error}
        onRefreshNativeRuntimes={handleRefreshRuntimeState}
      />

      {showHistory && (
        <SessionHistoryPanel
          sessions={runtimeScopedSessions}
          activeSessionId={runtimeScopedActiveSessionId}
          selectedAgentRuntime={selectedAgentRuntime}
          runtimeSessions={runtimeSessions}
          runtimeSessionsLoading={runtimeSessionsLoading}
          runtimeSessionsError={runtimeSessionsError}
          runtimeSessionActionId={runtimeSessionActionId}
          runtimeSessionsSupported={runtimeSessionCapabilities.supportsList}
          onLoad={handleLoadSession}
          onDelete={handleDeleteSession}
          onForkSession={handleForkSession}
          onRename={session.renameSession}
          onTogglePin={session.togglePinSession}
          onClearAll={handleClearRuntimeHistory}
          onClose={closeHistory}
          onNewChat={handleResetSession}
          onRefreshRuntimeSessions={loadRuntimeSessions}
          onAttachRuntimeSession={handleAttachRuntimeSession}
          onForkRuntimeSession={handleForkRuntimeSession}
          onArchiveRuntimeSession={handleArchiveRuntimeSession}
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
          <SessionContextDock
            session={session.activeSession}
            labels={t.ask.sessionContext}
            workDirEditable={Boolean(session.activeSessionId && canEditSessionWorkDir(session.activeSessionId))}
            compact={isPanel || isHome}
            onSetWorkDir={session.setSessionWorkDir}
            onSetContextSelection={session.setSessionContextSelection}
          />

          {activeQueuedFollowUps.length > 0 && (
            <div className="border-b border-border/25 bg-background/30 px-3 py-1.5" data-follow-up-queue>
              <div className="space-y-0.5">
                {activeQueuedFollowUps.map((item) => (
                  <div key={item.id} className="flex min-h-7 items-center gap-2 text-sm text-foreground/70">
                    <CornerDownRight size={13} className="shrink-0 text-muted-foreground/60" />
                    <span className="min-w-0 flex-1 truncate" title={item.content}>{item.content}</span>
                    <span className="shrink-0 text-2xs font-medium text-muted-foreground/60">{queuedFollowUpState}</span>
                    <button
                      type="button"
                      className="hit-target-box shrink-0 p-1 text-muted-foreground/70 transition-colors hover:text-foreground [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
                      title={removeQueuedFollowUp}
                      aria-label={removeQueuedFollowUp}
                      onClick={() => removeQueuedFollowUpById(item.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-error">
                  <span>{composerStatusMessage}</span>
                  {providerNotConfigured && (
                    <button
                      type="button"
                      className="font-medium underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      onClick={openAiSettings}
                    >
                      {t.ask.configureProvider}
                    </button>
                  )}
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
              placeholder={isLoading ? followUpPlaceholder : t.ask.placeholder}
              sendTitle={hasLoadingAttachments ? (t.ask.uploadsProcessing ?? 'Wait for uploaded files to finish processing before sending.') : runtimeCheckingMessage || runtimeUnavailableMessage || providerNotConfiguredMessage || (isLoading ? queueFollowUpTitle : t.ask.send)}
              stopTitle={loadingPhase === 'reconnecting' ? t.ask.cancelReconnect : t.ask.stopTitle}
              sendDisabledExternal={hasLoadingAttachments || selectedRuntimeChecking || !!selectedRuntimeUnavailable || providerNotConfigured}
              allowEmptySend={!isLoading && images.length > 0}
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
              {mounted && isAcpRuntime && (
                <AcpRuntimeOptionsCapsule
                  projection={runtimeSessionProjection.selectedProjection}
                  runtime={selectedAgentRuntime}
                  value={acpRuntimeOptions}
                  onChange={handleAcpRuntimeOptionsChange}
                  controlKeys={['mode']}
                  disabled={isLoading}
                />
              )}
              <ModeCapsule mode={permissionMode} onChange={setPermissionMode} disabled={isLoading} />
              {mounted && isAcpRuntime && (
                <AcpRuntimeOptionsCapsule
                  projection={runtimeSessionProjection.selectedProjection}
                  runtime={selectedAgentRuntime}
                  value={acpRuntimeOptions}
                  onChange={handleAcpRuntimeOptionsChange}
                  controlKeys={['model', 'thoughtLevel']}
                  disabled={isLoading}
                />
              )}
              {mounted && isMindosRuntime && (
                <ProviderModelCapsule
                  providerValue={providerOverride}
                  onProviderChange={handleProviderChange}
                  modelValue={modelOverride}
                  onModelChange={handleModelChange}
                  disabled={isLoading}
                  persistSelection={false}
                />
              )}
              {mounted && isNativeRuntime && selectedNativeRuntimeKind && (
                <NativeRuntimeOptionsCapsule
                  runtimeKind={selectedNativeRuntimeKind}
                  value={nativeRuntimeOptions}
                  onChange={handleNativeRuntimeOptionsChange}
                  disabled={isLoading}
                />
              )}
              <ContextStatusButton usage={contextUsage} />
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
