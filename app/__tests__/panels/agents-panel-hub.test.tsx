import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentsPanel from '@/components/panels/AgentsPanel';
import { messages } from '@/lib/i18n';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/agents',
  useSearchParams: () => new URLSearchParams('tab=mcp'),
}));

vi.mock('@/hooks/useMcpData', () => ({
  useMcpData: () => ({
    status: {
      running: true,
      port: 8781,
      toolCount: 3,
      transport: 'stdio',
      endpoint: 'http://127.0.0.1:8781/mcp',
      authConfigured: true,
    },
    agents: [
      {
        key: 'test-agent',
        name: 'Test Agent',
        present: true,
        installed: true,
        hasProjectScope: false,
        hasGlobalScope: true,
        preferredTransport: 'stdio' as const,
        format: 'json' as const,
        configKey: 'mcpServers',
        globalPath: '/home/user/.config/claude.json',
        transport: 'stdio',
      },
    ],
    skills: [],
    loading: false,
    refresh: async () => {},
    toggleSkill: async () => {},
    installAgent: async () => true,
  }),
}));

vi.mock('@/lib/LocaleContext', () => ({
  useLocale: () => ({ locale: 'en' as const, setLocale: () => {}, t: messages.en }),
}));

describe('AgentsPanel hub layout', () => {
  it('renders three hub nav rows (Overview, MCP, Skills), roster label, and agent name', () => {
    const html = renderToStaticMarkup(<AgentsPanel active maximized={false} />);
    const a = messages.en.panels.agents;
    expect(html).toContain(a.navOverview);
    expect(html).toContain(a.navMcp);
    expect(html).toContain(a.navSkills);
    expect(html).toContain(a.rosterLabel);
    expect(html).toContain('href="/agents"');
    expect(html).toContain('href="/agents?tab=mcp"');
    expect(html).toContain('href="/agents?tab=skills"');
    expect(html).toContain('Test Agent');
    expect(html).not.toContain('/help');
  });
});
