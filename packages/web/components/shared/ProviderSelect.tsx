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
  /** Protocols that already have credentials in setup, used only for checkmarks. */
  configuredProviders?: Set<ProviderId>;
  /** Unified provider entries used by Settings. */
  providerEntries?: Provider[];
  onAdd?: () => void;
}

export default function ProviderSelect({
  value, onChange, showSkip = false, compact = false, configuredProviders,
  providerEntries, onAdd,
}: ProviderSelectProps) {
  const { locale } = useLocale();
  const [showMore, setShowMore] = useState(false);
  const groups = groupedProviders();

  const hasProviderEntries = providerEntries && providerEntries.length > 0;

  const useProviderEntryMode = compact && hasProviderEntries && !showSkip;

  // Settings: show unconfigured protocol templates next to saved provider entries.
  const { primary: primaryItems, local: localItems, more: moreItems } = groups;
  const secondaryItems = [...localItems, ...moreItems];
  const configuredProtocolSet = new Set<ProviderId>([
    ...(configuredProviders ? Array.from(configuredProviders) : []),
    ...(providerEntries?.map(provider => provider.protocol) ?? []),
  ]);

  /* ── Compact tab button ── */
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
  if (useProviderEntryMode) {
    const unconfiguredPrimary = primaryItems.filter(id => !configuredProtocolSet.has(id));
    const unconfiguredSecondary = secondaryItems.filter(id => !configuredProtocolSet.has(id));

    return (
      <div className="space-y-2">
        {/* Providers row */}
        <div className="flex flex-wrap gap-2">
          {/* Saved provider entries */}
          {providerEntries?.map(cp => {
            const isSelected = value === cp.id;
            const preset = PROVIDER_PRESETS[cp.protocol];
            const displayName = cp.name.trim() || (locale === 'zh' ? preset.nameZh : preset.name);
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
                  {displayName}
                </span>
                {isSelected && (
                  <CheckCircle2 size={14} className="ml-auto shrink-0" style={{ color: 'var(--amber)' }} />
                )}
              </button>
            );
          })}

          {unconfiguredPrimary.map(id => renderCompactTab(id))}

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
        {unconfiguredSecondary.length > 0 && (
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
                    ? `更多服务商 (${unconfiguredSecondary.length})`
                    : `More providers (${unconfiguredSecondary.length})`)}
            </button>

            {showMore && (
              <div className="flex flex-wrap gap-2">
                {unconfiguredSecondary.map(id => renderCompactTab(id))}
              </div>
            )}
          </>
        )}
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
