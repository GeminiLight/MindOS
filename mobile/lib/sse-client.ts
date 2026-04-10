/**
 * SSE (Server-Sent Events) client for React Native mobile.
 *
 * MindOS /api/ask uses text/event-stream format:
 *   data:{"type":"text_delta","delta":"hello"}\n\n
 *   data:{"type":"tool_start","toolCallId":"1","toolName":"search","args":{}}\n\n
 *   data:{"type":"done"}\n\n
 *
 * This implementation uses native fetch() with manual SSE parsing
 * (react-native-sse was unreliable; this is RN 0.76+ compatible).
 */

import type { Message, MessagePart, TextPart, ReasoningPart, ToolCallPart } from '../lib/types';

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
 * Parses text/event-stream format and calls callbacks for each event.
 *
 * Returns a cancel function to abort the stream.
 */
export async function streamChat(
  baseUrl: string,
  body: Record<string, unknown>,
  callbacks: StreamConsumerCallbacks,
  signal?: AbortSignal,
): Promise<() => void> {
  const controller = new AbortController();
  const cancelSignal = AbortSignal.any([controller.signal, signal || new AbortController().signal]);

  let isClosed = false;

  (async () => {
    try {
      const response = await fetch(`${baseUrl}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: cancelSignal as AbortSignal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (!isClosed) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;

          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;

          try {
            const event = JSON.parse(dataStr) as SSEEvent;
            callbacks.onEvent(event);

            if (event.type === 'done' || event.type === 'error') {
              isClosed = true;
            }
          } catch (parseError) {
            console.warn('[SSE] Failed to parse event:', dataStr, parseError);
          }
        }
      }

      callbacks.onComplete();
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
 * Merges text_delta events and structures tool calls into MessagePart[].
 */
export class MessageBuilder {
  private parts: MessagePart[] = [];
  private currentText = '';
  private toolCalls: Map<string, ToolCallPart> = new Map();

  addTextDelta(delta: string): void {
    this.currentText += delta;
  }

  addThinkingDelta(delta: string): void {
    const last = this.parts[this.parts.length - 1];
    if (last && last.type === 'reasoning') {
      last.text += delta;
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
      state: 'pending',
    };
    this.toolCalls.set(toolCallId, toolCall);
    this.parts.push(toolCall);
  }

  addToolEnd(toolCallId: string, output: string, isError: boolean): void {
    const toolCall = this.toolCalls.get(toolCallId);
    if (toolCall) {
      toolCall.output = output;
      toolCall.state = isError ? 'error' : 'done';
    }
  }

  build(): Message {
    // Finalize any pending tool calls
    for (const tc of this.toolCalls.values()) {
      if (tc.state === 'pending') {
        tc.state = 'error';
        tc.output = 'Stream ended before tool completed';
      }
    }

    // Build text content from accumulated deltas + text parts
    const textParts = this.parts.filter((p) => p.type === 'text') as TextPart[];
    const combinedText = this.currentText + textParts.map((p) => p.text).join('');

    return {
      role: 'assistant',
      content: combinedText,
      parts: this.parts.length > 0 ? this.parts : undefined,
      timestamp: Date.now(),
    };
  }
}
