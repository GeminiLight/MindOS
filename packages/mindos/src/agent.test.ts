import { describe, expect, it } from 'vitest';
import {
  MINDOS_SYSTEM_PROMPT,
  ORGANIZE_SYSTEM_PROMPT,
  buildMindosAskSystemPrompt,
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
    expect(MINDOS_SYSTEM_PROMPT).toContain('You are MindOS');
    expect(loadMindosAgentPrompt()).toBe(MINDOS_SYSTEM_PROMPT);
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

  it('builds chat and organize ask prompts without Web modules', async () => {
    const prompt = await buildMindosAskSystemPrompt({
      mode: 'chat',
      mindRoot: '/tmp/mind',
      currentFile: 'Space/current.md',
      attachedFiles: ['Space/a.md'],
      uploadedParts: ['### upload.txt\n\nuploaded content'],
    }, {
      now: () => new Date('2026-01-02T03:04:05.000Z'),
      formatLocalTime: () => 'Friday, January 2, 2026 at 11:04:05 AM GMT+8',
      readKnowledgeFile: (filePath) => ({
        ok: filePath === 'README.md',
        content: filePath === 'README.md' ? '# Index\n\nUseful knowledge base structure.' : '',
        truncated: false,
        error: filePath === 'README.md' ? undefined : 'missing',
      }),
      loadFileContext: () => ({
        contextParts: [
          '### Attached file from the MindOS knowledge base: Space/a.md\n\nAlpha',
          '### Current file from the MindOS knowledge base: Space/current.md\n\nCurrent',
        ],
        failedFiles: ['missing.md'],
      }),
    });

    expect(prompt).toContain(MINDOS_SYSTEM_PROMPT);
    expect(prompt).toContain('mind_root=/tmp/mind');
    expect(prompt).toContain('## Knowledge Base Structure');
    expect(prompt).toContain('Current UTC Time: 2026-01-02T03:04:05.000Z');
    expect(prompt).toContain('## Request Context');
    expect(prompt).toContain('### Attached files from the MindOS knowledge base');
    expect(prompt).toContain('### Attached file from the MindOS knowledge base: Space/a.md');
    expect(prompt).toContain('missing.md');
    expect(prompt).toContain('Files uploaded by the user for this request');
  });

  it('builds agent prompts with product-owned initialization and recall policy', async () => {
    const prompt = await buildMindosAskSystemPrompt({
      mode: 'agent',
      mindRoot: '/tmp/mind',
      currentFile: 'Space/current.md',
      attachedFiles: ['Space/a.md'],
      uploadedParts: [],
      messages: [
        { role: 'user', content: 'find project alpha' },
      ],
      agentInitialization: {
        targetDir: 'Space',
        initFailures: ['bootstrap.config_json: failed (missing)'],
        truncationWarnings: ['skill.mindos was truncated'],
        initContextBlocks: ['## bootstrap_instruction\n\nAlways cite files.'],
      },
      activeRecall: {
        enabled: true,
        maxTokens: 1000,
        maxFiles: 2,
        minScore: 0.1,
      },
    }, {
      now: () => new Date('2026-01-02T03:04:05.000Z'),
      formatLocalTime: () => 'Friday, January 2, 2026 at 11:04:05 AM GMT+8',
      readKnowledgeFile: () => ({ ok: false, content: '', truncated: false, error: 'unused' }),
      loadFileContext: () => ({
        contextParts: ['### Attached file from the MindOS knowledge base: Space/a.md\n\nAlpha'],
        failedFiles: [],
      }),
      recallKnowledge: async () => [{ path: 'Recall.md', content: 'recalled content' }],
    });

    expect(prompt).toContain(MINDOS_SYSTEM_PROMPT);
    expect(prompt).toContain('Initialization issues:');
    expect(prompt).toContain('bootstrap.config_json: failed');
    expect(prompt).toContain('## bootstrap_instruction');
    expect(prompt).toContain('## KNOWLEDGE CONTEXT (auto-recalled)');
    expect(prompt).toContain('### Recall.md');
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
