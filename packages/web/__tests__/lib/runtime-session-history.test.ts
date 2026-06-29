import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRuntimeSessionAdapterCapabilities,
  importBoundRuntimeSessionHistory,
  listRuntimeSessions,
  readRuntimeSessionHistory,
} from '@/lib/runtime-session-history';
import { runtimeSessionEntryTurnsToMessages, type RuntimeSessionEntry } from '@/lib/runtime-session-entry';
import type { AgentRuntimeIdentity, ChatSession } from '@/lib/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('runtime session history adapters', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes Codex and ACP session adapters while leaving Claude unsupported until it provides a list/history API', () => {
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
      supportsList: true,
      supportsReadHistory: true,
      supportsAttachExisting: true,
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

  it('lists ACP runtime sessions by agent id and cwd', async () => {
    const kimiRuntime: AgentRuntimeIdentity = { id: 'kimi', name: 'Kimi', kind: 'acp' };
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.startsWith('/api/agent-runtimes/external-sessions')) {
        return jsonResponse({
          sessions: [{
            id: 'kimi-session-1',
            updatedAt: '2026-06-29T02:01:00.000Z',
            turns: [
              { role: 'user', content: 'inspect the repo', timestamp: 1782698400000 },
              { role: 'assistant', content: 'repo inspected', timestamp: 1782698401000 },
            ],
            messageCount: 2,
          }],
        });
      }
      expect(href).toBe('/api/acp/session');
      expect(init).toMatchObject({ method: 'POST' });
      return jsonResponse({
        sessions: [{
          sessionId: 'kimi-session-1',
          title: 'Kimi repository work',
          cwd: '/tmp/repo',
          updatedAt: '2026-06-29T02:00:00.000Z',
          messageCount: 99,
        }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const entries = await listRuntimeSessions(kimiRuntime, { cwd: '/tmp/repo' });

    expect(fetchMock).toHaveBeenCalledWith('/api/acp/session', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      action: 'list_sessions',
      agentId: 'kimi',
      cwd: '/tmp/repo',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'kimi-session-1',
      title: 'Kimi repository work',
      cwd: '/tmp/repo',
      runtime: kimiRuntime,
      messageCount: 2,
    });
    expect(entries[0]?.turns).toHaveLength(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('/api/agent-runtimes/external-sessions?runtimeId=kimi&limit=30&cwd=%2Ftmp%2Frepo');
  });

  it('falls back to native ACP transcripts when the ACP list endpoint is unavailable', async () => {
    const kimiRuntime: AgentRuntimeIdentity = { id: 'kimi', name: 'Kimi', kind: 'acp' };
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.startsWith('/api/agent-runtimes/external-sessions')) {
        return jsonResponse({
          sessions: [{
            id: 'session-native-only',
            title: 'Native Kimi history',
            cwd: '/tmp/repo',
            turns: [{ role: 'user', content: 'hello from local transcript' }],
            messageCount: 1,
          }],
        });
      }
      return jsonResponse({ error: 'ACP unavailable' }, 503);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listRuntimeSessions(kimiRuntime, { cwd: '/tmp/repo' })).resolves.toMatchObject([{
      id: 'session-native-only',
      title: 'Native Kimi history',
      messageCount: 1,
    }]);
  });

  it('reads ACP history from transcript fields already exposed by the session entry', async () => {
    const kimiRuntime: AgentRuntimeIdentity = { id: 'kimi', name: 'Kimi', kind: 'acp' };
    const entry: RuntimeSessionEntry = {
      id: 'kimi-session-1',
      runtime: kimiRuntime,
      updatedAt: '2026-06-29T02:00:00.000Z',
      turns: [{
        input: 'inspect the repo',
        output: 'repo inspected',
      }],
    };

    const result = await readRuntimeSessionHistory(entry);

    expect(result.entry).toMatchObject({
      id: 'kimi-session-1',
      runtime: kimiRuntime,
      updatedAt: '2026-06-29T02:00:00.000Z',
    });
    expect(result.messages).toEqual([
      {
        role: 'user',
        content: 'inspect the repo',
        timestamp: Date.parse('2026-06-29T02:00:00.000Z'),
        agentId: 'kimi',
        agentName: 'Kimi',
        agentKind: 'acp',
      },
      {
        role: 'assistant',
        content: 'repo inspected',
        timestamp: Date.parse('2026-06-29T02:00:00.000Z'),
        agentId: 'kimi',
        agentName: 'Kimi',
        agentKind: 'acp',
      },
    ]);
  });

  it('loads ACP history from the native importer when the selected entry has no transcript', async () => {
    const kimiRuntime: AgentRuntimeIdentity = { id: 'kimi', name: 'Kimi', kind: 'acp' };
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('/api/agent-runtimes/external-sessions?runtimeId=kimi&limit=1&cwd=%2Ftmp%2Frepo&sessionId=kimi-session-2');
      return jsonResponse({
        sessions: [{
          id: 'kimi-session-2',
          title: 'Imported native history',
          cwd: '/tmp/repo',
          updatedAt: '2026-06-29T03:00:00.000Z',
          turns: [
            { role: 'user', content: 'load native transcript' },
            { role: 'assistant', content: 'native transcript loaded' },
          ],
          messageCount: 2,
        }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await readRuntimeSessionHistory({
      id: 'kimi-session-2',
      runtime: kimiRuntime,
      cwd: '/tmp/repo',
      title: 'ACP metadata only',
      updatedAt: '2026-06-29T02:00:00.000Z',
    });

    expect(result.entry).toMatchObject({
      id: 'kimi-session-2',
      title: 'ACP metadata only',
      cwd: '/tmp/repo',
      messageCount: 2,
    });
    expect(result.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'load native transcript'],
      ['assistant', 'native transcript loaded'],
    ]);
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
