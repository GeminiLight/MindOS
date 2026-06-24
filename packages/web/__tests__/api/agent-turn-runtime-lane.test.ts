import { describe, expect, it } from 'vitest';
import { resolveRuntimeTurnLane } from '@/app/api/agent/_lib/turn-runtime-lane';
import type { MindosAgentRuntimeSelection } from '@geminilight/mindos/agent/runtime';

const CODEX_RUNTIME = {
  id: 'codex',
  name: 'Codex',
  kind: 'codex',
} satisfies MindosAgentRuntimeSelection;

const CLAUDE_RUNTIME = {
  id: 'claude',
  name: 'Claude Code',
  kind: 'claude',
} satisfies MindosAgentRuntimeSelection;

describe('resolveRuntimeTurnLane', () => {
  it('routes Codex through the native runtime lane', () => {
    const lane = resolveRuntimeTurnLane({
      verifiedNativeRuntime: CODEX_RUNTIME,
      selectedAcpAgent: null,
    });

    expect(lane.kind).toBe('native');
    expect(lane.runtimeKind).toBe('codex');
  });

  it('routes Claude through the native runtime lane', () => {
    const lane = resolveRuntimeTurnLane({
      verifiedNativeRuntime: CLAUDE_RUNTIME,
      selectedAcpAgent: null,
    });

    expect(lane.kind).toBe('native');
    expect(lane.runtimeKind).toBe('claude');
  });

  it('routes selected ACP agents through the ACP runtime lane', () => {
    const lane = resolveRuntimeTurnLane({
      verifiedNativeRuntime: null,
      selectedAcpAgent: { id: 'gemini-cli', name: 'Gemini CLI' },
    });

    expect(lane.kind).toBe('acp');
    expect(lane.runtimeKind).toBe('acp');
  });

  it('routes the default MindOS agent through the embedded Pi runtime lane', () => {
    const lane = resolveRuntimeTurnLane({
      verifiedNativeRuntime: null,
      selectedAcpAgent: null,
    });

    expect(lane.kind).toBe('mindos-pi');
    expect(lane.runtimeKind).toBe('mindos');
  });
});
