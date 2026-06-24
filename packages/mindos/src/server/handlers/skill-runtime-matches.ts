import {
  evaluateSkillRuntimeMatch,
  type MindosSkillRuntimeMatch,
} from '../../agent/runtime/skill-runtime-matcher.js';
import type {
  AgentRuntimeCompatibilityScenario,
  AgentRuntimeDescriptor,
} from '../../agent/runtime/registry.js';
import { json, type MindosServerResponse } from '../response.js';
import {
  collectSkillInfos,
  type MindosSkillInfo,
  type MindosSkillRoot,
} from './skills.js';

export type MindosSkillRuntimeMatchesPayload = {
  schemaVersion: 1;
  scenario: AgentRuntimeCompatibilityScenario;
  skills: Array<Pick<MindosSkillInfo, 'name' | 'description' | 'source' | 'origin' | 'path' | 'runtimeRequirements'>>;
  runtimes: Array<Pick<AgentRuntimeDescriptor, 'id' | 'runtimeId' | 'name' | 'kind' | 'category' | 'status'>>;
  matches: Record<string, Record<string, MindosSkillRuntimeMatch>>;
};

export type SkillRuntimeMatchesHandlerServices = {
  disabledSkills?: string[];
  skillRoots: MindosSkillRoot[];
  listRuntimes(): AgentRuntimeDescriptor[] | Promise<AgentRuntimeDescriptor[]>;
};

const VALID_SCENARIOS = new Set<AgentRuntimeCompatibilityScenario>([
  'interactive-turn',
  'coding-workflow',
  'session-continuity',
  'context-governance',
  'permission-governance',
  'mcp-tooling',
  'skill-execution',
  'artifact-governance',
  'remote-control',
  'unattended-automation',
  'team-coordination',
]);

export async function handleSkillRuntimeMatchesGet(
  searchParams: URLSearchParams,
  services: SkillRuntimeMatchesHandlerServices,
): Promise<MindosServerResponse<MindosSkillRuntimeMatchesPayload | { error: string }>> {
  const scenarioResult = parseScenario(searchParams.get('scenario'));
  if ('error' in scenarioResult) return json({ error: scenarioResult.error }, { status: 400 });

  try {
    const disabled = new Set(services.disabledSkills ?? []);
    const skills = collectSkillInfos(services.skillRoots, disabled);
    const runtimes = await services.listRuntimes();
    return json(
      buildSkillRuntimeMatchesPayload({ skills, runtimes, scenario: scenarioResult.scenario }),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export function buildSkillRuntimeMatchesPayload(input: {
  skills: MindosSkillInfo[];
  runtimes: AgentRuntimeDescriptor[];
  scenario: AgentRuntimeCompatibilityScenario;
}): MindosSkillRuntimeMatchesPayload {
  const matches: MindosSkillRuntimeMatchesPayload['matches'] = {};
  for (const skill of input.skills) {
    const row: Record<string, MindosSkillRuntimeMatch> = {};
    for (const runtime of input.runtimes) {
      const runtimeId = runtime.runtimeId ?? runtime.id;
      row[runtimeId] = evaluateSkillRuntimeMatch({
        skill,
        runtime,
        scenario: input.scenario,
      });
    }
    matches[skill.name] = row;
  }

  return {
    schemaVersion: 1,
    scenario: input.scenario,
    skills: input.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      origin: skill.origin,
      path: skill.path,
      runtimeRequirements: skill.runtimeRequirements,
    })),
    runtimes: input.runtimes.map((runtime) => ({
      id: runtime.id,
      ...(runtime.runtimeId ? { runtimeId: runtime.runtimeId } : {}),
      name: runtime.name,
      kind: runtime.kind,
      ...(runtime.category ? { category: runtime.category } : {}),
      status: runtime.status,
    })),
    matches,
  };
}

function parseScenario(value: string | null):
  | { scenario: AgentRuntimeCompatibilityScenario }
  | { error: string } {
  if (!value) return { scenario: 'interactive-turn' };
  if (VALID_SCENARIOS.has(value as AgentRuntimeCompatibilityScenario)) {
    return { scenario: value as AgentRuntimeCompatibilityScenario };
  }
  return { error: `Unsupported scenario: ${value}` };
}
