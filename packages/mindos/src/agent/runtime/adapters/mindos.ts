import {
  createMindosPiCodingAgentRuntime,
} from '../../mindos-pi/runtime.js';
import type {
  MindosAskMode,
  MindosExecutableTool,
  MindosPiAgentRuntime,
  MindosPiAgentRuntimeOptions,
  MindosPiAgentRuntimeServices,
  MindosUiAskMessage,
} from '../../session/index.js';
import { mindosRuntimeDescriptor } from '../descriptors.js';
import type { AgentRuntimeDescriptor } from '../registry.js';

export type MindosAgentRuntimeHostServices = Pick<
  MindosPiAgentRuntimeServices,
  | 'resolveModelConfig'
  | 'toRuntimeProvider'
  | 'setKbMode'
  | 'generateSkillsXml'
  | 'getOllamaContextWindow'
  | 'estimateTokens'
  | 'compactPrompt'
  | 'onOllamaContext'
  | 'onOllamaCompactStrip'
  | 'onOllamaCompacted'
  | 'onExtensionLoadErrors'
>;

export type MindosAgentRuntimeAdapterOptions =
  Omit<MindosPiAgentRuntimeOptions, 'mode' | 'messages' | 'requestTools' | 'services' | 'bashTool'> & {
    mode: MindosAskMode;
    messages: MindosUiAskMessage[];
    requestTools: MindosExecutableTool[];
    hostServices: MindosAgentRuntimeHostServices;
  };

export type MindosAgentRuntimeAdapter = {
  id: 'mindos';
  name: 'MindOS';
  descriptor: AgentRuntimeDescriptor;
  createRuntime(options: MindosAgentRuntimeAdapterOptions): Promise<MindosPiAgentRuntime>;
};

export function createMindosAgentRuntimeAdapter(input: {
  checkedAt?: string;
  createRuntime?: (options: MindosAgentRuntimeAdapterOptions) => Promise<MindosPiAgentRuntime>;
} = {}): MindosAgentRuntimeAdapter {
  return {
    id: 'mindos',
    name: 'MindOS',
    descriptor: mindosRuntimeDescriptor(input.checkedAt ?? new Date().toISOString()),
    createRuntime: input.createRuntime ?? createMindosPiCodingAgentRuntime,
  };
}

export async function createMindosAgentRuntime(
  options: MindosAgentRuntimeAdapterOptions,
): Promise<MindosPiAgentRuntime> {
  return createMindosAgentRuntimeAdapter().createRuntime(options);
}
