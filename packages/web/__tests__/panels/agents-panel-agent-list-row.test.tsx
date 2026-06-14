import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentsPanelAgentListRow from '@/components/panels/AgentsPanelAgentListRow';

const agent = {
  key: 'mindos',
  name: 'MindOS',
  present: true,
  installed: true,
  hasProjectScope: false,
  hasGlobalScope: true,
  preferredTransport: 'stdio' as const,
  format: 'json' as const,
  configKey: 'mcpServers',
  globalPath: '/Users/moonshot/MindOS/mind',
  transport: 'stdio',
};

const copy = {
  installing: 'Installing',
  install: 'Install',
  installSuccess: 'Installed',
  installFailed: 'Install failed',
  retryInstall: 'Retry',
};

describe('AgentsPanelAgentListRow active state', () => {
  it('uses the shared sidebar selected style without a heavy ring or left rail', () => {
    const html = renderToStaticMarkup(
      <AgentsPanelAgentListRow
        agent={agent}
        agentStatus="connected"
        selected
        detailHref="/agents/mindos"
        onInstallAgent={vi.fn()}
        copy={copy}
      />,
    );
    const rowClass = html.match(/<div class="([^"]*group flex items-center[^"]*)"/)?.[1] ?? '';

    expect(rowClass).toContain('border-[var(--amber)]/35');
    expect(rowClass).toContain('bg-[var(--amber-dim)]/45');
    expect(rowClass).toContain('shadow-sm');
    expect(rowClass).not.toContain('ring-2');
    expect(rowClass).not.toContain('rounded-r-full');
  });
});
