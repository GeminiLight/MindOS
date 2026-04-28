// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentSelectorCapsule from '@/components/ask/AgentSelectorCapsule';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      panels: {
        agents: {
          acpDefaultAgent: 'MindOS',
          acpSelectAgent: 'Select Agent',
          acpChangeAgent: 'Change agent',
        },
      },
    },
  }),
}));

describe('AgentSelectorCapsule', () => {
  it('renders the default MindOS capsule even when no ACP agents are installed', () => {
    const html = renderToStaticMarkup(
      <AgentSelectorCapsule
        selectedAgent={null}
        onSelect={vi.fn()}
        installedAgents={[]}
        loading={false}
      />,
    );

    expect(html).toContain('MindOS');
  });
});
