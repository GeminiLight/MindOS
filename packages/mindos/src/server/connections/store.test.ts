import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bindConnection,
  listConnectionBindings,
  refreshConnectionBinding,
  unbindConnection,
} from './store.js';
import type { ConnectionCandidate } from './types.js';

let mindRoot = '';

describe('connection binding registry', () => {
  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-connections-'));
    mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
  });

  afterEach(() => rmSync(mindRoot, { recursive: true, force: true }));

  it('persists only an external credential reference with private file permissions', () => {
    const bound = bindConnection(mindRoot, candidate(), new Date('2026-09-03T11:10:00.000Z'));
    expect(bound).toMatchObject({ id: 'lark-cli:existing-profile', status: 'ready' });
    expect(listConnectionBindings(mindRoot)).toEqual([bound]);

    const file = join(mindRoot, '.mindos', 'connections', 'bindings.json');
    const text = readFileSync(file, 'utf-8');
    expect(text).toContain('lark-cli-profile');
    expect(text).not.toMatch(/appSecret|access_token|refresh_token|secret-value/i);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('refreshes health without changing credential ownership and unbinds idempotently', () => {
    const first = bindConnection(mindRoot, candidate());
    const refreshed = refreshConnectionBinding(mindRoot, first.id, {
      ...candidate(),
      status: 'degraded',
      issues: [{ code: 'user_auth_missing', message: 'User auth is optional for bot operations.' }],
    }, new Date('2026-09-03T11:11:00.000Z'));

    expect(refreshed.credentialRef).toEqual(first.credentialRef);
    expect(refreshed.status).toBe('degraded');
    expect(refreshed.createdAt).toBe(first.createdAt);
    expect(unbindConnection(mindRoot, first.id)).toBe(true);
    expect(unbindConnection(mindRoot, first.id)).toBe(false);
    expect(listConnectionBindings(mindRoot)).toEqual([]);
  });

  it('rejects credential-like fields before anything is written', () => {
    const unsafe = {
      ...candidate(),
      application: { ...candidate().application, appSecret: 'secret-value' },
    } as unknown as ConnectionCandidate;
    expect(() => bindConnection(mindRoot, unsafe)).toThrow(/secret-bearing field/i);
    expect(listConnectionBindings(mindRoot)).toEqual([]);
  });
});

function candidate(): ConnectionCandidate {
  return {
    schemaVersion: 1,
    id: 'lark-cli:existing-profile',
    provider: 'feishu',
    adapter: 'lark-cli',
    status: 'ready',
    credentialRef: {
      kind: 'lark-cli-profile',
      executablePath: '/opt/lark-cli',
      profile: 'existing-profile',
    },
    application: { appId: 'cli_existing', appName: 'Existing Bot', brand: 'feishu' },
    owner: { identity: 'bot', source: 'lark-cli-profile', externalId: 'ou_bot', displayName: 'Existing Bot' },
    identities: {
      bot: { status: 'ready', available: true, verified: true, externalId: 'ou_bot' },
      user: { status: 'missing', available: false, verified: false },
    },
    capabilities: [
      { id: 'message.send', identity: 'bot', status: 'available' },
      { id: 'event.consume', identity: 'bot', status: 'available' },
      { id: 'user.act-as-user', identity: 'user', status: 'blocked', reason: 'User identity is missing.' },
    ],
    discoveredAt: '2026-09-03T11:00:00.000Z',
    issues: [],
  };
}
