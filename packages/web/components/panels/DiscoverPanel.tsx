'use client';

import { usePathname } from 'next/navigation';
import { Lightbulb, Blocks, Zap, LayoutTemplate, Compass, Server } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { PanelPrimaryNav, PanelNavRow, ComingSoonBadge } from './PanelNavRow';
import { useLocale } from '@/lib/stores/locale-store';

interface DiscoverPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

export default function DiscoverPanel({ active }: DiscoverPanelProps) {
  const { t } = useLocale();
  const d = t.panels.discover;
  const pathname = usePathname() ?? '';
  const capabilityMarketActive = pathname === '/explore/capabilities';
  const pluginMarketActive = pathname === '/explore/plugins';
  const skillMarketActive = pathname === '/explore/skills';
  const mcpMarketActive = pathname === '/explore/mcp';
  const useCasesActive = pathname === '/explore';

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={d.title} />
      <PanelPrimaryNav aria-label={d.title}>
        <PanelNavRow
          icon={<Compass size={14} className={capabilityMarketActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
          title={d.capabilityMarketplace}
          href="/explore/capabilities"
          active={capabilityMarketActive}
          activeVariant="rail"
        />
        <PanelNavRow
          icon={<Zap size={14} className={skillMarketActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
          title={d.skillMarket}
          href="/explore/skills"
          active={skillMarketActive}
          activeVariant="rail"
        />
        <PanelNavRow
          icon={<Server size={14} className={mcpMarketActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
          title={d.mcpServers}
          href="/explore/mcp"
          active={mcpMarketActive}
          activeVariant="rail"
        />
        <PanelNavRow
          icon={<Blocks size={14} className={pluginMarketActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
          title={d.pluginMarket}
          href="/explore/plugins"
          active={pluginMarketActive}
          activeVariant="rail"
        />
        <PanelNavRow
          icon={<LayoutTemplate size={14} className="text-muted-foreground" />}
          title={d.spaceTemplates}
          badge={<ComingSoonBadge label={d.comingSoon} />}
          activeVariant="rail"
        />
        <PanelNavRow
          icon={<Lightbulb size={14} className={useCasesActive ? 'text-[var(--amber)]' : 'text-muted-foreground'} />}
          title={d.useCases}
          href="/explore"
          active={useCasesActive}
          activeVariant="rail"
        />
      </PanelPrimaryNav>
    </div>
  );
}
