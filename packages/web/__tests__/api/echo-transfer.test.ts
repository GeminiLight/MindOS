import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { startLearningLoop } from '@geminilight/mindos/knowledge';
import { testMindRoot } from '../setup';
import { GET, POST, PATCH } from '@/app/api/echo/transfer/route';
let home: string; let learningId: string;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-api-')); vi.spyOn(os, 'homedir').mockReturnValue(home); learningId = startLearningLoop(testMindRoot, { cardId: 'transfer-source', title: 'Evidence', content: 'Check the design', sessions: [{ id: 's', messageRefs: [{ messageIndex: 0, role: 'user', quote: 'Read the original' }] }] }).id; });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });
const req = (body: unknown, method = 'POST') => new NextRequest('http://localhost/api/echo/transfer', { method, body: JSON.stringify(body) });
it('projects only the active phase and refuses timing and version bypasses', async () => {
  const response = await POST(req({ learningId, locale: 'en' })); expect(response.status).toBe(200);
  let view = (await response.json()).practice; expect(view.task.prompt).toContain('coffee'); expect(JSON.stringify(view)).not.toContain('school');
  const answer = { action: 'answer', answer: 'There is an association; confounders remain.', confidence: null, assistance: 'none', familiar: false };
  for (let i = 0; i < 3; i++) { const saved = await PATCH(req({ id: view.id, version: view.version, ...answer }, 'PATCH')); expect(saved.status).toBe(200); view = (await saved.json()).practice; }
  expect(view.stage).toBe('waiting'); expect(view.task).toBeUndefined(); expect(view.history).toBeUndefined();
  expect((await PATCH(req({ id: view.id, version: view.version, action: 'begin-delayed', now: '2099-01-01' }, 'PATCH'))).status).toBe(409);
  const refreshed = await GET(new NextRequest('http://localhost/api/echo/transfer?learningId=' + learningId));
  expect(refreshed.headers.get('cache-control')).toBe('no-store'); expect((await refreshed.json()).practice.id).toBe(view.id);
});
it('rejects malformed, oversized, missing and ungrounded requests', async () => {
  expect((await POST(req({ learningId: 'missing' }))).status).toBe(400);
  expect((await POST(req({ learningId: 'learn-' + '0'.repeat(24) }))).status).toBe(404);
  expect((await POST(req(null))).status).toBe(400);
  expect((await PATCH(req({ id: '../bad', answer: 'a'.repeat(20000) }, 'PATCH'))).status).toBe(400);
});

it('returns an uncached pending list without revealing the current task or answer', async () => {
  const saved = await POST(req({ learningId, locale: 'en' })); const view = (await saved.json()).practice;
  const result = await GET(new NextRequest('http://localhost/api/echo/transfer?list=pending'));
  expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
  const data = await result.json(); expect(data.practices[0].id).toBe(view.id); expect(data.practices[0].status).toBe('continue');
  expect(JSON.stringify(data)).not.toMatch(/coffee|school|reference|answers|guidance/);
});

it('prepares help only after the baseline and rejects fabricated help runs without exposing future tasks', async () => {
 const started = await POST(req({ learningId, locale: 'en' })); let practice = (await started.json()).practice;
 expect((await PATCH(req({ id: practice.id, version: practice.version, action: 'prepare-help' }, 'PATCH'))).status).toBe(409);
 const answered = await PATCH(req({ id: practice.id, version: practice.version, action: 'answer', answer: 'An association alone is insufficient.', confidence: null, assistance: 'none', familiar: false }, 'PATCH'));
 practice = (await answered.json()).practice;
 const prepared = await PATCH(req({ id: practice.id, version: practice.version, action: 'prepare-help' }, 'PATCH'));
 expect(prepared.status).toBe(200); const payload = await prepared.json();
 expect(payload.draft.prompt).toContain('An association alone is insufficient.');
 expect(JSON.stringify(payload)).not.toMatch(/school|workshop|calibrated statement/);
 expect(payload.practice.helpRuns).toEqual([]);
 expect((await PATCH(req({ id: practice.id, version: payload.practice.version, action: 'inspect-help', runId: 'fabricated-run' }, 'PATCH'))).status).toBe(409);
 expect((await PATCH(req({ id: practice.id, version: payload.practice.version, action: 'inspect-help', runId: '../escape' }, 'PATCH'))).status).toBe(400);
});
