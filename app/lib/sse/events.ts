import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

/**
 * MindOS SSE event types sent to client.
 * This is the contract between backend and frontend for streaming responses.
 */
export type MindOSSSEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; toolCallId: string; output: string; isError: boolean }
  | { type: 'done'; usage?: { input: number; output: number } }
  | { type: 'error'; message: string }
  | { type: 'status'; message: string };

/**
 * Type guards for AgentEvent variants.
 * AgentEvent from pi-coding-agent is a union; these interfaces describe actual shapes.
 */

export type MessageUpdateEvent = {
  type: 'message_update';
  assistantMessageEvent?: { type: string; delta?: string };
};

export type ToolExecStartEvent = {
  type: 'tool_execution_start';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
};

export type ToolExecEndEvent = {
  type: 'tool_execution_end';
  toolCallId?: string;
  result?: { content?: Array<{ type: string; text?: string }> };
  isError?: boolean;
};

export type TurnEndEvent = {
  type: 'turn_end';
  toolResults?: Array<{ toolName: string; content: unknown }>;
  usage?: { inputTokens: number; outputTokens?: number };
};

export type AgentEndEvent = {
  type: 'agent_end';
  messages?: Array<{ role: string; content?: Array<{ type: string; text?: string }> }>;
};

/**
 * Type guard functions for safe event handling.
 */

export function isTextDeltaEvent(e: any): e is MessageUpdateEvent {
  return e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta';
}

export function getTextDelta(e: any): string {
  return e.assistantMessageEvent?.delta ?? '';
}

export function isThinkingDeltaEvent(e: any): e is MessageUpdateEvent {
  return e.type === 'message_update' && e.assistantMessageEvent?.type === 'thinking_delta';
}

export function getThinkingDelta(e: any): string {
  return e.assistantMessageEvent?.delta ?? '';
}

export function isToolExecutionStartEvent(e: any): e is ToolExecStartEvent {
  return e.type === 'tool_execution_start';
}

export function getToolExecutionStart(e: any): { toolCallId: string; toolName: string; args: unknown } {
  return {
    toolCallId: e.toolCallId ?? '',
    toolName: e.toolName ?? 'unknown',
    args: e.args ?? {},
  };
}

export function isToolExecutionEndEvent(e: any): e is ToolExecEndEvent {
  return e.type === 'tool_execution_end';
}

export function getToolExecutionEnd(e: any): { toolCallId: string; output: string; isError: boolean } {
  const outputText = e.result?.content
    ?.filter((p: any) => p.type === 'text')
    .map((p: any) => p.text ?? '')
    .join('') ?? '';
  return {
    toolCallId: e.toolCallId ?? '',
    output: outputText,
    isError: !!e.isError,
  };
}

export function isTurnEndEvent(e: any): e is TurnEndEvent {
  return e.type === 'turn_end';
}

export function getTurnEndData(e: any): { toolResults: Array<{ toolName: string; content: unknown }> } {
  return {
    toolResults: e.toolResults ?? [],
  };
}

/**
 * Sanitize tool arguments before SSE transmission.
 * Strips large fields (file content) that would bloat payload.
 */
export function sanitizeToolArgs(toolName: string, args: unknown): unknown {
  if (!args || typeof args !== 'object') return args;
  const a = args as Record<string, unknown>;

  if (toolName === 'batch_create_files' && Array.isArray(a.files)) {
    return {
      ...a,
      files: (a.files as Array<Record<string, unknown>>).map(f => ({
        path: f.path,
        ...(f.description ? { description: f.description } : {}),
      })),
    };
  }

  if (typeof a.content === 'string' && a.content.length > 200) {
    return { ...a, content: `[${a.content.length} chars]` };
  }
  if (typeof a.text === 'string' && a.text.length > 200) {
    return { ...a, text: `[${a.text.length} chars]` };
  }
  return args;
}
