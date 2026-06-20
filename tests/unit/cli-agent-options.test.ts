import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  combineTaskAndStdin,
  normalizeAgentInvocation,
  prepareAgentInvocation,
  readStdinIfPiped,
} from '../../packages/mindos/bin/lib/agent-options.js';

describe('CLI agent option normalization', () => {
  it('splits @file attachments from task text and keeps --file attachments', () => {
    expect(normalizeAgentInvocation(['@notes/today.md', 'summarize', 'this'], {
      file: 'refs/project.md',
    })).toMatchObject({
      taskArgs: ['summarize', 'this'],
      attachedFiles: ['notes/today.md', 'refs/project.md'],
    });
  });

  it('maps provider, model, permission, thinking, and cwd into ask request options', () => {
    const cwd = path.resolve('packages/mindos');
    expect(normalizeAgentInvocation(['review'], {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      readonly: true,
      thinking: '8000',
      cwd: 'packages/mindos',
      'max-steps': '7',
    })).toMatchObject({
      taskArgs: ['review'],
      maxSteps: 7,
      providerOverride: 'anthropic',
      modelOverride: 'claude-sonnet-4-20250514',
      runtimeOptions: {
        permissionMode: 'readonly',
        modelOverride: 'claude-sonnet-4-20250514',
        reasoningEffort: 'medium',
      },
      agentOptions: {
        enableThinking: true,
        thinkingBudget: 8000,
      },
      workDir: {
        source: 'manual',
        path: cwd,
        label: 'mindos',
      },
    });
  });

  it('supports disabling thinking for one request even when settings enable it', () => {
    expect(normalizeAgentInvocation(['answer'], { 'no-thinking': true })).toMatchObject({
      agentOptions: { enableThinking: false },
    });

    expect(normalizeAgentInvocation(['answer'], { thinking: 'off' })).toMatchObject({
      agentOptions: { enableThinking: false },
    });
  });

  it('combines explicit task text and piped stdin without losing either side', async () => {
    expect(combineTaskAndStdin(['summarize'], 'line one\nline two')).toBe(
      'summarize\n\nInput from stdin:\nline one\nline two',
    );

    await expect(prepareAgentInvocation(['summarize'], {}, { stdinText: 'draft' })).resolves.toMatchObject({
      message: 'summarize\n\nInput from stdin:\ndraft',
      hasMessage: true,
    });
  });

  it('does not hang forever on an open non-tty stdin pipe with no data', async () => {
    const stream = new PassThrough();

    await expect(readStdinIfPiped(stream, { idleMs: 1 })).resolves.toBe('');

    stream.destroy();
  });
});
