import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PATCH } from '@/app/api/echo/research/route';
import { blankStudyProtocol } from '@/components/echo/research/study-draft';
import { readRuntimeAuthConfig } from '@/lib/runtime-auth-config';
import { verifyJwt } from '@/lib/jwt';
vi.mock('@/lib/runtime-auth-config', () => ({ readRuntimeAuthConfig: vi.fn(() => ({ webSessionSecret: '' })) }));
vi.mock('@/lib/jwt', () => ({ verifyJwt: vi.fn(async () => null) }));
let home: string;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'study-api-')); vi.spyOn(os, 'homedir').mockReturnValue(home); vi.mocked(readRuntimeAuthConfig).mockReturnValue({ webSessionSecret: '' }); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });
const req = (body: unknown, method = 'POST', headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/echo/research', { method, headers, body: JSON.stringify(body) });
it('saves incomplete drafts and serves material-free lists while refusing incomplete freezing and stale updates', async () => {
  const created = await POST(req({ requestId: 'draft-api', protocol: blankStudyProtocol('en') }));
  expect(created.status).toBe(200); const { study, missing } = await created.json(); expect(missing).toContain('title');
  const list = await GET(new NextRequest('http://localhost/api/echo/research')); expect(list.headers.get('cache-control')).toBe('no-store');
  expect((await list.json()).studies[0].id).toBe(study.id);
  const saved = await PATCH(req({ id: study.id, action: 'save', version: study.version, protocol: { ...study.protocol, title: 'Draft in progress' } }, 'PATCH'));
  expect(saved.status).toBe(200);
  expect((await PATCH(req({ id: study.id, action: 'save', version: study.version, protocol: study.protocol }, 'PATCH'))).status).toBe(409);
  expect((await PATCH(req({ id: study.id, action: 'freeze', version: study.version + 1, reviewedBy: 'owner', reviewNote: 'Incomplete', confirmed: true }, 'PATCH'))).status).toBe(400);
  const refreshed = await GET(new NextRequest('http://localhost/api/echo/research?id=' + study.id));
  expect((await refreshed.json()).study.protocol.title).toBe('Draft in progress');
});
it('does not expose participant operations, rejects bad inputs, and preserves the browser password boundary', async () => {
  for (const body of [null, [], { requestId: 'bad', protocol: {} }, { requestId: 'bad', protocol: blankStudyProtocol('en'), role: 'researcher' }]) expect((await POST(req(body))).status).toBe(400);
  expect((await PATCH(req({ id: 'study-' + 'a'.repeat(24), action: 'enroll', role: 'participant' }, 'PATCH'))).status).toBe(400);
  expect((await GET(new NextRequest('http://localhost/api/echo/research?id=../escape'))).status).toBe(400);
  expect((await GET(new NextRequest('http://localhost/api/echo/research?id=study-' + 'a'.repeat(24)))).status).toBe(404);
  expect((await POST(req({ text: '字'.repeat(200000) }))).status).toBe(400);
  expect((await POST(req({}, 'POST', { Origin: 'https://other.example' }))).status).toBe(403);
  vi.mocked(readRuntimeAuthConfig).mockReturnValue({ webPassword: 'configured', webSessionSecret: 'secret' });
  expect((await GET(new NextRequest('http://localhost/api/echo/research', { headers: { Authorization: 'Bearer shared-agent-token' } }))).status).toBe(401);
  vi.mocked(verifyJwt).mockResolvedValue({ exp: 9999999999 } as Awaited<ReturnType<typeof verifyJwt>>);
  expect((await GET(new NextRequest('http://localhost/api/echo/research', { headers: { Cookie: 'mindos-session=valid' } }))).status).toBe(200);
});
it('uses the browser request host when Next normalizes the route URL, while rejecting different origins', async () => {
  const input = { requestId: 'host-normalization', protocol: blankStudyProtocol('en') };
  const request = (origin: string) => new NextRequest('http://localhost:4569/api/echo/research', { method: 'POST', headers: { Host: '127.0.0.1:4569', Origin: origin, 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify(input) });
  expect((await POST(request('http://127.0.0.1:4569'))).status).toBe(200);
  for (const origin of ['http://127.0.0.1:4570', 'https://127.0.0.1:4569', 'null', 'https://other.example'])
    expect((await POST(request(origin))).status).toBe(403);
});
it('bounds a stalled upload and cancels its stream without creating study data', async () => {
  vi.useFakeTimers(); let cancelled = false;
  try {
    const stream = new ReadableStream({ cancel() { cancelled = true; } });
    const pending = POST(new NextRequest('http://localhost/api/echo/research', { method: 'POST', body: stream }));
    await vi.advanceTimersByTimeAsync(15001);
    expect((await pending).status).toBe(400); expect(cancelled).toBe(true);
  } finally { vi.useRealTimers(); }
});
