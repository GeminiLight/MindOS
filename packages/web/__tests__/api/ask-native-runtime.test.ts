import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { seedFile } from '../setup';
import { invalidateCache } from '../../lib/fs';
import type { MindosAgentRuntimeAskOptions } from '@geminilight/mindos/agent-runtime';

let capturedNativeOptions: MindosAgentRuntimeAskOptions | null = null;
const mockDetectLocalAcpAgents = vi.fn();
const mockResolveCommandPath = vi.fn();
const mockCheckNativeRuntimeHealth = vi.fn();

vi.mock('@/lib/acp/detect-local', () => ({
  detectLocalAcpAgents: mockDetectLocalAcpAgents,
  resolveCommandPath: mockResolveCommandPath,
  checkNativeRuntimeHealth: mockCheckNativeRuntimeHealth,
}));

vi.mock('@geminilight/mindos/agent-runtime', () => ({
  runMindosAgentRuntimeAskSession: vi.fn(async (options: MindosAgentRuntimeAskOptions) => {
    capturedNativeOptions = options;
    options.send({ type: 'text_delta', delta: 'native ok' });
    options.send({ type: 'done' });
    return { externalSessionId: 'thr_123' };
  }),
}));

vi.mock('@geminilight/mindos/session/pi-coding-agent', () => ({
  createMindosPiCodingAgentRuntime: vi.fn(() => {
    throw new Error('pi runtime should not initialize for native runtime requests');
  }),
}));

function askRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ask', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/ask native runtime routing', () => {
  beforeEach(() => {
    capturedNativeOptions = null;
    mockDetectLocalAcpAgents.mockReset();
    mockResolveCommandPath.mockReset();
    mockCheckNativeRuntimeHealth.mockReset();
  });

  it('routes Codex before MindOS pi runtime initialization and bridges MindOS context', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({
      installed: [
        { id: 'codex-acp', name: 'Codex', binaryPath: '/usr/local/bin/codex', status: 'available' },
      ],
      notInstalled: [],
    });
    seedFile('current.md', '# Current\nCurrent file body');
    seedFile('attached.md', '# Attached\nAttached file body');
    invalidateCache();

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Use the attached context' }],
      currentFile: 'current.md',
      attachedFiles: ['attached.md'],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      runtimeBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thr_existing',
        status: 'active',
        updatedAt: 1,
      },
      providerOverride: 'anthropic',
      modelOverride: 'claude-test',
      mode: 'agent',
    }));

    expect(res.status).toBe(200);
    await res.text();

    expect(capturedNativeOptions?.runtime).toEqual({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      externalSessionId: 'thr_existing',
    });
    expect(capturedNativeOptions?.prompt).toContain('MindOS Turn Context');
    expect(capturedNativeOptions?.prompt).toContain('Use the attached context');
    expect(capturedNativeOptions?.prompt).toContain('current.md');
    expect(capturedNativeOptions?.prompt).toContain('Current file body');
    expect(capturedNativeOptions?.prompt).toContain('attached.md');
    expect(capturedNativeOptions?.prompt).toContain('Attached file body');
    expect(capturedNativeOptions?.prompt).not.toContain('claude-test');
    expect(mockDetectLocalAcpAgents).not.toHaveBeenCalled();
    expect(mockResolveCommandPath).toHaveBeenCalledWith('codex');
    expect(mockResolveCommandPath).not.toHaveBeenCalledWith('claude');
  });

  it('rejects a native runtime request when forced availability recheck reports it unavailable', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockImplementation(async ({ runtime }) => (
      runtime === 'codex'
        ? { status: 'signed-out', reason: 'Run codex login first.' }
        : { status: 'error', reason: 'not checked' }
    ));
    mockDetectLocalAcpAgents.mockResolvedValue({
      installed: [
        {
          id: 'codex-acp',
          name: 'Codex',
          binaryPath: '/usr/local/bin/codex',
          status: 'signed-out',
          reason: 'Run codex login first.',
        },
      ],
      notInstalled: [],
    });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Use Codex' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      mode: 'agent',
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { message: 'Codex is signed out. Run codex login first.' },
    });
    expect(capturedNativeOptions).toBeNull();
  });
});
