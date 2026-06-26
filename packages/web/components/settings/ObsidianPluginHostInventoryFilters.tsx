import type {
  ObsidianPluginInventory,
  ObsidianPostureFilter,
} from './ObsidianPluginHostInventoryModel';

interface ObsidianPluginHostInventoryFiltersProps {
  inventory: ObsidianPluginInventory;
  onChange: (filter: ObsidianPostureFilter) => void;
}

export function ObsidianPluginHostInventoryFilters({
  inventory,
  onChange,
}: ObsidianPluginHostInventoryFiltersProps) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Compatibility posture filters">
      {inventory.filterOptions.map((option) => {
        const active = inventory.activeFilter === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            disabled={option.count === 0}
            aria-pressed={active}
            data-obsidian-posture-filter={option.value}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-2xs transition-colors disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              active
                ? 'border-[var(--amber)]/35 bg-[var(--amber-subtle)] text-[var(--amber-text)]'
                : 'border-border bg-background text-muted-foreground hover:bg-muted/60'
            }`}
          >
            <span>{option.label}</span>
            <span className="text-muted-foreground/70">{option.count}</span>
          </button>
        );
      })}
    </div>
  );
}
