import type { MindosAgentRuntimeSelection } from '@geminilight/mindos/agent/runtime';
import type {
  AcpRuntimeLaneTurnInput,
  NativeRuntimeLaneTurnInput,
} from './turn-lane-shared';
import type { RunMindosPiTurnInput } from './turn-runner-mindos-pi';

type SelectedAcpAgent = { id: string; name: string };

export type NativeRuntimeTurnLane = {
  kind: 'native';
  runtimeKind: 'codex' | 'claude';
  runTurn(input: NativeRuntimeLaneTurnInput): Promise<Response>;
};

export type AcpRuntimeTurnLane = {
  kind: 'acp';
  runtimeKind: 'acp';
  runTurn(input: AcpRuntimeLaneTurnInput): Promise<Response>;
};

export type MindosPiRuntimeTurnLane = {
  kind: 'mindos-pi';
  runtimeKind: 'mindos';
  runTurn(input: RunMindosPiTurnInput): Promise<Response>;
};

export type RuntimeTurnLane = NativeRuntimeTurnLane | AcpRuntimeTurnLane | MindosPiRuntimeTurnLane;

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
        const { runNativeRuntimeLaneTurn } = await import('./turn-lane-native');
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
        const { runAcpRuntimeLaneTurn } = await import('./turn-lane-acp');
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
