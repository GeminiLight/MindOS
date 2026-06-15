/**
 * SSE (Server-Sent Events) client for React Native (Hermes).
 *
 * IMPORTANT: Hermes does NOT support ReadableStream or TextDecoder.
 * This implementation uses XMLHttpRequest with onprogress, which is
 * the only reliable way to get streaming data in React Native.
 *
 * MindOS /api/ask SSE format:
 *   data:{"type":"text_delta","delta":"hello"}\n\n
 *   data:{"type":"done"}\n\n
 */

import type { Message, MessagePart, ReasoningPart, ToolCallPart } from './types';

// ─── SSE Event Types ───────────────────────────────────────────

export type SSEEventType =
  | 'text_delta'
  | 'thinking_delta'
  | 'tool_start'
  | 'tool_delta'
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

// ─── XMLHttpRequest-based SSE Stream ───────────────────────────

/**
 * Stream SSE events from /api/ask using XMLHttpRequest.
 * Returns a cancel function.
 */
export function streamChat(
  baseUrl: string,
  body: Record<string, unknown>,
  callbacks: StreamConsumerCallbacks,
  options: { authToken?: string } = {},
): () => void {
  let isClosed = false;
  let completed = false;
  let processedLength = 0;
  let buffer = '';

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${baseUrl}/api/ask`);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Accept', 'text/event-stream');
  if (options.authToken) {
    xhr.setRequestHeader('Authorization', `Bearer ${options.authToken}`);
  }

  const completeOnce = () => {
    if (completed) return;
    completed = true;
    callbacks.onComplete();
  };

  const processEvent = (event: SSEEvent) => {
    callbacks.onEvent(event);
    if (event.type === 'done' || event.type === 'error') {
      isClosed = true;
      completeOnce();
      return true;
    }
    return false;
  };

  const processBuffer = (text: string) => {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;

      const dataStr = line.slice(5).trim();
      if (!dataStr) continue;

      try {
        const event = JSON.parse(dataStr) as SSEEvent;
        if (processEvent(event)) return true;
      } catch {
        // Skip unparseable lines (e.g. partial JSON)
      }
    }
    return false;
  };

  const responseErrorMessage = () => {
    const status = xhr.status || 0;
    const fallback = status ? `MindOS request failed with HTTP ${status}` : 'MindOS request failed';
    if (!xhr.responseText) return fallback;
    try {
      const data = JSON.parse(xhr.responseText) as { error?: unknown; message?: unknown };
      if (typeof data.message === 'string' && data.message) return data.message;
      if (typeof data.error === 'string' && data.error) return data.error;
    } catch {
      // Non-JSON response body; use HTTP status fallback.
    }
    return fallback;
  };

  xhr.onprogress = () => {
    if (isClosed) return;

    // Get only the new data since last progress event
    const newData = xhr.responseText.slice(processedLength);
    processedLength = xhr.responseText.length;

    buffer += newData;

    // SSE events are separated by \n\n
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      if (processBuffer(chunk)) return;
    }
  };

  xhr.onload = () => {
    if (!completed && xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
      isClosed = true;
      callbacks.onError(new Error(responseErrorMessage()));
      return;
    }

    if (!completed) {
      if (!isClosed && buffer.trim()) processBuffer(buffer);
      completeOnce();
    }
    isClosed = true;
  };

  xhr.onerror = () => {
    if (!isClosed) {
      callbacks.onError(new Error('Network error — check your connection'));
    }
    isClosed = true;
  };

  xhr.ontimeout = () => {
    if (!isClosed) {
      callbacks.onError(new Error('Request timed out'));
    }
    isClosed = true;
  };

  // 5 minute timeout for long-running agent tasks
  xhr.timeout = 300_000;

  try {
    xhr.send(JSON.stringify(body));
  } catch (e) {
    callbacks.onError(e instanceof Error ? e : new Error(String(e)));
    isClosed = true;
  }

  return () => {
    if (!isClosed) {
      isClosed = true;
      xhr.abort();
    }
  };
}

// ─── Message Builder ───────────────────────────────────────────

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

  addToolDelta(toolCallId: string, delta: string): void {
    const tc = this.toolCalls.get(toolCallId);
    if (tc) {
      tc.output = `${tc.output ?? ''}${delta}`;
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
      if (tc.state === 'running') {
        tc.state = 'error';
        tc.output = tc.output || 'Stream ended before tool completed';
      }
    }
    return this.build();
  }
}
