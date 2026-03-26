import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  truncateToolOutputs,
  hardPrune,
  estimateTokens,
  estimateStringTokens,
  getContextLimit,
  needsCompact,
  compactMessages,
} from '../../lib/agent/context';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';

// Mock pi-ai's complete() — intercept the summarizer call
vi.mock('@mariozechner/pi-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mariozechner/pi-ai')>();
  return {
    ...actual,
    complete: vi.fn(),
  };
});

import { complete } from '@mariozechner/pi-ai';
const mockComplete = vi.mocked(complete);

// ---------------------------------------------------------------------------
// Helpers — build AgentMessage objects matching pi-ai types
// ---------------------------------------------------------------------------

const now = Date.now();

/** Create a UserMessage */
function userMsg(text: string): AgentMessage {
  return { role: 'user', content: text, timestamp: now } as AgentMessage;
}

/** Create an AssistantMessage */
function assistantMsg(text: string): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    usage: { inputTokens: 0, outputTokens: 0 },
  } as AgentMessage;
}

/** Create a ToolResultMessage */
function toolResultMsg(toolName: string, text: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: `call_${toolName}`,
    toolName,
    content: [{ type: 'text', text }],
  } as AgentMessage;
}

/** Create an assistant message with a tool call */
function assistantWithToolCall(toolName: string): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', toolCallId: `call_${toolName}`, toolName, args: {} }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    usage: { inputTokens: 0, outputTokens: 0 },
  } as AgentMessage;
}

/** Dummy Model (only used as pass-through; complete is mocked) */
const fakeModel = {} as Model<any>;

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

