'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ExternalLink, Blocks, Zap, LayoutTemplate } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { useLocale } from '@/lib/LocaleContext';
import { useCases, categories } from '@/components/explore/use-cases';
import { openAskModal } from '@/hooks/useAskModal';

interface DiscoverPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

/** Collapsible section with count badge */
function Section({
  icon,
  title,
  count,
  defaultOpen = true,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="flex items-center gap-1.5">
          {icon}
          {title}
        </span>
        {count !== undefined && (
          <span className="ml-auto text-2xs tabular-nums opacity-60">{count}</span>
        )}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

/** Compact use case row for panel display */
function UseCaseRow({
  icon,
  title,
  prompt,
  tryLabel,
}: {
  icon: string;
  title: string;
  prompt: string;
  tryLabel: string;
}) {
  return (
    <div className="group flex items-center gap-2 px-4 py-1.5 hover:bg-muted/50 transition-colors rounded-sm mx-1">
      <span className="text-sm leading-none shrink-0" suppressHydrationWarning>{icon}</span>
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

/** Coming soon placeholder */
function ComingSoonSection({
  icon,
  title,
  description,
  comingSoonLabel,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  comingSoonLabel: string;
}) {
  return (
    <Section icon={icon} title={title} defaultOpen={false}>
      <div className="px-4 py-3 mx-1">
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        <span className="inline-block mt-2 text-2xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          {comingSoonLabel}
        </span>
      </div>
    </Section>
  );
}

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

  /** Category emoji icons */
  const categoryIcons: Record<string, string> = {
    'memory-sync': '🧠',
    'auto-execute': '⚡',
    'experience-evolution': '🔁',
    'audit-control': '🛡️',
  };

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={d.title} maximized={maximized} onMaximize={onMaximize} />
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Use Cases grouped by category */}
        {categories.map(cat => {
          const items = useCases.filter(uc => uc.category === cat);
          const catLabel = (e.categories as Record<string, string>)[cat] || cat;
          return (
            <div key={cat}>
              <Section
                icon={<span className="text-xs" suppressHydrationWarning>{categoryIcons[cat]}</span>}
                title={catLabel}
                count={items.length}
              >
                <div className="flex flex-col">
                  {items.map(uc => {
                    const data = getUseCaseText(uc.id);
                    if (!data) return null;
                    return (
                      <UseCaseRow
                        key={uc.id}
                        icon={uc.icon}
                        title={data.title}
                        prompt={data.prompt}
                        tryLabel={d.tryIt}
                      />
                    );
                  })}
                </div>
              </Section>
              <div className="mx-4 border-t border-border" />
            </div>
          );
        })}

        {/* Plugin Market — Coming Soon */}
        <ComingSoonSection
          icon={<Blocks size={11} />}
          title={d.pluginMarket}
          description={d.pluginMarketDesc}
          comingSoonLabel={d.comingSoon}
        />

        <div className="mx-4 border-t border-border" />

        {/* Skill Market — Coming Soon */}
        <ComingSoonSection
          icon={<Zap size={11} />}
          title={d.skillMarket}
          description={d.skillMarketDesc}
          comingSoonLabel={d.comingSoon}
        />

        <div className="mx-4 border-t border-border" />

        {/* Space Templates — Coming Soon */}
        <ComingSoonSection
          icon={<LayoutTemplate size={11} />}
          title={d.spaceTemplates}
          description={d.spaceTemplatesDesc}
          comingSoonLabel={d.comingSoon}
        />

        {/* View all link */}
        <div className="px-4 py-3 mt-2">
          <Link
            href="/explore"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--amber)] hover:opacity-80 transition-opacity"
          >
            {d.viewAll}
            <ExternalLink size={11} />
          </Link>
        </div>
      </div>
    </div>
  );
}
