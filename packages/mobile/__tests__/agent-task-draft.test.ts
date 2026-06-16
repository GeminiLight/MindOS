import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }),
  },
}));

import {
  DEFAULT_AGENT_TASK_DRAFT,
  buildStoredAgentTaskDraft,
  buildAgentTaskDraftContract,
  formatAgentTaskDraftContract,
  getAgentTaskProvider,
  normalizeAgentTaskDraft,
  parseStoredAgentTaskDraft,
  validateAgentTaskDraft,
} from '@/lib/agent-task-draft';
import {
  AGENT_TASK_DRAFT_STORAGE_KEY,
  loadAgentTaskDraft,
  saveAgentTaskDraft,
} from '@/lib/agent-task-draft-storage';

describe('agent task draft contract', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('normalizes prompt and target fields without changing provider ownership', () => {
    expect(normalizeAgentTaskDraft({
      provider: 'codex-cloud',
      prompt: '  fix   the failing tests  ',
      repo: '  GeminiLight / MindOS  ',
      branch: '  agent/mobile  ',
      projectPath: '  packages/mobile  ',
    })).toEqual({
      provider: 'codex-cloud',
      prompt: 'fix the failing tests',
      repo: 'GeminiLight / MindOS',
      branch: 'agent/mobile',
      projectPath: 'packages/mobile',
    });
  });

  it('requires a repo or workspace for all cloud providers', () => {
    expect(validateAgentTaskDraft({
      provider: 'github-copilot',
      prompt: '',
      repo: '',
    })).toEqual({
      ok: false,
      missingFields: ['prompt', 'repo'],
      message: 'Add a repo and task prompt before this can become a cloud task.',
    });

    expect(validateAgentTaskDraft({
      provider: 'claude-code-web',
      prompt: 'Summarize current failures',
      repo: '',
    })).toEqual({
      ok: false,
      missingFields: ['repo'],
      message: 'Add a workspace or repo and task prompt before this can become a cloud task.',
    });
  });

  it('builds the future server contract without pretending mobile can submit it', () => {
    expect(buildAgentTaskDraftContract({
      provider: 'codex-cloud',
      prompt: 'Implement mobile review flow',
      repo: 'GeminiLight/MindOS',
      branch: 'codex/mobile-runtime-picker',
      projectPath: 'packages/mobile',
    })).toEqual({
      provider: 'codex-cloud',
      prompt: 'Implement mobile review flow',
      target: {
        repo: 'GeminiLight/MindOS',
        branch: 'codex/mobile-runtime-picker',
        projectPath: 'packages/mobile',
      },
      expectedServerEndpoint: '/api/agent-tasks',
      mobileCanSubmit: false,
      requiredServerCapabilities: [
        'agentTasks.create',
        'agentTasks.list',
        'agentTasks.subscribe',
        'agentTasks.reviewLinks',
        'runtimePermissions.pending',
        'userQuestions.pending',
      ],
    });
  });

  it('formats the full future server contract for clipboard handoff', () => {
    const formatted = formatAgentTaskDraftContract({
      provider: 'claude-code-web',
      prompt: 'Continue the fix',
      repo: 'local-workspace',
    });

    expect(JSON.parse(formatted)).toMatchObject({
      provider: 'claude-code-web',
      prompt: 'Continue the fix',
      target: {
        repo: 'local-workspace',
      },
      mobileCanSubmit: false,
    });
    expect(formatted).toContain('\n  "requiredServerCapabilities"');
  });

  it('builds and parses versioned local draft storage safely', () => {
    const stored = buildStoredAgentTaskDraft({
      provider: 'codex-cloud',
      prompt: '  fix   tests ',
      repo: ' GeminiLight/MindOS ',
    }, '2026-06-16T00:00:00.000Z');

    expect(parseStoredAgentTaskDraft(JSON.stringify(stored))).toEqual({
      provider: 'codex-cloud',
      prompt: 'fix tests',
      repo: 'GeminiLight/MindOS',
      branch: '',
      projectPath: '',
    });
    expect(parseStoredAgentTaskDraft('not-json')).toEqual(DEFAULT_AGENT_TASK_DRAFT);
    expect(parseStoredAgentTaskDraft(JSON.stringify({
      provider: 'missing',
      prompt: 123,
      repo: 'repo',
    }))).toEqual({
      provider: 'codex-cloud',
      prompt: '',
      repo: 'repo',
      branch: '',
      projectPath: '',
    });
  });

  it('persists non-empty drafts locally and clears the default draft', async () => {
    await saveAgentTaskDraft({
      provider: 'github-copilot',
      prompt: 'Open a PR',
      repo: 'GeminiLight/MindOS',
      branch: '',
      projectPath: '',
    });

    expect(storage.has(AGENT_TASK_DRAFT_STORAGE_KEY)).toBe(true);
    await expect(loadAgentTaskDraft()).resolves.toMatchObject({
      provider: 'github-copilot',
      prompt: 'Open a PR',
      repo: 'GeminiLight/MindOS',
    });

    await saveAgentTaskDraft(DEFAULT_AGENT_TASK_DRAFT);

    expect(storage.has(AGENT_TASK_DRAFT_STORAGE_KEY)).toBe(false);
    await expect(loadAgentTaskDraft()).resolves.toEqual(DEFAULT_AGENT_TASK_DRAFT);
  });

  it('falls back to Codex Cloud for unknown provider reads', () => {
    expect(getAgentTaskProvider('github-copilot')).toMatchObject({
      id: 'github-copilot',
      shortName: 'Copilot',
    });
    expect(getAgentTaskProvider('missing' as never)).toMatchObject({
      id: 'codex-cloud',
      shortName: 'Codex',
    });
  });
});
