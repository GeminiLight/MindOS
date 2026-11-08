// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { startLearningLoop, startLearningCorrection, listLearningLoops, updateLearningLoop, learningAgentEvidence } from '@geminilight/mindos/knowledge';
import { writeRetrievalReceipt } from '@geminilight/mindos/retrieval';
import { testMindRoot } from '../setup';
import EchoLearningPanel from '@/components/echo/learning/EchoLearningPanel';
import EchoLearningStartButton from '@/components/echo/learning/EchoLearningStartButton';
import { messages } from '@/lib/i18n';
import { announceLearningUpdate } from '@/components/echo/learning/learning-client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en', t: messages.en }),
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const source = { cardId: 'insight-1', title: 'Check evidence boundaries', content: 'Read the original source.', sessions: [{ id: 's1', messageRefs: [{ messageIndex: 0, role: 'user', quote: 'The claim is too strong.' }] }] };
let host: HTMLDivElement;
let root: Root;
let failSave: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.history.replaceState({}, '', '/echo/learning');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); failSave = false;
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (_url === '/api/echo/inquiries') return Response.json({ inquiries: [], unavailableCount: 0 });
    if (_url.includes('/api/echo/transfer?list=pending')) return Response.json({ practices: [], unavailableCount: 0 });
    if (_url.startsWith('/api/agent-runs')) return Response.json({ observatory: { schemaVersion: 1, traces: [{ status: 'completed', receipts: [{ id: 'test-use' }], outputSummary: 'The output explicitly says the study is correlational.', artifacts: [] }] } });
    if (_url.includes('/api/echo/learning?id=')) {
      const loop = listLearningLoops(testMindRoot)[0];
      return Response.json({ loop, agentEvidence: learningAgentEvidence(testMindRoot, loop) });
    }
    if (!init?.method || init.method === 'GET') return Response.json({ loops: listLearningLoops(testMindRoot) });
    if (failSave) throw new TypeError('Failed to fetch');
    const body = JSON.parse(String(init.body));
    try {
      const loop = init.method === 'POST' ? startLearningLoop(testMindRoot, source) : updateLearningLoop(testMindRoot, body.id, body);
      return Response.json({ loop });
    } catch { return Response.json({ code: 'conflict' }, { status: 409 }); }
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render() {
  await act(async () => root.render(<><EchoLearningStartButton cardId="insight-1" enabled /><EchoLearningPanel /></>));
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((el) => el.textContent?.trim() === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function fill(name: string, value: string) {
  const radio = host.querySelector(`input[type=radio][name="${name}"][value="${value}"]`) as HTMLInputElement | null;
  if (radio) { await act(async () => radio.click()); return; }
  const input = host.querySelector('[name="' + name + '"]') as HTMLInputElement | HTMLTextAreaElement;
  expect(input, name).not.toBeNull();
  await act(async () => {
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}

describe('Echo human learning experience', () => {
  it('protects a personal draft when switching records or archiving and permits an explicit discard', async () => {
    const first = startLearningLoop(testMindRoot, source);
    startLearningLoop(testMindRoot, { ...source, cardId: 'another-source', title: 'Another record' });
    await render(); await click(source.title); await fill('before', 'Unsaved reasoning');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await click('Another record');
    expect((host.querySelector('[name=before]') as HTMLTextAreaElement).value).toBe('Unsaved reasoning');
    await click('Archive');
    expect(listLearningLoops(testMindRoot).find(l => l.id === first.id)?.archived).toBe(false);
    const refresh = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(refresh);
    expect(refresh.defaultPrevented).toBe(true);
    confirm.mockClear();
    await act(async () => announceLearningUpdate(first, true));
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockReturnValue(true); await click('Another record');
    expect((host.querySelector('[name=before]') as HTMLTextAreaElement).value).toBe('');
    const cleanRefresh = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(cleanRefresh);
    expect(cleanRefresh.defaultPrevented).toBe(false);
  });
  it('preserves an unfinished personal reflection when an independent method action saves', async () => {
    const loop = startLearningCorrection(testMindRoot, source, { behavior: 'Check design', scope: 'Research', check: 'Evidence supports claims' });
    await render(); await click(source.title);
    await fill('before', 'My unfinished reflection');
    await click('Approve for future retrieval');
    expect((host.querySelector('[name=before]') as HTMLTextAreaElement).value).toBe('My unfinished reflection');
    expect(listLearningLoops(testMindRoot).find(l => l.id === loop.id)?.directMethod?.review?.decision).toBe('approved');
  });
  it('takes a real insight through understanding, practice, review and a new situation', async () => {
    await render();
    await click('Try it myself');
    expect(host.textContent).toContain('The claim is too strong.');
    await fill('before', 'I relied on summaries.');
    await fill('understanding', 'I should check the original evidence.');
    await click('Save my understanding');
    await fill('situation', 'The next paragraph I write');
    await fill('experiment', 'Check each claim against the paper');
    await fill('check', 'I can explain where the evidence stops');
    await fill('reviewOn', '2026-09-10');
    await click('Save this practice');
    expect(host.textContent).toContain('Check each claim against the paper');
    const plan = [...host.querySelectorAll('details')].find(el => el.querySelector('summary')?.textContent === 'Practice plan');
    expect(plan?.open).toBe(false);
    await fill('outcome', 'mixed');
    await fill('observation', 'I corrected two claims; one remains unclear.');
    await fill('revisedRule', 'Explain the evidence before choosing the wording.');
    await click('Save reflection');
    expect(host.textContent).toContain('I corrected two claims; one remains unclear.');
    await click('Try in a new situation');
    expect(host.textContent).toContain('Explain the evidence before choosing the wording.');
    expect(listLearningLoops(testMindRoot)[0].attempts).toHaveLength(1);
    expect(host.querySelector('[name="situation"]')).not.toBeNull();
  });

  it('preserves typed understanding on a failed save and can retry', async () => {
    startLearningLoop(testMindRoot, source);
    await render();
    await click('Check evidence boundaries');
    await fill('before', 'Old belief');
    await fill('understanding', 'My own revised judgment');
    failSave = true;
    await click('Save my understanding');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[role="alert"]'));
    expect((host.querySelector('[name="understanding"]') as HTMLTextAreaElement).value).toBe('My own revised judgment');
    failSave = false;
    await click('Save my understanding');
    expect(listLearningLoops(testMindRoot)[0].stage).toBe('planning');
  });

  it('keeps a dirty form when another tab changes the record, then reports the conflict', async () => {
    const loop = startLearningLoop(testMindRoot, source);
    await render(); await click('Check evidence boundaries');
    await fill('before', 'Unsaved belief'); await fill('understanding', 'Unsaved understanding');
    updateLearningLoop(testMindRoot, loop.id, { action: 'reflect', version: 1, before: 'Elsewhere', understanding: 'Changed elsewhere' });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect((host.querySelector('[name="before"]') as HTMLTextAreaElement).value).toBe('Unsaved belief');
    await click('Save my understanding');
    expect(host.textContent).toContain('changed');
    expect((host.querySelector('[name="understanding"]') as HTMLTextAreaElement).value).toBe('Unsaved understanding');
  });

  it('disables starting an ungrounded sample and restores archived records', async () => {
    await act(async () => root.render(<EchoLearningStartButton cardId="sample" enabled={false} />));
    expect(host.querySelector('button')?.disabled).toBe(true);
    expect(host.textContent).toContain('Start from an insight with a source conversation.');
    expect(host.querySelector('button')?.getAttribute('aria-describedby')).toBeTruthy();
    const loop = startLearningLoop(testMindRoot, source);
    updateLearningLoop(testMindRoot, loop.id, { action: 'archive', version: 1 });
    await render();
    await click('Archived');
    await click('Check evidence boundaries');
    await click('Restore');
    expect(listLearningLoops(testMindRoot)[0].archived).toBe(false);
  });

  it('retains existing practices when starting an insight before the initial list finishes loading', async () => {
    const existing = startLearningLoop(testMindRoot, { ...source, cardId: 'another', title: 'Earlier practice' });
    const previousFetch = fetchMock.getMockImplementation()!;
    let resolveInitial!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }));
    fetchMock.mockImplementation(previousFetch);
    await render();
    await click('Try it myself');
    await act(async () => resolveInitial(Response.json({ loops: [existing] })));
    expect(host.textContent).toContain('Earlier practice');
    expect(host.textContent).toContain('Check evidence boundaries');
  });
});

 it('lets a reviewed practice propose a scoped Agent method before explicit authorization', async () => {
    let loop = startLearningLoop(testMindRoot, source);
    for (const command of [
      { action: 'reflect', before: 'Trust summaries', understanding: 'Read evidence' },
      { action: 'plan', situation: 'A new paper', experiment: 'Check claims', check: 'Find limits', reviewOn: '2026-09-10' },
      { action: 'review', outcome: 'mixed', observation: 'Found a weak claim', revisedRule: 'Check study design' },
    ]) loop = updateLearningLoop(testMindRoot, loop.id, { ...command, version: loop.version });
    await render(); await click('Check evidence boundaries');
    await fill('agentBehavior', 'Check study design before causal wording');
    await fill('agentScope', 'Research claims, excluding fiction');
    await fill('agentCheck', 'Causal claims include evidence');
    failSave = true; await click('Save proposal');
    expect((host.querySelector('[name="agentScope"]') as HTMLTextAreaElement).value).toBe('Research claims, excluding fiction');
    failSave = false; await click('Save proposal');
    expect(host.textContent).toContain('Awaiting your decision');
    expect(listLearningLoops(testMindRoot)[0].attempts[0].agentChange?.review).toBeUndefined();
    await click('Approve for future retrieval');
    expect(host.textContent).toContain('Approved for retrieval');
    expect(host.textContent).toContain('A method retrieved or attached to context does not prove it was followed.');
 });

 it('shows the actual matching output and defaults to uncertainty before saving a user observation', async () => {
    let loop = startLearningLoop(testMindRoot, source);
    for (const command of [
      { action: 'reflect', before: 'Trust summaries', understanding: 'Read evidence' },
      { action: 'plan', situation: 'A paper', experiment: 'Check claims', check: 'Find limits', reviewOn: '2026-09-10' },
      { action: 'review', outcome: 'mixed', observation: 'A weak claim', revisedRule: 'Check design' },
      { action: 'propose-agent', attemptIndex: 0, behavior: 'Check design', scope: 'Research only', check: 'Bound causal claims' },
      { action: 'approve-agent', attemptIndex: 0 },
    ]) loop = updateLearningLoop(testMindRoot, loop.id, { ...command, version: loop.version });
    const assetId = loop.attempts[0].agentChange!.review!.assetId!;
    writeRetrievalReceipt(testMindRoot, { id: 'test-use', query: 'Review a causal claim', strategy: 'hybrid', outcome: 'selected', startedAt: '2099-01-01T00:00:00.000Z', completedAt: '2099-01-01T00:00:00.000Z',
      budget: { maxTokens: 1000, maxFiles: 2, minScore: 0, timeoutMs: 1000 }, scope: { preferredPaths: [], excludePaths: [] }, candidates: [],
      selections: [{ assetId, path: 'Echo/Playbooks/test.md', score: 1, estimatedTokens: 30, truncated: false, reason: 'Relevant' }],
      totals: { candidateCount: 1, selectedCount: 1, usedTokens: 30 }, metadata: { runId: 'test-run' } });
    await render(); await click('Check evidence boundaries');
    await fill('agentReceipt', 'test-use');
    expect(host.textContent).toContain('The output explicitly says the study is correlational.');
    expect((host.querySelector('[name="agentOutcome"]') as HTMLSelectElement).value).toBe('uncertain');
    await fill('agentOutcome', 'followed');
    await fill('agentObservation', 'It explicitly bounded the causal claim.');
    await click('Save my observation');
    expect(host.textContent).toContain('Your observation · not an automatic evaluation');
    expect(listLearningLoops(testMindRoot)[0].attempts[0].agentChange!.observations[0].outcome).toBe('followed');
 });

it('opens a linked correction without requiring personal practice and does not reset a later archive filter on refresh', async () => {
 const loop = startLearningCorrection(testMindRoot, { ...source, cardId: 'direct-link' }, { behavior: 'Check design', scope: 'Research', check: 'Evidence supports claims' });
 const previousUrl = window.location.href;
 window.history.replaceState({}, '', '?learning=' + loop.id);
 try {
   await render();
   expect(host.querySelector('button[aria-expanded=true]')?.textContent).toBe(source.title);
   expect(host.textContent).toContain('Awaiting your decision');
   const optional = [...host.querySelectorAll('details')].find(el => el.querySelector('summary')?.textContent?.includes('Practice this method'));
   expect(optional?.open).toBe(false);
   await click('Archived');
   await act(async () => window.dispatchEvent(new Event('focus')));
   expect([...host.querySelectorAll('button')].find(el => el.textContent === 'Archived')?.getAttribute('aria-pressed')).toBe('true');
 } finally { window.history.replaceState({}, '', previousUrl); }
});

it('keeps counterexamples independent from pausing and reviews revisions without losing old content', async () => {
  let loop = startLearningCorrection(testMindRoot, source, { behavior: 'Name the design', scope: 'Research claims', check: 'Design cited' });
  loop = updateLearningLoop(testMindRoot, loop.id, { action: 'approve-agent', version: loop.version, attemptIndex: -1 });
  await render(); await click('Check evidence boundaries');
  await fill('methodCounterexample', 'A design label missed the attrition problem.');
  failSave = true; await click('Save counterexample');
  expect((host.querySelector('[name="methodCounterexample"]') as HTMLTextAreaElement).value).toContain('attrition');
  failSave = false; await click('Save counterexample');
  expect(listLearningLoops(testMindRoot)[0].directMethod?.availability).toBe('active');
  await fill('methodTransitionReason', 'Check attrition before using this again.');
  await click('Pause this method');
  expect([...host.querySelectorAll('li')].find((item) => item.querySelector('button')?.textContent === source.title)?.textContent).toContain('Paused');
  expect(host.querySelector('[name="methodTrialTask"]')).toBeNull();
  await fill('methodRevisionBehavior', 'Name the design and check attrition');
  await fill('methodRevisionReason', 'Design labels alone are insufficient');
  await click('Save revision for review');
  expect([...host.querySelectorAll('li')].find((item) => item.querySelector('button')?.textContent === source.title)?.textContent).toContain('Awaiting your decision');
  const draft = listLearningLoops(testMindRoot)[0];
  expect(draft.directMethod?.revisions?.[0].review).toBeUndefined();
  await click('Approve for future retrieval');
  expect(listLearningLoops(testMindRoot)[0].directMethod?.revisions?.[0].review?.decision).toBe('approved');
  expect(host.textContent).toContain('Name the design and check attrition');
  expect(host.textContent).toContain('Check attrition before using this again.');
  expect(host.textContent).toContain('A design label missed the attrition problem.');
  expect([...host.querySelectorAll('button')].filter((button) => button.textContent === 'Resume this method')).toHaveLength(0);
});


it('keeps the open draft while filtering titles and offers a clear no-results recovery', async () => {
  startLearningLoop(testMindRoot, source);
  await render(); await click(source.title); await fill('before', 'Keep this thought');
  await fill('learningSearch', '不存在的记录 🪴');
  expect(host.textContent).toContain('No matching records');
  expect((host.querySelector('[name=before]') as HTMLTextAreaElement).value).toBe('Keep this thought');
  await click('Clear search');
  expect(host.querySelector('button[aria-expanded=true]')?.textContent).toBe(source.title);
});

it('protects drafts when changing the archive filter and closes the old editor after confirmed navigation', async () => {
  startLearningLoop(testMindRoot, source);
  await render(); await click(source.title); await fill('before', 'Unfinished thought');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await click('Archived');
  expect(host.querySelector('[name=before]')).not.toBeNull();
  expect([...host.querySelectorAll('button')].find(el => el.textContent === 'Archived')?.getAttribute('aria-pressed')).toBe('false');
  confirm.mockReturnValue(true); await click('Archived');
  expect(host.querySelector('[name=before]')).toBeNull();
  expect(host.textContent).toContain('No archived records');
});

it('marks the step being edited instead of the saved stage', async () => {
  let loop = startLearningLoop(testMindRoot, source);
  loop = updateLearningLoop(testMindRoot, loop.id, { action: 'reflect', version: loop.version, before: 'Old', understanding: 'New' });
  await render(); await click(source.title);
  expect(host.querySelector('[aria-current=step]')?.textContent).toContain('One practice');
  await click('Edit my understanding');
  expect(host.querySelector('[aria-current=step]')?.textContent).toContain('My understanding');
});

it('offers an actionable retry without claiming an empty library after an initial read failure', async () => {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => url === '/api/echo/learning' ? Promise.reject(new Error('offline')) : original(url, init));
  await render();
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain(messages.en.echoLearning.empty);
  fetchMock.mockImplementation(original); await click('Retry');
  expect(host.textContent).toContain(messages.en.echoLearning.empty);
});

