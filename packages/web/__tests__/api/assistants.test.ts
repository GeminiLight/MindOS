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
  it('delegates every method to the shared route table instead of importing handlers', () => {
    const routePath = fileURLToPath(new URL('../../app/api/assistants/route.ts', import.meta.url));
    const source = readFileSync(routePath, 'utf-8');
    for (const method of ['GET', 'POST', 'DELETE']) {
      expect(source).toContain(`export const ${method} = delegateToMindos('${method}', '/api/assistants')`);
    }
    expect(source).not.toMatch(/^import\s+.*from ['"]@geminilight\/mindos\/server['"]/m);
  });

  it('loads local Assistant profiles from the hidden assistant registry', async () => {
    seedFile('.mindos/assistants/custom-research.md', `---
name: Research Queue
description: Turns local research notes into a ranked queue.
version: 2
mode: subagent
runtime: codex
model: gpt-5
permission: ask
hidden: false
color: amber
steps: 8
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
    seedFile('.mindos/assistants/Bad Name.md', '# Unsafe file should be ignored');

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
      version: 2,
      mode: 'subagent',
      runtime: 'codex',
      model: 'gpt-5',
      permissionMode: 'ask',
      source: 'custom',
      deletable: true,
      preferredAgent: 'codex',
      skills: [],
      mcp: [],
      paths: {
        root: '.mindos/assistants',
        profile: '.mindos/assistants/custom-research.md',
        prompt: '.mindos/assistants/custom-research.md',
        file: '.mindos/assistants/custom-research.md',
      },
      prompt: {
        exists: true,
      },
      health: {
        state: 'ready',
        issues: [],
      },
      promptPath: '.mindos/assistants/custom-research.md',
      profilePath: '.mindos/assistants/custom-research.md',
      promptReady: true,
      profileReady: true,
    });
    expect(assistant.prompt.content).toContain('# Custom Research');
    expect(assistant.prompt.content).not.toContain('version: 2');
    expect(assistant).not.toHaveProperty('sections');
    expect(assistant).not.toHaveProperty('metadata');
    expect(body.assistants.some((item: { id: string }) => item.id === 'Bad Name')).toBe(false);
  }, ROUTE_TEST_TIMEOUT_MS);

  it('creates custom Assistants as single Markdown files with version', async () => {
    const { POST, GET } = await import('../../app/api/assistants/route');
    const res = await POST(new Request('http://localhost/api/assistants', {
      method: 'POST',
      body: JSON.stringify({
        id: 'research-scout',
        name: 'Research Scout',
        description: 'Finds useful local research follow-ups.',
        runtime: 'codex',
        model: 'gpt-5',
        permission: 'ask',
        permissionMode: 'ask',
        schedule: { mode: 'daily' },
        surface: ['agents'],
        outputPolicy: { mode: 'draft' },
        tools: ['write_file'],
      }),
    }));
    const created = await res.json();

    expect(res.status, JSON.stringify(created)).toBe(201);
    expect(created.paths.profile).toBe('.mindos/assistants/research-scout.md');
    const savedMarkdown = readFileSync(join(getTestMindRoot(), created.paths.file), 'utf-8');
    expect(savedMarkdown).toContain('name: Research Scout');
    expect(savedMarkdown).toContain('description: Finds useful local research follow-ups.');
    expect(savedMarkdown).toContain('version: 1');
    expect(savedMarkdown).toContain('mode: subagent');
    expect(savedMarkdown).toContain('runtime: codex');
    expect(savedMarkdown).toContain('model: gpt-5');
    expect(savedMarkdown).toContain('permissionMode: ask');
    expect(savedMarkdown).not.toContain('schemaVersion');
    expect(savedMarkdown).not.toContain('permission:');
    expect(savedMarkdown).not.toContain('schedule:');
    expect(savedMarkdown).not.toContain('surface:');
    expect(savedMarkdown).not.toContain('outputPolicy');
    expect(savedMarkdown).not.toContain('tools:');

    const list = await GET();
    const body = await list.json();
    const assistant = body.assistants.find((item: { id: string }) => item.id === 'research-scout');
    expect(assistant).toMatchObject({
      id: 'research-scout',
      source: 'custom',
      deletable: true,
      version: 1,
      runtime: 'codex',
      preferredAgent: 'codex',
      skills: [],
      mcp: [],
    });
    expect(assistant.prompt.content).toContain('# Research Scout');
  }, ROUTE_TEST_TIMEOUT_MS);

  it('rejects creating built-in Assistants through the custom Assistant API', async () => {
    const { POST } = await import('../../app/api/assistants/route');
    const inboxOrganizer = await POST(new Request('http://localhost/api/assistants', {
      method: 'POST',
      body: JSON.stringify({
        id: 'inbox-organizer',
        name: 'Inbox Organizer Override',
      }),
    }));
    const inboxBody = await inboxOrganizer.json();

    expect(inboxOrganizer.status, JSON.stringify(inboxBody)).toBe(409);
    expect(inboxBody.error).toContain('Built-in assistants');

    const dreaming = await POST(new Request('http://localhost/api/assistants', {
      method: 'POST',
      body: JSON.stringify({
        id: 'dreaming',
        name: 'Dreaming Override',
      }),
    }));
    const dreamingBody = await dreaming.json();

    expect(dreaming.status, JSON.stringify(dreamingBody)).toBe(409);
    expect(dreamingBody.error).toContain('Built-in assistants');

    const echoImprint = await POST(new Request('http://localhost/api/assistants', {
      method: 'POST',
      body: JSON.stringify({
        id: 'echo-imprint',
        name: 'Echo Imprint Override',
      }),
    }));
    const echoBody = await echoImprint.json();

    expect(echoImprint.status, JSON.stringify(echoBody)).toBe(409);
    expect(echoBody.error).toContain('Built-in assistants');
  }, ROUTE_TEST_TIMEOUT_MS);

  it('rejects deletion for built-in Assistants and deletes custom Assistants', async () => {
    seedFile('.mindos/assistants/dreaming.md', `---
name: Dreaming
description: Review knowledge-base health.
version: 1
mode: subagent
runtime: mindos
model: default
permission: ask
hidden: true
---

# Dreaming
`);
    seedFile('.mindos/assistants/custom-research.md', `---
name: Custom Research
description: Custom assistant.
version: 1
mode: subagent
runtime: mindos
model: default
permission: ask
hidden: false
---

# Custom Research
`);

    const { DELETE, GET } = await import('../../app/api/assistants/route');
    const builtin = await DELETE(new Request('http://localhost/api/assistants', {
      method: 'DELETE',
      body: JSON.stringify({ id: 'dreaming' }),
    }));
    expect(builtin.status).toBe(403);
    const dreaming = await DELETE(new Request('http://localhost/api/assistants', {
      method: 'DELETE',
      body: JSON.stringify({ id: 'dreaming' }),
    }));
    expect(dreaming.status).toBe(403);
    const echoImprint = await DELETE(new Request('http://localhost/api/assistants', {
      method: 'DELETE',
      body: JSON.stringify({ id: 'echo-imprint' }),
    }));
    expect(echoImprint.status).toBe(403);

    const custom = await DELETE(new Request('http://localhost/api/assistants', {
      method: 'DELETE',
      body: JSON.stringify({ id: 'custom-research' }),
    }));
    expect(custom.status).toBe(200);

    const list = await GET();
    const body = await list.json();
    expect(body.assistants.some((item: { id: string }) => item.id === 'dreaming')).toBe(true);
    expect(body.assistants.some((item: { id: string }) => item.id === 'custom-research')).toBe(false);
  }, ROUTE_TEST_TIMEOUT_MS);
});
