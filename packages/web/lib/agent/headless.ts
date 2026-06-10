import { getFileContent, getMindRoot } from '@/lib/fs';
import { truncate } from '@/lib/agent/tools';
import { readSettings } from '@/lib/settings';
import { getProjectRoot } from '@/lib/project-root';
import type { AskModeApi, Message as FrontendMessage } from '@/lib/types';
import { performActiveRecall } from '@/lib/agent/active-recall';
import { toMindosUiAskMessages } from '@/lib/agent/to-agent-messages';
import {
  getTextDelta,
  getThinkingDelta,
  getToolExecutionEnd,
  getToolExecutionStart,
  isTextDeltaEvent,
  isThinkingDeltaEvent,
  isToolExecutionEndEvent,
  isToolExecutionStartEvent,
} from '@geminilight/mindos/session';
import { buildMindosAskSystemPrompt } from '@geminilight/mindos/agent';
import { resolveHeadlessAgentMode, type HeadlessAgentEntryPoint } from './headless-mode-guard';

export interface HeadlessAgentRunOptions {
  userMessage: string;
  historyMessages?: FrontendMessage[];
  mode?: AskModeApi;
  maxSteps?: number;
  providerOverride?: string;
  modelOverride?: string;
  entrypoint?: HeadlessAgentEntryPoint;
  allowAgentMode?: boolean;
}

export interface HeadlessAgentRunResult {
  text: string;
  thinking: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; output: string; isError: boolean }>;
}

function readKnowledgeFile(filePath: string): { ok: boolean; content: string; truncated: boolean; error?: string } {
  try {
    const raw = getFileContent(filePath);
    if (raw.length > 20_000) {
      return {
        ok: true,
        content: truncate(raw),
        truncated: true,
      };
    }
    return { ok: true, content: raw, truncated: false };
  } catch (err) {
    return {
      ok: false,
      content: '',
      truncated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runHeadlessAgent(options: HeadlessAgentRunOptions): Promise<HeadlessAgentRunResult> {
  const modeDecision = resolveHeadlessAgentMode({
    requestedMode: options.mode,
    entrypoint: options.entrypoint,
    allowAgentMode: options.allowAgentMode,
  });
  const askMode = modeDecision.effectiveMode;
  const historyMessages = Array.isArray(options.historyMessages) ? options.historyMessages : [];
  const currentMessage: FrontendMessage = { role: 'user', content: options.userMessage, timestamp: Date.now() };
  const allMessages = [...historyMessages, currentMessage];
  const mindosUiMessages = toMindosUiAskMessages(allMessages);
  const serverSettings = readSettings();
  const agentConfig = serverSettings.agent ?? {};
  const projectRoot = getProjectRoot();
  const mindRoot = getMindRoot();

  const systemPrompt = await buildMindosAskSystemPrompt({
    mode: askMode,
    mindRoot,
    uploadedParts: [],
    messages: mindosUiMessages,
    activeRecall: agentConfig.activeRecall,
  }, {
    readKnowledgeFile,
    loadFileContext: () => ({ contextParts: [], failedFiles: [] }),
    recallKnowledge: (query, recallOptions) => performActiveRecall(mindRoot, query, recallOptions),
    warn: (message, error) => console.warn(message, error),
  });

  const {
    createWebMindosPiRuntimeHostServices,
    getMindosWebPiRuntimePaths,
    getMindosWebRequestTools,
  } = await import('@/lib/agent/mindos-pi-runtime-host');
  const runtimePaths = getMindosWebPiRuntimePaths({ projectRoot, mindRoot, serverSettings, mode: askMode });
  const { createMindosPiCodingAgentRuntime } = await import('@geminilight/mindos/session/pi-coding-agent');
  const runtime = await createMindosPiCodingAgentRuntime({
    mode: askMode,
    messages: mindosUiMessages,
    systemPrompt,
    providerOverride: options.providerOverride,
    modelOverride: typeof options.modelOverride === 'string' ? options.modelOverride : undefined,
    projectRoot,
    agentDir: runtimePaths.agentDir,
    mindRoot,
    agentConfig,
    serverSettings,
    requestTools: getMindosWebRequestTools(askMode),
    additionalSkillPaths: runtimePaths.additionalSkillPaths,
    additionalExtensionPaths: runtimePaths.additionalExtensionPaths,
    hostServices: createWebMindosPiRuntimeHostServices(serverSettings),
  });

  let text = '';
  let thinking = '';
  const toolCalls: Array<{ toolCallId: string; toolName: string; output: string; isError: boolean }> = [];

  runtime.session.subscribe((event: unknown) => {
    if (isTextDeltaEvent(event)) {
      text += getTextDelta(event);
    } else if (isThinkingDeltaEvent(event)) {
      thinking += getThinkingDelta(event);
    } else if (isToolExecutionStartEvent(event)) {
      const { toolCallId, toolName } = getToolExecutionStart(event);
      toolCalls.push({ toolCallId, toolName, output: '', isError: false });
    } else if (isToolExecutionEndEvent(event)) {
      const { toolCallId, output, isError } = getToolExecutionEnd(event);
      const index = toolCalls.findIndex((call) => call.toolCallId === toolCallId);
      if (index >= 0) {
        toolCalls[index] = { ...toolCalls[index], output, isError };
      } else {
        toolCalls.push({ toolCallId, toolName: 'unknown', output, isError });
      }
    }
  });

  await runtime.session.prompt(
    runtime.lastUserContent,
    runtime.lastUserImages ? { images: runtime.lastUserImages } : undefined,
  );

  return {
    text: text.trim(),
    thinking: thinking.trim(),
    toolCalls,
  };
}
