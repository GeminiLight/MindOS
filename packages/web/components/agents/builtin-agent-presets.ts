import {
  INBOX_ORGANIZER_ASSISTANT_ID,
  INBOX_ORGANIZER_ASSISTANT_NAME,
  INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH,
  INBOX_ORGANIZER_DEFAULT_PROMPT,
} from '@/lib/inbox-assistant';

export type BuiltinAgentPresetStatus = 'active' | 'draft' | 'planned';

export interface BuiltinAgentPreset {
  id: string;
  legacyIds?: string[];
  name: string;
  shortName: string;
  status: BuiltinAgentPresetStatus;
  surface: string;
  surfaceHref?: string;
  primaryAction: string;
  owner: string;
  runMode: string;
  persistence: string;
  modelPolicy: string;
  description: string;
  prompt: string;
  promptPath?: string;
  tools: string[];
  skills: string[];
  context: string[];
  triggers: string[];
  guardrails: string[];
}

export const BUILTIN_AGENT_PRESETS: BuiltinAgentPreset[] = [
  {
    id: INBOX_ORGANIZER_ASSISTANT_ID,
    legacyIds: ['inbox-agent'],
    name: INBOX_ORGANIZER_ASSISTANT_NAME,
    shortName: 'Inbox',
    status: 'active',
    surface: 'Inbox / Review',
    surfaceHref: '/capture#queue',
    primaryAction: 'Open Inbox review',
    owner: 'MindOS Core',
    runMode: 'Manual review now, scheduled later',
    persistence: `Prompt stored at ${INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH}`,
    modelPolicy: 'Follows system model, override per run',
    description: 'Reviews pending captures and proposes safe knowledge-base writes.',
    prompt: INBOX_ORGANIZER_DEFAULT_PROMPT,
    promptPath: INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH,
    tools: ['read_inbox', 'read_file', 'write_note', 'search_knowledge', 'organize_history'],
    skills: ['mindos', 'curate-creator-archive', 'workflow-to-skill'],
    context: ['Inbox files', 'Knowledge tree', 'Recent organize history', 'User language preference'],
    triggers: ['Review all pending captures', 'Retry failed organize run', 'Open from Inbox panel'],
    guardrails: ['Preview before write', 'Keep raw source until success', 'Record undo history'],
  },
  {
    id: 'skill-librarian',
    name: 'Skill Librarian',
    shortName: 'Skills',
    status: 'draft',
    surface: 'Agents / Skills',
    primaryAction: 'Review skill coverage',
    owner: 'Agent Platform',
    runMode: 'Manual audit',
    persistence: 'Runtime binding pending',
    modelPolicy: 'Follows system model',
    description: 'Audits installed skills and suggests cleanup, copying, or enablement.',
    prompt:
      'Inspect installed skills across agents. Identify missing, duplicated, disabled, or stale skills. Recommend the smallest safe action and explain which agents are affected.',
    tools: ['list_agents', 'list_skills', 'copy_skill_to_agent', 'read_skill_file'],
    skills: ['skill-installer', 'skill-creator', 'workflow-to-skill'],
    context: ['Agent registry', 'Skill directories', 'Enabled/disabled skill state'],
    triggers: ['Review skill coverage', 'Copy skill to selected agent', 'Find stale skills'],
    guardrails: ['Never delete skill files automatically', 'Show target agents before copy', 'Prefer built-in skills when equivalent'],
  },
  {
    id: 'context-curator',
    name: 'Context Curator',
    shortName: 'Context',
    status: 'planned',
    surface: 'Wiki / Ask',
    primaryAction: 'Build context pack',
    owner: 'Knowledge Runtime',
    runMode: 'On-demand context assembly',
    persistence: 'Not wired yet',
    modelPolicy: 'Use lightweight model by default',
    description: 'Builds compact context packs for a task, file, or conversation.',
    prompt:
      'Given a user task, assemble a compact context pack from MindOS notes, recent decisions, and relevant files. Keep it short, cite source paths, and separate facts from assumptions.',
    tools: ['search_knowledge', 'read_file', 'summarize_note', 'create_context_pack'],
    skills: ['mindos', 'context-restore', 'smart-search'],
    context: ['Current file', 'Recent notes', 'Conversation summary', 'Known pitfalls'],
    triggers: ['Prepare context for Ask', 'Attach context to agent session', 'Summarize current workspace'],
    guardrails: ['Do not include secrets', 'Prefer source links over pasted long text', 'Mark uncertain matches'],
  },
  {
    id: 'release-steward',
    name: 'Release Steward',
    shortName: 'Release',
    status: 'planned',
    surface: 'Release / Desktop',
    primaryAction: 'Audit release readiness',
    owner: 'Release Runtime',
    runMode: 'Checklist before publish',
    persistence: 'Not wired yet',
    modelPolicy: 'Use system model with release checklist',
    description: 'Checks npm/runtime/desktop release readiness before publishing.',
    prompt:
      'Audit the release state. Verify version alignment, package contents, runtime assets, desktop bundle notes, and smoke commands. Report blockers before any publish action.',
    tools: ['read_package_json', 'run_tests', 'inspect_release_assets', 'check_github_workflows'],
    skills: ['ship', 'document-release', 'health'],
    context: ['Release checklist', 'Changelog', 'Package manifest', 'Desktop workflow notes'],
    triggers: ['Prepare npm release', 'Prepare desktop release', 'Post-release smoke check'],
    guardrails: ['Never publish from dirty state', 'Verify tag content first', 'Prefer patch unless explicitly overridden'],
  },
];

export function getPresetStorageKey(id: string): string {
  return `mindos:agent-preset:${id}:prompt`;
}

export function getPresetLegacyStorageKeys(preset: BuiltinAgentPreset): string[] {
  return (preset.legacyIds ?? []).map(getPresetStorageKey);
}
