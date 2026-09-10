/**
 * Recovery-capsule helpers for the agent turn lanes. The implementation moved
 * to the core lane runner (spec-runtime-lane-contract 方案 1/2): the single
 * caller `runRuntimeLaneTurn` captures and finalizes capsules for every lane.
 * This module keeps the historical web export names as re-exports so
 * `turn-runner.ts` / `turn-lane-shared.ts` imports stay stable.
 */
export {
  captureLaneTurnCapsule as captureAgentTurnCapsule,
  finalizeLaneTurnCapsule as finalizeAgentTurnCapsule,
  laneCapsuleRuntimeBinding as capsuleRuntimeBinding,
  type AgentTurnCapsuleSeed,
} from '@geminilight/mindos/agent/runtime';
