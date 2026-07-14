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
  MINDOS_AGENT_PROMPT_ASSET_PATH,
  MINDOS_AGENT_PROMPT_ASSET_URL,
  loadMindosAgentPrompt,
  type LoadMindosAgentPromptOptions,
} from './prompt/index.js';

export {
  MINDOS_AGENT_MANIFEST,
  buildMindosTurnContext,
  buildMindosContextPrompt,
  buildMindosSystemPrompt,
  compactMindosPromptForTokenBudget,
  createMindosActiveAssistantPrompt,
  createMindosActiveAssistantPromptFromMarkdown,
  createMindosSessionContextSignature,
  formatMindosAgentTimeContext,
  normalizeMindosAssistantSkillBindings,
  parseMindosAssistantMarkdownPrompt,
  prependMindosActiveAssistantPrompt,
  renderMindosActiveAssistantPromptSection,
  renderMindosActiveAssistantSectionContent,
  renderMindosContextPrompt,
  type BuildMindosContextPromptInput,
  type BuildMindosContextPromptServices,
  type BuildMindosSystemPromptInput,
  type CompactMindosPromptOptions,
  type CreateMindosActiveAssistantPromptInput,
  type MindosActiveAssistantPrompt,
  type MindosAgentManifest,
  type MindosAgentInitializationContext,
  type MindosAgentRecalledKnowledgeItem,
  type MindosAssistantMarkdownPrompt,
  type MindosAssistantSkillActivation,
  type MindosAssistantSkillBinding,
  type MindosContextPromptSection,
  type MindosPromptSection,
  type MindosSystemPromptEnvironment,
  type MindosTurnContext,
} from './prompt/index.js';

export {
  mindosSelectedSkillNames,
  normalizeMindosSelectedSkills,
  type MindosSelectedSkill,
  type MindosSelectedSkillSource,
} from './selected-skills.js';

export * from './ledger/index.js';
export * from './bridges/index.js';
export * from './stream/index.js';
export * from './subagent/index.js';
export * from './agent-run-context.js';
export * from './result-reducer.js';
export * from './global-state.js';
export * from './redaction.js';
export * from './tool/index.js';
export * from './mode.js';
export * from './mode-run-events.js';
