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

  it('keeps completed message actions in floating docks outside the bubble flow', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: 'Please summarize this.',
      },
      {
        role: 'assistant',
        content: 'Here is the summary.',
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

    expect(html).toContain('group/message');
    expect(html).toContain('absolute right-3 top-full');
    expect(html).toContain('md:group-hover/message:opacity-100');
    expect(html).not.toContain('mt-2 flex justify-start');
    expect(html).not.toContain('mt-2 flex justify-end');
  });

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

  it('does not render routine native runtime lifecycle status cards from saved messages', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'runtime-status',
            runtime: 'claude',
            message: 'Claude Code is connected and working in this chat.',
          },
          {
            type: 'runtime-status',
            runtime: 'codex',
            message: 'Starting Codex locally.',
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

    expect(html).not.toContain('Claude Code is connected and working in this chat.');
    expect(html).not.toContain('Starting Codex locally.');
    expect(html).not.toContain('role="status"');
  });

  it('keeps native runtime logos without repeating identity badges inside assistant messages', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'Native runtime result one',
        agentId: 'codex',
        agentName: 'Codex',
        agentKind: 'codex',
      },
      {
        role: 'assistant',
        content: 'Native runtime result two',
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

    expect(html).toContain('Native runtime result one');
    expect(html).toContain('Native runtime result two');
    expect(html).toContain('/agent-icons/openai.svg');
    expect(html).toContain('/agent-icons/claude.svg');
    expect(html).not.toContain('<span>Codex</span>');
    expect(html).not.toContain('<span>Claude Code</span>');
  });

  it('keeps an agent capsule for ACP assistant messages', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'Delegated answer',
        agentId: 'gemini',
        agentName: 'Gemini ACP',
        agentKind: 'acp',
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

    expect(html).toContain('Gemini ACP');
    expect(html).toContain('Delegated answer');
    expect(html).toContain('/agent-icons/gemini.svg');
    expect(html).toContain('rounded-full');
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
                permissionMode: 'chat',
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
    expect(html).toContain('chat');
    expect(html).toContain('agent');
    expect(html).toContain('Main answer');
  });
});
