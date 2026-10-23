import { afterEach, expect, it, vi } from 'vitest';
import { installKnowledgeAgentRunCapsuleReader } from '../agent-run-data.js';
import { coevolutionRunOutput } from './output.js';
const run = { id: 'r', chatSessionId: 's', runtimeId: 'mindos', status: 'completed' as const, startedAt: 1, outputSummary: 'Short summary' };
const capsule = { id: 'r', runId: 'r', chatSessionId: 's', status: 'completed' as const, request: { messages: [], runtime: { name: 'MindOS' } }, result: { outputText: 'Full completed output' } };
afterEach(() => installKnowledgeAgentRunCapsuleReader(null));
it('uses bounded completed output and preserves summary redaction', () => {
  installKnowledgeAgentRunCapsuleReader(() => ({ ...capsule, result: { outputText: 'x'.repeat(18000) + ' token=private-value\nFinal evidence' } }));
  const output = coevolutionRunOutput('/mind', run);
  expect(output).toContain('Final evidence');
  expect(output).toContain('token=[redacted]');
  expect(output).not.toContain('private-value');
});
it.each([{ runId: 'another' }, { chatSessionId: 'another' }, { status: 'running' as const }])('does not trust a mismatched or unfinished capsule: %j', patch => {
  installKnowledgeAgentRunCapsuleReader(() => ({ ...capsule, ...patch }));
  expect(coevolutionRunOutput('/mind', run)).toBe('Short summary');
});
it('falls back when no capsule is available and avoids reading unfinished runs', () => {
  const reader = vi.fn(() => { throw new Error('Unavailable'); });
  installKnowledgeAgentRunCapsuleReader(reader);
  expect(coevolutionRunOutput('/mind', { ...run, status: 'running' })).toBe('Short summary');
  expect(reader).not.toHaveBeenCalled();
  expect(coevolutionRunOutput('/mind', run)).toBe('Short summary');
  installKnowledgeAgentRunCapsuleReader(() => null);
  expect(coevolutionRunOutput('/mind', run)).toBe('Short summary');
});
