import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import AgentsContentPage from '@/components/agents/AgentsContentPage';
import AgentDetailContent from '@/components/agents/AgentDetailContent';
import { messages } from '@/lib/i18n';

const baseMcpState = {
  status: {
    running: true,
    transport: 'stdio',
    endpoint: 'http://127.0.0.1:8781/mcp',
    port: 8781,
    toolCount: 12,
    authConfigured: true,
  },
  agents: [
    {
      key: 'cursor',
      name: 'Cursor',
      present: true,
      installed: true,
      hasProjectScope: true,
      hasGlobalScope: true,
      preferredTransport: 'stdio' as const,
      format: 'json' as const,
      configKey: 'mcpServers',
      globalPath: '/tmp/cursor.json',
      transport: 'stdio',
    },
    {
      key: 'codex',
      name: 'Codex',
      present: true,
      installed: false,
      hasProjectScope: true,
      hasGlobalScope: false,
      preferredTransport: 'http' as const,
      format: 'json' as const,
      configKey: 'mcpServers',
      globalPath: '/tmp/codex.json',
    },
    {
      key: 'ghost',
      name: 'Ghost Agent',
      present: false,
      installed: false,
      hasProjectScope: false,
      hasGlobalScope: false,
      preferredTransport: 'stdio' as const,
      format: 'json' as const,
      configKey: 'mcpServers',
      globalPath: '/tmp/ghost.json',
    },
  ],
  skills: [
    { name: 'mindos', description: 'kb ops', path: '/skills/mindos', source: 'builtin' as const, enabled: true, editable: false },
    { name: 'custom-routing', description: 'route notes', path: '/skills/custom', source: 'user' as const, enabled: false, editable: true },
  ],
  loading: false,
  refresh: async () => {},
  toggleSkill: async () => true,
  installAgent: async () => true,
};

vi.mock('@/hooks/useMcpData', () => ({
  useMcpData: () => baseMcpState,
}));

vi.mock('@/lib/LocaleContext', () => ({
  useLocale: () => ({ locale: 'en' as const, setLocale: () => {}, t: messages.en }),
}));

describe('Agents content dashboard', () => {
  it('renders overview without top segment nav', () => {
    const html = renderToStaticMarkup(<AgentsContentPage tab="overview" />);
    const a = messages.en.agentsContent;

    expect(html).toContain(a.title);
    expect(html).toContain(a.overview.riskQueue);
    expect(html).not.toContain('role="tablist"');
  });

  it('renders mcp manage/topology sections with table actions', () => {
    const html = renderToStaticMarkup(<AgentsContentPage tab="mcp" />);
    const a = messages.en.agentsContent;

    expect(html).not.toContain('role="tablist"');
    expect(html).toContain(a.mcp.tabs.manage);
    expect(html).toContain(a.mcp.tabs.topology);
    expect(html).toContain(a.mcp.connectionGraph);
    expect(html).toContain(a.mcp.searchPlaceholder);
    expect(html).toContain(a.mcp.filters.all);
    expect(html).toContain(a.mcp.resultCount(baseMcpState.agents.length));
    expect(html).toContain(a.mcp.table.agent);
    expect(html).toContain(a.mcp.actions.copySnippet);
    expect(html).toContain(a.mcp.actions.testConnection);
    expect(html).toContain(a.mcp.actions.reconnect);
  });

  it('renders skills focused header and section tabs', () => {
    const html = renderToStaticMarkup(<AgentsContentPage tab="skills" />);
    const a = messages.en.agentsContent;

    expect(html).toContain(a.skills.title);
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain(a.skills.tabs.manage);
    expect(html).toContain(a.skills.tabs.matrix);
    expect(html).toContain(a.skills.searchPlaceholder);
    expect(html).toContain(a.skills.statusAttention);
    expect(html).toContain(a.skills.bulkEnableFiltered);
    expect(html).toContain(a.skills.capabilityGroups);
    expect(html).toContain('custom-routing');
  });
});

describe('Agent detail content', () => {
  it('renders detail modules for existing agent', () => {
    const html = renderToStaticMarkup(<AgentDetailContent agentKey="cursor" />);
    const a = messages.en.agentsContent.detail;

    expect(html).toContain(a.identity);
    expect(html).toContain(a.connection);
    expect(html).toContain(a.capabilities);
    expect(html).toContain(a.skillAssignments);
    expect(html).toContain(a.recentActivity);
    expect(html).toContain(a.spaceReach);
  });

  it('renders not-found state for missing agent key', () => {
    const html = renderToStaticMarkup(<AgentDetailContent agentKey="missing-agent" />);
    const a = messages.en.agentsContent;
    expect(html).toContain(a.detailNotFound);
  });
});
