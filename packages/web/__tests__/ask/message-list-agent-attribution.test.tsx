// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
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

describe('MessageList agent attribution', () => {
  const labels = {
    connecting: 'Connecting',
    thinking: 'Thinking',
    generating: 'Generating',
    copyMessage: 'Copy',
  };

  it('renders the agent badge above assistant replies', () => {
    const messages: Message[] = [
      { role: 'assistant', content: 'Hello from Claude.', agentId: 'claude-code', agentName: 'Claude Code' },
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

    expect(html).toContain('Claude Code');
    expect(html).toContain('Hello from Claude.');
    expect(html).toContain('lucide-bot');
  });

  it('keeps the agent badge visible on assistant error bubbles', () => {
    const messages: Message[] = [
      { role: 'assistant', content: '__error__ACP Agent Error: timeout', agentId: 'claude-code', agentName: 'Claude Code' },
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

    expect(html).toContain('Claude Code');
    expect(html).toContain('ACP Agent Error: timeout');
    expect(html).toContain('lucide-bot');
  });
});
