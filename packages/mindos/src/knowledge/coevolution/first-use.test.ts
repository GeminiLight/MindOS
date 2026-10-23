import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCoevolutionTask, prepareCoevolutionTaskRun, consumeCoevolutionDraft, createCoevolutionInquiry, coevolutionContext, coevolutionRuns } from './index.js';
import { updateInquiry } from '../inquiries/index.js';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { installKnowledgeAgentRunLister } from '../agent-run-data.js';
let root: string, home: string;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'co-first-')); root = path.join(home, 'mind'); fs.mkdirSync(root); vi.spyOn(os, 'homedir').mockReturnValue(home); setMindRootResolverForTests(() => root); installKnowledgeAgentRunLister(() => []); });
afterEach(() => { vi.restoreAllMocks(); setMindRootResolverForTests(null); installKnowledgeAgentRunLister(null); fs.rmSync(home, { recursive: true, force: true }); });
const create = () => createCoevolutionTask(root, { requestId: 'first', title: 'A real design discussion', goal: 'Compare learning formats', mode: 'together' });
it('prepares an explicit feature request and keeps the existing task conversation', () => {
  const task = create();
  const first = prepareCoevolutionTaskRun(root, task.id, { version: task.version, requestId: 'first-run' });
  const bound = consumeCoevolutionDraft(root, { prompt: first.draft.prompt, chatSessionId: 'same-chat' })!;
  const next = prepareCoevolutionTaskRun(root, task.id, { version: bound.version, requestId: 'standard', intent: 'correction' });
  expect(next.draft.prompt).toContain('修改');
  expect(next.draft.prompt).toContain('echo_suggest');
  expect(next.draft.chatSessionId).toBe('same-chat');
  expect(consumeCoevolutionDraft(root, { prompt: next.draft.prompt, chatSessionId: 'same-chat' })?.chatSessionId).toBe('same-chat');
  expect(() => prepareCoevolutionTaskRun(root, task.id, { version: 99, requestId: 'invalid', intent: 'publish' })).toThrow();
});
it('includes attributed later corrections from the source instead of only its opening reply', () => {
  const task = createCoevolutionTask(root, { requestId: 'source', title: 'Source', goal: 'Continue', mode: 'together', source: { kind: 'replay', sessionId: 'source', messageIndex: 1, messageHash: 'a'.repeat(64), title: 'Source', quote: 'Start with cards', excerpts: [{ messageId: 'u2', role: 'user', quote: 'Let me choose a branch before seeing the outcome.' }, { messageId: 'a2', role: 'assistant', quote: 'The next design shows a decision first.' }] } });
  const context = coevolutionContext(task, root);
  expect(context).toContain('用户 [u2]');
  expect(context).toContain('Let me choose a branch before seeing the outcome.');
  expect(context).toContain('历史');
});
it('feeds the human-confirmed disagreement into subsequent work but does not treat an unconfirmed draft as agreement', () => {
  const task = create();
  const linked = createCoevolutionInquiry(root, task.id, { version: task.version, requestId: 'inquiry' });
  let inquiry = updateInquiry(root, linked.inquiry.id, { version: linked.inquiry.version, requestId: 'draft', action: 'save-draft', draft: { question: 'Which check?', explanationA: 'Inspect the score only', explanationB: 'Inspect the unscored held-out cases', distinction: 'Does the score hide failures?', capability: 'Judge evaluation validity' } });
  expect(coevolutionContext(linked.task, root)).not.toContain('Inspect the score only');
  inquiry = updateInquiry(root, inquiry.id, { version: inquiry.version, requestId: 'frame', action: 'commit-frame' });
  const context = coevolutionContext(linked.task, root);
  expect(context).toContain('Inspect the score only');
  expect(context).toContain('Inspect the unscored held-out cases');
  expect(context).toContain('尚未验证');
});
it('preserves what was actually sent with a run, independently of later task changes', () => {
  const first = prepareCoevolutionTaskRun(root, create().id, { version: 1, requestId: 'run' });
  const task = consumeCoevolutionDraft(root, { prompt: first.draft.prompt, chatSessionId: 'chat' })!;
  const receipt = { taskId: task.id, taskVersion: task.version, mode: 'try', context: 'Let the human propose first.', contextHash: 'a'.repeat(64) };
  installKnowledgeAgentRunLister(() => [{ id: 'actual', chatSessionId: 'chat', runtimeId: 'mindos', status: 'completed', startedAt: Date.now()+1, completedAt: Date.now()+2, outputSummary: 'What would you try?', metadata: { coevolutionReceipt: receipt } }]);
  expect(coevolutionRuns(root, task)[0].collaboration).toEqual(receipt);
});

it('refuses an unattributed Agent inquiry and preserves even a partially edited human draft', async () => {
  const { suggestCoevolutionInquiry } = await import('./suggestions.js');
  const first = prepareCoevolutionTaskRun(root, create().id, {version:1, requestId:'bind'});
  const task = consumeCoevolutionDraft(root,{prompt:first.draft.prompt,chatSessionId:'chat'})!;
  const proposal = {question:'Agent question',explanationA:'A',explanationB:'B',distinction:'A measurable distinction',capability:'Judgment'};
  expect(()=>suggestCoevolutionInquiry(root,task.id,proposal,{runId:'missing',chatSessionId:'chat'})).toThrow();
  installKnowledgeAgentRunLister(()=>[{id:'active',chatSessionId:'chat',runtimeId:'mindos',status:'running',startedAt:Date.now()+1}]);
  const linked = createCoevolutionInquiry(root,task.id,{version:task.version,requestId:'link'});
  updateInquiry(root,linked.inquiry.id,{version:linked.inquiry.version,requestId:'partial',action:'save-draft',draft:{...linked.inquiry.draft,question:'My own edited question'}});
  expect(()=>suggestCoevolutionInquiry(root,task.id,proposal,{runId:'active',chatSessionId:'chat'})).toThrow();
});
