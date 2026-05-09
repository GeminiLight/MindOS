import { describe, expect, it } from 'vitest';
import { createMindosToolRegistry, defineMindosTool } from './tool/index.js';

describe('MindOS tool contract', () => {
  it('registers tools and prevents duplicate ids', async () => {
    const tool = defineMindosTool({
      id: 'echo',
      description: 'Echo input',
      async run(input: { text: string }) {
        return { ok: true, output: input.text };
      },
    });
    const registry = createMindosToolRegistry([tool]);

    await expect(registry.get('echo')?.run({ text: 'hi' }, {})).resolves.toEqual({ ok: true, output: 'hi' });
    expect(() => registry.register(tool)).toThrow('tool already registered');
  });
});
