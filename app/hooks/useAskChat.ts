'use client';

import { useRef, useState, useCallback } from 'react';
import type { Message, ImagePart, AskMode } from '@/lib/types';
import type { ProviderId } from '@/lib/agent/providers';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';
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
    localAttachments: { name: string; content: string }[];
  }>;
  selectedSkillRef: React.RefObject<{ name: string } | null>;
  selectedAcpAgentRef: React.RefObject<unknown>;
  attachedFilesRef: React.RefObject<string[]>;
}

interface UseAskChatOpts {
  currentFile?: string;
  chatMode: AskMode;
  providerOverride: ProviderId | null;
  onFirstMessage?: () => void;
  refs: AskChatRefs;
  errorLabels: { noResponse: string; stopped: string };
  resetInputState: () => void;
}

export function useAskChat({
  currentFile,
  chatMode,
  providerOverride,
  onFirstMessage,
  refs,
  errorLabels,
  resetInputState,
}: UseAskChatOpts) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectMaxRef = useRef(3);
  const abortRef = useRef<AbortController | null>(null);
  const firstMessageFired = useRef(false);

  const stop = useCallback(() => { abortRef.current?.abort(); }, []);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const m = refs.mentionRef.current;
    const s = refs.slashRef.current;
    const img = refs.imageUploadRef.current;
    const sess = refs.sessionRef.current;
    const upl = refs.uploadRef.current;
    if (!m || !s || !img || !sess || !upl) return;
    if (m.mentionQuery !== null || s.slashQuery !== null) return;
    const text = refs.inputValueRef.current?.trim() ?? '';
    if ((!text && img.images.length === 0) || isLoadingRef.current) return;

    const skill = refs.selectedSkillRef.current;
    const acpAgent = refs.selectedAcpAgentRef.current;
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
          refs.sessionRef.current?.setMessages(prev => {
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
            refs.sessionRef.current?.setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: `__error__${errorLabels.noResponse}` };
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
        refs.sessionRef.current?.setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            const last = updated[lastIdx];
            const hasContent = last.content.trim() || (last.parts && last.parts.length > 0);
            if (!hasContent) {
              updated[lastIdx] = { role: 'assistant', content: `__error__${errorLabels.stopped}` };
            }
          }
          return updated;
        });
      } else {
        const errMsg = err instanceof Error ? err.message : 'Something went wrong';
        refs.sessionRef.current?.setMessages(prev => {
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
  }, [currentFile, chatMode, providerOverride, errorLabels.noResponse, errorLabels.stopped, onFirstMessage, refs, resetInputState]);

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
