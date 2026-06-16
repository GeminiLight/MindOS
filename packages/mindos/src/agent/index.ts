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
  MINDOS_SYSTEM_PROMPT,
  ORGANIZE_SYSTEM_PROMPT,
  MINDOS_AGENT_PROMPT_ASSET_PATH,
  MINDOS_AGENT_PROMPT_ASSET_URL,
  loadMindosAgentPrompt,
  type LoadMindosAgentPromptOptions,
} from './prompt/index.js';

export {
  MINDOS_AGENT_MANIFEST,
  buildMindosContextPrompt,
  buildMindosSystemPrompt,
  compactMindosPromptForTokenBudget,
  formatMindosAskTimeContext,
  type BuildMindosContextPromptInput,
  type BuildMindosContextPromptServices,
  type BuildMindosSystemPromptInput,
  type CompactMindosPromptOptions,
  type MindosAgentManifest,
  type MindosAskActiveRecallConfig,
  type MindosAskInitializationContext,
  type MindosAskPromptMessage,
  type MindosPromptSection,
  type MindosSystemPromptEnvironment,
} from './prompt/index.js';

export * from './run-ledger-types.js';
export * from './agent-run-context.js';
export * from './result-reducer.js';
export * from './global-state.js';
export * from './redaction.js';
export * from './run-ledger.js';
export * from './run-timeline-events.js';
export * from './run-cancellation.js';
export * from './runtime-permission-bridge.js';
export * from './user-question-bridge.js';
export * from './tool/index.js';
