import { beforeEach, describe, expect, it } from 'vitest';
import { resetAgentRunsForTest, listAgentEvents, startAgentRun } from './ledger/run-ledger.js';
import {
  appendMindosAgentModeRunEvents,
  createMindosAgentModeRunArtifacts,
  mindosAgentModeArtifactsMetadata,
} from './mode-run-events.js';
import type { MindosAgentModeContract } from './mode.js';

describe('MindOS agent mode run events', () => {
  beforeEach(() => {
    resetAgentRunsForTest();
  });

  it('records plan artifacts as structured run events and metadata', () => {
    const run = startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'mindos',
      displayName: 'MindOS Agent',
      permissionMode: 'read',
      inputSummary: 'Plan the migration',
    });
    const contract: MindosAgentModeContract = {
      schemaVersion: 1,
      mode: 'plan',
      objective: 'Plan the migration',
      requestedPermissionMode: 'full',
      effectivePermissionMode: 'read',
      behavior: 'read_only_plan',
    };
    const artifacts = createMindosAgentModeRunArtifacts({
      contract,
      runStatus: 'completed',
      outputSummary: '- [ ] Read current code\n- [ ] Write tests',
      now: 10,
    });

    appendMindosAgentModeRunEvents(run.id, artifacts);

    expect(mindosAgentModeArtifactsMetadata(artifacts)).toMatchObject({
      planArtifact: {
        mode: 'plan',
        objective: 'Plan the migration',
        steps: [
          { title: 'Read current code', status: 'pending' },
          { title: 'Write tests', status: 'pending' },
        ],
      },
    });
    expect(listAgentEvents({ runId: run.id, category: 'plan' })).toEqual([
      expect.objectContaining({
        type: 'plan_artifact',
        data: expect.objectContaining({
          kind: 'plan',
          objective: 'Plan the migration',
        }),
      }),
    ]);
  });

  it('records goal evaluations as structured run events and metadata', () => {
    const run = startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'mindos',
      displayName: 'MindOS Agent',
      permissionMode: 'ask',
      inputSummary: 'Finish the goal',
    });
    const contract: MindosAgentModeContract = {
      schemaVersion: 1,
      mode: 'goal',
      objective: 'Finish the goal',
      behavior: 'goal_until_done_blocked_or_needs_user',
    };
    const artifacts = createMindosAgentModeRunArtifacts({
      contract,
      runStatus: 'completed',
      outputSummary: 'Goal status: complete\nAll tests passed.',
      now: 20,
    });

    appendMindosAgentModeRunEvents(run.id, artifacts);

    expect(mindosAgentModeArtifactsMetadata(artifacts)).toMatchObject({
      goalEvaluation: {
        mode: 'goal',
        objective: 'Finish the goal',
        status: 'completed',
        confidence: 'high',
      },
    });
    expect(listAgentEvents({ runId: run.id, category: 'goal' })).toEqual([
      expect.objectContaining({
        type: 'goal_evaluation',
        data: expect.objectContaining({
          kind: 'goal',
          status: 'completed',
        }),
      }),
    ]);
  });
});
