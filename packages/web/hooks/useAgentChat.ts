'use client';

import { useRef, useCallback, useLayoutEffect } from 'react';
import type { AcpRuntimeOptions, AgentIdentity, AgentPermissionMode, AgentRuntimeIdentity, Message, MessagePart, ImagePart, LocalAttachment, RuntimeSessionBinding, NativeRuntimeOptions } from '@/lib/types';
import type { ProviderId } from '@/lib/agent/providers';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';
import { MINDOS_AGENT, annotateMessageWithAgentRuntime, compactAgentRuntimeIdentity, getMatchingRuntimeSessionBinding } from '@/lib/ask-agent';
import { isRetryableError, retryDelay, sleep } from '@/lib/agent/reconnect';
import { buildAgentTurnEndpoint } from '@/lib/agent-turn-endpoint';
import {
  MAX_CONCURRENT_RUNS,
  appendMessages as storeAppendMessages,
  endRun,
  getMessages as storeGetMessages,
  getRun,
  getRunCount,
  isInSubmitCooldown,
  replaceLastMessage,
  setMessages as storeSetMessages,
  startRun,
  startSubmitCooldown,
  updateRun,
  useSessionContextUsage,
  useSessionRun,
  writeContextUsage,
  writeRuntimeBinding,
} from '@/lib/agent-run-store';
import { getSessionSubmitContextSnapshot } from '@/lib/agent-session-store';
import { openTab } from '@/lib/workspace-tabs';
import { toast } from '@/lib/toast';
import { describeOversizedAiAttachments, getOversizedAiAttachments } from '@/lib/agent/attachment-limits';

export type LoadingPhase = 'connecting' | 'thinking' | 'streaming' | 'reconnecting';

type AgentRequestRuntime = AgentRuntimeIdentity & {
  binaryPath?: string;
};

const MINDOS_RUNTIME: AgentRuntimeIdentity = { ...MINDOS_AGENT, kind: 'mindos' };
const ESTABLISHED_RUN_REATTACH_ATTEMPTS = 180;

function runtimeForAgentRequest(runtime: AgentRequestRuntime | null | undefined): AgentRequestRuntime | null {
  if (!runtime) return null;
  return {
    id: runtime.id,
    name: runtime.name,
    kind: runtime.kind,
    ...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
  };
}

function chatTabTitleFromDraft(text: string, fallback = 'Chat session'): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return fallback;
  return line.length > 42 ? `${line.slice(0, 42)}...` : line;
}

export interface AgentChatRefs {
  inputValueRef: React.RefObject<string>;
  mentionRef: React.RefObject<{ mentionQuery: string | null }>;
  slashRef: React.RefObject<{ slashQuery: string | null }>;
  imageUploadRef: React.RefObject<{ images: ImagePart[]; clearImages: () => void }>;
  sessionRef: React.RefObject<{
    activeSession?: {
      runtimeSessionBinding?: RuntimeSessionBinding | null;
      externalAgentBinding?: {
        runtime: 'acp' | 'codex' | 'claude';
        externalSessionId?: string;
        cwd?: string;
        status?: 'active' | 'missing' | 'signed-out';
        updatedAt: number;
      } | null;
    } | null;
    activeSessionId?: string | null;
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setSessionAgentRuntimeBinding?: (
      runtime: AgentRuntimeIdentity,
      binding?: { externalSessionId?: string; cwd?: string; status?: RuntimeSessionBinding['status']; updatedAt?: number },
    ) => void;
  }>;
  uploadRef: React.RefObject<{
    localAttachments: LocalAttachment[];
  }>;
  selectedSkillRef: React.RefObject<{ name: string } | null>;
  selectedAgentRuntimeRef: React.RefObject<(AgentRuntimeIdentity & { binaryPath?: string }) | null>;
  attachedFilesRef: React.RefObject<string[]>;
  permissionModeRef?: React.RefObject<AgentPermissionMode>;
}

