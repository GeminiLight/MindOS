/**
 * Parse MindOS SSE stream (6 event types) into structured Message parts.
 *
 * MindOS SSE format (backend: route.ts):
 * - text_delta: { type, delta }
 * - thinking_delta: { type, delta } (Anthropic extended thinking)
 * - tool_start: { type, toolCallId, toolName, args }
 * - tool_end: { type, toolCallId, output, isError }
 * - done: { type, usage? }
 * - error: { type, message }
 *
 * Frontend Message structure:
 * - role: 'assistant'
 * - content: concatenated text deltas (for display)
 * - parts: structured [TextPart | ReasoningPart | ToolCallPart] (for detailed view)
 */
import type { Message, MessagePart, ToolCallPart, TextPart, ReasoningPart } from '@/lib/types';

/** Tools that modify files — trigger files-changed notification on completion */
const FILE_MUTATING_TOOLS = new Set([
  'write_file', 'create_file', 'batch_create_files',
  'update_section', 'insert_after_heading', 'delete_file',
  'rename_file', 'create_space',
]);

/** Notify the app that files were changed by the AI agent */
function notifyFilesChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('mindos:files-changed'));
  }
}

export async function consumeUIMessageStream(
  body: ReadableStream<Uint8Array>,
  onUpdate: (message: Message) => void,
  signal?: AbortSignal,
): Promise<Message> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Mutable working copies
  const parts: MessagePart[] = [];
  const toolCalls = new Map<string, ToolCallPart>();
  let currentTextId: string | null = null;
  let currentReasoningPart: ReasoningPart | null = null;

  const startedAt = Date.now();

  /** Build an immutable Message snapshot from current parts */
  function buildMessage(): Message {
    const clonedParts: MessagePart[] = parts.map(p => {
      if (p.type === 'text') return { type: 'text' as const, text: p.text };
      if (p.type === 'reasoning') return { type: 'reasoning' as const, text: p.text };
      // ToolCallPart — shallow copy safe (primitive fields, input is replaced not mutated)
      return { ...p };
    });
    const textContent = clonedParts
      .filter((p): p is TextPart => p.type === 'text')
      .map(p => p.text)
      .join('');
    return {
      role: 'assistant',
      content: textContent,
      parts: clonedParts,
      timestamp: startedAt,
    };
  }

  /** Get or create the last text part with given ID */
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

  /** Get or create a tool call part */
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
      currentTextId = null;
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

        // Standard SSE format: "data:{json}"
        let jsonStr: string | null = null;
        if (trimmed.startsWith('data:')) {
          jsonStr = trimmed.slice(5).trim();
        }

        if (!jsonStr) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(jsonStr);
        } catch {
          continue; // skip malformed
        }

        const type = event.type as string;

        switch (type) {
          case 'text_delta': {
            // Regular text from assistant
            const part = findOrCreateTextPart('text');
            part.text += (event.delta as string) ?? '';
            changed = true;
            break;
          }

          case 'thinking_delta': {
            // Extended thinking (Anthropic)
            if (!currentReasoningPart) {
              currentReasoningPart = { type: 'reasoning', text: '' };
              parts.push(currentReasoningPart);
              currentTextId = null;
            }
            currentReasoningPart.text += (event.delta as string) ?? '';
            changed = true;
            break;
          }

          case 'tool_start': {
            // Beginning of tool execution
            const toolCallId = event.toolCallId as string;
            const toolName = event.toolName as string;
            const tc = findOrCreateToolCall(toolCallId, toolName);
            tc.input = event.args;
            tc.state = 'running';
            changed = true;
            break;
          }

          case 'tool_end': {
            // Tool execution finished
            const toolCallId = event.toolCallId as string;
            const tc = toolCalls.get(toolCallId);
            if (tc) {
              const output = event.output as string;
              tc.output = output ?? '';
              tc.state = (event.isError ? 'error' : 'done');
              changed = true;
              // Notify when a file-modifying tool completes successfully
              if (!event.isError && FILE_MUTATING_TOOLS.has(tc.toolName)) {
                notifyFilesChanged();
              }
            }
            break;
          }

          case 'error': {
            // Stream error
            const message = event.message as string;
            parts.push({
              type: 'text',
              text: `\n\n**Stream Error:** ${message}`,
            });
            currentTextId = null;
            changed = true;
            break;
          }

          case 'done': {
            // Stream completed cleanly — usage data is optional
            // No state change needed; just marks end of SSE stream
            break;
          }

          default:
            // Ignore unknown event types
            break;
        }
      }

      // Emit once per reader batch, not per SSE line
      if (changed) {
        onUpdate(buildMessage());
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Finalize any tool calls still in running/pending state
  // (stream ended unexpectedly — abort, network error, step limit)
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
