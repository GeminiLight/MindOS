import type {
  AgentRuntimeCompatibilityScenario,
  AgentRuntimeDescriptor,
  AgentRuntimeHarnessCapabilities,
} from './registry.js';
import type {
  MindosSkillRuntimeKindRequirement,
  MindosSkillRuntimeRequirements,
  MindosSkillRuntimeToolRequirement,
} from './skill-runtime-requirements.js';

export type MindosSkillRuntimeMatchLevel = 'ready' | 'limited' | 'blocked' | 'unknown';

export type MindosSkillRuntimeMatchReasonStatus =
  | 'satisfied'
  | 'limited'
  | 'missing'
  | 'unknown'
  | 'not-applicable';

export type MindosSkillRuntimeMatchReason = {
  id: string;
  status: MindosSkillRuntimeMatchReasonStatus;
  summary: string;
};

export type MindosSkillRuntimeMatch = {
  schemaVersion: 1;
  level: MindosSkillRuntimeMatchLevel;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeDescriptor['kind'];
  skillName: string;
  declared: boolean;
  scenario: AgentRuntimeCompatibilityScenario;
  reasons: MindosSkillRuntimeMatchReason[];
  blockers?: string[];
  notes?: string[];
};

export type MindosSkillRuntimeMatchInput = {
  skill: {
    name: string;
    runtimeRequirements: MindosSkillRuntimeRequirements;
  };
  runtime: AgentRuntimeDescriptor;
  scenario?: AgentRuntimeCompatibilityScenario;
};

export function evaluateSkillRuntimeMatch(input: MindosSkillRuntimeMatchInput): MindosSkillRuntimeMatch {
  const scenario = input.scenario ?? 'interactive-turn';
  const requirements = input.skill.runtimeRequirements;
  const reasons: MindosSkillRuntimeMatchReason[] = [];
  const blockers: string[] = [];
  let unknown = false;
  let limited = false;

  const addReason = (reason: MindosSkillRuntimeMatchReason, blocker?: string): void => {
    reasons.push(reason);
    if (reason.status === 'missing' && blocker) blockers.push(blocker);
    if (reason.status === 'unknown') unknown = true;
  };
  const addLimited = (): void => {
    limited = true;
  };

  if (input.runtime.status !== 'available') {
    addReason({
      id: 'runtime-available',
      status: 'missing',
      summary: `${input.runtime.name} is ${input.runtime.status}, so this skill cannot run there yet.`,
    }, 'runtime-unavailable');
  } else {
    addReason({
      id: 'runtime-available',
      status: 'satisfied',
      summary: `${input.runtime.name} is available.`,
    });
  }

  if (!requirements.declared) {
    addReason({
      id: 'skill-requirements-declared',
      status: 'unknown',
      summary: 'The skill has not declared runtime requirements, so MindOS cannot prove it is safe for automatic routing.',
    });
  } else {
    addReason({
      id: 'skill-requirements-declared',
      status: 'satisfied',
      summary: 'The skill declares machine-readable runtime requirements.',
    });
  }

  evaluateRuntimeKinds(requirements.runtimeKinds, input.runtime, addReason);
  evaluateRuntimeScenario(scenario, input.runtime, addReason, addLimited);
  evaluateRequiredTools(requirements.requiredTools, input.runtime.harnessCapabilities, addReason);
  evaluateRequiredCapabilities(requirements.requiredCapabilities, input.runtime, addReason);
  evaluateApprovalRequirement(requirements.approvals, input.runtime, scenario, addReason, addLimited);
  evaluateUserInputRequirement(requirements.userInput, input.runtime, scenario, addReason);
  evaluateScenarioSafety(requirements, scenario, addReason, addLimited);

  const level = blockers.length > 0
    ? 'blocked'
    : unknown
      ? 'unknown'
      : limited
        ? 'limited'
        : 'ready';

  return {
    schemaVersion: 1,
    level,
    runtimeId: input.runtime.runtimeId ?? input.runtime.id,
    runtimeName: input.runtime.name,
    runtimeKind: input.runtime.kind,
    skillName: input.skill.name,
    declared: requirements.declared,
    scenario,
    reasons,
    ...(blockers.length > 0 ? { blockers: unique(blockers) } : {}),
    ...(requirements.notes.length > 0 ? { notes: requirements.notes } : {}),
  };
}

