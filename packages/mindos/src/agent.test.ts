import { describe, expect, it } from 'vitest';
import {
  AGENT_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  ORGANIZE_SYSTEM_PROMPT,
  buildMindosAskSystemPrompt,
  compactMindosPromptForTokenBudget,
  defineMindosAgent,
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
    expect(AGENT_SYSTEM_PROMPT).toContain('You are MindOS');
    expect(AGENT_SYSTEM_PROMPT).toContain('Read Before Write');
    expect(AGENT_SYSTEM_PROMPT).toContain('Delegation / Subagents');
    expect(AGENT_SYSTEM_PROMPT).toContain('action: "list"');
    expect(AGENT_SYSTEM_PROMPT).toContain('separate from ACP runtimes, A2A agents');
    expect(AGENT_SYSTEM_PROMPT).toContain('Structured Clarification');
    expect(AGENT_SYSTEM_PROMPT).toContain('ask_user_question');
    expect(CHAT_SYSTEM_PROMPT).toContain('Read-Only');
    expect(CHAT_SYSTEM_PROMPT).not.toContain('Delegation / Subagents');
    expect(CHAT_SYSTEM_PROMPT).not.toContain('ask_user_question');
    expect(CHAT_SYSTEM_PROMPT.length).toBeLessThan(AGENT_SYSTEM_PROMPT.length);
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
        contextParts: ['## Attached: Space/a.md\n\nAlpha', '## Current file: Space/current.md\n\nCurrent'],
        failedFiles: ['missing.md'],
      }),
    });

    expect(prompt).toContain(CHAT_SYSTEM_PROMPT);
    expect(prompt).toContain('mind_root=/tmp/mind');
    expect(prompt).toContain('## Knowledge Base Structure');
    expect(prompt).toContain('Current UTC Time: 2026-01-02T03:04:05.000Z');
    expect(prompt).toContain('## Attached: Space/a.md');
    expect(prompt).toContain('missing.md');
    expect(prompt).toContain('USER-UPLOADED FILES');
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
        contextParts: ['## Attached: Space/a.md\n\nAlpha'],
        failedFiles: [],
      }),
      recallKnowledge: async () => [{ path: 'Recall.md', content: 'recalled content' }],
    });

    expect(prompt).toContain(AGENT_SYSTEM_PROMPT);
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
      '## Attached: a.md\n\n' + 'a'.repeat(200),
      '## USER-UPLOADED FILES\n\n' + 'u'.repeat(200),
    ].join('\n\n---\n\n');

    const compacted = compactMindosPromptForTokenBudget(prompt, {
      maxPromptTokens: 30,
      estimateTokens: (value) => Math.ceil(value.length / 4),
    });

    expect(compacted).toContain('core prompt');
    expect(compacted).toContain('## Attached: a.md');
    expect(compacted).toContain('## USER-UPLOADED FILES');
    expect(compacted).not.toContain('low priority section');
  });
});
