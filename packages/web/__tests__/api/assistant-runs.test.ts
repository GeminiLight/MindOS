import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/assistant-runs/route';

const agentTurnPostMock = vi.hoisted(() => vi.fn());
const listLocalAssistantsMock = vi.hoisted(() => vi.fn(() => []));

vi.mock('@/app/api/agent/_lib/turn-runner', () => ({
  runAgentTurnRequestBody: agentTurnPostMock,
}));

vi.mock('@/lib/fs', () => ({
  getMindRoot: () => '/tmp/mind',
}));

vi.mock('@geminilight/mindos/server', () => ({
  listLocalAssistants: listLocalAssistantsMock,
}));

describe('POST /api/assistant-runs', () => {
  beforeEach(() => {
    agentTurnPostMock.mockReset();
    listLocalAssistantsMock.mockReset();
    listLocalAssistantsMock.mockReturnValue([]);
  });

  it('delegates Inbox Organizer runs to the shared agent turn streaming runner', async () => {
    agentTurnPostMock.mockResolvedValueOnce(new Response('data: {"type":"done"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }));

    const response = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      headers: { 'accept-language': 'zh-CN' },
      body: JSON.stringify({
        assistantId: 'inbox-organizer',
        trigger: 'manual',
        messages: [{ role: 'user', content: 'Organize this Inbox item.' }],
        uploadedFiles: [{ name: 'capture.md', content: 'source' }],
        providerOverride: 'p_stepfun',
        modelOverride: 'step-2',
        maxSteps: 15,
      }),
    }));

    expect(agentTurnPostMock).toHaveBeenCalledTimes(1);
    const delegatedBody = agentTurnPostMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const delegatedContext = agentTurnPostMock.mock.calls[0]?.[1] as {
      headers?: Headers;
      request?: Request;
      signal?: AbortSignal;
      activeAssistant?: { id: string; name: string; instructions?: string; permissionMode?: string };
    };
    expect(delegatedContext.headers?.get('accept-language')).toBe('zh-CN');
    expect(delegatedContext.request?.url).toBe('http://localhost/api/assistant-runs');
    expect(delegatedContext.activeAssistant).toMatchObject({
      id: 'inbox-organizer',
      name: 'Inbox Organizer',
      permissionMode: 'ask',
    });
    expect(delegatedContext.activeAssistant?.instructions).toContain('Review staged Inbox material');
    expect(delegatedBody).toMatchObject({
      assistantId: 'inbox-organizer',
      messages: [{ role: 'user', content: 'Organize this Inbox item.' }],
      uploadedFiles: [{ name: 'capture.md', content: 'source' }],
      providerOverride: 'p_stepfun',
      modelOverride: 'step-2',
      maxSteps: 15,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    await expect(response.text()).resolves.toContain('"type":"done"');
  });

  it('rejects assistant runs without messages before touching the agent turn runner', async () => {
    const response = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({ assistantId: 'inbox-organizer' }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_MESSAGES' },
    });
    expect(agentTurnPostMock).not.toHaveBeenCalled();
  });

  it('normalizes assistant bodies without leaking invalid raw fields', async () => {
    agentTurnPostMock.mockResolvedValueOnce(new Response('data: {"type":"done"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }));

    await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({
        assistantId: 'inbox-organizer',
        messages: [{ role: 'user', content: 'Organize this Inbox item.' }],
        uploadedFiles: 'not-files',
        providerOverride: '   ',
        modelOverride: '',
        runtimeOptions: 'not-options',
        maxSteps: -1,
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
        chatSessionId: 'chat-1',
      }),
    }));

    const delegatedBody = agentTurnPostMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(delegatedBody).toMatchObject({
      assistantId: 'inbox-organizer',
      messages: [{ role: 'user', content: 'Organize this Inbox item.' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      chatSessionId: 'chat-1',
    });
    expect(delegatedBody).not.toHaveProperty('uploadedFiles');
    expect(delegatedBody).not.toHaveProperty('providerOverride');
    expect(delegatedBody).not.toHaveProperty('modelOverride');
    expect(delegatedBody).not.toHaveProperty('runtimeOptions');
    expect(delegatedBody).not.toHaveProperty('maxSteps');
  });

  it('delegates Dreaming runs to the shared agent turn runner with the local dreaming tool instruction', async () => {
    agentTurnPostMock.mockResolvedValueOnce(new Response('data: {"type":"text_delta","delta":"Dreaming queued"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }));

    const response = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({
        assistantId: 'dreaming',
        trigger: 'manual',
      }),
    }));

    expect(agentTurnPostMock).toHaveBeenCalledTimes(1);
    const delegatedBody = agentTurnPostMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(delegatedBody).toMatchObject({
      assistantId: 'dreaming',
      maxSteps: 16,
    });
    const messages = delegatedBody.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('First call the local `dreaming` tool exactly once');
    expect(messages[0].content).toContain('space: all');
    expect(messages[0].content).toContain('writeArtifacts: true');
    expect(messages[0].content).not.toContain('# Dreaming');
    const delegatedContext = agentTurnPostMock.mock.calls[0]?.[1] as {
      activeAssistant?: { id: string; name: string; instructions?: string; permissionMode?: string };
    };
    expect(delegatedContext.activeAssistant).toMatchObject({
      id: 'dreaming',
      name: 'Dreaming',
      permissionMode: 'ask',
    });
    expect(delegatedContext.activeAssistant?.instructions).toContain('.mindos/dreaming');
    expect(response.headers.get('content-type')).toContain('text/event-stream');
  });

  it('passes Dreaming dry-run scope through the agent turn prompt instead of running a server branch', async () => {
    agentTurnPostMock.mockResolvedValueOnce(new Response('data: {"type":"done"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }));

    const response = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({
        assistantId: 'dreaming',
        dryRun: true,
        context: {
          space: 'Projects',
        },
      }),
    }));

    expect(response.status).toBe(200);
    const delegatedBody = agentTurnPostMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const messages = delegatedBody.messages as Array<{ content: string }>;
    expect(messages[0].content).toContain('space: Projects');
    expect(messages[0].content).toContain('writeArtifacts: false');
    expect(messages[0].content).toContain('space "Projects"');
    expect(messages[0].content).toContain('dryRun true');
  });

  it('delegates custom assistant runs through agent turns with top-level read permission', async () => {
    agentTurnPostMock.mockResolvedValueOnce(new Response('data: {"type":"done"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }));

    const response = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({
        assistantId: 'daily-signal',
        messages: [{ role: 'user', content: 'Run this assistant.' }],
        permissionMode: 'read',
        runtimeOptions: { reasoningEffort: 'high' },
      }),
    }));

    expect(response.status).toBe(200);
    const delegatedBody = agentTurnPostMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(delegatedBody).toMatchObject({
      assistantId: 'daily-signal',
      messages: [{ role: 'user', content: 'Run this assistant.' }],
      permissionMode: 'read',
      runtimeOptions: { reasoningEffort: 'high' },
    });
    const delegatedContext = agentTurnPostMock.mock.calls[0]?.[1] as {
      activeAssistant?: { id: string; name: string; permissionMode?: string };
    };
    expect(delegatedContext.activeAssistant).toMatchObject({
      id: 'daily-signal',
      name: 'Daily Signal',
      permissionMode: 'read',
    });
  });

  it('rejects nested runtime permission options before touching the agent turn runner', async () => {
    const response = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({
        assistantId: 'daily-signal',
        messages: [{ role: 'user', content: 'Run this assistant.' }],
        runtimeOptions: { permissionMode: 'ask', reasoningEffort: 'high' },
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_RUNTIME_OPTIONS',
        message: 'Unknown field: runtimeOptions.permissionMode',
      },
    });
    expect(agentTurnPostMock).not.toHaveBeenCalled();
  });

  it('rejects unsafe assistant ids and spaces before starting a run', async () => {
    const unsafeAssistant = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({ assistantId: '../dreaming' }),
    }));
    expect(unsafeAssistant.status).toBe(400);
    expect(await unsafeAssistant.json()).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ASSISTANT_ID' },
    });

    const unsafeSpace = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({ assistantId: 'dreaming', context: { space: '../Notes' } }),
    }));
    expect(unsafeSpace.status).toBe(400);
    expect(await unsafeSpace.json()).toMatchObject({
      ok: false,
      error: { code: 'INVALID_SPACE' },
    });
    expect(agentTurnPostMock).not.toHaveBeenCalled();
  });
});