describe('context: token estimation', () => {
  it('estimates string tokens as length/4', () => {
    expect(estimateStringTokens('abcd')).toBe(1);
    expect(estimateStringTokens('abcde')).toBe(2);
    expect(estimateStringTokens('')).toBe(0);
  });

  it('estimates message tokens for string content', () => {
    const msgs = [userMsg('a'.repeat(100))];
    expect(estimateTokens(msgs)).toBe(25);
  });

  it('returns 0 for messages with no content', () => {
    const msgs = [{ role: 'user' as const, content: undefined }] as unknown as AgentMessage[];
    expect(estimateTokens(msgs)).toBe(0);
  });

  it('estimates tokens for array content (assistant with text)', () => {
    const msgs = [assistantMsg('a'.repeat(100))];
    expect(estimateTokens(msgs)).toBe(25);
  });

  it('estimates tokens for tool call args', () => {
    const msgs = [assistantWithToolCall('read_file')];
    // args = {} → JSON.stringify = "{}" = 2 chars → ceil(2/4) = 1
    expect(estimateTokens(msgs)).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Context limits
// ---------------------------------------------------------------------------

describe('context: model limits', () => {
  it('returns correct limit for known models', () => {
    expect(getContextLimit('claude-3.5-sonnet')).toBe(200_000);
    expect(getContextLimit('gpt-4o-mini')).toBe(128_000);
    expect(getContextLimit('gpt-3.5-turbo')).toBe(16_000);
  });

  it('returns default for unknown models', () => {
    expect(getContextLimit('llama-3-70b')).toBe(100_000);
  });

  it('matches gpt-4o before gpt-4 (prefix sort)', () => {
    expect(getContextLimit('gpt-4o-mini')).toBe(128_000);
    expect(getContextLimit('gpt-4o-2024-05-13')).toBe(128_000);
    expect(getContextLimit('gpt-4-turbo')).toBe(128_000);
  });

  it('matches gpt-5 models correctly', () => {
    expect(getContextLimit('gpt-5')).toBe(200_000);
    expect(getContextLimit('gpt-5.4')).toBe(200_000);
  });

  it('is case-insensitive', () => {
    expect(getContextLimit('Claude-3.5-Sonnet')).toBe(200_000);
    expect(getContextLimit('GPT-4O-MINI')).toBe(128_000);
  });

  it('needsCompact detects threshold breach', () => {
    const bigMsg = userMsg('x'.repeat(560_001));
    expect(needsCompact([bigMsg], '', 'claude-3.5-sonnet')).toBe(true);

    const smallMsg = userMsg('hello');
    expect(needsCompact([smallMsg], '', 'claude-3.5-sonnet')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// truncateToolOutputs
// ---------------------------------------------------------------------------

describe('context: truncateToolOutputs', () => {
  it('truncates long tool outputs in non-last tool messages', () => {
    const msgs: AgentMessage[] = [
      userMsg('hello'),
      toolResultMsg('read_file', 'x'.repeat(5000)),
      assistantMsg('done'),
      toolResultMsg('read_file', 'y'.repeat(5000)),  // last tool — kept intact
    ];
    const result = truncateToolOutputs(msgs);
    // First tool msg (idx 1) should be truncated (read_file limit = 2000)
    const firstTool = result[1] as any;
    expect(firstTool.content[0].text.length).toBeLessThan(5000);
    expect(firstTool.content[0].text).toContain('[...truncated');
    // Last tool msg (idx 3) should be untouched
    const lastTool = result[3] as any;
    expect(lastTool.content[0].text).toBe('y'.repeat(5000));
  });

  it('handles empty messages array', () => {
    expect(truncateToolOutputs([])).toEqual([]);
  });

  it('handles messages with no tool messages', () => {
    const msgs = [userMsg('hi'), assistantMsg('hello')];
    const result = truncateToolOutputs(msgs);
    expect(result).toEqual(msgs);
  });

  it('does not truncate short tool outputs', () => {
    const msgs: AgentMessage[] = [
      toolResultMsg('write_file', 'File written: test.md'),
      toolResultMsg('read_file', 'short content'),
    ];
    const result = truncateToolOutputs(msgs);
    // Last tool kept intact, first tool is short enough
    expect((result[0] as any).content[0].text).toBe('File written: test.md');
  });
});

// ---------------------------------------------------------------------------
// hardPrune
// ---------------------------------------------------------------------------

describe('context: hardPrune', () => {
  it('returns messages unchanged when under threshold', () => {
    const msgs = [userMsg('hello'), assistantMsg('hi')];
    const result = hardPrune(msgs, '', 'claude');
    expect(result).toBe(msgs); // same reference — no pruning
  });

  it('prunes earliest messages when over 90% context', () => {
    const msgs: AgentMessage[] = [
      userMsg('a'.repeat(400_000)),
      assistantMsg('b'.repeat(400_000)),
      userMsg('c'.repeat(100)),
      assistantMsg('d'.repeat(100)),
    ];
    const result = hardPrune(msgs, '', 'claude');
    expect(result.length).toBeLessThan(msgs.length);
  });

  it('ensures first message is user role after pruning', () => {
    const msgs: AgentMessage[] = [
      userMsg('a'.repeat(100_000)),
      assistantMsg('b'.repeat(100_000)),
      assistantMsg('c'.repeat(1000)),
      userMsg('keep this'),
      assistantMsg('and this'),
    ];
    const result = hardPrune(msgs, '', 'gpt-3.5');
    expect(result.length).toBeGreaterThan(0);
    expect((result[0] as any).role).toBe('user');
  });

  it('skips toolResult messages that are orphaned after cut', () => {
    const msgs: AgentMessage[] = [
      userMsg('a'.repeat(100_000)),
      assistantMsg('b'.repeat(100_000)),
      toolResultMsg('read_file', 'x'.repeat(1000)),
      userMsg('keep'),
      assistantMsg('response'),
    ];
    const result = hardPrune(msgs, '', 'gpt-3.5');
    expect((result[0] as any).role).toBe('user');
    expect((result[0] as any).role).not.toBe('toolResult');
  });

  it('injects synthetic user message when no user message remains', () => {
    const msgs: AgentMessage[] = [
      userMsg('a'.repeat(200_000)),
      assistantMsg('b'.repeat(1000)),
      assistantMsg('c'.repeat(1000)),
    ];
    const result = hardPrune(msgs, '', 'gpt-3.5');
    expect((result[0] as any).role).toBe('user');
    const content = (result[0] as any).content;
    expect(typeof content === 'string' && content.includes('truncated')).toBe(true);
  });

  it('preserves messages when exactly at threshold', () => {
    const msgs = [userMsg('small'), assistantMsg('also small')];
    const result = hardPrune(msgs, '', 'claude');
    expect(result).toBe(msgs);
  });
});

// ---------------------------------------------------------------------------
// compactMessages
// ---------------------------------------------------------------------------

describe('context: compactMessages', () => {
  beforeEach(() => {
    mockComplete.mockReset();
  });

  it('returns uncompacted when fewer than 6 messages', async () => {
    const msgs = [userMsg('a'), assistantMsg('b'), userMsg('c'), assistantMsg('d')];
    const result = await compactMessages(msgs, fakeModel, 'test-key', '', 'claude');
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(msgs);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('returns uncompacted when early messages < 2', async () => {
    const msgs = [
      userMsg('only-early'),
      assistantMsg('r1'), userMsg('r2'), assistantMsg('r3'),
      userMsg('r4'), assistantMsg('r5'), userMsg('r6'),
    ];
    const result = await compactMessages(msgs, fakeModel, 'test-key', '', 'claude');
    expect(result.compacted).toBe(false);
  });

  it('prepends summary as separate user message when recentMessages[0] is assistant', async () => {
    mockComplete.mockResolvedValue({
      role: 'assistant',
      content: [{ type: 'text', text: 'Summary of conversation.' }],
      api: 'anthropic-messages', provider: 'anthropic', model: 'claude',
      usage: { inputTokens: 0, outputTokens: 0 },
    } as any);

    const msgs: AgentMessage[] = [
      userMsg('early1'),
      assistantMsg('early2'),
      assistantMsg('recent1'),
      userMsg('recent2'),
      assistantMsg('recent3'),
      userMsg('recent4'),
      assistantMsg('recent5'),
      userMsg('recent6'),
    ];

    const result = await compactMessages(msgs, fakeModel, 'test-key', '', 'claude');
    expect(result.compacted).toBe(true);
    expect(result.messages.length).toBe(7); // 1 summary + 6 recent
    expect((result.messages[0] as any).role).toBe('user');
    const content = (result.messages[0] as any).content;
    expect(typeof content === 'string').toBe(true);
    expect(content).toContain('Summary of conversation.');
    expect((result.messages[1] as any).role).toBe('assistant');
  });

  it('merges summary into first user message to avoid consecutive user→user', async () => {
    mockComplete.mockResolvedValue({
      role: 'assistant',
      content: [{ type: 'text', text: 'This is the summary.' }],
      api: 'anthropic-messages', provider: 'anthropic', model: 'claude',
      usage: { inputTokens: 0, outputTokens: 0 },
    } as any);

    const msgs: AgentMessage[] = [
      userMsg('early1'),
      assistantMsg('early2'),
      userMsg('recent-user-first'),
      assistantMsg('recent2'),
      userMsg('recent3'),
      assistantMsg('recent4'),
      userMsg('recent5'),
      assistantMsg('recent6'),
    ];

    const result = await compactMessages(msgs, fakeModel, 'test-key', '', 'claude');
    expect(result.compacted).toBe(true);
    expect(result.messages.length).toBe(6);
    expect((result.messages[0] as any).role).toBe('user');
    const content = (result.messages[0] as any).content;
    expect(content).toContain('This is the summary.');
    expect(content).toContain('recent-user-first');
    expect((result.messages[1] as any).role).toBe('assistant');
  });

  it('handles multimodal (array) content in first user message', async () => {
    mockComplete.mockResolvedValue({
      role: 'assistant',
      content: [{ type: 'text', text: 'Multimodal summary.' }],
      api: 'anthropic-messages', provider: 'anthropic', model: 'claude',
      usage: { inputTokens: 0, outputTokens: 0 },
    } as any);

    const multimodalUser: AgentMessage = {
      role: 'user',
      content: [
        { type: 'image', image: new Uint8Array(0), mimeType: 'image/png' },
        { type: 'text', text: 'describe this image' },
      ],
      timestamp: now,
    } as unknown as AgentMessage;

    const msgs: AgentMessage[] = [
      userMsg('early1'),
      assistantMsg('early2'),
      multimodalUser,
      assistantMsg('recent2'),
      userMsg('recent3'),
      assistantMsg('recent4'),
      userMsg('recent5'),
      assistantMsg('recent6'),
    ];

    const result = await compactMessages(msgs, fakeModel, 'test-key', '', 'claude');
    expect(result.compacted).toBe(true);
    expect(result.messages.length).toBe(6);
    expect((result.messages[0] as any).role).toBe('user');
    const content = (result.messages[0] as any).content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as any[];
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('Multimodal summary.');
  });

  it('falls back to hardPrune when complete() throws, then throws if pruning insufficient', async () => {
    mockComplete.mockRejectedValue(new Error('API error'));

    const msgs: AgentMessage[] = [
      userMsg('early1'), assistantMsg('early2'),
      userMsg('recent1'), assistantMsg('recent2'),
      userMsg('recent3'), assistantMsg('recent4'),
      userMsg('recent5'), assistantMsg('recent6'),
    ];

    // Small messages on a large model — hardPrune won't help, so it throws
    await expect(
      compactMessages(msgs, fakeModel, 'test-key', '', 'claude'),
    ).rejects.toThrow('Context compaction failed');
  });

  it('does not split between assistant tool-call and tool result (M6)', async () => {
    mockComplete.mockResolvedValue({
      role: 'assistant',
      content: [{ type: 'text', text: 'Tool summary.' }],
      api: 'anthropic-messages', provider: 'anthropic', model: 'claude',
      usage: { inputTokens: 0, outputTokens: 0 },
    } as any);

    const msgs: AgentMessage[] = [
      userMsg('e1'),
      assistantMsg('e2'),
      userMsg('e3'),
      assistantWithToolCall('read_file'),
      toolResultMsg('read_file', 'file content here'),
      userMsg('r1'),
      assistantMsg('r2'),
      userMsg('r3'),
      assistantMsg('r4'),
      userMsg('r5'),
    ];

    const result = await compactMessages(msgs, fakeModel, 'test-key', '', 'claude');
    expect(result.compacted).toBe(true);

    for (let i = 0; i < result.messages.length; i++) {
      if ((result.messages[i] as any).role === 'toolResult') {
        expect(i).toBeGreaterThan(0);
        expect((result.messages[i - 1] as any).role).toBe('assistant');
      }
    }
  });
});
