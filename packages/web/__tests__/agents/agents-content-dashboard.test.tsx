import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import AgentsContentPage from '@/components/agents/AgentsContentPage';
import AgentDetailContent from '@/components/agents/AgentDetailContent';
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

const baseMcpState = {
  status: {
    running: true,
    transport: 'stdio',
    endpoint: 'http://127.0.0.1:8781/mcp',
    port: 8781,
    toolCount: 12,
    authConfigured: true,
    connectionMode: { cli: true, mcp: true },
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
      skillMode: 'universal' as const,
      hiddenRootPath: '/home/test/.cursor',
      hiddenRootPresent: true,
      runtimeConversationSignal: true,
      runtimeUsageSignal: true,
      runtimeLastActivityAt: '2026-03-24T00:00:00.000Z',
      configuredMcpServers: ['mindos', 'github'],
      configuredMcpServerCount: 2,
      installedSkillNames: ['mindos', 'custom-routing', 'cursor-native-helper'],
      installedSkillCount: 3,
      installedSkillSourcePath: '/home/test/.cursor/skills',
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
      skillMode: 'universal' as const,
      hiddenRootPath: '/home/test/.codex',
      hiddenRootPresent: true,
      runtimeConversationSignal: false,
      runtimeUsageSignal: false,
      configuredMcpServers: ['mindos'],
      configuredMcpServerCount: 1,
      installedSkillNames: ['mindos'],
      installedSkillCount: 1,
      installedSkillSourcePath: '/home/test/.codex/skills',
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
      skillMode: 'additional' as const,
      hiddenRootPath: '/home/test/.ghost',
      hiddenRootPresent: false,
      runtimeConversationSignal: false,
      runtimeUsageSignal: false,
      configuredMcpServers: [],
      configuredMcpServerCount: 0,
      installedSkillNames: [],
      installedSkillCount: 0,
    },
    {
      key: 'workbuddy',
      name: 'WorkBuddy',
      present: false,
      installed: false,
      isCustom: true,
      hasProjectScope: false,
      hasGlobalScope: true,
      preferredTransport: 'stdio' as const,
      format: 'json' as const,
      configKey: 'mcpServers',
      globalPath: '/tmp/workbuddy/mcp.json',
      customBaseDir: '~/.workbuddy/',
      skillMode: 'additional' as const,
      hiddenRootPath: '/home/test/.workbuddy',
      hiddenRootPresent: false,
      runtimeConversationSignal: false,
      runtimeUsageSignal: false,
      configuredMcpServers: [],
      configuredMcpServerCount: 0,
      installedSkillNames: [],
      installedSkillCount: 0,
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

vi.mock('@/lib/stores/mcp-store', () => ({
  useMcpData: () => baseMcpState,
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
        runtimeBridge: { kind: 'codex-app-server', label: 'Codex app-server' },
        binaryPath: '/usr/local/bin/codex',
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
        runtimeBridge: { kind: 'claude-sdk', label: 'Claude Code SDK' },
      },
    ],
    loadingByKind: { codex: false, claude: false },
    errorByKind: { codex: null, claude: null },
    refresh: vi.fn(),
  }),
}));