function evaluateRuntimeKinds(
  runtimeKinds: MindosSkillRuntimeKindRequirement[],
  runtime: AgentRuntimeDescriptor,
  addReason: (reason: MindosSkillRuntimeMatchReason, blocker?: string) => void,
): void {
  if (runtimeKinds.length === 0 || runtimeKinds.includes('any')) {
    addReason({
      id: 'runtime-kind',
      status: 'not-applicable',
      summary: 'The skill does not restrict runtime kind.',
    });
    return;
  }

  if (runtimeKinds.some((kind) => runtimeKindMatches(kind, runtime))) {
    addReason({
      id: 'runtime-kind',
      status: 'satisfied',
      summary: `The skill allows ${runtime.kind} runtimes.`,
    });
    return;
  }

  addReason({
    id: 'runtime-kind',
    status: 'missing',
    summary: `The skill allows ${runtimeKinds.join(', ')} runtimes, but ${runtime.name} is ${runtime.kind}.`,
  }, 'runtime-kind');
}

function runtimeKindMatches(kind: MindosSkillRuntimeKindRequirement, runtime: AgentRuntimeDescriptor): boolean {
  if (kind === 'any') return true;
  if (kind === 'native') return runtime.category === 'native' || runtime.kind === 'codex' || runtime.kind === 'claude';
  return runtime.kind === kind;
}

function evaluateRuntimeScenario(
  scenario: AgentRuntimeCompatibilityScenario,
  runtime: AgentRuntimeDescriptor,
  addReason: (reason: MindosSkillRuntimeMatchReason, blocker?: string) => void,
  addLimited: () => void,
): void {
  const assessment = runtime.compatibility.scenarios[scenario];
  if (!assessment) {
    addReason({
      id: `runtime-scenario:${scenario}`,
      status: 'unknown',
      summary: `${runtime.name} has not declared compatibility for ${scenario}.`,
    });
    return;
  }

  if (assessment.level === 'ready') {
    addReason({
      id: `runtime-scenario:${scenario}`,
      status: 'satisfied',
      summary: `${runtime.name} declares ${scenario} as ready.`,
    });
    return;
  }

  if (assessment.level === 'limited') {
    addLimited();
    addReason({
      id: `runtime-scenario:${scenario}`,
      status: 'limited',
      summary: `${runtime.name} declares ${scenario} as limited: ${assessment.summary}`,
    });
    return;
  }

  if (assessment.level === 'blocked') {
    addReason({
      id: `runtime-scenario:${scenario}`,
      status: 'missing',
      summary: `${runtime.name} declares ${scenario} as blocked: ${assessment.summary}`,
    }, `runtime-scenario:${scenario}`);
    return;
  }

  addReason({
    id: `runtime-scenario:${scenario}`,
    status: 'unknown',
    summary: `${runtime.name} declares ${scenario} as unknown: ${assessment.summary}`,
  });
}

function evaluateRequiredTools(
  requiredTools: MindosSkillRuntimeToolRequirement[],
  harnessCapabilities: AgentRuntimeHarnessCapabilities | undefined,
  addReason: (reason: MindosSkillRuntimeMatchReason, blocker?: string) => void,
): void {
  if (requiredTools.length === 0) {
    addReason({
      id: 'required-tools',
      status: 'not-applicable',
      summary: 'The skill does not require specific runtime tools.',
    });
    return;
  }

  if (!harnessCapabilities) {
    addReason({
      id: 'required-tools',
      status: 'unknown',
      summary: 'The runtime has not declared harness tool capabilities.',
    });
    return;
  }

  for (const tool of requiredTools) {
    const hasTool = harnessCapabilities.tools.includes(tool);
    addReason({
      id: `tool:${tool}`,
      status: hasTool ? 'satisfied' : 'missing',
      summary: hasTool
        ? `${tool} tool is available in this runtime harness.`
        : `${tool} tool is required by the skill but not available in this runtime harness.`,
    }, hasTool ? undefined : `tool:${tool}`);
  }
}

