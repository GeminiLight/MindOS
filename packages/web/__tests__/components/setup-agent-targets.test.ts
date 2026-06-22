import { describe, expect, it } from 'vitest';
import { resolveSetupAgentTargets } from '@/components/setup/installTargets';
import type { AgentEntry } from '@/components/setup/types';

const agents: AgentEntry[] = [
  {
    key: 'claude-code',
    name: 'Claude Code',
    present: true,
    installed: false,
    hasProjectScope: false,
    hasGlobalScope: true,
    preferredTransport: 'stdio',
  },
  {
    key: 'cursor',
    name: 'Cursor',
    present: true,
    installed: true,
    hasProjectScope: false,
    hasGlobalScope: true,
    preferredTransport: 'http',
  },
  {
    key: 'windsurf',
    name: 'Windsurf',
    present: false,
    installed: false,
    hasProjectScope: false,
    hasGlobalScope: false,
    preferredTransport: 'stdio',
  },
];

describe('setup agent target resolution', () => {
  it('keeps Skill installation targets independent from the MCP toggle', () => {
    const targets = resolveSetupAgentTargets({
      agents,
      selectedAgents: new Set(['claude-code', 'cursor']),
      mcpEnabled: false,
    });

    expect(targets.skillAgentKeys).toEqual(['claude-code', 'cursor']);
    expect(targets.mcpAgentKeys).toEqual([]);
  });

  it('uses the same selected present agents for MCP when MCP is enabled', () => {
    const targets = resolveSetupAgentTargets({
      agents,
      selectedAgents: new Set(['claude-code', 'cursor', 'windsurf', 'missing']),
      mcpEnabled: true,
    });

    expect(targets.skillAgentKeys).toEqual(['claude-code', 'cursor']);
    expect(targets.mcpAgentKeys).toEqual(['claude-code', 'cursor']);
  });
});
