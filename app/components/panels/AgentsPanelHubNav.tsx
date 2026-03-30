'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Globe, LayoutDashboard, Server, Zap } from 'lucide-react';
import { PanelNavRow } from './PanelNavRow';

type HubCopy = {
  navOverview: string;
  navMcp: string;
  navSkills: string;
  navA2a: string;
};

export function AgentsPanelHubNav({
  copy,
  connectedCount,
}: {
  copy: HubCopy;
  connectedCount: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab');
  const inAgentsRoute = pathname === '/agents';

  return (
    <div className="py-2">
      <PanelNavRow
        icon={<LayoutDashboard size={14} className="text-[var(--amber)]" />}
        title={copy.navOverview}
        badge={<span className="text-2xs tabular-nums text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted/40 font-medium">{connectedCount}</span>}
        href="/agents"
        active={inAgentsRoute && (tab === null || tab === 'overview')}
      />
      <PanelNavRow
        icon={<Server size={14} className={inAgentsRoute && tab === 'mcp' ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navMcp}
        href="/agents?tab=mcp"
        active={inAgentsRoute && tab === 'mcp'}
      />
      <PanelNavRow
        icon={<Zap size={14} className={inAgentsRoute && tab === 'skills' ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navSkills}
        href="/agents?tab=skills"
        active={inAgentsRoute && tab === 'skills'}
      />
      <PanelNavRow
        icon={<Globe size={14} className={inAgentsRoute && tab === 'a2a' ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
        title={copy.navA2a}
        href="/agents?tab=a2a"
        active={inAgentsRoute && tab === 'a2a'}
      />
    </div>
  );
}