function evaluateRequiredCapabilities(
  requiredCapabilities: string[],
  runtime: AgentRuntimeDescriptor,
  addReason: (reason: MindosSkillRuntimeMatchReason, blocker?: string) => void,
): void {
  if (requiredCapabilities.length === 0) {
    addReason({
      id: 'required-capabilities',
      status: 'not-applicable',
      summary: 'The skill does not require named runtime capabilities.',
    });
    return;
  }

  for (const capability of requiredCapabilities) {
    const status = evaluateKnownCapability(capability, runtime);
    addReason({
      id: `capability:${capability}`,
      status,
      summary: capabilitySummary(capability, status),
    }, status === 'missing' ? `capability:${capability}` : undefined);
  }
}

function evaluateKnownCapability(
  capability: string,
  runtime: AgentRuntimeDescriptor,
): MindosSkillRuntimeMatchReasonStatus {
  const harness = runtime.harnessCapabilities;
  switch (capability) {
    case 'artifact-output':
      return harness?.output.includes('artifact') ? 'satisfied' : harness ? 'missing' : 'unknown';
    case 'diff-output':
      return harness?.output.includes('diff') ? 'satisfied' : harness ? 'missing' : 'unknown';
    case 'branch-output':
      return harness?.output.includes('branch') ? 'satisfied' : harness ? 'missing' : 'unknown';
    case 'pr-output':
      return harness?.output.includes('pr') ? 'satisfied' : harness ? 'missing' : 'unknown';
    case 'checkpoint-output':
      return harness?.output.includes('checkpoint') ? 'satisfied' : harness ? 'missing' : 'unknown';
    case 'approval-routing':
      return runtime.capabilities.supportsApprovals || runtime.compatibility.scenarios['permission-governance']?.level === 'ready'
        ? 'satisfied'
        : 'missing';
    case 'mcp-config':
      return runtime.capabilities.supportsMcpConfig || Boolean(harness?.tools.includes('mcp')) ? 'satisfied' : 'missing';
    case 'user-input':
      return runtime.capabilities.supportsUserInput || Boolean(harness?.eventStream.includes('user-input')) ? 'satisfied' : 'missing';
    case 'background-runs':
      return runtime.capabilities.supportsBackgroundRuns ? 'satisfied' : 'missing';
    case 'tool-events':
      return runtime.capabilities.supportsToolEvents || Boolean(harness?.eventStream.includes('tool-events')) ? 'satisfied' : 'missing';
    case 'runtime-status':
      return runtime.capabilities.supportsRuntimeStatus || Boolean(harness?.eventStream.includes('runtime-status')) ? 'satisfied' : 'missing';
    case 'session-resume':
      return runtime.capabilities.supportsResume ? 'satisfied' : 'missing';
    case 'fresh-session':
      return runtime.capabilities.supportsFreshSession ? 'satisfied' : 'missing';
    default:
      return 'unknown';
  }
}

function capabilitySummary(capability: string, status: MindosSkillRuntimeMatchReasonStatus): string {
  if (status === 'satisfied') return `${capability} is satisfied by this runtime descriptor.`;
  if (status === 'missing') return `${capability} is required by the skill but missing from this runtime descriptor.`;
  return `${capability} is not a known MindOS runtime capability yet, so the matcher cannot prove it.`;
}

function evaluateApprovalRequirement(
  approvals: MindosSkillRuntimeRequirements['approvals'],
  runtime: AgentRuntimeDescriptor,
  scenario: AgentRuntimeCompatibilityScenario,
  addReason: (reason: MindosSkillRuntimeMatchReason, blocker?: string) => void,
  addLimited: () => void,
): void {
  if (approvals === 'not-required') {
    addReason({
      id: 'approval-requirement',
      status: 'satisfied',
      summary: 'The skill declares that runtime approvals are not required.',
    });
    return;
  }

  if (approvals === 'unknown') {
    addReason({
      id: 'approval-requirement',
      status: 'unknown',
      summary: 'The skill has not declared whether runtime approvals are required.',
    });
    return;
  }

  const permissionGovernance = runtime.compatibility.scenarios['permission-governance']?.level;
  const hasInteractiveApprovalRoute = runtime.capabilities.supportsApprovals || permissionGovernance === 'ready' || permissionGovernance === 'limited';
  if (scenario !== 'unattended-automation' && hasInteractiveApprovalRoute) {
    addReason({
      id: 'approval-requirement',
      status: 'satisfied',
      summary: 'The runtime has an interactive approval or permission governance route.',
    });
    return;
  }

  if (scenario === 'unattended-automation') {
    const unattended = runtime.compatibility.scenarios['unattended-automation'];
    const approvalRouting = unattended?.requirements.some((requirement) => (
      requirement.id === 'approval-routing' &&
      (requirement.status === 'satisfied' || requirement.status === 'external')
    )) ?? false;
    if (approvalRouting) {
      addReason({
        id: 'approval-requirement',
        status: 'satisfied',
        summary: 'The unattended scenario has an approval routing contract.',
      });
      return;
    }
    addReason({
      id: 'approval-requirement',
      status: 'missing',
      summary: 'The skill requires approvals, but unattended approval routing is not available yet.',
    }, 'approval-routing');
    return;
  }

  addLimited();
  addReason({
    id: 'approval-requirement',
    status: 'missing',
    summary: 'The skill requires approvals, but this runtime does not expose approval or permission governance.',
  }, 'approval-routing');
}

