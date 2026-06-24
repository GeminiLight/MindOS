import os from 'os';
import type { MindosSelectedSkill } from '@geminilight/mindos/agent';
import {
  mindosRuntimeDescriptor,
  type AgentRuntimeCompatibilityScenario,
} from '@geminilight/mindos/agent/runtime';
import {
  getSkillRootsFromRuntime,
  handleAgentRuntimesGet,
  handleSkillRuntimeMatchesGet,
  type AgentRuntimeDescriptor,
  type MindosRuntimeSettings,
  type MindosSkillRuntimeMatch,
} from '@geminilight/mindos/server';
import { apiError, ErrorCodes } from '@/lib/errors';
import type { RuntimeTurnLane } from './turn-runtime-lane';
import { createAgentRuntimesServices } from './runtime-selection';

type SelectedAcpAgent = { id: string; name: string };
type RuntimeSkillSettings = {
  disabledSkills?: string[];
  skillPaths?: MindosRuntimeSettings['skillPaths'];
};

export type EnforceSelectedSkillRuntimeMatchesInput = {
  selectedSkills: MindosSelectedSkill[];
  runtimeLane: RuntimeTurnLane;
  selectedAcpAgent: SelectedAcpAgent | null;
  mindRoot: string;
  projectRoot: string;
  serverSettings: RuntimeSkillSettings;
  scenario?: AgentRuntimeCompatibilityScenario;
};

export async function enforceSelectedSkillRuntimeMatches(
  input: EnforceSelectedSkillRuntimeMatchesInput,
): Promise<Response | null> {
  if (input.selectedSkills.length === 0) return null;

  const runtimeDescriptor = await resolveSelectedRuntimeDescriptor(input);
  if (!runtimeDescriptor) {
    return apiError(
      ErrorCodes.CONFLICT,
      'MindOS could not resolve the selected runtime descriptor for skill compatibility enforcement.',
      409,
      {
        issueCode: 'skill-runtime-descriptor-unavailable',
        context: {
          runtimeKind: input.runtimeLane.runtimeKind,
          acpAgentId: input.selectedAcpAgent?.id,
        },
      },
    );
  }

  const skillRoots = getSkillRootsFromRuntime({
    mindRoot: input.mindRoot,
    runtimeRoot: input.projectRoot,
    homeDir: process.env.HOME || os.homedir(),
    settings: input.serverSettings as MindosRuntimeSettings,
  });
  const scenario = input.scenario ?? 'interactive-turn';
  const matchesResponse = await handleSkillRuntimeMatchesGet(new URLSearchParams(`scenario=${scenario}`), {
    disabledSkills: input.serverSettings.disabledSkills,
    skillRoots,
    listRuntimes: () => [runtimeDescriptor],
  });

  const matchesPayload = matchesResponse.body;
  if (matchesResponse.status !== 200 || !matchesPayload || !('matches' in matchesPayload)) {
    const message = matchesPayload && 'error' in matchesPayload
      ? matchesPayload.error
      : 'MindOS could not evaluate selected skill runtime compatibility.';
    return apiError(ErrorCodes.INTERNAL_ERROR, message, 500, {
      issueCode: 'skill-runtime-enforcement-failed',
    });
  }

  const runtimeId = runtimeDescriptor.runtimeId ?? runtimeDescriptor.id;
  const blockedMatches = input.selectedSkills
    .map((selectedSkill) => matchesPayload.matches[selectedSkill.name]?.[runtimeId])
    .filter((match): match is MindosSkillRuntimeMatch => match?.level === 'blocked');

  if (blockedMatches.length === 0) return null;

  const firstBlocked = blockedMatches[0]!;
  return apiError(
    ErrorCodes.CONFLICT,
    skillRuntimeBlockedMessage(firstBlocked),
    409,
    {
      issueCode: 'skill-runtime-blocked',
      context: {
        scenario: firstBlocked.scenario,
        runtimeId: firstBlocked.runtimeId,
        runtimeKind: firstBlocked.runtimeKind,
        runtimeName: firstBlocked.runtimeName,
        skillName: firstBlocked.skillName,
        blockers: firstBlocked.blockers ?? [],
        reasons: firstBlocked.reasons,
        blockedSkills: blockedMatches.map((match) => ({
          skillName: match.skillName,
          blockers: match.blockers ?? [],
        })),
      },
    },
  );
}

export function skillRuntimeBlockedMessage(match: MindosSkillRuntimeMatch): string {
  const blockers = match.blockers?.length ? `: ${match.blockers.join(', ')}` : '';
  return `Skill "${match.skillName}" cannot run on ${match.runtimeName} for ${match.scenario}${blockers}.`;
}

async function resolveSelectedRuntimeDescriptor(
  input: Pick<EnforceSelectedSkillRuntimeMatchesInput, 'runtimeLane' | 'selectedAcpAgent'>,
): Promise<AgentRuntimeDescriptor | null> {
  if (input.runtimeLane.kind === 'mindos-pi') {
    return mindosRuntimeDescriptor(new Date().toISOString());
  }

  const response = await handleAgentRuntimesGet(
    runtimeDescriptorParams(input),
    createAgentRuntimesServices(),
  );
  if (response.status !== 200 || !response.body) return null;

  if ('runtime' in response.body) return response.body.runtime;
  if ('runtimes' in response.body) {
    const expectedRuntimeId = input.runtimeLane.kind === 'acp'
      ? input.selectedAcpAgent?.id
      : input.runtimeLane.runtimeKind;
    return response.body.runtimes.find((runtime) => (
      (runtime.runtimeId ?? runtime.id) === expectedRuntimeId
    )) ?? null;
  }
  return null;
}

function runtimeDescriptorParams(
  input: Pick<EnforceSelectedSkillRuntimeMatchesInput, 'runtimeLane'>,
): URLSearchParams {
  const params = new URLSearchParams();
  if (input.runtimeLane.kind === 'native') {
    params.set('runtime', input.runtimeLane.runtimeKind);
    params.set('force', '1');
  } else {
    params.set('scope', 'acp');
  }
  return params;
}