interface UseAgentChatOpts {
  currentFile?: string;
  providerOverride: ProviderId | `p_${string}` | null;
  modelOverride: string | null;
  permissionMode?: AgentPermissionMode;
  nativeRuntimeOptions?: NativeRuntimeOptions;
  acpRuntimeOptions?: AcpRuntimeOptions;
  activeSessionId: string | null;
  onFirstMessage?: () => void;
  refs: AgentChatRefs;
  errorLabels: { noResponse: string; stopped: string; concurrentLimit: string; tabLimitReached: string };
  resetInputState: () => void;
  onRestoreInput?: (userMessage: Message) => void;
  onTransientError?: (message: string) => void;
}

interface TurnSubmitSnapshot {
  sessionId: string;
  text: string;
  skill: { name: string } | null;
  images: ImagePart[];
  explicitAttachedFiles: string[];
  requestAttachedFiles: string[];
  uploadAttachments: LocalAttachment[];
  onSubmitStarted: () => void;
  restoreInputOnContextError: boolean;
}

const SESSION_CONTEXT_ERROR_CODES = new Set([
  'workdir_missing',
  'workdir_not_directory',
  'workdir_outside_allowed_roots',
  'workdir_changed_after_history',
  'runtime_cwd_locked',
  'runtime_resume_untrusted',
]);

function isWorkDirContextError(error: Error & { httpStatus?: number; issueCode?: string }): boolean {
  return error.httpStatus === 409 && (
    (!!error.issueCode && SESSION_CONTEXT_ERROR_CODES.has(error.issueCode))
    || /\bWorkDir\b/i.test(error.message)
  );
}

function buildAgentRunReattachEndpoint(chatSessionId: string, rootRunId: string): string {
  const params = new URLSearchParams({
    chatSessionId,
    rootRunId,
  });
  return `/api/agent-runs/reattach?${params.toString()}`;
}

function mergeTextByOverlap(existing: string, incoming: string): string {
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.startsWith(incoming)) return existing;

  const max = Math.min(existing.length, incoming.length);
  for (let size = max; size > 0; size--) {
    if (existing.endsWith(incoming.slice(0, size))) {
      return existing + incoming.slice(size);
    }
  }
  return existing + incoming;
}

function nonTextPartKey(part: MessagePart): string {
  if (part.type === 'tool-call') return `tool:${part.toolCallId}`;
  if (part.type === 'runtime-status') return `runtime-status:${part.runtime ?? ''}:${part.message}`;
  if (part.type === 'agent-run-timeline') return `timeline:${part.chatSessionId}:${part.rootRunId ?? ''}:${part.startedAfter ?? ''}`;
  if (part.type === 'reasoning') return `reasoning:${part.text}`;
  if (part.type === 'image') return `image:${part.fileName ?? ''}:${part.path ?? ''}`;
  return `part:${JSON.stringify(part)}`;
}

function mergeNonTextParts(existingParts?: MessagePart[], incomingParts?: MessagePart[]): MessagePart[] {
  const merged: MessagePart[] = [];
  const indexByKey = new Map<string, number>();
  const add = (part: MessagePart) => {
    if (part.type === 'text') return;
    const key = nonTextPartKey(part);
    const existingIndex = indexByKey.get(key);
    if (existingIndex !== undefined) {
      merged[existingIndex] = part;
      return;
    }
    indexByKey.set(key, merged.length);
    merged.push(part);
  };
  existingParts?.forEach(add);
  incomingParts?.forEach(add);
  return merged;
}

function mergeReattachedAssistantMessage(existing: Message | null | undefined, incoming: Message): Message {
  if (!existing || existing.role !== 'assistant' || incoming.role !== 'assistant') return incoming;
  const existingContent = existing.content ?? '';
  const incomingContent = incoming.content ?? '';
  if (!existingContent) return incoming;

  const mergedContent = mergeTextByOverlap(existingContent, incomingContent);
  if (mergedContent === incomingContent) return incoming;

  const nonTextParts = mergeNonTextParts(existing.parts, incoming.parts);
  const parts: MessagePart[] = [
    { type: 'text', text: mergedContent },
    ...nonTextParts,
  ];
  return {
    ...incoming,
    content: mergedContent,
    timestamp: existing.timestamp ?? incoming.timestamp,
    parts,
  };
}

function lastAssistantMessage(sessionId: string): Message | null {
  const messages = storeGetMessages(sessionId);
  const last = messages[messages.length - 1];
  return last?.role === 'assistant' ? last : null;
}

