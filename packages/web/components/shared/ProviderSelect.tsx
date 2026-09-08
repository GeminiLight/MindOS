'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, SkipForward, Plus } from 'lucide-react';
import { type ProviderId, PROVIDER_PRESETS, groupedProviders } from '@/lib/agent/providers';
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

  const useProviderEntryMode = compact && providerEntries !== undefined && !showSkip;

  // Setup mode uses protocol templates. Settings mode uses saved provider entries only:
  // adding a new provider is an explicit form action, not a hidden side effect of
  // clicking an unconfigured protocol template.
  const { primary: primaryItems, local: localItems, more: moreItems } = groups;
  const secondaryItems = [...localItems, ...moreItems];
  const secondaryExampleIds = (['groq', 'openrouter', 'ollama'] as ProviderId[])
    .filter(id => secondaryItems.includes(id));
  const secondaryExamples = secondaryExampleIds
    .map(id => locale === 'zh' ? PROVIDER_PRESETS[id].nameZh : PROVIDER_PRESETS[id].name)
    .join(', ');

  /* ── Compact tab button ── */
  const renderCompactTab = (id: ProviderId) => {
    const preset = PROVIDER_PRESETS[id];
    const displayName = compact ? preset.shortLabel : (locale === 'zh' ? preset.nameZh : preset.name);
    const isSelected = value === id;
    const isConfigured = configuredProviders?.has(id);

    return (
      <button
        key={id}
        type="button"
        onClick={() => onChange(id)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors text-sm ${
          isSelected
            ? 'border-[var(--amber)] bg-[var(--amber-subtle)]'
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

  const renderCompactSkip = () => {
    const isSelected = value === 'skip';
    return (
      <button
        key="skip"
        type="button"
        onClick={() => onChange('skip')}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
          isSelected
            ? ''
            : 'border-border/50 hover:border-border hover:bg-muted/30'
        }`}
        style={isSelected ? {
          borderColor: 'color-mix(in srgb, var(--error) 42%, var(--border))',
          background: 'color-mix(in srgb, var(--error) 7%, transparent)',
        } : undefined}
      >
        <SkipForward
          size={14}
          className="shrink-0"
          style={{ color: isSelected ? 'var(--error)' : 'var(--muted-foreground)' }}
        />
        <span className={`font-medium ${isSelected ? '' : 'text-muted-foreground'}`} style={{ color: isSelected ? 'var(--error)' : undefined }}>
          {locale === 'zh' ? '跳过' : 'Skip'}
        </span>
        {isSelected && (
          <CheckCircle2 size={14} className="ml-auto shrink-0" style={{ color: 'var(--error)' }} />
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
    const entries = providerEntries ?? [];

    if (entries.length === 0) return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{locale === 'zh' ? '添加一个模型服务商，即可开始与 MindOS Agent 对话。' : 'Add a model provider to start talking with MindOS Agent.'}</p>
        {onAdd && <button type="button" onClick={onAdd} className="min-h-11 inline-flex items-center gap-2 rounded-lg bg-[var(--amber-action)] px-4 text-sm font-medium text-[var(--amber-foreground)] transition-shadow hover:shadow-sm">
          <Plus size={14} /><span>{locale === 'zh' ? '添加服务商' : 'Add provider'}</span>
        </button>}
      </div>
    );

    return (
      <div className="space-y-2">
        <div data-provider-entry-grid className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map(cp => {
            const isSelected = value === cp.id;
            const preset = PROVIDER_PRESETS[cp.protocol];
            const displayName = cp.name.trim() || (locale === 'zh' ? preset.nameZh : preset.name);
            const protocolName = locale === 'zh' ? preset.nameZh : preset.name;
            const modelName = cp.model.trim() || preset.defaultModel;
            return (
              <button
                key={cp.id}
                type="button"
                onClick={() => onChange(cp.id)}
                aria-pressed={isSelected}
                title={`${displayName} · ${protocolName} · ${modelName}`}
                className={`group flex h-full min-h-[4.5rem] min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isSelected
                    ? 'border-[var(--amber)] bg-[var(--amber-subtle)]'
                    : 'border-border/60 bg-background/40 hover:border-border hover:bg-muted/35'
                }`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${
                  isSelected
                    ? 'bg-[var(--amber-action)] text-[var(--amber-foreground)]'
                    : 'bg-muted text-muted-foreground group-hover:text-foreground'
                }`}>
                  {preset.shortLabel.slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-medium ${isSelected ? 'text-foreground' : 'text-foreground/90'}`}>
                    {displayName}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {protocolName} · {modelName}
                  </span>
                </span>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center ${isSelected ? 'opacity-100' : 'opacity-0'}`} aria-hidden={!isSelected}>
                  <CheckCircle2 size={15} className="text-[var(--amber)]" />
                </span>
              </button>
            );
          })}

          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="flex min-h-[4.5rem] items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:border-[var(--amber)]/45 hover:bg-[var(--amber-subtle)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus size={14} />
              <span>{locale === 'zh' ? '添加服务商' : 'Add provider'}</span>
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
        {compact && showSkip && renderCompactSkip()}
        {primaryItems.map(id => compact ? renderCompactTab(id) : renderCard(id))}
      </div>

      {/* More toggle */}
      {secondaryItems.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowMore(!showMore)}
            className={compact
              ? 'flex w-full items-center justify-between gap-3 rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-left transition-colors hover:border-[var(--amber)]/40 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              : 'flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1'}
          >
            {compact ? (
              <>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {showMore
                      ? (locale === 'zh' ? '收起更多服务商' : 'Hide more providers')
                      : (locale === 'zh' ? `更多服务商 (${secondaryItems.length})` : `More providers (${secondaryItems.length})`)}
                  </span>
                  {!showMore && secondaryExamples && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {secondaryExamples}
                    </span>
                  )}
                </span>
                <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${showMore ? 'rotate-180' : ''}`} />
              </>
            ) : (
              <>
                <ChevronDown size={12} className={`transition-transform ${showMore ? 'rotate-180' : ''}`} />
                {showMore
                  ? (locale === 'zh' ? '收起' : 'Show less')
                  : (locale === 'zh'
                      ? `更多 (${secondaryItems.length})`
                      : `More (${secondaryItems.length})`)}
              </>
            )}
          </button>

          {showMore && (
            compact ? (
              <div className="space-y-2 rounded-lg border border-border/60 bg-background/35 p-2">
                {moreItems.length > 0 && (
                  <div>
                    <p className="px-1 pb-1 text-2xs font-medium text-muted-foreground">
                      {locale === 'zh' ? '云端服务商' : 'Cloud providers'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {moreItems.map(id => renderCompactTab(id))}
                    </div>
                  </div>
                )}
                {localItems.length > 0 && (
                  <div>
                    <p className="px-1 pb-1 pt-1 text-2xs font-medium text-muted-foreground">
                      {locale === 'zh' ? '本地模型' : 'Local models'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {localItems.map(id => renderCompactTab(id))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {secondaryItems.map(id => renderCard(id))}
              </div>
            )
          )}
        </>
      )}

      {/* Skip option — only in onboarding */}
      {showSkip && !compact && (
        <button
          type="button"
          onClick={() => onChange('skip')}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all text-sm w-full mt-1"
        style={{
          background: value === 'skip' ? 'color-mix(in srgb, var(--error) 7%, transparent)' : 'var(--card)',
          borderColor: value === 'skip' ? 'color-mix(in srgb, var(--error) 42%, var(--border))' : 'var(--border)',
        }}
      >
        <SkipForward size={14} className="shrink-0" style={{ color: value === 'skip' ? 'var(--error)' : 'var(--muted-foreground)' }} />
        <span className={`font-medium ${value === 'skip' ? '' : 'text-muted-foreground'}`} style={{ color: value === 'skip' ? 'var(--error)' : undefined }}>
          {locale === 'zh' ? '暂时跳过' : 'Skip for now'}
        </span>
        {value === 'skip' && (
          <CheckCircle2 size={14} className="ml-auto shrink-0" style={{ color: 'var(--error)' }} />
        )}
      </button>
      )}

    </div>
  );
}
