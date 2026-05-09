import type { MindosAskFileContext, MindosAskMode } from '../session/index.js';
import {
  AGENT_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  ORGANIZE_SYSTEM_PROMPT,
} from './prompts.js';

export type MindosKnowledgeFile = {
  ok: boolean;
  content: string;
  truncated: boolean;
  error?: string;
};

export type MindosAskPromptMessage = {
  role?: unknown;
  content?: unknown;
};

export type MindosAskActiveRecallConfig = {
  enabled?: boolean;
  maxTokens?: number;
  maxFiles?: number;
  minScore?: number;
};

export type MindosAskInitializationContext = {
  targetDir?: string | null;
  initFailures?: string[];
  truncationWarnings?: string[];
  initContextBlocks?: string[];
};

export type BuildMindosAskSystemPromptInput = {
  mode: MindosAskMode;
  mindRoot: string;
  currentFile?: string;
  attachedFiles?: string[];
  uploadedParts?: string[];
  messages?: MindosAskPromptMessage[];
  agentInitialization?: MindosAskInitializationContext;
  activeRecall?: MindosAskActiveRecallConfig;
};

export type BuildMindosAskSystemPromptServices = {
  readKnowledgeFile(filePath: string): MindosKnowledgeFile;
  loadFileContext(attachedFiles: string[] | undefined, currentFile: string | undefined, mode: MindosAskMode): MindosAskFileContext;
  recallKnowledge?(query: string, options: {
    maxTokens?: number;
    maxFiles?: number;
    minScore?: number;
    excludePaths: string[];
  }): Promise<Array<{ path: string; content: string }>>;
  now?: () => Date;
  formatLocalTime?: (date: Date) => string;
  warn?: (message: string, error?: unknown) => void;
};

export type CompactMindosPromptOptions = {
  maxPromptTokens: number;
  estimateTokens: (content: string) => number;
  onStrip?: (section: string, tokens: number) => void;
};

const MIN_USEFUL_CONTENT_LENGTH = 10;

export async function buildMindosAskSystemPrompt(
  input: BuildMindosAskSystemPromptInput,
  services: BuildMindosAskSystemPromptServices,
): Promise<string> {
  if (input.mode === 'organize') return buildLeanPrompt(input, services, 'organize');
  if (input.mode === 'chat') return buildLeanPrompt(input, services, 'chat');
  return buildAgentPrompt(input, services);
}

function buildLeanPrompt(
  input: BuildMindosAskSystemPromptInput,
  services: BuildMindosAskSystemPromptServices,
  mode: 'chat' | 'organize',
): string {
  const promptParts: string[] = [
    mode === 'chat' ? CHAT_SYSTEM_PROMPT : ORGANIZE_SYSTEM_PROMPT,
    `---\n\nmind_root=${input.mindRoot}`,
  ];

  const bootstrapIndex = services.readKnowledgeFile('README.md');
  if (bootstrapIndex.ok && (mode === 'organize' || bootstrapIndex.content.trim().length > MIN_USEFUL_CONTENT_LENGTH)) {
    promptParts.push(`---\n\n## Knowledge Base Structure\n\n${bootstrapIndex.content}`);
  }

  if (mode === 'chat') {
    promptParts.push(`---\n\n${formatMindosAskTimeContext(services, { includeUnix: false })}`);
  }

  appendFileContext(promptParts, services.loadFileContext(input.attachedFiles, input.currentFile, mode));
  appendUploadedParts(promptParts, input.uploadedParts, mode);

  return promptParts.join('\n\n');
}

async function buildAgentPrompt(
  input: BuildMindosAskSystemPromptInput,
  services: BuildMindosAskSystemPromptServices,
): Promise<string> {
  const initialization = input.agentInitialization ?? {};
  const initFailures = initialization.initFailures ?? [];
  const truncationWarnings = initialization.truncationWarnings ?? [];
  const initContextBlocks = initialization.initContextBlocks ?? [];
  const targetDir = initialization.targetDir ?? null;
  const promptParts: string[] = [
    AGENT_SYSTEM_PROMPT,
    `---\n\n${formatMindosAskTimeContext(services, { includeUnix: true })}`,
  ];

  if (initFailures.length > 0 || truncationWarnings.length > 0) {
    promptParts.push(`---\n\nInitialization status (auto-loaded at request start):\n\n${formatInitializationStatus({
      mindRoot: input.mindRoot,
      targetDir,
      initFailures,
      truncationWarnings,
    })}`);
  }

  if (initContextBlocks.length > 0) {
    promptParts.push(`---\n\nInitialization context:\n\n${initContextBlocks.join('\n\n---\n\n')}`);
  }

  appendFileContext(promptParts, services.loadFileContext(input.attachedFiles, input.currentFile, 'agent'));
  appendUploadedParts(promptParts, input.uploadedParts, 'agent');
  await appendActiveRecall(promptParts, input, services);

  return promptParts.join('\n\n');
}

