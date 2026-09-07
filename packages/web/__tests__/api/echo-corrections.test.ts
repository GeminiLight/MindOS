import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { listContextAssets } from '@geminilight/mindos/knowledge';
import { testMindRoot } from '../setup';
const state = vi.hoisted(() => ({ sessions: [] as unknown[], runs: [] as unknown[] }));
vi.mock('@geminilight/mindos/server', async (original) => ({ ...await original<object>(), handleAgentSessionsGet: () => ({ body: state.sessions }) }));
vi.mock('@geminilight/mindos/agent', async (original) => ({ ...await original<object>(), listAgentRuns: () => state.runs }));
import { POST } from '@/app/api/echo/corrections/route';
const content = 'This observational study proves causation.';
const body = { sessionId: 's-correction', messageIndex: 1, messageHash: createHash('sha256').update(content).digest('hex'), behavior: 'Check design before causal claims', scope: 'Research only', check: 'Causal claims cite supporting design' };
const req = (input: unknown) => new NextRequest('http://localhost/api/echo/corrections', { method: 'POST', body: JSON.stringify(input) });
beforeEach(() => { state.sessions = [{ id: body.sessionId, title: 'Research', messages: [{ role: 'user', content: 'Summarize the paper' }, { role: 'assistant', content }] }]; state.runs = []; });
it('captures a server-verified correction as an idempotent private method without invented practice', async () => {
 const response = await POST(req(body)); expect(response.status).toBe(200); const { loop } = await response.json();
 expect(loop.directMethod.behavior).toBe(body.behavior); expect(loop.reflection).toBeUndefined(); expect(loop.attempts).toEqual([]);
 expect(loop.source.sessions[0].messageRefs[0].quote).toBe(content);
 expect(listContextAssets(testMindRoot)).toEqual([]);
 expect((await (await POST(req(body))).json()).loop.id).toBe(loop.id);
});
it('rejects changed, missing, streaming or wrong-role sources and invalid input', async () => {
 expect((await POST(req({ ...body, messageHash: 'a'.repeat(64) }))).status).toBe(409);
 expect((await POST(req({ ...body, messageIndex: 0 }))).status).toBe(409);
 expect((await POST(req({ ...body, sessionId: 'missing' }))).status).toBe(404);
 expect((await POST(req({ ...body, scope: '' }))).status).toBe(400);
 state.runs = [{ status: 'running' }]; expect((await POST(req(body))).status).toBe(409);
});
