'use client';

import { type RefObject } from 'react';
import { LayoutDashboard, Server, Zap } from 'lucide-react';
import { PanelNavRow } from './PanelNavRow';

type HubCopy = {
  navOverview: string;
  navMcp: string;
  navSkills: string;
};

export function AgentsPanelHubNav({
  copy,
  connectedCount,
  overviewRef,
  skillsRef,
  scrollTo,
  openAdvancedConfig,
}: {
  copy: HubCopy;
  connectedCount: number;
  overviewRef: RefObject<HTMLDivElement | null>;
  skillsRef: RefObject<HTMLDivElement | null>;
  scrollTo: (el: HTMLElement | null) => void;
  openAdvancedConfig: () => void;
}) {
  return (
    <div className="py-2">
      <PanelNavRow
        icon={<LayoutDashboard size={14} className="text-[var(--amber)]" />}
        title={copy.navOverview}
        badge={<span className="text-2xs tabular-nums text-muted-foreground">{connectedCount}</span>}
        onClick={() => scrollTo(overviewRef.current)}
      />
      <PanelNavRow
        icon={<Server size={14} className="text-muted-foreground" />}
        title={copy.navMcp}
        onClick={openAdvancedConfig}
      />
      <PanelNavRow
        icon={<Zap size={14} className="text-muted-foreground" />}
        title={copy.navSkills}
        onClick={() => scrollTo(skillsRef.current)}
      />
    </div>
  );
}