it('keeps the selected record in the address so refreshing resumes the same practice', async () => {
  const loop = startLearningLoop(testMindRoot, source);
  await render(); await click(source.title);
  expect(new URLSearchParams(location.search).get('learning')).toBe(loop.id);
  await act(async () => root.render(null)); await render();
  expect(host.querySelector('[name=before]')).not.toBeNull();
});

it('restores an unfinished reflection against its original version after another page saves', async () => {
  const loop = startLearningLoop(testMindRoot, source);
  await render(); await click(source.title);
  await fill('before', 'My earlier view'); await fill('understanding', 'My private draft');
  await act(async () => root.render(null));
  updateLearningLoop(testMindRoot, loop.id, { action: 'reflect', version: loop.version, before: 'Another page', understanding: 'A different conclusion' });
  await render(); await click(source.title);
  expect((host.querySelector('[name=understanding]') as HTMLTextAreaElement)?.value).toBe('My private draft');
  expect(host.textContent).toContain('This record changed');
  await click('Save my understanding');
  expect(listLearningLoops(testMindRoot)[0].reflection?.understanding).toBe('A different conclusion');
  expect(host.querySelector('[role=alert]')).not.toBeNull();
});

it('restores the plan editing step along with its unsent input', async () => {
  let loop = startLearningLoop(testMindRoot, source);
  loop = updateLearningLoop(testMindRoot, loop.id, { action: 'reflect', version: loop.version, before: 'Old', understanding: 'New' });
  updateLearningLoop(testMindRoot, loop.id, { action: 'plan', version: loop.version, situation: 'Original', experiment: 'Check', check: 'Evidence', reviewOn: '2099-01-01' });
  await render(); await click(source.title); await click('Adjust the plan');
  await fill('situation', 'An unfinished new situation');
  await act(async () => root.render(null)); await render(); await click(source.title);
  expect(host.querySelector('[aria-current=step]')?.textContent).toContain('One practice');
  expect((host.querySelector('[name=situation]') as HTMLTextAreaElement)?.value).toBe('An unfinished new situation');
});

