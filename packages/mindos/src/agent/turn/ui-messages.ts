/**
 * UI agent message types and the UI-message → model-history conversion
 * (`toMindosAgentMessages`). Split out of `index.ts` (which stayed over the
 * 1000-line budget); `index.ts` re-exports everything here, so consumers
 * keep importing from the barrel.
 */
export type MindosUiImagePart = {
  type: 'image';
  data?: string;
  mimeType?: string;
};

export type MindosUiTextPart = {
  type: 'text';
  text?: string;
};

export type MindosUiReasoningPart = {
  type: 'reasoning';
  text?: string;
};

export type MindosUiToolCallPart = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: unknown;
  output?: string;
  state?: 'pending' | 'running' | 'done' | 'error';
};

export type MindosUiRuntimeStatusPart = {
  type: 'runtime-status';
  message: string;
  runtime?: 'mindos' | 'acp' | 'codex' | 'claude';
};

export type MindosUiMessagePart =
  | MindosUiImagePart
  | MindosUiTextPart
  | MindosUiReasoningPart
  | MindosUiToolCallPart
  | MindosUiRuntimeStatusPart;

export type MindosUiAgentMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  skillName?: string;
  parts?: MindosUiMessagePart[];
  images?: MindosUiImagePart[];
};

export type MindosAgentHistoryMessage = Record<string, unknown>;

export function toMindosAgentMessages(messages: MindosUiAgentMessage[]): MindosAgentHistoryMessage[] {
  const result: MindosAgentHistoryMessage[] = [];

  for (const msg of messages) {
    const timestamp = msg.timestamp ?? Date.now();

    if (msg.role === 'user') {
      result.push({
        role: 'user',
        content: buildMindosUserContent(msg.content, msg.images),
        timestamp,
      });
      continue;
    }

    if (msg.content.startsWith('__error__')) continue;

    if (!msg.parts || msg.parts.length === 0) {
      if (msg.content) {
        result.push(createMindosAssistantHistoryMessage({
          content: [{ type: 'text', text: msg.content }],
          stopReason: 'stop',
          timestamp,
        }));
      }
      continue;
    }

    const assistantContent: Array<Record<string, unknown>> = [];
    const toolCalls: MindosUiToolCallPart[] = [];

    for (const part of msg.parts) {
      if (part.type === 'text') {
        if (part.text) assistantContent.push({ type: 'text', text: part.text });
      } else if (part.type === 'tool-call') {
        assistantContent.push({
          type: 'toolCall',
          id: part.toolCallId,
          name: part.toolName,
          arguments: part.input ?? {},
        });
        toolCalls.push(part);
      } else if (part.type === 'runtime-status') {
        // UI-only runtime diagnostics should not become model conversation history.
      }
    }

    if (assistantContent.length > 0) {
      result.push(createMindosAssistantHistoryMessage({
        content: assistantContent,
        stopReason: toolCalls.length > 0 ? 'toolUse' : 'stop',
        timestamp,
      }));
    }

    for (const toolCall of toolCalls) {
      result.push({
        role: 'toolResult',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        content: [{ type: 'text', text: toolCall.output ?? '' }],
        isError: toolCall.state === 'error',
        timestamp,
      });
    }
  }

  return result;
}

function buildMindosUserContent(text: string, images?: MindosUiImagePart[]): string | Array<Record<string, unknown>> {
  const validImages = images?.filter((image) => image.data);
  if (!validImages || validImages.length === 0) return text;

  const parts: Array<Record<string, unknown>> = validImages.map((image) => ({
    type: 'image',
    data: image.data,
    mimeType: image.mimeType,
  }));
  if (text) parts.push({ type: 'text', text });
  return parts;
}

function createMindosAssistantHistoryMessage(input: {
  content: Array<Record<string, unknown>>;
  stopReason: 'stop' | 'toolUse';
  timestamp: number;
}): MindosAgentHistoryMessage {
  return {
    role: 'assistant',
    content: input.content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: '',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: input.stopReason,
    timestamp: input.timestamp,
  };
}
