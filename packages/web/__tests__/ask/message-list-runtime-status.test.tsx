// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MessageList from '@/components/ask/MessageList';
import type { Message } from '@/lib/types';

vi.mock('@/hooks/useAiOrganize', () => ({
  stripThinkingTags: (text: string) => text,
}));

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/components/ask/ToolCallBlock', () => ({ default: () => null }));
vi.mock('@/components/ask/ThinkingBlock', () => ({ default: () => null }));
vi.mock('@/components/ask/SaveSessionInline', () => ({
  SaveMessageButton: () => null,
}));

describe('MessageList runtime status rendering', () => {
  const labels = {
    connecting: 'Connecting',
    thinking: 'Thinking',
    generating: 'Generating',
    copyMessage: 'Copy',
  };

  it('renders visible runtime status as a compact status card without assistant text', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'runtime-status',
            runtime: 'claude',
            message: 'Claude Code HTTP 429; retrying (2/10). Retrying in 1s.',
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      <MessageList
        messages={messages}
        isLoading={false}
        loadingPhase="streaming"
        emptyPrompt="Empty"
        suggestions={[]}
        onSuggestionClick={() => {}}
        labels={labels}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('Claude Code');
    expect(html).toContain('Claude Code HTTP 429; retrying (2/10). Retrying in 1s.');
    expect(html).toContain('/agent-icons/claude.svg');
    expect(html).not.toContain('prose-panel');
  });

  it('uses native runtime icons for native assistant messages', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'Codex result',
        agentId: 'codex',
        agentName: 'Codex',
        agentKind: 'codex',
      },
      {
        role: 'assistant',
        content: 'Claude result',
        agentId: 'claude',
        agentName: 'Claude Code',
        agentKind: 'claude',
      },
    ];

    const html = renderToStaticMarkup(
      <MessageList
        messages={messages}
        isLoading={false}
        loadingPhase="streaming"
        emptyPrompt="Empty"
        suggestions={[]}
        onSuggestionClick={() => {}}
        labels={labels}
      />,
    );

    expect(html).toContain('/agent-icons/openai.svg');
    expect(html).toContain('/agent-icons/claude.svg');
    expect(html).not.toContain('lucide-sparkles');
  });

  it('renders agent run timeline inside assistant messages', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'Main answer',
        parts: [
          { type: 'text', text: 'Main answer' },
          {
            type: 'agent-run-timeline',
            chatSessionId: 'chat-1',
            startedAfter: 1000,
            updatedAt: 2000,
            runs: [
              {
                id: 'run-1',
                chatSessionId: 'chat-1',
                agentKind: 'pi-subagent',
                runtimeId: 'reviewer',
                displayName: 'Reviewer',
                status: 'running',
                permissionMode: 'readonly',
                inputSummary: 'Review the patch.',
                startedAt: 1100,
              },
              {
                id: 'run-2',
                parentRunId: 'run-1',
                chatSessionId: 'chat-1',
                agentKind: 'acp',
                runtimeId: 'gemini',
                displayName: 'Gemini ACP',
                status: 'failed',
                permissionMode: 'agent',
                inputSummary: 'Check external context.',
                error: 'agent crashed',
                startedAt: 1200,
                completedAt: 1800,
                durationMs: 600,
              },
            ],
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      <MessageList
        messages={messages}
        isLoading={false}
        loadingPhase="streaming"
        emptyPrompt="Empty"
        suggestions={[]}
        onSuggestionClick={() => {}}
        labels={labels}
      />,
    );

    expect(html).toContain('Agent activity');
    expect(html).toContain('Reviewer');
    expect(html).toContain('Running');
    expect(html).toContain('1 child run');
    expect(html).toContain('Gemini ACP');
    expect(html).toContain('Failed');
    expect(html).toContain('agent crashed');
    expect(html).toContain('readonly');
    expect(html).toContain('agent');
    expect(html).toContain('Main answer');
  });
});