async function cancelAgentRunForSession(chatSessionId: string, rootRunId: string): Promise<void> {
  await fetch('/api/agent-runs/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatSessionId, rootRunId }),
  });
}

export function useAgentChat({
  currentFile,
  providerOverride,
  modelOverride,
  permissionMode = 'ask',
  nativeRuntimeOptions = {},
  acpRuntimeOptions = {},
  activeSessionId,
  onFirstMessage,
  refs,
  errorLabels,
  resetInputState,
  onRestoreInput,
  onTransientError,
}: UseAgentChatOpts) {
  // All run state lives in agent-run-store, keyed by session. The hook derives
  // UI state for the *active* session — background runs keep going on their
  // own and never touch these values.
  const activeRun = useSessionRun(activeSessionId);
  const isLoading = activeRun !== null;
  const loadingPhase: LoadingPhase = activeRun?.phase ?? 'connecting';
  const reconnectAttempt = activeRun?.reconnectAttempt ?? 0;
  const reconnectMax = activeRun?.reconnectMax ?? 3;
  const agentRunContext = activeRun?.agentRunContext ?? null;
  const contextUsage = useSessionContextUsage(activeSessionId);

  const reconnectMaxRef = useRef(3);
  const abortRef = useRef<AbortController | null>(null);
  const firstMessageFired = useRef(false);

  const isLoadingRef = useRef(false);
  useLayoutEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const stop = useCallback(() => {
    const sessionId = refs.sessionRef.current?.activeSessionId ?? null;
    if (!sessionId) return;
    const run = getRun(sessionId);
    if (!run) return;

    const pending = run.pendingUserMessage;
    // Mark retracted before aborting so the AbortError handler in the run
    // closure (which fires on a later microtask) skips its own cleanup.
    if (pending) updateRun(sessionId, { retracted: true, pendingUserMessage: null });
    const rootRunId = run.agentRunContext?.rootRunId;
    if (rootRunId) {
      void cancelAgentRunForSession(sessionId, rootRunId).catch((err) => {
        console.warn('[useAgentChat] failed to cancel agent run:', err);
      });
    }
    run.controller.abort();

    if (pending) {
      // Always remove the user message + assistant response (empty or partial).
      // The user clicked stop — they don't want this exchange in the history.
      // Timestamp-based lookup avoids index races if the array changed between
      // submit() and stop().
      const userTimestamp = pending.timestamp;
      storeSetMessages(sessionId, (prev) => prev.filter((msg, idx) => {
        if (msg.role === 'user' && msg.timestamp === userTimestamp) return false;
        if (idx > 0 && prev[idx - 1].role === 'user'
            && prev[idx - 1].timestamp === userTimestamp
            && msg.role === 'assistant') return false;
        return true;
      }));

      // Restore text (+ attachments) back into the input box.
      onRestoreInput?.(pending);

      // Block re-submission for a short window so the browser's mouseup
      // doesn't hit the send button that replaces the stop button.
      startSubmitCooldown(sessionId);
    }
  }, [refs, onRestoreInput]);

  const submitTurnSnapshot = useCallback(async (snapshot: TurnSubmitSnapshot): Promise<boolean> => {
    const sess = refs.sessionRef.current;
    if (!sess) return false;
    const sessionId = snapshot.sessionId;
    if (!sessionId) return false;
    if (isInSubmitCooldown(sessionId)) return false; // ignore accidental re-submit after stop
    if (getRun(sessionId)) return false; // per-session mutex: this session is already running

    const text = snapshot.text.trim();
    if (!text && snapshot.images.length === 0) return false;
    const readyUploads = snapshot.uploadAttachments.filter(f => f.status !== 'loading');
    const oversizedUploads = getOversizedAiAttachments(readyUploads);
    if (oversizedUploads.length > 0) {
      onTransientError?.(describeOversizedAiAttachments(oversizedUploads));
      return false;
    }

    const skill = snapshot.skill;
    const permissionModeSnapshot = refs.permissionModeRef?.current ?? permissionMode;
    const selectedRuntimeBase = compactAgentRuntimeIdentity(refs.selectedAgentRuntimeRef.current);
    const requestRuntimeBase = selectedRuntimeBase?.kind === 'mindos' ? null : selectedRuntimeBase;
    const runtimeSnapshot = selectedRuntimeBase ?? MINDOS_RUNTIME;
    const acpAgent: AgentIdentity | null = requestRuntimeBase?.kind === 'acp'
      ? { id: requestRuntimeBase.id, name: requestRuntimeBase.name }
      : null;
    const matchingRuntimeBinding = requestRuntimeBase
      ? getMatchingRuntimeSessionBinding(sess.activeSession, requestRuntimeBase)
      : null;
    const selectedRuntime = runtimeForAgentRequest(requestRuntimeBase);
    const runtimeForMessage = requestRuntimeBase;
    const pendingImages = snapshot.images.length > 0 ? [...snapshot.images] : undefined;
    const pendingAttachedFiles = snapshot.explicitAttachedFiles.length > 0 ? snapshot.explicitAttachedFiles : undefined;
    const pendingUploadedNames = readyUploads.map(f => f.name);
    const userMsg: Message = annotateMessageWithAgentRuntime({
      role: 'user',
      content: text,
      timestamp: Date.now(),
      ...(skill && { skillName: skill.name }),
      ...(pendingImages && { images: pendingImages }),
      ...(pendingAttachedFiles && { attachedFiles: pendingAttachedFiles }),
      ...(pendingUploadedNames.length > 0 && { uploadedFileNames: pendingUploadedNames }),
    }, runtimeForMessage);

    const openedTab = openTab('chat', sessionId, chatTabTitleFromDraft(text), { pinned: true });
    if (!openedTab) toast.error(errorLabels.tabLimitReached);

    // Concurrency cap: reject loudly (a silent drop here would feel like a
    // dead send button). The backend has its own per-agent/global caps whose
    // errors stream through as readable text.
    if (getRunCount() >= MAX_CONCURRENT_RUNS) {
      storeAppendMessages(sessionId, [
        userMsg,
        annotateMessageWithAgentRuntime(
          { role: 'assistant', content: `__error__${errorLabels.concurrentLimit}`, timestamp: Date.now() },
          runtimeForMessage,
        ),
      ]);
      snapshot.onSubmitStarted();
      return true;
    }

    snapshot.onSubmitStarted();
    const previousMessages = [...storeGetMessages(sessionId)];
    const requestMessages = [...previousMessages, userMsg];

    storeAppendMessages(sessionId, [
      userMsg,
      annotateMessageWithAgentRuntime({ role: 'assistant', content: '', timestamp: Date.now() }, runtimeForMessage),
    ]);

    if (onFirstMessage && !firstMessageFired.current) {
      firstMessageFired.current = true;
      onFirstMessage();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    let maxRetries = 3;
    try {
      const stored = localStorage.getItem('mindos-reconnect-retries');
      if (stored !== null) { const n = parseInt(stored, 10); if (Number.isFinite(n)) maxRetries = Math.max(0, Math.min(10, n)); }
    } catch { /* localStorage unavailable */ }
    reconnectMaxRef.current = maxRetries;

    startRun(sessionId, {
      controller,
      runtimeSnapshot,
      reconnectMax: maxRetries,
      pendingUserMessage: userMsg,
    });

    const selectedRuntimeIsNative = requestRuntimeBase?.kind === 'codex' || requestRuntimeBase?.kind === 'claude';
    const selectedRuntimeIsAcp = requestRuntimeBase?.kind === 'acp';
    const compactRuntimeOptions: NativeRuntimeOptions = {
      ...(nativeRuntimeOptions.modelOverride?.trim() ? { modelOverride: nativeRuntimeOptions.modelOverride.trim() } : {}),
      ...(selectedRuntimeIsNative && nativeRuntimeOptions.reasoningEffort
        ? { reasoningEffort: nativeRuntimeOptions.reasoningEffort }
        : {}),
    };
    const compactAcpRuntimeOptions: AcpRuntimeOptions = {
      ...(selectedRuntimeIsAcp && acpRuntimeOptions.modeId?.trim()
        ? { modeId: acpRuntimeOptions.modeId.trim() }
        : {}),
      ...(selectedRuntimeIsAcp && acpRuntimeOptions.configValues
        ? { configValues: Object.fromEntries(
            Object.entries(acpRuntimeOptions.configValues)
              .map(([key, value]) => [key.trim(), value.trim()] as const)
              .filter(([key, value]) => key && value),
          ) }
        : {}),
    };
    if (compactAcpRuntimeOptions.configValues && Object.keys(compactAcpRuntimeOptions.configValues).length === 0) {
      delete compactAcpRuntimeOptions.configValues;
    }
    const sessionContextSnapshot = getSessionSubmitContextSnapshot(sessionId);
    const requestBody = JSON.stringify({
      messages: requestMessages,
      agentMode: 'default',
      permissionMode: permissionModeSnapshot,
      currentFile,
      attachedFiles: snapshot.requestAttachedFiles,
      uploadedFiles: readyUploads
        .map(f => ({
          name: f.name,
          ...(f.mimeType ? { mimeType: f.mimeType } : {}),
          ...(typeof f.size === 'number' ? { size: f.size } : {}),
          ...(f.dataBase64 ? { dataBase64: f.dataBase64 } : {}),
          content: f.content,
        })),
      selectedAcpAgent: acpAgent,
      selectedRuntime,
      runtimeBinding: matchingRuntimeBinding ?? null,
      workDir: sessionContextSnapshot.workDir,
      contextSelection: sessionContextSnapshot.contextSelection,
      chatSessionId: sessionId,
      providerOverride: requestRuntimeBase ? undefined : providerOverride ?? undefined,
      modelOverride: requestRuntimeBase ? undefined : modelOverride ?? undefined,
      runtimeOptions: Object.keys(compactRuntimeOptions).length > 0
        ? compactRuntimeOptions
        : undefined,
      acpRuntimeOptions: Object.keys(compactAcpRuntimeOptions).length > 0
        ? compactAcpRuntimeOptions
        : undefined,
    });

    // ---- Async phase (run closure): only snapshots + store APIs from here.
    // No `refs.*.current` — the component may unmount mid-stream and the run
    // must keep writing to its own session.
    const setPhase = (phase: LoadingPhase) => {
      const run = getRun(sessionId);
      if (run && run.phase !== phase) updateRun(sessionId, { phase });
    };

    const consumeAgentTurnBody = async (
      body: ReadableStream<Uint8Array>,
      opts: { mergeReattachReplay?: boolean } = {},
    ): Promise<{ finalMessage: Message }> => {
      setPhase('thinking');

      const finalMessage = await consumeUIMessageStream(
        body,
        (msg) => {
          setPhase('streaming');
          const annotated = annotateMessageWithAgentRuntime(msg, runtimeForMessage);
          const next = opts.mergeReattachReplay
            ? mergeReattachedAssistantMessage(lastAssistantMessage(sessionId), annotated)
            : annotated;
          replaceLastMessage(sessionId, next, { requireRun: true });
        },
        controller.signal,
        {
          onRuntimeBinding: (binding) => {
            // Late events after the run ended are dropped; the lane is judged
            // from the submit-time snapshot, NOT the currently selected
            // runtime — the user may have switched runtimes mid-stream.
            const run = getRun(sessionId);
            if (!run) return;
            const runtime = run.runtimeSnapshot;
            if (!runtime || runtime.kind !== binding.runtime) return;
            writeRuntimeBinding(sessionId, runtime, {
              externalSessionId: binding.externalSessionId,
              cwd: binding.cwd,
              status: binding.status,
              updatedAt: Date.now(),
            });
          },
          onAgentRunContext: (context) => {
            updateRun(sessionId, { agentRunContext: context });
          },
          onContextUsage: (usage) => {
            writeContextUsage(sessionId, usage);
          },
        },
      );
      if (!opts.mergeReattachReplay) return { finalMessage };
      const annotatedFinal = annotateMessageWithAgentRuntime(finalMessage, runtimeForMessage);
      const mergedFinal = mergeReattachedAssistantMessage(lastAssistantMessage(sessionId), annotatedFinal);
      replaceLastMessage(sessionId, mergedFinal, { requireRun: true });
      return { finalMessage: mergedFinal };
    };

    const doFetch = async (): Promise<{ finalMessage: Message }> => {
      const res = await fetch(buildAgentTurnEndpoint(sessionId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal: controller.signal,
      });

      if (!res.ok) {
        let errorMsg = `Request failed (${res.status})`;
        let issueCode: string | undefined;
        try {
          const errBody = await res.json() as {
            error?: { message?: string; issueCode?: string } | string;
            message?: string;
          };
          if (typeof errBody?.error === 'string' && errBody.error.trim()) {
            errorMsg = errBody.error;
          } else if (typeof errBody?.error === 'object' && typeof errBody.error?.message === 'string' && errBody.error.message.trim()) {
            errorMsg = errBody.error.message;
            if (typeof errBody.error.issueCode === 'string' && errBody.error.issueCode.trim()) {
              issueCode = errBody.error.issueCode.trim();
            }
          } else if (typeof errBody?.message === 'string' && errBody.message.trim()) {
            errorMsg = errBody.message;
          }
        } catch (err) { console.warn("[useAgentChat] error body parse failed:", err); }
        const err = new Error(errorMsg);
        (err as Error & { httpStatus?: number }).httpStatus = res.status;
        if (issueCode) (err as Error & { issueCode?: string }).issueCode = issueCode;
        throw err;
      }

      if (!res.body) throw new Error('No response body');

      return consumeAgentTurnBody(res.body);
    };

    const doReattach = async (rootRunId: string): Promise<{ finalMessage: Message }> => {
      const res = await fetch(buildAgentRunReattachEndpoint(sessionId, rootRunId), {
        method: 'GET',
        signal: controller.signal,
      });

      if (!res.ok) {
        const error = new Error(`Reconnect failed (${res.status})`);
        (error as Error & { httpStatus?: number }).httpStatus = res.status;
        throw error;
      }
      if (!res.body) throw new Error('No response body');

      return consumeAgentTurnBody(res.body, { mergeReattachReplay: true });
    };

    try {
      let lastError: Error | null = null;

      for (let attempt = 0; ; attempt++) {
        if (controller.signal.aborted) break;

        if (attempt > 0) {
          const displayMax = Math.max(1, maxRetries);
          updateRun(sessionId, {
            reconnectAttempt: Math.min(attempt, displayMax),
            reconnectMax: displayMax,
            phase: 'reconnecting',
          });
          if (!getRun(sessionId)?.agentRunContext?.rootRunId) {
            replaceLastMessage(
              sessionId,
              annotateMessageWithAgentRuntime({ role: 'assistant', content: '', timestamp: Date.now() }, runtimeForMessage),
              { requireRun: true },
            );
          }
          await sleep(retryDelay(attempt - 1), controller.signal);
          setPhase('connecting');
        }

        try {
          const rootRunId = attempt > 0 ? getRun(sessionId)?.agentRunContext?.rootRunId : undefined;
          const { finalMessage } = rootRunId
            ? await doReattach(rootRunId)
            : await doFetch();
          if (!finalMessage.content.trim() && (!finalMessage.parts || finalMessage.parts.length === 0)) {
            replaceLastMessage(
              sessionId,
              annotateMessageWithAgentRuntime({ role: 'assistant', content: `__error__${errorLabels.noResponse}` }, runtimeForMessage),
              { requireRun: true },
            );
          }
          // Successfully received response — no longer retractable.
          updateRun(sessionId, { pendingUserMessage: null });
          return true;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const httpStatus = (err as Error & { httpStatus?: number }).httpStatus;
          if (httpStatus === 400 || httpStatus === 404 || !isRetryableError(err, httpStatus)) break;
          const hasEstablishedRun = Boolean(getRun(sessionId)?.agentRunContext?.rootRunId);
          const retryLimit = hasEstablishedRun
            ? Math.max(maxRetries, ESTABLISHED_RUN_REATTACH_ATTEMPTS)
            : maxRetries;
          if (attempt >= retryLimit) break;
        }
      }

      if (lastError) throw lastError;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // If stop() already retracted the messages, skip writing __error__stopped.
        if (!getRun(sessionId)?.retracted) {
          storeSetMessages(sessionId, (prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              const last = updated[lastIdx];
              const hasContent = last.content.trim() || (last.parts && last.parts.length > 0);
              if (!hasContent) {
                updated[lastIdx] = annotateMessageWithAgentRuntime({ role: 'assistant', content: `__error__${errorLabels.stopped}` }, runtimeForMessage);
              }
            }
            return updated;
          }, { requireRun: true });
        }
      } else {
        const errMsg = err instanceof Error ? err.message : 'Something went wrong';
        if (err instanceof Error && isWorkDirContextError(err)) {
          updateRun(sessionId, { pendingUserMessage: null });
          storeSetMessages(sessionId, previousMessages, { requireRun: true });
          if (snapshot.restoreInputOnContextError) onRestoreInput?.(userMsg);
          onTransientError?.(errMsg);
          return true;
        }
        storeSetMessages(sessionId, (prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            const last = updated[lastIdx];
            const hasContent = last.content.trim() || (last.parts && last.parts.length > 0);
            if (!hasContent) {
              updated[lastIdx] = annotateMessageWithAgentRuntime({ role: 'assistant', content: `__error__${errMsg}` }, runtimeForMessage);
              return updated;
            }
          }
          return [...updated, annotateMessageWithAgentRuntime({ role: 'assistant', content: `__error__${errMsg}` }, runtimeForMessage)];
        }, { requireRun: true });
      }
    } finally {
      endRun(sessionId);
      if (abortRef.current === controller) abortRef.current = null;
    }
    return true;
  }, [currentFile, providerOverride, modelOverride, permissionMode, nativeRuntimeOptions, acpRuntimeOptions, errorLabels.noResponse, errorLabels.stopped, errorLabels.concurrentLimit, errorLabels.tabLimitReached, onFirstMessage, refs, onRestoreInput, onTransientError]);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    // ---- Sync phase: the component is mounted, refs are valid. Everything
    // the run needs is snapshotted into plain values here; the async phase
    // below must never read a ref again.
    const m = refs.mentionRef.current;
    const s = refs.slashRef.current;
    const img = refs.imageUploadRef.current;
    const sess = refs.sessionRef.current;
    const upl = refs.uploadRef.current;
    if (!m || !s || !img || !sess || !upl) return;
    if (m.mentionQuery !== null || s.slashQuery !== null) return;

    const sessionId = sess.activeSessionId ?? null;
    if (!sessionId) return;

    const text = refs.inputValueRef.current?.trim() ?? '';
    const hasLoadingUploads = upl.localAttachments.some(f => f.status === 'loading');
    if (hasLoadingUploads || (!text && img.images.length === 0)) return;

    // Only store explicitly user-chosen files (filter out auto-included currentFile)
    const attachedFiles = [...(refs.attachedFilesRef.current ?? [])];
    const explicitAttached = attachedFiles.filter(f => f !== currentFile);
    await submitTurnSnapshot({
      sessionId,
      text,
      skill: refs.selectedSkillRef.current,
      images: [...img.images],
      explicitAttachedFiles: explicitAttached,
      requestAttachedFiles: attachedFiles,
      uploadAttachments: [...upl.localAttachments],
      onSubmitStarted: () => {
        img.clearImages();
        resetInputState();
      },
      restoreInputOnContextError: true,
    });
  }, [currentFile, refs, resetInputState, submitTurnSnapshot]);

  const submitTextOnly = useCallback(async (text: string): Promise<boolean> => {
    const sess = refs.sessionRef.current;
    const sessionId = sess?.activeSessionId ?? null;
    if (!sessionId) return false;
    return submitTurnSnapshot({
      sessionId,
      text,
      skill: null,
      images: [],
      explicitAttachedFiles: [],
      requestAttachedFiles: currentFile ? [currentFile] : [],
      uploadAttachments: [],
      onSubmitStarted: () => {},
      restoreInputOnContextError: false,
    });
  }, [currentFile, refs, submitTurnSnapshot]);

  return {
    isLoading,
    isLoadingRef,
    loadingPhase,
    reconnectAttempt,
    reconnectMax,
    agentRunContext,
    contextUsage,
    reconnectMaxRef,
    abortRef,
    firstMessageFired,
    submit,
    submitTextOnly,
    stop,
  };
}
