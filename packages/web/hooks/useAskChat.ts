'use client';

import { useRef, useCallback, useLayoutEffect } from 'react';
import type { AgentIdentity, AgentRuntimeIdentity, Message, ImagePart, AskMode, LocalAttachment, RuntimeSessionBinding } from '@/lib/types';
import type { ProviderId } from '@/lib/agent/providers';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';
import { annotateMessageWithAgentRuntime, compactAgentRuntimeIdentity, getMatchingRuntimeSessionBinding, isRuntimeSessionBindingResumable } from '@/lib/ask-agent';
import { isRetryableError, retryDelay, sleep } from '@/lib/agent/reconnect';
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
  useSessionRun,
  writeRuntimeBinding,
} from '@/lib/ask-run-store';

export type LoadingPhase = 'connecting' | 'thinking' | 'streaming' | 'reconnecting';

type AskRequestRuntime = AgentRuntimeIdentity & {
  binaryPath?: string;
  externalSessionId?: string;
};

function runtimeForAskRequest(runtime: AskRequestRuntime | null | undefined): AskRequestRuntime | null {
  if (!runtime) return null;
  return {
    id: runtime.id,
    name: runtime.name,
    kind: runtime.kind,
    ...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
    ...(runtime.externalSessionId ? { externalSessionId: runtime.externalSessionId } : {}),
  };
}

export interface AskChatRefs {
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
}

interface UseAskChatOpts {
  currentFile?: string;
  chatMode: AskMode;
  providerOverride: ProviderId | `p_${string}` | null;
  modelOverride: string | null;
  activeSessionId: string | null;
  onFirstMessage?: () => void;
  refs: AskChatRefs;
  errorLabels: { noResponse: string; stopped: string; concurrentLimit: string };
  resetInputState: () => void;
  onRestoreInput?: (userMessage: Message) => void;
}