it('announces a saved understanding and focuses the next step', async () => {
  startLearningLoop(testMindRoot, source);
  await render(); await click(source.title); await fill('before', 'Old'); await fill('understanding', 'New');
  await click('Save my understanding');
  expect(host.textContent).toContain('Understanding saved. Plan one small practice next.');
  expect(document.activeElement?.textContent).toBe('One practice');
});

it('explains an unavailable bookmarked record without pretending the library is empty', async () => {
  startLearningLoop(testMindRoot, source);
  window.history.replaceState({}, '', '/echo/learning?learning=learn-' + 'f'.repeat(24));
  await render();
  expect(host.textContent).toContain('This learning record is unavailable');
  expect(host.textContent).toContain(source.title);
});

it('loads current server data after a committed form is reopened instead of reviving a saved snapshot', async () => {
  const first = startLearningLoop(testMindRoot, source);
  await render(); await click(source.title); await fill('before', 'Old'); await fill('understanding', 'First revision');
  await click('Save my understanding');
  await act(async () => root.render(null));
  updateLearningLoop(testMindRoot, first.id, { action: 'reflect', version: 2, before: 'Elsewhere', understanding: 'Latest revision' });
  await render();
  expect(host.textContent).toContain('Latest revision');
  expect(host.textContent).not.toContain('This record changed');
});

