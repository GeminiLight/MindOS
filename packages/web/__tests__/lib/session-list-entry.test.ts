import { describe, expect, it, vi } from 'vitest';
import {
  buildChatSessionListEntry,
  buildRuntimeSessionListEntry,
  chatSessionTitle,
  formatSessionListRelativeTime,
  sessionListAgentFilterId,
  sessionListEntryMatchesSearch,
} from '@/lib/session-list-entry';
import type { AgentRuntimeIdentity, ChatSession } from '@/lib/types';
import type { RuntimeSessionEntry } from '@/lib/runtime-session-entry';

describe('session list entry projection', () => {
  it('projects saved MindOS sessions into the same list contract used by runtime sessions', () => {
    const session: ChatSession = {
      id: 'saved-session-123456789',
      title: 'Saved architecture review',
      createdAt: 1,
      updatedAt: Date.parse('2026-06-29T00:00:00.000Z'),
      messages: [
        {
          role: 'user',
          content: 'Review ACP runtime list projection',
          attachedFiles: ['/tmp/spec.md'],
        },
      ],
      defaultAgentRuntime: { id: 'kimi', name: 'Kimi', kind: 'acp' },
      workDir: {
        source: 'manual',
        path: '/Users/moonshot/projects/product/mindos-dev',
        label: 'mindos-dev',
        updatedAt: 1,
      },
      runtimeSessionBinding: {
        kind: 'acp-session',
        runtime: 'acp',
        runtimeId: 'kimi',
        externalSessionId: 'kimi-session-abcdef123456',
        cwd: '/Users/moonshot/projects/product/mindos-dev',
        status: 'active',
        updatedAt: 1,
      },
    };

    const entry = buildChatSessionListEntry(session);

    expect(entry).toMatchObject({
      source: 'chat-session',
      id: 'saved-session-123456789',
      title: 'Saved architecture review',
      preview: 'Review ACP runtime list projection',
      agentKind: 'acp',
      runtimeLabel: 'Kimi',
      compactRuntimePath: '/mindos-dev',
      fullSessionId: 'kimi-session-abcdef123456',
      compactSessionId: 'kimi-ses...123456',
      messageCount: 1,
      hasListContent: true,
      pinned: false,
    });
    expect(entry.metadataTitle).toContain('Session ID: kimi-session-abcdef123456');
    expect(sessionListAgentFilterId(entry)).toBe('acp:kimi');
    expect(sessionListEntryMatchesSearch(entry, 'runtime spec.md')).toBe(true);
    expect(sessionListEntryMatchesSearch(entry, 'missing-term')).toBe(false);
  });

  it('projects native runtime entries into matching display, search, and sort fields', () => {
    const runtime: AgentRuntimeIdentity = { id: 'codex', name: 'Codex', kind: 'codex' };
    const runtimeEntry: RuntimeSessionEntry = {
      id: '019eb06e-a24b-7221-b47d-c2c99cf07b14',
      runtime,
      title: 'Fix runtime switcher',
      preview: 'Continue the native Codex thread manager work',
      cwd: '/Users/moonshot/projects/product/mindos-dev',
      updatedAt: '2026-06-29T00:00:00.000Z',
      status: 'idle',
      messageCount: 4,
    };

    const entry = buildRuntimeSessionListEntry(runtimeEntry);

    expect(entry).toMatchObject({
      source: 'runtime-session',
      id: '019eb06e-a24b-7221-b47d-c2c99cf07b14',
      title: 'Fix runtime switcher',
      preview: 'Continue the native Codex thread manager work',
      agentKind: 'codex',
      runtimeLabel: 'Codex',
      compactRuntimePath: '/mindos-dev',
      compactSessionId: '019eb06e...f07b14',
      status: 'idle',
      updatedAtMs: Date.parse('2026-06-29T00:00:00.000Z'),
      messageCount: 4,
      noun: 'Codex thread',
    });
    expect(entry.metadataTitle).toContain('/Users/moonshot/projects/product/mindos-dev');
    expect(sessionListAgentFilterId(entry)).toBe('codex');
    expect(sessionListEntryMatchesSearch(entry, 'codex switcher')).toBe(true);
  });

  it('keeps relative time and legacy title helpers centralized', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-29T00:30:00.000Z'));

    expect(formatSessionListRelativeTime('2026-06-29T00:00:00.000Z')).toBe('30m ago');
    expect(chatSessionTitle({
      id: 'empty',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    })).toBe('(empty session)');

    vi.useRealTimers();
  });
});
