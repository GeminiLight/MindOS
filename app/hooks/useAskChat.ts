'use client';

import { useRef, useState, useCallback } from 'react';
import type { AgentIdentity, Message, ImagePart, AskMode, LocalAttachment } from '@/lib/types';
import type { ProviderId } from '@/lib/agent/providers';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';
import { annotateMessageWithAgent } from '@/lib/ask-agent';
import { isRetryableError, retryDelay, sleep } from '@/lib/agent/reconnect';

export type LoadingPhase = 'connecting' | 'thinking' | 'streaming' | 'reconnecting';

export interface AskChatRefs {
  inputValueRef: React.RefObject<string>;
  mentionRef: React.RefObject<{ mentionQuery: string | null }>;
  slashRef: React.RefObject<{ slashQuery: string | null }>;
  imageUploadRef: React.RefObject<{ images: ImagePart[]; clearImages: () => void }>;
  sessionRef: React.RefObject<{
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  }>;
  uploadRef: React.RefObject<{
    localAttachments: LocalAttachment[];
  }>;
  selectedSkillRef: React.RefObject<{ name: string } | null>;
  selectedAcpAgentRef: React.RefObject<AgentIdentity | null>;
  attachedFilesRef: React.RefObject<string[]>;
}

interface UseAskChatOpts {
  currentFile?: string;
  chatMode: AskMode;
  providerOverride: ProviderId | `p_${string}` | null;
  modelOverride: string | null;
  onFirstMessage?: () => void;
  refs: AskChatRefs;
  errorLabels: { noResponse: string; stopped: string };
  resetInputState: () => void;
  onRestoreInput?: (userMessage: Message) => void;
}

