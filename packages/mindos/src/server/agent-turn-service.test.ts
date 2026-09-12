import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createStandaloneAgentTurnStream } from './agent-turn-service.js';
import { flushAllCapsuleWrites } from '../agent/capsules/store.js';
const roots: string[] = [];
afterEach(async () => { await flushAllCapsuleWrites(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function setup(script: (emit: (event: unknown) => void) => Promise<void> = async emit => { emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'answer' } }); }) {
  const root = mkdtempSync(join(tmpdir(), 'mindos-turn-service-')); roots.push(root);
  let listener: ((event: unknown) => void) | undefined;
  const dispose = vi.fn(); const abort = vi.fn();
  const createRuntime = vi.fn(async (options: any) => ({
    session: { subscribe(fn: (event: unknown) => void) { listener = fn; return () => { listener = undefined; }; }, prompt: async () => script(event => listener?.(event)), abort, dispose, steer: vi.fn() },
    turnPrompt: options.turnPrompt, agentRunContextResource: {}, model: {}, modelName: 'fake', provider: 'fake', apiKey: 'fake', lastUserContent: 'hello', extensionLoadErrors: [],
  } as any));
  const stream = createStandaloneAgentTurnStream({ mindRoot: root, homeDir: root, readSettings: () => ({}), createRuntime });
  return { stream, createRuntime, dispose, abort, root };
}
it('executes a default Product Server turn through the shared lane and disposes the runtime', async () => {
  const { stream, createRuntime, dispose } = setup();
  const events = await Array.fromAsync(stream({ messages: [{ role: 'user', content: 'hello' }], maxSteps: 2 }));
  expect(events).toContainEqual({ type: 'text_delta', delta: 'answer' });
  expect(events).toContainEqual({ type: 'done' });
  expect(events.some(event => event.type === 'agent_run_context')).toBe(true);
  expect(createRuntime).toHaveBeenCalledOnce(); expect(dispose).toHaveBeenCalledOnce();
});
it('surfaces budget exhaustion without a successful terminal frame', async () => {
  const { stream, dispose } = setup(async emit => { emit({ type: 'turn_end', toolResults: [{ toolName: 'read_file', content: [] }] }); });
  const events = await Array.fromAsync(stream({ messages: [{ role: 'user', content: 'hello' }], maxSteps: 1 }));
  expect(events.filter(event => event.type === 'error')).toHaveLength(1);
  expect(events.some(event => event.type === 'done')).toBe(false);
  expect(dispose).toHaveBeenCalledOnce();
});
it('rejects invalid input before opening a runtime', async () => {
  const { stream, createRuntime } = setup();
  const events = await Array.fromAsync(stream({ messages: [] }));
  expect(events).toEqual([{ type: 'error', message: expect.any(String) }]);
  expect(createRuntime).not.toHaveBeenCalled();
});

it('aborts and disposes a running runtime when the stream consumer closes', async () => {
  const { stream, dispose, abort } = setup(async emit => { emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'partial' } }); await new Promise(() => {}); });
  for await (const event of stream({ messages: [{ role: 'user', content: 'hello' }] })) { if (event.type === 'text_delta') break; }
  await expect.poll(() => dispose.mock.calls.length).toBe(1);
  expect(abort).toHaveBeenCalled();
});
