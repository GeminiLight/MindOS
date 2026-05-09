import { describe, it, expect } from 'vitest';
import {
  mindosPiMessagesToOpenAI as piMessagesToOpenAI,
  reassembleMindosOpenAISse as reassembleSSE,
} from '@geminilight/mindos/session';

/**
 * Tests for non-streaming API fallback.
 * Verifies:
 * 1. pi-ai → OpenAI message format conversion
 * 2. SSE response reassembly (for proxies that ignore stream:false)
 */

// ─────────────────────────────────────────────────
// piMessagesToOpenAI tests
// ─────────────────────────────────────────────────

describe('piMessagesToOpenAI', () => {
  it('converts plain user message', () => {
    expect(piMessagesToOpenAI([{ role: 'user', content: 'Hello!' }]))
      .toEqual([{ role: 'user', content: 'Hello!' }]);
  });

  it('converts assistant text-only message', () => {
    const result = piMessagesToOpenAI([{
      role: 'assistant',
      content: [{ type: 'text', text: 'Response' }],
    }]);
    expect(result).toEqual([{ role: 'assistant', content: 'Response' }]);
  });

  it('converts assistant message with tool calls', () => {
    const result = piMessagesToOpenAI([{
      role: 'assistant',
      content: [
        { type: 'text', text: 'Calling tool' },
        { type: 'toolCall', id: 'call_1', name: 'read_file', arguments: { path: '/tmp' } },
      ],
    }]);
    expect(result[0].content).toBe('Calling tool');
    expect(result[0].tool_calls[0]).toMatchObject({
      id: 'call_1', type: 'function',
      function: { name: 'read_file', arguments: '{"path":"/tmp"}' },
    });
  });

  it('converts tool result message', () => {
    expect(piMessagesToOpenAI([{
      role: 'toolResult', toolCallId: 'call_1',
      content: [{ type: 'text', text: 'result data' }],
    }])).toEqual([{ role: 'tool', tool_call_id: 'call_1', content: 'result data' }]);
  });

  it('skips system messages', () => {
    const result = piMessagesToOpenAI([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
  });

  it('handles empty assistant content', () => {
    const result = piMessagesToOpenAI([{ role: 'assistant', content: [] }]);
    expect(result[0]).toEqual({ role: 'assistant', content: '' });
  });

  it('handles complex conversation history', () => {
    const result = piMessagesToOpenAI([
      { role: 'user', content: 'list files' },
      { role: 'assistant', content: [
        { type: 'text', text: 'checking' },
        { type: 'toolCall', id: 'c1', name: 'ls', arguments: {} },
      ]},
      { role: 'toolResult', toolCallId: 'c1', content: [{ type: 'text', text: 'a.txt' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Found a.txt' }] },
    ]);
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[1].tool_calls).toHaveLength(1);
    expect(result[2].role).toBe('tool');
    expect(result[3]).toMatchObject({ role: 'assistant', content: 'Found a.txt' });
  });
});

// ─────────────────────────────────────────────────
// reassembleSSE tests
// ─────────────────────────────────────────────────

describe('reassembleSSE', () => {
  it('reassembles simple text SSE response', () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n');

    const result = reassembleSSE(sse);
    expect(result.choices[0].message.content).toBe('Hello!');
    expect(result.choices[0].message.role).toBe('assistant');
    expect(result.choices[0].finish_reason).toBe('stop');
  });

  it('handles ikuncode-style empty response (proxy returns SSE with no content)', () => {
    // This is the actual response from ikuncode when stream:false is sent
    const sse = [
      'data: {"id":"","object":"chat.completion.chunk","created":0,"model":"gpt-5.4","choices":[],"usage":{"prompt_tokens":28,"completion_tokens":0,"total_tokens":28}}',
      '',
      'data: [DONE]',
    ].join('\n');

    const result = reassembleSSE(sse);
    // Should return empty content (no choices with delta)
    expect(result.choices[0].message.content).toBeNull();
    expect(result.choices[0].message.role).toBe('assistant');
  });

  it('reassembles SSE with tool calls', () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"read_","arguments":""}}]},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"{\\"pa"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"/tmp\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"content":""},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ].join('\n');

    const result = reassembleSSE(sse);
    const msg = result.choices[0].message;
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls[0].id).toBe('call_abc');
    expect(msg.tool_calls[0].function.name).toBe('read_file');
    expect(msg.tool_calls[0].function.arguments).toBe('{"path":"/tmp"}');
    expect(result.choices[0].finish_reason).toBe('tool_calls');
  });

  it('handles SSE with multiple tool calls', () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"tool_a","arguments":"{}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"c2","type":"function","function":{"name":"tool_b","arguments":"{}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"content":""},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ].join('\n');

    const result = reassembleSSE(sse);
    expect(result.choices[0].message.tool_calls).toHaveLength(2);
    expect(result.choices[0].message.tool_calls[0].id).toBe('c1');
    expect(result.choices[0].message.tool_calls[1].id).toBe('c2');
  });

  it('handles SSE with text + tool calls mixed', () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"content":"Let me "},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"content":"check."},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"search","arguments":"{\\"q\\":\\"test\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"content":""},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ].join('\n');

    const result = reassembleSSE(sse);
    expect(result.choices[0].message.content).toBe('Let me check.');
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
  });

  it('skips invalid SSE lines gracefully', () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}',
      'data: INVALID_JSON',
      '',
      ':comment line',
      'data: {"choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n');

    const result = reassembleSSE(sse);
    expect(result.choices[0].message.content).toBe('OK');
  });

  it('handles SSE with usage chunk at end (no delta)', () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
      'data: [DONE]',
    ].join('\n');

    const result = reassembleSSE(sse);
    expect(result.choices[0].message.content).toBe('Hi');
    expect(result.choices[0].finish_reason).toBe('stop');
  });
});
