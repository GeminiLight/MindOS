import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { startLearningCorrection, updateLearningLoop } from '@geminilight/mindos/knowledge';
import { testMindRoot } from '../setup';
import { GET, POST, PATCH } from '@/app/api/echo/method-comparisons/route';
const runtime = { adapter: 'isolated-chat-v1', provider: 'ollama', model: 'qa', endpoint: 'http://localhost:9999/v1/chat/completions', temperature: 0, maxOutputTokens: 1024, tools: [] };
const config = vi.hoisted(() => ({ available: true }));
const execute = vi.hoisted(() => vi.fn());
vi.mock('@/lib/method-comparison-runtime', () => ({ currentComparisonRuntime: () => config.available ? runtime : null }));
vi.mock('@/lib/study-coaching-executor', () => ({ executeMethodComparison: execute }));
let home: string, loop: ReturnType<typeof startLearningCorrection>;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'comparison-api-')); vi.spyOn(os, 'homedir').mockReturnValue(home);
  config.available = true; execute.mockReset(); execute.mockResolvedValue({ status: 'succeeded', output: 'Inspect design', reportedModel: 'qa' });
  loop = startLearningCorrection(testMindRoot, { cardId: 'comparison-api', title: 'Design', content: 'Evidence', sessions: [{ id: 'source', messageRefs: [{ messageIndex: 0, role: 'assistant', quote: 'Causal' }] }] }, { behavior: 'Original', scope: 'Research', check: 'Design' });
  const change = (data: Record<string, unknown>) => { loop = updateLearningLoop(testMindRoot, loop.id, { version: loop.version, attemptIndex: -1, ...data }); };
  change({ action: 'approve-agent' }); change({ action: 'revise-agent', reason: 'Exception', behavior: 'Revised', scope: 'Research', check: 'Identify exceptions' });
  change({ action: 'pause-agent', reason: 'Updated' }); change({ action: 'approve-agent', revisionIndex: 1 });
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });
const request = (body: unknown, method = 'POST') => new NextRequest('http://localhost/api/echo/method-comparisons', { method, body: JSON.stringify(body) });
const input = () => ({ learningId: loop.id, version: loop.version, attemptIndex: -1, revisions: [0, 1], repetitions: 1, requestId: 'freeze', runtime, cases: ['use', 'exception', 'retention'].map(kind => ({ kind, task: 'Task ' + kind, expected: 'Private ' + kind })) });
it('freezes server-checked configuration and executes an idempotent isolated reservation once', async () => {
  const created = await POST(request(input())); expect(created.status).toBe(200); const c = (await created.json()).comparison;
  const command = { id: c.id, action: 'run', version: c.version, slot: 0, requestId: 'once' };
  const run = await PATCH(request(command, 'PATCH')); expect(run.status).toBe(200);
  expect((await run.json()).comparison.runs[0].status).toBe('succeeded');
  await PATCH(request(command, 'PATCH')); expect(execute).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(execute.mock.calls[0][0])).not.toContain('Private');
  const listing = await GET(new NextRequest(`http://localhost/api/echo/method-comparisons?learningId=${loop.id}&attemptIndex=-1`));
  expect(listing.headers.get('cache-control')).toBe('no-store'); expect(JSON.stringify(await listing.json())).not.toContain('apiKey');
});
it('records a provider failure and rejects stale or unavailable runtime configuration', async () => {
  expect((await POST(request({ ...input(), runtime: { ...runtime, model: 'substituted' } }))).status).toBe(409);
  config.available = false; expect((await POST(request(input()))).status).toBe(409); config.available = true;
  const c = (await (await POST(request(input()))).json()).comparison;
  execute.mockResolvedValue({ status: 'failed', failure: 'provider' });
  const response = await PATCH(request({ id: c.id, action: 'run', version: c.version, slot: 0, requestId: 'failed' }, 'PATCH'));
  expect((await response.json()).comparison.runs[0].failure).toBe('provider');
});
it('rejects invalid bodies and never accepts a client-supplied execution result', async () => {
  expect((await POST(request(null))).status).toBe(400);
  expect((await PATCH(request({ id: 'comparison-' + 'a'.repeat(24), action: 'finish', output: 'invented' }, 'PATCH'))).status).toBe(400);
  expect((await GET(new NextRequest('http://localhost/api/echo/method-comparisons?id=../secret'))).status).toBe(400);
});
