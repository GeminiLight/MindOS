'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Footprints, GitBranch, LayoutDashboard, Sprout } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { PanelPrimaryNav, PanelNavRow } from './PanelNavRow';
import { useLocale } from '@/lib/stores/locale-store';
import { ECHO_PRIMARY_SEGMENT_ORDER, ECHO_SEGMENT_HREF, type EchoSegment } from '@/lib/echo-segments';

interface EchoPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

export default function EchoPanel({ active }: EchoPanelProps) {
  const { t } = useLocale();
  const e = t.panels.echo;
  const pathname = usePathname() ?? '';

  const rowBySegment: Partial<Record<EchoSegment, { icon: ReactNode; title: string }>> = {
    overview: { icon: <LayoutDashboard size={14} />, title: e.overviewTitle },
    imprint: { icon: <Footprints size={14} />, title: e.imprintTitle },
    growth: { icon: <Sprout size={14} />, title: e.growthTitle },
    practice: { icon: <GitBranch size={14} />, title: e.practiceTitle },
  };

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={e.title} />
      <PanelPrimaryNav aria-label={e.title}>
        {ECHO_PRIMARY_SEGMENT_ORDER.map((segment) => {
          const row = rowBySegment[segment];
          if (!row) return null;
          const href = ECHO_SEGMENT_HREF[segment];
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <PanelNavRow
              key={segment}
              href={href}
              icon={row.icon}
              title={row.title}
              active={isActive}
              activeVariant="rail"
            />
          );
        })}
      </PanelPrimaryNav>
      <div className="sidebar-scroll-area min-h-0 flex-1 overflow-y-auto" aria-hidden="true" />
    </div>
  );
}
