import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTestMindRoot, seedFile } from '../setup';

vi.mock('@geminilight/mindos/server', async () => {
  return await import('../../../mindos/src/server');
});

const ROUTE_TEST_TIMEOUT_MS = 15_000;

describe('GET /api/assistants', () => {
  it('keeps the Product Server import lazy so Next does not bundle unrelated runtime adapters', () => {
    const routePath = fileURLToPath(new URL('../../app/api/assistants/route.ts', import.meta.url));
    const source = readFileSync(routePath, 'utf-8');
    expect(source).toContain('webpackIgnore');
    expect(source).not.toMatch(/^import\s+.*from ['"]@geminilight\/mindos\/server['"]/m);
  });

  it('loads local Assistant profiles from the hidden assistant registry', async () => {
    seedFile('.mindos/assistants/custom-research/prompt.md', `---
owner: Research
tools: read_notes, web-search
skills: paper-radar
context: Papers, Notes
triggers: Manual review
guardrails: Cite sources
---

# Custom Research

## Role

Prepare a research reading queue from local notes.

## Inputs

- Paper notes
- Daily radar notes

## Output

Write a ranked reading queue.

## Boundaries

- Do not cite papers that are not in the source notes.
`);
    seedFile('.mindos/assistants/custom-research/profile.json', JSON.stringify({
      name: 'Research Queue',
      description: 'Turns local research notes into a ranked queue.',
      schemaVersion: 1,
      preferredAgent: 'mindos-agent',
      skills: ['paper-radar'],
      mcp: ['arxiv'],
      schedule: { mode: 'weekly' },
      surface: 'Research',
      owner: 'Local Research',
      modelPolicy: 'Use system model',
      tools: ['read_notes'],
      context: ['Papers'],
      triggers: ['Weekly review'],
      guardrails: ['Cite sources'],
    }));
    seedFile('.mindos/assistants/Bad Name/prompt.md', '# Unsafe directory should be ignored');

    const { GET } = await import('../../app/api/assistants/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.root).toBe('.mindos/assistants');
    const assistant = body.assistants.find((item: { id: string }) => item.id === 'custom-research');
    expect(assistant).toMatchObject({
      id: 'custom-research',
      name: 'Research Queue',
      description: 'Turns local research notes into a ranked queue.',
      source: 'custom',
      deletable: true,
      preferredAgent: 'mindos-agent',
      skills: ['paper-radar'],
      mcp: ['arxiv'],
      paths: {
        root: '.mindos/assistants/custom-research',
        profile: '.mindos/assistants/custom-research/profile.json',
        prompt: '.mindos/assistants/custom-research/prompt.md',
      },
      prompt: {
        exists: true,
      },
      health: {
        state: 'ready',
        issues: [],
      },
      promptPath: '.mindos/assistants/custom-research/prompt.md',
      profilePath: '.mindos/assistants/custom-research/profile.json',
      promptReady: true,
      profileReady: true,
    });
    expect(assistant.prompt.content).toContain('# Custom Research');
    expect(assistant).not.toHaveProperty('sections');
    expect(assistant).not.toHaveProperty('metadata');
    expect(body.assistants.some((item: { id: string }) => item.id === 'Bad Name')).toBe(false);
  }, ROUTE_TEST_TIMEOUT_MS);

  it('creates custom Assistants with profile.json and prompt.md only', async () => {
    const { POST, GET } = await import('../../app/api/assistants/route');
    const res = await POST(new Request('http://localhost/api/assistants', {
      method: 'POST',
      body: JSON.stringify({
        id: 'research-scout',
        name: 'Research Scout',
        description: 'Finds useful local research follow-ups.',
        preferredAgent: 'mindos-agent',
        skills: ['mindos'],
        mcp: ['arxiv'],
        permissionMode: 'agent',
        schedule: { mode: 'daily' },
        surface: ['agents'],
        outputPolicy: { mode: 'draft' },
        tools: ['write_file'],
      }),
    }));
    const created = await res.json();

    expect(res.status, JSON.stringify(created)).toBe(201);
    expect(created.paths.profile).toBe('.mindos/assistants/research-scout/profile.json');
    const savedProfile = JSON.parse(readFileSync(join(getTestMindRoot(), created.paths.profile), 'utf-8'));
    expect(savedProfile).toMatchObject({
      name: 'Research Scout',
      description: 'Finds useful local research follow-ups.',
      schemaVersion: 1,
      preferredAgent: 'mindos-agent',
      skills: ['mindos'],
      mcp: ['arxiv'],
    });
    expect(savedProfile).not.toHaveProperty('permissionMode');
    expect(savedProfile).not.toHaveProperty('schedule');
    expect(savedProfile).not.toHaveProperty('surface');
    expect(savedProfile).not.toHaveProperty('outputPolicy');
    expect(savedProfile).not.toHaveProperty('tools');

    const list = await GET();
    const body = await list.json();
    const assistant = body.assistants.find((item: { id: string }) => item.id === 'research-scout');
    expect(assistant).toMatchObject({
      id: 'research-scout',
      source: 'custom',
      deletable: true,
      preferredAgent: 'mindos-agent',
      skills: ['mindos'],
      mcp: ['arxiv'],
    });
    expect(assistant.prompt.content).toContain('# Research Scout');
  }, ROUTE_TEST_TIMEOUT_MS);

  it('rejects creating built-in Assistants through the custom Assistant API', async () => {
    const { POST } = await import('../../app/api/assistants/route');
    const res = await POST(new Request('http://localhost/api/assistants', {
      method: 'POST',
      body: JSON.stringify({
        id: 'daily-signal',
        name: 'Daily Signal Override',
      }),
    }));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.error).toContain('Built-in assistants');
  }, ROUTE_TEST_TIMEOUT_MS);

  it('rejects deletion for built-in Assistants and deletes custom Assistants', async () => {
    seedFile('.mindos/assistants/daily-signal/profile.json', JSON.stringify({
      name: 'Daily Signal',
      schemaVersion: 1,
      preferredAgent: 'mindos-agent',
      skills: [],
      mcp: [],
    }));
    seedFile('.mindos/assistants/daily-signal/prompt.md', '# Daily Signal\n');
    seedFile('.mindos/assistants/custom-research/profile.json', JSON.stringify({
      name: 'Custom Research',
      schemaVersion: 1,
      preferredAgent: 'mindos-agent',
      skills: [],
      mcp: [],
    }));
    seedFile('.mindos/assistants/custom-research/prompt.md', '# Custom Research\n');

    const { DELETE, GET } = await import('../../app/api/assistants/route');
    const builtin = await DELETE(new Request('http://localhost/api/assistants', {
      method: 'DELETE',
      body: JSON.stringify({ id: 'daily-signal' }),
    }));
    expect(builtin.status).toBe(403);

    const custom = await DELETE(new Request('http://localhost/api/assistants', {
      method: 'DELETE',
      body: JSON.stringify({ id: 'custom-research' }),
    }));
    expect(custom.status).toBe(200);

    const list = await GET();
    const body = await list.json();
    expect(body.assistants.some((item: { id: string }) => item.id === 'daily-signal')).toBe(true);
    expect(body.assistants.some((item: { id: string }) => item.id === 'custom-research')).toBe(false);
  }, ROUTE_TEST_TIMEOUT_MS);
});
