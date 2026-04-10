/**
 * useChat — React hook for AI conversation with streaming support.
 */

import { useCallback, useRef, useState } from 'react';
import { useConnectionStore } from '@/lib/connection-store';
import { streamChat, MessageBuilder } from '@/lib/sse-client';
import type { Message, AskMode } from '@/lib/types';

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
  // Use a ref to always have latest messages in the closure
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  const send = useCallback(
    (userMessage: string, attachedFilePaths?: string[]) => {
      setError('');
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

      setMessages((prev) => [...prev, userMsg, placeholder]);

      builderRef.current = new MessageBuilder();

      // streamChat is synchronous — returns cancel fn immediately
      cancelRef.current = streamChat(
        baseUrl,
        {
          messages: [...messagesRef.current, userMsg],
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
                break;
              case 'done':
                break;
            }

            // Update UI with latest snapshot
            const snapshot = builder.build();
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = snapshot;
              return updated;
            });
          },
          onError: (err) => {
            // Finalize partial message
            if (builderRef.current) {
              const final = builderRef.current.finalize();
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = final;
                return updated;
              });
            }
            setError(err.message);
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
    },
    [baseUrl, mode, sessionId],
  );

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

  const clear = useCallback(() => {
    cancel();
    setMessages([]);
    setError('');
  }, [cancel]);

  return { messages, isStreaming, error, send, cancel, clear };
}
