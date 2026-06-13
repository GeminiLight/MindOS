import { beforeEach, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentsPanel from '@/components/panels/AgentsPanel';
import { messages } from '@/lib/i18n';

const runtimeCapabilities = vi.hoisted(() => ({
  ownsModelSelection: false,
  supportsResume: true,
  supportsFreshSession: true,
  supportsListSessions: true,
  supportsAttachExisting: true,
  supportsFork: true,
  supportsArchive: true,
  supportsInterrupt: true,
  supportsModelList: false,
  supportsApprovals: true,
  supportsUserInput: true,
  supportsToolEvents: true,
  supportsRuntimeStatus: true,
  supportsDiffs: true,
  supportsCheckpoints: false,
  supportsBackgroundRuns: false,
  supportsMcpConfig: false,
}));

const routeState = vi.hoisted(() => ({
  pathname: '/agents',
  search: 'tab=agent',
}));

const mcpState = vi.hoisted(() => ({
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
  skills: [] as Array<unknown>,
  loading: false,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => routeState.pathname,
  useSearchParams: () => new URLSearchParams(routeState.search),
}));

vi.mock('@/lib/stores/mcp-store', () => ({
  useMcpData: () => ({
    ...mcpState,
    refresh: async () => {},
    toggleSkill: async () => true,
    installAgent: async () => true,
  }),
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' as const, setLocale: () => {}, t: messages.en }),
}));

vi.mock('@/hooks/useNativeRuntimeDetection', () => ({
  useNativeRuntimeDetection: () => ({
    runtimes: [
      {
        id: 'codex',
        name: 'Codex',
        kind: 'codex',
        adapter: 'codex-app-server',
        modelOwner: 'external',
        authOwner: 'external',
        permissionOwner: 'external',
        sessionOwner: 'external',
        status: 'available',
        capabilities: runtimeCapabilities,
      },
      {
        id: 'claude',
        name: 'Claude Code',
        kind: 'claude',
        adapter: 'claude-sdk',
        modelOwner: 'external',
        authOwner: 'external',
        permissionOwner: 'external',
        sessionOwner: 'external',
        status: 'available',
        capabilities: runtimeCapabilities,
      },
    ],
    loadingByKind: { codex: false, claude: false },
    errorByKind: { codex: null, claude: null },
    refresh: vi.fn(),
  }),
}));

describe('AgentsPanel hub layout', () => {
  beforeEach(() => {
    routeState.pathname = '/agents';
    routeState.search = 'tab=agent';
    mcpState.loading = false;
    mcpState.agents = [
      {
        key: 'test-agent',
        name: 'Test Agent',
        present: true,
        installed: true,
        hasProjectScope: false,
        hasGlobalScope: true,
        preferredTransport: 'stdio',
        format: 'json',
        configKey: 'mcpServers',
        globalPath: '/home/user/.config/claude.json',
        transport: 'stdio',
      },
    ];
    mcpState.skills = [];
  });

  it('renders split hub nav rows and runtime endpoints in the Agent tab', () => {
    const html = renderToStaticMarkup(<AgentsPanel active maximized={false} />);
    const a = messages.en.panels.agents;
    const runtime = messages.en.agentsContent.runtime;
    const localClients = messages.en.agentsContent.localClients;
    expect(html).toContain(a.navOverview);
    expect(html).toContain(a.navAssistant);
    expect(html).toContain(a.navAgent);
    expect(html).toContain(a.navPlugins);
    expect(html).toContain(a.navSkills);
    expect(html).toContain(a.navMcp);
    expect(html).toContain(a.navChannels);
    expect(html).toContain('href="/agents"');
    expect(html).toContain('href="/agents?tab=assistant"');
    expect(html).toContain('href="/agents?tab=agent"');
    expect(html).toContain('href="/agents?tab=plugins"');
    expect(html).toContain('href="/agents?tab=skills"');
    expect(html).toContain('href="/agents?tab=mcp"');
    expect(html).toContain('href="/agents?tab=channels"');
    expect(html).toContain('href="/agents?tab=runs"');
    expect(html).not.toContain('href="/agents?tab=capabilities"');
    expect(html).toContain(runtime.panelTitle);
    expect(html).toContain(runtime.mindosName);
    expect(html).toContain('Codex');
    expect(html).toContain('Claude Code');
    expect(html).not.toContain(runtime.remoteEmpty);
    expect(html).toContain(localClients.panelTitle);
    expect(html).toContain('href="/agents/test-agent"');
    expect(html).toContain('Test Agent');
    expect(html).not.toContain('Your setup');
    expect(html).not.toContain('/help');
  });

  it('keeps the hub nav visible while MCP data is loading', () => {
    routeState.search = 'tab=overview';
    mcpState.loading = true;
    mcpState.agents = [];
    mcpState.skills = [];

    const html = renderToStaticMarkup(<AgentsPanel active maximized={false} />);
    const a = messages.en.panels.agents;

    expect(html).toContain(a.navOverview);
    expect(html).toContain(a.navAssistant);
    expect(html).toContain(a.navAgent);
    expect(html).toContain(a.navChannels);
    expect(html.indexOf(a.navOverview)).toBeLessThan(html.indexOf('aria-busy="true"'));
  });
});
