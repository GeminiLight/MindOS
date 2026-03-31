/**
 * Convert frontend Message[] (with parts containing tool calls + results)
 * into pi-agent-core AgentMessage[] that Agent expects.
 *
 * This is "Layer 1" of the two-layer conversion:
 *   Frontend Message[] → AgentMessage[] (this file)
 *   AgentMessage[] → pi-ai Message[] (handled by Agent's convertToLlm internally)
 *
 * Key responsibilities:
 * - User messages: wrap as { role: 'user', content, timestamp }
 * - Assistant messages: convert parts into { role: 'assistant', content: [...] }
 * - Tool results: emit separate { role: 'toolResult', ... } per tool call
 * - Orphaned tool calls (running/pending from interrupted streams): supply empty result
 * - Reasoning parts: filtered out (display-only, not sent back to LLM)
 */
import type { Message as FrontendMessage, ToolCallPart as FrontendToolCallPart, ImagePart } from '@/lib/types';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { UserMessage, AssistantMessage, ToolResultMessage } from '@mariozechner/pi-ai';

// Re-export for convenience
export type { AgentMessage } from '@mariozechner/pi-agent-core';

/** Build multimodal content array for user messages with images */
function buildUserContent(text: string, images?: ImagePart[]): string | any[] {
  // Filter out stripped images (empty data from persisted sessions)
  const validImages = images?.filter(img => img.data);
  if (!validImages || validImages.length === 0) return text;

  // Multimodal content: images first, then text
  // Use pi-ai ImageContent format: { type: 'image', data: base64, mimeType }
  // The SDK converts this to the provider-specific format (Anthropic/OpenAI) internally
  const parts: any[] = [];
  for (const img of validImages) {
    parts.push({
      type: 'image',
      data: img.data,
      mimeType: img.mimeType,
    });
  }
  if (text) {
    parts.push({ type: 'text', text });
  }
  return parts;
}

export function toAgentMessages(messages: FrontendMessage[]): AgentMessage[] {
  const result: AgentMessage[] = [];

  for (const msg of messages) {
    const timestamp = msg.timestamp ?? Date.now();

    if (msg.role === 'user') {
      result.push({
        role: 'user',
        content: buildUserContent(msg.content, msg.images),
        timestamp,
      } satisfies UserMessage as AgentMessage);
      continue;
    }

    // Skip error placeholder messages from frontend
    if (msg.content.startsWith('__error__')) continue;

    // Assistant message
    if (!msg.parts || msg.parts.length === 0) {
      // Plain text assistant message — no tool calls
      if (msg.content) {
        result.push({
          role: 'assistant',
          content: [{ type: 'text', text: msg.content }],
          // Minimal required fields for historical messages
          api: 'anthropic-messages' as any,
          provider: 'anthropic' as any,
          model: '',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop',
          timestamp,
        } satisfies AssistantMessage as AgentMessage);
      }
      continue;
    }

    // Build assistant content array (text + tool calls)
    const assistantContent: AssistantMessage['content'] = [];
    const toolCalls: FrontendToolCallPart[] = [];

    for (const part of msg.parts) {
      if (part.type === 'text') {
        if (part.text) {
          assistantContent.push({ type: 'text', text: part.text });
        }
      } else if (part.type === 'tool-call') {
        assistantContent.push({
          type: 'toolCall' as any,
          id: part.toolCallId,
          name: part.toolName,
          arguments: part.input ?? {},
        });
        toolCalls.push(part);
      }
      // 'reasoning' parts are display-only; not sent back to model
    }

    if (assistantContent.length > 0) {
      result.push({
        role: 'assistant',
        content: assistantContent,
        api: 'anthropic-messages' as any,
        provider: 'anthropic' as any,
        model: '',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: toolCalls.length > 0 ? 'toolUse' : 'stop',
        timestamp,
      } satisfies AssistantMessage as AgentMessage);
    }

    // Emit tool result messages for each tool call
    for (const tc of toolCalls) {
      result.push({
        role: 'toolResult',
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        content: [{ type: 'text', text: tc.output ?? '' }],
        isError: tc.state === 'error',
        timestamp,
      } satisfies ToolResultMessage as AgentMessage);
    }
  }

  return result;
}
