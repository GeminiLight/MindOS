export type MindosSkillRuntimeKindRequirement =
  | 'any'
  | 'mindos'
  | 'codex'
  | 'claude'
  | 'acp'
  | 'native';

export type MindosSkillRuntimeToolRequirement =
  | 'shell'
  | 'file'
  | 'git'
  | 'browser'
  | 'mcp'
  | 'plugins'
  | 'skills';

export type MindosSkillRuntimeSafety = 'safe' | 'unsafe' | 'unknown';

export type MindosSkillRuntimeNeed = 'required' | 'not-required' | 'unknown';

export type MindosSkillRuntimeRequirements = {
  schemaVersion: 1;
  /**
   * True only when the skill author declared at least one runtime requirement
   * frontmatter field. Undeclared skills remain loadable, but matchers must not
   * treat them as automatically safe for every runtime or unattended surface.
   */
  declared: boolean;
  runtimeKinds: MindosSkillRuntimeKindRequirement[];
  requiredTools: MindosSkillRuntimeToolRequirement[];
  requiredCapabilities: string[];
  remote: MindosSkillRuntimeSafety;
  unattended: MindosSkillRuntimeSafety;
  approvals: MindosSkillRuntimeNeed;
  userInput: MindosSkillRuntimeNeed;
  notes: string[];
};

export function emptySkillRuntimeRequirements(): MindosSkillRuntimeRequirements {
  return {
    schemaVersion: 1,
    declared: false,
    runtimeKinds: [],
    requiredTools: [],
    requiredCapabilities: [],
    remote: 'unknown',
    unattended: 'unknown',
    approvals: 'unknown',
    userInput: 'unknown',
    notes: [],
  };
}
