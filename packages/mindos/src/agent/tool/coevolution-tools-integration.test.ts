import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { createCoevolutionTask, getCoevolutionTask, prepareCoevolutionTaskRun, consumeCoevolutionDraft, updateCoevolutionTask } from '../../knowledge/coevolution/index.js';
import { installKnowledgeAgentRunLister } from '../../knowledge/agent-run-data.js';
import { completeAgentRun, listAgentRuns, resetAgentRunsForTest, startAgentRun } from '../ledger/run-ledger.js';
import { runWithAgentRunContext } from '../agent-run-context.js';
import { answerAskUserQuestion, runWithAskUserQuestionBridge } from '../bridges/user-question-bridge.js';
import { createCoevolutionTools, finalizeCoevolutionObservations } from './coevolution-tools.js';
import { createAgentRunCapsule, finalizeAgentRunCapsule, flushAllCapsuleWrites } from '../capsules/store.js';
import { resolveCoevolutionDecisionBridge } from './coevolution-decision-bridge.js';

let home: string, root: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-tools-')); root = path.join(home, 'mind'); fs.mkdirSync(root);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  setMindRootResolverForTests(() => root); resetAgentRunsForTest(); installKnowledgeAgentRunLister(listAgentRuns);
});
afterEach(async () => { await flushAllCapsuleWrites(); resetAgentRunsForTest(); setMindRootResolverForTests(null); vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });

it.each([true, false])('links a real human answer and completed ledger, accepting only matching outcome evidence (%s)', async matches => {
  const task = createCoevolutionTask(root, { requestId: 'create', title: 'Revise the proposal', goal: 'Decide whether a date has sufficient evidence', mode: 'together' });
  const prepared = prepareCoevolutionTaskRun(root, task.id, { version: task.version, requestId: 'prepare' });
  consumeCoevolutionDraft(root, { prompt: prepared.draft.prompt, chatSessionId: 'human-chat' });
  const run = startAgentRun({ chatSessionId: 'human-chat', agentKind: 'mindos-main', runtimeId: 'mindos', displayName: 'MindOS', permissionMode: 'ask', inputSummary: prepared.draft.prompt });
  const tools = createCoevolutionTools({ getMindRoot: () => root });
  const call = (name: string, params: unknown) => tools.find(item => item.name === name)!.execute(`call-${name}`, params);
  let questionsAsked = 0;
  await runWithAgentRunContext({ parentRunId: run.id, rootRunId: run.id, chatSessionId: 'human-chat' }, () => runWithAskUserQuestionBridge({ runId: 'permission-bridge', send: event => {
    if (event.type !== 'user_question_start') return;
    questionsAsked++;
    const values = ['Qualify the date', 'The sentence will identify the remaining uncertainty', '75%'];
    const result = answerAskUserQuestion({ runId: event.runId, toolCallId: event.toolCallId, answers: event.questions.map((question, index) => ({ questionIndex: index, question: question.question, kind: index === 1 ? 'custom' : 'option', answer: values[index]! })) });
    expect(result.ok).toBe(true);
  } }, async () => {
    const decisionResult = await call('echo_decide', { question: 'How should we present the date?', options: [{ id: 'qualify', label: 'Qualify the date', tradeoff: 'Preserve the target, expose uncertainty' }, { id: 'remove', label: 'Remove the date', tradeoff: 'Avoid a weak claim, lose a planning anchor' }] });
    expect(JSON.stringify(decisionResult)).toContain('chosen');
    const chosen = getCoevolutionTask(root, task.id)!.decisions[0]!;
    expect(chosen.actor).toEqual({ kind: 'agent', runId: run.id, chatSessionId: 'human-chat' });
    expect(chosen.choice?.prediction).toBe(valuesForPrediction);
    const queued = await call('echo_observe', { decisionId: chosen.id, observation: 'The target date now names its dependency.', quote: 'Targeting May, pending validation.' });
    expect(JSON.stringify(queued)).toContain('pending verification');
    expect(getCoevolutionTask(root, task.id)!.decisions[0]!.outcome).toBeUndefined();
  }));
  completeAgentRun(run.id, { outputSummary: matches ? 'Revised sentence: Targeting May, pending validation.' : 'No revised sentence was produced.' });
  await finalizeCoevolutionObservations(root, run.id);
  const saved = getCoevolutionTask(root, task.id)!;
  expect(questionsAsked).toBe(1);
  if (matches) {
    expect(saved.decisions[0]!.outcome?.evidence).toEqual({ kind: 'run', runId: run.id, quote: 'Targeting May, pending validation.' });
    await finalizeCoevolutionObservations(root, run.id);
    expect(getCoevolutionTask(root, task.id)!.version).toBe(saved.version);
  } else expect(saved.decisions[0]!.outcome).toBeUndefined();
});
const valuesForPrediction = 'The sentence will identify the remaining uncertainty';


