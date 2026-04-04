'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, SkipForward } from 'lucide-react';
import { type ProviderId, PROVIDER_PRESETS, groupedProviders } from '@/lib/agent/providers';
import { useLocale } from '@/lib/stores/locale-store';

interface ProviderSelectProps {
  value: ProviderId | 'skip';
  onChange: (id: ProviderId | 'skip') => void;
  showSkip?: boolean;
  compact?: boolean;
  configuredProviders?: Set<ProviderId>;
}

export default function ProviderSelect({
  value, onChange, showSkip = false, compact = false, configuredProviders,
}: ProviderSelectProps) {
  const { locale } = useLocale();
  const [showMore, setShowMore] = useState(false);
  const groups = groupedProviders();

  const renderItem = (id: ProviderId) => {
    const preset = PROVIDER_PRESETS[id];
    const displayName = locale === 'zh' ? preset.nameZh : preset.name;
    const isSelected = value === id;
    const isConfigured = configuredProviders?.has(id);

    if (compact) {
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
    }

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
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
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

  const { primary: primaryItems, more: moreItems } = groups;

  return (
    <div className="space-y-2">
      {/* Primary providers — always visible */}
      <div className={compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-1 gap-2'}>
        {primaryItems.map(renderItem)}
      </div>

      {/* Show more toggle */}
      {moreItems.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowMore(!showMore)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <ChevronDown size={12} className={`transition-transform ${showMore ? 'rotate-180' : ''}`} />
            {showMore
              ? (locale === 'zh' ? '收起' : 'Show less')
              : (locale === 'zh' ? `更多 (${moreItems.length})` : `More providers (${moreItems.length})`)}
          </button>

          {showMore && (
            <div className={compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-1 gap-2'}>
              {moreItems.map(renderItem)}
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
