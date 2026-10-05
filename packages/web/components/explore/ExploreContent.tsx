'use client';

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { useCases, categories, scenarios, type UseCaseCategory, type UseCaseScenario } from './use-cases.generated';
import UseCaseCard from './UseCaseCard';

type UseCaseText = { title: string; desc: string; prompt: string };

function isUseCaseText(value: unknown): value is UseCaseText {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UseCaseText>;
  return typeof candidate.title === 'string' && typeof candidate.desc === 'string' && typeof candidate.prompt === 'string';
}

export default function ExploreContent() {
  const { t } = useLocale();
  const e = t.explore;
  const [activeCategory, setActiveCategory] = useState<UseCaseCategory | 'all'>('all');
  const [activeScenario, setActiveScenario] = useState<UseCaseScenario | 'all'>('all');

  const filtered = useCases.filter(uc =>
    (activeCategory === 'all' || uc.category === activeCategory)
    && (activeScenario === 'all' || uc.scenario === activeScenario));

  const clearFilters = () => {
    setActiveCategory('all');
    setActiveScenario('all');
  };

  return (
    <div className="content-width px-4 py-8 md:px-6 md:py-12">
      <header className="mb-8 max-w-2xl">
        <h1 className="border-l-[3px] border-[var(--amber)] pl-3 text-2xl font-semibold tracking-tight text-foreground">
          {e.title}
        </h1>
        <p className="mt-3 pl-4 text-sm leading-relaxed text-muted-foreground">{e.subtitle}</p>
      </header>

      <section aria-label={e.byScenario} className="mb-7 space-y-3">
        <h2 className="text-sm font-medium text-foreground">{e.byScenario}</h2>
        <div className="flex flex-wrap gap-2" data-explore-scenario-filter>
          <FilterChip label={e.all} active={activeScenario === 'all'} onClick={() => setActiveScenario('all')} />
          {scenarios.map(sc => (
            <FilterChip
              key={sc}
              label={(e.scenarios as Record<string, string>)[sc]}
              active={activeScenario === sc}
              onClick={() => setActiveScenario(sc)}
            />
          ))}
        </div>
        <details className="group" data-explore-capability-filter>
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal size={15} aria-hidden="true" />
            {e.byCapability}
            {activeCategory !== 'all' && (
              <span className="rounded-md bg-[var(--amber-subtle)] px-2 py-1 text-xs font-medium text-foreground">
                {(e.categories as Record<string, string>)[activeCategory]}
              </span>
            )}
          </summary>
          <div className="flex flex-wrap gap-2 pb-1 pt-2">
            <FilterChip label={e.all} active={activeCategory === 'all'} onClick={() => setActiveCategory('all')} />
            {categories.map(cat => (
              <FilterChip
                key={cat}
                label={(e.categories as Record<string, string>)[cat]}
                active={activeCategory === cat}
                onClick={() => setActiveCategory(cat)}
              />
            ))}
          </div>
        </details>
      </section>

      <div className="mb-3 flex items-baseline justify-between border-b border-border/70 pb-3">
        <h2 className="text-sm font-semibold text-foreground">{e.taskListTitle}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{filtered.length}</span>
      </div>

      {filtered.length > 0 ? (
        <div className="space-y-7" data-explore-task-list>
          {scenarios.map(sc => {
            const tasks = filtered.filter(uc => uc.scenario === sc);
            if (tasks.length === 0) return null;
            return (
              <section key={sc} aria-label={(e.scenarios as Record<string, string>)[sc]}>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {(e.scenarios as Record<string, string>)[sc]}
                </h3>
                <div className={`grid grid-cols-1 gap-x-6 ${tasks.length > 1 ? 'md:grid-cols-2' : ''}`}>
                  {tasks.map(uc => {
                    const data = (e as Record<string, unknown>)[uc.id];
                    if (!isUseCaseText(data)) return null;
                    return (
                      <UseCaseCard
                        key={uc.id}
                        icon={uc.icon}
                        title={data.title}
                        description={data.desc}
                        prompt={data.prompt}
                        tryItLabel={e.tryIt}
                        wide={tasks.length === 1}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-border/70 px-4 py-7" role="status">
          <p className="text-sm text-foreground">{e.noMatches}</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-3 min-h-11 rounded-lg px-3 text-sm font-medium text-[var(--amber-text)] transition-colors hover:bg-[var(--amber-subtle)] focus-visible:ring-2 focus-visible:ring-ring"
          >
            {e.clearFilters}
          </button>
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-11 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring ${active
        ? 'border-[var(--amber)]/40 bg-[var(--amber-subtle)] text-foreground'
        : 'border-border/70 bg-background/60 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground'}`}
    >
      {label}
    </button>
  );
}
