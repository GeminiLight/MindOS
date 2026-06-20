'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Footprints, GitBranch, LayoutDashboard, Sprout } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { PANEL_NAV_STACK_CLASS, PanelNavRow } from './PanelNavRow';
import { useLocale } from '@/lib/stores/locale-store';
import { ECHO_SEGMENT_HREF, ECHO_SEGMENT_ORDER, type EchoSegment } from '@/lib/echo-segments';

interface EchoPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

export default function EchoPanel({ active }: EchoPanelProps) {
  const { t } = useLocale();
  const e = t.panels.echo;
  const pathname = usePathname() ?? '';

  const rowBySegment: Record<EchoSegment, { icon: ReactNode; title: string; subtitle: string }> = {
    overview: { icon: <LayoutDashboard size={14} />, title: e.overviewTitle, subtitle: e.overviewDesc },
    imprint: { icon: <Footprints size={14} />, title: e.imprintTitle, subtitle: e.imprintDesc },
    threads: { icon: <GitBranch size={14} />, title: e.threadsTitle, subtitle: e.threadsDesc },
    growth: { icon: <Sprout size={14} />, title: e.growthTitle, subtitle: e.growthDesc },
  };

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={e.title} />
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
        <div className={PANEL_NAV_STACK_CLASS}>
          {ECHO_SEGMENT_ORDER.map((segment) => {
            const row = rowBySegment[segment];
            const href = ECHO_SEGMENT_HREF[segment];
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <PanelNavRow
                key={segment}
                href={href}
                icon={row.icon}
                title={row.title}
                subtitle={row.subtitle}
                active={isActive}
                activeVariant="rail"
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
