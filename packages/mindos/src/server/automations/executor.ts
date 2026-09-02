import {
  getTextDelta,
  getThinkingDelta,
  getToolExecutionEnd,
  getToolExecutionStart,
  isTextDeltaEvent,
  isThinkingDeltaEvent,
  isToolExecutionEndEvent,
  isToolExecutionStartEvent,
} from '../../agent/turn/index.js';
import {
  runMindosNativeAgentTurn,
  type MindosNativeAgentTurnOptions,
  type MindosNativeAgentTurnResult,
} from '../../agent/runtime/run.js';
import {
  requestStudioAutomationPermission,
  StudioAutomationApprovalRequiredError,
} from './approvals.js';
import {
  notifyStudioAutomationApprovalViaFeishu,
  type FeishuApprovalDeliveryOptions,
  type FeishuApprovalDeliveryResult,
} from './feishu-approval.js';
import type {
  StudioAutomationExecutor,
  StudioAutomationExecutorContext,
  StudioAutomationExecutorResult,
  StudioAutomationJob,
} from './types.js';

type MindosPiAutomationRunner = (
  job: StudioAutomationJob,
  context: StudioAutomationExecutorContext,
) => Promise<StudioAutomationExecutorResult>;

type NativeAutomationRunner = (
  options: MindosNativeAgentTurnOptions,
) => Promise<MindosNativeAgentTurnResult | Record<string, unknown>>;

export type CreateStudioAutomationExecutorOptions = {
  mindRoot: string;
  runMindosPi?: MindosPiAutomationRunner;
  runNative?: NativeAutomationRunner;
  codexCommand?: string;
  claudeCommand?: string;
  now?(): Date;
  approvalConfigPath?: string;
  notifyApproval?(options: FeishuApprovalDeliveryOptions): Promise<FeishuApprovalDeliveryResult>;
};

export function createStudioAutomationExecutor(
  options: CreateStudioAutomationExecutorOptions,
): StudioAutomationExecutor {
  const runPi = options.runMindosPi ?? (async (job, context) => {
    const { runStandaloneMindosPiAutomation } = await import('./pi-executor.js');
    return runStandaloneMindosPiAutomation({ mindRoot: options.mindRoot, job, context });
  });
  const runNative = options.runNative ?? runMindosNativeAgentTurn;

  return async (job, context) => {
    if (job.runtime === 'mindos-pi') return runPi(job, context);
    return executeNativeAutomation({ ...options, runNative }, job, context);
  };
}

async function executeNativeAutomation(
  options: CreateStudioAutomationExecutorOptions & { runNative: NativeAutomationRunner },
  job: StudioAutomationJob,
  context: StudioAutomationExecutorContext,
): Promise<StudioAutomationExecutorResult> {
  if (job.runtime !== 'codex' && job.runtime !== 'claude') {
    throw new Error(`Unsupported automation runtime: ${job.runtime}`);
  }
  let text = '';
  let thinking = '';
  let approvalError: StudioAutomationApprovalRequiredError | undefined;
  const toolCalls: Array<{ toolCallId: string; toolName: string; output: string; isError: boolean }> = [];
  const runtime = job.runtime;
  const nativeResult = await options.runNative({
    runtime: {
      id: runtime,
      name: runtime === 'codex' ? 'Codex' : 'Claude Code',
      kind: runtime,
      binaryPath: runtime === 'codex'
        ? options.codexCommand ?? process.env.MINDOS_CODEX_COMMAND ?? 'codex'
        : options.claudeCommand ?? process.env.MINDOS_CLAUDE_COMMAND ?? 'claude',
    },
    cwd: options.mindRoot,
    prompt: job.prompt,
    permissionMode: job.permissionMode,
    reasoningEffort: nativeEffort(job.effort),
    timeoutMs: job.timeoutMs,
    signal: context.signal,
    send(event) {
      if (isTextDeltaEvent(event)) {
        text += getTextDelta(event);
      } else if (isThinkingDeltaEvent(event)) {
        thinking += getThinkingDelta(event);
      } else if (isToolExecutionStartEvent(event)) {
        const call = getToolExecutionStart(event);
        toolCalls.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', isError: false });
      } else if (isToolExecutionEndEvent(event)) {
        const completed = getToolExecutionEnd(event);
        const index = toolCalls.findIndex((call) => call.toolCallId === completed.toolCallId);
        if (index >= 0) toolCalls[index] = { ...toolCalls[index]!, output: completed.output, isError: completed.isError };
        else toolCalls.push({ toolCallId: completed.toolCallId, toolName: 'unknown', output: completed.output, isError: completed.isError });
      }
    },
    services: {
      requestRuntimePermission: async (request) => {
        try {
          return requestStudioAutomationPermission(
            options.mindRoot,
            job,
            request,
            options.now?.() ?? new Date(),
          );
        } catch (error) {
          if (error instanceof StudioAutomationApprovalRequiredError) {
            approvalError = error;
            if (error.created) {
              await (options.notifyApproval ?? notifyStudioAutomationApprovalViaFeishu)({
                mindRoot: options.mindRoot,
                approvalId: error.approvalId,
                ...(options.approvalConfigPath ? { configPath: options.approvalConfigPath } : {}),
                ...(options.now ? { now: options.now } : {}),
              }).catch(() => undefined);
            }
          }
          throw error;
        }
      },
      requestUserQuestion: async () => ({
        answers: [],
        cancelled: true,
        error: 'Automation runs cannot answer interactive questions.',
      }),
      ...(runtime === 'claude' && job.permissionMode === 'ask'
        ? {
          createClaudeCliClient: async () => {
            throw new Error('Claude approval recovery requires the Claude Agent SDK bridge; CLI fallback cannot prompt unattended.');
          },
        }
        : {}),
    },
  });

  if (approvalError) throw approvalError;
  if ('error' in nativeResult && nativeResult.error instanceof Error) throw nativeResult.error;
  return { text: text.trim(), thinking: thinking.trim(), toolCalls };
}

function nativeEffort(effort: StudioAutomationJob['effort']): 'medium' | 'high' | 'xhigh' {
  if (effort === 'extra-high') return 'xhigh';
  if (effort === 'high') return 'high';
  return 'medium';
}
