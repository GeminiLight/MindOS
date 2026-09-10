import { describe, expect, it } from 'vitest';
import { createMindosServerEventBus, type MindosServerEventEnvelope } from '../events/bus.js';
import { handleSettingsPost, type MindosSettingsServices } from './settings.js';

function settingsServices(overrides: Partial<MindosSettingsServices> = {}): MindosSettingsServices {
  let settings = { ai: { activeProvider: '', providers: [] }, mindRoot: '/mind' };
  return {
    readSettings: () => settings,
    writeSettings: (next) => {
      settings = next as typeof settings;
    },
    readWebSearchConfig: () => ({}),
    writeWebSearchConfig: () => {},
    parseProviders: (providers) => providers,
    getEmbeddingStatus: () => ({}),
    invalidateCache: () => {},
    providerEnv: { ids: [], getApiKeyEnvVar: () => undefined, getApiKeyFromEnv: () => undefined },
    ...overrides,
  };
}

describe('handleSettingsPost settings.changed notification', () => {
  it('emits settings.changed on the injected bus after a successful write', () => {
    const bus = createMindosServerEventBus();
    const seen: MindosServerEventEnvelope[] = [];
    bus.subscribe((envelope) => seen.push(envelope));

    const res = handleSettingsPost({ agentRuntimeEnv: { keys: ['STAFF_KEY'] } }, settingsServices({ events: bus }));

    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(seen.map((entry) => entry.event)).toEqual([{ type: 'settings.changed' }]);
  });

  it('does not emit when the write fails', () => {
    const bus = createMindosServerEventBus();
    const seen: MindosServerEventEnvelope[] = [];
    bus.subscribe((envelope) => seen.push(envelope));

    const res = handleSettingsPost({ port: 4567 }, settingsServices({
      events: bus,
      writeSettings: () => {
        throw new Error('disk full');
      },
    }));

    expect(res.status).toBe(500);
    expect(seen).toEqual([]);
  });

  it('keeps the write successful when the bus itself throws', () => {
    const res = handleSettingsPost({ port: 4567 }, settingsServices({
      events: {
        emit: () => {
          throw new Error('bus down');
        },
      },
    }));

    expect(res).toEqual({ status: 200, body: { ok: true } });
  });
});
