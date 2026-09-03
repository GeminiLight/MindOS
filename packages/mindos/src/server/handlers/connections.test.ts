import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listConnectionBindings } from '../connections/store.js';
import type { ConnectionCandidate } from '../connections/types.js';
import { handleConnectionsGet, handleConnectionsPost } from './connections.js';

let mindRoot = '';

describe('connection broker handlers', () => {
  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-connections-handler-'));
    mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
  });
  afterEach(() => rmSync(mindRoot, { recursive: true, force: true }));

  it('discovers and binds a server-verified existing CLI candidate', async () => {
    const discoverConnections = vi.fn(async () => [candidate()]);
    const discovered = await handleConnectionsGet(new URLSearchParams('discover=true&provider=feishu'), {
      mindRoot,
      discoverConnections,
    });
    expect(discovered.status).toBe(200);
    expect(discovered.body).toMatchObject({ bindings: [], candidates: [{ id: 'lark-cli:existing-profile' }] });

    const bound = await handleConnectionsPost({ action: 'bind', candidateId: 'lark-cli:existing-profile' }, {
      mindRoot,
      discoverConnections,
    });
    expect(bound.status).toBe(201);
    expect(bound.body).toMatchObject({ ok: true, binding: { status: 'ready' } });
    expect(listConnectionBindings(mindRoot)).toHaveLength(1);
    expect(discoverConnections).toHaveBeenCalledTimes(2);
  });

  it('refreshes matching external ownership and removes a binding without touching the CLI profile', async () => {
    const services = { mindRoot, discoverConnections: async () => [candidate()] };
    await handleConnectionsPost({ action: 'bind', candidateId: candidate().id }, services);
    const refreshed = await handleConnectionsPost({ action: 'refresh', bindingId: candidate().id }, services);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toMatchObject({ ok: true, binding: { id: candidate().id } });

    const removed = await handleConnectionsPost({ action: 'unbind', bindingId: candidate().id }, services);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ ok: true, removed: true });
    expect(listConnectionBindings(mindRoot)).toEqual([]);
  });

  it('rejects unavailable candidates and malformed actions', async () => {
    const unavailable = { ...candidate(), status: 'unavailable' as const };
    const services = { mindRoot, discoverConnections: async () => [unavailable] };
    expect((await handleConnectionsPost({ action: 'bind', candidateId: unavailable.id }, services)).status).toBe(409);
    expect((await handleConnectionsPost({ action: 'bind', candidateId: '../escape' }, services)).status).toBe(400);
    expect((await handleConnectionsPost({ action: 'unknown' }, services)).status).toBe(400);
  });
});

function candidate(): ConnectionCandidate {
  return {
    schemaVersion: 1,
    id: 'lark-cli:existing-profile',
    provider: 'feishu',
    adapter: 'lark-cli',
    status: 'ready',
    credentialRef: { kind: 'lark-cli-profile', executablePath: '/opt/lark-cli', profile: 'existing-profile' },
    application: { appId: 'cli_existing', appName: 'Existing Bot', brand: 'feishu' },
    owner: { identity: 'bot', source: 'lark-cli-profile' },
    identities: {
      bot: { status: 'ready', available: true, verified: true },
      user: { status: 'missing', available: false, verified: false },
    },
    capabilities: [
      { id: 'message.send', identity: 'bot', status: 'available' },
      { id: 'event.consume', identity: 'bot', status: 'available' },
      { id: 'user.act-as-user', identity: 'user', status: 'blocked' },
    ],
    discoveredAt: '2026-09-03T11:00:00.000Z',
    issues: [],
  };
}
