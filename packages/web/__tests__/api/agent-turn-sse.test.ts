import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentTurnSseResponse } from '../../app/api/agent/_lib/turn-sse';

describe('agent turn SSE response', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits hidden status heartbeat data frames while the agent is quiet', async () => {
    vi.useFakeTimers();
    const response = createAgentTurnSseResponse(async () => {
      await new Promise(() => {});
    });
    const reader = response.body!.getReader();

    const read = reader.read();
    await vi.advanceTimersByTimeAsync(15_000);
    const chunk = await read;

    expect(chunk.done).toBe(false);
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toBe('data:{"type":"status","visible":false,"message":"keep-alive"}\n\n');

    await reader.cancel();
  });
});
