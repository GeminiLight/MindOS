import type { Message, MessagePart, ToolCallPart, TextPart, ReasoningPart } from '@/lib/types';

/**
 * Parse a UIMessageStream SSE response into structured Message parts.
 * The stream format is Server-Sent Events where each data line is a JSON-encoded UIMessageChunk.
 */
export async function consumeUIMessageStream(
  body: ReadableStream<Uint8Array>,
  onUpdate: (message: Message) => void,
  signal?: AbortSignal,
): Promise<Message> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Mutable working copies — we deep-clone when emitting to React
  const parts: MessagePart[] = [];
  const toolCalls = new Map<string, ToolCallPart>();
  let currentTextId: string | null = null;
  let currentReasoningPart: ReasoningPart | null = null;

  /** Deep-clone parts into an immutable Message snapshot for React state */
  function buildMessage(): Message {
    const clonedParts: MessagePart[] = parts.map(p => {
      if (p.type === 'text') return { type: 'text' as const, text: p.text };
      if (p.type === 'reasoning') return { type: 'reasoning' as const, text: p.text };
      return { ...p }; // ToolCallPart — shallow copy is safe (all primitive fields + `input` is replaced, not mutated)
    });
    const textContent = clonedParts
      .filter((p): p is TextPart => p.type === 'text')
      .map(p => p.text)
      .join('');
    return {
      role: 'assistant',
      content: textContent,
      parts: clonedParts,
    };
  }

  function findOrCreateTextPart(id: string): TextPart {
    if (currentTextId === id) {
      const last = parts[parts.length - 1];
      if (last && last.type === 'text') return last;
    }
    const part: TextPart = { type: 'text', text: '' };
    parts.push(part);
    currentTextId = id;
    return part;
  }

  function findOrCreateToolCall(toolCallId: string, toolName?: string): ToolCallPart {
    let tc = toolCalls.get(toolCallId);
    if (!tc) {
      tc = {
        type: 'tool-call',
        toolCallId,
        toolName: toolName ?? 'unknown',
        input: undefined,
        state: 'pending',
      };
      toolCalls.set(toolCallId, tc);
      parts.push(tc);
      currentTextId = null; // break text continuity
    }
    return tc;
  }

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep incomplete last line

      let changed = false;

      for (const line of lines) {
        const trimmed = line.trim();

        // SSE format: the ai SDK v6 UIMessageStream uses "d:{json}\n"
        // Also handle standard "data:{json}" for robustness
        let jsonStr: string | null = null;
        if (trimmed.startsWith('d:')) {
          jsonStr = trimmed.slice(2);
        } else if (trimmed.startsWith('data:')) {
          jsonStr = trimmed.slice(5).trim();
        }

        if (!jsonStr) continue;

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(jsonStr);
        } catch {
          continue; // skip malformed lines
        }

        const type = chunk.type as string;

        switch (type) {
          case 'text-start': {
            findOrCreateTextPart(chunk.id as string);
            changed = true;
            break;
          }
          case 'text-delta': {
            const part = findOrCreateTextPart(chunk.id as string);
            part.text += chunk.delta as string;
            changed = true;
            break;
          }
          case 'text-end': {
            // Text part is complete — no state change needed
            break;
          }
          case 'tool-input-start': {
            const tc = findOrCreateToolCall(chunk.toolCallId as string, chunk.toolName as string);
            tc.state = 'running';
            changed = true;
            break;
          }
          case 'tool-input-delta': {
            // Streaming input — we wait for input-available for the complete input
            break;
          }
          case 'tool-input-available': {
            const tc = findOrCreateToolCall(chunk.toolCallId as string, chunk.toolName as string);
            tc.input = chunk.input;
            tc.state = 'running';
            changed = true;
            break;
          }
          case 'tool-output-available': {
            const tc = toolCalls.get(chunk.toolCallId as string);
            if (tc) {
              tc.output = chunk.output != null
                ? (typeof chunk.output === 'string' ? chunk.output : JSON.stringify(chunk.output))
                : '';
              tc.state = 'done';
              changed = true;
            }
            break;
          }
          case 'tool-output-error':
          case 'tool-input-error': {
            const tc = toolCalls.get(chunk.toolCallId as string);
            if (tc) {
              tc.output = (chunk.errorText as string) ?? (chunk.error as string) ?? 'Tool error';
              tc.state = 'error';
              changed = true;
            }
            break;
          }
          case 'error': {
            const errorText = (chunk.errorText as string) ?? 'Unknown error';
            parts.push({ type: 'text', text: `\n\n**Error:** ${errorText}` });
            currentTextId = null;
            changed = true;
            break;
          }
          // step-start, metadata, finish — ignored for now
          case 'reasoning-start': {
            currentReasoningPart = { type: 'reasoning', text: '' };
            parts.push(currentReasoningPart);
            currentTextId = null;
            changed = true;
            break;
          }
          case 'reasoning-delta': {
            if (currentReasoningPart) {
              currentReasoningPart.text += chunk.delta as string;
              changed = true;
            }
            break;
          }
          case 'reasoning-end': {
            currentReasoningPart = null;
            break;
          }
          default:
            break;
        }
      }

      // Emit once per reader.read() batch, not per SSE line
      if (changed) {
        onUpdate(buildMessage());
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Finalize any tool calls still stuck in running/pending state
  // (stream ended before their output arrived — e.g. abort, network error, step limit)
  let finalized = false;
  for (const tc of toolCalls.values()) {
    if (tc.state === 'running' || tc.state === 'pending') {
      tc.state = 'error';
      tc.output = tc.output ?? 'Stream ended before tool completed';
      finalized = true;
    }
  }
  if (finalized) {
    onUpdate(buildMessage());
  }

  return buildMessage();
}
