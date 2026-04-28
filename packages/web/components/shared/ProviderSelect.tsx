'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, SkipForward, Plus } from 'lucide-react';
import { type ProviderId, PROVIDER_PRESETS, groupedProviders, ALL_PROVIDER_IDS } from '@/lib/agent/providers';
import { type Provider } from '@/lib/custom-endpoints';
import { useLocale } from '@/lib/stores/locale-store';

interface ProviderSelectProps {
  value: string | 'skip';
  onChange: (id: string | 'skip') => void;
  showSkip?: boolean;
  compact?: boolean;
  /** @deprecated Use customProviders (unified Provider[]) instead */
  configuredProviders?: Set<ProviderId>;
  customProviders?: Provider[];
  onAdd?: () => void;
}

export default function ProviderSelect({
  value, onChange, showSkip = false, compact = false, configuredProviders,
  customProviders, onAdd,
}: ProviderSelectProps) {
  const { locale } = useLocale();
  const [showMore, setShowMore] = useState(false);
  const groups = groupedProviders();

  const hasConfigured = configuredProviders && configuredProviders.size > 0;
  const hasCustom = customProviders && customProviders.length > 0;

  // In compact settings mode: show provider list + Add button
  // New model: customProviders IS the full list (unified Provider[])
  // Legacy model: configuredProviders set + separate customProviders array
  const useConfiguredMode = compact && (hasConfigured || hasCustom) && !showSkip;

  // Legacy: Sorted configured provider IDs (for backward compat with old callers)
  const configuredIds = hasConfigured
    ? ALL_PROVIDER_IDS.filter(id => configuredProviders!.has(id))
    : [];

  // Add panel shows ALL providers as protocol templates (can add multiple of the same type)
  const { primary: primaryItems, local: localItems, more: moreItems } = groups;
  const secondaryItems = [...localItems, ...moreItems];

  /* ── Compact tab button (for legacy builtin-only mode) ── */
  const renderCompactTab = (id: ProviderId) => {
    const preset = PROVIDER_PRESETS[id];
    const displayName = locale === 'zh' ? preset.nameZh : preset.name;
    const isSelected = value === id;
    const isConfigured = configuredProviders?.has(id);

    return (
      <button
        key={id}
        type="button"
        onClick={() => onChange(id)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all text-sm ${
          isSelected
            ? 'border-[var(--amber)] bg-[var(--amber-subtle)] shadow-sm'
            : 'border-border/50 hover:border-border hover:bg-muted/30'
        }`}
      >
        <span className={`font-medium ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>
          {displayName}
        </span>
        {isConfigured && !isSelected && (
          <CheckCircle2 size={12} className="text-success ml-auto shrink-0" />
        )}
        {isSelected && (
          <CheckCircle2 size={14} className="ml-auto shrink-0" style={{ color: 'var(--amber)' }} />
        )}
      </button>
    );
  };

  /* ── Full card button (used in setup wizard / non-compact) ── */
  const renderCard = (id: ProviderId) => {
    const preset = PROVIDER_PRESETS[id];
    const displayName = locale === 'zh' ? preset.nameZh : preset.name;
    const description = locale === 'zh' ? preset.descriptionZh : preset.description;
    const isSelected = value === id;
    const isConfigured = configuredProviders?.has(id);

    return (
      <button
        key={id}
        type="button"
        onClick={() => onChange(id)}
        className="flex items-start gap-3 p-4 rounded-xl border text-left transition-all duration-150"
        style={{
          background: isSelected ? 'var(--amber-dim)' : 'var(--card)',
          borderColor: isSelected ? 'var(--amber)' : 'var(--border)',
        }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{displayName}</p>
          {description && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{description}</p>
          )}
          <p className={`text-xs ${description ? 'mt-1' : 'mt-0.5'}`} style={{ color: 'var(--muted-foreground)' }}>
            {preset.defaultModel}
          </p>
        </div>
        {isConfigured && !isSelected && (
          <CheckCircle2 size={14} className="text-success shrink-0 mt-0.5" />
        )}
        {isSelected && (
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--amber)' }} />
        )}
      </button>
    );
  };

  /* ════════════════════════════════════════════
   *  MODE 1: Provider list + Add button
   *  (compact settings, has providers)
   * ════════════════════════════════════════════ */
  if (useConfiguredMode) {
    return (
      <div className="space-y-2">
        {/* Providers row */}
        <div className="flex flex-wrap gap-2">
          {/* Legacy: built-in configured providers */}
          {configuredIds.map(id => renderCompactTab(id))}

          {/* Unified provider list (or legacy custom providers) */}
          {customProviders?.map(cp => {
            const isSelected = value === cp.id;
            return (
              <button
                key={cp.id}
                type="button"
                onClick={() => onChange(cp.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all text-sm ${
                  isSelected
                    ? 'border-[var(--amber)] bg-[var(--amber-subtle)] shadow-sm'
                    : 'border-border/50 hover:border-border hover:bg-muted/30'
                }`}
              >
                <span className={`font-medium ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {cp.name}
                </span>
                {isSelected && (
                  <CheckCircle2 size={14} className="ml-auto shrink-0" style={{ color: 'var(--amber)' }} />
                )}
              </button>
            );
          })}

          {/* Add button — opens form directly */}
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border/50 text-sm text-muted-foreground hover:border-border hover:text-foreground transition-all"
            >
              <Plus size={14} />
              <span>{locale === 'zh' ? '添加' : 'Add'}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════
   *  MODE 2: Full list (setup wizard / no configured providers)
   *  Original behavior preserved
   * ════════════════════════════════════════════ */

  return (
    <div className="space-y-2">
      {/* Primary providers */}
      <div className={compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-1 gap-2'}>
        {primaryItems.map(id => compact ? renderCompactTab(id) : renderCard(id))}
      </div>

      {/* More toggle */}
      {secondaryItems.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowMore(!showMore)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <ChevronDown size={12} className={`transition-transform ${showMore ? 'rotate-180' : ''}`} />
            {showMore
              ? (locale === 'zh' ? '收起' : 'Show less')
              : (locale === 'zh'
                  ? `更多 (${secondaryItems.length})`
                  : `More (${secondaryItems.length})`)}
          </button>

          {showMore && (
            <div className={compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-1 gap-2'}>
              {secondaryItems.map(id => compact ? renderCompactTab(id) : renderCard(id))}
            </div>
          )}
        </>
      )}

      {/* Skip option — only in onboarding */}
      {showSkip && (
        <button
          type="button"
          onClick={() => onChange('skip')}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all text-sm w-full mt-1"
          style={{
            background: value === 'skip' ? 'var(--amber-dim)' : 'var(--card)',
            borderColor: value === 'skip' ? 'var(--amber)' : 'var(--border)',
          }}
        >
          <SkipForward size={14} className="shrink-0" style={{ color: value === 'skip' ? 'var(--amber)' : 'var(--muted-foreground)' }} />
          <span className={`font-medium ${value === 'skip' ? 'text-foreground' : 'text-muted-foreground'}`}>
            {locale === 'zh' ? '暂时跳过' : 'Skip for now'}
          </span>
          {value === 'skip' && (
            <CheckCircle2 size={14} className="ml-auto shrink-0" style={{ color: 'var(--amber)' }} />
          )}
        </button>
      )}

    </div>
  );
}
