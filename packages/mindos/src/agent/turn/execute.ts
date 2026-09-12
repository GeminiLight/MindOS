import type { AgentRunCapsuleRequest } from '../capsules/types.js';
import { createMindosPiRuntimeLane } from '../runtime/lane-adapters.js';
import { runRuntimeLaneTurn, type RuntimeLane, type RuntimeLaneTurnInput } from '../runtime/lane-runner.js';
import { createMindosAgentModeContract, type MindosAgentMode } from '../mode.js';
import type { MindosPiAgentRuntime } from '../mindos-pi/session.js';
import type { MindosPermissionMode } from '../permission/index.js';
import type { MindOSSSEvent } from './sse.js';

export interface AgentTurnResult {
  text: string;
  thinking: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; output: string; isError: boolean }>;
}

/** Non-HTTP hosts consume exactly the same ledger, budget, approval and terminal semantics. */
export async function executeAgentTurn(lane: RuntimeLane, input: RuntimeLaneTurnInput, send?: (event: MindOSSSEvent) => void): Promise<AgentTurnResult> {
  const result: AgentTurnResult = { text: '', thinking: '', toolCalls: [] };
  let failure: string | undefined;
  await runRuntimeLaneTurn(lane, input, event => {
    send?.(event);
    if (event.type === 'text_delta') result.text += event.delta;
    else if (event.type === 'thinking_delta') result.thinking += event.delta;
    else if (event.type === 'error') failure = event.message;
    else if (event.type === 'tool_start') result.toolCalls.push({ toolCallId: event.toolCallId, toolName: event.toolName, output: '', isError: false });
    else if (event.type === 'tool_end') {
      let tool = result.toolCalls.find(call => call.toolCallId === event.toolCallId);
      if (!tool) { tool = { toolCallId: event.toolCallId, toolName: event.toolName ?? 'unknown', output: '', isError: false }; result.toolCalls.push(tool); }
      tool.output = event.output;
      tool.isError = event.isError ?? false;
    }
  });
  if (failure) throw new Error(failure);
  return { ...result, text: result.text.trim(), thinking: result.thinking.trim() };
}

export function executeMindosPiRuntimeTurn(input: {
  runtime: MindosPiAgentRuntime;
  mindRoot: string;
  cwd: string;
  permissionMode: MindosPermissionMode;
  agentMode?: MindosAgentMode;
  maxSteps: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  source?: 'interactive' | 'automation' | 'event';
  chatSessionId?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
  capsuleRequest?: AgentRunCapsuleRequest;
  send?: (event: MindOSSSEvent) => void;
}): Promise<AgentTurnResult> {
  const { runtime } = input;
  const prompt = runtime.turnPrompt;
  const lane = createMindosPiRuntimeLane({ runtime, cwd: input.cwd, stepLimit: input.maxSteps, thinkingLevel: runtime.thinkingLevel ?? 'off' });
  return executeAgentTurn(lane, {
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    chatSessionId: input.chatSessionId,
    ledger: { agentKind: 'mindos-main', runtimeId: 'mindos', displayName: 'MindOS Agent', permissionMode: input.permissionMode, inputSummary: prompt, metadata: input.metadata },
    capsule: { mindRoot: input.mindRoot, runId: input.runId, source: input.source ?? 'interactive', request: input.capsuleRequest ?? {
      messages: [{ role: 'user', content: prompt }], runtime: { kind: 'mindos', id: 'mindos', name: 'MindOS' }, permissionMode: input.permissionMode,
      context: { attachedFiles: [], uploadedFiles: [], receiptIds: [], assetIds: [] },
    }, provenance: { cwd: input.cwd } },
    modeContract: createMindosAgentModeContract({ mode: input.agentMode ?? 'default', prompt, requestedPermissionMode: input.permissionMode, effectivePermissionMode: input.permissionMode }),
  }, input.send);
}