export function formatMindosAskTimeContext(
  services: Pick<BuildMindosAskSystemPromptServices, 'now' | 'formatLocalTime'>,
  options: { includeUnix: boolean },
): string {
  const now = services.now?.() ?? new Date();
  const localTime = services.formatLocalTime?.(now)
    ?? new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long' }).format(now);
  const lines = [
    '## Current Time Context',
    `- Current UTC Time: ${now.toISOString()}`,
    `- System Local Time: ${localTime}`,
  ];
  if (options.includeUnix) lines.push(`- Unix Timestamp: ${Math.floor(now.getTime() / 1000)}`);
  if (options.includeUnix) {
    lines.push(
      '',
      '*Note: The times listed above represent "NOW". The user may have sent messages hours or days ago in this same conversation thread. Each user message in the history contains its own specific timestamp which you should refer to when understanding historical context.*',
    );
  }
  return lines.join('\n');
}

export function compactMindosPromptForTokenBudget(prompt: string, options: CompactMindosPromptOptions): string {
  const sections = prompt.split('\n\n---\n\n');
  const preserved: string[] = [];
  let currentTokens = 0;

  for (const section of sections) {
    const sectionTokens = options.estimateTokens(section);
    const isAttachment = section.includes('## Attached:')
      || section.includes('## Current file:')
      || section.includes('USER-UPLOADED');
    const isCore = preserved.length === 0;

    if (isCore || isAttachment) {
      preserved.push(section);
      currentTokens += sectionTokens;
    } else if (currentTokens + sectionTokens <= options.maxPromptTokens) {
      preserved.push(section);
      currentTokens += sectionTokens;
    } else {
      options.onStrip?.(section, sectionTokens);
    }
  }

  return preserved.join('\n\n---\n\n');
}

function formatInitializationStatus(input: {
  mindRoot: string;
  targetDir: string | null;
  initFailures: string[];
  truncationWarnings: string[];
}): string {
  const location = `mind_root=${input.mindRoot}${input.targetDir ? `, target_dir=${input.targetDir}` : ''}`;
  if (input.initFailures.length === 0) {
    return `All initialization contexts loaded successfully. ${location}${input.truncationWarnings.length > 0 ? ` ⚠️ ${input.truncationWarnings.length} files truncated` : ''}`;
  }

  return `Initialization issues:\n${input.initFailures.join('\n')}\n${location}${input.truncationWarnings.length > 0 ? `\n⚠️ Warnings:\n${input.truncationWarnings.join('\n')}` : ''}`;
}

function appendFileContext(promptParts: string[], context: MindosAskFileContext) {
  if (context.contextParts.length > 0) {
    promptParts.push(`---\n\nThe user is currently viewing these files:\n\n${context.contextParts.join('\n\n---\n\n')}`);
  }
  if (context.failedFiles.length > 0) {
    promptParts.push(`---\n\n⚠️ The following attached files could not be read: ${context.failedFiles.join(', ')}. Inform the user that these files were not loaded.`);
  }
}

function appendUploadedParts(promptParts: string[], uploadedParts: string[] | undefined, mode: MindosAskMode) {
  if (!uploadedParts || uploadedParts.length === 0) return;
  if (mode === 'agent') {
    promptParts.push(
      `---\n\n## ⚠️ USER-UPLOADED FILES (ACTIVE ATTACHMENTS)\n\n`
      + `The user has uploaded the following file(s) in this conversation. `
      + `Their FULL CONTENT is provided below. You MUST use this content directly when the user refers to these files. `
      + `Do NOT use read_file or search tools to find them — they exist only here, not in the knowledge base.\n\n`
      + uploadedParts.join('\n\n---\n\n'),
    );
    return;
  }

  promptParts.push(
    `---\n\n## ⚠️ USER-UPLOADED FILES\n\n`
    + `Their FULL CONTENT is below. Use this directly — do NOT call read tools on them.\n\n`
    + uploadedParts.join('\n\n---\n\n'),
  );
}

async function appendActiveRecall(
  promptParts: string[],
  input: BuildMindosAskSystemPromptInput,
  services: BuildMindosAskSystemPromptServices,
) {
  if (!services.recallKnowledge) return;
  const arConfig = input.activeRecall ?? {};
  if (arConfig.enabled === false) return;

  const lastUserMsg = (input.messages ?? []).filter((message) => message.role === 'user').pop();
  const userQuery = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
  if (userQuery.trim().length <= 1) return;

  const excludePaths = [
    ...(input.currentFile ? [input.currentFile] : []),
    ...(Array.isArray(input.attachedFiles) ? input.attachedFiles : []),
  ];

  try {
    const recalled = await services.recallKnowledge(userQuery, {
      maxTokens: arConfig.maxTokens,
      maxFiles: arConfig.maxFiles,
      minScore: arConfig.minScore,
      excludePaths,
    });
    if (recalled.length === 0) return;
    const block = recalled.map((item) => `### ${item.path}\n\n${item.content}`).join('\n\n---\n\n');
    promptParts.push(
      `---\n\n## KNOWLEDGE CONTEXT (auto-recalled)\n\n`
      + `The following notes were automatically found in the knowledge base based on the user's question. `
      + `Reference this content to provide accurate, grounded answers. `
      + `Cite the file path when using information from a specific note.\n\n`
      + block,
    );
  } catch (error) {
    services.warn?.('[ask] Active recall failed, continuing without:', error);
  }
}
