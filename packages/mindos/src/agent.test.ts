import { describe, expect, it } from 'vitest';
import {
  MINDOS_AGENT_PROMPT_ASSET_URL,
  MINDOS_AGENT_MANIFEST,
  MINDOS_SYSTEM_PROMPT,
  ORGANIZE_SYSTEM_PROMPT,
  buildMindosContextPrompt,
  buildMindosSystemPrompt,
  compactMindosPromptForTokenBudget,
  defineMindosAgent,
  loadMindosAgentPrompt,
} from './agent/index.js';

describe('MindOS agent product contract', () => {
  it('validates agent descriptors', () => {
    expect(defineMindosAgent({
      id: 'mindos',
      name: 'MindOS',
      transports: ['http'],
    })).toMatchObject({ id: 'mindos', name: 'MindOS' });

    expect(() => defineMindosAgent({ id: '', name: 'x', transports: ['http'] })).toThrow('agent id is required');
    expect(() => defineMindosAgent({ id: 'x', name: '', transports: ['http'] })).toThrow('name is required');
    expect(() => defineMindosAgent({ id: 'x', name: 'x', transports: [] })).toThrow('must declare at least one transport');
  });

  it('owns system prompts inside the product runtime', () => {
    expect(MINDOS_AGENT_MANIFEST).toMatchObject({ id: 'mindos', name: 'MindOS' });
    expect(MINDOS_SYSTEM_PROMPT).toContain('You are MindOS');
    expect(loadMindosAgentPrompt()).toBe(MINDOS_SYSTEM_PROMPT);
    expect(loadMindosAgentPrompt({ asset: MINDOS_AGENT_PROMPT_ASSET_URL })).toBe(MINDOS_SYSTEM_PROMPT);
    expect(MINDOS_SYSTEM_PROMPT).toContain('Before modifying an existing file, read it first');
    expect(MINDOS_SYSTEM_PROMPT).toContain('Use tools as the default path');
    expect(MINDOS_SYSTEM_PROMPT).toContain('Attached files from the MindOS knowledge base');
    expect(MINDOS_SYSTEM_PROMPT).toContain('Files uploaded by the user for this request');
    expect(MINDOS_SYSTEM_PROMPT).toContain('Use uploaded content directly');
    expect(MINDOS_SYSTEM_PROMPT).toContain('Available skills may be listed');
    expect(MINDOS_SYSTEM_PROMPT).toContain('Use subagents only when the work is complex and separable');
    expect(MINDOS_SYSTEM_PROMPT).toContain('Do not expose hidden reasoning');
    expect(MINDOS_SYSTEM_PROMPT).not.toContain('Mode: Chat');
    expect(MINDOS_SYSTEM_PROMPT).not.toContain('Agent mode');
    expect(MINDOS_SYSTEM_PROMPT).not.toContain('Working Context');
    expect(ORGANIZE_SYSTEM_PROMPT).toContain('organizing information');
  });

  it('builds stable system prompts without turn-local context', () => {
    const prompt = buildMindosSystemPrompt({
      mindRoot: '/tmp/mind',
      environment: {
        projectRoot: '/tmp/project',
        cwd: '/tmp/mind',
        platform: 'test-platform',
        isGitRepo: true,
        model: { provider: 'openai', id: 'gpt-test' },
      },
    });

    expect(prompt).toContain(MINDOS_SYSTEM_PROMPT);
    expect(prompt).toContain('## Agent Manifest');
    expect(prompt).toContain('<id>mindos</id>');
    expect(prompt).toContain('## Environment');
    expect(prompt).toContain('<mind_root>/tmp/mind</mind_root>');
    expect(prompt).toContain('<project_root>/tmp/project</project_root>');
    expect(prompt).toContain('<is_git_repo>yes</is_git_repo>');
    expect(prompt).toContain('<provider>openai</provider>');
    expect(prompt).not.toContain('## MindOS Turn Context');
    expect(prompt).not.toContain('Current UTC Time: 2026-01-02T03:04:05.000Z');
    expect(prompt).not.toContain('### Attached file from the MindOS knowledge base: Space/a.md');
    expect(prompt).not.toContain('### upload.txt');
    expect(prompt).not.toContain('### Recall.md');
  });

  it('builds turn context prompts with initialization, files, uploads, and recall', async () => {
    const prompt = await buildMindosContextPrompt({
      prompt: 'find project alpha',
      mode: 'agent',
      mindRoot: '/tmp/mind',
      currentFile: 'Space/current.md',
      attachedFiles: ['Space/a.md'],
      uploadedParts: ['### upload.txt\n\nuploaded content'],
      messages: [
        { role: 'user', content: 'find project alpha' },
      ],
      agentInitialization: {
        targetDir: 'Space',
        initFailures: ['bootstrap.config_json: failed (missing)'],
        truncationWarnings: ['skill.mindos was truncated'],
        initContextBlocks: ['## bootstrap_instruction\n\nAlways cite files.'],
      },
      selectedSkillName: 'third-party',
      activeRecall: {
        enabled: true,
        maxTokens: 1000,
        maxFiles: 2,
        minScore: 0.1,
      },
    }, {
      now: () => new Date('2026-01-02T03:04:05.000Z'),
      formatLocalTime: () => 'Friday, January 2, 2026 at 11:04:05 AM GMT+8',
      loadFileContext: () => ({
        contextParts: ['### Attached file from the MindOS knowledge base: Space/a.md\n\nAlpha'],
        failedFiles: ['missing.md'],
      }),
      recallKnowledge: async () => [{ path: 'Recall.md', content: 'recalled content' }],
    });

    expect(prompt).toContain('find project alpha');
    expect(prompt).toContain('## MindOS Turn Context');
    expect(prompt).toContain('Current UTC Time: 2026-01-02T03:04:05.000Z');
    expect(prompt).toContain('Unix Timestamp: 1767323045');
    expect(prompt).toContain('## MindOS Chat Panel Bridge');
    expect(prompt).toContain('## Active Skill Request');
    expect(prompt).toContain('The user selected the skill "third-party" for this turn.');
    expect(prompt).toContain('load_skill("third-party")');
    expect(prompt).toContain('Initialization issues:');
    expect(prompt).toContain('bootstrap.config_json: failed');
    expect(prompt).toContain('## bootstrap_instruction');
    expect(prompt).toContain('## Attached files from the MindOS knowledge base');
    expect(prompt).toContain('### Attached file from the MindOS knowledge base: Space/a.md');
    expect(prompt).toContain('## Files uploaded by the user for this request');
    expect(prompt).toContain('### upload.txt');
    expect(prompt).toContain('## Auto-Recalled MindOS Knowledge');
    expect(prompt).toContain('### Recall.md');
    expect(prompt).toContain('These attached files could not be loaded: missing.md');
    expect(prompt).not.toContain(MINDOS_SYSTEM_PROMPT);
  });

  it('escapes selected skill names in active skill requests', async () => {
    const prompt = await buildMindosContextPrompt({
      prompt: 'use it',
      selectedSkillName: 'skill "quoted"',
    }, {
      now: () => new Date('2026-01-02T03:04:05.000Z'),
      formatLocalTime: () => 'Friday, January 2, 2026 at 11:04:05 AM GMT+8',
    });

    expect(prompt).toContain('## Active Skill Request');
    expect(prompt).toContain('load_skill("skill \\"quoted\\"")');
  });

  it('compacts oversized prompts while preserving core and explicit attachments', () => {
    const prompt = [
      'core prompt',
      'low priority section ' + 'x'.repeat(200),
      '### Attached file from the MindOS knowledge base: a.md\n\n' + 'a'.repeat(200),
      '## Files uploaded by the user for this request\n\n' + 'u'.repeat(200),
    ].join('\n\n---\n\n');

    const compacted = compactMindosPromptForTokenBudget(prompt, {
      maxPromptTokens: 30,
      estimateTokens: (value) => Math.ceil(value.length / 4),
    });

    expect(compacted).toContain('core prompt');
    expect(compacted).toContain('Attached file from the MindOS knowledge base: a.md');
    expect(compacted).toContain('Files uploaded by the user for this request');
    expect(compacted).not.toContain('low priority section');
  });
});
