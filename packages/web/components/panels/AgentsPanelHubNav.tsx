'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Bot, LayoutDashboard, MessageSquare, Puzzle, Server, Sparkles } from 'lucide-react';
import { PanelNavRow } from './PanelNavRow';

type HubCopy = {
  navOverview: string;
  navAssistant: string;
  navAgent: string;
  navCapabilities: string;
  navPlugins?: string;
  navPresets: string;
  navMcp: string;
  navSkills: string;
  navChannels: string;
  navNetwork: string;
  navSessions: string;
  navActivity?: string;
};

export function AgentsPanelHubNav({
  copy,
  connectedCount,
  assistantCount,
  channelCount,
  channelsActive = false,
}: {
  copy: HubCopy;
  connectedCount: number;
  assistantCount: number;
  channelCount: number;
  channelsActive?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab');
  const inAgentsRoute = pathname === '/agents';

  // When channels view is active, suppress route-based active states
  const routeActive = !channelsActive;
  const overviewActive = routeActive && inAgentsRoute && (tab === null || tab === 'overview');
  const assistantActive = routeActive && inAgentsRoute && (tab === 'assistant' || tab === 'presets');
  const agentActive = routeActive && inAgentsRoute && (tab === 'agent' || tab === 'a2a');
  const pluginsActive = routeActive && inAgentsRoute && tab === 'plugins';
  const skillsActive = routeActive && inAgentsRoute && (tab === 'skills' || tab === 'capabilities');
  const mcpActive = routeActive && inAgentsRoute && tab === 'mcp';
  const channelsHubActive = (routeActive && inAgentsRoute && tab === 'channels') || channelsActive;
  const badge = (count: number) => (
    <span className="text-2xs tabular-nums text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted/40 font-medium">{count}</span>
  );

  return (
    <div className="py-2">
      <PanelNavRow
        icon={<LayoutDashboard size={14} className={overviewActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navOverview}
        badge={badge(connectedCount)}
        href="/agents"
        active={overviewActive}
      />
      <PanelNavRow
        icon={<Sparkles size={14} className={assistantActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navAssistant ?? copy.navPresets}
        badge={badge(assistantCount)}
        href="/agents?tab=assistant"
        active={assistantActive}
      />
      <PanelNavRow
        icon={<Bot size={14} className={agentActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navAgent ?? copy.navMcp}
        href="/agents?tab=agent"
        active={agentActive}
      />
      <PanelNavRow
        icon={<Puzzle size={14} className={pluginsActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navPlugins ?? 'Plugins'}
        href="/agents?tab=plugins"
        active={pluginsActive}
      />
      <PanelNavRow
        icon={<Sparkles size={14} className={skillsActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navSkills}
        href="/agents?tab=skills"
        active={skillsActive}
      />
      <PanelNavRow
        icon={<Server size={14} className={mcpActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navMcp}
        href="/agents?tab=mcp"
        active={mcpActive}
      />
      <PanelNavRow
        icon={<MessageSquare size={14} className={channelsHubActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navChannels}
        badge={badge(channelCount)}
        href="/agents?tab=channels"
        active={channelsHubActive}
      />
    </div>
  );
}
