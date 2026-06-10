import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentsPanel from '@/components/panels/AgentsPanel';
import { messages } from '@/lib/i18n';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/agents',
  useSearchParams: () => new URLSearchParams('tab=agent'),
}));

vi.mock('@/lib/stores/mcp-store', () => ({
  useMcpData: () => ({
    status: {
      running: true,
      port: 8781,
      toolCount: 3,
      transport: 'stdio',
      endpoint: 'http://127.0.0.1:8781/mcp',
      authConfigured: true,
      connectionMode: { cli: true, mcp: true },
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
    toggleSkill: async () => true,
    installAgent: async () => true,
  }),
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' as const, setLocale: () => {}, t: messages.en }),
}));

describe('AgentsPanel hub layout', () => {
  it('renders five hub nav rows for the Agents IA and agent name', () => {
    const html = renderToStaticMarkup(<AgentsPanel active maximized={false} />);
    const a = messages.en.panels.agents;
    const capabilitiesLabel = a.navCapabilities.replace('&', '&amp;');
    expect(html).toContain(a.navOverview);
    expect(html).toContain(a.navAssistant);
    expect(html).toContain(a.navAgent);
    expect(html).toContain(capabilitiesLabel);
    expect(html).toContain(a.navChannels);
    expect(html).toContain('href="/agents"');
    expect(html).toContain('href="/agents?tab=assistant"');
    expect(html).toContain('href="/agents?tab=agent"');
    expect(html).toContain('href="/agents?tab=capabilities"');
    expect(html).toContain('href="/agents?tab=channels"');
    expect(html).toContain('href="/agents?tab=runs"');
    expect(html).not.toContain('href="/agents?tab=mcp"');
    expect(html).not.toContain('href="/agents?tab=skills"');
    expect(html).not.toContain('href="/agents?tab=a2a"');
    expect(html).toContain('href="/agents/test-agent"');
    expect(html).toContain('Test Agent');
    expect(html).not.toContain('/help');
  });
});
