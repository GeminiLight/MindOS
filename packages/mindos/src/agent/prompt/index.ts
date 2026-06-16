export {
  MINDOS_AGENT_PROMPT_ASSET_PATH,
  MINDOS_AGENT_PROMPT_ASSET_URL,
  MINDOS_SYSTEM_PROMPT,
  ORGANIZE_SYSTEM_PROMPT,
  loadMindosAgentPrompt,
  type LoadMindosAgentPromptOptions,
} from './base-prompt.js';

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
} from './system-prompt.js';
