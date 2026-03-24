'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { UserRound, Bookmark, Sun, History, Brain } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { PanelNavRow } from './PanelNavRow';
import { useLocale } from '@/lib/LocaleContext';
import { ECHO_SEGMENT_ORDER, type EchoSegment } from '@/lib/echo-segments';

interface EchoPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

const SEGMENT_HREF: Record<EchoSegment, string> = {
  'about-you': '/echo/about-you',
  continued: '/echo/continued',
  daily: '/echo/daily',
  'past-you': '/echo/past-you',
  growth: '/echo/growth',
};

export default function EchoPanel({ active, maximized, onMaximize }: EchoPanelProps) {
  const { t } = useLocale();
  const e = t.panels.echo;
  const pathname = usePathname() ?? '';

  const rowBySegment: Record<EchoSegment, { icon: ReactNode; title: string }> = {
    'about-you': { icon: <UserRound size={14} />, title: e.aboutYouTitle },
    continued: { icon: <Bookmark size={14} />, title: e.continuedTitle },
    daily: { icon: <Sun size={14} />, title: e.dailyEchoTitle },
    'past-you': { icon: <History size={14} />, title: e.pastYouTitle },
    growth: { icon: <Brain size={14} />, title: e.intentGrowthTitle },
  };

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={e.title} maximized={maximized} onMaximize={onMaximize} />
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="flex flex-col py-1">
          {ECHO_SEGMENT_ORDER.map((segment) => {
            const row = rowBySegment[segment];
            const href = SEGMENT_HREF[segment];
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <div key={segment} className="border-b border-border/60 last:border-b-0">
                <PanelNavRow href={href} icon={row.icon} title={row.title} active={isActive} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
