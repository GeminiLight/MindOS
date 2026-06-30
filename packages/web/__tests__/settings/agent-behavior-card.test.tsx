// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentBehaviorCard } from '@/components/settings/ai/AgentBehaviorCard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const labels = {
  settings: {
    agent: {
      title: 'Agent',
      subtitle: 'Agent behavior',
      maxSteps: 'Max Steps',
      maxStepsHint: 'Max tool call rounds per request',
      contextStrategy: 'Context',
      contextStrategyHint: 'Context strategy',
      contextStrategyAuto: 'Auto',
      contextStrategyOff: 'Off',
      reconnectRetries: 'Reconnect retries',
      reconnectRetriesHint: 'Reconnect retry count',
      thinking: 'Thinking',
      thinkingHint: 'Enable thinking',
      thinkingBudget: 'Thinking budget',
      thinkingBudgetHint: 'Thinking budget tokens',
    },
  },
};

describe('AgentBehaviorCard', () => {
  it('defaults Max Steps to 100 and offers larger presets', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <AgentBehaviorCard
          agent={undefined}
          supportsThinking={false}
          updateAgent={vi.fn()}
          t={labels as Parameters<typeof AgentBehaviorCard>[0]['t']}
        />,
      );
    });

    const maxStepsSelect = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement | null;
    expect(maxStepsSelect?.textContent).toContain('100');

    await act(async () => {
      maxStepsSelect?.click();
    });

    const options = Array.from(host.querySelectorAll('[role="option"]')) as HTMLElement[];
    expect(options.map(option => option.textContent?.trim())).toEqual([
      '10',
      '20',
      '50',
      '100',
      '200',
      '500',
      'Unlimited',
      'Custom',
    ]);

    await act(async () => {
      root.unmount();
    });
  });
});
