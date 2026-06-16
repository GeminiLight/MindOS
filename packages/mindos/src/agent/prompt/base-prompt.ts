import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MINDOS_AGENT_PROMPT_ASSET_URL = new URL('./agent-prompt.txt', import.meta.url);
export const MINDOS_AGENT_PROMPT_ASSET_PATH = fileURLToPath(MINDOS_AGENT_PROMPT_ASSET_URL);

export type LoadMindosAgentPromptOptions = {
  asset?: URL | string;
};

export function loadMindosAgentPrompt(options: LoadMindosAgentPromptOptions = {}): string {
  const content = readFileSync(options.asset ?? MINDOS_AGENT_PROMPT_ASSET_URL, 'utf-8').trim();
  if (!content) {
    throw new Error('MindOS agent prompt asset is empty.');
  }
  return content;
}

type PromptSection = {
  title: string;
  body: string[];
};

function renderPrompt(intro: string[], sections: PromptSection[]): string {
  return [
    ...intro,
    ...sections.map((section) => `## ${section.title}\n\n${section.body.join('\n\n')}`),
  ].join('\n\n');
}

const ORGANIZE_PROMPT_SECTIONS: PromptSection[] = [
  {
    title: 'Rules',
    body: [
      `1. Read uploaded file content from the "Files uploaded by the user for this request" section below; do NOT call read tools on them.`,
      `2. Use \`list_files\` to understand the existing KB structure before deciding where to place notes.`,
      `3. Create new files or update existing ones. Prefer \`create_file\` for new content, \`update_section\` / \`append_to_file\` for additions to existing files.`,
      `4. Match the language of the source files when writing notes.`,
      `5. Batch parallel tool calls in a single turn for efficiency.`,
      `6. Do NOT write to the KB root directory; place files under the most fitting subdirectory.`,
      `7. After writing, provide a brief summary of what you created/updated.`,
    ],
  },
];

export const MINDOS_SYSTEM_PROMPT = loadMindosAgentPrompt();

/**
 * Lean system prompt for "organize uploaded files" mode.
 */
export const ORGANIZE_SYSTEM_PROMPT = renderPrompt([
  `You are MindOS, the user's local knowledge assistant for organizing information into a local Markdown knowledge base.`,
  `Your ONLY job: read the user's uploaded files, extract key information, and save well-structured Markdown notes into the knowledge base using file tools.`,
], ORGANIZE_PROMPT_SECTIONS);
