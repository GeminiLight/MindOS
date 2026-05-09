export type MindosAgentDescriptor = {
  id: string;
  name: string;
  description?: string;
  transports: Array<'http' | 'stdio' | 'mcp' | 'acp'>;
};

export function defineMindosAgent(descriptor: MindosAgentDescriptor): MindosAgentDescriptor {
  if (!descriptor.id?.trim()) throw new Error('agent id is required');
  if (!descriptor.name?.trim()) throw new Error(`agent "${descriptor.id}" name is required`);
  if (descriptor.transports.length === 0) throw new Error(`agent "${descriptor.id}" must declare at least one transport`);
  return descriptor;
}

export {
  AGENT_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  ORGANIZE_SYSTEM_PROMPT,
} from './prompts.js';

export {
  buildMindosAskSystemPrompt,
  compactMindosPromptForTokenBudget,
  formatMindosAskTimeContext,
  type BuildMindosAskSystemPromptInput,
  type BuildMindosAskSystemPromptServices,
  type CompactMindosPromptOptions,
  type MindosAskActiveRecallConfig,
  type MindosAskInitializationContext,
  type MindosAskPromptMessage,
  type MindosKnowledgeFile,
} from './prompt-builder.js';
