import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamSSE } from '../../../mindos/bin/lib/sse-stream.js';

function sseResponse(events: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data:${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function captureStdout() {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  return {
    output: () => write.mock.calls.map(([chunk]) => String(chunk)).join(''),
  };
}

describe('CLI SSE consumer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('consumes current product SSE fields', async () => {
    const stdout = captureStdout();

    const result = await streamSSE(sseResponse([
      { type: 'text_delta', delta: 'Hello ' },
      { type: 'text_delta', delta: 'world' },
      {
        type: 'tool_start',
        toolCallId: 'call-1',
        toolName: 'search_notes',
        args: { query: 'today' },
      },
      {
        type: 'tool_end',
        toolCallId: 'call-1',
        output: 'found 3 notes',
        isError: false,
      },
      { type: 'done' },
    ]), { showTools: true });

    expect(result.text).toBe('Hello world');
    expect(result.toolCalls).toEqual(['search_notes']);
    expect(stdout.output()).toContain('Hello world');
    expect(stdout.output()).toContain('search_notes');
    expect(stdout.output()).toContain('"query":"today"');
    expect(stdout.output()).toContain('found 3 notes');
  });

  it('keeps compatibility with legacy CLI SSE fields', async () => {
    const stdout = captureStdout();

    const result = await streamSSE(sseResponse([
      { type: 'text_delta', text: 'Legacy text' },
      { type: 'tool_start', name: 'legacy_tool', input: { id: 1 } },
      { type: 'tool_end', result: 'legacy result' },
      { type: 'done' },
    ]), { showTools: true });

    expect(result.text).toBe('Legacy text');
    expect(result.toolCalls).toEqual(['legacy_tool']);
    expect(stdout.output()).toContain('Legacy text');
    expect(stdout.output()).toContain('legacy_tool');
    expect(stdout.output()).toContain('"id":1');
    expect(stdout.output()).toContain('legacy result');
  });
});
