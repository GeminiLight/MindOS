import { describe, expect, it, vi } from 'vitest';
import type { CoevolutionTask } from '../../knowledge/coevolution/model.js';
import { createCoevolutionTools, finalizeCoevolutionObservations, type CoevolutionToolServices } from './coevolution-tools.js';

function fixture() {
  const task = { id: 'coevolution-123456789012345678901234', version: 1, archived: false, chatSessionId: 'chat-1', decisions: [], corrections: [], agreements: [] } as unknown as CoevolutionTask;
  const run = { id: 'run-1', chatSessionId: 'chat-1', permissionMode: 'ask', status: 'running', metadata: {} };
  const services = {
    context: () => ({ chatSessionId: 'chat-1', parentRunId: 'run-1' }),
    hasQuestionBridge: () => true,
    ask: vi.fn(async () => ({ cancelled: false, answers: [
      { questionIndex: 0, kind: 'option', answer: 'Keep the evidence' },
      { questionIndex: 1, kind: 'custom', answer: 'The proposal will be shorter but traceable' },
      { questionIndex: 2, kind: 'option', answer: '75%' },
    ] })),
    find: vi.fn(() => task), get: vi.fn(() => task),
    suggest: vi.fn(async (_root, _id, command) => ({ ...task, version: 2, decisions: [{ id: 'decision-1', ...command }] })),
    update: vi.fn(async (_root, _id, command) => ({ ...task, version: 3, command })),
    getRun: vi.fn(() => run),
    updateRun: vi.fn((_id, patch) => { Object.assign(run, { metadata: { ...run.metadata, ...patch.metadata } }); return run; }),
    event: vi.fn(),
    suggestInquiry: vi.fn(async () => ({ id: 'inquiry-1' })),
  } as unknown as CoevolutionToolServices;
  const tools = createCoevolutionTools({ getMindRoot: () => '/private' }, services);
  return { services, task, run, call: (name: string, params: unknown, signal?: AbortSignal) => tools.find(tool => tool.name === name)!.execute('tool-1', params, signal) };
}
const decision = { question: 'Which proposal should we deliver?', options: [
  { id: 'evidence', label: 'Keep the evidence', tradeoff: 'Shorter, with fewer promises' },
  { id: 'ambition', label: 'Keep every promise', tradeoff: 'Longer and not all claims can be checked' },
] };
const text = (result: Awaited<ReturnType<ReturnType<typeof fixture>['call']>>) => result.content.map(part => part.type === 'text' ? part.text : '').join('');

