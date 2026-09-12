import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ create: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/settings', () => ({ readSettings: () => ({ agent: { maxSteps: 20 } }) }));
vi.mock('@/lib/agent/active-recall', () => ({ performActiveRecallWithReceipt: async () => ({ items: [] }) }));
vi.mock('@/lib/agent/mindos-pi-runtime-host', () => ({ createWebMindosPiRuntimeHostServices: () => ({}), getMindosWebPiRuntimePaths: () => ({ agentDir: '/tmp/pi', additionalSkillPaths: [], additionalExtensionPaths: [] }) }));
vi.mock('@geminilight/mindos/agent/runtime/adapters/mindos', () => ({ createMindosAgentRuntime: state.create }));
vi.mock('@geminilight/mindos/agent/turn', async importOriginal => ({ ...await importOriginal<typeof import('@geminilight/mindos/agent/turn')>(), executeMindosPiRuntimeTurn: state.run }));
import { runHeadlessAgent } from '@/lib/agent/headless';
beforeEach(() => { state.create.mockReset().mockResolvedValue({ turnPrompt: 'prepared' }); state.run.mockReset().mockResolvedValue({ text: 'answer', thinking: '', toolCalls: [] }); });
it('passes IM budget and owner cancellation to the common runtime lifecycle', async () => {
  const owner = new AbortController();
  await expect(runHeadlessAgent({ userMessage: 'hello', entrypoint: 'im', maxSteps: 8, signal: owner.signal })).resolves.toMatchObject({ text: 'answer' });
  expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ maxSteps: 8, signal: owner.signal, permissionMode: 'read', source: 'event' }));
  expect(state.create.mock.calls[0][0].turnPrompt).toContain('hello');
});
it('does not construct an IM runtime after cancellation', async () => {
  const owner = new AbortController(); owner.abort();
  await expect(runHeadlessAgent({ userMessage: 'hello', signal: owner.signal })).rejects.toThrow();
  expect(state.create).not.toHaveBeenCalled(); expect(state.run).not.toHaveBeenCalled();
});
it('propagates a runtime failure to the IM caller', async () => {
  state.run.mockRejectedValueOnce(new Error('model failed'));
  await expect(runHeadlessAgent({ userMessage: 'hello' })).rejects.toThrow('model failed');
});
