import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMindosServerEventBus, type MindosServerEventEnvelope } from '../events/bus.js';
import { handleAgentRuntimesGet, type AgentRuntimeDetectionServices } from './agent-runtimes.js';
import {
  RUNTIME_DETECTION_CACHE_TTL_MS,
  getRuntimeDetection,
  peekRuntimeDetection,
  resetRuntimeDetectionCacheForTest,
} from './runtime-detection-cache.js';

type Probe = ReturnType<typeof vi.fn<(...args: never[]) => Promise<unknown>>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Detection services whose probes are counted; every field is a fresh function so identities differ per test. */
function countedServices(overrides: Partial<AgentRuntimeDetectionServices> & { clock?: { now: number } } = {}) {
  const clock = overrides.clock ?? { now: Date.parse('2026-09-10T00:00:00.000Z') };
  const detectLocalAcpAgents = vi.fn(async () => ({
    installed: [{ id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini', status: 'available' }],
    notInstalled: [],
  }));
  const checkNativeRuntimeHealth = vi.fn(async () => ({ status: 'available' as const }));
  const resolveRuntimeCommand = vi.fn(async (command: string) => (
    command === 'codex' ? '/usr/local/bin/codex' : command === 'claude' ? '/usr/local/bin/claude' : null
  ));
  const services: AgentRuntimeDetectionServices = {
    now: () => clock.now,
    readSettings: () => ({ acpAgents: {} }),
    detectLocalAcpAgents,
    checkNativeRuntimeHealth,
    resolveRuntimeCommand,
    resolveRuntimeCommandCandidates: async () => [],
    ...overrides,
  };
  return {
    services,
    clock,
    detectLocalAcpAgents: (services.detectLocalAcpAgents ?? detectLocalAcpAgents) as typeof detectLocalAcpAgents,
    checkNativeRuntimeHealth: (services.checkNativeRuntimeHealth ?? checkNativeRuntimeHealth) as typeof checkNativeRuntimeHealth,
    resolveRuntimeCommand: (services.resolveRuntimeCommand ?? resolveRuntimeCommand) as typeof resolveRuntimeCommand,
  };
}

beforeEach(() => {
  resetRuntimeDetectionCacheForTest();
});

afterEach(() => {
  resetRuntimeDetectionCacheForTest();
});

describe('runtime detection cache: in-flight de-duplication', () => {
  it('serves ten concurrent full requests from a single probe per runtime', async () => {
    const { services, checkNativeRuntimeHealth, detectLocalAcpAgents, resolveRuntimeCommand } = countedServices();

    const responses = await Promise.all(Array.from({ length: 10 }, () => handleAgentRuntimesGet(new URLSearchParams(), services)));

    expect(responses.every((res) => res.status === 200)).toBe(true);
    // codex + claude health, once each; ACP detection once.
    expect(checkNativeRuntimeHealth).toHaveBeenCalledTimes(2);
    expect(detectLocalAcpAgents).toHaveBeenCalledTimes(1);
    expect(resolveRuntimeCommand.mock.calls.map(([command]) => command).sort()).toEqual(['claude', 'codex']);
    const first = responses[0].body as { runtimes: Array<{ id: string; status: string }> };
    expect(first.runtimes.map((runtime) => `${runtime.id}:${runtime.status}`)).toEqual([
      'mindos:available',
      'codex:available',
      'claude:available',
      'gemini:available',
    ]);
  });

  it('shares one probe between the single-runtime picker, the ACP scope and the full payload', async () => {
    const { services, checkNativeRuntimeHealth, detectLocalAcpAgents } = countedServices();

    await Promise.all([
      handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), services),
      handleAgentRuntimesGet(new URLSearchParams('runtime=claude'), services),
      handleAgentRuntimesGet(new URLSearchParams('scope=acp'), services),
      handleAgentRuntimesGet(new URLSearchParams(), services),
    ]);
    await handleAgentRuntimesGet(new URLSearchParams(), services);

    expect(checkNativeRuntimeHealth).toHaveBeenCalledTimes(2);
    expect(detectLocalAcpAgents).toHaveBeenCalledTimes(1);
  });

  it('lets force=1 join an in-flight probe instead of starting a second one', async () => {
    const gate = deferred<{ status: 'available' }>();
    const { services, checkNativeRuntimeHealth } = countedServices({
      checkNativeRuntimeHealth: vi.fn(() => gate.promise),
    });

    const plain = handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), services);
    const forced = handleAgentRuntimesGet(new URLSearchParams('runtime=codex&force=1'), services);
    await Promise.resolve();
    gate.resolve({ status: 'available' });
    const [a, b] = await Promise.all([plain, forced]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(checkNativeRuntimeHealth).toHaveBeenCalledTimes(1);
  });

  it('re-probes on force=1 once the previous probe has settled, but not on a plain request', async () => {
    const { services, checkNativeRuntimeHealth } = countedServices();

    await handleAgentRuntimesGet(new URLSearchParams('runtime=claude'), services);
    await handleAgentRuntimesGet(new URLSearchParams('runtime=claude'), services);
    expect(checkNativeRuntimeHealth).toHaveBeenCalledTimes(1);

    await handleAgentRuntimesGet(new URLSearchParams('runtime=claude&force=1'), services);
    expect(checkNativeRuntimeHealth).toHaveBeenCalledTimes(2);
  });
});