function evaluateUserInputRequirement(
  userInput: MindosSkillRuntimeRequirements['userInput'],
  runtime: AgentRuntimeDescriptor,
  scenario: AgentRuntimeCompatibilityScenario,
  addReason: (reason: MindosSkillRuntimeMatchReason, blocker?: string) => void,
): void {
  if (userInput === 'not-required') {
    addReason({
      id: 'user-input-requirement',
      status: 'satisfied',
      summary: 'The skill declares that user input is not required after launch.',
    });
    return;
  }

  if (userInput === 'unknown') {
    addReason({
      id: 'user-input-requirement',
      status: 'unknown',
      summary: 'The skill has not declared whether user input is required after launch.',
    });
    return;
  }

  if (scenario === 'unattended-automation') {
    addReason({
      id: 'user-input-requirement',
      status: 'missing',
      summary: 'The skill requires user input, so it is not safe for unattended automation.',
    }, 'user-input-required');
    return;
  }

  const hasUserInput = runtime.capabilities.supportsUserInput || Boolean(runtime.harnessCapabilities?.eventStream.includes('user-input'));
  addReason({
    id: 'user-input-requirement',
    status: hasUserInput ? 'satisfied' : 'missing',
    summary: hasUserInput
      ? 'The runtime supports interactive user input.'
      : 'The skill requires user input, but this runtime does not expose a user-input event route.',
  }, hasUserInput ? undefined : 'user-input');
}

function evaluateScenarioSafety(
  requirements: MindosSkillRuntimeRequirements,
  scenario: AgentRuntimeCompatibilityScenario,
  addReason: (reason: MindosSkillRuntimeMatchReason, blocker?: string) => void,
  addLimited: () => void,
): void {
  if (scenario === 'remote-control') {
    if (requirements.remote === 'safe') {
      addReason({
        id: 'remote-safety',
        status: 'satisfied',
        summary: 'The skill declares remote control as safe.',
      });
      return;
    }
    if (requirements.remote === 'unsafe') {
      addReason({
        id: 'remote-safety',
        status: 'missing',
        summary: 'The skill declares remote control as unsafe.',
      }, 'remote-unsafe');
      return;
    }
    addLimited();
    addReason({
      id: 'remote-safety',
      status: 'unknown',
      summary: 'The skill has not declared whether remote control is safe.',
    });
    return;
  }

  if (scenario === 'unattended-automation') {
    if (requirements.unattended === 'safe') {
      addReason({
        id: 'unattended-safety',
        status: 'satisfied',
        summary: 'The skill declares unattended automation as safe.',
      });
      return;
    }
    if (requirements.unattended === 'unsafe') {
      addReason({
        id: 'unattended-safety',
        status: 'missing',
        summary: 'The skill declares unattended automation as unsafe.',
      }, 'unattended-unsafe');
      return;
    }
    addLimited();
    addReason({
      id: 'unattended-safety',
      status: 'unknown',
      summary: 'The skill has not declared whether unattended automation is safe.',
    });
    return;
  }

  addReason({
    id: 'scenario-safety',
    status: 'not-applicable',
    summary: `${scenario} does not require remote or unattended safety metadata.`,
  });
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
