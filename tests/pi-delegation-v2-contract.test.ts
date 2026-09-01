import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

describe('Pi delegation v2 contract', () => {
  it('uses workflowScript in the production subagent demo instead of emitting legacy tasks or chain input', () => {
    const demo = read('packages/web/app/dev/subagent-demo/page.tsx');

    expect(demo).toContain('workflowScript');
    expect(demo).toContain('runs.all');
    expect(demo).not.toMatch(/\b(?:tasks|chain)\s*:/);
  });

  it('keeps legacy delegation conversion isolated to the compatibility boundary', () => {
    const wrapper = read('packages/mindos/src/agent/subagent/subagent-ledger-extension.ts');
    const compatibility = read('packages/mindos/src/agent/subagent/pi-subagents-compat.ts');
    const prompt = read('packages/mindos/src/agent/prompt/agent-prompt.txt');
    const toolCallUi = read('packages/web/components/ask/ToolCallBlock.tsx');

    expect(wrapper).toContain("from './pi-subagents-compat.js'");
    expect(wrapper).not.toContain('function legacyParallelWorkflowScript');
    expect(wrapper).not.toContain('function legacyChainWorkflowScript');
    expect(compatibility).toContain('normalizeLegacySubagentExecutionParams');
    expect(compatibility).toContain('return runs.all');
    expect(prompt).toContain('Use direct `{ agent, task }` parameters for one bounded child.');
    expect(prompt).toContain('Use workflowScript for parallel or sequential orchestration');
    expect(toolCallUi).toContain('workflowScript');
    expect(toolCallUi).toContain('workflowScriptPath');
    expect(toolCallUi).toContain('input.workflow');
  });
});