describe('Agents content dashboard', () => {
  it('renders overview with split IA groups and clickable system model', () => {
    const html = renderToStaticMarkup(<AgentsContentPage tab="overview" />);
    const a = messages.en.agentsContent;
    const capabilitiesLabel = a.overview.capabilitiesLabel.replace('&', '&amp;');
    const navCapabilities = a.navCapabilities.replace('&', '&amp;');
    const channelsHint = a.navHints.channels.replace('&', '&amp;');

    expect(html).toContain('data-content-page-shell="agents"');
    expect(html).toContain('content-width');
    expect(html).toContain('workbench-content-page');
    expect(html).toContain('agents-content-page');
    expect(html).toContain(a.title);
    expect(html).toContain(a.navAriaLabel);
    expect(html).toContain(a.navHints.overview);
    expect(html).toContain(a.navHints.assistant);
    expect(html).toContain(a.navHints.agent);
    expect(html).toContain(a.navHints.capabilities.replace('&', '&amp;'));
    expect(html).toContain(channelsHint);
    expect(html).not.toContain('MCP :8781');
    expect(html).toContain('href="/agents?tab=assistant"');
    expect(html).toContain('href="/agents?tab=agent"');
    expect(html).toContain('href="/agents?tab=skills"');
    expect(html).toContain('href="/agents?tab=channels"');
    expect(html).toContain(navCapabilities);
    expect(html).toContain(a.overview.systemModelTitle);
    expect(html).toContain(a.overview.assistantLabel);
    expect(html).toContain(a.overview.agentLabel);
    expect(html).toContain(capabilitiesLabel);
    expect(html).toContain(a.overview.channelsLabel);
    expect(html).toContain(a.overview.recentActivity);
    expect(html).toContain(a.overview.nextActionsTitle);
    expect(html).not.toContain('/agents?tab=presets');
    expect(html).not.toContain('/agents?tab=capabilities');
    expect(html).not.toContain('/agents?tab=a2a');
    expect(html).not.toContain('/agents?tab=activity');
    // Hidden/legacy agent card wall is not part of the overview anymore.
    expect(html).not.toContain('Ghost Agent');
  });

  it('renders Agent section as runtime endpoints instead of MCP management', () => {
    const html = renderToStaticMarkup(<AgentsContentPage tab="agent" />);
    const a = messages.en.agentsContent;

    expect(html).toContain(a.runtime.title);
    expect(html).toContain(a.runtime.mindosName);
    expect(html).toContain('Codex');
    expect(html).toContain('Claude Code');
    expect(html).toContain(a.runtime.openChatWith('Codex'));
    expect(html).toContain(a.agentOverview.title);
    expect(html).toContain('href="#agent-local-runtime"');
    expect(html).toContain('href="#agent-local-clients"');
    expect(html).toContain('href="#agent-remote-acp"');
    expect(html).toContain('href="#agent-remote-a2a"');
    expect(html).toContain(a.localClients.title);
    expect(html).toContain(a.localClients.statusConnected);
    expect(html).toContain(a.localClients.statusDetected);
    expect(html).toContain(a.localClients.groupNotFound);
    expect(html).toContain(a.localClients.addCustomClient);
    expect(html).toContain(a.localClients.groupCustom);
    expect(html).toContain('WorkBuddy');
    expect(html).toContain(a.localClients.editCustomClient);
    expect(html).toContain(a.localClients.removeCustomClient);
    expect(html).toContain(a.acpAgents.title);
    expect(html).toContain(a.acpAgents.description);
    expect(html).toContain(a.a2aAgents.title);
    expect(html).toContain(a.a2aAgents.description);
    expect(html).toContain('Cursor');
    expect(html).toContain('/agent-icons/openai.svg');
    expect(html).toContain('/agent-icons/claude.svg');
    expect(html).not.toContain(a.localClients.skillCount(3));
    expect(html).not.toContain(a.localClients.projectScope);
    expect(html).not.toContain(a.localClients.globalScope);
    expect(html).not.toContain(a.runtime.remoteEmpty);
    expect(html).not.toContain(a.runtime.contractModelTitle);
    expect(html).not.toContain(a.runtime.contractPermissionTitle);
    expect(html).not.toContain(a.runtime.contractSessionTitle);
    expect(html).not.toContain(a.mcp.tabs.byAgent);
    expect(html).not.toContain(a.mcp.tabs.byServer);
    expect(html).not.toContain(a.mcp.connectionGraph);
    expect(html).not.toContain(a.mcp.searchServersPlaceholder);
    expect(html).not.toContain('github');
  });

  it('renders Skills as a dedicated section', () => {
    const html = renderToStaticMarkup(<AgentsContentPage tab="skills" />);
    const a = messages.en.agentsContent;

    expect(html).toContain(a.skills.title);
    expect(html).toContain(a.skills.tabs.bySkill);
    expect(html).toContain(a.skills.tabs.byAgent);
    expect(html).toContain(a.skills.searchPlaceholder);
    expect(html).toContain(a.skills.statusAttention);
    expect(html).toContain(a.skills.summaryEnabled(1));
    expect(html).toContain(a.skills.summaryDisabled(1));
    expect(html).toContain(a.skills.bulkEnableFiltered);
    expect(html).toContain(a.skills.bulkDisableFiltered);
    // Skill names (e.g. 'custom-routing', 'mindos') are inside Virtuoso which
    // doesn't inflate items in renderToStaticMarkup (no viewport/scroll height).
    // Skill rendering is validated via Virtuoso's data prop, not DOM assertion.
  });

  it('renders MCP as a dedicated section without the old connection wrapper copy', () => {
    const html = renderToStaticMarkup(<AgentsContentPage tab="mcp" />);
    const a = messages.en.agentsContent;

    expect(html).toContain(a.mcp.title);
    expect(html).toContain(a.mcp.tabs.byAgent);
    expect(html).toContain(a.mcp.tabs.byServer);
    expect(html).toContain(a.mcp.searchServersPlaceholder);
    expect(html).toContain('mindos');
    expect(html).not.toContain(a.mcp.connectionGraph);
  });

  it('renders the Assistant local-library shell before dynamic profiles load', () => {
    const html = renderToStaticMarkup(<AgentsContentPage tab="assistant" />);
    const a = messages.en.agentsContent;

    expect(html).toContain(a.presets.title);
    expect(html).toContain(a.presets.presetRail);
    expect(html).toContain(a.presets.libraryHint);
    expect(html).toContain(a.presets.localRoot);
    expect(html).toContain(a.presets.localRootHint);
    expect(html).toContain(a.presets.loading);
    expect(html).not.toContain('.mindos/assistants');
    expect(html).not.toContain('Inbox Organizer');
    expect(html).not.toContain('Open Inbox review');
    expect(html).not.toContain('/capture#queue');
    expect(html).not.toContain('read_inbox');
    expect(html).not.toContain('data-assistant-run');
    expect(html).not.toContain(a.presets.filterAll);
  });

  it('maps legacy Plugins tab links into the combined capabilities page', () => {
    const html = renderToStaticMarkup(<AgentsContentPage tab="plugins" />);
    const a = messages.en.agentsContent;
    const navCapabilities = a.navCapabilities.replace('&', '&amp;');

    expect(html).toContain(navCapabilities);
    expect(html).toContain(a.skills.title);
    expect(html).toContain(a.plugins.title);
    expect(html).toContain(a.plugins.empty);
    expect(html).toContain(a.mcp.title);
  });
});

describe('Agent detail content', () => {
  it('renders consolidated detail with cross-agent context', () => {
    const html = renderToStaticMarkup(<AgentDetailContent agentKey="cursor" />);
    const a = messages.en.agentsContent.detail;

    expect(html).toContain('json');
    expect(html).toContain(a.skillAssignments);
    expect(html).toContain(a.skillsSearchPlaceholder);
    expect(html).toContain(a.skillsSourceBuiltin);
    expect(html).toContain(a.mcpManagement);
    expect(html).toContain(a.mcpCopySnippet);
    expect(html).toContain(a.mcpReconnect);
    expect(html).toContain(a.nativeInstalledSkills);
    expect(html).toContain(a.configuredMcpServers);
    expect(html).toContain('github');
    expect(html).toContain('custom-routing');
    expect(html).toContain('Codex');
    expect(html).not.toContain(a.recentActivity);
    expect(html).not.toContain(a.spaceReach);
  });

  it('renders not-found state for missing agent key', () => {
    const html = renderToStaticMarkup(<AgentDetailContent agentKey="missing-agent" />);
    const a = messages.en.agentsContent;
    expect(html).toContain(a.detailNotFound);
  });
});
