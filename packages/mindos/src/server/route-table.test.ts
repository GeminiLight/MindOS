import { describe, expect, it } from 'vitest';
import { MINDOS_SERVER_ROUTES, getMindosServerContract } from './contract.js';
import { MINDOS_ROUTE_AUTH_GUARDS, MINDOS_ROUTE_TABLE } from './routes/index.js';
import { toHonoPath } from './route-table.js';

describe('Product Server route table', () => {
  it('is the single source of truth for MINDOS_SERVER_ROUTES', () => {
    const projected = MINDOS_ROUTE_TABLE.map(({ id, method, path, auth }) => ({ id, method, path, auth }));
    expect(MINDOS_SERVER_ROUTES).toEqual(projected);
    expect(getMindosServerContract().routes).toBe(MINDOS_SERVER_ROUTES);
  });

  it('has a unique method+path and a unique id per entry', () => {
    const keys = MINDOS_ROUTE_TABLE.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    const ids = MINDOS_ROUTE_TABLE.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares a callable handler and a contract-shaped path for every entry', () => {
    for (const route of MINDOS_ROUTE_TABLE) {
      expect(typeof route.handler, route.id).toBe('function');
      expect(route.path, route.id).toMatch(/^\/api\//);
      expect(['public', 'required'], route.id).toContain(route.auth);
      // Dynamic segments use the contract's [param] notation, never Hono's :param.
      expect(route.path, route.id).not.toMatch(/:[A-Za-z]/);
    }
  });

  it('keeps the routes other hosts rely on', () => {
    expect(MINDOS_SERVER_ROUTES).toEqual(expect.arrayContaining([
      { id: 'health', method: 'GET', path: '/api/health', auth: 'public' },
      { id: 'connect', method: 'GET', path: '/api/connect', auth: 'public' },
      { id: 'im.feishu.oauth.callback', method: 'GET', path: '/api/im/feishu/oauth/callback', auth: 'public' },
      { id: 'a2a.options', method: 'OPTIONS', path: '/api/a2a', auth: 'public' },
      { id: 'agent.sessions.turns.create', method: 'POST', path: '/api/agent/sessions/[sessionId]/turns', auth: 'required' },
      { id: 'agent-run-capsules.recovery', method: 'POST', path: '/api/agent-run-capsules/[capsuleId]/recovery', auth: 'required' },
      { id: 'agent-runtimes.codex.thread.fork', method: 'POST', path: '/api/agent-runtimes/codex/threads/[threadId]/fork', auth: 'required' },
    ]));
    expect(MINDOS_SERVER_ROUTES.filter((route) => route.auth === 'public').map((route) => route.id).sort()).toEqual([
      'a2a.options',
      'connect',
      'health',
      'im.feishu.oauth.callback',
    ]);
  });

  it('protects unmatched codex thread sub-paths like the legacy dispatcher did', () => {
    expect(MINDOS_ROUTE_AUTH_GUARDS).toEqual([
      { methods: ['GET', 'POST'], prefix: '/api/agent-runtimes/codex/threads/', auth: 'required' },
    ]);
  });

  it('translates contract params into Hono params', () => {
    expect(toHonoPath('/api/agent/sessions/[sessionId]/turns')).toBe('/api/agent/sessions/:sessionId/turns');
    expect(toHonoPath('/api/files')).toBe('/api/files');
    expect(toHonoPath('/api/a/[x]/b/[y]')).toBe('/api/a/:x/b/:y');
  });
});
