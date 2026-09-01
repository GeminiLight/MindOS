import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MINDOS_SERVER_ROUTES } from '../packages/mindos/src/server/contract';

const root = resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

describe('mobile pending agent actions route contract', () => {
  it('publishes authenticated Product Server list and resolve routes', () => {
    expect(MINDOS_SERVER_ROUTES).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: '/api/agent/pending-actions', auth: 'required' }),
      expect.objectContaining({ method: 'POST', path: '/api/agent/runtime-permission', auth: 'required' }),
      expect.objectContaining({ method: 'POST', path: '/api/agent/user-question', auth: 'required' }),
    ]));

    const http = read('packages/mindos/src/server/http.ts');
    expect(http).toContain("route === 'GET /api/agent/pending-actions'");
    expect(http).toContain("route === 'POST /api/agent/runtime-permission'");
    expect(http).toContain("route === 'POST /api/agent/user-question'");
  });

  it('keeps Next routes as thin adapters to the same Product Server handlers', () => {
    const pending = read('packages/web/app/api/agent/pending-actions/route.ts');
    const permission = read('packages/web/app/api/agent/runtime-permission/route.ts');
    const question = read('packages/web/app/api/agent/user-question/route.ts');

    for (const source of [pending, permission, question]) {
      expect(source).toContain("from '@geminilight/mindos/server'");
      expect(source).toContain('toNextResponse');
    }
  });
});
