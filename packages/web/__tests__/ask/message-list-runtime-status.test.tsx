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
    runThinking: (_runtime: string) => 'Thinking with you',
    awaitingFirstOutput: 'Waiting for the first output',
    toolRunningProgress: (tool: string) => `Running ${tool}`,
    permissionWaiting: 'Waiting for your approval',
    questionWaiting: 'Waiting for your answer',
    contextCompacting: 'Compacting context',
    elapsedSeconds: (seconds: number) => `${seconds}s`,
    reconnectingDetail: (attempt: number, max: number) => `Attempt ${attempt} of ${max}`,
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

  it('renders message timestamps with actions in metadata rows outside the bubble flow', () => {
    const userTimestamp = Date.parse('2026-06-30T15:41:00.000Z');
    const assistantTimestamp = Date.parse('2026-06-30T15:42:00.000Z');
    const expectedUserTime = new Date(userTimestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const expectedAssistantTime = new Date(assistantTimestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const messages: Message[] = [
      {
        role: 'user',
        content: 'Please summarize this.',
        timestamp: userTimestamp,
      },
      {
        role: 'assistant',
        content: 'Here is the summary.',
        timestamp: assistantTimestamp,
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
    expect(html).toContain('data-message-meta');
    expect(html).toContain('data-message-meta-card');
    expect(html).toContain(`data-message-timestamp="${new Date(userTimestamp).toISOString()}"`);
    expect(html).toContain(`data-message-timestamp="${new Date(assistantTimestamp).toISOString()}"`);
    expect(html).toContain(expectedUserTime);
    expect(html).toContain(expectedAssistantTime);
    expect(html).toContain('data-message-actions');
    const firstCardIndex = html.indexOf('data-message-meta-card');
    const firstTimeIndex = html.indexOf(`data-message-timestamp="${new Date(userTimestamp).toISOString()}"`);
    const firstActionsIndex = html.indexOf('data-message-actions', firstCardIndex);
    expect(firstCardIndex).toBeGreaterThanOrEqual(0);
    expect(firstTimeIndex).toBeGreaterThan(firstCardIndex);
    expect(firstActionsIndex).toBeGreaterThan(firstTimeIndex);
    expect(html).toContain('absolute top-full');
    expect(html).toContain('flex pt-1 opacity-0');
    expect(html).not.toContain('top-full z-20 mt-1');
    expect(html).toContain('opacity-0');
    expect(html).toContain('md:group-hover/message:opacity-100');
    expect(html).not.toContain('absolute right-3 top-full');
    expect(html).not.toContain('data-message-action-dock');
    expect(html).not.toContain('content-visibility:auto');
    expect(html).not.toContain('mt-2 flex justify-start');
    expect(html).not.toContain('mt-2 flex justify-end');
  });

  it('keeps assistant markdown bubbles inside the chat row when long inline code is present', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          '缺失项：',
          '',
          '- `Tianfu Wang 个人主页摘录（2026-05-16）.md` 实际位于 `👤 画像/资料源/`',
          '- `CV 20260410 处理说明.md` 未读取',
          '- `Publications.csv` 未读取',
        ].join('\n'),
        agentKind: 'mindos',
        agentName: 'MindOS',
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

    expect(html).toContain('max-w-[calc(100%_-_2.5rem)]');
    expect(html).toContain('min-w-0 flex-col items-start');
    expect(html).toContain('[overflow-wrap:anywhere]');
    expect(html).toContain('prose-code:break-words');
    expect(html).toContain('prose-code:[overflow-wrap:anywhere]');
    expect(html).toContain('prose-pre:max-w-full');
    expect(html).not.toContain('relative flex max-w-[85%] flex-col items-start');
  });

  it('keeps routine native runtime lifecycle details out of the run progress', () => {
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
          {
            type: 'runtime-status',
            runtime: 'codex',
            message: 'Codex is connected and working in this chat.',
          },
          {
            type: 'runtime-status',
            runtime: 'claude',
            message: 'Claude Code is contacting Claude.',
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
    expect(html).not.toContain('Codex is connected and working in this chat.');
    expect(html).not.toContain('Claude Code is contacting Claude.');
    expect(html).toContain('Thinking with you');
    expect(html).not.toContain('Codex is Thinking with you');
    expect(html).not.toContain('Waiting for the first output');
    expect(html).toContain('data-run-progress');
    expect(html).not.toContain('border-border/35 bg-muted/25');
  });

  it('keeps compacting context visible as a meaningful runtime status', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'runtime-status',
            runtime: 'claude',
            message: 'Claude Code is compacting context.',
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
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

    expect(html).toContain('role="status"');
    expect(html).toContain('Claude Code');
    expect(html).toContain('Compacting context');
  });

  it('renders the normal thinking status as a run-level footer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(12_500);
    try {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'hello',
          timestamp: 1_000,
        },
        {
          role: 'assistant',
          content: '',
          timestamp: 1_000,
          agentKind: 'codex',
          agentName: 'Codex',
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

      expect(html).toContain('Thinking with you');
      expect(html).not.toContain('MindOS is Thinking with you');
      expect(html).not.toContain('Waiting for the first output');
      expect(html).toContain('11s');
      expect(html).toContain('data-run-progress');
      expect(html).toContain('data-run-progress-footer');
      expect(html).toContain('!mt-2');
      const footerHtml = html.slice(html.lastIndexOf('data-run-progress-footer'));
      expect(footerHtml).toContain('data-run-progress-agent-logo="codex"');
      expect(footerHtml).toContain('/agent-icons/openai.svg');
      expect(footerHtml).not.toContain('data-run-progress-activity-mark');
      expect(html).not.toContain('border-border/35 bg-muted/25');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the MindOS logo while the run starts before an assistant row exists', () => {
    vi.useFakeTimers();
    vi.setSystemTime(4_000);
    try {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'hello',
          timestamp: 1_000,
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

      const footerHtml = html.slice(html.lastIndexOf('data-run-progress-footer'));
      expect(footerHtml).toContain('Thinking with you');
      expect(footerHtml).toContain('data-run-progress-agent-logo="mindos"');
      expect(footerHtml).toContain('/agent-icons/mindos.svg');
      expect(footerHtml).not.toContain('data-run-progress-activity-mark');
    } finally {
      vi.useRealTimers();
    }
  });

  it('times a newly-started run from the latest user message before the assistant row exists', () => {
    vi.useFakeTimers();
    vi.setSystemTime(125_000);
    try {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'old prompt',
          timestamp: 1_000,
        },
        {
          role: 'assistant',
          content: 'old answer',
          timestamp: 2_000,
        },
        {
          role: 'user',
          content: 'new prompt',
          timestamp: 120_000,
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

      const footerHtml = html.slice(html.lastIndexOf('data-run-progress-footer'));
      expect(footerHtml).toContain('Thinking with you');
      expect(footerHtml).toContain('5s');
      expect(footerHtml).not.toContain('123s');
      expect(footerHtml).toContain('data-run-progress-agent-logo="mindos"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the lightweight thinking footer while the assistant already has content', () => {
    vi.useFakeTimers();
    vi.setSystemTime(7_500);
    try {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'summarize',
          timestamp: 1_000,
        },
        {
          role: 'assistant',
          content: 'I found the files.',
          timestamp: 1_000,
          parts: [
            {
              type: 'text',
              text: 'I found the files.',
            },
            {
              type: 'tool-call',
              toolCallId: 'tool-1',
              toolName: 'read_file',
              input: { path: 'README.md' },
              state: 'running',
            },
          ],
        },
      ];

      const html = renderToStaticMarkup(
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

      expect(html).toContain('I found the files.');
      expect(html).toContain('data-run-progress-footer');
      expect(html).toContain('Thinking with you');
      expect(html).not.toContain('MindOS is Thinking with you');
      const footerHtml = html.slice(html.lastIndexOf('data-run-progress-footer'));
      expect(footerHtml).toContain('ml-10');
      expect(footerHtml).not.toContain('/agent-icons/mindos.svg');
      expect(footerHtml).not.toContain('data-run-progress-agent-logo');
      expect(html).toContain('6s');
      expect(html.indexOf('I found the files.')).toBeLessThan(html.lastIndexOf('data-run-progress-footer'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps active tool, permission, question, and reconnect runs on the same lightweight footer', () => {
    const baseProps = {
      isLoading: true,
      loadingPhase: 'streaming' as const,
      emptyPrompt: 'Empty',
      suggestions: [],
      onSuggestionClick: () => {},
      labels,
    };

    const toolHtml = renderToStaticMarkup(
      <MessageList
        {...baseProps}
        messages={[{
          role: 'assistant',
          content: '',
          parts: [{
            type: 'tool-call',
            toolCallId: 'tool-1',
            toolName: 'Bash',
            input: { command: 'npm test' },
            state: 'running',
          }],
        }]}
      />,
    );
    expect(toolHtml).toContain('data-run-progress-footer');
    expect(toolHtml).toContain('Thinking with you');
    expect(toolHtml).not.toContain('MindOS is Thinking with you');
    expect(toolHtml).not.toContain('Running Bash');

    const permissionHtml = renderToStaticMarkup(
      <MessageList
        {...baseProps}
        messages={[{
          role: 'assistant',
          content: '',
          parts: [{
            type: 'tool-call',
            toolCallId: 'tool-2',
            toolName: 'Bash',
            input: { command: 'rm file' },
            state: 'running',
            runtimePermission: {
              runId: 'run-1',
              requestId: 'req-1',
              runtime: 'codex',
              status: 'waiting',
              options: [],
              resource: 'rm file',
            },
          }],
        }]}
      />,
    );
    expect(permissionHtml).toContain('data-run-progress-footer');
    expect(permissionHtml).toContain('Thinking with you');
    expect(permissionHtml).not.toContain('MindOS is Thinking with you');
    expect(permissionHtml).not.toContain('Waiting for your approval');

    const questionHtml = renderToStaticMarkup(
      <MessageList
        {...baseProps}
        messages={[{
          role: 'assistant',
          content: '',
          parts: [{
            type: 'tool-call',
            toolCallId: 'tool-3',
            toolName: 'ask_user_question',
            input: {},
            state: 'running',
            userQuestion: {
              runId: 'run-1',
              status: 'waiting',
              questions: [{ header: 'Choose path', question: 'Which path?', options: [] }],
            },
          }],
        }]}
      />,
    );
    expect(questionHtml).toContain('data-run-progress-footer');
    expect(questionHtml).toContain('Thinking with you');
    expect(questionHtml).not.toContain('MindOS is Thinking with you');
    expect(questionHtml).not.toContain('Waiting for your answer');

    const reconnectHtml = renderToStaticMarkup(
      <MessageList
        messages={[{ role: 'assistant', content: '', timestamp: Date.now() }]}
        isLoading
        loadingPhase="reconnecting"
        reconnectAttempt={2}
        reconnectMax={3}
        emptyPrompt="Empty"
        suggestions={[]}
        onSuggestionClick={() => {}}
        labels={{ ...labels, reconnecting: 'Reconnecting' }}
      />,
    );
    expect(reconnectHtml).toContain('data-run-progress-footer');
    expect(reconnectHtml).toContain('Thinking with you');
    expect(reconnectHtml).not.toContain('MindOS is Thinking with you');
    expect(reconnectHtml).not.toContain('Reconnecting');
    expect(reconnectHtml).not.toContain('Attempt 2 of 3');
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
