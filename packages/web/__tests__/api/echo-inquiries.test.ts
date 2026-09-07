import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({
  sessions: [] as unknown[],
  runs: [] as unknown[],
}));
vi.mock('@geminilight/mindos/server', async (original) => ({
  ...(await original<object>()),
  handleAgentSessionsGet: () => ({ body: state.sessions }),
}));
vi.mock('@geminilight/mindos/agent', async (original) => ({
  ...(await original<object>()),
  listAgentRuns: () => state.runs,
}));
vi.mock('@/lib/runtime-auth-config', () => ({
  readRuntimeAuthConfig: vi.fn(() => ({ webSessionSecret: '' })),
}));
import { readRuntimeAuthConfig } from '@/lib/runtime-auth-config';
import { GET as METHODS } from '@/app/api/echo/inquiries/methods/route';
import { GET, POST, PATCH } from '@/app/api/echo/inquiries/route';
const answer = 'The highest ranked model is best.';
const input = {
  requestId: 'inquiry-api',
  locale: 'en',
  sessionId: 's-inquiry',
  messageIndex: 1,
  messageHash: createHash('sha256').update(answer).digest('hex'),
};
const req = (
  data?: unknown,
  method = 'POST',
  query = '',
  headers: Record<string, string> = {},
) =>
  new NextRequest('http://localhost/api/echo/inquiries' + query, {
    method,
    headers,
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'inquiry-api-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  state.sessions = [
    {
      id: input.sessionId,
      messages: [
        { role: 'user', content: 'Which model should we use?' },
        { role: 'assistant', content: answer },
      ],
    },
  ];
  state.runs = [];
  vi.mocked(readRuntimeAuthConfig).mockReturnValue({ webSessionSecret: '' });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});
it('starts a private question only from a verified reply and serves summaries without private reasoning', async () => {
  const response = await POST(req(input));
  expect(response.status).toBe(200);
  const { inquiry } = await response.json();
  expect(inquiry.source.quote).toBe(answer);
  expect(inquiry.draft.question).toBe('Which model should we use?');
  expect((await (await POST(req(input))).json()).inquiry.id).toBe(inquiry.id);
  const saved = await PATCH(
    req(
      {
        id: inquiry.id,
        version: inquiry.version,
        requestId: 'draft',
        action: 'save-draft',
        draft: {
          question: 'A useful question',
          explanationA: 'PRIVATE_EXPLANATION',
          explanationB: '',
          distinction: '',
          capability: '',
        },
      },
      'PATCH',
    ),
  );
  expect(saved.status).toBe(200);
  const list = await GET(req(undefined, 'GET'));
  const data = await list.json();
  expect(data.inquiries[0].title).toBe('A useful question');
  expect(JSON.stringify(data)).not.toContain('PRIVATE_EXPLANATION');
  expect(list.headers.get('cache-control')).toBe('no-store');
  expect((await GET(req(undefined, 'GET', '?id=' + inquiry.id))).status).toBe(
    200,
  );
  expect(
    (
      await PATCH(
        req(
          {
            id: inquiry.id,
            version: inquiry.version,
            requestId: 'stale',
            action: 'archive',
            archived: true,
          },
          'PATCH',
        ),
      )
    ).status,
  ).toBe(409);
});
it('refuses changed, missing, active or forged sources, cross-origin mutations and shared bearer access', async () => {
  expect(
    (await POST(req({ ...input, messageHash: 'f'.repeat(64) }))).status,
  ).toBe(409);
  expect((await POST(req({ ...input, messageIndex: 0 }))).status).toBe(409);
  expect((await POST(req({ ...input, sessionId: 'missing' }))).status).toBe(
    404,
  );
  expect(
    (await POST(req({ ...input, source: { quote: 'forged' } }))).status,
  ).toBe(400);
  state.runs = [{ status: 'running' }];
  expect((await POST(req(input))).status).toBe(409);
  state.runs = [];
  expect(
    (await POST(req(input, 'POST', '', { Origin: 'https://other.example' })))
      .status,
  ).toBe(403);
  expect((await GET(req(undefined, 'GET', '?id=../escape'))).status).toBe(400);
  expect((await GET(req(undefined, 'GET', '?unknown=true'))).status).toBe(400);
  vi.mocked(readRuntimeAuthConfig).mockReturnValue({
    webSessionSecret: 'secret',
    webPassword: 'password',
  });
  expect(
    (
      await GET(
        req(undefined, 'GET', '', { Authorization: 'Bearer shared-agent' }),
      )
    ).status,
  ).toBe(401);
});

it('serves method choices privately without caching and rejects unknown parameters and shared access', async () => {
  const response = await METHODS(req(undefined, 'GET'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ methods: [] });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect((await METHODS(req(undefined, 'GET', '?scope=all'))).status).toBe(400);
  vi.mocked(readRuntimeAuthConfig).mockReturnValue({
    webSessionSecret: 'secret',
    webPassword: 'password',
  });
  expect(
    (
      await METHODS(
        req(undefined, 'GET', '', { Authorization: 'Bearer shared-agent' }),
      )
    ).status,
  ).toBe(401);
});
