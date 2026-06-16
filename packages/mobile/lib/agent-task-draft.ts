export type AgentTaskProviderId = 'codex-cloud' | 'claude-code-web' | 'github-copilot';

export interface AgentTaskProviderOption {
  id: AgentTaskProviderId;
  name: string;
  shortName: string;
  statusLabel: string;
  contractHint: string;
}

export interface AgentTaskDraftInput {
  provider: AgentTaskProviderId;
  prompt: string;
  repo?: string;
  branch?: string;
  projectPath?: string;
}

export interface AgentTaskDraftValidation {
  ok: boolean;
  missingFields: Array<'prompt' | 'repo'>;
  message: string;
}

export interface AgentTaskDraftContract {
  provider: AgentTaskProviderId;
  prompt: string;
  target: {
    repo?: string;
    branch?: string;
    projectPath?: string;
  };
  expectedServerEndpoint: '/api/agent-tasks';
  mobileCanSubmit: false;
  requiredServerCapabilities: string[];
}

export interface StoredAgentTaskDraft {
  version: 1;
  savedAt: string;
  draft: AgentTaskDraftInput;
}

export const AGENT_TASK_DRAFT_REQUIRED_SERVER_CAPABILITIES = [
  'agentTasks.create',
  'agentTasks.list',
  'agentTasks.subscribe',
  'agentTasks.reviewLinks',
  'runtimePermissions.pending',
  'userQuestions.pending',
];

export const AGENT_TASK_PROVIDER_OPTIONS: AgentTaskProviderOption[] = [
  {
    id: 'codex-cloud',
    name: 'Codex Cloud',
    shortName: 'Codex',
    statusLabel: 'Adapter needed',
    contractHint: 'repo, branch, task prompt, diff or PR URL, checkpoints',
  },
  {
    id: 'claude-code-web',
    name: 'Claude Code Web',
    shortName: 'Claude',
    statusLabel: 'Adapter needed',
    contractHint: 'workspace, remote session id, prompt, approval queue',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot agent',
    shortName: 'Copilot',
    statusLabel: 'Adapter needed',
    contractHint: 'issue, repo, branch, PR URL, review state',
  },
];

export const DEFAULT_AGENT_TASK_DRAFT: AgentTaskDraftInput = {
  provider: 'codex-cloud',
  prompt: '',
  repo: '',
  branch: '',
  projectPath: '',
};

export function isAgentTaskProviderId(value: unknown): value is AgentTaskProviderId {
  return typeof value === 'string'
    && AGENT_TASK_PROVIDER_OPTIONS.some((provider) => provider.id === value);
}

export function normalizeAgentTaskDraft(input: AgentTaskDraftInput): AgentTaskDraftInput {
  return {
    provider: input.provider,
    prompt: compactWhitespace(input.prompt),
    repo: compactWhitespace(input.repo ?? ''),
    branch: compactWhitespace(input.branch ?? ''),
    projectPath: compactWhitespace(input.projectPath ?? ''),
  };
}

export function isDefaultAgentTaskDraft(input: AgentTaskDraftInput): boolean {
  const draft = normalizeAgentTaskDraft(input);
  return draft.provider === DEFAULT_AGENT_TASK_DRAFT.provider
    && !draft.prompt
    && !draft.repo
    && !draft.branch
    && !draft.projectPath;
}

export function validateAgentTaskDraft(input: AgentTaskDraftInput): AgentTaskDraftValidation {
  const draft = normalizeAgentTaskDraft(input);
  const missingFields: AgentTaskDraftValidation['missingFields'] = [];
  if (!draft.prompt) missingFields.push('prompt');
  if (!draft.repo) missingFields.push('repo');

  if (missingFields.length === 0) {
    return {
      ok: true,
      missingFields,
      message: 'Draft is complete. Server adapter still required before mobile can launch it.',
    };
  }

  return {
    ok: false,
    missingFields,
    message: missingFields.includes('repo')
      ? draft.provider === 'claude-code-web'
        ? 'Add a workspace or repo and task prompt before this can become a cloud task.'
        : 'Add a repo and task prompt before this can become a cloud task.'
      : 'Add a task prompt before this can become a cloud task.',
  };
}

export function buildAgentTaskDraftContract(input: AgentTaskDraftInput): AgentTaskDraftContract {
  const draft = normalizeAgentTaskDraft(input);
  return {
    provider: draft.provider,
    prompt: draft.prompt,
    target: {
      ...(draft.repo ? { repo: draft.repo } : {}),
      ...(draft.branch ? { branch: draft.branch } : {}),
      ...(draft.projectPath ? { projectPath: draft.projectPath } : {}),
    },
    expectedServerEndpoint: '/api/agent-tasks',
    mobileCanSubmit: false,
    requiredServerCapabilities: [...AGENT_TASK_DRAFT_REQUIRED_SERVER_CAPABILITIES],
  };
}

export function formatAgentTaskDraftContract(input: AgentTaskDraftInput): string {
  return JSON.stringify(buildAgentTaskDraftContract(input), null, 2);
}

export function buildStoredAgentTaskDraft(
  input: AgentTaskDraftInput,
  savedAt = new Date().toISOString(),
): StoredAgentTaskDraft {
  return {
    version: 1,
    savedAt,
    draft: normalizeAgentTaskDraft(input),
  };
}

export function parseStoredAgentTaskDraft(raw: string | null): AgentTaskDraftInput {
  if (!raw) return DEFAULT_AGENT_TASK_DRAFT;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_AGENT_TASK_DRAFT;

    const candidate = parsed as Partial<StoredAgentTaskDraft> & Partial<AgentTaskDraftInput>;
    const rawDraft = isObject(candidate.draft) ? candidate.draft : candidate;
    const provider = isAgentTaskProviderId(rawDraft.provider)
      ? rawDraft.provider
      : DEFAULT_AGENT_TASK_DRAFT.provider;

    return normalizeAgentTaskDraft({
      provider,
      prompt: stringValue(rawDraft.prompt),
      repo: stringValue(rawDraft.repo),
      branch: stringValue(rawDraft.branch),
      projectPath: stringValue(rawDraft.projectPath),
    });
  } catch {
    return DEFAULT_AGENT_TASK_DRAFT;
  }
}

export function getAgentTaskProvider(id: AgentTaskProviderId): AgentTaskProviderOption {
  return AGENT_TASK_PROVIDER_OPTIONS.find((provider) => provider.id === id)
    ?? AGENT_TASK_PROVIDER_OPTIONS[0];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
