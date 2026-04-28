/**
 * useChatWithSession — Chat hook that works with external session management.
 *
 * Unlike useChat, this hook:
 * - Receives sessionId and initialMessages from parent
 * - Calls onMessagesChange callback when messages update
 * - Does NOT manage its own AsyncStorage persistence
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import { useConnectionStore } from '@/lib/connection-store';
import { streamChat, MessageBuilder } from '@/lib/sse-client';
import type { Message, AskMode } from '@/lib/types';

export interface UseChatWithSessionOptions {
  sessionId: string;
  initialMessages: Message[];
  mode?: AskMode;
  onMessagesChange: (messages: Message[]) => void;
}

const generateMessageId = (): string => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export function useChatWithSession({
  sessionId,
  initialMessages,
  mode = 'chat',
  onMessagesChange,
}: UseChatWithSessionOptions) {
  const baseUrl = useConnectionStore((s) => s.serverUrl);

  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState('');
  const [lastFailedMessage, setLastFailedMessage] = useState('');
  const [lastFailedAttachments, setLastFailedAttachments] = useState<string[]>([]);

  const cancelRef = useRef<(() => void) | null>(null);
  const builderRef = useRef<MessageBuilder | null>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  // Reset when session changes (ignore initialMessages reference to avoid re-render loop)
  useEffect(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setIsStreaming(false);
    setMessages(initialMessages);
    setError('');
    setLastFailedMessage('');
    setLastFailedAttachments([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Notify parent of message changes (debounced)
  const notifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isStreaming) return;
    if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = setTimeout(() => {
      onMessagesChange(messages);
    }, 500);
    return () => { if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current); };
  }, [messages, isStreaming, onMessagesChange]);

  // --- Send message ---
  const send = useCallback(
    (userMessage: string, attachedFilePaths?: string[]) => {
      if (!baseUrl || !sessionId) return false;

      setError('');
      setLastFailedMessage('');
      setLastFailedAttachments([]);
      setIsStreaming(true);

      const userMsg: Message = {
        id: generateMessageId(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
        attachedFiles: attachedFilePaths,
      };

      const placeholder: Message = {
        id: generateMessageId(),
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

  // --- Clear messages (for new chat within same session) ---
  const clearMessages = useCallback(() => {
    cancel();
    setMessages([]);
    setError('');
    setLastFailedMessage('');
    setLastFailedAttachments([]);
  }, [cancel]);

  return {
    messages,
    isStreaming,
    error,
    lastFailedMessage,
    lastFailedAttachments,
    send,
    retry,
    cancel,
    clearMessages,
  };
}