describe('real collaboration tools', () => {
  it('saves a disagreement only as a reviewable draft rather than committing human views', async () => {
    const f = fixture();
    const draft = { question: 'Is a high score enough?', explanationA: 'The score represents quality', explanationB: 'Held-out failures may be hidden', distinction: 'Inspect held-out failures', capability: 'Judge evidence' };
    expect(text(await f.call('echo_suggest', { kind: 'inquiry', ...draft }))).toContain('awaiting human review');
    expect(f.services.suggestInquiry).toHaveBeenCalledWith('/private', f.task.id, expect.objectContaining({ ...draft }), expect.objectContaining({ runId: 'run-1' }));
    expect(f.services.update).not.toHaveBeenCalled();
  });
  it('names missing conditional fields so the model can repair a rejected suggestion', async () => {
    const f=fixture();
    const result=text(await f.call('echo_suggest',{kind:'correction',before:'Original',after:'Human correction',scope:'This task'}));
    expect(result).toContain('behavior');expect(result).toContain('check');expect(f.services.suggest).not.toHaveBeenCalled();
  });
  it('uses provider-compatible object schemas at the root of every tool', () => {
    for (const tool of createCoevolutionTools({ getMindRoot: () => '/private' })) {
      expect(tool.parameters).toMatchObject({ type: 'object', properties: expect.any(Object) });
    }
  });
  it('records an Agent proposal then waits for actual human choice and prediction', async () => {
    const f = fixture();
    const result = await f.call('echo_decide', decision);
    expect(f.services.suggest).toHaveBeenCalledWith('/private', f.task.id, expect.objectContaining({ action: 'add-decision', ...decision }), { runId: 'run-1', chatSessionId: 'chat-1' });
    expect(f.services.ask).toHaveBeenCalledOnce();
    expect(f.services.update).toHaveBeenCalledWith('/private', f.task.id, expect.objectContaining({ action: 'choose-decision', optionId: 'evidence', prediction: 'The proposal will be shorter but traceable', confidence: 75 }));
    expect(text(result)).toContain('evidence');
  });
  it('keeps an unanswered decision open when the user cancels; no default choice or execution instruction is invented', async () => {
    const f = fixture(); vi.mocked(f.services.ask).mockResolvedValue({ cancelled: true, answers: [], error: 'aborted' });
    const result = await f.call('echo_decide', decision);
    expect(f.services.update).not.toHaveBeenCalled();
    expect(text(result)).toContain('not chosen');
  });
  it.each(['read', 'unbound', 'no-bridge'])('refuses mutation in the %s boundary', async kind => {
    const f = fixture();
    if (kind === 'read') f.run.permissionMode = 'read';
    if (kind === 'unbound') vi.mocked(f.services.find).mockReturnValue(null);
    if (kind === 'no-bridge') f.services.hasQuestionBridge = () => false;
    expect(text(await f.call('echo_decide', decision))).toContain('Error:');
    expect(f.services.suggest).not.toHaveBeenCalled();
  });
  it('rejects invalid or duplicate alternatives before opening a question', async () => {
    const f = fixture();
    expect(text(await f.call('echo_decide', { ...decision, options: [decision.options[0], decision.options[0]] }))).toContain('Error:');
    expect(f.services.ask).not.toHaveBeenCalled();
  });
  it('offers rules only as reviewable drafts and never lets a tool confirm them', async () => {
    const f = fixture();
    await f.call('echo_suggest', { kind: 'correction', before: 'Will ship in May', after: 'Targeting May, pending validation', behavior: 'Qualify unverified dates', scope: 'Proposals', check: 'Every date has a source' });
    expect(f.services.suggest).toHaveBeenCalledWith('/private', f.task.id, expect.objectContaining({ action: 'draft-correction' }), expect.anything());
    expect(text(await f.call('echo_suggest', { kind: 'confirm-correction', correctionId: 'one' }))).toContain('Error:');
    expect(f.services.update).not.toHaveBeenCalled();
  });
  it('queues feedback until the actual run finishes and accepts only the completed run evidence', async () => {
    const f = fixture();
    f.task.decisions.push({ id: 'decision-1', choice: { optionId: 'evidence' } } as never);
    expect(text(await f.call('echo_observe', { decisionId: 'decision-1', observation: 'Claim removed', quote: 'The unsupported date was removed.' }))).toContain('pending');
    expect(f.services.update).not.toHaveBeenCalled();
    await finalizeCoevolutionObservations('/private', 'run-1', f.services);
    expect(f.services.update).not.toHaveBeenCalled();
    f.run.status = 'completed';
    await finalizeCoevolutionObservations('/private', 'run-1', f.services);
    expect(f.services.update).toHaveBeenCalledWith('/private', f.task.id, expect.objectContaining({ action: 'observe-decision', evidence: { kind: 'run', runId: 'run-1', quote: 'The unsupported date was removed.' } }));
  });
  it('keeps failed evidence unverified and does not turn a completed task into an error', async () => {
    const f = fixture(); f.task.decisions.push({ id: 'decision-1', choice: { optionId: 'evidence' } } as never);
    await f.call('echo_observe', { decisionId: 'decision-1', observation: 'Claim removed', quote: 'A missing quotation.' });
    f.run.status = 'completed'; vi.mocked(f.services.update).mockRejectedValue(new Error('Quote is absent from the completed run.'));
    await expect(finalizeCoevolutionObservations('/private', 'run-1', f.services)).resolves.toBeUndefined();
    expect(f.services.event).toHaveBeenCalledWith('run-1', expect.objectContaining({ type: 'status', message: expect.stringContaining('not verified') }));
  });
  it('does not fail a completed run when feedback storage and its warning ledger are unavailable', async () => {
    const f = fixture(); f.task.decisions.push({ id: 'decision-1', choice: { optionId: 'evidence' } } as never);
    await f.call('echo_observe', { decisionId: 'decision-1', observation: 'Claim removed', quote: 'Actual output.' });
    f.run.status = 'completed';
    vi.mocked(f.services.update).mockRejectedValue(new Error('Storage unavailable'));
    vi.mocked(f.services.event).mockImplementation(() => { throw new Error('Ledger unavailable'); });
    await expect(finalizeCoevolutionObservations('/private', 'run-1', f.services)).resolves.toBeUndefined();
    vi.mocked(f.services.getRun).mockImplementation(() => { throw new Error('Ledger unavailable'); });
    await expect(finalizeCoevolutionObservations('/private', 'run-1', f.services)).resolves.toBeUndefined();
  });
});
