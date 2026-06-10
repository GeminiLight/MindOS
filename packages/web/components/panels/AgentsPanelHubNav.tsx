'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Bot, LayoutDashboard, MessageSquare, Server, Sparkles } from 'lucide-react';
import { PanelNavRow } from './PanelNavRow';

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
  const inAgentsRoute = pathname === '/agents';

  // When channels view is active, suppress route-based active states
  const routeActive = !channelsActive;
  const overviewActive = routeActive && inAgentsRoute && (tab === null || tab === 'overview');
  const assistantActive = routeActive && inAgentsRoute && (tab === 'assistant' || tab === 'presets');
  const agentActive = routeActive && inAgentsRoute && (tab === 'agent' || tab === 'a2a');
  const capabilitiesActive = routeActive && inAgentsRoute && (tab === 'capabilities' || tab === 'skills' || tab === 'mcp');
  const channelsHubActive = (routeActive && inAgentsRoute && tab === 'channels') || channelsActive;

  return (
    <div className="py-2">
      <PanelNavRow
        icon={<LayoutDashboard size={14} className={overviewActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navOverview}
        badge={<span className="text-2xs tabular-nums text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted/40 font-medium">{connectedCount}</span>}
        href="/agents"
        active={overviewActive}
      />
      <PanelNavRow
        icon={<Sparkles size={14} className={assistantActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navAssistant ?? copy.navPresets}
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
        icon={<Server size={14} className={capabilitiesActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navCapabilities ?? copy.navSkills}
        href="/agents?tab=capabilities"
        active={capabilitiesActive}
      />
      <PanelNavRow
        icon={<MessageSquare size={14} className={channelsHubActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navChannels}
        href="/agents?tab=channels"
        active={channelsHubActive}
      />
    </div>
  );
}
