import type { MindosAskFileContext, MindosAskMode } from '../../session/index.js';
import {
  MINDOS_SYSTEM_PROMPT,
} from './base-prompt.js';

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

export type MindosAgentManifest = {
  id: 'mindos';
  name: string;
  description: string;
};

export type MindosSystemPromptEnvironment = {
  mindRoot: string;
  projectRoot?: string;
  cwd?: string;
  platform?: string;
  isGitRepo?: boolean;
  model?: {
    provider?: string;
    id?: string;
  };
};

export type MindosPromptSection = {
  title: string;
  content: string | string[];
};

export type BuildMindosSystemPromptInput = {
  mindRoot: string;
  agent?: Partial<MindosAgentManifest>;
  environment?: Partial<MindosSystemPromptEnvironment>;
  skillsPrompt?: string;
  extraSections?: MindosPromptSection[];
};

export type BuildMindosContextPromptInput = {
  prompt: string;
  mode?: MindosAskMode;
  mindRoot?: string;
  currentFile?: string;
  attachedFiles?: string[];
  fileContext?: MindosAskFileContext;
  uploadedParts?: string[];
  recalledKnowledge?: Array<{ path: string; content: string }>;
  messages?: MindosAskPromptMessage[];
  agentInitialization?: MindosAskInitializationContext;
  activeRecall?: MindosAskActiveRecallConfig;
  includeChatPanelBridge?: boolean;
};

export type BuildMindosContextPromptServices = {
  loadFileContext?(attachedFiles: string[] | undefined, currentFile: string | undefined, mode: MindosAskMode): MindosAskFileContext;
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

export const MINDOS_AGENT_MANIFEST: MindosAgentManifest = {
  id: 'mindos',
  name: 'MindOS',
  description: 'Local knowledge-base assistant and agent runtime for searching, reading, organizing, and updating the user\'s MindOS knowledge.',
};

export function buildMindosSystemPrompt(input: BuildMindosSystemPromptInput): string {
  const manifest: MindosAgentManifest = {
    ...MINDOS_AGENT_MANIFEST,
    ...input.agent,
    id: 'mindos',
  };
  const environment: MindosSystemPromptEnvironment = {
    platform: process.platform,
    ...input.environment,
    mindRoot: input.environment?.mindRoot ?? input.mindRoot,
  };

  const sections: MindosPromptSection[] = [
    {
      title: 'Agent Manifest',
      content: renderAgentManifest(manifest),
    },
    {
      title: 'Environment',
      content: renderSystemEnvironment(environment),
    },
  ];

  const skillsPrompt = input.skillsPrompt?.trim();
  if (skillsPrompt) {
    sections.push({
      title: 'Available Skills',
      content: [
        'Skills are optional specialized workflows. Use the skill-loading tool only when the current task matches a listed skill or the user explicitly selected one.',
        skillsPrompt,
      ],
    });
  }

  if (input.extraSections?.length) sections.push(...input.extraSections);

  return renderPromptWithSections(MINDOS_SYSTEM_PROMPT, sections);
}

export async function buildMindosContextPrompt(
  input: BuildMindosContextPromptInput,
  services: BuildMindosContextPromptServices = {},
): Promise<string> {
  const prompt = input.prompt.trim();
  const mode = input.mode ?? 'agent';
  const fileContext = input.fileContext ?? services.loadFileContext?.(input.attachedFiles, input.currentFile, mode);
  const recalledKnowledge = input.recalledKnowledge ?? await recallMindosKnowledge(input, services);
  const contextSections: MindosPromptSection[] = [];
  const modeGuidance = getMindosContextModeGuidance(mode);

  if (modeGuidance) {
    contextSections.push({
      title: 'MindOS Request Guidance',
      content: modeGuidance,
    });
  }

  contextSections.push({
    title: 'Current Time Context',
    content: formatMindosAskTimeContext(services, { includeUnix: true }).replace(/^## Current Time Context\n\n?/, ''),
  });

  if (input.includeChatPanelBridge !== false) {
    contextSections.push({
      title: 'MindOS Chat Panel Bridge',
      content: 'If the available tools include `AskUserQuestion`, use it for user confirmations or structured choices that affect the next action. Keep questions concise and include concrete options.',
    });
  }

  appendInitializationContext(contextSections, input);
  appendFileContextSections(contextSections, fileContext);
  appendUploadedContextSections(contextSections, input.uploadedParts);
  appendRecalledKnowledgeSections(contextSections, recalledKnowledge);

  if (contextSections.length === 0) return prompt;
  return [
    prompt,
    '---',
    '## MindOS Turn Context',
    ...contextSections.map(renderSection),
  ].filter(Boolean).join('\n\n');
}

export function formatMindosAskTimeContext(
  services: Pick<BuildMindosContextPromptServices, 'now' | 'formatLocalTime'>,
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
      || section.includes('Attached files from the MindOS knowledge base')
      || section.includes('Attached file from the MindOS knowledge base')
      || section.includes('Current file from the MindOS knowledge base')
      || section.includes('Files uploaded by the user for this request')
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
    return `All initialization contexts loaded successfully. ${location}${input.truncationWarnings.length > 0 ? ` ${input.truncationWarnings.length} files truncated` : ''}`;
  }

  return `Initialization issues:\n${input.initFailures.join('\n')}\n${location}${input.truncationWarnings.length > 0 ? `\nWarnings:\n${input.truncationWarnings.join('\n')}` : ''}`;
}

async function recallMindosKnowledge(
  input: BuildMindosContextPromptInput,
  services: BuildMindosContextPromptServices,
): Promise<Array<{ path: string; content: string }>> {
  if (!services.recallKnowledge) return [];
  const arConfig = input.activeRecall ?? {};
  if (arConfig.enabled === false) return [];

  const lastUserMsg = (input.messages ?? []).filter((message) => message.role === 'user').pop();
  const userQuery = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : input.prompt;
  if (userQuery.trim().length <= 1) return [];

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
    return recalled;
  } catch (error) {
    services.warn?.('[ask] Active recall failed, continuing without:', error);
    return [];
  }
}

