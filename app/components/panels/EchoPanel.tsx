'use client';

import type { ReactNode } from 'react';
import { UserRound, Bookmark, Sun, History, Brain } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { ComingSoonBadge } from './PanelNavRow';
import { useLocale } from '@/lib/LocaleContext';

interface EchoPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

function EchoPlaceholdSection({
  icon,
  title,
  hint,
  comingSoonLabel,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  comingSoonLabel: string;
}) {
  return (
    <div className="px-4 py-2.5 border-b border-border/60 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <span className="flex items-center justify-center w-7 h-7 rounded-md bg-muted shrink-0 text-muted-foreground">{icon}</span>
        <span className="text-sm font-medium text-foreground flex-1 text-left">{title}</span>
        <ComingSoonBadge label={comingSoonLabel} />
      </div>
      <p className="text-2xs text-muted-foreground leading-relaxed mt-1.5 pl-9">{hint}</p>
    </div>
  );
}

export default function EchoPanel({ active, maximized, onMaximize }: EchoPanelProps) {
  const { t } = useLocale();
  const e = t.panels.echo;
  const soon = e.comingSoon;

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={e.title} maximized={maximized} onMaximize={onMaximize} />
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="py-1">
          <EchoPlaceholdSection
            icon={<UserRound size={14} />}
            title={e.aboutYouTitle}
            hint={e.aboutYouHint}
            comingSoonLabel={soon}
          />
          <EchoPlaceholdSection
            icon={<Bookmark size={14} />}
            title={e.continuedTitle}
            hint={e.continuedHint}
            comingSoonLabel={soon}
          />
          <EchoPlaceholdSection
            icon={<Sun size={14} />}
            title={e.dailyEchoTitle}
            hint={e.dailyEchoHint}
            comingSoonLabel={soon}
          />
          <EchoPlaceholdSection
            icon={<History size={14} />}
            title={e.pastYouTitle}
            hint={e.pastYouHint}
            comingSoonLabel={soon}
          />
          <EchoPlaceholdSection
            icon={<Brain size={14} />}
            title={e.intentGrowthTitle}
            hint={e.intentGrowthHint}
            comingSoonLabel={soon}
          />
        </div>
      </div>
    </div>
  );
}