it('keeps a local draft when leaving, and explicitly confirms replacing it with the latest record', async () => {
  const loop = startLearningLoop(testMindRoot, source);
  startLearningLoop(testMindRoot, { ...source, cardId: 'other', title: 'Another record' });
  await render(); await click(source.title); await fill('before', 'Keep my local draft');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  await click('Another record');
  expect(confirm).toHaveBeenLastCalledWith(messages.en.echoLearning.workspace.leaveDraft);
  await click(source.title);
  expect((host.querySelector('[name=before]') as HTMLTextAreaElement).value).toBe('Keep my local draft');
  updateLearningLoop(testMindRoot, loop.id, { action: 'reflect', version: 1, before: 'Remote', understanding: 'New' });
  await act(async () => window.dispatchEvent(new Event('focus')));
  confirm.mockReturnValue(false); await click('Load latest version (replace this form)');
  expect((host.querySelector('[name=before]') as HTMLTextAreaElement).value).toBe('Keep my local draft');
  confirm.mockReturnValue(true); await click('Load latest version (replace this form)');
  expect(host.querySelector('[name=situation]')).not.toBeNull();
});

it('keeps input usable when local storage is full and warns instead of claiming it can be restored', async () => {
  startLearningLoop(testMindRoot, source);
  await render(); await click(source.title);
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
  await fill('before', 'Still here');
  expect((host.querySelector('[name=before]') as HTMLTextAreaElement).value).toBe('Still here');
  expect(host.textContent).toContain('Draft storage is unavailable');
  await fill('understanding', 'Save directly'); await click('Save my understanding');
  expect(listLearningLoops(testMindRoot)[0].reflection?.understanding).toBe('Save directly');
});

