'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { FlaskConical, Footprints, GitBranch, LayoutDashboard, Sprout } from 'lucide-react';
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

  const rowBySegment: Record<EchoSegment, { icon: ReactNode; title: string }> = {
    overview: { icon: <LayoutDashboard size={14} />, title: e.overviewTitle },
    imprint: { icon: <Footprints size={14} />, title: e.imprintTitle },
    threads: { icon: <GitBranch size={14} />, title: e.threadsTitle },
    growth: { icon: <Sprout size={14} />, title: e.growthTitle },
    practice: { icon: <FlaskConical size={14} />, title: e.practiceTitle },
  };

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={e.title} />
      <div className="sidebar-scroll-area flex-1 overflow-y-auto min-h-0 flex flex-col">
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
