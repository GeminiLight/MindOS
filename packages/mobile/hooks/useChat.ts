/**
 * useChat — React hook for AI conversation with streaming + persistence.
 *
 * P0 fixes:
 * - Persist messages to AsyncStorage (survives app restart)
 * - Persist sessionId (survives component remount)
 * - Retry button: stores lastFailedMessage for re-send
 * - Finalize partial messages on error/cancel
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConnectionStore } from '@/lib/connection-store';
import { streamChat, MessageBuilder } from '@/lib/sse-client';
import type { Message, AskMode } from '@/lib/types';

const CHAT_STORAGE_KEY = 'mindos_chat_messages';
const SESSION_STORAGE_KEY = 'mindos_chat_session';

export interface UseChatOptions {
  mode?: AskMode;
}

export function useChat({ mode = 'chat' }: UseChatOptions = {}) {
  const baseUrl = useConnectionStore((s) => s.serverUrl);

  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState('');
  const [lastFailedMessage, setLastFailedMessage] = useState('');
  const [lastFailedAttachments, setLastFailedAttachments] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const cancelRef = useRef<(() => void) | null>(null);
  const builderRef = useRef<MessageBuilder | null>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  // --- Load session + messages from storage ---
  useEffect(() => {
    (async () => {
      try {
        const [savedSession, savedMessages] = await Promise.all([
          AsyncStorage.getItem(SESSION_STORAGE_KEY),
          AsyncStorage.getItem(CHAT_STORAGE_KEY),
        ]);
        if (savedSession) {
          setSessionId(savedSession);
        } else {
          const newId = `s-${Date.now()}`;
          setSessionId(newId);
          await AsyncStorage.setItem(SESSION_STORAGE_KEY, newId);
        }
        if (savedMessages) {
          try {
            const parsed = JSON.parse(savedMessages);
            if (Array.isArray(parsed)) setMessages(parsed);
          } catch { /* corrupt data, start fresh */ }
        }
      } catch { /* storage error, start fresh */ }
      setLoaded(true);
    })();
  }, []);

  // --- Persist messages after each change (debounced) ---
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded || isStreaming) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // Only persist non-empty conversations; trim to last 200 messages for storage
      const toSave = messages.slice(-200);
      AsyncStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(toSave)).catch(() => {});
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [messages, loaded, isStreaming]);

  // --- Send message ---
  const send = useCallback(
    (userMessage: string, attachedFilePaths?: string[]) => {
      if (!baseUrl || !sessionId) return false;

      setError('');
      setLastFailedMessage('');
      setLastFailedAttachments([]);
      setIsStreaming(true);

      const userMsg: Message = {
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
        attachedFiles: attachedFilePaths,
      };

      const placeholder: Message = {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };

      const nextHistory = [...messagesRef.current, userMsg];
      setMessages([...nextHistory, placeholder]);

      builderRef.current = new MessageBuilder();

      cancelRef.current = streamChat(
        baseUrl,
        {
          messages: nextHistory,
          mode,
          sessionId,
          attachedFiles: attachedFilePaths,
        },
        {
          onEvent: (event) => {
            const builder = builderRef.current;
            if (!builder) return;

            switch (event.type) {
              case 'text_delta':
                builder.addTextDelta(event.delta || '');
                break;
              case 'thinking_delta':
                builder.addThinkingDelta(event.delta || '');
                break;
              case 'tool_start':
                builder.addToolStart(event.toolCallId || '', event.toolName || '', event.args);
                break;
              case 'tool_end':
                builder.addToolEnd(event.toolCallId || '', event.output || '', event.isError || false);
                break;
              case 'error':
                setError(event.message || 'Unknown error');
                setLastFailedMessage(userMessage);
                setLastFailedAttachments(attachedFilePaths || []);
                break;
              case 'done':
                break;
            }

            const snapshot = builder.build();
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = snapshot;
              return updated;
            });
          },
          onError: (err) => {
            if (builderRef.current) {
              const final = builderRef.current.finalize();
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = final;
                return updated;
              });
            }
            setError(err.message);
            setLastFailedMessage(userMessage);
            setLastFailedAttachments(attachedFilePaths || []);
            setIsStreaming(false);
          },
          onComplete: () => {
            if (builderRef.current) {
              const final = builderRef.current.finalize();
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = final;
                return updated;
              });
            }
            setIsStreaming(false);
          },
        },
      );
      return true;
    },
    [baseUrl, mode, sessionId],
  );

  // --- Retry last failed message ---
  const retry = useCallback(() => {
    if (lastFailedMessage) {
      // Remove the failed assistant message + user message
      setMessages((prev) => prev.slice(0, -2));
      send(lastFailedMessage, lastFailedAttachments);
    }
  }, [lastFailedMessage, lastFailedAttachments, send]);

  // --- Cancel streaming ---
  const cancel = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    if (builderRef.current) {
      const final = builderRef.current.finalize();
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = final;
        return updated;
      });
    }
    setIsStreaming(false);
  }, []);

  // --- New chat (with session reset) ---
  const newChat = useCallback(async () => {
    cancel();
    setMessages([]);
    setError('');
    setLastFailedMessage('');
    setLastFailedAttachments([]);
    const newId = `s-${Date.now()}`;
    setSessionId(newId);
    await AsyncStorage.setItem(SESSION_STORAGE_KEY, newId);
    await AsyncStorage.removeItem(CHAT_STORAGE_KEY);
  }, [cancel]);

  return {
    messages,
    isStreaming,
    error,
    lastFailedMessage,
    lastFailedAttachments,
    loaded,
    sessionId,
    send,
    retry,
    cancel,
    newChat,
  };
}
