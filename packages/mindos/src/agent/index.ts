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

export * from './run-ledger-types.js';
export * from './agent-run-context.js';
export * from './file-write-lock.js';
export * from './result-reducer.js';
export * from './permission-policy.js';
export * from './global-state.js';
export * from './redaction.js';
export * from './run-ledger.js';
export * from './run-cancellation.js';
export * from './runtime-permission-bridge.js';
export * from './user-question-bridge.js';
export * from './line-diff.js';
export * from './paragraph-extract.js';
export * from './kb-tools.js';
export * from './kb-extension.js';
export * from './capability-registry.js';
