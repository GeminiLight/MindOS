import { describe, expect, it } from 'vitest';
import { toMindosUiAskMessages } from '@/lib/agent/to-agent-messages';
import type { Message } from '@/lib/types';

describe('toMindosUiAskMessages', () => {
  it('filters UI-only agent timeline parts before sending messages to agent runtimes', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'Done',
        timestamp: 10,
        parts: [
          { type: 'text', text: 'Done' },
          { type: 'runtime-status', runtime: 'codex', message: 'Codex is connected.' },
          {
            type: 'agent-run-timeline',
            chatSessionId: 'chat-1',
            updatedAt: 11,
            runs: [
              {
                id: 'run-1',
                agentKind: 'native-runtime',
                runtimeId: 'codex',
                displayName: 'Codex',
                status: 'completed',
                permissionMode: 'agent',
                inputSummary: 'Work',
                outputSummary: 'Done',
                startedAt: 1,
                completedAt: 2,
              },
            ],
          },
        ],
      },
    ];

    expect(toMindosUiAskMessages(messages)).toEqual([
      {
        role: 'assistant',
        content: 'Done',
        timestamp: 10,
        parts: [
          { type: 'text', text: 'Done' },
          { type: 'runtime-status', runtime: 'codex', message: 'Codex is connected.' },
        ],
      },
    ]);
  });
});
