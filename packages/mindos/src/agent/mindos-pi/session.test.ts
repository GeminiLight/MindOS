/**
 * Terminal-state and lifecycle contracts for the embedded Pi turn session
 * (spec-runtime-lane-correctness, items 2 and 6). Model errors reported by
 * the pi agent must surface as a structured `status: 'error'` result and an
 * SSE `error` frame without a trailing `done`, matching the native lanes.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  runMindosPiAgentTurnSession,
  type MindosPiAgentSessionAdapter,
  type MindosPiAgentTurnSessionOptions,
} from './session.js';

type Listener = (event: unknown) => void;

const proxyMessages = {
  proxyCompatMode: 'proxy mode',
  proxyCompatDetecting: 'detecting',
  proxyCompatFailed: (message: string) => `failed: ${message}`,
  proxyCompatAlsoFailed: (message: string) => `also failed: ${message}`,
};

function modelErrorEvent(errorMessage: string): unknown {
  return {
    type: 'agent_end',
    messages: [{ role: 'assistant', stopReason: 'error', errorMessage }],
  };
}

function createSession(script: (emit: Listener) => Promise<void>, options: { unsubscribe?: () => void } = {}): MindosPiAgentSessionAdapter {
  let listener: Listener | undefined;
  return {
    subscribe: (callback) => {
      listener = callback;
      return options.unsubscribe;
    },
    prompt: async () => {
      await script((event) => listener?.(event));
    },
    steer: async () => {},
    abort: async () => {},
  };
}

function baseOptions(session: MindosPiAgentSessionAdapter, events: unknown[]): MindosPiAgentTurnSessionOptions {
  return {
    session,
    prompt: 'hello',
    stepLimit: 5,
    send: (event) => events.push(event),
    signal: new AbortController().signal,
    provider: 'anthropic',
    runFallback: async () => {},
    proxyMessages,
    sleep: async () => {},
  };
}

describe('runMindosPiAgentTurnSession terminal state', () => {
  it('returns status completed and a done frame for a clean turn', async () => {
    const events: unknown[] = [];
    const session = createSession(async (emit) => {
      emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hi' } });
    });

    const result = await runMindosPiAgentTurnSession(baseOptions(session, events));

    expect(result).toEqual({ status: 'completed', hasContent: true, lastModelError: '' });
    expect(events).toEqual([
      { type: 'text_delta', delta: 'hi' },
      { type: 'done' },
    ]);
  });

  it('returns status error and only an error frame when the model failed without content', async () => {
    const events: unknown[] = [];
    const session = createSession(async (emit) => {
      emit(modelErrorEvent('model failed'));
    });

    const result = await runMindosPiAgentTurnSession(baseOptions(session, events));

    expect(result).toEqual({ status: 'error', message: 'model failed', hasContent: false, lastModelError: 'model failed' });
    expect(events).toEqual([{ type: 'error', message: 'model failed' }]);
  });

  it('returns status error after visible content when the model errored mid-turn', async () => {
    const events: unknown[] = [];
    const session = createSession(async (emit) => {
      emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'partial' } });
      emit(modelErrorEvent('overloaded'));
    });

    const result = await runMindosPiAgentTurnSession(baseOptions(session, events));

    expect(result).toMatchObject({ status: 'error', message: 'overloaded', hasContent: true });
    expect(events).toEqual([
      { type: 'text_delta', delta: 'partial' },
      { type: 'error', message: 'overloaded' },
    ]);
    expect(events).not.toContainEqual({ type: 'done' });
  });

  it('returns status error when the cached proxy fallback fails before streaming', async () => {
    const events: unknown[] = [];
    const session = createSession(async () => {
      throw new Error('prompt must not run when the cached fallback is used');
    });

    const result = await runMindosPiAgentTurnSession({
      ...baseOptions(session, events),
      provider: 'openai',
      baseUrl: 'https://proxy.example/v1',
      compatMode: 'non-streaming',
      runFallback: async () => { throw new Error('boom'); },
    });

    expect(result).toMatchObject({ status: 'error', message: 'failed: boom' });
    expect(events).toEqual([
      { type: 'status', message: 'proxy mode' },
      { type: 'error', message: 'failed: boom' },
    ]);
  });

  it('returns status error when the after-stream proxy fallback also fails', async () => {
    const events: unknown[] = [];
    const session = createSession(async (emit) => {
      emit(modelErrorEvent('stream failed'));
    });

    const result = await runMindosPiAgentTurnSession({
      ...baseOptions(session, events),
      provider: 'openai',
      baseUrl: 'https://proxy.example/v1',
      runFallback: async () => { throw new Error('boom'); },
    });

    expect(result).toMatchObject({ status: 'error', message: 'also failed: boom' });
    expect(events).toEqual([
      { type: 'status', message: 'detecting' },
      { type: 'error', message: 'also failed: boom' },
    ]);
  });

  it('returns status completed when the after-stream proxy fallback recovers the turn', async () => {
    const events: unknown[] = [];
    const cached: string[] = [];
    const session = createSession(async (emit) => {
      emit(modelErrorEvent('stream failed'));
    });

    const result = await runMindosPiAgentTurnSession({
      ...baseOptions(session, events),
      provider: 'openai',
      baseUrl: 'https://proxy.example/v1',
      effectiveBaseUrlKey: 'proxy-key',
      runFallback: async () => {},
      writeCompat: (key, mode) => { cached.push(`${key}:${mode}`); },
    });

    expect(result).toMatchObject({ status: 'completed', lastModelError: 'stream failed' });
    expect(cached).toEqual(['proxy-key:non-streaming']);
    expect(events).toEqual([
      { type: 'status', message: 'detecting' },
      { type: 'done' },
    ]);
  });

  it('propagates a thrown prompt error unchanged', async () => {
    const events: unknown[] = [];
    const session = createSession(async () => {
      throw new Error('Invalid API key');
    });

    await expect(runMindosPiAgentTurnSession(baseOptions(session, events))).rejects.toThrow('Invalid API key');
    expect(events.filter((event) => (event as { type: string }).type === 'done')).toEqual([]);
  });
});

describe('runMindosPiAgentTurnSession subscription lifecycle', () => {
  it('unsubscribes the session listener once the turn completes', async () => {
    const unsubscribe = vi.fn();
    const session = createSession(async (emit) => {
      emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hi' } });
    }, { unsubscribe });

    await runMindosPiAgentTurnSession(baseOptions(session, []));

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes the session listener when the prompt throws', async () => {
    const unsubscribe = vi.fn();
    const session = createSession(async () => {
      throw new Error('boom');
    }, { unsubscribe });

    await expect(runMindosPiAgentTurnSession(baseOptions(session, []))).rejects.toThrow('boom');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('tolerates adapters whose subscribe returns nothing', async () => {
    const session = createSession(async () => {});

    await expect(runMindosPiAgentTurnSession(baseOptions(session, []))).resolves.toMatchObject({ status: 'completed' });
  });
});
