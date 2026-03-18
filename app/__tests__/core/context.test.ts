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
import type { ModelMessage } from 'ai';
import type { LanguageModel } from 'ai';

// Mock the 'ai' module's generateText — intercept the summarizer call
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

import { generateText } from 'ai';
const mockGenerateText = vi.mocked(generateText);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a simple user message */
function userMsg(text: string): ModelMessage {
  return { role: 'user', content: text };
}

/** Create a simple assistant message */
function assistantMsg(text: string): ModelMessage {
  return { role: 'assistant', content: text };
}

/** Create a tool message with a text output */
function toolMsg(toolName: string, value: string): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: `call_${toolName}`,
        toolName,
        output: { type: 'text', value },
      },
    ],
  } as ModelMessage;
}

/** Create a tool message with undefined output (triggers null guard) */
function toolMsgNoOutput(toolName: string): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: `call_${toolName}`,
        toolName,
        // output is intentionally missing
      },
    ],
  } as ModelMessage;
}

/** Create a tool message with non-text output */
function toolMsgImageOutput(toolName: string): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: `call_${toolName}`,
        toolName,
        output: { type: 'image', data: 'base64...' },
      },
    ],
  } as ModelMessage;
}

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
    const msgs = [{ role: 'user' as const, content: undefined }] as unknown as ModelMessage[];
    expect(estimateTokens(msgs)).toBe(0);
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

  it('needsCompact detects threshold breach', () => {
    // 200k limit, 0.7 threshold = 140k tokens
    // Each char = 0.25 tokens, so 140k tokens = 560k chars
    const bigMsg = userMsg('x'.repeat(560_001));
    expect(needsCompact([bigMsg], '', 'claude-3.5-sonnet')).toBe(true);

    const smallMsg = userMsg('hello');
    expect(needsCompact([smallMsg], '', 'claude-3.5-sonnet')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fix 3: truncateToolOutputs null guard
// ---------------------------------------------------------------------------

describe('context: truncateToolOutputs', () => {
  it('truncates long tool outputs in non-last tool messages', () => {
    const msgs: ModelMessage[] = [
      userMsg('hello'),
      toolMsg('read_file', 'x'.repeat(5000)),
      assistantMsg('done'),
      toolMsg('read_file', 'y'.repeat(5000)),  // last tool — kept intact
    ];
    const result = truncateToolOutputs(msgs);
    // First tool msg (idx 1) should be truncated (read_file limit = 2000)
    const firstTool = result[1] as any;
    expect(firstTool.content[0].output.value.length).toBeLessThan(5000);
    expect(firstTool.content[0].output.value).toContain('[...truncated');
    // Last tool msg (idx 3) should be untouched
    const lastTool = result[3] as any;
    expect(lastTool.content[0].output.value).toBe('y'.repeat(5000));
  });

  it('does NOT crash when trp.output is undefined (Fix 3)', () => {
    const msgs: ModelMessage[] = [
      userMsg('hello'),
      toolMsgNoOutput('read_file'),
      assistantMsg('ok'),
      toolMsg('write_file', 'done'),  // last tool
    ];
    // Should not throw
    const result = truncateToolOutputs(msgs);
    expect(result).toHaveLength(4);
    // The undefined-output part should pass through unchanged
    const noOutputTool = result[1] as any;
    expect(noOutputTool.content[0].output).toBeUndefined();
  });

  it('does NOT crash when trp.output is non-text type', () => {
    const msgs: ModelMessage[] = [
      userMsg('hello'),
      toolMsgImageOutput('some_tool'),
      assistantMsg('ok'),
      toolMsg('write_file', 'done'),  // last tool
    ];
    const result = truncateToolOutputs(msgs);
    expect(result).toHaveLength(4);
    const imageTool = result[1] as any;
    expect(imageTool.content[0].output.type).toBe('image');
  });

  it('handles empty messages array', () => {
    expect(truncateToolOutputs([])).toEqual([]);
  });

  it('handles messages with no tool messages', () => {
    const msgs = [userMsg('hi'), assistantMsg('hello')];
    const result = truncateToolOutputs(msgs);
    expect(result).toEqual(msgs);
  });
});

// ---------------------------------------------------------------------------
// Fix 6 + G: hardPrune ensures user-first message
// ---------------------------------------------------------------------------

describe('context: hardPrune', () => {
  it('returns messages unchanged when under threshold', () => {
    const msgs = [userMsg('hello'), assistantMsg('hi')];
    const result = hardPrune(msgs, '', 'claude');
    expect(result).toBe(msgs); // same reference — no pruning
  });

  it('prunes earliest messages when over 90% context', () => {
    // claude = 200k limit, 90% = 180k tokens = 720k chars
    // Create messages that exceed threshold
    const msgs: ModelMessage[] = [
      userMsg('a'.repeat(400_000)),
      assistantMsg('b'.repeat(400_000)),
      userMsg('c'.repeat(100)),
      assistantMsg('d'.repeat(100)),
    ];
    const result = hardPrune(msgs, '', 'claude');
    expect(result.length).toBeLessThan(msgs.length);
  });

  it('ensures first message is user role after pruning (Fix 6)', () => {
    // Build a scenario where pruning would land on an assistant message
    // Small model to trigger pruning easily
    const msgs: ModelMessage[] = [
      userMsg('a'.repeat(100_000)),     // will be pruned
      assistantMsg('b'.repeat(100_000)), // will be pruned
      assistantMsg('c'.repeat(1000)),    // cutIdx might land here
      userMsg('keep this'),
      assistantMsg('and this'),
    ];
    const result = hardPrune(msgs, '', 'gpt-3.5'); // 16k limit
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].role).toBe('user');
  });

  it('skips tool messages that are orphaned after cut (Fix 6)', () => {
    const msgs: ModelMessage[] = [
      userMsg('a'.repeat(100_000)),
      assistantMsg('b'.repeat(100_000)),
      toolMsg('read_file', 'x'.repeat(1000)),  // orphaned tool
      userMsg('keep'),
      assistantMsg('response'),
    ];
    const result = hardPrune(msgs, '', 'gpt-3.5');
    expect(result[0].role).toBe('user');
    // Should not start with a tool message
    expect(result[0].role).not.toBe('tool');
  });

  it('injects synthetic user message when no user message remains (Fix G)', () => {
    // Extreme: only assistant messages left after pruning
    const msgs: ModelMessage[] = [
      userMsg('a'.repeat(200_000)),      // will be pruned
      assistantMsg('b'.repeat(1000)),
      assistantMsg('c'.repeat(1000)),
    ];
    const result = hardPrune(msgs, '', 'gpt-3.5');
    expect(result[0].role).toBe('user');
    expect(typeof result[0].content === 'string' && result[0].content.includes('pruned')).toBe(true);
  });

  it('preserves messages when exactly at threshold', () => {
    const msgs = [userMsg('small'), assistantMsg('also small')];
    const result = hardPrune(msgs, '', 'claude');
    expect(result).toBe(msgs);
  });
});

// ---------------------------------------------------------------------------
// Fix 5: compactMessages — consecutive user merge + multimodal support
// ---------------------------------------------------------------------------

/** Dummy LanguageModel (only used as a pass-through token; generateText is mocked) */
const fakeModel = {} as LanguageModel;

describe('context: compactMessages', () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it('returns uncompacted when fewer than 6 messages', async () => {
    const msgs = [userMsg('a'), assistantMsg('b'), userMsg('c'), assistantMsg('d')];
    const result = await compactMessages(msgs, fakeModel);
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(msgs);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('returns uncompacted when early messages < 2', async () => {
    // 7 messages but first split leaves only 1 early message
    const msgs = [
      userMsg('only-early'),
      // --- split here (length-6 = 1) ---
      assistantMsg('r1'), userMsg('r2'), assistantMsg('r3'),
      userMsg('r4'), assistantMsg('r5'), userMsg('r6'),
    ];
    const result = await compactMessages(msgs, fakeModel);
    expect(result.compacted).toBe(false);
  });

  it('prepends summary as separate user message when recentMessages[0] is assistant', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Summary of conversation.' } as any);

    // 8 messages: 2 early + 6 recent. Recent starts with assistant.
    const msgs: ModelMessage[] = [
      userMsg('early1'),
      assistantMsg('early2'),
      // --- split (idx 2) → recent starts with assistant ---
      assistantMsg('recent1'),
      userMsg('recent2'),
      assistantMsg('recent3'),
      userMsg('recent4'),
      assistantMsg('recent5'),
      userMsg('recent6'),
    ];

    const result = await compactMessages(msgs, fakeModel);
    expect(result.compacted).toBe(true);
    expect(result.messages.length).toBe(7); // 1 summary + 6 recent
    expect(result.messages[0].role).toBe('user');
    expect(typeof result.messages[0].content === 'string').toBe(true);
    expect((result.messages[0].content as string)).toContain('Summary of conversation.');
    // Second message should be the original assistant recent[0]
    expect(result.messages[1].role).toBe('assistant');
  });

  it('merges summary into first user message to avoid consecutive user→user (Fix 5)', async () => {
    mockGenerateText.mockResolvedValue({ text: 'This is the summary.' } as any);

    // 8 messages: 2 early + 6 recent. Recent starts with user.
    const msgs: ModelMessage[] = [
      userMsg('early1'),
      assistantMsg('early2'),
      // --- split → recent starts with user ---
      userMsg('recent-user-first'),
      assistantMsg('recent2'),
      userMsg('recent3'),
      assistantMsg('recent4'),
      userMsg('recent5'),
      assistantMsg('recent6'),
    ];

    const result = await compactMessages(msgs, fakeModel);
    expect(result.compacted).toBe(true);
    // Should NOT have 7 messages (that would mean separate summary + user = consecutive user)
    // Should have 6: merged(summary+user) + remaining 5 recent
    expect(result.messages.length).toBe(6);
    expect(result.messages[0].role).toBe('user');
    const content = result.messages[0].content as string;
    expect(content).toContain('This is the summary.');
    expect(content).toContain('recent-user-first');
    // Second message should be assistant (no consecutive user)
    expect(result.messages[1].role).toBe('assistant');
  });

  it('handles multimodal (array) content in first user message (Fix 5 review B)', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Multimodal summary.' } as any);

    // First recent message is user with array content (e.g. image + text)
    const multimodalUser: ModelMessage = {
      role: 'user',
      content: [
        { type: 'image', image: new Uint8Array(0), mimeType: 'image/png' },
        { type: 'text', text: 'describe this image' },
      ],
    } as unknown as ModelMessage;

    const msgs: ModelMessage[] = [
      userMsg('early1'),
      assistantMsg('early2'),
      // --- split → recent starts with multimodal user ---
      multimodalUser,
      assistantMsg('recent2'),
      userMsg('recent3'),
      assistantMsg('recent4'),
      userMsg('recent5'),
      assistantMsg('recent6'),
    ];

    const result = await compactMessages(msgs, fakeModel);
    expect(result.compacted).toBe(true);
    expect(result.messages.length).toBe(6);
    expect(result.messages[0].role).toBe('user');
    // Content should be an array with summary text prepended
    const content = result.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as any[];
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('Multimodal summary.');
    // Original parts preserved after the summary
    expect(parts[1].type).toBe('image');
    expect(parts[2].type).toBe('text');
    expect(parts[2].text).toBe('describe this image');
  });

  it('falls back gracefully when generateText throws', async () => {
    mockGenerateText.mockRejectedValue(new Error('API error'));

    const msgs: ModelMessage[] = [
      userMsg('early1'),
      assistantMsg('early2'),
      userMsg('recent1'),
      assistantMsg('recent2'),
      userMsg('recent3'),
      assistantMsg('recent4'),
      userMsg('recent5'),
      assistantMsg('recent6'),
    ];

    const result = await compactMessages(msgs, fakeModel);
    expect(result.compacted).toBe(false);
    // Returns original messages unchanged
    expect(result.messages).toBe(msgs);
  });

  it('never produces consecutive user messages at the summary boundary', async () => {
    mockGenerateText.mockResolvedValue({ text: 'summary text' } as any);

    // Case 1: recent[0] is user → summary merges into it (no consecutive user)
    const msgsUserFirst: ModelMessage[] = [
      userMsg('e1'), assistantMsg('e2'), userMsg('e3'),
      // --- recent (6) ---
      userMsg('r1'), assistantMsg('r2'), userMsg('r3'),
      assistantMsg('r4'), userMsg('r5'), assistantMsg('r6'),
    ];
    const result1 = await compactMessages(msgsUserFirst, fakeModel);
    expect(result1.compacted).toBe(true);
    // First two messages should not both be user
    expect(result1.messages[0].role).toBe('user');
    expect(result1.messages[1].role).not.toBe('user');

    // Case 2: recent[0] is assistant → summary is separate user, then assistant (fine)
    const msgsAssistFirst: ModelMessage[] = [
      userMsg('e1'), assistantMsg('e2'), userMsg('e3'),
      // --- recent (6) ---
      assistantMsg('r1'), userMsg('r2'), assistantMsg('r3'),
      userMsg('r4'), assistantMsg('r5'), userMsg('r6'),
    ];
    const result2 = await compactMessages(msgsAssistFirst, fakeModel);
    expect(result2.compacted).toBe(true);
    expect(result2.messages[0].role).toBe('user');   // summary
    expect(result2.messages[1].role).toBe('assistant'); // no consecutive user
  });
});