describe('runtime detection cache: keys and expiry', () => {
  it('probes again when the settings fingerprint changes', async () => {
    let acpAgents: Record<string, unknown> = {};
    const { services, checkNativeRuntimeHealth, detectLocalAcpAgents } = countedServices({
      readSettings: () => ({ acpAgents }),
    });

    await handleAgentRuntimesGet(new URLSearchParams(), services);
    acpAgents = { gemini: { command: '/opt/gemini' } };
    await handleAgentRuntimesGet(new URLSearchParams(), services);

    expect(checkNativeRuntimeHealth).toHaveBeenCalledTimes(4);
    expect(detectLocalAcpAgents).toHaveBeenCalledTimes(2);
    expect(detectLocalAcpAgents).toHaveBeenLastCalledWith({ overrides: { gemini: { command: '/opt/gemini' } } });
  });

  it('probes again after the TTL and reports the probe time as checkedAt', async () => {
    const { services, clock, checkNativeRuntimeHealth } = countedServices();
    const start = clock.now;

    const first = await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), services);
    clock.now = start + RUNTIME_DETECTION_CACHE_TTL_MS - 1;
    const cached = await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), services);
    clock.now = start + RUNTIME_DETECTION_CACHE_TTL_MS;
    const refreshed = await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), services);

    expect(checkNativeRuntimeHealth).toHaveBeenCalledTimes(2);
    const checkedAt = (res: typeof first) => (res.body as { runtime: { availability: { checkedAt: string } } }).runtime.availability.checkedAt;
    expect(checkedAt(first)).toBe(new Date(start).toISOString());
    expect(checkedAt(cached)).toBe(new Date(start).toISOString());
    expect(checkedAt(refreshed)).toBe(new Date(start + RUNTIME_DETECTION_CACHE_TTL_MS).toISOString());
  });

  it('keeps hosts with different detectors apart unless they share a detectionIdentity', async () => {
    const a = countedServices();
    const b = countedServices();
    await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), a.services);
    await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), b.services);
    expect(a.checkNativeRuntimeHealth).toHaveBeenCalledTimes(1);
    expect(b.checkNativeRuntimeHealth).toHaveBeenCalledTimes(1);

    const c = countedServices({ detectionIdentity: 'web-host' });
    const d = countedServices({ detectionIdentity: 'web-host' });
    await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), c.services);
    await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), d.services);
    expect(c.checkNativeRuntimeHealth).toHaveBeenCalledTimes(1);
    expect(d.checkNativeRuntimeHealth).toHaveBeenCalledTimes(0);
  });

  it('does not cache a failed probe', async () => {
    let attempts = 0;
    const probe: Probe = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('boom');
      return { ok: true };
    });
    const { services } = countedServices();

    await expect(getRuntimeDetection({ scope: 'acp', services, settings: {}, probe })).rejects.toThrow('boom');
    await expect(getRuntimeDetection({ scope: 'acp', services, settings: {}, probe })).resolves.toMatchObject({ value: { ok: true } });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('peek returns the last known entry even after it expired, and nothing before a probe ran', async () => {
    const { services, clock } = countedServices();
    expect(peekRuntimeDetection({ scope: 'codex', services, settings: {} })).toBeNull();

    await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), services);
    clock.now += RUNTIME_DETECTION_CACHE_TTL_MS * 5;

    const peeked = peekRuntimeDetection<{ agent: { binaryPath?: string } }>({ scope: 'codex', services, settings: services.readSettings?.() });
    expect(peeked?.value.agent.binaryPath).toBe('/usr/local/bin/codex');
    expect(peeked?.expiresAt).toBeLessThan(clock.now);
  });

  it('drops an in-flight probe that settles after the cache was reset', async () => {
    const gate = deferred<{ status: 'available' }>();
    const { services, checkNativeRuntimeHealth } = countedServices({ checkNativeRuntimeHealth: vi.fn(() => gate.promise) });

    const pending = handleAgentRuntimesGet(new URLSearchParams('runtime=claude'), services);
    resetRuntimeDetectionCacheForTest();
    gate.resolve({ status: 'available' });
    await pending;

    expect(peekRuntimeDetection({ scope: 'claude', services, settings: services.readSettings?.() })).toBeNull();
    expect(checkNativeRuntimeHealth).toHaveBeenCalledTimes(1);
  });
});

describe('runtime detection cache: runtime.changed', () => {
  it('emits runtime.changed only when a refreshed result differs from the cached one', async () => {
    const bus = createMindosServerEventBus();
    const seen: MindosServerEventEnvelope[] = [];
    bus.subscribe((envelope) => seen.push(envelope));
    let status: 'available' | 'signed-out' = 'available';
    const { services } = countedServices({
      events: bus,
      checkNativeRuntimeHealth: vi.fn(async () => ({ status })),
    });

    await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), services);
    expect(seen).toEqual([]);

    await handleAgentRuntimesGet(new URLSearchParams('runtime=codex&force=1'), services);
    expect(seen).toEqual([]);

    status = 'signed-out';
    await handleAgentRuntimesGet(new URLSearchParams('runtime=codex&force=1'), services);
    expect(seen.map((entry) => entry.event)).toEqual([{ type: 'runtime.changed', runtimes: ['codex'] }]);
  });

  it('names the ACP agents whose detection changed', async () => {
    const bus = createMindosServerEventBus();
    const seen: MindosServerEventEnvelope[] = [];
    bus.subscribe((envelope) => seen.push(envelope));
    let installed = [{ id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini', status: 'available' }];
    const { services } = countedServices({
      events: bus,
      detectLocalAcpAgents: vi.fn(async () => ({ installed, notInstalled: [] })),
    });

    await handleAgentRuntimesGet(new URLSearchParams('scope=acp'), services);
    installed = [
      ...installed,
      { id: 'opencode', name: 'OpenCode', binaryPath: '/usr/local/bin/opencode', status: 'available' },
    ];
    await handleAgentRuntimesGet(new URLSearchParams('scope=acp&force=1'), services);

    expect(seen.map((entry) => entry.event)).toEqual([{ type: 'runtime.changed', runtimes: ['opencode'] }]);
  });
});