export function useAskChat({
  currentFile,
  chatMode,
  providerOverride,
  modelOverride,
  activeSessionId,
  onFirstMessage,
  refs,
  errorLabels,
  resetInputState,
  onRestoreInput,
}: UseAskChatOpts) {
  // All run state lives in ask-run-store, keyed by session. The hook derives
  // UI state for the *active* session — background runs keep going on their
  // own and never touch these values.
  const activeRun = useSessionRun(activeSessionId);
  const isLoading = activeRun !== null;
  const loadingPhase: LoadingPhase = activeRun?.phase ?? 'connecting';
  const reconnectAttempt = activeRun?.reconnectAttempt ?? 0;
  const reconnectMax = activeRun?.reconnectMax ?? 3;
  const agentRunContext = activeRun?.agentRunContext ?? null;

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
    if (isInSubmitCooldown(sessionId)) return; // ignore accidental re-submit after stop
    if (getRun(sessionId)) return; // per-session mutex: this session is already running

    const text = refs.inputValueRef.current?.trim() ?? '';
    const hasLoadingUploads = upl.localAttachments.some(f => f.status === 'loading');
    if (hasLoadingUploads || (!text && img.images.length === 0)) return;

    const skill = refs.selectedSkillRef.current;
    const selectedRuntimeBase = compactAgentRuntimeIdentity(refs.selectedAgentRuntimeRef.current);
    const acpAgent: AgentIdentity | null = selectedRuntimeBase?.kind === 'acp'
      ? { id: selectedRuntimeBase.id, name: selectedRuntimeBase.name }
      : null;
    const matchingRuntimeBinding = getMatchingRuntimeSessionBinding(sess.activeSession, selectedRuntimeBase);
    const selectedRuntimeWithBinding = selectedRuntimeBase && isRuntimeSessionBindingResumable(matchingRuntimeBinding)
      ? {
          ...selectedRuntimeBase,
          externalSessionId: matchingRuntimeBinding.externalSessionId,
        }
      : selectedRuntimeBase;
    const selectedRuntime = runtimeForAskRequest(selectedRuntimeWithBinding);
    const runtimeForMessage = selectedRuntimeBase ?? null;
    const pendingImages = img.images.length > 0 ? [...img.images] : undefined;
    // Only store explicitly user-chosen files (filter out auto-included currentFile)
    const explicitAttached = refs.attachedFilesRef.current.filter(f => f !== currentFile);
    const pendingAttachedFiles = explicitAttached.length > 0 ? explicitAttached : undefined;
    const pendingUploadedNames = upl.localAttachments
      .filter(f => f.status !== 'loading')
      .map(f => f.name);
    const userMsg: Message = annotateMessageWithAgentRuntime({
      role: 'user',
      content: text,
      timestamp: Date.now(),
      ...(skill && { skillName: skill.name }),
      ...(pendingImages && { images: pendingImages }),
      ...(pendingAttachedFiles && { attachedFiles: pendingAttachedFiles }),
      ...(pendingUploadedNames.length > 0 && { uploadedFileNames: pendingUploadedNames }),
    }, runtimeForMessage);

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
      resetInputState();
      img.clearImages();
      return;
    }

    img.clearImages();
    const requestMessages = [...storeGetMessages(sessionId), userMsg];

    storeAppendMessages(sessionId, [
      userMsg,
      annotateMessageWithAgentRuntime({ role: 'assistant', content: '', timestamp: Date.now() }, runtimeForMessage),
    ]);

    resetInputState();

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
      runtimeSnapshot: runtimeForMessage,
      reconnectMax: maxRetries,
      pendingUserMessage: userMsg,
    });

    const requestBody = JSON.stringify({
      messages: requestMessages,
      currentFile,
      attachedFiles: refs.attachedFilesRef.current,
      uploadedFiles: upl.localAttachments
        .filter(f => f.status !== 'loading')
        .map(f => ({
          name: f.name,
          content: f.content.length > 80_000
            ? f.content.slice(0, 80_000) + '\n\n[...truncated to first ~80000 chars]'
            : f.content,
      })),
      selectedAcpAgent: acpAgent,
      selectedRuntime,
      runtimeBinding: matchingRuntimeBinding ?? null,
      mode: chatMode,
      chatSessionId: sessionId,
      providerOverride: selectedRuntimeBase && selectedRuntimeBase.kind !== 'mindos' ? undefined : providerOverride ?? undefined,
      modelOverride: selectedRuntimeBase && selectedRuntimeBase.kind !== 'mindos' ? undefined : modelOverride ?? undefined,
    });

    // ---- Async phase (run closure): only snapshots + store APIs from here.
    // No `refs.*.current` — the component may unmount mid-stream and the run
    // must keep writing to its own session.
    const setPhase = (phase: LoadingPhase) => {
      const run = getRun(sessionId);
      if (run && run.phase !== phase) updateRun(sessionId, { phase });
    };

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
        } catch (err) { console.warn("[useAskChat] error body parse failed:", err); }
        const err = new Error(errorMsg);
        (err as Error & { httpStatus?: number }).httpStatus = res.status;
        throw err;
      }

      if (!res.body) throw new Error('No response body');

      setPhase('thinking');

      const finalMessage = await consumeUIMessageStream(
        res.body,
        (msg) => {
          setPhase('streaming');
          replaceLastMessage(sessionId, annotateMessageWithAgentRuntime(msg, runtimeForMessage), { requireRun: true });
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
        },
      );
      return { finalMessage };
    };

    try {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (controller.signal.aborted) break;

        if (attempt > 0) {
          updateRun(sessionId, { reconnectAttempt: attempt, phase: 'reconnecting' });
          replaceLastMessage(
            sessionId,
            annotateMessageWithAgentRuntime({ role: 'assistant', content: '', timestamp: Date.now() }, runtimeForMessage),
            { requireRun: true },
          );
          await sleep(retryDelay(attempt - 1), controller.signal);
          setPhase('connecting');
        }

        try {
          const { finalMessage } = await doFetch();
          if (!finalMessage.content.trim() && (!finalMessage.parts || finalMessage.parts.length === 0)) {
            replaceLastMessage(
              sessionId,
              annotateMessageWithAgentRuntime({ role: 'assistant', content: `__error__${errorLabels.noResponse}` }, runtimeForMessage),
              { requireRun: true },
            );
          }
          // Successfully received response — no longer retractable.
          updateRun(sessionId, { pendingUserMessage: null });
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
  }, [currentFile, chatMode, providerOverride, modelOverride, errorLabels.noResponse, errorLabels.stopped, errorLabels.concurrentLimit, onFirstMessage, refs, resetInputState]);

  return {
    isLoading,
    isLoadingRef,
    loadingPhase,
    reconnectAttempt,
    reconnectMax,
    agentRunContext,
    reconnectMaxRef,
    abortRef,
    firstMessageFired,
    submit,
    stop,
  };
}
