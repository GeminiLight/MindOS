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
import { mindosClient } from '@/lib/api-client';
import type { Message, AskMode, AgentRuntimeIdentity } from '@/lib/types';

export interface UseChatWithSessionOptions {
  sessionId: string;
  initialMessages: Message[];
  initialMessagesLoaded?: boolean;
  mode?: AskMode;
  selectedRuntime?: AgentRuntimeIdentity | null;
  onMessagesChange: (messages: Message[]) => void;
}

const generateMessageId = (): string => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export function useChatWithSession({
  sessionId,
  initialMessages,
  initialMessagesLoaded = true,
  mode = 'chat',
  selectedRuntime = null,
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
  const streamEndedRef = useRef(true);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  const finishCurrentStream = useCallback(() => {
    if (streamEndedRef.current) return;
    streamEndedRef.current = true;
    if (builderRef.current) {
      const final = builderRef.current.finalize();
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = final;
        return updated;
      });
    }
    cancelRef.current = null;
    setIsStreaming(false);
  }, []);

  // Reset when session changes or async-loaded messages arrive.
  useEffect(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    builderRef.current = null;
    streamEndedRef.current = true;
    setIsStreaming(false);
    setError('');
    setLastFailedMessage('');
    setLastFailedAttachments([]);
    if (!initialMessagesLoaded) {
      setMessages([]);
      return;
    }
    setMessages(initialMessages);
  }, [initialMessages, initialMessagesLoaded, sessionId]);

  // Notify parent of message changes (debounced)
  const notifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!sessionId || !initialMessagesLoaded) return;
    if (isStreaming) return;
    if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = setTimeout(() => {
      onMessagesChange(messages);
    }, 500);
    return () => { if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current); };
  }, [initialMessagesLoaded, messages, isStreaming, onMessagesChange, sessionId]);

  // --- Send message ---
  const send = useCallback(
    (userMessage: string, attachedFilePaths?: string[]) => {
      if (!baseUrl || !sessionId || !initialMessagesLoaded) return false;

      setError('');
      setLastFailedMessage('');
      setLastFailedAttachments([]);
      setIsStreaming(true);
      streamEndedRef.current = false;

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
          chatSessionId: sessionId,
          attachedFiles: attachedFilePaths,
          ...(selectedRuntime ? { selectedRuntime } : {}),
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
              case 'tool_delta':
                builder.addToolDelta(event.toolCallId || '', event.delta || '');
                break;
              case 'tool_end':
                builder.addToolEnd(event.toolCallId || '', event.output || '', event.isError || false);
                break;
              case 'error':
                setError(event.message || 'Unknown error');
                setLastFailedMessage(userMessage);
                setLastFailedAttachments(attachedFilePaths || []);
                finishCurrentStream();
                return;
              case 'done':
                finishCurrentStream();
                return;
              case 'status':
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
            setError(err.message);
            setLastFailedMessage(userMessage);
            setLastFailedAttachments(attachedFilePaths || []);
            finishCurrentStream();
          },
          onComplete: () => {
            finishCurrentStream();
          },
        },
        { authToken: mindosClient.authToken },
      );
      return true;
    },
    [baseUrl, finishCurrentStream, initialMessagesLoaded, mode, selectedRuntime, sessionId],
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
    finishCurrentStream();
  }, [finishCurrentStream]);

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
    ready: initialMessagesLoaded,
    send,
    retry,
    cancel,
    clearMessages,
  };
}