it('answers from the canvas through the existing pending bridge without duplicating a human choice', async () => {
  const task = createCoevolutionTask(root, { requestId: 'canvas-task', title: 'Canvas decision', goal: 'Take an evidenced next step', mode: 'together' });
  const prepared = prepareCoevolutionTaskRun(root, task.id, { version: task.version, requestId: 'canvas-prepare' });
  consumeCoevolutionDraft(root, { prompt: prepared.draft.prompt, chatSessionId: 'canvas-chat' });
  const run = startAgentRun({ chatSessionId: 'canvas-chat', agentKind: 'mindos-main', runtimeId: 'mindos', displayName: 'MindOS', permissionMode: 'ask', inputSummary: prepared.draft.prompt });
  const tool = createCoevolutionTools({ getMindRoot: () => root }).find(item => item.name === 'echo_decide')!;
  let savedVersion = 0;
  const result = await runWithAgentRunContext({ parentRunId: run.id, chatSessionId: 'canvas-chat' }, () => runWithAskUserQuestionBridge({ runId: 'canvas-bridge', send: event => {
    if (event.type !== 'user_question_start') return;
    const current = getCoevolutionTask(root, task.id)!;
    const chosen = updateCoevolutionTask(root, task.id, { version: current.version, requestId: 'canvas-human-choice', action: 'choose-decision', decisionId: current.decisions[0]!.id, optionId: 'inspect', prediction: 'We will see the ordering', confidence: 65 });
    savedVersion = chosen.version;
    expect(resolveCoevolutionDecisionBridge(chosen, chosen.decisions[0]!.id).status).toBe('delivered');
    expect(resolveCoevolutionDecisionBridge(chosen, chosen.decisions[0]!.id).status).toBe('already-delivered');
  } }, () => tool.execute('canvas-tool', { question: 'Which path?', options: [{ id: 'inspect', label: 'Inspect timing', tradeoff: 'Takes time, tests the cause' }, { id: 'reload', label: 'Reload', tradeoff: 'Fast, does not establish the cause' }] })));
  expect(JSON.stringify(result)).toContain('inspect');
  expect(getCoevolutionTask(root, task.id)!.version).toBe(savedVersion);
});

