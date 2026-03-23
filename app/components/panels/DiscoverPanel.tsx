'use client';

import Link from 'next/link';
import { Lightbulb, Blocks, Zap, LayoutTemplate, ChevronRight, User, Download, RefreshCw, Repeat, Rocket, Search, Handshake, ShieldCheck } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { useLocale } from '@/lib/LocaleContext';
import { useCases } from '@/components/explore/use-cases';
import { openAskModal } from '@/hooks/useAskModal';

interface DiscoverPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

/** Navigation entry — clickable row linking to a page or showing coming soon */
function NavEntry({
  icon,
  title,
  badge,
  href,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="flex items-center justify-center w-7 h-7 rounded-md bg-muted shrink-0">{icon}</span>
      <span className="text-sm font-medium text-foreground flex-1">{title}</span>
      {badge}
      <ChevronRight size={14} className="text-muted-foreground shrink-0" />
    </>
  );

  const className = "flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer";

  if (href) {
    return <Link href={href} className={className}>{content}</Link>;
  }
  return <button onClick={onClick} className={`${className} w-full`}>{content}</button>;
}

/** Coming soon badge */
function ComingSoonBadge({ label }: { label: string }) {
  return (
    <span className="text-2xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
      {label}
    </span>
  );
}

/** Compact use case row */
function UseCaseRow({
  icon,
  title,
  prompt,
  tryLabel,
}: {
  icon: React.ReactNode;
  title: string;
  prompt: string;
  tryLabel: string;
}) {
  return (
    <div className="group flex items-center gap-2.5 px-4 py-1.5 hover:bg-muted/50 transition-colors rounded-sm mx-1">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-xs text-foreground truncate flex-1">{title}</span>
      <button
        onClick={() => openAskModal(prompt, 'user')}
        className="opacity-0 group-hover:opacity-100 text-2xs px-2 py-0.5 rounded text-[var(--amber)] bg-[var(--amber-dim)] hover:opacity-80 transition-all duration-150 shrink-0"
      >
        {tryLabel}
      </button>
    </div>
  );
}

/** Map use case id → lucide icon */
const useCaseIcons: Record<string, React.ReactNode> = {
  c1: <User size={12} />,          // Inject Identity
  c2: <Download size={12} />,      // Save Information
  c3: <RefreshCw size={12} />,     // Cross-Agent Handoff
  c4: <Repeat size={12} />,        // Experience → SOP
  c5: <Lightbulb size={12} />,     // Capture Ideas
  c6: <Rocket size={12} />,        // Project Cold Start
  c7: <Search size={12} />,        // Research & Archive
  c8: <Handshake size={12} />,     // Network Management
  c9: <ShieldCheck size={12} />,   // Audit & Correct
};

export default function DiscoverPanel({ active, maximized, onMaximize }: DiscoverPanelProps) {
  const { t } = useLocale();
  const d = t.panels.discover;
  const e = t.explore;

  /** Type-safe lookup for use case i18n */
  const getUseCaseText = (id: string): { title: string; prompt: string } | undefined => {
    const map: Record<string, { title: string; desc: string; prompt: string }> = {
      c1: e.c1, c2: e.c2, c3: e.c3, c4: e.c4, c5: e.c5,
      c6: e.c6, c7: e.c7, c8: e.c8, c9: e.c9,
    };
    return map[id];
  };

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={d.title} maximized={maximized} onMaximize={onMaximize} />
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Navigation entries */}
        <div className="py-2">
          <NavEntry
            icon={<Lightbulb size={14} className="text-[var(--amber)]" />}
            title={d.useCases}
            badge={<span className="text-2xs tabular-nums text-muted-foreground">{useCases.length}</span>}
            href="/explore"
          />
          <NavEntry
            icon={<Blocks size={14} className="text-muted-foreground" />}
            title={d.pluginMarket}
            badge={<ComingSoonBadge label={d.comingSoon} />}
          />
          <NavEntry
            icon={<Zap size={14} className="text-muted-foreground" />}
            title={d.skillMarket}
            badge={<ComingSoonBadge label={d.comingSoon} />}
          />
          <NavEntry
            icon={<LayoutTemplate size={14} className="text-muted-foreground" />}
            title={d.spaceTemplates}
            badge={<ComingSoonBadge label={d.comingSoon} />}
          />
        </div>

        <div className="mx-4 border-t border-border" />

        {/* Quick try — use case list */}
        <div className="py-2">
          <div className="px-4 py-1.5">
            <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{d.useCases}</span>
          </div>
          {useCases.map(uc => {
            const data = getUseCaseText(uc.id);
            if (!data) return null;
            return (
              <UseCaseRow
                key={uc.id}
                icon={useCaseIcons[uc.id] || <Lightbulb size={12} />}
                title={data.title}
                prompt={data.prompt}
                tryLabel={d.tryIt}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
