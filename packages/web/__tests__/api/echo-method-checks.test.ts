import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  startLearningCorrection,
  updateLearningLoop,
} from '@geminilight/mindos/knowledge';
import { testMindRoot } from '../setup';
import { GET, POST, PATCH } from '@/app/api/echo/method-checks/route';
vi.mock('@/app/api/agent-runtimes/route', () => ({
  GET: vi.fn(async () => Response.json({ runtimes: [] })),
}));
let home: string;
let loop: ReturnType<typeof startLearningCorrection>;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'check-api-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  loop = startLearningCorrection(
    testMindRoot,
    {
      cardId: 'check-api',
      title: 'Evidence',
      content: 'Design',
      sessions: [
        {
          id: 'source',
          messageRefs: [
            {
              messageIndex: 0,
              role: 'assistant',
              quote: 'A comparison proves cause.',
            },
          ],
        },
      ],
    },
    {
      behavior: 'Inspect design',
      scope: 'Research',
      check: 'Identify limitations',
    },
  );
  loop = updateLearningLoop(testMindRoot, loop.id, {
    action: 'approve-agent',
    attemptIndex: -1,
    version: loop.version,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});
const request = (body: unknown, method = 'POST') =>
  new NextRequest('http://localhost/api/echo/method-checks', {
    method,
    body: JSON.stringify(body),
  });
it('creates frozen cases, prepares only the chosen task and returns an uncached summary list', async () => {
  const saved = await POST(
    request({
      learningId: loop.id,
      version: loop.version,
      attemptIndex: -1,
      revisionIndex: 0,
      locale: 'en',
      useTask: 'An observational comparison',
      useExpected: 'Private criterion A',
      exceptionTask: 'A randomized experiment',
      exceptionExpected: 'Private criterion B',
    }),
  );
  expect(saved.status).toBe(200);
  const check = (await saved.json()).check;
  const prepared = await PATCH(
    request(
      { id: check.id, version: check.version, action: 'prepare', kind: 'use' },
      'PATCH',
    ),
  );
  expect(prepared.status).toBe(200);
  const data = await prepared.json();
  expect(data.draft.prompt).not.toContain('Private criterion');
  expect(data.draft.prompt).not.toContain('randomized');
  const listing = await GET(
    new NextRequest(
      'http://localhost/api/echo/method-checks?learningId=' +
        loop.id +
        '&attemptIndex=-1&revisionIndex=0',
    ),
  );
  expect(listing.headers.get('cache-control')).toBe('no-store');
  expect((await listing.json()).checks[0].id).toBe(check.id);
});
it('rejects invented evidence, malformed commands and invalid identifiers', async () => {
  expect((await POST(request(null))).status).toBe(400);
  expect(
    (
      await PATCH(
        request({ id: '../bad', version: 1, action: 'capture' }, 'PATCH'),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await GET(
        new NextRequest(
          'http://localhost/api/echo/method-checks?id=methodcheck-' +
            '0'.repeat(24),
        ),
      )
    ).status,
  ).toBe(404);
});

it('refuses unknown or unavailable receiving Agents before creating an untraceable handoff', async () => {
  const { GET: runtimesGET } = await import('@/app/api/agent-runtimes/route');
  const descriptor = {
    id: 'claude',
    kind: 'claude',
    name: 'Claude Code',
    status: 'available',
  };
  vi.mocked(runtimesGET).mockImplementation(async () => Response.json({ runtimes: [descriptor] }));
  for (const target of [
    { id: 'invented', kind: 'claude', name: 'Unknown' },
    { id: 'claude', kind: 'codex', name: 'Wrong adapter' },
  ]) {
    const response = await PATCH(
      request(
        {
          action: 'handoff',
          id: 'methodcheck-' + '0'.repeat(24),
          version: 1,
          target,
        },
        'PATCH',
      ),
    );
    expect(response.status).toBe(409);
  }
  vi.mocked(runtimesGET).mockImplementation(async () => Response.json({ runtimes: [{ ...descriptor, status: 'unavailable' }] }));
  expect(
    (
      await PATCH(
        request(
          {
            action: 'handoff',
            id: 'methodcheck-' + '0'.repeat(24),
            version: 1,
            target: descriptor,
          },
          'PATCH',
        ),
      )
    ).status,
  ).toBe(409);
});
