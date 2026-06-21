import {
  MINDOS_SYSTEM_PROMPT,
} from './base-prompt.js';
import {
  renderMindosActiveAssistantSectionContent,
  type MindosActiveAssistantPrompt,
} from './assistant-prompt.js';

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
  activeAssistant?: MindosActiveAssistantPrompt;
  skillsPrompt?: string;
  extraSections?: MindosPromptSection[];
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

  const activeAssistantContent = renderMindosActiveAssistantSectionContent(input.activeAssistant);
  if (activeAssistantContent) {
    sections.push({
      title: 'Active Assistant',
      content: activeAssistantContent,
    });
  }

  if (input.extraSections?.length) sections.push(...input.extraSections);

  return renderPromptWithSections(MINDOS_SYSTEM_PROMPT, sections);
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
