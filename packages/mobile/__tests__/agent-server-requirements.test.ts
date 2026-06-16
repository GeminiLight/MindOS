import { describe, expect, it } from 'vitest';
import {
  AGENT_SERVER_REQUIREMENTS,
  buildAgentServerRequirementsContract,
  formatAgentServerRequirementsContract,
  summarizeAgentServerRequirements,
} from '@/lib/agent-server-requirements';

describe('agent server requirements contract', () => {
  it('lists the server contracts needed for real mobile agent control', () => {
    expect(AGENT_SERVER_REQUIREMENTS.map((requirement) => requirement.id)).toEqual([
      'agent-tasks',
      'runtime-permissions',
      'user-questions',
      'native-sessions',
      'run-tree',
    ]);

    expect(AGENT_SERVER_REQUIREMENTS.find((requirement) => requirement.id === 'runtime-permissions'))
      .toMatchObject({
        title: 'Runtime permission queue',
        requiredCapabilities: expect.arrayContaining([
          'runtimePermissions.pending',
          'runtimePermissions.resolve',
        ]),
      });
  });

  it('builds a copyable contract without pretending mobile can submit server work', () => {
    const contract = buildAgentServerRequirementsContract();

    expect(contract).toMatchObject({
      version: 1,
      mobileSurface: 'agent-runs',
      mobileCanSubmit: false,
    });
    expect(contract.requirements).toHaveLength(5);
    expect(contract.requirements[0].requiredEndpoints).toContain('POST /api/agent-tasks');
    expect(contract.note).toContain('runtime ownership');
  });

  it('summarizes unique endpoints and capabilities for compact mobile UI', () => {
    expect(summarizeAgentServerRequirements()).toEqual({
      requirementCount: 5,
      endpointCount: 13,
      capabilityCount: 16,
    });
  });

  it('formats valid JSON for clipboard handoff', () => {
    const formatted = formatAgentServerRequirementsContract();
    const parsed = JSON.parse(formatted);

    expect(parsed.requirements.map((requirement: { id: string }) => requirement.id)).toContain('run-tree');
    expect(formatted).toContain('\n  "mobileCanSubmit": false');
  });
});