function renderPromptWithSections(basePrompt: string, sections: MindosPromptSection[]): string {
  return [
    basePrompt.trim(),
    ...sections.map(renderSection),
  ].filter(Boolean).join('\n\n---\n\n');
}

function renderSection(section: MindosPromptSection): string {
  const content = Array.isArray(section.content) ? section.content.filter(Boolean).join('\n\n') : section.content;
  return `## ${section.title}\n\n${content.trim()}`;
}

function renderAgentManifest(manifest: MindosAgentManifest): string {
  return [
    '<agent>',
    `  <id>${escapeXml(manifest.id)}</id>`,
    `  <name>${escapeXml(manifest.name)}</name>`,
    `  <description>${escapeXml(manifest.description)}</description>`,
    '</agent>',
  ].join('\n');
}

function renderSystemEnvironment(environment: MindosSystemPromptEnvironment): string {
  const lines = [
    '<env>',
    `  <mind_root>${escapeXml(environment.mindRoot)}</mind_root>`,
  ];
  if (environment.projectRoot) lines.push(`  <project_root>${escapeXml(environment.projectRoot)}</project_root>`);
  if (environment.cwd) lines.push(`  <working_directory>${escapeXml(environment.cwd)}</working_directory>`);
  if (environment.platform) lines.push(`  <platform>${escapeXml(environment.platform)}</platform>`);
  if (typeof environment.isGitRepo === 'boolean') lines.push(`  <is_git_repo>${environment.isGitRepo ? 'yes' : 'no'}</is_git_repo>`);
  if (environment.model?.provider || environment.model?.id) {
    lines.push('  <model>');
    if (environment.model.provider) lines.push(`    <provider>${escapeXml(environment.model.provider)}</provider>`);
    if (environment.model.id) lines.push(`    <id>${escapeXml(environment.model.id)}</id>`);
    lines.push('  </model>');
  }
  lines.push('</env>');
  return lines.join('\n');
}

function getMindosContextModeGuidance(mode: MindosAskMode): string | null {
  if (mode === 'organize') {
    return 'Prioritize classification, cleanup, and knowledge organization. Use uploaded or selected materials as source material for well-structured MindOS notes when tools and permissions allow it.';
  }
  return null;
}

function appendInitializationContext(
  sections: MindosPromptSection[],
  input: BuildMindosContextPromptInput,
): void {
  const initialization = input.agentInitialization ?? {};
  const initFailures = initialization.initFailures ?? [];
  const truncationWarnings = initialization.truncationWarnings ?? [];
  const initContextBlocks = initialization.initContextBlocks ?? [];
  const targetDir = initialization.targetDir ?? null;

  if (initFailures.length > 0 || truncationWarnings.length > 0) {
    sections.push({
      title: 'Initialization Status',
      content: formatInitializationStatus({
        mindRoot: input.mindRoot ?? '',
        targetDir,
        initFailures,
        truncationWarnings,
      }),
    });
  }

  if (initContextBlocks.length > 0) {
    sections.push({
      title: 'Initialization Context',
      content: initContextBlocks.join('\n\n---\n\n'),
    });
  }
}

function appendFileContextSections(
  sections: MindosPromptSection[],
  context: MindosAskFileContext | undefined,
): void {
  if (!context) return;
  if (context.contextParts.length > 0) {
    sections.push({
      title: 'Attached files from the MindOS knowledge base',
      content: [
        'These files already exist in the user\'s MindOS knowledge base or local workspace. They have stable paths. Cite their paths when using them, and use file tools to re-read or search them only when needed.',
        context.contextParts.join('\n\n---\n\n'),
      ],
    });
  }
  if (context.failedFiles.length > 0) {
    sections.push({
      title: 'Unavailable MindOS Context',
      content: `These attached files could not be loaded: ${context.failedFiles.join(', ')}. Inform the user that these files were not loaded.`,
    });
  }
}

function appendUploadedContextSections(
  sections: MindosPromptSection[],
  uploadedParts: string[] | undefined,
): void {
  if (!uploadedParts?.length) return;
  sections.push({
    title: 'Files uploaded by the user for this request',
    content: [
      'The user uploaded the following file content for this turn. It may not exist in the MindOS knowledge base yet; use it directly unless it is saved first.',
      uploadedParts.join('\n\n---\n\n'),
    ],
  });
}

function appendRecalledKnowledgeSections(
  sections: MindosPromptSection[],
  recalledKnowledge: Array<{ path: string; content: string }> | undefined,
): void {
  if (!recalledKnowledge?.length) return;
  const block = recalledKnowledge
    .map((item) => `### ${item.path}\n\n${item.content}`)
    .join('\n\n---\n\n');
  sections.push({
    title: 'Auto-Recalled MindOS Knowledge',
    content: [
      'MindOS found these related notes for the user request. Cite file paths when relying on them.',
      block,
    ],
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
