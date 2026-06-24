import type { MindosAgentRuntimeSelection } from '@geminilight/mindos/agent/runtime';
import type { RunExternalRuntimeTurnInput } from './turn-runner-external';
import type { RunMindosPiTurnInput } from './turn-runner-mindos-pi';

type SelectedAcpAgent = { id: string; name: string };

export type ExternalRuntimeTurnLane = {
  kind: 'native' | 'acp';
  runtimeKind: 'codex' | 'claude' | 'acp';
  runTurn(input: RunExternalRuntimeTurnInput): Promise<Response>;
};

export type MindosPiRuntimeTurnLane = {
  kind: 'mindos-pi';
  runtimeKind: 'mindos';
  runTurn(input: RunMindosPiTurnInput): Promise<Response>;
};

export type RuntimeTurnLane = ExternalRuntimeTurnLane | MindosPiRuntimeTurnLane;

export function resolveRuntimeTurnLane(input: {
  verifiedNativeRuntime: MindosAgentRuntimeSelection | null;
  selectedAcpAgent: SelectedAcpAgent | null;
}): RuntimeTurnLane {
  const verifiedNativeRuntime = input.verifiedNativeRuntime;
  if (verifiedNativeRuntime) {
    return {
      kind: 'native',
      runtimeKind: verifiedNativeRuntime.kind,
      runTurn: async (turnInput) => {
        const { runNativeRuntimeLaneTurn } = await import('./turn-runner-external');
        return runNativeRuntimeLaneTurn({
          ...turnInput,
          nativeRuntime: verifiedNativeRuntime,
        });
      },
    };
  }

  const selectedAcpAgent = input.selectedAcpAgent;
  if (selectedAcpAgent) {
    return {
      kind: 'acp',
      runtimeKind: 'acp',
      runTurn: async (turnInput) => {
        const { runAcpRuntimeLaneTurn } = await import('./turn-runner-external');
        return runAcpRuntimeLaneTurn({
          ...turnInput,
          acpAgent: selectedAcpAgent,
        });
      },
    };
  }

  return {
    kind: 'mindos-pi',
    runtimeKind: 'mindos',
    runTurn: async (turnInput) => {
      const { runMindosPiTurn } = await import('./turn-runner-mindos-pi');
      return runMindosPiTurn(turnInput);
    },
  };
}
