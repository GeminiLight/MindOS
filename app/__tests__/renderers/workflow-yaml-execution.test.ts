import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the prompt construction and skill fetching logic by importing
// the execution module and mocking fetch.

// The execution module uses fetch() for /api/skills and /api/ask.
// We mock fetch at the global level.

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function streamResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

beforeEach(() => {
  // Clear module cache to reset skill cache between tests
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('Workflow Execution — Skill Injection', () => {
  it('fetches skill content and includes it in prompt (normal path)', async () => {
    const capturedBodies: string[] = [];
    const skillContent = '# Code Review\n\nReview code for quality and correctness.';

    mockFetch((url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (url === '/api/skills' && body.action === 'read') {
        return jsonResponse({ content: skillContent });
      }
      if (url === '/api/ask') {
        capturedBodies.push(body.messages[0].content);
        return streamResponse(['0:"Done."\n']);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });

    // Dynamic import to get fresh module with cleared skill cache
    const { runStepWithAI } = await import('@/components/renderers/workflow-yaml/execution');

    const step = {
      id: 'review', name: 'Code Review', prompt: 'Review the code',
      skill: 'code-review-quality', index: 0, status: 'running' as const, output: '',
    };
    const workflow = {
      title: 'Test', steps: [{ id: 'review', name: 'Code Review', prompt: 'Review the code', skill: 'code-review-quality' }],
    };

    const chunks: string[] = [];
    const ctrl = new AbortController();
    await runStepWithAI(step, workflow, '/test.yaml', (acc) => chunks.push(acc), ctrl.signal);

    // Verify skill content was injected into the prompt
    expect(capturedBodies.length).toBe(1);
    const prompt = capturedBodies[0];
    expect(prompt).toContain('Code Review');
    expect(prompt).toContain('Review code for quality and correctness');
    expect(prompt).toContain('[Primary] Skill: code-review-quality');
  });

  it('includes workflow-level skills as additional context (normal path)', async () => {
    const capturedBodies: string[] = [];

    mockFetch((url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (url === '/api/skills' && body.action === 'read') {
        if (body.name === 'step-skill') return jsonResponse({ content: 'Step skill content' });
        if (body.name === 'global-skill') return jsonResponse({ content: 'Global skill content' });
        return jsonResponse({ error: 'not found' }, 404);
      }
      if (url === '/api/ask') {
        capturedBodies.push(body.messages[0].content);
        return streamResponse(['0:"OK"\n']);
      }
      return jsonResponse({}, 404);
    });

    const { runStepWithAI } = await import('@/components/renderers/workflow-yaml/execution');

    const step = {
      id: 's1', name: 'Step 1', prompt: 'Do work',
      skill: 'step-skill', index: 0, status: 'running' as const, output: '',
    };
    const workflow = {
      title: 'Test',
      skills: ['global-skill'],
      steps: [{ id: 's1', name: 'Step 1', prompt: 'Do work', skill: 'step-skill' }],
    };

    const ctrl = new AbortController();
    await runStepWithAI(step, workflow, '/test.yaml', () => {}, ctrl.signal);

    const prompt = capturedBodies[0];
    expect(prompt).toContain('[Primary] Skill: step-skill');
    expect(prompt).toContain('Skill: global-skill');
    expect(prompt).toContain('Step skill content');
    expect(prompt).toContain('Global skill content');
  });

  it('handles missing skill gracefully (error path)', async () => {
    const capturedBodies: string[] = [];

    mockFetch((url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (url === '/api/skills') {
        return jsonResponse({ error: 'Skill not found' }, 404);
      }
      if (url === '/api/ask') {
        capturedBodies.push(body.messages[0].content);
        return streamResponse(['0:"Done"\n']);
      }
      return jsonResponse({}, 404);
    });

    const { runStepWithAI } = await import('@/components/renderers/workflow-yaml/execution');

    const step = {
      id: 's1', name: 'Step 1', prompt: 'Do work',
      skill: 'nonexistent-skill', index: 0, status: 'running' as const, output: '',
    };
    const workflow = {
      title: 'Test',
      steps: [{ id: 's1', name: 'Step 1', prompt: 'Do work', skill: 'nonexistent-skill' }],
    };

    const ctrl = new AbortController();
    await runStepWithAI(step, workflow, '/test.yaml', () => {}, ctrl.signal);

    // Prompt should NOT contain skill reference block (skill not found)
    const prompt = capturedBodies[0];
    expect(prompt).not.toContain('Skill Reference');
    expect(prompt).toContain('Do work');
  });

  it('works without any skills (boundary: no skill field)', async () => {
    const capturedBodies: string[] = [];

    mockFetch((url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (url === '/api/ask') {
        capturedBodies.push(body.messages[0].content);
        return streamResponse(['0:"Result"\n']);
      }
      return jsonResponse({}, 404);
    });

    const { runStepWithAI } = await import('@/components/renderers/workflow-yaml/execution');

    const step = {
      id: 's1', name: 'Step 1', prompt: 'Simple task',
      index: 0, status: 'running' as const, output: '',
    };
    const workflow = {
      title: 'Simple',
      steps: [{ id: 's1', name: 'Step 1', prompt: 'Simple task' }],
    };

    const ctrl = new AbortController();
    await runStepWithAI(step, workflow, '/test.yaml', () => {}, ctrl.signal);

    // Should NOT call /api/skills at all
    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const skillCalls = fetchCalls.filter(([url]: [string]) => url === '/api/skills');
    expect(skillCalls.length).toBe(0);

    // Prompt should not have skill section
    expect(capturedBodies[0]).not.toContain('Skill Reference');
  });

  it('caches skill content across calls (boundary: same skill used twice)', async () => {
    let skillFetchCount = 0;

    mockFetch((url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (url === '/api/skills') {
        skillFetchCount++;
        return jsonResponse({ content: 'Cached skill' });
      }
      if (url === '/api/ask') {
        return streamResponse(['0:"OK"\n']);
      }
      return jsonResponse({}, 404);
    });

    const { runStepWithAI } = await import('@/components/renderers/workflow-yaml/execution');

    const makeStep = (idx: number) => ({
      id: `s${idx}`, name: `Step ${idx}`, prompt: 'Work',
      skill: 'same-skill', index: idx, status: 'running' as const, output: '',
    });
    const workflow = {
      title: 'Test',
      steps: [
        { id: 's0', name: 'Step 0', prompt: 'Work', skill: 'same-skill' },
        { id: 's1', name: 'Step 1', prompt: 'Work', skill: 'same-skill' },
      ],
    };

    const ctrl = new AbortController();
    await runStepWithAI(makeStep(0), workflow, '/test.yaml', () => {}, ctrl.signal);
    await runStepWithAI(makeStep(1), workflow, '/test.yaml', () => {}, ctrl.signal);

    // Skill should only be fetched once due to caching
    expect(skillFetchCount).toBe(1);
  });
});
