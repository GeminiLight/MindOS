'use client';

import { useState } from 'react';
import { useLocale } from '@/lib/stores/locale-store';
import { useCases, categories, scenarios, type UseCaseCategory, type UseCaseScenario } from './use-cases.generated';
import UseCaseCard from './UseCaseCard';

export default function ExploreContent() {
  const { t } = useLocale();
  const e = t.explore;
  const [activeCategory, setActiveCategory] = useState<UseCaseCategory | 'all'>('all');
  const [activeScenario, setActiveScenario] = useState<UseCaseScenario | 'all'>('all');

  const filtered = useCases.filter(uc => {
    if (activeCategory !== 'all' && uc.category !== activeCategory) return false;
    if (activeScenario !== 'all' && uc.scenario !== activeScenario) return false;
    return true;
  });

  /** Dynamic lookup for use case i18n data by id (works for any number of cases) */
  const getUseCaseText = (id: string): { title: string; desc: string; prompt: string } | undefined => {
    return (e as Record<string, any>)[id] as { title: string; desc: string; prompt: string } | undefined;
  };

  return (
    <div className="content-width px-4 md:px-6 py-8 md:py-12">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 rounded-full bg-[var(--amber)]" />
          <h1 className="text-2xl font-semibold tracking-tight font-display text-foreground">
            {e.title}
          </h1>
        </div>
        <p
          className="text-sm leading-relaxed text-muted-foreground pl-4"
        >
          {e.subtitle}
        </p>
      </div>

      {/* Dual-axis filter */}
      <div className="space-y-3 mb-6" style={{ paddingLeft: '1rem' }}>
        {/* Capability axis */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-muted-foreground uppercase tracking-wider font-medium w-16 shrink-0">{e.byCapability}</span>
          <FilterChip
            label={e.all}
            active={activeCategory === 'all'}
            onClick={() => setActiveCategory('all')}
          />
          {categories.map(cat => (
            <FilterChip
              key={cat}
              label={(e.categories as Record<string, string>)[cat]}
              active={activeCategory === cat}
              onClick={() => setActiveCategory(cat)}
            />
          ))}
        </div>
        {/* Scenario axis */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-muted-foreground uppercase tracking-wider font-medium w-16 shrink-0">{e.byScenario}</span>
          <FilterChip
            label={e.all}
            active={activeScenario === 'all'}
            onClick={() => setActiveScenario('all')}
          />
          {scenarios.map(sc => (
            <FilterChip
              key={sc}
              label={(e.scenarios as Record<string, string>)[sc]}
              active={activeScenario === sc}
              onClick={() => setActiveScenario(sc)}
            />
          ))}
        </div>
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ paddingLeft: '1rem' }}>
        {filtered.map(uc => {
          const data = getUseCaseText(uc.id);
          if (!data) return null;
          return (
            <UseCaseCard
              key={uc.id}
              icon={uc.icon}
              image={uc.image}
              title={data.title}
              description={data.desc}
              prompt={data.prompt}
              tryItLabel={e.tryIt}
            />
          );
        })}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12" style={{ paddingLeft: '1rem' }}>
          No use cases match the current filters.
        </p>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`
        px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150
        ${active
          ? 'text-[var(--amber)] bg-[var(--amber-dim)]'
          : 'text-[var(--muted-foreground)] bg-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/80'
        }
      `}
    >
      {label}
    </button>
  );
}
