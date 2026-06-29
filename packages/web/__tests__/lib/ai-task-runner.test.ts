import { describe, expect, it, vi } from 'vitest';
import { AiTaskRunner, type AiTaskDefinition } from '@/lib/ai/ai-task-runner';

type TestInput = { value: string };
type TestOutput = { answer: string };

const task: AiTaskDefinition<TestInput, TestOutput> = {
  id: 'test.structured',
  mode: 'structured',
  promptVersion: 'test-v1',
  modelProfile: 'fast-structured',
  policy: {
    tools: 'none',
    sideEffects: 'none',
    maxSteps: 1,
  },
  buildMessages(input) {
    return [
      { role: 'system', content: 'Return JSON.' },
      { role: 'user', content: input.value },
    ];
  },
  validateOutput(output) {
    if (!output || typeof output !== 'object' || typeof (output as { answer?: unknown }).answer !== 'string') {
      throw new Error('invalid output');
    }
    return output as TestOutput;
  },
};

describe('AiTaskRunner', () => {
  it('runs a tool-free structured task and parses fenced JSON', async () => {
    const completeText = vi.fn(async () => ({
      text: '```json\n{"answer":"ok"}\n```',
      model: { provider: 'test-provider', name: 'test-model' },
    }));
    const runner = new AiTaskRunner({ completeText });

    const result = await runner.run(task, { value: 'hello' });

    expect(completeText).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'test.structured',
      promptVersion: 'test-v1',
      modelProfile: 'fast-structured',
      messages: [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: 'hello' },
      ],
    }));
    expect(result.output).toEqual({ answer: 'ok' });
    expect(result).toMatchObject({
      taskId: 'test.structured',
      promptVersion: 'test-v1',
      model: { provider: 'test-provider', name: 'test-model' },
    });
    expect(result.trace.inputHash).toHaveLength(64);
    expect(result.trace.outputHash).toHaveLength(64);
  });

  it('rejects agent-mode tasks so tool loops stay out of structured extraction', async () => {
    const runner = new AiTaskRunner({
      completeText: vi.fn(async () => ({
        text: '{"answer":"ok"}',
        model: { provider: 'test', name: 'test' },
      })),
    });

    await expect(runner.run({
      ...task,
      mode: 'agent',
    }, { value: 'hello' })).rejects.toThrow('does not execute agent-mode tasks');
  });
});
