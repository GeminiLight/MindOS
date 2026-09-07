import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { readEchoCardsState, writeEchoCardsState } from '@/lib/echo-card-generator';
import { testMindRoot } from '../setup';
import { GET, POST, PATCH } from '@/app/api/echo/learning/route';

function request(body: unknown, method = 'POST') {
  return new NextRequest('http://localhost/api/echo/learning', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}
function seed() {
  const state = readEchoCardsState(testMindRoot);
  state.cards.push({
    id: 'insight-learning', segment: 'insight', kind: 'judgment', title: 'Review the evidence', content: 'Check the original source.',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), generatedAt: new Date().toISOString(),
    generation: { method: 'lm', trigger: 'manual', locale: 'en' }, confidence: 0.8, status: 'active',
    source: { label: 'Discussion', sessions: [{ id: 'session-evidence', messageRefs: [{ messageIndex: 0, role: 'user', quote: 'Read the original source.' }] }] },
  });
  writeEchoCardsState(testMindRoot, state);
}

describe('/api/echo/learning', () => {
  it('starts from server evidence, persists understanding and exports a readable journal', async () => {
    seed();
    const created = await POST(request({ cardId: 'insight-learning', source: { title: 'forged' } }));
    expect(created.status).toBe(200);
    const { loop } = await created.json();
    expect(loop.source.title).toBe('Review the evidence');
    const saved = await PATCH(request({ id: loop.id, action: 'reflect', version: loop.version, before: 'I trusted summaries.', understanding: 'I need to verify evidence.' }, 'PATCH'));
    expect(saved.status).toBe(200);
    expect((await saved.json()).loop.stage).toBe('planning');
    const all = await GET(new NextRequest('http://localhost/api/echo/learning'));
    expect((await all.json()).loops).toHaveLength(1);
    expect(all.headers.get('cache-control')).toContain('no-store');
    const exported = await GET(new NextRequest('http://localhost/api/echo/learning?id=' + loop.id + '&format=markdown'));
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    expect(await exported.text()).toContain('I need to verify evidence.');
  });

  it('rejects missing, ungrounded and deleted insights', async () => {
    expect((await POST(request({ cardId: 'missing' }))).status).toBe(404);
    seed();
    const state = readEchoCardsState(testMindRoot);
    state.cards[0].source.sessions[0].messageRefs = [];
    writeEchoCardsState(testMindRoot, state);
    expect((await POST(request({ cardId: 'insight-learning' }))).status).toBe(400);
    state.cards[0].status = 'deleted';
    writeEchoCardsState(testMindRoot, state);
    expect((await POST(request({ cardId: 'insight-learning' }))).status).toBe(404);
  });

  it('returns conflict for stale forms and validation errors for invalid requests', async () => {
    seed();
    const { loop } = await (await POST(request({ cardId: 'insight-learning' }))).json();
    expect((await PATCH(request({ id: loop.id, action: 'archive', version: 1 }, 'PATCH'))).status).toBe(200);
    expect((await PATCH(request({ id: loop.id, action: 'archive', version: 1 }, 'PATCH'))).status).toBe(409);
    expect((await PATCH(request({ id: '../escape', action: 'archive', version: 1 }, 'PATCH'))).status).toBe(400);
    expect((await POST(request(null))).status).toBe(400);
    expect((await POST(new NextRequest('http://localhost/api/echo/learning', { method: 'POST', body: '{bad' }))).status).toBe(400);
  });
});

