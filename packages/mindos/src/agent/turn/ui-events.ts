import { MINDOS_AGENT_TURN_STREAM_EVENT_TYPES, type MindOSSSEvent } from './sse.js';
export * from './sse.js';
export { sanitizeToolArgs } from './tool-event-safety.js';

export type MessageUpdateEvent = {
  type: 'message_update';
  assistantMessageEvent?: { type: string; delta?: string };
};

export type ToolExecStartEvent = {
  type: 'tool_execution_start';
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type ToolExecEndEvent = {
  type: 'tool_execution_end';
  toolCallId: string;
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
  messages?: Array<{
    role: string;
    content?: Array<{ type: string; text?: string }>;
    stopReason?: string;
    errorMessage?: string;
  }>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

export function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const child = value[key];
  return isRecord(child) ? child : undefined;
}

export function isTextDeltaEvent(event: unknown): event is MessageUpdateEvent {
  if (!isRecord(event) || event.type !== 'message_update') return false;
  return nestedRecord(event, 'assistantMessageEvent')?.type === 'text_delta';
}

export function getTextDelta(event: unknown): string {
  if (!isRecord(event)) return '';
  const assistantEvent = nestedRecord(event, 'assistantMessageEvent');
  return typeof assistantEvent?.delta === 'string' ? assistantEvent.delta : '';
}

export function isThinkingDeltaEvent(event: unknown): event is MessageUpdateEvent {
  if (!isRecord(event) || event.type !== 'message_update') return false;
  return nestedRecord(event, 'assistantMessageEvent')?.type === 'thinking_delta';
}

export function getThinkingDelta(event: unknown): string {
  return getTextDelta(event);
}

export function isToolExecutionStartEvent(event: unknown): event is ToolExecStartEvent {
  return isRecord(event) && event.type === 'tool_execution_start';
}

export function getToolExecutionStart(event: unknown): { toolCallId: string; toolName: string; args: unknown } {
  if (!isRecord(event)) return { toolCallId: '', toolName: 'unknown', args: {} };
  return {
    toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : '',
    toolName: typeof event.toolName === 'string' ? event.toolName : 'unknown',
    args: event.args ?? {},
  };
}

export function isToolExecutionEndEvent(event: unknown): event is ToolExecEndEvent {
  return isRecord(event) && event.type === 'tool_execution_end';
}

export function getToolExecutionEnd(event: unknown): { toolCallId: string; output: string; isError: boolean } {
  if (!isRecord(event)) return { toolCallId: '', output: '', isError: false };
  const result = nestedRecord(event, 'result');
  const content = Array.isArray(result?.content) ? result.content : [];
  const output = content
    .filter((part): part is { type: string; text?: string } => isRecord(part) && part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');

  return {
    toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : '',
    output,
    isError: event.isError === true,
  };
}

export function isTurnEndEvent(event: unknown): event is TurnEndEvent {
  return isRecord(event) && event.type === 'turn_end';
}

export function getTurnEndData(event: unknown): { toolResults: Array<{ toolName: string; content: unknown }> } {
  if (!isRecord(event)) return { toolResults: [] };
  return {
    toolResults: Array.isArray(event.toolResults)
      ? event.toolResults.filter((item): item is { toolName: string; content: unknown } => isRecord(item) && typeof item.toolName === 'string')
      : [],
  };
}

export function parseMindosSseLine(line: string): MindOSSSEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const json = trimmed.slice(5).trim();
  if (!json || json === '[DONE]') return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return null;
    if (!(MINDOS_AGENT_TURN_STREAM_EVENT_TYPES as readonly string[]).includes(parsed.type)) return null;
    return parsed as MindOSSSEvent;
  } catch {
    return null;
  }
}
