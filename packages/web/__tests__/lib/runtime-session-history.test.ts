import { describe, expect, it, vi } from 'vitest';
import {
  getRuntimeSessionAdapterCapabilities,
  importBoundRuntimeSessionHistory,
} from '@/lib/runtime-session-history';
import { runtimeSessionEntryTurnsToMessages, type RuntimeSessionEntry } from '@/lib/runtime-session-entry';
import type { AgentRuntimeIdentity, ChatSession } from '@/lib/types';

describe('runtime session history adapters', () => {
  it('exposes Codex as one adapter while leaving Claude and ACP unsupported until they provide history APIs', () => {
    expect(getRuntimeSessionAdapterCapabilities({ id: 'codex', name: 'Codex', kind: 'codex' })).toMatchObject({
      supportsList: true,
      supportsReadHistory: true,
      supportsFork: true,
      supportsArchive: true,
    });

    expect(getRuntimeSessionAdapterCapabilities({ id: 'claude', name: 'Claude Code', kind: 'claude' })).toMatchObject({
      supportsList: false,
      supportsReadHistory: false,
      supportsFork: false,
      supportsArchive: false,
    });

    expect(getRuntimeSessionAdapterCapabilities({ id: 'kimi', name: 'Kimi', kind: 'acp' })).toMatchObject({
      supportsList: false,
      supportsReadHistory: false,
      supportsFork: false,
      supportsArchive: false,
    });
  });

  it('skips unsupported bound runtime history without calling attach', async () => {
    const claudeRuntime: AgentRuntimeIdentity = { id: 'claude', name: 'Claude Code', kind: 'claude' };
    const session: ChatSession = {
      id: 's-claude',
      title: 'Claude local session',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      defaultAgentRuntime: claudeRuntime,
      runtimeSessionBinding: {
        kind: 'claude-session',
        runtime: 'claude',
        runtimeId: 'claude',
        externalSessionId: 'session_123',
        status: 'active',
        updatedAt: 1,
      },
    };
    const attach = vi.fn(() => true);

    await expect(importBoundRuntimeSessionHistory(session, claudeRuntime, attach)).resolves.toEqual({
      status: 'skipped',
      reason: 'unsupported-runtime',
    });
    expect(attach).not.toHaveBeenCalled();
  });
});

describe('runtime session entry message extraction', () => {
  it('imports ACP-shaped message arrays through the shared entry parser', () => {
    const kimiRuntime: AgentRuntimeIdentity = { id: 'kimi', name: 'Kimi', kind: 'acp' };
    const entry: RuntimeSessionEntry = {
      id: 'kimi-session-1',
      runtime: kimiRuntime,
      updatedAt: '2026-06-29T00:00:00.000Z',
      turns: [{
        messages: [
          { role: 'user', content: 'summarize this file' },
          { role: 'assistant', content: 'summary ready' },
        ],
      }],
    };

    expect(runtimeSessionEntryTurnsToMessages(entry)).toEqual([
      {
        role: 'user',
        content: 'summarize this file',
        timestamp: Date.parse('2026-06-29T00:00:00.000Z'),
        agentId: 'kimi',
        agentName: 'Kimi',
        agentKind: 'acp',
      },
      {
        role: 'assistant',
        content: 'summary ready',
        timestamp: Date.parse('2026-06-29T00:00:00.000Z'),
        agentId: 'kimi',
        agentName: 'Kimi',
        agentKind: 'acp',
      },
    ]);
  });
});