it('serves durable approval and real evidence separately from the learning journal', async () => {
  seed();
  let { loop } = await (await POST(request({ cardId: 'insight-learning' }))).json();
  for (const command of [
    { action: 'reflect', before: 'Trust prose', understanding: 'Check evidence' },
    { action: 'plan', situation: 'A new paper', experiment: 'Check methods', check: 'Bound the claim', reviewOn: '2026-09-10' },
    { action: 'review', outcome: 'not-tried', observation: 'Not yet', revisedRule: 'A tentative method' },
    { action: 'propose-agent', attemptIndex: 0, behavior: 'Check causal claims', scope: 'Research only', check: 'Cite study design' },
    { action: 'approve-agent', attemptIndex: 0 },
  ]) {
    const response = await PATCH(request({ id: loop.id, version: loop.version, ...command }, 'PATCH'));
    expect(response.status).toBe(200); loop = (await response.json()).loop;
  }
  const response = await GET(new NextRequest('http://localhost/api/echo/learning?id=' + loop.id));
  expect(response.headers.get('cache-control')).toBe('no-store');
  const result = await response.json();
  expect(result.loop.attempts[0].agentChange.review.decision).toBe('approved');
  expect(result.loop.attempts[0].review.outcome).toBe('not-tried');
  expect(result.agentEvidence).toEqual([{ attemptIndex: 0, revisionIndex: 0, receipts: [] }]);
  expect((await PATCH(request({ id: loop.id, version: loop.version, action: 'observe-agent', attemptIndex: 0, receiptId: 'forged', outcome: 'followed', observation: 'Worked' }, 'PATCH'))).status).toBe(400);
});

it('prepares an exact approved method and rejects stale or malformed trial requests', async () => {
  const { startLearningCorrection, updateLearningLoop } = await import('@geminilight/mindos/knowledge');
  let loop = startLearningCorrection(testMindRoot, { cardId: 'trial-source', title: 'Check sources', content: 'Read the design', sessions: [{ id: 's1', messageRefs: [{ role: 'assistant', messageIndex: 0, quote: 'A claim' }] }] }, { behavior: 'Read the design', scope: 'Research', check: 'Supported claims' });
  const trial = (query: string) => GET(new NextRequest('http://localhost/api/echo/learning?id=' + loop.id + '&action=trial&' + query));
  expect((await trial('attemptIndex=-1&version=' + loop.version)).status).toBe(409);
  loop = updateLearningLoop(testMindRoot, loop.id, { action: 'approve-agent', attemptIndex: -1, version: loop.version });
  const response = await trial('attemptIndex=-1&version=' + loop.version);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).trial).toMatchObject({ assetId: loop.directMethod!.review!.assetId, assetVersion: 1 });
  for (const query of ['version=2', 'attemptIndex=&version=2', 'attemptIndex=-1&version=', 'attemptIndex=NaN&version=2']) expect((await trial(query)).status).toBe(400);
  expect((await trial('attemptIndex=-1&version=1')).status).toBe(409);
});

it('addresses method revisions explicitly and refuses malformed trial versions', async () => {
  const { startLearningCorrection } = await import('@geminilight/mindos/knowledge');
  let loop = startLearningCorrection(testMindRoot, { cardId: 'revision-source', title: 'Test', content: 'Check it', sessions: [{ id: 's', messageRefs: [{ messageIndex: 0, role: 'user', quote: 'Check it' }] }] }, { behavior: 'Check design', scope: 'Research', check: 'Design cited' });
  const update = async (command: Record<string, unknown>) => {
    const response = await PATCH(request({ id: loop.id, version: loop.version, attemptIndex: -1, ...command }, 'PATCH'));
    expect(response.status).toBe(200); loop = (await response.json()).loop;
  };
  await update({ action: 'approve-agent' });
  await update({ action: 'pause-agent', reason: 'Review scope' });
  await update({ action: 'revise-agent', reason: 'Refine scope', behavior: 'Check design and limitations', scope: 'Research', check: 'Limitations cited' });
  await update({ action: 'approve-agent', revisionIndex: 1 });
  const url = `http://localhost/api/echo/learning?id=${loop.id}&action=trial&attemptIndex=-1&version=${loop.version}`;
  const current = await GET(new NextRequest(url + '&revisionIndex=1'));
  expect(current.status).toBe(200);
  expect((await current.json()).trial.assetId).toBe(loop.directMethod?.revisions?.[0].review?.assetId);
  expect((await GET(new NextRequest(url))).status).toBe(409);
  for (const value of ['bad', '-1', '1.5', '100']) expect((await GET(new NextRequest(url + '&revisionIndex=' + value))).status).toBe(400);
});
