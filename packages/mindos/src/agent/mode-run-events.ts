import { appendAgentRunEvent } from './ledger/run-ledger.js';
import type { AgentRunStatus } from './ledger/run-ledger-types.js';
import {
  createMindosPlanArtifact,
  evaluateMindosGoalCompletion,
  type MindosAgentModeContract,
  type MindosGoalEvaluation,
  type MindosPlanArtifact,
} from './mode.js';

export type MindosAgentModeRunArtifacts = {
  planArtifact?: MindosPlanArtifact;
  goalEvaluation?: MindosGoalEvaluation;
};

export function createMindosAgentModeRunArtifacts(input: {
  contract?: MindosAgentModeContract;
  outputSummary: string;
  runStatus: AgentRunStatus;
  now?: number;
}): MindosAgentModeRunArtifacts {
  if (!input.contract || input.contract.mode === 'default') return {};
  if (input.contract.mode === 'plan') {
    return {
      planArtifact: createMindosPlanArtifact({
        objective: input.contract.objective,
        output: input.outputSummary,
        generatedAt: input.now,
      }),
    };
  }
  return {
    goalEvaluation: evaluateMindosGoalCompletion({
      objective: input.contract.objective,
      output: input.outputSummary,
      runStatus: input.runStatus,
      evaluatedAt: input.now,
    }),
  };
}

export function appendMindosAgentModeRunEvents(
  runId: string,
  artifacts: MindosAgentModeRunArtifacts,
): void {
  if (artifacts.planArtifact) {
    appendAgentRunEvent(runId, {
      type: 'plan_artifact',
      category: 'plan',
      title: 'Plan artifact',
      message: artifacts.planArtifact.summary,
      data: {
        kind: 'plan',
        ...artifacts.planArtifact,
      },
    });
  }
  if (artifacts.goalEvaluation) {
    appendAgentRunEvent(runId, {
      type: 'goal_evaluation',
      category: 'goal',
      title: 'Goal evaluation',
      message: artifacts.goalEvaluation.summary,
      data: {
        kind: 'goal',
        ...artifacts.goalEvaluation,
      },
    });
  }
}

export function mindosAgentModeArtifactsMetadata(
  artifacts: MindosAgentModeRunArtifacts,
): Record<string, unknown> {
  return {
    ...(artifacts.planArtifact ? { planArtifact: artifacts.planArtifact } : {}),
    ...(artifacts.goalEvaluation ? { goalEvaluation: artifacts.goalEvaluation } : {}),
  };
}
