/**
 * useChat — React hook for AI conversation with streaming support.
 *
 * Manages:
 * - Message history (user + assistant)
 * - SSE stream consumption
 * - Tool call tracking
 * - Session persistence
 * - Error recovery
 */

import { useCallback, useRef, useState } from 'react';
import { useConnectionStore } from './connection-store';
import { streamChat, MessageBuilder } from '../lib/sse-client';
import type { Message, AskMode } from '../lib/types';

export interface UseChatOptions {
  sessionId: string;
  mode?: AskMode;
}

export function useChat({ sessionId, mode = 'chat' }: UseChatOptions) {
  const baseUrl = useConnectionStore((s) => s.serverUrl);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string>('');

  const cancelRef = useRef<(() => void) | null>(null);
  const builderRef = useRef<MessageBuilder | null>(null);

  /**
   * Send a message and stream the response.
   */
  const send = useCallback(
    async (userMessage: string, attachedFilePaths?: string[]) => {
      setError('');
      setIsStreaming(true);

      // Add user message to history
      const userMsg: Message = {
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
        attachedFiles: attachedFilePaths,
      };

      setMessages((prev) => [...prev, userMsg]);

      // Create placeholder for assistant response
      const assistantPlaceholder: Message = {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantPlaceholder]);

      builderRef.current = new MessageBuilder();

      try {
        cancelRef.current = await streamChat(
          baseUrl,
          {
            messages: [...messages, userMsg],
            mode,
            sessionId,
            attachedFiles: attachedFilePaths,
          },
          {
            onEvent: (event) => {
              if (event.type === 'text_delta') {
                builderRef.current?.addTextDelta(event.delta || '');
              } else if (event.type === 'thinking_delta') {
                builderRef.current?.addThinkingDelta(event.delta || '');
              } else if (event.type === 'tool_start') {
                builderRef.current?.addToolStart(
                  event.toolCallId || '',
                  event.toolName || '',
                  event.args,
                );
              } else if (event.type === 'tool_end') {
                builderRef.current?.addToolEnd(
                  event.toolCallId || '',
                  event.output || '',
                  event.isError || false,
                );
              } else if (event.type === 'error') {
                setError(event.message || 'Unknown error occurred');
              }

              // Update UI incrementally
              const builtMessage = builderRef.current?.build();
              if (builtMessage) {
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = builtMessage;
                  return updated;
                });
              }
            },
            onError: (err) => {
              setError(err.message);
              setIsStreaming(false);
            },
            onComplete: () => {
              setIsStreaming(false);
            },
          },
        );
      } catch (err) {
        setError((err as Error).message || 'Failed to send message');
        setIsStreaming(false);
      }
    },
    [baseUrl, messages, mode, sessionId],
  );

  /**
   * Cancel ongoing stream.
   */
  const cancel = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  /**
   * Clear conversation.
   */
  const clear = useCallback(() => {
    setMessages([]);
    setError('');
    cancel();
  }, [cancel]);

  return {
    messages,
    isStreaming,
    error,
    send,
    cancel,
    clear,
  };
}