it('preserves a legacy draft without silently rebasing its missing version', async () => {
  let loop = startLearningLoop(testMindRoot, source);
  loop = updateLearningLoop(testMindRoot, loop.id, { action: 'reflect', version: 1, before: 'Old', understanding: 'New' });
  localStorage.setItem('mindos-echo-draft-v1:' + loop.id + ':personal', JSON.stringify({schema:1,at:Date.now(),value:{before:'Local old',understanding:'Local new',situation:'My situation',experiment:'My action',check:'My evidence',reviewOn:'2099-01-01',outcome:'',observation:'',revisedRule:''}}));
  await render(); await click(source.title);
  expect((host.querySelector('[name=situation]') as HTMLTextAreaElement).value).toBe('My situation');
  await click('Save this practice');
  expect(listLearningLoops(testMindRoot)[0].stage).toBe('planning');
  expect(host.textContent).toContain('This older draft has no saved base version');
});

it('ignores malformed and expired workspace drafts without breaking the record editor', async () => {
  const loop = startLearningLoop(testMindRoot, source);
  const key = 'mindos-echo-draft-v1:' + loop.id + ':workspace';
  localStorage.setItem(key, JSON.stringify({ schema:1, at:Date.now(), value:{snapshot:null,values:{},editing:'bogus'} }));
  await render(); await click(source.title);
  expect((host.querySelector('[name=before]') as HTMLTextAreaElement).value).toBe('');
  await act(async () => root.render(null));
  localStorage.setItem(key, JSON.stringify({ schema:1,at:Date.now()-8*86400000,value:{} }));
  await render();
  expect(host.querySelector('[name=before]')).not.toBeNull();
});

it('clears a previous practice anchor when selecting another record', async () => {
  const first = startLearningLoop(testMindRoot, source);
  const second = startLearningLoop(testMindRoot, { ...source, cardId: 'second-anchor', title: 'Another record' });
  window.history.replaceState({}, '', '/echo/learning?learning=' + first.id + '&practice=1#echo-transfer-' + first.id);
  await render(); await click(second.source.title);
  const url = new URL(window.location.href);
  expect(url.searchParams.get('learning')).toBe(second.id);
  expect(url.searchParams.has('practice')).toBe(false);
  expect(url.hash).toBe('');
});
