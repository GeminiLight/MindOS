import { describe, expect, it } from 'vitest';
import { createAgentCapabilitiesServices } from '@/lib/agent/capability-registry';

describe('agent capability registry adapter', () => {
  it('discovers bundled pi-subagents without exposing system prompts', async () => {
    const services = createAgentCapabilitiesServices();
    const capabilities = await services.subagents?.();

    expect(capabilities?.some((capability) => capability.kind === 'pi-subagent' && capability.name === 'reviewer')).toBe(true);
    const serialized = JSON.stringify(capabilities);
    expect(serialized).not.toContain('systemPrompt');
    expect(serialized).not.toContain('You are a disciplined review subagent');
  });
});