export function useAskChat({
  currentFile,
  chatMode,
  providerOverride,
  modelOverride,
  onFirstMessage,
  refs,
  errorLabels,
  resetInputState,
  onRestoreInput,
}: UseAskChatOpts) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectMaxRef = useRef(3);
  const abortRef = useRef<AbortController | null>(null);
  const firstMessageFired = useRef(false);

  // Cooldown guard: after stop+retract, briefly block re-submission so that
  // the mouseup on the stop-button position doesn't accidentally trigger the
  // send button that React swaps in at the same DOM position.
  const submitCooldownRef = useRef(false);

  // Track the pending user message so we can retract it on stop.
  // `userMessageIndex` is the index of the *user* message inside the messages
  // array (the assistant placeholder sits at userMessageIndex + 1).
  const pendingMessageRef = useRef<{
    userMessageIndex: number;
    userMessage: Message;
  } | null>(null);

  // When true the AbortError handler in submit() skips its own setMessages
  // because stop() already cleaned up the messages array.
  const retractedRef = useRef(false);

  const stop = useCallback(() => {
    const pending = pendingMessageRef.current;

    // Abort the fetch first.
    abortRef.current?.abort();

    if (pending) {
      retractedRef.current = true;

      // Always remove the user message + assistant response (empty or partial)
      // from the messages array. The user clicked stop — they don't want this
      // exchange in the history at all.
      refs.sessionRef.current?.setMessages(prev => {
        // Use timestamp to locate messages instead of index to avoid race conditions.
        // If the messages array is modified between submit() and stop(), index-based
        // deletion could remove the wrong messages.
        const userTimestamp = pending.userMessage.timestamp;

        return prev.filter((msg, idx) => {
          // Remove the user message with matching timestamp
          if (msg.role === 'user' && msg.timestamp === userTimestamp) {
            return false;
          }
          // Remove the assistant message that immediately follows the user message
          if (idx > 0 && prev[idx - 1].role === 'user' &&
              prev[idx - 1].timestamp === userTimestamp &&
              msg.role === 'assistant') {
            return false;
          }
          return true;
        });
      });

      // Restore text (+ attachments) back into the input box.
      onRestoreInput?.(pending.userMessage);

      pendingMessageRef.current = null;

      // Block re-submission for a short window so the browser's mouseup
      // doesn't hit the send button that replaces the stop button.
      submitCooldownRef.current = true;
      setTimeout(() => { submitCooldownRef.current = false; }, 300);
    }
  }, [refs, onRestoreInput]);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitCooldownRef.current) return; // ignore accidental re-submit after stop
    const m = refs.mentionRef.current;
    const s = refs.slashRef.current;
    const img = refs.imageUploadRef.current;
    const sess = refs.sessionRef.current;
    const upl = refs.uploadRef.current;
    if (!m || !s || !img || !sess || !upl) return;
    if (m.mentionQuery !== null || s.slashQuery !== null) return;
    const text = refs.inputValueRef.current?.trim() ?? '';
    const hasLoadingUploads = upl.localAttachments.some(f => f.status === 'loading');
    if (hasLoadingUploads || ((!text && img.images.length === 0) || isLoadingRef.current)) return;

    const skill = refs.selectedSkillRef.current;
    const acpAgent = refs.selectedAcpAgentRef.current;
    const pendingImages = img.images.length > 0 ? [...img.images] : undefined;
    // Only store explicitly user-chosen files (filter out auto-included currentFile)
    const explicitAttached = refs.attachedFilesRef.current.filter(f => f !== currentFile);
    const pendingAttachedFiles = explicitAttached.length > 0 ? explicitAttached : undefined;
    const pendingUploadedNames = upl.localAttachments
      .filter(f => f.status !== 'loading')
      .map(f => f.name);
    const userMsg: Message = annotateMessageWithAgent({
      role: 'user',
      content: text,
      timestamp: Date.now(),
      ...(skill && { skillName: skill.name }),
      ...(pendingImages && { images: pendingImages }),
      ...(pendingAttachedFiles && { attachedFiles: pendingAttachedFiles }),
      ...(pendingUploadedNames.length > 0 && { uploadedFileNames: pendingUploadedNames }),
    }, acpAgent);
    img.clearImages();
    const requestMessages = [...sess.messages, userMsg];

    // Track the user message index for potential retraction on stop.
    // The user message is at requestMessages.length - 1; the assistant
    // placeholder we're about to insert will be at requestMessages.length.
    pendingMessageRef.current = {
      userMessageIndex: requestMessages.length - 1,
      userMessage: userMsg,
    };
    retractedRef.current = false;

    sess.setMessages([...requestMessages, annotateMessageWithAgent({ role: 'assistant', content: '', timestamp: Date.now() }, acpAgent)]);

    resetInputState();

    if (onFirstMessage && !firstMessageFired.current) {
      firstMessageFired.current = true;
      onFirstMessage();
    }
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
      mode: chatMode,
      providerOverride: providerOverride ?? undefined,
      modelOverride: modelOverride ?? undefined,
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
        } catch (err) { console.warn("[useAskChat] error body parse failed:", err); }
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
          refs.sessionRef.current?.setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = annotateMessageWithAgent(msg, acpAgent);
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
          refs.sessionRef.current?.setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = annotateMessageWithAgent({ role: 'assistant', content: '', timestamp: Date.now() }, acpAgent);
            return updated;
          });
          await sleep(retryDelay(attempt - 1), controller.signal);
          setLoadingPhase('connecting');
        }

        try {
          const { finalMessage } = await doFetch();
          if (!finalMessage.content.trim() && (!finalMessage.parts || finalMessage.parts.length === 0)) {
            refs.sessionRef.current?.setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = annotateMessageWithAgent({ role: 'assistant', content: `__error__${errorLabels.noResponse}` }, acpAgent);
              return updated;
            });
          }
          // Successfully received response — no longer retractable.
          pendingMessageRef.current = null;
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
        if (!retractedRef.current) {
          refs.sessionRef.current?.setMessages(prev => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              const last = updated[lastIdx];
              const hasContent = last.content.trim() || (last.parts && last.parts.length > 0);
              if (!hasContent) {
                updated[lastIdx] = annotateMessageWithAgent({ role: 'assistant', content: `__error__${errorLabels.stopped}` }, acpAgent);
              }
            }
            return updated;
          });
        }
      } else {
        const errMsg = err instanceof Error ? err.message : 'Something went wrong';
        refs.sessionRef.current?.setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            const last = updated[lastIdx];
            const hasContent = last.content.trim() || (last.parts && last.parts.length > 0);
            if (!hasContent) {
              updated[lastIdx] = annotateMessageWithAgent({ role: 'assistant', content: `__error__${errMsg}` }, acpAgent);
              return updated;
            }
          }
          return [...updated, annotateMessageWithAgent({ role: 'assistant', content: `__error__${errMsg}` }, acpAgent)];
        });
      }
    } finally {
      setIsLoading(false);
      setReconnectAttempt(0);
      abortRef.current = null;
      pendingMessageRef.current = null;
    }
  }, [currentFile, chatMode, providerOverride, modelOverride, errorLabels.noResponse, errorLabels.stopped, onFirstMessage, refs, resetInputState]);

  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;

  return {
    isLoading,
    isLoadingRef,
    loadingPhase,
    reconnectAttempt,
    reconnectMaxRef,
    abortRef,
    firstMessageFired,
    submit,
    stop,
  };
}
