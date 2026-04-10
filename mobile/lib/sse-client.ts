/**
 * SSE (Server-Sent Events) client for React Native mobile.
 *
 * MindOS /api/ask uses text/event-stream format:
 *   data:{"type":"text_delta","delta":"hello"}\n\n
 *   data:{"type":"tool_start","toolCallId":"1","toolName":"search","args":{}}\n\n
 *   data:{"type":"done"}\n\n
 *
 * This implementation uses native fetch() with manual SSE parsing.
 * No dependency on react-native-sse.
 */

import type { Message, MessagePart, TextPart, ReasoningPart, ToolCallPart } from './types';

export type SSEEventType =
  | 'text_delta'
  | 'thinking_delta'
  | 'tool_start'
  | 'tool_end'
  | 'done'
  | 'error'
  | 'status';

export interface SSEEvent {
  type: SSEEventType;
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  output?: string;
  isError?: boolean;
  message?: string;
  usage?: { input: number; output: number };
}

export interface StreamConsumerCallbacks {
  onEvent: (event: SSEEvent) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
}

/**
 * Consume SSE stream from /api/ask.
 * Returns a cancel function to abort the stream.
 */
export function streamChat(
  baseUrl: string,
  body: Record<string, unknown>,
  callbacks: StreamConsumerCallbacks,
  externalSignal?: AbortSignal,
): () => void {
  const controller = new AbortController();
  let isClosed = false;

  // Forward external abort to our controller (AbortSignal.any() is not in RN)
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  (async () => {
    try {
      const response = await fetch(`${baseUrl}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body — streaming may not be supported');

      const decoder = new TextDecoder();
      let buffer = '';

      while (!isClosed) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE uses \n\n as event separator
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          // Each SSE event can have multiple lines; we only care about data: lines
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data:')) continue;

            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;

            try {
              const event = JSON.parse(dataStr) as SSEEvent;
              callbacks.onEvent(event);

              if (event.type === 'done' || event.type === 'error') {
                isClosed = true;
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      }

      if (!isClosed) callbacks.onComplete();
    } catch (error) {
      if (!isClosed && !(error instanceof Error && error.name === 'AbortError')) {
        callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      isClosed = true;
    }
  })();

  return () => {
    isClosed = true;
    controller.abort();
  };
}

/**
 * Build a Message from accumulated SSE events.
 * Merges text_delta into content; structures tool calls into parts[].
 */
export class MessageBuilder {
  private parts: MessagePart[] = [];
  private currentText = '';
  private toolCalls = new Map<string, ToolCallPart>();
  private startedAt = Date.now();

  addTextDelta(delta: string): void {
    this.currentText += delta;
  }

  addThinkingDelta(delta: string): void {
    const last = this.parts[this.parts.length - 1];
    if (last && last.type === 'reasoning') {
      (last as ReasoningPart).text += delta;
    } else {
      this.parts.push({ type: 'reasoning', text: delta });
    }
  }

  addToolStart(toolCallId: string, toolName: string, args: unknown): void {
    const toolCall: ToolCallPart = {
      type: 'tool-call',
      toolCallId,
      toolName,
      input: args,
      state: 'running',
    };
    this.toolCalls.set(toolCallId, toolCall);
    this.parts.push(toolCall);
  }

  addToolEnd(toolCallId: string, output: string, isError: boolean): void {
    const tc = this.toolCalls.get(toolCallId);
    if (tc) {
      tc.output = output;
      tc.state = isError ? 'error' : 'done';
    }
  }

  /** Build the current snapshot of the assistant message. */
  build(): Message {
    return {
      role: 'assistant',
      content: this.currentText,
      parts: this.parts.length > 0 ? [...this.parts] : undefined,
      timestamp: this.startedAt,
    };
  }

  /** Finalize: mark unfinished tool calls as errored. */
  finalize(): Message {
    for (const tc of this.toolCalls.values()) {
      if (tc.state === 'running' || tc.state === 'pending') {
        tc.state = 'error';
        tc.output = tc.output || 'Stream ended before tool completed';
      }
    }
    return this.build();
  }
}