it('does not claim a later canvas choice was delivered after an unrecognized human answer ended the tool', async () => {
  const task = createCoevolutionTask(root, { requestId: 'custom-task', title: 'Custom choice', goal: 'Let the person suggest a different path', mode: 'together' });
  const prepared = prepareCoevolutionTaskRun(root, task.id, { version: task.version, requestId: 'custom-prepare' });
  consumeCoevolutionDraft(root, { prompt: prepared.draft.prompt, chatSessionId: 'custom-chat' });
  const run = startAgentRun({ chatSessionId: 'custom-chat', agentKind: 'mindos-main', runtimeId: 'mindos', displayName: 'MindOS', permissionMode: 'ask', inputSummary: prepared.draft.prompt });
  const tool = createCoevolutionTools({ getMindRoot: () => root }).find(item => item.name === 'echo_decide')!;
  await runWithAgentRunContext({ parentRunId: run.id, chatSessionId: 'custom-chat' }, () => runWithAskUserQuestionBridge({ runId: 'custom-bridge', send: event => {
    if (event.type !== 'user_question_start') return;
    answerAskUserQuestion({ runId: event.runId, toolCallId: event.toolCallId, answers: event.questions.map((question, index) => ({ questionIndex: index, question: question.question, kind: 'custom', answer: ['A completely different path', 'Something changes', '50%'][index]! })) });
  } }, () => tool.execute('custom-tool', { question: 'Which path?', options: [{ id: 'inspect', label: 'Inspect timing', tradeoff: 'Takes time' }, { id: 'reload', label: 'Reload', tradeoff: 'Fast' }] })));
  const current = getCoevolutionTask(root, task.id)!;
  const chosen = updateCoevolutionTask(root, task.id, { version: current.version, requestId: 'later-choice', action: 'choose-decision', decisionId: current.decisions[0]!.id, optionId: 'inspect', prediction: 'See ordering', confidence: 50 });
  expect(resolveCoevolutionDecisionBridge(chosen, chosen.decisions[0]!.id).status).toBe('not-waiting');
});


it('verifies an observation beyond the ledger summary using the completed run capsule', async () => {
  let task = createCoevolutionTask(root, { requestId: 'long-output-task', title: 'Long output', goal: 'Review the final observation', mode: 'together' });
  const prepared = prepareCoevolutionTaskRun(root, task.id, { version: task.version, requestId: 'long-prepare' });
  task = consumeCoevolutionDraft(root, { prompt: prepared.draft.prompt, chatSessionId: 'long-chat' })!;
  task = updateCoevolutionTask(root, task.id, { version: task.version, requestId: 'long-decision', action: 'add-decision', question: 'Which approach?', options: [{ id: 'a', label: 'A', tradeoff: 'Faster' }, { id: 'b', label: 'B', tradeoff: 'Broader' }] });
  task = updateCoevolutionTask(root, task.id, { version: task.version, requestId: 'long-choice', action: 'choose-decision', decisionId: 'decision-1', optionId: 'a', prediction: 'The result will name its limits', confidence: 60 });
  const run = startAgentRun({ chatSessionId: 'long-chat', agentKind: 'mindos-main', runtimeId: 'mindos', displayName: 'MindOS', permissionMode: 'ask' });
  createAgentRunCapsule(root, { id: run.id, runId: run.id, rootRunId: run.id, chatSessionId: 'long-chat', source: 'interactive', request: { messages: [], runtime: { kind: 'mindos', id: 'mindos', name: 'MindOS' }, context: { attachedFiles: [], uploadedFiles: [], receiptIds: [], assetIds: [] } } });
  const quote = 'The final observation names the unresolved tradeoff precisely.';
  const tool = createCoevolutionTools({ getMindRoot: () => root }).find(t => t.name === 'echo_observe')!;
  await runWithAgentRunContext({ parentRunId: run.id, chatSessionId: 'long-chat' }, () => tool.execute('long-observe', { decisionId: 'decision-1', observation: 'The final result includes its limits', quote }));
  const output = 'Detailed background. '.repeat(1000) + quote;
  const completed = completeAgentRun(run.id, { outputSummary: output });
  expect(completed?.outputSummary).not.toContain(quote);
  finalizeAgentRunCapsule(root, run.id, { status: 'completed', outputText: output });
  await finalizeCoevolutionObservations(root, run.id);
  const saved = getCoevolutionTask(root, task.id)!;
  expect(saved.decisions[0].outcome?.evidence.quote).toBe(quote);
  expect(saved.runs[0].output).toContain(quote);
  expect(saved.runs[0].output.length).toBeGreaterThan(12000);
});
