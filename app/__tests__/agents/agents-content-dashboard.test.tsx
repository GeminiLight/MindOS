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
      skillMode: 'universal' as const,
      hiddenRootPath: '/home/test/.cursor',
      hiddenRootPresent: true,
      runtimeConversationSignal: true,
      runtimeUsageSignal: true,
      runtimeLastActivityAt: '2026-03-24T00:00:00.000Z',
      configuredMcpServers: ['mindos', 'github'],
      configuredMcpServerCount: 2,
      installedSkillNames: ['mindos', 'custom-routing'],
      installedSkillCount: 2,
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
  it('renders overview with pulse stats, agent cards, and quick nav', () => {
    const html = renderToStaticMarkup(<AgentsContentPage tab="overview" />);
    const a = messages.en.agentsContent;

    expect(html).toContain(a.title);
    expect(html).toContain(a.workspacePulse.connected);
    expect(html).toContain(a.workspacePulse.enabledSkills);
    expect(html).toContain(a.overview.usagePulse);
    expect(html).toContain(a.overview.pulseMcp);
    expect(html).toContain('Cursor');
    expect(html).toContain('Codex');
    expect(html).toContain('Ghost Agent');
    expect(html).toContain('MCP');
    expect(html).toContain('Skills');
  });

  it('renders mcp section with By Server (default) / By Agent views and management', () => {
    const html = renderToStaticMarkup(<AgentsContentPage tab="mcp" />);
    const a = messages.en.agentsContent;

    expect(html).toContain(a.mcp.tabs.byAgent);
    expect(html).toContain(a.mcp.tabs.byServer);
    expect(html).toContain(a.mcp.searchServersPlaceholder);
    expect(html).toContain('mindos');
    expect(html).toContain('github');
    expect(html).toContain('Cursor');
    expect(html).toContain('Codex');
  });

  it('renders skills section with By Skill / By Agent views and management', () => {
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
    expect(html).toContain('custom-routing');
    expect(html).toContain('mindos');
  });
});

describe('Agent detail content', () => {
  it('renders consolidated detail with cross-agent context', () => {
    const html = renderToStaticMarkup(<AgentDetailContent agentKey="cursor" />);
    const a = messages.en.agentsContent.detail;

    expect(html).toContain(a.format);
    expect(html).toContain(a.lastActivityAt);
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
