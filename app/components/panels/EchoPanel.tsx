'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { UserRound, Bookmark, Sun, History, Brain } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { PanelNavRow } from './PanelNavRow';
import { useLocale } from '@/lib/LocaleContext';
import { ECHO_SEGMENT_HREF, ECHO_SEGMENT_ORDER, type EchoSegment } from '@/lib/echo-segments';

interface EchoPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

export default function EchoPanel({ active, maximized, onMaximize }: EchoPanelProps) {
  const { t } = useLocale();
  const e = t.panels.echo;
  const pathname = usePathname() ?? '';

  const rowBySegment: Record<EchoSegment, { icon: ReactNode; title: string; subtitle: string }> = {
    'about-you': { icon: <UserRound size={14} />, title: e.aboutYouTitle, subtitle: e.aboutYouDesc },
    continued: { icon: <Bookmark size={14} />, title: e.continuedTitle, subtitle: e.continuedDesc },
    daily: { icon: <Sun size={14} />, title: e.dailyEchoTitle, subtitle: e.dailyDesc },
    'past-you': { icon: <History size={14} />, title: e.pastYouTitle, subtitle: e.pastYouDesc },
    growth: { icon: <Brain size={14} />, title: e.intentGrowthTitle, subtitle: e.growthDesc },
  };

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={e.title} maximized={maximized} onMaximize={onMaximize} />
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="flex flex-col gap-0.5 py-1.5">
          {ECHO_SEGMENT_ORDER.map((segment) => {
            const row = rowBySegment[segment];
            const href = ECHO_SEGMENT_HREF[segment];
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <PanelNavRow key={segment} href={href} icon={row.icon} title={row.title} subtitle={row.subtitle} active={isActive} />
            );
          })}
        </div>
      </div>
    </div>
  );
}
