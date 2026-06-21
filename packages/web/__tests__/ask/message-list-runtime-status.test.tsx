// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
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

  it('coalesces streaming auto-scroll work into a single animation frame', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const frames: FrameRequestCallback[] = [];
    const scrollTo = vi.fn();
    const originalRaf = window.requestAnimationFrame;
    const originalCancelRaf = window.cancelAnimationFrame;
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');

    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 640,
    });

    const renderMessages = async (content: string) => {
      const messages: Message[] = [
        { role: 'user', content: 'stream please', timestamp: 1 },
        { role: 'assistant', content, timestamp: 2 },
      ];
      await act(async () => {
        root.render(
          <MessageList
            messages={messages}
            isLoading
            loadingPhase="streaming"
            emptyPrompt="Empty"
            suggestions={[]}
            onSuggestionClick={() => {}}
            labels={labels}
          />,
        );
      });
    };

    try {
      await renderMessages('chunk 1');
      await renderMessages('chunk 2');
      await renderMessages('chunk 3');

      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
      expect(scrollTo).not.toHaveBeenCalled();

      await act(async () => {
        frames.shift()?.(performance.now());
      });

      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'instant' });
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCancelRaf;
      if (originalScrollTo) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
          configurable: true,
          value: originalScrollTo,
        });
      } else {
        delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
      } else {
        delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
      }
      delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    }
  });

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
    expect(html).toContain('data-message-action-dock');
    expect(html).toContain('md:group-hover/message:opacity-100');
    expect(html).not.toContain('content-visibility:auto');
    expect(html).not.toContain('mt-2 flex justify-start');
    expect(html).not.toContain('mt-2 flex justify-end');
  });

  it('renders a generic loading placeholder while native runtime routine statuses are the only parts', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: 'OK',
      },
      {
        role: 'assistant',
        content: '',
        agentId: 'codex',
        agentName: 'Codex',
        agentKind: 'codex',
        parts: [
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
        isLoading
        loadingPhase="thinking"
        emptyPrompt="Empty"
        suggestions={[]}
        onSuggestionClick={() => {}}
        labels={labels}
      />,
    );

    expect(html).toContain('OK');
    expect(html).not.toContain('Starting Codex locally.');
    expect(html).toContain('Thinking');
    expect(html).toContain('/agent-icons/openai.svg');
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

  it('cleans up empty assistant placeholders even when they are not native runtime messages', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: 'hello',
      },
      {
        role: 'assistant',
        content: '',
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

    expect(html).toContain('hello');
    expect(html).not.toContain('prose-panel');
    expect(html).not.toContain('/agent-icons/mindos.svg');
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
                permissionMode: 'read',
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
                permissionMode: 'ask',
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
    expect(html).toContain('read');
    expect(html).toContain('ask');
    expect(html).toContain('Main answer');
  });
});
