'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Bot, LayoutDashboard, MessageSquare, Server, Sparkles } from 'lucide-react';
import { PANEL_NAV_STACK_CLASS, PanelNavRow } from './PanelNavRow';

type HubCopy = {
  navOverview: string;
  navAssistant: string;
  navAgent: string;
  navCapabilities: string;
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
  channelsActive = false,
}: {
  copy: HubCopy;
  connectedCount: number;
  channelsActive?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab');
  const inAgentsIndexRoute = pathname === '/agents';
  const inAgentDetailRoute = Boolean(pathname?.startsWith('/agents/'));

  // When channels view is active, suppress route-based active states
  const routeActive = !channelsActive;
  const overviewActive = routeActive && inAgentsIndexRoute && (tab === null || tab === 'overview');
  const assistantActive = routeActive && inAgentsIndexRoute && (tab === 'assistant' || tab === 'presets');
  const agentActive = routeActive && (
    (inAgentsIndexRoute && (tab === 'agent' || tab === 'a2a')) || inAgentDetailRoute
  );
  const capabilitiesActive = routeActive && inAgentsIndexRoute && (tab === 'capabilities' || tab === 'skills' || tab === 'mcp');
  const channelsHubActive = (routeActive && inAgentsIndexRoute && tab === 'channels') || channelsActive;

  return (
    <div className={PANEL_NAV_STACK_CLASS}>
      <PanelNavRow
        icon={<LayoutDashboard size={14} className={overviewActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navOverview}
        badge={<span className="text-2xs tabular-nums text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted/40 font-medium">{connectedCount}</span>}
        href="/agents"
        active={overviewActive}
        activeVariant="rail"
      />
      <PanelNavRow
        icon={<Sparkles size={14} className={assistantActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navAssistant ?? copy.navPresets}
        href="/agents?tab=assistant"
        active={assistantActive}
        activeVariant="rail"
      />
      <PanelNavRow
        icon={<Bot size={14} className={agentActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navAgent ?? copy.navMcp}
        href="/agents?tab=agent"
        active={agentActive}
        activeVariant="rail"
      />
      <PanelNavRow
        icon={<Server size={14} className={capabilitiesActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navCapabilities ?? copy.navSkills}
        href="/agents?tab=capabilities"
        active={capabilitiesActive}
        activeVariant="rail"
      />
      <PanelNavRow
        icon={<MessageSquare size={14} className={channelsHubActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navChannels}
        href="/agents?tab=channels"
        active={channelsHubActive}
        activeVariant="rail"
      />
    </div>
  );
}
